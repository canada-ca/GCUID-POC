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
 * Smoke test: the harness can boot the express app in-process and a
 * supertest request returns a sane response.
 *
 * This test guards the foundation. If this fails, the more interesting
 * tests below will also fail in ways that obscure the real problem.
 */

import request from 'supertest';
import { setupTestEnv, TestContext } from './setup';

describe('Harness smoke test', () => {
  let ctx: TestContext;

  beforeAll(() => { ctx = setupTestEnv({ mountRoutes: ['flags'] }); });
  afterAll(() => { ctx.cleanup(); });

  test('express app boots and /api/flags returns 200', async () => {
    const res = await request(ctx.app).get('/api/flags');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  test('registry DB exists and is empty', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(`${ctx.dataDir}/registry.db`, { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining([
      'aliases', 'caes_attribute_mappings', 'caes_match_strategies',
      'identities', 'pending_linkages', 'source_mappings', 'state_history',
    ]));
    const identityCount = (db.prepare('SELECT COUNT(*) as c FROM identities').get() as any).c;
    expect(identityCount).toBe(0);
    db.close();
  });

  test('all 4 connector DBs exist and are empty', async () => {
    const Database = require('better-sqlite3');
    for (const name of ['conn-hr', 'conn-ldap', 'conn-engineering', 'conn-finance']) {
      const db = new Database(`${ctx.dataDir}/sources/${name}.db`, { readonly: true });
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as { name: string }[];
      expect(tables.length).toBeGreaterThanOrEqual(1);
      db.close();
    }
  });
});
