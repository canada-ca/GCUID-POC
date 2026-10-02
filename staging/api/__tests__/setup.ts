/*!
 * GCUID — Government of Canada Unique Identifier System
 *
 * @license
 * Copyright (c) 2024-2026 NOETRONIQ Strategic Initiatives. All rights reserved.
 * Author: Philippe R. Beauchamp <prb@noetroniq.com>
 *
 * Licensed for use and modification by the Treasury Board of Canada Secretariat.
 * See LICENSE in the project root for full terms.
 */
/**
 * Test setup and helpers for staging API tests.
 *
 * Strategy
 * --------
 * server.ts uses ESM-specific features (`import.meta.url`) and a bootstrap
 * admin block that is harder to isolate in a unit test than the routes
 * themselves. We therefore build a minimal express app in setupTestEnv()
 * that mounts only the route modules, using the same path resolution the
 * real server uses.
 *
 *   1. Create a fresh temp directory per test file (tmpDir).
 *   2. chdir into it for the duration of the test (jest runs the test in
 *      a single process, so process.cwd() is global to the file).
 *   3. Seed all five expected DB files (registry + 4 sources) into
 *      tmpDir/data/ using the helper `seedAllDbs`.
 *   4. Mount the route modules under their real prefixes (/api/user,
 *      /api/hr, /api/ldap, /api/gcuid-request, /api/caes, /api/policies,
 *      /api/flags). supertest drives the resulting express app in-process.
 *
 *   afterAll() restores the original cwd and deletes tmpDir.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import express, { Express } from 'express';
import cors from 'cors';
import { seedAllDbs } from './db-helpers';

export { seedAllDbs, seedRegistryOnly, insertIdentity, insertAlias, insertSourceMapping,
  insertHrEmployee, insertLdapUser, insertEngEmployee, insertFinEmployee,
} from './db-helpers';

/** Create a fresh temp dir + chdir into it. Returns the data path. */
export function enterTempDataDir(prefix = 'gcuid-test-'): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(path.join(dataDir, 'sources'), { recursive: true });
  process.chdir(tmp);
  return dataDir;
}

/** Restore cwd (called from afterAll). */
export function leaveTempDataDir(origCwd: string): void {
  try { process.chdir(origCwd); } catch { /* cwd may already be valid */ }
}

/** Recursively delete a temp dir created by enterTempDataDir. */
export function rmTempDataDir(dataDir: string): void {
  const tmp = path.dirname(dataDir);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch { /* best-effort cleanup */ }
}

export interface TestContext {
  dataDir: string;
  app: Express;
  cleanup: () => void;
}

export interface SetupOptions {
  skipRegistrySeed?: boolean;
  skipConnectorSeed?: boolean;
  /**
   * Route prefixes to mount. Default: the full set of routes covered by
   * the test plan (user, hr, ldap, engineering, finance, gcuid, caes,
   * gcuid-request, policies, flags). Tests that only need a subset can
   * pass a smaller list to keep boot time down.
   */
  mountRoutes?: string[];
}

// Map of mount path → route file. Some route files use a different name
// from the URL prefix (e.g. /api/gcuid is mounted from admin.ts because
// the GCUID Portal is the "admin" view of the central identity registry).
const ROUTE_FILES: Record<string, string> = {
  'user':         'user',
  'hr':           'hr',
  'ldap':         'ldap',
  'engineering':  'engineering',
  'finance':      'finance',
  'gcuid':        'admin',
  'caes':         'caes',
  'gcuid-request':'gcuid-request',
  'policies':     'policies',
  'flags':        'flags',
  'log-levels':   'log-levels',
  'sources':   'sources',
  'system':       'system-dashboard',
  'bulk':         'bulk',
  'hooks':        'hooks',
  'tools':        'tools',
  'ux-config':    'ux-config',
  'logs':         'logs',
};

const ALL_ROUTES = Object.keys(ROUTE_FILES);

/**
 * Build a fully-seeded test environment. Returns:
 *   { dataDir, app, cleanup }
 * where `app` is an express application with the route modules mounted.
 */
export function setupTestEnv(opts: SetupOptions = {}): TestContext {
  const origCwd = process.cwd();
  const dataDir = enterTempDataDir();

  if (!opts.skipRegistrySeed || !opts.skipConnectorSeed) {
    seedAllDbs(dataDir, {
      skipRegistry:    opts.skipRegistrySeed    ?? false,
      skipConnectors:  opts.skipConnectorSeed  ?? false,
    });
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  const toMount = opts.mountRoutes ?? ALL_ROUTES;
  for (const name of toMount) {
    if (!ROUTE_FILES[name]) {
      throw new Error(`Unknown route "${name}". Add it to ROUTE_FILES in setup.ts.`);
    }
    const fileName = ROUTE_FILES[name];
    try {
      // The route files are TypeScript modules. We use jest's module
      // resolver (no explicit extension) so it picks up the .ts file.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(`../routes/${fileName}`);
      // Routes follow the pattern: `export const xxxRoutes = router;` or
      // `export { router as xxxRoutes }`. The export name may be camelCase
      // even when the file name uses dashes (e.g. gcuid-request.ts exports
      // `gcuidRequestRoutes`). We also accept default exports.
      const expected = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Routes';
      const router = mod[expected] ?? mod.default ?? mod[Object.keys(mod)[0]];
      if (!router) {
        throw new Error(`No router exported from routes/${fileName} (looked for ${expected}, default, or first export)`);
      }
      app.use(`/api/${name}`, router);
    } catch (e: any) {
      // Surface the error so a missing/broken route is obvious, not a silent
      // 404 inside the test.
      throw new Error(`Failed to mount /api/${name}: ${e.message}\n${e.stack}`);
    }
  }

  // Minimal error handler — converts thrown errors to JSON like the real
  // server's error middleware does. We don't import the real error.ts
  // because it has its own bootstrap logic; this is a faithful simplification.
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.status ?? err.statusCode ?? 500;
    res.status(status).json({
      success: false,
      error: err.message ?? 'Internal server error',
    });
  });

  return {
    dataDir,
    app,
    cleanup: () => {
      leaveTempDataDir(origCwd);
      rmTempDataDir(dataDir);
    },
  };
}
