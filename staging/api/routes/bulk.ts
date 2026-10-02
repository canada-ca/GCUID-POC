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
 * Bulk Operations API Routes
 *
 * 7.5.1  POST /api/bulk/import  — Batch identity import (migration / backfill)
 * 7.5.2  GET  /api/bulk/export  — Scoped, privacy-preserving identity export
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { createError } from '../middleware/error.js';
import { readFlags } from './flags.js';
import { logRegistry } from '../lib/logging/logger.js';
import { REGISTRY_EVENTS } from '../lib/logging/log-events.js';

import { REGISTRY_DB_PATH as REGISTRY_DB } from '../lib/db-paths.js';

const router = Router();

// ─── GCUID generation (duplicated from admin.ts — no shared module yet) ───────
const CROCKFORD_ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const STD_B32_ALPHA   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateCore(coreIdType: 'ulid' | 'uuid', encoding: 'crockford' | 'standard'): string {
  const alpha = encoding === 'crockford' ? CROCKFORD_ALPHA : STD_B32_ALPHA;
  if (coreIdType === 'ulid') {
    const ms = Date.now();
    let t = ms;
    let tsChars = '';
    for (let i = 9; i >= 0; i--) { tsChars = CROCKFORD_ALPHA[t % 32] + tsChars; t = Math.floor(t / 32); }
    const rnd = crypto.randomBytes(10);
    let bits = 0n;
    for (const b of rnd) bits = (bits << 8n) | BigInt(b);
    let rndChars = '';
    for (let i = 15; i >= 0; i--) { rndChars = CROCKFORD_ALPHA[Number(bits % 32n)] + rndChars; bits >>= 5n; }
    const core = tsChars + rndChars;
    if (encoding === 'standard') {
      let val = 0n;
      for (const ch of core) val = val * 32n + BigInt(CROCKFORD_ALPHA.indexOf(ch));
      let result = '';
      for (let i = 25; i >= 0; i--) result = STD_B32_ALPHA[Number((val >> BigInt(i * 5)) & 31n)] + result;
      return result;
    }
    return core;
  }
  // UUID v4
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let val = 0n;
  for (const b of bytes) val = (val << 8n) | BigInt(b);
  val = val << 2n;
  let result = '';
  for (let i = 25; i >= 0; i--) result = alpha[Number((val >> BigInt(i * 5)) & 31n)] + result;
  return result;
}

function buildGCUID(format: 'v1' | 'v2', entityType: string, namespace: string, core: string): string {
  return format === 'v1'
    ? `urn:${namespace}:uid:${entityType}:1:${core}`
    : `urn:gcuid:${core}`;
}

// ─── Anonymisation helper ──────────────────────────────────────────────────────
/** One-way pseudonymise a value so it is consistent within a single export
 *  but cannot be reversed to the original. */
function pseudonymise(value: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(value).digest('hex').slice(0, 16);
}

// ─── 7.5.1 Batch Import ───────────────────────────────────────────────────────

interface ImportRecord {
  entity_type?: string;
  entity_id?: string;
  namespace?: string;
  metadata?: Record<string, any>;
  source_links?: Array<{ source_system: string; source_id: string; is_primary?: boolean }>;
  /** Override the initial identity state. Defaults to 'provisional'. */
  initial_state?: 'provisional' | 'active';
}

/**
 * POST /api/bulk/import
 *
 * Process a large batch of legacy identities through the correlation engine.
 * Each record is registered independently (partial success is allowed — errors
 * in one row do not roll back other rows).  Records that would create duplicates
 * (by entity_id or source_id) are individually rejected with a clear reason.
 *
 * Body: {
 *   records:        ImportRecord[],   // 1–500 per request
 *   format?:        'v1' | 'v2',
 *   core_id_type?:  'ulid' | 'uuid',
 *   encoding?:      'crockford' | 'standard',
 *   generate_aliases?: boolean        // auto-generate a GC-A alias per record
 * }
 *
 * Response: {
 *   accepted:  number,
 *   rejected:  number,
 *   total:     number,
 *   results:   Array<{ index, status: 'created'|'rejected', gcuid?, state?, error? }>
 * }
 */
router.post('/import', (req: Request, res: Response, next: NextFunction) => {
  try {
    const MAX_BATCH = 500;
    const {
      records,
      format,
      core_id_type,
      encoding,
      generate_aliases = false,
    } = req.body as {
      records?: unknown[];
      format?: 'v1' | 'v2';
      core_id_type?: 'ulid' | 'uuid';
      encoding?: 'crockford' | 'standard';
      generate_aliases?: boolean;
    };

    if (!Array.isArray(records) || records.length === 0) {
      throw createError('"records" must be a non-empty array', 400);
    }
    if (records.length > MAX_BATCH) {
      throw createError(`Batch size ${records.length} exceeds the maximum of ${MAX_BATCH} per request`, 400);
    }

    const VALID_TYPES = ['person', 'org', 'asset', 'app', 'agent'];
    const sysGen = readFlags().gcuidGeneration;
    const resolvedFormat   = (['v1', 'v2'].includes(format ?? ''))     ? format!     : sysGen.format      as 'v1' | 'v2';
    const resolvedCoreType = (['ulid', 'uuid'].includes(core_id_type ?? '')) ? core_id_type! : sysGen.coreIdType as 'ulid' | 'uuid';
    const resolvedEncoding = (['crockford', 'standard'].includes(encoding ?? '')) ? encoding!   : sysGen.encoding  as 'crockford' | 'standard';

    const db = new Database(REGISTRY_DB);

    // Prepare statements once for performance
    const stmtEntityConflict  = db.prepare('SELECT gcuid FROM identities WHERE entity_id = ?');
    const stmtSourceConflict  = db.prepare('SELECT gcuid FROM source_mappings WHERE source_system = ? AND source_id = ?');
    const stmtInsertIdentity  = db.prepare(
      `INSERT INTO identities (gcuid, state, identifier_state, entity_type, entity_id, namespace, created_at, updated_at, metadata)
       VALUES (?, ?, 'reserved', ?, ?, ?, ?, ?, ?)`
    );
    const stmtInsertStateHist = db.prepare(
      `INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
       VALUES (?, NULL, ?, 'import', 'Bulk import', 'bulk-api', ?)`
    );
    const stmtInsertIdHist    = db.prepare(
      `INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
       VALUES (?, NULL, 'reserved', 'import', 'bulk-api', 'Bulk import', ?)`
    );
    const stmtInsertMapping   = db.prepare(
      `INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    const stmtInsertAlias     = db.prepare(
      `INSERT OR IGNORE INTO aliases (gcuid, alias_type, alias_value, created_at) VALUES (?, ?, ?, ?)`
    );

    type Result =
      | { index: number; status: 'created'; gcuid: string; state: string }
      | { index: number; status: 'rejected'; error: string };

    const results: Result[] = [];
    let accepted = 0;
    let rejected = 0;

    for (let i = 0; i < records.length; i++) {
      const raw = records[i] as ImportRecord;

      // ── Per-row validation ────────────────────────────────────────────────
      if (!raw.entity_type || !VALID_TYPES.includes(raw.entity_type)) {
        results.push({ index: i, status: 'rejected', error: `entity_type must be one of: ${VALID_TYPES.join(', ')}` });
        rejected++;
        continue;
      }

      const sourceLinks = raw.source_links ?? [];
      let rowError: string | null = null;

      if (raw.entity_id?.trim()) {
        if (stmtEntityConflict.get(raw.entity_id.trim())) {
          rowError = `entity_id "${raw.entity_id.trim()}" is already registered`;
        }
      }

      if (!rowError) {
        for (const link of sourceLinks) {
          if (!link.source_system?.trim() || !link.source_id?.trim()) {
            rowError = 'Each source_link must have source_system and source_id';
            break;
          }
          const conflict = stmtSourceConflict.get(link.source_system.trim(), link.source_id.trim());
          if (conflict) {
            rowError = `source_id "${link.source_id}" in "${link.source_system}" is already linked to another GCUID`;
            break;
          }
        }
      }

      if (rowError) {
        results.push({ index: i, status: 'rejected', error: rowError });
        rejected++;
        continue;
      }

      // ── Mint GCUID and write to DB ────────────────────────────────────────
      try {
        const coreId    = generateCore(resolvedCoreType, resolvedEncoding);
        const gcuid     = buildGCUID(resolvedFormat, raw.entity_type, raw.namespace?.trim() || 'gc', coreId);
        const now       = new Date().toISOString();
        const state     = raw.initial_state === 'active' ? 'active' : 'provisional';
        const metaStr   = raw.metadata ? JSON.stringify(raw.metadata) : null;
        const namespace = raw.namespace?.trim() || 'gc';

        stmtInsertIdentity.run(gcuid, state, raw.entity_type, raw.entity_id?.trim() ?? null, namespace, now, now, metaStr);
        stmtInsertStateHist.run(gcuid, state, now);
        stmtInsertIdHist.run(gcuid, now);

        for (const link of sourceLinks) {
          stmtInsertMapping.run(gcuid, link.source_system.trim(), link.source_id.trim(), link.is_primary ? 1 : 0, now);
        }

        if (generate_aliases) {
          // Derive the Crockford core for alias generation regardless of encoding
          const aliasCore = resolvedFormat === 'v2'
            ? gcuid.replace('urn:gcuid:', '')
            : gcuid.split(':')[5] ?? coreId;
          const CHECKSUM_ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          const hash = crypto.createHash('sha256').update(aliasCore.toUpperCase().replace(/-/g, '')).digest();
          let bits = '';
          for (const byte of hash.slice(0, 8)) bits += byte.toString(2).padStart(8, '0');
          let h = '';
          for (let b = 0; b < 60; b += 5) h += CROCKFORD_ALPHA[parseInt(bits.slice(b, b + 5), 2)];
          h = h.slice(0, 12);
          const hf = `${h.slice(0,4)}-${h.slice(4,8)}-${h.slice(8,12)}`;
          const norm = `GCA${h}`.toUpperCase().replace(/-/g, '');
          let c = 37;
          for (const ch of norm) { const v = CHECKSUM_ALPHA.indexOf(ch); c = ((c + v) * 2) % 37; }
          const checksum = CHECKSUM_ALPHA[((37 - c + 1) % 37) % CHECKSUM_ALPHA.length];
          stmtInsertAlias.run(gcuid, 'GC-A', `GC-A-${hf}-${checksum}`, now);
        }

        results.push({ index: i, status: 'created', gcuid, state });
        accepted++;
      } catch (rowErr: any) {
        results.push({ index: i, status: 'rejected', error: rowErr.message ?? 'Unknown error' });
        rejected++;
      }
    }

    db.close();

    logRegistry('notice', REGISTRY_EVENTS.ADMIN_BULK_ACTION, {
      component:  'api:bulk',
      actor_id:   (req.ip ?? 'system'),
      actor_type: 'admin',
      context:    JSON.stringify({ action: 'import', total: records.length, accepted, rejected }),
      request_id: (req as any).requestId,
    });

    res.status(accepted > 0 ? 207 : 400).json({
      success: accepted > 0,
      data: {
        accepted,
        rejected,
        total: records.length,
        results,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── 7.5.2 Scoped Export ──────────────────────────────────────────────────────

/**
 * GET /api/bulk/export
 *
 * Produce a filtered, privacy-preserving snapshot of the identity registry for
 * enterprise reporting.  Supports scoping by state, entity_type, namespace,
 * and date range.  When anonymize=true, all PII fields are replaced with
 * deterministic pseudonyms (HMAC-SHA256) that are consistent within a single
 * export response but cannot be reversed.
 *
 * Query params:
 *   state?        — filter by identity state (provisional, active, suspended, retired, archived)
 *   entity_type?  — filter by entity type (person, org, asset, app, agent)
 *   namespace?    — filter by namespace (default: all)
 *   from?         — ISO 8601 lower bound on created_at
 *   to?           — ISO 8601 upper bound on created_at
 *   anonymize?    — 'true' | 'false' (default false)
 *   limit?        — max rows (default 1000, max 10000)
 *   offset?       — pagination offset (default 0)
 *
 * Response: {
 *   export_id, generated_at, filters_applied, anonymized,
 *   metrics: { total_count, by_state, by_entity_type, coverage_rate, source_mapping_count },
 *   identities: [...]
 * }
 */
router.get('/export', (req: Request, res: Response, next: NextFunction) => {
  try {
    const MAX_LIMIT = 10_000;
    const {
      state,
      entity_type,
      namespace,
      from,
      to,
      anonymize = 'false',
      limit:  limitStr  = '1000',
      offset: offsetStr = '0',
    } = req.query as Record<string, string>;

    const doAnonymize = anonymize === 'true';
    const limit  = Math.min(parseInt(limitStr,  10) || 1000, MAX_LIMIT);
    const offset = Math.max(parseInt(offsetStr, 10) || 0, 0);

    // Build dynamic WHERE clause
    const conditions: string[] = [];
    const params: any[]        = [];

    if (state)       { conditions.push('i.state = ?');       params.push(state);       }
    if (entity_type) { conditions.push('i.entity_type = ?'); params.push(entity_type); }
    if (namespace)   { conditions.push('i.namespace = ?');   params.push(namespace);   }
    if (from)        { conditions.push('i.created_at >= ?'); params.push(from);        }
    if (to)          { conditions.push('i.created_at <= ?'); params.push(to);          }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const db = new Database(REGISTRY_DB, { readonly: true });

    // Filtered identity rows
    const rows = db.prepare(`
      SELECT i.gcuid, i.state, i.identifier_state, i.entity_type, i.entity_id,
             i.namespace, i.created_at, i.updated_at, i.metadata,
             i.superseded_by,
             (SELECT COUNT(*) FROM source_mappings sm WHERE sm.gcuid = i.gcuid) AS mapping_count,
             (SELECT COUNT(*) FROM aliases a WHERE a.gcuid = i.gcuid) AS alias_count
      FROM identities i
      ${where}
      ORDER BY i.created_at ASC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    // Aggregate metrics over the FULL filtered set (no pagination)
    const totalCount = (db.prepare(`
      SELECT COUNT(*) AS n FROM identities i ${where}
    `).get(...params) as any).n as number;

    const byState = db.prepare(`
      SELECT state, COUNT(*) AS n FROM identities i ${where} GROUP BY state
    `).all(...params) as Array<{ state: string; n: number }>;

    const byEntityType = db.prepare(`
      SELECT entity_type, COUNT(*) AS n FROM identities i ${where} GROUP BY entity_type
    `).all(...params) as Array<{ entity_type: string; n: number }>;

    const withMappings = (db.prepare(`
      SELECT COUNT(DISTINCT sm.gcuid) AS n
      FROM source_mappings sm
      INNER JOIN identities i ON i.gcuid = sm.gcuid
      ${where}
    `).get(...params) as any).n as number;

    const totalMappings = (db.prepare(`
      SELECT COUNT(*) AS n
      FROM source_mappings sm
      INNER JOIN identities i ON i.gcuid = sm.gcuid
      ${where}
    `).get(...params) as any).n as number;

    db.close();

    // ── Anonymisation ─────────────────────────────────────────────────────
    // One-time salt per export — consistent pseudonyms within the response
    const exportSalt = doAnonymize ? crypto.randomBytes(16).toString('hex') : '';
    const exportId   = crypto.randomUUID();

    const identities = rows.map((row: any) => {
      let metadata: any = null;
      try { metadata = row.metadata ? JSON.parse(row.metadata) : null; } catch { /* leave null */ }

      if (doAnonymize) {
        return {
          gcuid:            row.gcuid, // GCUID is not PII — it is the canonical identifier
          state:            row.state,
          identifier_state: row.identifier_state,
          entity_type:      row.entity_type,
          entity_id:        row.entity_id ? pseudonymise(row.entity_id, exportSalt) : null,
          namespace:        row.namespace,
          created_at:       row.created_at,
          updated_at:       row.updated_at,
          superseded_by:    row.superseded_by ?? null,
          mapping_count:    row.mapping_count,
          alias_count:      row.alias_count,
          metadata:         null, // strip all metadata fields in anonymised exports
        };
      }

      return {
        gcuid:            row.gcuid,
        state:            row.state,
        identifier_state: row.identifier_state,
        entity_type:      row.entity_type,
        entity_id:        row.entity_id ?? null,
        namespace:        row.namespace,
        created_at:       row.created_at,
        updated_at:       row.updated_at,
        superseded_by:    row.superseded_by ?? null,
        mapping_count:    row.mapping_count,
        alias_count:      row.alias_count,
        metadata,
      };
    });

    const filtersApplied: Record<string, string> = {};
    if (state)       filtersApplied.state       = state;
    if (entity_type) filtersApplied.entity_type = entity_type;
    if (namespace)   filtersApplied.namespace   = namespace;
    if (from)        filtersApplied.from        = from;
    if (to)          filtersApplied.to          = to;

    logRegistry('notice', REGISTRY_EVENTS.ADMIN_BULK_ACTION, {
      component:  'api:bulk',
      actor_id:   (req.ip ?? 'system'),
      actor_type: 'admin',
      context:    JSON.stringify({ action: 'export', filters: filtersApplied, anonymize: doAnonymize, limit, offset, total: totalCount }),
      request_id: (req as any).requestId,
    });

    res.json({
      success: true,
      data: {
        export_id:       exportId,
        generated_at:    new Date().toISOString(),
        anonymized:      doAnonymize,
        filters_applied: filtersApplied,
        pagination: {
          limit,
          offset,
          returned: identities.length,
          total_matching: totalCount,
          has_more: offset + identities.length < totalCount,
        },
        metrics: {
          total_count:          totalCount,
          coverage_rate:        totalCount > 0 ? parseFloat((withMappings / totalCount).toFixed(4)) : 0,
          source_mapping_count: totalMappings,
          by_state:             Object.fromEntries(byState.map(r => [r.state, r.n])),
          by_entity_type:       Object.fromEntries(byEntityType.map(r => [r.entity_type, r.n])),
        },
        identities,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { router as bulkRoutes };
