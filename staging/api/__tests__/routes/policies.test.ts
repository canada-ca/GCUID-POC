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
 * Route tests for /api/policies/validate and /api/policies/validate-gcuid.
 *
 * Scenarios covered:
 *   SC-POL-1  alias "nadia" resolves to GCUID whose source_mapping is keyed
 *             by username (the canonical key) → granted for Project Hub.
 *   SC-POL-2  alias "nadia" resolves to GCUID whose source_mapping is keyed
 *             by distinguished_name (legacy, pre-canonicalization) → granted
 *             for Project Hub.  This is the safety-net path: the policy
 *             validator falls back from username to distinguished_name when
 *             the direct lookup fails, so users linked via the pre-fix
 *             LDAP portal can still sign in.
 *   SC-POL-3  alias "ghost" matches no identity → not found, not granted.
 */

import request from 'supertest';
import { setupTestEnv, TestContext,
         insertIdentity, insertAlias, insertSourceMapping, insertLdapUser } from '../setup';

describe('Policy validation routes (/api/policies/...)', () => {
  let ctx: TestContext;

  const GCUID  = 'urn:gcuid:01KWCCHR4CMT68D66RKAW0AN9A';
  const ALIAS  = 'nadia';
  const UNAME  = 'nyoung0573';
  const DN     = 'CN=nyoung0573,OU=Users,DC=agency,DC=gov';

  beforeAll(() => {
    ctx = setupTestEnv({ mountRoutes: ['policies'] });

    // The LDAP row that both the canonical and the safety-net path resolve to.
    insertLdapUser(`${ctx.dataDir}/sources`, {
      username:           UNAME,
      distinguished_name: DN,
      email:              'nadia.young@department.gc.ca',
      first_name:         'Nadia',
      last_name:          'Young',
      department:         'Human Resources',
      account_enabled:    1,
    });
  });
  afterAll(() => { ctx.cleanup(); });

  // ── SC-POL-1: canonical (username) key ───────────────────────────────────

  describe('SC-POL-1: validate-gcuid with username-keyed LDAP mapping', () => {
    beforeAll(() => {
      insertIdentity(`${ctx.dataDir}/registry.db`, {
        gcuid: GCUID,
        state: 'active',
        identifier_state: 'issued',
        entity_id: 'E11033',
      });
      insertAlias(`${ctx.dataDir}/registry.db`, {
        gcuid: GCUID, alias_type: 'custom', alias_value: ALIAS, status: 'enabled',
      });
      insertSourceMapping(`${ctx.dataDir}/registry.db`, {
        gcuid: GCUID, source_system: 'ldap', source_id: UNAME, is_primary: false,
      });
    });

    test('POST /api/policies/validate-gcuid grants access to Project Hub for alias "nadia"', async () => {
      const res = await request(ctx.app)
        .post('/api/policies/validate-gcuid')
        .send({ appId: 'projects', gcuid_or_alias: ALIAS });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.granted).toBe(true);
      expect(res.body.data.gcuid).toBe(GCUID);
      expect(String(res.body.data.reason ?? '')).not.toMatch(/No account found/i);
    });
  });

  // ── SC-POL-2: legacy (DN) key — safety-net path ──────────────────────────

  describe('SC-POL-2: validate-gcuid with DN-keyed LDAP mapping (legacy/safety net)', () => {
    const LEGACY_GCUID = 'urn:gcuid:01KWCCHR4CMT68D66RKAW0AN9B';
    const LEGACY_ALIAS = 'nadia.legacy';

    beforeAll(() => {
      // A second identity whose mapping was written by the pre-fix LDAP portal
      // (source_id = DN, not username).  The validator should still grant.
      insertIdentity(`${ctx.dataDir}/registry.db`, {
        gcuid: LEGACY_GCUID,
        state: 'active',
        identifier_state: 'issued',
        entity_id: 'E11034',
      });
      insertAlias(`${ctx.dataDir}/registry.db`, {
        gcuid: LEGACY_GCUID, alias_type: 'custom', alias_value: LEGACY_ALIAS, status: 'enabled',
      });
      insertSourceMapping(`${ctx.dataDir}/registry.db`, {
        gcuid: LEGACY_GCUID, source_system: 'ldap', source_id: DN, is_primary: false,
      });
    });

    test('POST /api/policies/validate-gcuid grants access even when mapping is keyed by DN', async () => {
      const res = await request(ctx.app)
        .post('/api/policies/validate-gcuid')
        .send({ appId: 'projects', gcuid_or_alias: LEGACY_ALIAS });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.granted).toBe(true);
      expect(res.body.data.gcuid).toBe(LEGACY_GCUID);
      expect(String(res.body.data.reason ?? '')).not.toMatch(/No account found/i);
    });
  });

  // ── SC-POL-3: alias not found ────────────────────────────────────────────

  describe('SC-POL-3: validate-gcuid for an unknown alias', () => {
    test('returns granted:false with found_gcuid:false', async () => {
      const res = await request(ctx.app)
        .post('/api/policies/validate-gcuid')
        .send({ appId: 'projects', gcuid_or_alias: 'ghost-alias' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.granted).toBe(false);
      expect(res.body.data.found_gcuid).toBe(false);
      expect(String(res.body.data.reason ?? '')).toMatch(/No identity found matching/i);
    });
  });
});
