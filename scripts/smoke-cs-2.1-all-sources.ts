/*!
 * Smoke test for sub-phase 2.1: all 4 sources wired through HTTP boundary.
 *
 * Verifies for each of HR/LDAP/Engineering/Finance:
 *   1. Source server starts and serves /health with non-zero recordCount
 *   2. Source /records/:id returns a record for a known sample id
 *   3. Connector server starts and its /health returns 200 (proxied)
 *   4. Connector /record/:id (singular, via the proxy chain) returns same data as source
 *   5. Connector /search with a known attribute filter returns >= 1 record
 *
 * Prerequisites:
 *   - API server on :5182 IS running (this smoke doesn't touch it)
 *   - All connector/source ports (5183-5191) are FREE before this smoke runs
 *   - The smoke launches the source servers (5188-5191) and connectors (5183-5186)
 *
 * Run with: ./node_modules/.bin/tsx.cmd scripts/smoke-cs-2.1-all-sources.ts
 *   (tsx is hoisted to root because staging/ is now a workspace)
 */

import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';
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

interface SmokeResult { passed: boolean; label: string; detail?: string }
const results: SmokeResult[] = [];
const record = (label: string, ok: boolean, detail?: string) => {
  results.push({ passed: ok, label, detail });
  const status = ok ? '✓' : '✗';
  console.log(`  ${status} ${label}${detail ? ` — ${detail}` : ''}`);
};

interface SourceSpec {
  name: string;
  sourceId: string;
  configName: string;
  sourcePort: number;
  connectorPort: number;
  sourceToken: string;
  connectorToken: string;
  sampleId: string;
  sampleAttr: { key: string; value: string };
}

const SOURCES: SourceSpec[] = [
  {
    name: 'HR',
    sourceId: 'conn-hr',
    configName: 'src-hr',
    sourcePort: 5188,
    connectorPort: 5183,
    sourceToken: 'gcuid_source_hr_token_12345',
    connectorToken: 'staging_hr_token_12345',
    sampleId: 'E10001',
    sampleAttr: { key: 'email', value: 'john.smith' },
  },
  {
    name: 'LDAP',
    sourceId: 'conn-ldap',
    configName: 'src-ldap',
    sourcePort: 5189,
    connectorPort: 5184,
    sourceToken: 'gcuid_source_ldap_token_12345',
    connectorToken: 'staging_ldap_token_12345',
    sampleId: 'jsmith',
    sampleAttr: { key: 'email', value: 'john.smith' },
  },
  {
    name: 'Engineering',
    sourceId: 'conn-engineering',
    configName: 'src-engineering',
    sourcePort: 5190,
    connectorPort: 5185,
    sourceToken: 'gcuid_source_engineering_token_12345',
    connectorToken: 'staging_eng_token_12345',
    sampleId: 'ENG-001',
    // John Smith exists in engineering, matches first_name LIKE '%John%'
    sampleAttr: { key: 'first_name', value: 'John' },
  },
  {
    name: 'Finance',
    sourceId: 'conn-finance',
    configName: 'src-finance',
    sourcePort: 5191,
    connectorPort: 5186,
    sourceToken: 'gcuid_source_finance_token_12345',
    connectorToken: 'staging_fin_token_12345',
    sampleId: 'FIN-001',
    // Patricia Jones exists in finance, matches first_name LIKE '%Pat%'
    sampleAttr: { key: 'first_name', value: 'Pat' },
  },
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
    req.setTimeout(5000, () => { req.destroy(new Error('request timeout')); });
  });
}

function post(url: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let parsed: any;
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('request timeout')); });
    req.write(data);
    req.end();
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(port: number, label: string, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await get(`http://127.0.0.1:${port}/health`);
      if (r.status === 200) return true;
    } catch {}
    await sleep(250);
  }
  return false;
}

const sourceProcs: ChildProcess[] = [];
let connectorsProc: ChildProcess | null = null;

function startSource(cfg: SourceSpec): ChildProcess {
  const cmd = `"${TSX}" ${path.join(STAGING_ROOT, 'scripts', 'start-sources.ts')} ${cfg.configName}`;
  const p = spawn(cmd, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  p.stdout?.on('data', () => {}); // suppress noise
  p.stderr?.on('data', (chunk) => process.stderr.write(`[src-${cfg.name}] ${chunk}`));
  return p;
}

function startConnectors(): ChildProcess {
  const cmd = `"${TSX}" ${path.join(STAGING_ROOT, 'scripts', 'start-connectors.ts')}`;
  const p = spawn(cmd, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  p.stdout?.on('data', () => {});
  p.stderr?.on('data', (chunk) => process.stderr.write(`[connectors] ${chunk}`));
  return p;
}

async function cleanup(): Promise<void> {
  for (const p of sourceProcs) {
    try { p.kill('SIGTERM'); } catch {}
  }
  if (connectorsProc) {
    try { connectorsProc.kill('SIGTERM'); } catch {}
  }
  await sleep(500);
}

async function main() {
  console.log(`\n=== smoke-cs-2.1: all 4 sources wired through HTTP ===\n`);

  // Step 1: launch all 4 source servers
  console.log('[Step 1] Launch all 4 source servers (5188-5191)');
  for (const cfg of SOURCES) {
    const p = startSource(cfg);
    sourceProcs.push(p);
  }
  // Wait for all sources to become healthy in parallel
  const sourceReady = await Promise.all(
    SOURCES.map(async (cfg) => {
      const ok = await waitForHealth(cfg.sourcePort, `${cfg.name} source`, 10000);
      record(`${cfg.name} source :${cfg.sourcePort} /health returns 200`, ok);
      return ok;
    })
  );

  // Step 2: per-source /info + recordCount + sample-id lookup
  console.log('\n[Step 2] Per-source /info + sample record lookup');
  for (const cfg of SOURCES) {
    if (!sourceReady[SOURCES.indexOf(cfg)]) continue;
    try {
      const info = await get(`http://127.0.0.1:${cfg.sourcePort}/info`,
        { 'Authorization': `Bearer ${cfg.sourceToken}` });
      record(`${cfg.name} source /info.sourceId === "${cfg.sourceId}"`,
        info.body?.sourceId === cfg.sourceId,
        `got ${info.body?.sourceId}`);
    } catch (e: any) {
      record(`${cfg.name} source /info accessible`, false, e.message);
    }
    try {
      const rec = await get(`http://127.0.0.1:${cfg.sourcePort}/records/${cfg.sampleId}`,
        { 'Authorization': `Bearer ${cfg.sourceToken}` });
      record(`${cfg.name} source /records/${cfg.sampleId} returns 200`,
        rec.status === 200, `status=${rec.status}`);
    } catch (e: any) {
      record(`${cfg.name} source /records/${cfg.sampleId}`, false, e.message);
    }
    try {
      const health = await get(`http://127.0.0.1:${cfg.sourcePort}/health`);
      const rc = health.body?.recordCount ?? 0;
      record(`${cfg.name} source recordCount > 0`, rc > 0, `recordCount=${rc}`);
    } catch {}
  }

  // Step 3: launch connectors
  console.log('\n[Step 3] Launch all 4 connector servers (5183-5186)');
  connectorsProc = startConnectors();
  // Wait for all 4 connectors
  const connectorReady = await Promise.all(
    SOURCES.map(async (cfg) => {
      const ok = await waitForHealth(cfg.connectorPort, `${cfg.name} connector`, 15000);
      record(`${cfg.name} connector :${cfg.connectorPort} /health returns 200`, ok);
      return ok;
    })
  );

  // Step 4: per-connector proxy round-trip — get the same record via the connector as via the source
  console.log('\n[Step 4] Per-connector proxy round-trip (connector → source → SQLite)');
  for (const cfg of SOURCES) {
    const idx = SOURCES.indexOf(cfg);
    if (!sourceReady[idx] || !connectorReady[idx]) continue;
    try {
      const viaConnector = await get(`http://127.0.0.1:${cfg.connectorPort}/record/${cfg.sampleId}`,
        { 'Authorization': `Bearer ${cfg.connectorToken}` });
      record(`${cfg.name} connector /record/${cfg.sampleId} returns 200`,
        viaConnector.status === 200, `status=${viaConnector.status}`);
      const recId = viaConnector.body?.recordId;
      record(`${cfg.name} connector proxy returned recordId "${cfg.sampleId}"`,
        recId === cfg.sampleId,
        `got recordId=${recId}`);
    } catch (e: any) {
      record(`${cfg.name} connector proxy round-trip`, false, e.message);
    }
  }

  // Step 5: per-connector search via the proxy
  console.log('\n[Step 5] Per-connector /search via the proxy');
  for (const cfg of SOURCES) {
    const idx = SOURCES.indexOf(cfg);
    if (!sourceReady[idx] || !connectorReady[idx]) continue;
    try {
      const search = await post(`http://127.0.0.1:${cfg.connectorPort}/search`,
        { attributes: { [cfg.sampleAttr.key]: cfg.sampleAttr.value }, limit: 5 },
        { 'Authorization': `Bearer ${cfg.connectorToken}` });
      record(`${cfg.name} connector /search returns 200`,
        search.status === 200, `status=${search.status}`);
      const count = Array.isArray(search.body?.records) ? search.body.records.length : 0;
      record(`${cfg.name} connector /search returns >=1 record`,
        count >= 1, `got ${count} records`);
    } catch (e: any) {
      record(`${cfg.name} connector /search`, false, e.message);
    }
  }

  // Step 6: source-direct search for completeness
  console.log('\n[Step 6] Per-source /search (proves source server is the one doing the query)');
  for (const cfg of SOURCES) {
    const idx = SOURCES.indexOf(cfg);
    if (!sourceReady[idx]) continue;
    try {
      const search = await post(`http://127.0.0.1:${cfg.sourcePort}/search`,
        { attributes: { [cfg.sampleAttr.key]: cfg.sampleAttr.value }, limit: 5 },
        { 'Authorization': `Bearer ${cfg.sourceToken}` });
      record(`${cfg.name} source /search returns 200`,
        search.status === 200, `status=${search.status}`);
    } catch (e: any) {
      record(`${cfg.name} source /search`, false, e.message);
    }
  }

  finish();
}

async function finish() {
  await cleanup();
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n=== smoke-cs-2.1: ${passed}/${results.length} assertions passed ===\n`);
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
  await cleanup();
  process.exit(2);
});
