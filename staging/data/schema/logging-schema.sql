-- =============================================================================
-- GCUID System Logging Schema
-- =============================================================================
-- Covers: GCUID Registry, CAES, HR System, LDAP/AD, Engineering, Finance,
--         and the General/Infrastructure system.
--
-- Design principles:
--   • Every table shares the same base column set (see §1 comment block).
--   • System-specific columns are appended after the base columns.
--   • All timestamps are ISO 8601 with millisecond precision (TEXT).
--   • All JSON columns store minified JSON text.
--   • Log levels follow RFC 5424 / syslog numeric severity ordering.
--   • A shared composite index on (timestamp, level) is created on every table.
--   • Foreign keys are NOT enforced here — log tables are append-only stores
--     and must remain writable even when referenced entities are deleted.
--
-- Log level values (ordered by severity, ascending = less severe):
--   debug(7)  info(6)  notice(5)  warning(4)  error(3)  critical(2)  alarm(1)  emergency(0)
--
-- Component-type values:
--   api | ui | module | connector | scheduler | middleware | auth | cli
--
-- Outcome values:
--   success | failure | partial | pending | skipped
--
-- Actor-type values:
--   user | admin | system | connector | scheduler | anonymous
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;   -- intentional for log tables (see design note above)

-- =============================================================================
-- §1  GCUID REGISTRY LOG TABLE
--     Covers the central identity registry: identity lifecycle, matching,
--     alias management, state transitions, and admin operations.
--
--     Components:
--       api:admin           – Admin REST route handlers
--       api:user            – User-facing REST route handlers
--       api:caes            – CAES attribute federation routes
--       api:connectors      – Connector management routes
--       api:flags           – Feature-flag routes
--       module:matcher      – Identity matching / deduplication engine
--       module:state-machine– Identity state-transition engine
--       module:alias        – Alias generation and management
--       module:seed         – Database seed / initialisation
--       scheduler:sync      – Scheduled synchronisation jobs
--       ui:GCUIDPortal      – GCUIDPortal.tsx page events
--       ui:AdminPortal      – (future) admin management page
--       middleware:auth     – Authentication / authorisation middleware
--       middleware:logger   – HTTP request logger middleware
-- =============================================================================

CREATE TABLE IF NOT EXISTS log_gcuid_registry (
  -- ── Identity ─────────────────────────────────────────────────────────────
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id           TEXT    NOT NULL UNIQUE,          -- UUID v4 for cross-system correlation

  -- ── Time ─────────────────────────────────────────────────────────────────
  timestamp        TEXT    NOT NULL,                 -- ISO 8601 + ms, e.g. 2026-04-29T14:32:01.123Z
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- ── Severity ─────────────────────────────────────────────────────────────
  level            TEXT    NOT NULL                  -- debug|info|notice|warning|error|critical|alarm|emergency
                   CHECK(level IN ('debug','info','notice','warning','error','critical','alarm','emergency')),
  level_code       INTEGER NOT NULL,                 -- numeric: 7=debug … 0=emergency

  -- ── Source component ─────────────────────────────────────────────────────
  system           TEXT    NOT NULL DEFAULT 'gcuid-registry',
  component        TEXT    NOT NULL,                 -- e.g. 'api:admin'
  component_type   TEXT    NOT NULL                  -- api|ui|module|connector|scheduler|middleware|auth|cli
                   CHECK(component_type IN ('api','ui','module','connector','scheduler','middleware','auth','cli')),

  -- ── Event identification ──────────────────────────────────────────────────
  event_type       TEXT    NOT NULL,                 -- categorical slug, e.g. 'identity.created'
  event_code       TEXT    NOT NULL,                 -- machine code, e.g. 'REG-001'
  message          TEXT    NOT NULL,                 -- human-readable description

  -- ── Session / transaction ─────────────────────────────────────────────────
  session_id       TEXT,                             -- browser/CLI session UUID
  transaction_id   TEXT,                             -- request-scoped transaction UUID
  correlation_id   TEXT,                             -- cross-system trace / span ID
  request_id       TEXT,                             -- HTTP request ID (from X-Request-ID header)

  -- ── Actor ────────────────────────────────────────────────────────────────
  actor_id         TEXT,                             -- user/system performing the action
  actor_type       TEXT                              -- user|admin|system|connector|scheduler|anonymous
                   CHECK(actor_type IN ('user','admin','system','connector','scheduler','anonymous')),

  -- ── Target ───────────────────────────────────────────────────────────────
  target_id        TEXT,                             -- e.g. a GCUID URN
  target_type      TEXT,                             -- identity|alias|connector|config|flag

  -- ── Outcome ──────────────────────────────────────────────────────────────
  outcome          TEXT                              -- success|failure|partial|pending|skipped
                   CHECK(outcome IN ('success','failure','partial','pending','skipped')),
  duration_ms      INTEGER,                          -- operation wall-clock time in ms

  -- ── Network context ───────────────────────────────────────────────────────
  ip_address       TEXT,                             -- IPv4/6, last octet masked for PII compliance
  user_agent       TEXT,                             -- truncated browser/client UA string

  -- ── Registry-specific columns ─────────────────────────────────────────────
  gcuid            TEXT,                             -- the GCUID URN being operated on (if applicable)
  identity_state_before TEXT,                        -- state before transition (provisional|active|suspended|…)
  identity_state_after  TEXT,                        -- state after transition
  match_confidence REAL,                             -- 0.0–1.0 matching confidence score
  alias_type       TEXT,                             -- e.g. GC-ALIAS, LEGACY
  source_systems   TEXT,                             -- JSON array: ["hr","ldap"]

  -- ── Free-form context and error ───────────────────────────────────────────
  context          TEXT,                             -- JSON object with any additional context
  error_code       TEXT,                             -- machine-readable error code
  error_detail     TEXT                              -- error message or stack trace excerpt
);

CREATE INDEX IF NOT EXISTS idx_log_gcuid_registry_ts_level
  ON log_gcuid_registry (timestamp, level_code);
CREATE INDEX IF NOT EXISTS idx_log_gcuid_registry_gcuid
  ON log_gcuid_registry (gcuid) WHERE gcuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_gcuid_registry_session
  ON log_gcuid_registry (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_gcuid_registry_correlation
  ON log_gcuid_registry (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_gcuid_registry_event
  ON log_gcuid_registry (event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_gcuid_registry_actor
  ON log_gcuid_registry (actor_id, timestamp) WHERE actor_id IS NOT NULL;

-- =============================================================================
-- §2  CAES LOG TABLE
--     Common Attribute Exchange Service: attribute federation, mappings,
--     cross-system attribute queries, cache operations, and connector-mapping
--     administration.
--
--     Components:
--       api:caes              – CAES REST route handlers (caes.ts)
--       module:resolver       – Attribute resolution / federation logic
--       module:cache          – CAES attribute cache read/write
--       module:mapping        – Attribute mapping configuration
--       module:connector-map  – Cross-system connector mapping administration
--       scheduler:prefetch    – Attribute pre-fetch scheduler
--       ui:CAESPortal         – CAESPortal.tsx page events
--       ui:SourceSystemsPortal– SourceSystemsPortal.tsx events
--       ui:SourceConnectorPortal – SourceConnectorPortal.tsx events
-- =============================================================================

CREATE TABLE IF NOT EXISTS log_caes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id           TEXT    NOT NULL UNIQUE,
  timestamp        TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  level            TEXT    NOT NULL
                   CHECK(level IN ('debug','info','notice','warning','error','critical','alarm','emergency')),
  level_code       INTEGER NOT NULL,
  system           TEXT    NOT NULL DEFAULT 'caes',
  component        TEXT    NOT NULL,
  component_type   TEXT    NOT NULL
                   CHECK(component_type IN ('api','ui','module','connector','scheduler','middleware','auth','cli')),
  event_type       TEXT    NOT NULL,
  event_code       TEXT    NOT NULL,
  message          TEXT    NOT NULL,
  session_id       TEXT,
  transaction_id   TEXT,
  correlation_id   TEXT,
  request_id       TEXT,
  actor_id         TEXT,
  actor_type       TEXT
                   CHECK(actor_type IN ('user','admin','system','connector','scheduler','anonymous')),
  target_id        TEXT,
  target_type      TEXT,                             -- attribute|mapping|connector|cache
  outcome          TEXT
                   CHECK(outcome IN ('success','failure','partial','pending','skipped')),
  duration_ms      INTEGER,
  ip_address       TEXT,
  user_agent       TEXT,

  -- ── CAES-specific columns ─────────────────────────────────────────────────
  query_gcuid           TEXT,                        -- GCUID being looked up
  attributes_requested  TEXT,                        -- JSON array of attribute names requested
  attributes_returned   TEXT,                        -- JSON array of attribute names actually returned
  attributes_missing    TEXT,                        -- JSON array of requested but unavailable attributes
  source_systems_queried TEXT,                       -- JSON array of systems queried, e.g. ["hr","ldap"]
  source_systems_failed  TEXT,                       -- JSON array of systems that failed to respond
  cache_hit             INTEGER,                     -- 1=cache hit, 0=live query
  cache_age_seconds     INTEGER,                     -- age of cached data in seconds
  federation_depth      INTEGER,                     -- number of federation hops
  mapping_id            INTEGER,                     -- attribute_mappings.id if a mapping was involved
  standard_attribute    TEXT,                        -- standard attribute name, e.g. 'person.name.given'

  context          TEXT,
  error_code       TEXT,
  error_detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_caes_ts_level
  ON log_caes (timestamp, level_code);
CREATE INDEX IF NOT EXISTS idx_log_caes_gcuid
  ON log_caes (query_gcuid) WHERE query_gcuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_caes_session
  ON log_caes (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_caes_correlation
  ON log_caes (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_caes_event
  ON log_caes (event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_caes_attribute
  ON log_caes (standard_attribute) WHERE standard_attribute IS NOT NULL;

-- =============================================================================
-- §3  HR SYSTEM LOG TABLE
--     Authoritative source connector for the HR employee database.
--     Covers data reads, connector health checks, sync operations, employee
--     record mutations (admin-driven), and portal UI interactions.
--
--     Components:
--       api:hr              – HR REST route handlers (hr.ts)
--       connector:hr-server – ConnectorAPIServer running at port 5183
--       connector:hr-client – ConnectorAPIClient queries from the registry
--       module:hr-seed      – HR database seed / data initialisation
--       scheduler:hr-sync   – Scheduled pull sync job
--       ui:HRPortal         – HRPortal.tsx page events
--       cli:hr              – CLI commands targeting HR data
-- =============================================================================

CREATE TABLE IF NOT EXISTS log_hr_system (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id           TEXT    NOT NULL UNIQUE,
  timestamp        TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  level            TEXT    NOT NULL
                   CHECK(level IN ('debug','info','notice','warning','error','critical','alarm','emergency')),
  level_code       INTEGER NOT NULL,
  system           TEXT    NOT NULL DEFAULT 'hr',
  component        TEXT    NOT NULL,
  component_type   TEXT    NOT NULL
                   CHECK(component_type IN ('api','ui','module','connector','scheduler','middleware','auth','cli')),
  event_type       TEXT    NOT NULL,
  event_code       TEXT    NOT NULL,
  message          TEXT    NOT NULL,
  session_id       TEXT,
  transaction_id   TEXT,
  correlation_id   TEXT,
  request_id       TEXT,
  actor_id         TEXT,
  actor_type       TEXT
                   CHECK(actor_type IN ('user','admin','system','connector','scheduler','anonymous')),
  target_id        TEXT,                             -- employee_id or record key
  target_type      TEXT,                             -- employee|record|connector|health
  outcome          TEXT
                   CHECK(outcome IN ('success','failure','partial','pending','skipped')),
  duration_ms      INTEGER,
  ip_address       TEXT,
  user_agent       TEXT,

  -- ── HR-specific columns ───────────────────────────────────────────────────
  employee_id      TEXT,                             -- HR employee ID (EMP001, etc.)
  operation_type   TEXT,                             -- read|write|update|delete|sync|health|search
  connector_status TEXT,                             -- healthy|degraded|unhealthy|offline
  connector_url    TEXT,                             -- connector endpoint URL
  records_affected INTEGER,                          -- count of records touched by the operation
  sync_cursor      TEXT,                             -- ISO timestamp used as sync cursor (incremental pull)
  department       TEXT,                             -- employee's department if available
  gcuid_linked     TEXT,                             -- linked GCUID if the employee is mapped

  context          TEXT,
  error_code       TEXT,
  error_detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_hr_ts_level
  ON log_hr_system (timestamp, level_code);
CREATE INDEX IF NOT EXISTS idx_log_hr_employee
  ON log_hr_system (employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_hr_session
  ON log_hr_system (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_hr_correlation
  ON log_hr_system (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_hr_event
  ON log_hr_system (event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_hr_connector_status
  ON log_hr_system (connector_status) WHERE connector_status IS NOT NULL;

-- =============================================================================
-- §4  LDAP/AD LOG TABLE
--     Authoritative source connector for the LDAP / Active Directory store.
--     Covers user account reads, group membership queries, self-service profile
--     updates (preferred name, job title), connector health, and sync operations.
--
--     Components:
--       api:ldap             – LDAP REST route handlers (ldap.ts)
--       connector:ldap-server– ConnectorAPIServer running at port 5184
--       connector:ldap-client– ConnectorAPIClient queries from the registry
--       module:ldap-seed     – LDAP database seed / data initialisation
--       scheduler:ldap-sync  – Scheduled pull sync job
--       ui:LDAPPortal        – LDAPPortal.tsx page events
--       ui:UserPortal        – Self-service updates through UserPortal.tsx
--       cli:ldap             – CLI commands targeting LDAP data
-- =============================================================================

CREATE TABLE IF NOT EXISTS log_ldap (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id           TEXT    NOT NULL UNIQUE,
  timestamp        TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  level            TEXT    NOT NULL
                   CHECK(level IN ('debug','info','notice','warning','error','critical','alarm','emergency')),
  level_code       INTEGER NOT NULL,
  system           TEXT    NOT NULL DEFAULT 'ldap',
  component        TEXT    NOT NULL,
  component_type   TEXT    NOT NULL
                   CHECK(component_type IN ('api','ui','module','connector','scheduler','middleware','auth','cli')),
  event_type       TEXT    NOT NULL,
  event_code       TEXT    NOT NULL,
  message          TEXT    NOT NULL,
  session_id       TEXT,
  transaction_id   TEXT,
  correlation_id   TEXT,
  request_id       TEXT,
  actor_id         TEXT,
  actor_type       TEXT
                   CHECK(actor_type IN ('user','admin','system','connector','scheduler','anonymous')),
  target_id        TEXT,                             -- username or DN (masked)
  target_type      TEXT,                             -- user|group|connector|health
  outcome          TEXT
                   CHECK(outcome IN ('success','failure','partial','pending','skipped')),
  duration_ms      INTEGER,
  ip_address       TEXT,
  user_agent       TEXT,

  -- ── LDAP-specific columns ─────────────────────────────────────────────────
  username         TEXT,                             -- LDAP username (sAMAccountName)
  dn_hash          TEXT,                             -- SHA-256 (8 chars) of the full DN — avoids storing PII
  operation_type   TEXT,                             -- read|write|update|search|bind|sync|health
  groups_affected  TEXT,                             -- JSON array of group names
  connector_status TEXT,                             -- healthy|degraded|unhealthy|offline
  connector_url    TEXT,
  records_affected INTEGER,
  sync_cursor      TEXT,
  self_service     INTEGER,                          -- 1 = user initiated their own update
  attribute_changed TEXT,                            -- standard attribute name if a field was updated
  value_before_hash TEXT,                            -- SHA-256 (8 chars) of old value (for audit without PII)
  gcuid_linked     TEXT,                             -- linked GCUID

  context          TEXT,
  error_code       TEXT,
  error_detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_ldap_ts_level
  ON log_ldap (timestamp, level_code);
CREATE INDEX IF NOT EXISTS idx_log_ldap_username
  ON log_ldap (username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_ldap_session
  ON log_ldap (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_ldap_correlation
  ON log_ldap (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_ldap_event
  ON log_ldap (event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_ldap_self_service
  ON log_ldap (self_service) WHERE self_service = 1;

-- =============================================================================
-- §5  ENGINEERING DEPARTMENT LOG TABLE
--     Department portal for the Engineering team: employee list, GCUID coverage,
--     cache operations, and departmental data management.
--
--     Components:
--       api:engineering      – Engineering REST route handlers (engineering.ts)
--       module:dept-cache    – dept-cache.ts cache read/write/invalidate
--       scheduler:eng-sync   – Connector sync scheduler for Engineering
--       ui:EngineeringPortal – EngineeringPortal.tsx page events
--       ui:DepartmentPortal  – DepartmentPortal.tsx shared department portal
--       cli:engineering      – CLI commands targeting Engineering data
-- =============================================================================

CREATE TABLE IF NOT EXISTS log_engineering (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id           TEXT    NOT NULL UNIQUE,
  timestamp        TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  level            TEXT    NOT NULL
                   CHECK(level IN ('debug','info','notice','warning','error','critical','alarm','emergency')),
  level_code       INTEGER NOT NULL,
  system           TEXT    NOT NULL DEFAULT 'engineering',
  component        TEXT    NOT NULL,
  component_type   TEXT    NOT NULL
                   CHECK(component_type IN ('api','ui','module','connector','scheduler','middleware','auth','cli')),
  event_type       TEXT    NOT NULL,
  event_code       TEXT    NOT NULL,
  message          TEXT    NOT NULL,
  session_id       TEXT,
  transaction_id   TEXT,
  correlation_id   TEXT,
  request_id       TEXT,
  actor_id         TEXT,
  actor_type       TEXT
                   CHECK(actor_type IN ('user','admin','system','connector','scheduler','anonymous')),
  target_id        TEXT,                             -- eng employee ID or cache key
  target_type      TEXT,                             -- employee|cache|connector|health
  outcome          TEXT
                   CHECK(outcome IN ('success','failure','partial','pending','skipped')),
  duration_ms      INTEGER,
  ip_address       TEXT,
  user_agent       TEXT,

  -- ── Engineering-specific columns ──────────────────────────────────────────
  eng_employee_id  TEXT,                             -- department-internal employee ID
  operation_type   TEXT,                             -- read|write|update|delete|sync|health|search
  cache_operation  TEXT,                             -- read|write|invalidate|miss|expire
  cache_mode       TEXT,                             -- dynamic-pull|push-cache|scheduled-pull
  coverage_score   INTEGER,                          -- 0–4 data coverage score
  coverage_pct     INTEGER,                          -- 0–100 coverage percentage
  skills           TEXT,                             -- JSON array of skills if changed/viewed
  gcuid_linked     TEXT,                             -- linked GCUID
  records_affected INTEGER,

  context          TEXT,
  error_code       TEXT,
  error_detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_engineering_ts_level
  ON log_engineering (timestamp, level_code);
CREATE INDEX IF NOT EXISTS idx_log_engineering_employee
  ON log_engineering (eng_employee_id) WHERE eng_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_engineering_session
  ON log_engineering (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_engineering_correlation
  ON log_engineering (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_engineering_event
  ON log_engineering (event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_engineering_cache
  ON log_engineering (cache_operation) WHERE cache_operation IS NOT NULL;

-- =============================================================================
-- §6  FINANCE DEPARTMENT LOG TABLE
--     Department portal for the Finance team: employee list, GCUID coverage,
--     cache operations, financial record management, and cost-centre tracking.
--
--     Components:
--       api:finance          – Finance REST route handlers (finance.ts)
--       module:dept-cache    – dept-cache.ts cache read/write/invalidate
--       scheduler:fin-sync   – Connector sync scheduler for Finance
--       ui:FinancePortal     – FinancePortal.tsx page events
--       ui:DepartmentPortal  – DepartmentPortal.tsx shared department portal
--       cli:finance          – CLI commands targeting Finance data
-- =============================================================================

CREATE TABLE IF NOT EXISTS log_finance (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id           TEXT    NOT NULL UNIQUE,
  timestamp        TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  level            TEXT    NOT NULL
                   CHECK(level IN ('debug','info','notice','warning','error','critical','alarm','emergency')),
  level_code       INTEGER NOT NULL,
  system           TEXT    NOT NULL DEFAULT 'finance',
  component        TEXT    NOT NULL,
  component_type   TEXT    NOT NULL
                   CHECK(component_type IN ('api','ui','module','connector','scheduler','middleware','auth','cli')),
  event_type       TEXT    NOT NULL,
  event_code       TEXT    NOT NULL,
  message          TEXT    NOT NULL,
  session_id       TEXT,
  transaction_id   TEXT,
  correlation_id   TEXT,
  request_id       TEXT,
  actor_id         TEXT,
  actor_type       TEXT
                   CHECK(actor_type IN ('user','admin','system','connector','scheduler','anonymous')),
  target_id        TEXT,                             -- fin employee ID, cost-centre code, etc.
  target_type      TEXT,                             -- employee|cost_centre|cache|connector|health
  outcome          TEXT
                   CHECK(outcome IN ('success','failure','partial','pending','skipped')),
  duration_ms      INTEGER,
  ip_address       TEXT,
  user_agent       TEXT,

  -- ── Finance-specific columns ──────────────────────────────────────────────
  fin_employee_id  TEXT,                             -- department-internal employee ID
  operation_type   TEXT,                             -- read|write|update|delete|sync|health|search
  cache_operation  TEXT,                             -- read|write|invalidate|miss|expire
  cache_mode       TEXT,                             -- dynamic-pull|push-cache|scheduled-pull
  financial_record_type TEXT,                        -- cost_centre|budget_code|payroll_group|account
  cost_centre      TEXT,                             -- cost centre code if applicable
  coverage_score   INTEGER,                          -- 0–4 data coverage score
  coverage_pct     INTEGER,
  gcuid_linked     TEXT,
  records_affected INTEGER,

  context          TEXT,
  error_code       TEXT,
  error_detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_finance_ts_level
  ON log_finance (timestamp, level_code);
CREATE INDEX IF NOT EXISTS idx_log_finance_employee
  ON log_finance (fin_employee_id) WHERE fin_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_finance_session
  ON log_finance (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_finance_correlation
  ON log_finance (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_finance_event
  ON log_finance (event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_finance_cache
  ON log_finance (cache_operation) WHERE cache_operation IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_finance_cost_centre
  ON log_finance (cost_centre) WHERE cost_centre IS NOT NULL;

-- =============================================================================
-- §7  GENERAL / INFRASTRUCTURE LOG TABLE
--     Cross-cutting system events: API server lifecycle, web-UI events, HTTP
--     middleware, connector runner, configuration changes, feature flags,
--     authentication, and any event that spans multiple domain systems.
--
--     Components:
--       server:api           – Express server startup/shutdown (server.ts)
--       server:web-ui        – Vite / React app lifecycle events
--       middleware:error     – Error-handling middleware
--       middleware:logger    – HTTP request logger middleware
--       middleware:cors      – CORS policy middleware
--       module:connector-resolver – connector-resolver.ts
--       module:dept-cache    – dept-cache.ts infrastructure events
--       api:connectors       – Connector management REST routes (connectors.ts)
--       api:flags            – Feature-flag REST routes (flags.ts)
--       api:dept             – Generic department routes (dept.ts)
--       ui:OptionsPortal     – OptionsPortal.tsx events
--       ui:Layout            – Layout.tsx navigation/routing events
--       scheduler:global     – Global/multi-system scheduler events
--       auth:session         – Session creation, expiry, revocation
-- =============================================================================

CREATE TABLE IF NOT EXISTS log_system (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id           TEXT    NOT NULL UNIQUE,
  timestamp        TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  level            TEXT    NOT NULL
                   CHECK(level IN ('debug','info','notice','warning','error','critical','alarm','emergency')),
  level_code       INTEGER NOT NULL,
  system           TEXT    NOT NULL DEFAULT 'system',
  component        TEXT    NOT NULL,
  component_type   TEXT    NOT NULL
                   CHECK(component_type IN ('api','ui','module','connector','scheduler','middleware','auth','cli')),
  event_type       TEXT    NOT NULL,
  event_code       TEXT    NOT NULL,
  message          TEXT    NOT NULL,
  session_id       TEXT,
  transaction_id   TEXT,
  correlation_id   TEXT,
  request_id       TEXT,
  actor_id         TEXT,
  actor_type       TEXT
                   CHECK(actor_type IN ('user','admin','system','connector','scheduler','anonymous')),
  target_id        TEXT,
  target_type      TEXT,                             -- service|config|flag|session|connector|route
  outcome          TEXT
                   CHECK(outcome IN ('success','failure','partial','pending','skipped')),
  duration_ms      INTEGER,
  ip_address       TEXT,
  user_agent       TEXT,

  -- ── Infrastructure-specific columns ───────────────────────────────────────
  service_name     TEXT,                             -- api-server|web-ui|connector-runner|scheduler
  service_version  TEXT,                             -- semver string
  host             TEXT,                             -- hostname or container ID
  process_id       INTEGER,                          -- OS PID
  port             INTEGER,                          -- listening port if applicable

  -- HTTP request context (for middleware-level logs)
  http_method      TEXT,                             -- GET|POST|PUT|DELETE|PATCH
  http_path        TEXT,                             -- URL path (stripped of query params)
  http_status      INTEGER,                          -- HTTP response status code
  http_request_size  INTEGER,                        -- request body size in bytes
  http_response_size INTEGER,                        -- response body size in bytes

  -- Configuration / flag events
  flag_name        TEXT,                             -- feature flag name if changed
  flag_value_before TEXT,                            -- previous flag value
  flag_value_after  TEXT,                            -- new flag value
  config_key        TEXT,                            -- config key if changed

  -- Resource metrics (sampled, not real-time)
  memory_mb        REAL,                             -- resident memory in MB
  cpu_percent      REAL,                             -- CPU utilisation 0–100
  active_connections INTEGER,                        -- open HTTP connections

  context          TEXT,
  error_code       TEXT,
  error_detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_system_ts_level
  ON log_system (timestamp, level_code);
CREATE INDEX IF NOT EXISTS idx_log_system_service
  ON log_system (service_name) WHERE service_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_system_session
  ON log_system (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_system_correlation
  ON log_system (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_system_http
  ON log_system (http_status, timestamp) WHERE http_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_log_system_event
  ON log_system (event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_system_flag
  ON log_system (flag_name) WHERE flag_name IS NOT NULL;

-- =============================================================================
-- §8  CROSS-SYSTEM CORRELATION VIEW
--     A UNION ALL view across all seven tables presenting the shared base
--     columns. Used for cross-system timeline queries and distributed tracing.
--     Does NOT include system-specific columns — join back to the source table
--     on log_id for full detail.
-- =============================================================================

DROP VIEW IF EXISTS log_all;
CREATE VIEW log_all AS
  SELECT log_id, timestamp, level, level_code, system, component, component_type,
         event_type, event_code, message, session_id, transaction_id, correlation_id,
         request_id, actor_id, actor_type, target_id, target_type,
         outcome, duration_ms, ip_address, error_code, created_at
  FROM log_gcuid_registry
  UNION ALL
  SELECT log_id, timestamp, level, level_code, system, component, component_type,
         event_type, event_code, message, session_id, transaction_id, correlation_id,
         request_id, actor_id, actor_type, target_id, target_type,
         outcome, duration_ms, ip_address, error_code, created_at
  FROM log_caes
  UNION ALL
  SELECT log_id, timestamp, level, level_code, system, component, component_type,
         event_type, event_code, message, session_id, transaction_id, correlation_id,
         request_id, actor_id, actor_type, target_id, target_type,
         outcome, duration_ms, ip_address, error_code, created_at
  FROM log_hr_system
  UNION ALL
  SELECT log_id, timestamp, level, level_code, system, component, component_type,
         event_type, event_code, message, session_id, transaction_id, correlation_id,
         request_id, actor_id, actor_type, target_id, target_type,
         outcome, duration_ms, ip_address, error_code, created_at
  FROM log_ldap
  UNION ALL
  SELECT log_id, timestamp, level, level_code, system, component, component_type,
         event_type, event_code, message, session_id, transaction_id, correlation_id,
         request_id, actor_id, actor_type, target_id, target_type,
         outcome, duration_ms, ip_address, error_code, created_at
  FROM log_engineering
  UNION ALL
  SELECT log_id, timestamp, level, level_code, system, component, component_type,
         event_type, event_code, message, session_id, transaction_id, correlation_id,
         request_id, actor_id, actor_type, target_id, target_type,
         outcome, duration_ms, ip_address, error_code, created_at
  FROM log_finance
  UNION ALL
  SELECT log_id, timestamp, level, level_code, system, component, component_type,
         event_type, event_code, message, session_id, transaction_id, correlation_id,
         request_id, actor_id, actor_type, target_id, target_type,
         outcome, duration_ms, ip_address, error_code, created_at
  FROM log_system;
