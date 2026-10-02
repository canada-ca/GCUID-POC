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
 * System Dashboard API Routes
 *
 * GET  /api/system/dashboard   — operational snapshot: uptime, DB sizes,
 *                                log sizes, record counts, connector health
 * DELETE /api/system/logs/:system — clear log entries for one system (or 'all')
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createError } from '../middleware/error.js';
import { logSystem } from '../lib/logging/logger.js';
import { SYSTEM_EVENTS } from '../lib/logging/log-events.js';

const router = Router();

import { REGISTRY_DB_PATH as REGISTRY_DB, LOGS_DB_PATH as LOG_DB, CONNECTORS_DIR as CONNECTORS_DB_DIR, connectorDbPath } from '../lib/db-paths.js';
import { BUILD_VERSION, RELEASE_DATE } from '../lib/version.js';

const HR_DB   = connectorDbPath('conn-hr');
const LDAP_DB = connectorDbPath('conn-ldap');

const CONNECTOR_DB_FILES: Array<{ label: string; file: string }> = [
  { label: 'Engineering (connector)',   file: connectorDbPath('conn-engineering') },
  { label: 'Finance (connector)',       file: connectorDbPath('conn-finance') },
  { label: 'HR System (connector)',     file: connectorDbPath('conn-hr') },
  { label: 'LDAP/AD (connector)',       file: connectorDbPath('conn-ldap') },
];

// Plan B option B3 — connector↔source HTTP boundary.
// Each source server is a separate process on its own port; the connector
// proxies to it via SourceAPIClient. The dashboard probes each source's /health
// to surface its reachability in the same place as the connector health.
// Ports are registry-owned (see /e/github/.dev-ports.json — 5187 reserved).
const SOURCE_SERVERS: Array<{ sourceId: string; label: string; port: number }> = [
  { sourceId: 'conn-hr',          label: 'HR Source',          port: 5188 },
  { sourceId: 'conn-ldap',        label: 'LDAP Source',        port: 5189 },
  { sourceId: 'conn-engineering', label: 'Engineering Source', port: 5190 },
  { sourceId: 'conn-finance',     label: 'Finance Source',     port: 5191 },
];

const LOG_SYSTEM_MAP: Record<string, string> = {
  'gcuid-registry': 'log_gcuid_registry',
  'caes':           'log_caes',
  'hr':             'log_hr_system',
  'ldap':           'log_ldap',
  'engineering':    'log_engineering',
  'finance':        'log_finance',
  'system':         'log_system',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/** Row count from a table, returns 0 if DB or table not available. */
function countRows(dbPath: string, table: string): number {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      return row.n;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

/** SQLite page_count × page_size (actual on-disk used space). */
function dbUsedBytes(dbPath: string): number {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const r = db.prepare('PRAGMA page_count').get() as { page_count: number };
      const s = db.prepare('PRAGMA page_size').get()  as { page_size: number };
      return r.page_count * s.page_size;
    } finally {
      db.close();
    }
  } catch {
    return fileSize(dbPath);
  }
}

// ─── GET /api/system/dashboard ────────────────────────────────────────────────

/**
 * GET /api/system/dashboard
 *
 * Operational snapshot for the dashboard tile. Reports server
 * uptime + Node version, identity counts by state, source-system
 * registration status, record counts (HR / LDAP / connectors /
 * cache), database file sizes, log entry totals per system, and
 * (Plan B option B3) HTTP reachability of each source server.
 *
 * Designed for cheap re-poll (no writes, no upserts). All probes
 * are wrapped so a single failed DB or source server doesn't crash
 * the whole response.
 *
 * @returns 200 — `{ success: true, data: { server: { uptime_seconds, uptime_human, node_version, pid, timestamp }, identities: { by_state, total }, source_systems: SourceSystemRow[], record_counts: { hr_employees, ldap_users, connector_records, cache_entries, attribute_mappings_by_source }, databases: { files: [{ label, file_bytes, formatted, exists }], total_bytes, total_formatted }, logs: { total, by_system, db_bytes, db_formatted, db_exists }, sources: [{ sourceId, label, port, status, recordCount?, responseTimeMs, error? }] } }`
 */
router.get('/dashboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // ── Uptime ────────────────────────────────────────────────────────────────
    const uptimeSeconds = Math.floor(process.uptime());

    // ── Registry DB stats ─────────────────────────────────────────────────────
    const registryDb = new Database(REGISTRY_DB, { readonly: true });
    let identityStats: Record<string, any> = {};
    let sourceSystems: any[] = [];
    let cacheStats: Record<string, any> = {};
    let connectorConfigs: any[] = [];
    try {
      // Identity counts by state
      const byState = registryDb.prepare(
        `SELECT state, COUNT(*) AS count FROM identities GROUP BY state`
      ).all() as Array<{ state: string; count: number }>;
      const totalIdentities = (registryDb.prepare(`SELECT COUNT(*) AS n FROM identities`).get() as any).n;

      identityStats = {
        total: totalIdentities,
        by_state: byState,
      };

      // Source systems
      sourceSystems = (registryDb.prepare(
        `SELECT system_id, display_name, system_type, access_mode, last_sync_at, cache_ttl_seconds FROM source_systems`
      ).all() as any[]);

      // Cache counts per system
      const cacheCounts = registryDb.prepare(
        `SELECT system_id, COUNT(*) AS count FROM attribute_cache GROUP BY system_id`
      ).all() as Array<{ system_id: string; count: number }>;
      cacheStats = Object.fromEntries(cacheCounts.map(r => [r.system_id, r.count]));

      // Connector configurations from attribute_mappings (distinct source systems)
      connectorConfigs = (registryDb.prepare(
        `SELECT source_system, COUNT(*) AS mapping_count FROM attribute_mappings GROUP BY source_system`
      ).all() as any[]);
    } finally {
      registryDb.close();
    }

    // ── HR/LDAP record counts ─────────────────────────────────────────────────
    const hrCount    = countRows(HR_DB,   'employees');
    const ldapCount  = countRows(LDAP_DB, 'users');

    // ── Connector DB record counts ────────────────────────────────────────────
    const connectorRecords: Record<string, number> = {
      engineering: countRows(path.join(CONNECTORS_DB_DIR, 'conn-engineering.db'), 'employees'),
      finance:     countRows(path.join(CONNECTORS_DB_DIR, 'conn-finance.db'),     'employees'),
      hr:          countRows(path.join(CONNECTORS_DB_DIR, 'conn-hr.db'),          'employees'),
      ldap:        countRows(path.join(CONNECTORS_DB_DIR, 'conn-ldap.db'),        'users'),
    };

    // ── Database sizes ────────────────────────────────────────────────────────
    const dbSizes = {
      registry: {
        label:      'GCUID Registry',
        path:       'data/registry.db',
        bytes:      dbUsedBytes(REGISTRY_DB),
        file_bytes: fileSize(REGISTRY_DB),
        formatted:  formatBytes(dbUsedBytes(REGISTRY_DB)),
      },
      hr: {
        label:      'HR System',
        path:       'data/sources/conn-hr.db',
        bytes:      dbUsedBytes(HR_DB),
        file_bytes: fileSize(HR_DB),
        formatted:  formatBytes(dbUsedBytes(HR_DB)),
      },
      ldap: {
        label:      'LDAP/AD',
        path:       'data/sources/conn-ldap.db',
        bytes:      dbUsedBytes(LDAP_DB),
        file_bytes: fileSize(LDAP_DB),
        formatted:  formatBytes(dbUsedBytes(LDAP_DB)),
      },
      logs: {
        label:      'System Logs',
        path:       'data/logs.db',
        bytes:      dbUsedBytes(LOG_DB),
        file_bytes: fileSize(LOG_DB),
        formatted:  formatBytes(dbUsedBytes(LOG_DB)),
        exists:     fs.existsSync(LOG_DB),
      },
      connectors: CONNECTOR_DB_FILES.map(c => ({
        label:      c.label,
        path:       path.relative(process.cwd(), c.file).replace(/\\/g, '/'),
        bytes:      dbUsedBytes(c.file),
        file_bytes: fileSize(c.file),
        formatted:  formatBytes(dbUsedBytes(c.file)),
      })),
    };

    // Total disk used by all tracked files
    const allBytes =
      dbSizes.registry.file_bytes +
      dbSizes.hr.file_bytes +
      dbSizes.ldap.file_bytes +
      dbSizes.logs.file_bytes +
      dbSizes.connectors.reduce((s: number, c: any) => s + c.file_bytes, 0);

    // ── Log table row counts per system ───────────────────────────────────────
    let logCounts: Record<string, number> = {};
    if (fs.existsSync(LOG_DB)) {
      try {
        const logDb = new Database(LOG_DB, { readonly: true });
        try {
          for (const [system, table] of Object.entries(LOG_SYSTEM_MAP)) {
            const row = logDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
            logCounts[system] = row.n;
          }
        } finally {
          logDb.close();
        }
      } catch {
        logCounts = {};
      }
    }
    const totalLogs = Object.values(logCounts).reduce((s, n) => s + n, 0);

    // ── Source server health (Plan B option B3) ─────────────────────────────
    // Probe each source's /health in parallel. Failure on any single source
    // is captured in the result rather than crashing the whole response.
    const sourceHealth = await Promise.all(SOURCE_SERVERS.map(async (src) => {
      const t0 = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        try {
          const resp = await fetch(`http://127.0.0.1:${src.port}/health`, {
            signal: controller.signal,
          });
          const ms = Date.now() - t0;
          if (!resp.ok) {
            return {
              sourceId: src.sourceId,
              label:     src.label,
              port:      src.port,
              status:    'unhealthy' as const,
              responseTimeMs: ms,
              error:     `HTTP ${resp.status}`,
            };
          }
          const body = await resp.json() as { status?: string; recordCount?: number };
          return {
            sourceId: src.sourceId,
            label:     src.label,
            port:      src.port,
            status:    body.status === 'healthy' ? 'healthy' as const : 'degraded' as const,
            recordCount: body.recordCount,
            responseTimeMs: ms,
          };
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        return {
          sourceId: src.sourceId,
          label:     src.label,
          port:      src.port,
          status:    'unreachable' as const,
          responseTimeMs: Date.now() - t0,
          error:     (err as Error).message,
        };
      }
    }));

    res.json({
      success: true,
      data: {
        server: {
          uptime_seconds: uptimeSeconds,
          uptime_human: formatUptime(uptimeSeconds),
          node_version: process.version,
          pid: process.pid,
          timestamp: new Date().toISOString(),
        },
        identities: identityStats,
        source_systems: sourceSystems,
        record_counts: {
          hr_employees:    hrCount,
          ldap_users:      ldapCount,
          connector_records: connectorRecords,
          cache_entries:   cacheStats,
          attribute_mappings_by_source: connectorConfigs,
        },
        databases: {
          files: dbSizes,
          total_bytes:    allBytes,
          total_formatted: formatBytes(allBytes),
        },
        logs: {
          total: totalLogs,
          by_system: logCounts,
          db_bytes: dbSizes.logs.file_bytes,
          db_formatted: dbSizes.logs.formatted,
          db_exists: fs.existsSync(LOG_DB),
        },
        sources: sourceHealth,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/system/logs/:system ─────────────────────────────────────────

/**
 * DELETE /api/system/logs/:system
 *
 * Clear log entries for one system (or `'all'`). Maps the URL-safe
 * system id to the underlying log table via `LOG_SYSTEM_MAP`, then
 * runs `DELETE FROM` (no WHERE — all rows). Emits a `CONFIG_RELOADED`
 * notice-level log entry recording what was cleared and how many
 * rows were deleted.
 *
 * @route   DELETE /api/system/logs/:system
 * @param   system — one of `'gcuid-registry' | 'caes' | 'hr' | 'ldap' | 'engineering' | 'finance' | 'system' | 'all'`.
 * @returns 200 — `{ success: true, data: { cleared: string, deleted: number } }`
 * @throws  400 — `createError('Unknown log system ...', 400)` when `:system` is not in `LOG_SYSTEM_MAP` and not `'all'`.
 * @throws  404 — `createError('Log database does not exist', 404)` when `logs.db` is missing on disk.
 */
router.delete('/logs/:system', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { system } = req.params;

    if (!fs.existsSync(LOG_DB)) {
      throw createError('Log database does not exist', 404);
    }

    const db = new Database(LOG_DB);
    try {
      if (system === 'all') {
        let deleted = 0;
        for (const table of Object.values(LOG_SYSTEM_MAP)) {
          const r = db.prepare(`DELETE FROM ${table}`).run();
          deleted += r.changes;
        }
        logSystem('notice', SYSTEM_EVENTS.CONFIG_RELOADED, {
          component: 'api:system-dashboard',
          context: JSON.stringify({ action: 'clear_all_logs', deleted }),
          actor_id: req.ip ?? 'system',
        });
        res.json({ success: true, data: { cleared: 'all', deleted } });
      } else if (LOG_SYSTEM_MAP[system]) {
        const table = LOG_SYSTEM_MAP[system];
        const r = db.prepare(`DELETE FROM ${table}`).run();
        logSystem('notice', SYSTEM_EVENTS.CONFIG_RELOADED, {
          component: 'api:system-dashboard',
          context: JSON.stringify({ action: 'clear_logs', system, deleted: r.changes }),
          actor_id: req.ip ?? 'system',
        });
        res.json({ success: true, data: { cleared: system, deleted: r.changes } });
      } else {
        throw createError(`Unknown log system '${system}'. Valid: ${Object.keys(LOG_SYSTEM_MAP).join(', ')}, all`, 400);
      }
    } finally {
      db.close();
    }
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/system/health — SLA aggregate health (7.7.1) ──────────────────
//
// Probes every subsystem synchronously, measures response latency, and
// reports SLA compliance against the ≥99.9% uptime / <500 ms targets.

/**
 * GET /api/system/health
 *
 * SLA-aggregate health probe (7.7.1).
 *
 * Synchronously probes every subsystem (Registry DB / HR System DB /
 * LDAP DB / Logs DB), measures response latency in ms, and reports
 * SLA compliance against the ≥99.9% availability / <500 ms
 * per-subsystem targets. Each subsystem's status is computed from
 * its measured latency:
 *
 * - `pass`        — probe returned without throwing AND latency ≤ 500 ms
 * - `degraded`    — probe returned without throwing BUT latency > 500 ms
 * - `fail`        — probe threw an exception
 *
 * Returns HTTP 503 when any subsystem is `fail`, otherwise 200.
 *
 * @returns 200/503 — `{ overall_status: 'healthy' | 'degraded' | 'unhealthy', sla_compliant, checked_at, uptime_seconds, uptime_formatted, sla_targets: { availability_pct, response_time_ms }, subsystems: [{ name, status, response_time_ms, sla_target_ms, sla_compliant, detail? }], summary: { passed, degraded, failed, total } }`
 */
router.get('/health', (req: Request, res: Response, next: NextFunction) => {
  try {
    const SLA_LATENCY_MS  = 500;   // <500 ms per-subsystem target
    const uptimeSeconds   = Math.floor(process.uptime());
    const checked_at      = new Date().toISOString();

    interface SubsystemResult {
      name:           string;
      status:         'pass' | 'fail' | 'degraded';
      response_time_ms: number;
      sla_target_ms:  number;
      sla_compliant:  boolean;
      detail?:        string;
    }

    const results: SubsystemResult[] = [];

    function probe(name: string, fn: () => string | void): SubsystemResult {
      const t0 = Date.now();
      try {
        const detail = fn();
        const ms = Date.now() - t0;
        return {
          name,
          status:           ms <= SLA_LATENCY_MS ? 'pass' : 'degraded',
          response_time_ms: ms,
          sla_target_ms:    SLA_LATENCY_MS,
          sla_compliant:    ms <= SLA_LATENCY_MS,
          ...(detail ? { detail } : {}),
        };
      } catch (err) {
        return {
          name,
          status:           'fail',
          response_time_ms: Date.now() - t0,
          sla_target_ms:    SLA_LATENCY_MS,
          sla_compliant:    false,
          detail:           (err as Error).message,
        };
      }
    }

    // Probe: Registry DB
    results.push(probe('Registry DB', () => {
      const db = new Database(REGISTRY_DB, { readonly: true });
      const r = db.prepare('SELECT COUNT(*) AS n FROM identities').get() as { n: number };
      db.close();
      return `${r.n} identities`;
    }));

    // Probe: HR System DB
    results.push(probe('HR System DB', () => {
      const db = new Database(HR_DB, { readonly: true });
      const r = db.prepare('SELECT COUNT(*) AS n FROM employees').get() as { n: number };
      db.close();
      return `${r.n} employees`;
    }));

    // Probe: LDAP/AD DB
    results.push(probe('LDAP/AD DB', () => {
      const db = new Database(LDAP_DB, { readonly: true });
      const r = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
      db.close();
      return `${r.n} users`;
    }));

    // Probe: Logs DB (non-critical)
    results.push(probe('Logs DB', () => {
      if (!fs.existsSync(LOG_DB)) return 'log db not initialised (non-critical)';
      const db = new Database(LOG_DB, { readonly: true });
      db.prepare('SELECT 1').get();
      db.close();
    }));

    const passed   = results.filter(r => r.status === 'pass').length;
    const degraded = results.filter(r => r.status === 'degraded').length;
    const failed   = results.filter(r => r.status === 'fail').length;

    const overall_status =
      failed   > 0 ? 'unhealthy' :
      degraded > 0 ? 'degraded'  : 'healthy';

    const sla_compliant = results.every(r => r.sla_compliant);

    // Uptime SLA: 99.9% = 8.76 hrs downtime/year. We report current session uptime.
    const uptime_sla_target_pct = 99.9;

    return res.status(overall_status === 'unhealthy' ? 503 : 200).json({
      overall_status,
      sla_compliant,
      checked_at,
      uptime_seconds: uptimeSeconds,
      uptime_formatted: formatUptime(uptimeSeconds),
      sla_targets: {
        availability_pct: uptime_sla_target_pct,
        response_time_ms: SLA_LATENCY_MS,
      },
      subsystems: results,
      summary: { passed, degraded, failed, total: results.length },
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /api/system/versions — API & Schema versions (7.7.2) ────────────────
//
// Returns current API contracts, canonical URN versions, and schema versions
// so consuming applications can verify backward compatibility before upgrading.

/**
 * GET /api/system/versions
 *
 * Version manifest (7.7.2) — returns build info, API contracts,
 * canonical URN versions, schema versions, identity / identifier
 * state machines, and feature flags so consuming applications can
 * verify backward compatibility before upgrading.
 *
 * Also reports `identity_count` from the registry DB and probes
 * for the optional `hook_subscriptions` table (added in 7.6) —
 * its presence is reflected in the schema table list and the
 * `event_hooks` feature flag.
 *
 * @returns 200 — `{ build: { version, release_date }, api: { version, release_date, base_path, spec, backward_compatible_since }, urn: { scheme, current_version, format, example, entity_types, core_id_types, encodings }, schema: { registry_db: { version, tables, identity_count }, caes: { version, schema_name, canonical_attributes } }, identity_states: { lifecycle, identifier }, features: { bulk_import, bulk_export, event_hooks, alias_support, federation, merge, anonymised_export }, supported_api_sections: [...] } }`
 */
router.get('/versions', (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Read identifier count to confirm which DB schema version is active
    let identityCount = 0;
    let hookSubscriptionTableExists = false;
    try {
      const db = new Database(REGISTRY_DB, { readonly: true });
      const r = db.prepare('SELECT COUNT(*) AS n FROM identities').get() as { n: number };
      identityCount = r.n;
      // Probe for hook_subscriptions table (added in 7.6 implementation)
      try {
        db.prepare('SELECT 1 FROM hook_subscriptions LIMIT 1').get();
        hookSubscriptionTableExists = true;
      } catch { /* table doesn't exist yet */ }
      db.close();
    } catch { /* DB not accessible */ }

    return res.json({
      build: {
        version:      BUILD_VERSION,
        release_date: RELEASE_DATE,
      },
      api: {
        version:        '1.0.0',
        release_date:   '2026-04-01',
        base_path:      '/api',
        spec:           'GCUID Federal Architecture v1',
        backward_compatible_since: '1.0.0',
      },
      urn: {
        scheme:        'urn:gcuid',
        current_version: 'v1',
        format:        'urn:gcuid:{entity-type}:{version}:{core-id}',
        example:       'urn:gcuid:person:v1:01ARZ3NDEKTSV4RRFFQ69G5FAV',
        entity_types:  ['person', 'org', 'asset', 'app', 'agent'],
        core_id_types: ['ulid', 'uuid'],
        encodings:     ['crockford', 'base32'],
      },
      schema: {
        registry_db: {
          version: '1.3.0',
          tables: [
            'identities', 'state_history', 'identifier_state_history',
            'source_mappings', 'source_systems', 'aliases', 'attribute_cache',
            ...(hookSubscriptionTableExists ? ['hook_subscriptions', 'hook_events'] : []),
          ],
          identity_count: identityCount,
        },
        caes: {
          version:          '1.0.0',
          schema_name:      'GC Identity Attribute Schema',
          canonical_attributes: [
            'gc_uid', 'given_name', 'family_name', 'preferred_name',
            'work_email', 'department', 'title', 'employee_id',
            'manager_gcuid', 'clearance_level', 'location',
          ],
        },
      },
      identity_states: {
        lifecycle: ['provisional', 'under_review', 'active', 'suspended', 'retired', 'archived'],
        identifier: ['reserved', 'issued', 'nullified', 'superseded', 'tombstoned'],
      },
      features: {
        bulk_import:   true,
        bulk_export:   true,
        event_hooks:   true,
        alias_support: true,
        federation:    true,
        merge:         true,
        anonymised_export: true,
      },
      supported_api_sections: [
        '7.1 Identity Lifecycle', '7.2 Identifier State Machine',
        '7.3 Alias & Mapping',    '7.4 Authoritative Sources',
        '7.5 Bulk',               '7.6 Hooks',
        '7.7 Operations',
      ],
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /api/system/stats — Lightweight federation summary counts ────────────
//
// Returns the count of active authoritative sources and departments as reported
// by the source_systems registry table.  Used by the footer to display live
// federation metrics without loading the full dashboard payload.

/**
 * GET /api/system/stats
 *
 * Lightweight federation summary counts — the count of active
 * authoritative sources and departments from the registry's
 * `source_systems` table, grouped by `system_type`. Used by the
 * footer to display live metrics without loading the full
 * dashboard payload.
 *
 * @returns 200 — `{ success: true, data: { authoritative_sources: number, departments: number } }`
 *          Both fields default to `0` when the DB is unreadable.
 */
router.get('/stats', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = new Database(REGISTRY_DB, { readonly: true });
    let authoritativeSources = 0;
    let departments = 0;
    try {
      const rows = db.prepare(
        `SELECT system_type, COUNT(*) AS count
         FROM source_systems
         WHERE is_active = 1
         GROUP BY system_type`
      ).all() as Array<{ system_type: string; count: number }>;
      for (const row of rows) {
        if (row.system_type === 'authoritative_source') authoritativeSources = row.count;
        else if (row.system_type === 'department') departments = row.count;
      }
    } finally {
      db.close();
    }
    res.json({
      success: true,
      data: {
        authoritative_sources: authoritativeSources,
        departments,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/system/policy — Governance policy for identity resolution (7.7.3)
//
// Displays the governance rules from the Attribute Governance Registry:
// context-aware constraints, trust agreements, PIA boundaries, and the
// relying-party permissions that govern which attributes may be resolved.

/**
 * GET /api/system/policy
 *
 * Governance policy for identity resolution (7.7.3).
 *
 * Returns the canonical policy document for the PoC: attribute
 * sensitivity levels (public / internal / restricted /
 * confidential), trust tiers (GCpass / Departmental Systems /
 * External Relying Parties), resolution constraints (active_only,
 * purpose_binding, minimal_disclosure, consent_required_for_restricted,
 * audit_all_resolutions), PIA boundaries, data-retention periods,
 * and contact references.
 *
 * In production this would be read from a policy DB / OPA bundle;
 * the current implementation returns the static PoC document.
 *
 * @returns 200 — `{ policy_version, effective_date, jurisdiction, framework, pia_reference, attribute_sensitivity_levels: {...}, trust_tiers: {...}, resolution_constraints: [...], pia_boundaries: { in_scope, out_of_scope }, data_retention: {...}, contact: {...} }`
 */
router.get('/policy', (_req: Request, res: Response, next: NextFunction) => {
  try {
    // In production this would be read from a policy DB / OPA bundle.
    // This implementation returns the canonical policy document for the PoC.
    return res.json({
      policy_version:  '1.0.0',
      effective_date:  '2026-04-01',
      jurisdiction:    'Government of Canada',
      framework:       'Privacy Act (R.S.C., 1985, c. P-21)',
      pia_reference:   'PIA-GCUID-2026-001',

      attribute_sensitivity_levels: {
        public: {
          description: 'Non-personal, freely shareable attributes',
          attributes:  ['gc_uid', 'department', 'title', 'location', 'work_email'],
        },
        internal: {
          description: 'Attributes shared within the GC network under authenticated sessions',
          attributes:  ['given_name', 'family_name', 'preferred_name', 'employee_id'],
        },
        restricted: {
          description: 'Sensitive attributes requiring explicit authorisation per relying party',
          attributes:  ['manager_gcuid', 'clearance_level', 'home_address', 'personal_email'],
        },
        confidential: {
          description: 'Highly sensitive; only resolved by systems with PIA approval and data-sharing agreement',
          attributes:  ['medical_info', 'security_vetting_detail', 'disciplinary_record'],
        },
      },

      trust_tiers: {
        tier_1_gcpass: {
          label:       'GCpass (IdP)',
          permitted_sensitivity: ['public', 'internal', 'restricted'],
          requires_mfa: true,
          requires_active_identity: true,
        },
        tier_2_department: {
          label:       'Departmental Systems (HR, LDAP)',
          permitted_sensitivity: ['public', 'internal'],
          requires_mfa: false,
          requires_active_identity: true,
        },
        tier_3_external: {
          label:       'External Relying Parties',
          permitted_sensitivity: ['public'],
          requires_mfa: true,
          requires_active_identity: true,
          requires_data_sharing_agreement: true,
        },
      },

      resolution_constraints: [
        {
          rule:        'active_only',
          description: 'Attributes may only be resolved for identities in the "active" lifecycle state',
          enforced:    true,
        },
        {
          rule:        'purpose_binding',
          description: 'Each attribute resolution request must declare an intended purpose (authentication, authorisation, provisioning, audit). The purpose is logged.',
          enforced:    true,
        },
        {
          rule:        'minimal_disclosure',
          description: 'Only the minimum set of attributes necessary for the declared purpose may be resolved',
          enforced:    true,
        },
        {
          rule:        'consent_required_for_restricted',
          description: 'Restricted attributes require either explicit subject consent or statutory authority',
          enforced:    true,
        },
        {
          rule:        'audit_all_resolutions',
          description: 'Every attribute resolution event is recorded in the audit log with requester identity, purpose, and attributes disclosed',
          enforced:    true,
        },
      ],

      pia_boundaries: {
        in_scope: [
          'Identity binding (GCUID ↔ authoritative source account)',
          'Attribute aggregation for authentication and access management',
          'Lifecycle event notifications to registered downstream systems',
        ],
        out_of_scope: [
          'Biometric data collection',
          'Cross-border transfer of personal data without adequacy agreement',
          'Automated decision-making without human oversight',
        ],
      },

      data_retention: {
        active_identity_years:   99,
        retired_identity_years:  7,
        audit_log_years:         10,
        anonymised_export_years: 0,
        note: 'Retention periods apply from last activity date. Subject to departmental records schedules.',
      },

      contact: {
        privacy_office: 'privacy@gc.example.gov',
        pia_reference:  'PIA-GCUID-2026-001',
        atip_reference: 'INFO SOURCE – GC Identity Registry',
      },
    });
  } catch (err) {
    return next(err);
  }
});

// ─── Database Portal registry ─────────────────────────────────────────────────

const DB_PORTAL_REGISTRY: Array<{
  id: string; label: string; path: string; group: string; color: string;
}> = [
  { id: 'registry',          label: 'GCUID Registry',       path: REGISTRY_DB,                                              group: 'core',      color: 'amber'  },
  { id: 'hr',                label: 'HR System',            path: HR_DB,                                                    group: 'core',      color: 'blue'   },
  { id: 'ldap',              label: 'LDAP / AD',            path: LDAP_DB,                                                  group: 'core',      color: 'indigo' },
  { id: 'logs',              label: 'System Logs',          path: LOG_DB,                                                   group: 'core',      color: 'slate'  },
  { id: 'connector-eng',     label: 'Engineering Connector',path: path.join(CONNECTORS_DB_DIR, 'conn-engineering.db'),      group: 'connector', color: 'purple' },
  { id: 'connector-finance', label: 'Finance Connector',    path: path.join(CONNECTORS_DB_DIR, 'conn-finance.db'),          group: 'connector', color: 'green'  },
];

/** List non-system tables and their row counts in a SQLite DB. */
function listDbTables(dbPath: string): Array<{ name: string; row_count: number }> {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      ).all() as Array<{ name: string }>;
      return tables.map(t => {
        let row_count = 0;
        try {
          const r = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number };
          row_count = r.n;
        } catch { /* ignore */ }
        return { name: t.name, row_count };
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

// ─── GET /api/system/databases ────────────────────────────────────────────────

/**
 * GET /api/system/databases
 *
 * Database-portal registry — lists every DB the portal can browse,
 * with on-disk size + per-table row counts. The registry is
 * fixed (defined by `DB_PORTAL_REGISTRY`); each entry is rendered
 * with a path relative to `process.cwd()`, an existence flag, and
 * a `tables` array (empty when the file doesn't exist).
 *
 * @returns 200 — `{ success: true, data: DatabaseEntry[] }` where each entry is `{ id, label, path, group, color, exists, size_formatted, size_bytes, tables: { name, row_count }[] }`
 */
router.get('/databases', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const databases = DB_PORTAL_REGISTRY.map(entry => ({
      id:             entry.id,
      label:          entry.label,
      path:           path.relative(process.cwd(), entry.path).replace(/\\/g, '/'),
      group:          entry.group,
      color:          entry.color,
      exists:         fs.existsSync(entry.path),
      size_formatted: formatBytes(dbUsedBytes(entry.path)),
      size_bytes:     fileSize(entry.path),
      tables:         fs.existsSync(entry.path) ? listDbTables(entry.path) : [],
    }));
    res.json({ success: true, data: databases });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/system/databases/:dbId/tables/:tableName ───────────────────────
//
// Query params:
//   q       — full-text search across all columns (optional)
//   limit   — page size, max 500, default 50
//   offset  — row offset, default 0

/**
 * GET /api/system/databases/:dbId/tables/:tableName
 *
 * Read a slice of one table in one DB. Both `:dbId` (validated
 * against `DB_PORTAL_REGISTRY`) and `:tableName` (validated
 * against the actual tables in the DB) are checked to prevent
 * SQL injection via path params.
 *
 * Optional full-text search (`q`) runs a parameterised
 * `LIKE %q%` across every column cast to TEXT. `sort_by` is
 * validated against the actual column names.
 *
 * @route   GET /api/system/databases/:dbId/tables/:tableName
 * @param   dbId      — one of the registered DB ids (see `DB_PORTAL_REGISTRY`).
 * @param   tableName — table within that DB (case-sensitive match).
 * @param   q         — query param (optional). Substring search across all columns.
 * @param   limit     — query param (default 50, min 1, max 500).
 * @param   offset    — query param (default 0, min 0).
 * @param   sort_by   — query param (optional). Column name; defaults to insertion order.
 * @param   sort_dir  — query param (default `'asc'`; `'desc'` to reverse).
 * @returns 200 — `{ success: true, data: { columns: { name, type, pk }[], rows: object[], total: number, limit: number, offset: number, query: string } }`
 * @throws  404 — `createError('Unknown database: ...')` / `'Database file not found for: ...'` / `'Table "..." not found in database "..."'`.
 * @throws  500 — SQLite read failure.
 */
router.get('/databases/:dbId/tables/:tableName', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dbId, tableName } = req.params;
    const q         = ((req.query.q      as string) || '').trim();
    const limit     = Math.min(Math.max(parseInt((req.query.limit  as string) || '50', 10), 1), 500);
    const offset    = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);
    const sortByRaw = ((req.query.sort_by  as string) || '').trim();
    const sortDir   = ((req.query.sort_dir as string) || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    // Validate dbId against the fixed registry
    const dbEntry = DB_PORTAL_REGISTRY.find(d => d.id === dbId);
    if (!dbEntry) return next(createError(`Unknown database: ${dbId}`, 404));
    if (!fs.existsSync(dbEntry.path)) return next(createError(`Database file not found for: ${dbId}`, 404));

    const db = new Database(dbEntry.path, { readonly: true });
    try {
      // Validate tableName against the actual tables in this DB (prevents SQL injection)
      const validTables = (db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      ).all() as Array<{ name: string }>).map(t => t.name);

      if (!validTables.includes(tableName)) {
        return next(createError(`Table "${tableName}" not found in database "${dbId}"`, 404));
      }

      // Column metadata
      const pragmaRows = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
        cid: number; name: string; type: string; notnull: number; dflt_value: any; pk: number;
      }>;
      const columns = pragmaRows.map(c => ({ name: c.name, type: c.type, pk: c.pk === 1 }));

      // Validate sort_by against actual column names to prevent SQL injection via column identifier
      const sortColumn  = sortByRaw ? columns.find(c => c.name === sortByRaw) : null;
      const orderClause = sortColumn ? `ORDER BY "${sortColumn.name}" ${sortDir}` : '';

      let total: number;
      let rows: Record<string, any>[];

      if (q) {
        // Build a parameterised LIKE search across every column cast to TEXT
        const likeVal = `%${q}%`;
        const whereParts = columns.map(c => `CAST("${c.name}" AS TEXT) LIKE ?`).join(' OR ');
        const countParams: string[] = columns.map(() => likeVal);
        const rowParams: (string | number)[] = [...countParams, limit, offset];

        total = (db.prepare(
          `SELECT COUNT(*) AS n FROM "${tableName}" WHERE ${whereParts}`
        ).get(...countParams) as { n: number }).n;

        rows = db.prepare(
          `SELECT * FROM "${tableName}" WHERE ${whereParts} ${orderClause} LIMIT ? OFFSET ?`
        ).all(...rowParams) as Record<string, any>[];
      } else {
        total = (db.prepare(`SELECT COUNT(*) AS n FROM "${tableName}"`).get() as { n: number }).n;
        rows  = db.prepare(`SELECT * FROM "${tableName}" ${orderClause} LIMIT ? OFFSET ?`).all(limit, offset) as Record<string, any>[];
      }

      return res.json({
        success: true,
        data: { columns, rows, total, limit, offset, query: q },
      });
    } finally {
      db.close();
    }
  } catch (err) {
    return next(err);
  }
});

// ─── DELETE /api/system/databases/:dbId/tables/:tableName/rows/:pkValue ───────
//
// Delete a single row by primary-key value.
// Only works when the table has a single-column primary key.

/**
 * DELETE /api/system/databases/:dbId/tables/:tableName/rows/:pkValue
 *
 * Delete one row by primary-key value. Both `:dbId` and
 * `:tableName` are validated to prevent SQL injection; the PK
 * column is discovered via `PRAGMA table_info`. Composite-PK
 * tables are explicitly rejected (return 400).
 *
 * The PK value is coerced to a number when the column type
 * matches `int|real|num|float|double` (case-insensitive),
 * otherwise treated as TEXT.
 *
 * @route   DELETE /api/system/databases/:dbId/tables/:tableName/rows/:pkValue
 * @param   dbId      — one of the registered DB ids.
 * @param   tableName — table within that DB.
 * @param   pkValue   — primary-key value (text or numeric; coerced per the PK column's declared type).
 * @returns 200 — `{ success: true, data: { deleted: number } }`
 * @throws  400 — `'Table "..." has no primary key'` or `'Table "..." has a composite primary key'`.
 * @throws  404 — `'Unknown database'`, `'Database file not found'`, `'Table ... not found'`, or `'Row not found'`.
 * @throws  500 — SQLite write failure.
 */
router.delete('/databases/:dbId/tables/:tableName/rows/:pkValue', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dbId, tableName, pkValue } = req.params;

    const dbEntry = DB_PORTAL_REGISTRY.find(d => d.id === dbId);
    if (!dbEntry) return next(createError(`Unknown database: ${dbId}`, 404));
    if (!fs.existsSync(dbEntry.path)) return next(createError(`Database file not found for: ${dbId}`, 404));

    const db = new Database(dbEntry.path);
    try {
      // Validate table name against real tables (prevents SQL injection)
      const validTables = (db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      ).all() as Array<{ name: string }>).map(t => t.name);

      if (!validTables.includes(tableName)) {
        return next(createError(`Table "${tableName}" not found in database "${dbId}"`, 404));
      }

      // Find the primary-key column (single-column PK only)
      const pragmaRows = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
        cid: number; name: string; type: string; notnull: number; dflt_value: any; pk: number;
      }>;
      const pkCols = pragmaRows.filter(c => c.pk > 0);
      if (pkCols.length === 0) return next(createError(`Table "${tableName}" has no primary key`, 400));
      if (pkCols.length > 1)   return next(createError(`Table "${tableName}" has a composite primary key; row deletion is not supported here`, 400));

      const pkCol = pkCols[0];
      const isNumeric = /int|real|num|float|double/i.test(pkCol.type);
      const coercedValue = isNumeric ? Number(pkValue) : pkValue;

      const result = db.prepare(`DELETE FROM "${tableName}" WHERE "${pkCol.name}" = ?`).run(coercedValue);
      if (result.changes === 0) return next(createError(`Row not found`, 404));

      return res.json({ success: true, data: { deleted: result.changes } });
    } finally {
      db.close();
    }
  } catch (err) {
    return next(err);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export const systemDashboardRoutes = router;
