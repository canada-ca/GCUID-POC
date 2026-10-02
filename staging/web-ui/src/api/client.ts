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
// API Base URL — must be relative to the app's Vite base path so that requests
// go through the correct CloudFront behavior (/client/.../gcuid/api/...) rather
// than hitting the root origin.  In local dev BASE_URL is '/' so this resolves
// to '/api' and the Vite proxy forwards the call to the local Express server.
const API_BASE_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

// API Response types
export interface ApiResponse<T> {
  success: true;
  data: T;
  count?: number;
}

export interface ApiError {
  error: {
    message: string;
    statusCode: number;
    timestamp: string;
    path: string;
  };
}

// Domain types
export interface RegisterIdentityInput {
  entity_type: 'person' | 'org' | 'asset' | 'app' | 'agent';
  entity_id?: string;
  namespace?: string;
  metadata?: Record<string, any>;
  source_links?: Array<{ source_system: string; source_id: string; is_primary?: boolean }>;
  format?:       'v1' | 'v2';
  core_id_type?: 'ulid' | 'uuid';
  encoding?:     'crockford' | 'standard';
}

export interface Identity {
  gcuid: string;
  // Identity entity lifecycle (the person/org/entity)
  state: 'provisional' | 'active' | 'under_review' | 'suspended' | 'retired' | 'archived';
  // Identifier token lifecycle (the GCUID itself)
  identifier_state: 'reserved' | 'issued' | 'superseded' | 'nullified';
  superseded_by?: string | null;
  entity_type: string;
  entity_id: string;
  namespace: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any> | string | null;
  aliases?: Array<{ alias_type: string; alias_value: string }>;
}

export interface IdentifierStateHistory {
  id: number;
  gcuid: string;
  from_state: string | null;
  to_state: string;
  transition: string;
  changed_by: string;
  reason: string | null;
  timestamp: string;
}

export interface StateHistory {
  id: number;
  gcuid: string;
  from_state: string | null;
  to_state: string;
  changed_at: string;
  changed_by: string;
  reason: string | null;
  transition_type?: string | null;
}

export interface AuditTrailEntry {
  event_source: 'identity' | 'identifier';
  id: number;
  gcuid: string;
  from_state: string | null;
  to_state: string;
  transition: string | null;
  reason: string | null;
  actor: string;
  timestamp: string;
}

export interface GcuidAuditSummary {
  gcuid: string;
  entity_id: string | null;
  current_state: string;
  identifier_state: string | null;
  superseded_by: string | null;
  supersedes: string[];
  created: string;
  audit_trail: AuditTrailEntry[];
}

export interface UserAttributeEntry {
  value: any;
  source: string | null;
  fetch_mode: 'live' | 'cache' | null;
  authoritative_source: string | null;
  self_service: boolean;
  writable: boolean;
  self_service_value?: any;
  self_service_source?: string;
  self_service_fetch_mode?: 'live' | 'cache';
}

export interface UserAttributes {
  gcuid: string;
  attributes: Record<string, UserAttributeEntry>;
}

export interface UserAttributeUpdateResult {
  gcuid: string;
  updated: Record<string, { source: string; value: string }>;
  rejected?: Record<string, string>;
}

export interface Employee {
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  department: string;
  hire_date: string;
  gcuid: string | null;
}

export interface DepartmentStats {
  total_employees: number;
  employees_with_gcuid: number;
  integration_rate: string;
  by_department: Array<{
    department: string;
    total: number;
    integrated: number;
    rate: string;
  }>;
}

export interface ConnectorStatus {
  connector_id: string;
  source_system: string;
  status: 'running' | 'stopped';
  last_sync: string | null;
  records_synced: number;
}

export interface MonitorDashboard {
  statistics: {
    total_employees: number;
    total_gcuids: number;
    active_gcuids: number;
    integration_rate: string;
  };
  recent_activity: {
    state_transitions_24h: number;
  };
  health: {
    status: string;
    databases_accessible: boolean;
    errors: number;
  };
}

export interface AdminStats {
  overview: {
    total_identities: number;
    created_24h: number;
    transitions_24h: number;
  };
  by_state: Array<{
    state: string;
    count: number;
  }>;
  by_type: Array<{
    type: string;
    count: number;
  }>;
}

export interface DuplicateGroup {
  kind: 'entity_id' | 'source_id_conflict' | 'cross_system_id';
  key: string;
  count: number;
  gcuids: string[];
  reason: string;
  // entity_id clash
  entity_id: string | null;
  // source_id conflict / cross-system
  source_system?: string;
  source_id?: string;
  systems?: string[];
}

export interface EngineeringEmployee {
  dept_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  employment_type: string;
  skills: string[] | string | null;
  start_date: string;
  end_date: string | null;
  status: string;
  gcuid: string | null;
  hr_employee_id: string | null;
  ldap_username: string | null;
  manager_dept_id: string | null;
  coverage_score?: number;
  coverage_percentage?: string;
  gcuid_details?: Identity & { aliases: any[]; source_mappings: any[] };
}

export type EngineeringEmployeeInput = {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  employment_type: string;
  start_date: string;
  end_date?: string | null;
  status?: string;
  hr_employee_id?: string | null;
  ldap_username?: string | null;
  skills?: string[];
  manager_dept_id?: string | null;
};

export interface FinanceEmployee {
  dept_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  employment_type: string;
  clearance_level: string | null;
  start_date: string;
  end_date: string | null;
  status: string;
  gcuid: string | null;
  hr_employee_id: string | null;
  ldap_username: string | null;
  manager_dept_id: string | null;
  coverage_score?: number;
  coverage_percentage?: string;
  gcuid_details?: Identity & { aliases: any[]; source_mappings: any[] };
}

export type FinanceEmployeeInput = {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  employment_type: string;
  start_date: string;
  end_date?: string | null;
  status?: string;
  clearance_level?: string | null;
  hr_employee_id?: string | null;
  ldap_username?: string | null;
  manager_dept_id?: string | null;
};

export interface DepartmentCoverageStats {
  total_employees: number;
  employment_types: Record<string, number>;
  coverage: {
    with_hr: number;
    with_ldap: number;
    with_gcuid: number;
    full_coverage: number;
    hr_percentage: string;
    ldap_percentage: string;
    gcuid_percentage: string;
    full_coverage_percentage: string;
  };
}

export interface EngineeringStats extends DepartmentCoverageStats {
  by_employment_type?: Array<{
    type: string;
    total: number;
    with_gcuid: number;
  }>;
}

export interface FinanceStats extends DepartmentCoverageStats {
  by_clearance?: Array<{
    clearance_level: string;
    total: number;
    with_gcuid: number;
  }>;
}

export interface CoverageGap {
  dept_id: string;
  name: string;
  email: string;
  employment_type: string;
  missing_hr: boolean;
  missing_ldap: boolean;
  missing_gcuid: boolean;
}

export interface HREmployee {
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  department: string;
  job_title: string;
  employment_type: string;
  hire_date: string;
  status: string;
  salary: number | null;
  manager_id: string | null;
  gcuid: string | null;
  gcuid_state: string | null;
  gcuid_details?: Identity & { aliases: any[]; source_mappings: any[] };
}

export type HREmployeeInput = {
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  department: string;
  job_title: string;
  employment_type: string;
  hire_date: string;
  status?: string;
  salary?: number | null;
  manager_id?: string | null;
};

export interface LDAPUser {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  distinguished_name: string;
  department: string;
  title: string | null;
  account_enabled: number;
  groups: string[] | string;
  last_logon: string | null;
  gcuid: string | null;
  gcuid_state: string | null;
  gcuid_details?: Identity & { aliases: any[]; source_mappings: any[] };
}

export type LDAPUserInput = {
  username: string;
  distinguished_name: string;
  email: string;
  first_name: string;
  last_name: string;
  department: string;
  title?: string | null;
  account_enabled?: boolean;
  groups?: string[];
};

export interface HRStats {
  total_employees: number;
  with_gcuid: number;
  without_gcuid: number;
  gcuid_percentage: string;
  by_department: Array<{
    department: string;
    count: number;
  }>;
  by_status: Array<{
    status: string;
    count: number;
  }>;
}

export interface LDAPStats {
  total_users: number;
  enabled_accounts: number;
  disabled_accounts: number;
  with_gcuid: number;
  without_gcuid: number;
  gcuid_percentage: string;
}

export interface AttributeSchema {
  [key: string]: {
    description: string;
    sources: string[];
    dataType: string;
    sensitive?: boolean;
  };
}

// Source Mapping - GCUID to authoritative source accounts (belongs to GCUID Portal)
export interface SourceMapping {
  gcuid: string;
  source_system: string;
  source_id: string;
  is_primary: boolean;
  verified_at: string | null;
  created_at: string;
}

// GC-style alias (GC-{CONTEXT}-{HASH}-{CHECKSUM})
export interface GCAlias {
  id: number;
  gcuid: string;
  alias_type: string;   // e.g. 'GC-A', 'GC-S'
  alias_value: string;  // e.g. 'GC-A-ABCD-EFGH-IJKL-M'
  status: 'enabled' | 'disabled';
  created_at: string;
}

export interface SourceSystemInput {
  system_id: string;
  display_name: string;
  system_type: 'authoritative_source' | 'department';
  api_url?: string;
  /** Set a new shared secret. On update, leave blank to keep the existing secret. */
  api_secret?: string;
  description?: string;
  allow_inbound?: boolean;
  cache_ttl_seconds?: number;
  cache_stale_policy?: string;
  /** Whether this system communicates using the canonical GCUID URN or an alias */
  identifier_mode?: 'gcuid' | 'alias';
}

// Attribute Mapping - CAES standard attribute names to source-specific fields
export interface AttributeMapping {
  id: number;
  standardAttribute: string;
  sourceSystem: string;
  sourceField: string;
  sourceTable: string;
  keyField: string;
  is_authoritative: boolean;
  operations: ('read' | 'write' | 'update' | 'delete')[];
  transformations?: {
    read?: string;
    write?: string;
  };
  searchable: boolean;
  indexed: boolean;
}

export type AttributeMappingInput = Omit<AttributeMapping, 'id'>;

export interface SelfServiceAttribute {
  standardAttribute: string;
  label: string;
  description: string;
  dataType: string;
  writableSource: string;
  writableField: string;
  writableTable: string;
  writableKeyField: string;
}

export interface CAESStats {
  overview: {
    total_attribute_mappings: number;
    unique_attributes: number;
    multi_source_attributes: number;
    source_systems: number;
  };
  by_source: Array<{
    source_system: string;
    mapping_count: number;
  }>;
  multi_source_attributes: Array<{
    attribute: string;
    sources: string[];
    source_count: number;
  }>;
  operation_support: Array<{
    operation: string;
    mappings_supporting: number;
  }>;
  searchable_mappings: number;
  indexed_mappings: number;
}

export interface AttributeResolution {
  gcuid: string;
  attributes: Record<string, {
    // Canonical (authoritative) value — backward compat
    value: any;
    source: string | null;
    dataType: string;
    // All values retrieved across every linked source
    values: Array<{
      source: string;
      value: any;
      is_authoritative: boolean;
    }>;
    // Which source system is authoritative for this attribute per the mapping
    authoritative_source: string | null;
  }>;
  sources_used: string[];
  /** Source system IDs whose connectors are disabled and therefore returned no values */
  disabled_sources?: string[];
}

// Identity Match types - compound attribute-based identity search
export interface MatchStrategy {
  strategyId: string;
  description: string;
  standardAttributes: string[];
  matchType: 'exact' | 'contains';
  confidence: number;
  requiresUnique: boolean;
}

export interface SourceMatchConfig {
  sourceSystem: string;
  connectorId?: string;
  sourceTable: string;
  keyField: string;
  strategies: MatchStrategy[];
}

export interface IdentityMatch {
  sourceSystem: string;
  sourceId: string;
  confidence: number;
  strategyId: string;
  strategyDescription: string;
  matchedAttributes: string[];
  record: Record<string, any>;
}

export interface IdentityMatchResult {
  matches: IdentityMatch[];
  search_attributes_provided: string[];
  sources_searched: string[];
  summary: {
    total_matches: number;
    unique_match_found: boolean;
    sources_with_match: string[];
  };
}

export interface MatchAndLinkResult {
  gcuid: string;
  matches_found: number;
  sources_linked: string[];
  high_confidence_matches: { sourceSystem: string; sourceId: string; confidence: number; strategyId: string }[];
  low_confidence_matches: { sourceSystem: string; sourceId: string; confidence: number; strategyId: string }[];
  requested_by: string;
  linked_at: string;
}

// Connector configuration — one file per connector process
export interface ConnectorTransformation {
  type:
    | 'lowercase' | 'uppercase' | 'trim'
    | 'value_map'
    | 'date_format'
    | 'regex_replace'
    | 'prefix'
    | 'suffix'
    | 'substring'
    | 'conditional'
    | 'pipeline'
    | 'expression';
  /**
   * When to apply the transformation:
   *   'read'  — reading from source (before CAES query response)
   *   'write' — writing to source (before persisting a value)
   *   'both'  — both directions; value_map / date_format invert automatically on write
   * Defaults to 'both'.
   */
  direction?: 'read' | 'write' | 'both';
  description?: string;
  /** value_map: source code → normalised label pairs */
  map?: Record<string, string>;
  /** date_format: input format string (e.g. 'DD/MM/YYYY') */
  fromFormat?: string;
  /** date_format: output format string. Defaults to 'YYYY-MM-DD'. */
  toFormat?: string;
  /** regex_replace / conditional: ECMAScript regex pattern. Validated server-side for ReDoS safety. */
  pattern?: string;
  /** regex_replace: replacement string; supports capture groups ($1, $2…). */
  replacement?: string;
  /** prefix / suffix: string to prepend or append. */
  affixValue?: string;
  /** substring: zero-based start index (inclusive). */
  start?: number;
  /** substring: zero-based end index (exclusive). Omit to extract to end. */
  end?: number;
  /** conditional: value to produce when pattern matches. */
  thenValue?: string;
  /** conditional: value to produce when pattern does NOT match. Omit to pass through unchanged. */
  elseValue?: string;
  /** pipeline: ordered list of transforms (max 10; no nested pipelines). */
  steps?: ConnectorTransformation[];
  /** expression: JEXL expression; context: { value, field }. Max 500 chars. */
  expr?: string;
}

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
    /**
     * Plan B option B3 (sub-phases 1.1-2.1): the connector talks to this
     * upstream source server over HTTP instead of opening the SQLite file
     * directly. baseUrl is the source server's root (e.g. http://localhost:5188);
     * authToken is the bearer token the source server enforces on /health,
     * /info, /search, /records/:id.
     */
    upstreamSource?: {
      baseUrl: string;
      authToken: string;
    };
  };
  connectorServer: {
    port: number;
    authToken: string;
  };
  transformations?: Record<string, ConnectorTransformation>;
}

export type ConnectorPatch = Partial<Pick<ConnectorConfig,
  'displayName' | 'description' | 'enabled' | 'accessMode'
>> & {
  gcuidIntegration?: Partial<ConnectorConfig['gcuidIntegration']>;
  connectorServer?: Partial<ConnectorConfig['connectorServer']>;
  sourceConnection?: Partial<ConnectorConfig['sourceConnection']>;
  transformations?: Record<string, ConnectorTransformation>;
};

// API Client
async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  } catch {
    throw new Error(`API server is unreachable. Make sure the server is running on port 5182.`);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status} ${response.statusText})`;
    try {
      const error: ApiError = await response.json();
      message = error.error?.message || message;
    } catch {
      // Response body wasn't JSON (e.g. proxy error page) — use status text
    }
    throw new Error(message);
  }

  let data: ApiResponse<T>;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Invalid response from server (not JSON). Endpoint: ${endpoint}`);
  }
  return data.data;
}

// User Portal API
export const userApi = {
  lookup: (id: string) => 
    apiRequest<Identity>(`/user/lookup/${encodeURIComponent(id)}`),
  
  search: (query: string) => 
    apiRequest<Identity[]>(`/user/search?q=${encodeURIComponent(query)}`),
  
  getHistory: (gcuid: string) => 
    apiRequest<StateHistory[]>(`/user/history/${encodeURIComponent(gcuid)}`),
  
  verify: (gcuid: string) => 
    apiRequest<{ valid: boolean; gcuid?: string; error?: string }>(`/user/verify/${encodeURIComponent(gcuid)}`),

  getAttributes: (gcuid: string) =>
    apiRequest<UserAttributes>(`/user/attributes/${encodeURIComponent(gcuid)}`),

  updateAttributes: (gcuid: string, attributes: Record<string, string>) =>
    apiRequest<UserAttributeUpdateResult>(`/user/attributes/${encodeURIComponent(gcuid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes }),
    }),

  getAliases: (gcuid: string) =>
    apiRequest<GCAlias[]>(`/user/aliases/${encodeURIComponent(gcuid)}`),

  checkAlias: (value: string, gcuid?: string) =>
    apiRequest<{ available: boolean; alreadyOwned?: boolean; reason?: string; suggestions: string[] }>(
      `/user/aliases/check?value=${encodeURIComponent(value)}${gcuid ? `&gcuid=${encodeURIComponent(gcuid)}` : ''}`
    ),

  saveAlias: (gcuid: string, value: string) =>
    apiRequest<GCAlias>(`/user/aliases/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }),

  deleteAlias: (gcuid: string, id: number) =>
    apiRequest<{ deleted: number }>(`/user/aliases/${encodeURIComponent(gcuid)}/${id}`, {
      method: 'DELETE',
    }),

  disableAlias: (gcuid: string, id: number, reason?: string) =>
    apiRequest<GCAlias>(`/user/aliases/${encodeURIComponent(gcuid)}/${id}/disable`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),

  enableAlias: (gcuid: string, id: number, reason?: string) =>
    apiRequest<GCAlias>(`/user/aliases/${encodeURIComponent(gcuid)}/${id}/enable`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),
};

// Department Portal API
export const departmentApi = {
  listEmployees: () => 
    apiRequest<Employee[]>('/dept/data/list'),
  
  viewEmployee: (id: string) => 
    apiRequest<Employee & { gcuid_details?: Identity }>(`/dept/data/view/${encodeURIComponent(id)}`),
  
  getStats: () => 
    apiRequest<DepartmentStats>('/dept/data/stats'),
  
  searchEmployees: (query: string) => 
    apiRequest<Employee[]>(`/dept/data/search?q=${encodeURIComponent(query)}`),
  
  getConnectorStatus: () => 
    apiRequest<ConnectorStatus>('/dept/connector/status'),
  
  testConnector: () => 
    apiRequest<{ success: boolean; message: string }>('/dept/connector/test'),
  
  getConnectorInfo: () => 
    apiRequest<{ connector_id: string; source_system: string; database: string }>('/dept/connector/info'),
  
  getDashboard: () => 
    apiRequest<MonitorDashboard>('/dept/monitor/dashboard'),
  
  getMonitorStats: () => 
    apiRequest<{ state_transitions_24h: number; gcuids_created_today: number }>('/dept/monitor/stats'),
};

// HR Portal API
export const hrApi = {
  listEmployees: () => 
    apiRequest<HREmployee[]>('/hr/employees'),
  
  viewEmployee: (id: string) => 
    apiRequest<HREmployee>(`/hr/employees/${encodeURIComponent(id)}`),
  
  getStats: () => 
    apiRequest<HRStats>('/hr/stats'),
  
  searchEmployees: (query: string) => 
    apiRequest<HREmployee[]>(`/hr/search?q=${encodeURIComponent(query)}`),

  getCoverageGaps: () =>
    apiRequest<{ source: string; gaps: { without_gcuid: { count: number; employees: any[] }; degraded_coverage: { count: number; records: any[] } } }>('/hr/coverage-gaps'),
  
  getConnectorHealth: () => 
    apiRequest<ConnectorHealthData>('/hr/connector/health'),
  
  getConnectorInfo: () => 
    apiRequest<any>('/hr/connector/info'),

  createEmployee: (data: HREmployeeInput) =>
    apiRequest<HREmployee>('/hr/employees', { method: 'POST', body: JSON.stringify(data) }),

  updateEmployee: (id: string, data: Partial<HREmployeeInput>) =>
    apiRequest<HREmployee>(`/hr/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteEmployee: (id: string) =>
    apiRequest<{ deleted: string }>(`/hr/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// LDAP Portal API
export const ldapApi = {
  listUsers: () => 
    apiRequest<LDAPUser[]>('/ldap/users'),
  
  viewUser: (username: string) => 
    apiRequest<LDAPUser>(`/ldap/users/${encodeURIComponent(username)}`),
  
  getStats: () => 
    apiRequest<LDAPStats>('/ldap/stats'),
  
  searchUsers: (query: string) => 
    apiRequest<LDAPUser[]>(`/ldap/search?q=${encodeURIComponent(query)}`),

  getCoverageGaps: () =>
    apiRequest<{ source: string; gaps: { without_gcuid: { count: number; users: any[] }; degraded_coverage: { count: number; records: any[] } } }>('/ldap/coverage-gaps'),
  
  getConnectorHealth: () => 
    apiRequest<ConnectorHealthData>('/ldap/connector/health'),
  
  getConnectorInfo: () => 
    apiRequest<any>('/ldap/connector/info'),

  createUser: (data: LDAPUserInput) =>
    apiRequest<LDAPUser>('/ldap/users', { method: 'POST', body: JSON.stringify(data) }),

  updateUser: (username: string, data: Partial<LDAPUserInput>) =>
    apiRequest<LDAPUser>(`/ldap/users/${encodeURIComponent(username)}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteUser: (username: string) =>
    apiRequest<{ deleted: string }>(`/ldap/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
};

// Engineering Portal API
const normalizeDeptStats = (raw: any): DepartmentCoverageStats => ({
  total_employees: raw.total_employees,
  employment_types: Object.fromEntries(
    (raw.employment_types as Array<{ employment_type: string; count: number }>)
      .map((e) => [e.employment_type, e.count])
  ),
  coverage: {
    with_hr: raw.coverage.hr.count,
    with_ldap: raw.coverage.ldap.count,
    with_gcuid: raw.coverage.gcuid.count,
    full_coverage: raw.coverage.full_coverage.count,
    hr_percentage: `${raw.coverage.hr.percentage}%`,
    ldap_percentage: `${raw.coverage.ldap.percentage}%`,
    gcuid_percentage: `${raw.coverage.gcuid.percentage}%`,
    full_coverage_percentage: `${raw.coverage.full_coverage.percentage}%`,
  },
});

const normalizeCoverageGaps = (raw: any): { missing_hr: CoverageGap[]; missing_ldap: CoverageGap[]; missing_gcuid: CoverageGap[] } => {
  const mapList = (list: any[]): CoverageGap[] =>
    list.map((e) => ({
      dept_id: e.dept_id,
      name: `${e.first_name} ${e.last_name}`,
      email: e.email,
      employment_type: e.employment_type,
      missing_hr: false,
      missing_ldap: false,
      missing_gcuid: false,
    }));
  return {
    missing_hr: mapList(raw.gaps.missing_hr.employees),
    missing_ldap: mapList(raw.gaps.missing_ldap.employees),
    missing_gcuid: mapList(raw.gaps.missing_gcuid.employees),
  };
};

export const engineeringApi = {
  listEmployees: () => 
    apiRequest<EngineeringEmployee[]>('/engineering/employees'),
  
  viewEmployee: (id: string) => 
    apiRequest<EngineeringEmployee>(`/engineering/employees/${encodeURIComponent(id)}`),
  
  getStats: async (): Promise<EngineeringStats> => {
    const raw = await apiRequest<any>('/engineering/stats');
    return normalizeDeptStats(raw) as EngineeringStats;
  },
  
  searchEmployees: (query: string) => 
    apiRequest<EngineeringEmployee[]>(`/engineering/search?q=${encodeURIComponent(query)}`),
  
  getCoverageGaps: async () => {
    const raw = await apiRequest<any>('/engineering/coverage-gaps');
    return normalizeCoverageGaps(raw);
  },

  getConnectorHealth: () =>
    apiRequest<ConnectorHealthData>('/engineering/connector/health'),
  
  requestGCUID: (deptId: string, requestedBy: string) => 
    apiRequest<{ success: boolean; message: string; gcuid?: string }>('/engineering/request-gcuid', {
      method: 'POST',
      body: JSON.stringify({ dept_id: deptId, requested_by: requestedBy }),
    }),

  createEmployee: (data: EngineeringEmployeeInput) =>
    apiRequest<EngineeringEmployee>('/engineering/employees', { method: 'POST', body: JSON.stringify(data) }),

  updateEmployee: (id: string, data: Partial<EngineeringEmployeeInput>) =>
    apiRequest<EngineeringEmployee>(`/engineering/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteEmployee: (id: string) =>
    apiRequest<{ deleted: string }>(`/engineering/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  setLinkage: (id: string, linkage: { hr_employee_id?: string | null; ldap_username?: string | null }) =>
    apiRequest<EngineeringEmployee>(`/engineering/employees/${encodeURIComponent(id)}/linkage`, { method: 'PATCH', body: JSON.stringify(linkage) }),
};

// Finance Portal API
export const financeApi = {
  listEmployees: () => 
    apiRequest<FinanceEmployee[]>('/finance/employees'),
  
  viewEmployee: (id: string) => 
    apiRequest<FinanceEmployee>(`/finance/employees/${encodeURIComponent(id)}`),
  
  getStats: async (): Promise<FinanceStats> => {
    const raw = await apiRequest<any>('/finance/stats');
    return normalizeDeptStats(raw) as FinanceStats;
  },
  
  searchEmployees: (query: string) => 
    apiRequest<FinanceEmployee[]>(`/finance/search?q=${encodeURIComponent(query)}`),
  
  getCoverageGaps: async () => {
    const raw = await apiRequest<any>('/finance/coverage-gaps');
    return normalizeCoverageGaps(raw);
  },

  getConnectorHealth: () =>
    apiRequest<ConnectorHealthData>('/finance/connector/health'),
  
  requestGCUID: (deptId: string, requestedBy: string) => 
    apiRequest<{ success: boolean; message: string; gcuid?: string }>('/finance/request-gcuid', {
      method: 'POST',
      body: JSON.stringify({ dept_id: deptId, requested_by: requestedBy }),
    }),

  createEmployee: (data: FinanceEmployeeInput) =>
    apiRequest<FinanceEmployee>('/finance/employees', { method: 'POST', body: JSON.stringify(data) }),

  updateEmployee: (id: string, data: Partial<FinanceEmployeeInput>) =>
    apiRequest<FinanceEmployee>(`/finance/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteEmployee: (id: string) =>
    apiRequest<{ deleted: string }>(`/finance/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  setLinkage: (id: string, linkage: { hr_employee_id?: string | null; ldap_username?: string | null }) =>
    apiRequest<FinanceEmployee>(`/finance/employees/${encodeURIComponent(id)}/linkage`, { method: 'PATCH', body: JSON.stringify(linkage) }),
};

// Admin Portal API
export const adminApi = {
  listIdentities: () =>
    apiRequest<Identity[]>('/gcuid/list'),

  listIdentitiesByFilter: (filters: { state?: string; entity_type?: string }) => {
    const params = new URLSearchParams();
    if (filters.state)       params.set('state',       filters.state);
    if (filters.entity_type) params.set('entity_type', filters.entity_type);
    const qs = params.toString();
    return apiRequest<Identity[]>(`/gcuid/list${qs ? '?' + qs : ''}`);
  },
  
  viewIdentity: async (gcuid: string) => {
    const result = await apiRequest<{ identity: Identity; history: StateHistory[] | null }>(
      `/gcuid/view/${encodeURIComponent(gcuid)}?withHistory=true`
    );
    return { ...result.identity, history: result.history ?? [] };
  },
  
  searchIdentities: (query: string) => 
    apiRequest<Identity[]>(`/gcuid/search?q=${encodeURIComponent(query)}`),
  
  getAuditLog: (gcuid?: string) => 
    apiRequest<StateHistory[]>(`/gcuid/audit${gcuid ? `?gcuid=${encodeURIComponent(gcuid)}` : ''}`),

  getAuditForGcuid: (gcuid: string) =>
    apiRequest<GcuidAuditSummary>(`/gcuid/audit/${encodeURIComponent(gcuid)}`),
  
  approve: (gcuid: string, _approver: string, reason?: string) => 
    apiRequest<{ success: boolean; message: string }>(`/gcuid/approve/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  
  flagReview: (gcuid: string, reason?: string) =>
    apiRequest<{ success: boolean; message: string }>(`/gcuid/flag-review/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  suspend: (gcuid: string, _suspender: string, reason?: string) => 
    apiRequest<{ success: boolean; message: string }>(`/gcuid/suspend/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  
  retire: (gcuid: string, _retirer: string, reason?: string) => 
    apiRequest<{ success: boolean; message: string }>(`/gcuid/retire/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  clearSuspension: (gcuid: string, reason?: string) =>
    apiRequest<{ success: boolean; message: string }>(`/gcuid/clear-suspension/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  rehire: (gcuid: string, reason?: string) =>
    apiRequest<{ success: boolean; message: string }>(`/gcuid/rehire/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  archive: (gcuid: string, reason?: string) =>
    apiRequest<{ success: boolean; message: string }>(`/gcuid/archive/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  
  detectDuplicates: () => 
    apiRequest<DuplicateGroup[]>('/gcuid/detect-duplicates'),
  
  getStats: () => 
    apiRequest<AdminStats>('/gcuid/stats'),
  
  getHealth: () => 
    apiRequest<{ status: string; timestamp: string; checks: Record<string, boolean> }>('/gcuid/health'),
  
  // Identifier state — the GCUID token's own lifecycle
  getIdentifierState: (gcuid: string) =>
    apiRequest<{ gcuid: string; identifier_state: string; superseded_by: string | null; history: IdentifierStateHistory[] }>(`/gcuid/identifier-state/${encodeURIComponent(gcuid)}`),

  bindIdentifier: (gcuid: string, reason?: string) =>
    apiRequest<{ gcuid: string; from_state: string; to_state: string; transition: string }>(`/gcuid/identifier-state/${encodeURIComponent(gcuid)}/bind`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  nullifyIdentifier: (gcuid: string, reason?: string, transition: 'error' | 'catastrophic' = 'error') =>
    apiRequest<{ gcuid: string; from_state: string; to_state: string; transition: string }>(`/gcuid/identifier-state/${encodeURIComponent(gcuid)}/nullify`, {
      method: 'POST',
      body: JSON.stringify({ reason, transition }),
    }),

  supersedeIdentifier: (gcuid: string, superseded_by: string, reason?: string) =>
    apiRequest<{ gcuid: string; from_state: string; to_state: string; superseded_by: string }>(`/gcuid/identifier-state/${encodeURIComponent(gcuid)}/supersede`, {
      method: 'POST',
      body: JSON.stringify({ superseded_by, reason }),
    }),

  // Alias management
  getAliases: (gcuid: string) =>
    apiRequest<GCAlias[]>(`/gcuid/aliases/${encodeURIComponent(gcuid)}?includeDisabled=true`),

  generateAlias: (gcuid: string, context: string = 'A') =>
    apiRequest<GCAlias>(`/gcuid/aliases/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ context }),
    }),

  /**
   * Look up the email from the authoritative source for person.email (LDAP in
   * this codebase) and create an enabled `email` alias.  Idempotent: if an
   * email alias already exists, returns it (no duplicate).
   */
  deriveEmailAlias: (gcuid: string) =>
    apiRequest<{ id: number; gcuid: string; alias_type: string; alias_value: string; status: string; created_at: string; metadata?: any } & { deduped: boolean }>(
      `/gcuid/aliases/${encodeURIComponent(gcuid)}/derive-email`,
      { method: 'POST' }
    ),

  deleteAlias: (gcuid: string, id: number) =>
    apiRequest<GCAlias>(`/gcuid/aliases/${encodeURIComponent(gcuid)}/${id}/disable`, {
      method: 'PATCH',
      body: JSON.stringify({ reason: 'User removed alias' }),
    }),

  disableAlias: (gcuid: string, id: number, reason?: string) =>
    apiRequest<GCAlias>(`/gcuid/aliases/${encodeURIComponent(gcuid)}/${id}/disable`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),

  enableAlias: (gcuid: string, id: number, reason?: string) =>
    apiRequest<GCAlias>(`/gcuid/aliases/${encodeURIComponent(gcuid)}/${id}/enable`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),

  // Source Mappings - GCUID to authoritative source accounts
  listSourceMappings: () =>
    apiRequest<{
      mappings: Record<string, SourceMapping[]>;
      total_gcuids: number;
      total_mappings: number;
      gcuid_meta: Record<string, { display_name: string | null; email: string | null; aliases: string[]; source: string | null; identifier_state: string | null; superseded_by: string | null }>;
    }>('/gcuid/source-mappings'),
  
  getSourceMappings: (gcuid: string) => 
    apiRequest<{ gcuid: string; mappings: SourceMapping[]; source_count: number }>(`/gcuid/source-mappings/${encodeURIComponent(gcuid)}`),

  addSourceMapping: (gcuid: string, source_system: string, source_id: string, is_primary = false) =>
    apiRequest<SourceMapping>(`/gcuid/source-mappings/${encodeURIComponent(gcuid)}`, {
      method: 'POST',
      body: JSON.stringify({ source_system, source_id, is_primary }),
    }),

  // Source Systems Registry - authoritative sources and departments
  listSourceSystems: () =>
    apiRequest<SourceSystem[]>('/gcuid/source-systems'),

  createSourceSystem: (data: SourceSystemInput) =>
    apiRequest<SourceSystem>('/gcuid/source-systems', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateSourceSystem: (id: number, data: Partial<Omit<SourceSystemInput, 'system_id'>> & { is_active?: boolean }) =>
    apiRequest<SourceSystem>(`/gcuid/source-systems/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteSourceSystem: (id: number) =>
    apiRequest<{ deleted: number; system_id: string }>(`/gcuid/source-systems/${id}`, {
      method: 'DELETE',
    }),

  registerIdentity: (data: RegisterIdentityInput) =>
    apiRequest<Identity>('/gcuid/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// CAES Portal API - Attribute Exchange Service
export const caesApi = {
  getSchema: () => 
    apiRequest<{ attributes: AttributeSchema; totalAttributes: number; sources: string[] }>('/caes/schema'),
  
  // Attribute Mappings - how CAES standard attributes map to source-specific fields
  getAttributeMappings: () => 
    apiRequest<{ 
      mappings: AttributeMapping[]; 
      grouped_by_attribute: Record<string, AttributeMapping[]>;
      grouped_by_source: Record<string, AttributeMapping[]>;
      total_mappings: number;
      source_systems: string[];
    }>('/caes/attribute-mappings'),
  
  resolveAttributes: (gcuid: string, attributes: string[]) => 
    apiRequest<AttributeResolution>('/caes/resolve', {
      method: 'POST',
      body: JSON.stringify({ gcuid, attributes }),
    }),

  createMapping: (mapping: AttributeMappingInput) =>
    apiRequest<AttributeMapping>('/caes/attribute-mappings', {
      method: 'POST',
      body: JSON.stringify(mapping),
    }),

  updateMapping: (id: number, mapping: Partial<AttributeMappingInput>) =>
    apiRequest<AttributeMapping>(`/caes/attribute-mappings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(mapping),
    }),

  deleteMapping: (id: number) =>
    apiRequest<{ deleted: number }>(`/caes/attribute-mappings/${id}`, {
      method: 'DELETE',
    }),

  setMappingAuthoritative: (id: number) =>
    apiRequest<AttributeMapping>(`/caes/attribute-mappings/${id}/authoritative`, {
      method: 'PUT',
    }),
  
  getStats: () => 
    apiRequest<CAESStats>('/caes/stats'),
  
  getHealth: () => 
    apiRequest<{
      status: 'operational' | 'degraded' | 'error';
      timestamp: string;
      services: {
        registry: { status: 'connected' | 'disconnected'; identity_count: number };
      };
      connectors: Array<{
        connector_id: string;
        system_id: string;
        display_name: string;
        enabled: boolean;
        status: 'connected' | 'degraded' | 'unavailable' | 'disabled';
      }>;
      attribute_schema_version: string;
      attribute_mappings_loaded: number;
    }>('/caes/health'),

  getMatchConfigs: () =>
    apiRequest<{ configs: SourceMatchConfig[] }>('/caes/match-configs'),

  updateMatchConfig: (
    sourceSystem: string,
    config: { sourceTable: string; keyField: string; strategies: MatchStrategy[] }
  ) =>
    apiRequest<{ sourceSystem: string; sourceTable: string; keyField: string; strategies: MatchStrategy[] }>(
      `/caes/match-configs/${encodeURIComponent(sourceSystem)}`,
      { method: 'PUT', body: JSON.stringify(config) }
    ),

  addMatchConfig: (config: {
    sourceSystem: string;
    connectorId?: string;
    sourceTable: string;
    keyField: string;
    strategies: MatchStrategy[];
  }) =>
    apiRequest<{ sourceSystem: string }>('/caes/match-configs', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  matchIdentity: (attributes: Record<string, string>, sources?: string[]) =>
    apiRequest<IdentityMatchResult>('/caes/match', {
      method: 'POST',
      body: JSON.stringify({ attributes, sources }),
    }),

  matchAndLink: (gcuid: string, attributes: Record<string, string>, requestedBy?: string, sources?: string[]) =>
    apiRequest<MatchAndLinkResult>('/caes/match-and-link', {
      method: 'POST',
      body: JSON.stringify({ gcuid, attributes, requested_by: requestedBy, sources }),
    }),

  getSelfServiceAttributes: () =>
    apiRequest<SelfServiceAttribute[]>('/caes/self-service-attributes'),
};

// Connectors API — per-connector JSON config files
export interface ConnectorPingResult {
  reachable: boolean;
  latency_ms: number | null;
  status_code: number | null;
  checked_at: string;
  base_url: string;
}

export interface ConnectorHealthResult {
  reachable: boolean;
  status_code: number | null;
  latency_ms: number | null;
  checked_at: string;
  base_url: string;
  health: Record<string, unknown> | null;
  error?: string;
}

export const connectorsApi = {
  list: () =>
    apiRequest<ConnectorConfig[]>('/connectors'),

  get: (systemId: string) =>
    apiRequest<ConnectorConfig>(`/connectors/${encodeURIComponent(systemId)}`),

  update: (systemId: string, patch: ConnectorPatch) =>
    apiRequest<ConnectorConfig>(`/connectors/${encodeURIComponent(systemId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  sync: (systemId: string) =>
    apiRequest<{ systemId: string; synced: number; since: string | null; syncedAt: string }>(
      `/connectors/${encodeURIComponent(systemId)}/sync`,
      { method: 'POST', body: JSON.stringify({}) }
    ),

  ping: (connectorId: string) =>
    apiRequest<ConnectorPingResult>(`/connectors/${encodeURIComponent(connectorId)}/ping`),

  health: (connectorId: string) =>
    apiRequest<ConnectorHealthResult>(`/connectors/${encodeURIComponent(connectorId)}/health`),
};

// Source Systems (registry enriched with connector runtime state)
export interface SourceSystem {
  id: number;
  system_id: string;
  display_name: string;
  system_type: 'authoritative_source' | 'department';
  db_path: string | null;   // retained for backward compat; prefer api_url
  api_port: number | null;   // retained for backward compat; prefer api_url
  api_url: string | null;
  /** True when an api_secret has been configured (the raw secret is never returned). */
  api_secret_configured: boolean;
  description: string | null;
  is_active: boolean;
  connector_id: string | null;
  /** false when the connector JSON has enabled=false */
  connector_enabled: boolean;
  access_mode: 'dynamic-pull' | 'push-cache' | 'scheduled-pull';
  cache_ttl_seconds: number;
  allow_inbound: boolean;
  last_sync_at: string | null;
  cache_stale_policy: string;
  /** Whether this system sends/receives the canonical GCUID URN or an alias */
  identifier_mode: 'gcuid' | 'alias';
  identity_mappings: number;
  cache_record_count: number;
  created_at: string;
  updated_at: string;
}

export const sourceSystemsApi = {
  list: () =>
    apiRequest<SourceSystem[]>('/gcuid/source-systems'),
};

// ─── Log Levels API ───────────────────────────────────────────────────────────

export const LOG_LEVEL_OPTIONS = [
  { value: 'debug',     label: 'Debug',     description: 'All messages including verbose diagnostics' },
  { value: 'info',      label: 'Info',      description: 'Normal operational messages' },
  { value: 'notice',    label: 'Notice',    description: 'Significant but normal conditions' },
  { value: 'warning',   label: 'Warning',   description: 'Conditions that may require attention' },
  { value: 'error',     label: 'Error',     description: 'Error conditions that must be addressed' },
  { value: 'critical',  label: 'Critical',  description: 'Critical conditions requiring immediate action' },
  { value: 'alarm',     label: 'Alarm',     description: 'Alert — action must be taken immediately (always logged)' },
  { value: 'emergency', label: 'Emergency', description: 'System is unusable (always logged)' },
] as const;

export type LogLevelValue = typeof LOG_LEVEL_OPTIONS[number]['value'];

export const SYSTEM_LOG_LEVEL_LABELS: Record<string, string> = {
  'gcuid-registry': 'GCUID Registry',
  'caes':           'CAES',
  'hr':             'HR System',
  'ldap':           'LDAP / AD',
  'engineering':    'Engineering',
  'finance':        'Finance',
  'system':         'System',
};

export type LogLevelsConfig = Record<string, LogLevelValue>;

export const logLevelsApi = {
  get: () =>
    apiRequest<LogLevelsConfig>('/log-levels'),

  patch: (patch: Partial<LogLevelsConfig>) =>
    apiRequest<LogLevelsConfig>('/log-levels', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};

// ─── Logs API ─────────────────────────────────────────────────────────────────

export interface LogRow {
  log_id:          string;
  timestamp:       string;
  created_at:      string;
  level:           string;
  level_code:      number;
  system:          string;
  component:       string;
  component_type:  string;
  event_type:      string;
  event_code:      string;
  message:         string;
  session_id:      string | null;
  transaction_id:  string | null;
  correlation_id:  string | null;
  request_id:      string | null;
  actor_id:        string | null;
  actor_type:      string | null;
  target_id:       string | null;
  target_type:     string | null;
  outcome:         string | null;
  duration_ms:     number | null;
  ip_address:      string | null;
  error_code:      string | null;
}

/** Full record including system-specific columns, returned by GET /api/logs/:log_id */
export type LogRowDetail = LogRow & Record<string, unknown>;

export interface LogsQueryParams {
  system?:     string;
  level?:      string;
  component?:  string;
  event_type?: string;
  search?:     string;
  from?:       string;
  to?:         string;
  limit?:      number;
  offset?:     number;
  sort_by?:    string;
  sort_dir?:   'asc' | 'desc';
}

export interface LogsPage {
  rows:   LogRow[];
  total:  number;
  limit:  number;
  offset: number;
}

export interface LogsStats {
  total:    number;
  bySystem: Array<{ system: string; count: number }>;
  byLevel:  Array<{ level: string; level_code: number; count: number }>;
}

export const logsApi = {
  query: (params: LogsQueryParams = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
    }
    const query = qs.toString();
    return apiRequest<LogsPage>(`/logs${query ? `?${query}` : ''}`);
  },

  stats: () =>
    apiRequest<LogsStats>('/logs/stats'),

  get: (log_id: string) =>
    apiRequest<LogRowDetail>(`/logs/${encodeURIComponent(log_id)}`),
};

// ─── System Dashboard API ─────────────────────────────────────────────────────

export interface DbFileInfo {
  label:      string;
  path:       string;
  bytes:      number;
  file_bytes: number;
  formatted:  string;
  exists?:    boolean;
}

export interface SystemDashboard {
  server: {
    uptime_seconds: number;
    uptime_human:   string;
    node_version:   string;
    pid:            number;
    timestamp:      string;
  };
  identities: {
    total:    number;
    by_state: Array<{ state: string; count: number }>;
  };
  source_systems: Array<{
    system_id:         string;
    display_name:      string;
    system_type:       string;
    access_mode:       string;
    last_sync_at:      string | null;
    cache_ttl_seconds: number | null;
  }>;
  record_counts: {
    hr_employees:    number;
    ldap_users:      number;
    connector_records: Record<string, number>;
    cache_entries:   Record<string, number>;
    attribute_mappings_by_source: Array<{ source_system: string; mapping_count: number }>;
  };
  databases: {
    files: {
      registry:   DbFileInfo;
      hr:         DbFileInfo;
      ldap:       DbFileInfo;
      logs:       DbFileInfo & { exists: boolean };
      connectors: DbFileInfo[];
    };
    total_bytes:     number;
    total_formatted: string;
  };
  logs: {
    total:        number;
    by_system:    Record<string, number>;
    db_bytes:     number;
    db_formatted: string;
    db_exists:    boolean;
  };
}

export interface SystemVersions {
  api: { version: string; release_date: string; base_path: string };
  urn: { scheme: string; current_version: string; format: string; example: string; entity_types: string[]; core_id_types: string[]; encodings: string[] };
  schema: {
    registry_db: { version: string; tables: string[]; identity_count: number };
    caes: { version: string; schema_name: string; canonical_attributes: string[] };
  };
  identity_states: { lifecycle: string[]; identifier: string[] };
  features: Record<string, boolean>;
  supported_api_sections: string[];
}

export const ACCESS_MODE_LABELS: Record<string, string> = {
  'dynamic-pull':   'Dynamic Pull',
  'scheduled-pull': 'Scheduled Pull',
  'push-cache':     'Push to Cache',
};

/** Unified connector health response — covers all three access modes. */
export interface ConnectorHealthData {
  system_id: string;
  /** Connector config ID — matches the scope key used in UX config (e.g. 'conn-hr'). */
  connector_id?: string;
  display_name: string;
  access_mode: 'dynamic-pull' | 'scheduled-pull' | 'push-cache';
  is_active: boolean;
  status: 'operational' | 'degraded' | 'disabled' | 'unavailable' | 'unregistered';
  db_status: string;
  db_message: string;
  local_record_count: number;
  registry_gcuid_count: number;
  // dynamic-pull only
  connector_url?: string;
  connector_port?: number | null;
  endpoint_status?: string | null;
  endpoint_latency_ms?: number | null;
  // scheduled-pull + push-cache
  last_sync_at?: string | null;
  cache_ttl_seconds?: number | null;
  cache_stale_policy?: string | null;
  pull_schedule?: string | null;
  allow_inbound?: boolean;
  error?: string;
}

// ─── Database Portal types ────────────────────────────────────────────────────

export interface DbPortalTable {
  name: string;
  row_count: number;
}

export interface DbPortalDatabase {
  id: string;
  label: string;
  path: string;
  group: 'core' | 'connector';
  color: string;
  exists: boolean;
  size_formatted: string;
  size_bytes: number;
  tables: DbPortalTable[];
}

export interface DbPortalColumn {
  name: string;
  type: string;
  pk: boolean;
}

export interface DbPortalTableData {
  columns: DbPortalColumn[];
  rows: Record<string, any>[];
  total: number;
  limit: number;
  offset: number;
  query: string;
}

export const systemApi = {
  getDashboard: () =>
    apiRequest<SystemDashboard>('/system/dashboard'),

  clearLogs: (system: string) =>
    apiRequest<{ cleared: string; deleted: number }>(`/system/logs/${encodeURIComponent(system)}`, {
      method: 'DELETE',
    }),

  getHealth: () =>
    apiRequest<{
      overall_status: string;
      sla_compliant: boolean;
      checked_at: string;
      uptime_seconds: number;
      uptime_formatted: string;
      sla_targets: { availability_pct: number; response_time_ms: number };
      subsystems: Array<{ name: string; status: string; response_time_ms: number; sla_target_ms: number; sla_compliant: boolean; detail?: string }>;
      summary: { passed: number; degraded: number; failed: number; total: number };
    }>('/system/health'),

  getVersions: () =>
    apiRequest<SystemVersions>('/system/versions'),

  getStats: () =>
    apiRequest<{ authoritative_sources: number; departments: number }>('/system/stats'),

  getPolicy: () =>
    apiRequest<Record<string, unknown>>('/system/policy'),
};

// ─── Databases Portal API ─────────────────────────────────────────────────────

// ─── Self-Service Registration ────────────────────────────────────────────────

export interface RegistrationIdentityProof {
  /** Identifier value in the source system (e.g. employee id, badge number) */
  id: string;
  /** Which source system this identifier belongs to (e.g. 'hr', 'engineering', 'finance') */
  source: string;
}

export interface RegistrationFormData {
  first_name: string;
  last_name: string;
  email: string;
  /**
   * Optional: one or more identifiers the registrant already has in existing
   * departmental / source systems. A user may list any number of these,
   * up to all of the identifiers they are known by across systems.
   */
  identity_proofs?: RegistrationIdentityProof[];
  /** @deprecated Use identity_proofs instead. Kept for backwards compatibility. */
  dept_id?: string;
  /** @deprecated Use identity_proofs instead. Kept for backwards compatibility. */
  dept_source?: string;
}

export type RegistrationOutcome =
  | 'gcuid_exists'
  | 'high_confidence_match'
  | 'low_confidence_match'
  | 'no_match'
  | 'review_required';

export interface RegistrationResult {
  outcome: RegistrationOutcome;
  gcuid?: string;
  identity_state?: string;
  identifier_state?: string;
  matches?: Array<{
    sourceSystem: string;
    sourceId: string;
    confidence: number;
    strategyDescription: string;
    record: Record<string, any>;
  }>;
  /**
   * For outcome='gcuid_exists': how the existing GCUID was located.
   * 'alias' = a confirmed-source email alias; 'claim' = an unverified
   * self-registration claim still pending review. The wording of `message`
   * reflects which path matched.
   */
  match_source?: 'alias' | 'claim';
  message: string;
}

export const registrationApi = {
  /** Check + match + optionally register a new person identity */
  register: (form: RegistrationFormData) =>
    apiRequest<RegistrationResult>('/user/self-register', {
      method: 'POST',
      body: JSON.stringify(form),
    }),
};

// ─── GCUID Request API ────────────────────────────────────────────────────────

export interface GcuidRequestPreviewResult {
  existing_gcuid_matches: { gcuid: string; state: string; match_basis: string; confidence: number }[];
  caes_source_matches:    { sourceSystem: string; sourceId: string; confidence: number; record: Record<string, any> }[];
  recommendation:         'link_existing_strong' | 'link_existing_weak' | 'create_strong' | 'create_weak' | 'create_no_match';
  thresholds:             { strong: number; weak: number };
}

export interface GcuidRequestSubmitResult {
  gcuid:        string;
  action_taken: string;
  needs_review: boolean;
  write_back:   string;
}

export interface LinkageCandidate {
  source_system: string;
  source_id:     string;
  first_name:    string;
  last_name:     string;
  email:         string;
  match_score:   number;
  match_reasons: string[];
}

export interface ScanLinkagesResult {
  gcuid:            string;
  attributes_used:  { first_name: string | null; last_name: string | null; email: string | null };
  candidates:       LinkageCandidate[];
}

export const gcuidRequestApi = {
  preview: (body: { source_system: string; source_id: string; attributes: Record<string, string> }) =>
    apiRequest<GcuidRequestPreviewResult>('/gcuid-request/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  submit: (body: {
    source_system:  string;
    source_id:      string;
    attributes:     Record<string, string>;
    action:         'link_existing' | 'create_new';
    target_gcuid?:  string;
    reason?:        string;
  }) =>
    apiRequest<GcuidRequestSubmitResult>('/gcuid-request/submit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  scanLinkages: (gcuid: string) =>
    apiRequest<ScanLinkagesResult>('/gcuid-request/scan-linkages', {
      method: 'POST',
      body: JSON.stringify({ gcuid }),
    }),
};

export const databasesApi = {
  listDatabases: () =>
    apiRequest<DbPortalDatabase[]>('/system/databases'),

  queryTable: (dbId: string, tableName: string, params: { q?: string; limit?: number; offset?: number; sort_by?: string; sort_dir?: 'asc' | 'desc' } = {}) => {
    const qs = new URLSearchParams();
    if (params.q)        qs.set('q',        params.q);
    if (params.limit)    qs.set('limit',    String(params.limit));
    if (params.offset)   qs.set('offset',   String(params.offset));
    if (params.sort_by)  qs.set('sort_by',  params.sort_by);
    if (params.sort_dir) qs.set('sort_dir', params.sort_dir);
    const query = qs.toString();
    return apiRequest<DbPortalTableData>(
      `/system/databases/${encodeURIComponent(dbId)}/tables/${encodeURIComponent(tableName)}${query ? `?${query}` : ''}`
    );
  },

  deleteRow: (dbId: string, tableName: string, pkValue: string) =>
    apiRequest<{ deleted: number }>(
      `/system/databases/${encodeURIComponent(dbId)}/tables/${encodeURIComponent(tableName)}/rows/${encodeURIComponent(pkValue)}`,
      { method: 'DELETE' }
    ),
};

// ─── Tools API types ──────────────────────────────────────────────────────────

export interface ToolsGcuidSearchResult {
  gcuid: string;
  state: string;
  entity_type: string;
  entity_id: string;
  namespace: string;
  created_at: string;
  updated_at: string;
  alias_value: string | null;
  alias_type: string | null;
}

export interface ToolsGcuidSearchResponse {
  results: ToolsGcuidSearchResult[];
  total: number;
  limit: number;
}

export interface ToolsDeleteSummaryEntry {
  registry: Record<string, number>;
  connectors: Record<string, number>;
  not_found: boolean;
}

export interface ToolsDeleteResponse {
  dry_run: boolean;
  reason?: string;
  deleted: number;
  summary: Record<string, ToolsDeleteSummaryEntry>;
}

// ─── Tools API ────────────────────────────────────────────────────────────────

export const toolsApi = {
  searchGcuids: (params: {
    q?: string;
    entity_type?: string;
    state?: string;
    namespace?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.q)           qs.set('q',           params.q);
    if (params.entity_type) qs.set('entity_type', params.entity_type);
    if (params.state)       qs.set('state',       params.state);
    if (params.namespace)   qs.set('namespace',   params.namespace);
    if (params.limit)       qs.set('limit',       String(params.limit));
    return apiRequest<ToolsGcuidSearchResponse>(
      `/tools/gcuid/search${qs.toString() ? `?${qs}` : ''}`
    );
  },

  deleteGcuids: (gcuids: string[], options: { dry_run?: boolean; reason?: string } = {}) =>
    apiRequest<ToolsDeleteResponse>('/tools/gcuid/delete', {
      method: 'POST',
      body: JSON.stringify({ gcuids, ...options }),
    }),
};

// ─── UX Config API ────────────────────────────────────────────────────────────

/** All configurable colour tokens for one light-or-dark mode variant. */
export interface ThemeTokens {
  bgPage: string;
  bgSurface: string;
  bgSurfaceAlt: string;
  bgHover: string;
  bgHighlight: string;
  borderDefault: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textLink: string;
  accentPrimary: string;
  accentOnPrimary: string;
  accentSecondary: string;
  btnPrimaryBg: string;
  btnPrimaryText: string;
  btnSecondaryBg: string;
  btnSecondaryText: string;
  statusSuccess: string;
  statusWarning: string;
  statusError: string;
  statusInfo: string;
  navDotColor: string;
  navLabelColor: string;
  tableHeaderBg: string;
  inputBg: string;
  codeBg: string;
  badgeNeutralBg: string;
  badgeNeutralText: string;
  toggleThumb: string;
  accentSubtleBg:      string;
  accentSubtleBorder:  string;
  accentMutedBg:       string;
  statusSuccessBg:     string;
  statusSuccessBorder: string;
  statusWarningBg:     string;
  statusWarningBorder: string;
  statusErrorBg:       string;
  statusErrorBorder:   string;
  statusInfoBg:        string;
  statusInfoBorder:    string;
  navAuthSourcePanelBg: string;
  navAuthSourceAccent:  string;
  navDeptPanelBg:       string;
  navDeptAccent:        string;
  navSystemPanelBg:     string;
  navSystemAccent:      string;
  bgElevation1:         string;
  bgElevation2:         string;
}

/** A paired light + dark set of tokens. */
export interface ThemePair {
  light: ThemeTokens;
  dark: ThemeTokens;
}

/** Per-connector UX override scope (authoritative source or department). */
export interface UXScopeConfig {
  id: string;
  label: string;
  type: 'global' | 'source' | 'department' | 'portal';
  /** When true, this scope overrides the global mid-section tokens. */
  enabled: boolean;
  theme: ThemePair;
}

/** Full UX configuration: global defaults + per-scope overrides. */
export interface UXConfig {
  /** Global application-wide tokens — apply to headers, footers, and mid-section. */
  global: ThemePair;
  /** Per-connector overrides; keyed by connector systemId. */
  scopes: Record<string, UXScopeConfig>;
}

/** A named, reusable theme stored in the library. */
export interface ThemeLibraryEntry {
  id: string;
  name: string;
  createdAt: string;
  theme: ThemePair;
}

export const uxConfigApi = {
  get: () =>
    apiRequest<UXConfig>('/ux-config'),

  put: (config: UXConfig) =>
    apiRequest<UXConfig>('/ux-config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  patchScope: (scopeId: string, patch: Partial<UXScopeConfig> | { light?: Partial<ThemeTokens>; dark?: Partial<ThemeTokens> }) =>
    apiRequest<UXConfig>(`/ux-config/${encodeURIComponent(scopeId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};

export const themeLibraryApi = {
  list: () =>
    apiRequest<ThemeLibraryEntry[]>('/ux-config/theme-library'),

  save: (name: string, theme: ThemePair) =>
    apiRequest<ThemeLibraryEntry>('/ux-config/theme-library', {
      method: 'POST',
      body: JSON.stringify({ name, theme }),
    }),

  rename: (id: string, name: string) =>
    apiRequest<ThemeLibraryEntry>(`/ux-config/theme-library/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  update: (id: string, theme: ThemePair) =>
    apiRequest<ThemeLibraryEntry>(`/ux-config/theme-library/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ theme }),
    }),

  delete: (id: string) =>
    apiRequest<void>(`/ux-config/theme-library/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

// ─── App Access Policies ──────────────────────────────────────────────────────

export interface AppPolicy {
  app_id:           string;
  source_system:    'hr' | 'ldap' | 'engineering' | 'finance';
  credential_field: string;
  credential_label: string;
  access_type:      'account_exists' | 'attribute_match';
  attribute_key:    string | null;
  attribute_value:  string | null;
  created_at:       string;
  updated_at:       string;
}

export interface PolicyValidateResult {
  appId:      string;
  credential: string;
  found:      boolean;
  granted:    boolean;
  reason:     string;
  policy:     { source_system: string; credential_field: string; access_type: string };
  record?:    Record<string, unknown>;
  gcuid:      string | null;
}

export interface PolicyValidateGcuidResult {
  appId:        string;
  gcuid_or_alias: string;
  found_gcuid:  boolean;
  found_account: boolean;
  granted:      boolean;
  reason:       string;
  record?:      Record<string, unknown>;
  gcuid:        string | null;
  /** End-of-chain GCUID after following the supersession chain (may equal `gcuid` if no chain). */
  effective_gcuid?:    string | null;
  /** Identity state of the input GCUID ('active' | 'provisional' | 'suspended' | etc.). */
  identity_state?:     string | null;
  /** Identifier state of the effective GCUID ('issued' | 'superseded' | 'nullified' | etc.). */
  identifier_state?:   string | null;
  /** Ordered list of GCUIDs traversed from input to effective — the supersession chain. */
  supersession_chain?: string[];
}

export const policiesApi = {
  list: () =>
    apiRequest<{ policies: AppPolicy[] }>('/policies'),

  get: (appId: string) =>
    apiRequest<{ policy: AppPolicy }>(`/policies/${encodeURIComponent(appId)}`),

  save: (appId: string, policy: Omit<AppPolicy, 'app_id' | 'created_at' | 'updated_at'>) =>
    apiRequest<{ policy: AppPolicy }>(`/policies/${encodeURIComponent(appId)}`, {
      method: 'PUT',
      body: JSON.stringify(policy),
    }),

  reset: (appId: string) =>
    apiRequest<{ policy: AppPolicy; reset: boolean }>(`/policies/${encodeURIComponent(appId)}`, {
      method: 'DELETE',
    }),

  validate: (appId: string, credential: string) =>
    apiRequest<PolicyValidateResult>('/policies/validate', {
      method: 'POST',
      body: JSON.stringify({ appId, credential }),
    }),

  validateGcuid: (appId: string, gcuidOrAlias: string) =>
    apiRequest<PolicyValidateGcuidResult>('/policies/validate-gcuid', {
      method: 'POST',
      body: JSON.stringify({ appId, gcuid_or_alias: gcuidOrAlias }),
    }),
};
