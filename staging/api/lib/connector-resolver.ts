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
 * ConnectorResolver
 *
 * Routes attribute-value lookups to the correct backend based on each source
 * system's accessMode:
 *
 *   dynamic-pull      → live HTTP request to the connector server
 *   push-cache        → query attribute_cache table (populated via ingest)
 *   scheduled-pull    → query attribute_cache table (populated via sync)
 *
 * The source_systems table bridges legacy short IDs ('hr', 'ldap', …) used
 * in source_mappings to the full connector JSON systemId ('conn-hr', …)
 * via the connector_id column added in the migrations.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ConnectorAPIClient } from '../../../packages/core/dist/connector-api.js';
import { REGISTRY_DB_PATH, IS_EFS_MODE, connectorDbPath } from './db-paths.js';
import type { ConnectorTransformation } from '../routes/connectors.js';
import { applyConnectorTransformation } from './apply-transformation.js';

// Use LAMBDA_TASK_ROOT when available — lambda-handler.js calls process.chdir('/tmp')
// before importing the Express app, so process.cwd() resolves to /tmp at module-load
// time in Lambda and path.join(cwd, 'config', 'connectors') would point to /tmp/config/
// (which doesn't exist).  LAMBDA_TASK_ROOT always points to /var/task where the
// bundled JSON config files live.
const CONFIG_ROOT    = process.env['LAMBDA_TASK_ROOT'] ?? process.cwd();
const CONNECTORS_DIR = path.join(CONFIG_ROOT, 'config', 'connectors');

// ─── Types used internally ────────────────────────────────────────────────────

interface SourceSystemRow {
  system_id:          string;
  connector_id:       string | null;
  access_mode:        string;
  api_url:            string | null;
  api_secret:         string | null;
  allow_inbound:      number;
  last_sync_at:       string | null;
  cache_ttl_seconds:  number;
  cache_stale_policy: string;
}

interface CacheRow {
  normalised:  string;
  expires_at:  string | null;
}

export interface ResolveContext {
  /** The sourceField that should be extracted from the remote/cached record */
  sourceField: string;
  /** Source table name (used only for direct-DB fallback, not for connector path) */
  sourceTable: string;
  /** Primary key column name (used only for direct-DB fallback) */
  keyField: string;
  transformations?: Record<string, any>;
  standardAttribute?: string;
}

// ─── Cache of loaded connector JSON configs ───────────────────────────────────

interface ConnectorJsonConfig {
  systemId:      string;
  enabled:       boolean;
  connectorServer: { port: number; authToken: string };
  sourceConnection: { dbPath?: string; primaryTable?: string; primaryKeyField?: string };
  accessMode: string;
  /** Per-attribute transformation rules applied after fetching the raw value. */
  transformations?: Record<string, ConnectorTransformation>;
}

export function loadConnectorConfig(connectorId: string): ConnectorJsonConfig | null {
  const filePath = path.join(CONNECTORS_DIR, `${connectorId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ConnectorJsonConfig;
  } catch {
    return null;
  }
}

// ─── ConnectorResolver ────────────────────────────────────────────────────────

export class ConnectorResolver {
  /**
   * Resolve the value of a single source field for a given source system + sourceId.
   *
   * @param sourceSystem  Value from source_mappings.source_system (e.g. 'hr', 'ldap')
   * @param sourceId      The source-system-native primary key for this identity
   * @param ctx           Which field to extract and how
   * @returns The resolved value, or undefined if not found
   */
  async resolveAttribute(
    sourceSystem: string,
    sourceId: string,
    ctx: ResolveContext
  ): Promise<any> {
    const db = new Database(REGISTRY_DB_PATH, { readonly: true });
    let row: SourceSystemRow | null = null;
    try {
      row = db.prepare(
        'SELECT system_id, connector_id, access_mode, api_url, api_secret, allow_inbound, last_sync_at, cache_ttl_seconds, cache_stale_policy FROM source_systems WHERE system_id = ?'
      ).get(sourceSystem) as SourceSystemRow | null;
    } finally {
      db.close();
    }

    if (!row) {
      // Unknown system — return undefined; caller falls back to direct DB access.
      return undefined;
    }

    const mode = row.access_mode ?? 'dynamic-pull';

    if (mode === 'dynamic-pull') {
      // For live lookups, respect the enabled flag — a disabled dynamic-pull
      // connector has no cache fallback, so return undefined.
      if (row.connector_id) {
        const cfg = loadConnectorConfig(row.connector_id);
        if (cfg && cfg.enabled === false) return undefined;
      }
      return this._fetchFromConnectorServer(row, sourceId, ctx);
    }

    // push-cache or scheduled-pull: serve from attribute_cache regardless of
    // enabled flag — the cache is a local snapshot and remains valid even when
    // the connector is disabled (sync is blocked separately).
    return this._fetchFromCache(row, sourceId, ctx);
  }

  /**
   * Fetch a record live from the connector HTTP server and extract the requested field.
   * In EFS (Lambda) mode, sidecar connector processes don't run — read the connector
   * SQLite DB directly from /mnt/efs/connectors/ instead.
   */
  private async _fetchFromConnectorServer(
    row: SourceSystemRow,
    sourceId: string,
    ctx: ResolveContext
  ): Promise<any> {
    const connectorId = row.connector_id;
    if (!connectorId) return undefined;

    const cfg = loadConnectorConfig(connectorId);
    if (!cfg) return undefined;

    // In EFS mode there are no sidecar connector processes — read the connector
    // DB directly from /mnt/efs/connectors/ instead of calling localhost.
    if (IS_EFS_MODE) {
      return this._fetchDirectFromConnectorDB(cfg, sourceId, ctx);
    }

    // Prefer the api_url and api_secret registered in source_systems (the live registry);
    // fall back to the connector JSON config values for backward compatibility.
    const baseUrl = row.api_url ?? `http://localhost:${cfg.connectorServer.port}`;
    const authToken = row.api_secret ?? cfg.connectorServer.authToken;

    const client = new ConnectorAPIClient(
      baseUrl,
      authToken
    );

    const record = await client.getRecord(sourceId).catch(() => null);
    if (!record) return undefined;

    // normalizedAttributes already uses standard attribute names; fall back to raw attributes
    const value =
      record.normalizedAttributes?.[ctx.sourceField] ??
      record.attributes?.[ctx.sourceField];

    return this._applyTransformations(value, ctx, cfg.transformations);
  }

  /**
   * Read a single record directly from the connector's SQLite database file.
   * Used in EFS (Lambda) mode where no sidecar connector server runs.
   *
   * Resolves the DB path via connectorDbPath(cfg.systemId) which points to
   * /mnt/efs/sources/{id}.db in EFS mode and ./data/sources/{id}.db locally.
   */
  private async _fetchDirectFromConnectorDB(
    cfg: ConnectorJsonConfig,
    sourceId: string,
    ctx: ResolveContext
  ): Promise<any> {
    const sc = cfg.sourceConnection;
    if (!sc?.primaryTable || !sc?.primaryKeyField) return undefined;

    const dbPath = connectorDbPath(cfg.systemId);
    let db: InstanceType<typeof Database> | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const record = db.prepare(
        `SELECT * FROM ${sc.primaryTable} WHERE ${sc.primaryKeyField} = ?`
      ).get(sourceId) as Record<string, any> | null;
      if (!record) return undefined;

      const value = record[ctx.sourceField];
      return this._applyTransformations(value, ctx, cfg.transformations);
    } catch (err) {
      console.error(
        `[connector-resolver] Direct DB read failed for ${cfg.systemId} source_id='${sourceId}':`,
        err
      );
      return undefined;
    } finally {
      db?.close();
    }
  }

  /**
   * Look up the attribute cache and extract the requested field from the normalised blob.
   * Checks expires_at and applies cache_stale_policy when the entry is stale.
   */
  private async _fetchFromCache(
    row: SourceSystemRow,
    sourceId: string,
    ctx: ResolveContext
  ): Promise<any> {
    const db = new Database(REGISTRY_DB_PATH, { readonly: true });
    let cacheRow: CacheRow | null = null;
    try {
      cacheRow = db.prepare(
        'SELECT normalised, expires_at FROM attribute_cache WHERE system_id = ? AND source_id = ?'
      ).get(row.system_id, sourceId) as CacheRow | null;
    } finally {
      db.close();
    }

    if (!cacheRow) return undefined;

    // ── Staleness check ───────────────────────────────────────────────────────
    const isStale = cacheRow.expires_at !== null && new Date(cacheRow.expires_at) < new Date();
    if (isStale) {
      const policy = row.cache_stale_policy ?? 'serve-stale';
      if (policy === 'error-on-stale') {
        throw new Error(
          `Cache for system '${row.system_id}' is stale (expired ${cacheRow.expires_at}). ` +
          `Re-sync required.`
        );
      }
      if (policy === 'serve-stale-warn') {
        console.warn(
          `[connector-resolver] Serving stale cache for system='${row.system_id}' source_id='${sourceId}' ` +
          `(expired ${cacheRow.expires_at})`
        );
      }
      // 'serve-stale' (default): fall through and return the value silently
    }

    let normalised: Record<string, any>;
    try {
      normalised = JSON.parse(cacheRow.normalised);
    } catch {
      return undefined;
    }

    const value = normalised[ctx.sourceField];
    // Load the connector config to access its transformation rules
    const connectorCfg = row.connector_id ? loadConnectorConfig(row.connector_id) : null;
    return this._applyTransformations(value, ctx, connectorCfg?.transformations);
  }

  private async _applyTransformations(
    value: any,
    ctx: ResolveContext,
    connectorTransforms?: Record<string, ConnectorTransformation>,
  ): Promise<any> {
    if (value === null || value === undefined) return undefined;

    // ── Legacy CAES-level transforms (hardcoded, checked via ctx.transformations.read) ──
    if (ctx.transformations?.read) {
      if (ctx.standardAttribute === 'person.account.groups') {
        if (typeof value === 'string') { try { return JSON.parse(value); } catch { return []; } }
        return Array.isArray(value) ? value : [];
      }
      if (ctx.standardAttribute === 'person.account.enabled') return value === 1 || value === true;
    }

    // ── Connector-level transforms (from connector JSON config) ───────────────
    if (connectorTransforms && ctx.standardAttribute) {
      return applyConnectorTransformation(value, connectorTransforms, ctx.standardAttribute, 'read');
    }

    return value;
  }

  // ─── Sync (scheduled-pull) ─────────────────────────────────────────────────

  /**
   * Pull all records from a scheduled-pull connector server and upsert them into
   * the attribute_cache.  Also updates source_systems.last_sync_at.
   *
   * @param systemId  The source_systems.system_id (e.g. 'engineering')
   * @param since     Optional ISO timestamp — only fetch records modified after this
   * @returns number of records upserted
   */
  async syncSystem(systemId: string, since?: string): Promise<number> {
    const db = new Database(REGISTRY_DB_PATH, { readonly: true });
    let row: SourceSystemRow | null = null;
    try {
      row = db.prepare(
        'SELECT system_id, connector_id, access_mode, api_port, cache_ttl_seconds FROM source_systems WHERE system_id = ?'
      ).get(systemId) as SourceSystemRow | null;
    } finally {
      db.close();
    }

    if (!row) throw new Error(`Unknown source system: ${systemId}`);
    if (row.access_mode !== 'scheduled-pull' && row.access_mode !== 'push-cache') {
      throw new Error(`System '${systemId}' uses access mode '${row.access_mode}' — only scheduled-pull and push-cache connectors can be synced`);
    }

    const connectorId = row.connector_id;
    if (!connectorId) throw new Error(`System '${systemId}' has no connector_id configured`);

    const cfg = loadConnectorConfig(connectorId);
    if (!cfg) throw new Error(`Connector config not found for connector_id '${connectorId}'`);

    const client = new ConnectorAPIClient(
      `http://localhost:${cfg.connectorServer.port}`,
      cfg.connectorServer.authToken
    );

    const records = await client.fetchAll(since);

    const now = new Date().toISOString();
    const ttl = row.cache_ttl_seconds ?? 0;
    const expiresAt = ttl > 0
      ? new Date(Date.now() + ttl * 1000).toISOString()
      : null;
    const rw = new Database(REGISTRY_DB_PATH);
    try {
      if (records.length > 0) {
        const upsert = rw.prepare(`
          INSERT INTO attribute_cache (system_id, source_id, normalised, effective_at, received_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(system_id, source_id)
          DO UPDATE SET normalised = excluded.normalised,
                        effective_at = excluded.effective_at,
                        received_at = excluded.received_at,
                        expires_at = excluded.expires_at
        `);

        rw.transaction(() => {
          for (const record of records) {
            // normalizedAttributes is the GCUID-standard blob to cache
            const normalised = JSON.stringify(record.normalizedAttributes ?? record.attributes ?? {});
            const effectiveAt = record.lastModified
              ? new Date(record.lastModified).toISOString()
              : now;
            upsert.run(systemId, record.recordId, normalised, effectiveAt, now, expiresAt);
          }
        })();
      }

      // Always update last_sync_at — a sync happened even if there were no new records
      rw.prepare(
        "UPDATE source_systems SET last_sync_at = ?, updated_at = ? WHERE system_id = ?"
      ).run(now, now, systemId);
    } finally {
      rw.close();
    }

    return records.length;
  }

  // ─── Ingest (push-cache) ───────────────────────────────────────────────────

  /**
   * Persist pushed records directly into the attribute_cache (no HTTP call).
   * Called by the ingest route handler after auth validation.
   *
   * @param systemId  The source_systems.system_id
   * @param records   Array of { source_id, normalised, effective_at? }
   * @returns number of records upserted
   */
  ingestRecords(
    systemId: string,
    records: Array<{ source_id: string; normalised: Record<string, any>; effective_at?: string }>
  ): number {
    if (records.length === 0) return 0;

    // Read cache_ttl_seconds to compute expires_at
    const sysDb = new Database(REGISTRY_DB_PATH, { readonly: true });
    const sysRow = sysDb.prepare(
      'SELECT cache_ttl_seconds FROM source_systems WHERE system_id = ?'
    ).get(systemId) as { cache_ttl_seconds: number } | undefined;
    sysDb.close();

    const ttl = sysRow?.cache_ttl_seconds ?? 0;
    const now = new Date().toISOString();
    const expiresAt = ttl > 0
      ? new Date(Date.now() + ttl * 1000).toISOString()
      : null;

    const db = new Database(REGISTRY_DB_PATH);
    try {
      const upsert = db.prepare(`
        INSERT INTO attribute_cache (system_id, source_id, normalised, effective_at, received_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(system_id, source_id)
        DO UPDATE SET normalised = excluded.normalised,
                      effective_at = excluded.effective_at,
                      received_at = excluded.received_at,
                      expires_at = excluded.expires_at
      `);

      db.transaction(() => {
        for (const r of records) {
          upsert.run(
            systemId,
            r.source_id,
            JSON.stringify(r.normalised),
            r.effective_at ?? now,
            now,
            expiresAt
          );
        }
      })();

      db.prepare(
        "UPDATE source_systems SET last_sync_at = ?, updated_at = ? WHERE system_id = ?"
      ).run(now, now, systemId);

      return records.length;
    } finally {
      db.close();
    }
  }

  // ─── Write (dynamic-pull connectors) ──────────────────────────────────────

  /**
   * Update a single source field on a specific record via the connector HTTP API.
   * Only supported for dynamic-pull connectors that implement updateRecord.
   *
   * @param sourceSystem  Value from source_mappings.source_system (e.g. 'hr', 'ldap')
   * @param sourceId      The source-system-native primary key
   * @param sourceField   Column name to update
   * @param value         New value
   */
  async updateAttribute(
    sourceSystem: string,
    sourceId: string,
    sourceField: string,
    value: any
  ): Promise<void> {
    const db = new Database(REGISTRY_DB_PATH, { readonly: true });
    let row: SourceSystemRow | null = null;
    try {
      row = db.prepare(
        'SELECT system_id, connector_id, access_mode, api_port FROM source_systems WHERE system_id = ?'
      ).get(sourceSystem) as SourceSystemRow | null;
    } finally {
      db.close();
    }

    if (!row || !row.connector_id) {
      throw new Error(`No connector config found for source system '${sourceSystem}'`);
    }

    const cfg = loadConnectorConfig(row.connector_id);
    if (!cfg) {
      throw new Error(`Connector config file not found for connector '${row.connector_id}'`);
    }
    if (!cfg.enabled) {
      throw new Error(`Connector '${row.connector_id}' is disabled`);
    }

    const client = new ConnectorAPIClient(
      `http://localhost:${cfg.connectorServer.port}`,
      cfg.connectorServer.authToken
    );
    await client.updateRecord(sourceId, { [sourceField]: value });
  }
}

export const connectorResolver = new ConnectorResolver();
