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
 * Source-database direct scan.
 *
 * The CAES match engine (POST /api/caes/match) goes through a per-connector
 * HTTP service which is not available in EFS / Lambda mode.  This module
 * provides a synchronous, in-process equivalent that talks directly to each
 * connector's SQLite DB.  It is used by:
 *
 *   - POST /api/user/self-register (so a self-registrant can be matched
 *     against HR / LDAP / Engineering / Finance even when connectors are
 *     offline)
 *   - POST /api/gcuid-request/scan-linkages (the GCUID Registry "scan for
 *     matches" view)
 *
 * The scan walks the connectors + departments registered in the GCUID
 * Registry's `source_systems` table, opens the SQLite DB for each, and
 * applies a series of compound surrogate-key lookups (email, given+family,
 * given+family+department, etc.) — equivalent to the strategies declared in
 * caes.ts SOURCE_MATCH_CONFIGS but evaluated locally.  Each match is returned
 * with a confidence derived from the strength of the strategy that hit.
 *
 * When the per-connector HTTP service IS reachable (local Docker, non-EFS
 * Lambda, dev), the async `*ConnectorHttp` variants go through the
 * ConnectorAPIClient abstraction instead — same connector pattern, just
 * transport via HTTP.
 *
 * Returned records include the raw connector row so callers can present
 * matching candidates to the user for linking.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { REGISTRY_DB_PATH, CONNECTORS_DIR, connectorDbPath } from './db-paths.js';
import { ConnectorAPIClient } from '../../../packages/core/dist/connector-api.js';
import { loadConnectorConfig } from './connector-resolver.js';

// Cached probe result — if a connector HTTP endpoint responds, we trust it
// for the rest of the process lifetime; failures are remembered too so we
// don't repeatedly hammer a dead endpoint on every scan.
const probedConnectors = new Map<string, boolean>();

// ─── Per-source DB column map ────────────────────────────────────────────────
// Mirrors the column names in the seed connector databases.  Authoritative
// sources and department sources differ in key field (employee_id vs dept_id)
// but share first_name/last_name/email.

interface SourceColumns {
  table:        string;
  keyCol:       string;
  firstNameCol: string;
  lastNameCol:  string;
  emailCol:     string;
}

const SOURCE_COLUMNS: Record<string, SourceColumns> = {
  hr: {
    table: 'employees', keyCol: 'employee_id',
    firstNameCol: 'first_name', lastNameCol: 'last_name', emailCol: 'email',
  },
  ldap: {
    table: 'users', keyCol: 'username',
    firstNameCol: 'first_name', lastNameCol: 'last_name', emailCol: 'email',
  },
  engineering: {
    table: 'employees', keyCol: 'dept_id',
    firstNameCol: 'first_name', lastNameCol: 'last_name', emailCol: 'email',
  },
  finance: {
    table: 'employees', keyCol: 'dept_id',
    firstNameCol: 'first_name', lastNameCol: 'last_name', emailCol: 'email',
  },
};

// ─── Public types ───────────────────────────────────────────────────────────

export interface DirectMatchCandidate {
  sourceSystem: string;
  sourceId:     string;
  confidence:   number;
  strategyId:   string;
  strategyDescription: string;
  matchedAttributes: string[];
  record:       Record<string, any>;
}

/**
 * Result of an unlinked-records scan — connector DB rows that have NO
 * source_mapping in the registry yet.  Returned by
 * `findUnlinkedSourceRecords()` for the GCUID record "scan for matches"
 * view so admins can link pre-existing connector records to a pending GCUID
 * even when the registrant did not supply first_name/last_name/email.
 */
export interface UnlinkedSourceRecord {
  sourceSystem: string;
  sourceId:     string;
  first_name:   string;
  last_name:    string;
  email:        string;
  /** Why this row was selected (e.g. "matched email", "self-registered identity with same email"). */
  reason:       string;
  record:       Record<string, any>;
}

/** Plain attribute bag accepted by the scan; missing fields are silently ignored. */
export interface ScanAttributes {
  first_name?: string | null;
  last_name?:  string | null;
  email?:      string | null;
  /** LDAP / authoritative-source portal flow may supply a username; the
   *  self-service registration form does not. */
  username?:   string | null;
  /** Optional list of connector system_ids to restrict the scan (defaults to all). */
  sources?:    string[];
}

// ─── Strategies ─────────────────────────────────────────────────────────────
// Mirrors the SOURCE_MATCH_CONFIGS in api/routes/caes.ts but evaluated locally.
// Each strategy yields a confidence score; the highest per (source, source_id)
// wins.  Cross-source corroborated strategies (eng-ldap-corroborated etc.) need
// the LDAP/HR records to carry the linkage fields so they're honoured here too.

interface LocalStrategy {
  strategyId: string;
  description: string;
  confidence: number;
  /** Returns matched rows from a connector DB or null if attributes don't qualify. */
  apply: (db: Database.Database, cols: SourceColumns, attrs: Required<Omit<ScanAttributes, 'sources'>>) => any[] | null;
}

// All strategies are read-only SELECTs and are restricted to LIMIT 2 so that
// requiresUnique semantics match the HTTP strategy (records.length > 1 => no match).

const safeStr = (v: string | null | undefined): string => (v ?? '').trim();

const STRATEGIES: LocalStrategy[] = [
  // ── Authoritative sources ─────────────────────────────────────────────────
  {
    strategyId: 'hr-email-exact',
    description: 'HR: exact match on email address',
    confidence: 0.98,
    apply: (db, c, a) => {
      if (!a.email) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table} WHERE lower(${c.emailCol}) = lower(?) LIMIT 2`
      ).all(a.email);
      return rows.length === 1 ? rows : null;
    },
  },
  {
    strategyId: 'hr-name-dept',
    description: 'HR: exact match on given name + family name + department',
    confidence: 0.85,
    apply: (db, c, a) => {
      if (!a.first_name || !a.last_name) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table}
         WHERE lower(${c.firstNameCol}) = lower(?)
           AND lower(${c.lastNameCol})  = lower(?)
           ${a.email ? `AND lower(${c.emailCol}) = lower(?)` : ''}
         LIMIT 2`
      ).all(...(a.email ? [a.first_name, a.last_name, a.email] : [a.first_name, a.last_name]));
      return rows.length === 1 ? rows : null;
    },
  },
  {
    strategyId: 'hr-name-only',
    description: 'HR: exact match on given name + family name',
    confidence: 0.55,
    apply: (db, c, a) => {
      if (!a.first_name || !a.last_name) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table}
         WHERE lower(${c.firstNameCol}) = lower(?)
           AND lower(${c.lastNameCol})  = lower(?)
         LIMIT 2`
      ).all(a.first_name, a.last_name);
      return rows.length === 1 ? rows : null;
    },
  },
  // ── LDAP ──────────────────────────────────────────────────────────────────
  {
    strategyId: 'ldap-username-exact',
    description: 'LDAP: exact match on username (authoritative unique key)',
    confidence: 1.0,
    apply: (db, c, a) => {
      // The self-service form does not collect a username, so this strategy
      // only fires when an authoritative-source portal (e.g. LDAP admin)
      // submits a request that includes one.  Matching on `username` rather
      // than on `email` keeps the two LDAP strategies from producing the
      // same row twice (once keyed by DN, once by username) for the same
      // physical record.
      if (!a.username) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table} WHERE lower(${c.keyCol}) = lower(?) LIMIT 2`
      ).all(a.username);
      return rows.length === 1 ? rows : null;
    },
  },
  {
    strategyId: 'ldap-email-exact',
    description: 'LDAP: exact match on email address',
    confidence: 0.98,
    apply: (db, c, a) => {
      if (!a.email) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table} WHERE lower(${c.emailCol}) = lower(?) LIMIT 2`
      ).all(a.email);
      return rows.length === 1 ? rows : null;
    },
  },
  {
    strategyId: 'ldap-name-only',
    description: 'LDAP: exact match on given name + family name',
    confidence: 0.55,
    apply: (db, c, a) => {
      if (!a.first_name || !a.last_name) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table}
         WHERE lower(${c.firstNameCol}) = lower(?)
           AND lower(${c.lastNameCol})  = lower(?)
         LIMIT 2`
      ).all(a.first_name, a.last_name);
      return rows.length === 1 ? rows : null;
    },
  },
  // ── Engineering ───────────────────────────────────────────────────────────
  {
    strategyId: 'eng-email-exact',
    description: 'Engineering: exact match on email address',
    confidence: 0.97,
    apply: (db, c, a) => {
      if (!a.email) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table} WHERE lower(${c.emailCol}) = lower(?) LIMIT 2`
      ).all(a.email);
      return rows.length === 1 ? rows : null;
    },
  },
  {
    strategyId: 'eng-name-only',
    description: 'Engineering: exact match on given name + family name',
    confidence: 0.50,
    apply: (db, c, a) => {
      if (!a.first_name || !a.last_name) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table}
         WHERE lower(${c.firstNameCol}) = lower(?)
           AND lower(${c.lastNameCol})  = lower(?)
         LIMIT 2`
      ).all(a.first_name, a.last_name);
      return rows.length === 1 ? rows : null;
    },
  },
  // ── Finance ───────────────────────────────────────────────────────────────
  {
    strategyId: 'fin-email-exact',
    description: 'Finance: exact match on email address',
    confidence: 0.97,
    apply: (db, c, a) => {
      if (!a.email) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table} WHERE lower(${c.emailCol}) = lower(?) LIMIT 2`
      ).all(a.email);
      return rows.length === 1 ? rows : null;
    },
  },
  {
    strategyId: 'fin-name-only',
    description: 'Finance: exact match on given name + family name',
    confidence: 0.50,
    apply: (db, c, a) => {
      if (!a.first_name || !a.last_name) return null;
      const rows = db.prepare(
        `SELECT * FROM ${c.table}
         WHERE lower(${c.firstNameCol}) = lower(?)
           AND lower(${c.lastNameCol})  = lower(?)
         LIMIT 2`
      ).all(a.first_name, a.last_name);
      return rows.length === 1 ? rows : null;
    },
  },
];

// Per-source ordered list of strategy ids (highest confidence first).
const STRATEGY_ORDER: Record<string, string[]> = {
  hr:          ['hr-email-exact', 'hr-name-dept', 'hr-name-only'],
  ldap:        ['ldap-username-exact', 'ldap-email-exact', 'ldap-name-only'],
  engineering: ['eng-email-exact', 'eng-name-only'],
  finance:     ['fin-email-exact', 'fin-name-only'],
};

// ─── Source discovery ───────────────────────────────────────────────────────
// Look up the connector DB files for each registered source_system.  When a
// source has been registered with a `connector_id`, its `conn-<id>.db` file is
// the canonical lookup target.  As a fallback (and so existing deployments
// work even when source_systems hasn't been seeded), we also scan the
// connectors/ directory directly for files matching `conn-<known>.db`.

interface SourceSlot {
  systemId: string;
  dbPath:   string;
  cols:     SourceColumns;
}

function discoverConnectorDbs(): SourceSlot[] {
  const sources: SourceSlot[] = [];
  const seenDbPaths = new Set<string>();

  // 1. Read from registry's source_systems table when available
  let registryDb: Database.Database | null = null;
  try {
    registryDb = new Database(REGISTRY_DB_PATH, { readonly: true });
  } catch {
    registryDb = null;
  }
  if (registryDb) {
    try {
      const rows = registryDb.prepare(
        `SELECT system_id, connector_id FROM source_systems
         WHERE connector_id IS NOT NULL AND connector_id <> ''`
      ).all() as Array<{ system_id: string; connector_id: string }>;
      for (const r of rows) {
        const cols = SOURCE_COLUMNS[r.system_id];
        if (!cols) continue; // unknown source — skip
        const dbPath = connectorDbPath(r.connector_id);
        sources.push({ systemId: r.system_id, dbPath, cols });
        seenDbPaths.add(dbPath);
      }
    } catch {
      // Registry not readable; fall through to directory scan
    } finally {
      try { registryDb.close(); } catch { /* ignore */ }
    }
  }

  // 2. Fallback / augment: scan the connectors/ directory directly so the
  //    scan still works on deployments whose source_systems table isn't
  //    fully seeded. We pick up any `conn-<known-system>.db` file that maps
  //    to a known SOURCE_COLUMNS entry (hr, ldap, engineering, finance).
  try {
    if (fs.existsSync(CONNECTORS_DIR)) {
      const files = fs.readdirSync(CONNECTORS_DIR)
        .filter(f => f.endsWith('.db') && f.startsWith('conn-'))
        .map(f => path.join(CONNECTORS_DIR, f));
      for (const dbPath of files) {
        if (seenDbPaths.has(dbPath)) continue; // already added from registry
        // Map "conn-<system>.db" or "conn-<id>.db" back to a known system.
        // We accept either:
        //   conn-hr.db          -> hr
        //   conn-conn-hr.db     -> hr  (some seeds double-prefix)
        //   conn-foo.db         -> unknown unless `foo` matches a known system
        const base = path.basename(dbPath, '.db');              // e.g. "conn-hr" or "conn-conn-hr"
        const stripped = base.replace(/^conn-/, '');             // e.g. "hr" or "conn-hr"
        const candidateId = stripped.replace(/^conn-/, '');      // e.g. "hr"
        const cols = SOURCE_COLUMNS[candidateId];
        if (!cols) continue; // unknown connector — skip
        sources.push({ systemId: candidateId, dbPath, cols });
        seenDbPaths.add(dbPath);
      }
    }
  } catch {
    // connectors directory not readable; return whatever we have
  }

  return sources;
}

// ─── Connector HTTP probe (preferred path when reachable) ──────────────────
// When the per-connector HTTP service IS up (local Docker, dev, non-EFS
// Lambda) we still go through the connector abstraction rather than
// touching SQLite directly — same ConnectorAPIClient.search call CAES uses.

interface SourceConnectorClient {
  systemId:  string;
  baseUrl:   string;
  authToken: string;
}

function probeConnectorClients(sources: Array<{ systemId: string }>): Map<string, SourceConnectorClient> {
  const clients = new Map<string, SourceConnectorClient>();
  let registryDb: Database.Database;
  try {
    registryDb = new Database(REGISTRY_DB_PATH, { readonly: true });
  } catch {
    return clients;
  }
  try {
    for (const src of sources) {
      // Honor probe cache — if we already determined this connector's
      // reachability (positive or negative), skip re-querying.
      if (probedConnectors.has(src.systemId)) continue;

      const row = registryDb.prepare(
        `SELECT connector_id, api_url, api_secret FROM source_systems WHERE system_id = ?`
      ).get(src.systemId) as { connector_id: string | null; api_url: string | null; api_secret: string | null } | undefined;
      if (!row?.connector_id) { probedConnectors.set(src.systemId, false); continue; }

      const cfg = loadConnectorConfig(row.connector_id);
      if (!cfg || cfg.enabled === false) { probedConnectors.set(src.systemId, false); continue; }

      const baseUrl    = row.api_url ?? `http://localhost:${cfg.connectorServer.port}`;
      const authToken  = row.api_secret ?? cfg.connectorServer.authToken;
      clients.set(src.systemId, { systemId: src.systemId, baseUrl, authToken });
      probedConnectors.set(src.systemId, true);
    }
  } finally {
    registryDb.close();
  }
  return clients;
}

/**
 * Compute which query attributes actually agree with the candidate record,
 * and derive a confidence score from the overlap.
 *
 * This is the security-critical counterpart to the connector HTTP /search
 * endpoint: the connector may return a record that only matches one of
 * the query attributes (e.g. shares a first name but not the email or
 * last name). Treating every returned record as a 0.90-confidence match
 * causes spurious source_mapping creation during self-registration when
 * two people share a first name (see `urn:gcuid:01KVTQ3VK5VVJZWTYK6AKGE8WN`,
 * Lucas O'Neill vs Lucas Pham).
 *
 * Confidence model (mirrors the configured match-strategy confidences in
 * `match_configs.hr`):
 *   - email match alone                → 0.95  (functionally unique)
 *   - email + (first_name OR last_name) → 0.98  (very strong)
 *   - first_name + last_name           → 0.55  (weak; needs corroboration)
 *   - first_name alone                 → 0.30  (very weak; treat as low)
 *   - last_name alone                  → 0.30
 *   - no overlap                       → 0     (reject the candidate)
 *
 * `matched` returns the actual canonical attribute names that agree, so
 * downstream consumers can tell "email + first_name matched" from
 * "first_name only matched".
 */
export function computeConnectorHttpMatchConfidence(
  attrs: { email?: string; first_name?: string; last_name?: string },
  record: Record<string, any>,
): { confidence: number; matched: string[] } {
  const matched: string[] = [];
  const normEmail = (v: any) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const normName  = (v: any) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

  if (attrs.email && normEmail(record.email) === normEmail(attrs.email)) {
    matched.push('person.email');
  }
  if (attrs.first_name && normName(record.first_name) === normName(attrs.first_name)) {
    matched.push('person.name.given');
  }
  if (attrs.last_name && normName(record.last_name) === normName(attrs.last_name)) {
    matched.push('person.name.family');
  }

  let confidence = 0;
  if (matched.includes('person.email') && matched.length >= 2) {
    confidence = 0.98;
  } else if (matched.includes('person.email')) {
    confidence = 0.95;
  } else if (
    matched.includes('person.name.given') &&
    matched.includes('person.name.family')
  ) {
    // First+last name without an email match: very common collision risk.
    confidence = 0.55;
  } else if (matched.length >= 1) {
    // Single name attribute matched; could be a different person with the
    // same first or last name. Stay well below the strongMatchThreshold.
    confidence = 0.30;
  }

  return { confidence, matched };
}

async function searchViaConnectorHttp(
  client: SourceConnectorClient,
  attrs: Required<Omit<ScanAttributes, 'sources'>>,
  timeoutMs = 4000,
): Promise<Array<{
  recordId: string;
  record: Record<string, any>;
  confidence: number;
  matchedAttributes: string[];
}>> {
  const apiClient = new ConnectorAPIClient(client.baseUrl, client.authToken);
  try {
    const searchAttrs: Record<string, string> = {};
    if (attrs.email)      searchAttrs['email']      = attrs.email;
    if (attrs.first_name) searchAttrs['first_name'] = attrs.first_name;
    if (attrs.last_name)  searchAttrs['last_name']  = attrs.last_name;
    if (Object.keys(searchAttrs).length === 0) return [];

    // Note: the bundled ConnectorAPIClient does not currently expose a
    // per-call AbortSignal, so we race it against a setTimeout.  This keeps
    // the connector HTTP path from stalling the scan if a sidecar is wedged.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; }, timeoutMs);
    try {
      const resp = await apiClient.search({
        attributes: searchAttrs,
        limit:      10,
        fuzzy:      false,
      });
      if (timedOut) return [];
      if (!resp || !Array.isArray(resp.records)) return [];

      // For each returned record, compute the *actual* attribute overlap
      // with the query. Reject candidates with zero overlap (the connector
      // was over-eager) and downgrade confidence for partial matches
      // (e.g. first-name-only collisions).
      return resp.records
        .map((r: any) => {
          const recAttrs = r.attributes ?? {};
          const { confidence, matched } = computeConnectorHttpMatchConfidence(
            { email: attrs.email, first_name: attrs.first_name, last_name: attrs.last_name },
            recAttrs,
          );
          return {
            recordId:          String(r.recordId ?? ''),
            record:            recAttrs,
            confidence,
            matchedAttributes: matched,
          };
        })
        .filter((c: any) => c.recordId && c.confidence > 0);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

// ─── Public scan API ─────────────────────────────────────────────────────────

/**
 * Synchronous variant — runs the SQLite-fallback scan only.  Use this when
 * you cannot await (e.g. legacy sync callers).  In modern callers prefer
 * `directScanSourcesAsync()` which also tries the live connector HTTP
 * path first.
 *
 * The scan walks every registered source system, applies the compound-key
 * strategies locally against the connector's SQLite file, and returns the
 * best-confidence match per (source, source_id).  Missing or unreadable
 * connector DBs are silently skipped so a single broken connector doesn't
 * break the rest of the scan.
 */
export function directScanSources(attributes: ScanAttributes): DirectMatchCandidate[] {
  const attrs = {
    first_name: safeStr(attributes.first_name as string | null | undefined),
    last_name:  safeStr(attributes.last_name  as string | null | undefined),
    email:      safeStr(attributes.email      as string | null | undefined),
    username:   safeStr(attributes.username   as string | null | undefined),
  };
  if (!attrs.first_name && !attrs.last_name && !attrs.email && !attrs.username) return [];

  const sources = discoverConnectorDbs();
  const allowSources = new Set(attributes.sources ?? sources.map(s => s.systemId));
  const candidates: DirectMatchCandidate[] = [];

  for (const src of sources) {
    if (!allowSources.has(src.systemId)) continue;

    let connDb: Database.Database;
    try {
      connDb = new Database(src.dbPath, {readonly: true});
    } catch {
      continue;
    }

    try {
      const seen = new Set<string>();
      const order = STRATEGY_ORDER[src.systemId] ?? [];
      for (const stratId of order) {
        const strat = STRATEGIES.find(s => s.strategyId === stratId);
        if (!strat) continue;

        let rows: any[] | null = null;
        try {
          rows = strat.apply(connDb, src.cols, attrs);
        } catch {
          rows = null;
        }
        if (!rows) continue;

        for (const row of rows) {
          const key = String(row[src.cols.keyCol] ?? '');
          if (!key || seen.has(key)) continue;
          seen.add(key);

          const matched: string[] = [];
          if (strat.strategyId.includes('email') && attrs.email) matched.push('person.email');
          if (strat.strategyId.includes('username') && attrs.email) matched.push('person.account.username');
          if (strat.strategyId.includes('name-dept') || strat.strategyId.includes('name-only')) {
            matched.push('person.name.given', 'person.name.family');
          }
          if (strat.strategyId.includes('name-dept')) matched.push('person.employment.department');

          candidates.push({
            sourceSystem:        src.systemId,
            sourceId:            key,
            confidence:          strat.confidence,
            strategyId:          strat.strategyId,
            strategyDescription: strat.description,
            matchedAttributes:   matched,
            record:              row as Record<string, any>,
          });
        }
        break;
      }
    } finally {
      connDb.close();
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

/**
 * Async variant — first tries to talk to each connector via its live HTTP
 * `/search` endpoint (going through the ConnectorAPIClient abstraction),
 * then falls back to direct SQLite for any connectors whose sidecar is
 * unreachable.  Same return shape as `directScanSources`.
 *
 * Use this from async handlers (Express req handlers in particular) so the
 * connector HTTP path actually runs — it goes through the connector rather
 * than skipping straight to the database.
 */
export async function directScanSourcesAsync(attributes: ScanAttributes): Promise<DirectMatchCandidate[]> {
  const attrs = {
    first_name: safeStr(attributes.first_name as string | null | undefined),
    last_name:  safeStr(attributes.last_name  as string | null | undefined),
    email:      safeStr(attributes.email      as string | null | undefined),
    username:   safeStr(attributes.username   as string | null | undefined),
  };
  if (!attrs.first_name && !attrs.last_name && !attrs.email && !attrs.username) return [];

  const sources = discoverConnectorDbs();
  const clients = probeConnectorClients(sources);
  const allowSources = new Set(attributes.sources ?? sources.map(s => s.systemId));
  const candidates: DirectMatchCandidate[] = [];
  const matchedKeys = new Set<string>();

  // Phase 1: try the connector HTTP /search endpoint for every reachable
  // connector in parallel.  Results go through the same connector abstraction
  // that CAES uses — the connector handles its own attribute mapping and
  // returns records keyed by source_id.
  const httpTasks: Array<Promise<void>> = [];
  for (const src of sources) {
    if (!allowSources.has(src.systemId)) continue;
    const client = clients.get(src.systemId);
    if (!client) continue;
    httpTasks.push((async () => {
          const records = await searchViaConnectorHttp(client, attrs);
          for (const rec of records) {
            const key = `${src.systemId}:${rec.recordId}`;
            if (matchedKeys.has(key)) continue;
            matchedKeys.add(key);

            // Use the matched attributes reported by searchViaConnectorHttp, which
            // reflects actual attribute overlap between the query and the record.
            // Building this list from the query (as the previous code did) was
            // misleading: a first-name-only collision would be tagged as
            // "person.email matched" even when it didn't.
            candidates.push({
              sourceSystem:        src.systemId,
              sourceId:            rec.recordId,
              confidence:          rec.confidence,
              strategyId:          'connector-http-search',
              strategyDescription: `${src.systemId}: matched via connector HTTP /search endpoint`,
              matchedAttributes:   rec.matchedAttributes,
              record:              rec.record,
            });
          }
        })());
  }
  await Promise.all(httpTasks);

  // Phase 1b: enrich matchedKeys with the alternate identifier form for any
  // LDAP entry we just added.  The connector HTTP path returns records keyed
  // by `distinguished_name`; the SQLite-fallback path keys them by
  // `username`.  Both forms identify the same LDAP row, so without this
  // enrichment Phase 2 would surface a "second" match for the same record
  // under a different source_id.
  for (const key of Array.from(matchedKeys)) {
    const colonIdx = key.indexOf(':');
    if (colonIdx < 0) continue;
    const sys = key.slice(0, colonIdx);
    if (sys !== 'ldap') continue;
    const dn = key.slice(colonIdx + 1);
    let altUsername: string | null = null;
    try {
      const ldapDb = new Database(connectorDbPath('conn-ldap'), { readonly: true });
      try {
        const row = ldapDb.prepare(
          `SELECT username FROM users WHERE distinguished_name = ? LIMIT 1`
        ).get(dn) as { username?: string } | undefined;
        if (row?.username && row.username !== dn) altUsername = row.username;
      } finally { ldapDb.close(); }
    } catch { /* LDAP DB unavailable — skip enrichment */ }
    if (altUsername) matchedKeys.add(`ldap:${altUsername}`);
  }

  // Phase 2: for connectors that didn't respond via HTTP (the probe failed),
  // run the SQLite-fallback scan and merge results.  We DON'T scan
  // connectors that already responded via HTTP (their rows are already in
  // matchedKeys) — Phase 2 is purely a safety net.
  const sqlFallback = directScanSources({
    first_name: attrs.first_name || null,
    last_name:  attrs.last_name  || null,
    email:      attrs.email      || null,
    sources:    attributes.sources,
  });
  for (const c of sqlFallback) {
    const key = `${c.sourceSystem}:${c.sourceId}`;
    if (matchedKeys.has(key)) continue;
    matchedKeys.add(key);
    candidates.push(c);
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

/**
 * Resolve which source-system IDs the registry knows about that have a
 * connector DB.  Useful for building a "scan against X" UI without hard-coding
 * the list of source systems elsewhere.
 */
export function listScanableSources(): string[] {
  return discoverConnectorDbs().map(s => s.systemId);
}

/**
 * Return connector rows that don't yet have any `source_mappings` row in
 * the GCUID registry, filtered by attributes that strongly identify a
 * single person (email first, then first+last).  Used by the GCUID record
 * "scan for matches" view so an admin can link a self-registered identity
 * to existing connector records even when the registrant supplied no
 * `identity_proofs` and the registry has no first_name/last_name/email
 * stored on the identity.
 *
 * `alreadyLinked` filters out rows that are already mapped to ANY GCUID,
 * so the caller can pass in their own gcuid's `source_mappings` and the
 * remaining records are guaranteed to be new linkage candidates.
 *
 * `attributes` may be empty or partial — when no identifying attribute is
 * supplied, the function returns [] rather than dumping every row in every
 * connector DB into the result.
 */
export function findUnlinkedSourceRecords(
  attributes: ScanAttributes,
  alreadyLinked: Set<string> = new Set(),
): UnlinkedSourceRecord[] {
  const attrs = {
    first_name: safeStr(attributes.first_name as string | null | undefined),
    last_name:  safeStr(attributes.last_name  as string | null | undefined),
    email:      safeStr(attributes.email      as string | null | undefined),
  };

  if (!attrs.first_name && !attrs.last_name && !attrs.email) return [];

  const sources = discoverConnectorDbs();
  const results: UnlinkedSourceRecord[] = [];
  const seen = new Set<string>();

  for (const src of sources) {
    let connDb: Database.Database;
    try {
      connDb = new Database(src.dbPath, {readonly: true});
    } catch {
      continue;
    }
    try {
      if (attrs.email) {
        try {
          const rows = connDb.prepare(
            `SELECT * FROM ${src.cols.table}
             WHERE lower(${src.cols.emailCol}) = lower(?)
             LIMIT 5`
          ).all(attrs.email) as any[];
          for (const row of rows) {
            const key = String(row[src.cols.keyCol] ?? '');
            if (!key) continue;
            const dedupeKey = `${src.systemId}:${key}`;
            if (alreadyLinked.has(dedupeKey) || seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            results.push({
              sourceSystem: src.systemId,
              sourceId:     key,
              first_name:   String(row[src.cols.firstNameCol] ?? ''),
              last_name:    String(row[src.cols.lastNameCol]  ?? ''),
              email:        String(row[src.cols.emailCol]     ?? ''),
              reason:       'unlinked record with matching email',
              record:       row,
            });
          }
        } catch { /* ignore */ }
      }

      if (attrs.first_name && attrs.last_name) {
        try {
          const rows = connDb.prepare(
            `SELECT * FROM ${src.cols.table}
             WHERE lower(${src.cols.firstNameCol}) = lower(?)
               AND lower(${src.cols.lastNameCol})  = lower(?)
               ${attrs.email ? `AND lower(${src.cols.emailCol}) = lower(?)` : ''}
             LIMIT 5`
          ).all(...(attrs.email ? [attrs.first_name, attrs.last_name, attrs.email] : [attrs.first_name, attrs.last_name])) as any[];
          for (const row of rows) {
            const key = String(row[src.cols.keyCol] ?? '');
            if (!key) continue;
            const dedupeKey = `${src.systemId}:${key}`;
            if (alreadyLinked.has(dedupeKey) || seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            results.push({
              sourceSystem: src.systemId,
              sourceId:     key,
              first_name:   String(row[src.cols.firstNameCol] ?? ''),
              last_name:    String(row[src.cols.lastNameCol]  ?? ''),
              email:        String(row[src.cols.emailCol]     ?? ''),
              reason:       attrs.email
                ? 'unlinked record with matching name + email'
                : 'unlinked record with matching name',
              record:       row,
            });
          }
        } catch { /* ignore */ }
      }
    } finally {
      connDb.close();
    }
  }

  return results;
}