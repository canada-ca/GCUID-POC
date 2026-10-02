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
/*!
 * GCUID System Logging — Logger Service
 *
 * Typed write helpers for each system's log table.
 * Each helper:
 *   1. Resolves the effective minimum level for the component from levels.json
 *   2. Suppresses the write if level_code is below the effective minimum
 *      (alarm/critical/emergency always emit — see levels.json "alwaysEmit")
 *   3. Derives level_code from the level string
 *   4. Generates log_id (UUID v4) and timestamp if not supplied
 *   5. Masks ip_address last octet
 *   6. Inserts into the appropriate SQLite table
 *
 * Usage:
 *   import { logRegistry, logCAES, logHR, logLDAP, logEngineering, logFinance, logSystem } from './logger.js';
 *
 *   logRegistry('info', REGISTRY_EVENTS.IDENTITY_APPROVED, {
 *     gcuid: 'urn:gcuid:...',
 *     identity_state_before: 'provisional',
 *     identity_state_after: 'active',
 *     actor_id: 'admin@example.com',
 *     actor_type: 'admin',
 *     transaction_id: req.transactionId,
 *     correlation_id: req.correlationId,
 *   });
 */

import crypto from 'crypto';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  LogLevel, Outcome, ActorType,
  GCUIDRegistryLogRecord, CAESLogRecord, HRSystemLogRecord,
  LDAPLogRecord, EngineeringLogRecord, FinanceLogRecord, SystemLogRecord,
} from './log-types.js';
import type { LogEventDef } from './log-events.js';
import { LOG_LEVEL_CODES } from './log-types.js';
import { REGISTRY_DB_PATH, LOGS_DB_PATH as LOG_DB_PATH } from '../db-paths.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const ENV = (process.env.NODE_ENV ?? 'development') as 'development' | 'staging' | 'production';
const CONFIG_PATH = join(process.cwd(), 'config', 'logging', 'levels.json');

interface LevelConfig {
  default: LogLevel;
  components: Record<string, LogLevel>;
  slowRequestThresholdMs: number;
}
interface LevelsFile {
  environments: Record<string, LevelConfig>;
  alwaysEmit: { maxLevelCode: number };
}

let _levelConfig: LevelConfig | null = null;
let _alwaysEmitMaxCode = 2;

function loadLevelConfig(): LevelConfig {
  if (_levelConfig) return _levelConfig;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as LevelsFile;
    _levelConfig = raw.environments[ENV] ?? raw.environments['development'];
    _alwaysEmitMaxCode = raw.alwaysEmit?.maxLevelCode ?? 2;
  } catch {
    // Fallback: emit everything if config is unreadable
    _levelConfig = { default: 'debug', components: {}, slowRequestThresholdMs: 1000 };
  }
  return _levelConfig;
}

function resolveMinLevel(component: string): number {
  const cfg = loadLevelConfig();
  // Exact match
  if (cfg.components[component]) return LOG_LEVEL_CODES[cfg.components[component]];
  // Prefix glob: 'api:*' matches 'api:admin', 'api:user', etc.
  const prefix = component.split(':')[0];
  const globKey = `${prefix}:*`;
  if (cfg.components[globKey]) return LOG_LEVEL_CODES[cfg.components[globKey]];
  return LOG_LEVEL_CODES[cfg.default];
}

// ─── Runtime system-level overrides (DB-backed, 30-second TTL cache) ─────────

type SystemLevels = Record<string, LogLevel>;
let _systemLevelsCache: SystemLevels | null = null;
let _systemLevelsCacheTime = 0;
const SYSTEM_LEVELS_CACHE_TTL_MS = 30_000;

// Safe defaults used when the DB config is absent or unreadable.
// All systems default to 'info' so that debug/verbose noise is suppressed
// even before the user has explicitly configured levels via the Options UI.
const DEFAULT_SYSTEM_LEVELS: SystemLevels = {
  'gcuid-registry': 'info',
  'caes':           'info',
  'hr':             'info',
  'ldap':           'info',
  'engineering':    'info',
  'finance':        'info',
  'system':         'info',
};

/**
 * Invalidate the in-memory cache of per-system log level overrides.
 * Called by the log-levels API route after a successful PATCH so that the
 * next log write reflects the new setting without waiting for TTL expiry.
 */
export function invalidateSystemLevelsCache(): void {
  _systemLevelsCache = null;
  _systemLevelsCacheTime = 0;
}

function loadSystemLevels(): SystemLevels {
  const now = Date.now();
  if (_systemLevelsCache !== null && (now - _systemLevelsCacheTime) < SYSTEM_LEVELS_CACHE_TTL_MS) {
    return _systemLevelsCache;
  }
  try {
    const registryDb = new Database(REGISTRY_DB_PATH, { readonly: true });
    try {
      const row = registryDb.prepare('SELECT value FROM config WHERE key = ?').get('log_levels') as { value: string } | undefined;
      // Merge stored config with defaults so any missing key falls back to 'info'
      _systemLevelsCache = row
        ? { ...DEFAULT_SYSTEM_LEVELS, ...(JSON.parse(row.value) as SystemLevels) }
        : { ...DEFAULT_SYSTEM_LEVELS };
    } finally {
      registryDb.close();
    }
  } catch (err) {
    // DB temporarily unavailable — use safe defaults (info for all systems).
    // Log to stderr only (never recurse into the log writer).
    console.error('[logger] loadSystemLevels: failed to read registry DB, using default levels:', (err as Error).message);
    _systemLevelsCache = { ...DEFAULT_SYSTEM_LEVELS };
  }
  _systemLevelsCacheTime = Date.now();
  return _systemLevelsCache;
}

/**
 * Returns true if this record should be written.
 *
 * Resolution order:
 *   1. alarm/critical/emergency (level_code ≤ alwaysEmitMaxCode) — always emit
 *   2. Per-system DB override    — the minimum level set via System→Options (authoritative)
 *   3. Per-component JSON config — only used when no DB override is present for this system
 *
 * The DB setting is authoritative: if the user configures a system to 'info' via the
 * Options UI that level is respected regardless of what levels.json says for that
 * component.  The JSON config is only a fallback when the DB has no entry.
 */
function shouldEmit(levelCode: number, component: string, system: string): boolean {
  if (levelCode <= _alwaysEmitMaxCode) return true;   // alarm/critical/emergency always write

  const systemLevels = loadSystemLevels();
  const dbLevelStr = systemLevels[system] as LogLevel | undefined;

  // DB setting is authoritative; fall back to JSON component/default only when absent
  const effectiveMinCode = dbLevelStr !== undefined
    ? LOG_LEVEL_CODES[dbLevelStr]
    : resolveMinLevel(component);

  return levelCode <= effectiveMinCode;
}

// ─── SQLite connection ────────────────────────────────────────────────────────

let _db: InstanceType<typeof Database> | null = null;

function db(): InstanceType<typeof Database> {
  if (!_db) {
    _db = new Database(LOG_DB_PATH);
    _db.pragma('journal_mode = WAL');
  }
  return _db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Mask the last octet of an IPv4 address, or the last group of an IPv6 address. */
function maskIp(ip: string | undefined): string | undefined {
  if (!ip) return ip;
  // IPv4
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.xxx`;
  // IPv6 — mask the last group
  const parts = ip.split(':');
  if (parts.length > 1) { parts[parts.length - 1] = 'xxxx'; return parts.join(':'); }
  return ip;
}

function makeBase(
  level: LogLevel,
  event: LogEventDef,
  overrides: Partial<Omit<GCUIDRegistryLogRecord, 'system' | 'component' | 'component_type' | 'event_type' | 'event_code' | 'level' | 'level_code'>>,
  component: string,
  component_type: string,
): Record<string, unknown> {
  return {
    log_id:          uuid(),
    timestamp:       nowIso(),
    level,
    level_code:      LOG_LEVEL_CODES[level],
    component,
    component_type,
    event_type:      event.event_type,
    event_code:      event.code,
    message:         overrides.message ?? event.description,
    session_id:      overrides.session_id ?? null,
    transaction_id:  overrides.transaction_id ?? null,
    correlation_id:  overrides.correlation_id ?? null,
    request_id:      overrides.request_id ?? null,
    actor_id:        overrides.actor_id ?? null,
    actor_type:      overrides.actor_type ?? null,
    target_id:       overrides.target_id ?? null,
    target_type:     overrides.target_type ?? null,
    outcome:         overrides.outcome ?? event.outcome ?? null,
    duration_ms:     overrides.duration_ms ?? null,
    ip_address:      maskIp(overrides.ip_address),
    user_agent:      overrides.user_agent ? String(overrides.user_agent).slice(0, 255) : null,
    context:         overrides.context ?? null,
    error_code:      overrides.error_code ?? null,
    error_detail:    overrides.error_detail ? String(overrides.error_detail).slice(0, 2048) : null,
  };
}

function insertRow(table: string, row: Record<string, unknown>): void {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map(k => row[k] ?? null);
  db().prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`).run(...values);
}

// ─── Per-system logger functions ──────────────────────────────────────────────

type RegistryExtras = Partial<Pick<GCUIDRegistryLogRecord,
  'gcuid' | 'identity_state_before' | 'identity_state_after' |
  'match_confidence' | 'alias_type' | 'source_systems' |
  'message' | 'session_id' | 'transaction_id' | 'correlation_id' | 'request_id' |
  'actor_id' | 'actor_type' | 'target_id' | 'target_type' | 'outcome' |
  'duration_ms' | 'ip_address' | 'user_agent' | 'context' | 'error_code' | 'error_detail'
>>;

export function logRegistry(
  level: LogLevel,
  event: LogEventDef,
  data: RegistryExtras & { component?: GCUIDRegistryLogRecord['component'] },
): void {
  const component = data.component ?? ('api:admin' as const);
  if (!shouldEmit(LOG_LEVEL_CODES[level], component, 'gcuid-registry')) return;
  const row = {
    ...makeBase(level, event, data, component, 'api'),
    system: 'gcuid-registry',
    gcuid:                  data.gcuid ?? null,
    identity_state_before:  data.identity_state_before ?? null,
    identity_state_after:   data.identity_state_after ?? null,
    match_confidence:       data.match_confidence ?? null,
    alias_type:             data.alias_type ?? null,
    source_systems:         data.source_systems ?? null,
  };
  insertRow('log_gcuid_registry', row);
}

// ──

type CAESExtras = Partial<Pick<CAESLogRecord,
  'query_gcuid' | 'attributes_requested' | 'attributes_returned' | 'attributes_missing' |
  'source_systems_queried' | 'source_systems_failed' | 'cache_hit' | 'cache_age_seconds' |
  'federation_depth' | 'mapping_id' | 'standard_attribute' |
  'message' | 'session_id' | 'transaction_id' | 'correlation_id' | 'request_id' |
  'actor_id' | 'actor_type' | 'target_id' | 'target_type' | 'outcome' |
  'duration_ms' | 'ip_address' | 'user_agent' | 'context' | 'error_code' | 'error_detail'
>>;

export function logCAES(
  level: LogLevel,
  event: LogEventDef,
  data: CAESExtras & { component?: CAESLogRecord['component'] },
): void {
  const component = data.component ?? 'api:caes';
  if (!shouldEmit(LOG_LEVEL_CODES[level], component, 'caes')) return;
  const row = {
    ...makeBase(level, event, data, component, 'api'),
    system: 'caes',
    query_gcuid:             data.query_gcuid ?? null,
    attributes_requested:    data.attributes_requested ?? null,
    attributes_returned:     data.attributes_returned ?? null,
    attributes_missing:      data.attributes_missing ?? null,
    source_systems_queried:  data.source_systems_queried ?? null,
    source_systems_failed:   data.source_systems_failed ?? null,
    cache_hit:               data.cache_hit ?? null,
    cache_age_seconds:       data.cache_age_seconds ?? null,
    federation_depth:        data.federation_depth ?? null,
    mapping_id:              data.mapping_id ?? null,
    standard_attribute:      data.standard_attribute ?? null,
  };
  insertRow('log_caes', row);
}

// ──

type HRExtras = Partial<Pick<HRSystemLogRecord,
  'employee_id' | 'operation_type' | 'connector_status' | 'connector_url' |
  'records_affected' | 'sync_cursor' | 'department' | 'gcuid_linked' |
  'message' | 'session_id' | 'transaction_id' | 'correlation_id' | 'request_id' |
  'actor_id' | 'actor_type' | 'target_id' | 'target_type' | 'outcome' |
  'duration_ms' | 'ip_address' | 'user_agent' | 'context' | 'error_code' | 'error_detail'
>>;

export function logHR(
  level: LogLevel,
  event: LogEventDef,
  data: HRExtras & { component?: HRSystemLogRecord['component'] },
): void {
  const component = data.component ?? 'api:hr';
  if (!shouldEmit(LOG_LEVEL_CODES[level], component, 'hr')) return;
  const row = {
    ...makeBase(level, event, data, component, 'api'),
    system: 'hr',
    employee_id:      data.employee_id ?? null,
    operation_type:   data.operation_type ?? null,
    connector_status: data.connector_status ?? null,
    connector_url:    data.connector_url ?? null,
    records_affected: data.records_affected ?? null,
    sync_cursor:      data.sync_cursor ?? null,
    department:       data.department ?? null,
    gcuid_linked:     data.gcuid_linked ?? null,
  };
  insertRow('log_hr_system', row);
}

// ──

type LDAPExtras = Partial<Pick<LDAPLogRecord,
  'username' | 'dn_hash' | 'operation_type' | 'groups_affected' |
  'connector_status' | 'connector_url' | 'records_affected' | 'sync_cursor' |
  'self_service' | 'attribute_changed' | 'value_before_hash' | 'gcuid_linked' |
  'message' | 'session_id' | 'transaction_id' | 'correlation_id' | 'request_id' |
  'actor_id' | 'actor_type' | 'target_id' | 'target_type' | 'outcome' |
  'duration_ms' | 'ip_address' | 'user_agent' | 'context' | 'error_code' | 'error_detail'
>>;

export function logLDAP(
  level: LogLevel,
  event: LogEventDef,
  data: LDAPExtras & { component?: LDAPLogRecord['component'] },
): void {
  const component = data.component ?? 'api:ldap';
  if (!shouldEmit(LOG_LEVEL_CODES[level], component, 'ldap')) return;
  const row = {
    ...makeBase(level, event, data, component, 'api'),
    system: 'ldap',
    username:          data.username ?? null,
    dn_hash:           data.dn_hash ?? null,
    operation_type:    data.operation_type ?? null,
    groups_affected:   data.groups_affected ?? null,
    connector_status:  data.connector_status ?? null,
    connector_url:     data.connector_url ?? null,
    records_affected:  data.records_affected ?? null,
    sync_cursor:       data.sync_cursor ?? null,
    self_service:      data.self_service ?? null,
    attribute_changed: data.attribute_changed ?? null,
    value_before_hash: data.value_before_hash ?? null,
    gcuid_linked:      data.gcuid_linked ?? null,
  };
  insertRow('log_ldap', row);
}

// ──

type EngExtras = Partial<Pick<EngineeringLogRecord,
  'eng_employee_id' | 'operation_type' | 'cache_operation' | 'cache_mode' |
  'coverage_score' | 'coverage_pct' | 'skills' | 'gcuid_linked' | 'records_affected' |
  'message' | 'session_id' | 'transaction_id' | 'correlation_id' | 'request_id' |
  'actor_id' | 'actor_type' | 'target_id' | 'target_type' | 'outcome' |
  'duration_ms' | 'ip_address' | 'user_agent' | 'context' | 'error_code' | 'error_detail'
>>;

export function logEngineering(
  level: LogLevel,
  event: LogEventDef,
  data: EngExtras & { component?: EngineeringLogRecord['component'] },
): void {
  const component = data.component ?? 'api:engineering';
  if (!shouldEmit(LOG_LEVEL_CODES[level], component, 'engineering')) return;
  const row = {
    ...makeBase(level, event, data, component, 'api'),
    system: 'engineering',
    eng_employee_id: data.eng_employee_id ?? null,
    operation_type:  data.operation_type ?? null,
    cache_operation: data.cache_operation ?? null,
    cache_mode:      data.cache_mode ?? null,
    coverage_score:  data.coverage_score ?? null,
    coverage_pct:    data.coverage_pct ?? null,
    skills:          data.skills ?? null,
    gcuid_linked:    data.gcuid_linked ?? null,
    records_affected: data.records_affected ?? null,
  };
  insertRow('log_engineering', row);
}

// ──

type FinExtras = Partial<Pick<FinanceLogRecord,
  'fin_employee_id' | 'operation_type' | 'cache_operation' | 'cache_mode' |
  'financial_record_type' | 'cost_centre' | 'coverage_score' | 'coverage_pct' |
  'gcuid_linked' | 'records_affected' |
  'message' | 'session_id' | 'transaction_id' | 'correlation_id' | 'request_id' |
  'actor_id' | 'actor_type' | 'target_id' | 'target_type' | 'outcome' |
  'duration_ms' | 'ip_address' | 'user_agent' | 'context' | 'error_code' | 'error_detail'
>>;

export function logFinance(
  level: LogLevel,
  event: LogEventDef,
  data: FinExtras & { component?: FinanceLogRecord['component'] },
): void {
  const component = data.component ?? 'api:finance';
  if (!shouldEmit(LOG_LEVEL_CODES[level], component, 'finance')) return;
  const row = {
    ...makeBase(level, event, data, component, 'api'),
    system: 'finance',
    fin_employee_id:       data.fin_employee_id ?? null,
    operation_type:        data.operation_type ?? null,
    cache_operation:       data.cache_operation ?? null,
    cache_mode:            data.cache_mode ?? null,
    financial_record_type: data.financial_record_type ?? null,
    cost_centre:           data.cost_centre ?? null,
    coverage_score:        data.coverage_score ?? null,
    coverage_pct:          data.coverage_pct ?? null,
    gcuid_linked:          data.gcuid_linked ?? null,
    records_affected:      data.records_affected ?? null,
  };
  insertRow('log_finance', row);
}

// ──

type SysExtras = Partial<Pick<SystemLogRecord,
  'service_name' | 'service_version' | 'host' | 'process_id' | 'port' |
  'http_method' | 'http_path' | 'http_status' | 'http_request_size' | 'http_response_size' |
  'flag_name' | 'flag_value_before' | 'flag_value_after' | 'config_key' |
  'memory_mb' | 'cpu_percent' | 'active_connections' |
  'message' | 'session_id' | 'transaction_id' | 'correlation_id' | 'request_id' |
  'actor_id' | 'actor_type' | 'target_id' | 'target_type' | 'outcome' |
  'duration_ms' | 'ip_address' | 'user_agent' | 'context' | 'error_code' | 'error_detail'
>>;

export function logSystem(
  level: LogLevel,
  event: LogEventDef,
  data: SysExtras & { component?: SystemLogRecord['component'] },
): void {
  const component = data.component ?? 'server:api';
  if (!shouldEmit(LOG_LEVEL_CODES[level], component, 'system')) return;
  const row = {
    ...makeBase(level, event, data, component, 'module'),
    system: 'system',
    service_name:       data.service_name ?? null,
    service_version:    data.service_version ?? null,
    host:               data.host ?? null,
    process_id:         data.process_id ?? null,
    port:               data.port ?? null,
    http_method:        data.http_method ?? null,
    http_path:          data.http_path ?? null,
    http_status:        data.http_status ?? null,
    http_request_size:  data.http_request_size ?? null,
    http_response_size: data.http_response_size ?? null,
    flag_name:          data.flag_name ?? null,
    flag_value_before:  data.flag_value_before ?? null,
    flag_value_after:   data.flag_value_after ?? null,
    config_key:         data.config_key ?? null,
    memory_mb:          data.memory_mb ?? null,
    cpu_percent:        data.cpu_percent ?? null,
    active_connections: data.active_connections ?? null,
  };
  insertRow('log_system', row);
}

// ─── Slow-request threshold accessor ─────────────────────────────────────────

export function slowRequestThresholdMs(): number {
  return loadLevelConfig().slowRequestThresholdMs;
}
