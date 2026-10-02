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
 * Admin API Routes
 * 
 * Central registry administrator endpoints for identity management
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { createError } from '../middleware/error.js';
import { readFlags } from './flags.js';
import { loadConnectorConfig, connectorResolver } from '../lib/connector-resolver.js';
import { logRegistry } from '../lib/logging/logger.js';
import { REGISTRY_EVENTS } from '../lib/logging/log-events.js';
import { resolveAttributesForGcuid } from './caes.js';
import { resolveToGcuid } from '../lib/resolve-identifier.js';

import { REGISTRY_DB_PATH as REGISTRY_DB, connectorDbPath } from '../lib/db-paths.js';
import fs from 'fs';

// Connector schema descriptors — defines how to query each source system's DB
// for canonical name + email.  Priority order: hr > ldap > engineering > finance.
const CONNECTOR_SCHEMAS: Record<string, { table: string; pkCol: string }> = {
  'conn-hr':          { table: 'employees', pkCol: 'employee_id' },
  'conn-ldap':        { table: 'users',     pkCol: 'username'    },
  'conn-engineering': { table: 'employees', pkCol: 'dept_id'     },
  'conn-finance':     { table: 'employees', pkCol: 'dept_id'     },
};
const SOURCE_PRIORITY = ['hr', 'ldap', 'engineering', 'finance'];

const router = Router();

// ─── Actor resolution ─────────────────────────────────────────────────────────
// Prefer the forwarded identity (set by the Cognito/Lambda@Edge middleware in
// production).  In local development there is no auth middleware so req.ip is
// used instead; ::1 and 127.0.0.1 are normalised to 'localhost' so they appear
// readable in the audit log rather than as a raw IPv6 loopback address.
function getActor(req: Request, res: Response): string {
  const email = res.locals['noetroniqEmail'];
  if (email && typeof email === 'string') return email;
  const ip = req.ip ?? 'system';
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') return 'localhost';
  return ip;
}

// ─── Lazy database accessors (module-level) ───────────────────────────────────
// Defer Database() construction so that EFS first-run seeding in
// lambda-handler.js has time to run before any DB file is opened.

let _REGISTRY_DB_RW_ID: InstanceType<typeof Database> | null = null;
let _REGISTRY_DB_RW_SYSTEMS: InstanceType<typeof Database> | null = null;

function getRegistryDbRwId(): InstanceType<typeof Database> {
  if (!_REGISTRY_DB_RW_ID) _REGISTRY_DB_RW_ID = new Database(REGISTRY_DB);
  return _REGISTRY_DB_RW_ID;
}
function getRegistryDbRwSystems(): InstanceType<typeof Database> {
  if (!_REGISTRY_DB_RW_SYSTEMS) _REGISTRY_DB_RW_SYSTEMS = new Database(REGISTRY_DB);
  return _REGISTRY_DB_RW_SYSTEMS;
}

// ─── Alias param resolution ───────────────────────────────────────────────────
// When aliases are enabled in Options, any route that accepts a :gcuid path
// parameter will also accept an alias value — the middleware below transparently
// resolves it to the canonical GCUID before the route handler runs.
router.param('gcuid', (_req: Request, _res: Response, next: NextFunction, value: string) => {
  _req.params.gcuid = resolveToGcuid(value);
  next();
});

// ─── Alias generation helpers (ISO 7064 MOD 37,36 + Crockford Base32) ─────────
const CROCKFORD_ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECKSUM_ALPHA  = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function _hashCore(core: string): string {
  const normalized = core.toUpperCase().replace(/-/g, '');
  const hash = crypto.createHash('sha256').update(normalized).digest();
  let bits = '';
  for (const byte of hash.slice(0, 8)) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < 60; i += 5) result += CROCKFORD_ALPHA[parseInt(bits.slice(i, i + 5), 2)];
  return result.slice(0, 12);
}

function _checksum(data: string): string {
  const norm = data.toUpperCase().replace(/-/g, '');
  const MOD = 37;
  let c = MOD;
  for (const ch of norm) {
    const v = CHECKSUM_ALPHA.indexOf(ch);
    if (v === -1) throw new Error(`Invalid checksum char: ${ch}`);
    c = ((c + v) * 2) % MOD;
  }
  const idx = (MOD - c + 1) % MOD;
  return CHECKSUM_ALPHA[idx % CHECKSUM_ALPHA.length];
}

function buildGCAlias(core: string, context: string): string {
  const h = _hashCore(core);
  const hf = `${h.slice(0,4)}-${h.slice(4,8)}-${h.slice(8,12)}`;
  return `GC-${context}-${hf}-${_checksum(`GC${context}${h}`)}`;
}

function attachAliases(db: InstanceType<typeof Database>, identities: any[]): void {
  if (identities.length === 0) return;
  const placeholders = identities.map(() => '?').join(',');
  const gcuids = identities.map((i: any) => i.gcuid);
  const rows = db.prepare(
    `SELECT id, gcuid, alias_type, alias_value, created_at FROM aliases WHERE gcuid IN (${placeholders}) AND status = 'enabled' ORDER BY created_at ASC`
  ).all(...gcuids) as any[];
  const map: Record<string, any[]> = {};
  for (const r of rows) { (map[r.gcuid] ??= []).push(r); }
  for (const id of identities) id.aliases = map[id.gcuid] ?? [];
}

// ─── GCUID generation helpers (Crockford and Standard Base32) ────────────────
const STD_B32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Generate a 26-character Base32 core identifier. */
function generateCore(coreIdType: 'ulid' | 'uuid', encoding: 'crockford' | 'standard'): string {
  const alpha = encoding === 'crockford' ? CROCKFORD_ALPHA : STD_B32_ALPHA;
  if (coreIdType === 'ulid') {
    // ULID: 48-bit timestamp (10 chars) + 80-bit random (16 chars), native Crockford
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
      // re-encode Crockford → Standard Base32
      let val = 0n;
      for (const ch of core) val = val * 32n + BigInt(CROCKFORD_ALPHA.indexOf(ch));
      let result = '';
      for (let i = 25; i >= 0; i--) result = STD_B32_ALPHA[Number((val >> BigInt(i * 5)) & 31n)] + result;
      return result;
    }
    return core;
  } else {
    // UUID v4: 16 random bytes encoded as 26 Base32 chars (128 bits → 130-bit encoding)
    const bytes = crypto.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    let val = 0n;
    for (const b of bytes) val = (val << 8n) | BigInt(b);
    val = val << 2n; // pad to 130 bits (26 × 5)
    let result = '';
    for (let i = 25; i >= 0; i--) result = alpha[Number((val >> BigInt(i * 5)) & 31n)] + result;
    return result;
  }
}

/** Assemble a GCUID URN from format, entity type, namespace and core. */
function buildGCUID(format: 'v1' | 'v2', entityType: string, namespace: string, core: string): string {
  return format === 'v1'
    ? `urn:${namespace}:${entityType}:1:${core}`
    : `urn:gcuid:${core}`;
}

/**
 * POST /api/gcuid/register
 *
 * Mint a new GCUID and register a brand-new identity row in the
 * registry. Three call patterns:
 *
 * 1. **Auto-format**: omit `format` / `core_id_type` / `encoding`
 *    — resolved from `readFlags().gcuidGeneration`.
 * 2. **Explicit-format**: pass `format: 'v1' | 'v2'`,
 *    `core_id_type: 'ulid' | 'uuid'`, `encoding: 'crockford' | 'standard'`.
 * 3. **Source-link registration**: include `source_links[]` to
 *    atomically bind authoritative-source IDs in the same call.
 *
 * Validation:
 * - `entity_type` ∈ `['person', 'org', 'asset', 'app', 'agent']`.
 * - Each `source_link` must have non-empty `source_system` and `source_id`.
 * - If `entity_id` is provided, must not conflict with an existing identity.
 * - Each `(source_system, source_id)` pair must be unused.
 *
 * The new identity starts with BOTH state dimensions set explicitly:
 * `state = 'provisional'`, `identifier_state = 'reserved'`. A
 * `state_history` and `identifier_state_history` row are written
 * to record the creation. Logs `IDENTITY_REQUEST_RECEIVED` (info)
 * and `IDENTITY_CREATED` (notice).
 *
 * @route   POST /api/gcuid/register
 * @body    `{ entity_type, entity_id?, namespace? = 'gc', metadata?, source_links?: { source_system, source_id, is_primary? }[], format?, core_id_type?, encoding? }`
 * @returns 201 — `{ success: true, data: IdentityWithAliasesAndSourceMappings }`
 * @throws  400 — `entity_type must be one of: ...` or missing `source_link.source_system`/`source_id`.
 * @throws  409 — `An identity with entity_id "X" already exists` or `Source ID "Y" in "Z" is already linked to another GCUID`.
 * @throws  500 — DB write failure.
 */
router.post('/register', (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      entity_type,
      entity_id,
      namespace = 'gc',
      metadata,
      source_links = [],
      format,
      core_id_type,
      encoding,
    } = req.body as {
      entity_type?: string;
      entity_id?: string;
      namespace?: string;
      metadata?: Record<string, any>;
      source_links?: Array<{ source_system: string; source_id: string; is_primary?: boolean }>;
      format?:       'v1' | 'v2';
      core_id_type?: 'ulid' | 'uuid';
      encoding?:     'crockford' | 'standard';
    };

    // Validate entity_type
    const VALID_TYPES = ['person', 'org', 'asset', 'app', 'agent'];
    if (!entity_type || !VALID_TYPES.includes(entity_type)) {
      logRegistry('warning', REGISTRY_EVENTS.REQUEST_VALIDATION_FAILED, {
        component:    'api:admin',
        request_id:   (req as any).requestId,
        error_detail: `entity_type must be one of: ${VALID_TYPES.join(', ')}`,
      });
      throw createError(`entity_type must be one of: ${VALID_TYPES.join(', ')}`, 400);
    }

    // Validate source_links shape
    for (const link of source_links) {
      if (!link.source_system?.trim()) throw createError('Each source_link must have a source_system', 400);
      if (!link.source_id?.trim())     throw createError('Each source_link must have a source_id', 400);
    }

    const db = new Database(REGISTRY_DB);

    // entity_id uniqueness check (if provided)
    if (entity_id?.trim()) {
      const conflict = db.prepare('SELECT gcuid FROM identities WHERE entity_id = ?').get(entity_id.trim());
      if (conflict) {
        db.close();
        throw createError(`An identity with entity_id "${entity_id.trim()}" already exists`, 409);
      }
    }

    // source_id uniqueness check per source_system
    for (const link of source_links) {
      const conflict = db.prepare(
        'SELECT gcuid FROM source_mappings WHERE source_system = ? AND source_id = ?'
      ).get(link.source_system.trim(), link.source_id.trim());
      if (conflict) {
        db.close();
        throw createError(
          `Source ID "${link.source_id.trim()}" in "${link.source_system.trim()}" is already linked to another GCUID`,
          409
        );
      }
    }

    const sysGen        = readFlags().gcuidGeneration;
    const resolvedFormat = (format === 'v1' || format === 'v2') ? format : sysGen.format;
    const resolvedCore   = (core_id_type === 'ulid' || core_id_type === 'uuid') ? core_id_type : sysGen.coreIdType;
    const resolvedEncode = (encoding === 'crockford' || encoding === 'standard') ? encoding : sysGen.encoding;
    const coreId         = generateCore(resolvedCore, resolvedEncode);
    const gcuid          = buildGCUID(resolvedFormat, entity_type, namespace?.trim() || 'gc', coreId);
    const now     = new Date().toISOString();
    const metaStr = metadata ? JSON.stringify(metadata) : null;

    // identity record — both state dimensions set explicitly
    db.prepare(
      `INSERT INTO identities
         (gcuid, state, identifier_state, entity_type, entity_id, namespace, created_at, updated_at, metadata)
       VALUES (?, 'provisional', 'reserved', ?, ?, ?, ?, ?, ?)`
    ).run(gcuid, entity_type, entity_id?.trim() ?? null, (namespace?.trim() || 'gc'), now, now, metaStr);

    // identity state history
    db.prepare(
      `INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
       VALUES (?, NULL, 'provisional', 'create', 'Initial registration', 'admin', ?)`
    ).run(gcuid, now);

    // identifier state history
    db.prepare(
      `INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
       VALUES (?, NULL, 'reserved', 'create', 'admin', 'Initial registration', ?)`
    ).run(gcuid, now);

    for (const link of source_links) {
      db.prepare(
        `INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(gcuid, link.source_system.trim(), link.source_id.trim(), link.is_primary ? 1 : 0, now);
    }

    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    identity.aliases = [];
    identity.source_mappings = source_links;
    if (identity.metadata) {
      try { identity.metadata = JSON.parse(identity.metadata); } catch { /* leave as string */ }
    }
    db.close();

    logRegistry('info', REGISTRY_EVENTS.IDENTITY_REQUEST_RECEIVED, {
      component:      'api:admin',
      actor_id:       (getActor(req, res)),
      actor_type:     'admin',
      transaction_id: (req as any).requestId,
      request_id:     (req as any).requestId,
    });
    logRegistry('notice', REGISTRY_EVENTS.IDENTITY_CREATED, {
      component:      'api:admin',
      gcuid,
      actor_id:       (getActor(req, res)),
      actor_type:     'admin',
      transaction_id: (req as any).requestId,
      request_id:     (req as any).requestId,
    });

    res.status(201).json({ success: true, data: identity });
  } catch (error) { next(error); }
});

/**
 * GET /api/gcuid/list?state=active&entity_type=person&limit=100
 *
 * List all identities in the registry. Optional query-string
 * filters narrow by lifecycle `state` (`provisional` / `active` /
 * `suspended` / `retired` / `archived`) and `entity_type`
 * (`person` / `organisation` / `device` / …). `limit` caps the
 * row count (default 100).
 *
 * Aliases are attached via `attachAliases()`, generated-alias
 * (`GC-*`) filtering respects the `aliases.generated` feature
 * flag. `metadata` JSON columns are parsed in-place where present;
 * unparseable rows fall through as raw strings (no error).
 *
 * Logs `REGISTRY_EVENTS.IDENTITY_LISTED` at `debug`.
 *
 * @route   GET /api/gcuid/list
 * @query   state       — optional lifecycle state filter.
 * @query   entity_type — optional entity-type filter.
 * @query   limit       — max rows (default 100).
 * @returns 200 — `{ success: true, data: Identity[], count: number }`.
 * @throws  500 — DB read failure.
 */
router.get('/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const state       = req.query.state       as string | undefined;
    const entity_type = req.query.entity_type as string | undefined;
    const limit       = parseInt(req.query.limit as string) || 100;

    const db = new Database(REGISTRY_DB, { readonly: true });

    let identities: any[];
    if (state && entity_type) {
      identities = db.prepare(
        'SELECT * FROM identities WHERE state = ? AND entity_type = ? LIMIT ?'
      ).all(state, entity_type, limit) as any[];
    } else if (state) {
      identities = db.prepare(
        'SELECT * FROM identities WHERE state = ? LIMIT ?'
      ).all(state, limit) as any[];
    } else if (entity_type) {
      identities = db.prepare(
        'SELECT * FROM identities WHERE entity_type = ? LIMIT ?'
      ).all(entity_type, limit) as any[];
    } else {
      identities = db.prepare('SELECT * FROM identities LIMIT ?').all(limit) as any[];
    }

    attachAliases(db, identities);
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

    logRegistry('debug', REGISTRY_EVENTS.IDENTITY_LISTED, {
      component:  'api:admin',
      actor_id:   (getActor(req, res)),
      actor_type: 'admin',
      request_id: (req as any).requestId,
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
 * GET /api/gcuid/view/:gcuid?withHistory=true
 *
 * View a single identity, plus its aliases and (when
 * `withHistory=true`) the full state-transition history. Aliases
 * are filtered through `readFlags().aliases.generated` — when
 * generated aliases are disabled, `GC-*` rows are omitted.
 *
 * Logs `REGISTRY_EVENTS.IDENTITY_VIEWED` (debug) on success;
 * `REGISTRY_EVENTS.IDENTITY_NOT_FOUND` (info) on miss.
 *
 * @route   GET /api/gcuid/view/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @query   withHistory — `'true'` to include the `history` array (otherwise `history: null`).
 * @returns 200 — `{ success: true, data: { identity: Identity, aliases: Alias[], history: StateHistory[] | null } }`.
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB read failure.
 */
router.get('/view/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const withHistory = req.query.withHistory === 'true';
    
    const db = new Database(REGISTRY_DB, { readonly: true });
    
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    
    if (!identity) {
      db.close();
      logRegistry('info', REGISTRY_EVENTS.IDENTITY_NOT_FOUND, {
        component:  'api:admin',
        target_id:  gcuid,
        actor_id:   (getActor(req, res)),
        request_id: (req as any).requestId,
      });
      throw createError('Identity not found', 404);
    }
    
    // Parse metadata
    if (identity.metadata) {
      try {
        identity.metadata = JSON.parse(identity.metadata);
      } catch (e) {
        // Leave as string
      }
    }

    // Attach all aliases
    let allAliases = db.prepare(
      'SELECT id, gcuid, alias_type, alias_value, status, created_at FROM aliases WHERE gcuid = ? ORDER BY created_at ASC'
    ).all(gcuid) as any[];
    if (!readFlags().aliases.generated) {
      allAliases = allAliases.filter((a: any) => !String(a.alias_type ?? '').startsWith('GC-'));
    }
    identity.aliases = allAliases;
    
    let history = null;
    if (withHistory) {
      history = db.prepare(`
        SELECT id, gcuid, from_state, to_state, transition_type,
               reason, actor AS changed_by, timestamp AS changed_at
        FROM state_history
        WHERE gcuid = ?
        ORDER BY timestamp DESC
      `).all(gcuid);
    }
    
    db.close();
    
    logRegistry('debug', REGISTRY_EVENTS.IDENTITY_VIEWED, {
      component:  'api:admin',
      gcuid,
      actor_id:   (getActor(req, res)),
      actor_type: 'admin',
      request_id: (req as any).requestId,
    });

    res.json({
      success: true,
      data: {
        identity,
        history
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gcuid/subject/:gcuid
 *
 * Unified subject record — the policy-aware bundle of identity,
 * aliases, source mappings, and CAES-resolved non-sensitive
 * attributes for a single GCUID, returned in a single response.
 *
 * Resolves these standard attributes for the subject (and reports
 * which sources contributed): `person.name.given`, `person.name.family`,
 * `person.name.display`, `person.email`, `person.employment.department`,
 * `person.employment.hireDate`, `person.employment.status`,
 * `person.account.username`, `person.account.enabled`, `person.account.groups`,
 * `person.account.lastLogon`, `person.account.dn`, `person.job.title`.
 *
 * @route   GET /api/gcuid/subject/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @returns 200 — `{ success: true, data: { gcuid, subject: { entity_type, entity_id, namespace, state, identifier_state, created_at, updated_at, metadata }, aliases, source_mappings, attributes, sources_used, disabled_sources } }`.
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB or CAES resolution failure.
 */
router.get('/subject/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const db = new Database(REGISTRY_DB, { readonly: true });

    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) {
      db.close();
      logRegistry('info', REGISTRY_EVENTS.IDENTITY_NOT_FOUND, {
        component:  'api:admin',
        target_id:  gcuid,
        actor_id:   (getActor(req, res)),
        request_id: (req as any).requestId,
      });
      throw createError('Identity not found', 404);
    }

    if (identity.metadata) {
      try { identity.metadata = JSON.parse(identity.metadata); } catch { /* leave as string */ }
    }

    let aliases = db.prepare(
      'SELECT id, gcuid, alias_type, alias_value, status, created_at FROM aliases WHERE gcuid = ? ORDER BY created_at ASC'
    ).all(gcuid) as any[];
    if (!readFlags().aliases.generated) {
      aliases = aliases.filter((a: any) => !String(a.alias_type ?? '').startsWith('GC-'));
    }

    const sourceMappings = db.prepare(
      'SELECT source_system, source_id, is_primary, created_at FROM source_mappings WHERE gcuid = ?'
    ).all(gcuid) as any[];

    db.close();

    // Resolve all non-sensitive CAES attributes for this subject
    const SUBJECT_ATTRIBUTES = [
      'person.name.given', 'person.name.family', 'person.name.display',
      'person.email', 'person.employment.department', 'person.employment.hireDate',
      'person.employment.status', 'person.account.username', 'person.account.enabled',
      'person.account.groups', 'person.account.lastLogon', 'person.account.dn',
      'person.job.title',
    ];

    const attrResult = await resolveAttributesForGcuid(gcuid, SUBJECT_ATTRIBUTES);

    logRegistry('debug', REGISTRY_EVENTS.IDENTITY_VIEWED, {
      component:  'api:admin',
      gcuid,
      actor_id:   (getActor(req, res)),
      actor_type: 'admin',
      request_id: (req as any).requestId,
    });

    res.json({
      success: true,
      data: {
        gcuid,
        subject: {
          entity_type:      identity.entity_type,
          entity_id:        identity.entity_id,
          namespace:        identity.namespace,
          state:            identity.state,
          identifier_state: identity.identifier_state,
          created_at:       identity.created_at,
          updated_at:       identity.updated_at,
          metadata:         identity.metadata,
        },
        aliases,
        source_mappings:  sourceMappings,
        attributes:       attrResult.attributes,
        sources_used:     attrResult.sources_used,
        disabled_sources: attrResult.disabled_sources,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/gcuid/attributes/:gcuid
 *
 * Apply a CAES-attribute update received from an authoritative
 * source (e.g. HR, LDAP, Procurement) to the canonical identity
 * record. The update is deep-merged into the existing `metadata`
 * JSON column; `metadata` is not replaced wholesale.
 *
 * Empty or non-object `attributes` bodies are rejected. Each
 * successful merge is recorded via `IDENTITY_ATTRIBUTES_UPDATED`
 * (notice-level) for the audit trail.
 *
 * @route   PATCH /api/gcuid/attributes/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ attributes: Record<string, any>, source_system?: string, reason?: string }`
 * @returns 200 — `{ success: true, data: Identity }` after the deep-merge.
 * @throws  400 — `"attributes" object is required` or `"attributes" must not be empty`.
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB write failure.
 */
router.patch('/attributes/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const { attributes, source_system, reason } = req.body as {
      attributes?: Record<string, any>;
      source_system?: string;
      reason?: string;
    };

    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw createError('"attributes" object is required', 400);
    }
    if (Object.keys(attributes).length === 0) {
      throw createError('"attributes" must not be empty', 400);
    }

    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    const identity = registryDb.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) {
      registryDb.close();
      throw createError('Identity not found', 404);
    }

    const sourceMappings = registryDb.prepare(
      'SELECT source_system, source_id FROM source_mappings WHERE gcuid = ?'
    ).all(gcuid) as Array<{ source_system: string; source_id: string }>;

    const allMappings = registryDb.prepare('SELECT * FROM attribute_mappings').all() as any[];
    registryDb.close();

    const now = new Date().toISOString();
    const updatedAttributes: string[] = [];
    const failedAttributes: Record<string, string> = {};

    for (const [attrName, value] of Object.entries(attributes)) {
      // Find a writable mapping for this attribute (prefer the requested source_system if specified)
      const candidateMappings = allMappings.filter((m: any) =>
        m.standard_attribute === attrName &&
        (source_system ? m.source_system === source_system : true)
      );

      let written = false;
      for (const mapping of candidateMappings) {
        const srcRecord = sourceMappings.find(s => s.source_system === mapping.source_system);
        if (!srcRecord) continue;
        try {
          await connectorResolver.updateAttribute(
            mapping.source_system,
            srcRecord.source_id,
            mapping.source_field,
            value
          );
          updatedAttributes.push(attrName);
          written = true;
          break;
        } catch (err: any) {
          failedAttributes[attrName] = err.message ?? 'Connector write failed';
        }
      }
      if (!written && !failedAttributes[attrName]) {
        failedAttributes[attrName] = 'No source mapping found for this identity';
      }
    }

    // Write audit entry if any attributes succeeded
    if (updatedAttributes.length > 0) {
      const auditDb = new Database(REGISTRY_DB);
      try {
        auditDb.prepare(
          `INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
           VALUES (?, ?, ?, 'attribute_sync', ?, ?, ?)`
        ).run(
          gcuid,
          identity.state,
          identity.state,
          reason ?? `Attribute sync from ${source_system ?? 'admin'}`,
          source_system ?? 'admin',
          now,
        );
      } finally {
        auditDb.close();
      }
    }

    logRegistry('notice', REGISTRY_EVENTS.ADMIN_BULK_ACTION, {
      component:  'api:admin',
      actor_id:   (getActor(req, res)),
      actor_type: 'admin',
      context:    JSON.stringify({ gcuid, attribute_count: updatedAttributes.length, source_system: source_system ?? 'admin' }),
      request_id: (req as any).requestId,
    });

    res.json({
      success: updatedAttributes.length > 0,
      data: {
        gcuid,
        updated_attributes: updatedAttributes,
        source_system:      source_system ?? null,
        synced_at:          now,
        ...(Object.keys(failedAttributes).length > 0 ? { failed: failedAttributes } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gcuid/search?q=query&limit=10
 *
 * Full-text-ish search across identity fields. Matches the query
 * (substring, case-insensitive) against `gcuid`, `entity_id`,
 * `metadata`, and any `enabled` alias's `alias_value`. Aliases
 * attached via `attachAliases()`; metadata parsed in-place.
 *
 * @route   GET /api/gcuid/search
 * @query   q     — required search term.
 * @query   limit — max rows (default 10).
 * @returns 200 — `{ success: true, data: Identity[], count: number }`.
 * @throws  400 — `Query parameter "q" is required`.
 * @throws  500 — DB read failure.
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
      SELECT DISTINCT i.* FROM identities i
      LEFT JOIN aliases a ON a.gcuid = i.gcuid AND a.status = 'enabled'
      WHERE i.gcuid LIKE ?
         OR i.entity_id LIKE ?
         OR i.metadata LIKE ?
         OR a.alias_value LIKE ?
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];

    attachAliases(db, identities);

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
 * GET /api/gcuid/audit?gcuid=...
 *
 * List every `state_history` row, newest first. Optional `gcuid`
 * query parameter filters to a single identity. Unlike the
 * `audit/:auditGcuid` route, this endpoint returns the
 * identity-lifecycle stream only (no identifier transitions).
 *
 * @route   GET /api/gcuid/audit
 * @query   gcuid — optional GCUID filter.
 * @returns 200 — `{ success: true, data: StateHistory[] }` sorted DESC by `timestamp`.
 * @throws  500 — DB read failure.
 */
router.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gcuidFilter = req.query.gcuid as string | undefined;

    const db = new Database(REGISTRY_DB, { readonly: true });

    const rows = gcuidFilter
      ? (db.prepare(`
          SELECT id, gcuid, from_state, to_state, transition_type, reason, actor AS changed_by, timestamp AS changed_at
          FROM state_history
          WHERE gcuid = ?
          ORDER BY timestamp DESC
        `).all(gcuidFilter) as any[])
      : (db.prepare(`
          SELECT id, gcuid, from_state, to_state, transition_type, reason, actor AS changed_by, timestamp AS changed_at
          FROM state_history
          ORDER BY timestamp DESC
        `).all() as any[]);

    db.close();

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gcuid/audit/:auditGcuid
 *
 * Full audit trail for one identity, merging BOTH the identity
 * lifecycle stream (`state_history`) and the identifier-token
 * stream (`identifier_state_history`) into a single chronologically-
 * sorted list, plus supersession links.
 *
 * **Routing note**: the path param is named `:auditGcuid`
 * (NOT `:gcuid`) so the `router.param('gcuid', resolveToGcuid)`
 * middleware does NOT rewrite it. The audit endpoint must show
 * history for the exact GCUID requested — including archived /
 * superseded identities — not for their canonical replacement.
 *
 * Each merged row carries `event_source: 'identity' | 'identifier'`
 * so callers can tell which stream each entry came from.
 *
 * @route   GET /api/gcuid/audit/:auditGcuid
 * @param   auditGcuid — exact GCUID (path param; passed through without resolution).
 * @returns 200 — `{ success: true, data: { gcuid, entity_id, current_state, identifier_state, superseded_by: string|null, supersedes: string[], created: timestamp, audit_trail: MergedEvent[] } }` — `audit_trail` sorted ASC by `timestamp`.
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB read failure.
 */
router.get('/audit/:auditGcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Use the RAW parameter name `:auditGcuid` (not `:gcuid`) so that the
    // `router.param('gcuid', resolveToGcuid)` middleware does NOT rewrite this
    // value.  The audit endpoint must always show history for the exact GCUID
    // requested — including archived / superseded identities — not for their
    // canonical replacement.
    const gcuid = req.params.auditGcuid;
    
    const db = new Database(REGISTRY_DB, { readonly: true });
    
    // Verify identity exists
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) {
      db.close();
      throw createError('Identity not found', 404);
    }
    
    // Identity lifecycle events (state_history)
    const identityHistory = (db.prepare(`
      SELECT 'identity' as event_source, id, gcuid, from_state, to_state,
             transition_type as transition, reason, actor, timestamp
      FROM state_history
      WHERE gcuid = ?
    `).all(gcuid) as any[]).map(r => ({ ...r }));

    // Identifier token events (identifier_state_history)
    const identifierHistory = (db.prepare(`
      SELECT 'identifier' as event_source, id, gcuid, from_state, to_state,
             transition, reason, changed_by as actor, timestamp
      FROM identifier_state_history
      WHERE gcuid = ?
    `).all(gcuid) as any[]).map(r => ({ ...r }));

    // Also surface any supersession links where this GCUID is the canonical survivor
    const supersededBy = db.prepare(
      `SELECT gcuid, superseded_by FROM identities WHERE superseded_by = ?`
    ).all(gcuid) as any[];

    db.close();

    // Merge both streams, sorted ascending by timestamp
    const combined = [...identityHistory, ...identifierHistory].sort(
      (a, b) => a.timestamp.localeCompare(b.timestamp)
    );
    
    res.json({
      success: true,
      data: {
        gcuid,
        entity_id:        identity.entity_id,
        current_state:    identity.state,
        identifier_state: identity.identifier_state,
        superseded_by:    identity.superseded_by ?? null,
        supersedes:       supersededBy.map((r: any) => r.gcuid),
        created:          identity.created_at,
        audit_trail:      combined,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/approve/:gcuid
 *
 * Approve a `provisional` or `under_review` identity, transitioning
 * it to `active`. Records the transition in `state_history` with
 * `transition_type = 'approve'` and logs `IDENTITY_APPROVED` (notice).
 *
 * @route   POST /api/gcuid/approve/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ reason?: string }` — defaults to `'Approved via API'`.
 * @returns 200 — `{ success: true, message, data: { gcuid, previous_state, new_state: 'active', timestamp } }`
 * @throws  400 — `Cannot approve identity in state: X` (must be `provisional` or `under_review`).
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB write failure.
 */
router.post('/approve/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const reason = req.body.reason || 'Approved via API';
    
    const db = new Database(REGISTRY_DB);
    
    // Get current identity
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) {
      db.close();
      throw createError('Identity not found', 404);
    }
    
    // Check current state
    if (identity.state !== 'provisional' && identity.state !== 'under_review') {
      db.close();
      throw createError(`Cannot approve identity in state: ${identity.state}`, 400);
    }
    
    // Update state
    const timestamp = new Date().toISOString();
    db.prepare(
      'UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?'
    ).run('active', timestamp, gcuid);
    
    // Record state history
    db.prepare(`
      INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(gcuid, identity.state, 'active', 'approve', reason, getActor(req, res), timestamp);
    
    db.close();

    logRegistry('notice', REGISTRY_EVENTS.IDENTITY_APPROVED, {
      component:             'api:admin',
      gcuid,
      actor_id:              (getActor(req, res)),
      actor_type:            'admin',
      identity_state_before: identity.state as any,
      identity_state_after:  'active' as any,
      request_id:            (req as any).requestId,
    });
    
    res.json({
      success: true,
      message: 'Identity approved successfully',
      data: {
        gcuid,
        previous_state: identity.state,
        new_state: 'active',
        timestamp
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/flag-review/:gcuid
 *
 * Move a `provisional` or `active` identity into `under_review`,
 * typically after duplicate / anomaly detection. Records the
 * transition in `state_history` with `transition_type = 'flag_review'`.
 *
 * @route   POST /api/gcuid/flag-review/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ reason?: string }` — defaults to `'Flagged for review via API'`.
 * @returns 200 — `{ success: true, message, data: { gcuid, previous_state, new_state: 'under_review', timestamp } }`
 * @throws  400 — `Cannot flag for review from state: X` (must be `provisional` or `active`).
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB write failure.
 */
router.post('/flag-review/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const reason = req.body.reason || 'Flagged for review via API';

    const db = new Database(REGISTRY_DB);
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) { db.close(); throw createError('Identity not found', 404); }

    const allowed = ['provisional', 'active'];
    if (!allowed.includes(identity.state)) {
      db.close();
      throw createError(`Cannot flag for review from state: ${identity.state}`, 400);
    }

    const timestamp = new Date().toISOString();
    db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
      .run('under_review', timestamp, gcuid);
    db.prepare(`INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(gcuid, identity.state, 'under_review', 'flag_review', reason, getActor(req, res), timestamp);
    db.close();

    res.json({
      success: true,
      message: 'Identity flagged for review',
      data: { gcuid, previous_state: identity.state, new_state: 'under_review', timestamp }
    });
  } catch (error) { next(error); }
});

/**
 * POST /api/gcuid/clear-suspension/:gcuid
 *
 * Clear a suspension — `suspended` identity returns to `active`.
 * Records the transition in `state_history` with
 * `transition_type = 'clear_suspension'`. Only valid from `suspended`.
 *
 * @route   POST /api/gcuid/clear-suspension/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ reason?: string }` — defaults to `'Suspension cleared via API'`.
 * @returns 200 — `{ success: true, message, data: { gcuid, previous_state: 'suspended', new_state: 'active', timestamp } }`
 * @throws  400 — `Clear suspension is only valid from suspended state, current state: X`.
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB write failure.
 */
router.post('/clear-suspension/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const reason = req.body.reason || 'Suspension cleared via API';

    const db = new Database(REGISTRY_DB);
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) { db.close(); throw createError('Identity not found', 404); }

    if (identity.state !== 'suspended') {
      db.close();
      throw createError(`Clear suspension is only valid from suspended state, current state: ${identity.state}`, 400);
    }

    const timestamp = new Date().toISOString();
    db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
      .run('active', timestamp, gcuid);
    db.prepare(`INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(gcuid, 'suspended', 'active', 'clear_suspension', reason, getActor(req, res), timestamp);
    db.close();

    res.json({
      success: true,
      message: 'Suspension cleared, identity is now active',
      data: { gcuid, previous_state: 'suspended', new_state: 'active', timestamp }
    });
  } catch (error) { next(error); }
});

/**
 * POST /api/gcuid/suspend/:gcuid
 *
 * Suspend an `active` or `under_review` identity — a deeper
 * investigation / security hold. Logs `IDENTITY_SUSPENDED` (warning)
 * on success.
 *
 * @route   POST /api/gcuid/suspend/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ reason?: string }` — defaults to `'Suspended via API'`.
 * @returns 200 — `{ success: true, message, data: { gcuid, previous_state, new_state: 'suspended', timestamp } }`
 * @throws  400 — `Cannot suspend identity in state: X` (must be `active` or `under_review`).
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB write failure.
 */
router.post('/suspend/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const reason = req.body.reason || 'Suspended via API';
    
    const db = new Database(REGISTRY_DB);
    
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) {
      db.close();
      throw createError('Identity not found', 404);
    }
    
    const allowed = ['active', 'under_review'];
    if (!allowed.includes(identity.state)) {
      db.close();
      throw createError(`Cannot suspend identity in state: ${identity.state}`, 400);
    }
    
    const timestamp = new Date().toISOString();
    db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
      .run('suspended', timestamp, gcuid);
    db.prepare(`INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(gcuid, identity.state, 'suspended', 'suspend', reason, getActor(req, res), timestamp);
    db.close();

    logRegistry('warning', REGISTRY_EVENTS.IDENTITY_SUSPENDED, {
      component:             'api:admin',
      gcuid,
      actor_id:              (getActor(req, res)),
      actor_type:            'admin',
      identity_state_before: identity.state as any,
      identity_state_after:  'suspended' as any,
      request_id:            (req as any).requestId,
    });
    
    res.json({
      success: true,
      message: 'Identity suspended successfully',
      data: { gcuid, previous_state: identity.state, new_state: 'suspended', timestamp }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/retire/:gcuid
 *
 * Retire an `active` or `suspended` identity. Allowed from both
 * lifecycle states; transitions `→ retired`.
 *
 * **Side effect**: also tombstones the identifier token. If the
 * current `identifier_state` is `issued` or `reserved`, this
 * route transitions `identifier_state → tombstoned` and writes a
 * corresponding `identifier_state_history` row. `nullified` /
 * `superseded` identifiers are already hard-blocked and are
 * preserved as-is.
 *
 * Logs `IDENTITY_ARCHIVED` (notice) — note the event-name
 * historical naming: the log event represents "identity retired".
 *
 * @route   POST /api/gcuid/retire/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ reason?: string }` — defaults to `'Retired via API'`.
 * @returns 200 — `{ success: true, message, data: { gcuid, previous_state, new_state: 'retired', identifier_state: 'tombstoned', previous_identifier_state, timestamp } }`
 * @throws  400 — `Cannot retire identity in state: X` (must be `active` or `suspended`).
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB write failure.
 */
router.post('/retire/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const reason = req.body.reason || 'Retired via API';
    
    const db = new Database(REGISTRY_DB);
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) { db.close(); throw createError('Identity not found', 404); }

    const allowed = ['active', 'suspended'];
    if (!allowed.includes(identity.state)) {
      db.close();
      throw createError(`Cannot retire identity in state: ${identity.state}`, 400);
    }
    
    const timestamp = new Date().toISOString();
    db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
      .run('retired', timestamp, gcuid);
    db.prepare(`INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(gcuid, identity.state, 'retired', 'retire', reason, getActor(req, res), timestamp);
    db.close();

    // Tombstone the identifier — transition issued → tombstoned (permanent deactivation).
    // Only act if the identifier is still in an issued/reserved state; nullified/superseded
    // identifiers are already hard-blocked and should not be overwritten.
    const idRow = REGISTRY_DB_RW_ID.prepare(
      'SELECT identifier_state FROM identities WHERE gcuid = ?'
    ).get(gcuid) as any;
    if (idRow && ['issued', 'reserved'].includes(idRow.identifier_state)) {
      REGISTRY_DB_RW_ID.prepare(
        `UPDATE identities SET identifier_state = 'tombstoned', updated_at = ? WHERE gcuid = ?`
      ).run(timestamp, gcuid);
      REGISTRY_DB_RW_ID.prepare(`
        INSERT INTO identifier_state_history
          (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
        VALUES (?, ?, 'tombstoned', 'retire', 'admin', ?, ?)
      `).run(gcuid, idRow.identifier_state, reason, timestamp);
    }

    logRegistry('notice', REGISTRY_EVENTS.IDENTITY_ARCHIVED, {
      component:             'api:admin',
      gcuid,
      actor_id:              (getActor(req, res)),
      actor_type:            'admin',
      identity_state_before: identity.state as any,
      identity_state_after:  'retired' as any,
      request_id:            (req as any).requestId,
    });
    
    res.json({
      success: true,
      message: 'Identity retired successfully',
      data: {
        gcuid,
        previous_state:            identity.state,
        new_state:                 'retired',
        identifier_state:          'tombstoned',
        previous_identifier_state: idRow?.identifier_state ?? null,
        timestamp,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/rehire/:gcuid
 *
 * Re-engage a retired identity (same GCUID, rehire / re-engagement).
 * Transitions `retired → under_review` (NOT directly to `active` —
 * the re-engaged identity must be reviewed before activation).
 *
 * @route   POST /api/gcuid/rehire/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ reason?: string }` — defaults to `'Rehire / re-engagement via API'`.
 * @returns 200 — `{ success: true, message, data: { gcuid, previous_state: 'retired', new_state: 'under_review', timestamp } }`
 * @throws  400 — `Rehire is only valid from retired state, current state: X`.
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB write failure.
 */
router.post('/rehire/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const reason = req.body.reason || 'Rehire / re-engagement via API';

    const db = new Database(REGISTRY_DB);
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) { db.close(); throw createError('Identity not found', 404); }

    if (identity.state !== 'retired') {
      db.close();
      throw createError(`Rehire is only valid from retired state, current state: ${identity.state}`, 400);
    }

    const timestamp = new Date().toISOString();
    db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
      .run('under_review', timestamp, gcuid);
    db.prepare(`INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(gcuid, 'retired', 'under_review', 'rehire', reason, getActor(req, res), timestamp);
    db.close();

    res.json({
      success: true,
      message: 'Identity re-engaged, pending review',
      data: { gcuid, previous_state: 'retired', new_state: 'under_review', timestamp }
    });
  } catch (error) { next(error); }
});

/**
 * POST /api/gcuid/archive/:gcuid
 *
 * Move a `retired` identity to `archived` (long-term retention /
 * compliance). Only valid from `retired` — entities in any other
 * state must be retired first via `/retire`.
 *
 * @route   POST /api/gcuid/archive/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ reason?: string }` — defaults to `'Archived via API'`.
 * @returns 200 — `{ success: true, message, data: { gcuid, previous_state: 'retired', new_state: 'archived', timestamp } }`
 * @throws  400 — `Archive is only valid from retired state, current state: X`.
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB write failure.
 */
router.post('/archive/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const reason = req.body.reason || 'Archived via API';

    const db = new Database(REGISTRY_DB);
    const identity = db.prepare('SELECT * FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!identity) { db.close(); throw createError('Identity not found', 404); }

    if (identity.state !== 'retired') {
      db.close();
      throw createError(`Archive is only valid from retired state, current state: ${identity.state}`, 400);
    }

    const timestamp = new Date().toISOString();
    db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
      .run('archived', timestamp, gcuid);
    db.prepare(`INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(gcuid, 'retired', 'archived', 'archive', reason, getActor(req, res), timestamp);
    db.close();

    logRegistry('notice', REGISTRY_EVENTS.IDENTITY_ARCHIVED, {
      component:             'api:admin',
      gcuid,
      actor_id:              (getActor(req, res)),
      actor_type:            'admin',
      identity_state_before: 'retired' as any,
      identity_state_after:  'archived' as any,
      request_id:            (req as any).requestId,
    });

    res.json({
      success: true,
      message: 'Identity archived',
      data: { gcuid, previous_state: 'retired', new_state: 'archived', timestamp }
    });
  } catch (error) { next(error); }
});

/**
 * GET /api/gcuid/detect-duplicates?threshold=0.8
 *
 * Three-pass duplicate detection across the registry. GCUIDs in
 * resolved states (`superseded` / `retired` / `revoked`) are
 * excluded — marking a GCUID as superseded is the intended
 * resolution workflow.
 *
 * - **Pass 1 — entity_id clash**: same `entity_id` claimed by
 *   more than one identity row.
 * - **Pass 2 — source_id conflict**: same `(source_system, source_id)`
 *   pair claimed by more than one GCUID.
 * - **Pass 3 — cross-system ID collision**: same `source_id`
 *   string appears in more than one distinct source system for
 *   more than one GCUID. Pass-2 conflicts are skipped here (already
 *   reported).
 *
 * Each result entry has `kind` ∈ `'entity_id' | 'source_id_conflict' | 'cross_system_id'`,
 * a stable `key`, `count`, the `gcuids` list, a human-readable
 * `reason`, and kind-specific fields (`source_system`,
 * `source_id`, `systems`, `entity_id`). The `threshold` query
 * parameter is currently accepted but unused — the heuristics are
 * exact-match; reserved for fuzzy-match expansion.
 *
 * @route   GET /api/gcuid/detect-duplicates
 * @query   threshold — reserved for future fuzzy-match (currently unused).
 * @returns 200 — `{ success: true, data: DuplicateFinding[] }` (empty array when no duplicates).
 * @throws  500 — DB read failure.
 */
router.get('/detect-duplicates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threshold = parseFloat(req.query.threshold as string) || 0.8;
    const db = new Database(REGISTRY_DB, { readonly: true });
    const results: any[] = [];

    // GCUIDs that have been resolved (superseded, retired, revoked) are excluded from all
    // duplicate detection — marking a GCUID as superseded is the intended resolution workflow.
    const RESOLVED_STATES = `('superseded', 'retired', 'revoked')`;

    // ── Pass 1: entity_id clash ───────────────────────────────────────────────
    const entityIdClashes = db.prepare(`
      SELECT entity_id, COUNT(*) as count, GROUP_CONCAT(gcuid) as gcuids
      FROM identities
      WHERE entity_id IS NOT NULL
        AND identifier_state NOT IN ${RESOLVED_STATES}
      GROUP BY entity_id
      HAVING count > 1
    `).all() as any[];

    for (const row of entityIdClashes) {
      results.push({
        kind: 'entity_id',
        key: row.entity_id,
        count: row.count,
        gcuids: row.gcuids.split(','),
        reason: `${row.count} GCUIDs share entity_id "${row.entity_id}"`,
        // legacy fields kept for backwards-compat
        entity_id: row.entity_id,
      });
    }

    // ── Pass 2: shared (source_system, source_id) ─────────────────────────────
    const sourceIdConflicts = db.prepare(`
      SELECT sm.source_system, sm.source_id,
             COUNT(DISTINCT sm.gcuid) as gcuid_count,
             GROUP_CONCAT(DISTINCT sm.gcuid) as gcuids
      FROM source_mappings sm
      JOIN identities i ON i.gcuid = sm.gcuid
      WHERE i.identifier_state NOT IN ${RESOLVED_STATES}
      GROUP BY sm.source_system, sm.source_id
      HAVING gcuid_count > 1
    `).all() as any[];

    for (const row of sourceIdConflicts) {
      results.push({
        kind: 'source_id_conflict',
        key: `${row.source_system}/${row.source_id}`,
        count: row.gcuid_count,
        gcuids: row.gcuids.split(','),
        reason: `source record "${row.source_system} / ${row.source_id}" is claimed by ${row.gcuid_count} GCUIDs`,
        source_system: row.source_system,
        source_id: row.source_id,
        entity_id: null,
      });
    }

    // ── Pass 3: cross-system source_id collision ──────────────────────────────
    // Same source_id string appears for >1 distinct GCUID across different source systems.
    // Catches cases like "E10001" used as the source_id in both 'hr' and 'engineering'
    // for two separate GCUIDs that actually refer to the same person.
    const crossSystemCollisions = db.prepare(`
      SELECT sm.source_id,
             COUNT(DISTINCT sm.gcuid) as gcuid_count,
             COUNT(DISTINCT sm.source_system) as system_count,
             GROUP_CONCAT(DISTINCT sm.gcuid) as gcuids,
             GROUP_CONCAT(DISTINCT sm.source_system) as systems
      FROM source_mappings sm
      JOIN identities i ON i.gcuid = sm.gcuid
      WHERE i.identifier_state NOT IN ${RESOLVED_STATES}
      GROUP BY sm.source_id
      HAVING gcuid_count > 1 AND system_count > 1
    `).all() as any[];

    // Exclude any source_id already reported as a same-system conflict (pass 2)
    const pass2Keys = new Set(sourceIdConflicts.map((r: any) => r.source_id));
    for (const row of crossSystemCollisions) {
      if (pass2Keys.has(row.source_id)) continue;
      results.push({
        kind: 'cross_system_id',
        key: `cross/${row.source_id}`,
        count: row.gcuid_count,
        gcuids: row.gcuids.split(','),
        reason: `source_id "${row.source_id}" is used across systems [${row.systems}] for ${row.gcuid_count} different GCUIDs — likely the same person registered in multiple systems`,
        source_id: row.source_id,
        systems: row.systems.split(','),
        entity_id: null,
      });
    }

    db.close();

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gcuid/stats
 *
 * Registry overview statistics: total identities, identity count
 * per lifecycle state, identity count per entity type, plus
 * rolling 24-hour counters for `identities.created_at` and
 * `state_history.timestamp` (recent activity).
 *
 * @returns 200 — `{ success: true, data: { overview: { total_identities, created_24h, transitions_24h }, by_state: { state, count }[], by_type: { type, count }[] } }`.
 * @throws  500 — DB read failure.
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = new Database(REGISTRY_DB, { readonly: true });
    
    // Total identities
    const total = db.prepare('SELECT COUNT(*) as count FROM identities').get() as any;
    
    // By state
    const byState = db.prepare(`
      SELECT state, COUNT(*) as count
      FROM identities
      GROUP BY state
    `).all();
    
    // By entity type
    const byType = db.prepare(`
      SELECT entity_type as type, COUNT(*) as count
      FROM identities
      GROUP BY entity_type
    `).all();
    
    // Recent activity (24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const created24h = db.prepare(
      'SELECT COUNT(*) as count FROM identities WHERE created_at > ?'
    ).get(oneDayAgo) as any;
    
    const transitions24h = db.prepare(
      'SELECT COUNT(*) as count FROM state_history WHERE timestamp > ?'
    ).get(oneDayAgo) as any;
    
    db.close();
    
    res.json({
      success: true,
      data: {
        overview: {
          total_identities: total.count,
          created_24h: created24h.count,
          transitions_24h: transitions24h.count
        },
        by_state: byState,
        by_type: byType
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gcuid/health
 *
 * Registry health probe — runs three checks:
 *
 * 1. **Registry accessible** — `SELECT 1` against the identities table.
 * 2. **All GCUIDs have valid format** — every row matches `urn:gcuid:{24 chars}`.
 * 3. **No orphaned history records** — every `state_history.gcuid`
 *    still exists in `identities`.
 *
 * `healthy` is true iff every check passed. Response always
 * 200; callers inspect `data.healthy` and the per-check status.
 *
 * @returns 200 — `{ success: true, data: { checks: { name, status: 'pass'|'fail', error?: string }[], passed, total, healthy, message } }`.
 * @throws  500 — Unexpected failure before the checks ran.
 */
router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = new Database(REGISTRY_DB, { readonly: true });
    
    const checks = [];
    let passed = 0;
    
    // Check 1: Registry accessible
    try {
      db.prepare('SELECT 1').get();
      checks.push({ name: 'Registry accessible', status: 'pass' });
      passed++;
    } catch (e) {
      checks.push({ name: 'Registry accessible', status: 'fail', error: (e as Error).message });
    }
    
    // Check 2: All GCUIDs have valid format
    try {
      const invalid = db.prepare(`
        SELECT COUNT(*) as count FROM identities
        WHERE gcuid NOT LIKE 'urn:gcuid:________________________'
      `).get() as any;
      
      if (invalid.count === 0) {
        checks.push({ name: 'All GCUIDs have valid format', status: 'pass' });
        passed++;
      } else {
        checks.push({ 
          name: 'All GCUIDs have valid format', 
          status: 'fail', 
          error: `${invalid.count} invalid GCUIDs found` 
        });
      }
    } catch (e) {
      checks.push({ name: 'All GCUIDs have valid format', status: 'fail', error: (e as Error).message });
    }
    
    // Check 3: No orphaned history records
    try {
      const orphaned = db.prepare(`
        SELECT COUNT(*) as count FROM state_history
        WHERE gcuid NOT IN (SELECT gcuid FROM identities)
      `).get() as any;
      
      if (orphaned.count === 0) {
        checks.push({ name: 'No orphaned history records', status: 'pass' });
        passed++;
      } else {
        checks.push({ 
          name: 'No orphaned history records', 
          status: 'fail', 
          error: `${orphaned.count} orphaned records found` 
        });
      }
    } catch (e) {
      checks.push({ name: 'No orphaned history records', status: 'fail', error: (e as Error).message });
    }
    
    db.close();
    
    const healthy = passed === checks.length;
    
    res.json({
      success: true,
      data: {
        checks,
        passed,
        total: checks.length,
        healthy,
        message: healthy ? 'All health checks passed' : 'Some health checks failed'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gcuid/source-mappings
 *
 * List every `source_mappings` row across the registry, plus per-
 * source aggregate counts (`gcuid_count`, `mapping_count`) and
 * `is_primary` flag. Useful for cross-system identity audits.
 *
 * @returns 200 — `{ success: true, data: { mappings: SourceMapping[], by_source: { source_system, gcuid_count, mapping_count }[], total } }`
 * @throws  500 — DB read failure.
 */
router.get('/source-mappings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = new Database(REGISTRY_DB, { readonly: true });
    
    const mappings = db.prepare(`
      SELECT 
        gcuid,
        source_system,
        source_id,
        is_primary,
        verified_at,
        created_at
      FROM source_mappings
      ORDER BY created_at DESC
    `).all();

    // Group by GCUID
    const groupedMappings: Record<string, any[]> = {};
    for (const mapping of mappings as any[]) {
      if (!groupedMappings[mapping.gcuid]) {
        groupedMappings[mapping.gcuid] = [];
      }
      groupedMappings[mapping.gcuid].push(mapping);
    }

    // ── Enrich with name/email + aliases ──────────────────────────────────────
    const gcuids = Object.keys(groupedMappings);
    const gcuidMeta: Record<string, { display_name: string | null; email: string | null; aliases: string[]; source: string | null; identifier_state: string | null; superseded_by: string | null }> = {};

    if (gcuids.length > 0) {
      // Step 1: load connector_id for each source_system from the registry
      const sourceSystemRows = db.prepare(
        `SELECT system_id, connector_id FROM source_systems`
      ).all() as { system_id: string; connector_id: string }[];
      const connectorIdBySystem: Record<string, string> = {};
      for (const r of sourceSystemRows) connectorIdBySystem[r.system_id] = r.connector_id;

      // Step 2: collect (source_system, source_id) pairs grouped by gcuid and by source_system
      const bySystem: Record<string, { gcuid: string; source_id: string }[]> = {};
      for (const [gcuid, mappingList] of Object.entries(groupedMappings)) {
        for (const m of mappingList as any[]) {
          (bySystem[m.source_system] ??= []).push({ gcuid, source_id: m.source_id });
        }
      }

      // Step 3: query each connector DB for name + email (highest priority system wins per GCUID)
      // connectorHit stores the best hit found so far per gcuid
      const connectorHit: Record<string, { display_name: string; email: string | null; source: string }> = {};

      for (const systemId of SOURCE_PRIORITY) {
        const connectorId = connectorIdBySystem[systemId];
        if (!connectorId) continue;
        const schema = CONNECTOR_SCHEMAS[connectorId];
        if (!schema) continue;
        const dbFile = connectorDbPath(connectorId);
        if (!fs.existsSync(dbFile)) continue;

        const pairs = bySystem[systemId] ?? [];
        if (pairs.length === 0) continue;

        let connDb: InstanceType<typeof Database> | null = null;
        try {
          connDb = new Database(dbFile, { readonly: true });
          const idPh = pairs.map(() => '?').join(',');
          const rows = connDb.prepare(
            `SELECT ${schema.pkCol} AS pk, first_name, last_name, email FROM "${schema.table}" WHERE ${schema.pkCol} IN (${idPh})`
          ).all(...pairs.map(p => p.source_id)) as any[];

          const rowByPk: Record<string, any> = {};
          for (const row of rows) rowByPk[row.pk] = row;

          for (const { gcuid, source_id } of pairs) {
            // Only set if not already filled by a higher-priority source
            if (connectorHit[gcuid]) continue;
            const row = rowByPk[source_id];
            if (!row) continue;
            const nameParts = [row.first_name, row.last_name].filter(Boolean);
            if (nameParts.length === 0) continue;
            connectorHit[gcuid] = {
              display_name: nameParts.join(' '),
              email: row.email ?? null,
              source: systemId,
            };
          }
        } catch {
          // Connector DB unavailable — skip silently
        } finally {
          connDb?.close();
        }
      }

      // Step 4: fall back to registry identity metadata for any GCUID not resolved from connectors
      const ph = gcuids.map(() => '?').join(',');
      const identityRows = db.prepare(
        `SELECT gcuid, metadata, identifier_state, superseded_by FROM identities WHERE gcuid IN (${ph})`
      ).all(...gcuids) as any[];

      const registryMeta: Record<string, { display_name: string | null; email: string | null; identifier_state: string | null; superseded_by: string | null }> = {};
      for (const row of identityRows) {
        let meta: Record<string, any> = {};
        try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch { /* ignore */ }
        const parts = [meta.first_name, meta.last_name].filter(Boolean);
        registryMeta[row.gcuid] = {
          display_name:     parts.length ? parts.join(' ') : (meta.name ?? meta.full_name ?? meta.display_name ?? null),
          email:            meta.email ?? null,
          identifier_state: row.identifier_state ?? null,
          superseded_by:    row.superseded_by    ?? null,
        };
      }

      // Step 5: merge — connector hit wins; fall back to registry metadata
      for (const gcuid of gcuids) {
        const hit = connectorHit[gcuid];
        const reg = registryMeta[gcuid];
        gcuidMeta[gcuid] = {
          display_name:     hit?.display_name   ?? reg?.display_name   ?? null,
          email:            hit?.email          ?? reg?.email          ?? null,
          source:           hit?.source         ?? (reg?.display_name ? 'registry' : null),
          identifier_state: reg?.identifier_state ?? null,
          superseded_by:    reg?.superseded_by    ?? null,
          aliases:          [],
        };
      }

      // Step 6: batch-fetch enabled aliases
      const aliasRows = db.prepare(
        `SELECT gcuid, alias_value FROM aliases WHERE gcuid IN (${ph}) AND status = 'enabled' ORDER BY created_at ASC`
      ).all(...gcuids) as any[];

      for (const row of aliasRows) {
        if (!gcuidMeta[row.gcuid]) gcuidMeta[row.gcuid] = { display_name: null, email: null, source: null, aliases: [] };
        gcuidMeta[row.gcuid].aliases.push(row.alias_value);
      }
    }

    db.close();

    res.json({
      success: true,
      data: {
        mappings: groupedMappings,
        total_gcuids: Object.keys(groupedMappings).length,
        total_mappings: mappings.length,
        gcuid_meta: gcuidMeta,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gcuid/source-mappings/:gcuid
 *
 * List every `source_mappings` row for one GCUID. 404 if the
 * GCUID isn't in the `identities` table — the route verifies
 * existence before listing.
 *
 * @route   GET /api/gcuid/source-mappings/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @returns 200 — `{ success: true, data: { gcuid, mappings: SourceMapping[], source_count: number } }`
 * @throws  404 — `GCUID not found`.
 * @throws  500 — DB read failure.
 */
router.get('/source-mappings/:gcuid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const db = new Database(REGISTRY_DB, { readonly: true });

    // First verify the GCUID exists in the registry
    const identity = db.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(gcuid);

    if (!identity) {
      db.close();
      return res.status(404).json({
        success: false,
        error: {
          message: 'GCUID not found',
          gcuid,
        },
      });
    }

    const mappings = db.prepare(`
      SELECT 
        gcuid,
        source_system,
        source_id,
        is_primary,
        verified_at,
        created_at
      FROM source_mappings
      WHERE gcuid = ?
    `).all(gcuid);

    db.close();

    res.json({
      success: true,
      data: {
        gcuid,
        mappings,
        source_count: mappings.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/source-mappings/:gcuid
 *
 * Add an authoritative-source mapping to an existing identity.
 * The route enforces the `(source_system, source_id)` uniqueness
 * constraint at the application layer (returns 409 on conflict).
 *
 * @route   POST /api/gcuid/source-mappings/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ source_system: string, source_id: string, is_primary?: boolean }`
 * @returns 201 — `{ success: true, data: { id, gcuid, source_system, source_id, is_primary: boolean, created_at } }`
 * @throws  400 — `"source_system" is required` or `"source_id" is required`.
 * @throws  404 — `Identity not found`.
 * @throws  409 — `source_id "X" is already registered under "Y"`.
 * @throws  500 — DB write failure.
 */
router.post('/source-mappings/:gcuid', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const { source_system, source_id, is_primary = false } = req.body as {
      source_system?: string;
      source_id?: string;
      is_primary?: boolean;
    };

    if (!source_system?.trim()) throw createError('"source_system" is required', 400);
    if (!source_id?.trim())     throw createError('"source_id" is required', 400);

    const db = new Database(REGISTRY_DB);
    if (!db.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(gcuid)) {
      db.close();
      throw createError('Identity not found', 404);
    }

    // Enforce unique constraint on (source_system, source_id) per schema
    const existing = db.prepare(
      'SELECT id FROM source_mappings WHERE source_system = ? AND source_id = ?'
    ).get(source_system, source_id) as any;
    if (existing) {
      db.close();
      throw createError(
        `source_id "${source_id}" is already registered under "${source_system}"`,
        409,
      );
    }

    const ts = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(gcuid, source_system, source_id, is_primary ? 1 : 0, ts);
    db.close();

    res.status(201).json({
      success: true,
      data: {
        id:            Number(result.lastInsertRowid),
        gcuid,
        source_system,
        source_id,
        is_primary:    Boolean(is_primary),
        created_at:    ts,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/gcuid/source-mappings/:gcuid/:id
 * Revoke a source mapping by row ID, scoped to the GCUID.
 * The mapping row is removed but the removal is recorded in state_history
 * so the audit trail (GET /api/gcuid/audit/:gcuid) shows the full lineage.
 * Body (optional): { reason?: string }
 */
router.delete('/source-mappings/:gcuid/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid, id } = req.params;
    const reason = (req.body?.reason as string | undefined)?.trim() ?? 'Mapping revoked';
    const numId = parseInt(id, 10);
    if (isNaN(numId)) throw createError('Invalid mapping id', 400);

    const db = new Database(REGISTRY_DB);
    const mapping = db.prepare(
      'SELECT id, source_system, source_id FROM source_mappings WHERE id = ? AND gcuid = ?'
    ).get(numId, gcuid) as any;
    if (!mapping) {
      db.close();
      throw createError('Source mapping not found', 404);
    }

    const identity = db.prepare('SELECT state FROM identities WHERE gcuid = ?').get(gcuid) as any;
    const ts = new Date().toISOString();

    // Write audit record before deleting so the removal is preserved in history
    db.prepare(`
      INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
      VALUES (?, ?, 'active', 'mapping_removed', ?, ?, ?)
    `).run(gcuid, identity?.state ?? 'unknown', `${mapping.source_system}:${mapping.source_id} — ${reason}`, getActor(req, res), ts);

    db.prepare('DELETE FROM source_mappings WHERE id = ?').run(numId);
    db.close();

    res.json({
      success: true,
      data: {
        deleted:       numId,
        gcuid,
        source_system: mapping.source_system,
        source_id:     mapping.source_id,
        revoked_at:    ts,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Identifier State Tracking ───────────────────────────────────────────────
// The GCUID has TWO parallel lifecycles:
//   • Identity state  (provisional → active → suspended/retired) — entity lifecycle
//   • Identifier state (reserved → issued → superseded/nullified) — token lifecycle
//
// This block adds `identifier_state` to the identities table and provides
// endpoints to drive identifier transitions independently.

const REGISTRY_DB_RW_ID = new Proxy({} as InstanceType<typeof Database>, {
  get(_t, prop) { return (getRegistryDbRwId() as any)[prop]; },
});

function migrateIdentifierStateColumn() {
  // Add identifier_state column if absent
  try {
    REGISTRY_DB_RW_ID.exec(`ALTER TABLE identities ADD COLUMN identifier_state TEXT NOT NULL DEFAULT 'reserved'`);
  } catch (e) {
    // Column already exists — OK
  }
  // Backfill: active/suspended/retired entities have already been bound (issued)
  REGISTRY_DB_RW_ID.exec(`
    UPDATE identities SET identifier_state = 'issued'
    WHERE identifier_state = 'reserved'
      AND state IN ('active', 'suspended', 'retired')
  `);

  // Add superseded_by column if absent
  try {
    REGISTRY_DB_RW_ID.exec(`ALTER TABLE identities ADD COLUMN superseded_by TEXT REFERENCES identities(gcuid)`);
  } catch (e) {
    // Column already exists — OK
  }
}

function initIdentifierStateHistoryTable() {
  REGISTRY_DB_RW_ID.exec(`
    CREATE TABLE IF NOT EXISTS identifier_state_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      gcuid           TEXT    NOT NULL REFERENCES identities(gcuid),
      from_state      TEXT,
      to_state        TEXT    NOT NULL,
      transition      TEXT    NOT NULL,
      changed_by      TEXT    NOT NULL DEFAULT 'admin',
      reason          TEXT,
      timestamp       TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// Module-level schema migrations — wrapped so that a read-only bundled DB
// (Lambda container image) doesn't prevent module load.
try { migrateIdentifierStateColumn(); } catch (err: any) { console.warn('[admin] migrateIdentifierStateColumn skipped:', err?.message); }
try { initIdentifierStateHistoryTable(); } catch (err: any) { console.warn('[admin] initIdentifierStateHistoryTable skipped:', err?.message); }

// ─── Alias status column migration ───────────────────────────────────────────
// Adds status TEXT NOT NULL DEFAULT 'enabled' to the aliases table so that
// existing databases are migrated without data loss.
try {
  const REGISTRY_DB_RW_ALIASES = new Database(REGISTRY_DB);
  try {
    REGISTRY_DB_RW_ALIASES.exec(`ALTER TABLE aliases ADD COLUMN status TEXT NOT NULL DEFAULT 'enabled'`);
  } catch { /* column already exists */ }
  REGISTRY_DB_RW_ALIASES.close();
} catch (err: any) { console.warn('[admin] alias status migration skipped (read-only DB):', err?.message); }

/**
 * GET /api/gcuid/identifier-state/:gcuid
 *
 * Read the current `identifier_state` and the full transition
 * history for one GCUID.
 *
 * @route   GET /api/gcuid/identifier-state/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @returns 200 — `{ success: true, data: { gcuid, identifier_state: 'reserved'|'issued'|'superseded'|'nullified'|'tombstoned', superseded_by: string|null, history: IdentifierStateHistory[] } }`
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB read failure.
 */
router.get('/identifier-state/:gcuid', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const db = new Database(REGISTRY_DB, { readonly: true });

    const row = db.prepare(`
      SELECT gcuid, identifier_state, superseded_by FROM identities WHERE gcuid = ?
    `).get(gcuid) as any;
    if (!row) { db.close(); throw createError('Identity not found', 404); }

    const history = db.prepare(`
      SELECT * FROM identifier_state_history WHERE gcuid = ? ORDER BY timestamp DESC
    `).all(gcuid);

    db.close();
    res.json({ success: true, data: { gcuid: row.gcuid, identifier_state: row.identifier_state, superseded_by: row.superseded_by ?? null, history } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/identifier-state/:gcuid/bind
 *
 * Identifier-token transition: `reserved → issued`. Signals that
 * the GCUID has been bound to a verified identity record. Only
 * valid from `reserved`; any other source state returns 409.
 *
 * @route   POST /api/gcuid/identifier-state/:gcuid/bind
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ reason?: string, changed_by?: string }` — defaults: `'Bound via API'`, `'admin'`.
 * @returns 200 — `{ success: true, data: { gcuid, from_state, to_state: 'issued', transition: 'bind' } }`
 * @throws  404 — `Identity not found`.
 * @throws  409 — `Cannot bind: identifier is already "X"`.
 * @throws  500 — DB write failure.
 */
router.post('/identifier-state/:gcuid/bind', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const reason = req.body.reason || 'Bound via API';
    const changed_by = req.body.changed_by || 'admin';

    const row = REGISTRY_DB_RW_ID.prepare('SELECT identifier_state FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!row) throw createError('Identity not found', 404);
    if (row.identifier_state !== 'reserved') throw createError(`Cannot bind: identifier is already "${row.identifier_state}"`, 409);

    const ts = new Date().toISOString();
    REGISTRY_DB_RW_ID.prepare(`UPDATE identities SET identifier_state = 'issued', updated_at = ? WHERE gcuid = ?`).run(ts, gcuid);
    REGISTRY_DB_RW_ID.prepare(`
      INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
      VALUES (?, ?, 'issued', 'bind', ?, ?, ?)
    `).run(gcuid, row.identifier_state, changed_by, reason, ts);

    res.json({ success: true, data: { gcuid, from_state: row.identifier_state, to_state: 'issued', transition: 'bind' } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/identifier-state/:gcuid/nullify
 *
 * Identifier-token transition: `reserved → nullified` OR
 * `issued → nullified`. Used for validation failures
 * (`transition: 'error'`) or catastrophic revocation
 * (`transition: 'catastrophic'`).
 *
 * @route   POST /api/gcuid/identifier-state/:gcuid/nullify
 * @param   gcuid — registry GCUID (path param).
 * @body    `{ reason?: string, changed_by?: string, transition?: 'error'|'catastrophic' }` — defaults: `'Nullified via API'`, `'admin'`, `'error'`.
 * @returns 200 — `{ success: true, data: { gcuid, from_state, to_state: 'nullified', transition } }`
 * @throws  404 — `Identity not found`.
 * @throws  409 — `Cannot nullify: identifier is already "X"`.
 * @throws  500 — DB write failure.
 */
router.post('/identifier-state/:gcuid/nullify', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const reason = req.body.reason || 'Nullified via API';
    const changed_by = req.body.changed_by || 'admin';
    const transition = req.body.transition || 'error'; // 'error' or 'catastrophic'

    const row = REGISTRY_DB_RW_ID.prepare('SELECT identifier_state FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!row) throw createError('Identity not found', 404);
    if (!['reserved', 'issued'].includes(row.identifier_state)) {
      throw createError(`Cannot nullify: identifier is already "${row.identifier_state}"`, 409);
    }

    const ts = new Date().toISOString();
    REGISTRY_DB_RW_ID.prepare(`UPDATE identities SET identifier_state = 'nullified', updated_at = ? WHERE gcuid = ?`).run(ts, gcuid);
    REGISTRY_DB_RW_ID.prepare(`
      INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
      VALUES (?, ?, 'nullified', ?, ?, ?, ?)
    `).run(gcuid, row.identifier_state, transition, changed_by, reason, ts);

    res.json({ success: true, data: { gcuid, from_state: row.identifier_state, to_state: 'nullified', transition } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/identifier-state/:gcuid/supersede
 *
 * Identifier-token transition: `issued → superseded`. Used when
 * a duplicate is detected; the body must include `superseded_by`
 * (the canonical GCUID). The replacement GCUID must exist in the
 * identities table. The `transition` is recorded as `'duplicate'`.
 *
 * @route   POST /api/gcuid/identifier-state/:gcuid/supersede
 * @param   gcuid — registry GCUID (path param, the duplicate being superseded).
 * @body    `{ superseded_by: string, reason?: string, changed_by?: string }` — `changed_by` defaults to `'admin'`.
 * @returns 200 — `{ success: true, data: { gcuid, from_state: 'issued', to_state: 'superseded', superseded_by } }`
 * @throws  400 — `"superseded_by" GCUID is required` or `"superseded_by" must be a different GCUID`.
 * @throws  404 — `Identity not found` (source GCUID) or `Canonical GCUID "X" not found`.
 * @throws  409 — `Cannot supersede: identifier is "X", expected "issued"`.
 * @throws  500 — DB write failure.
 */
router.post('/identifier-state/:gcuid/supersede', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const { superseded_by, reason, changed_by = 'admin' } = req.body;

    if (!superseded_by) throw createError('"superseded_by" GCUID is required', 400);
    if (superseded_by === gcuid) throw createError('"superseded_by" must be a different GCUID', 400);

    const row = REGISTRY_DB_RW_ID.prepare('SELECT identifier_state FROM identities WHERE gcuid = ?').get(gcuid) as any;
    if (!row) throw createError('Identity not found', 404);
    if (row.identifier_state !== 'issued') {
      throw createError(`Cannot supersede: identifier is "${row.identifier_state}", expected "issued"`, 409);
    }

    // Verify the replacement GCUID exists
    const canonical = REGISTRY_DB_RW_ID.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(superseded_by) as any;
    if (!canonical) throw createError(`Canonical GCUID "${superseded_by}" not found`, 404);

    const ts = new Date().toISOString();
    REGISTRY_DB_RW_ID.prepare(`
      UPDATE identities SET identifier_state = 'superseded', superseded_by = ?, updated_at = ? WHERE gcuid = ?
    `).run(superseded_by, ts, gcuid);
    REGISTRY_DB_RW_ID.prepare(`
      INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
      VALUES (?, 'issued', 'superseded', 'duplicate', ?, ?, ?)
    `).run(gcuid, changed_by, reason || `Superseded by ${superseded_by}`, ts);

    res.json({ success: true, data: { gcuid, from_state: 'issued', to_state: 'superseded', superseded_by } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/merge
 *
 * Adjudicated merge workflow — combine two or more duplicate
 * identities into a single canonical record (the survivor). For
 * each merged GCUID, atomically:
 *
 * 1. **Transfers source mappings** to the surviving GCUID. Any
 *    `(source_system, source_id)` pair that would conflict with
 *    an existing mapping on the survivor is reported in
 *    `skipped_mappings` (not transferred).
 * 2. **Retires the identity**: `state → 'retired'`.
 * 3. **Tombstones or supersedes the identifier token**:
 *    `identifier_state → 'superseded'` if the original was `issued`,
 *    otherwise `'tombstoned'`. `superseded_by = surviving_gcuid`.
 * 4. **Writes audit records**: one row each in `state_history` and
 *    `identifier_state_history` per merged GCUID.
 *
 * Both `surviving_gcuid` and each entry in `merged_gcuids` are
 * passed through `resolveToGcuid()` first, so aliases resolve to
 * their canonical GCUIDs before validation.
 *
 * Logs `ADMIN_BULK_ACTION` (notice) with `context` payload
 * `JSON.stringify({ action: 'merge', surviving_gcuid, merged_count })`.
 *
 * @route   POST /api/gcuid/merge
 * @body    `{ surviving_gcuid: string, merged_gcuids: string[], reason?: string, changed_by?: string }`
 * @returns 200 — `{ success: true, data: { surviving_gcuid, merged_gcuids, transferred_mappings: { gcuid, source_system, source_id }[], skipped_mappings: { gcuid, source_system, source_id }[], merged_at } }`
 * @throws  400 — `surviving_gcuid` missing, `merged_gcuids` empty, or survivor present in merged list.
 * @throws  404 — `Surviving GCUID "X" not found` or `Merged GCUID "X" not found`.
 * @throws  409 — `GCUID "X" is already nullified/superseded and cannot be merged`.
 * @throws  500 — DB transaction failure.
 */
router.post('/merge', (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      surviving_gcuid: _rawSurviving,
      merged_gcuids:   _rawMerged,
      reason = 'Merge adjudication',
      changed_by = 'admin',
    } = req.body as {
      surviving_gcuid?: string;
      merged_gcuids?: string[];
      reason?: string;
      changed_by?: string;
    };

    // Resolve aliases to canonical GCUIDs when the feature is enabled
    const surviving_gcuid = resolveToGcuid(_rawSurviving);
    const merged_gcuids   = (_rawMerged ?? []).map(resolveToGcuid);

    if (!surviving_gcuid?.trim()) throw createError('"surviving_gcuid" is required', 400);
    if (!Array.isArray(merged_gcuids) || merged_gcuids.length === 0) {
      throw createError('"merged_gcuids" must be a non-empty array', 400);
    }
    if (merged_gcuids.includes(surviving_gcuid)) {
      throw createError('"surviving_gcuid" must not appear in "merged_gcuids"', 400);
    }

    const db = REGISTRY_DB_RW_ID; // reuse writable handle

    // Verify survivor exists
    const survivor = db.prepare('SELECT gcuid, identifier_state FROM identities WHERE gcuid = ?').get(surviving_gcuid) as any;
    if (!survivor) throw createError(`Surviving GCUID "${surviving_gcuid}" not found`, 404);

    // Verify all merged GCUIDs exist and are in a mergeable state
    for (const m of merged_gcuids) {
      const row = db.prepare('SELECT gcuid, state, identifier_state FROM identities WHERE gcuid = ?').get(m) as any;
      if (!row) throw createError(`Merged GCUID "${m}" not found`, 404);
      if (['nullified', 'superseded'].includes(row.identifier_state)) {
        throw createError(`GCUID "${m}" is already ${row.identifier_state} and cannot be merged`, 409);
      }
    }

    const ts = new Date().toISOString();
    const transferredMappings: Array<{ gcuid: string; source_system: string; source_id: string }> = [];
    const skippedMappings:    Array<{ gcuid: string; source_system: string; source_id: string }> = [];

    db.transaction(() => {
      for (const mergedGcuid of merged_gcuids) {
        const mergedRow = db.prepare(
          'SELECT state, identifier_state FROM identities WHERE gcuid = ?'
        ).get(mergedGcuid) as any;

        // Transfer source_mappings (skip pairs already present on the survivor)
        const srcMaps = db.prepare(
          'SELECT source_system, source_id, is_primary FROM source_mappings WHERE gcuid = ?'
        ).all(mergedGcuid) as any[];

        for (const sm of srcMaps) {
          const conflict = db.prepare(
            'SELECT 1 FROM source_mappings WHERE gcuid = ? AND source_system = ? AND source_id = ?'
          ).get(surviving_gcuid, sm.source_system, sm.source_id);
          if (conflict) {
            skippedMappings.push({ gcuid: mergedGcuid, source_system: sm.source_system, source_id: sm.source_id });
          } else {
            db.prepare(
              'INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, created_at) VALUES (?, ?, ?, 0, ?)'
            ).run(surviving_gcuid, sm.source_system, sm.source_id, ts);
            transferredMappings.push({ gcuid: mergedGcuid, source_system: sm.source_system, source_id: sm.source_id });
          }
        }

        // Retire the merged identity
        db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
          .run('retired', ts, mergedGcuid);
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
          VALUES (?, ?, 'retired', 'merge', ?, ?, ?)
        `).run(mergedGcuid, mergedRow.state, reason, changed_by, ts);

        // Tombstone/supersede the merged identifier
        const mergedIdState = mergedRow.identifier_state as string;
        const newIdState = mergedIdState === 'issued' ? 'superseded' : 'tombstoned';
        db.prepare(
          'UPDATE identities SET identifier_state = ?, superseded_by = ?, updated_at = ? WHERE gcuid = ?'
        ).run(newIdState, surviving_gcuid, ts, mergedGcuid);
        db.prepare(`
          INSERT INTO identifier_state_history
            (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
          VALUES (?, ?, ?, 'merge', ?, ?, ?)
        `).run(mergedGcuid, mergedIdState, newIdState, changed_by, `Merged into ${surviving_gcuid}: ${reason}`, ts);
      }
    })();

    logRegistry('notice', REGISTRY_EVENTS.ADMIN_BULK_ACTION, {
      component:  'api:admin',
      actor_id:   (getActor(req, res)),
      actor_type: 'admin',
      context:    JSON.stringify({ action: 'merge', surviving_gcuid, merged_count: merged_gcuids.length }),
      request_id: (req as any).requestId,
    });

    res.json({
      success: true,
      data: {
        surviving_gcuid,
        merged_gcuids,
        transferred_mappings: transferredMappings,
        skipped_mappings:     skippedMappings,
        merged_at:            ts,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Source Systems Registry ──────────────────────────────────────────────────
// Stores configuration for every authoritative source and department that
// participates in the GCUID federation.

const REGISTRY_DB_RW_SYSTEMS = new Proxy({} as InstanceType<typeof Database>, {
  get(_t, prop) { return (getRegistryDbRwSystems() as any)[prop]; },
}); // writable handle

function initSourceSystemsTable() {
  REGISTRY_DB_RW_SYSTEMS.exec(`
    CREATE TABLE IF NOT EXISTS source_systems (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      system_id           TEXT    UNIQUE NOT NULL,
      display_name        TEXT    NOT NULL,
      system_type         TEXT    NOT NULL CHECK(system_type IN ('authoritative_source','department')),
      db_path             TEXT,
      api_port            INTEGER,
      api_url             TEXT,
      api_secret          TEXT,
      description         TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      connector_id        TEXT,
      access_mode         TEXT    NOT NULL DEFAULT 'dynamic-pull'
                                  CHECK(access_mode IN ('dynamic-pull','push-cache','scheduled-pull')),
      cache_ttl_seconds   INTEGER NOT NULL DEFAULT 300,
      pull_schedule       TEXT,
      allow_inbound       INTEGER NOT NULL DEFAULT 0,
      last_sync_at        TEXT,
      cache_stale_policy  TEXT    NOT NULL DEFAULT 'serve-stale',
      identifier_mode     TEXT    NOT NULL DEFAULT 'gcuid'
                                  CHECK(identifier_mode IN ('gcuid','alias')),
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
    )
  `);

  // Idempotent migrations for databases that existed before this schema version
  const alterColumns = [
    `ALTER TABLE source_systems ADD COLUMN connector_id TEXT`,
    `ALTER TABLE source_systems ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'dynamic-pull'`,
    `ALTER TABLE source_systems ADD COLUMN cache_ttl_seconds INTEGER NOT NULL DEFAULT 300`,
    `ALTER TABLE source_systems ADD COLUMN pull_schedule TEXT`,
    `ALTER TABLE source_systems ADD COLUMN allow_inbound INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE source_systems ADD COLUMN last_sync_at TEXT`,
    `ALTER TABLE source_systems ADD COLUMN cache_stale_policy TEXT NOT NULL DEFAULT 'serve-stale'`,
    `ALTER TABLE source_systems ADD COLUMN identifier_mode TEXT NOT NULL DEFAULT 'gcuid'`,
    `ALTER TABLE source_systems ADD COLUMN api_url TEXT`,
    `ALTER TABLE source_systems ADD COLUMN api_secret TEXT`,
  ];
  for (const sql of alterColumns) {
    try { REGISTRY_DB_RW_SYSTEMS.exec(sql); } catch { /* column already exists */ }
  }
}

function initAttributeCacheTable() {
  REGISTRY_DB_RW_SYSTEMS.exec(`
    CREATE TABLE IF NOT EXISTS attribute_cache (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      system_id    TEXT    NOT NULL,
      source_id    TEXT    NOT NULL,
      normalised   TEXT    NOT NULL,
      effective_at TEXT    NOT NULL,
      received_at  TEXT    NOT NULL,
      expires_at   TEXT,
      UNIQUE(system_id, source_id)
    )
  `);

  // Idempotent migration for databases that existed before expires_at was added
  try {
    REGISTRY_DB_RW_SYSTEMS.exec(`ALTER TABLE attribute_cache ADD COLUMN expires_at TEXT`);
  } catch { /* column already exists */ }
}

function seedSourceSystems() {
  const { n } = REGISTRY_DB_RW_SYSTEMS.prepare('SELECT COUNT(*) as n FROM source_systems').get() as { n: number };
  if (n > 0) {
    // Update connector_id and access_mode for existing rows — covers NULL/empty AND old pre-rename values
    REGISTRY_DB_RW_SYSTEMS.exec(`
      UPDATE source_systems SET connector_id = 'conn-hr',          access_mode = 'dynamic-pull',    allow_inbound = 0 WHERE system_id = 'hr'          AND (connector_id IS NULL OR connector_id = '' OR connector_id = 'hr-system');
      UPDATE source_systems SET connector_id = 'conn-ldap',         access_mode = 'dynamic-pull',    allow_inbound = 0 WHERE system_id = 'ldap'        AND (connector_id IS NULL OR connector_id = '' OR connector_id = 'ldap-ad');
      UPDATE source_systems SET connector_id = 'conn-engineering',  access_mode = 'scheduled-pull',  allow_inbound = 0 WHERE system_id = 'engineering' AND (connector_id IS NULL OR connector_id = '' OR connector_id = 'engineering-dept');
      UPDATE source_systems SET connector_id = 'conn-finance',      access_mode = 'push-cache',      allow_inbound = 1 WHERE system_id = 'finance'     AND (connector_id IS NULL OR connector_id = '' OR connector_id = 'finance-dept');
      -- api_url: write canonical port on NULL, empty, or stale pre-remap port. Pre-remap ports
      -- were 8101/8102/8201/8202; current canonical ports are 5183-5186. The (api_url IS NULL OR api_url = '')
      -- clause alone is not enough — existing DBs seeded before the port remap still hold the old
      -- values and would silently bypass this migration.
      UPDATE source_systems SET api_url = 'http://localhost:5183', api_secret = 'staging_hr_token_12345'       WHERE system_id = 'hr'          AND (api_url IS NULL OR api_url = '' OR api_url = 'http://localhost:8101');
      UPDATE source_systems SET api_url = 'http://localhost:5184', api_secret = 'staging_ldap_token_12345'     WHERE system_id = 'ldap'        AND (api_url IS NULL OR api_url = '' OR api_url = 'http://localhost:8102');
      UPDATE source_systems SET api_url = 'http://localhost:5185', api_secret = 'staging_eng_token_12345'      WHERE system_id = 'engineering' AND (api_url IS NULL OR api_url = '' OR api_url = 'http://localhost:8201');
      UPDATE source_systems SET api_url = 'http://localhost:5186', api_secret = 'staging_fin_token_12345'      WHERE system_id = 'finance'     AND (api_url IS NULL OR api_url = '' OR api_url = 'http://localhost:8202');
      UPDATE source_systems SET api_secret = 'staging_hr_token_12345'    WHERE system_id = 'hr'          AND api_secret = 'gcuid-poc-hr-secret';
      UPDATE source_systems SET api_secret = 'staging_ldap_token_12345'  WHERE system_id = 'ldap'        AND api_secret = 'gcuid-poc-ldap-secret';
      UPDATE source_systems SET api_secret = 'staging_eng_token_12345'   WHERE system_id = 'engineering' AND api_secret = 'gcuid-poc-eng-secret';
      UPDATE source_systems SET api_secret = 'staging_fin_token_12345'   WHERE system_id = 'finance'     AND api_secret = 'gcuid-poc-finance-secret';
    `);
    return;
  }
  const stmt = REGISTRY_DB_RW_SYSTEMS.prepare(`
    INSERT INTO source_systems (system_id, display_name, system_type, api_url, api_secret, description, connector_id, access_mode, allow_inbound)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  REGISTRY_DB_RW_SYSTEMS.transaction(() => {
    stmt.run('hr',          'HR System',             'authoritative_source', 'http://localhost:5183', 'staging_hr_token_12345',   'Human Resources — authoritative for legal identity, employment, and compensation attributes',       'conn-hr',          'dynamic-pull',   0);
        stmt.run('ldap',        'LDAP / AD',             'authoritative_source', 'http://localhost:5184', 'staging_ldap_token_12345', 'Directory Service — authoritative for network accounts, groups, and access control',               'conn-ldap',         'dynamic-pull',   0);
        stmt.run('engineering', 'Engineering Department', 'department',           'http://localhost:5185', 'staging_eng_token_12345',  'Engineering department roster and project assignments',                                             'conn-engineering',  'scheduled-pull', 0);
        stmt.run('finance',     'Finance Department',     'department',           'http://localhost:5186', 'staging_fin_token_12345',  'Finance department personnel and clearance management',                                             'conn-finance',      'push-cache',     1);
  })();
}

try { initSourceSystemsTable(); } catch (err: any) { console.warn('[admin] initSourceSystemsTable skipped:', err?.message); }
try { initAttributeCacheTable(); } catch (err: any) { console.warn('[admin] initAttributeCacheTable skipped:', err?.message); }
try { seedSourceSystems(); } catch (err: any) { console.warn('[admin] seedSourceSystems skipped:', err?.message); }

/**
 * GET /api/gcuid/source-systems
 *
 * List every registered source system, enriched with live
 * `source_mappings` count and `attribute_cache` record count
 * from the registry DB. `api_secret_configured` is a boolean
 * derived from the presence of `api_secret` (the secret itself
 * is never returned in the response).
 *
 * `connector_enabled` is a live lookup: if the row has a
 * `connector_id`, the connector config is loaded and
 * `enabled !== false` is reported. Rows without a connector
 * report `connector_enabled: true` (the system is reachable
 * directly).
 *
 * @returns 200 — `{ success: true, data: SourceSystem[] }` ordered by `system_type`, then `display_name`.
 * @throws  500 — DB read failure.
 */
router.get('/source-systems', (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = new Database(REGISTRY_DB, { readonly: true });
    const systems = REGISTRY_DB_RW_SYSTEMS.prepare('SELECT * FROM source_systems ORDER BY system_type, display_name').all() as any[];

    // Enrich each with live stats from source_mappings and cache counts
    const enriched = systems.map(s => {
      const stats = db.prepare(
        'SELECT COUNT(*) as mapping_count FROM source_mappings WHERE source_system = ?'
      ).get(s.system_id) as any;
      let cacheCount = 0;
      try {
        const cacheStats = db.prepare(
          'SELECT COUNT(*) as n FROM attribute_cache WHERE system_id = ?'
        ).get(s.system_id) as any;
        cacheCount = cacheStats?.n ?? 0;
      } catch { /* attribute_cache may not exist yet in older DBs */ }
      return {
        id: s.id,
        system_id: s.system_id,
        display_name: s.display_name,
        system_type: s.system_type,
        api_url: s.api_url ?? null,
        api_secret_configured: !!(s.api_secret),
        description: s.description,
        is_active: s.is_active === 1,
        connector_id: s.connector_id ?? null,
        connector_enabled: s.connector_id
          ? (loadConnectorConfig(s.connector_id)?.enabled !== false)
          : true,
        access_mode: s.access_mode ?? 'dynamic-pull',
        cache_ttl_seconds: s.cache_ttl_seconds ?? 300,
        allow_inbound: s.allow_inbound === 1,
        last_sync_at: s.last_sync_at ?? null,
        cache_stale_policy: s.cache_stale_policy ?? 'serve-stale',
        identifier_mode: (s.identifier_mode ?? 'gcuid') as 'gcuid' | 'alias',
        identity_mappings: stats.mapping_count,
        cache_record_count: cacheCount,
        created_at: s.created_at,
        updated_at: s.updated_at,
      };
    });

    db.close();
    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gcuid/source-systems
 *
 * Register a new source system.
 *
 * Validation:
 * - `system_id`, `display_name`, `system_type` are required.
 * - `system_type` ∈ `['authoritative_source', 'department']`.
 * - `system_id` must match `/^[a-z0-9-]+$/` (lowercase alphanumeric with hyphens).
 * - `api_url` (when provided) must match `/^https?:\/\/.+/`.
 *
 * @route   POST /api/gcuid/source-systems
 * @body    `{ system_id, display_name, system_type, api_url?, api_secret?, description? }`
 * @returns 201 — `{ success: true, data: SourceSystem }` with `is_active` normalised to boolean and `identity_mappings: 0`.
 * @throws  400 — `system_id, display_name and system_type are required` / `system_type must be "authoritative_source" or "department"` / `system_id must be lowercase alphanumeric with optional hyphens` / `api_url must be a valid http/https URL`.
 * @throws  500 — DB write failure.
 */
router.post('/source-systems', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { system_id, display_name, system_type, api_url, api_secret, description } = req.body;

    if (!system_id || !display_name || !system_type) {
      throw createError('system_id, display_name and system_type are required', 400);
    }
    if (!['authoritative_source', 'department'].includes(system_type)) {
      throw createError('system_type must be "authoritative_source" or "department"', 400);
    }
    // Validate system_id: lowercase alphanumeric + hyphens only
    if (!/^[a-z0-9-]+$/.test(system_id)) {
      throw createError('system_id must be lowercase alphanumeric with optional hyphens', 400);
    }
    // Validate api_url format if provided
    if (api_url && !/^https?:\/\/.+/.test(api_url)) {
      throw createError('api_url must be a valid http/https URL', 400);
    }

    const result = REGISTRY_DB_RW_SYSTEMS.prepare(`
      INSERT INTO source_systems (system_id, display_name, system_type, api_url, api_secret, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(system_id, display_name, system_type, api_url ?? null, api_secret ?? null, description ?? null);

    const created = REGISTRY_DB_RW_SYSTEMS.prepare('SELECT * FROM source_systems WHERE id = ?').get(result.lastInsertRowid) as any;
    res.status(201).json({ success: true, data: { ...created, is_active: created.is_active === 1, identity_mappings: 0 } });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/gcuid/source-systems/:id
 *
 * Update an existing source system's configuration. Sparse update
 * — any omitted field falls back to the existing value. `api_secret`
 * is updated only when the body supplies a non-empty string
 * (sending `null`, `''`, or omitting the field preserves the
 * existing secret).
 *
 * Validation:
 * - `system_type` (when provided) ∈ `['authoritative_source', 'department']`.
 * - `cache_ttl_seconds` (when provided) must be a non-negative number.
 * - `identifier_mode` (when provided) ∈ `['gcuid', 'alias']`.
 * - `api_url` (when provided, non-empty) must match `/^https?:\/\/.+/`.
 *
 * @route   PUT /api/gcuid/source-systems/:id
 * @param   id — `source_systems` row primary key (path param).
 * @body    Partial `SourceSystem`: `{ display_name?, system_type?, api_url?, api_secret?, description?, is_active?, allow_inbound?, cache_ttl_seconds?, cache_stale_policy?, identifier_mode? }`.
 * @returns 200 — `{ success: true, data: SourceSystem }` with `is_active` boolean and live `identity_mappings` count.
 * @throws  400 — Validation failure on any of the four enums or numeric range.
 * @throws  404 — `Source system not found`.
 * @throws  500 — DB write failure.
 */
router.put('/source-systems/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = REGISTRY_DB_RW_SYSTEMS.prepare('SELECT * FROM source_systems WHERE id = ?').get(id) as any;
    if (!existing) throw createError('Source system not found', 404);

    const { display_name, system_type, api_url, api_secret, description, is_active,
            allow_inbound, cache_ttl_seconds, cache_stale_policy, identifier_mode } = req.body;

    if (system_type && !['authoritative_source', 'department'].includes(system_type)) {
      throw createError('system_type must be "authoritative_source" or "department"', 400);
    }
    if (cache_ttl_seconds !== undefined && (typeof cache_ttl_seconds !== 'number' || cache_ttl_seconds < 0)) {
      throw createError('cache_ttl_seconds must be a non-negative number', 400);
    }
    if (identifier_mode !== undefined && !['gcuid', 'alias'].includes(identifier_mode)) {
      throw createError('identifier_mode must be "gcuid" or "alias"', 400);
    }
    if (api_url !== undefined && api_url !== null && api_url !== '' && !/^https?:\/\/.+/.test(api_url)) {
      throw createError('api_url must be a valid http/https URL', 400);
    }

    REGISTRY_DB_RW_SYSTEMS.prepare(`
      UPDATE source_systems SET
        display_name = ?, system_type = ?, api_url = ?,
        api_secret = CASE WHEN ? IS NOT NULL THEN ? ELSE api_secret END,
        description = ?, is_active = ?,
        allow_inbound = ?, cache_ttl_seconds = ?, cache_stale_policy = ?,
        identifier_mode = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      display_name       ?? existing.display_name,
      system_type        ?? existing.system_type,
      api_url            !== undefined ? (api_url || null)  : existing.api_url,
      api_secret         !== undefined && api_secret !== '' ? api_secret : null,
      api_secret         !== undefined && api_secret !== '' ? api_secret : null,
      description        !== undefined ? description : existing.description,
      is_active          !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      allow_inbound      !== undefined ? (allow_inbound ? 1 : 0) : existing.allow_inbound,
      cache_ttl_seconds  !== undefined ? cache_ttl_seconds  : existing.cache_ttl_seconds,
      cache_stale_policy !== undefined ? cache_stale_policy : existing.cache_stale_policy,
      identifier_mode    !== undefined ? identifier_mode    : (existing.identifier_mode ?? 'gcuid'),
      id,
    );

    const updated = REGISTRY_DB_RW_SYSTEMS.prepare('SELECT * FROM source_systems WHERE id = ?').get(id) as any;
    const stats = new Database(REGISTRY_DB, { readonly: true })
      .prepare('SELECT COUNT(*) as n FROM source_mappings WHERE source_system = ?')
      .get(updated.system_id) as any;
    res.json({ success: true, data: { ...updated, is_active: updated.is_active === 1, identity_mappings: stats.n } });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/gcuid/source-systems/:id
 *
 * Remove a source system registration. **Blocked** when the
 * system still has any active identity mappings — callers must
 * revoke or supersede those mappings first.
 *
 * @route   DELETE /api/gcuid/source-systems/:id
 * @param   id — `source_systems` row primary key (path param).
 * @returns 200 — `{ success: true, data: { deleted: id, system_id } }`
 * @throws  404 — `Source system not found`.
 * @throws  409 — `Cannot delete "X": N active identity mapping(s) exist. Remove all identity links first.`
 * @throws  500 — DB write failure.
 */
router.delete('/source-systems/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = REGISTRY_DB_RW_SYSTEMS.prepare('SELECT * FROM source_systems WHERE id = ?').get(id) as any;
    if (!existing) throw createError('Source system not found', 404);

    const db = new Database(REGISTRY_DB, { readonly: true });
    const { n } = db.prepare('SELECT COUNT(*) as n FROM source_mappings WHERE source_system = ?').get(existing.system_id) as any;
    db.close();

    if (n > 0) {
      throw createError(
        `Cannot delete "${existing.display_name}": ${n} active identity mapping(s) exist. Remove all identity links first.`,
        409,
      );
    }

    REGISTRY_DB_RW_SYSTEMS.prepare('DELETE FROM source_systems WHERE id = ?').run(id);
    res.json({ success: true, data: { deleted: id, system_id: existing.system_id } });
  } catch (error) {
    next(error);
  }
});

// ─── GC Alias Management ─────────────────────────────────────────────────────

/**
 * GET /api/gcuid/aliases/:gcuid
 *
 * List aliases for one GCUID. Optional `?includeDisabled=true`
 * returns both `enabled` and `disabled` rows; default returns
 * only `enabled`. The `aliases.generated` feature flag filters
 * `GC-*` rows when false.
 *
 * @route   GET /api/gcuid/aliases/:gcuid
 * @param   gcuid — registry GCUID (path param).
 * @query   includeDisabled — `'true'` to include disabled rows.
 * @returns 200 — `{ success: true, data: Alias[] }` ordered ASC by `created_at`.
 * @throws  404 — `Identity not found`.
 * @throws  500 — DB read failure.
 */
router.get('/aliases/:gcuid', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const db = new Database(REGISTRY_DB, { readonly: true });
    if (!db.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(gcuid)) {
      db.close(); throw createError('Identity not found', 404);
    }
    const includeDisabled = req.query.includeDisabled === 'true';
    let aliases = db.prepare(
      includeDisabled
        ? 'SELECT id, gcuid, alias_type, alias_value, status, created_at FROM aliases WHERE gcuid = ? ORDER BY created_at ASC'
        : "SELECT id, gcuid, alias_type, alias_value, status, created_at FROM aliases WHERE gcuid = ? AND status = 'enabled' ORDER BY created_at ASC"
    ).all(gcuid) as any[];
    if (!readFlags().aliases.generated) {
      aliases = aliases.filter((a: any) => !String(a.alias_type ?? '').startsWith('GC-'));
    }
    db.close();
    res.json({ success: true, data: aliases });
  } catch (error) { next(error); }
});

/**
 * POST /api/gcuid/aliases/:gcuid/derive-email
 * Look up the email attribute for the authoritative source of `person.email`
 * (LDAP in this codebase), resolve it via the connector against any of the
 * GCUID's source_mappings for that source, and persist the result as an
 * enabled `email` alias.  Mirrors the self-register / link_existing alias
 * generation path; intended to be triggered manually from the GCUID
 * Registry right-details panel when no email alias exists yet.
 *
 * Idempotent: if an enabled email alias already exists, returns it (no
 * duplicate).  If a disabled email alias exists, re-uses the row.
 */
router.post('/aliases/:gcuid/derive-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid } = req.params;
    const db = new Database(REGISTRY_DB);

    if (!db.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(gcuid)) {
      db.close();
      throw createError('Identity not found', 404);
    }

    // Idempotency: if an email alias already exists for this gcuid, return it.
    const existing = db.prepare(
      "SELECT id, gcuid, alias_type, alias_value, status, created_at FROM aliases WHERE gcuid = ? AND alias_type = 'email' ORDER BY id LIMIT 1"
    ).get(gcuid) as any;
    if (existing) {
      db.close();
      return res.json({ success: true, data: existing, deduped: true });
    }

    // Find the authoritative source for person.email.
    const emailAttr = db.prepare(`
      SELECT source_system, source_field, source_table, key_field
      FROM attribute_mappings
      WHERE standard_attribute = 'person.email' AND is_authoritative = 1
      LIMIT 1
    `).get() as
      | { source_system: string; source_field: string; source_table: string; key_field: string }
      | undefined;
    if (!emailAttr) {
      db.close();
      throw createError('No authoritative email mapping configured', 422);
    }

    // Walk this GCUID's source_mappings for the authoritative source in id
    // order; the first mapping that resolves an email wins.  This matches
    // the order used in the self-register and link_existing paths.
    const sourceMappings = db.prepare(
      'SELECT id, source_id FROM source_mappings WHERE gcuid = ? AND source_system = ? ORDER BY id'
    ).all(gcuid, emailAttr.source_system) as { id: number; source_id: string }[];

    if (sourceMappings.length === 0) {
      db.close();
      throw createError(
        `No source_mapping for authoritative source '${emailAttr.source_system}' on this identity`,
        422
      );
    }

    let emailValue: string | undefined;
    let resolvedFrom: string | undefined;
    for (const sm of sourceMappings) {
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
          resolvedFrom = sm.source_id;
          break;
        }
      } catch { /* try next mapping */ }
    }

    if (!emailValue) {
      db.close();
      throw createError(
        `No resolvable email for authoritative source '${emailAttr.source_system}' on this identity`,
        502
      );
    }

    const now = new Date().toISOString();
    const insertResult = db.prepare(`
      INSERT INTO aliases (gcuid, alias_type, alias_value, status, created_at, metadata)
      VALUES (?, 'email', ?, 'enabled', ?, ?)
    `).run(gcuid, emailValue, now, JSON.stringify({
      source: 'admin_derive_email',
      resolved_from_source: emailAttr.source_system,
      resolved_from_source_id: resolvedFrom,
      backfill_run_at: now,
    }));

    const newRow = db.prepare(
      'SELECT id, gcuid, alias_type, alias_value, status, created_at FROM aliases WHERE id = ?'
    ).get(insertResult.lastInsertRowid);
    db.close();
    res.json({ success: true, data: newRow, deduped: false });
  } catch (error) { next(error); }
});

/**
 * POST /api/gcuid/aliases/:gcuid
 * Generate and persist a GC-style alias for a GCUID.
 * Body: { context?: string }  — defaults to 'A'
 * The alias is deterministic per (gcuid, context) so duplicate calls return the existing alias.
 */
router.post('/aliases/:gcuid', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!readFlags().aliases.generated) {
      throw createError('System-generated aliases are disabled by feature flag', 403);
    }
    const { gcuid } = req.params;
    const context: string = ((req.body?.context as string | undefined) ?? 'A').toUpperCase();

    if (!/^[A-Z]{1,10}$/.test(context)) {
      throw createError('context must be 1–10 uppercase letters (A–Z)', 400);
    }

    const core = gcuid.startsWith('urn:gcuid:') ? gcuid.slice('urn:gcuid:'.length) : null;
    if (!core) throw createError('Invalid GCUID format — expected urn:gcuid:{core}', 400);

    const aliasType  = `GC-${context}`;
    const aliasValue = buildGCAlias(core, context);
    const createdAt  = new Date().toISOString();

    const db = new Database(REGISTRY_DB);
    if (!db.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(gcuid)) {
      db.close(); throw createError('Identity not found', 404);
    }

    // Alias is deterministic — re-enable and update value if already generated (handles disabled + corrupted records)
    const existing = db.prepare(
      'SELECT id, gcuid, alias_type, alias_value, status, created_at FROM aliases WHERE gcuid = ? AND alias_type = ?'
    ).get(gcuid, aliasType) as any;
    if (existing) {
      if (existing.status === 'enabled' && existing.alias_value === aliasValue) {
        db.close(); return res.json({ success: true, data: existing });
      }
      // Re-enable and correct the value (was disabled or had corrupted checksum)
      db.prepare(
        "UPDATE aliases SET status = 'enabled', alias_value = ?, created_at = ? WHERE id = ?"
      ).run(aliasValue, createdAt, existing.id);
      db.close();
      return res.json({ success: true, data: { ...existing, alias_value: aliasValue, status: 'enabled', created_at: createdAt } });
    }

    const result = db.prepare(
      "INSERT INTO aliases (gcuid, alias_type, alias_value, status, created_at) VALUES (?, ?, ?, 'enabled', ?)"
    ).run(gcuid, aliasType, aliasValue, createdAt);
    db.close();

    res.status(201).json({
      success: true,
      data: { id: Number(result.lastInsertRowid), gcuid, alias_type: aliasType, alias_value: aliasValue, status: 'enabled', created_at: createdAt }
    });
  } catch (error) { next(error); }
});

/**
 * PATCH /api/gcuid/aliases/:gcuid/:id/disable
 * Disable an alias — it remains bound to the GCUID for life but will not
 * resolve until re-enabled.  Aliases cannot be deleted.
 * Body (optional): { reason?: string }
 */
router.patch('/aliases/:gcuid/:id/disable', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid, id } = req.params;
    const reason = (req.body?.reason as string | undefined)?.trim() ?? 'Alias disabled';
    const numId = parseInt(id, 10);
    if (isNaN(numId)) throw createError('Invalid alias id', 400);

    const db = new Database(REGISTRY_DB);
    const existing = db.prepare(
      'SELECT id, alias_type, alias_value, status FROM aliases WHERE id = ? AND gcuid = ?'
    ).get(numId, gcuid) as any;
    if (!existing) { db.close(); throw createError('Alias not found', 404); }
    if (existing.status === 'disabled') { db.close(); return res.json({ success: true, data: { ...existing, gcuid } }); }

    const identity = db.prepare('SELECT state FROM identities WHERE gcuid = ?').get(gcuid) as any;
    const ts = new Date().toISOString();

    db.prepare(`
      INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
      VALUES (?, ?, 'active', 'alias_disabled', ?, ?, ?)
    `).run(gcuid, identity?.state ?? 'unknown', `${existing.alias_type}:${existing.alias_value} — ${reason}`, getActor(req, res), ts);

    db.prepare("UPDATE aliases SET status = 'disabled' WHERE id = ?").run(numId);
    db.close();
    res.json({ success: true, data: { id: numId, gcuid, alias_type: existing.alias_type, alias_value: existing.alias_value, status: 'disabled', disabled_at: ts } });
  } catch (error) { next(error); }
});

/**
 * PATCH /api/gcuid/aliases/:gcuid/:id/enable
 *
 * Re-enable a previously disabled alias. Idempotent: enabling an
 * already-enabled alias returns it without writing to history.
 * The transition is recorded in `state_history` with
 * `transition_type = 'alias_enabled'` (preserved in the audit trail).
 *
 * @route   PATCH /api/gcuid/aliases/:gcuid/:id/enable
 * @param   gcuid — registry GCUID (path param).
 * @param   id    — `aliases` row primary key (path param).
 * @body    `{ reason?: string }` — defaults to `'Alias re-enabled'`.
 * @returns 200 — `{ success: true, data: { id, gcuid, alias_type, alias_value, status: 'enabled', enabled_at } }`
 * @throws  400 — `Invalid alias id` (non-numeric).
 * @throws  404 — `Alias not found`.
 * @throws  500 — DB write failure.
 */
router.patch('/aliases/:gcuid/:id/enable', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gcuid, id } = req.params;
    const reason = (req.body?.reason as string | undefined)?.trim() ?? 'Alias re-enabled';
    const numId = parseInt(id, 10);
    if (isNaN(numId)) throw createError('Invalid alias id', 400);

    const db = new Database(REGISTRY_DB);
    const existing = db.prepare(
      'SELECT id, alias_type, alias_value, status FROM aliases WHERE id = ? AND gcuid = ?'
    ).get(numId, gcuid) as any;
    if (!existing) { db.close(); throw createError('Alias not found', 404); }
    if (existing.status === 'enabled') { db.close(); return res.json({ success: true, data: { ...existing, gcuid } }); }

    const identity = db.prepare('SELECT state FROM identities WHERE gcuid = ?').get(gcuid) as any;
    const ts = new Date().toISOString();

    db.prepare(`
      INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
      VALUES (?, ?, 'active', 'alias_enabled', ?, ?, ?)
    `).run(gcuid, identity?.state ?? 'unknown', `${existing.alias_type}:${existing.alias_value} — ${reason}`, getActor(req, res), ts);

    db.prepare("UPDATE aliases SET status = 'enabled' WHERE id = ?").run(numId);
    db.close();
    res.json({ success: true, data: { id: numId, gcuid, alias_type: existing.alias_type, alias_value: existing.alias_value, status: 'enabled', enabled_at: ts } });
  } catch (error) { next(error); }
});

export { router as adminRoutes };
