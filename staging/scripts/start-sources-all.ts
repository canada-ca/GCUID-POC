/*!
 * GCUID Staging — All Source Servers Launcher
 *
 * Reads every JSON config in staging/config/sources/ and starts one
 * SourceAPIServer per source. Use this to launch the full source tier.
 *
 * Usage: tsx scripts/start-sources-all.ts
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  SourceAPIServer,
  createSqliteSourceProvider,
  SourceConfig,
} from '../../packages/core/dist/index.js';

// ESM-safe __dirname equivalent (tsx runs as ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// better-sqlite3 is a CJS module — use createRequire so tsx's ESM loader can resolve it.
const _require = createRequire(import.meta.url);

const STAGING_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCES_DIR = path.join(STAGING_ROOT, 'config', 'sources');
const LOGS_DIR = path.join(STAGING_ROOT, 'data', 'logs');

// tsx may live at staging/node_modules/.bin/tsx.cmd (pre-workspace layout) or at
// root/node_modules/.bin/tsx.cmd (when staging/ is a root workspace and deps hoist).
// Check both locations; prefer staging if both exist.
function resolveTsx(): string {
  const ext = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  const candidates = [
    path.join(STAGING_ROOT, 'node_modules', '.bin', ext),
    path.join(REPO_ROOT, 'node_modules', '.bin', ext),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

// Map source config-name to the --source= argument expected by seed-data.ts.
// Keep this in lockstep with staging/scripts/seed-data.ts main() switch.
const CONFIG_TO_SEED_FLAG: Record<string, string> = {
  'src-hr':          'hr',
  'src-ldap':        'ldap',
  'src-engineering': 'engineering',
  'src-finance':     'finance',
};

/**
 * If the source DB doesn't exist or is empty, seed it via seed-data.ts.
 *
 * Self-bootstrapping means each source can be launched in isolation and it
 * will bring its own data — no pre-existing conn-X.db required. Existing
 * data is preserved (no-op if the DB has rows).
 *
 * Returns true if seeding ran, false if data was already present.
 */
function seedSourceIfEmpty(argName: string, dbPath: string): boolean {
  if (fs.existsSync(dbPath)) {
    // DB exists — check if it has any rows
    try {
      const Database = _require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      const realTables = tables.filter((t) => !t.name.startsWith('sqlite_'));
      if (realTables.length === 0) {
        db.close();
      } else {
        const row = db
          .prepare(`SELECT COUNT(*) as c FROM ${realTables[0].name}`)
          .get() as { c: number };
        db.close();
        if (row.c > 0) {
          console.log(
            `[seed] ${path.basename(dbPath)} already has ${row.c} rows — skipping seed.`,
          );
          return false;
        }
      }
    } catch (e) {
      console.warn(
        `[seed] Could not inspect ${path.basename(dbPath)} (${(e as Error).message}); will re-seed.`,
      );
    }
  }

  const seedFlag = CONFIG_TO_SEED_FLAG[argName];
  if (!seedFlag) {
    console.warn(`[seed] No seed-data mapping for config ${argName}; assuming manual seed.`);
    return false;
  }

  console.log(
    `[seed] ${path.basename(dbPath)} missing or empty — seeding via seed-data.ts --source=${seedFlag}`,
  );
  const tsx = resolveTsx();
  const seedScript = path.join(STAGING_ROOT, 'scripts', 'seed-data.ts');
  const result = spawnSync(tsx, [seedScript, `--source=${seedFlag}`], {
    cwd: STAGING_ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    throw new Error(
      `seed-data.ts --source=${seedFlag} spawn error: ${result.error.message}`,
    );
  }
  if (result.signal) {
    throw new Error(
      `seed-data.ts --source=${seedFlag} killed by signal ${result.signal}`,
    );
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `seed-data.ts --source=${seedFlag} ran but ${path.basename(dbPath)} still missing`,
    );
  }
  return true;
}

async function startOne(argName: string): Promise<SourceAPIServer> {
  const configPath = path.join(SOURCES_DIR, `${argName}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  const config: SourceConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const dbPath = path.isAbsolute(config.database.path)
    ? config.database.path
    : path.join(STAGING_ROOT, config.database.path);

  // Self-bootstrap: if DB is missing or empty, seed it before starting.
  seedSourceIfEmpty(argName, dbPath);

  const provider = createSqliteSourceProvider({
    databasePath: dbPath,
    tableName: config.database.tableName,
    primaryKey: config.database.primaryKey,
    sourceId: config.sourceId,
    sourceName: config.sourceName,
  });

  const server = new SourceAPIServer(config, provider);
  await server.start();

  console.log(`📡 Source ${config.sourceName}`);
  console.log(`   Source ID:  ${config.sourceId}`);
  console.log(`   Port:       ${config.port}`);
  console.log(`   Database:   ${dbPath}`);
  console.log(
    `   Table:      ${config.database.tableName} (primary key: ${config.database.primaryKey})`,
  );
  console.log(`✅ Source server running at http://localhost:${config.port}`);
  console.log('');

  return server;
}

async function main() {
  // Optional --only=<name> filter for debugging a single source.
  // Usage: tsx scripts/start-sources-all.ts --only=src-hr
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const onlyName = onlyArg ? onlyArg.split('=')[1] : null;

  if (!fs.existsSync(SOURCES_DIR)) {
    console.error(`No sources directory at ${SOURCES_DIR}`);
    process.exit(1);
  }

  const configs = fs
    .readdirSync(SOURCES_DIR)
    .filter((f) => f.startsWith('src-') && f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((n) => (onlyName ? n === onlyName : true));

  if (configs.length === 0) {
    console.error(`No source configs found in ${SOURCES_DIR}`);
    process.exit(1);
  }

  console.log(`\n🛰  Launching ${configs.length} source servers...\n`);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

  const servers: SourceAPIServer[] = [];

  // Stagger startup so the ports come up sequentially.
  for (const name of configs) {
    try {
      const server = await startOne(name);
      servers.push(server);
    } catch (e) {
      console.error(`❌ Failed to start ${name}: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  if (servers.length === 0) {
    console.error('No source servers started successfully.');
    process.exit(1);
  }

  console.log(`\n✅ ${servers.length} source servers running.`);

  // Graceful shutdown — stop all servers on signal
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — stopping ${servers.length} source server(s)...`);
    await Promise.allSettled(servers.map((s) => s.stop()));
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep the parent alive — on Windows the job-object would kill
  // everything when this process exits. Park on a never-resolving
  // promise; the SIGINT/SIGTERM handler above will resolve things.
  await new Promise<void>(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});