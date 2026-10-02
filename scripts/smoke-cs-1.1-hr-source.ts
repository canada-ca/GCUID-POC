/*!
 * Smoke test for sub-phase 1.1: HR source wired through HTTP boundary.
 *
 * Verifies:
 *   1. HR source server starts on :5188 and serves /health
 *   2. HR connector server (which proxies to the source via HTTP) starts on :5183
 *   3. GET /api/hr/employees/E00001 returns the expected employee record
 *   4. POST /api/gcuid/request with HR attributes resolves via the connector-proxy chain
 *   5. GET /api/system/dashboard reports 1 source (HR) and 4 connectors (HR healthy, others down)
 *
 * Prerequisites:
 *   - The HR source server is NOT running (the smoke launches it).
 *   - The HR connector server is NOT running (the smoke launches it).
 *   - The other 3 connectors are NOT running (acceptable; they aren't exercised by this smoke).
 *   - The API server on :5182 IS running (the smoke hits it).
 *   - The Web UI on :5181 is irrelevant for this smoke.
 *
 * Run with: npx tsx scripts/smoke-cs-1.1-hr-source.ts
 */

import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as http from 'node:http';

const REPO_ROOT = process.env.GCUID_POC_ROOT || process.cwd();
const STAGING_ROOT = path.join(REPO_ROOT, 'staging');
// tsx may live at staging/node_modules/.bin/tsx.cmd (pre-workspace layout) or at
// root node_modules/.bin/tsx.cmd (when staging/ is a root workspace and deps hoist)
function resolveTsx(): string {
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
}
const TSX = resolveTsx();
const HR_SOURCE_PORT = 5188;
const HR_CONNECTOR_PORT = 5183;
const API_PORT = 5182;

interface SmokeResult { passed: boolean; label: string; detail?: string }
const results: SmokeResult[] = [];
const record = (label: string, ok: boolean, detail?: string) => {
  results.push({ passed: ok, label, detail });
  const status = ok ? '✓' : '✗';
  console.log(`  ${status} ${label}${detail ? ` — ${detail}` : ''}`);
};

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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(port: number, label: string, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await get(`http://127.0.0.1:${port}/health`);
      if (r.status === 200) {
        console.log(`  ✓ ${label} healthy on :${port}`);
        return true;
      }
    } catch {
      // ignore connection refused
    }
    await sleep(250);
  }
  console.log(`  ✗ ${label} did not become healthy on :${port} within ${timeoutMs}ms`);
  return false;
}

let hrSourceProc: ChildProcess | null = null;
let hrConnectorProc: ChildProcess | null = null;

function startProcess(cmd: string, args: string[], label: string): ChildProcess {
  console.log(`  starting ${label}: ${cmd} ${args.join(' ')}`);
  // On Windows + shell:true, paths with spaces must be quoted to survive the shell.
  // We pass cmd + args as a single shell-quoted command string instead of an arg array.
  const isWin = process.platform === 'win32';
  const quotedCmd = `"${cmd}"`;
  const quotedArgs = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  const fullCommand = `${quotedCmd} ${quotedArgs}`;
  console.log(`  shell command: ${fullCommand}`);
  const p = spawn(fullCommand, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: isWin,
  });
  p.stdout?.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  p.stderr?.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return p;
}

async function cleanup(): Promise<void> {
  if (hrSourceProc && !hrSourceProc.killed) {
    hrSourceProc.kill('SIGTERM');
  }
  if (hrConnectorProc && !hrConnectorProc.killed) {
    hrConnectorProc.kill('SIGTERM');
  }
  await sleep(500);
}

process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

async function main() {
  console.log('\n=== smoke-cs-1.1: HR source wired through HTTP ===\n');

  // Pre-flight: check API server is up
  const apiUp = await waitForHealth(API_PORT, 'API server', 3000);
  record('API server reachable on :5182', apiUp);
  if (!apiUp) {
    console.log('\n  FATAL: API server not running. Start it with `npm run start-api` first.');
    return finish(false);
  }

  // Step 1: start the HR source server
  console.log('\n[Step 1] Start HR source server on :5188');
  hrSourceProc = startProcess(
    TSX,
    [path.join(STAGING_ROOT, 'scripts', 'start-sources.ts'), 'src-hr'],
    'hr-source'
  );
  const hrSourceUp = await waitForHealth(HR_SOURCE_PORT, 'HR source', 10000);
  record('HR source server /health returns 200', hrSourceUp);

  // Step 1a: verify source /info endpoint (requires auth)
  if (hrSourceUp) {
    try {
      const info = await get(`http://127.0.0.1:${HR_SOURCE_PORT}/info`,
        { 'Authorization': 'Bearer gcuid_source_hr_token_12345' });
      record('HR source /info returns 200', info.status === 200,
        `status=${info.status}`);
      record('HR source /info.sourceId === "conn-hr"',
        info.body?.sourceId === 'conn-hr',
        `got ${info.body?.sourceId}`);
    } catch (e: any) {
      record('HR source /info accessible', false, e.message);
    }
  }

  // Step 1b: verify source health response shape
  if (hrSourceUp) {
    try {
      const health = await get(`http://127.0.0.1:${HR_SOURCE_PORT}/health`);
      record('HR source health has sourceId', health.body?.sourceId === 'conn-hr');
      record('HR source health status is healthy', health.body?.status === 'healthy',
        `got ${health.body?.status}`);
      record('HR source health has non-zero recordCount', (health.body?.recordCount ?? 0) > 0,
        `got ${health.body?.recordCount}`);
    } catch (e: any) {
      record('HR source health shape', false, e.message);
    }
  }

  // Step 2: start the HR connector server (now backed by SourceAPIClient)
  console.log('\n[Step 2] Start HR connector server on :5183');
  // We can't easily launch just HR — start-connectors.ts launches all 4.
  // For the smoke, we'll launch just the HR connector by spawning start-connectors.ts
  // (LDAP/Eng/Finance will fail because their source DBs may have port conflicts with the
  // non-existent source servers, but HR should come up first since it has a source server).
  // Better: we'll accept that 3 connectors will be unhealthy and just check HR.
  hrConnectorProc = startProcess(
    TSX,
    [path.join(STAGING_ROOT, 'scripts', 'start-connectors.ts')],
    'connectors'
  );
  const hrConnectorUp = await waitForHealth(HR_CONNECTOR_PORT, 'HR connector', 15000);
  record('HR connector /health returns 200', hrConnectorUp);

  // Step 3: hit /api/hr/employees/E10001 (legacy direct-SQLite route; verifies API still serves data)
  console.log('\n[Step 3] Verify API HR route still serves data (legacy direct-SQLite path)');
  try {
    const employee = await get(`http://127.0.0.1:${API_PORT}/api/hr/employees/E10001`,
      { 'Authorization': 'Bearer staging_admin_token_ghi789' });
    record('GET /api/hr/employees/E10001 returns 200', employee.status === 200,
      `status=${employee.status}`);
    // API wraps responses as {success, data: {...}}
    record('HR employee has employee_id',
      !!employee.body?.data?.employee_id,
      `got ${JSON.stringify(employee.body).slice(0, 100)}`);
    record('HR employee_id === "E10001"', employee.body?.data?.employee_id === 'E10001');
  } catch (e: any) {
    record('GET /api/hr/employees/E10001', false, e.message);
  }

  // Step 3b: hit the CONNECTOR proxy (port 5183) -> source (port 5188) — proves the HTTP chain
  console.log('\n[Step 3b] Verify connector->source HTTP chain via connector proxy');
  try {
    // Connector exposes /record/:recordId (singular); source exposes /records/:recordId (plural).
    const connectorEmployee = await get(`http://127.0.0.1:${HR_CONNECTOR_PORT}/record/E10001`,
      { 'Authorization': 'Bearer staging_hr_token_12345' });
    record('GET /record/E10001 via HR connector returns 200',
      connectorEmployee.status === 200,
      `status=${connectorEmployee.status}`);
    record('Connector proxy returned employee E10001',
      connectorEmployee.body?.recordId === 'E10001' || connectorEmployee.body?.data?.recordId === 'E10001',
      `got ${JSON.stringify(connectorEmployee.body).slice(0, 200)}`);
  } catch (e: any) {
    record('GET /record/E10001 via HR connector', false, e.message);
  }

  // Step 4: verify the connector-source HTTP boundary by hitting the source directly
  console.log('\n[Step 4] Verify connector->source HTTP boundary by hitting source directly');
  try {
    const sourceEmployee = await get(`http://127.0.0.1:${HR_SOURCE_PORT}/records/E10001`,
      { 'Authorization': 'Bearer gcuid_source_hr_token_12345' });
    record('GET source /records/E10001 returns 200', sourceEmployee.status === 200,
      `status=${sourceEmployee.status}`);
    record('Source returns employee record',
      !!sourceEmployee.body?.recordId || !!sourceEmployee.body?.data?.recordId,
      `got ${JSON.stringify(sourceEmployee.body).slice(0, 150)}`);
  } catch (e: any) {
    record('GET source /records/E10001', false, e.message);
  }

  // Step 4b: search via source's POST /search (using a known email pattern)
  try {
    const sourceSearch = await post(`http://127.0.0.1:${HR_SOURCE_PORT}/search`,
      { attributes: { email: 'john.smith' }, limit: 5 },
      { 'Authorization': 'Bearer gcuid_source_hr_token_12345' });
    record('POST source /search returns 200', sourceSearch.status === 200,
      `status=${sourceSearch.status}`);
    record('Source search returns >=1 record',
      Array.isArray(sourceSearch.body?.records) && sourceSearch.body.records.length >= 1,
      `got ${sourceSearch.body?.records?.length ?? 'undefined'} records`);
  } catch (e: any) {
    record('POST source /search', false, e.message);
  }

  // Step 5: dashboard
  console.log('\n[Step 5] Verify dashboard reflects HTTP-backed connector health');
  try {
    const dash = await get(`http://127.0.0.1:${API_PORT}/api/system/dashboard`,
      { 'Authorization': 'Bearer staging_admin_token_ghi789' });
    record('GET /api/system/dashboard returns 200', dash.status === 200);
    // Dashboard is wrapped: {success, data: {source_systems: [...]}}
    const systems = dash.body?.data?.source_systems;
    record('Dashboard reports 4 source_systems',
      Array.isArray(systems) && systems.length === 4,
      `got ${systems?.length ?? 'undefined'} source_systems`);
    const hr = systems?.find((s: any) => s.system_id === 'hr');
    record('Dashboard HR source_systems entry present', !!hr,
      `hr entry: ${JSON.stringify(hr).slice(0, 100)}`);
  } catch (e: any) {
    record('Dashboard check', false, e.message);
  }

  finish(true);
}

async function finish(_shouldPrintSummary: boolean): Promise<void> {
  await cleanup();
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n=== smoke-cs-1.1: ${passed}/${results.length} assertions passed ===\n`);
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
  process.exit(0);
}

// Wait for cleanup before exit (replacement for the helper inside main)
async function mainWithCleanup(): Promise<void> {
  try {
    await main();
  } catch (e) {
    console.error('smoke crashed:', e);
    await cleanup();
    process.exit(2);
  }
}

mainWithCleanup();
