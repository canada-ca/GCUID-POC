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
 * Log Levels API Routes
 *
 * Exposes per-system minimum log level settings stored in the registry database.
 * GET  /api/log-levels        — read current per-system levels
 * PATCH /api/log-levels       — update one or more system levels
 *
 * Levels follow RFC 5424 severity (lower code = higher severity):
 *   emergency(0) alarm(1) critical(2) error(3) warning(4) notice(5) info(6) debug(7)
 *
 * Alarm, critical, and emergency always emit regardless of the configured minimum.
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { LOG_LEVELS } from '../lib/logging/log-types.js';
import { invalidateSystemLevelsCache } from '../lib/logging/logger.js';

const router = Router();
const REGISTRY_DB = path.join(process.cwd(), 'data/registry.db');
const CONFIG_KEY   = 'log_levels';

// ─── Types ────────────────────────────────────────────────────────────────────

export const SYSTEM_IDS = [
  'gcuid-registry',
  'caes',
  'hr',
  'ldap',
  'engineering',
  'finance',
  'system',
] as const;

export type SystemId = (typeof SYSTEM_IDS)[number];
export type LogLevelsConfig = Record<SystemId, string>;

const DEFAULT_LEVELS: LogLevelsConfig = {
  'gcuid-registry': 'info',
  'caes':           'info',
  'hr':             'info',
  'ldap':           'info',
  'engineering':    'info',
  'finance':        'info',
  'system':         'info',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Ensure the config table exists (idempotent). */
function ensureTable(db: Database.Database): void {
  db.prepare(
    'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)'
  ).run();
}

/** Read log levels from the DB, merging with defaults. */
export function readLogLevels(): LogLevelsConfig {
  const db = new Database(REGISTRY_DB, { readonly: true });
  try {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(CONFIG_KEY) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_LEVELS };
    const stored = JSON.parse(row.value) as Partial<LogLevelsConfig>;
    return { ...DEFAULT_LEVELS, ...stored };
  } catch {
    return { ...DEFAULT_LEVELS };
  } finally {
    db.close();
  }
}

/** Persist log levels to the DB. */
function writeLogLevels(levels: LogLevelsConfig): void {
  const db = new Database(REGISTRY_DB);
  try {
    ensureTable(db);
    db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(CONFIG_KEY, JSON.stringify(levels), new Date().toISOString());
  } finally {
    db.close();
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/log-levels
 *
 * Read current per-system minimum log levels. Stored in
 * `config(key='log_levels')` in the registry DB; merged with
 * defaults on read so missing systems fall back to `'info'`.
 *
 * @returns 200 — `{ success: true, data: { 'gcuid-registry': LogLevel, 'caes': LogLevel, 'hr': LogLevel, 'ldap': LogLevel, 'engineering': LogLevel, 'finance': LogLevel, 'system': LogLevel } }`
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: readLogLevels() });
});

/**
 * PATCH /api/log-levels
 *
 * Update one or more system log levels. Validates every key
 * (must be a known `SystemId`) and every value (must be a valid
 * `LogLevel` from `LOG_LEVELS`).
 *
 * After persisting, invalidates the logger's in-memory cache so
 * the next log write picks up the new threshold immediately.
 *
 * @route   PATCH /api/log-levels
 * @body    Partial map of `SystemId → LogLevel`. Example: `{ "hr": "debug", "system": "warning" }`.
 * @returns 200 — `{ success: true, data: <full merged LogLevelsConfig> }`
 * @throws  400 — `400` JSON error envelope when any key is unknown or any value is not in `LOG_LEVELS`.
 * @throws  500 — database write failure.
 */
router.patch('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const patch = req.body as Record<string, string>;

    // Validate all keys and values
    for (const [key, val] of Object.entries(patch)) {
      if (!(SYSTEM_IDS as readonly string[]).includes(key)) {
        res.status(400).json({ error: { message: `Unknown system: ${key}`, statusCode: 400, timestamp: new Date().toISOString(), path: req.path } });
        return;
      }
      if (!(LOG_LEVELS as readonly string[]).includes(val)) {
        res.status(400).json({ error: { message: `Invalid log level for ${key}: "${val}". Must be one of: ${LOG_LEVELS.join(', ')}`, statusCode: 400, timestamp: new Date().toISOString(), path: req.path } });
        return;
      }
    }

    const current = readLogLevels();
    const updated: LogLevelsConfig = { ...current, ...(patch as Partial<LogLevelsConfig>) };
    writeLogLevels(updated);

    // Invalidate the logger's in-memory cache so next log write picks up the change immediately
    invalidateSystemLevelsCache();

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

export { router as logLevelsRoutes };
