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
 * LDAP/AD Portal API Routes
 * 
 * Routes for monitoring the LDAP/Active Directory authoritative source connector
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createError } from '../middleware/error.js';
import { logLDAP } from '../lib/logging/logger.js';
import { LDAP_EVENTS } from '../lib/logging/log-events.js';
import { IS_EFS_MODE, CONNECTORS_DIR as EFS_CONNECTORS_DIR, REGISTRY_DB_PATH } from '../lib/db-paths.js';

const CROCKFORD_ALPHA_LDAP = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generate a ULID-style core using the same alphabet/format as the rest of the codebase. */
function generateRegistrationCoreLdap(): string {
  const ms = Date.now();
  let t = ms;
  let tsChars = '';
  for (let i = 9; i >= 0; i--) {
    tsChars = CROCKFORD_ALPHA_LDAP[t % 32] + tsChars;
    t = Math.floor(t / 32);
  }
  const rnd = crypto.randomBytes(10);
  let bits = 0n;
  for (const b of rnd) bits = (bits << 8n) | BigInt(b);
  let rndChars = '';
  for (let i = 15; i >= 0; i--) {
    rndChars = CROCKFORD_ALPHA_LDAP[Number(bits % 32n)] + rndChars;
    bits >>= 5n;
  }
  return tsChars + rndChars;
}

const LDAP_DB           = IS_EFS_MODE ? path.join(EFS_CONNECTORS_DIR, 'conn-ldap.db') : './data/sources/conn-ldap.db';
const router = Router();
// In Lambda, lambda-handler.js calls process.chdir('/tmp') so relative paths break.
// Use LAMBDA_TASK_ROOT (always /var/task) for config files and db-paths.ts for DB files.
const CONFIG_ROOT       = process.env['LAMBDA_TASK_ROOT'] ?? process.cwd();
const REGISTRY_DB       = IS_EFS_MODE ? REGISTRY_DB_PATH : './data/registry.db';
const LDAP_CONNECTOR_URL = 'http://localhost:5184';
const LDAP_CONNECTOR_JSON = path.join(CONFIG_ROOT, 'config', 'connectors', 'conn-ldap.json');

/** Read the registered connector API URL from source_systems, with a safe fallback. */
function getLdapConnectorUrl(): string {
  try {
    const db = new Database(REGISTRY_DB, { readonly: true });
    const row = db.prepare(`SELECT api_url FROM source_systems WHERE system_id = 'ldap'`).get() as any;
    db.close();
    return (row?.api_url as string | null) ?? 'http://localhost:5184';
  } catch {
    return 'http://localhost:5184';
  }
}

function isLdapConnectorEnabled(): boolean {
  try {
    const cfg = JSON.parse(fs.readFileSync(LDAP_CONNECTOR_JSON, 'utf-8')) as { enabled?: boolean };
    return cfg.enabled !== false;
  } catch {
    return true;
  }
}

/** In EFS mode the sidecar process doesn't run — probe the SQLite DB file directly. */
function probeLdapConnectorDb(): { status: string; message: string; record_count?: number } {
  try {
    const db = new Database(LDAP_DB, { readonly: true });
    const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    db.close();
    return { status: 'operational', message: 'Direct EFS DB access OK', record_count: row.cnt };
  } catch (err) {
    return { status: 'degraded', message: err instanceof Error ? err.message : 'DB probe failed' };
  }
}

// ============================================================================
// LDAP System Data Endpoints
// ============================================================================

/**
 * GET /api/ldap/users
 *
 * List all users from the LDAP/AD authoritative source.
 *
 * Joins each user row with the GCUID Registry to attach the
 * identity's GCUID and state (when one exists), and parses the
 * stored `groups` JSON column into an array when present.
 *
 * @returns 200 — `{ success: true, data: UserRow[], count: number }`
 *          where `UserRow` is every column of `data/sources/conn-ldap.db#users`
 *          plus `gcuid: string | null` and `gcuid_state: string | null`.
 * @throws  500 — database read failure.
 */
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ldapDb = new Database(LDAP_DB, { readonly: true });
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    
    const users = ldapDb.prepare('SELECT * FROM users ORDER BY username').all();
    
    // Add GCUID mapping info
    users.forEach((user: any) => {
      // Try to find GCUID by username, email alias, or source mapping
      const identity = registryDb.prepare(`
        SELECT gcuid, state FROM identities
        WHERE entity_id LIKE ?
           OR entity_id IN (
             SELECT entity_id FROM identities WHERE gcuid IN (
               SELECT gcuid FROM aliases WHERE alias_value = ?
             )
           )
           OR gcuid IN (SELECT gcuid FROM source_mappings WHERE source_system = 'ldap' AND source_id = ?)
        LIMIT 1
      `).get(user.username, user.email, user.username) as any;
      
      user.gcuid = identity?.gcuid || null;
      user.gcuid_state = identity?.state || null;
      
      // Parse groups JSON if exists
      if (user.groups && typeof user.groups === 'string') {
        try {
          user.groups = JSON.parse(user.groups);
        } catch (e) {
          // Leave as string if not valid JSON
        }
      }
    });
    
    ldapDb.close();
    registryDb.close();
    
    res.json({
      success: true,
      data: users,
      count: users.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ldap/users/:username
 *
 * View one LDAP/AD user record, joined with their GCUID identity and
 * full alias / source-mapping history when present.
 *
 * @route   GET /api/ldap/users/:username
 * @param   username — LDAP `uid` (path param).
 * @returns 200 — `{ success: true, data: UserRow & { gcuid_details: IdentityRow & { aliases: AliasRow[], source_mappings: SourceMappingRow[] } | null } }`
 * @throws  404 — `createError('User not found in LDAP', 404)` when no row matches `:username`.
 * @throws  500 — database read failure.
 */
router.get('/users/:username', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username } = req.params;
    
    const ldapDb = new Database(LDAP_DB, { readonly: true });
    const user = ldapDb.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    ldapDb.close();
    
    if (!user) {
      logLDAP('info', LDAP_EVENTS.USER_NOT_FOUND, {
        component:  'api:ldap',
        username,
        actor_id:   (req.ip ?? 'system'),
        request_id: (req as any).requestId,
      });
      throw createError('User not found in LDAP', 404);
    }
    
    // Parse groups JSON
    if (user.groups && typeof user.groups === 'string') {
      try {
        user.groups = JSON.parse(user.groups);
      } catch (e) {
        // Leave as string
      }
    }
    
    // Get GCUID mapping details
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    const identity = registryDb.prepare(`
      SELECT * FROM identities
      WHERE entity_id = ?
         OR entity_id IN (
           SELECT entity_id FROM identities WHERE gcuid IN (
             SELECT gcuid FROM aliases WHERE alias_value = ?
           )
         )
         OR gcuid IN (SELECT gcuid FROM source_mappings WHERE source_system = 'ldap' AND source_id = ?)
      LIMIT 1
    `).get(username, user.email, username) as any;
    
    const aliases = identity ? registryDb.prepare(
      'SELECT * FROM aliases WHERE gcuid = ?'
    ).all(identity.gcuid) : [];
    
    const sourceMappings = identity ? registryDb.prepare(
      'SELECT * FROM source_mappings WHERE gcuid = ?'
    ).all(identity.gcuid) : [];
    
    registryDb.close();
    
    logLDAP('debug', LDAP_EVENTS.USER_VIEWED, {
      component:  'api:ldap',
      username,
      actor_id:   (req.ip ?? 'system'),
      request_id: (req as any).requestId,
    });

    res.json({
      success: true,
      data: {
        ...user,
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
 * GET /api/ldap/stats
 *
 * Aggregate statistics over the LDAP/AD dataset:
 * - Total users
 * - Enabled vs disabled count
 * - Approximate GCUID coverage (matched by username OR email)
 *
 * @returns 200 — `{ success: true, data: { total_users: number, enabled: number, disabled: number, with_gcuid: number, without_gcuid: number, gcuid_percentage: string } }`
 * @throws  500 — database read failure.
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ldapDb = new Database(LDAP_DB, { readonly: true });
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    
    // Total users in LDAP
    const totalUsers = ldapDb.prepare('SELECT COUNT(*) as count FROM users').get() as any;
    
    // Enabled vs disabled
    const byStatus = ldapDb.prepare(`
      SELECT account_enabled, COUNT(*) as count
      FROM users
      GROUP BY account_enabled
    `).all();
    
    // Users with GCUIDs (approximate - match by username or email)
    const allUsers = ldapDb.prepare('SELECT username, email FROM users').all();
    let withGcuid = 0;
    for (const user of allUsers as any[]) {
      const identity = registryDb.prepare(`
        SELECT COUNT(*) as count FROM identities 
        WHERE entity_id LIKE ? OR entity_id IN (
          SELECT entity_id FROM identities WHERE gcuid IN (
            SELECT gcuid FROM aliases WHERE alias_value = ?
          )
        )
      `).get(user.username, user.email) as any;
      
      if (identity.count > 0) withGcuid++;
    }
    
    ldapDb.close();
    registryDb.close();
    
    const gcuidPercentage = totalUsers.count > 0
      ? ((withGcuid / totalUsers.count) * 100).toFixed(1)
      : '0.0';
    
    const enabledCount  = (byStatus.find((s: any) => s.account_enabled === 1) as any)?.count || 0;
    const disabledCount = (byStatus.find((s: any) => s.account_enabled === 0) as any)?.count || 0;
    
    res.json({
      success: true,
      data: {
        total_users: totalUsers.count,
        enabled_accounts: enabledCount,
        disabled_accounts: disabledCount,
        with_gcuid: withGcuid,
        without_gcuid: totalUsers.count - withGcuid,
        gcuid_percentage: `${gcuidPercentage}%`
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ldap/search?q=query
 *
 * Search LDAP/AD users by `LIKE %query%` against username, display
 * name, email, or DN. Returns up to 20 matches ordered by username,
 * each enriched with `gcuid` and `gcuid_state` from the registry.
 *
 * @route   GET /api/ldap/search
 * @param   q — query string (query param, required). Case-insensitive
 *             substring; no fuzzy matching.
 * @returns 200 — `{ success: true, data: UserRow[], count: number }`
 *          (max 20 rows; same shape as `/users`).
 * @throws  400 — `createError('Query parameter "q" is required', 400)` when `q` is missing.
 * @throws  500 — database read failure.
 */
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.query.q as string;
    
    if (!query) {
      throw createError('Query parameter "q" is required', 400);
    }
    
    const ldapDb = new Database(LDAP_DB, { readonly: true });
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    
    const users = ldapDb.prepare(`
      SELECT * FROM users
      WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ? OR dn LIKE ?
      ORDER BY username
      LIMIT 20
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
    
    // Add GCUID info and parse groups
    users.forEach((user: any) => {
      const identity = registryDb.prepare(`
        SELECT gcuid, state FROM identities 
        WHERE entity_id LIKE ? OR entity_id IN (
          SELECT entity_id FROM identities WHERE gcuid IN (
            SELECT gcuid FROM aliases WHERE alias_value = ?
          )
        )
      `).get(user.username, user.email) as any;
      
      user.gcuid = identity?.gcuid || null;
      user.gcuid_state = identity?.state || null;
      
      if (user.groups && typeof user.groups === 'string') {
        try {
          user.groups = JSON.parse(user.groups);
        } catch (e) {
          // Leave as string
        }
      }
    });
    
    ldapDb.close();
    registryDb.close();
    
    res.json({
      success: true,
      data: users,
      count: users.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ldap/coverage-gaps
 *
 * Returns the two coverage-gap views for LDAP/AD:
 *
 * 1. **Without GCUID** — LDAP users that have no entry in
 *    `source_mappings` (never issued a GCUID).
 * 2. **Degraded** — GCUIDs backed by LDAP whose registry identity is
 *    in a non-active state (superseded / reserved / withdrawn / etc.).
 *
 * Used by the LDAP coverage dashboard to drive the "request GCUID"
 * action.
 *
 * @returns 200 — `{ success: true, data: { source: 'LDAP / AD', gaps: { without_gcuid: { count, users }, degraded_coverage: { count, records } } } }`
 * @throws  500 — database read failure.
 */
router.get('/coverage-gaps', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const ldapDb     = new Database(LDAP_DB,     { readonly: true });
    const registryDb = new Database(REGISTRY_DB, { readonly: true });

    // LDAP users with no source_mapping entry (username as source_id)
    const mappedUsernames = new Set(
      (registryDb.prepare(
        `SELECT source_id FROM source_mappings WHERE source_system = 'ldap'`
      ).all() as Array<{ source_id: string }>).map(r => r.source_id)
    );
    const allUsers = ldapDb.prepare(
      `SELECT username, first_name, last_name, email, department, account_enabled FROM users ORDER BY username`
    ).all() as Array<{ username: string; first_name: string; last_name: string; email: string; department: string; account_enabled: number }>;

    const withoutGcuid = allUsers.filter(u => !mappedUsernames.has(u.username));

    // Mapped users whose registry identity is in a non-active state
    const degraded = registryDb.prepare(
      `SELECT sm.source_id AS username, i.gcuid, i.state
       FROM source_mappings sm
       JOIN identities i ON i.gcuid = sm.gcuid
       WHERE sm.source_system = 'ldap'
         AND i.state NOT IN ('active', 'provisional')`
    ).all() as Array<{ username: string; gcuid: string; state: string }>;

    ldapDb.close();
    registryDb.close();

    res.json({
      success: true,
      data: {
        source: 'LDAP / AD',
        gaps: {
          without_gcuid:     { count: withoutGcuid.length, users:   withoutGcuid },
          degraded_coverage: { count: degraded.length,     records: degraded     },
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ldap/connector/health
 *
 * Composite health snapshot of the LDAP/AD connector, combining three
 * sources:
 *
 * 1. **Registry registration** — row from `source_systems` (api_url,
 *    access_mode, last_sync_at, cache_ttl, etc.)
 * 2. **Direct DB probe** — opens `conn-ldap.db` read-only and counts
 *    enabled rows. In EFS mode this is the only probe (no sidecar).
 * 3. **Live endpoint probe** — `GET {api_url}/health` with 3-second
 *    timeout. Non-EFS mode only.
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
         FROM source_systems WHERE system_id = 'ldap'`
      ).get();
      gcuidCount = (registryDb.prepare(
        `SELECT COUNT(DISTINCT gcuid) AS n FROM source_mappings WHERE source_system = 'ldap'`
      ).get() as any)?.n ?? 0;
    } finally {
      registryDb.close();
    }

    const enabled = isLdapConnectorEnabled();

    // ── DB probe ────────────────────────────────────────────────────────────
    let dbStatus = 'unavailable';
    let dbMessage = 'DB probe not attempted';
    let localRecordCount = 0;
    try {
      const ldapDb = new Database(LDAP_DB, { readonly: true });
      localRecordCount = (ldapDb.prepare(`SELECT COUNT(*) AS n FROM users WHERE account_enabled = 1`).get() as any).n;
      ldapDb.close();
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
      const connectorUrl = (sysRow?.api_url as string | null) ?? getLdapConnectorUrl();
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

    res.json({
      success: true,
      data: {
        system_id:            sysRow?.system_id            ?? 'ldap',
        connector_id:         sysRow?.connector_id         ?? 'conn-ldap',
        display_name:         sysRow?.display_name         ?? 'LDAP / Active Directory',
        access_mode:          sysRow?.access_mode          ?? 'dynamic-pull',
        is_active:            enabled && !!sysRow?.is_active,
        connector_url:        IS_EFS_MODE ? LDAP_DB : ((sysRow?.api_url as string | null) ?? getLdapConnectorUrl()),
        connector_port:       IS_EFS_MODE ? null    : null,
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
        system_id:    'ldap',
        connector_id: 'conn-ldap',
        display_name: 'LDAP / Active Directory',
        access_mode:  'dynamic-pull',
        status:       'unavailable',
        error:        error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

/**
 * GET /api/ldap/connector/info
 *
 * Live connector introspection — `GET {connectorUrl}/info` proxied
 * through to the running LDAP sidecar (or EFS-mounted connector
 * service). Returns whatever the connector decides to expose
 * (typically: name, version, supported operations, schema).
 *
 * @returns 200 — `{ success: true, data: <whatever /info returned> }`
 * @throws  502 / 500 — `next(error)` if the upstream fetch fails or returns non-JSON.
 */
router.get('/connector/info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await fetch(`${getLdapConnectorUrl()}/info`);
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
 * POST /api/ldap/users
 *
 * Create a new LDAP/AD user record.
 *
 * Important: LDAP has no direct write path into the GCUID Registry.
 * Creating a user here does NOT issue a GCUID or create any
 * source_mapping. To link an LDAP user to a GCUID, the user or an
 * admin must explicitly call `/api/gcuid-request/preview` then
 * `/api/gcuid-request/submit` (or `/api/user/self-register`).
 *
 * @route   POST /api/ldap/users
 * @body    `{ username, distinguished_name, email, first_name, last_name, department, title?, account_enabled?, groups? }`
 *          `account_enabled` defaults to `true`. `groups` may be a single string or string array (serialised to JSON).
 * @returns 201 — `{ success: true, data: UserRow }`
 * @throws  400 — `createError('...required', 400)` when any required field is missing.
 * @throws  409 — `createError('Username ... already exists', 409)` when `:username` is taken.
 */
router.post('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      username, distinguished_name, email, first_name, last_name,
      department, title, account_enabled = true, groups,
    } = req.body;

    if (!username || !distinguished_name || !email || !first_name || !last_name || !department) {
      throw createError('username, distinguished_name, email, first_name, last_name, and department are required', 400);
    }

    const ldapDb = new Database(LDAP_DB);
    const existing = ldapDb.prepare('SELECT username FROM users WHERE username = ?').get(username);
    if (existing) {
      ldapDb.close();
      throw createError(`Username ${username} already exists`, 409);
    }

    const now = new Date().toISOString();
    const groupsJson = groups ? JSON.stringify(Array.isArray(groups) ? groups : [groups]) : null;
    ldapDb.prepare(`
      INSERT INTO users
        (username, distinguished_name, email, first_name, last_name, department, title, account_enabled, groups, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(username, distinguished_name, email, first_name, last_name, department, title ?? null, account_enabled ? 1 : 0, groupsJson, now, now);

    const user = ldapDb.prepare('SELECT * FROM users WHERE username = ?').get(username) as Record<string, any>;
    ldapDb.close();

    // Per architecture requirements (R3, R6): LDAP user creation must not
        // auto-create a GCUID or mappings in the registry. The GCUID/CAES
        // system is arms-length from authoritative sources. An admin must
        // explicitly request a GCUID via /api/gcuid-request/preview + /submit,
        // or the user must self-register. The connector layer is the bridge
        // used by those explicit flows — LDAP has no direct registry write.

        logLDAP('notice', LDAP_EVENTS.USER_UPDATED, {
          component:         'api:ldap',
          username,
          actor_id:          (req.ip ?? 'system'),
          attribute_changed: '-',
          request_id:        (req as any).requestId,
        });

        res.status(201).json({
          success: true,
          data: user,
        });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/ldap/users/:username
 *
 * Partial update of an LDAP/AD user record. Only the fields listed
 * below are accepted; any other key in `req.body` is silently
 * ignored. `account_enabled` is converted to 0/1; `groups` is
 * serialised to JSON if given as an array. `updated_at` is set
 * server-side.
 *
 * @route   PUT /api/ldap/users/:username
 * @param   username — LDAP `uid` (path param).
 * @body    Any subset of `{ distinguished_name, email, first_name, last_name, department, title, account_enabled, groups, last_logon }`.
 * @returns 200 — `{ success: true, data: UserRow }`
 * @throws  400 — `createError('No updatable fields provided', 400)` when none of the accepted keys are present.
 * @throws  404 — `createError('User not found', 404)` when `:username` does not exist.
 */
router.put('/users/:username', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username } = req.params;
    const fields = ['distinguished_name', 'email', 'first_name', 'last_name', 'department', 'title', 'account_enabled', 'groups', 'last_logon'];
    const updates: Record<string, any> = {};
    for (const f of fields) {
      if (f in req.body) {
        if (f === 'account_enabled') updates[f] = req.body[f] ? 1 : 0;
        else if (f === 'groups') updates[f] = Array.isArray(req.body[f]) ? JSON.stringify(req.body[f]) : req.body[f];
        else updates[f] = req.body[f];
      }
    }

    if (Object.keys(updates).length === 0) {
      throw createError('No updatable fields provided', 400);
    }

    const ldapDb = new Database(LDAP_DB);
    const existing = ldapDb.prepare('SELECT username FROM users WHERE username = ?').get(username);
    if (!existing) {
      ldapDb.close();
      throw createError('User not found', 404);
    }

    updates.updated_at = new Date().toISOString();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    ldapDb.prepare(`UPDATE users SET ${setClauses} WHERE username = ?`).run(...Object.values(updates), username);

    const user = ldapDb.prepare('SELECT * FROM users WHERE username = ?').get(username);
    ldapDb.close();

    logLDAP('notice', LDAP_EVENTS.USER_UPDATED, {
      component:         'api:ldap',
      username,
      actor_id:          (req.ip ?? 'system'),
      attribute_changed: Object.keys(req.body).join(','),
      request_id:        (req as any).requestId,
    });

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/ldap/users/:username
 *
 * Permanently delete an LDAP/AD user row.
 *
 * Important: LDAP does NOT clean up any source_mappings or
 * identities the GCUID Registry may have created through explicit
 * `/api/gcuid-request/*` flows. The arms-length boundary is
 * preserved — registry records owned by the GCUID system remain.
 * If GCUID-side cleanup is needed, route it through the connector
 * layer (push-cache or scheduled-pull), not by LDAP writing the
 * registry directly.
 *
 * @route   DELETE /api/ldap/users/:username
 * @param   username — LDAP `uid` (path param).
 * @returns 200 — `{ success: true, data: { deleted: <username> } }`
 * @throws  404 — `createError('User not found', 404)` when `:username` does not exist.
 */
router.delete('/users/:username', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username } = req.params;
    const ldapDb = new Database(LDAP_DB);
    const existing = ldapDb.prepare('SELECT username FROM users WHERE username = ?').get(username);
    if (!existing) {
      ldapDb.close();
      throw createError('User not found', 404);
    }

    ldapDb.prepare('DELETE FROM users WHERE username = ?').run(username);
    ldapDb.close();

    // No registry cleanup here: LDAP no longer auto-provisions a GCUID on
        // user create, so there is no source_mapping that LDAP "owns" to
        // clean up. If a GCUID was later explicitly requested via
        // /api/gcuid-request/submit, that mapping is owned by the GCUID
        // system and must not be removed by LDAP delete — that would cross
        // the arms-length boundary. If the GCUID system needs to be notified
        // of the LDAP deletion, it should do so via the connector
        // (push-cache or scheduled-pull), not by LDAP writing the registry
        // directly.

        logLDAP('notice', LDAP_EVENTS.USER_UPDATED, {
      component:         'api:ldap',
      username,
      actor_id:          (req.ip ?? 'system'),
      attribute_changed: 'deleted',
      request_id:        (req as any).requestId,
    });

    res.json({ success: true, data: { deleted: username } });
  } catch (error) {
    next(error);
  }
});

export { router as ldapRoutes };
