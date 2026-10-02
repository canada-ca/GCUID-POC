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
 * GCUID System Logging — TypeScript Type Definitions
 *
 * These types mirror the SQL schema in `staging/data/schema/logging-schema.sql`
 * exactly. Use them when writing log records from API routes, modules,
 * schedulers, and UI components.
 *
 * Log levels follow RFC 5424 numeric severity (0 = most severe):
 * `emergency(0) alarm(1) critical(2) error(3) warning(4) notice(5) info(6) debug(7)`
 *
 * Every system has its own `*LogRecord` interface extending `BaseLogRecord`
 * with a system-specific `component` discriminator and the columns
 * unique to that system. The `AnyLogRecord` union is the type accepted
 * by `logSystem(...)` when the writer doesn't know the system at
 * compile time.
 */

// ─── Shared enumerations ──────────────────────────────────────────────────────

/** All log levels in ascending severity order. The numeric code lives in {@link LOG_LEVEL_CODES}. */
export const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alarm', 'emergency'] as const;

/** Discriminated string for log severity. Numeric value via {@link LOG_LEVEL_CODES}. */
export type LogLevel = typeof LOG_LEVELS[number];

/** RFC 5424 numeric severity per log level (0 = most severe). */
export const LOG_LEVEL_CODES: Record<LogLevel, number> = {
  debug:     7,
  info:      6,
  notice:    5,
  warning:   4,
  error:     3,
  critical:  2,
  alarm:     1,
  emergency: 0,
};

/** High-level category of the component that emitted a log record. */
export const COMPONENT_TYPES = ['api', 'ui', 'module', 'connector', 'scheduler', 'middleware', 'auth', 'cli'] as const;

/** Discriminated string for component categories. */
export type ComponentType = typeof COMPONENT_TYPES[number];

/** Type of actor that triggered the logged action. */
export const ACTOR_TYPES = ['user', 'admin', 'system', 'connector', 'scheduler', 'anonymous'] as const;

/** Discriminated string for actor types. */
export type ActorType = typeof ACTOR_TYPES[number];

/** Outcome categories used in `BaseLogRecord.outcome`. */
export const OUTCOMES = ['success', 'failure', 'partial', 'pending', 'skipped'] as const;

/** Discriminated string for action outcomes. */
export type Outcome = typeof OUTCOMES[number];

// ─── System identifiers ───────────────────────────────────────────────────────

/**
 * Discriminated system identifier. Each value maps to its own
 * `*LogRecord` interface and to its own SQLite table in
 * `logging-schema.sql`.
 */
export type SystemId =
  | 'gcuid-registry'
  | 'caes'
  | 'hr'
  | 'ldap'
  | 'engineering'
  | 'finance'
  | 'system';

// ─── Component identifiers per system ────────────────────────────────────────

/** Components that emit GCUID Registry log records. The discriminator for {@link GCUIDRegistryLogRecord.component}. */
export type GCUIDRegistryComponent =
  | 'api:admin'
  | 'api:user'
  | 'api:caes'
  | 'api:connectors'
  | 'api:flags'
  | 'module:matcher'
  | 'module:state-machine'
  | 'module:alias'
  | 'module:seed'
  | 'scheduler:sync'
  | 'ui:GCUIDPortal'
  | 'ui:AdminPortal'
  | 'middleware:auth'
  | 'middleware:logger';

/** Components that emit CAES log records. The discriminator for {@link CAESLogRecord.component}. */
export type CAESComponent =
  | 'api:caes'
  | 'module:resolver'
  | 'module:cache'
  | 'module:mapping'
  | 'module:connector-map'
  | 'scheduler:prefetch'
  | 'ui:CAESPortal'
  | 'ui:SourceSystemsPortal'
  | 'ui:SourceConnectorPortal';

/** Components that emit HR System log records. The discriminator for {@link HRSystemLogRecord.component}. */
export type HRSystemComponent =
  | 'api:hr'
  | 'connector:hr-server'
  | 'connector:hr-client'
  | 'module:hr-seed'
  | 'scheduler:hr-sync'
  | 'ui:HRPortal'
  | 'cli:hr';

/** Components that emit LDAP/AD log records. The discriminator for {@link LDAPLogRecord.component}. */
export type LDAPComponent =
  | 'api:ldap'
  | 'connector:ldap-server'
  | 'connector:ldap-client'
  | 'module:ldap-seed'
  | 'scheduler:ldap-sync'
  | 'ui:LDAPPortal'
  | 'ui:UserPortal'
  | 'cli:ldap';

/** Components that emit Engineering log records. The discriminator for {@link EngineeringLogRecord.component}. */
export type EngineeringComponent =
  | 'api:engineering'
  | 'module:dept-cache'
  | 'scheduler:eng-sync'
  | 'ui:EngineeringPortal'
  | 'ui:DepartmentPortal'
  | 'cli:engineering';

/** Components that emit Finance log records. The discriminator for {@link FinanceLogRecord.component}. */
export type FinanceComponent =
  | 'api:finance'
  | 'module:dept-cache'
  | 'scheduler:fin-sync'
  | 'ui:FinancePortal'
  | 'ui:DepartmentPortal'
  | 'cli:finance';

/** Components that emit System / infrastructure log records. The discriminator for {@link SystemLogRecord.component}. */
export type SystemComponent =
  | 'server:api'
  | 'server:web-ui'
  | 'middleware:error'
  | 'middleware:logger'
  | 'middleware:cors'
  | 'module:connector-resolver'
  | 'module:dept-cache'
  | 'api:connectors'
  | 'api:flags'
  | 'api:dept'
  | 'ui:OptionsPortal'
  | 'ui:Layout'
  | 'scheduler:global'
  | 'auth:session';

// ─── Base log record (shared columns on every table) ─────────────────────────

/**
 * Columns shared by every `*LogRecord` table. Use one of the
 * system-specific extensions (`GCUIDRegistryLogRecord`,
 * `CAESLogRecord`, etc.) when writing; this interface alone is not
 * enough to discriminate which SQLite table the row belongs to.
 */
export interface BaseLogRecord {
  // Identity
  /** Auto-increment PK (omit on insert; filled by SQLite). */
  id?:             number;
  /** UUID v4; uniquely identifies the log record across all systems. */
  log_id:          string;

  // Time
  /** ISO 8601 timestamp with milliseconds, e.g. `2026-04-29T14:32:01.123Z`. */
  timestamp:       string;
  /** DB-managed insert timestamp (omit on insert; filled by SQLite default). */
  created_at?:     string;

  // Severity
  /** Severity name; numeric value auto-derived via {@link LOG_LEVEL_CODES}. */
  level:           LogLevel;
  /** Numeric severity (0–7). Derive via {@link LOG_LEVEL_CODES}[level] on insert. */
  level_code:      number;

  // Source component
  /** Logical system that emitted the record. */
  system:          SystemId;
  /** Concrete component within the system. Type-narrowed in the system-specific extensions. */
  component:       string;
  /** High-level category of the component (api / ui / module / connector / scheduler / middleware / auth / cli). */
  component_type:  ComponentType;

  // Event identification
  /** Categorical slug such as `'identity.created'`. */
  event_type:      string;
  /** Machine code such as `'REG-001'`. */
  event_code:      string;
  /** Human-readable description. */
  message:         string;

  // Session / transaction
  /** Session id (one per browser tab, typically). */
  session_id?:     string;
  /** Transaction id; correlates multiple log records from a single unit of work. */
  transaction_id?: string;
  /** Correlation id; links related transactions across systems. */
  correlation_id?: string;
  /** Request id; matches `req.requestId` from the request-logger middleware. */
  request_id?:     string;

  // Actor
  /** Stable identifier for the actor (user id, connector id, etc.). */
  actor_id?:       string;
  /** Category of actor. */
  actor_type?:     ActorType;

  // Target
  /** Identifier of the entity the action was performed against. */
  target_id?:      string;
  /** Type of the target entity. */
  target_type?:    string;

  // Outcome
  /** Whether the action succeeded, failed, etc. */
  outcome?:        Outcome;
  /** Wall-clock duration of the action in milliseconds. */
  duration_ms?:    number;

  // Network context
  /** Client IP, last octet masked (e.g. `192.168.1.xxx`). */
  ip_address?:     string;
  /** Raw User-Agent header. */
  user_agent?:     string;

  // Error
  /** Machine-readable error code (e.g. `E_TIMEOUT`). */
  error_code?:     string;
  /** Human-readable error detail. */
  error_detail?:   string;

  // Free-form
  /** Arbitrary JSON string carrying context that doesn't fit the typed columns. */
  context?:        string;
}

// ─── GCUID Registry log record ────────────────────────────────────────────────

/**
 * Log record emitted by the central GCUID Registry (identity
 * creation, state transitions, match confidence, alias operations).
 */
export interface GCUIDRegistryLogRecord extends BaseLogRecord {
  system:    'gcuid-registry';
  component: GCUIDRegistryComponent | string;

  /** Affected GCUID (if any). */
  gcuid?:                  string;
  /** Identity state before the transition. */
  identity_state_before?:  string;
  /** Identity state after the transition. */
  identity_state_after?:   string;
  /** Confidence of the identity match (0.0–1.0). */
  match_confidence?:       number;
  /** Alias type (custom / email / GC-generated). */
  alias_type?:             string;
  /** JSON array of source system ids involved in the action, e.g. `'["hr","ldap"]'`. */
  source_systems?:         string;
}

// ─── CAES log record ──────────────────────────────────────────────────────────

/**
 * Log record emitted by CAES (Cross-Attribute Evaluation Service).
 * Tracks attribute queries, cache hits/misses, source-system fan-out,
 * and federation depth.
 */
export interface CAESLogRecord extends BaseLogRecord {
  system:    'caes';
  component: CAESComponent | string;

  /** GCUID the query was issued against. */
  query_gcuid?:            string;
  /** JSON array of standard attribute keys requested. */
  attributes_requested?:   string;
  /** JSON array of standard attribute keys returned. */
  attributes_returned?:    string;
  /** JSON array of standard attribute keys that were missing. */
  attributes_missing?:     string;
  /** JSON array of source systems queried. */
  source_systems_queried?: string;
  /** JSON array of source systems that failed. */
  source_systems_failed?:  string;
  /** 1 if the result came from the cache, 0 otherwise. */
  cache_hit?:              number;
  /** Age of the cached record in seconds at read time. */
  cache_age_seconds?:      number;
  /** Federation depth reached when resolving. */
  federation_depth?:       number;
  /** Mapping row id that resolved the attribute. */
  mapping_id?:             number;
  /** Canonical standard attribute key. */
  standard_attribute?:     string;
}

// ─── HR System log record ─────────────────────────────────────────────────────

/**
 * Log record emitted by the HR System connector / portal.
 * Tracks employee record operations, sync activity, and connector
 * health.
 */
export interface HRSystemLogRecord extends BaseLogRecord {
  system:    'hr';
  component: HRSystemComponent | string;

  employee_id?:     string;
  /** Operation type: read | write | update | delete | sync | health | search. */
  operation_type?:  string;
  /** Connector health status: healthy | degraded | unhealthy | offline. */
  connector_status?: string;
  connector_url?:   string;
  records_affected?: number;
  sync_cursor?:     string;
  department?:      string;
  /** GCUID linked to this employee record, if any. */
  gcuid_linked?:    string;
}

// ─── LDAP/AD log record ───────────────────────────────────────────────────────

/**
 * Log record emitted by the LDAP/AD connector / portal.
 * Tracks directory operations, group changes, and bind attempts.
 */
export interface LDAPLogRecord extends BaseLogRecord {
  system:    'ldap';
  component: LDAPComponent | string;

  username?:          string;
  /** First 8 chars of SHA-256(full DN); never the raw DN. */
  dn_hash?:           string;
  /** Operation type: read | write | update | search | bind | sync | health. */
  operation_type?:    string;
  /** JSON array of group identifiers affected. */
  groups_affected?:   string;
  connector_status?:  string;
  connector_url?:     string;
  records_affected?:  number;
  sync_cursor?:       string;
  /** 1 if the action was a self-service operation, 0 otherwise. */
  self_service?:      number;
  attribute_changed?: string;
  /** SHA-256 hash of the pre-change value, never the raw value. */
  value_before_hash?: string;
  gcuid_linked?:      string;
}

// ─── Engineering log record ───────────────────────────────────────────────────

/**
 * Log record emitted by the Engineering department connector / portal.
 * Tracks skill coverage, dept-cache operations, and sync activity.
 */
export interface EngineeringLogRecord extends BaseLogRecord {
  system:    'engineering';
  component: EngineeringComponent | string;

  eng_employee_id?:  string;
  /** Operation type: read | write | update | delete | sync | health | search. */
  operation_type?:   string;
  /** Cache operation: read | write | invalidate | miss | expire. */
  cache_operation?:  string;
  /** Connector access mode: dynamic-pull | push-cache | scheduled-pull. */
  cache_mode?:       string;
  /** Coverage score (0–4) for the queried employee. */
  coverage_score?:   number;
  /** Coverage percent (0–100) for the queried employee. */
  coverage_pct?:     number;
  /** JSON array of skills. */
  skills?:           string;
  gcuid_linked?:     string;
  records_affected?: number;
}

// ─── Finance log record ───────────────────────────────────────────────────────

/**
 * Log record emitted by the Finance department connector / portal.
 * Tracks financial record operations, dept-cache operations, and
 * coverage of cost-centre / budget-code / payroll data.
 */
export interface FinanceLogRecord extends BaseLogRecord {
  system:    'finance';
  component: FinanceComponent | string;

  fin_employee_id?:        string;
  /** Operation type: read | write | update | delete | sync | health | search. */
  operation_type?:         string;
  cache_operation?:        string;
  cache_mode?:             string;
  /** Financial record type: cost_centre | budget_code | payroll_group | account. */
  financial_record_type?:  string;
  cost_centre?:            string;
  coverage_score?:         number;
  coverage_pct?:           number;
  gcuid_linked?:           string;
  records_affected?:       number;
}

// ─── General / Infrastructure log record ─────────────────────────────────────

/**
 * Log record emitted by general / infrastructure components (the
 * HTTP server, middleware, schedulers, the options portal). Captures
 * HTTP request/response metrics, feature-flag changes, and runtime
 * resource usage.
 */
export interface SystemLogRecord extends BaseLogRecord {
  system:    'system';
  component: SystemComponent | string;

  /** Service name: api-server | web-ui | connector-runner | scheduler. */
  service_name?:     string;
  service_version?:  string;
  host?:             string;
  process_id?:       number;
  port?:             number;

  http_method?:          string;
  http_path?:            string;
  http_status?:          number;
  http_request_size?:    number;
  http_response_size?:   number;

  /** Feature-flag key (when the record documents a flag change). */
  flag_name?:         string;
  /** Feature-flag value before the change. */
  flag_value_before?: string;
  /** Feature-flag value after the change. */
  flag_value_after?:  string;
  /** Config key (when the record documents a config change). */
  config_key?:        string;

  /** Resident memory in MB at the time of the record. */
  memory_mb?:          number;
  /** CPU utilisation percent. */
  cpu_percent?:        number;
  /** Active connection count. */
  active_connections?: number;
}

// ─── Union type ───────────────────────────────────────────────────────────────

/** Discriminated union of every system-specific log record type. */
export type AnyLogRecord =
  | GCUIDRegistryLogRecord
  | CAESLogRecord
  | HRSystemLogRecord
  | LDAPLogRecord
  | EngineeringLogRecord
  | FinanceLogRecord
  | SystemLogRecord;

// ─── Cross-system correlation view row ───────────────────────────────────────

/** Shape returned by the `log_all` SQLite view (cross-system correlation query). */
export interface LogAllRow {
  log_id:         string;
  timestamp:      string;
  level:          LogLevel;
  level_code:     number;
  system:         SystemId;
  component:      string;
  component_type: ComponentType;
  event_type:     string;
  event_code:     string;
  message:        string;
  session_id:     string | null;
  transaction_id: string | null;
  correlation_id: string | null;
  request_id:     string | null;
  actor_id:       string | null;
  actor_type:     ActorType | null;
  target_id:      string | null;
  target_type:    string | null;
  outcome:        Outcome | null;
  duration_ms:    number | null;
  ip_address:     string | null;
  error_code:     string | null;
  created_at:     string;
}
