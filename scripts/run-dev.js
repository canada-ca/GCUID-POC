#!/usr/bin/env node
//
// Cross-platform launcher for the root-level start-dev/stop-dev scripts.
// Used by `npm run start-all` / `npm run stop-all` so the npm entry point
// works the same way on Windows, Linux, and macOS without requiring the
// user to know which shell the underlying script is written in.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const action = process.argv[2];
const extraArgs = process.argv.slice(3);

if (action !== 'start' && action !== 'stop') {
    console.error('Usage: node start-all.js {start|stop} [--flags...]');
    process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

const scriptName = action === 'start'
    ? (isWindows ? 'start-dev.ps1' : 'start-dev.sh')
    : (isWindows ? 'stop-dev.bat'   : 'stop-dev.sh');

const scriptPath = path.join(repoRoot, scriptName);

if (!fs.existsSync(scriptPath)) {
    console.error(`ERROR: ${scriptName} not found at repo root (${repoRoot})`);
    process.exit(1);
}

let cmd;
let args;

if (isWindows && scriptName.endsWith('.ps1')) {
    cmd = 'pwsh';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...extraArgs];
} else if (isWindows && scriptName.endsWith('.bat')) {
    cmd = 'cmd.exe';
    args = ['/c', scriptPath, ...extraArgs];
} else {
    cmd = scriptPath;
    args = extraArgs;
}

const child = spawn(cmd, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    windowsHide: false,
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
    console.error(`Failed to launch ${scriptName}: ${err.message}`);
    process.exit(1);
});
