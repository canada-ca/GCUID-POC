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
 * HR System Portal API Routes
 * 
 * Routes for monitoring the HR System authoritative source connector
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createError } from '../middleware/error.js';
import { logHR, logRegistry } from '../lib/logging/logger.js';
import { HR_EVENTS, REGISTRY_EVENTS } from '../lib/logging/log-events.js';
import { IS_EFS_MODE, CONNECTORS_DIR as EFS_CONNECTORS_DIR, REGISTRY_DB_PATH } from '../lib/db-paths.js';

const CROCKFORD_ALPHA_REG = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generate a ULID-style core using the same alphabet/format as the rest of the codebase. */
function generateRegistrationCore(): string {
  const ms = Date.now();
  let t = ms;
  let tsChars = '';
  for (let i = 9; i >= 0; i--) {
    tsChars = CROCKFORD_ALPHA_REG[t % 32] + tsChars;
    t = Math.floor(t / 32);
  }
  const rnd = crypto.randomBytes(10);
  let bits = 0n;
  for (const b of rnd) bits = (bits << 8n) | BigInt(b);
  let rndChars = '';
  for (let i = 15; i >= 0; i--) {
    rndChars = CROCKFORD_ALPHA_REG[Number(bits % 32n)] + rndChars;
    bits >>= 5n;
  }
  return tsChars + rndChars;
}

const router = Router();
// In Lambda, lambda-handler.js calls process.chdir('/tmp') so relative paths break.
// Use LAMBDA_TASK_ROOT (always /var/task) for config files and db-paths.ts for DB files.
const CONFIG_ROOT      = process.env['LAMBDA_TASK_ROOT'] ?? process.cwd();
const HR_DB            = IS_EFS_MODE ? path.join(EFS_CONNECTORS_DIR, 'conn-hr.db') : './data/sources/conn-hr.db';
const REGISTRY_DB      = IS_EFS_MODE ? REGISTRY_DB_PATH : './data/registry.db';
const HR_CONNECTOR_URL = 'http://localhost:5183';
const HR_CONNECTOR_JSON = path.join(CONFIG_ROOT, 'config', 'connectors', 'conn-hr.json');

/** Read the registered connector API URL from source_systems, with a safe fallback. */
function getHrConnectorUrl(): string {
  try {
    const db = new Database(REGISTRY_DB, { readonly: true });
    const row = db.prepare(`SELECT api_url FROM source_systems WHERE system_id = 'hr'`).get() as any;
    db.close();
    return (row?.api_url as string | null) ?? 'http://localhost:5183';
  } catch {
    return 'http://localhost:5183';
  }
}

function isHrConnectorEnabled(): boolean {
  try {
    const cfg = JSON.parse(fs.readFileSync(HR_CONNECTOR_JSON, 'utf-8')) as { enabled?: boolean };
    return cfg.enabled !== false;
  } catch {
    return true;
  }
}

/** In EFS mode the sidecar process doesn't run — probe the SQLite DB file directly. */
function probeHrConnectorDb(): { status: string; message: string; record_count?: number } {
  try {
    const db = new Database(HR_DB, { readonly: true });
    const row = db.prepare('SELECT COUNT(*) as cnt FROM employees').get() as { cnt: number };
    db.close();
    return { status: 'operational', message: 'Direct EFS DB access OK', record_count: row.cnt };
  } catch (err) {
    return { status: 'degraded', message: err instanceof Error ? err.message : 'DB probe failed' };
  }
}

// ============================================================================
// HR System Data Endpoints
// ============================================================================

/**
 * GET /api/hr/employees
 *
 * List all employees from the HR System authoritative source.
 *
 * Joins each employee row with the GCUID Registry to attach the
 * identity's GCUID and state (when one exists).
 *
 * @returns 200 — `{ success: true, data: EmployeeRow[], count: number }`
 *          where `EmployeeRow` is every column of `data/sources/conn-hr.db#employees`
 *          plus `gcuid: string | null` and `gcuid_state: string | null`.
 * @throws  500 — database read failure (forwarded to `errorHandler`).
 */
router.get('/employees', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hrDb = new Database(HR_DB, { readonly: true });
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    
    const employees = hrDb.prepare('SELECT * FROM employees ORDER BY employee_id').all();
    
    // Add GCUID mapping info
    employees.forEach((emp: any) => {
      const identity = registryDb.prepare(`
        SELECT gcuid, state FROM identities
        WHERE entity_id = ?
           OR gcuid IN (SELECT gcuid FROM source_mappings WHERE source_system = 'hr' AND source_id = ?)
        LIMIT 1
      `).get(emp.employee_id, emp.employee_id) as any;
      
      emp.gcuid = identity?.gcuid || null;
      emp.gcuid_state = identity?.state || null;
    });
    
    hrDb.close();
    registryDb.close();
    
    res.json({
      success: true,
      data: employees,
      count: employees.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/hr/employees/:id
 *
 * View one employee record from the HR System, joined with their
 * GCUID identity and full alias / source-mapping history when present.
 *
 * @route   GET /api/hr/employees/:id
 * @param   id — HR employee_id (path param).
 * @returns 200 — `{ success: true, data: EmployeeRow & { gcuid_details: IdentityRow & { aliases: AliasRow[], source_mappings: SourceMappingRow[] } | null } }`
 * @throws  404 — `createError('Employee not found in HR System', 404)` when no row matches `:id`.
 * @throws  500 — database read failure.
 */
router.get('/employees/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    const hrDb = new Database(HR_DB, { readonly: true });
    const employee = hrDb.prepare('SELECT * FROM employees WHERE employee_id = ?').get(id);
    hrDb.close();
    
    if (!employee) {
      logHR('info', HR_EVENTS.EMPLOYEE_NOT_FOUND, {
        component:   'api:hr',
        employee_id: id,
        actor_id:    (req.ip ?? 'system'),
        request_id:  (req as any).requestId,
      });
      throw createError('Employee not found in HR System', 404);
    }
    
    // Get GCUID mapping details
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    const identity = registryDb.prepare(`
      SELECT * FROM identities
      WHERE entity_id = ?
         OR gcuid IN (SELECT gcuid FROM source_mappings WHERE source_system = 'hr' AND source_id = ?)
      LIMIT 1
    `).get(id, id) as any;
    
    const aliases = identity ? registryDb.prepare(
      'SELECT * FROM aliases WHERE gcuid = ?'
    ).all(identity.gcuid) : [];
    
    const sourceMappings = identity ? registryDb.prepare(
      'SELECT * FROM source_mappings WHERE gcuid = ?'
    ).all(identity.gcuid) : [];
    
    registryDb.close();
    
    logHR('debug', HR_EVENTS.EMPLOYEE_VIEWED, {
      component:   'api:hr',
      employee_id: id,
      actor_id:    (req.ip ?? 'system'),
      request_id:  (req as any).requestId,
    });

    res.json({
      success: true,
      data: {
        ...employee,
        gcuid_details: identity ? {
          ...identity,
          aliases,
          source_mappings: sourceMappings
        } : null
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/hr/stats
 *
 * Aggregate statistics over the HR System dataset:
 * - Total employees
 * - How many have a GCUID via `source_mappings`
 * - Coverage percentage
 * - Breakdown by department
 * - Breakdown by status (active / on-leave / terminated / etc.)
 *
 * @returns 200 — `{ success: true, data: { total_employees: number, with_gcuid: number, without_gcuid: number, gcuid_percentage: string, by_department: { department: string, count: number }[], by_status: { status: string, count: number }[] } }`
 * @throws  500 — database read failure.
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hrDb = new Database(HR_DB, { readonly: true });
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    
    // Total employees in HR
    const totalEmployees = hrDb.prepare('SELECT COUNT(*) as count FROM employees').get() as any;
    
    // Employees with GCUIDs (via source_mappings)
    const withGcuid = registryDb.prepare(`
      SELECT COUNT(DISTINCT source_id) as count FROM source_mappings 
      WHERE source_system = 'hr'
    `).get() as any;
    
    // By department
    const byDepartment = hrDb.prepare(`
      SELECT department, COUNT(*) as count
      FROM employees
      GROUP BY department
      ORDER BY count DESC
    `).all();
    
    // By status
    const byStatus = hrDb.prepare(`
      SELECT status, COUNT(*) as count
      FROM employees
      GROUP BY status
    `).all();
    
    hrDb.close();
    registryDb.close();
    
    const gcuidPercentage = totalEmployees.count > 0
      ? ((withGcuid.count / totalEmployees.count) * 100).toFixed(1)
      : '0.0';
    
    res.json({
      success: true,
      data: {
        total_employees: totalEmployees.count,
        with_gcuid: withGcuid.count,
        without_gcuid: totalEmployees.count - withGcuid.count,
        gcuid_percentage: `${gcuidPercentage}%`,
        by_department: byDepartment,
        by_status: byStatus
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/hr/search?q=query
 *
 * Search HR employees by `LIKE %query%` against first_name, last_name,
 * email, or employee_id. Returns up to 20 matches ordered by surname,
 * each enriched with `gcuid` and `gcuid_state` from the registry.
 *
 * @route   GET /api/hr/search
 * @param   q — query string (query param, required). Case-insensitive
 *             substring; no fuzzy matching.
 * @returns 200 — `{ success: true, data: EmployeeRow[], count: number }`
 *          (max 20 rows; same shape as `/employees`).
 * @throws  400 — `createError('Query parameter "q" is required', 400)` when `q` is missing.
 * @throws  500 — database read failure.
 */
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.query.q as string;
    
    if (!query) {
      throw createError('Query parameter "q" is required', 400);
    }
    
    const hrDb = new Database(HR_DB, { readonly: true });
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    
    const employees = hrDb.prepare(`
      SELECT * FROM employees
      WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR employee_id LIKE ?
      ORDER BY last_name, first_name
      LIMIT 20
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
    
    // Add GCUID info
    employees.forEach((emp: any) => {
      const identity = registryDb.prepare(
        'SELECT gcuid, state FROM identities WHERE entity_id = ?'
      ).get(emp.employee_id) as any;
      
      emp.gcuid = identity?.gcuid || null;
      emp.gcuid_state = identity?.state || null;
    });
    
    hrDb.close();
    registryDb.close();
    
    res.json({
      success: true,
      data: employees,
      count: employees.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/hr/coverage-gaps
 *
 * Returns the two coverage-gap views for the HR System:
 *
 * 1. **Without GCUID** — HR employees that have no entry in
 *    `source_mappings` (never issued a GCUID).
 * 2. **Degraded** — GCUIDs backed by HR whose registry identity is
 *    in a non-active state (superseded / reserved / withdrawn / etc.).
 *
 * Used by the HR coverage dashboard to drive the "request GCUID"
 * action.
 *
 * @returns 200 — `{ success: true, data: { without_gcuid: EmployeeSummary[], degraded: { employee_id: string, gcuid: string, state: string }[] } }`
 * @throws  500 — database read failure.
 */
router.get('/coverage-gaps', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const hrDb       = new Database(HR_DB,       { readonly: true });
    const registryDb = new Database(REGISTRY_DB, { readonly: true });

    // Employees in HR with no source_mapping entry (never issued a GCUID)
    const mappedIds = new Set(
      (registryDb.prepare(
        `SELECT source_id FROM source_mappings WHERE source_system = 'hr'`
      ).all() as Array<{ source_id: string }>).map(r => r.source_id)
    );
    const allEmployees = hrDb.prepare(
      `SELECT employee_id, first_name, last_name, email, department, status FROM employees ORDER BY employee_id`
    ).all() as Array<{ employee_id: string; first_name: string; last_name: string; email: string; department: string; status: string }>;

    const withoutGcuid = allEmployees.filter(e => !mappedIds.has(e.employee_id));

    // Mapped employees whose registry identity is in a non-active state
    const degraded = registryDb.prepare(
      `SELECT sm.source_id AS employee_id, i.gcuid, i.state
       FROM source_mappings sm
       JOIN identities i ON i.gcuid = sm.gcuid
       WHERE sm.source_system = 'hr'
         AND i.state NOT IN ('active', 'provisional')`
    ).all() as Array<{ employee_id: string; gcuid: string; state: string }>;

    hrDb.close();
    registryDb.close();

    res.json({
      success: true,
      data: {
        source: 'HR System',
        gaps: {
          without_gcuid:     { count: withoutGcuid.length,    employees: withoutGcuid },
          degraded_coverage: { count: degraded.length,        records:   degraded     },
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/hr/connector/health
 *
 * Composite health snapshot of the HR connector, combining three
 * sources:
 *
 * 1. **Registry registration** — row from `source_systems` (api_url,
 *    access_mode, last_sync_at, cache_ttl, etc.)
 * 2. **Direct DB probe** — opens `conn-hr.db` read-only and counts
 *    active rows. In EFS mode this is the only probe (no sidecar).
 * 3. **Live endpoint probe** — `GET {api_url}/health` with 3-second
 *    timeout. Non-EFS mode only.
 *
 * Computes `overallStatus` from the three probes (`disabled`,
 * `degraded`, `operational`).
 *
 * @returns 200 — `{ success: true, data: { system_id, connector_id, display_name, access_mode, is_active, connector_url, last_sync_at, cache_ttl_seconds, cache_stale_policy, pull_schedule, allow_inbound, status, db_status, db_message, local_record_count, registry_gcuid_count, endpoint_status, endpoint_latency_ms } }`
 *          OR `{ success: false, data: { ... minimal envelope, error } }` when an unexpected error escapes.
 */
router.get('/connector/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // ── Registry registration data ───────────────────────────────────────────
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    let sysRow: any = null;
    let gcuidCount = 0;
    try {
      sysRow = registryDb.prepare(
        `SELECT system_id, connector_id, display_name, access_mode, last_sync_at, cache_ttl_seconds,
                cache_stale_policy, pull_schedule, allow_inbound, is_active, api_url
         FROM source_systems WHERE system_id = 'hr'`
      ).get();
      gcuidCount = (registryDb.prepare(
        `SELECT COUNT(DISTINCT gcuid) AS n FROM source_mappings WHERE source_system = 'hr'`
      ).get() as any)?.n ?? 0;
    } finally {
      registryDb.close();
    }

    const enabled = isHrConnectorEnabled();

    // ── DB probe ────────────────────────────────────────────────────────────
    let dbStatus = 'unavailable';
    let dbMessage = 'DB probe not attempted';
    let localRecordCount = 0;
    try {
      const hrDb = new Database(HR_DB, { readonly: true });
      localRecordCount = (hrDb.prepare(`SELECT COUNT(*) AS n FROM employees WHERE status = 'active'`).get() as any).n;
      hrDb.close();
      dbStatus = 'operational';
      dbMessage = 'Direct DB access OK';
    } catch (err) {
      dbStatus = 'degraded';
      dbMessage = err instanceof Error ? err.message : 'DB probe failed';
    }

    // ── Live endpoint probe (non-EFS only) ──────────────────────────────────
    let endpointStatus: string | null = null;
    let endpointLatencyMs: number | null = null;
    if (!IS_EFS_MODE && enabled) {
      const connectorUrl = (sysRow?.api_url as string | null) ?? getHrConnectorUrl();
      const t0 = Date.now();
      try {
        const r = await fetch(`${connectorUrl}/health`, { signal: AbortSignal.timeout(3000) });
        endpointLatencyMs = Date.now() - t0;
        endpointStatus = r.ok ? 'reachable' : 'error';
      } catch {
        endpointStatus = 'unreachable';
      }
    }

    const overallStatus = !enabled
      ? 'disabled'
      : !sysRow || !sysRow.is_active ? 'disabled'
      : dbStatus === 'degraded'       ? 'degraded'
      : 'operational';

    logHR(overallStatus === 'operational' ? 'debug' : 'warning',
      overallStatus === 'operational' ? HR_EVENTS.CONNECTOR_HEALTH_OK : HR_EVENTS.CONNECTOR_HEALTH_DEGRADED, {
      component:        'api:hr',
      connector_status: overallStatus,
      request_id:       (req as any).requestId,
    });

    res.json({
      success: true,
      data: {
        system_id:            sysRow?.system_id            ?? 'hr',
        connector_id:         sysRow?.connector_id         ?? 'conn-hr',
        display_name:         sysRow?.display_name         ?? 'HR System',
        access_mode:          sysRow?.access_mode          ?? 'dynamic-pull',
        is_active:            enabled && !!sysRow?.is_active,
        connector_url:        IS_EFS_MODE ? HR_DB : ((sysRow?.api_url as string | null) ?? getHrConnectorUrl()),
        connector_port:       IS_EFS_MODE ? null  : null,
        last_sync_at:         sysRow?.last_sync_at         ?? null,
        cache_ttl_seconds:    sysRow?.cache_ttl_seconds    ?? null,
        cache_stale_policy:   sysRow?.cache_stale_policy   ?? null,
        pull_schedule:        sysRow?.pull_schedule         ?? null,
        allow_inbound:        !!sysRow?.allow_inbound,
        status:               overallStatus,
        db_status:            dbStatus,
        db_message:           dbMessage,
        local_record_count:   localRecordCount,
        registry_gcuid_count: gcuidCount,
        endpoint_status:      endpointStatus,
        endpoint_latency_ms:  endpointLatencyMs,
      },
    });
  } catch (error) {
    res.json({
      success: false,
      data: {
        system_id:    'hr',
        connector_id: 'conn-hr',
        display_name: 'HR System',
        access_mode:  'dynamic-pull',
        status:       'unavailable',
        error:        error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

/**
 * GET /api/hr/connector/info
 *
 * Live connector introspection — `GET {connectorUrl}/info` proxied
 * through to the running HR sidecar (or EFS-mounted connector
 * service). Returns whatever the connector decides to expose
 * (typically: name, version, supported operations, schema).
 *
 * @returns 200 — `{ success: true, data: <whatever /info returned> }`
 * @throws  502 / 500 — `next(error)` if the upstream fetch fails or returns non-JSON.
 */
router.get('/connector/info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await fetch(`${getHrConnectorUrl()}/info`);
    const data = await response.json();
    
    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/hr/employees
 *
 * Create a new HR employee record.
 *
 * Important: HR has no direct write path into the GCUID Registry.
 * Creating an employee here does NOT issue a GCUID or create any
 * source_mapping. To link an HR employee to a GCUID, the user or
 * an admin must explicitly call `/api/gcuid-request/preview` then
 * `/api/gcuid-request/submit` (or `/api/user/self-register`).
 *
 * @route   POST /api/hr/employees
 * @body    `{ employee_id, first_name, last_name, email, department, job_title, employment_type, hire_date, salary?, manager_id?, status? }`
 *          `status` defaults to `'active'`. `salary` and `manager_id` are optional.
 * @returns 201 — `{ success: true, data: EmployeeRow }`
 * @throws  400 — `createError('...required', 400)` when any required field is missing.
 * @throws  409 — `createError('Employee ID ... already exists', 409)` when `:employee_id` is taken.
 */
router.post('/employees', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      employee_id, first_name, last_name, email, department,
      job_title, employment_type, hire_date, salary, manager_id,
      status = 'active',
    } = req.body;

    if (!employee_id || !first_name || !last_name || !email || !department || !job_title || !employment_type || !hire_date) {
      throw createError('employee_id, first_name, last_name, email, department, job_title, employment_type, and hire_date are required', 400);
    }

    const hrDb = new Database(HR_DB);
    const existing = hrDb.prepare('SELECT employee_id FROM employees WHERE employee_id = ?').get(employee_id);
    if (existing) {
      hrDb.close();
      throw createError(`Employee ID ${employee_id} already exists`, 409);
    }

    const now = new Date().toISOString();
    hrDb.prepare(`
      INSERT INTO employees
        (employee_id, first_name, last_name, email, department, job_title, employment_type, hire_date, salary, manager_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(employee_id, first_name, last_name, email, department, job_title, employment_type, hire_date, salary ?? null, manager_id ?? null, status, now, now);

    const employee = hrDb.prepare('SELECT * FROM employees WHERE employee_id = ?').get(employee_id) as Record<string, any>;
    hrDb.close();

    // Per architecture requirements (R3, R6): HR employee creation must not
        // auto-create a GCUID or mappings in the registry. The GCUID/CAES system
        // is arms-length from authoritative sources. An admin must explicitly
        // request a GCUID via /api/gcuid-request/preview + /submit, or the user
        // must self-register. The connector layer is the bridge used by those
        // explicit flows — HR has no direct registry write.

        logHR('notice', HR_EVENTS.EMPLOYEE_CREATED, {
          component:   'api:hr',
          employee_id,
          actor_id:    (req.ip ?? 'system'),
          department,
          request_id:  (req as any).requestId,
        });

        res.status(201).json({
          success: true,
          data: employee,
        });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/hr/employees/:id
 *
 * Partial update of an HR employee record. Only the fields listed
 * below are accepted; any other key in `req.body` is silently
 * ignored. `updated_at` is set server-side.
 *
 * @route   PUT /api/hr/employees/:id
 * @param   id — HR employee_id (path param).
 * @body    Any subset of `{ first_name, last_name, email, department, job_title, employment_type, hire_date, salary, manager_id, status }`.
 * @returns 200 — `{ success: true, data: EmployeeRow }`
 * @throws  400 — `createError('No updatable fields provided', 400)` when none of the accepted keys are present.
 * @throws  404 — `createError('Employee not found', 404)` when `:id` does not exist.
 */
router.put('/employees/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const fields = ['first_name', 'last_name', 'email', 'department', 'job_title', 'employment_type', 'hire_date', 'salary', 'manager_id', 'status'];
    const updates: Record<string, any> = {};
    for (const f of fields) {
      if (f in req.body) updates[f] = req.body[f];
    }

    if (Object.keys(updates).length === 0) {
      throw createError('No updatable fields provided', 400);
    }

    const hrDb = new Database(HR_DB);
    const existing = hrDb.prepare('SELECT employee_id FROM employees WHERE employee_id = ?').get(id);
    if (!existing) {
      hrDb.close();
      throw createError('Employee not found', 404);
    }

    updates.updated_at = new Date().toISOString();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    hrDb.prepare(`UPDATE employees SET ${setClauses} WHERE employee_id = ?`).run(...Object.values(updates), id);

    const employee = hrDb.prepare('SELECT * FROM employees WHERE employee_id = ?').get(id);
    hrDb.close();

    logHR('notice', HR_EVENTS.EMPLOYEE_UPDATED, {
      component:   'api:hr',
      employee_id: id,
      actor_id:    (req.ip ?? 'system'),
      request_id:  (req as any).requestId,
    });

    res.json({ success: true, data: employee });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/hr/employees/:id
 *
 * Permanently delete an HR employee row.
 *
 * Important: HR does NOT clean up any source_mappings or identities
 * the GCUID Registry may have created through explicit
 * `/api/gcuid-request/*` flows. The arms-length boundary is
 * preserved — registry records owned by the GCUID system remain.
 * If GCUID-side cleanup is needed, route it through the connector
 * layer (push-cache or scheduled-pull), not by HR writing the
 * registry directly.
 *
 * @route   DELETE /api/hr/employees/:id
 * @param   id — HR employee_id (path param).
 * @returns 200 — `{ success: true, data: { deleted: <id> } }`
 * @throws  404 — `createError('Employee not found', 404)` when `:id` does not exist.
 */
router.delete('/employees/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const hrDb = new Database(HR_DB);
    const existing = hrDb.prepare('SELECT employee_id FROM employees WHERE employee_id = ?').get(id);
    if (!existing) {
      hrDb.close();
      throw createError('Employee not found', 404);
    }

    hrDb.prepare('DELETE FROM employees WHERE employee_id = ?').run(id);
    hrDb.close();

    // No registry cleanup here: HR no longer auto-provisions a GCUID on
        // employee create, so there is no source_mapping or entity_id that
        // HR "owns" to clean up. If a GCUID was later explicitly requested
        // via /api/gcuid-request/submit, that mapping is owned by the GCUID
        // system and must not be removed by HR delete — that would cross the
        // arms-length boundary. If the GCUID system needs to be notified of
        // the HR deletion, it should do so via the connector (push-cache or
        // scheduled-pull), not by HR writing the registry directly.

    logHR('notice', HR_EVENTS.EMPLOYEE_DEACTIVATED, {
      component:   'api:hr',
      employee_id: id,
      actor_id:    (req.ip ?? 'system'),
      request_id:  (req as any).requestId,
    });

    res.json({ success: true, data: { deleted: id } });
  } catch (error) {
    next(error);
  }
});

export { router as hrRoutes };
