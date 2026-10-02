/*!
 * Smoke test: post-refactor runtime invariants.
 *
 * Verifies the data + connectivity invariants the System->System page's
 * Ping/Health buttons depend on. Catches the class of bug where the
 * connectors are healthy but the registry's view of them is stale.
 *
 * What this smoke does NOT do:
 *   - Does NOT spawn or kill processes (the user's stack is canonical).
 *   - Does NOT mutate registry.db (read-only on the live DB).
 *   - Does NOT mock the stack. If the stack isn't up, this smoke fails
 *     with a clear error so the developer knows to start it.
 *
 * Invariants checked:
 *
 *   Section A — Stack liveness
 *     A1. API server reachable on :5182
 *     A2. All 4 connectors reachable on :5183-:5186
 *     A3. All 4 sources reachable on :5188-:5191
 *
 *   Section B — Registry data integrity (the bug class from commit e5c3b8c)
 *     For each connector row in source_systems:
 *       B1. system_id ↔ connector_id mapping matches staging/config/connectors/
 *       B2. api_url points to a port that is in the dev-ports registry
 *       B3. api_url port matches the connector JSON's connectorServer.port
 *       B4. api_secret matches the connector JSON's connectorServer.authToken
 *
 *   Section C — UI-equivalent connector probe (replaces System->System buttons)
 *     For each connector:
 *       C1. GET /api/connectors/{id}/ping returns reachable=true
 *       C2. GET /api/connectors/{id}/health returns reachable=true and no error
 *       C3. /health latency_ms < 500ms
 *
 * Run with: ./node_modules/.bin/tsx.cmd scripts/smoke-invariants-runtime.ts
 *   (tsx is hoisted to root because staging/ is now a workspace)
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import Database from 'better-sqlite3';

const REPO_ROOT = process.env.GCUID_POC_ROOT || process.cwd();
const STAGING_ROOT = path.join(REPO_ROOT, 'staging');
const REGISTRY_DB_PATH = path.join(STAGING_ROOT, 'data', 'registry.db');
const CONNECTOR_CONFIG_DIR = path.join(STAGING_ROOT, 'config', 'connectors');
const DEV_PORTS_JSON = 'E:\\github\\.dev-ports.json';
const API_BASE = 'http://127.0.0.1:5182';

interface SmokeResult { passed: boolean; label: string; detail?: string }
const results: SmokeResult[] = [];
const record = (label: string, ok: boolean, detail?: string) => {
  results.push({ passed: ok, label, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed: any;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
  });
}

async function tcpProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = require('node:net').createConnection({ host: '127.0.0.1', port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
  });
}

interface ConnectorConfig {
  systemId: string;
  displayName: string;
  connectorServer: { port: number; authToken: string };
}

interface SourceSystemRow {
  system_id: string;
  connector_id: string;
  api_url: string | null;
  api_secret: string | null;
}

const CONNECTORS = [
  { systemId: 'hr',          connectorId: 'conn-hr',          port: 5183 },
  { systemId: 'ldap',        connectorId: 'conn-ldap',        port: 5184 },
  { systemId: 'engineering', connectorId: 'conn-engineering', port: 5185 },
  { systemId: 'finance',     connectorId: 'conn-finance',     port: 5186 },
];

async function main() {
  console.log('\n=== smoke-invariants-runtime: post-refactor runtime invariants ===\n');
  console.log('This smoke verifies the System->System Ping/Health button surfaces.');
  console.log('It does NOT spawn processes — start your stack first (./start-dev.sh).\n');

  // ─── Section A — Stack liveness ──────────────────────────────────────────
  console.log('[A] Stack liveness');

  const apiUp = await tcpProbe(5182);
  record('A1a. API server listening on :5182', apiUp,
    apiUp ? '' : 'start the stack: ./start-dev.sh');
  if (!apiUp) return finish();

  const connectorLiveness: Record<string, boolean> = {};
  for (const c of CONNECTORS) {
    const up = await tcpProbe(c.port);
    connectorLiveness[c.connectorId] = up;
    record(`A2a. ${c.connectorId} listening on :${c.port}`, up,
      up ? '' : `connector not running on ${c.port}`);
  }

  const sourcePorts = [5188, 5189, 5190, 5191];
  const sourceLabels = ['HR source', 'LDAP source', 'Engineering source', 'Finance source'];
  for (let i = 0; i < sourcePorts.length; i++) {
    const up = await tcpProbe(sourcePorts[i]);
    record(`A3a. ${sourceLabels[i]} listening on :${sourcePorts[i]}`, up,
      up ? '' : `source server not running on ${sourcePorts[i]}`);
  }

  // ─── Section B — Registry data integrity ────────────────────────────────
  console.log('\n[B] Registry data integrity (source_systems ↔ connector JSON config)');

  // Load connector JSON configs
  const configs: Record<string, ConnectorConfig> = {};
  for (const c of CONNECTORS) {
    const cfgPath = path.join(CONNECTOR_CONFIG_DIR, `${c.connectorId}.json`);
    if (!fs.existsSync(cfgPath)) {
      record(`B0a. connector JSON exists: ${c.connectorId}.json`, false, `not found at ${cfgPath}`);
      continue;
    }
    configs[c.connectorId] = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  }

  // Load dev-ports.json if available (for B2)
  let devPorts: Record<string, { port: number }> = {};
  if (fs.existsSync(DEV_PORTS_JSON)) {
    try {
      devPorts = JSON.parse(fs.readFileSync(DEV_PORTS_JSON, 'utf-8')).projects || {};
      record('B0b. dev-ports.json loaded', true, `${Object.keys(devPorts).length} projects`);
    } catch (e: any) {
      record('B0b. dev-ports.json parseable', false, e.message);
    }
  } else {
    record('B0b. dev-ports.json present', false, `not at ${DEV_PORTS_JSON}`);
  }

  // Open registry DB read-only
  let regDb: Database.Database;
  try {
    regDb = new Database(REGISTRY_DB_PATH, { readonly: true });
  } catch (e: any) {
    record('B0c. registry.db readable', false, e.message);
    return finish();
  }
  record('B0c. registry.db readable (read-only)', true);

  for (const c of CONNECTORS) {
    const row = regDb.prepare(
      'SELECT system_id, connector_id, api_url, api_secret FROM source_systems WHERE system_id = ?'
    ).get(c.systemId) as SourceSystemRow | undefined;

    if (!row) {
      record(`B1. ${c.systemId} row exists in source_systems`, false, 'row missing');
      continue;
    }

    // B1: system_id ↔ connector_id matches
    record(`B1. ${c.systemId} → ${row.connector_id} matches canonical`,
      row.connector_id === c.connectorId,
      `got ${row.connector_id}`);

    // B3: api_url port matches connector JSON
    const cfg = configs[c.connectorId];
    if (cfg) {
      const expectedUrl = `http://localhost:${cfg.connectorServer.port}`;
      record(`B3. ${c.systemId} api_url = ${expectedUrl}`,
        row.api_url === expectedUrl,
        `got ${row.api_url}`);

      // B4: api_secret matches connector JSON
      record(`B4. ${c.systemId} api_secret matches ${c.connectorId}.json`,
        row.api_secret === cfg.connectorServer.authToken,
        row.api_secret ? `(token match)` : 'token missing');
    }

    // B2: api_url port is in dev-ports registry
    if (row.api_url) {
      const portMatch = row.api_url.match(/:(\d+)$/);
      if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        const matchingProject = Object.entries(devPorts).find(([_, p]) => p.port === port);
        record(`B2. ${c.systemId} port ${port} is in dev-ports registry`,
          !!matchingProject,
          matchingProject ? `→ ${matchingProject[0]}` : `port ${port} not registered`);
      } else {
        record(`B2. ${c.systemId} api_url is parseable`, false, `no port: ${row.api_url}`);
      }
    } else {
      record(`B2. ${c.systemId} api_url is set`, false, 'api_url is null');
    }
  }
  regDb.close();

  // ─── Section C — UI-equivalent connector probe ───────────────────────────
  console.log('\n[C] UI-equivalent connector probe (System->System Ping/Health)');

  // Need admin token to call /api/* endpoints. Use the same token the API uses for admin routes.
  // This is the standard demo admin token from staging/api/auth.ts.
  const adminToken = 'gcuid_admin_token_demo';

  for (const c of CONNECTORS) {
    // C1: ping
    const ping = await httpGet(`${API_BASE}/api/connectors/${c.connectorId}/ping`,
      { Authorization: `Bearer ${adminToken}` });
    const pingBody = ping.body?.data ?? {};
    record(`C1. ${c.connectorId} ping returns reachable=true`,
      ping.status === 200 && pingBody.reachable === true,
      pingBody.reachable === true
        ? `${pingBody.latency_ms}ms status=${pingBody.status_code} base=${pingBody.base_url}`
        : `reachable=${pingBody.reachable} base=${pingBody.base_url ?? 'n/a'}`);

    // C2 + C3: health
    const health = await httpGet(`${API_BASE}/api/connectors/${c.connectorId}/health`,
      { Authorization: `Bearer ${adminToken}` });
    const healthBody = health.body?.data ?? {};
    const healthOk = healthBody.reachable === true && !healthBody.error;
    record(`C2. ${c.connectorId} health returns reachable=true and no error`,
      health.status === 200 && healthOk,
      healthOk
        ? `${healthBody.latency_ms}ms`
        : `error=${healthBody.error ?? 'none'} status=${healthBody.status_code ?? 'n/a'}`);

    record(`C3. ${c.connectorId} health latency < 500ms`,
      healthBody.reachable === true && (healthBody.latency_ms ?? 9999) < 500,
      `${healthBody.latency_ms}ms`);
  }

  finish();
}

async function finish() {
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n=== smoke-invariants-runtime: ${passed}/${results.length} assertions passed ===\n`);
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('smoke crashed:', e);
  process.exit(2);
});
