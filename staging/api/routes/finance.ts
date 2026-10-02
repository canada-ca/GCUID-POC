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
 * Finance Department API Routes
 * 
 * Finance department portal endpoints for employee management and GCUID integration
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { createError } from '../middleware/error.js';
import {
  getDeptCacheInfo, upsertToCache, deleteFromCache,
} from '../lib/dept-cache.js';
import { logFinance } from '../lib/logging/logger.js';
import { FINANCE_EVENTS } from '../lib/logging/log-events.js';

const router = Router();
const REGISTRY_DB = './data/registry.db';
const FIN_DB = './data/sources/conn-finance.db';
const SYSTEM_ID = 'finance';

// ============================================================================
// Employee Management Endpoints
// ============================================================================

/**
 * GET /api/finance/employees?limit=100
 *
 * List active finance department employees (status='active') with
 * cross-system coverage metadata attached.
 *
 * Coverage is computed as 4 boolean axes:
 * - department: always true (this IS the dept system)
 * - hr:         linked HR employee_id
 * - ldap:       linked LDAP username
 * - gcuid:      linked GCUID
 *
 * `coverage_score` (0–4) and `coverage_percentage` (0/25/50/75/100)
 * are derived. Every employee triggers a `COVERAGE_CALCULATED` log
 * record (one per row, intended for analytics).
 *
 * @route   GET /api/finance/employees
 * @param   limit — query param, default 100. Hard cap; returns at most `limit` rows.
 * @returns 200 — `{ success: true, data: EmployeeRow[], count: number, department: 'Finance' }`
 *          Each `EmployeeRow` is the `conn-finance.db#employees` columns plus
 *          `coverage: { department, hr, ldap, gcuid }`, `coverage_score: number`,
 *          `coverage_percentage: number`.
 * @throws  500 — database read failure.
 */
router.get('/employees', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;

    // ── Authoritative source ────────────────────────────────────────────────
    const finDb = new Database(FIN_DB, { readonly: true });
    const employees = finDb.prepare('SELECT * FROM employees WHERE status = ? LIMIT ?')
      .all('active', limit);
    finDb.close();
    
    // Enrich with coverage information
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    
    employees.forEach((emp: any) => {
      // Add coverage info
      const coverage = {
        department: true,  // Always true for dept employees
        hr: !!emp.hr_employee_id,
        ldap: !!emp.ldap_username,
        gcuid: !!emp.gcuid
      };
      
      emp.coverage = coverage;
      emp.coverage_score = Object.values(coverage).filter(Boolean).length;
      emp.coverage_percentage = Math.round((emp.coverage_score / 4) * 100);
      logFinance('debug', FINANCE_EVENTS.COVERAGE_CALCULATED, {
        component: 'api:finance',
        fin_employee_id: String(emp.dept_id ?? ''),
        coverage_score: emp.coverage_score,
        coverage_pct: emp.coverage_percentage,
      });
    });
    
    registryDb.close();

    logFinance('debug', FINANCE_EVENTS.EMPLOYEE_LISTED, {
      component: 'api:finance',
      actor_id:  (req.ip ?? 'system'),
      request_id: (req as any).requestId,
    });
    
    res.json({
      success: true,
      data: employees,
      count: employees.length,
      department: 'Finance'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/finance/employees/:id
 *
 * View one finance employee record, joined with full GCUID details
 * (identity, aliases, source_mappings) when a GCUID exists, plus
 * the standard 4-axis coverage object.
 *
 * @route   GET /api/finance/employees/:id
 * @param   id — Finance dept_id (path param), e.g. `"FIN-001"`.
 * @returns 200 — `{ success: true, data: EmployeeRow & { gcuid_details: IdentityRow & { aliases: AliasRow[], source_mappings: SourceMappingRow[] } | null, coverage: { department, hr, ldap, gcuid } } }`
 * @throws  404 — `createError('Employee not found', 404)` when `:id` does not exist.
 * @throws  500 — database read failure.
 */
router.get('/employees/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // ── Authoritative source ────────────────────────────────────────────────
    const finDb = new Database(FIN_DB, { readonly: true });
    const employee = finDb.prepare('SELECT * FROM employees WHERE dept_id = ?').get(id) as any;
    finDb.close();
    
    if (!employee) {
      logFinance('info', FINANCE_EVENTS.EMPLOYEE_NOT_FOUND, {
        component: 'api:finance',
        fin_employee_id: id,
        actor_id: (req.ip ?? 'system'),
        request_id: (req as any).requestId,
      });
      throw createError('Employee not found', 404);
    }
    
    // Get GCUID details if present
    if (employee.gcuid) {
      const registryDb = new Database(REGISTRY_DB, { readonly: true });
      const identity = registryDb.prepare('SELECT * FROM identities WHERE gcuid = ?').get(employee.gcuid);
      const aliases = registryDb.prepare('SELECT * FROM aliases WHERE gcuid = ?').all(employee.gcuid);
      const mappings = registryDb.prepare('SELECT * FROM source_mappings WHERE gcuid = ?').all(employee.gcuid);
      registryDb.close();
      
      employee.gcuid_details = {
        identity,
        aliases,
        source_mappings: mappings
      };
    }
    
    // Add coverage info
    employee.coverage = {
      department: true,
      hr: !!employee.hr_employee_id,
      ldap: !!employee.ldap_username,
      gcuid: !!employee.gcuid
    };

    logFinance('debug', FINANCE_EVENTS.EMPLOYEE_VIEWED, {
      component: 'api:finance',
      fin_employee_id: id,
      actor_id: (req.ip ?? 'system'),
      request_id: (req as any).requestId,
    });
    
    res.json({
      success: true,
      data: employee
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/finance/stats
 *
 * Aggregate statistics for active finance employees:
 * - Total active employees
 * - Breakdown by employment_type
 * - Breakdown by clearance_level
 * - Per-system coverage counts + percentages (HR, LDAP, GCUID)
 * - Full-coverage count (all 4 axes present)
 *
 * Restricted to `status = 'active'` rows.
 *
 * @returns 200 — `{ success: true, data: { department: 'Finance', total_employees: number, employment_types: { employment_type, count }[], clearance_levels: { clearance_level, count }[], coverage: { hr: { count, percentage }, ldap: { count, percentage }, gcuid: { count, percentage }, full_coverage: { count, percentage } } } }`
 * @throws  500 — database read failure.
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const finDb = new Database(FIN_DB, { readonly: true });
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    
    // Total employees
    const totalEmployees = finDb.prepare('SELECT COUNT(*) as count FROM employees WHERE status = ?')
      .get('active') as any;
    
    // By employment type
    const byEmploymentType = finDb.prepare(`
      SELECT employment_type, COUNT(*) as count
      FROM employees
      WHERE status = 'active'
      GROUP BY employment_type
    `).all();
    
    // By clearance level
    const byClearance = finDb.prepare(`
      SELECT clearance_level, COUNT(*) as count
      FROM employees
      WHERE status = 'active' AND clearance_level IS NOT NULL
      GROUP BY clearance_level
    `).all();
    
    // Coverage statistics
    const withHR = finDb.prepare('SELECT COUNT(*) as count FROM employees WHERE hr_employee_id IS NOT NULL AND status = ?')
      .get('active') as any;
    const withLDAP = finDb.prepare('SELECT COUNT(*) as count FROM employees WHERE ldap_username IS NOT NULL AND status = ?')
      .get('active') as any;
    const withGCUID = finDb.prepare('SELECT COUNT(*) as count FROM employees WHERE gcuid IS NOT NULL AND status = ?')
      .get('active') as any;
    
    // Full coverage (all 4 systems)
    const fullCoverage = finDb.prepare(`
      SELECT COUNT(*) as count FROM employees 
      WHERE hr_employee_id IS NOT NULL 
        AND ldap_username IS NOT NULL 
        AND gcuid IS NOT NULL
        AND status = 'active'
    `).get() as any;
    
    finDb.close();
    registryDb.close();
    
    const total = totalEmployees.count;
    
    res.json({
      success: true,
      data: {
        department: 'Finance',
        total_employees: total,
        employment_types: byEmploymentType,
        clearance_levels: byClearance,
        coverage: {
          hr: {
            count: withHR.count,
            percentage: Math.round((withHR.count / total) * 100)
          },
          ldap: {
            count: withLDAP.count,
            percentage: Math.round((withLDAP.count / total) * 100)
          },
          gcuid: {
            count: withGCUID.count,
            percentage: Math.round((withGCUID.count / total) * 100)
          },
          full_coverage: {
            count: fullCoverage.count,
            percentage: Math.round((fullCoverage.count / total) * 100)
          }
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/finance/search?q=query&limit=10
 *
 * Search finance employees by `LIKE %query%` against first_name,
 * last_name, email, or dept_id. Restricted to active rows.
 *
 * @route   GET /api/finance/search
 * @param   q     — query string (required). Case-insensitive substring.
 * @param   limit — result cap (default 10).
 * @returns 200 — `{ success: true, data: EmployeeRow[], count: number, query: string }`
 *          Each row has the standard `coverage` object attached.
 * @throws  400 — `createError('Query parameter "q" is required', 400)` when `q` is missing.
 * @throws  500 — database read failure.
 */
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 10;
    
    if (!query) {
      throw createError('Query parameter "q" is required', 400);
    }

    // ── Authoritative source ────────────────────────────────────────────────
    const finDb = new Database(FIN_DB, { readonly: true });
    const pattern = `%${query}%`;
    
    const employees = finDb.prepare(`
      SELECT * FROM employees
      WHERE (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR dept_id LIKE ?)
        AND status = 'active'
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, limit);
    
    finDb.close();
    
    // Add coverage info
    employees.forEach((emp: any) => {
      emp.coverage = {
        department: true,
        hr: !!emp.hr_employee_id,
        ldap: !!emp.ldap_username,
        gcuid: !!emp.gcuid
      };
    });
    
    res.json({
      success: true,
      data: employees,
      count: employees.length,
      query
    });

    logFinance('debug', FINANCE_EVENTS.EMPLOYEE_SEARCHED, {
      component: 'api:finance',
      actor_id: (req.ip ?? 'system'),
      request_id: (req as any).requestId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/finance/connector/health
 *
 * Composite health snapshot for the Finance department connector.
 *
 * Returns a degraded result (200 OK with `status: 'unregistered'`)
 * if the system isn't registered with the GCUID Registry; otherwise
 * combines registration row + DB probe to compute overall status.
 *
 * @returns 200 — `{ success: true, data: { system_id, connector_id, display_name, access_mode, is_active, last_sync_at, cache_ttl_seconds, cache_stale_policy, status, db_status, db_message, local_record_count, registry_gcuid_count } }`
 *          OR `{ success: false, data: { status: 'unregistered', message } }` when the system is not in `source_systems`.
 * @throws  500 — database read failure.
 */
router.get('/connector/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    let sysRow: any = null;
    let gcuidCount = 0;
    try {
      sysRow = registryDb.prepare(
        `SELECT system_id, connector_id, display_name, access_mode, last_sync_at, cache_ttl_seconds,
                cache_stale_policy, is_active
         FROM source_systems WHERE system_id = ?`
      ).get(SYSTEM_ID);

      gcuidCount = (registryDb.prepare(
        `SELECT COUNT(DISTINCT gcuid) AS n FROM source_mappings WHERE source_system = ?`
      ).get(SYSTEM_ID) as any)?.n ?? 0;
    } finally {
      registryDb.close();
    }

    // Probe the connector DB for accessibility
    let dbStatus = 'unavailable';
    let dbMessage = 'DB probe not attempted';
    let localRecordCount = 0;
    try {
      const finDb = new Database(FIN_DB, { readonly: true });
      localRecordCount = (finDb.prepare(`SELECT COUNT(*) AS n FROM employees WHERE status = 'active'`).get() as any).n;
      finDb.close();
      dbStatus = 'operational';
      dbMessage = 'Direct DB access OK';
    } catch (err) {
      dbStatus = 'degraded';
      dbMessage = err instanceof Error ? err.message : 'DB probe failed';
    }

    if (!sysRow) {
      return res.json({ success: false, data: { status: 'unregistered', message: `System '${SYSTEM_ID}' not found in registry` } });
    }

    const status = !sysRow.is_active ? 'disabled'
      : dbStatus === 'degraded'       ? 'degraded'
      : 'operational';

    res.json({
      success: true,
      data: {
        system_id:           sysRow.system_id,
        connector_id:        sysRow.connector_id ?? 'conn-finance',
        display_name:        sysRow.display_name,
        access_mode:         sysRow.access_mode,
        is_active:           !!sysRow.is_active,
        last_sync_at:        sysRow.last_sync_at ?? null,
        cache_ttl_seconds:   sysRow.cache_ttl_seconds,
        cache_stale_policy:  sysRow.cache_stale_policy,
        status,
        db_status:           dbStatus,
        db_message:          dbMessage,
        local_record_count:  localRecordCount,
        registry_gcuid_count: gcuidCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/finance/coverage-gaps
 *
 * Active finance employees missing one of the cross-system linkages
 * (HR / LDAP / GCUID). Returns the three lists separately, plus a
 * count, so the UI can drive the "link now" CTA per gap type.
 *
 * @returns 200 — `{ success: true, data: { department: 'Finance', gaps: { missing_hr: { count, employees }, missing_ldap: { count, employees }, missing_gcuid: { count, employees } } } }`
 * @throws  500 — database read failure.
 */
router.get('/coverage-gaps', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const finDb = new Database(FIN_DB, { readonly: true });
    
    // Employees missing HR records
    const missingHR = finDb.prepare(`
      SELECT dept_id, first_name, last_name, email, role, employment_type
      FROM employees
      WHERE hr_employee_id IS NULL AND status = 'active'
    `).all();
    
    // Employees missing LDAP accounts
    const missingLDAP = finDb.prepare(`
      SELECT dept_id, first_name, last_name, email, role, employment_type
      FROM employees
      WHERE ldap_username IS NULL AND status = 'active'
    `).all();
    
    // Employees without GCUIDs
    const missingGCUID = finDb.prepare(`
      SELECT dept_id, first_name, last_name, email, role, employment_type,
             hr_employee_id, ldap_username
      FROM employees
      WHERE gcuid IS NULL AND status = 'active'
    `).all();
    
    finDb.close();
    
    res.json({
      success: true,
      data: {
        department: 'Finance',
        gaps: {
          missing_hr: {
            count: missingHR.length,
            employees: missingHR
          },
          missing_ldap: {
            count: missingLDAP.length,
            employees: missingLDAP
          },
          missing_gcuid: {
            count: missingGCUID.length,
            employees: missingGCUID
          }
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/finance/request-gcuid
 *
 * Step 1 of the two-step GCUID request workflow (preview).
 *
 * Looks up the finance employee by `dept_id`, then internally calls
 * `POST /api/gcuid-request/preview` on the GCUID API to obtain a
 * preview payload (matches, suggested action, etc.). The preview
 * does NOT yet create a GCUID or write to the registry.
 *
 * The preview result is returned to the caller. To commit, the
 * caller must follow up with `POST /api/finance/request-gcuid/confirm`
 * passing the same `dept_id` and the chosen `action`.
 *
 * @route   POST /api/finance/request-gcuid
 * @body    `{ dept_id: string, reason?: string }`
 * @returns 200 — `{ success: true, message: 'GCUID request preview — call /confirm to submit', data: { confirmed: false, dept_id, employee_name, reason, preview: <preview payload from /api/gcuid-request/preview> } }`
 * @throws  400 — missing `dept_id`, employee already has a GCUID, or downstream preview returns an error.
 * @throws  404 — `createError('Employee not found', 404)` when no row matches `dept_id`.
 */
router.post('/request-gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dept_id, reason } = req.body as { dept_id?: string; reason?: string };

    if (!dept_id) {
      throw createError('dept_id is required', 400);
    }

    const finDb = new Database(FIN_DB, { readonly: true });
    const employee = finDb.prepare('SELECT * FROM employees WHERE dept_id = ?').get(dept_id) as Record<string, any> | undefined;
    finDb.close();

    if (!employee) {
      throw createError('Employee not found', 404);
    }
    if (employee.gcuid) {
      throw createError('Employee already has a GCUID', 400);
    }

    // Step 1 (preview): call /api/gcuid-request/preview via the same-process API.
    // Per architecture (R3a): the department admin explicitly requests a GCUID
    // for this employee; the GCUID system owns the matching and creation logic.
    const port = process.env['PORT'] ?? '5182';
    const previewResp = await fetch(`http://localhost:${port}/api/gcuid-request/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_system: SYSTEM_ID,
        source_id:     dept_id,
        attributes: {
          first_name: String(employee.first_name ?? ''),
          last_name:  String(employee.last_name  ?? ''),
          email:      String(employee.email      ?? ''),
          username:   String(employee.ldap_username ?? ''),
        },
      }),
    });
    const previewJson = await previewResp.json() as { success: boolean; data?: any; error?: any };
    if (!previewResp.ok || !previewJson.success) {
      throw createError(previewJson.error?.message ?? 'GCUID preview failed', previewResp.status || 502);
    }

    logFinance('notice', FINANCE_EVENTS.GCUID_LINKED, {
      component:   'api:finance:request-gcuid',
      fin_employee_id: dept_id,
      actor_id:    (req.ip ?? 'system'),
      request_id:  (req as any).requestId,
    });

    res.json({
      success: true,
      message: 'GCUID request preview — call /confirm to submit',
      data: {
        confirmed: false,
        dept_id,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        reason: reason || 'Department requested',
        preview: previewJson.data,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/finance/request-gcuid/confirm
 *
 * Step 2 of the two-step GCUID request workflow (commit).
 *
 * Looks up the finance employee by `dept_id` and internally calls
 * `POST /api/gcuid-request/submit` on the GCUID API. If the call
 * succeeds, the GCUID is now linked to this employee in the registry.
 *
 * @route   POST /api/finance/request-gcuid/confirm
 * @body    `{ dept_id: string, reason?: string, action?: 'create_new' | 'link_existing', target_gcuid?: string }`
 *          `action` defaults to `'create_new'`. `target_gcuid` is required when
 *          `action === 'link_existing'` (the GCUID to link to).
 * @returns 201 — `{ success: true, message: 'GCUID request submitted', data: { confirmed: true, dept_id, employee_name, reason, ...<submit response> } }`
 * @throws  400 — missing `dept_id`, missing `target_gcuid` when action is `link_existing`, employee already has a GCUID, or downstream submit fails.
 * @throws  404 — `createError('Employee not found', 404)` when no row matches `dept_id`.
 */
router.post('/request-gcuid/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      dept_id, reason,
      action = 'create_new',
      target_gcuid,
    } = req.body as { dept_id?: string; reason?: string; action?: 'create_new' | 'link_existing'; target_gcuid?: string };

    if (!dept_id) {
      throw createError('dept_id is required', 400);
    }
    if (action === 'link_existing' && !target_gcuid) {
      throw createError('target_gcuid is required when action is link_existing', 400);
    }

    const finDb = new Database(FIN_DB, { readonly: true });
    const employee = finDb.prepare('SELECT * FROM employees WHERE dept_id = ?').get(dept_id) as Record<string, any> | undefined;
    finDb.close();

    if (!employee) {
      throw createError('Employee not found', 404);
    }
    if (employee.gcuid) {
      throw createError('Employee already has a GCUID', 400);
    }

    const port = process.env['PORT'] ?? '5182';
    const submitBody: Record<string, any> = {
      source_system: SYSTEM_ID,
      source_id:     dept_id,
      attributes: {
        first_name: String(employee.first_name ?? ''),
        last_name:  String(employee.last_name  ?? ''),
        email:      String(employee.email      ?? ''),
        username:   String(employee.ldap_username ?? ''),
      },
      action,
      reason: reason || 'Department admin confirmed GCUID request',
    };
    if (action === 'link_existing') {
      submitBody.target_gcuid = target_gcuid;
    }

    const submitResp = await fetch(`http://localhost:${port}/api/gcuid-request/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitBody),
    });
    const submitJson = await submitResp.json() as { success: boolean; data?: any; error?: any };
    if (!submitResp.ok || !submitJson.success) {
      throw createError(submitJson.error?.message ?? 'GCUID submit failed', submitResp.status || 502);
    }

    logFinance('notice', FINANCE_EVENTS.GCUID_LINKED, {
      component:    'api:finance:request-gcuid:confirm',
      fin_employee_id: dept_id,
      actor_id:     (req.ip ?? 'system'),
      gcuid_linked: submitJson.data?.gcuid,
      request_id:   (req as any).requestId,
    });

    res.status(201).json({
      success: true,
      message: 'GCUID request submitted',
      data: {
        confirmed: true,
        dept_id,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        reason: reason || 'Department admin confirmed GCUID request',
        ...submitJson.data,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/finance/employees
 *
 * Create a new finance employee record. `dept_id` is auto-generated
 * as `FIN-NNN` from `MAX(dept_id)+1`. The row is written through to
 * the department cache (if configured) so external readers see it
 * immediately.
 *
 * @route   POST /api/finance/employees
 * @body    `{ first_name, last_name, email, role, employment_type, start_date, hr_employee_id?, ldap_username?, clearance_level?, manager_dept_id?, end_date?, status? }`
 *          `status` defaults to `'active'`. Optional fields may be `null`.
 * @returns 201 — `{ success: true, data: EmployeeRow, cache_info?: CacheInfo }`
 *          (`cache_info` only present when a department cache is configured.)
 * @throws  400 — `createError('...required', 400)` when any required field is missing.
 */
router.post('/employees', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      first_name, last_name, email, role, employment_type, start_date,
      hr_employee_id, ldap_username, clearance_level, manager_dept_id, end_date,
      status = 'active',
    } = req.body;

    if (!first_name || !last_name || !email || !role || !employment_type || !start_date) {
      throw createError('first_name, last_name, email, role, employment_type, and start_date are required', 400);
    }

    const finDb = new Database(FIN_DB);

    // Auto-generate dept_id: FIN-NNN
    const maxRow = finDb.prepare("SELECT dept_id FROM employees WHERE dept_id LIKE 'FIN-%' ORDER BY dept_id DESC LIMIT 1").get() as any;
    const nextNum = maxRow ? (parseInt(maxRow.dept_id.replace('FIN-', ''), 10) + 1) : 1;
    const dept_id = `FIN-${String(nextNum).padStart(3, '0')}`;

    const now = new Date().toISOString();
    finDb.prepare(`
      INSERT INTO employees
        (dept_id, first_name, last_name, email, role, employment_type, hr_employee_id, ldap_username, clearance_level, manager_dept_id, start_date, end_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(dept_id, first_name, last_name, email, role, employment_type, hr_employee_id ?? null, ldap_username ?? null, clearance_level ?? null, manager_dept_id ?? null, start_date, end_date ?? null, status, now, now);

    const employee = finDb.prepare('SELECT * FROM employees WHERE dept_id = ?').get(dept_id);
    finDb.close();

    // Write-through to cache
    const cacheInfo = getDeptCacheInfo(SYSTEM_ID);
    if (cacheInfo) upsertToCache(SYSTEM_ID, dept_id, employee as Record<string, any>);

    logFinance('notice', FINANCE_EVENTS.EMPLOYEE_CREATED, {
      component:       'api:finance',
      fin_employee_id: dept_id,
      actor_id:        (req.ip ?? 'system'),
      cost_centre:     'n/a',
      request_id:      (req as any).requestId,
    });

    res.status(201).json({ success: true, data: employee, ...(cacheInfo ? { cache_info: cacheInfo } : {}) });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/finance/employees/:id
 *
 * Partial update of a finance employee record. Only the fields listed
 * below are accepted; any other key in `req.body` is silently
 * ignored. `updated_at` is set server-side. The row is written
 * through to the department cache when configured.
 *
 * @route   PUT /api/finance/employees/:id
 * @param   id — Finance dept_id (path param).
 * @body    Any subset of `{ first_name, last_name, email, role, employment_type, hr_employee_id, ldap_username, clearance_level, manager_dept_id, start_date, end_date, status }`.
 * @returns 200 — `{ success: true, data: EmployeeRow, cache_info?: CacheInfo }`
 * @throws  400 — `createError('No updatable fields provided', 400)` when none of the accepted keys are present.
 * @throws  404 — `createError('Employee not found', 404)` when `:id` does not exist.
 */
router.put('/employees/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const fields = ['first_name', 'last_name', 'email', 'role', 'employment_type', 'hr_employee_id', 'ldap_username', 'clearance_level', 'manager_dept_id', 'start_date', 'end_date', 'status'];
    const updates: Record<string, any> = {};
    for (const f of fields) {
      if (f in req.body) updates[f] = req.body[f];
    }

    if (Object.keys(updates).length === 0) {
      throw createError('No updatable fields provided', 400);
    }

    const finDb = new Database(FIN_DB);
    const existing = finDb.prepare('SELECT dept_id FROM employees WHERE dept_id = ?').get(id);
    if (!existing) {
      finDb.close();
      throw createError('Employee not found', 404);
    }

    updates.updated_at = new Date().toISOString();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    finDb.prepare(`UPDATE employees SET ${setClauses} WHERE dept_id = ?`).run(...Object.values(updates), id);

    const employee = finDb.prepare('SELECT * FROM employees WHERE dept_id = ?').get(id);
    finDb.close();

    // Write-through to cache
    const cacheInfo = getDeptCacheInfo(SYSTEM_ID);
    if (cacheInfo) upsertToCache(SYSTEM_ID, id, employee as Record<string, any>);

    logFinance('notice', FINANCE_EVENTS.EMPLOYEE_UPDATED, {
      component:       'api:finance',
      fin_employee_id: id,
      actor_id:        (req.ip ?? 'system'),
      request_id:      (req as any).requestId,
    });

    res.json({ success: true, data: employee, ...(cacheInfo ? { cache_info: cacheInfo } : {}) });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/finance/employees/:id
 *
 * Permanently delete a finance employee row.
 *
 * Note: this route ALSO removes the corresponding
 * `source_mappings` row for the Finance system from the GCUID
 * Registry, and removes the row from the department cache when
 * configured. The GCUID identity itself is NOT deleted here — only
 * the Finance-side source_mapping linking this employee to the
 * GCUID. If the GCUID has mappings from other systems (HR, LDAP),
 * those mappings remain. To retire the GCUID entirely, use the
 * GCUID Registry's withdraw flow.
 *
 * @route   DELETE /api/finance/employees/:id
 * @param   id — Finance dept_id (path param).
 * @returns 200 — `{ success: true, data: { deleted: <id> }, cache_info?: CacheInfo }`
 * @throws  404 — `createError('Employee not found', 404)` when `:id` does not exist.
 */
router.delete('/employees/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const finDb = new Database(FIN_DB);
    const existing = finDb.prepare('SELECT dept_id FROM employees WHERE dept_id = ?').get(id);
    if (!existing) {
      finDb.close();
      throw createError('Employee not found', 404);
    }

    finDb.prepare('DELETE FROM employees WHERE dept_id = ?').run(id);
    finDb.close();

    // Remove GCUID binding from the registry
    const registryDb = new Database(REGISTRY_DB);
    registryDb.prepare(
      'DELETE FROM source_mappings WHERE source_system = ? AND source_id = ?'
    ).run(SYSTEM_ID, id);
    registryDb.close();

    // Remove from cache
    const cacheInfo = getDeptCacheInfo(SYSTEM_ID);
    if (cacheInfo) deleteFromCache(SYSTEM_ID, id);

    logFinance('notice', FINANCE_EVENTS.EMPLOYEE_DELETED, {
      component:       'api:finance',
      fin_employee_id: id,
      actor_id:        (req.ip ?? 'system'),
      request_id:      (req as any).requestId,
    });

    res.json({ success: true, data: { deleted: id }, ...(cacheInfo ? { cache_info: cacheInfo } : {}) });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/finance/employees/:id/linkage
 *
 * Set or clear the cross-system linkage fields (`hr_employee_id`,
 * `ldap_username`) for one finance employee. Fields explicitly
 * present in the request body are written; missing fields are
 * untouched. Setting a field to `null` clears the linkage.
 *
 * @route   PATCH /api/finance/employees/:id/linkage
 * @param   id — Finance dept_id (path param).
 * @body    Any combination of `{ hr_employee_id?: string | null, ldap_username?: string | null }`. Both default to no-op when absent.
 * @returns 200 — `{ success: true, data: EmployeeRow, cache_info?: CacheInfo }`
 * @throws  404 — `createError('Employee not found', 404)` when `:id` does not exist.
 */
router.patch('/employees/:id/linkage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { hr_employee_id, ldap_username } = req.body;

    const finDb = new Database(FIN_DB);
    const existing = finDb.prepare('SELECT dept_id FROM employees WHERE dept_id = ?').get(id);
    if (!existing) {
      finDb.close();
      throw createError('Employee not found', 404);
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if ('hr_employee_id' in req.body) updates.hr_employee_id = hr_employee_id ?? null;
    if ('ldap_username' in req.body) updates.ldap_username = ldap_username ?? null;

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    finDb.prepare(`UPDATE employees SET ${setClauses} WHERE dept_id = ?`).run(...Object.values(updates), id);

    const employee = finDb.prepare('SELECT * FROM employees WHERE dept_id = ?').get(id);
    finDb.close();

    // Write-through to cache
    const cacheInfo = getDeptCacheInfo(SYSTEM_ID);
    if (cacheInfo) upsertToCache(SYSTEM_ID, id, employee as Record<string, any>);

    res.json({ success: true, data: employee, ...(cacheInfo ? { cache_info: cacheInfo } : {}) });
  } catch (error) {
    next(error);
  }
});

export default router;
export { router as financeRoutes };
