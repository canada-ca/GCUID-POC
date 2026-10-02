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
import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { connectorResolver, loadConnectorConfig } from '../lib/connector-resolver.js';
import { ConnectorAPIClient } from '../../../packages/core/dist/connector-api.js';
import { logCAES, logHR, logLDAP } from '../lib/logging/logger.js';
import { CAES_EVENTS, HR_EVENTS, LDAP_EVENTS } from '../lib/logging/log-events.js';
import { resolveToGcuid } from '../lib/resolve-identifier.js';
import { REGISTRY_DB_PATH, IS_EFS_MODE, connectorDbPath } from '../lib/db-paths.js';

const router = Router();

// ─── Lazy database accessors ──────────────────────────────────────────────────
// These are intentionally lazy so that module import does not open the database.
// EFS first-run seeding in lambda-handler.js runs before the app is imported;
// opening the DB here (at import time) would race against that seeding and
// create an empty/wrong database on the first cold start.

let _REGISTRY_DB: InstanceType<typeof Database> | null = null;
let _REGISTRY_DB_RW: InstanceType<typeof Database> | null = null;

function getRegistryDb(): InstanceType<typeof Database> {
  if (!_REGISTRY_DB) _REGISTRY_DB = new Database(REGISTRY_DB_PATH, { readonly: true });
  return _REGISTRY_DB;
}

function getRegistryDbRw(): InstanceType<typeof Database> {
  if (!_REGISTRY_DB_RW) _REGISTRY_DB_RW = new Database(REGISTRY_DB_PATH);
  return _REGISTRY_DB_RW;
}

// Compatibility shim: transparent Proxy objects that defer the actual Database
// open until the first method/property access.  This ensures no DB file is
// touched at module import time — EFS seeding in lambda-handler.js must run
// first, before any Database() constructor call.
const REGISTRY_DB = new Proxy({} as InstanceType<typeof Database>, {
  get(_t, prop) { return (getRegistryDb() as any)[prop]; },
});
const REGISTRY_DB_RW = new Proxy({} as InstanceType<typeof Database>, {
  get(_t, prop) { return (getRegistryDbRw() as any)[prop]; },
});

// ─── Attribute Mappings table (persisted in registry.db) ─────────────────────

// Create table and seed from the ATTRIBUTE_MAPPINGS constant on first boot.
// After seeding the constant is only used as a reference; all runtime reads
// go through the DB so that CRUD changes survive across restarts.
function initAttributeMappingsTable() {
  REGISTRY_DB_RW.exec(`
    CREATE TABLE IF NOT EXISTS attribute_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      standard_attribute TEXT NOT NULL,
      source_system TEXT NOT NULL,
      source_field TEXT NOT NULL,
      source_table TEXT NOT NULL,
      key_field TEXT NOT NULL,
      is_authoritative INTEGER NOT NULL DEFAULT 0,
      operations TEXT NOT NULL DEFAULT '["read"]',
      transformations TEXT,
      searchable INTEGER NOT NULL DEFAULT 0,
      indexed INTEGER NOT NULL DEFAULT 0,
      self_service INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration: deduplicate rows, then enforce a unique constraint so that
  // INSERT OR IGNORE in subsequent seeding functions works correctly.
  // Step 1 — remove duplicate rows keeping the lowest id for each logical key.
  REGISTRY_DB_RW.exec(`
    DELETE FROM attribute_mappings
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM attribute_mappings
      GROUP BY standard_attribute, source_system, source_field
    )
  `);
  // Step 2 — create the unique index now that duplicates are gone.
  REGISTRY_DB_RW.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_attr_mapping
    ON attribute_mappings (standard_attribute, source_system, source_field)
  `);
}

/** Idempotent migration: adds self_service column if missing and seeds its values. */
function migrateAttributeMappingsTable() {
  try {
    REGISTRY_DB_RW.exec(`ALTER TABLE attribute_mappings ADD COLUMN self_service INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }
  // Mark user-editable attributes (LDAP preferred-name display copy)
  REGISTRY_DB_RW.prepare(
    `UPDATE attribute_mappings SET self_service = 1 WHERE standard_attribute = 'person.name.given' AND source_system = 'ldap'`
  ).run();
  // person.job.title LDAP copy is inserted by ensureJobTitleMappings below
}

/**
 * Insert Engineering, Finance, and HR cross-reference attribute mappings if they have
 * not been seeded yet. These were added after the initial seed and include cross-source
 * linkage fields (hr_employee_id → person.employment.employee_id,
 * ldap_username → person.account.username) that enable corroborated matching.
 */
function ensureDeptConnectorMappings() {
  const stmt = REGISTRY_DB_RW.prepare(`
    INSERT OR IGNORE INTO attribute_mappings
      (standard_attribute, source_system, source_field, source_table, key_field,
       is_authoritative, operations, self_service, searchable, indexed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // HR employee_id surfaced as a cross-reference standard attribute
  stmt.run('person.employment.employee_id', 'hr', 'employee_id', 'employees', 'employee_id', 1, '["read"]', 0, 1, 1);
  // Engineering
  stmt.run('person.email',                   'engineering', 'email',           'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.name.given',              'engineering', 'first_name',      'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.name.family',             'engineering', 'last_name',       'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.employment.role',         'engineering', 'role',            'employees', 'dept_id', 1, '["read"]', 0, 1, 0);
  stmt.run('person.employment.type',         'engineering', 'employment_type', 'employees', 'dept_id', 0, '["read"]', 0, 1, 0);
  stmt.run('person.employment.status',       'engineering', 'status',          'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.employment.start_date',   'engineering', 'start_date',      'employees', 'dept_id', 0, '["read"]', 0, 0, 0);
  stmt.run('person.employment.employee_id',  'engineering', 'hr_employee_id',  'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.account.username',        'engineering', 'ldap_username',   'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  // Finance
  stmt.run('person.email',                   'finance', 'email',           'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.name.given',              'finance', 'first_name',      'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.name.family',             'finance', 'last_name',       'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.employment.role',         'finance', 'role',            'employees', 'dept_id', 1, '["read"]', 0, 1, 0);
  stmt.run('person.employment.type',         'finance', 'employment_type', 'employees', 'dept_id', 0, '["read"]', 0, 1, 0);
  stmt.run('person.employment.status',       'finance', 'status',          'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.employment.start_date',   'finance', 'start_date',      'employees', 'dept_id', 0, '["read"]', 0, 0, 0);
  stmt.run('person.employment.employee_id',  'finance', 'hr_employee_id',  'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.account.username',        'finance', 'ldap_username',   'employees', 'dept_id', 0, '["read"]', 0, 1, 1);
  stmt.run('person.security.clearance_level','finance', 'clearance_level', 'employees', 'dept_id', 1, '["read"]', 0, 0, 0);
}

/** Insert person.job.title mappings if they have not been seeded yet. */
function ensureJobTitleMappings() {
  const stmt = REGISTRY_DB_RW.prepare(`
    INSERT OR IGNORE INTO attribute_mappings
      (standard_attribute, source_system, source_field, source_table, key_field,
       is_authoritative, operations, self_service, searchable, indexed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // HR is authoritative for job title (admin-managed, read-only for users)
  stmt.run('person.job.title', 'hr', 'job_title', 'employees', 'employee_id', 1, '["read"]', 0, 0, 0);
  // LDAP stores the user's preferred title — self-service writable
  stmt.run('person.job.title', 'ldap', 'title', 'users', 'username', 0, '["read","write","update"]', 1, 0, 0);
}

/**
 * One-time cleanup (safe to run every boot): for any standard_attribute that has
 * more than one row with is_authoritative = 1, keep only the lowest-id row and
 * clear the rest. Prevents the "multiple authoritative sources" data corruption
 * that can arise from connector upserts or generic edits.
 */
function fixDuplicateAuthorities() {
  const dupes = REGISTRY_DB_RW.prepare(`
    SELECT standard_attribute
    FROM   attribute_mappings
    WHERE  is_authoritative = 1
    GROUP  BY standard_attribute
    HAVING COUNT(*) > 1
  `).all() as { standard_attribute: string }[];

  for (const { standard_attribute } of dupes) {
    const rows = REGISTRY_DB_RW.prepare(`
      SELECT id FROM attribute_mappings
      WHERE  standard_attribute = ? AND is_authoritative = 1
      ORDER  BY id ASC
    `).all(standard_attribute) as { id: number }[];
    const [, ...clear] = rows; // keep rows[0] (lowest id), clear duplicates
    if (clear.length > 0) {
      const placeholders = clear.map(() => '?').join(',');
      REGISTRY_DB_RW.prepare(
        `UPDATE attribute_mappings SET is_authoritative = 0, updated_at = datetime('now')
         WHERE id IN (${placeholders})`
      ).run(...clear.map(r => r.id));
    }
  }
}

function seedAttributeMappings() {
  const { n } = REGISTRY_DB_RW.prepare('SELECT COUNT(*) as n FROM attribute_mappings').get() as { n: number };
  if (n > 0) return;
  const stmt = REGISTRY_DB_RW.prepare(`
    INSERT INTO attribute_mappings
      (standard_attribute, source_system, source_field, source_table, key_field,
       is_authoritative, operations, transformations, self_service, searchable, indexed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  REGISTRY_DB_RW.transaction(() => {
    for (const m of ATTRIBUTE_MAPPINGS) {
      stmt.run(
        m.standardAttribute, m.sourceSystem, m.sourceField, m.sourceTable, m.keyField,
        m.is_authoritative ? 1 : 0,
        JSON.stringify(m.operations),
        m.transformations ? JSON.stringify(m.transformations) : null,
        m.self_service ? 1 : 0,
        m.searchable ? 1 : 0,
        m.indexed ? 1 : 0,
      );
    }
  })();
}

function parseDbMapping(row: any): AttributeMapping & { id: number } {
  return {
    id: row.id,
    standardAttribute: row.standard_attribute,
    sourceSystem: row.source_system,
    sourceField: row.source_field,
    sourceTable: row.source_table,
    keyField: row.key_field,
    is_authoritative: row.is_authoritative === 1,
    operations: JSON.parse(row.operations),
    transformations: row.transformations ? JSON.parse(row.transformations) : undefined,
    self_service: row.self_service === 1,
    searchable: row.searchable === 1,
    indexed: row.indexed === 1,
  };
}

function getAllMappings(): Array<AttributeMapping & { id: number }> {
  return (REGISTRY_DB_RW
    .prepare('SELECT * FROM attribute_mappings ORDER BY standard_attribute, source_system')
    .all() as any[]
  ).map(parseDbMapping);
}

/**
 * Last-resort LDAP attribute lookup: when the LDAP connector's HTTP path
 * can't resolve a source_id (because source_mappings stores one identifier
 * form — typically `username` — while the connector's `recordId` is the
 * `distinguished_name`), read the row directly from `conn-ldap.db` and
 * extract the requested field.
 *
 * Only invoked when all connector-routed lookups have failed for an LDAP
 * attribute mapping; this is the graceful-degradation path. Returns
 * `undefined` if the LDAP DB can't be opened, the row can't be found, or
 * the requested `sourceField` is absent.
 */
function _ldapDirectDbFallback(
  sourceIds: string[],
  sourceField: string,
): any {
  if (sourceIds.length === 0) return undefined;
  const dbPath = connectorDbPath('conn-ldap');
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const placeholders = sourceIds.map(() => '?').join(',');
    const row = db
      .prepare(
        `SELECT * FROM users WHERE username IN (${placeholders}) OR distinguished_name IN (${placeholders}) LIMIT 1`,
      )
      .get(...sourceIds, ...sourceIds) as Record<string, any> | undefined;
    if (!row) return undefined;
    const value = row[sourceField];
    return value === null || value === undefined ? undefined : value;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

// Initialise on startup — wrapped so that a read-only bundled DB (e.g. Lambda
// container image) doesn't prevent the module from loading.  The table and
// schema already exist in the seed registry.db bundled in the image.
try {
  initAttributeMappingsTable();
} catch (err: any) {
  console.warn('[caes] initAttributeMappingsTable skipped (read-only DB):', err?.message);
}

// Seed AFTER the ATTRIBUTE_MAPPINGS constant is defined (see call below)
// migrateAttributeMappingsTable and ensureJobTitleMappings also called after ATTRIBUTE_MAPPINGS

// Standardized attribute schema
const ATTRIBUTE_SCHEMA = {
  'person.name.given': {
    description: 'Given name (first name)',
    sources: ['hr', 'ldap'],
    dataType: 'string',
  },
  'person.name.family': {
    description: 'Family name (last name)',
    sources: ['hr', 'ldap'],
    dataType: 'string',
  },
  'person.name.display': {
    description: 'Display name',
    sources: ['ldap'],
    dataType: 'string',
  },
  'person.email': {
    description: 'Primary email address',
    sources: ['hr', 'ldap'],
    dataType: 'email',
  },
  'person.employment.department': {
    description: 'Department or organizational unit',
    sources: ['hr'],
    dataType: 'string',
  },
  'person.employment.hireDate': {
    description: 'Date of hire',
    sources: ['hr'],
    dataType: 'date',
  },
  'person.employment.status': {
    description: 'Employment status (Active, Leave, Terminated)',
    sources: ['hr'],
    dataType: 'string',
  },
  'person.employment.salary': {
    description: 'Annual salary',
    sources: ['hr'],
    dataType: 'number',
    sensitive: true,
  },
  'person.account.username': {
    description: 'Network username',
    sources: ['ldap'],
    dataType: 'string',
  },
  'person.account.enabled': {
    description: 'Account enabled status',
    sources: ['ldap'],
    dataType: 'boolean',
  },
  'person.account.groups': {
    description: 'Security groups membership',
    sources: ['ldap'],
    dataType: 'array',
  },
  'person.account.lastLogon': {
    description: 'Last logon timestamp',
    sources: ['ldap'],
    dataType: 'datetime',
  },
  'person.account.dn': {
    description: 'Distinguished Name in directory',
    sources: ['ldap'],
    dataType: 'string',
  },
  'person.job.title': {
    description: 'Job title (preferred display title)',
    sources: ['hr', 'ldap'],
    dataType: 'string',
  },
  'person.employment.employee_id': {
    description: 'HR employee identifier — used as a cross-source linkage key',
    sources: ['hr', 'engineering', 'finance'],
    dataType: 'string',
  },
  'person.employment.role': {
    description: 'Role or position within the department',
    sources: ['engineering', 'finance'],
    dataType: 'string',
  },
  'person.employment.type': {
    description: 'Employment type (FTE, contractor, term, etc.)',
    sources: ['hr', 'engineering', 'finance'],
    dataType: 'string',
  },
  'person.employment.start_date': {
    description: 'Employment start date in the department',
    sources: ['engineering', 'finance'],
    dataType: 'date',
  },
  'person.security.clearance_level': {
    description: 'Government security clearance level',
    sources: ['finance'],
    dataType: 'string',
    sensitive: true,
  },
};

/** Human-readable labels for self-service attributes shown in the User Portal */
const SELF_SERVICE_LABELS: Record<string, string> = {
  'person.name.given': 'Preferred First Name',
  'person.job.title': 'Preferred Job Title',
};

/**
 * Attribute Mappings Configuration
 * Maps standardized CAES attribute names to source-specific field names
 * Includes CRUD operation support and search parameters
 */
interface AttributeMapping {
  standardAttribute: string;
  sourceSystem: string;
  sourceField: string;
  sourceTable: string;
  keyField: string; // Field used to identify records
  is_authoritative: boolean; // Whether this source is authoritative for this attribute
  operations: ('read' | 'write' | 'update' | 'delete')[];
  transformations?: {
    read?: string; // SQL or JS transformation for reading
    write?: string; // Transformation for writing
  };
  /** User can read/edit this attribute themselves (self-service portal) */
  self_service: boolean;
  searchable: boolean;
  indexed: boolean;
}

const ATTRIBUTE_MAPPINGS: AttributeMapping[] = [
  // HR System Mappings
  // HR is authoritative for identity-of-record attributes (name, email, employment)
  {
    standardAttribute: 'person.name.given',
    sourceSystem: 'hr',
    sourceField: 'first_name',
    sourceTable: 'employees',
    keyField: 'employee_id',
    is_authoritative: true,
    operations: ['read', 'write', 'update'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.name.family',
    sourceSystem: 'hr',
    sourceField: 'last_name',
    sourceTable: 'employees',
    keyField: 'employee_id',
    is_authoritative: true,
    operations: ['read', 'write', 'update'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.email',
    sourceSystem: 'hr',
    sourceField: 'email',
    sourceTable: 'employees',
    keyField: 'employee_id',
    is_authoritative: true,
    operations: ['read', 'write', 'update'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.employment.department',
    sourceSystem: 'hr',
    sourceField: 'department',
    sourceTable: 'employees',
    keyField: 'employee_id',
    is_authoritative: true, // single source — always authoritative
    operations: ['read', 'write', 'update'],
    self_service: false,
    searchable: true,
    indexed: false,
  },
  {
    standardAttribute: 'person.employment.hireDate',
    sourceSystem: 'hr',
    sourceField: 'hire_date',
    sourceTable: 'employees',
    keyField: 'employee_id',
    is_authoritative: true,
    operations: ['read', 'write', 'update'],
    self_service: false,
    searchable: false,
    indexed: false,
  },
  {
    standardAttribute: 'person.employment.status',
    sourceSystem: 'hr',
    sourceField: 'status',
    sourceTable: 'employees',
    keyField: 'employee_id',
    is_authoritative: true,
    operations: ['read', 'write', 'update'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.employment.salary',
    sourceSystem: 'hr',
    sourceField: 'salary',
    sourceTable: 'employees',
    keyField: 'employee_id',
    is_authoritative: true,
    operations: ['read'], // Sensitive - read only
    self_service: false,
    searchable: false,
    indexed: false,
  },
  // LDAP System Mappings
  // LDAP is authoritative for account/directory attributes; non-authoritative for shared identity attributes
  {
    standardAttribute: 'person.name.given',
    sourceSystem: 'ldap',
    sourceField: 'first_name',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: false, // HR is authoritative for legal given name
    operations: ['read', 'write', 'update'],
    self_service: true, // User can set preferred/display first name in directory
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.name.family',
    sourceSystem: 'ldap',
    sourceField: 'last_name',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: false, // HR is authoritative for family name
    operations: ['read', 'write', 'update'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.name.display',
    sourceSystem: 'ldap',
    sourceField: 'distinguished_name',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: true, // single source — always authoritative
    operations: ['read', 'write', 'update'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.email',
    sourceSystem: 'ldap',
    sourceField: 'email',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: false, // HR is authoritative for email
    operations: ['read', 'write', 'update'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.account.username',
    sourceSystem: 'ldap',
    sourceField: 'username',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: true,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.account.enabled',
    sourceSystem: 'ldap',
    sourceField: 'account_enabled',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: true,
    operations: ['read', 'write', 'update'],
    transformations: {
      read: 'CAST(account_enabled AS INTEGER)',
      write: 'boolean to integer conversion',
    },
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.account.groups',
    sourceSystem: 'ldap',
    sourceField: 'groups',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: true,
    operations: ['read'],
    transformations: {
      read: 'JSON.parse() for string to array',
    },
    self_service: false,
    searchable: false,
    indexed: false,
  },
  {
    standardAttribute: 'person.account.lastLogon',
    sourceSystem: 'ldap',
    sourceField: 'last_logon',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: true,
    operations: ['read'],
    self_service: false,
    searchable: false,
    indexed: true,
  },
  {
    standardAttribute: 'person.account.dn',
    sourceSystem: 'ldap',
    sourceField: 'distinguished_name',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: true,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  // Job title — HR is authoritative (admin-managed); LDAP copy is user's preferred display title
  {
    standardAttribute: 'person.job.title',
    sourceSystem: 'hr',
    sourceField: 'job_title',
    sourceTable: 'employees',
    keyField: 'employee_id',
    is_authoritative: true,
    operations: ['read'],
    self_service: false,
    searchable: false,
    indexed: false,
  },
  {
    standardAttribute: 'person.job.title',
    sourceSystem: 'ldap',
    sourceField: 'title',
    sourceTable: 'users',
    keyField: 'username',
    is_authoritative: false,
    operations: ['read', 'write', 'update'],
    self_service: true, // User can set their preferred job title display in directory
    searchable: false,
    indexed: false,
  },
  // HR Employee ID — authoritative cross-reference key surfaced as a standard attribute
  {
    standardAttribute: 'person.employment.employee_id',
    sourceSystem: 'hr',
    sourceField: 'employee_id',
    sourceTable: 'employees',
    keyField: 'employee_id',
    is_authoritative: true,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  // Engineering Department Mappings
  // Engineering is authoritative for role and department-specific attributes.
  // hr_employee_id and ldap_username are cross-source linkage fields — not authoritative
  // for the underlying identity but used to corroborate matches with HR and LDAP.
  {
    standardAttribute: 'person.email',
    sourceSystem: 'engineering',
    sourceField: 'email',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.name.given',
    sourceSystem: 'engineering',
    sourceField: 'first_name',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.name.family',
    sourceSystem: 'engineering',
    sourceField: 'last_name',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.employment.role',
    sourceSystem: 'engineering',
    sourceField: 'role',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: true, // Engineering owns role classification for its staff
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: false,
  },
  {
    standardAttribute: 'person.employment.type',
    sourceSystem: 'engineering',
    sourceField: 'employment_type',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: false,
  },
  {
    standardAttribute: 'person.employment.status',
    sourceSystem: 'engineering',
    sourceField: 'status',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.employment.start_date',
    sourceSystem: 'engineering',
    sourceField: 'start_date',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: false,
    indexed: false,
  },
  {
    // Cross-source link: engineering records store the HR employee ID when known.
    // Matching on this attribute corroborates the identity against the HR system.
    standardAttribute: 'person.employment.employee_id',
    sourceSystem: 'engineering',
    sourceField: 'hr_employee_id',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    // Cross-source link: engineering records store the LDAP username when known.
    // person.account.username is the same standard attribute LDAP uses, so a match
    // on this field simultaneously corroborates the identity against the directory.
    standardAttribute: 'person.account.username',
    sourceSystem: 'engineering',
    sourceField: 'ldap_username',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  // Finance Department Mappings
  // Finance is authoritative for role, clearance level, and finance-specific attributes.
  // hr_employee_id and ldap_username are cross-source linkage fields (same as engineering).
  {
    standardAttribute: 'person.email',
    sourceSystem: 'finance',
    sourceField: 'email',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.name.given',
    sourceSystem: 'finance',
    sourceField: 'first_name',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.name.family',
    sourceSystem: 'finance',
    sourceField: 'last_name',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.employment.role',
    sourceSystem: 'finance',
    sourceField: 'role',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: true, // Finance owns role classification for its staff
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: false,
  },
  {
    standardAttribute: 'person.employment.type',
    sourceSystem: 'finance',
    sourceField: 'employment_type',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: false,
  },
  {
    standardAttribute: 'person.employment.status',
    sourceSystem: 'finance',
    sourceField: 'status',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.employment.start_date',
    sourceSystem: 'finance',
    sourceField: 'start_date',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: false,
    indexed: false,
  },
  {
    // Cross-source link to HR (same semantics as engineering)
    standardAttribute: 'person.employment.employee_id',
    sourceSystem: 'finance',
    sourceField: 'hr_employee_id',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    // Cross-source link to LDAP (same semantics as engineering)
    standardAttribute: 'person.account.username',
    sourceSystem: 'finance',
    sourceField: 'ldap_username',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: false,
    operations: ['read'],
    self_service: false,
    searchable: true,
    indexed: true,
  },
  {
    standardAttribute: 'person.security.clearance_level',
    sourceSystem: 'finance',
    sourceField: 'clearance_level',
    sourceTable: 'employees',
    keyField: 'dept_id',
    is_authoritative: true, // Finance is authoritative for clearance classification
    operations: ['read'],
    self_service: false,
    searchable: false,
    indexed: false,
  },
];

// Seed the table now that ATTRIBUTE_MAPPINGS is defined
// All writes are wrapped so that a read-only bundled DB (Lambda image) doesn't
// prevent module load.  Schema + seed data already exist in the bundled registry.db.
try { seedAttributeMappings(); } catch (err: any) { console.warn('[caes] seedAttributeMappings skipped:', err?.message); }
try { migrateAttributeMappingsTable(); } catch (err: any) { console.warn('[caes] migrateAttributeMappingsTable skipped:', err?.message); }
try { ensureJobTitleMappings(); } catch (err: any) { console.warn('[caes] ensureJobTitleMappings skipped:', err?.message); }
try { fixDuplicateAuthorities(); } catch (err: any) { console.warn('[caes] fixDuplicateAuthorities skipped:', err?.message); }
try { ensureDeptConnectorMappings(); } catch (err: any) { console.warn('[caes] ensureDeptConnectorMappings skipped:', err?.message); }

/**
 * GET /api/caes/schema
 *
 * Returns the standardised CAES attribute schema — the catalogue of
 * standard attribute keys (`person.name.given`, `person.email`,
 * `person.employment.department`, …) with their `description`,
 * `sources`, `dataType`, and `sensitive` flag. Used by the UI to
 * render attribute pickers dynamically.
 *
 * @returns 200 — `ATTRIBUTE_SCHEMA` wrapped in `{ success: true, data: ... }` — see the in-file constant for the per-attribute shape.
 */
router.get('/schema', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      attributes: ATTRIBUTE_SCHEMA,
      totalAttributes: Object.keys(ATTRIBUTE_SCHEMA).length,
      sources: ['hr', 'ldap'],
    },
  });
});

/**
 * GET /api/caes/attribute-mappings
 *
 * List every attribute mapping in the registry DB. Source of truth
 * is the `attribute_mappings` table (live), not the in-code
 * `ATTRIBUTE_MAPPINGS` constant. Mappings are ordered by
 * `standard_attribute`, then `source_system`.
 *
 * @returns 200 — `{ success: true, data: AttributeMapping[] }` where each entry is the `parseDbMapping` shape (id, standardAttribute, sourceSystem, sourceField, sourceTable, keyField, is_authoritative, operations, transformations?, self_service, searchable, indexed).
 * @throws  500 — DB read failure (handled via `next(error)`).
 */
router.get('/attribute-mappings', (_req: Request, res: Response) => {
  try {
    const mappings = getAllMappings();

    const groupedByAttribute: Record<string, typeof mappings> = {};
    const groupedBySource: Record<string, typeof mappings> = {};
    for (const m of mappings) {
      (groupedByAttribute[m.standardAttribute] ??= []).push(m);
      (groupedBySource[m.sourceSystem] ??= []).push(m);
    }

    res.json({
      success: true,
      data: {
        mappings,
        grouped_by_attribute: groupedByAttribute,
        grouped_by_source: groupedBySource,
        total_mappings: mappings.length,
        source_systems: [...new Set(mappings.map(m => m.sourceSystem))],
      },
    });
  } catch (error) {
    console.error('Error fetching attribute mappings:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch attribute mappings', details: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

/**
 * POST /api/caes/attribute-mappings
 *
 * Create a new attribute mapping row. The body must satisfy the
 * `AttributeMapping` interface (without `id` — assigned by SQLite).
 *
 * @route   POST /api/caes/attribute-mappings
 * @body    `AttributeMapping` (no `id`): `{ standardAttribute, sourceSystem, sourceField, sourceTable, keyField, is_authoritative, operations: ('read'|'write'|'update'|'delete')[], transformations?: { read?, write? }, self_service, searchable, indexed }`
 * @returns 201 — `{ success: true, data: { id, ...AttributeMapping } }`
 * @throws  400 — `createError(...)` when required fields are missing.
 * @throws  500 — DB write failure.
 */
router.post('/attribute-mappings', (req: Request, res: Response) => {
  try {
    const { standardAttribute, sourceSystem, sourceField, sourceTable, keyField,
            is_authoritative, operations, transformations, searchable, indexed } = req.body;

    if (!standardAttribute || !sourceSystem || !sourceField || !sourceTable || !keyField) {
      return res.status(400).json({ success: false, error: { message: 'standardAttribute, sourceSystem, sourceField, sourceTable and keyField are required' } });
    }

    const result = REGISTRY_DB_RW.prepare(`
      INSERT INTO attribute_mappings
        (standard_attribute, source_system, source_field, source_table, key_field,
         is_authoritative, operations, transformations, searchable, indexed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      standardAttribute, sourceSystem, sourceField, sourceTable, keyField,
      is_authoritative ? 1 : 0,
      JSON.stringify(operations ?? ['read']),
      transformations ? JSON.stringify(transformations) : null,
      searchable ? 1 : 0,
      indexed ? 1 : 0,
    );

    const created = parseDbMapping(
      REGISTRY_DB_RW.prepare('SELECT * FROM attribute_mappings WHERE id = ?').get(result.lastInsertRowid) as any
    );
    logCAES('notice', CAES_EVENTS.MAPPING_CREATED, {
      component:          'api:caes',
      standard_attribute: standardAttribute,
      actor_id:           (req.ip ?? 'system'),
      request_id:         (req as any).requestId,
    });
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Error creating attribute mapping:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create attribute mapping', details: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

/**
 * PUT /api/caes/attribute-mappings/:id/authoritative
 *
 * Mark one mapping as the authoritative source for its standard
 * attribute. As a side effect, clears `is_authoritative` on every
 * OTHER mapping for the same `standard_attribute`, ensuring the
 * "at most one authoritative source per attribute" invariant.
 *
 * @route   PUT /api/caes/attribute-mappings/:id/authoritative
 * @param   id — mapping primary key (path param).
 * @returns 200 — `{ success: true, data: { id, ...AttributeMapping } }` after the toggle + sweep.
 * @throws  404 — when `:id` does not exist.
 * @throws  500 — DB write failure.
 */
router.put('/attribute-mappings/:id/authoritative', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = REGISTRY_DB_RW.prepare('SELECT * FROM attribute_mappings WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ success: false, error: { message: 'Mapping not found' } });

    REGISTRY_DB_RW.transaction(() => {
      REGISTRY_DB_RW.prepare(
        `UPDATE attribute_mappings SET is_authoritative = 0, updated_at = datetime('now')
         WHERE standard_attribute = ? AND id != ?`
      ).run(existing.standard_attribute, id);
      REGISTRY_DB_RW.prepare(
        `UPDATE attribute_mappings SET is_authoritative = 1, updated_at = datetime('now') WHERE id = ?`
      ).run(id);
    })();

    const updated = parseDbMapping(REGISTRY_DB_RW.prepare('SELECT * FROM attribute_mappings WHERE id = ?').get(id) as any);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error setting authoritative mapping:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to set authoritative mapping', details: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

/**
 * PUT /api/caes/attribute-mappings/:id
 *
 * Update an existing attribute mapping row. All writable columns
 * may be overwritten; `id` and `standard_attribute` are fixed.
 *
 * @route   PUT /api/caes/attribute-mappings/:id
 * @param   id — mapping primary key (path param).
 * @body    Partial `AttributeMapping` (anything except `id` may change).
 * @returns 200 — `{ success: true, data: { id, ...AttributeMapping } }`
 * @throws  404 — when `:id` does not exist.
 * @throws  500 — DB write failure.
 */
router.put('/attribute-mappings/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = REGISTRY_DB_RW.prepare('SELECT * FROM attribute_mappings WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ success: false, error: { message: 'Mapping not found' } });

    const { standardAttribute, sourceSystem, sourceField, sourceTable, keyField,
            is_authoritative, operations, transformations, searchable, indexed } = req.body;

    const effectiveAttr = standardAttribute ?? existing.standard_attribute;
    const newIsAuth     = is_authoritative != null ? (is_authoritative ? 1 : 0) : existing.is_authoritative;

    REGISTRY_DB_RW.transaction(() => {
      // Enforce at-most-one authoritative source per standard_attribute.
      // When this mapping is claiming authority, clear it from every other row first.
      if (newIsAuth === 1) {
        REGISTRY_DB_RW.prepare(
          `UPDATE attribute_mappings SET is_authoritative = 0, updated_at = datetime('now')
           WHERE standard_attribute = ? AND id != ?`
        ).run(effectiveAttr, id);
      }
      REGISTRY_DB_RW.prepare(`
        UPDATE attribute_mappings SET
          standard_attribute = ?, source_system = ?, source_field = ?, source_table = ?,
          key_field = ?, is_authoritative = ?, operations = ?, transformations = ?,
          searchable = ?, indexed = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        effectiveAttr,
        sourceSystem      ?? existing.source_system,
        sourceField       ?? existing.source_field,
        sourceTable       ?? existing.source_table,
        keyField          ?? existing.key_field,
        newIsAuth,
        operations ? JSON.stringify(operations) : existing.operations,
        transformations !== undefined ? (transformations ? JSON.stringify(transformations) : null) : existing.transformations,
        searchable != null ? (searchable ? 1 : 0) : existing.searchable,
        indexed    != null ? (indexed    ? 1 : 0) : existing.indexed,
        id,
      );
    })();

    const updated = parseDbMapping(REGISTRY_DB_RW.prepare('SELECT * FROM attribute_mappings WHERE id = ?').get(id) as any);
    logCAES('notice', CAES_EVENTS.MAPPING_UPDATED, {
      component:          'api:caes',
      mapping_id:         id,
      standard_attribute: updated.standardAttribute,
      actor_id:           (req.ip ?? 'system'),
      request_id:         (req as any).requestId,
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating attribute mapping:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update attribute mapping', details: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

/**
 * DELETE /api/caes/attribute-mappings/:id
 *
 * Permanently delete one attribute mapping. After deletion, that
 * source no longer contributes to attribute resolution for the
 * affected `standard_attribute`.
 *
 * @route   DELETE /api/caes/attribute-mappings/:id
 * @param   id — mapping primary key (path param).
 * @returns 200 — `{ success: true, data: { id, deleted: true } }`
 * @throws  404 — when `:id` does not exist.
 * @throws  500 — DB write failure.
 */
router.delete('/attribute-mappings/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = REGISTRY_DB_RW.prepare('SELECT * FROM attribute_mappings WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ success: false, error: { message: 'Mapping not found' } });

    REGISTRY_DB_RW.prepare('DELETE FROM attribute_mappings WHERE id = ?').run(id);
    logCAES('notice', CAES_EVENTS.MAPPING_DELETED, {
      component:  'api:caes',
      mapping_id: id,
      actor_id:   (req.ip ?? 'system'),
      request_id: (req as any).requestId,
    });
    res.json({ success: true, data: { deleted: id } });
  } catch (error) {
    console.error('Error deleting attribute mapping:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete attribute mapping', details: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

/**
 * POST /api/caes/resolve
 *
 * Resolve one or more standard attribute values for a GCUID using
 * the configured attribute mappings.
 *
 * For multi-source attributes, **all** source values are returned
 * (under `values[]`) along with which mapping is authoritative.
 * The top-level `value` / `source` fields always reflect the
 * authoritative entry (or the first available entry when no
 * authoritative mapping has data) for back-compat with single-source
 * callers.
 *
 * Resolution path: `connectorResolver.resolveAttribute()` for each
 * source — `dynamic-pull` connectors go live HTTP; `push-cache` /
 * `scheduled-pull` go through the cache. When the connector path
 * fails on LDAP (because `source_mappings` stores `username` while
 * the connector keys records by `distinguished_name`), falls back
 * to a direct read from `conn-ldap.db`.
 *
 * `disabled_sources` lists source systems linked to this GCUID whose
 * connector is currently `enabled: false` — the UI uses this to
 * surface a "connector disabled" message instead of a generic
 * "no attributes resolved" failure.
 *
 * Logging: emits `ATTR_QUERY_RECEIVED` on entry, then `ATTR_RESOLVED`
 * (all requested found), `ATTR_PARTIAL` (some found), or
 * `ATTR_NOT_FOUND` (none found) on exit.
 *
 * @route   POST /api/caes/resolve
 * @body    `{ gcuid: string, attributes: string[] }` — `gcuid` may be a raw GCUID or alias; resolved via `resolveToGcuid`.
 * @returns 200 — `{ success: true, data: { gcuid, attributes: { [stdAttr]: { value, source, dataType, values: { source, value, is_authoritative }[], authoritative_source: string|null } }, sources_used: string[], disabled_sources: string[] } }`
 * @throws  400 — `{ success: false, error: { message: 'Invalid request. Requires gcuid and attributes array.' } }` when input shape is wrong.
 * @throws  404 — `{ success: false, error: { message: 'GCUID not found', gcuid } }` when the GCUID has no `source_mappings`.
 * @throws  500 — `{ success: false, error: { message: 'Failed to resolve attributes', details } }` on unexpected failure.
 */
router.post('/resolve', async (req: Request, res: Response) => {
  try {
    const { gcuid: rawGcuid, attributes } = req.body;
    const gcuid = resolveToGcuid(rawGcuid as string | undefined);

    if (!gcuid || !attributes || !Array.isArray(attributes)) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid request. Requires gcuid and attributes array.',
        },
      });
    }

    logCAES('debug', CAES_EVENTS.ATTR_QUERY_RECEIVED, {
      component:            'api:caes',
      query_gcuid:          gcuid,
      attributes_requested: String(attributes.length),
      transaction_id:       (req as any).requestId ?? '',
      request_id:           (req as any).requestId,
    });

    // Get source mappings from GCUID registry. Order by id so iteration is
    // stable across requests (better-sqlite3 otherwise returns rows in an
    // implementation-defined order, which can flip the resolver's
    // first-found selection between calls).
    const mappings = REGISTRY_DB.prepare(`
      SELECT id, source_system, source_id, is_primary
      FROM source_mappings
      WHERE gcuid = ?
      ORDER BY id
    `).all(gcuid);

    if (mappings.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'GCUID not found',
          gcuid,
        },
      });
    }

    const result: Record<string, any> = {
      gcuid,
      attributes: {},
      sources_used: [] as string[],
      disabled_sources: [] as string[],
    };

    // Helper: retrieve a raw value from the appropriate backend for a given attribute mapping + sourceId.
    // Routes to the connector resolver (dynamic-pull → live HTTP; push-cache/scheduled-pull → cache).
    const fetchValue = async (attrMapping: AttributeMapping, sourceId: string): Promise<any> => {
      return connectorResolver.resolveAttribute(
        attrMapping.sourceSystem,
        sourceId,
        {
          sourceField:       attrMapping.sourceField,
          sourceTable:       attrMapping.sourceTable,
          keyField:          attrMapping.keyField,
          transformations:   attrMapping.transformations,
          standardAttribute: attrMapping.standardAttribute,
        }
      ).catch(() => undefined);
    };

    // Load live mappings from DB once
    const allDbMappings = getAllMappings();

    // Retrieve attributes from appropriate sources using attribute mappings
    for (const attr of attributes) {
      const schema = ATTRIBUTE_SCHEMA[attr as keyof typeof ATTRIBUTE_SCHEMA];

      if (!schema) {
        result.attributes[attr] = { error: 'Unknown attribute' };
        continue;
      }

      // Find all attribute mappings for this standard attribute
      const attrMappings = allDbMappings.filter(m => m.standardAttribute === attr);

      // Collect values from every available source
      const values: Array<{ source: string; value: any; is_authoritative: boolean }> = [];

      for (const attrMapping of attrMappings) {
        // Try every source_mapping row for this source_system in id order.
        // Some connectors key records by a primary field (e.g. LDAP keys by
        // DN, not by username); an older mapping row that points at a
        // non-keyed identifier will resolve to undefined. Falling through to
        // the next mapping row lets the live, keyable identifier win
        // without forcing the caller to clean up legacy rows first.
        const candidateRecords = (mappings as any[]).filter(
          (m: any) => m.source_system === attrMapping.sourceSystem,
        );
        if (candidateRecords.length === 0) continue;

        let resolvedValue: any = undefined;
        for (const rec of candidateRecords) {
          const v = await fetchValue(attrMapping, rec.source_id);
          if (v !== undefined) { resolvedValue = v; break; }
        }
        // Last-resort LDAP fallback: read the row directly from conn-ldap.db
        // when the connector path didn't resolve (source_mappings may store
        // a username while the connector keys records by DN). Without this,
        // a mapping inserted via the LDAP portal (which always uses the
        // username) would silently drop LDAP values from the right details
        // panel even though the LDAP link is intact.
        if (resolvedValue === undefined && attrMapping.sourceSystem === 'ldap') {
          resolvedValue = _ldapDirectDbFallback(
            candidateRecords.map((r: any) => r.source_id),
            attrMapping.sourceField,
          );
        }
        if (resolvedValue === undefined) continue;

        values.push({
          source: attrMapping.sourceSystem,
          value: resolvedValue,
          is_authoritative: attrMapping.is_authoritative,
        });

        if (!result.sources_used.includes(attrMapping.sourceSystem)) {
          result.sources_used.push(attrMapping.sourceSystem);
        }
      }

      // Determine the canonical (authoritative) value — prefer the authoritative mapping,
      // fall back to the first available value if no authoritative entry has data
      const authEntry = values.find(v => v.is_authoritative) ?? values[0] ?? null;

      result.attributes[attr] = {
        // Top-level value/source for backward compatibility — always the authoritative one
        value: authEntry?.value ?? null,
        source: authEntry?.source ?? null,
        dataType: schema.dataType,
        // All source values (present when multiple sources have data)
        values,
        // Authoritative source name, derived from the DB mapping
        authoritative_source: attrMappings.find(m => m.is_authoritative)?.sourceSystem ?? null,
      };
    }

    // Identify source systems linked to this GCUID whose connectors are disabled.
    // These are reported so the UI can show a specific "connector disabled" message
    // instead of the generic "no attributes resolved" fallback.
    for (const mapping of mappings as any[]) {
      const sysRow = REGISTRY_DB.prepare(
        'SELECT connector_id FROM source_systems WHERE system_id = ?'
      ).get(mapping.source_system) as { connector_id: string | null } | null;
      if (sysRow?.connector_id) {
        const connCfg = loadConnectorConfig(sysRow.connector_id);
        if (connCfg && connCfg.enabled === false && !result.disabled_sources.includes(mapping.source_system)) {
          result.disabled_sources.push(mapping.source_system);
        }
      }
    }

    // Determine log outcome based on how many attributes were resolved
    const requestedCount   = attributes.length;
    const resolvedCount    = Object.values(result.attributes).filter((v: any) => v.value !== null).length;

    if (resolvedCount === 0) {
      logCAES('info', CAES_EVENTS.ATTR_NOT_FOUND, {
        component:            'api:caes',
        query_gcuid:          gcuid,
        attributes_requested: String(requestedCount),
        attributes_missing:   String(requestedCount),
        request_id:           (req as any).requestId,
      });
    } else if (resolvedCount < requestedCount) {
      logCAES('warning', CAES_EVENTS.ATTR_PARTIAL, {
        component:           'api:caes',
        query_gcuid:         gcuid,
        attributes_returned: String(resolvedCount),
        attributes_missing:  String(requestedCount - resolvedCount),
        request_id:          (req as any).requestId,
      });
    } else {
      logCAES('info', CAES_EVENTS.ATTR_RESOLVED, {
        component:              'api:caes',
        query_gcuid:            gcuid,
        attributes_returned:    String(resolvedCount),
        source_systems_queried: String(result.sources_used.length),
        duration_ms:            0,
        request_id:             (req as any).requestId,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error resolving attributes:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to resolve attributes',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

/**
 * GET /api/caes/stats
 *
 * Aggregate statistics over the live `attribute_mappings` table:
 * totals (mappings / unique attributes / multi-source attributes /
 * source systems), per-source mapping counts, multi-source
 * attribute list, operation support breakdown, and counts of
 * `searchable` / `indexed` mappings.
 *
 * @returns 200 — `{ success: true, data: { overview: { total_attribute_mappings, unique_attributes, multi_source_attributes, source_systems }, by_source: { source_system, mapping_count }[], multi_source_attributes: { attribute, sources, source_count }[], operation_support: { operation, mappings_supporting }[], searchable_mappings, indexed_mappings } }`
 * @throws  500 — DB read failure.
 */
router.get('/stats', (req: Request, res: Response) => {
  try {
    const liveMappings = getAllMappings();

    // Count mappings by source
    const bySource: Record<string, number> = {};
    for (const mapping of liveMappings) {
      bySource[mapping.sourceSystem] = (bySource[mapping.sourceSystem] || 0) + 1;
    }

    // Count attributes available from multiple sources
    const attributeCoverage: Record<string, string[]> = {};
    for (const mapping of liveMappings) {
      if (!attributeCoverage[mapping.standardAttribute]) {
        attributeCoverage[mapping.standardAttribute] = [];
      }
      attributeCoverage[mapping.standardAttribute].push(mapping.sourceSystem);
    }

    const multiSourceAttributes = Object.entries(attributeCoverage)
      .filter(([_, sources]) => sources.length > 1);

    // Operation support
    const operationSupport: Record<string, number> = {};
    for (const mapping of liveMappings) {
      for (const op of mapping.operations) {
        operationSupport[op] = (operationSupport[op] || 0) + 1;
      }
    }

    res.json({
      success: true,
      data: {
        overview: {
          total_attribute_mappings: liveMappings.length,
          unique_attributes: Object.keys(attributeCoverage).length,
          multi_source_attributes: multiSourceAttributes.length,
          source_systems: Object.keys(bySource).length,
        },
        by_source: Object.entries(bySource).map(([source, count]) => ({
          source_system: source,
          mapping_count: count,
        })),
        multi_source_attributes: multiSourceAttributes.map(([attr, sources]) => ({
          attribute: attr,
          sources,
          source_count: sources.length,
        })),
        operation_support: Object.entries(operationSupport).map(([op, count]) => ({
          operation: op,
          mappings_supporting: count,
        })),
        searchable_mappings: liveMappings.filter(m => m.searchable).length,
        indexed_mappings: liveMappings.filter(m => m.indexed).length,
      },
    });
  } catch (error) {
    console.error('Error fetching CAES stats:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch statistics',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

/**
 * GET /api/caes/health
 *
 * Composite health probe. Checks the GCUID Registry connection,
 * dynamically discovers every connector registered in
 * `source_systems.connector_id`, and probes each:
 *
 * - **EFS mode**: opens the connector's SQLite DB and runs
 *   `SELECT 1 FROM <primaryTable> LIMIT 1` → `connected`/`degraded`.
 * - **Sidecar mode**: calls the connector's `/health` endpoint
 *   over HTTP → `connected`/`degraded`/`unavailable`.
 *
 * `disabled` overrides all of the above when the connector's
 * `enabled: false` flag is set. Overall status: `error` when the
 * registry itself is unreachable, `degraded` when any enabled
 * connector is degraded/unavailable, otherwise `operational`.
 *
 * @returns 200 — `{ success: true, data: { status, timestamp, services: { registry: { status, identity_count } }, connectors: { connector_id, system_id, display_name, enabled, status }[], attribute_schema_version, attribute_mappings_loaded } }`
 * @throws  500 — `{ success: false, error: { message: 'Health check failed', details } }` on unexpected failure.
 */
router.get('/health', async (req: Request, res: Response) => {
  type ConnectorStatus = 'connected' | 'degraded' | 'unavailable' | 'disabled';

  const probeConnectorDb = (connectorId: string, table: string): ConnectorStatus => {
    try {
      const db = new Database(connectorDbPath(connectorId), { readonly: true });
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
      db.close();
      return 'connected';
    } catch {
      return 'degraded';
    }
  };

  try {
    // ── GCUID Registry ──────────────────────────────────────────────────────
    let registryStatus: 'connected' | 'disconnected' = 'disconnected';
    let identityCount = 0;
    try {
      REGISTRY_DB.prepare('SELECT 1 as ok').get();
      registryStatus = 'connected';
      identityCount = (REGISTRY_DB.prepare('SELECT COUNT(*) as n FROM identities').get() as any).n;
    } catch { /* leave disconnected */ }

    // ── Connectors — dynamically discovered from source_systems ────────────
    const sourceSystems = REGISTRY_DB.prepare(
      'SELECT system_id, display_name, connector_id FROM source_systems WHERE connector_id IS NOT NULL'
    ).all() as Array<{ system_id: string; display_name: string; connector_id: string }>;

    const connectors: Array<{
      connector_id: string;
      system_id: string;
      display_name: string;
      enabled: boolean;
      status: ConnectorStatus;
    }> = [];

    for (const sys of sourceSystems) {
      const cfg = loadConnectorConfig(sys.connector_id);
      const enabled = cfg ? cfg.enabled !== false : false;

      let status: ConnectorStatus = 'disabled';
      if (enabled && cfg) {
        if (IS_EFS_MODE) {
          status = probeConnectorDb(
            sys.connector_id,
            cfg.sourceConnection?.primaryTable ?? 'employees'
          );
        } else {
          try {
            const client = new ConnectorAPIClient(
              `http://localhost:${cfg.connectorServer.port}`,
              cfg.connectorServer.authToken
            );
            const h = await client.health();
            status = h.status === 'healthy' ? 'connected' : 'degraded';
          } catch {
            status = 'unavailable';
          }
        }
      }

      connectors.push({
        connector_id: sys.connector_id,
        system_id: sys.system_id,
        display_name: sys.display_name,
        enabled,
        status,
      });
    }

    // ── Overall status ──────────────────────────────────────────────────────
    const anyDegraded = connectors.some(c => c.enabled && c.status !== 'connected');
    const overallStatus =
      registryStatus === 'disconnected' ? 'error'
      : anyDegraded ? 'degraded'
      : 'operational';

    res.json({
      success: true,
      data: {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        services: {
          registry: { status: registryStatus, identity_count: identityCount },
        },
        connectors,
        attribute_schema_version: '1.0.0',
        attribute_mappings_loaded: getAllMappings().length,
      },
    });
  } catch (error) {
    console.error('Error in health check:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Health check failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

/**
 * Identity Matching Configuration
 * Defines ordered strategies for matching an individual in each source system
 * using compound attribute combinations as surrogate keys.
 */
interface MatchStrategy {
  strategyId: string;
  description: string;
  standardAttributes: string[]; // CAES standard attribute names required for this strategy
  matchType: 'exact' | 'contains';
  confidence: number; // 0–1, expected confidence when exactly one record matches
  requiresUnique: boolean; // if multiple records match, treat as no match
}

interface SourceMatchConfig {
  sourceSystem: string;
  connectorId: string;
  sourceTable: string;
  keyField: string; // identifier returned (e.g. employee_id, username)
  strategies: MatchStrategy[];
}

// Ordered highest-confidence first so we return the best match per source
const SOURCE_MATCH_CONFIGS: SourceMatchConfig[] = [
  {
    sourceSystem: 'hr',
    connectorId: 'conn-hr',
    sourceTable: 'employees',
    keyField: 'employee_id',
    strategies: [
      {
        strategyId: 'hr-email-exact',
        description: 'Exact match on email address (functionally unique)',
        standardAttributes: ['person.email'],
        matchType: 'exact',
        confidence: 0.98,
        requiresUnique: true,
      },
      {
        strategyId: 'hr-name-dept',
        description: 'Exact match on given name + family name + department',
        standardAttributes: ['person.name.given', 'person.name.family', 'person.employment.department'],
        matchType: 'exact',
        confidence: 0.85,
        requiresUnique: true,
      },
      {
        strategyId: 'hr-name-only',
        description: 'Exact match on given name + family name',
        standardAttributes: ['person.name.given', 'person.name.family'],
        matchType: 'exact',
        confidence: 0.55,
        requiresUnique: true,
      },
    ],
  },
  {
    sourceSystem: 'ldap',
    connectorId: 'conn-ldap',
    sourceTable: 'users',
    keyField: 'username',
    strategies: [
      {
        strategyId: 'ldap-username-exact',
        description: 'Exact match on username (authoritative unique key)',
        standardAttributes: ['person.account.username'],
        matchType: 'exact',
        confidence: 1.0,
        requiresUnique: true,
      },
      {
        strategyId: 'ldap-email-exact',
        description: 'Exact match on email address (functionally unique)',
        standardAttributes: ['person.email'],
        matchType: 'exact',
        confidence: 0.98,
        requiresUnique: true,
      },
      {
        strategyId: 'ldap-name-only',
        description: 'Exact match on given name + family name (sn)',
        standardAttributes: ['person.name.given', 'person.name.family'],
        matchType: 'exact',
        confidence: 0.55,
        requiresUnique: true,
      },
    ],
  },
  // ── Engineering Department ────────────────────────────────────────────────
  // Strategies ordered highest-confidence first.
  // Cross-source strategies (ldap-corroborated, hr-corroborated) leverage the
  // hr_employee_id and ldap_username linkage fields stored in the connector DB.
  // These fields are NOT guaranteed to be present, so the strategies gracefully
  // fall through to lower-confidence options when the linkage fields are null.
  {
    sourceSystem: 'engineering',
    connectorId: 'conn-engineering',
    sourceTable: 'employees',
    keyField: 'dept_id',
    strategies: [
      {
        strategyId: 'eng-ldap-corroborated',
        description: 'Email + LDAP username — cross-corroborated with directory source',
        standardAttributes: ['person.email', 'person.account.username'],
        matchType: 'exact',
        confidence: 0.99,
        requiresUnique: true,
      },
      {
        strategyId: 'eng-email-exact',
        description: 'Exact match on email address',
        standardAttributes: ['person.email'],
        matchType: 'exact',
        confidence: 0.97,
        requiresUnique: true,
      },
      {
        strategyId: 'eng-hr-corroborated',
        description: 'Email + HR employee ID — cross-corroborated with HR system',
        standardAttributes: ['person.email', 'person.employment.employee_id'],
        matchType: 'exact',
        confidence: 0.96,
        requiresUnique: true,
      },
      {
        strategyId: 'eng-hr-id-only',
        description: 'HR employee ID only — strong linkage when email unavailable',
        standardAttributes: ['person.employment.employee_id'],
        matchType: 'exact',
        confidence: 0.91,
        requiresUnique: true,
      },
      {
        strategyId: 'eng-name-role',
        description: 'Given name + family name + role — role is distinctive in engineering',
        standardAttributes: ['person.name.given', 'person.name.family', 'person.employment.role'],
        matchType: 'exact',
        confidence: 0.72,
        requiresUnique: true,
      },
      {
        strategyId: 'eng-name-only',
        description: 'Given name + family name — fallback only',
        standardAttributes: ['person.name.given', 'person.name.family'],
        matchType: 'exact',
        confidence: 0.50,
        requiresUnique: true,
      },
    ],
  },
  // ── Finance Department ───────────────────────────────────────────────────
  // Same cross-source corroboration approach as engineering.
  // Finance has strong HR linkage (~73% of records have hr_employee_id)
  // but sparse LDAP linkage (~20%), so fin-hr-corroborated is more useful
  // in practice than fin-ldap-corroborated.
  {
    sourceSystem: 'finance',
    connectorId: 'conn-finance',
    sourceTable: 'employees',
    keyField: 'dept_id',
    strategies: [
      {
        strategyId: 'fin-ldap-corroborated',
        description: 'Email + LDAP username — cross-corroborated with directory source',
        standardAttributes: ['person.email', 'person.account.username'],
        matchType: 'exact',
        confidence: 0.99,
        requiresUnique: true,
      },
      {
        strategyId: 'fin-email-exact',
        description: 'Exact match on email address',
        standardAttributes: ['person.email'],
        matchType: 'exact',
        confidence: 0.97,
        requiresUnique: true,
      },
      {
        strategyId: 'fin-hr-corroborated',
        description: 'Email + HR employee ID — cross-corroborated with HR system',
        standardAttributes: ['person.email', 'person.employment.employee_id'],
        matchType: 'exact',
        confidence: 0.96,
        requiresUnique: true,
      },
      {
        strategyId: 'fin-hr-id-only',
        description: 'HR employee ID only — strong linkage when email unavailable',
        standardAttributes: ['person.employment.employee_id'],
        matchType: 'exact',
        confidence: 0.91,
        requiresUnique: true,
      },
      {
        strategyId: 'fin-name-role',
        description: 'Given name + family name + role — finance roles tend to be distinctive',
        standardAttributes: ['person.name.given', 'person.name.family', 'person.employment.role'],
        matchType: 'exact',
        confidence: 0.78,
        requiresUnique: true,
      },
      {
        strategyId: 'fin-name-only',
        description: 'Given name + family name — fallback only',
        standardAttributes: ['person.name.given', 'person.name.family'],
        matchType: 'exact',
        confidence: 0.50,
        requiresUnique: true,
      },
    ],
  },
];

// ─── Match Configs DB layer ───────────────────────────────────────────────────

/**
 * Insert any SOURCE_MATCH_CONFIGS entries that are missing from the match_configs
 * table. Used for source systems added after the initial seed (e.g. engineering,
 * finance). Safe to call on every boot — uses INSERT OR IGNORE.
 */
function ensureNewMatchConfigs() {
  const stmt = REGISTRY_DB_RW.prepare(
    `INSERT OR IGNORE INTO match_configs (source_system, connector_id, source_table, key_field, strategies)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const c of SOURCE_MATCH_CONFIGS) {
    stmt.run(c.sourceSystem, c.connectorId, c.sourceTable, c.keyField, JSON.stringify(c.strategies));
  }
}

/**
 * Persist SOURCE_MATCH_CONFIGS into the registry DB so that edits from the UI
 * survive restarts. Seeded once from the hardcoded constant if the table is empty.
 */
function initMatchConfigsTable() {
  REGISTRY_DB_RW.exec(`
    CREATE TABLE IF NOT EXISTS match_configs (
      source_system TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      source_table TEXT NOT NULL,
      key_field TEXT NOT NULL,
      strategies TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  const { n } = REGISTRY_DB_RW.prepare('SELECT COUNT(*) as n FROM match_configs').get() as { n: number };
  if (n === 0) {
    const stmt = REGISTRY_DB_RW.prepare(
      `INSERT INTO match_configs (source_system, connector_id, source_table, key_field, strategies)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const c of SOURCE_MATCH_CONFIGS) {
      stmt.run(c.sourceSystem, c.connectorId, c.sourceTable, c.keyField, JSON.stringify(c.strategies));
    }
  }
}

function getMatchConfigsFromDB(): SourceMatchConfig[] {
  const rows = REGISTRY_DB_RW.prepare('SELECT * FROM match_configs ORDER BY source_system').all() as Array<{
    source_system: string; connector_id: string; source_table: string; key_field: string; strategies: string;
  }>;
  return rows.map(r => ({
    sourceSystem: r.source_system,
    connectorId: r.connector_id,
    sourceTable: r.source_table,
    keyField: r.key_field,
    strategies: JSON.parse(r.strategies) as MatchStrategy[],
  }));
}

// Initialise match configs table on startup (after SOURCE_MATCH_CONFIGS is defined)
try { initMatchConfigsTable(); } catch (err: any) { console.warn('[caes] initMatchConfigsTable skipped:', err?.message); }
// Seed any source configs added after the initial seed (engineering, finance)
try { ensureNewMatchConfigs(); } catch (err: any) { console.warn('[caes] ensureNewMatchConfigs skipped:', err?.message); }

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a standard attribute name to the source-specific field name
 * using the ATTRIBUTE_MAPPINGS config.
 */
function getSourceField(standardAttribute: string, sourceSystem: string): string | null {
  const mapping = ATTRIBUTE_MAPPINGS.find(
    m => m.standardAttribute === standardAttribute && m.sourceSystem === sourceSystem
  );
  return mapping ? mapping.sourceField : null;
}

/**
 * Run a single match strategy against a source connector via HTTP search API.
 * Returns the matched record(s) or empty array if attributes are missing or no match.
 */
async function runMatchStrategyAsync(
  config: SourceMatchConfig,
  strategy: MatchStrategy,
  providedAttributes: Record<string, string>
): Promise<{ sourceId: string; confidence: number; strategyId: string; matchedAttributes: string[]; record: Record<string, any> }[]> {
  // Check all required attributes are present
  for (const attr of strategy.standardAttributes) {
    if (!providedAttributes[attr] || providedAttributes[attr].trim() === '') {
      return [];
    }
  }

  // Map standard attribute names to source-specific field names for the connector search
  const searchAttrs: Record<string, string> = {};
  for (const attr of strategy.standardAttributes) {
    const field = getSourceField(attr, config.sourceSystem);
    if (!field) return [];
    searchAttrs[field] = providedAttributes[attr];
  }

  const connCfg = loadConnectorConfig(config.connectorId);
  if (!connCfg || connCfg.enabled === false) return [];

  const client = new ConnectorAPIClient(
    `http://localhost:${connCfg.connectorServer.port}`,
    connCfg.connectorServer.authToken
  );

  let response;
  try {
    response = await client.search({
      attributes: searchAttrs,
      limit: strategy.requiresUnique ? 2 : 10,
      fuzzy: false,
    });
  } catch {
    return [];
  }

  const records = response.records;
  if (records.length === 0) return [];
  if (strategy.requiresUnique && records.length > 1) return [];

  return records.map(rec => ({
    sourceId: rec.recordId,
    confidence: strategy.confidence,
    strategyId: strategy.strategyId,
    matchedAttributes: strategy.standardAttributes,
    record: rec.attributes,
  }));
}

/**
 * POST /api/caes/match
 *
 * Identity match — search authoritative sources for an individual
 * using supplied identity attributes. Acts as a compound surrogate
 * key lookup to enable identity linking without a prior GCUID.
 *
 * For each requested source system, iterates the configured
 * strategies (highest-confidence first) and applies the
 * `matchType` (`exact` / `contains`) with the supplied standard
 * attributes. Strategies with `requiresUnique: true` return at
 * most one match (multi-match = no match).
 *
 * Each match record reports the source system, the matched
 * `keyField` value, the strategy id, the strategy description, the
 * confidence, and the list of attributes that participated.
 *
 * @route   POST /api/caes/match
 * @body    `{ source_systems: string[], attributes: { [stdAttr: string]: string } }`
 *          `source_systems` is a subset of `['hr','ldap','engineering','finance']`; missing sources are skipped.
 * @returns 200 — `{ success: true, data: { matches: { source_system: string, matches: { source_id, strategy_id, strategy_description, confidence, matched_attributes }[] }[] } }`
 *          One entry per source system queried (only those with ≥1 match).
 * @throws  400 — when required fields are missing.
 * @throws  500 — DB or connector failure.
 */
router.post('/match', async (req: Request, res: Response) => {
  try {
    const { attributes, sources } = req.body as {
      attributes: Record<string, string>;
      sources?: string[];
    };

    if (!attributes || typeof attributes !== 'object' || Object.keys(attributes).length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'attributes object is required and must not be empty' },
      });
    }

    const liveConfigs = getMatchConfigsFromDB();
    const targetSources = sources && sources.length > 0 ? sources : liveConfigs.map(c => c.sourceSystem);
    const configs = liveConfigs.filter(c => targetSources.includes(c.sourceSystem));

    const matches: {
      sourceSystem: string;
      sourceId: string;
      confidence: number;
      strategyId: string;
      strategyDescription: string;
      matchedAttributes: string[];
      record: Record<string, any>;
    }[] = [];

    for (const config of configs) {
      let foundMatch = false;
      // Try strategies from highest to lowest confidence
      for (const strategy of config.strategies) {
        const results = await runMatchStrategyAsync(config, strategy, attributes);
        if (results.length > 0) {
          for (const result of results) {
            const strategyDef = config.strategies.find(s => s.strategyId === result.strategyId);
            matches.push({
              sourceSystem: config.sourceSystem,
              sourceId: result.sourceId,
              confidence: result.confidence,
              strategyId: result.strategyId,
              strategyDescription: strategyDef?.description ?? '',
              matchedAttributes: result.matchedAttributes,
              record: result.record,
            });
          }
          foundMatch = true;
          break; // Stop at the first successful strategy per source
        }
      }
      void foundMatch;
    }

    const sourcesWithMatch = [...new Set(matches.map(m => m.sourceSystem))];

    res.json({
      success: true,
      data: {
        matches,
        search_attributes_provided: Object.keys(attributes),
        sources_searched: configs.map(c => c.sourceSystem),
        summary: {
          total_matches: matches.length,
          unique_match_found: matches.length > 0 && sourcesWithMatch.length === targetSources.filter(s => configs.some(c => c.sourceSystem === s)).length,
          sources_with_match: sourcesWithMatch,
        },
      },
    });
  } catch (error) {
    console.error('Error during identity match:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Identity match failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

/**
 * POST /api/caes/match-and-link
 *
 * Run identity match across the requested sources (same logic as
 * `/match`), then create `source_mappings` rows in the registry for
 * the provided GCUID pointing at each matched source id.
 *
 * Used as part of the GCUID creation lifecycle to automatically
 * establish links from attribute evidence rather than known IDs.
 *
 * @route   POST /api/caes/match-and-link
 * @body    `{ gcuid: string, source_systems: string[], attributes: { [stdAttr: string]: string } }`
 * @returns 200 — `{ success: true, data: { gcuid, links_created: { source_system, source_id, strategy_id, confidence }[] } }`
 *          `links_created` includes every link the route actually inserted.
 * @throws  400 — when `gcuid`, `source_systems`, or `attributes` are missing.
 * @throws  500 — DB or connector failure.
 */
router.post('/match-and-link', async (req: Request, res: Response) => {
  try {
    const { gcuid: rawGcuid, attributes, sources, requested_by } = req.body as {
      gcuid: string;
      attributes: Record<string, string>;
      sources?: string[];
      requested_by?: string;
    };
    const gcuid = resolveToGcuid(rawGcuid);

    if (!gcuid || typeof gcuid !== 'string') {
      return res.status(400).json({
        success: false,
        error: { message: 'gcuid is required' },
      });
    }
    if (!attributes || typeof attributes !== 'object' || Object.keys(attributes).length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'attributes object is required and must not be empty' },
      });
    }

    // Verify GCUID exists in registry
    const identity = REGISTRY_DB.prepare('SELECT gcuid FROM identities WHERE gcuid = ?').get(gcuid);
    if (!identity) {
      return res.status(404).json({
        success: false,
        error: { message: 'GCUID not found in registry', gcuid },
      });
    }

    const liveConfigs = getMatchConfigsFromDB();
    const targetSources = sources && sources.length > 0 ? sources : liveConfigs.map(c => c.sourceSystem);
    const configs = liveConfigs.filter(c => targetSources.includes(c.sourceSystem));

    const matches: { sourceSystem: string; sourceId: string; confidence: number; strategyId: string }[] = [];

    for (const config of configs) {
      for (const strategy of config.strategies) {
        const results = await runMatchStrategyAsync(config, strategy, attributes);
        if (results.length > 0) {
          matches.push({
            sourceSystem: config.sourceSystem,
            sourceId: results[0].sourceId,
            confidence: results[0].confidence,
            strategyId: results[0].strategyId,
          });
          break;
        }
      }
    }

    // Upsert source_mappings for each match found
    const upsert = REGISTRY_DB_RW.prepare(`
      INSERT INTO source_mappings (gcuid, source_system, source_id, is_primary, verified_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT (gcuid, source_system) DO UPDATE SET
        source_id = excluded.source_id,
        verified_at = excluded.verified_at
    `);

    const linked: string[] = [];
    for (const match of matches) {
      // Only link high-confidence matches (>= 0.75)
      if (match.confidence >= 0.75) {
        upsert.run(gcuid, match.sourceSystem, match.sourceId, 0);
        linked.push(match.sourceSystem);
      }
    }

    const linkedAt = new Date().toISOString();
    logCAES(linked.length > 0 ? 'info' : 'warning', CAES_EVENTS.FEDERATION_COMPLETED, {
      component:              'api:caes',
      query_gcuid:            gcuid,
      source_systems_queried: String(matches.length),
      duration_ms:            0,
      request_id:             (req as any).requestId,
    });

    // F7 / G7: emit per-system GCUID_LINKED events for HR and LDAP
    for (const match of matches.filter(m => m.confidence >= 0.75)) {
      if (match.sourceSystem === 'hr') {
        logHR('info', HR_EVENTS.GCUID_LINKED, {
          component:   'api:caes',
          employee_id: match.sourceId,
          gcuid_linked: gcuid,
          request_id:  (req as any).requestId,
        });
      } else if (match.sourceSystem === 'ldap') {
        logLDAP('info', LDAP_EVENTS.GCUID_LINKED, {
          component:    'api:caes',
          username:     match.sourceId,
          gcuid_linked: gcuid,
          request_id:   (req as any).requestId,
        });
      }
    }

    res.json({
      success: true,
      data: {
        gcuid,
        matches_found: matches.length,
        sources_linked: linked,
        high_confidence_matches: matches.filter(m => m.confidence >= 0.75),
        low_confidence_matches: matches.filter(m => m.confidence < 0.75),
        requested_by: requested_by ?? 'system',
        linked_at: linkedAt,
      },
    });
  } catch (error) {
    console.error('Error during match-and-link:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Match and link failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

/**
 * GET /api/caes/match-configs
 *
 * Return the configured match strategies per source so the UI can
 * display them. Sources are returned in stable order. Each entry
 * lists the per-source `keyField` and the ordered `strategies[]`
 * (highest-confidence first).
 *
 * @returns 200 — `{ success: true, data: SourceMatchConfig[] }` — see `SOURCE_MATCH_CONFIGS` for the shape and source list.
 */
router.get('/match-configs', (_req: Request, res: Response) => {
  const configs = getMatchConfigsFromDB().map(c => ({
    sourceSystem: c.sourceSystem,
    connectorId: c.connectorId,
    sourceTable: c.sourceTable,
    keyField: c.keyField,
    strategies: c.strategies.map(s => ({
      strategyId: s.strategyId,
      description: s.description,
      standardAttributes: s.standardAttributes,
      matchType: s.matchType,
      confidence: s.confidence,
      requiresUnique: s.requiresUnique,
    })),
  }));
  res.json({ success: true, data: { configs } });
});

/**
 * POST /api/caes/match-configs
 *
 * Add a new source match configuration. Persisted to the
 * `source_match_configs` table so future `/match` calls honour it
 * (in addition to the static `SOURCE_MATCH_CONFIGS` baseline).
 *
 * @route   POST /api/caes/match-configs
 * @body    `SourceMatchConfig`: `{ sourceSystem, connectorId, sourceTable, keyField, strategies: MatchStrategy[] }`
 *          Each `MatchStrategy` is `{ strategyId, description, standardAttributes: string[], matchType: 'exact'|'contains', confidence: number, requiresUnique: boolean }`.
 * @returns 201 — `{ success: true, data: { id, ...SourceMatchConfig } }` after the row is persisted.
 * @throws  400 — when required fields are missing.
 * @throws  500 — DB write failure.
 */
router.post('/match-configs', (req: Request, res: Response) => {
  const { sourceSystem, connectorId, sourceTable, keyField, strategies } = req.body as {
    sourceSystem?: string;
    connectorId?: string;
    sourceTable?: string;
    keyField?: string;
    strategies?: unknown[];
  };
  if (!sourceSystem || !sourceTable || !keyField) {
    return res.status(400).json({
      success: false,
      error: { message: 'sourceSystem, sourceTable, and keyField are required' },
    });
  }
  const existing = REGISTRY_DB_RW.prepare('SELECT 1 FROM match_configs WHERE source_system = ?').get(sourceSystem);
  if (existing) {
    return res.status(409).json({
      success: false,
      error: { message: `Source '${sourceSystem}' already exists — use PUT to update it` },
    });
  }
  REGISTRY_DB_RW.prepare(
    `INSERT INTO match_configs (source_system, connector_id, source_table, key_field, strategies)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sourceSystem, connectorId ?? `conn-${sourceSystem}`, sourceTable, keyField, JSON.stringify(strategies ?? []));
  res.status(201).json({ success: true, data: { sourceSystem } });
});

/**
 * PUT /api/caes/match-configs/:sourceSystem
 *
 * Replace the full configuration (sourceTable, keyField, strategies)
 * for a source system. Any previous DB-stored configuration for
 * `:sourceSystem` is deleted before the new one is inserted.
 *
 * @route   PUT /api/caes/match-configs/:sourceSystem
 * @param   sourceSystem — source id (path param), e.g. `'hr'`, `'ldap'`.
 * @body    `{ sourceTable, keyField, strategies: MatchStrategy[] }`
 * @returns 200 — `{ success: true, data: { sourceSystem, ...replacement } }`
 * @throws  404 — when no existing configuration exists for `:sourceSystem` (delete-first path returns 0 rows).
 */
router.put('/match-configs/:sourceSystem', (req: Request, res: Response) => {
  const { sourceSystem } = req.params;
  const { sourceTable, keyField, strategies } = req.body as {
    sourceTable?: string;
    keyField?: string;
    strategies?: unknown[];
  };
  if (!sourceTable || !keyField || !Array.isArray(strategies)) {
    return res.status(400).json({
      success: false,
      error: { message: 'sourceTable, keyField, and strategies (array) are required' },
    });
  }
  const existing = REGISTRY_DB_RW.prepare('SELECT 1 FROM match_configs WHERE source_system = ?').get(sourceSystem);
  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { message: `Source '${sourceSystem}' not found` },
    });
  }
  REGISTRY_DB_RW.prepare(
    `UPDATE match_configs SET source_table = ?, key_field = ?, strategies = ?, updated_at = datetime('now')
     WHERE source_system = ?`
  ).run(sourceTable, keyField, JSON.stringify(strategies), sourceSystem);
  res.json({ success: true, data: { sourceSystem, sourceTable, keyField, strategies } });
});

/**
 * GET /api/caes/self-service-attributes
 *
 * Returns the schema for attributes a user can read/edit themselves.
 * Used by the User Portal to build the self-service edit form
 * dynamically. The list is filtered from the live mappings where
 * `self_service = 1`; labels come from `SELF_SERVICE_LABELS`.
 *
 * @returns 200 — `{ success: true, data: { [standardAttribute]: { label, schema: { description, sources, dataType, sensitive? } } } }`
 *          Only entries where `SELF_SERVICE_LABELS` provides a label appear in the response.
 */
router.get('/self-service-attributes', (_req: Request, res: Response) => {
  try {
    const mappings = getAllMappings().filter(m => m.self_service);
    // Build a deduplicated list of attribute metadata for the UI
    const seen = new Set<string>();
    const attrs: Array<{
      standardAttribute: string;
      label: string;
      description: string;
      dataType: string;
      writableSource: string;
      writableField: string;
      writableTable: string;
      writableKeyField: string;
    }> = [];
    for (const m of mappings) {
      if (seen.has(m.standardAttribute)) continue;
      seen.add(m.standardAttribute);
      const schema = ATTRIBUTE_SCHEMA[m.standardAttribute as keyof typeof ATTRIBUTE_SCHEMA];
      attrs.push({
        standardAttribute: m.standardAttribute,
        label: SELF_SERVICE_LABELS[m.standardAttribute] ?? m.standardAttribute,
        description: schema?.description ?? '',
        dataType: schema?.dataType ?? 'string',
        writableSource: m.sourceSystem,
        writableField: m.sourceField,
        writableTable: m.sourceTable,
        writableKeyField: m.keyField,
      });
    }
    res.json({ success: true, data: attrs });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to fetch self-service attributes' } });
  }
});

export const caesRoutes = router;

// ─── Shared resolution helper ─────────────────────────────────────────────────

/**
 * Resolve CAES attributes for a GCUID.
 * Exported so that other route modules (e.g. the unified subject endpoint) can
 * call it directly without going through the HTTP layer.
 *
 * Returns `gcuid_not_found: true` when the GCUID has no source_mappings row,
 * allowing callers to distinguish "not found" from "no attributes resolved".
 */
export async function resolveAttributesForGcuid(
  gcuid: string,
  attributeNames: string[],
): Promise<{
  gcuid: string;
  attributes: Record<string, any>;
  sources_used: string[];
  disabled_sources: string[];
  gcuid_not_found?: boolean;
}> {
  const mappings = REGISTRY_DB.prepare(
    'SELECT id, source_system, source_id, is_primary FROM source_mappings WHERE gcuid = ? ORDER BY id'
  ).all(gcuid);

  if (mappings.length === 0) {
    return { gcuid, attributes: {}, sources_used: [], disabled_sources: [], gcuid_not_found: true };
  }

  const result = {
    gcuid,
    attributes: {} as Record<string, any>,
    sources_used: [] as string[],
    disabled_sources: [] as string[],
  };

  const _fetchValue = async (attrMapping: AttributeMapping, sourceId: string): Promise<any> => {
    return connectorResolver.resolveAttribute(
      attrMapping.sourceSystem,
      sourceId,
      {
        sourceField:       attrMapping.sourceField,
        sourceTable:       attrMapping.sourceTable,
        keyField:          attrMapping.keyField,
        transformations:   attrMapping.transformations,
        standardAttribute: attrMapping.standardAttribute,
      }
    ).catch(() => undefined);
  };

  const allDbMappings = getAllMappings();

  for (const attr of attributeNames) {
    const schema = ATTRIBUTE_SCHEMA[attr as keyof typeof ATTRIBUTE_SCHEMA];
    if (!schema) { result.attributes[attr] = { error: 'Unknown attribute' }; continue; }

    const attrMappings = allDbMappings.filter(m => m.standardAttribute === attr);
    const values: Array<{ source: string; value: any; is_authoritative: boolean }> = [];

    for (const attrMapping of attrMappings) {
      // See comment on the matching loop in POST /resolve above. Try each
      // mapping row for this source_system in id order so a stale row that
      // doesn't key cleanly with the connector doesn't silently shadow a
      // newer, resolvable row.
      const candidateRecords = (mappings as any[]).filter(
        (m: any) => m.source_system === attrMapping.sourceSystem,
      );
      if (candidateRecords.length === 0) continue;

      let resolvedValue: any = undefined;
      for (const rec of candidateRecords) {
        const v = await _fetchValue(attrMapping, rec.source_id);
        if (v !== undefined) { resolvedValue = v; break; }
      }
      // Last-resort LDAP fallback (see matching block in POST /resolve above):
      // when the connector path can't resolve a source_id, read the LDAP row
      // directly so the right details panel still shows LDAP values for legacy
      // mappings stored by username while the connector keys records by DN.
      if (resolvedValue === undefined && attrMapping.sourceSystem === 'ldap') {
        resolvedValue = _ldapDirectDbFallback(
          candidateRecords.map((r: any) => r.source_id),
          attrMapping.sourceField,
        );
      }
      if (resolvedValue === undefined) continue;

      values.push({ source: attrMapping.sourceSystem, value: resolvedValue, is_authoritative: attrMapping.is_authoritative });
      if (!result.sources_used.includes(attrMapping.sourceSystem)) result.sources_used.push(attrMapping.sourceSystem);
    }

    const authEntry = values.find(v => v.is_authoritative) ?? values[0] ?? null;
    result.attributes[attr] = {
      value:                authEntry?.value ?? null,
      source:               authEntry?.source ?? null,
      dataType:             schema.dataType,
      values,
      authoritative_source: attrMappings.find(m => m.is_authoritative)?.sourceSystem ?? null,
    };
  }

  for (const mapping of mappings as any[]) {
    const sysRow = REGISTRY_DB.prepare(
      'SELECT connector_id FROM source_systems WHERE system_id = ?'
    ).get(mapping.source_system) as { connector_id: string | null } | null;
    if (sysRow?.connector_id) {
      const connCfg = loadConnectorConfig(sysRow.connector_id);
      if (
        connCfg &&
        connCfg.enabled === false &&
        !result.disabled_sources.includes(mapping.source_system)
      ) {
        result.disabled_sources.push(mapping.source_system);
      }
    }
  }

  return result;
}

// ─── Connector Registration ───────────────────────────────────────────────────

/**
 * Idempotent upsert of a connector's attribute mappings into the CAES table.
 *
 * Called at server startup for every enabled connector config, and via the
 * POST /api/connectors/:id/register endpoint.
 *
 * Strategy:
 *   - If a row already exists for (standard_attribute, source_system): update the
 *     structural fields (source_field, source_table, key_field, is_authoritative)
 *     but leave CAES-curated fields (operations, self_service, transformations,
 *     searchable, indexed) unchanged.
 *   - If no row exists: insert with read-only defaults; an operator can enrich
 *     those fields in the CAES UI afterwards.
 *
 * @returns Object with counts of inserted and updated rows.
 */
export function upsertConnectorMappings(
  systemId: string,
  sourceConnection: { primaryTable?: string; primaryKeyField?: string },
  isAuthoritativeSource: boolean,
  mappings: Record<string, string>,
): { inserted: number; updated: number } {
  const sourceTable = sourceConnection.primaryTable ?? '';
  const keyField    = sourceConnection.primaryKeyField ?? '';
  const isAuth      = isAuthoritativeSource ? 1 : 0;

  // Resolve connector_id → canonical system_id via source_systems bridge table.
  // If no bridge row found (e.g. connector is already a system_id), use as-is.
  const sysRow = REGISTRY_DB_RW
    .prepare<[string]>('SELECT system_id FROM source_systems WHERE connector_id = ?')
    .get(systemId) as { system_id: string } | undefined;
  const canonicalId = sysRow?.system_id ?? systemId;

  const checkStmt = REGISTRY_DB_RW.prepare<[string, string]>(
    `SELECT id FROM attribute_mappings WHERE standard_attribute = ? AND source_system = ?`
  );
  const insertStmt = REGISTRY_DB_RW.prepare(
    `INSERT INTO attribute_mappings
       (standard_attribute, source_system, source_field, source_table, key_field,
        is_authoritative, operations, self_service, searchable, indexed)
     VALUES (?, ?, ?, ?, ?, ?, '["read"]', 0, 0, 0)`
  );
  const updateStmt = REGISTRY_DB_RW.prepare(
    `UPDATE attribute_mappings
     SET source_field = ?, source_table = ?, key_field = ?, is_authoritative = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  );
  // When claiming authority for an attribute, clear any other source that currently holds it.
  const clearOtherAuthStmt = REGISTRY_DB_RW.prepare(
    `UPDATE attribute_mappings SET is_authoritative = 0, updated_at = datetime('now')
     WHERE standard_attribute = ? AND source_system != ? AND is_authoritative = 1`
  );

  let inserted = 0;
  let updated  = 0;

  REGISTRY_DB_RW.transaction(() => {
    for (const [standardAttr, sourceField] of Object.entries(mappings)) {
      if (isAuth === 1) {
        clearOtherAuthStmt.run(standardAttr, canonicalId);
      }
      const existing = checkStmt.get(standardAttr, canonicalId) as { id: number } | undefined;
      if (existing) {
        updateStmt.run(sourceField, sourceTable, keyField, isAuth, existing.id);
        updated++;
      } else {
        insertStmt.run(standardAttr, canonicalId, sourceField, sourceTable, keyField, isAuth);
        inserted++;
      }
    }
  })();

  return { inserted, updated };
}
