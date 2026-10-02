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
 * Tools API Routes
 *
 * Administrative tooling endpoints. Currently provides GCUID search-and-purge:
 *
 *   GET  /api/tools/gcuid/search  — search registry by criteria
 *   POST /api/tools/gcuid/delete  — delete (or dry-run) a list of GCUIDs
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createError } from '../middleware/error.js';
import { REGISTRY_DB_PATH, CONNECTORS_DIR } from '../lib/db-paths.js';

const router = Router();

// ─── Lazy DB accessor ─────────────────────────────────────────────────────────

let _reg: InstanceType<typeof Database> | null = null;
function reg(): InstanceType<typeof Database> {
  if (!_reg) _reg = new Database(REGISTRY_DB_PATH);
  return _reg;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchRow {
  gcuid: string;
  state: string;
  entity_type: string;
  entity_id: string;
  namespace: string;
  created_at: string;
  updated_at: string;
  alias_value: string | null;
  alias_type: string | null;
}

// ─── GCUID Search ─────────────────────────────────────────────────────────────
// GET /api/tools/gcuid/search
// Query params (all optional, ANDed together):
//   q            — free-text against gcuid / entity_id / alias_value
//   entity_type  — exact match (person | org | asset | app | agent)
//   state        — exact match (active | provisional | suspended | retired | archived | under_review)
//   namespace    — exact match (gc | ...)
//   limit        — max rows returned (default 200, max 500)

router.get('/gcuid/search', (req: Request, res: Response, next: NextFunction) => {
  try {
    const q          = (req.query['q']           as string | undefined)?.trim() ?? '';
    const entityType = (req.query['entity_type'] as string | undefined)?.trim() ?? '';
    const state      = (req.query['state']       as string | undefined)?.trim() ?? '';
    const namespace  = (req.query['namespace']   as string | undefined)?.trim() ?? '';
    const rawLimit   = parseInt(req.query['limit'] as string ?? '200', 10);
    const limit      = Math.min(isNaN(rawLimit) ? 200 : rawLimit, 500);

    const conditions: string[] = [];
    const params: any[]        = [];

    if (q) {
      conditions.push(`(
        i.gcuid       LIKE ? ESCAPE '\\' OR
        i.entity_id   LIKE ? ESCAPE '\\' OR
        a.alias_value LIKE ? ESCAPE '\\'
      )`);
      const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
      params.push(like, like, like);
    }
    if (entityType) { conditions.push('i.entity_type = ?'); params.push(entityType); }
    if (state)      { conditions.push('i.state = ?');       params.push(state); }
    if (namespace)  { conditions.push('i.namespace = ?');   params.push(namespace); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        i.gcuid,
        i.state,
        i.entity_type,
        i.entity_id,
        i.namespace,
        i.created_at,
        i.updated_at,
        a.alias_value,
        a.alias_type
      FROM identities i
      LEFT JOIN aliases a ON a.gcuid = i.gcuid AND a.status = 'enabled'
      ${where}
      GROUP BY i.gcuid
      ORDER BY i.created_at DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = reg().prepare(sql).all(...params) as SearchRow[];

    res.json({ success: true, data: { results: rows, total: rows.length, limit } });
  } catch (err) {
    next(err);
  }
});

// ─── GCUID Delete (with dry-run) ──────────────────────────────────────────────
// POST /api/tools/gcuid/delete
// Body: { gcuids: string[], dry_run?: boolean, reason?: string }
//
// Deletes each GCUID from:
//   registry.db  — identifier_state_history, state_history, aliases,
//                  source_mappings, attribute_mappings, attribute_cache,
//                  hook_events, identities
//   connector DBs — sets gcuid = NULL, gcuid_state = NULL on employee/user rows
//
// Audit rows in logs.db are intentionally retained for traceability.

const REGISTRY_DELETION_ORDER = [
  'identifier_state_history',
  'state_history',
  'aliases',
  'source_mappings',
  'attribute_mappings',
  'attribute_cache',
  'hook_events',
  'identities',
] as const;

router.post('/gcuid/delete', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuids, dry_run = false, reason = 'Administrative purge via Tools portal' } = req.body as {
      gcuids: string[];
      dry_run?: boolean;
      reason?: string;
    };

    if (!Array.isArray(gcuids) || gcuids.length === 0) {
      return next(createError('gcuids must be a non-empty array', 400));
    }
    if (gcuids.length > 100) {
      return next(createError('Cannot delete more than 100 GCUIDs per request', 400));
    }
    // Basic format validation — accept any URN-prefixed identifier found in the registry
    for (const g of gcuids) {
      if (typeof g !== 'string' || !g.startsWith('urn:')) {
        return next(createError(`Invalid identifier (must start with urn:): ${g}`, 400));
      }
    }

    const summary: Record<string, { registry: Record<string, number>; connectors: Record<string, number>; not_found: boolean }> = {};

    const registryDb = reg();

    const execDelete = registryDb.transaction(() => {
      for (const gcuid of gcuids) {
        // Verify it exists first
        const exists = registryDb.prepare('SELECT 1 FROM identities WHERE gcuid = ?').get(gcuid);
        if (!exists) {
          summary[gcuid] = { registry: {}, connectors: {}, not_found: true };
          continue;
        }

        const registryChanges: Record<string, number> = {};
        for (const table of REGISTRY_DELETION_ORDER) {
          const cols = (registryDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
          const key = cols.includes('gcuid') ? 'gcuid' : cols.includes('identity_gcuid') ? 'identity_gcuid' : null;
          if (!key) continue;

          if (dry_run) {
            const { n } = registryDb.prepare(`SELECT COUNT(*) as n FROM ${table} WHERE ${key} = ?`).get(gcuid) as { n: number };
            if (n > 0) registryChanges[table] = n;
          } else {
            const result = registryDb.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(gcuid);
            if (result.changes > 0) registryChanges[table] = result.changes;
          }
        }

        // Connector DBs — NULL out gcuid fields rather than deleting person records
        const connectorChanges: Record<string, number> = {};
        let connectorDir: string;
        try { connectorDir = CONNECTORS_DIR; } catch { connectorDir = ''; }

        if (connectorDir && fs.existsSync(connectorDir)) {
          for (const file of fs.readdirSync(connectorDir)) {
            if (!file.endsWith('.db')) continue;
            const dbPath = path.join(connectorDir, file);
            try {
              const cdb = new Database(dbPath);
              const tables = (cdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
              let fileChanges = 0;
              for (const t of tables) {
                const cols = (cdb.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name);
                if (!cols.includes('gcuid')) continue;
                if (dry_run) {
                  const { n } = cdb.prepare(`SELECT COUNT(*) as n FROM ${t} WHERE gcuid = ?`).get(gcuid) as { n: number };
                  fileChanges += n;
                } else {
                  const updateCols = cols.includes('gcuid_state') ? 'gcuid = NULL, gcuid_state = NULL' : 'gcuid = NULL';
                  const result = cdb.prepare(`UPDATE ${t} SET ${updateCols} WHERE gcuid = ?`).run(gcuid);
                  fileChanges += result.changes;
                }
              }
              cdb.close();
              if (fileChanges > 0) connectorChanges[file.replace('.db', '')] = fileChanges;
            } catch {
              // Non-fatal: skip inaccessible connector DB
            }
          }
        }

        summary[gcuid] = { registry: registryChanges, connectors: connectorChanges, not_found: false };
      }
    });

    execDelete();

    res.json({
      success: true,
      data: {
        dry_run,
        reason: dry_run ? undefined : reason,
        deleted: gcuids.length,
        summary,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as toolsRoutes };
