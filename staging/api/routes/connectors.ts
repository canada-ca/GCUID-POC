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
 * Connector Configuration API Routes
 *
 * Manages per-connector JSON configuration files stored in config/connectors/.
 * Each file defines both ends of a connector:
 *   - gcuidIntegration: how the connector authenticates and maps attributes to the GCUID registry
 *   - sourceConnection:  how the connector reads from the department/authoritative source
 *   - connectorServer:   the HTTP connector process settings (port, auth token)
 *
 * GET  /api/connectors           — list all connector configs
 * GET  /api/connectors/:id       — read one connector config
 * PATCH /api/connectors/:id      — update a connector config (partial update)
 */

import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { createError } from '../middleware/error.js';
import { upsertConnectorMappings } from './caes.js';
import { REGISTRY_DB_PATH } from '../lib/db-paths.js';
import { connectorResolver } from '../lib/connector-resolver.js';
import { logRegistry } from '../lib/logging/logger.js';
import { REGISTRY_EVENTS } from '../lib/logging/log-events.js';

const router = Router();

// Config directory is relative to CWD (staging/).
const CONNECTORS_DIR = path.join(process.cwd(), 'config', 'connectors');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectorConfig {
  systemId: string;
  displayName: string;
  systemType: 'authoritative_source' | 'department';
  accessMode: 'dynamic-pull' | 'scheduled-pull' | 'push-cache';
  enabled: boolean;
  description: string;
  gcuidIntegration: {
    registryUrl: string;
    registryAuthToken: string;
    attributeMappings: Record<string, string>;
  };
  sourceConnection: {
    type: 'sqlite' | 'rest-api' | 'ldap';
    dbPath?: string;
    apiUrl?: string;
    primaryTable?: string;
    primaryKeyField?: string;
  };
  connectorServer: {
    port: number;
    authToken: string;
  };
  /** Optional per-attribute normalisation rules applied before values are stored in CAES. */
  transformations?: Record<string, ConnectorTransformation>;
}

/** Normalisation rule applied to a source field value during read, write, or both directions. */
export interface ConnectorTransformation {
  type:
    | 'lowercase'    // Convert to lower-case
    | 'uppercase'    // Convert to upper-case
    | 'trim'         // Strip leading/trailing whitespace
    | 'value_map'    // Map source codes to normalised labels (map field)
    | 'date_format'  // Reformat a date string (fromFormat → toFormat)
    | 'regex_replace'  // Regex find-and-replace; supports capture groups ($1, $2…)
    | 'prefix'         // Prepend affixValue to the string
    | 'suffix'         // Append affixValue to the string
    | 'substring'      // Extract characters [start..end]
    | 'conditional'    // If value matches pattern: thenValue, else: elseValue (or pass-through)
    | 'pipeline'       // Apply steps[] in sequence (max 10; no nested pipelines)
    | 'expression';    // JEXL safe expression — context available: { value, field }
  /**
   * When to apply the transformation:
   *   'read'  — applied when reading from the source system (before CAES storage / query response)
   *   'write' — applied when writing to the source system (before persisting a value)
   *   'both'  — applied in both directions; value_map and date_format invert automatically on write
   * Defaults to 'both'.
   */
  direction?: 'read' | 'write' | 'both';
  description?: string;

  // ── value_map ──────────────────────────────────────────────────────────────
  /** Source code → normalised label pairs. Only for type === 'value_map'. */
  map?: Record<string, string>;

  // ── date_format ────────────────────────────────────────────────────────────
  /** Input date format string (e.g. 'DD/MM/YYYY'). Only for type === 'date_format'. */
  fromFormat?: string;
  /** Output date format string. Defaults to 'YYYY-MM-DD'. Only for type === 'date_format'. */
  toFormat?: string;

  // ── regex_replace / conditional ────────────────────────────────────────────
  /**
   * ECMAScript regex pattern string. Validated server-side for ReDoS safety.
   * Max 200 characters. Used by: regex_replace, conditional.
   */
  pattern?: string;
  /** Replacement string for regex_replace. Supports capture-group references ($1, $2…). Max 200 chars. */
  replacement?: string;

  // ── prefix / suffix ────────────────────────────────────────────────────────
  /** String to prepend (prefix) or append (suffix) to the value. Max 200 chars. */
  affixValue?: string;

  // ── substring ──────────────────────────────────────────────────────────────
  /** Zero-based start index for substring extraction (inclusive). */
  start?: number;
  /** Zero-based end index for substring extraction (exclusive). Omit to extract to end of string. */
  end?: number;

  // ── conditional ────────────────────────────────────────────────────────────
  /** Value to produce when the conditional pattern matches the input. */
  thenValue?: string;
  /** Value to produce when the conditional pattern does NOT match. Omit to pass through unchanged. */
  elseValue?: string;

  // ── pipeline ───────────────────────────────────────────────────────────────
  /** Ordered list of transforms applied in sequence. Max 10 steps. Nested pipelines are not allowed. */
  steps?: ConnectorTransformation[];

  // ── expression ─────────────────────────────────────────────────────────────
  /**
   * JEXL expression evaluated in a sandboxed context — no I/O, no globals, no require.
   * Available identifiers: value (the current field value), field (the attribute key string).
   * Example: "value.length > 0 ? 'EMP-' + value.toUpperCase() : null"
   * Max 500 characters.
   */
  expr?: string;
}

// Fields the operator may update via PATCH. systemId is always read-only.
type PatchableFields = Partial<Pick<ConnectorConfig,
  'displayName' | 'description' | 'enabled' | 'accessMode'
>> & {
  gcuidIntegration?: Partial<ConnectorConfig['gcuidIntegration']>;
  connectorServer?: Partial<ConnectorConfig['connectorServer']>;
  sourceConnection?: Partial<ConnectorConfig['sourceConnection']>;
  transformations?: Record<string, ConnectorTransformation>;
};

// ─── Transformation validation ────────────────────────────────────────────────

const TRANSFORM_VALID_TYPES = new Set([
  'lowercase', 'uppercase', 'trim', 'value_map', 'date_format',
  'regex_replace', 'prefix', 'suffix', 'substring', 'conditional', 'pipeline', 'expression',
]);

const REGEX_MAX_LEN         = 200;
const REPLACEMENT_MAX_LEN   = 200;
const AFFIX_MAX_LEN         = 200;
const EXPR_MAX_LEN          = 500;
const PIPELINE_MAX_STEPS    = 10;

/** JEXL expression identifiers that would allow code execution or environment access. */
const EXPR_DISALLOWED = /\b(require|import|process|global|globalThis|eval|Function|setTimeout|setInterval|fetch|XMLHttpRequest)\b/;

/**
 * Heuristic ReDoS safety check.
 * Rejects patterns with nested quantifiers or alternation-under-quantifiers,
 * which are the primary cause of catastrophic backtracking.
 */
function isReDoSSafe(pattern: string): boolean {
  if (pattern.length > REGEX_MAX_LEN) return false;
  // Nested quantifier: group containing a quantified atom, itself quantified — (a+)+, (a*)+, etc.
  if (/\([^)]*[+*{][^)]*\)[+*{?]/.test(pattern)) return false;
  // Alternation inside a quantified group — (a|aa)+
  if (/\([^)]*\|[^)]*\)[+*{?]/.test(pattern)) return false;
  return true;
}

function isValidRegexPattern(pattern: string): boolean {
  try { new RegExp(pattern); return true; } catch { return false; }
}

/**
 * Validates a single ConnectorTransformation object.
 * Returns an error string if invalid, null if valid.
 * depth > 0 means we are inside a pipeline (nested pipelines are forbidden).
 */
function validateTransformation(t: ConnectorTransformation, depth = 0): string | null {
  if (!TRANSFORM_VALID_TYPES.has(t.type)) return `Unknown transformation type: "${t.type}"`;

  switch (t.type) {
    case 'regex_replace': {
      if (!t.pattern) return 'regex_replace requires a "pattern" field';
      if (!isReDoSSafe(t.pattern))       return `Unsafe regex pattern (possible ReDoS attack): "${t.pattern}"`;
      if (!isValidRegexPattern(t.pattern)) return `Invalid regex pattern: "${t.pattern}"`;
      if (t.replacement && t.replacement.length > REPLACEMENT_MAX_LEN)
        return `regex_replace "replacement" exceeds max length (${REPLACEMENT_MAX_LEN})`;
      break;
    }
    case 'conditional': {
      if (!t.pattern) return 'conditional requires a "pattern" field';
      if (!isReDoSSafe(t.pattern))       return `Unsafe regex pattern (possible ReDoS attack): "${t.pattern}"`;
      if (!isValidRegexPattern(t.pattern)) return `Invalid regex pattern: "${t.pattern}"`;
      break;
    }
    case 'prefix':
    case 'suffix': {
      if (t.affixValue === undefined) return `${t.type} requires an "affixValue" field`;
      if (t.affixValue.length > AFFIX_MAX_LEN)
        return `${t.type} "affixValue" exceeds max length (${AFFIX_MAX_LEN})`;
      break;
    }
    case 'substring': {
      if (t.start !== undefined && (typeof t.start !== 'number' || !Number.isInteger(t.start) || t.start < 0))
        return 'substring "start" must be a non-negative integer';
      if (t.end !== undefined && (typeof t.end !== 'number' || !Number.isInteger(t.end) || t.end < 0))
        return 'substring "end" must be a non-negative integer';
      break;
    }
    case 'pipeline': {
      if (depth > 0) return 'Nested pipelines are not allowed';
      if (!Array.isArray(t.steps) || t.steps.length === 0)
        return 'pipeline requires a non-empty "steps" array';
      if (t.steps.length > PIPELINE_MAX_STEPS)
        return `pipeline "steps" exceeds max length (${PIPELINE_MAX_STEPS})`;
      for (let i = 0; i < t.steps.length; i++) {
        if (t.steps[i].type === 'pipeline') return `pipeline step[${i}]: nested pipelines are not allowed`;
        const stepErr = validateTransformation(t.steps[i], depth + 1);
        if (stepErr) return `pipeline step[${i}]: ${stepErr}`;
      }
      break;
    }
    case 'expression': {
      if (!t.expr) return 'expression requires an "expr" field';
      if (t.expr.length > EXPR_MAX_LEN)
        return `expression "expr" exceeds max length (${EXPR_MAX_LEN} chars)`;
      if (EXPR_DISALLOWED.test(t.expr))
        return `expression contains a disallowed identifier (${t.expr.match(EXPR_DISALLOWED)?.[0]})`;
      break;
    }
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Validate systemId: lowercase alphanumeric + hyphens only. Guards against path traversal. */
function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

function configPath(systemId: string): string {
  return path.join(CONNECTORS_DIR, `${systemId}.json`);
}

function readConfig(systemId: string): ConnectorConfig {
  const filePath = configPath(systemId);
  if (!fs.existsSync(filePath)) throw createError(`Connector '${systemId}' not found`, 404);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ConnectorConfig;
  } catch {
    throw createError(`Connector config for '${systemId}' is not valid JSON`, 500);
  }
}

function writeConfig(config: ConnectorConfig): void {
  fs.writeFileSync(configPath(config.systemId), JSON.stringify(config, null, 2), 'utf-8');
}

export function listConfigs(): ConnectorConfig[] {
  if (!fs.existsSync(CONNECTORS_DIR)) return [];
  return fs.readdirSync(CONNECTORS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CONNECTORS_DIR, f), 'utf-8')) as ConnectorConfig;
      } catch {
        return null;
      }
    })
    .filter((c): c is ConnectorConfig => c !== null)
    .sort((a, b) => {
      // Authoritative sources first, then departments; alpha within each group
      if (a.systemType !== b.systemType) return a.systemType === 'authoritative_source' ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/connectors
 *
 * List every connector configuration file, sorted: authoritative
 * sources first, then departments. The shape comes from
 * `listConfigs()` (which reads from `staging/config/connectors/*.json`).
 *
 * @returns 200 — `{ success: true, data: ConnectorConfig[], count }`
 * @throws  500 — File read failure.
 */
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const configs = listConfigs();
    res.json({ success: true, data: configs, count: configs.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/connectors/:id
 *
 * Read a single connector configuration by id (the connector
 * file stem, e.g. `'conn-hr'`). Validates the id format before
 * attempting the read.
 *
 * @route   GET /api/connectors/:id
 * @param   id — connector id (path param; must pass `isValidId()`).
 * @returns 200 — `{ success: true, data: ConnectorConfig }`
 * @throws  400 — `Invalid connector ID`.
 * @throws  404 — Config file not found.
 * @throws  500 — File read failure.
 */
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) throw createError('Invalid connector ID', 400);
    const config = readConfig(id);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/connectors/:id
 *
 * Update operator-configurable fields on a connector config.
 * Sparse update — any omitted field is preserved. **`systemId`
 * and `attributeMappings` are read-only and silently ignored if
 * supplied.**
 *
 * Patchable fields:
 * - Top-level: `displayName`, `description`, `enabled`, `accessMode` (enum: `dynamic-pull`/`scheduled-pull`/`push-cache`).
 * - `gcuidIntegration`: `registryUrl`, `registryAuthToken`, `attributeMappings` (ignored).
 * - `connectorServer`: `port` (positive integer), `authToken`.
 * - `sourceConnection`: `type` (enum: `sqlite`/`rest-api`/`ldap`), `dbPath`, `apiUrl`, `primaryTable`, `primaryKeyField`.
 * - `transformations`: full replacement of the transformation map; empty object clears all.
 *
 * Logs:
 * - `REGISTRY_EVENTS.CONNECTOR_REGISTERED` (notice) when `enabled` flips `false → true`.
 * - `REGISTRY_EVENTS.CONNECTOR_REMOVED` (notice) when `enabled` flips `true → false`.
 * - `REGISTRY_EVENTS.FLAG_CHANGED` (notice) on every successful config change.
 *
 * @route   PATCH /api/connectors/:id
 * @param   id — connector id (path param; must pass `isValidId()`).
 * @body    `PatchableFields` — partial; any combination of the patchable fields above.
 * @returns 200 — `{ success: true, data: ConnectorConfig }` after the patch is written.
 * @throws  400 — `Invalid connector ID` or `Invalid transformation for attribute "X": <validateTransformation error>`.
 * @throws  404 — Config file not found.
 * @throws  500 — File write failure.
 */
router.patch('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) throw createError('Invalid connector ID', 400);

    const current = readConfig(id);
    const patch = req.body as PatchableFields;

    // Apply top-level patchable scalar fields
    if (typeof patch.displayName === 'string')  current.displayName  = patch.displayName.trim();
    if (typeof patch.description === 'string')  current.description  = patch.description.trim();
    if (typeof patch.enabled     === 'boolean') current.enabled      = patch.enabled;
    if (patch.accessMode && ['dynamic-pull', 'scheduled-pull', 'push-cache'].includes(patch.accessMode)) {
      current.accessMode = patch.accessMode;
    }

    // Apply nested gcuidIntegration fields
    if (patch.gcuidIntegration) {
      if (typeof patch.gcuidIntegration.registryUrl === 'string') {
        current.gcuidIntegration.registryUrl = patch.gcuidIntegration.registryUrl.trim();
      }
      if (typeof patch.gcuidIntegration.registryAuthToken === 'string') {
        current.gcuidIntegration.registryAuthToken = patch.gcuidIntegration.registryAuthToken.trim();
      }
      if (patch.gcuidIntegration.attributeMappings !== undefined) {
        const am = patch.gcuidIntegration.attributeMappings;
        if (am && typeof am === 'object') {
          current.gcuidIntegration.attributeMappings = am;
        }
      }
    }

    // Apply connectorServer fields
    if (patch.connectorServer) {
      if (typeof patch.connectorServer.port === 'number' && patch.connectorServer.port > 0) {
        current.connectorServer.port = patch.connectorServer.port;
      }
      if (typeof patch.connectorServer.authToken === 'string') {
        current.connectorServer.authToken = patch.connectorServer.authToken.trim();
      }
    }

    // Apply sourceConnection fields
    if (patch.sourceConnection) {
      const sc = patch.sourceConnection;
      if (sc.type && (['sqlite', 'rest-api', 'ldap'] as const).includes(sc.type)) {
        current.sourceConnection.type = sc.type;
      }
      if (sc.dbPath          !== undefined) current.sourceConnection.dbPath          = sc.dbPath?.trim()          || undefined;
      if (sc.apiUrl          !== undefined) current.sourceConnection.apiUrl          = sc.apiUrl?.trim()          || undefined;
      if (sc.primaryTable    !== undefined) current.sourceConnection.primaryTable    = sc.primaryTable?.trim()    || undefined;
      if (sc.primaryKeyField !== undefined) current.sourceConnection.primaryKeyField = sc.primaryKeyField?.trim() || undefined;
    }

    // Apply transformations (replaces the full transformation map; empty object clears all)
    if (patch.transformations !== undefined) {
      if (Object.keys(patch.transformations).length === 0) {
        delete current.transformations;
      } else {
        // Validate every rule before persisting
        for (const [attr, rule] of Object.entries(patch.transformations)) {
          const err = validateTransformation(rule);
          if (err) throw createError(`Invalid transformation for attribute "${attr}": ${err}`, 400);
        }
        current.transformations = patch.transformations;
      }
    }

    writeConfig(current);
    // Log connector enable/disable transitions
    if (typeof patch.enabled === 'boolean') {
      logRegistry('notice', patch.enabled ? REGISTRY_EVENTS.CONNECTOR_REGISTERED : REGISTRY_EVENTS.CONNECTOR_REMOVED, {
        component:  'api:connectors',
        target_id:  id,
        actor_id:   (req.ip ?? 'system'),
        request_id: (req as any).requestId,
      });
    }
    // K3: log every config change
    logRegistry('notice', REGISTRY_EVENTS.FLAG_CHANGED, {
      component:  'api:connectors',
      target_id:  `connector:${id}`,
      actor_id:   (req.ip ?? 'system'),
      request_id: (req as any).requestId,
    });
    res.json({ success: true, data: current });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/connectors/:id/register
 * Upsert this connector's attributeMappings into CAES as the single source of truth.
 * Safe to call repeatedly — existing rows are updated structurally; CAES-curated
 * fields (operations, self_service, transformations) are preserved.
 */
router.post('/:id/register', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) throw createError('Invalid connector ID', 400);

    const config = readConfig(id);
    const result = upsertConnectorMappings(
      config.systemId,
      config.sourceConnection,
      config.systemType === 'authoritative_source',
      config.gcuidIntegration.attributeMappings,
    );

    res.json({
      success: true,
      data: {
        systemId: config.systemId,
        inserted: result.inserted,
        updated: result.updated,
        total: result.inserted + result.updated,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/connectors/:id/ingest
 * Push-cache ingest: receive a batch of pre-normalised records from a source
 * system and store them in the attribute_cache.
 *
 * Auth: Bearer token must match connectorServer.authToken in the connector JSON.
 * Body: { records: Array<{ source_id: string, normalised: Record<string,any>, effective_at?: string }> }
 */
router.post('/:id/ingest', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) throw createError('Invalid connector ID', 400);

    const config = readConfig(id);

    if (config.enabled === false) {
      throw createError(`Connector '${id}' is disabled. Re-enable it before ingesting data.`, 503);
    }

    if (config.accessMode !== 'push-cache') {
      throw createError(`Connector '${id}' is not a push-cache connector (mode: ${config.accessMode})`, 400);
    }

    // Validate Bearer token
    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) throw createError('Missing Authorization header', 401);
    const token = authHeader.slice(7);
    if (token !== config.connectorServer.authToken) throw createError('Invalid auth token', 403);

    const { records } = req.body as { records?: unknown[] };
    if (!Array.isArray(records) || records.length === 0) {
      throw createError('Body must contain a non-empty records array', 400);
    }

    // Validate and normalise each record
    const validated: Array<{ source_id: string; normalised: Record<string, any>; effective_at?: string }> = [];
    const errors: string[] = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i] as any;
      if (!r || typeof r.source_id !== 'string' || !r.source_id.trim()) {
        errors.push(`record[${i}]: missing source_id`);
        continue;
      }
      if (!r.normalised || typeof r.normalised !== 'object') {
        errors.push(`record[${i}]: normalised must be an object`);
        continue;
      }
      validated.push({ source_id: r.source_id.trim(), normalised: r.normalised, effective_at: r.effective_at });
    }

    // Ingest the valid records using the system_id that matches source_systems
    // (system_id in source_systems uses short names: 'finance', not 'finance-dept')
    const db = new Database(REGISTRY_DB_PATH, { readonly: true });
    const sysRow = db.prepare(
      "SELECT system_id FROM source_systems WHERE connector_id = ?"
    ).get(config.systemId) as { system_id: string } | undefined;
    db.close();

    if (!sysRow) throw createError(`No source_system entry found for connector '${config.systemId}'`, 404);

    const accepted = connectorResolver.ingestRecords(sysRow.system_id, validated);

    res.json({
      success: true,
      data: { accepted, rejected: records.length - accepted, errors },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/connectors/:id/event
 * Lifecycle event intake: receive a structured lifecycle trigger from an
 * authoritative source connector and map it to the corresponding GCUID
 * registry state transition, initiating downstream provisioning flows.
 *
 * Auth: Bearer token must match connectorServer.authToken in the connector JSON.
 *
 * Body: {
 *   event_type: 'hire' | 'terminate' | 'rehire' | 'leave' | 'role_change',
 *   source_id:  string,            // The local ID known to the source system (e.g. 'EMP-1234')
 *   payload?:   Record<string,any> // Optional event-specific data (role, department, etc.)
 *   reason?:    string
 * }
 *
 * event_type → registry action mapping:
 *   hire        — provisional / reserved → active (approve transition)
 *   terminate   — active / suspended → retired (+ tombstones identifier)
 *   rehire      — retired → under_review (rehire transition)
 *   leave       — active / under_review → suspended
 *   role_change — merges payload into identities.metadata.attributes; writes audit row
 */
router.post('/:id/event', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) throw createError('Invalid connector ID', 400);

    const config = readConfig(id);
    if (config.enabled === false) {
      throw createError(`Connector '${id}' is disabled`, 503);
    }

    // Validate Bearer token
    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) throw createError('Missing Authorization header', 401);
    if (authHeader.slice(7) !== config.connectorServer.authToken) {
      throw createError('Invalid auth token', 403);
    }

    const { event_type, source_id, payload = {}, reason } = req.body as {
      event_type?: string;
      source_id?: string;
      payload?: Record<string, any>;
      reason?: string;
    };

    const VALID_EVENTS = ['hire', 'terminate', 'rehire', 'leave', 'role_change'] as const;
    type EventType = typeof VALID_EVENTS[number];

    if (!event_type || !VALID_EVENTS.includes(event_type as EventType)) {
      throw createError(`event_type must be one of: ${VALID_EVENTS.join(', ')}`, 400);
    }
    if (!source_id?.trim()) throw createError('"source_id" is required', 400);

    const db = new Database(REGISTRY_DB_PATH);

    // Resolve the source_systems.system_id for this connector
    const sysRow = db.prepare(
      'SELECT system_id FROM source_systems WHERE connector_id = ?'
    ).get(config.systemId) as { system_id: string } | undefined;

    if (!sysRow) {
      db.close();
      throw createError(`No source_system entry found for connector '${config.systemId}'`, 404);
    }

    // Find the GCUID linked to this source_id
    const mapping = db.prepare(
      'SELECT gcuid FROM source_mappings WHERE source_system = ? AND source_id = ?'
    ).get(sysRow.system_id, source_id.trim()) as { gcuid: string } | undefined;

    if (!mapping) {
      db.close();
      return res.status(404).json({
        success: false,
        error: {
          message: `No GCUID found for source_id "${source_id}" in system "${sysRow.system_id}"`,
          guidance: 'Register the identity first via POST /api/gcuid/register, then link it via POST /api/gcuid/source-mappings/:gcuid',
        },
      });
    }

    const gcuid = mapping.gcuid;
    const identity = db.prepare(
      'SELECT state, identifier_state, metadata FROM identities WHERE gcuid = ?'
    ).get(gcuid) as { state: string; identifier_state: string; metadata: string | null } | undefined;

    if (!identity) {
      db.close();
      throw createError(`Identity record for GCUID "${gcuid}" not found`, 500);
    }

    const ts = new Date().toISOString();
    const actor = config.systemId;
    const evtReason = reason?.trim() ?? `${event_type} event from ${config.displayName}`;

    let action_taken = '';
    let new_state = identity.state;
    let new_identifier_state = identity.identifier_state;

    switch (event_type as EventType) {
      case 'hire': {
        const allowed = ['provisional', 'reserved', 'under_review'];
        if (!allowed.includes(identity.state)) {
          db.close();
          return res.json({
            success: true,
            data: {
              gcuid,
              event_type,
              action_taken: 'no_op',
              message: `Identity is already in state "${identity.state}" — no transition needed`,
              state: identity.state,
              identifier_state: identity.identifier_state,
            },
          });
        }
        const prevState = identity.state;
        db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
          .run('active', ts, gcuid);
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
          VALUES (?, ?, 'active', 'hire', ?, ?, ?)
        `).run(gcuid, prevState, evtReason, actor, ts);
        // Issue identifier if still reserved
        if (identity.identifier_state === 'reserved') {
          db.prepare('UPDATE identities SET identifier_state = ?, updated_at = ? WHERE gcuid = ?')
            .run('issued', ts, gcuid);
          db.prepare(`
            INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
            VALUES (?, 'reserved', 'issued', 'hire', ?, ?, ?)
          `).run(gcuid, actor, evtReason, ts);
          new_identifier_state = 'issued';
        }
        action_taken = `state: ${prevState} → active`;
        new_state = 'active';
        break;
      }

      case 'terminate': {
        if (!['active', 'suspended', 'under_review'].includes(identity.state)) {
          db.close();
          return res.json({
            success: true,
            data: {
              gcuid,
              event_type,
              action_taken: 'no_op',
              message: `Cannot terminate identity in state "${identity.state}"`,
              state: identity.state,
              identifier_state: identity.identifier_state,
            },
          });
        }
        const prevState = identity.state;
        db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
          .run('retired', ts, gcuid);
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
          VALUES (?, ?, 'retired', 'terminate', ?, ?, ?)
        `).run(gcuid, prevState, evtReason, actor, ts);
        // Tombstone identifier
        if (['issued', 'reserved'].includes(identity.identifier_state)) {
          db.prepare('UPDATE identities SET identifier_state = ?, updated_at = ? WHERE gcuid = ?')
            .run('tombstoned', ts, gcuid);
          db.prepare(`
            INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
            VALUES (?, ?, 'tombstoned', 'terminate', ?, ?, ?)
          `).run(gcuid, identity.identifier_state, actor, evtReason, ts);
          new_identifier_state = 'tombstoned';
        }
        action_taken = `state: ${prevState} → retired, identifier: tombstoned`;
        new_state = 'retired';
        break;
      }

      case 'rehire': {
        if (identity.state !== 'retired') {
          db.close();
          return res.json({
            success: true,
            data: {
              gcuid,
              event_type,
              action_taken: 'no_op',
              message: `Cannot rehire identity in state "${identity.state}" — must be retired`,
              state: identity.state,
              identifier_state: identity.identifier_state,
            },
          });
        }
        db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
          .run('under_review', ts, gcuid);
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
          VALUES (?, 'retired', 'under_review', 'rehire', ?, ?, ?)
        `).run(gcuid, evtReason, actor, ts);
        // Re-issue identifier
        if (['tombstoned', 'nullified'].includes(identity.identifier_state)) {
          db.prepare('UPDATE identities SET identifier_state = ?, superseded_by = NULL, updated_at = ? WHERE gcuid = ?')
            .run('reserved', ts, gcuid);
          db.prepare(`
            INSERT INTO identifier_state_history (gcuid, from_state, to_state, transition, changed_by, reason, timestamp)
            VALUES (?, ?, 'reserved', 'rehire', ?, ?, ?)
          `).run(gcuid, identity.identifier_state, actor, evtReason, ts);
          new_identifier_state = 'reserved';
        }
        action_taken = 'state: retired → under_review';
        new_state = 'under_review';
        break;
      }

      case 'leave': {
        if (!['active', 'under_review'].includes(identity.state)) {
          db.close();
          return res.json({
            success: true,
            data: {
              gcuid,
              event_type,
              action_taken: 'no_op',
              message: `Cannot place identity on leave from state "${identity.state}"`,
              state: identity.state,
              identifier_state: identity.identifier_state,
            },
          });
        }
        const prevState = identity.state;
        db.prepare('UPDATE identities SET state = ?, updated_at = ? WHERE gcuid = ?')
          .run('suspended', ts, gcuid);
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
          VALUES (?, ?, 'suspended', 'leave', ?, ?, ?)
        `).run(gcuid, prevState, evtReason, actor, ts);
        action_taken = `state: ${prevState} → suspended`;
        new_state = 'suspended';
        break;
      }

      case 'role_change': {
        // Merge payload into metadata.attributes; write audit row
        let meta: Record<string, any> = {};
        try { meta = JSON.parse(identity.metadata ?? '{}'); } catch { /* ignore */ }
        meta.attributes = { ...(meta.attributes ?? {}), ...payload };
        db.prepare('UPDATE identities SET metadata = ?, updated_at = ? WHERE gcuid = ?')
          .run(JSON.stringify(meta), ts, gcuid);
        db.prepare(`
          INSERT INTO state_history (gcuid, from_state, to_state, transition_type, reason, actor, timestamp)
          VALUES (?, ?, ?, 'role_change', ?, ?, ?)
        `).run(gcuid, identity.state, identity.state, evtReason, actor, ts);
        action_taken = `metadata.attributes updated with ${Object.keys(payload).length} field(s)`;
        break;
      }
    }

    db.close();

    logRegistry('notice', REGISTRY_EVENTS.ADMIN_BULK_ACTION, {
      component:  'api:connectors',
      gcuid,
      actor_id:   config.systemId,
      actor_type: 'connector',
      context:    JSON.stringify({ event_type, source_id, connector: id }),
      request_id: (req as any).requestId,
    });

    res.json({
      success: true,
      data: {
        gcuid,
        event_type,
        action_taken,
        state:            new_state,
        identifier_state: new_identifier_state,
        processed_at:     ts,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/connectors/:id/sync
 * Manual cache sync: pull all records from the connector server and upsert them
 * into the attribute_cache. Works for both scheduled-pull and push-cache connectors
 * (push-cache connectors normally push, but can also be pulled manually via this endpoint).
 */
router.post('/:id/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) throw createError('Invalid connector ID', 400);

    const config = readConfig(id);
    if (config.accessMode !== 'scheduled-pull' && config.accessMode !== 'push-cache') {
      throw createError(`Connector '${id}' uses access mode '${config.accessMode}' — only scheduled-pull and push-cache connectors can be synced`, 400);
    }

    if (config.enabled === false) {
      throw createError(`Connector '${id}' is disabled. Re-enable it before syncing.`, 503);
    }

    // Resolve the source_systems.system_id for this connector
    const db = new Database(REGISTRY_DB_PATH, { readonly: true });
    const sysRow = db.prepare(
      "SELECT system_id, last_sync_at FROM source_systems WHERE connector_id = ?"
    ).get(config.systemId) as { system_id: string; last_sync_at: string | null } | undefined;
    db.close();

    if (!sysRow) throw createError(`No source_system entry found for connector '${config.systemId}'`, 404);

    // Only use `since` if the caller explicitly supplies it in the request body.
    // Defaulting to last_sync_at caused re-syncs to fetch nothing (no changes since
    // last sync), which then skipped the last_sync_at update entirely.
    const since: string | undefined = req.body?.since ?? undefined;
    const count = await connectorResolver.syncSystem(sysRow.system_id, since);

    res.json({
      success: true,
      data: { systemId: id, synced: count, since: since ?? null, syncedAt: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/connectors/:id/ping
 * Lightweight reachability probe to the connector's HTTP server.
 * Sends a GET to {baseUrl}/health with a 3-second timeout (no auth — just checks network path).
 * Returns: { reachable, latency_ms, status_code, checked_at, base_url }
 */
router.get('/:id/ping', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) throw createError('Invalid connector ID', 400);

    const config = readConfig(id);

    // Prefer api_url from the source_systems registry row over the JSON config port
    const db = new Database(REGISTRY_DB_PATH, { readonly: true });
    const sysRow = db.prepare(
      'SELECT api_url FROM source_systems WHERE connector_id = ?'
    ).get(config.systemId) as { api_url: string | null } | undefined;
    db.close();

    const baseUrl = sysRow?.api_url ?? `http://localhost:${config.connectorServer.port}`;

    const t0 = Date.now();
    let reachable = false;
    let statusCode: number | null = null;
    let latencyMs: number | null = null;

    try {
      const r = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      latencyMs = Date.now() - t0;
      statusCode = r.status;
      reachable = r.ok;
    } catch {
      // Network error or timeout — connector unreachable
    }

    res.json({
      success: true,
      data: {
        reachable,
        latency_ms: latencyMs,
        status_code: statusCode,
        checked_at: new Date().toISOString(),
        base_url: baseUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/connectors/:id/health
 * Authenticated health report from the connector's HTTP server.
 * Sends a GET to {baseUrl}/health with a 5-second timeout and the connector's auth token.
 * Returns: { reachable, status_code, latency_ms, checked_at, base_url, health, error? }
 */
router.get('/:id/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) throw createError('Invalid connector ID', 400);

    const config = readConfig(id);

    // Prefer api_url + api_secret from source_systems over JSON config values
    const db = new Database(REGISTRY_DB_PATH, { readonly: true });
    const sysRow = db.prepare(
      'SELECT api_url, api_secret FROM source_systems WHERE connector_id = ?'
    ).get(config.systemId) as { api_url: string | null; api_secret: string | null } | undefined;
    db.close();

    const baseUrl   = sysRow?.api_url    ?? `http://localhost:${config.connectorServer.port}`;
    const authToken = sysRow?.api_secret ?? config.connectorServer.authToken;

    const t0 = Date.now();
    let reachable = false;
    let statusCode: number | null = null;
    let latencyMs: number | null = null;
    let health: Record<string, unknown> | null = null;
    let probeError: string | undefined;

    try {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const r = await fetch(`${baseUrl}/health`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      latencyMs  = Date.now() - t0;
      statusCode = r.status;
      reachable  = r.ok;

      if (r.ok) {
        const ct = r.headers.get('content-type') ?? '';
        health = ct.includes('application/json')
          ? await r.json() as Record<string, unknown>
          : { raw: await r.text() };
      } else {
        probeError = `HTTP ${r.status}`;
      }
    } catch (err) {
      probeError = err instanceof Error ? err.message : 'Unreachable';
    }

    res.json({
      success: true,
      data: {
        reachable,
        status_code: statusCode,
        latency_ms:  latencyMs,
        checked_at:  new Date().toISOString(),
        base_url:    baseUrl,
        health,
        ...(probeError ? { error: probeError } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as connectorsRoutes };
