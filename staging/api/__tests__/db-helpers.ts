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
 * Test database seeding helpers.
 *
 * Every test that boots the express app needs a registry.db and four
 * connector .db files. We seed them from a minimum set of inline DDL
 * statements (no dependency on the staging seed-data.ts script, which
 * would re-run against the live DB).
 *
 * Each helper takes the temp dataDir and creates the expected files
 * with the schemas the route code reads.
 */

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

// ── Schemas ────────────────────────────────────────────────────────────────

const REGISTRY_SCHEMA = `
  CREATE TABLE identities (
    gcuid TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'provisional',
    entity_type TEXT NOT NULL DEFAULT 'person',
    entity_id TEXT,
    identifier_state TEXT NOT NULL DEFAULT 'reserved',
    superseded_by TEXT,
    namespace TEXT DEFAULT 'gc',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata TEXT
  );

  CREATE TABLE state_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gcuid TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT NOT NULL,
    transition_type TEXT NOT NULL,
    reason TEXT,
    actor TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (gcuid) REFERENCES identities(gcuid)
  );

  CREATE TABLE aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gcuid TEXT NOT NULL,
    alias_type TEXT NOT NULL,
    alias_value TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'enabled',
    created_at TEXT NOT NULL,
    metadata TEXT,
    UNIQUE(gcuid, alias_type, alias_value),
    FOREIGN KEY (gcuid) REFERENCES identities(gcuid)
  );

  CREATE TABLE source_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gcuid TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_id TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    verified_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(source_system, source_id),
    FOREIGN KEY (gcuid) REFERENCES identities(gcuid)
  );

  CREATE TABLE pending_linkages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gcuid TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_id TEXT NOT NULL,
    confidence REAL NOT NULL,
    strategy TEXT NOT NULL,
    candidate_attributes TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(gcuid, source_system, source_id)
  );

  CREATE TABLE caes_attribute_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_system TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    source_field TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source_system, canonical_name)
  );

  CREATE TABLE caes_match_strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_system TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    description TEXT,
    threshold REAL NOT NULL,
    min_confidence REAL,
    weight REAL NOT NULL DEFAULT 1.0,
    required_attributes TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE(source_system, strategy_id)
  );

  CREATE INDEX idx_identities_state ON identities(state);
  CREATE INDEX idx_identities_identifier_state ON identities(identifier_state);
  CREATE INDEX idx_identities_entity ON identities(entity_type, entity_id);
  CREATE INDEX idx_history_gcuid ON state_history(gcuid);
  CREATE INDEX idx_aliases_gcuid ON aliases(gcuid);
  CREATE INDEX idx_aliases_value ON aliases(alias_value);
  CREATE INDEX idx_source_mappings_gcuid ON source_mappings(gcuid);
  CREATE INDEX idx_source_mappings_source ON source_mappings(source_system, source_id);
  CREATE INDEX idx_pending_linkages_gcuid ON pending_linkages(gcuid);
`;

const HR_SCHEMA = `
  CREATE TABLE employees (
    employee_id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    department TEXT NOT NULL,
    job_title TEXT NOT NULL,
    employment_type TEXT NOT NULL,
    hire_date TEXT NOT NULL,
    salary INTEGER,
    manager_id TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const LDAP_SCHEMA = `
  CREATE TABLE users (
    username TEXT PRIMARY KEY,
    distinguished_name TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    department TEXT NOT NULL,
    title TEXT,
    account_enabled INTEGER DEFAULT 1,
    groups TEXT,
    last_logon TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const ENG_SCHEMA = `
  CREATE TABLE employees (
    dept_id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    employment_type TEXT NOT NULL,
    hr_employee_id TEXT,
    ldap_username TEXT,
    skills TEXT,
    manager_dept_id TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    gcuid TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const FIN_SCHEMA = ENG_SCHEMA; // finance uses the same shape as engineering

// ── Seeders ────────────────────────────────────────────────────────────────

export interface SeedOptions {
  skipRegistry?: boolean;
  skipConnectors?: boolean;
}

export function seedAllDbs(dataDir: string, opts: SeedOptions = {}): void {
  fs.mkdirSync(path.join(dataDir, 'sources'), { recursive: true });
  if (!opts.skipRegistry) {
    seedRegistry(path.join(dataDir, 'registry.db'));
  }
  if (!opts.skipConnectors) {
    seedConnector(path.join(dataDir, 'sources', 'conn-hr.db'), HR_SCHEMA);
    seedConnector(path.join(dataDir, 'sources', 'conn-ldap.db'), LDAP_SCHEMA);
    seedConnector(path.join(dataDir, 'sources', 'conn-engineering.db'), ENG_SCHEMA);
    seedConnector(path.join(dataDir, 'sources', 'conn-finance.db'), FIN_SCHEMA);
  }
}

/** Seed only the registry DB; useful for tests that don't touch sources. */
export function seedRegistryOnly(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  seedRegistry(path.join(dataDir, 'registry.db'));
}

function seedRegistry(filePath: string): void {
  const db = new Database(filePath);
  db.exec(REGISTRY_SCHEMA);
  db.close();
}

function seedConnector(filePath: string, schema: string): void {
  const db = new Database(filePath);
  db.exec(schema);
  db.close();
}

// ── Row inserters ──────────────────────────────────────────────────────────

export interface IdentityRow {
  gcuid: string;
  state?: 'provisional' | 'active' | 'suspended' | 'retired' | 'under_review' | 'nullified';
  identifier_state?: 'reserved' | 'issued' | 'superseded' | 'nullified';
  superseded_by?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, any>;
  namespace?: string;
  created_at?: string;
  updated_at?: string;
}

export function insertIdentity(registryPath: string, row: IdentityRow): void {
  const db = new Database(registryPath);
  const now = row.created_at ?? new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO identities
      (gcuid, state, entity_type, entity_id, identifier_state, superseded_by,
       namespace, created_at, updated_at, metadata)
    VALUES (?, ?, 'person', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.gcuid,
    row.state ?? 'provisional',
    row.entity_id ?? null,
    row.identifier_state ?? 'reserved',
    row.superseded_by ?? null,
    row.namespace ?? 'gc',
    now,
    row.updated_at ?? now,
    JSON.stringify(row.metadata ?? {}),
  );
  db.close();
}

export interface AliasRow {
  gcuid: string;
  alias_type: string;
  alias_value: string;
  status?: 'enabled' | 'disabled';
}

export function insertAlias(registryPath: string, row: AliasRow): void {
  const db = new Database(registryPath);
  db.prepare(`
    INSERT OR REPLACE INTO aliases
      (gcuid, alias_type, alias_value, status, created_at, metadata)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(
    row.gcuid,
    row.alias_type,
    row.alias_value,
    row.status ?? 'enabled',
    new Date().toISOString(),
  );
  db.close();
}

export interface SourceMappingRow {
  gcuid: string;
  source_system: 'hr' | 'ldap' | 'engineering' | 'finance';
  source_id: string;
  is_primary?: boolean;
  verified_at?: string | null;
}

export function insertSourceMapping(registryPath: string, row: SourceMappingRow): void {
  const db = new Database(registryPath);
  db.prepare(`
    INSERT OR REPLACE INTO source_mappings
      (gcuid, source_system, source_id, is_primary, verified_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    row.gcuid,
    row.source_system,
    row.source_id,
    row.is_primary ? 1 : 0,
    row.verified_at ?? null,
    new Date().toISOString(),
  );
  db.close();
}

export function insertHrEmployee(connectorDir: string, row: {
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  department: string;
  job_title?: string;
  employment_type?: string;
  hire_date?: string;
  status?: string;
}): void {
  const db = new Database(path.join(connectorDir, 'conn-hr.db'));
  db.prepare(`
    INSERT OR REPLACE INTO employees
      (employee_id, first_name, last_name, email, department, job_title, employment_type, hire_date, salary, manager_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
  `).run(
    row.employee_id, row.first_name, row.last_name, row.email, row.department,
    row.job_title ?? 'Engineer', row.employment_type ?? 'FTE',
    row.hire_date ?? '2026-01-01', row.status ?? 'active',
    new Date().toISOString(), new Date().toISOString(),
  );
  db.close();
}

export function insertLdapUser(connectorDir: string, row: {
  username: string;
  distinguished_name?: string;
  email: string;
  first_name: string;
  last_name: string;
  department: string;
  title?: string;
  account_enabled?: number;
}): void {
  const db = new Database(path.join(connectorDir, 'conn-ldap.db'));
  db.prepare(`
    INSERT OR REPLACE INTO users
      (username, distinguished_name, email, first_name, last_name, department, title, account_enabled, groups, last_logon, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, ?, ?)
  `).run(
    row.username,
    row.distinguished_name ?? `CN=${row.username},OU=Users,DC=agency,DC=gov`,
    row.email, row.first_name, row.last_name, row.department,
    row.title ?? null, row.account_enabled ?? 1,
    new Date().toISOString(), new Date().toISOString(),
  );
  db.close();
}

export function insertEngEmployee(connectorDir: string, row: {
  dept_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role?: string;
  employment_type?: string;
  hr_employee_id?: string;
  ldap_username?: string;
  start_date?: string;
  status?: string;
}): void {
  const db = new Database(path.join(connectorDir, 'conn-engineering.db'));
  db.prepare(`
    INSERT OR REPLACE INTO employees
      (dept_id, first_name, last_name, email, role, employment_type, hr_employee_id, ldap_username, skills, manager_dept_id, start_date, end_date, gcuid, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, ?, NULL, NULL, ?, ?, ?)
  `).run(
    row.dept_id, row.first_name, row.last_name, row.email,
    row.role ?? 'Engineer', row.employment_type ?? 'FTE',
    row.hr_employee_id ?? null, row.ldap_username ?? null,
    row.start_date ?? '2026-01-01', row.status ?? 'active',
    new Date().toISOString(), new Date().toISOString(),
  );
  db.close();
}

export function insertFinEmployee(connectorDir: string, row: {
  dept_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role?: string;
  hr_employee_id?: string;
  start_date?: string;
  status?: string;
}): void {
  const db = new Database(path.join(connectorDir, 'conn-finance.db'));
  db.prepare(`
    INSERT OR REPLACE INTO employees
      (dept_id, first_name, last_name, email, role, employment_type, hr_employee_id, ldap_username, skills, manager_dept_id, start_date, end_date, gcuid, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, ?, NULL, NULL, ?, ?, ?)
  `).run(
    row.dept_id, row.first_name, row.last_name, row.email,
    row.role ?? 'Analyst', 'FTE', row.hr_employee_id ?? null, null,
    row.start_date ?? '2026-01-01', row.status ?? 'active',
    new Date().toISOString(), new Date().toISOString(),
  );
  db.close();
}
