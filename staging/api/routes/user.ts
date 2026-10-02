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
 * User API Routes
 * 
 * End user endpoints for identity lookup and verification
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { createError } from '../middleware/error.js';
import { readFlags } from './flags.js';
import { logRegistry, logLDAP } from '../lib/logging/logger.js';
import { REGISTRY_EVENTS, LDAP_EVENTS } from '../lib/logging/log-events.js';
import { resolveToGcuid } from '../lib/resolve-identifier.js';
import { ConnectorResolver } from '../lib/connector-resolver.js';
import { directScanSourcesAsync } from '../lib/source-scan.js';

const router = Router();
const REGISTRY_DB = './data/registry.db';
const HR_DB_PATH = './data/sources/conn-hr.db';
const LDAP_DB_PATH = './data/sources/conn-ldap.db';

const connectorResolver = new ConnectorResolver();

// ─── Alias param resolution ───────────────────────────────────────────────────
// When aliases are enabled in Options, :gcuid path params are transparently
// resolved from alias value → canonical GCUID before the route handler runs.
// The /lookup/:id route uses :id (not :gcuid) and has its own alias logic.
router.param('gcuid', (_req: Request, _res: Response, next: NextFunction, value: string) => {
  _req.params.gcuid = resolveToGcuid(value);
  next();
});

/**
 * Helper: Get aliases for a GCUID — respects feature flags.
 * Omits custom aliases when aliases.userSelected is off.
 * Omits GC-* aliases when aliases.generated is off.
 */
function getAliases(db: Database.Database, gcuid: string): Array<{alias_type: string, alias_value: string}> {
  try {
    let rows = db.prepare(
      'SELECT alias_type, alias_value FROM aliases WHERE gcuid = ?'
    ).all(gcuid) as Array<{alias_type: string, alias_value: string}>;
    const flags = readFlags();
    if (!flags.aliases.userSelected) {
      rows = rows.filter((a) => a.alias_type !== 'custom');
    }
    if (!flags.aliases.generated) {
      rows = rows.filter((a) => !String(a.alias_type ?? '').startsWith('GC-'));
    }
    if (!flags.aliases.email) {
      rows = rows.filter((a) => a.alias_type !== 'email');
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * GET /api/user/lookup/:id
 *
 * Resolve an identifier to a canonical identity record.
 *
 * Accepts three input shapes via the `:id` path param:
 *
 * 1. A raw GCUID (URN-formatted) — followed through the supersede
 *    chain so a superseded identifier transparently resolves to the
 *    canonical survivor. The originating (raw) id is reported back as
 *    `resolved_from` when a hop occurred.
 * 2. An `entity_id` (the per-source-system native id).
 * 3. An alias value — falls back from entity_id when no match.
 *    Honours the alias feature flags: `userSelected`, `generated`,
 *    `email`. Disabled alias types are excluded from the lookup.
 *
 * The response includes the identity row plus its aliases (also
 * filtered through the alias feature flags) and any
 * `resolved_from` hint.
 *
 * @route   GET /api/user/lookup/:id
 * @param   id — one of: a `urn:gcuid:...` URN, an entity_id, or any alias value.
 * @returns 200 — `{ success: true, data: IdentityRow & { aliases: AliasRow[], resolved_from?: string } }`
 * @throws  404 — `createError('Identity not found', 404)` when no entity, GCUID, or alias matches `:id`.
 * @throws  500 — database read failure.
 */
router.get('/lookup/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const db = new Database(REGISTRY_DB, { readonly: true });
    
    let identity;
    let resolvedFrom: string | null = null;

    // Try GCUID first — follow the supersede chain so a superseded ID transparently
    // returns the canonical record, matching what router.param('gcuid') does for other routes.
    if (id.startsWith('urn:gcuid:')) {
      let resolvedId = id;
      for (let depth = 0; depth < 10; depth++) {
        const stateRow = db.prepare(
          'SELECT identifier_state, superseded_by FROM identities WHERE gcuid = ?'
        ).get(resolvedId) as { identifier_state: string; superseded_by: string | null } | undefined;
        if (!stateRow || stateRow.identifier_state !== 'superseded' || !stateRow.superseded_by) break;
        if (resolvedFrom === null) resolvedFrom = id;
        resolvedId = stateRow.superseded_by;
      }
      identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(resolvedId) as any;
    }
    // Try entity_id
    else {
      identity = db.prepare('SELECT * FROM identities WHERE entity_id = ?').get(id) as any;
      
      // If not found, try aliases (email or employee_id)
      if (!identity) {
        // Respect feature flags: exclude alias types that are currently disabled
        const flags = readFlags();
        const conditions: string[] = [];
        if (!flags.aliases.userSelected) conditions.push("alias_type != 'custom'");
        if (!flags.aliases.generated)    conditions.push("alias_type NOT LIKE 'GC-%'");
        if (!flags.aliases.email)        conditions.push("alias_type != 'email'");
        const whereClause = conditions.length
          ? `WHERE alias_value = ? AND ${conditions.join(' AND ')}`
          : 'WHERE alias_value = ?';
        const aliasRecord = db.prepare(`SELECT gcuid FROM aliases ${whereClause}`).get(id) as { gcuid: string } | undefined;
        
        if (aliasRecord) {
          identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(aliasRecord.gcuid) as any;
        }
      }
    }
    
    if (!identity) {
      db.close();
      logRegistry('info', REGISTRY_EVENTS.IDENTITY_NOT_FOUND, {
        component:  'api:user',
        target_id:  id,
        actor_id:   (req.ip ?? 'system'),
        request_id: (req as any).requestId,
      });
      throw createError('Identity not found', 404);
    }
    
    // Get aliases
    const aliases = getAliases(db, identity.gcuid);
    
    db.close();
    
    // Parse metadata if present
    if (identity.metadata) {
      try {
        identity.metadata = JSON.parse(identity.metadata);
      } catch (e) {
        // Leave as string if not valid JSON
      }
    }

    logRegistry('debug', REGISTRY_EVENTS.IDENTITY_VIEWED, {
      component:  'api:user',
      gcuid:      (identity as any).gcuid,
      actor_id:   (req.ip ?? 'system'),
      actor_type: 'user',
      request_id: (req as any).requestId,
    });
    
    res.json({
      success: true,
      data: {
        ...identity,
        aliases,
        ...(resolvedFrom ? { resolved_from: resolvedFrom } : {}),
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/user/search?q=query&limit=10
 *
 * Search the registry by `LIKE %query%` against `entity_id`, `gcuid`,
 * or `metadata`. Returns up to `limit` matches with `metadata`
 * parsed from JSON when valid.
 *
 * @route   GET /api/user/search
 * @param   q     — query string (required). Case-insensitive substring; no fuzzy matching.
 * @param   limit — result cap (default 10).
 * @returns 200 — `{ success: true, data: IdentityRow[], count: number }`
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
    
    const db = new Database(REGISTRY_DB, { readonly: true });
    
    const identities = db.prepare(`
      SELECT * FROM identities
      WHERE entity_id LIKE ? 
         OR gcuid LIKE ?
         OR metadata LIKE ?
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit);
    
    db.close();
    
    // Parse metadata
    identities.forEach((identity: any) => {
      if (identity.metadata) {
        try {
          identity.metadata = JSON.parse(identity.metadata);
        } catch (e) {
          // Leave as string
        }
      }
    });
    
    res.json({
      success: true,
      data: identities,
      count: identities.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/user/history/:gcuid
 *
 * Return every state transition for one identity, newest first.
 *
 * Each row is taken from `state_history` (a separate table from
 * `identities`) and remapped to a client-facing shape: the
 * internal `actor` column is exposed as `changed_by`, and the
 * internal `timestamp` is exposed as `changed_at`.
 *
 * @route   GET /api/user/history/:gcuid
 * @param   gcuid — GCUID (path param).
 * @returns 200 — `{ success: true, data: { gcuid: string, history: { id, gcuid, from_state, to_state, transition_type, reason, changed_by, changed_at }[] } }`
 * @throws  404 — `createError('Identity not found', 404)` when `:gcuid` does not exist (no row in `identities`).
 */
router.get('/history/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const db = new Database(REGISTRY_DB, { readonly: true });
    
    // Verify identity exists
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid);
    if (!identity) {
      db.close();
      throw createError('Identity not found', 404);
    }
    
    // Get history
    const history = db.prepare(`
      SELECT id, gcuid, from_state, to_state, transition_type,
             reason, actor AS changed_by, timestamp AS changed_at
      FROM state_history
      WHERE gcuid = ?
      ORDER BY timestamp DESC
    `).all(gcuid);
    
    db.close();
    
    res.json({
      success: true,
      data: {
        gcuid,
        history
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/user/verify/:gcuid
 *
 * Cheap verification of a GCUID: format check + existence +
 * activity. Returns 200 with `valid_format=false` when the input
 * doesn't match the URN regex — no 400, so clients can probe
 * without distinguishing "bad input" from "not found".
 *
 * Activity is computed from the identity's `state` column: only
 * `'active'` is reported as `active=true`. Other states
 * (`'provisional'`, `'suspended'`, `'retired'`, etc.) report
 * `active=false` but `exists=true`.
 *
 * @route   GET /api/user/verify/:gcuid
 * @param   gcuid — GCUID string (path param).
 * @returns 200 — `{ success: true, data: { gcuid, valid_format: boolean, exists: boolean, active: boolean, state?: string, message: string } }`
 *          (Always 200 — `data` carries the classification.)
 */
router.get('/verify/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    
    // Validate format
    const isValidFormat = /^urn:gcuid:[0-9A-HJKMNP-TV-Z]{26}$/.test(gcuid);
    
    if (!isValidFormat) {
      return res.json({
        success: true,
        data: {
          gcuid,
          valid_format: false,
          exists: false,
          active: false,
          message: 'Invalid GCUID format'
        }
      });
    }
    
    // Check registry
    const db = new Database(REGISTRY_DB, { readonly: true });
    const identity = db.prepare('SELECT state FROM identities WHERE gcuid = ?').get(gcuid) as any;
    db.close();
    
    if (!identity) {
      return res.json({
        success: true,
        data: {
          gcuid,
          valid_format: true,
          exists: false,
          active: false,
          message: 'GCUID not found in registry'
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        gcuid,
        valid_format: true,
        exists: true,
        active: identity.state === 'active',
        state: identity.state,
        message: identity.state === 'active' ? 'GCUID is active' : `GCUID is ${identity.state}`
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/user/attributes/:gcuid
 *
 * Returns the self-service-readable attributes for a user, sourced
 * via CAES attribute mappings. Each attribute exposes its current
 * value, the source system it came from, the fetch mode
 * (`'live'` for `dynamic-pull`, `'cache'` for `push-cache` /
 * `scheduled-pull`), and whether the user can edit it.
 *
 * The fixed attribute list (`VIEWABLE_ATTRS`) covers identity
 * basics: given/family name, email, department, employment status,
 * LDAP username, account-enabled flag, job title.
 *
 * Some attribute values are post-processed on the way out:
 * - `person.account.groups`: parsed from JSON if it arrives as a string.
 * - `person.account.enabled`: coerced from `0`/`1` to `boolean`.
 *
 * @route   GET /api/user/attributes/:gcuid
 * @param   gcuid — GCUID (path param).
 * @returns 200 — `{ success: true, data: { gcuid: string, attributes: { [standardAttr]: { value, source, fetch_mode, authoritative_source, self_service, writable, self_service_value?, self_service_source?, self_service_fetch_mode? } } } }`
 * @throws  404 — `createError('GCUID not found', 404)` when `:gcuid` has no identity row.
 * @throws  500 — connector resolution failure (one source failing does not fail the whole response — per-source `try/catch`).
 */
router.get('/attributes/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const registryDb = new Database(REGISTRY_DB, { readonly: true });

    // Validate GCUID exists
    const identity = registryDb.prepare('SELECT entity_id FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) {
      registryDb.close();
      throw createError('GCUID not found', 404);
    }

    // Load source mappings
    const sourceMappings = registryDb.prepare(
      'SELECT source_system, source_id FROM source_mappings WHERE gcuid = ?'
    ).all(gcuid) as Array<{ source_system: string; source_id: string }>;

    // Load ALL attribute_mappings from registry (includes self_service flag)
    const allMappings = registryDb.prepare('SELECT * FROM attribute_mappings').all() as any[];

    // Load access modes so each returned attribute can be annotated with how its
    // value was fetched: dynamic-pull → 'live', push-cache/scheduled-pull → 'cache'
    const accessModeRows = registryDb.prepare(
      'SELECT system_id, access_mode FROM source_systems'
    ).all() as Array<{ system_id: string; access_mode: string }>;
    registryDb.close();
    const accessModeMap = new Map(accessModeRows.map(r => [r.system_id, r.access_mode]));

    // We want to return:
    //  - All self_service=1 attributes (editable by user)
    //  - Key read-only attributes for context (name, email, department, account info)
    const VIEWABLE_ATTRS = [
      'person.name.given', 'person.name.family', 'person.email',
      'person.employment.department', 'person.employment.status',
      'person.account.username', 'person.account.enabled',
      'person.job.title',
    ];

    const result: Record<string, {
      value: any; source: string | null; fetch_mode: 'live' | 'cache' | null;
      authoritative_source: string | null;
      self_service: boolean; writable: boolean;
    }> = {};

    for (const attrName of VIEWABLE_ATTRS) {
      const mappings = allMappings.filter((m: any) => m.standard_attribute === attrName);
      if (!mappings.length) continue;

      // Collect values from all available sources via connector resolver
      const values: Array<{ source: string; value: any; is_authoritative: boolean; self_service: boolean; fetch_mode: 'live' | 'cache' }> = [];
      for (const mapping of mappings) {
        const srcRecord = sourceMappings.find(s => s.source_system === mapping.source_system);
        if (!srcRecord) continue;

        try {
          const rawValue = await connectorResolver.resolveAttribute(
            mapping.source_system,
            srcRecord.source_id,
            {
              sourceField: mapping.source_field,
              sourceTable: mapping.source_table,
              keyField: mapping.key_field,
              standardAttribute: attrName,
            }
          );
          if (rawValue === null || rawValue === undefined) continue;

          let value = rawValue;
          if (attrName === 'person.account.groups') {
            if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = []; } }
          } else if (attrName === 'person.account.enabled') {
            value = value === 1 || value === true;
          }
          values.push({
            source: mapping.source_system,
            value,
            is_authoritative: mapping.is_authoritative === 1,
            self_service: mapping.self_service === 1,
            fetch_mode: (accessModeMap.get(mapping.source_system) ?? 'dynamic-pull') === 'dynamic-pull' ? 'live' : 'cache',
          });
        } catch {
          // skip if field unavailable
        }
      }

      const authEntry = values.find(v => v.is_authoritative) ?? values[0] ?? null;
      const selfServiceEntry = values.find(v => v.self_service) ?? null;

      result[attrName] = {
        value: authEntry?.value ?? null,
        source: authEntry?.source ?? null,
        fetch_mode: authEntry?.fetch_mode ?? null,
        authoritative_source: mappings.find((m: any) => m.is_authoritative === 1)?.source_system ?? null,
        self_service: selfServiceEntry !== null,
        // Current self-service value (may differ from authoritative)
        ...(selfServiceEntry && selfServiceEntry.source !== authEntry?.source
          ? {
              self_service_value: selfServiceEntry.value,
              self_service_source: selfServiceEntry.source,
              self_service_fetch_mode: selfServiceEntry.fetch_mode,
            }
          : {}),
        writable: selfServiceEntry !== null,
      };
    }

    res.json({ success: true, data: { gcuid, attributes: result } });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/user/attributes/:gcuid
 *
 * Update self-service attributes for a user. Writes are routed to
 * the correct source system via CAES mapping and only attributes
 * marked `self_service=1` in `attribute_mappings` are accepted.
 *
 * Per-attribute result classification:
 * - `updated`: written successfully; emits `SELF_SVC_SUCCESS`.
 * - `rejected[attr] = 'Attribute is not user-editable'` if the
 *   attribute is not in the self-service allowlist; emits
 *   `SELF_SVC_UNAUTHORISED`.
 * - `rejected[attr] = 'No <system> account linked to this identity'`
 *   if no `source_mappings` row points at a record in the
 *   configured source system; emits `SELF_SVC_REJECTED`.
 * - `rejected[attr] = 'Write to <system> failed'` if the connector
 *   throws during the write; emits `SELF_SVC_REJECTED`.
 *
 * Every attempt is logged as `SELF_SVC_ATTEMPTED` before any work,
 * carrying the list of requested attribute names.
 *
 * Pre-write, the old value is hashed (`sha256`) and recorded on the
 * success log as `value_before_hash` — the raw old value is never
 * written to the log.
 *
 * @route   PATCH /api/user/attributes/:gcuid
 * @param   gcuid — GCUID (path param).
 * @body    `{ attributes: { [standardAttribute: string]: string } }`
 *          All values must be non-empty strings ≤ 255 characters. Trailing whitespace is trimmed.
 * @returns 200 — `{ success: boolean, data: { gcuid, updated: { [attr]: { source, value } }, rejected?: { [attr]: string } } }`
 *          `success` is `true` when at least one attribute was updated. `rejected` is omitted when empty.
 * @throws  400 — `createError('"attributes" object is required', 400)` when body shape is wrong; per-attribute 400 errors on empty / non-string / too-long values.
 * @throws  404 — `createError('GCUID not found', 404)` when no `source_mappings` row exists for `:gcuid`.
 */
router.patch('/attributes/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const { attributes } = req.body as { attributes?: Record<string, string> };

    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw createError('"attributes" object is required', 400);
    }

    // Allowlist: only non-empty string values accepted
    for (const [key, val] of Object.entries(attributes)) {
      if (typeof val !== 'string') throw createError(`Value for "${key}" must be a string`, 400);
      if (val.trim().length === 0) throw createError(`Value for "${key}" must not be empty`, 400);
      if (val.length > 255) throw createError(`Value for "${key}" exceeds maximum length`, 400);
    }

    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    const sourceMappings = registryDb.prepare(
      'SELECT source_system, source_id FROM source_mappings WHERE gcuid = ?'
    ).all(gcuid) as Array<{ source_system: string; source_id: string }>;

    if (!sourceMappings.length) {
      registryDb.close();
      throw createError('GCUID not found', 404);
    }

    // Load self-service attribute mappings
    const selfServiceMappings = registryDb.prepare(
      `SELECT * FROM attribute_mappings WHERE self_service = 1
       AND (operations LIKE '%"update"%' OR operations LIKE '%"write"%')`
    ).all() as any[];
    registryDb.close();

    const updated: Record<string, { source: string; value: string }> = {};
    const rejected: Record<string, string> = {};

    // E3: log self-service attempt
    logLDAP('info', LDAP_EVENTS.SELF_SVC_ATTEMPTED, {
      component:         'api:user',
      username:          gcuid,
      actor_id:          (req.ip ?? 'system'),
      attribute_changed: Object.keys(attributes).join(','),
      self_service:      1,
      request_id:        (req as any).requestId,
    });

    for (const [attrName, value] of Object.entries(attributes)) {
      const mapping = selfServiceMappings.find((m: any) => m.standard_attribute === attrName);
      if (!mapping) {
        rejected[attrName] = 'Attribute is not user-editable';
        // E6: unauthorised — attribute is not self-service
        logLDAP('warning', LDAP_EVENTS.SELF_SVC_UNAUTHORISED, {
          component:         'api:user',
          username:          gcuid,
          actor_id:          (req.ip ?? 'system'),
          attribute_changed: attrName,
          request_id:        (req as any).requestId,
        });
        continue;
      }

      const srcRecord = sourceMappings.find(s => s.source_system === mapping.source_system);
      if (!srcRecord) {
        rejected[attrName] = `No ${mapping.source_system} account linked to this identity`;
        // E5: rejected — no linked account
        logLDAP('warning', LDAP_EVENTS.SELF_SVC_REJECTED, {
          component:         'api:user',
          username:          gcuid,
          actor_id:          (req.ip ?? 'system'),
          attribute_changed: attrName,
          error_detail:      `No ${mapping.source_system} account linked to this identity`,
          request_id:        (req as any).requestId,
        });
        continue;
      }

      try {
        // Read old value for audit hash via connector
        let valueBeforeHash = '';
        try {
          const oldValue = await connectorResolver.resolveAttribute(
            mapping.source_system,
            srcRecord.source_id,
            { sourceField: mapping.source_field, sourceTable: mapping.source_table, keyField: mapping.key_field }
          );
          valueBeforeHash = crypto.createHash('sha256').update(String(oldValue ?? '')).digest('hex');
        } catch { /* skip if read fails */ }
        await connectorResolver.updateAttribute(
          mapping.source_system,
          srcRecord.source_id,
          mapping.source_field,
          value.trim()
        );
        updated[attrName] = { source: mapping.source_system, value: value.trim() };
        // E4: success
        logLDAP('notice', LDAP_EVENTS.SELF_SVC_SUCCESS, {
          component:         'api:user',
          username:          gcuid,
          actor_id:          (req.ip ?? 'system'),
          attribute_changed: attrName,
          value_before_hash: valueBeforeHash,
          request_id:        (req as any).requestId,
        });
      } catch (err) {
        rejected[attrName] = `Write to ${mapping.source_system} failed`;
        // E5: rejected — write failure
        logLDAP('warning', LDAP_EVENTS.SELF_SVC_REJECTED, {
          component:         'api:user',
          username:          gcuid,
          actor_id:          (req.ip ?? 'system'),
          attribute_changed: attrName,
          error_detail:      `Write to ${mapping.source_system} failed`,
          request_id:        (req as any).requestId,
        });
      }
    }

    res.json({
      success: Object.keys(updated).length > 0,
      data: {
        gcuid,
        updated,
        ...(Object.keys(rejected).length > 0 ? { rejected } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom alias helpers
// ─────────────────────────────────────────────────────────────────────────────

function validateCustomAlias(value: string): string | null {
  if (value.length < 3)  return 'Alias must be at least 3 characters';
  if (value.length > 64) return 'Alias must be at most 64 characters';
  if (!/^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(value))
    return 'Use only letters, numbers, dots, and underscores — start and end with a letter or number';
  return null;
}

function getAliasSuggestions(db: Database.Database, base: string): string[] {
  const suggestions: string[] = [];
  for (let i = 1; i <= 9 && suggestions.length < 3; i++) {
    const candidate = `${base}_${i}`;
    const taken = db.prepare(
      "SELECT gcuid FROM aliases WHERE LOWER(alias_value) = ? AND alias_type IN ('custom','GC-A','GC-S','GC-Q','GC-T','GC-P')"
    ).get(candidate) as { gcuid: string } | undefined;
    // Only suggest truly free aliases — never suggest one the user already owns
    if (!taken) suggestions.push(candidate);
  }
  return suggestions;
}

/**
 * GET /api/user/aliases/check
 *
 * Check whether a custom-alias value is available. Validates the
 * value via `validateCustomAlias` (3–64 chars, lowercase letters /
 * digits / `.` / `_`, must start and end with alnum) and probes the
 * DB for collisions against custom and GC-style alias types
 * (`custom`, `GC-A`, `GC-S`, `GC-Q`, `GC-T`, `GC-P`). Email aliases
 * are lookup-only and never collide here.
 *
 * When unavailable, returns up to 3 suggestions of the form
 * `<base>_<n>` where `<n>` ∈ 1..9 and the candidate isn't already
 * owned by anyone (including the same caller — the caller is told
 * `alreadyOwned=true` instead of getting a suggested alternative).
 *
 * Requires the `aliases.userSelected` feature flag.
 *
 * NOTE: registered before `/aliases/:gcuid` to avoid route shadowing.
 *
 * @route   GET /api/user/aliases/check
 * @param   value — query param (required). The alias value to test (case-insensitive; lowercased internally).
 * @param   gcuid — query param (optional). When present and the value is already owned by this GCUID, returns `alreadyOwned=true`.
 * @returns 200 — `{ success: true, data: { available: boolean, reason?: string, alreadyOwned?: boolean, suggestions: string[] } }`
 *          `reason` carries the validator message (when format invalid) or the conflict message (when taken).
 * @throws  400 — `createError('value query parameter is required', 400)` when `value` is missing.
 * @throws  403 — `createError('User-selected aliases are disabled by feature flag', 403)` when `aliases.userSelected` is off.
 */
router.get('/aliases/check', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!readFlags().aliases.userSelected) {
      throw createError('User-selected aliases are disabled by feature flag', 403);
    }
    const raw = (req.query.value as string | undefined)?.trim().toLowerCase() ?? '';
    const ownGcuid = req.query.gcuid as string | undefined;

    if (!raw) throw createError('value query parameter is required', 400);

    const validErr = validateCustomAlias(raw);
    if (validErr) {
      return res.json({ success: true, data: { available: false, reason: validErr, suggestions: [] } });
    }

    const db = new Database(REGISTRY_DB, { readonly: true });
    // Only GC-style and custom aliases can conflict — email aliases are lookup-only
    const conflict = db.prepare(
      "SELECT gcuid FROM aliases WHERE LOWER(alias_value) = ? AND alias_type IN ('custom','GC-A','GC-S','GC-Q','GC-T','GC-P')"
    ).get(raw) as { gcuid: string } | undefined;

    if (!conflict) {
      db.close();
      return res.json({ success: true, data: { available: true, suggestions: [] } });
    }

    if (conflict.gcuid === ownGcuid) {
      const suggestions = getAliasSuggestions(db, raw);
      db.close();
      return res.json({ success: true, data: { available: false, alreadyOwned: true, reason: 'You already have this alias', suggestions } });
    }

    const suggestions = getAliasSuggestions(db, raw);
    db.close();
    res.json({ success: true, data: { available: false, reason: 'This alias is already taken', suggestions } });
  } catch (error) { next(error); }
});

/**
 * GET /api/user/aliases/:gcuid
 *
 * List the custom aliases owned by a GCUID, ordered by creation
 * time ascending. Only `alias_type='custom'` rows are returned
 * (GC-generated and email aliases are filtered out).
 *
 * Requires the `aliases.userSelected` feature flag.
 *
 * @route   GET /api/user/aliases/:gcuid
 * @param   gcuid — GCUID (path param).
 * @returns 200 — `{ success: true, data: { id, gcuid, alias_type, alias_value, status, created_at }[] }`
 * @throws  403 — `createError('User-selected aliases are disabled by feature flag', 403)` when `aliases.userSelected` is off.
 * @throws  404 — `createError('Identity not found', 404)` when `:gcuid` has no identity row.
 */
router.get('/aliases/:gcuid', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!readFlags().aliases.userSelected) {
      throw createError('User-selected aliases are disabled by feature flag', 403);
    }
    const { gcuid } = req.params;
    const db = new Database(REGISTRY_DB, { readonly: true });

    if (!db.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(gcuid)) {
      db.close(); throw createError('Identity not found', 404);
    }

    const aliases = db.prepare(
      "SELECT id, gcuid, alias_type, alias_value, status, created_at FROM aliases WHERE gcuid = ? AND alias_type = 'custom' ORDER BY created_at ASC"
    ).all(gcuid);
    db.close();
    res.json({ success: true, data: aliases });
  } catch (error) { next(error); }
});

/**
 * POST /api/user/aliases/:gcuid
 *
 * Create a custom alias for a GCUID.
 *
 * Behaviour:
 * - **Idempotent on `(value, gcuid)`**: if the same GCUID already
 *   owns the same value, returns the existing row with 200 (not 201).
 * - **409 conflict** when a different GCUID already owns the value.
 * - Validation via `validateCustomAlias` (length 3–64, lowercase
 *   alnum / `.` / `_`, must start and end alnum).
 *
 * Requires the `aliases.userSelected` feature flag.
 *
 * @route   POST /api/user/aliases/:gcuid
 * @param   gcuid — GCUID (path param).
 * @body    `{ value: string }` — the alias to claim; lowercased and trimmed internally.
 * @returns 200/201 — `{ success: true, data: { id, gcuid, alias_type: 'custom', alias_value, status: 'enabled', created_at } }`
 *          Status 200 when idempotent (existing row); status 201 when newly created.
 * @throws  400 — `createError('value is required', 400)` or any `validateCustomAlias` failure.
 * @throws  403 — `createError('User-selected aliases are disabled by feature flag', 403)` when `aliases.userSelected` is off.
 * @throws  404 — `createError('Identity not found', 404)` when `:gcuid` has no identity row.
 * @throws  409 — `createError('Alias "..." is already taken', 409)` when a different GCUID owns it.
 */
router.post('/aliases/:gcuid', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!readFlags().aliases.userSelected) {
      throw createError('User-selected aliases are disabled by feature flag', 403);
    }
    const { gcuid } = req.params;
    const raw = (req.body?.value as string | undefined)?.trim().toLowerCase() ?? '';

    if (!raw) throw createError('value is required', 400);

    const validErr = validateCustomAlias(raw);
    if (validErr) throw createError(validErr, 400);

    const db = new Database(REGISTRY_DB);

    if (!db.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(gcuid)) {
      db.close(); throw createError('Identity not found', 404);
    }

    // Idempotent: return existing row if this GCUID already owns this alias
    const ownRow = db.prepare(
      "SELECT id, gcuid, alias_type, alias_value, status, created_at FROM aliases WHERE LOWER(alias_value) = ? AND gcuid = ?"
    ).get(raw, gcuid) as any;
    if (ownRow) { db.close(); return res.json({ success: true, data: ownRow }); }

    // Conflict: taken by a different GCUID
    const conflict = db.prepare(
      'SELECT gcuid FROM aliases WHERE LOWER(alias_value) = ? AND gcuid != ?'
    ).get(raw, gcuid) as any;
    if (conflict) { db.close(); throw createError(`Alias "${raw}" is already taken`, 409); }

    const createdAt = new Date().toISOString();
    const result = db.prepare(
      "INSERT INTO aliases (gcuid, alias_type, alias_value, status, created_at) VALUES (?, 'custom', ?, 'enabled', ?)"
    ).run(gcuid, raw, createdAt);
    db.close();

    res.status(201).json({
      success: true,
      data: { id: Number(result.lastInsertRowid), gcuid, alias_type: 'custom', alias_value: raw, status: 'enabled', created_at: createdAt },
    });
  } catch (error) { next(error); }
});

/**
 * PATCH /api/user/aliases/:gcuid/:id/disable
 *
 * Disable a custom alias. The alias row stays bound to the GCUID
 * for life but stops resolving until re-enabled (aliases cannot
 * be deleted). Idempotent: disabling an already-disabled alias
 * returns 200 with the existing row, no DB write.
 *
 * Every state change is recorded as a `state_history` row of type
 * `alias_disabled` so the alias lifecycle is auditable.
 *
 * Requires the `aliases.userSelected` feature flag.
 *
 * @route   PATCH /api/user/aliases/:gcuid/:id/disable
 * @param   gcuid — GCUID (path param).
 * @param   id    — alias primary key (path param, must parse as integer).
 * @body    `{ reason?: string }` — optional audit reason; defaults to `'User disabled alias'`.
 * @returns 200 — `{ success: true, data: { id, gcuid, alias_type: 'custom', alias_value, status: 'disabled', disabled_at: ISO timestamp } }`
 *          When the alias is already disabled, returns the existing row without `disabled_at`.
 * @throws  400 — `createError('Invalid alias id', 400)` when `:id` is non-numeric.
 * @throws  403 — `createError('User-selected aliases are disabled by feature flag', 403)` when `aliases.userSelected` is off.
 * @throws  404 — `createError('Alias not found', 404)` when no `id + gcuid + alias_type='custom'` row exists.
 */
router.patch('/aliases/:gcuid/:id/disable', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!readFlags().aliases.userSelected) {
      throw createError('User-selected aliases are disabled by feature flag', 403);
    }
    const { gcuid, id } = req.params;
    const reason = (req.body?.reason as string | undefined)?.trim() ?? 'User disabled alias';
    const numId = parseInt(id, 10);
    if (isNaN(numId)) throw createError('Invalid alias id', 400);

    const db = new Database(REGISTRY_DB);
    const row = db.prepare(
      "SELECT id, alias_value, status FROM aliases WHERE id = ? AND gcuid = ? AND alias_type = 'custom'"
    ).get(numId, gcuid) as any;
    if (!row) { db.close(); throw createError('Alias not found', 404); }
    if (row.status === 'disabled') { db.close(); return res.json({ success: true, data: { ...row, gcuid, alias_type: 'custom' } }); }

    const identity = db.prepare('SELECT state FROM identities WHERE gcuid = ?').get(gcuid) as any;
    const ts = new Date().toISOString();

    db.prepare(`
      INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
      VALUES (?, ?, 'active', 'alias_disabled', ?, ?, ?)
    `).run(gcuid, identity?.state ?? 'unknown', `custom:${row.alias_value} — ${reason}`, req.ip ?? 'user', ts);

    db.prepare("UPDATE aliases SET status = 'disabled' WHERE id = ?").run(numId);
    db.close();
    res.json({ success: true, data: { id: numId, gcuid, alias_type: 'custom', alias_value: row.alias_value, status: 'disabled', disabled_at: ts } });
  } catch (error) { next(error); }
});

/**
 * PATCH /api/user/aliases/:gcuid/:id/enable
 *
 * Re-enable a previously disabled custom alias. Idempotent:
 * enabling an already-enabled alias returns 200 with the existing
 * row, no DB write.
 *
 * Every state change is recorded as a `state_history` row of type
 * `alias_enabled`.
 *
 * Requires the `aliases.userSelected` feature flag.
 *
 * @route   PATCH /api/user/aliases/:gcuid/:id/enable
 * @param   gcuid — GCUID (path param).
 * @param   id    — alias primary key (path param, must parse as integer).
 * @body    `{ reason?: string }` — optional audit reason; defaults to `'User re-enabled alias'`.
 * @returns 200 — `{ success: true, data: { id, gcuid, alias_type: 'custom', alias_value, status: 'enabled', enabled_at: ISO timestamp } }`
 *          When the alias is already enabled, returns the existing row without `enabled_at`.
 * @throws  400 — `createError('Invalid alias id', 400)` when `:id` is non-numeric.
 * @throws  403 — `createError('User-selected aliases are disabled by feature flag', 403)` when `aliases.userSelected` is off.
 * @throws  404 — `createError('Alias not found', 404)` when no `id + gcuid + alias_type='custom'` row exists.
 */
router.patch('/aliases/:gcuid/:id/enable', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!readFlags().aliases.userSelected) {
      throw createError('User-selected aliases are disabled by feature flag', 403);
    }
    const { gcuid, id } = req.params;
    const reason = (req.body?.reason as string | undefined)?.trim() ?? 'User re-enabled alias';
    const numId = parseInt(id, 10);
    if (isNaN(numId)) throw createError('Invalid alias id', 400);

    const db = new Database(REGISTRY_DB);
    const row = db.prepare(
      "SELECT id, alias_value, status FROM aliases WHERE id = ? AND gcuid = ? AND alias_type = 'custom'"
    ).get(numId, gcuid) as any;
    if (!row) { db.close(); throw createError('Alias not found', 404); }
    if (row.status === 'enabled') { db.close(); return res.json({ success: true, data: { ...row, gcuid, alias_type: 'custom' } }); }

    const identity = db.prepare('SELECT state FROM identities WHERE gcuid = ?').get(gcuid) as any;
    const ts = new Date().toISOString();

    db.prepare(`
      INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
      VALUES (?, ?, 'active', 'alias_enabled', ?, ?, ?)
    `).run(gcuid, identity?.state ?? 'unknown', `custom:${row.alias_value} — ${reason}`, req.ip ?? 'user', ts);

    db.prepare("UPDATE aliases SET status = 'enabled' WHERE id = ?").run(numId);
    db.close();
    res.json({ success: true, data: { id: numId, gcuid, alias_type: 'custom', alias_value: row.alias_value, status: 'enabled', enabled_at: ts } });
  } catch (error) { next(error); }
});


// ─── Self-Service Registration helpers ───────────────────────────────────────

const CROCKFORD_ALPHA_REG = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

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

/**
 * POST /api/user/self-register
 *
 * Self-service registration: returns either an existing GCUID or
 * creates a provisional one.
 *
 * Body shape:
 * ```
 * {
 *   first_name: string,
 *   last_name:  string,
 *   email:      string,
 *   identity_proofs?: Array<{ source_system: string, source_id: string }>,
 *   // Legacy single-value pair — still honoured for back-compat.
 *   // If supplied alongside `identity_proofs` it is merged into the same list.
 *   dept_id?:     string,
 *   dept_source?: string,
 * }
 * ```
 *
 * Outcomes (returned as `data.outcome`):
 *
 * - `gcuid_exists`           — a GCUID is already registered for this email or one of the supplied proofs.
 * - `high_confidence_match`  — matches found in ≥1 authoritative source at high confidence.
 * - `low_confidence_match`   — partial matches found; manual review required.
 * - `no_match`               — new provisional GCUID created; can self-approve.
 *
 * The route also handles re-registration cleanup: prior attempts
 * whose `state` is `archived`/`retired` or whose
 * `identifier_state` is `nullified` are released so the new
 * registration can claim the email and the source identifiers
 * cleanly. The dead GCUID remains in its terminal state — it is a
 * permanent record of the failed attempt, not a recyclable slot.
 *
 * Match records returned to the client (and persisted to
 * `metadata.matches[]`) are stripped of the full source-system row
 * (via `summarizeMatch`) so the right pane shows the summary, not
 * a 1–3 KB uninterpreted JSON blob. The full record remains
 * reachable via `source_mappings → connector lookup`.
 *
 * @route   POST /api/user/self-register
 * @body    see above
 * @returns 200 — `{ success: true, data: { outcome, gcuid?, identity_state?, identifier_state?, match_source?, message, matches?, can_self_approve?, ... } }`
 *          The exact `data` shape depends on `outcome`; see route body for per-branch payloads.
 * @throws  400 — `{ success: false, error: { message: 'first_name, last_name, and email are required' } }` when any of the three required fields is missing or empty.
 */
// Optional: callers may supply a list of pre-known identity proofs to be
// matched and linked during registration (preferred — supports multiple
// departmental identifiers from different source systems). The legacy
// single-value `dept_id` / `dept_source` pair is still honoured for back-compat.
type IdentityProof = { source_system: string; source_id: string };

/**
 * Strip the full source-system row from a match record before persisting it
 * in identity metadata or returning it in a response body.
 *
 * Each match (from source-scan.ts) carries a `record` field containing the
 * entire source-system row (all 10+ columns from HR, LDAP, etc.). Storing
 * that row inside `metadata.matches[].record` makes the right-pane show an
 * uninterpreted JSON blob and bloats every identity by 1-3 KB. The full
 * record remains reachable via the source_mapping → connector lookup, so
 * dropping it from the match summary is safe.
 *
 * Returns only the match-summary fields: source identifiers, confidence,
 * strategy, and the list of attributes that matched.
 */
function summarizeMatch(m: {
  sourceSystem: string;
  sourceId: string;
  confidence: number;
  strategyId?: string;
  strategyDescription?: string;
  matchedAttributes?: string[];
  record?: unknown;
}): {
  sourceSystem: string;
  sourceId: string;
  confidence: number;
  strategyId?: string;
  strategyDescription?: string;
  matchedAttributes?: string[];
} {
  return {
    sourceSystem: m.sourceSystem,
    sourceId: m.sourceId,
    confidence: m.confidence,
    strategyId: m.strategyId,
    strategyDescription: m.strategyDescription,
    matchedAttributes: m.matchedAttributes,
  };
}

router.post('/self-register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { first_name, last_name, email, dept_id, dept_source, identity_proofs } = req.body as {
      first_name?: string;
      last_name?: string;
      email?: string;
      dept_id?: string;
      dept_source?: string;
      identity_proofs?: Array<{ source_system?: string; source_id?: string }>;
    };

    if (!first_name?.trim() || !last_name?.trim() || !email?.trim()) {
      return res.status(400).json({
        success: false,
        error: { message: 'first_name, last_name, and email are required' },
      });
    }

    // Build a deduplicated, trimmed list of {source_system, source_id} identity
    // proofs from either the new `identity_proofs` array (preferred — supports
    // multiple departmental identifiers) or the legacy single `dept_id` /
    // `dept_source` pair (back-compat).
    const proofList: IdentityProof[] = Array.isArray(identity_proofs)
      ? (identity_proofs
          .filter((p: any) => p && typeof p.source_system === 'string' && typeof p.source_id === 'string')
          .map((p: any) => ({ source_system: p.source_system.trim(), source_id: p.source_id.trim() }))
          .filter((p: IdentityProof) => p.source_system.length > 0 && p.source_id.length > 0))
      : [];

    if (dept_id?.trim() && dept_source?.trim()) {
      proofList.push({ source_system: dept_source.trim(), source_id: dept_id.trim() });
    }

    const seenProofs = new Set<string>();
    const uniqueProofs: IdentityProof[] = proofList.filter((p) => {
      const key = `${p.source_system.toLowerCase()}|${p.source_id.toLowerCase()}`;
      if (seenProofs.has(key)) return false;
      seenProofs.add(key);
      return true;
    });

    const db = new Database(REGISTRY_DB);

    // ── Step 1: Check if a GCUID already exists for this email ─────────────
    // Self-registration no longer creates a persistent `aliases` row from the
    // user-claimed email (that caused typos to become permanent look-up keys).
    // The claim is now stored in `identities.metadata->>'$.email'`. We still
    // check the aliases table for confirmed-source email aliases, and fall
    // back to the metadata claim to catch re-registrations of an unverified
    // claim. Both branches are case-insensitive.
    const claimedEmail = email.trim();
    const existingByEmail = db.prepare(`
      SELECT i.gcuid, i.state, i.identifier_state, 'alias' AS source
      FROM aliases a
      JOIN identities i ON i.gcuid = a.gcuid
      WHERE a.alias_type = 'email' AND lower(a.alias_value) = lower(?)
        AND i.identifier_state != 'nullified'
        AND i.state != 'archived'
        AND i.state != 'retired'
      UNION
      SELECT i.gcuid, i.state, i.identifier_state, 'claim' AS source
      FROM identities i
      WHERE json_extract(i.metadata, '$.email') IS NOT NULL
        AND lower(json_extract(i.metadata, '$.email')) = lower(?)
        AND i.identifier_state != 'nullified'
        AND i.state != 'archived'
        AND i.state != 'retired'
    `).get(claimedEmail, claimedEmail) as { gcuid: string; state: string; identifier_state: string; source: string } | undefined;

    if (existingByEmail) {
      db.close();
      return res.json({
        success: true,
        data: {
          outcome: 'gcuid_exists',
          gcuid: existingByEmail.gcuid,
          identity_state: existingByEmail.state,
          identifier_state: existingByEmail.identifier_state,
          match_source: existingByEmail.source,
          message: existingByEmail.source === 'alias'
            ? 'A GCUID is already registered for this email address.'
            : 'A GCUID is already pending review for this email address.',
        },
      });
    }

    // The user is asking us to recover from a previously-failed attempt: a
    // prior self-registration for this email was nullified (or archived), but
    // the metadata.email claim (and any source_mappings bound to that gcuid)
    // is still in the DB.  A new self-registration would otherwise be blocked
    // by the lookup above if we didn't filter.  Find the dead rows now and
    // clear their locks so the new gcuid can claim the email and the source
    // identifiers cleanly.  The old gcuid remains in its terminal state — it
    // is a permanent record of the failed attempt, not a recyclable slot.
    const deadByEmail = db.prepare(`
      SELECT i.gcuid, i.identifier_state
      FROM identities i
      WHERE (i.identifier_state = 'nullified' OR i.state IN ('archived','retired'))
        AND (
          EXISTS (SELECT 1 FROM aliases a WHERE a.gcuid = i.gcuid
                  AND a.alias_type = 'email' AND lower(a.alias_value) = lower(?))
          OR
          (json_extract(i.metadata, '$.email') IS NOT NULL
           AND lower(json_extract(i.metadata, '$.email')) = lower(?))
        )
    `).all(claimedEmail, claimedEmail) as { gcuid: string; identifier_state: string }[];

    for (const dead of deadByEmail) {
      // Clear the source_mappings that block re-registration.  The dead
      // gcuid's history (state_history, identifier_state_history) is
      // preserved for audit.
      const del = db.prepare('DELETE FROM source_mappings WHERE gcuid = ?').run(dead.gcuid);
      if (del.changes > 0) {
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(dead.gcuid, 'archived', 'archived', 'auto_release_mappings',
               `Released ${del.changes} source_mapping(s) to allow re-registration for ${claimedEmail}`,
               'system', new Date().toISOString());
      }
    }

    // ── Step 2: Check source_mappings for any known departmental identifier ──
    // Iterate the full unique proof list (either from `identity_proofs` or the
    // legacy `dept_id`/`dept_source` pair). We only probe source_mappings here
    // because entity_id maps 1:1 to a single primary dept ID — the multi-proof
    // case can only be pre-linked via source_mappings rows from prior imports.
    for (const proof of uniqueProofs) {
      const existingBySourceMapping = db.prepare(`
        SELECT gcuid, state, identifier_state
        FROM source_mappings
        WHERE source_system = ? AND source_id = ?
      `).get(proof.source_system, proof.source_id) as
        { gcuid: string; state: string; identifier_state: string } | undefined;

      if (existingBySourceMapping) {
        // If the bound gcuid is nullified/archived/retired, the binding is
        // effectively stale.  Clear it so the new registration can claim
        // the same source_id, then continue with the next proof.
        const idRow = db.prepare(
          'SELECT identifier_state, state FROM identities WHERE gcuid = ?'
        ).get(existingBySourceMapping.gcuid) as { identifier_state: string; state: string } | undefined;
        if (idRow && (idRow.identifier_state === 'nullified' || ['archived','retired'].includes(idRow.state))) {
          db.prepare('DELETE FROM source_mappings WHERE gcuid = ?').run(existingBySourceMapping.gcuid);
          db.prepare(`
            INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(existingBySourceMapping.gcuid, idRow.state, idRow.state, 'auto_release_mappings',
                 `Released source_mapping (${proof.source_system}:${proof.source_id}) to allow re-registration`,
                 'system', new Date().toISOString());
          continue;
        }
        db.close();
        return res.json({
          success: true,
          data: {
            outcome: 'gcuid_exists',
            gcuid: existingBySourceMapping.gcuid,
            identity_state: existingBySourceMapping.state,
            identifier_state: existingBySourceMapping.identifier_state,
            matched_proof: proof,
            message: `A GCUID is already linked to this ${proof.source_system} identifier.`,
          },
        });
      }

      // Also probe entity_id (primary departmental ID) if source_system is the
      // canonical 'dept' namespace — keeps behaviour aligned with prior logic.
      if (proof.source_system.toLowerCase() === 'dept') {
        const existingByEntityId = db.prepare(`
          SELECT gcuid, state, identifier_state
          FROM identities
          WHERE entity_id = ?
        `).get(proof.source_id) as
          { gcuid: string; state: string; identifier_state: string } | undefined;

        if (existingByEntityId) {
          db.close();
          return res.json({
            success: true,
            data: {
              outcome: 'gcuid_exists',
              gcuid: existingByEntityId.gcuid,
              identity_state: existingByEntityId.state,
              identifier_state: existingByEntityId.identifier_state,
              matched_proof: proof,
              message: 'A GCUID is already linked to this department identifier.',
            },
          });
        }
      }
    }

    db.close();

    // ── Step 3: Run CAES identity match ──────────────────────────────────────
    const matchAttributes: Record<string, string> = {
      'person.name.given':  first_name.trim(),
      'person.name.family': last_name.trim(),
      'person.email':       email.trim(),
    };
    // Surface every supplied departmental identifier to the match engine. The
    // first proof feeds the canonical `person.employment.employee_id` slot;
    // remaining proofs are exposed under `person.employment.identifiers` as a
    // comma-joined string so the match engine (and downstream authoritative
    // sources) can correlate on any of them.
    if (uniqueProofs.length > 0) {
      matchAttributes['person.employment.employee_id'] = uniqueProofs[0].source_id;
      if (uniqueProofs.length > 1) {
        matchAttributes['person.employment.identifiers'] =
          uniqueProofs.map(p => `${p.source_system}:${p.source_id}`).join(',');
      }
    }

    const PORT_INTERNAL = process.env.PORT || 5182;
    let matchResult: {
      matches: Array<{
        sourceSystem: string;
        sourceId: string;
        confidence: number;
        strategyId: string;
        strategyDescription: string;
        matchedAttributes: string[];
        record: Record<string, any>;
      }>;
      summary: { total_matches: number; unique_match_found: boolean; sources_with_match: string[] };
    };

    try {
      const matchResp = await fetch(
        `http://localhost:${PORT_INTERNAL}/api/caes/match`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attributes: matchAttributes }),
        }
      );
      if (!matchResp.ok) throw new Error(`match endpoint returned ${matchResp.status}`);
      const matchBody = (await matchResp.json()) as { success: boolean; data: typeof matchResult };
      matchResult = matchBody.data;
    } catch (_err) {
      // If CAES match is unavailable, proceed as no_match
      matchResult = {
        matches: [],
        summary: { total_matches: 0, unique_match_found: false, sources_with_match: [] },
      };
    }

    const HIGH_CONFIDENCE_THRESHOLD = readFlags().identityMatching.strongMatchThreshold;

    // ── Step 3b: Augment CAES results with a direct connector-DB scan ───────
    // The CAES match engine goes through a per-connector HTTP service which is
    // not available in EFS / Lambda mode.  Direct DB scanning lets the match
    // succeed even when the connector is offline; it covers every registered
    // source system (HR / LDAP / Engineering / Finance) and is treated as
    // authoritative when no CAES results were returned.
    let directMatches: typeof matchResult.matches = [];
    try {
      // First try the live connector HTTP /search endpoint via the
      // ConnectorAPIClient abstraction (same call CAES uses) so we go
      // THROUGH the connector rather than skipping straight to the
      // database.  The async helper falls back to direct SQLite when the
      // connector sidecar is unreachable (EFS / Lambda mode).
      directMatches = await directScanSourcesAsync({
        first_name: first_name.trim(),
        last_name:  last_name.trim(),
        email:      email.trim(),
      }).then(candidates => candidates.map((c: any) => ({
        sourceSystem:        c.sourceSystem,
        sourceId:            c.sourceId,
        confidence:          c.confidence,
        strategyId:          c.strategyId,
        strategyDescription: c.strategyDescription,
        matchedAttributes:   c.matchedAttributes,
        record:              c.record,
      })));
    } catch {
      // Direct scan is best-effort; ignore failures and rely on CAES alone.
      directMatches = [];
    }

    // Merge: prefer direct-scan matches when CAES returned no results for that
    // (sourceSystem, sourceId) tuple.  CAES matches still win when both fire on
    // the same record, since CAES uses the live connector view.
    const caesKeys = new Set(matchResult.matches.map(m => `${m.sourceSystem}:${m.sourceId}`));
    const mergedMatches: typeof matchResult.matches = [
      ...matchResult.matches,
      ...directMatches.filter(m => !caesKeys.has(`${m.sourceSystem}:${m.sourceId}`)),
    ];

    const highConfidenceMatches = mergedMatches.filter(m => m.confidence >= HIGH_CONFIDENCE_THRESHOLD);
    const lowConfidenceMatches  = mergedMatches.filter(m => m.confidence < HIGH_CONFIDENCE_THRESHOLD);
    // Keep matchResult consistent so the rest of the flow (which references
    // matchResult.matches) reflects the merged view.
    matchResult = {
      ...matchResult,
      matches: mergedMatches,
      summary: {
        total_matches: mergedMatches.length,
        unique_match_found: mergedMatches.length > 0,
        sources_with_match: [...new Set(mergedMatches.map(m => m.sourceSystem))],
      },
    };

    // ── Step 4: Determine outcome and act ────────────────────────────────────
    // Helper to record the new identity's source_mappings from the multi-proof
    // list. The first proof is marked primary; subsequent proofs are stored as
    // non-primary so the identity is linked to every departmental identifier
    // the user supplied.
    //
    // IMPORTANT: The user's self-registration email is NOT inserted as an alias
    // here. Aliases represent *confirmed, for-life* identity references — a
    // user-claimed email during self-registration is just a "best guess" that
    // has not yet been verified against any authoritative source. Persisting
    // it as an enabled alias caused typos (e.g. "oah.liu" vs "noah.liu") to
    // become permanent look-up keys. The claim still lives in `metadata.email`
    // for matching, and a verified alias is created when an admin confirms the
    // link to a source record that has a matching email attribute.
    const persistUserLinkages = (
      dbRw: Database.Database,
      gcuid: string,
      now: string,
    ): void => {
      // Dedupe proofs by source_system — a (gcuid, source_system) row should
      // identify the SAME record in the source DB. Two LDAP proofs (e.g. one
      // keyed by username, one by distinguished_name) refer to the same LDAP
      // record; without this filter both would be inserted as separate
      // source_mappings rows and the right details panel would surface the
      // same person twice.  First-wins preserves user-typed order.
      const seenSystems = new Set<string>();
      const dedupedProofs = uniqueProofs.filter((p) => {
        if (seenSystems.has(p.source_system.toLowerCase())) return false;
        seenSystems.add(p.source_system.toLowerCase());
        return true;
      });

      dedupedProofs.forEach((proof, idx) => {
        const isPrimary = idx === 0 ? 1 : 0;
        dbRw.prepare(`
          INSERT OR IGNORE INTO source_mappings
            (gcuid, source_system, source_id, is_primary, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(gcuid, proof.source_system, proof.source_id, isPrimary, now);
      });
    };

    if (highConfidenceMatches.length > 0) {
      // High-confidence matches found — likely an existing person without a GCUID yet,
      // or the match is strong enough to confirm the link.
      // Create a provisional GCUID and mark it for auto-approval path.
      const core  = generateRegistrationCore();
      const gcuid = `urn:gcuid:${core}`;
      const now   = new Date().toISOString();

      // Use the first user-supplied departmental identifier (if any) as the
      // canonical entity_id — the legacy code used email.trim() as a placeholder
      // which leaked PII into a non-PII slot. Fall back to the email only if the
      // user supplied no departmental identifiers at all.
      const primaryEntityId = uniqueProofs[0]?.source_id ?? email.trim();

      const dbRw = new Database(REGISTRY_DB);

      // Strip the full source-system row from each match before persisting.
      // The full record is reachable via source_mapping → connector lookup,
      // so storing only the match summary is sufficient and avoids the
      // right-pane showing an uninterpreted JSON blob (see C-5).
      const matchSummaries = highConfidenceMatches.map(summarizeMatch);

      // Compute metadata object so the identity row can be inserted FIRST
      // (so the parent row exists before we write child rows in
      // `aliases` and `source_mappings`, both of which FK to `identities.gcuid`).
      const metadata = {
        self_registered: true,
        email,
        first_name,
        last_name,
        high_confidence_match: true,
        matches: matchSummaries,
      };

      dbRw.prepare(`
        INSERT INTO identities
          (gcuid, state, identifier_state, entity_type, entity_id, namespace, created_at, updated_at, metadata)
        VALUES (?, 'provisional', 'reserved', 'person', ?, 'gc', ?, ?, ?)
      `).run(gcuid, primaryEntityId, now, now, JSON.stringify(metadata));

      persistUserLinkages(dbRw, gcuid, now);

      dbRw.prepare(`
        INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
        VALUES (?, NULL, 'provisional', 'create', 'Self-service registration — high confidence match', ?, ?)
      `).run(gcuid, req.ip ?? 'user', now);

      dbRw.prepare(`
        INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
        VALUES (?, NULL, 'reserved', 'create', ?, 'Self-service registration', ?)
      `).run(gcuid, req.ip ?? 'user', now);

      // Persist source_mappings for confirmed high-confidence CAES matches.
            //
            // SECURITY-CRITICAL: do not blindly map every high-confidence candidate
            // to this new identity. The connector-http-search path can return a
            // candidate that only matched on a single attribute (e.g. shared first
            // name) and label it as "high confidence" via a hardcoded heuristic.
            // Even with the upstream confidence fix, an extra consistency check
            // here ensures we never bind to a record whose email or last name
            // disagrees with the user's self-claim — see
            // urn:gcuid:01KVTQ3VK5VVJZWTYK6AKGE8WN (Lucas O'Neill incorrectly
            // mapped to Lucas Pham / E30039 via a first-name-only collision).
            const claimedEmail    = email.trim().toLowerCase();
            const claimedLastName = last_name.trim().toLowerCase();
            const claimedFirstName= first_name.trim().toLowerCase();
            const isConsistentMatch = (m: typeof highConfidenceMatches[number]): boolean => {
              const rec = (m.record ?? {}) as Record<string, unknown>;
              const recEmail    = String(rec['email'] ?? rec['email_address'] ?? '').trim().toLowerCase();
              const recLastName = String(rec['last_name'] ?? rec['surname']    ?? '').trim().toLowerCase();
              const recFirstName= String(rec['first_name'] ?? rec['given_name'] ?? '').trim().toLowerCase();

              // Email is functionally unique. If both sides supplied an email,
              // they MUST agree.
              if (claimedEmail && recEmail) {
                return recEmail === claimedEmail;
              }
              // Without email, require first AND last name to agree. First-name
              // only matches are too common to auto-link.
              if (claimedFirstName && claimedLastName) {
                return recFirstName === claimedFirstName && recLastName === claimedLastName;
              }
              // Claimed name is incomplete — be conservative and skip auto-link.
              return false;
            };

            // When auto-binding high-confidence matches to source_mappings, the LDAP
            // matcher can return TWO entries for the same physical record (one
            // keyed by username, one by distinguished_name). Without dedup,
            // both rows land in source_mappings and the right details panel
            // surfaces the same person twice. Filter to first-wins per
            // (sourceSystem) so multi-form LDAP matches collapse into a single
            // auto-bound mapping. Metadata.matches still records every CAES
            // match for the admin review panel.
            const seenAutoBoundSystems = new Set<string>();
            for (const match of highConfidenceMatches) {
              if (!isConsistentMatch(match)) {
                // Don't drop the candidate silently — keep it in metadata.matches
                // for the admin review panel so they can see what CAES surfaced.
                // We just don't bind a source_mapping.
                continue;
              }
              const sysKey = match.sourceSystem.toLowerCase();
              if (seenAutoBoundSystems.has(sysKey)) continue;
              seenAutoBoundSystems.add(sysKey);
              dbRw.prepare(
                'INSERT OR IGNORE INTO source_mappings (gcuid, source_system, source_id, is_primary, created_at) VALUES (?, ?, ?, 0, ?)'
              ).run(gcuid, match.sourceSystem, match.sourceId, now);
            }

            // Generate an email alias from the authoritative source for
            // person.email (LDAP in this codebase).  Mirrors the
            // link_existing path in gcuid-request.ts so self-registered
            // identities get a verified email alias on creation, not only
            // on a subsequent portal-link.
            try {
              const emailAttr = dbRw.prepare(`
                SELECT source_system, source_field, source_table, key_field FROM attribute_mappings
                WHERE standard_attribute = 'person.email' AND is_authoritative = 1
                LIMIT 1
              `).get() as
                | { source_system: string; source_field: string; source_table: string; key_field: string }
                | undefined;
              if (emailAttr) {
                const autoBoundMappings = dbRw.prepare(`
                  SELECT id, source_id FROM source_mappings
                  WHERE gcuid = ? AND source_system = ?
                  ORDER BY id
                `).all(gcuid, emailAttr.source_system) as { id: number; source_id: string }[];
                let emailValue: string | undefined;
                for (const sm of autoBoundMappings) {
                  try {
                    const v = await connectorResolver.resolveAttribute(
                      emailAttr.source_system,
                      sm.source_id,
                      {
                        sourceField: emailAttr.source_field,
                        sourceTable: emailAttr.source_table,
                        keyField:    emailAttr.key_field,
                      }
                    );
                    if (v !== undefined && v !== null && String(v).trim() !== '') {
                      emailValue = String(v).trim();
                      break;
                    }
                  } catch { /* try next mapping */ }
                }
                if (emailValue) {
                  dbRw.prepare(`
                    INSERT OR IGNORE INTO aliases
                      (gcuid, alias_type, alias_value, status, created_at, metadata)
                    VALUES (?, 'email', ?, 'enabled', ?, ?)
                  `).run(gcuid, emailValue, now, JSON.stringify({
                    source: 'self_register_auto_bind',
                    backfill_run_at: now,
                  }));
                }
              }
            } catch (aliasErr) {
              // Alias generation is best-effort.  Don't fail the registration
              // if a connector lookup hiccups — the source_mappings are the
              // source of truth, and the alias can be backfilled later.
              console.warn('[self-register] email alias generation skipped:', aliasErr);
            }

      dbRw.close();

      return res.status(201).json({
        success: true,
        data: {
          outcome: 'high_confidence_match',
          gcuid,
          identity_state: 'provisional',
          identifier_state: 'reserved',
          matches: matchSummaries,
          message: 'Your identity was matched in our authoritative sources. A provisional GCUID has been created and is pending final approval.',
        },
      });
    }

    if (lowConfidenceMatches.length > 0) {
      // Possible matches found but not conclusive — create provisional and flag for review
      const core  = generateRegistrationCore();
      const gcuid = `urn:gcuid:${core}`;
      const now   = new Date().toISOString();

      // Snapshot the candidate linkages into metadata so admin review panel can show them immediately
      const pendingLinkages = lowConfidenceMatches.map(match => {
        const rec = (match.record ?? {}) as Record<string, unknown>;
        return {
          source_system: match.sourceSystem,
          source_id:     match.sourceId,
          first_name:    String(rec['first_name'] ?? rec['given_name'] ?? ''),
          last_name:     String(rec['last_name']  ?? rec['surname']    ?? ''),
          email:         String(rec['email']      ?? rec['email_address'] ?? ''),
          match_score:   match.confidence,
          match_reasons: match.matchedAttributes ?? [],
        };
      });

      // Use the first user-supplied departmental identifier (if any) as the
      // canonical entity_id for the same reason as the high-confidence branch.
      const primaryEntityId = uniqueProofs[0]?.source_id ?? email.trim();

      const dbRw = new Database(REGISTRY_DB);

      // Insert identity row FIRST so that the FK parent exists before the
      // child rows written by `persistUserLinkages` (aliases /
      // source_mappings).
      const metadata = {
        self_registered: true,
        email,
        first_name,
        last_name,
        potential_match: true,
        pending_linkages: pendingLinkages,
      };

      dbRw.prepare(`
        INSERT INTO identities
          (gcuid, state, identifier_state, entity_type, entity_id, namespace, created_at, updated_at, metadata)
        VALUES (?, 'under_review', 'reserved', 'person', ?, 'gc', ?, ?, ?)
      `).run(gcuid, primaryEntityId, now, now, JSON.stringify(metadata));

      persistUserLinkages(dbRw, gcuid, now);

      dbRw.prepare(`
        INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
        VALUES (?, NULL, 'under_review', 'create', 'Self-service registration — ambiguous match, requires review', ?, ?)
      `).run(gcuid, req.ip ?? 'user', now);

      dbRw.prepare(`
        INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
        VALUES (?, NULL, 'reserved', 'create', ?, 'Self-service registration (pending review)', ?)
      `).run(gcuid, req.ip ?? 'user', now);

      dbRw.close();

      return res.status(201).json({
        success: true,
        data: {
          outcome: 'low_confidence_match',
          gcuid,
          identity_state: 'under_review',
          identifier_state: 'reserved',
          matches: lowConfidenceMatches.map(summarizeMatch),
          message: 'Possible existing records were found that may match your details. Your registration has been submitted for manual review by an administrator.',
        },
      });
    }

    // ── No match at all — create fresh provisional GCUID ──────────────────────
    const core  = generateRegistrationCore();
    const gcuid = `urn:gcuid:${core}`;
    const now   = new Date().toISOString();

    // Use the first user-supplied departmental identifier (if any) as the
    // canonical entity_id, falling back to email only when the user supplied
    // no identifiers at all. Persist all user-supplied proofs as
    // source_mappings via the shared helper so this branch is symmetric with
    // the high/low-confidence branches.
    const primaryEntityId = uniqueProofs[0]?.source_id ?? email.trim();

    const dbRw = new Database(REGISTRY_DB);

    // Insert identity row FIRST so the FK parent exists before the
    // child rows written by `persistUserLinkages` (aliases /
    // source_mappings).
    const metadata = { self_registered: true, email, first_name, last_name };

    dbRw.prepare(`
      INSERT INTO identities
        (gcuid, state, identifier_state, entity_type, entity_id, namespace, created_at, updated_at, metadata)
      VALUES (?, 'provisional', 'reserved', 'person', ?, 'gc', ?, ?, ?)
    `).run(gcuid, primaryEntityId, now, now, JSON.stringify(metadata));

    persistUserLinkages(dbRw, gcuid, now);

    dbRw.prepare(`
      INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
      VALUES (?, NULL, 'provisional', 'create', 'Self-service registration — no prior record found', ?, ?)
    `).run(gcuid, req.ip ?? 'user', now);

    dbRw.prepare(`
      INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
      VALUES (?, NULL, 'reserved', 'create', ?, 'Self-service registration', ?)
    `).run(gcuid, req.ip ?? 'user', now);

    dbRw.close();

    return res.status(201).json({
      success: true,
      data: {
        outcome: 'no_match',
        gcuid,
        identity_state: 'provisional',
        identifier_state: 'reserved',
        matches: [],
        message: 'No existing record was found. A new provisional GCUID has been created for your identity.',
      },
    });
  } catch (error) { next(error); }
});

export { router as userRoutes };

