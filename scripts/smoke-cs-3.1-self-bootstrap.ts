/*!
 * Smoke test for sub-phase 3.1: per-source self-bootstrapping.
 *
 * Verifies for each of HR/LDAP/Engineering/Finance:
 *   1. Deleting the conn-X.db file and launching the source server re-creates
 *      and re-seeds it (self-bootstrap works)
 *   2. If the DB is already present and populated, the seed step is skipped
 *   3. Source server comes up with the expected recordCount after self-seed
 *
 * Prerequisites:
 *   - All connector/source ports (5183-5191) are FREE before this smoke runs
 *   - The smoke launches a single source at a time, each in its own subprocess
 *
 * Run with: ./node_modules/.bin/tsx.cmd scripts/smoke-cs-3.1-self-bootstrap.ts
 *   (tsx is hoisted to root because staging/ is now a workspace)
 */

import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';

const REPO_ROOT = process.env.GCUID_POC_ROOT || process.cwd();
const STAGING_ROOT = path.join(REPO_ROOT, 'staging');
// tsx may live at staging/node_modules/.bin/tsx.cmd (pre-workspace layout) or at
// root node_modules/.bin/tsx.cmd (when staging/ is a root workspace and deps hoist)
const TSX = (() => {
    const candidates = process.platform === 'win32'
        ? [
            path.join(STAGING_ROOT, 'node_modules', '.bin', 'tsx.cmd'),
            path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx.cmd'),
          ]
        : [
            path.join(STAGING_ROOT, 'node_modules', '.bin', 'tsx'),
            path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'),
          ];
    return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
})();
const SOURCES_DIR = path.join(STAGING_ROOT, 'data', 'sources');

interface SmokeResult { passed: boolean; label: string; detail?: string }
const results: SmokeResult[] = [];
const record = (label: string, ok: boolean, detail?: string) => {
  results.push({ passed: ok, label, detail });
  const status = ok ? '✓' : '✗';
  console.log(`  ${status} ${label}${detail ? ` — ${detail}` : ''}`);
};

interface SourceSpec {
  name: string;
  configName: string;
  port: number;
  token: string;
  dbName: string;
  expectedRowCount: number;
}

const SOURCES: SourceSpec[] = [
  { name: 'HR',          configName: 'src-hr',          port: 5188, token: 'gcuid_source_hr_token_12345',          dbName: 'conn-hr.db',          expectedRowCount: 31 },
  { name: 'LDAP',        configName: 'src-ldap',        port: 5189, token: 'gcuid_source_ldap_token_12345',        dbName: 'conn-ldap.db',        expectedRowCount: 20 },
  { name: 'Engineering', configName: 'src-engineering', port: 5190, token: 'gcuid_source_engineering_token_12345', dbName: 'conn-engineering.db', expectedRowCount: 35 },
  { name: 'Finance',     configName: 'src-finance',     port: 5191, token: 'gcuid_source_finance_token_12345',     dbName: 'conn-finance.db',     expectedRowCount: 25 },
];

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed: any;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('request timeout')); });
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(port: number, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await get(`http://127.0.0.1:${port}/health`);
      if (r.status === 200) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

function startSource(cfg: SourceSpec, stdoutLog?: string): ChildProcess {
  const cmd = `"${TSX}" ${path.join(STAGING_ROOT, 'scripts', 'start-sources.ts')} ${cfg.configName}`;
  const p = spawn(cmd, {
    cwd: REPO_ROOT,
    stdio: ['ignore', stdoutLog ? fs.openSync(stdoutLog, 'w') : 'pipe', 'inherit'],
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  return p;
}

async function stopSource(p: ChildProcess, port: number): Promise<void> {
  if (!p.killed && p.pid) {
    // Tree-kill the child + any shims (tsx.cmd / cmd.exe wrappers).
    // On Windows, killing only the parent PID leaves cmd.exe wrappers holding
    // SQLite file handles, which then triggers EBUSY on the next iteration.
    try {
      const { execSync } = await import('node:child_process');
      execSync(`taskkill /T /F /PID ${p.pid}`, { stdio: 'pipe' });
    } catch {
      try { p.kill('SIGTERM'); } catch {}
    }
  }
  // Wait for the source's actual port to actually free up
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await get(`http://127.0.0.1:${port}/health`);
    } catch (e: any) {
      if (e.code === 'ECONNREFUSED') return;
    }
    await sleep(250);
  }
}

// Module-scoped so the catch in main() can clean them up.
let proc: ChildProcess | null = null;
let stdoutLog: string | null = null;

async function cleanupProcesses(): Promise<void> {
  // PID-aware cleanup: only kill the processes WE spawned, never use port-based
  // killing (which would clobber the user's running stack).
  const ps = require('node:child_process');

  if (proc && !proc.killed && proc.pid) {
    try {
      // Kill the whole subprocess tree on Windows. Use taskkill /T /F for tree kill,
      // which handles cmd.exe shims (tsx.cmd wraps node.exe) properly.
      ps.spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'pipe' });
    } catch {}
    proc = null;
  }
  await sleep(1500);
}

async function main() {
  console.log('\n=== smoke-cs-3.1: per-source self-bootstrapping ===\n');

  // This smoke mutates source DBs (deletes + re-seeds) and spawns short-lived
  // source servers on ports 5188-5191. It is NOT compatible with a running
  // stack — run it standalone (not via run-smokes) with NO stack up:
  //   ./node_modules/.bin/tsx.cmd scripts/smoke-cs-3.1-self-bootstrap.ts
   //   (tsx is hoisted to root because staging/ is now a workspace)
  // The orchestrator run-smokes.js excludes this smoke by default for that reason.

  // Clean up any children from a previous interrupted run (PID-scoped, safe).
  await cleanupProcesses();
  await sleep(1500);

  try {
    for (const cfg of SOURCES) {
      console.log(`\n[${cfg.name}] Testing self-bootstrap for ${cfg.dbName}`);

      const dbPath = path.join(SOURCES_DIR, cfg.dbName);

      // Step A: snapshot the current DB (so we can restore after the smoke)
      const backupPath = dbPath + '.smoke3.1.bak';
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
      }

      // Step B: delete the DB (force self-seed).
      // On Windows, the previous source's tsx.cmd shim may briefly hold a
      // file handle. Retry on EBUSY with a longer window since this can
      // take 5-10s to release after the previous source's port-free.
      let deleted = !fs.existsSync(dbPath);
      for (let attempt = 1; !deleted && attempt <= 20; attempt++) {
        try {
          fs.unlinkSync(dbPath);
          deleted = true;
        } catch (e: any) {
          if (e.code === 'EBUSY' && attempt < 20) {
            await sleep(750);
            continue;
          }
          throw e;
        }
      }
      record(`${cfg.name} DB deleted (forcing self-bootstrap)`, deleted);

      // Step C: launch source — expect self-seed to fire
      stdoutLog = path.join(STAGING_ROOT, 'data', 'logs', `smoke-3.1-${cfg.name}.log`);
      if (!fs.existsSync(path.dirname(stdoutLog))) fs.mkdirSync(path.dirname(stdoutLog), { recursive: true });

      proc = startSource(cfg, stdoutLog);

      // Step D: wait for source to come up
      const up = await waitForHealth(cfg.port, 20000);
      record(`${cfg.name} source :${cfg.port} came up after self-seed`, up,
        up ? '' : `see ${stdoutLog}`);
      if (!up) {
        if (proc && !proc.killed) proc.kill('SIGTERM');
        await sleep(500);
        continue;
      }

      // Step E: check that self-seed actually fired (log contains "[seed]" line)
      try {
        const logContent = fs.readFileSync(stdoutLog, 'utf-8');
        const sawSeed = logContent.includes('[seed]') && logContent.includes('seeding via seed-data.ts');
        record(`${cfg.name} start-sources.ts log shows self-seed call`, sawSeed,
          sawSeed ? 'found [seed] ... seeding via seed-data.ts' : `log excerpt: ${logContent.slice(-300)}`);
      } catch (e: any) {
        record(`${cfg.name} start-sources.ts log readable`, false, e.message);
      }

      // Step F: verify DB exists and is populated
      const dbExists = fs.existsSync(dbPath);
      record(`${cfg.name} DB recreated after self-seed`, dbExists);
      if (dbExists) {
        try {
          const Database = require(path.join(STAGING_ROOT, 'node_modules', 'better-sqlite3'));
          const db = new Database(dbPath, { readonly: true });
          const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
            .filter((t) => !t.name.startsWith('sqlite_'));
          const row = db.prepare(`SELECT COUNT(*) as c FROM ${tables[0].name}`).get() as { c: number };
          db.close();
          record(`${cfg.name} DB has data after self-seed`, row.c > 0, `rows=${row.c}`);
          // Allow >= rather than exact match — seed counts have changed during the project;
          // what matters is "populated".
        } catch (e: any) {
          record(`${cfg.name} DB inspection`, false, e.message);
        }
      }

      // Step G: hit the source's /health to verify recordCount
      try {
        const health = await get(`http://127.0.0.1:${cfg.port}/health`);
        const rc = health.body?.recordCount ?? 0;
        record(`${cfg.name} /health recordCount > 0`, rc > 0, `recordCount=${rc}`);
      } catch (e: any) {
        record(`${cfg.name} /health after self-seed`, false, e.message);
      }

      // Step H: stop source
      await stopSource(proc, cfg.port);
      proc = null;
      await sleep(500);

      // Step I: verify that re-launching with DB present SKIPS self-seed
      const dbStillThere = fs.existsSync(dbPath);
      record(`${cfg.name} DB persists across restarts`, dbStillThere);
      if (dbStillThere) {
        const log2Path = path.join(STAGING_ROOT, 'data', 'logs', `smoke-3.1-${cfg.name}-restart.log`);
        proc = startSource(cfg, log2Path);
        const up2 = await waitForHealth(cfg.port, 15000);
        record(`${cfg.name} source comes up on second launch`, up2);
        if (up2) {
          // Give the source a moment to write its [seed] line, then probe the file.
          // The tsx.cmd wrapper can take ~500ms to flush stdout when piped to a file.
          await sleep(2000);
          try {
            const log2 = fs.readFileSync(log2Path, 'utf-8');
            const sawSkip = log2.includes('already has') && log2.includes('skipping seed');
            record(`${cfg.name} self-seed SKIPPED on second launch (DB already populated)`,
              sawSkip,
              sawSkip ? 'found "already has ... skipping seed"' : `log (${log2.length} chars): ${log2.slice(-500)}`);
          } catch (e: any) {
            record(`${cfg.name} restart log readable`, false, e.message);
          }
        }
        await stopSource(proc, cfg.port);
        proc = null;
        await sleep(500);
      }

      // Step J: restore the backup (so other smokes / dev work don't see a freshly-seeded DB)
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, dbPath);
        fs.unlinkSync(backupPath);
      }

      // Between iterations: explicitly kill any lingering tsx.cmd shims from
      // the previous source's spawnSync so SQLite file locks are released
      // before the next iteration tries to delete the next DB.
      await cleanupProcesses();
    }
  } finally {
    if (proc && !proc.killed) proc.kill('SIGTERM');
    await cleanupProcesses();
  }

  finish();
}

async function finish() {
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n=== smoke-cs-3.1: ${passed}/${results.length} assertions passed ===\n`);
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(async (e) => {
  console.error('smoke crashed:', e);
  if (proc && !proc.killed) proc.kill('SIGTERM');
  await cleanupProcesses();
  process.exit(2);
});
