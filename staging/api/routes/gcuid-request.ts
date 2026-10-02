/**
 * GCUID Request Routes
 * Provides a unified, source-agnostic API for portal pages to preview
 * CAES match results and then request a new GCUID (or link to an existing one).
 *
 * POST /api/gcuid-request/preview  — dry-run; returns match results + recommendation
 * POST /api/gcuid-request/submit   — creates provisional GCUID or links existing one
 */
import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { createError } from '../middleware/error.js';
import { readFlags } from './flags.js';
import { REGISTRY_DB_PATH as REGISTRY_DB, CONNECTORS_DIR, IS_EFS_MODE, connectorDbPath } from '../lib/db-paths.js';
import { connectorResolver } from '../lib/connector-resolver.js';
import { logRegistry } from '../lib/logging/logger.js';
import { REGISTRY_EVENTS } from '../lib/logging/log-events.js';
import { directScanSourcesAsync, findUnlinkedSourceRecords } from '../lib/source-scan.js';

const router = Router();

// ─── Source-system write-back config ─────────────────────────────────────────
// Describes how to write a GCUID back to each source connector DB after creation.
// 'entity_id' means the registry identity row uses entity_id = source_id (HR pattern).
// 'source_mapping_only' means we only create a source_mapping row (LDAP pattern).
// 'column' means we UPDATE a gcuid column in the connector's employees/users table.
type WriteBackStrategy =
  | { mode: 'column';              dbFile: string; table: string; keyCol: string; gcuidCol: string }
  | { mode: 'entity_id' }
  | { mode: 'source_mapping_only' };

// Connector DB paths resolved at module load time (EFS-aware via CONNECTORS_DIR)
const SOURCE_WRITE_BACK: Record<string, WriteBackStrategy> = {
  engineering: {
    mode:     'column',
    dbFile:   `${CONNECTORS_DIR}/conn-engineering.db`,
    table:    'employees',
    keyCol:   'dept_id',
    gcuidCol: 'gcuid',
  },
  finance: {
    mode:     'column',
    dbFile:   `${CONNECTORS_DIR}/conn-finance.db`,
    table:    'employees',
    keyCol:   'dept_id',
    gcuidCol: 'gcuid',
  },
  hr:   { mode: 'entity_id' },
  ldap: { mode: 'source_mapping_only' },
};

// ─── Connector scan config ────────────────────────────────────────────────────
// Used by the scan-linkages endpoint to search each connector DB for potential matches.
interface ConnectorScanConfig {
  dbFile:       string;
  table:        string;
  keyCol:       string;
  firstNameCol: string;
  lastNameCol:  string;
  emailCol:     string;
}

const CONNECTOR_SCAN: Record<string, ConnectorScanConfig> = {
  engineering: {
    dbFile:       `${CONNECTORS_DIR}/conn-engineering.db`,
    table:        'employees',
    keyCol:       'dept_id',
    firstNameCol: 'first_name',
    lastNameCol:  'last_name',
    emailCol:     'email',
  },
  finance: {
    dbFile:       `${CONNECTORS_DIR}/conn-finance.db`,
    table:        'employees',
    keyCol:       'dept_id',
    firstNameCol: 'first_name',
    lastNameCol:  'last_name',
    emailCol:     'email',
  },
  hr: {
    dbFile:       `${CONNECTORS_DIR}/conn-hr.db`,
    table:        'employees',
    keyCol:       'employee_id',
    firstNameCol: 'first_name',
    lastNameCol:  'last_name',
    emailCol:     'email',
  },
  ldap: {
    dbFile:       `${CONNECTORS_DIR}/conn-ldap.db`,
    table:        'users',
    keyCol:       'username',
    firstNameCol: 'first_name',
    lastNameCol:  'last_name',
    emailCol:     'email',
  },
};

// ─── GCUID generation (same logic as admin.ts) ────────────────────────────────

const CROCKFORD_ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const STD_B32_ALPHA   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateCore(coreIdType: 'ulid' | 'uuid', encoding: 'crockford' | 'standard'): string {
  const alpha = encoding === 'crockford' ? CROCKFORD_ALPHA : STD_B32_ALPHA;
  if (coreIdType === 'ulid') {
    const ms = Date.now();
    let t = ms;
    let tsChars = '';
    for (let i = 9; i >= 0; i--) {
      tsChars = CROCKFORD_ALPHA[t % 32] + tsChars;
      t = Math.floor(t / 32);
    }
    const rnd = crypto.randomBytes(10);
    let bits = 0n;
    for (const b of rnd) bits = (bits << 8n) | BigInt(b);
    let rndChars = '';
    for (let i = 15; i >= 0; i--) {
      rndChars = CROCKFORD_ALPHA[Number(bits % 32n)] + rndChars;
      bits >>= 5n;
    }
    const core = tsChars + rndChars;
    if (encoding === 'standard') {
      let val = 0n;
      for (const ch of core) val = val * 32n + BigInt(CROCKFORD_ALPHA.indexOf(ch));
      let result = '';
      for (let i = 25; i >= 0; i--) result = STD_B32_ALPHA[Number((val >> BigInt(i * 5)) & 31n)] + result;
      return result;
    }
    return core;
  } else {
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
}

function buildGCUID(format: 'v1' | 'v2', entityType: string, namespace: string, core: string): string {
  return format === 'v1'
    ? `urn:${namespace}:${entityType}:1:${core}`
    : `urn:gcuid:${core}`;
}

// ─── Registry lookup helpers ──────────────────────────────────────────────────

interface ExistingMatch {
  gcuid:      string;
  state:      string;
  match_basis: string;
  confidence: number;
}

function findExistingGcuidsByAttributes(
  attributes: Record<string, string>,
  sourceSystem: string,
  sourceId: string,
): ExistingMatch[] {
  const db = new Database(REGISTRY_DB, { readonly: true });
  const results: ExistingMatch[] = [];
  const seen = new Set<string>();

  try {
    // 1. Already linked via source_mapping
    const bySourceMap = db.prepare(
      'SELECT i.gcuid, i.state FROM identities i JOIN source_mappings sm ON sm.gcuid = i.gcuid WHERE sm.source_system = ? AND sm.source_id = ?'
    ).all(sourceSystem, sourceId) as { gcuid: string; state: string }[];
    for (const row of bySourceMap) {
      if (!seen.has(row.gcuid)) {
        seen.add(row.gcuid);
        results.push({ gcuid: row.gcuid, state: row.state, match_basis: 'source_mapping', confidence: 1.0 });
      }
    }

    // 2. Match by email alias
    if (attributes['email']) {
      const byEmail = db.prepare(
        `SELECT i.gcuid, i.state FROM identities i
         JOIN aliases a ON a.gcuid = i.gcuid
         WHERE a.alias_type = 'email' AND LOWER(a.alias_value) = LOWER(?) AND a.status = 'enabled'`
      ).all(attributes['email']) as { gcuid: string; state: string }[];
      for (const row of byEmail) {
        if (!seen.has(row.gcuid)) {
          seen.add(row.gcuid);
          results.push({ gcuid: row.gcuid, state: row.state, match_basis: 'email_alias', confidence: 0.95 });
        }
      }
    }

    // 3. Match by entity_id (HR employee_id etc.)
    if (attributes['entity_id']) {
      const byEntityId = db.prepare(
        'SELECT gcuid, state FROM identities WHERE entity_id = ?'
      ).all(attributes['entity_id']) as { gcuid: string; state: string }[];
      for (const row of byEntityId) {
        if (!seen.has(row.gcuid)) {
          seen.add(row.gcuid);
          results.push({ gcuid: row.gcuid, state: row.state, match_basis: 'entity_id', confidence: 0.95 });
        }
      }
    }
  } finally {
    db.close();
  }

  return results;
}

// ─── Flat-to-canonical attribute name translation ────────────────────────────
// Portal UIs send short/flat names (first_name, last_name, email).
// The CAES match engine requires canonical names (person.name.given, etc.).
const FLAT_TO_CANONICAL: Record<string, string> = {
  first_name: 'person.name.given',
  last_name:  'person.name.family',
  email:      'person.email',
  username:   'person.account.username',
};

function toCanonicalAttributes(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    out[FLAT_TO_CANONICAL[k] ?? k] = v;
  }
  return out;
}

// ─── Internal CAES match call ─────────────────────────────────────────────────

async function callCaesMatch(
  attributes: Record<string, string>,
  requestId: string,
): Promise<{ sourceSystem: string; sourceId: string; confidence: number; record: Record<string, any> }[]> {
  const port = process.env['PORT'] ?? '5182';
  try {
    const resp = await fetch(`http://localhost:${port}/api/caes/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify({ attributes }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const json = await resp.json() as { success: boolean; data?: { matches: any[] } };
    return json.success && json.data?.matches ? json.data.matches : [];
  } catch {
    return [];
  }
}

// ─── Recommendation logic ─────────────────────────────────────────────────────

function computeRecommendation(
  existingMatches: ExistingMatch[],
  caesMatches: { confidence: number }[],
  strong: number,
  weak: number,
  existingBehavior: 'propose_link' | 'always_create',
): 'link_existing_strong' | 'link_existing_weak' | 'create_strong' | 'create_weak' | 'create_no_match' {
  const bestExisting = existingMatches.reduce((m, r) => Math.max(m, r.confidence), 0);
  if (bestExisting >= strong && existingBehavior === 'propose_link') return 'link_existing_strong';
  if (bestExisting >= weak   && existingBehavior === 'propose_link') return 'link_existing_weak';

  const bestCaes = caesMatches.reduce((m, r) => Math.max(m, r.confidence), 0);
  if (bestCaes >= strong) return 'create_strong';
  if (bestCaes >= weak)   return 'create_weak';
  return 'create_no_match';
}

// ─── POST /api/gcuid-request/preview ─────────────────────────────────────────

router.post('/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { source_system, source_id, attributes } = req.body as {
      source_system: string;
      source_id:     string;
      attributes:    Record<string, string>;
    };

    if (!source_system || !source_id || !attributes || Object.keys(attributes).length === 0) {
      throw createError('source_system, source_id, and attributes are required', 400);
    }

    const flags      = readFlags().identityMatching;
    const strong     = flags.strongMatchThreshold;
    const weak       = flags.weakMatchThreshold;
    const behavior   = flags.existingGcuidBehavior;
    const requestId  = (req as any).requestId ?? crypto.randomUUID();

    const existingMatches = findExistingGcuidsByAttributes(attributes, source_system, source_id);
    const seen            = new Set(existingMatches.map(m => m.gcuid));

    // Translate flat attribute names to CAES canonical names before matching
    const canonicalAttrs = toCanonicalAttributes(attributes);
    const caesMatches    = await callCaesMatch(canonicalAttrs, requestId);

    // Cross-reference CAES source-record matches with source_mappings to find
    // already-issued GCUIDs linked to those source records (e.g. LDAP user who
    // shares name/email with an HR employee that already has a GCUID).
    if (caesMatches.length > 0) {
      const db = new Database(REGISTRY_DB, { readonly: true });
      try {
        for (const match of caesMatches) {
          const row = db.prepare(
            `SELECT i.gcuid, i.state
             FROM identities i
             JOIN source_mappings sm ON sm.gcuid = i.gcuid
             WHERE sm.source_system = ? AND sm.source_id = ?`
          ).get(match.sourceSystem, match.sourceId) as { gcuid: string; state: string } | undefined;
          if (row && !seen.has(row.gcuid)) {
            seen.add(row.gcuid);
            existingMatches.push({
              gcuid:       row.gcuid,
              state:       row.state,
              match_basis: 'caes_cross_source',
              confidence:  match.confidence,
            });
          }
        }
      } finally {
        db.close();
      }
    }

    const recommendation = computeRecommendation(existingMatches, caesMatches, strong, weak, behavior);

    res.json({
      success: true,
      data: {
        existing_gcuid_matches: existingMatches,
        caes_source_matches:    caesMatches,
        recommendation,
        thresholds: { strong, weak },
      },
    });
  } catch (error) { next(error); }
});

// ─── POST /api/gcuid-request/submit ──────────────────────────────────────────

router.post('/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      source_system,
      source_id,
      attributes,
      action,
      target_gcuid,
      reason,
    } = req.body as {
      source_system:  string;
      source_id:      string;
      attributes:     Record<string, string>;
      action:         'link_existing' | 'create_new';
      target_gcuid?:  string;
      reason?:        string;
    };

    if (!source_system || !source_id || !attributes || !action) {
      throw createError('source_system, source_id, attributes, and action are required', 400);
    }
    if (action === 'link_existing' && !target_gcuid) {
      throw createError('target_gcuid is required for link_existing action', 400);
    }

    const flags       = readFlags();
    const imFlags     = flags.identityMatching;
    const genFlags    = flags.gcuidGeneration;
    const writeBack   = imFlags.writeBackMode;
    const strong      = imFlags.strongMatchThreshold;
    const requestId   = (req as any).requestId ?? crypto.randomUUID();
    const now         = new Date().toISOString();

    const registryDb = new Database(REGISTRY_DB);
    let resultGcuid: string;
    let needsReview   = false;
    let actionTaken:  string;

    try {
      if (action === 'link_existing') {
        // ── Link to an existing GCUID ─────────────────────────────────────────
        const identity = registryDb.prepare('SELECT * FROM identities WHERE gcuid = ?').get(target_gcuid) as any;
        if (!identity) throw createError(`GCUID ${target_gcuid} not found`, 404);

        // Cross-identity uniqueness: the same (source_system, source_id) cannot
        // be linked to two different GCUIDs. Return a 409 to surface the conflict.
        const crossIdentity = registryDb.prepare(
          'SELECT gcuid FROM source_mappings WHERE source_system = ? AND source_id = ? AND gcuid != ?'
        ).get(source_system, source_id, target_gcuid);
        if (crossIdentity) {
          throw createError(
            `source_id "${source_id}" is already linked to a different GCUID under "${source_system}"`,
            409,
          );
        }

        // Per-identity uniqueness: only one mapping row per (gcuid, source_system).
        // If the same source_system is already mapped for this GCUID with a different
        // source_id (e.g. LDAP scan returned a DN instead of the username), UPDATE
        // the existing row rather than inserting a duplicate. Mirrors the
        // ON CONFLICT (gcuid, source_system) DO UPDATE semantics used by
        // POST /api/caes/match-and-link so the two code paths stay consistent.
        const sameSource = registryDb.prepare(
          'SELECT id FROM source_mappings WHERE gcuid = ? AND source_system = ?'
        ).get(target_gcuid, source_system) as { id: number } | undefined;
        if (sameSource) {
          registryDb.prepare(
            'UPDATE source_mappings SET source_id = ?, created_at = ? WHERE id = ?'
          ).run(source_id, now, sameSource.id);
        } else {
          registryDb.prepare(
            'INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, created_at) VALUES (?, ?, ?, 0, ?)'
          ).run(target_gcuid, source_system, source_id, now);
        }

        // Mirror the mapping into identities.metadata.matches so the right-pane
        // match summary stays in sync as new mappings form. Upsert by
        // (sourceSystem, sourceId): if the exact pair is present, no-op; if
        // the same sourceSystem has a different sourceId (e.g. LDAP scan
        // updated the username row to a DN), replace the sourceId of the
        // existing entry so we never carry two rows for one source system.
        const currentMeta = JSON.parse(identity.metadata || '{}');
        const existingMatches: any[] = Array.isArray(currentMeta.matches) ? currentMeta.matches : [];
        const sameSystemIndex = existingMatches.findIndex(
          (m: any) => m?.sourceSystem === source_system
        );
        const newEntry = {
          sourceSystem:         source_system,
          sourceId:             source_id,
          confidence:           1.0,
          strategyId:           'portal-link',
          strategyDescription:  'Confirmed via portal link_existing',
          matchedAttributes:    [],
        };
        if (sameSystemIndex >= 0) {
          const existing = existingMatches[sameSystemIndex];
          if (existing && existing.sourceId === source_id) {
            // No change needed
          } else {
            existingMatches[sameSystemIndex] = newEntry;
          }
        } else {
          existingMatches.push(newEntry);
        }
        const updatedMeta = { ...currentMeta, matches: existingMatches };
        registryDb.prepare(
          'UPDATE identities SET metadata = ?, updated_at = ? WHERE gcuid = ?'
        ).run(JSON.stringify(updatedMeta), now, target_gcuid);

        // ── Email alias generation ───────────────────────────────────────────
        // When the newly-linked source_system is authoritative for person.email
        // (per attribute_mappings.is_authoritative), fetch the email value via
        // the CAES connector resolver and write it as an `email` alias so the
        // GCUID can be looked up by that email even when no claim exists.
        //
        // Try each source_mapping row for (gcuid, source_system) — the resolver
        // keys connectors by their primary key field, which for LDAP is the DN
        // and for HR is the employee_id. A stale `username`-style LDAP row will
        // resolve to undefined; the live DN row will resolve cleanly.
        const emailMapping = registryDb.prepare(
          `SELECT source_field, source_table, key_field
           FROM attribute_mappings
           WHERE standard_attribute = 'person.email'
             AND source_system = ?
             AND is_authoritative = 1`
        ).get(source_system) as
          | { source_field: string; source_table: string; key_field: string }
          | undefined;

        if (emailMapping) {
          const candidateRows = registryDb.prepare(
            'SELECT source_id FROM source_mappings WHERE gcuid = ? AND source_system = ? ORDER BY id'
          ).all(target_gcuid, source_system) as { source_id: string }[];

          let resolvedEmail: string | undefined;
          for (const row of candidateRows) {
            const value = await connectorResolver.resolveAttribute(
              source_system,
              row.source_id,
              {
                sourceField:       emailMapping.source_field,
                sourceTable:       emailMapping.source_table,
                keyField:          emailMapping.key_field,
                standardAttribute: 'person.email',
              },
            ).catch(() => undefined);
            if (typeof value === 'string' && value.trim().length > 0) {
              resolvedEmail = value.trim();
              break;
            }
          }

          if (resolvedEmail) {
            // INSERT OR IGNORE on the (gcuid, alias_type, alias_value) unique index.
            registryDb.prepare(
              `INSERT OR IGNORE INTO aliases (gcuid, alias_type, alias_value, status, created_at)
               VALUES (?, 'email', ?, 'enabled', ?)`
            ).run(target_gcuid, resolvedEmail, now);
          }
        }

        // target_gcuid is guaranteed by the action === 'link_existing' guard at the top.
        resultGcuid = target_gcuid!;
        actionTaken = 'linked_to_existing';
        needsReview = identity.state !== 'active';

      } else {
        // ── Create new provisional GCUID ──────────────────────────────────────
        const coreId = generateCore(genFlags.coreIdType, genFlags.encoding);
        const gcuid  = buildGCUID(genFlags.format, 'person', 'gc', coreId);

        // Determine entity_id (HR looks up by entity_id in registry)
        const wb = SOURCE_WRITE_BACK[source_system];
        const entityId = (wb && wb.mode === 'entity_id') ? source_id : null;

        registryDb.prepare(
          `INSERT INTO identities (gcuid, state, identifier_state, entity_type, entity_id, namespace, created_at, updated_at, metadata)
           VALUES (?, 'provisional', 'reserved', 'person', ?, 'gc', ?, ?, ?)`
        ).run(gcuid, entityId, now, now, JSON.stringify({ requested_by: source_system, reason: reason ?? null }));

        registryDb.prepare(
          `INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
           VALUES (?, NULL, 'provisional', 'create', ?, ?, ?)`
        ).run(gcuid, reason ?? 'Requested from portal', source_system, now);

        registryDb.prepare(
          `INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
           VALUES (?, NULL, 'reserved', 'create', ?, ?, ?)`
        ).run(gcuid, source_system, reason ?? 'Requested from portal', now);

        // Source mapping
        registryDb.prepare(
          'INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, created_at) VALUES (?, ?, ?, 1, ?)'
        ).run(gcuid, source_system, source_id, now);

        resultGcuid = gcuid;
        actionTaken = 'created_provisional';

        // Determine if this needs admin review (no strong CAES match = manual review)
        const caesMatches = await callCaesMatch(attributes, requestId);
        const bestCaes    = caesMatches.reduce((m, r) => Math.max(m, r.confidence), 0);
        needsReview = bestCaes < strong;
      }

      registryDb.close();

      // ── Write-back to source connector DB ─────────────────────────────────
      // Per architecture requirements (R2, R5): the GCUID/CAES system must
      // write to source systems via the connector abstraction, not by opening
      // the connector's database directly. Try the connector HTTP PATCH path
      // first; fall back to a direct SQLite write only when the connector
      // does not implement updateRecord (501) or in EFS mode where no HTTP
      // sidecar is running. The fallback is logged so the team can see when
      // a connector needs to implement updateRecord.
      if (writeBack === 'immediate') {
        const wb = SOURCE_WRITE_BACK[source_system];
        if (wb && wb.mode === 'column') {
          try {
            await connectorResolver.updateAttribute(source_system, source_id, wb.gcuidCol, resultGcuid);
          } catch (err) {
            const msg = (err as Error).message;
            console.warn(
              `[gcuid-request] Connector HTTP write-back to ${source_system} failed ` +
              `(${msg}); falling back to direct SQLite write. ` +
              `Implement updateRecord in this connector to remove the fallback.`
            );
            try {
              // Resolve connector_id from source_systems so we use the same
              // path-naming convention as the connector-resolver (db file is
              // named after connector_id, not source_system).
              const lookupDb = new Database(REGISTRY_DB, { readonly: true });
              const sysRow = lookupDb.prepare(
                'SELECT connector_id FROM source_systems WHERE system_id = ?'
              ).get(source_system) as { connector_id: string | null } | undefined;
              lookupDb.close();
              const connDbPath = sysRow?.connector_id
                ? connectorDbPath(sysRow.connector_id)
                : connectorDbPath(source_system);
              const connDb = new Database(connDbPath);
              connDb.prepare(`UPDATE ${wb.table} SET ${wb.gcuidCol} = ? WHERE ${wb.keyCol} = ?`)
                .run(resultGcuid, source_id);
              connDb.close();
            } catch (err2) {
              console.error(`[gcuid-request] Direct SQLite fallback write to ${source_system} also failed:`, (err2 as Error).message);
              // Non-fatal — GCUID was created; write-back failure is logged only
            }
          }
        }
        // entity_id and source_mapping_only modes: registry already has the correct data
      }

      logRegistry('notice', REGISTRY_EVENTS.IDENTITY_CREATED, {
        component:      'api:gcuid-request',
        gcuid:          resultGcuid,
        actor_id:       source_system,
        actor_type:     'connector',
        transaction_id: requestId,
        request_id:     requestId,
      });

      res.status(201).json({
        success: true,
        data: {
          gcuid:        resultGcuid,
          action_taken: actionTaken,
          needs_review: needsReview,
          write_back:   writeBack,
        },
      });

    } catch (err) {
      try { registryDb.close(); } catch { /* already closed */ }
      throw err;
    }

  } catch (error) { next(error); }
});

// ─── POST /api/gcuid-request/scan-linkages ────────────────────────────────────
// Uses CAES matching to find unlinked source records that attribute-match
// this identity (i.e. the same person exists in a connector DB but no
// source_mappings row has been created yet).
//
// Flow:
//   1. Resolve identity + existing source_mappings from registry DB
//   2. Gather known attributes (first_name / last_name / email) from already-
//      mapped connector DBs so we have something to search with
//   3. Convert to CAES standard attribute names and call callCaesMatch()
//   4. Filter out any CAES results that are already in source_mappings
//   5. Return the remaining results as linkage candidates

router.post('/scan-linkages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.body as { gcuid?: string };
    if (!gcuid?.trim()) throw createError('gcuid is required', 400);

    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    const identity = registryDb.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) {
      registryDb.close();
      throw createError(`Identity ${gcuid} not found`, 404);
    }
    const existingMappings = registryDb.prepare(
      'SELECT source_system, source_id FROM source_mappings WHERE gcuid = ?'
    ).all(gcuid) as Array<{ source_system: string; source_id: string }>;
    registryDb.close();

    // Build a set of "already linked" source_system:source_id pairs to filter CAES results
    const alreadyLinked = new Set(existingMappings.map(m => `${m.source_system}:${m.source_id}`));

    // LDAP records can be referenced by either `username` or `distinguished_name`
    // (the connector's recordId is the DN; some portal flows write source_mappings
    // keyed by username). Both forms identify the same `conn-ldap.db` row, so
    // the scan paths returning one form should not re-surface a record that's
    // already linked under the other. Surface both identifier forms in the
    // dedup set so "Scan for Matches" doesn't offer the same person twice.
    const ldapCfg = CONNECTOR_SCAN['ldap'];
    if (ldapCfg) {
      try {
        const ldapDb = new Database(ldapCfg.dbFile, { readonly: true });
        for (const m of existingMappings) {
          if (m.source_system !== 'ldap') continue;
          // Look up the LDAP row by either identifier form — `keyCol` is
          // `username`, but source_mappings may legitimately store either
          // `username` or `distinguished_name` depending on which flow
          // created the mapping.
          const row = ldapDb.prepare(
            `SELECT username, distinguished_name FROM ${ldapCfg.table} WHERE ${ldapCfg.keyCol} = ? OR distinguished_name = ? LIMIT 1`
          ).get(m.source_id, m.source_id) as { username?: string; distinguished_name?: string } | undefined;
          if (row?.username             && row.username             !== m.source_id) alreadyLinked.add(`ldap:${row.username}`);
          if (row?.distinguished_name  && row.distinguished_name  !== m.source_id) alreadyLinked.add(`ldap:${row.distinguished_name}`);
        }
        ldapDb.close();
      } catch { /* LDAP DB unavailable — skip alternate-ID enrichment */ }
    }

    // ── Step 1: Gather known attributes from already-mapped connector DBs ─────
    let firstName = '';
    let lastName  = '';
    let email     = '';

    for (const mapping of existingMappings) {
      const cfg = CONNECTOR_SCAN[mapping.source_system];
      if (!cfg) continue;
      try {
        const connDb = new Database(cfg.dbFile, { readonly: true });
        const row = connDb.prepare(
          `SELECT ${cfg.firstNameCol}, ${cfg.lastNameCol}, ${cfg.emailCol}
           FROM ${cfg.table} WHERE ${cfg.keyCol} = ?`
        ).get(mapping.source_id) as any;
        connDb.close();
        if (row) {
          if (!firstName && row[cfg.firstNameCol]) firstName = String(row[cfg.firstNameCol]);
          if (!lastName  && row[cfg.lastNameCol])  lastName  = String(row[cfg.lastNameCol]);
          if (!email     && row[cfg.emailCol])     email     = String(row[cfg.emailCol]);
        }
      } catch { /* connector DB unavailable — skip */ }
    }

    // Fallback: parse attributes from identity.metadata (self-registered identities
    // store first_name / last_name / email here; no source_mappings exist yet)
    if (!firstName || !lastName || !email) {
      try {
        const meta = identity.metadata ? JSON.parse(identity.metadata) : {};
        if (!firstName && meta.first_name) firstName = String(meta.first_name);
        if (!lastName  && meta.last_name)  lastName  = String(meta.last_name);
        if (!email     && meta.email)      email     = String(meta.email);
      } catch { /* malformed metadata — skip */ }
    }

    // Fallback: entity_id that looks like an email (self-service stores email as entity_id)
    if (!email && identity.entity_id?.includes('@')) {
      email = String(identity.entity_id);
    }

    // Fallback: HR-style identity where entity_id === employee_id
    if (identity.entity_id && (!firstName || !lastName) && CONNECTOR_SCAN['hr']) {
      try {
        const cfg = CONNECTOR_SCAN['hr'];
        const connDb = new Database(cfg.dbFile, { readonly: true });
        const row = connDb.prepare(
          `SELECT ${cfg.firstNameCol}, ${cfg.lastNameCol}, ${cfg.emailCol}
           FROM ${cfg.table} WHERE ${cfg.keyCol} = ?`
        ).get(identity.entity_id) as any;
        connDb.close();
        if (row) {
          if (!firstName) firstName = String(row[cfg.firstNameCol] ?? '');
          if (!lastName)  lastName  = String(row[cfg.lastNameCol]  ?? '');
          if (!email)     email     = String(row[cfg.emailCol]     ?? '');
        }
      } catch { /* skip */ }
    }

    const attributesUsed = {
      first_name: firstName || null,
      last_name:  lastName  || null,
      email:      email     || null,
    };

    // ── Step 2: Build CAES standard-attribute map and call the matcher ─────────
    const caesAttributes: Record<string, string> = {};
    if (firstName)           caesAttributes['person.name.given']  = firstName;
    if (lastName)            caesAttributes['person.name.family'] = lastName;
    if (email)               caesAttributes['person.email']       = email;
    if (identity.entity_id)  caesAttributes['person.employment.employee_id'] = String(identity.entity_id);

    const candidates: Array<{
      source_system: string;
      source_id:     string;
      first_name:    string;
      last_name:     string;
      email:         string;
      match_score:   number;
      match_reasons: string[];
    }> = [];

    if (Object.keys(caesAttributes).length > 0) {
      const requestId = req.headers['x-request-id'] as string ?? `scan-${gcuid}`;
      const caesMatches = await callCaesMatch(caesAttributes, requestId);

      for (const match of caesMatches) {
        const key = `${match.sourceSystem}:${match.sourceId}`;
        if (alreadyLinked.has(key)) continue;

        // Extract display fields from the CAES record (raw connector row)
        const cfg = CONNECTOR_SCAN[match.sourceSystem];
        const rec = match.record ?? {};
        const recFirstName = cfg ? String(rec[cfg.firstNameCol] ?? '') : '';
        const recLastName  = cfg ? String(rec[cfg.lastNameCol]  ?? '') : '';
        const recEmail     = cfg ? String(rec[cfg.emailCol]     ?? '') : '';

        candidates.push({
          source_system: match.sourceSystem,
          source_id:     match.sourceId,
          first_name:    recFirstName,
          last_name:     recLastName,
          email:         recEmail,
          match_score:   match.confidence,
          match_reasons: (match as any).matchedAttributes ?? [],
        });
      }
    }

    // ── Step 3: Direct connector-DB scan (via live connector abstraction) ────
    // Augment CAES results with a connector-aware scan.  When the per-connector
    // HTTP service is up, the scan goes THROUGH the connector
    // (ConnectorAPIClient.search) — same call CAES uses.  When the connector
    // sidecar is unreachable (EFS / Lambda mode), it falls back to direct
    // SQLite queries against each connector's `conn-*.db` file.
    let directMatches: Awaited<ReturnType<typeof directScanSourcesAsync>> = [];
    try {
      directMatches = await directScanSourcesAsync({
        first_name: firstName,
        last_name:  lastName,
        email:      email,
      });
    } catch {
      directMatches = [];
    }

    const seenCandidateKeys = new Set(candidates.map(c => `${c.source_system}:${c.source_id}`));
    for (const dm of directMatches) {
      const key = `${dm.sourceSystem}:${dm.sourceId}`;
      if (alreadyLinked.has(key) || seenCandidateKeys.has(key)) continue;
      seenCandidateKeys.add(key);

      const rec = dm.record ?? {};
      candidates.push({
        source_system: dm.sourceSystem,
        source_id:     dm.sourceId,
        first_name:    String(rec['first_name'] ?? rec['given_name'] ?? ''),
        last_name:     String(rec['last_name']  ?? rec['surname']    ?? ''),
        email:         String(rec['email']      ?? rec['mail']       ?? ''),
        match_score:   dm.confidence,
        match_reasons: dm.matchedAttributes ?? [],
      });
    }

    // ── Step 4: Unlinked source-record scan ────────────────────────────────
    // Find connector DB rows (HR / LDAP / Engineering / Finance) that are not
    // yet linked to ANY GCUID but match the attributes of this identity on
    // email or name. This is the critical path for the GCUID Registry "scan
    // for matches" view when a self-registered identity was created without
    // any identity_proofs — the admin can then pick the right existing
    // record to bind to the pending GCUID.
    //
    // `alreadyLinked` here includes rows from BOTH existingMappings and
    // already-pushed candidates so we never surface duplicates.
    let unlinkedRecords: ReturnType<typeof findUnlinkedSourceRecords> = [];
    try {
      const linkedForUnlinkedScan = new Set<string>([
        ...alreadyLinked,
        ...seenCandidateKeys,
      ]);
      unlinkedRecords = findUnlinkedSourceRecords(
        {
          first_name: firstName,
          last_name:  lastName,
          email:      email,
        },
        linkedForUnlinkedScan,
      );
    } catch {
      unlinkedRecords = [];
    }

    for (const rec of unlinkedRecords) {
      const key = `${rec.sourceSystem}:${rec.sourceId}`;
      if (seenCandidateKeys.has(key)) continue;
      seenCandidateKeys.add(key);

      // Unlinked records don't have a confidence score from CAES — pick a
      // reasonable default of 0.85 (email match) or 0.55 (name-only match)
      // based on the reason string so the UI can still rank them.
      const match_score = rec.reason.includes('email') ? 0.85
                        : rec.reason.includes('name')  ? 0.55
                        : 0.40;

      candidates.push({
        source_system: rec.sourceSystem,
        source_id:     rec.sourceId,
        first_name:    rec.first_name,
        last_name:     rec.last_name,
        email:         rec.email,
        match_score,
        match_reasons: [rec.reason],
      });
    }

    candidates.sort((a, b) => b.match_score - a.match_score);

    res.json({
      success: true,
      data: { gcuid, attributes_used: attributesUsed, candidates },
    });
  } catch (error) { next(error); }
});

export { router as gcuidRequestRoutes };
