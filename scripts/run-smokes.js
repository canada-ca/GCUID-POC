#!/usr/bin/env node
/*!
 * Cross-platform smoke-test orchestrator.
 *
 * Runs every scripts/smoke-*.ts in the repo root in sequence, aggregates
 * results, and returns a non-zero exit if any smoke failed. Symmetrical
 * with run-dev.js for the start/stop scripts.
 *
 * Each smoke is responsible for its own setup/teardown. This wrapper does
 * NOT spawn or kill processes — the user's stack is canonical. Smokes that
 * need the stack will fail fast with a clear "start the stack" message.
 *
 * Usage:
 *   node scripts/run-smokes.js           # run all
 *   node scripts/run-smokes.js --list    # list smokes without running
 *   node scripts/run-smokes.js cs-1.1 invariants   # run specific ones
 *
 * Exit codes:
 *   0  — all smokes passed
 *   1  — one or more smokes failed
 *   2  — orchestrator crashed
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const repoRoot = path.resolve(__dirname, '..');
const scriptsDir = path.join(repoRoot, 'scripts');
// tsx is installed at root node_modules when staging/ is a workspace
// (npm hoists deps to the root). Check both locations.
function findTsx() {
    const candidates = process.platform === 'win32'
        ? [
            path.join(repoRoot, 'staging', 'node_modules', '.bin', 'tsx.cmd'),
            path.join(repoRoot, 'node_modules', '.bin', 'tsx.cmd'),
          ]
        : [
            path.join(repoRoot, 'staging', 'node_modules', '.bin', 'tsx'),
            path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
          ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return candidates[0];
}
const tsxBin = findTsx();

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const includeAll = args.includes('--all');   // include smokes that need port isolation
const positional = args.filter((a) => !a.startsWith('--'));

// Smokes that mutate state or need exclusive port access — excluded by default
// because they conflict with a user's running stack. Run them standalone.
const STACK_CONFLICTING = [
    'smoke-cs-1.1-hr-source.ts',         // spawns HR connector on 5183
    'smoke-cs-2.1-all-sources.ts',       // spawns 4 connectors + 4 sources on 5183-5191
    'smoke-cs-3.1-self-bootstrap.ts',    // mutates source DBs and spawns source servers
];

if (!fs.existsSync(tsxBin)) {
    console.error(`ERROR: tsx not found at ${tsxBin}`);
    console.error('Run: cd staging && npm install');
    process.exit(2);
}

// Discover smokes
const allSmokes = fs.readdirSync(scriptsDir)
    .filter((f) => /^smoke-.*\.ts$/.test(f))
    .sort();

let selectedSmokes;
if (positional.length === 0) {
    if (includeAll) {
        selectedSmokes = allSmokes;
    } else {
        selectedSmokes = allSmokes.filter((s) => !STACK_CONFLICTING.includes(s));
        const skipped = allSmokes.filter((s) => STACK_CONFLICTING.includes(s));
        if (skipped.length > 0) {
            console.log(`Excluding stack-conflicting smokes (use --all to include):`);
            for (const s of skipped) console.log(`  - ${s}`);
            console.log('');
        }
    }
} else {
    // Match by name fragment: "cs-1.1" matches "smoke-cs-1.1-hr-source.ts"
    selectedSmokes = allSmokes.filter((f) =>
        positional.some((frag) => f.includes(frag)));
    if (selectedSmokes.length === 0) {
        console.error(`ERROR: no smokes matched: ${positional.join(', ')}`);
        console.error('Available:');
        for (const s of allSmokes) console.error(`  ${s}`);
        process.exit(2);
    }
}

if (listOnly) {
    console.log('Available smokes:');
    for (const s of allSmokes) console.log(`  ${s}`);
    console.log('\nStack-conflicting smokes (need exclusive ports, --all to include):');
    for (const s of STACK_CONFLICTING) console.log(`  ${s}`);
    process.exit(0);
}

console.log(`\n=== run-smokes: ${selectedSmokes.length} smoke(s) ===\n`);
console.log('Stack canonical state required — start with ./start-dev.sh before running.');
console.log('Smokes that need the stack will fail fast with a clear message.\n');

const t0 = Date.now();
const results = [];

for (const smoke of selectedSmokes) {
    const smokePath = path.join(scriptsDir, smoke);
    const sm0 = Date.now();
    console.log(`── ${smoke} ──`);

    const r = spawnSync(tsxBin, [smokePath], {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',  // tsx.cmd is a .cmd batch shim
    });

    const elapsed = ((Date.now() - sm0) / 1000).toFixed(1);
    // Status can be null on Windows when stdio:'inherit' — fall back to signal
    const ok = r.status === 0 || (r.status === null && r.signal === null);
    results.push({ smoke, ok, status: r.status, signal: r.signal, elapsed: `${elapsed}s` });

    if (r.status === null && r.signal !== null) {
        console.log(`\n  ⚠ ${smoke} killed by signal ${r.signal} after ${elapsed}s`);
    } else if (r.status !== 0) {
        console.log(`\n  ✗ ${smoke} exited with code ${r.status} after ${elapsed}s`);
    } else {
        console.log(`\n  ✓ ${smoke} passed in ${elapsed}s`);
    }
    console.log('');
}

const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

console.log(`=== run-smokes summary ===`);
for (const r of results) {
    const tag = r.ok ? '✓' : '✗';
    console.log(`  ${tag} ${r.smoke.padEnd(40)} ${r.elapsed}`);
}
console.log(`\n${passed}/${results.length} smokes passed in ${totalElapsed}s`);

if (failed > 0) {
    console.log(`\n${failed} smoke(s) FAILED — see output above.`);
    process.exit(1);
}
process.exit(0);
