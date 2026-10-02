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
 * Route tests for /api/hr/...
 *
 * Scenarios covered (from TEST_PLAN.md):
 *   SC-HR-1  Creating a new HR employee does NOT provision a GCUID
 *   SC-HR-2  Deleting an HR employee does NOT unbind the source_mapping
 */

import request from 'supertest';
import Database from 'better-sqlite3';
import { setupTestEnv, TestContext, insertIdentity, insertSourceMapping } from '../setup';

describe('HR Portal routes (/api/hr/...)', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = setupTestEnv({ mountRoutes: ['hr', 'gcuid'] });
  });
  afterAll(() => { ctx.cleanup(); });

  // ── SC-HR-1 ────────────────────────────────────────────────────────────

  describe('SC-HR-1: HREmployeeCreateDoesNotProvisionGcuid', () => {
    test('POST /api/hr/employees creates the employee in HR, NOT in registry', async () => {
      // Pre-condition: registry is empty.
      const db = new Database(`${ctx.dataDir}/registry.db`, { readonly: true });
      const beforeIdentities = (db.prepare('SELECT COUNT(*) as c FROM identities').get() as any).c;
      const beforeMappings   = (db.prepare('SELECT COUNT(*) as c FROM source_mappings').get() as any).c;
      db.close();

      const res = await request(ctx.app)
        .post('/api/hr/employees')
        .send({
          employee_id:     'E_HR_TEST_1',
          first_name:      'HRTest',
          last_name:       'One',
          email:           'hrtest1@department.gc.ca',
          department:      'Engineering',
          job_title:       'Engineer',
          employment_type: 'FTE',
          hire_date:       '2026-06-23',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.employee_id).toBe('E_HR_TEST_1');

      // HR record exists
      const hrDb = new Database(`${ctx.dataDir}/sources/conn-hr.db`, { readonly: true });
      const hrRow = hrDb.prepare('SELECT * FROM employees WHERE employee_id = ?').get('E_HR_TEST_1') as any;
      hrDb.close();
      expect(hrRow).toBeTruthy();
      expect(hrRow.first_name).toBe('HRTest');

      // GCUID invariants: NO identity, NO source_mapping, NO alias
      const reg = new Database(`${ctx.dataDir}/registry.db`, { readonly: true });
      const afterIdentities = (reg.prepare('SELECT COUNT(*) as c FROM identities').get() as any).c;
      const afterMappings   = (reg.prepare('SELECT COUNT(*) as c FROM source_mappings').get() as any).c;
      const aliases         = (reg.prepare('SELECT COUNT(*) as c FROM aliases').get() as any).c;
      reg.close();
      expect(afterIdentities).toBe(beforeIdentities);
      expect(afterMappings).toBe(beforeMappings);
      expect(aliases).toBe(0);
    });

    test('SC-HR-1 (negative): validation rejects missing required fields', async () => {
      const res = await request(ctx.app)
        .post('/api/hr/employees')
        .send({ employee_id: 'E_HR_TEST_BAD' });
      expect(res.status).toBe(400);
    });

    test('SC-HR-1 (negative): duplicate employee_id returns 409', async () => {
      const payload = {
        employee_id: 'E_HR_TEST_DUP', first_name: 'A', last_name: 'B',
        email: 'dup@x.com', department: 'D', job_title: 'J',
        employment_type: 'FTE', hire_date: '2026-01-01',
      };
      const first = await request(ctx.app).post('/api/hr/employees').send(payload);
      expect(first.status).toBe(201);
      const second = await request(ctx.app).post('/api/hr/employees').send(payload);
      expect(second.status).toBe(409);
    });
  });

  // ── SC-HR-2 ────────────────────────────────────────────────────────────

  describe('SC-HR-2: HREmployeeDeleteDoesNotUnbind', () => {
    test('DELETE /api/hr/employees/:id removes the HR record but keeps the source_mapping', async () => {
      // Setup: an identity bound to (hr, E_HR_BIND_DELETE) from a prior
      // gcuid-request flow.
      const registry = `${ctx.dataDir}/registry.db`;
      insertIdentity(registry, {
        gcuid:           'urn:gcuid:01HRBINDTESTDELETE0000',
        state:           'active',
        identifier_state:'issued',
        entity_id:       'E_HR_BIND_DELETE',
        metadata:        { email: 'bind-delete@x.com' },
      });
      insertSourceMapping(registry, {
        gcuid:         'urn:gcuid:01HRBINDTESTDELETE0000',
        source_system: 'hr',
        source_id:     'E_HR_BIND_DELETE',
        verified_at:   new Date().toISOString(),
      });
      // Create the actual HR record so DELETE has something to find.
      const hrDb = new Database(`${ctx.dataDir}/sources/conn-hr.db`);
      hrDb.prepare(`
        INSERT INTO employees
          (employee_id, first_name, last_name, email, department, job_title, employment_type, hire_date, status, created_at, updated_at)
        VALUES ('E_HR_BIND_DELETE', 'Bind', 'Delete', 'bind-delete@x.com', 'D', 'J', 'FTE', '2026-01-01', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
      `).run();
      hrDb.close();

      // Delete the HR record
      const del = await request(ctx.app).delete('/api/hr/employees/E_HR_BIND_DELETE');
      expect(del.status).toBe(200);

      // HR row gone
      const hrDb2 = new Database(`${ctx.dataDir}/sources/conn-hr.db`, { readonly: true });
      const gone = hrDb2.prepare('SELECT * FROM employees WHERE employee_id = ?').get('E_HR_BIND_DELETE');
      hrDb2.close();
      expect(gone).toBeUndefined();

      // Registry source_mapping STILL EXISTS — arms-length invariant
      const reg = new Database(registry, { readonly: true });
      const mapping = reg.prepare(
        "SELECT * FROM source_mappings WHERE source_system='hr' AND source_id='E_HR_BIND_DELETE'"
      ).get() as any;
      const identity = reg.prepare("SELECT * FROM identities WHERE gcuid='urn:gcuid:01HRBINDTESTDELETE0000'").get() as any;
      reg.close();
      expect(mapping).toBeTruthy();
      expect(identity).toBeTruthy();
      expect(identity.state).toBe('active');
    });

    test('SC-HR-2: delete of non-existent employee returns 404', async () => {
      const res = await request(ctx.app).delete('/api/hr/employees/E_NONEXISTENT');
      expect(res.status).toBe(404);
    });
  });

  // ── Read paths (smoke coverage) ────────────────────────────────────────

  describe('Read endpoints (smoke)', () => {
    test('GET /api/hr/employees lists all employees', async () => {
      const res = await request(ctx.app).get('/api/hr/employees');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data) || Array.isArray(res.body)).toBe(true);
    });

    test('GET /api/hr/employees/:id returns a single employee', async () => {
      const res = await request(ctx.app).get('/api/hr/employees/E_HR_TEST_1');
      expect(res.status).toBe(200);
      expect(res.body.data.employee_id).toBe('E_HR_TEST_1');
    });

    test('GET /api/hr/stats returns counters', async () => {
      const res = await request(ctx.app).get('/api/hr/stats');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('total');
    });

    test('GET /api/hr/search?q=... returns matching employees', async () => {
      const res = await request(ctx.app).get('/api/hr/search?q=HRTest');
      expect(res.status).toBe(200);
    });
  });
});
