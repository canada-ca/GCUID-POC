/*!
 * Smoke test for sub-phase 4.1: startup scripts + port registry +
 * dashboard source health visibility.
 *
 * STRUCTURAL smoke — verifies the configuration surface, does NOT manage
 * live processes. On Windows the git-bash job-object semantics kill
 * child processes when the parent shell exits, so a smoke that spawns
 * start-dev.sh from inside a tsx script cannot reliably keep children
 * alive. The full end-to-end check is manual:
 *
 *   1. Run `./start-dev.sh` from your own terminal.
 *   2. Open http://localhost:5181/admin/system and confirm the
 *      "Source Servers" card shows all four sources as healthy.
 *
 * Structural checks here:
 *   1. /e/github/.dev-ports.json contains entries for all 4 source servers
 *   2. start-dev.{sh,ps1,bat} accept --skip-sources (or equivalent)
 *   3. start-dev.{sh,ps1,bat} reference start-sources-all.ts
 *   4. stop-dev.sh handles source ports 5188-5191
 *   5. DashboardPortal.tsx renders source health from data.sources
 *   6. system-dashboard.ts probes each source /health endpoint and
 *      returns a sources array
 *
 * Run with: ./node_modules/.bin/tsx.cmd scripts/smoke-cs-4.1-startup-cycle.ts
 *   (tsx is hoisted to root because staging/ is now a workspace)
 */

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
const DEV_PORTS_JSON = path.resolve(REPO_ROOT, '..', '..', '..', 'github', '.dev-ports.json');
// Repo is at E:\GitHub\GCUID-POC, port registry is at E:\github\.dev-ports.json
// That's 2 levels up from GCUID-POC into e:\ then into github\
const ALT_DEV_PORTS_JSON = 'E:\\github\\.dev-ports.json';

interface SmokeResult { passed: boolean; label: string; detail?: string }
const results: SmokeResult[] = [];
const record = (label: string, ok: boolean, detail?: string) => {
  results.push({ passed: ok, label, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
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

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log('\n=== smoke-cs-4.1: startup scripts + port registry ===\n');

  // This is a structural smoke — it does NOT spawn or kill processes. The
  // user's stack is canonical; we only verify configuration surface.

  // Step 1: dev-ports.json contains all 4 source entries
  console.log('[Step 1] /e/github/.dev-ports.json has 4 source server entries');
  const portsPath = fs.existsSync(ALT_DEV_PORTS_JSON) ? ALT_DEV_PORTS_JSON : DEV_PORTS_JSON;
  if (!fs.existsSync(portsPath)) {
    console.log(`  ✗ dev-ports.json not found at ${portsPath}`);
    record('dev-ports.json accessible', false, `not found at ${portsPath}`);
    return finish();
  }
  const portsData = JSON.parse(fs.readFileSync(portsPath, 'utf-8'));
  const expected = [
    { id: 'gcuid-poc-hr-source',      port: 5188 },
    { id: 'gcuid-poc-ldap-source',    port: 5189 },
    { id: 'gcuid-poc-eng-source',     port: 5190 },
    { id: 'gcuid-poc-finance-source', port: 5191 },
  ];
  for (const e of expected) {
    const entry = portsData.projects[e.id];
    record(`${e.id} entry in dev-ports.json with port ${e.port}`,
      entry?.port === e.port,
      `found port=${entry?.port}`);
  }

  // Step 2: start-dev.sh has --skip-sources flag
  console.log('\n[Step 2] start-dev.sh contains --skip-sources flag');
  const startDevSh = path.join(REPO_ROOT, 'start-dev.sh');
  if (fs.existsSync(startDevSh)) {
    const shContent = fs.readFileSync(startDevSh, 'utf-8');
    record('start-dev.sh lists --skip-sources in arg parsing',
      shContent.includes('--skip-sources'),
      shContent.includes('--skip-sources') ? '' : 'flag missing');
    record('start-dev.sh documents --skip-sources in help text',
      shContent.includes('Skip starting the four source servers'),
      shContent.includes('Skip starting the four source servers') ? '' : 'help text missing');
  } else {
    record('start-dev.sh exists', false, 'not found');
  }
  // Also check start-dev.ps1 and start-dev.bat
  const startDevPs1 = path.join(REPO_ROOT, 'start-dev.ps1');
  if (fs.existsSync(startDevPs1)) {
    const psContent = fs.readFileSync(startDevPs1, 'utf-8');
    record('start-dev.ps1 declares [switch]$SkipSources',
      psContent.includes('[switch]$SkipSources'),
      psContent.includes('[switch]$SkipSources') ? '' : 'param missing');
  }
  const startDevBat = path.join(REPO_ROOT, 'start-dev.bat');
  if (fs.existsSync(startDevBat)) {
    const batContent = fs.readFileSync(startDevBat, 'utf-8');
    const batOk = batContent.includes('/no-sources') && batContent.includes('SKIP_SOURCES');
    record('start-dev.bat handles /no-sources arg', batOk,
      batOk ? '' : 'flag missing');
  }

  // Steps 3-7 (process lifecycle) are deliberately NOT included here.
  //
  // On Windows the git-bash job-object semantics kill child processes
  // when the parent shell exits. A smoke that spawns start-dev.sh or
  // npm.cmd from inside a tsx script cannot reliably keep children
  // alive — process cleanup between iterations would tear them down.
  //
  // Instead, the lifecycle test is done manually: a developer runs
  // `./start-dev.sh`, opens a separate terminal, and confirms the
  // dashboard reports sources. The structural checks below cover
  // everything that can be verified in isolation.

  // Step 3: structural check — start-dev.sh would launch 4 sources
  console.log('\n[Step 3] start-dev.sh references start-sources-all.ts');
  if (fs.existsSync(startDevSh)) {
    const shContent = fs.readFileSync(startDevSh, 'utf-8');
    const hasLaunchSources = shContent.includes('start-sources-all.ts');
    record('start-dev.sh launches start-sources-all.ts', hasLaunchSources,
      hasLaunchSources ? '' : 'not referenced');
    const hasApiLaunch = shContent.includes('start-api') || shContent.includes('start_service');
    record('start-dev.sh launches API server', hasApiLaunch,
      hasApiLaunch ? '' : 'no start-api reference');
    const hasConnectorsLaunch = shContent.includes('start-connectors');
    record('start-dev.sh launches connectors', hasConnectorsLaunch,
      hasConnectorsLaunch ? '' : 'no start-connectors reference');
  }
  // Same for ps1 and bat
  if (fs.existsSync(startDevPs1)) {
    const psContent = fs.readFileSync(startDevPs1, 'utf-8');
    record('start-dev.ps1 launches start-sources-all.ts',
      psContent.includes('start-sources-all'));
  }
  if (fs.existsSync(startDevBat)) {
    const batContent = fs.readFileSync(startDevBat, 'utf-8');
    record('start-dev.bat launches start-sources-all.ts',
      batContent.includes('start-sources-all'));
  }

  // Step 4: stop-dev.sh covers source ports
  console.log('\n[Step 4] stop-dev.sh handles source ports 5188-5191');
  const stopDevSh = path.join(REPO_ROOT, 'stop-dev.sh');
  if (fs.existsSync(stopDevSh)) {
    const stopContent = fs.readFileSync(stopDevSh, 'utf-8');
    for (const p of [5188, 5189, 5190, 5191]) {
      const hasPort = stopContent.includes(`${p}`);
      record(`stop-dev.sh handles port ${p}`, hasPort,
        hasPort ? '' : `port ${p} missing`);
    }
  }

  // Step 5: SystemPortal renders source health
  console.log('\n[Step 5] DashboardPortal.tsx renders source health from data.sources');
  const dashboardTsx = path.join(REPO_ROOT, 'staging', 'web-ui', 'src', 'pages', 'DashboardPortal.tsx');
  if (fs.existsSync(dashboardTsx)) {
    const dashContent = fs.readFileSync(dashboardTsx, 'utf-8');
    const rendersSources = dashContent.includes('sourceServers') ||
                            dashContent.includes('Source Servers') ||
                            dashContent.includes('data.sources');
    record('DashboardPortal renders Source Servers card', rendersSources,
      rendersSources ? '' : 'no source health card found');
  } else {
    record('DashboardPortal.tsx exists', false, 'not found');
  }

  // Step 6: system-dashboard route probes /health
  console.log('\n[Step 6] system-dashboard.ts probes source /health endpoints');
  const dashboardRoute = path.join(REPO_ROOT, 'staging', 'api', 'routes', 'system-dashboard.ts');
  if (fs.existsSync(dashboardRoute)) {
    const routeContent = fs.readFileSync(dashboardRoute, 'utf-8');
    const probesHealth = routeContent.includes('/health') && routeContent.includes('SOURCE_SERVERS');
    record('system-dashboard.ts probes each source /health endpoint', probesHealth,
      probesHealth ? '' : 'no /health probe found');
    const returnsArray = routeContent.includes('sources: sourceHealth');
    record('system-dashboard.ts returns sources array in payload', returnsArray,
      returnsArray ? '' : 'no sources field');
  } else {
    record('system-dashboard.ts exists', false, 'not found');
  }

  finish();
}

async function finish() {
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n=== smoke-cs-4.1: ${passed}/${results.length} assertions passed ===\n`);
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
