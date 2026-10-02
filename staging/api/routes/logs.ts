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
 * Logs API Routes
 *
 * Provides read-only access to the system log tables for the Logs Portal UI.
 *
 * GET  /api/logs              — paginated, filtered log entries (from log_all view)
 * GET  /api/logs/stats        — per-system / per-level counts
 * GET  /api/logs/:log_id      — full record including system-specific fields
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { LOG_LEVEL_CODES } from '../lib/logging/log-types.js';
import type { LogLevel } from '../lib/logging/log-types.js';

import { LOGS_DB_PATH as LOG_DB_PATH } from '../lib/db-paths.js';

const router = Router();

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_SYSTEMS = new Set([
  'gcuid-registry', 'caes', 'hr', 'ldap', 'engineering', 'finance', 'system',
]);

const TABLE_FOR_SYSTEM: Record<string, string> = {
  'gcuid-registry': 'log_gcuid_registry',
  'caes':           'log_caes',
  'hr':             'log_hr_system',
  'ldap':           'log_ldap',
  'engineering':    'log_engineering',
  'finance':        'log_finance',
  'system':         'log_system',
};

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

// Whitelist of columns that may be sorted on — prevents SQL injection
const SORTABLE_COLUMNS = new Set([
  'timestamp', 'level_code', 'system', 'component', 'event_type', 'message', 'outcome', 'duration_ms',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function openDb() {
  const db = new Database(LOG_DB_PATH, { readonly: true });
  return db;
}

/** Build a parameterised WHERE clause from query params. */
function buildWhere(query: Record<string, any>): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const { system, level, component, event_type, search, from: fromTs, to: toTs } = query;

  if (typeof system === 'string' && VALID_SYSTEMS.has(system)) {
    conditions.push('system = ?');
    params.push(system);
  }

  // level = minimum level name → emit only if level_code <= that code
  if (typeof level === 'string' && level in LOG_LEVEL_CODES) {
    const code = LOG_LEVEL_CODES[level as LogLevel];
    conditions.push('level_code <= ?');
    params.push(code);
  }

  if (typeof component === 'string' && component.trim()) {
    conditions.push('component LIKE ?');
    params.push(`%${component.trim()}%`);
  }

  if (typeof event_type === 'string' && event_type.trim()) {
    conditions.push('event_type LIKE ?');
    params.push(`%${event_type.trim()}%`);
  }

  if (typeof search === 'string' && search.trim()) {
    conditions.push('(message LIKE ? OR event_type LIKE ? OR component LIKE ? OR event_code LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term);
  }

  if (typeof fromTs === 'string' && fromTs.trim()) {
    conditions.push('timestamp >= ?');
    params.push(fromTs.trim());
  }

  if (typeof toTs === 'string' && toTs.trim()) {
    conditions.push('timestamp <= ?');
    params.push(toTs.trim());
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/logs
 * Query params:
 *   system     — one of the 7 system IDs
 *   level      — minimum level name (e.g. "warning" → returns warning + error + critical + alarm + emergency)
 *   component  — partial match on component name
 *   event_type — partial match on event_type slug
 *   search     — searches message, event_type, component, event_code
 *   from       — ISO timestamp lower bound (inclusive)
 *   to         — ISO timestamp upper bound (inclusive)
 *   limit      — max rows per page (default 100, max 500)
 *   offset     — pagination offset (default 0)
 *   sort_by    — column to sort by: timestamp|level|system|component|event_type|message|outcome|duration_ms (default: timestamp)
 *   sort_dir   — asc or desc (default: desc)
 */
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  as string) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    // Resolve sort column — 'level' is a display alias for level_code
    const rawSortBy = typeof req.query.sort_by === 'string' ? req.query.sort_by : 'timestamp';
    const sortCol   = rawSortBy === 'level' ? 'level_code' : rawSortBy;
    const sortBy    = SORTABLE_COLUMNS.has(sortCol) ? sortCol : 'timestamp';
    const sortDir   = req.query.sort_dir === 'asc' ? 'ASC' : 'DESC';

    const { where, params } = buildWhere(req.query);

    const db = openDb();
    try {
      const countRow = db.prepare(`SELECT COUNT(*) AS count FROM log_all ${where}`).get(...params) as { count: number };
      const rows     = db.prepare(`SELECT * FROM log_all ${where} ORDER BY ${sortBy} ${sortDir} LIMIT ? OFFSET ?`).all(...params, limit, offset);

      res.json({
        success: true,
        data: {
          rows,
          total: countRow.count,
          limit,
          offset,
        },
      });
    } finally {
      db.close();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/logs/stats
 *
 * Return count breakdowns for the log summary bar — total count,
 * count per system (`HR` / `LDAP` / …), count per level
 * (`DEBUG` / `INFO` / `WARN` / `ERROR`).
 *
 * Aggregates from `log_all` (the unified view across all per-
 * system tables).
 *
 * @returns 200 — `{ success: true, data: { total: number, bySystem: { system, count }[], byLevel: { level, level_code, count }[] } }`
 * @throws  500 — DB read failure.
 */
router.get('/stats', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = openDb();
    try {
      const bySystem = db.prepare(
        `SELECT system, COUNT(*) AS count FROM log_all GROUP BY system ORDER BY system`
      ).all() as { system: string; count: number }[];

      const byLevel = db.prepare(
        `SELECT level, level_code, COUNT(*) AS count FROM log_all GROUP BY level ORDER BY level_code`
      ).all() as { level: string; level_code: number; count: number }[];

      const total = (db.prepare(`SELECT COUNT(*) AS count FROM log_all`).get() as { count: number }).count;

      res.json({ success: true, data: { total, bySystem, byLevel } });
    } finally {
      db.close();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/logs/:log_id
 *
 * Return the full record for one log entry — including all
 * system-specific columns from the appropriate per-system table.
 *
 * Resolution path:
 * 1. Query `log_all` for `system` by `log_id`.
 * 2. Map `system → table` via `TABLE_FOR_SYSTEM`.
 * 3. Query the per-system table for the full record.
 *
 * @route   GET /api/logs/:log_id
 * @param   log_id — log entry id (path param).
 * @returns 200 — `{ success: true, data: <per-system-table row with all system-specific columns> }`
 * @throws  404 — `Log entry not found` (no row in `log_all`) or `Log entry not found in system table` (system found, no per-system row).
 * @throws  500 — `Unknown system: X` (the system id from `log_all` has no `TABLE_FOR_SYSTEM` mapping — likely a migration gap).
 * @throws  500 — DB read failure.
 */
router.get('/:log_id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { log_id } = req.params;

    // First find which system this log_id belongs to (log_all is a view, no index on log_id)
    const db = openDb();
    try {
      // Find the system via log_all
      const meta = db.prepare(
        `SELECT system FROM log_all WHERE log_id = ? LIMIT 1`
      ).get(log_id) as { system: string } | undefined;

      if (!meta) {
        res.status(404).json({ error: { message: 'Log entry not found', statusCode: 404, timestamp: new Date().toISOString(), path: req.path } });
        return;
      }

      const table = TABLE_FOR_SYSTEM[meta.system];
      if (!table) {
        res.status(500).json({ error: { message: `Unknown system: ${meta.system}`, statusCode: 500, timestamp: new Date().toISOString(), path: req.path } });
        return;
      }

      const row = db.prepare(`SELECT * FROM ${table} WHERE log_id = ? LIMIT 1`).get(log_id);
      if (!row) {
        res.status(404).json({ error: { message: 'Log entry not found in system table', statusCode: 404, timestamp: new Date().toISOString(), path: req.path } });
        return;
      }

      res.json({ success: true, data: row });
    } finally {
      db.close();
    }
  } catch (err) {
    next(err);
  }
});

export { router as logsRoutes };
