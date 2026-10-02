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
 * Application Access Policy Routes
 *
 * Manages which authoritative source governs access to each corporate
 * application, and validates login credentials against that source.
 *
 * Routes:
 *   GET  /api/policies              – list all app policies (with defaults)
 *   GET  /api/policies/:appId       – get policy for one app
 *   PUT  /api/policies/:appId       – upsert policy for one app
 *   POST /api/policies/validate     – validate a login attempt
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { IS_EFS_MODE, CONNECTORS_DIR as EFS_CONNECTORS_DIR, REGISTRY_DB_PATH } from '../lib/db-paths.js';

const router = Router();

// ── DB paths ──────────────────────────────────────────────────────────────────

const REGISTRY_DB   = IS_EFS_MODE ? REGISTRY_DB_PATH                                      : './data/registry.db';
const HR_DB         = IS_EFS_MODE ? path.join(EFS_CONNECTORS_DIR, 'conn-hr.db')           : './data/sources/conn-hr.db';
const LDAP_DB       = IS_EFS_MODE ? path.join(EFS_CONNECTORS_DIR, 'conn-ldap.db')         : './data/sources/conn-ldap.db';
const ENG_DB        = IS_EFS_MODE ? path.join(EFS_CONNECTORS_DIR, 'conn-engineering.db')  : './data/sources/conn-engineering.db';
const FIN_DB        = IS_EFS_MODE ? path.join(EFS_CONNECTORS_DIR, 'conn-finance.db')      : './data/sources/conn-finance.db';

// ── Known app IDs ─────────────────────────────────────────────────────────────

const VALID_APP_IDS = ['budget', 'projects', 'travel', 'assets', 'hrconnect', 'procurement'];

// ── Default policies (used when none configured in DB) ────────────────────────

interface PolicyRow {
  app_id:          string;
  source_system:   string;      // 'hr' | 'ldap' | 'engineering' | 'finance'
  credential_field: string;     // The column name to match against in the source DB
  credential_label: string;     // Display label shown in the login form
  access_type:     string;      // 'account_exists' | 'attribute_match'
  attribute_key:   string | null;
  attribute_value: string | null;
  created_at:      string;
  updated_at:      string;
}

const DEFAULTS: Record<string, Omit<PolicyRow, 'app_id' | 'created_at' | 'updated_at'>> = {
  budget:      { source_system: 'hr',          credential_field: 'employee_id', credential_label: 'Employee ID',         access_type: 'account_exists', attribute_key: null, attribute_value: null },
  projects:    { source_system: 'ldap',         credential_field: 'username',    credential_label: 'Network Username',    access_type: 'account_exists', attribute_key: null, attribute_value: null },
  travel:      { source_system: 'hr',          credential_field: 'employee_id', credential_label: 'Employee ID',         access_type: 'account_exists', attribute_key: null, attribute_value: null },
  assets:      { source_system: 'ldap',         credential_field: 'username',    credential_label: 'Network Username',    access_type: 'account_exists', attribute_key: null, attribute_value: null },
  hrconnect:   { source_system: 'hr',          credential_field: 'employee_id', credential_label: 'Employee ID',         access_type: 'attribute_match', attribute_key: 'department', attribute_value: 'Human Resources' },
  procurement: { source_system: 'finance',      credential_field: 'dept_id',     credential_label: 'Finance Dept ID',    access_type: 'account_exists', attribute_key: null, attribute_value: null },
};

// ── Ensure table exists ───────────────────────────────────────────────────────

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_policies (
      app_id           TEXT PRIMARY KEY,
      source_system    TEXT NOT NULL,
      credential_field TEXT NOT NULL,
      credential_label TEXT NOT NULL,
      access_type      TEXT NOT NULL DEFAULT 'account_exists',
      attribute_key    TEXT,
      attribute_value  TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function withDefault(row: PolicyRow | undefined, appId: string): PolicyRow {
  if (row) return row;
  const def = DEFAULTS[appId];
  if (!def) return {
    app_id:          appId,
    source_system:   'hr',
    credential_field:'employee_id',
    credential_label:'Employee ID',
    access_type:     'account_exists',
    attribute_key:   null,
    attribute_value: null,
    created_at:      '',
    updated_at:      '',
  };
  return { app_id: appId, ...def, created_at: '', updated_at: '' };
}

/** Open a connector DB safely; return null if unavailable. */
function tryOpenDb(dbPath: string): Database.Database | null {
  try {
    return new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }
}

/** Look up a record in the appropriate source DB and optionally check an attribute. */
function lookupCredential(policy: PolicyRow, credential: string): {
  found: boolean;
  granted: boolean;
  reason: string;
  record?: Record<string, unknown>;
} {
  const { source_system, credential_field, access_type, attribute_key, attribute_value } = policy;

  let dbPath: string;
  let tableName: string;

  switch (source_system) {
    case 'hr':          dbPath = HR_DB;   tableName = 'employees'; break;
    case 'ldap':        dbPath = LDAP_DB; tableName = 'users';     break;
    case 'engineering': dbPath = ENG_DB;  tableName = 'employees'; break;
    case 'finance':     dbPath = FIN_DB;  tableName = 'employees'; break;
    default:
      return { found: false, granted: false, reason: `Unknown source system: ${source_system}` };
  }

  const db = tryOpenDb(dbPath);
  if (!db) {
    return { found: false, granted: false, reason: `Source system '${source_system}' is currently unavailable.` };
  }

  let record: Record<string, unknown> | undefined;
  try {
    record = db.prepare(`SELECT * FROM ${tableName} WHERE ${credential_field} = ?`).get(credential) as Record<string, unknown> | undefined;
    // Safety net (LDAP only): if the direct lookup missed AND the credential
    // value looks like a distinguished name (starts with 'CN='), retry by
    // `distinguished_name`.  The originating portal (LDAP Portal's
    // GcuidRequestPanel) is expected to write `username`; this fallback
    // exists to keep users who were linked before that fix was deployed
    // able to sign in.  Matches the dual-key tolerance already used by
    // gcuid-request.ts and user.ts.  Cost: one extra indexed SELECT only
    // on the LDAP miss path; zero impact on other source systems.
    if (!record && source_system === 'ldap' && credential.startsWith('CN=')) {
      record = db.prepare(`SELECT * FROM ${tableName} WHERE distinguished_name = ?`).get(credential) as Record<string, unknown> | undefined;
    }
  } finally {
    db.close();
  }

  if (!record) {
    return {
      found: false,
      granted: false,
      reason: `No account found in ${source_system.toUpperCase()} with ${credential_field} = '${credential}'.`,
    };
  }

  // Account found — now check access_type
  if (access_type === 'account_exists') {
    // For LDAP, also check account_enabled if present
    if (source_system === 'ldap' && 'account_enabled' in record && !record['account_enabled']) {
      return { found: true, granted: false, reason: 'Account exists but is disabled in LDAP.', record };
    }
    return { found: true, granted: true, reason: `Account found and active in ${source_system.toUpperCase()}.`, record };
  }

  if (access_type === 'attribute_match' && attribute_key) {
    const actualValue = String(record[attribute_key] ?? '');
    const expectedValue = attribute_value ?? '';
    if (actualValue.toLowerCase() === expectedValue.toLowerCase()) {
      return { found: true, granted: true, reason: `Attribute check passed: ${attribute_key} = '${actualValue}'.`, record };
    }
    return {
      found: true,
      granted: false,
      reason: `Policy requires ${attribute_key} = '${expectedValue}', but account has '${actualValue}'.`,
      record,
    };
  }

  return { found: true, granted: true, reason: 'Access granted.', record };
}

/** Try to find the GCUID linked to this source account. */
function findLinkedGcuid(registryDb: Database.Database, sourceSystem: string, sourceId: string): string | null {
  try {
    const row = registryDb.prepare(
      `SELECT gcuid FROM source_mappings WHERE source_system = ? AND source_id = ? LIMIT 1`
    ).get(sourceSystem, sourceId) as { gcuid: string } | undefined;
    return row?.gcuid ?? null;
  } catch {
    return null;
  }
}

// ── GET /api/policies ─────────────────────────────────────────────────────────

/**
 * GET /api/policies
 *
 * List every known application's policy, merging DB-stored overrides
 * with the in-code defaults from `DEFAULTS`. The table is created on
 * first call if missing (`ensureTable`).
 *
 * @returns 200 — `{ success: true, data: { policies: PolicyRow[] } }` where `PolicyRow` is one of the `VALID_APP_IDS` mapped through `withDefault`.
 * @throws  500 — database read failure.
 */
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = new Database(REGISTRY_DB);
    ensureTable(db);

    const rows = db.prepare('SELECT * FROM app_policies').all() as PolicyRow[];
    db.close();

    const byId = Object.fromEntries(rows.map(r => [r.app_id, r]));
    const policies = VALID_APP_IDS.map(id => withDefault(byId[id], id));

    res.json({ success: true, data: { policies } });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/policies/:appId ──────────────────────────────────────────────────

/**
 * GET /api/policies/:appId
 *
 * Get the policy for one application. Falls back to the in-code
 * default if no DB row exists.
 *
 * @route   GET /api/policies/:appId
 * @param   appId — one of `VALID_APP_IDS`: `budget | projects | travel | assets | hrconnect | procurement`.
 * @returns 200 — `{ success: true, data: { policy: PolicyRow } }` (the row may be a DB override OR the in-code default).
 * @throws  500 — database read failure.
 */
router.get('/:appId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { appId } = req.params;
    const db = new Database(REGISTRY_DB);
    ensureTable(db);

    const row = db.prepare('SELECT * FROM app_policies WHERE app_id = ?').get(appId) as PolicyRow | undefined;
    db.close();

    res.json({ success: true, data: { policy: withDefault(row, appId) } });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/policies/:appId ──────────────────────────────────────────────────

/**
 * PUT /api/policies/:appId
 *
 * Upsert the policy for one application. Existing rows are
 * overwritten; new rows are inserted. `created_at` is left as the
 * first-insert value (or set now on insert); `updated_at` is set
 * to `datetime('now')` on every call.
 *
 * @route   PUT /api/policies/:appId
 * @param   appId — one of `VALID_APP_IDS`.
 * @body    `{ source_system: 'hr'|'ldap'|'engineering'|'finance', credential_field: string, credential_label: string, access_type: 'account_exists'|'attribute_match', attribute_key?: string|null, attribute_value?: string|null }`
 *          `attribute_key` is required when `access_type === 'attribute_match'`.
 * @returns 200 — `{ success: true, data: { policy: PolicyRow } }`
 * @throws  400 — `{ error: 'Unknown app ID: ...' }` when `:appId` is not in `VALID_APP_IDS`, or `{ error: 'Missing required fields: ...' }` when any of the four required body fields is absent.
 * @throws  500 — database write failure.
 */
router.put('/:appId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { appId } = req.params;
    if (!VALID_APP_IDS.includes(appId)) {
      res.status(400).json({ error: `Unknown app ID: ${appId}` });
      return;
    }

    const { source_system, credential_field, credential_label, access_type, attribute_key, attribute_value } = req.body as Partial<PolicyRow>;

    if (!source_system || !credential_field || !credential_label || !access_type) {
      res.status(400).json({ error: 'Missing required fields: source_system, credential_field, credential_label, access_type' });
      return;
    }

    const db = new Database(REGISTRY_DB);
    ensureTable(db);

    db.prepare(`
      INSERT INTO app_policies (app_id, source_system, credential_field, credential_label, access_type, attribute_key, attribute_value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(app_id) DO UPDATE SET
        source_system    = excluded.source_system,
        credential_field = excluded.credential_field,
        credential_label = excluded.credential_label,
        access_type      = excluded.access_type,
        attribute_key    = excluded.attribute_key,
        attribute_value  = excluded.attribute_value,
        updated_at       = datetime('now')
    `).run(appId, source_system, credential_field, credential_label, access_type, attribute_key ?? null, attribute_value ?? null);

    const saved = db.prepare('SELECT * FROM app_policies WHERE app_id = ?').get(appId) as PolicyRow;
    db.close();

    res.json({ success: true, data: { policy: saved } });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/policies/:appId (reset to default) ───────────────────────────

/**
 * DELETE /api/policies/:appId
 *
 * Reset one application's policy to its in-code default by
 * deleting the DB row. Does NOT actually delete any policy from
 * the system — it removes the override so the default takes over.
 *
 * @route   DELETE /api/policies/:appId
 * @param   appId — one of `VALID_APP_IDS`.
 * @returns 200 — `{ success: true, data: { policy: PolicyRow, reset: true } }` where `policy` is the now-effective default.
 * @throws  500 — database write failure.
 */
router.delete('/:appId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { appId } = req.params;
    const db = new Database(REGISTRY_DB);
    ensureTable(db);
    db.prepare('DELETE FROM app_policies WHERE app_id = ?').run(appId);
    db.close();
    res.json({ success: true, data: { policy: withDefault(undefined, appId), reset: true } });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/policies/validate ───────────────────────────────────────────────

/**
 * POST /api/policies/validate
 *
 * Primary login: validate a `(appId, credential)` pair against the
 * configured policy for `appId`. Resolves the credential against
 * the configured source system, then enforces the `access_type`
 * (`account_exists` or `attribute_match`).
 *
 * Returns the matching record, a granted/denied flag, and (when
 * granted) the GCUID linked via `source_mappings`.
 *
 * @route   POST /api/policies/validate
 * @body    `{ appId: string, credential: string }`
 * @returns 200 — `{ success: true, data: { appId, credential, found: boolean, granted: boolean, reason: string, policy: { source_system, credential_field, access_type }, record?: object, gcuid: string | null } }`
 * @throws  400 — `{ error: 'Missing required fields: appId, credential' }` when either is absent.
 * @throws  500 — database failure.
 */
router.post('/validate', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { appId, credential } = req.body as { appId?: string; credential?: string };

    if (!appId || !credential) {
      res.status(400).json({ error: 'Missing required fields: appId, credential' });
      return;
    }

    // Load policy
    const regDb = new Database(REGISTRY_DB);
    ensureTable(regDb);
    const row = regDb.prepare('SELECT * FROM app_policies WHERE app_id = ?').get(appId) as PolicyRow | undefined;
    const policy = withDefault(row, appId);

    // Validate credential against source
    const result = lookupCredential(policy, credential.trim());

    // Try to find linked GCUID
    let gcuid: string | null = null;
    if (result.found) {
      gcuid = findLinkedGcuid(regDb, policy.source_system, credential.trim());
    }
    regDb.close();

    res.json({
      success: true,
      data: {
        appId,
        credential,
        found:    result.found,
        granted:  result.granted,
        reason:   result.reason,
        policy:   { source_system: policy.source_system, credential_field: policy.credential_field, access_type: policy.access_type },
        record:   result.granted ? result.record : undefined,
        gcuid,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/policies/validate-gcuid ─────────────────────────────────────────
// Secondary login: resolve a GCUID or alias to a canonical identity, then check
// the source-system mapping and run the same attribute policy as /validate.
// Failure classification:
//   found_gcuid=false             → authentication failure (identity not found)
//   found_gcuid=true, !eligible   → authorization failure (identity/identifier state)
//   found_gcuid=true, eligible, !granted → no linked account or attribute denied
//
// Eligibility (added 2026-06-22): the supplied GCUID's identity must be 'active',
// and the identifier must be 'issued' OR a chain of 'superseded' pointers
// leading to an 'issued' identifier. The effective (end-of-chain) GCUID is the
// one used for the source_mapping lookup, since supersession transfers mappings
// to the survivor.

interface EligibilityResult {
  eligible: boolean;
  effective_gcuid: string;
  identity_state: string | null;
  identifier_state: string | null;
  chain: string[];
  reason: string | null;
}

const MAX_CHAIN_DEPTH = 100;

function evaluateGcuidEligibility(regDb: Database.Database, gcuid: string): EligibilityResult {
  const visited: string[] = [];
  let current: string = gcuid;

  for (let hop = 0; hop < MAX_CHAIN_DEPTH; hop++) {
    visited.push(current);
    const row = regDb.prepare(
      'SELECT gcuid, state, identifier_state, superseded_by FROM identities WHERE gcuid = ?'
    ).get(current) as { gcuid: string; state: string; identifier_state: string; superseded_by: string | null } | undefined;

    if (!row) {
      return {
        eligible: false,
        effective_gcuid: current,
        identity_state: null,
        identifier_state: null,
        chain: visited,
        reason: visited.length > 1
          ? `Supersession chain is broken: GCUID '${current}' (linked from '${visited[visited.length - 2]}') was not found.`
          : `GCUID '${current}' was not found.`,
      };
    }

    // Identity state gate — the user must present a live identity.
    // Checked on the *input* GCUID: a suspended/retired user does not get in,
    // even if their identifier points to an active survivor.
    if (visited.length === 1 && row.state !== 'active') {
      return {
        eligible: false,
        effective_gcuid: current,
        identity_state: row.state,
        identifier_state: row.identifier_state,
        chain: visited,
        reason: `Identity is not active (current state: '${row.state}'). Corporate-app access requires an active identity.`,
      };
    }

    if (row.identifier_state === 'issued') {
      return {
        eligible: true,
        effective_gcuid: current,
        identity_state: row.state,
        identifier_state: row.identifier_state,
        chain: visited,
        reason: null,
      };
    }

    if (row.identifier_state === 'superseded') {
      if (!row.superseded_by) {
        return {
          eligible: false,
          effective_gcuid: current,
          identity_state: row.state,
          identifier_state: row.identifier_state,
          chain: visited,
          reason: `GCUID '${current}' is superseded but has no successor.`,
        };
      }
      if (row.superseded_by === current) {
        // Self-loop — defensively guarded by admin.ts but check anyway.
        return {
          eligible: false,
          effective_gcuid: current,
          identity_state: row.state,
          identifier_state: row.identifier_state,
          chain: visited,
          reason: `Supersession chain contains a self-loop at '${current}'.`,
        };
      }
      current = row.superseded_by;
      continue;
    }

    // Any other identifier state (reserved, nullified, tombstoned) is a hard deny.
    return {
      eligible: false,
      effective_gcuid: current,
      identity_state: row.state,
      identifier_state: row.identifier_state,
      chain: visited,
      reason: `Identifier is not eligible (current state: '${row.identifier_state}'). Corporate-app access requires an issued identifier.`,
    };
  }

  return {
    eligible: false,
    effective_gcuid: current,
    identity_state: null,
    identifier_state: null,
    chain: visited,
    reason: `Supersession chain exceeded ${MAX_CHAIN_DEPTH} hops — possible cycle.`,
  };
}

/**
 * POST /api/policies/validate-gcuid
 *
 * Secondary login: resolve a GCUID (or alias / entity_id) to a
 * canonical identity, walk the supersession chain to the
 * currently-issued identifier, then apply the same policy check
 * as `/validate` against the linked source-system account.
 *
 * Failure classification:
 *
 * - `found_gcuid=false`               → authentication failure (no identity matched)
 * - `found_gcuid=true, !eligible`     → authorization failure (identity not active, or no surviving identifier)
 * - `found_gcuid=true, eligible, !granted` → no linked account, or attribute policy denied
 *
 * Eligibility rule (added 2026-06-22): the supplied GCUID's identity
 * must be `'active'`, and the identifier must be `'issued'` OR a
 * chain of `'superseded'` pointers leading to an `'issued'`
 * identifier. The effective (end-of-chain) GCUID is the one used
 * for the `source_mappings` lookup, since supersession transfers
 * mappings to the survivor.
 *
 * @route   POST /api/policies/validate-gcuid
 * @body    `{ appId: string, gcuid_or_alias: string }` — accepts a raw GCUID, an `entity_id`, or any alias value.
 * @returns 200 — `{ success: true, data: { appId, gcuid_or_alias, found_gcuid, found_account, granted, reason, gcuid, effective_gcuid?, identity_state?, identifier_state?, supersession_chain?, record? } }`
 *          The full failure-classification shape is documented in the route above; every key is present in every response, only `null`/absent values vary.
 * @throws  400 — `{ error: 'Missing required fields: appId, gcuid_or_alias' }` when either is absent.
 * @throws  500 — database failure.
 */
router.post('/validate-gcuid', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { appId, gcuid_or_alias } = req.body as { appId?: string; gcuid_or_alias?: string };

    if (!appId || !gcuid_or_alias) {
      res.status(400).json({ error: 'Missing required fields: appId, gcuid_or_alias' });
      return;
    }

    const regDb = new Database(REGISTRY_DB);
    ensureTable(regDb);
    const row = regDb.prepare('SELECT * FROM app_policies WHERE app_id = ?').get(appId) as PolicyRow | undefined;
    const policy = withDefault(row, appId);

    // ── Resolve input → canonical GCUID ──────────────────────────────────────
    const input = gcuid_or_alias.trim();
    let gcuid: string | null = null;

    // 1. Try as a raw GCUID
    if (!gcuid) {
      const r = regDb.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(input) as { gcuid: string } | undefined;
      if (r) gcuid = r.gcuid;
    }
    // 2. Try as entity_id
    if (!gcuid) {
      const r = regDb.prepare('SELECT gcuid FROM identities WHERE entity_id = ?').get(input) as { gcuid: string } | undefined;
      if (r) gcuid = r.gcuid;
    }
    // 3. Try alias_value (any alias type)
    if (!gcuid) {
      const r = regDb.prepare('SELECT gcuid FROM aliases WHERE alias_value = ?').get(input) as { gcuid: string } | undefined;
      if (r) gcuid = r.gcuid;
    }

    if (!gcuid) {
      regDb.close();
      res.json({
        success: true,
        data: {
          appId, gcuid_or_alias: input,
          found_gcuid: false, found_account: false,
          granted: false,
          reason: `No identity found matching '${input}'.`,
          gcuid: null,
        },
      });
      return;
    }

    // ── Eligibility gate: active identity + issued identifier (with chain) ───
    const eligibility = evaluateGcuidEligibility(regDb, gcuid);
    if (!eligibility.eligible) {
      regDb.close();
      res.json({
        success: true,
        data: {
          appId, gcuid_or_alias: input,
          found_gcuid: true, found_account: false,
          granted: false,
          reason:   eligibility.reason,
          gcuid,
          effective_gcuid:     eligibility.effective_gcuid,
          identity_state:      eligibility.identity_state,
          identifier_state:    eligibility.identifier_state,
          supersession_chain:  eligibility.chain,
        },
      });
      return;
    }

    // ── Look up source mapping on the effective (post-chain) GCUID ───────────
    const mapping = regDb.prepare(
      'SELECT source_id FROM source_mappings WHERE gcuid = ? AND source_system = ? LIMIT 1'
    ).get(eligibility.effective_gcuid, policy.source_system) as { source_id: string } | undefined;

    if (!mapping) {
      regDb.close();
      res.json({
        success: true,
        data: {
          appId, gcuid_or_alias: input,
          found_gcuid: true, found_account: false,
          granted: false,
          reason: `This identity has no linked account in ${policy.source_system.toUpperCase()}.`,
          gcuid,
          effective_gcuid:    eligibility.effective_gcuid,
          identity_state:     eligibility.identity_state,
          identifier_state:   eligibility.identifier_state,
          supersession_chain: eligibility.chain,
        },
      });
      return;
    }

    // ── Run the same credential + attribute policy check ──────────────────────
    const result = lookupCredential(policy, mapping.source_id);
    regDb.close();

    res.json({
      success: true,
      data: {
        appId, gcuid_or_alias: input,
        found_gcuid: true,
        found_account: result.found,
        granted:  result.granted,
        reason:   result.reason,
        record:   result.granted ? result.record : undefined,
        gcuid,
        effective_gcuid:    eligibility.effective_gcuid,
        identity_state:     eligibility.identity_state,
        identifier_state:   eligibility.identifier_state,
        supersession_chain: eligibility.chain,
      },
    });
  } catch (err) {
    next(err);
  }
});

export const policiesRoutes = router;
