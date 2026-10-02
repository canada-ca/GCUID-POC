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
import { useState, useCallback } from 'react';
import { UXScopeWrapper } from '../context/UXThemeContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ParamDef {
  name: string;
  default?: string;
  hint?: string;
  required?: boolean;
}

interface HeaderDef {
  name: string;
  default?: string;
  hint?: string;
  required?: boolean;
}

interface EndpointDef {
  id: string;
  method: HttpMethod;
  path: string;
  pathParams?: ParamDef[];
  queryParams?: ParamDef[];
  headers?: HeaderDef[];
  defaultBody?: string;
  desc: string;
  warning?: string;
}

interface GroupDef {
  id: string;
  label: string;
  color: string;
  /** Port of the backend connector server these proxied routes forward to, if applicable. */
  connectorPort?: number;
  endpoints: EndpointDef[];
}

interface ApiResult {
  status: number;
  statusText: string;
  latencyMs: number;
  rawBody: string;
}

interface EndpointState {
  expanded: boolean;
  pathValues: Record<string, string>;
  queryValues: Record<string, string>;
  headerValues: Record<string, string>;
  body: string;
  loading: boolean;
  result: ApiResult | null;
  execError: string | null;
}

// ─── Endpoint Data ────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const GROUPS: GroupDef[] = [
  // ── GCUID Registry ──────────────────────────────────────────────────────────
  {
    id: 'gcuid',
    label: 'GCUID Registry',
    color: 'amber',
    endpoints: [
      {
        id: 'gcuid-register',
        method: 'POST',
        path: '/api/gcuid/register',
        desc: 'Mint a new GCUID and register an identity',
        defaultBody: JSON.stringify({
          entity_type: 'person',
          entity_id: 'EMP-0001',
          namespace: 'staging',
          metadata: { department: 'Engineering', title: 'Software Engineer' },
          source_links: [{ source_system: 'hr', source_id: 'EMP-0001', is_primary: true }],
        }, null, 2),
      },
      {
        id: 'gcuid-list',
        method: 'GET',
        path: '/api/gcuid/list',
        queryParams: [
          { name: 'state', default: '', hint: 'provisional | active | under_review | suspended | retired | archived' },
          { name: 'limit', default: '100' },
        ],
        desc: 'List all registered identities with optional state filter',
      },
      {
        id: 'gcuid-view',
        method: 'GET',
        path: '/api/gcuid/view/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN (urn:gcuid:…) or alias value' }],
        queryParams: [{ name: 'withHistory', default: 'true' }],
        desc: 'Detailed identity view with optional state history',
      },
      {
        id: 'gcuid-subject',
        method: 'GET',
        path: '/api/gcuid/subject/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN (urn:gcuid:…) or alias value' }],
        desc: 'Unified subject record: identity + both state dimensions + aliases + source mappings + all CAES-resolved attributes in one response',
      },
      {
        id: 'gcuid-attributes-patch',
        method: 'PATCH',
        path: '/api/gcuid/attributes/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({
          attributes: {
            'person.employment.department': 'Engineering',
            'person.employment.status': 'Active',
          },
          source_system: 'hr',
          reason: 'HR system sync',
        }, null, 2),
        desc: 'Receive standardized attribute updates from an authoritative source (e.g. HR, Procurement) and synchronize the canonical identity record',
      },
      {
        id: 'gcuid-search',
        method: 'GET',
        path: '/api/gcuid/search',
        queryParams: [
          { name: 'q', default: '', hint: 'Search term across gcuid, entity_id, metadata, aliases' },
          { name: 'limit', default: '10' },
        ],
        desc: 'Full-text search across all identity fields',
      },
      {
        id: 'gcuid-audit',
        method: 'GET',
        path: '/api/gcuid/audit/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        desc: 'Complete audit trail: identity lifecycle events + identifier state transitions merged chronologically (mint, bind, suspend, retire, supersede, merge, nullify)',
      },
      {
        id: 'gcuid-stats',
        method: 'GET',
        path: '/api/gcuid/stats',
        desc: 'Registry statistics: by state, by type, 24 h activity',
      },
      {
        id: 'gcuid-health',
        method: 'GET',
        path: '/api/gcuid/health',
        desc: 'Registry health: DB access, GCUID format checks, orphaned history rows',
      },
      {
        id: 'gcuid-detect-duplicates',
        method: 'GET',
        path: '/api/gcuid/detect-duplicates',
        queryParams: [{ name: 'threshold', default: '0.8', hint: 'Similarity threshold 0–1' }],
        desc: 'Find potential duplicate entity_id registrations',
      },
      // State transitions
      {
        id: 'gcuid-approve',
        method: 'POST',
        path: '/api/gcuid/approve/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ reason: 'Identity verified by operator' }, null, 2),
        desc: 'Approve identity: provisional / under_review → active',
      },
      {
        id: 'gcuid-flag-review',
        method: 'POST',
        path: '/api/gcuid/flag-review/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ reason: 'Flagged for manual review' }, null, 2),
        desc: 'Flag for review: provisional / active → under_review',
      },
      {
        id: 'gcuid-clear-suspension',
        method: 'POST',
        path: '/api/gcuid/clear-suspension/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ reason: 'Suspension resolved' }, null, 2),
        desc: 'Clear suspension: suspended → active',
      },
      {
        id: 'gcuid-suspend',
        method: 'POST',
        path: '/api/gcuid/suspend/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ reason: 'Security incident investigation' }, null, 2),
        desc: 'Suspend identity: active / under_review → suspended',
      },
      {
        id: 'gcuid-retire',
        method: 'POST',
        path: '/api/gcuid/retire/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ reason: 'Employee offboarding' }, null, 2),
        desc: 'Retire identity: active / suspended → retired (also tombstones the identifier — permanent, never reassigned)',
      },
      {
        id: 'gcuid-merge',
        method: 'POST',
        path: '/api/gcuid/merge',
        defaultBody: JSON.stringify({
          surviving_gcuid: '',
          merged_gcuids: [''],
          reason: 'Duplicate identity adjudication',
          changed_by: 'admin',
        }, null, 2),
        desc: 'Merge duplicate records into one canonical identity: transfers source_mappings, retires merged identities, sets their identifiers to superseded. surviving_gcuid and each entry in merged_gcuids accept a GCUID URN or alias value (alias resolution respects feature flags).',
      },
      {
        id: 'gcuid-rehire',
        method: 'POST',
        path: '/api/gcuid/rehire/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ reason: 'Re-employment' }, null, 2),
        desc: 'Rehire: retired → under_review',
      },
      {
        id: 'gcuid-archive',
        method: 'POST',
        path: '/api/gcuid/archive/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ reason: 'Long-term archival' }, null, 2),
        desc: 'Archive identity: retired → archived',
      },
      // Source mappings
      {
        id: 'gcuid-source-mappings-all',
        method: 'GET',
        path: '/api/gcuid/source-mappings',
        desc: 'All source_mappings grouped by GCUID',
      },
      {
        id: 'gcuid-source-mappings-one',
        method: 'GET',
        path: '/api/gcuid/source-mappings/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        desc: 'Source mappings for a specific GCUID (all active authoritative-source account links)',
      },
      {
        id: 'gcuid-source-mappings-add',
        method: 'POST',
        path: '/api/gcuid/source-mappings/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ source_system: 'hr', source_id: 'EMP-99999', is_primary: false }, null, 2),
        desc: 'Add a new authoritative-source mapping to an existing identity',
      },
      {
        id: 'gcuid-source-mappings-delete',
        method: 'DELETE',
        path: '/api/gcuid/source-mappings/:gcuid/:id',
        pathParams: [
          { name: 'gcuid', hint: 'GCUID URN or alias value' },
          { name: 'id', default: '1', hint: 'source_mappings row ID' },
        ],
        defaultBody: JSON.stringify({ reason: 'Account decommissioned' }, null, 2),
        desc: 'Revoke a source mapping — writes audit record to state_history before removal',
      },
      // Identifier (token) state
      {
        id: 'gcuid-id-state-get',
        method: 'GET',
        path: '/api/gcuid/identifier-state/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        desc: 'Current identifier token state + history (reserved → issued → superseded / nullified)',
      },
      {
        id: 'gcuid-id-state-bind',
        method: 'POST',
        path: '/api/gcuid/identifier-state/:gcuid/bind',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ reason: 'Binding after entity verification' }, null, 2),
        desc: 'Bind identifier token: reserved → issued',
      },
      {
        id: 'gcuid-id-state-nullify',
        method: 'POST',
        path: '/api/gcuid/identifier-state/:gcuid/nullify',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ reason: 'Invalid registration', transition: 'error' }, null, 2),
        desc: 'Nullify identifier: reserved / issued → nullified  (transition: "error" | "catastrophic")',
      },
      {
        id: 'gcuid-id-state-supersede',
        method: 'POST',
        path: '/api/gcuid/identifier-state/:gcuid/supersede',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ superseded_by: '', reason: 'Identity migration' }, null, 2),
        desc: 'Supersede identifier: issued → superseded  (provide superseded_by GCUID URN or alias value in the body)',
      },
      // Source systems registry
      {
        id: 'gcuid-source-systems-list',
        method: 'GET',
        path: '/api/gcuid/source-systems',
        desc: 'List all source systems with live mapping/cache stats',
      },
      {
        id: 'gcuid-source-systems-create',
        method: 'POST',
        path: '/api/gcuid/source-systems',
        defaultBody: JSON.stringify({
          system_id: 'new-system',
          display_name: 'New System',
          system_type: 'department',
          api_port: 8105,
          description: 'New data source',
          allow_inbound: true,
          cache_ttl_seconds: 300,
          identifier_mode: 'gcuid',
        }, null, 2),
        desc: 'Register a new source system. identifier_mode: "gcuid" (canonical URN) or "alias" (resolve to/from alias on exchange)',
        warning: 'Set identifier_mode to "alias" only when aliases are enabled in Options → Feature Flags and the system cannot store GCUID URNs directly.',
      },
      {
        id: 'gcuid-source-systems-update',
        method: 'PUT',
        path: '/api/gcuid/source-systems/:id',
        pathParams: [{ name: 'id', default: 'conn-hr', hint: 'Numeric row ID or system_id slug' }],
        defaultBody: JSON.stringify({ display_name: 'HR Management System (Updated)', identifier_mode: 'gcuid' }, null, 2),
        desc: 'Update source system configuration. identifier_mode: "gcuid" | "alias" — controls whether this system uses canonical GCUID URNs or alias values when exchanging identifiers with the platform.',
      },
      {
        id: 'gcuid-source-systems-delete',
        method: 'DELETE',
        path: '/api/gcuid/source-systems/:id',
        pathParams: [{ name: 'id', default: 'conn-hr' }],
        desc: 'Remove source system (blocked if active mappings exist)',
      },
      // Aliases (GC-style deterministic)
      {
        id: 'gcuid-aliases-list',
        method: 'GET',
        path: '/api/gcuid/aliases/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        queryParams: [{ name: 'includeDisabled', default: 'true', hint: 'true = include disabled aliases in results' }],
        desc: 'List GC-style generated aliases for a GCUID — includes disabled aliases when includeDisabled=true',
      },
      {
        id: 'gcuid-aliases-generate',
        method: 'POST',
        path: '/api/gcuid/aliases/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ context: 'A' }, null, 2),
        desc: 'Generate deterministic GC-style alias  (context: A = anonymous, S = system, etc.)',
      },
      {
        id: 'gcuid-aliases-delete',
        method: 'DELETE',
        path: '/api/gcuid/aliases/:gcuid/:id',
        pathParams: [
          { name: 'gcuid', hint: 'GCUID URN or alias value' },
          { name: 'id', default: '1', hint: 'Alias row ID' },
        ],
        defaultBody: JSON.stringify({ reason: 'Alias no longer needed' }, null, 2),
        desc: 'Remove a GC-style alias — writes audit record to state_history before removal',
      },
      {
        id: 'gcuid-aliases-disable',
        method: 'POST',
        path: '/api/gcuid/aliases/:gcuid/:id/disable',
        pathParams: [
          { name: 'gcuid', hint: 'GCUID URN or alias value' },
          { name: 'id', default: '1', hint: 'Alias row ID' },
        ],
        defaultBody: JSON.stringify({ reason: 'Alias temporarily suspended' }, null, 2),
        desc: 'Disable a GC-style alias — retains the record, sets disabled=true',
      },
      {
        id: 'gcuid-aliases-enable',
        method: 'POST',
        path: '/api/gcuid/aliases/:gcuid/:id/enable',
        pathParams: [
          { name: 'gcuid', hint: 'GCUID URN or alias value' },
          { name: 'id', default: '1', hint: 'Alias row ID' },
        ],
        desc: 'Re-enable a previously disabled GC-style alias',
      },
    ],
  },

  // ── CAES ────────────────────────────────────────────────────────────────────
  {
    id: 'caes',
    label: 'CAES',
    color: 'violet',
    endpoints: [
      {
        id: 'caes-schema',
        method: 'GET',
        path: '/api/caes/schema',
        desc: 'Standardized attribute schema (all known person.* attribute names)',
      },
      {
        id: 'caes-attribute-mappings-list',
        method: 'GET',
        path: '/api/caes/attribute-mappings',
        desc: 'All attribute mappings grouped by attribute and source',
      },
      {
        id: 'caes-attribute-mappings-create',
        method: 'POST',
        path: '/api/caes/attribute-mappings',
        defaultBody: JSON.stringify({
          standardAttribute: 'person.employment.department',
          sourceSystem: 'hr',
          sourceField: 'department',
          sourceTable: 'employees',
          keyField: 'employee_id',
          is_authoritative: true,
          operations: ['read'],
          searchable: true,
          indexed: false,
        }, null, 2),
        desc: 'Create a new CAES attribute mapping',
      },
      {
        id: 'caes-attribute-mappings-set-authoritative',
        method: 'PUT',
        path: '/api/caes/attribute-mappings/:id/authoritative',
        pathParams: [{ name: 'id', default: '1', hint: 'Mapping row ID' }],
        desc: 'Mark mapping as authoritative (clears authoritative flag on all others for same attribute)',
      },
      {
        id: 'caes-attribute-mappings-update',
        method: 'PUT',
        path: '/api/caes/attribute-mappings/:id',
        pathParams: [{ name: 'id', default: '1' }],
        defaultBody: JSON.stringify({ is_authoritative: true, operations: ['read', 'write'] }, null, 2),
        desc: 'Full update of an attribute mapping',
      },
      {
        id: 'caes-attribute-mappings-delete',
        method: 'DELETE',
        path: '/api/caes/attribute-mappings/:id',
        pathParams: [{ name: 'id', default: '1' }],
        desc: 'Delete an attribute mapping',
      },
      {
        id: 'caes-resolve',
        method: 'POST',
        path: '/api/caes/resolve',
        defaultBody: JSON.stringify({
          gcuid: '',
          attributes: [
            'person.name.given',
            'person.name.family',
            'person.email',
            'person.employment.department',
            'person.employment.title',
          ],
        }, null, 2),
        desc: 'Resolve attribute values for a GCUID via all linked source systems. The gcuid body field accepts a canonical GCUID URN or an alias value (resolved automatically when aliases are enabled in Options).',
      },
      {
        id: 'caes-stats',
        method: 'GET',
        path: '/api/caes/stats',
        desc: 'Mapping statistics: counts by source, multi-source attrs, operation support',
      },
      {
        id: 'caes-health',
        method: 'GET',
        path: '/api/caes/health',
        desc: 'CAES health: DB connectivity + connector enabled status',
      },
      {
        id: 'caes-match',
        method: 'POST',
        path: '/api/caes/match',
        defaultBody: JSON.stringify({
          attributes: {
            'person.name.given': 'Alice',
            'person.name.family': 'Smith',
            'person.email': 'alice.smith@agency.gov',
          },
        }, null, 2),
        desc: 'Search authoritative sources with provided attributes; returns source IDs + confidence scores',
      },
      {
        id: 'caes-match-and-link',
        method: 'POST',
        path: '/api/caes/match-and-link',
        defaultBody: JSON.stringify({
          gcuid: '',
          attributes: {
            'person.name.given': 'Alice',
            'person.name.family': 'Smith',
            'person.email': 'alice.smith@agency.gov',
          },
        }, null, 2),
        desc: 'Match + upsert source_mappings entries for a GCUID (≥0.75 confidence threshold). The gcuid body field accepts a canonical GCUID URN or an alias value.',
      },
      {
        id: 'caes-match-configs',
        method: 'GET',
        path: '/api/caes/match-configs',
        desc: 'Configured match strategies per source system',
      },
      {
        id: 'caes-self-service-attributes',
        method: 'GET',
        path: '/api/caes/self-service-attributes',
        desc: 'User-editable attribute schema for User Portal self-service form',
      },
    ],
  },

  // ── HR System ────────────────────────────────────────────────────────────────
  {
    id: 'hr',
    label: 'HR System',
    color: 'blue',
    connectorPort: 5183,
    endpoints: [
      {
        id: 'hr-employees-list',
        method: 'GET',
        path: '/api/hr/employees',
        desc: 'List all HR employees with GCUID state',
      },
      {
        id: 'hr-employees-view',
        method: 'GET',
        path: '/api/hr/employees/:id',
        pathParams: [{ name: 'id', default: 'EMP-0001', hint: 'HR employee_id' }],
        desc: 'View employee with full GCUID identity, aliases, source_mappings',
      },
      {
        id: 'hr-stats',
        method: 'GET',
        path: '/api/hr/stats',
        desc: 'Totals by department/status + GCUID linkage %',
      },
      {
        id: 'hr-search',
        method: 'GET',
        path: '/api/hr/search',
        queryParams: [{ name: 'q', default: '', hint: 'Search by name / email / employee_id' }],
        desc: 'Search HR employees',
      },
      {
        id: 'hr-connector-health',
        method: 'GET',
        path: '/api/hr/connector/health',
        desc: 'Proxy health check → HR connector server (port 8101)',
      },
      {
        id: 'hr-connector-info',
        method: 'GET',
        path: '/api/hr/connector/info',
        desc: 'Proxy info → HR connector server (port 8101)',
      },
      {
        id: 'hr-coverage-gaps',
        method: 'GET',
        path: '/api/hr/coverage-gaps',
        desc: 'Lists HR employees missing a GCUID linkage or with degraded source coverage',
      },
      {
        id: 'hr-employees-create',
        method: 'POST',
        path: '/api/hr/employees',
        defaultBody: JSON.stringify({
          employee_id: 'EMP-9999',
          first_name: 'Test',
          last_name: 'User',
          email: 'test.user@agency.gov',
          department: 'Engineering',
          job_title: 'Software Engineer',
          employment_type: 'FTE',
          hire_date: TODAY,
          status: 'active',
          salary: null,
          manager_id: null,
        }, null, 2),
        desc: 'Create a new HR employee record — does NOT auto-provision a GCUID; an admin must explicitly request one or the user must self-register',
      },
      {
        id: 'hr-employees-update',
        method: 'PUT',
        path: '/api/hr/employees/:id',
        pathParams: [{ name: 'id', default: 'EMP-0001' }],
        defaultBody: JSON.stringify({ job_title: 'Senior Software Engineer', department: 'Engineering' }, null, 2),
        desc: 'Update HR employee record',
      },
      {
        id: 'hr-employees-delete',
        method: 'DELETE',
        path: '/api/hr/employees/:id',
        pathParams: [{ name: 'id', default: 'EMP-9999', hint: 'Use a test record ID — this is permanent' }],
        desc: 'Delete HR employee record',
        warning: 'Permanently removes the employee record from the HR database.',
      },
    ],
  },

  // ── LDAP / AD ────────────────────────────────────────────────────────────────
  {
    id: 'ldap',
    label: 'LDAP / AD',
    color: 'indigo',
    connectorPort: 5184,
    endpoints: [
      {
        id: 'ldap-users-list',
        method: 'GET',
        path: '/api/ldap/users',
        desc: 'List all LDAP users with GCUID state',
      },
      {
        id: 'ldap-users-view',
        method: 'GET',
        path: '/api/ldap/users/:username',
        pathParams: [{ name: 'username', default: 'alice.smith', hint: 'LDAP username' }],
        desc: 'View LDAP user with full GCUID identity, aliases, source_mappings',
      },
      {
        id: 'ldap-stats',
        method: 'GET',
        path: '/api/ldap/stats',
        desc: 'Totals, enabled/disabled accounts, GCUID linkage %',
      },
      {
        id: 'ldap-search',
        method: 'GET',
        path: '/api/ldap/search',
        queryParams: [{ name: 'q', default: '', hint: 'Search by username / display_name / email / DN' }],
        desc: 'Search LDAP users',
      },
      {
        id: 'ldap-connector-health',
        method: 'GET',
        path: '/api/ldap/connector/health',
        desc: 'Proxy health check → LDAP connector server (port 5184)',
      },
      {
        id: 'ldap-connector-info',
        method: 'GET',
        path: '/api/ldap/connector/info',
        desc: 'Proxy info → LDAP connector server (port 5184)',
      },
      {
        id: 'ldap-coverage-gaps',
        method: 'GET',
        path: '/api/ldap/coverage-gaps',
        desc: 'Lists LDAP users missing a GCUID linkage or with degraded source coverage',
      },
      {
        id: 'ldap-users-create',
        method: 'POST',
        path: '/api/ldap/users',
        defaultBody: JSON.stringify({
          username: 'test.user',
          distinguished_name: 'CN=test.user,OU=Users,DC=agency,DC=gov',
          email: 'test.user@agency.gov',
          first_name: 'Test',
          last_name: 'User',
          department: 'Engineering',
          title: 'Software Engineer',
          account_enabled: true,
          groups: ['Domain Users', 'Engineering'],
        }, null, 2),
        desc: 'Create a new LDAP user record — does NOT auto-provision a GCUID; an admin must explicitly request one or the user must self-register',
      },
      {
        id: 'ldap-users-update',
        method: 'PUT',
        path: '/api/ldap/users/:username',
        pathParams: [{ name: 'username', default: 'alice.smith' }],
        defaultBody: JSON.stringify({ title: 'Senior Engineer', account_enabled: true }, null, 2),
        desc: 'Update LDAP user record',
      },
      {
        id: 'ldap-users-delete',
        method: 'DELETE',
        path: '/api/ldap/users/:username',
        pathParams: [{ name: 'username', default: 'test.user', hint: 'Use a test username — this is permanent' }],
        desc: 'Delete LDAP user record',
        warning: 'Permanently removes the user record from the LDAP database.',
      },
    ],
  },

  // ── Engineering ──────────────────────────────────────────────────────────────
  {
    id: 'engineering',
    label: 'Engineering',
    color: 'purple',
    connectorPort: 5185,
    endpoints: [
      {
        id: 'eng-employees-list',
        method: 'GET',
        path: '/api/engineering/employees',
        queryParams: [{ name: 'limit', default: '100' }],
        desc: 'List active Engineering employees with coverage scores',
      },
      {
        id: 'eng-employees-view',
        method: 'GET',
        path: '/api/engineering/employees/:id',
        pathParams: [{ name: 'id', default: 'ENG-0001', hint: 'Engineering dept_id' }],
        desc: 'View Engineering employee with GCUID linkage details',
      },
      {
        id: 'eng-stats',
        method: 'GET',
        path: '/api/engineering/stats',
        desc: 'Coverage stats: HR, LDAP, GCUID, full-coverage counts',
      },
      {
        id: 'eng-search',
        method: 'GET',
        path: '/api/engineering/search',
        queryParams: [
          { name: 'q', default: '' },
          { name: 'limit', default: '10' },
        ],
        desc: 'Search active Engineering employees',
      },
      {
        id: 'eng-coverage-gaps',
        method: 'GET',
        path: '/api/engineering/coverage-gaps',
        desc: 'Lists employees missing HR, LDAP, or GCUID linkage',
      },
      {
        id: 'eng-connector-health',
        method: 'GET',
        path: '/api/engineering/connector/health',
        desc: 'Proxy health check → Engineering connector server (port 5185)',
      },
      {
        id: 'eng-connector-info',
        method: 'GET',
        path: '/api/engineering/connector/info',
        desc: 'Proxy info → Engineering connector server (port 5185)',
      },
      {
        id: 'eng-request-gcuid',
        method: 'POST',
        path: '/api/engineering/request-gcuid',
        defaultBody: JSON.stringify({ dept_id: 'ENG-005', reason: 'New employee onboarding' }, null, 2),
        desc: 'Step 1 (preview) of the two-step GCUID request workflow for an Engineering employee — returns match results and recommendation without creating anything',
      },
      {
        id: 'eng-request-gcuid-confirm',
        method: 'POST',
        path: '/api/engineering/request-gcuid/confirm',
        defaultBody: JSON.stringify({ dept_id: 'ENG-005', reason: 'Onboarding confirmed', action: 'create_new' }, null, 2),
        desc: 'Step 2 (submit) of the two-step GCUID request workflow — creates a provisional GCUID and writes it back to the Engineering connector DB',
      },
      {
        id: 'eng-employees-create',
        method: 'POST',
        path: '/api/engineering/employees',
        defaultBody: JSON.stringify({
          first_name: 'Test',
          last_name: 'Engineer',
          email: 'test.engineer@agency.gov',
          role: 'Software Engineer',
          employment_type: 'FTE',
          start_date: TODAY,
          skills: ['TypeScript', 'Node.js'],
        }, null, 2),
        desc: 'Create Engineering employee (auto-assigns ENG-NNN dept_id)',
      },
      {
        id: 'eng-employees-update',
        method: 'PUT',
        path: '/api/engineering/employees/:id',
        pathParams: [{ name: 'id', default: 'ENG-0001' }],
        defaultBody: JSON.stringify({ role: 'Senior Software Engineer' }, null, 2),
        desc: 'Update Engineering employee record',
      },
      {
        id: 'eng-employees-delete',
        method: 'DELETE',
        path: '/api/engineering/employees/:id',
        pathParams: [{ name: 'id', default: 'ENG-0001', hint: 'Use a test record' }],
        desc: 'Delete Engineering employee record',
        warning: 'Permanently removes the employee record from the Engineering database.',
      },
      {
        id: 'eng-employees-linkage',
        method: 'PATCH',
        path: '/api/engineering/employees/:id/linkage',
        pathParams: [{ name: 'id', default: 'ENG-0001' }],
        defaultBody: JSON.stringify({ hr_employee_id: 'EMP-0001', ldap_username: 'alice.smith' }, null, 2),
        desc: 'Set HR/LDAP cross-system linkage for an Engineering employee',
      },
    ],
  },

  // ── Finance ──────────────────────────────────────────────────────────────────
  {
    id: 'finance',
    label: 'Finance',
    color: 'green',
    connectorPort: 8104,
    endpoints: [
      {
        id: 'fin-employees-list',
        method: 'GET',
        path: '/api/finance/employees',
        queryParams: [{ name: 'limit', default: '100' }],
        desc: 'List active Finance employees with coverage scores',
      },
      {
        id: 'fin-employees-view',
        method: 'GET',
        path: '/api/finance/employees/:id',
        pathParams: [{ name: 'id', default: 'FIN-0001', hint: 'Finance dept_id' }],
        desc: 'View Finance employee with GCUID info',
      },
      {
        id: 'fin-stats',
        method: 'GET',
        path: '/api/finance/stats',
        desc: 'Coverage stats + clearance level breakdown',
      },
      {
        id: 'fin-search',
        method: 'GET',
        path: '/api/finance/search',
        queryParams: [
          { name: 'q', default: '' },
          { name: 'limit', default: '10' },
        ],
        desc: 'Search active Finance employees',
      },
      {
        id: 'fin-coverage-gaps',
        method: 'GET',
        path: '/api/finance/coverage-gaps',
        desc: 'Lists Finance employees missing HR, LDAP, or GCUID',
      },
      {
        id: 'fin-connector-health',
        method: 'GET',
        path: '/api/finance/connector/health',
        desc: 'Proxy health check → Finance connector server (port 8104)',
      },
      {
        id: 'fin-connector-info',
        method: 'GET',
        path: '/api/finance/connector/info',
        desc: 'Proxy info → Finance connector server (port 8104)',
      },
      {
        id: 'fin-request-gcuid',
        method: 'POST',
        path: '/api/finance/request-gcuid',
        defaultBody: JSON.stringify({ dept_id: 'FIN-004', reason: 'New employee onboarding' }, null, 2),
        desc: 'Step 1 (preview) of the two-step GCUID request workflow for a Finance employee — returns match results and recommendation without creating anything',
      },
      {
        id: 'fin-request-gcuid-confirm',
        method: 'POST',
        path: '/api/finance/request-gcuid/confirm',
        defaultBody: JSON.stringify({ dept_id: 'FIN-004', reason: 'Onboarding confirmed', action: 'create_new' }, null, 2),
        desc: 'Step 2 (submit) of the two-step GCUID request workflow — creates a provisional GCUID and writes it back to the Finance connector DB',
      },
      {
        id: 'fin-employees-create',
        method: 'POST',
        path: '/api/finance/employees',
        defaultBody: JSON.stringify({
          first_name: 'Test',
          last_name: 'Analyst',
          email: 'test.analyst@agency.gov',
          role: 'Financial Analyst',
          employment_type: 'FTE',
          start_date: TODAY,
          clearance_level: 'Public Trust',
        }, null, 2),
        desc: 'Create Finance employee (auto-assigns FIN-NNN dept_id)',
      },
      {
        id: 'fin-employees-update',
        method: 'PUT',
        path: '/api/finance/employees/:id',
        pathParams: [{ name: 'id', default: 'FIN-0001' }],
        defaultBody: JSON.stringify({ role: 'Senior Financial Analyst', clearance_level: 'Secret' }, null, 2),
        desc: 'Update Finance employee record',
      },
      {
        id: 'fin-employees-delete',
        method: 'DELETE',
        path: '/api/finance/employees/:id',
        pathParams: [{ name: 'id', default: 'FIN-0001', hint: 'Use a test record' }],
        desc: 'Delete Finance employee record',
        warning: 'Permanently removes the employee record from the Finance database.',
      },
      {
        id: 'fin-employees-linkage',
        method: 'PATCH',
        path: '/api/finance/employees/:id/linkage',
        pathParams: [{ name: 'id', default: 'FIN-0001' }],
        defaultBody: JSON.stringify({ hr_employee_id: 'EMP-0001', ldap_username: 'bob.jones' }, null, 2),
        desc: 'Set HR/LDAP cross-system linkage for a Finance employee',
      },
    ],
  },

  // ── Department ───────────────────────────────────────────────────────────────────────────
  {
    id: 'dept',
    label: 'Department',
    color: 'blue',
    endpoints: [
      {
        id: 'dept-list',
        method: 'GET',
        path: '/api/dept/data/list',
        desc: 'List all employees in the department source with their GCUID linkage state',
      },
      {
        id: 'dept-view',
        method: 'GET',
        path: '/api/dept/data/view/:id',
        pathParams: [{ name: 'id', default: 'EMP-0001', hint: 'Employee or source record ID' }],
        desc: 'View a single department employee record with full GCUID identity and aliases',
      },
      {
        id: 'dept-stats',
        method: 'GET',
        path: '/api/dept/data/stats',
        desc: 'Department-level statistics: total employees, GCUID coverage percentage, state distribution',
      },
      {
        id: 'dept-search',
        method: 'GET',
        path: '/api/dept/data/search',
        queryParams: [{ name: 'q', default: '', hint: 'Search by name / email / employee_id' }],
        desc: 'Search department employees by name, email, or employee_id',
      },
      {
        id: 'dept-connector-status',
        method: 'GET',
        path: '/api/dept/connector/status',
        desc: 'Current operational status of the department connector (enabled, access mode, last sync)',
      },
      {
        id: 'dept-connector-test',
        method: 'POST',
        path: '/api/dept/connector/test',
        desc: 'Run a live connectivity test against the department connector server',
      },
      {
        id: 'dept-connector-info',
        method: 'GET',
        path: '/api/dept/connector/info',
        desc: 'Connector configuration details for the department source system',
      },
      {
        id: 'dept-monitor-dashboard',
        method: 'GET',
        path: '/api/dept/monitor/dashboard',
        desc: 'Department monitoring dashboard: recent state transitions, GCUID creation rate, anomaly flags',
      },
      {
        id: 'dept-monitor-stats',
        method: 'GET',
        path: '/api/dept/monitor/stats',
        desc: 'Department monitor statistics: state transitions and GCUIDs created in the last 24 h',
      },
    ],
  },

  // ── Connectors ───────────────────────────────────────────────────────────────
  {
    id: 'connectors',
    label: 'Connectors',
    color: 'orange',
    endpoints: [
      {
        id: 'conn-list',
        method: 'GET',
        path: '/api/connectors',
        desc: 'List all connector JSON configs (authoritative sources first)',
      },
      {
        id: 'conn-get',
        method: 'GET',
        path: '/api/connectors/:id',
        pathParams: [{
          name: 'id',
          default: 'conn-hr',
          hint: 'conn-hr | conn-ldap | conn-engineering | conn-finance',
        }],
        desc: 'Read single connector configuration file',
      },
      {
        id: 'conn-patch',
        method: 'PATCH',
        path: '/api/connectors/:id',
        pathParams: [{ name: 'id', default: 'conn-hr' }],
        defaultBody: JSON.stringify({
          enabled: true,
          accessMode: 'dynamic-pull',
          gcuidIntegration: { registryAuthToken: 'staging_hr_token_12345' },
          connectorServer: { authToken: 'staging_hr_token_12345' },
        }, null, 2),
        desc: 'Update connector operator fields: enabled, accessMode, display name, tokens, ports',
      },
      {
        id: 'conn-register',
        method: 'POST',
        path: '/api/connectors/:id/register',
        pathParams: [{ name: 'id', default: 'conn-hr' }],
        desc: "Upsert connector's attributeMappings into CAES attribute_mappings table",
      },
      {
        id: 'conn-ingest',
        method: 'POST',
        path: '/api/connectors/:id/ingest',
        pathParams: [{ name: 'id', default: 'conn-hr' }],
        headers: [
          {
            name: 'Authorization',
            default: 'Bearer staging_hr_token_12345',
            hint: 'Must match connectorServer.authToken in the connector JSON config. conn-hr=staging_hr_token_12345, conn-ldap=staging_ldap_token_12345',
            required: true,
          },
        ],
        defaultBody: JSON.stringify({
          records: [
            {
              employee_id: 'EMP-0001',
              first_name: 'Alice',
              last_name: 'Smith',
              email: 'alice.smith@agency.gov',
              department: 'Engineering',
              job_title: 'Software Engineer',
              employment_type: 'FTE',
              status: 'active',
            },
          ],
        }, null, 2),
        desc: '⚠ Auth required — push-cache batch attribute ingest from authoritative source connector. Bearer token must match connector config.',
        warning: 'This endpoint requires authentication. The Bearer token must match the connectorServer.authToken field in the connector\'s JSON config file.',
      },
      {
        id: 'conn-event',
        method: 'POST',
        path: '/api/connectors/:id/event',
        pathParams: [{ name: 'id', default: 'conn-hr', hint: 'Connector system ID (e.g. conn-hr, conn-ldap)' }],
        headers: [
          {
            name: 'Authorization',
            default: 'Bearer staging_hr_token_12345',
            hint: 'Must match connectorServer.authToken in the connector JSON config',
            required: true,
          },
        ],
        defaultBody: JSON.stringify({
          event_type: 'hire',
          source_id: 'EMP-0001',
          payload: {},
          reason: 'New employee onboarding',
        }, null, 2),
        desc: '⚠ Auth required — lifecycle event intake: receive a structured trigger (hire, terminate, rehire, leave, role_change) from an authoritative source and apply the corresponding GCUID registry state transition',
        warning: 'Bearer token must match connectorServer.authToken in the connector JSON config.',
      },
      {
        id: 'conn-sync',
        method: 'POST',
        path: '/api/connectors/:id/sync',
        pathParams: [{ name: 'id', default: 'conn-hr' }],
        desc: 'Manual pull sync from connector server (applicable to scheduled-pull / push-cache connectors)',
      },
    ],
  },

  // ── Bulk ─────────────────────────────────────────────────────────────────────
  {
    id: 'bulk',
    label: 'Bulk',
    color: 'orange',
    endpoints: [
      {
        id: 'bulk-import',
        method: 'POST',
        path: '/api/bulk/import',
        defaultBody: JSON.stringify({
          records: [
            {
              entity_type: 'person',
              entity_id: 'LEGACY-001',
              namespace: 'gc',
              metadata: { department: 'Finance', legacy_system: 'PeopleSoft' },
              source_links: [{ source_system: 'hr', source_id: 'EMP-LEGACY-001', is_primary: true }],
              initial_state: 'active',
            },
            {
              entity_type: 'person',
              entity_id: 'LEGACY-002',
              namespace: 'gc',
              source_links: [{ source_system: 'ldap', source_id: 'uid=legacy002,ou=users,dc=agency,dc=gov' }],
            },
          ],
          format: 'v2',
          core_id_type: 'ulid',
          encoding: 'crockford',
          generate_aliases: true,
        }, null, 2),
        desc: 'Batch identity import — process up to 500 legacy identities per request: mints GCUIDs, creates source mappings, optionally generates GC-A aliases. Returns per-row accepted/rejected results (partial success allowed)',
      },
      {
        id: 'bulk-export',
        method: 'GET',
        path: '/api/bulk/export',
        queryParams: [
          { name: 'state',       default: '',       hint: 'Filter by identity state: provisional, active, suspended, retired, archived' },
          { name: 'entity_type', default: 'person', hint: 'Filter by entity type: person, org, asset, app, agent' },
          { name: 'namespace',   default: '',       hint: 'Filter by namespace (e.g. gc)' },
          { name: 'from',        default: '',       hint: 'ISO 8601 lower bound on created_at (e.g. 2025-01-01T00:00:00Z)' },
          { name: 'to',          default: '',       hint: 'ISO 8601 upper bound on created_at' },
          { name: 'anonymize',   default: 'false',  hint: 'true = replace PII with deterministic pseudonyms' },
          { name: 'limit',       default: '100',    hint: 'Max rows returned (max 10000)' },
          { name: 'offset',      default: '0',      hint: 'Pagination offset' },
        ],
        desc: 'Scoped, privacy-preserving identity export — includes aggregate metrics (coverage rate, by_state, by_entity_type, source mapping count). Set anonymize=true to pseudonymise entity_id and strip metadata PII',
      },
    ],
  },

  // ── GCUID Request ───────────────────────────────────────────────────────────────────
  {
    id: 'gcuid-request',
    label: 'GCUID Request',
    color: 'amber',
    endpoints: [
      {
        id: 'gcuid-req-preview',
        method: 'POST',
        path: '/api/gcuid-request/preview',
        defaultBody: JSON.stringify({
          entity_type: 'person',
          entity_id: 'EMP-0001',
          namespace: 'gc',
          source_system: 'hr',
          attributes: {
            'person.name.given': 'Alice',
            'person.name.family': 'Smith',
            'person.email': 'alice.smith@agency.gov',
          },
        }, null, 2),
        desc: 'Preview a GCUID registration request — runs duplicate detection and returns a match report without writing to the registry. Use before submit to identify potential conflicts.',
      },
      {
        id: 'gcuid-req-submit',
        method: 'POST',
        path: '/api/gcuid-request/submit',
        defaultBody: JSON.stringify({
          entity_type: 'person',
          entity_id: 'EMP-0001',
          namespace: 'gc',
          source_system: 'hr',
          attributes: {
            'person.name.given': 'Alice',
            'person.name.family': 'Smith',
            'person.email': 'alice.smith@agency.gov',
            'person.employment.department': 'Engineering',
          },
        }, null, 2),
        desc: 'Submit a GCUID registration request — mints a new GCUID (provisional state), creates the source mapping, and seeds the CAES attribute record in one transaction',
      },
      {
        id: 'gcuid-req-scan-linkages',
        method: 'POST',
        path: '/api/gcuid-request/scan-linkages',
        defaultBody: JSON.stringify({
          source_system: 'hr',
          dry_run: true,
        }, null, 2),
        desc: 'Scan a source system for unlinked records and auto-match them to existing GCUIDs using CAES match strategies. Set dry_run: false to apply linkages.',
      },
    ],
  },

  // ── Hooks ─────────────────────────────────────────────────────────────────────
  {
    id: 'hooks',
    label: 'Hooks',
    color: 'violet',
    endpoints: [
      {
        id: 'hooks-subscribe',
        method: 'POST',
        path: '/api/hooks/subscriptions',
        defaultBody: JSON.stringify({
          subscriber_id: 'gcpass-directory',
          callback_url: 'https://gcpass.example.gov/webhooks/identity',
          events: ['identity.suspended', 'identity.retired', 'identifier.tombstoned'],
          secret: 'super-secret-hmac-key',
        }, null, 2),
        desc: 'Register for event notices — subscribe an external relying party or directory to specific identity lifecycle events (e.g. Suspend, Retire, Tombstone) to trigger downstream de-provisioning or access revocation. Valid events: identity.created, identity.activated, identity.suspended, identity.retired, identity.archived, identity.rehired, identifier.issued, identifier.nullified, identifier.tombstoned, identifier.superseded, alias.created, alias.removed, mapping.created, mapping.removed, * (all)',
      },
      {
        id: 'hooks-subscriptions-list',
        method: 'GET',
        path: '/api/hooks/subscriptions',
        queryParams: [
          { name: 'subscriber_id', default: '', hint: 'Filter by subscriber identifier' },
          { name: 'status',        default: '', hint: 'Filter by status: active, paused, revoked' },
        ],
        desc: 'List all webhook subscriptions, optionally filtered by subscriber_id or status',
      },
      {
        id: 'hooks-subscription-get',
        method: 'GET',
        path: '/api/hooks/subscriptions/:id',
        pathParams: [{ name: 'id', default: '' }],
        desc: 'Get a single webhook subscription by subscription ID',
      },
      {
        id: 'hooks-subscription-update',
        method: 'PATCH',
        path: '/api/hooks/subscriptions/:id',
        pathParams: [{ name: 'id', default: '' }],
        defaultBody: JSON.stringify({
          events: ['identity.suspended', 'identity.retired', 'identifier.tombstoned', 'identity.archived'],
          status: 'active',
        }, null, 2),
        desc: 'Update a webhook subscription — change callback_url, subscribed event types, secret, or pause/revoke status',
      },
      {
        id: 'hooks-subscription-delete',
        method: 'DELETE',
        path: '/api/hooks/subscriptions/:id',
        pathParams: [{ name: 'id', default: '' }],
        desc: 'Unsubscribe / permanently revoke a webhook subscription',
      },
      {
        id: 'hooks-events',
        method: 'GET',
        path: '/api/hooks/events',
        queryParams: [
          { name: 'since',       default: '',       hint: 'ISO 8601 lower bound — only return events emitted after this time' },
          { name: 'until',       default: '',       hint: 'ISO 8601 upper bound' },
          { name: 'gcuid',       default: '',       hint: 'Filter to events for a specific GCUID' },
          { name: 'event_type',  default: '',       hint: 'Filter by event type (e.g. identity.suspended) or * for all' },
          { name: 'after_id',    default: '',       hint: 'Cursor — only return events with id > this value (pagination)' },
          { name: 'limit',       default: '50',     hint: 'Max events per page (default 100, max 1000)' },
        ],
        desc: 'Pull event list — polling endpoint for downstream systems to retrieve a sequenced list of recent identity lifecycle transitions and identifier state changes. Use cursor (after_id) for sequential polling to keep synchronisation.',
      },
      {
        id: 'hooks-verify-webhook',
        method: 'POST',
        path: '/api/hooks/verify',
        defaultBody: JSON.stringify({
          type: 'webhook',
          subscription_id: '',
          payload: '{"gcuid":"urn:gcuid:person:v1:01ARZ3NDEKTSV4RRFFQ69G5FAV","event_type":"identity.suspended"}',
          signature: 'paste-hmac-sha256-hex-here',
          algorithm: 'sha256',
        }, null, 2),
        desc: 'Verify a webhook payload signature — confirms the HMAC-SHA256 integrity of an outbound event payload using the subscription\'s shared secret. Prevents consumer spoofing.',
      },
      {
        id: 'hooks-verify-jwt',
        method: 'POST',
        path: '/api/hooks/verify',
        defaultBody: JSON.stringify({
          type: 'jwt',
          token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1cm46Z2M6dWlkOnBlcnNvbjp2MTpFWEFNUExFIiwiaXNzIjoiaHR0cHM6Ly9nY3Bhc3MuZXhhbXBsZS5nb3YiLCJhdWQiOiJhY2Nlc3MtbWdtdC1zeXMiLCJleHAiOjk5OTk5OTk5OTksImlhdCI6MTcwMDAwMDAwMH0.signature',
          issuer: 'https://gcpass.example.gov',
          audience: 'access-mgmt-sys',
        }, null, 2),
        desc: 'Verify a JWT token (OIDC assertion from GCpass) — validates structure, expiry (exp), not-before (nbf), issuer (iss), and audience (aud) claims. Returns decoded claims. Note: cryptographic signature verification requires the IdP public key.',
      },
      {
        id: 'hooks-verify-saml',
        method: 'POST',
        path: '/api/hooks/verify',
        defaultBody: JSON.stringify({
          type: 'saml',
          token: 'base64-encoded-saml-assertion-here',
        }, null, 2),
        desc: 'Verify a SAML assertion — validates structure (urn:oasis namespace), checks for ds:Signature element and NotOnOrAfter expiry. Extracts issuer and NameID claims. Note: cryptographic XML-DSig verification requires the IdP certificate.',
      },
    ],
  },

  // ── User Portal ──────────────────────────────────────────────────────────────
  {
    id: 'user',
    label: 'User Portal',
    color: 'teal',
    endpoints: [
      {
        id: 'user-self-register',
        method: 'POST',
        path: '/api/user/self-register',
        defaultBody: JSON.stringify({
          entity_id: 'EMP-SELF-001',
          email: 'selfregister@agency.gov',
          attributes: {
            'person.name.given': 'Self',
            'person.name.family': 'Registered',
          },
        }, null, 2),
        desc: 'Self-service identity registration (R3b) — creates a provisional GCUID. If connector-side source records (HR/LDAP) match with high confidence, the source_mappings are auto-linked',
      },
      {
        id: 'user-lookup',
        method: 'GET',
        path: '/api/user/lookup/:id',
        pathParams: [{ name: 'id', hint: 'GCUID, entity_id, or alias value' }],
        desc: 'Resolve identity by GCUID, entity_id, or alias (respects alias feature flags)',
      },
      {
        id: 'user-search',
        method: 'GET',
        path: '/api/user/search',
        queryParams: [
          { name: 'q', default: '', hint: 'Search entity_id / gcuid / metadata' },
          { name: 'limit', default: '10' },
        ],
        desc: 'Search identities',
      },
      {
        id: 'user-history',
        method: 'GET',
        path: '/api/user/history/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        desc: 'State transition history for a GCUID',
      },
      {
        id: 'user-verify',
        method: 'GET',
        path: '/api/user/verify/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        desc: 'Validate GCUID format + check registry state',
      },
      {
        id: 'user-attributes-get',
        method: 'GET',
        path: '/api/user/attributes/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        desc: 'Read self-service + context attributes via CAES mappings',
      },
      {
        id: 'user-attributes-patch',
        method: 'PATCH',
        path: '/api/user/attributes/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({
          attributes: {
            'person.profile.bio': 'Software engineer at the federal agency.',
          },
        }, null, 2),
        desc: 'Write self-service attributes (only self_service=1 mappings accepted)',
      },
      {
        id: 'user-aliases-check',
        method: 'GET',
        path: '/api/user/aliases/check',
        queryParams: [
          { name: 'value', default: 'my-alias', hint: 'Alias string to check availability' },
          { name: 'gcuid', default: '', hint: 'Optional: GCUID to scope the check' },
        ],
        desc: 'Check custom alias availability',
      },
      {
        id: 'user-aliases-list',
        method: 'GET',
        path: '/api/user/aliases/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        desc: 'List custom aliases for a GCUID (gated on aliases.userSelected feature flag)',
      },
      {
        id: 'user-aliases-create',
        method: 'POST',
        path: '/api/user/aliases/:gcuid',
        pathParams: [{ name: 'gcuid', hint: 'GCUID URN or alias value' }],
        defaultBody: JSON.stringify({ value: 'my-preferred-alias' }, null, 2),
        desc: 'Create custom alias (idempotent for same value+gcuid pair)',
      },
      {
        id: 'user-aliases-delete',
        method: 'DELETE',
        path: '/api/user/aliases/:gcuid/:id',
        pathParams: [
          { name: 'gcuid', hint: 'GCUID URN or alias value' },
          { name: 'id', default: '1', hint: 'Alias row ID' },
        ],
        defaultBody: JSON.stringify({ reason: 'Preferred alias changed' }, null, 2),
        desc: 'Remove custom alias — writes audit record to state_history before removal',
      },
      {
        id: 'user-aliases-disable',
        method: 'POST',
        path: '/api/user/aliases/:gcuid/:id/disable',
        pathParams: [
          { name: 'gcuid', hint: 'GCUID URN or alias value' },
          { name: 'id', default: '1', hint: 'Alias row ID' },
        ],
        defaultBody: JSON.stringify({ reason: 'Alias temporarily suspended' }, null, 2),
        desc: 'Disable a custom alias — retains record, prevents its use for resolution',
      },
      {
        id: 'user-aliases-enable',
        method: 'POST',
        path: '/api/user/aliases/:gcuid/:id/enable',
        pathParams: [
          { name: 'gcuid', hint: 'GCUID URN or alias value' },
          { name: 'id', default: '1', hint: 'Alias row ID' },
        ],
        desc: 'Re-enable a previously disabled custom alias',
      },
    ],
  },

  // ── Logs ─────────────────────────────────────────────────────────────────────
  {
    id: 'logs',
    label: 'Logs',
    color: 'rose',
    endpoints: [
      {
        id: 'logs-query',
        method: 'GET',
        path: '/api/logs',
        queryParams: [
          { name: 'system', default: '', hint: 'gcuid-registry | caes | hr | ldap | engineering | finance | system' },
          { name: 'level', default: '', hint: 'debug | info | notice | warning | error | critical | alarm | emergency' },
          { name: 'component', default: '', hint: 'Filter by component name' },
          { name: 'event_type', default: '', hint: 'Filter by event type' },
          { name: 'search', default: '', hint: 'Free text search in message' },
          { name: 'from', default: '', hint: 'ISO timestamp e.g. 2026-01-01T00:00:00Z' },
          { name: 'to', default: '', hint: 'ISO timestamp' },
          { name: 'limit', default: '50' },
          { name: 'offset', default: '0' },
        ],
        desc: 'Query log entries across all systems with filters and pagination',
      },
      {
        id: 'logs-stats',
        method: 'GET',
        path: '/api/logs/stats',
        desc: 'Per-system and per-level row counts + total',
      },
      {
        id: 'logs-get-one',
        method: 'GET',
        path: '/api/logs/:log_id',
        pathParams: [{ name: 'log_id', default: '1', hint: 'Log row ID (system auto-detected)' }],
        desc: 'Full log record by ID (system found via log_all view)',
      },
    ],
  },

  // ── Feature Flags ────────────────────────────────────────────────────────────
  {
    id: 'flags',
    label: 'Feature Flags & Log Levels',
    color: 'pink',
    endpoints: [
      {
        id: 'flags-get',
        method: 'GET',
        path: '/api/flags',
        desc: 'Read current feature flags (aliases.enabled, email, userSelected, generated)',
      },
      {
        id: 'flags-patch',
        method: 'PATCH',
        path: '/api/flags',
        defaultBody: JSON.stringify({
          aliases: {
            enabled: true,
            email: false,
            userSelected: true,
            generated: true,
          },
        }, null, 2),
        desc: 'Update feature flags (deep-merge; aliases.enabled cascades to all sub-flags)',
      },
      {
        id: 'log-levels-get',
        method: 'GET',
        path: '/api/log-levels',
        desc: 'Read current per-system minimum log levels (gcuid-registry, caes, hr, ldap, engineering, finance, system). Levels follow RFC 5424 severity: emergency, alarm, critical, error, warning, notice, info, debug',
      },
      {
        id: 'log-levels-patch',
        method: 'PATCH',
        path: '/api/log-levels',
        defaultBody: JSON.stringify({
          'gcuid-registry': 'debug',
          'caes':           'info',
          'hr':             'warning',
          'ldap':           'info',
          'engineering':    'info',
          'finance':        'info',
          'system':         'info',
        }, null, 2),
        desc: 'Update runtime log level for one or more systems — takes effect immediately (invalidates in-memory cache). Valid levels: emergency, alarm, critical, error, warning, notice, info, debug',
      },
    ],
  },

  // ── System ───────────────────────────────────────────────────────────────────
  {
    id: 'system',
    label: 'System',
    color: 'slate',
    endpoints: [
      {
        id: 'sys-health',
        method: 'GET',
        path: '/health',
        desc: 'Top-level server health check (outside /api prefix) — uptime, timestamp, version',
      },
      {
        id: 'sys-sla-health',
        method: 'GET',
        path: '/api/system/health',
        desc: 'SLA aggregate health (7.7.1) — probes every subsystem (Registry DB, HR DB, LDAP DB, Logs DB), measures response latency against the <500 ms SLA target, and reports per-subsystem pass/degraded/fail status with overall SLA compliance flag',
      },
      {
        id: 'sys-versions',
        method: 'GET',
        path: '/api/system/versions',
        desc: 'API and schema versions (7.7.2) — returns current API contract version, URN scheme version (v1), GCUID format spec, CAES schema version, supported entity types/states, and feature flags. Enables consuming applications to verify backward compatibility before upgrading.',
      },
      {
        id: 'sys-policy',
        method: 'GET',
        path: '/api/system/policy',
        desc: 'Governance policy for identity resolution (7.7.3) — displays attribute sensitivity levels (public/internal/restricted/confidential), trust tiers (GCpass, departmental, external), resolution constraints (purpose binding, minimal disclosure, audit), PIA boundaries, data retention schedules, and relying-party permissions under the Privacy Act (R.S.C., 1985, c. P-21)',
      },
      {
        id: 'sys-dashboard',
        method: 'GET',
        path: '/api/system/dashboard',
        desc: 'Full operational snapshot: uptime, Node info, identity counts, DB sizes, log row counts',
      },
      {
        id: 'sys-stats',
        method: 'GET',
        path: '/api/system/stats',
        desc: 'High-level platform statistics: authoritative source count, registered department count',
      },
      {
        id: 'sys-clear-logs',
        method: 'DELETE',
        path: '/api/system/logs/:system',
        pathParams: [{
          name: 'system',
          default: 'system',
          hint: 'gcuid-registry | caes | hr | ldap | engineering | finance | system | all',
        }],
        desc: '⚠ Destructive — Clear log table for one system or ALL systems',
        warning: 'This permanently deletes log records from the database. Use "all" to clear every log table at once.',
      },
    ],
  },

  // ── UX Config ────────────────────────────────────────────────────────────────────────
  {
    id: 'ux-config',
    label: 'UX Config',
    color: 'violet',
    endpoints: [
      {
        id: 'ux-config-get',
        method: 'GET',
        path: '/api/ux-config',
        desc: 'Read full UX configuration (all scopes and their theme tokens)',
      },
      {
        id: 'ux-config-put',
        method: 'PUT',
        path: '/api/ux-config',
        defaultBody: JSON.stringify({
          global: {
            light: { bgPage: '#ffffff', accentPrimary: '#2563eb' },
            dark:  { bgPage: '#0f172a', accentPrimary: '#3b82f6' },
          },
        }, null, 2),
        desc: 'Replace the full UX configuration object (all scopes).',
        warning: 'Replaces the entire UX configuration. All scope-specific overrides will be overwritten.',
      },
      {
        id: 'ux-config-scope-put',
        method: 'PUT',
        path: '/api/ux-config/:scopeId',
        pathParams: [{ name: 'scopeId', default: 'global', hint: 'Scope: global | hr | ldap | engineering | finance | or a connector system_id' }],
        defaultBody: JSON.stringify({
          light: { accentPrimary: '#2563eb', btnPrimaryBg: '#2563eb', btnPrimaryText: '#ffffff' },
          dark:  { accentPrimary: '#3b82f6', btnPrimaryBg: '#3b82f6', btnPrimaryText: '#ffffff' },
        }, null, 2),
        desc: 'Update theme tokens for a single scope (deep-merged with global defaults)',
      },
      {
        id: 'ux-theme-lib-list',
        method: 'GET',
        path: '/api/ux-config/theme-library',
        desc: 'List all saved theme library entries',
      },
      {
        id: 'ux-theme-lib-save',
        method: 'POST',
        path: '/api/ux-config/theme-library',
        defaultBody: JSON.stringify({
          name: 'My Theme',
          theme: {
            light: { bgPage: '#ffffff', accentPrimary: '#2563eb' },
            dark:  { bgPage: '#0f172a', accentPrimary: '#3b82f6' },
          },
        }, null, 2),
        desc: 'Save the current theme as a named library entry (upserts by name if already exists)',
      },
      {
        id: 'ux-theme-lib-update',
        method: 'PUT',
        path: '/api/ux-config/theme-library/:id',
        pathParams: [{ name: 'id', default: '', hint: 'Theme library entry UUID' }],
        defaultBody: JSON.stringify({
          name: 'My Theme (Updated)',
          theme: {
            light: { bgPage: '#f8fafc', accentPrimary: '#0ea5e9' },
            dark:  { bgPage: '#020617', accentPrimary: '#38bdf8' },
          },
        }, null, 2),
        desc: 'Fully replace a theme library entry by ID',
      },
      {
        id: 'ux-theme-lib-rename',
        method: 'PATCH',
        path: '/api/ux-config/theme-library/:id',
        pathParams: [{ name: 'id', default: '', hint: 'Theme library entry UUID' }],
        defaultBody: JSON.stringify({ name: 'New Name' }, null, 2),
        desc: 'Rename a theme library entry without changing its token values',
      },
      {
        id: 'ux-theme-lib-delete',
        method: 'DELETE',
        path: '/api/ux-config/theme-library/:id',
        pathParams: [{ name: 'id', default: '', hint: 'Theme library entry UUID' }],
        desc: 'Delete a theme library entry',
        warning: 'Permanently removes the saved theme. This cannot be undone.',
      },
    ],
  },
];

// ─── Style Maps ───────────────────────────────────────────────────────────────

const GROUP_COLORS: Record<string, {
  inactive: string; active: string; dot: string; label: string; badge: string; headingDot: string;
}> = {
  amber:  { inactive: 'hover:bg-amber-50 dark:hover:bg-amber-900/20 text-ux-text-sub',  active: 'bg-amber-50 dark:bg-amber-900/20 border-l-2 border-amber-500 text-amber-800 dark:text-amber-200', dot: 'bg-amber-500',  label: 'text-amber-800 dark:text-amber-300',  badge: 'bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200',  headingDot: 'text-amber-800 dark:text-amber-400' },
  violet: { inactive: 'hover:bg-violet-50 dark:hover:bg-violet-900/20 text-ux-text-sub', active: 'bg-violet-50 dark:bg-violet-900/20 border-l-2 border-violet-500 text-violet-800 dark:text-violet-200', dot: 'bg-violet-500', label: 'text-violet-700 dark:text-violet-300', badge: 'bg-violet-100 dark:bg-violet-800/60 text-violet-800 dark:text-violet-200', headingDot: 'text-violet-600 dark:text-violet-400' },
  blue:   { inactive: 'hover:bg-blue-50 dark:hover:bg-blue-900/20 text-ux-text-sub',   active: 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500 text-blue-800 dark:text-blue-200',   dot: 'bg-blue-500',   label: 'text-blue-700 dark:text-blue-300',   badge: 'bg-blue-100 dark:bg-blue-800/60 text-blue-800 dark:text-blue-200',   headingDot: 'text-blue-600 dark:text-blue-400' },
  indigo: { inactive: 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-ux-text-sub', active: 'bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-indigo-500 text-indigo-800 dark:text-indigo-200', dot: 'bg-indigo-500', label: 'text-indigo-700 dark:text-indigo-300', badge: 'bg-indigo-100 dark:bg-indigo-800/60 text-indigo-800 dark:text-indigo-200', headingDot: 'text-indigo-600 dark:text-indigo-400' },
  purple: { inactive: 'hover:bg-purple-50 dark:hover:bg-purple-900/20 text-ux-text-sub', active: 'bg-purple-50 dark:bg-purple-900/20 border-l-2 border-purple-500 text-purple-800 dark:text-purple-200', dot: 'bg-purple-500', label: 'text-purple-700 dark:text-purple-300', badge: 'bg-purple-100 dark:bg-purple-800/60 text-purple-800 dark:text-purple-200', headingDot: 'text-purple-600 dark:text-purple-400' },
  green:  { inactive: 'hover:bg-green-50 dark:hover:bg-green-900/20 text-ux-text-sub',  active: 'bg-green-50 dark:bg-green-900/20 border-l-2 border-green-500 text-green-800 dark:text-green-200',  dot: 'bg-green-500',  label: 'text-green-700 dark:text-green-300',  badge: 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200',  headingDot: 'text-green-700 dark:text-green-400' },
  orange: { inactive: 'hover:bg-orange-50 dark:hover:bg-orange-900/20 text-ux-text-sub', active: 'bg-orange-50 dark:bg-orange-900/20 border-l-2 border-orange-500 text-orange-800 dark:text-orange-200', dot: 'bg-orange-500', label: 'text-orange-700 dark:text-orange-300', badge: 'bg-orange-100 dark:bg-orange-800/60 text-orange-800 dark:text-orange-200', headingDot: 'text-orange-600 dark:text-orange-400' },
  teal:   { inactive: 'hover:bg-teal-50 dark:hover:bg-teal-900/20 text-ux-text-sub',   active: 'bg-teal-50 dark:bg-teal-900/20 border-l-2 border-teal-500 text-teal-800 dark:text-teal-200',   dot: 'bg-teal-500',   label: 'text-teal-700 dark:text-teal-300',   badge: 'bg-teal-100 dark:bg-teal-800/60 text-teal-800 dark:text-teal-200',   headingDot: 'text-teal-600 dark:text-teal-400' },
  rose:   { inactive: 'hover:bg-rose-50 dark:hover:bg-rose-900/20 text-ux-text-sub',   active: 'bg-rose-50 dark:bg-rose-900/20 border-l-2 border-rose-500 text-rose-800 dark:text-rose-200',   dot: 'bg-rose-500',   label: 'text-rose-700 dark:text-rose-300',   badge: 'bg-rose-100 dark:bg-rose-800/60 text-rose-800 dark:text-rose-200',   headingDot: 'text-rose-600 dark:text-rose-400' },
  pink:   { inactive: 'hover:bg-pink-50 dark:hover:bg-pink-900/20 text-ux-text-sub',   active: 'bg-pink-50 dark:bg-pink-900/20 border-l-2 border-pink-500 text-pink-800 dark:text-pink-200',   dot: 'bg-pink-500',   label: 'text-pink-700 dark:text-pink-300',   badge: 'bg-pink-100 dark:bg-pink-800/60 text-pink-800 dark:text-pink-200',   headingDot: 'text-pink-600 dark:text-pink-400' },
  slate:  { inactive: 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-ux-text-sub',  active: 'bg-slate-50 dark:bg-slate-800 border-l-2 border-slate-400 text-slate-800 dark:text-slate-100',  dot: 'bg-slate-400',  label: 'text-slate-700 dark:text-slate-200',  badge: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200',  headingDot: 'text-slate-600 dark:text-slate-300' },
};

const METHOD_STYLE: Record<HttpMethod, string> = {
  GET:    'bg-[#e7eef4] dark:bg-blue-800/60 text-blue-700 dark:text-blue-300 border border-[#d0dde9] dark:border-[#3f6489]',
  POST:   'bg-[#e8ede6] dark:bg-green-800/60 text-green-800 dark:text-green-300 border border-[#d1dccf] dark:border-green-700',
  PUT:    'bg-[#f4f0e4] dark:bg-amber-800/60 text-amber-800 dark:text-amber-300 border border-[#e9e1c9] dark:border-[#a67f3d]',
  PATCH:  'bg-[#ffedd5] dark:bg-orange-800/60 text-orange-700 dark:text-orange-300 border border-[#fed7aa] dark:border-orange-700',
  DELETE: 'bg-red-100 dark:bg-red-800/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700',
};

function statusStyle(code: number): string {
  if (code >= 200 && code < 300) return 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-700';
  if (code >= 300 && code < 400) return 'bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700';
  if (code >= 400 && code < 500) return 'bg-red-100 dark:bg-red-800/60 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-700';
  return 'bg-red-200 text-red-900 dark:text-red-200 border border-red-300 dark:border-red-700 font-bold';
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function buildUrl(
  path: string,
  pathValues: Record<string, string>,
  queryValues: Record<string, string>,
): string {
  let url = path;
  for (const [k, v] of Object.entries(pathValues)) {
    url = url.replace(`:${k}`, v ? encodeURIComponent(v) : `:${k}`);
  }
  const qs = new URLSearchParams(Object.entries(queryValues).filter(([, v]) => v !== ''));
  const qsStr = qs.toString();
  return qsStr ? `${url}?${qsStr}` : url;
}

function prettyJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

function initState(ep: EndpointDef): EndpointState {
  const pathValues: Record<string, string> = {};
  for (const p of ep.pathParams ?? []) pathValues[p.name] = p.default ?? '';
  const queryValues: Record<string, string> = {};
  for (const p of ep.queryParams ?? []) queryValues[p.name] = p.default ?? '';
  const headerValues: Record<string, string> = {};
  for (const h of ep.headers ?? []) headerValues[h.name] = h.default ?? '';
  return { expanded: false, pathValues, queryValues, headerValues, body: ep.defaultBody ?? '', loading: false, result: null, execError: null };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide min-w-[52px] ${METHOD_STYLE[method]}`}>
      {method}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="px-2 py-1 text-xs rounded border border-ux-border text-ux-text-sub hover:text-gray-700 dark:hover:text-gray-200 hover:bg-ux-hover bg-ux-surface/50 transition-colors"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function PathDisplay({ path, pathValues }: { path: string; pathValues: Record<string, string> }) {
  const segments = path.split('/');
  return (
    <span className="font-mono text-xs">
      {segments.map((seg, i) => {
        if (seg.startsWith(':')) {
          const name = seg.slice(1);
          const val = pathValues[name];
          return (
            <span key={i}>
              {i > 0 && '/'}
              {val
                ? <span className="text-ux-text font-semibold">{encodeURIComponent(val)}</span>
                : <span className="text-ux-text-sub italic">{seg}</span>}
            </span>
          );
        }
        return <span key={i} className="text-ux-text-sub">{i > 0 ? '/' : ''}{seg}</span>;
      })}
    </span>
  );
}

interface EndpointCardProps {
  ep: EndpointDef;
  state: EndpointState;
  connectorPort?: number;
  onToggle: () => void;
  onUpdate: (patch: Partial<EndpointState>) => void;
  onExecute: () => void;
}

function EndpointCard({ ep, state, connectorPort, onToggle, onUpdate, onExecute }: EndpointCardProps) {
  const hasBody = ep.method !== 'GET' || !!ep.defaultBody;
  const resolvedPath = buildUrl(ep.path, state.pathValues, state.queryValues);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const resolvedUrl = origin + resolvedPath;
  const proxyTarget = connectorPort ? `http://localhost:${connectorPort}` : null;

  return (
    <div className={`border rounded-lg overflow-hidden transition-all ${state.expanded ? 'border-ux-border shadow-sm' : 'border-ux-border'}`}>
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-ux-hover bg-ux-surface/50 transition-colors"
      >
        <span className="flex-shrink-0 mt-0.5"><MethodBadge method={ep.method} /></span>
        <span className="flex-1 min-w-0">
          <span className="font-mono text-xs text-ux-text break-all">{ep.path}</span>
          <span className="block text-xs text-ux-text-sub mt-0.5">{ep.desc}</span>
        </span>
        <span className="text-ux-text-sub">{state.expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded panel */}
      {state.expanded && (
        <div className="border-t border-ux-border bg-ux-surface-alt px-4 py-4 space-y-4">
          {/* Warning notice */}
          {ep.warning && (
            <div className="flex gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded text-xs text-amber-800 dark:text-amber-200">
              <span className="flex-shrink-0">⚠</span>
              <span>{ep.warning}</span>
            </div>
          )}

          {/* Resolved URL preview */}
          <div>
            <div className="text-ux-text-sub">Resolved URL</div>
            <div className="flex items-center gap-2 px-3 py-2 bg-ux-surface border border-ux-border rounded">
              <span className="font-mono text-xs min-w-0 flex-1 break-all">
                <span className="text-ux-text-sub">{origin}</span>
                <PathDisplay path={ep.path} pathValues={state.pathValues} />
                {Object.entries(state.queryValues).some(([, v]) => v !== '') && (
                  <span className="text-blue-600">
                    ?{new URLSearchParams(Object.entries(state.queryValues).filter(([, v]) => v !== '')).toString()}
                  </span>
                )}
              </span>
              <div className="flex-shrink-0"><CopyButton text={resolvedUrl} /></div>
            </div>
            {proxyTarget && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-ux-text-sub">
                <span>⇢ proxied to</span>
                <span className="font-mono text-ux-text">{proxyTarget + resolvedPath}</span>
              </div>
            )}
          </div>

          {/* Path params */}
          {(ep.pathParams ?? []).length > 0 && (
            <div>
              <div className="text-ux-text-sub">Path Parameters</div>
              <div className="grid grid-cols-1 gap-2">
                {ep.pathParams!.map(p => (
                  <div key={p.name} className="flex items-start gap-2">
                    <label className="w-36 flex-shrink-0 text-xs font-mono text-ux-text-sub pt-2">
                      :{p.name}
                      {p.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <div className="flex-1">
                      <input
                        value={state.pathValues[p.name] ?? ''}
                        onChange={e => onUpdate({ pathValues: { ...state.pathValues, [p.name]: e.target.value } })}
                        placeholder={p.default ?? p.name}
                        className="w-full px-2.5 py-1.5 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      {p.hint && <div className="text-ux-text-sub">{p.hint}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Query params */}
          {(ep.queryParams ?? []).length > 0 && (
            <div>
              <div className="text-ux-text-sub">Query Parameters</div>
              <div className="grid grid-cols-2 gap-2">
                {ep.queryParams!.map(p => (
                  <div key={p.name}>
                    <label className="block text-[10px] font-mono text-ux-text-sub mb-0.5">?{p.name}</label>
                    <input
                      value={state.queryValues[p.name] ?? ''}
                      onChange={e => onUpdate({ queryValues: { ...state.queryValues, [p.name]: e.target.value } })}
                      placeholder={p.default ?? ''}
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    {p.hint && <div className="text-ux-text-sub">{p.hint}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Headers */}
          {(ep.headers ?? []).length > 0 && (
            <div>
              <div className="text-ux-text-sub">
                Headers
                <span className="text-amber-800 dark:text-amber-300 normal-case text-[10px] font-normal">— tokens shown for PoC debugging</span>
              </div>
              <div className="space-y-2">
                {ep.headers!.map(h => (
                  <div key={h.name}>
                    <label className="block text-[10px] font-mono text-ux-text-sub mb-0.5">
                      {h.name}
                      {h.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      value={state.headerValues[h.name] ?? ''}
                      onChange={e => onUpdate({ headerValues: { ...state.headerValues, [h.name]: e.target.value } })}
                      placeholder={h.default ?? ''}
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-amber-300 dark:border-amber-700 rounded bg-amber-50 dark:bg-amber-900/20 focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    {h.hint && <div className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">{h.hint}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Request body */}
          {hasBody && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-ux-text-sub">
                  Request Body
                  <span className="text-ux-text-sub">(JSON)</span>
                </div>
                <button
                  onClick={() => onUpdate({ body: ep.defaultBody ?? '' })}
                  className="text-[10px] text-blue-700 hover:text-blue-900 dark:text-blue-300"
                >
                  Reset to default
                </button>
              </div>
              <textarea
                value={state.body}
                onChange={e => onUpdate({ body: e.target.value })}
                rows={8}
                spellCheck={false}
                className="w-full px-3 py-2 text-xs font-mono border border-ux-border rounded bg-ux-surface resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="null — no body"
              />
            </div>
          )}

          {/* Execute */}
          <div className="flex items-center gap-3">
            <button
              onClick={onExecute}
              disabled={state.loading}
              className={`px-5 py-2 rounded text-sm font-semibold transition-colors ${
                state.loading
                  ? 'bg-ux-hover text-gray-400 cursor-not-allowed'
                  : 'bg-gray-900 text-white hover:bg-gray-700'
              }`}
            >
              {state.loading ? '⏳ Sending…' : '▶ Execute'}
            </button>
            {state.result && (
              <button
                onClick={() => onUpdate({ result: null, execError: null })}
                className="text-ux-text-sub"
              >
                Clear response
              </button>
            )}
          </div>

          {/* Network / exec error */}
          {state.execError && (
            <div className="flex gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded text-xs text-red-800 dark:text-red-200">
              <span className="flex-shrink-0 font-bold">Error:</span>
              <span>{state.execError}</span>
            </div>
          )}

          {/* Response panel */}
          {state.result && (
            <div className="border border-ux-border rounded bg-ux-surface overflow-hidden">
              {/* Response meta bar */}
              <div className="flex items-center gap-3 px-3 py-2 bg-ux-surface-alt border-b border-ux-border">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusStyle(state.result.status)}`}>
                  {state.result.status} {state.result.statusText}
                </span>
                <span className="text-xs text-ux-text-sub">{state.result.latencyMs} ms</span>
                <div className="ml-auto">
                  <CopyButton text={prettyJson(state.result.rawBody)} />
                </div>
              </div>
              {/* Response body */}
              <pre className="px-3 py-3 text-xs font-mono text-ux-text overflow-auto max-h-96 whitespace-pre-wrap break-words">
                {prettyJson(state.result.rawBody)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Credentials Reference Panel ─────────────────────────────────────────────

const CREDENTIALS = [
  {
    system: 'HR System',
    systemId: 'conn-hr',
    color: 'blue',
    connectorPort: 5183,
    ingestToken: 'staging_hr_token_12345',
    registryToken: 'staging_hr_token_12345',
    note: 'Use as Bearer token for POST /api/connectors/conn-hr/ingest',
  },
  {
    system: 'LDAP / AD',
    systemId: 'conn-ldap',
    color: 'indigo',
    connectorPort: 5184,
    ingestToken: 'staging_ldap_token_12345',
    registryToken: 'staging_ldap_token_12345',
    note: 'Use as Bearer token for POST /api/connectors/conn-ldap/ingest',
  },
  {
    system: 'Engineering',
    systemId: 'conn-engineering',
    color: 'purple',
    connectorPort: null,
    ingestToken: 'staging_eng_token_12345',
    registryToken: 'staging_eng_token_12345',
    note: 'scheduled-pull mode — no ingest endpoint exposed by default',
  },
  {
    system: 'Finance',
    systemId: 'conn-finance',
    color: 'green',
    connectorPort: null,
    ingestToken: 'staging_fin_token_12345',
    registryToken: 'staging_fin_token_12345',
    note: 'push-cache mode — ingest token required for POST /api/connectors/conn-finance/ingest',
  },
] as const;

const CRED_COLORS: Record<string, { dot: string; text: string; border: string; bg: string }> = {
  blue:   { dot: 'bg-blue-500',   text: 'text-blue-700 dark:text-blue-300',   border: 'border-blue-200 dark:border-blue-700',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
  indigo: { dot: 'bg-indigo-500', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-700', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
  purple: { dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-700', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  green:  { dot: 'bg-green-500',  text: 'text-green-700 dark:text-green-300',  border: 'border-green-200 dark:border-green-700',  bg: 'bg-green-50 dark:bg-green-900/20' },
};

function TokenChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      title="Click to copy"
      className="inline-flex items-center gap-1.5 px-2 py-1 font-mono text-xs bg-ux-surface border border-ux-border rounded hover:border-gray-400 hover:bg-ux-hover bg-ux-surface/50 transition-colors cursor-pointer group"
    >
      <span className="text-ux-text">{value}</span>
      <span className={`text-[10px] flex-shrink-0 transition-colors ${copied ? 'text-green-600' : 'text-ux-muted group-hover:text-ux-text-sub'}`}>
        {copied ? '✓' : '⎘'}
      </span>
    </button>
  );
}

function CredentialsPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-amber-300 dark:border-amber-700 rounded-lg bg-amber-50 dark:bg-amber-900/20 overflow-hidden mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-amber-100 dark:bg-amber-800/60 transition-colors"
      >
        <span className="text-amber-600 dark:text-amber-400 text-base">🔑</span>
        <span className="text-sm font-semibold text-amber-900 dark:text-amber-200 flex-1">
          PoC Credentials &amp; Auth Tokens
        </span>
        <span className="text-xs text-amber-700 dark:text-amber-300 mr-2">
          All connector tokens and registry auth tokens — exposed for operator debugging
        </span>
        <span className="text-amber-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-amber-200 dark:border-amber-700 bg-ux-surface px-4 py-4">
          {/* Server base URL */}
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-ux-border">
            <span className="text-xs font-semibold text-ux-text-sub w-32 flex-shrink-0">API Server</span>
            <TokenChip value="http://localhost:5182" />
            <span className="text-xs text-ux-text-sub">all /api/* routes are served here — no global auth</span>
          </div>

          {/* Per-connector credentials */}
          <div className="grid grid-cols-1 gap-3">
            {CREDENTIALS.map(c => {
              const col = CRED_COLORS[c.color];
              return (
                <div key={c.systemId} className={`border rounded-lg px-4 py-3 ${col.border} ${col.bg}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${col.dot}`} />
                    <span className={`text-xs font-bold ${col.text}`}>{c.system}</span>
                    <span className="text-ux-text-sub">({c.systemId})</span>
                    {c.connectorPort && (
                      <span className="text-ux-text-sub">Connector port: <span className="font-mono text-ux-text-sub">{c.connectorPort}</span></span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-[10px] text-ux-text-sub font-medium mb-1 uppercase tracking-wide">
                        Ingest Bearer Token
                        <span className="text-ux-text-sub">(Authorization header)</span>
                      </div>
                      <TokenChip value={`Bearer ${c.ingestToken}`} />
                    </div>
                    <div>
                      <div className="text-[10px] text-ux-text-sub font-medium mb-1 uppercase tracking-wide">
                        Registry Auth Token
                        <span className="text-ux-text-sub">(connector → GCUID registry)</span>
                      </div>
                      <TokenChip value={c.registryToken} />
                    </div>
                  </div>
                  <div className="text-ux-text-sub">{c.note}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 pt-3 border-t border-ux-border text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded px-3 py-2">
            ⚠ These tokens are staging-only PoC credentials. Only <code className="font-mono bg-amber-100 dark:bg-amber-800/60 px-1 rounded">POST /api/connectors/:id/ingest</code> enforces auth — all other endpoints are unauthenticated.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TestingPortal() {
  const [selectedGroupId, setSelectedGroupId] = useState<string>('gcuid');
  const [epStates, setEpStates] = useState<Record<string, EndpointState>>({});

  const getState = useCallback((ep: EndpointDef): EndpointState => {
    return epStates[ep.id] ?? initState(ep);
  }, [epStates]);

  const updateState = useCallback((id: string, patch: Partial<EndpointState>) => {
    setEpStates(prev => {
      const current = prev[id] ?? initState(GROUPS.flatMap(g => g.endpoints).find(e => e.id === id)!);
      return { ...prev, [id]: { ...current, ...patch } };
    });
  }, []);

  const handleToggle = useCallback((ep: EndpointDef) => {
    setEpStates(prev => {
      const current = prev[ep.id] ?? initState(ep);
      return { ...prev, [ep.id]: { ...current, expanded: !current.expanded } };
    });
  }, []);

  const handleExecute = useCallback(async (ep: EndpointDef) => {
    setEpStates(prev => {
      const current = prev[ep.id] ?? initState(ep);
      return { ...prev, [ep.id]: { ...current, loading: true, result: null, execError: null } };
    });

    const state = epStates[ep.id] ?? initState(ep);
    const url = buildUrl(ep.path, state.pathValues, state.queryValues);

    try {
      const headers: Record<string, string> = {};
      if (ep.method !== 'GET' && ep.method !== 'DELETE') {
        headers['Content-Type'] = 'application/json';
      }
      for (const [k, v] of Object.entries(state.headerValues)) {
        if (v) headers[k] = v;
      }

      const opts: RequestInit = { method: ep.method, headers };
      if (state.body && ep.method !== 'GET') {
        opts.body = state.body;
      }

      const start = Date.now();
      const resp = await fetch(url, opts);
      const latencyMs = Date.now() - start;
      const rawBody = await resp.text();

      setEpStates(prev => ({
        ...prev,
        [ep.id]: {
          ...(prev[ep.id] ?? initState(ep)),
          loading: false,
          result: { status: resp.status, statusText: resp.statusText, latencyMs, rawBody },
        },
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setEpStates(prev => ({
        ...prev,
        [ep.id]: {
          ...(prev[ep.id] ?? initState(ep)),
          loading: false,
          execError: `Network error: ${msg}`,
        },
      }));
    }
  }, [epStates]);

  const selectedGroup = GROUPS.find(g => g.id === selectedGroupId) ?? GROUPS[0];

  return (
    <UXScopeWrapper scopeId="portal-system">
    <div className="flex flex-col gap-0">
      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ux-text">API Testing Console</h1>
        <p className="mt-1 text-sm text-ux-text-sub">
          System operator debug interface — direct access to all {GROUPS.reduce((n, g) => n + g.endpoints.length, 0)} API
          endpoints. Defaults are pre-filled; override any value to test error conditions.
        </p>
      </div>

      {/* Credentials reference panel */}
      <CredentialsPanel />

      <div className="flex gap-4 min-h-0">
        {/* Sidebar */}
        <aside className="w-52 flex-shrink-0 bg-ux-surface border border-ux-border rounded-lg overflow-hidden self-start sticky top-4">
          <div className="px-3 py-2 border-b border-ux-border bg-ux-surface-alt">
            <span className="text-ux-text-sub">API Groups</span>
          </div>
          <nav className="py-1">
            {GROUPS.map(g => {
              const c = GROUP_COLORS[g.color] ?? GROUP_COLORS.slate;
              const isActive = g.id === selectedGroupId;
              return (
                <button
                  key={g.id}
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${isActive ? c.active : c.inactive}`}
                >
                  <span className={`h-2 w-2 rounded-full flex-shrink-0 ${c.dot}`} />
                  <span className="flex-1 font-medium truncate">{g.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.badge}`}>
                    {g.endpoints.length}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="text-ux-text-sub">
            {GROUPS.reduce((n, g) => n + g.endpoints.length, 0)} endpoints total
          </div>
        </aside>

        {/* Endpoint list */}
        <div className="flex-1 min-w-0">
          {/* Group header */}
          <div className="flex items-center gap-2 mb-4">
            <span className={`h-2.5 w-2.5 rounded-full ${GROUP_COLORS[selectedGroup.color]?.dot ?? 'bg-gray-400'}`} />
            <h2 className={`text-sm font-bold uppercase tracking-wider ${GROUP_COLORS[selectedGroup.color]?.headingDot ?? 'text-ux-text-sub'}`}>
              {selectedGroup.label}
            </h2>
            <span className="text-xs text-ux-text-sub">— {selectedGroup.endpoints.length} endpoints</span>
            {selectedGroup.connectorPort && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-ux-surface border border-ux-border text-ux-text-sub">
                {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5181'}
                <span className="text-ux-muted mx-1">⇢</span>
                http://localhost:{selectedGroup.connectorPort}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => {
                  const updates: Record<string, EndpointState> = {};
                  for (const ep of selectedGroup.endpoints) {
                    const s = epStates[ep.id] ?? initState(ep);
                    updates[ep.id] = { ...s, expanded: true };
                  }
                  setEpStates(prev => ({ ...prev, ...updates }));
                }}
                className="text-xs text-blue-700 hover:text-blue-900 dark:text-blue-300"
              >
                Expand all
              </button>
              <span className="text-ux-muted">|</span>
              <button
                onClick={() => {
                  const updates: Record<string, EndpointState> = {};
                  for (const ep of selectedGroup.endpoints) {
                    const s = epStates[ep.id] ?? initState(ep);
                    updates[ep.id] = { ...s, expanded: false };
                  }
                  setEpStates(prev => ({ ...prev, ...updates }));
                }}
                className="text-xs text-blue-700 hover:text-blue-900 dark:text-blue-300"
              >
                Collapse all
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {selectedGroup.endpoints.map(ep => (
              <EndpointCard
                key={ep.id}
                ep={ep}
                state={getState(ep)}
                connectorPort={selectedGroup.connectorPort}
                onToggle={() => handleToggle(ep)}
                onUpdate={patch => updateState(ep.id, patch)}
                onExecute={() => handleExecute(ep)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
    </UXScopeWrapper>
  );
}
