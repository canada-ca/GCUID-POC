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
 * dept-cache.ts
 *
 * Shared utilities for department API routes that have a cache-backed connector
 * (push-cache or scheduled-pull).  When a populated cache exists, reads are served
 * from attribute_cache and writes are written through to the cache so subsequent
 * reads remain consistent without waiting for the next scheduled sync.
 *
 * Decision rules
 * ──────────────
 *  • getDeptCacheInfo() returns null  →  dynamic-pull: bypass cache entirely.
 *  • cacheInfo present + countCacheRecords > 0  →  serve from cache.
 *  • cacheInfo present + countCacheRecords = 0  →  cache not yet populated, fall
 *    through to the authoritative dept db (graceful cold-start).
 *  • cache is stale + policy = error-on-stale  →  throw 409 on reads.
 *  • cache is stale + policy = serve-stale-warn  →  serve + set warning field.
 *  • cache is stale + policy = serve-stale  →  serve silently (default).
 *
 * All mutations (create, update, delete) go to the authoritative dept db first,
 * then write-through to attribute_cache so subsequent reads see the latest data.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logEngineering, logFinance } from './logging/logger.js';
import { ENGINEERING_EVENTS, FINANCE_EVENTS } from './logging/log-events.js';

const REGISTRY_DB_PATH = path.join(process.cwd(), 'data', 'registry.db');
const CONNECTORS_DIR   = path.join(process.cwd(), 'config', 'connectors');
const CACHE_BACKED_MODES = new Set(['push-cache', 'scheduled-pull']);

function readConnectorEnabled(connectorId: string | null): boolean {
  if (!connectorId) return true; // no config file — treat as enabled
  const filePath = path.join(CONNECTORS_DIR, `${connectorId}.json`);
  if (!fs.existsSync(filePath)) return true;
  try {
    const cfg = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { enabled?: boolean };
    return cfg.enabled !== false; // absent field ⇒ enabled
  } catch {
    return true;
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CacheInfo {
  is_cached:          boolean;
  system_id:          string;
  access_mode:        string;
  last_sync_at:       string | null;
  cache_ttl_seconds:  number;
  is_stale:           boolean;
  stale_policy:       string;
  expires_at:         string | null;
  /** false when the connector JSON has enabled=false; cache reads still work */
  connector_enabled:  boolean;
  /** Present when is_stale=true and policy is serve-stale-warn */
  warning?:           string;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface SysRow {
  system_id:          string;
  connector_id:       string | null;
  access_mode:        string;
  last_sync_at:       string | null;
  cache_ttl_seconds:  number;
  cache_stale_policy: string;
}

// ─── Cache metadata ───────────────────────────────────────────────────────────

/**
 * Return cache metadata for a source system, or null if the system uses
 * dynamic-pull (no cache).
 */
export function getDeptCacheInfo(systemId: string): CacheInfo | null {
  const db = new Database(REGISTRY_DB_PATH, { readonly: true });
  let row: SysRow | null = null;
  try {
    row = db.prepare(
      'SELECT system_id, connector_id, access_mode, last_sync_at, cache_ttl_seconds, cache_stale_policy ' +
      'FROM source_systems WHERE system_id = ?'
    ).get(systemId) as SysRow | null;
  } finally {
    db.close();
  }

  if (!row || !CACHE_BACKED_MODES.has(row.access_mode)) return null;

  const ttl = row.cache_ttl_seconds ?? 0;
  let isStale = false;
  let expiresAt: string | null = null;

  if (ttl > 0 && row.last_sync_at) {
    const expiry = new Date(new Date(row.last_sync_at).getTime() + ttl * 1000);
    expiresAt = expiry.toISOString();
    isStale = expiry < new Date();
  }

  const info: CacheInfo = {
    is_cached:          true,
    system_id:          row.system_id,
    access_mode:        row.access_mode,
    last_sync_at:       row.last_sync_at,
    cache_ttl_seconds:  ttl,
    is_stale:           isStale,
    stale_policy:       row.cache_stale_policy,
    expires_at:         expiresAt,
    connector_enabled:  readConnectorEnabled(row.connector_id),
  };

  if (isStale && row.cache_stale_policy === 'serve-stale-warn') {
    info.warning =
      `Cache for '${systemId}' is stale (expired ${expiresAt}). ` +
      'Data may not reflect recent changes — re-sync to refresh.';
  }

  return info;
}

/**
 * Enforce the stale policy on a read operation.
 * Throws a 409 error when cache_stale_policy is 'error-on-stale' and the cache
 * is stale.  No-op otherwise.
 */
export function assertCacheReadPolicy(info: CacheInfo): void {
  if (!info.is_stale) return;
  if (info.stale_policy === 'error-on-stale') {
    const msg =
      `The cache for '${info.system_id}' is stale (expired ${info.expires_at}). ` +
      'Re-sync the source system before accessing data.';
    // M2: log the policy violation before throwing
    if (info.system_id === 'engineering') {
      logEngineering('error', ENGINEERING_EVENTS.CACHE_POLICY_VIOLATED, {
        component:   'lib:dept-cache',
        cache_mode:  info.access_mode,
        error_detail: msg,
      });
    } else if (info.system_id === 'finance') {
      logFinance('error', FINANCE_EVENTS.CACHE_POLICY_VIOLATED, {
        component:   'lib:dept-cache',
        cache_mode:  info.access_mode,
        error_detail: msg,
      });
    }
    const err = new Error(msg) as any;
    err.statusCode = 409;
    throw err;
  }
}

// ─── Count ────────────────────────────────────────────────────────────────────

/** Return the number of entries in attribute_cache for the system. */
export function countCacheRecords(systemId: string): number {
  const db = new Database(REGISTRY_DB_PATH, { readonly: true });
  try {
    const row = db.prepare(
      'SELECT COUNT(*) as n FROM attribute_cache WHERE system_id = ?'
    ).get(systemId) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

function parseRecord(raw: string, sourceId: string): Record<string, any> {
  try {
    const obj = JSON.parse(raw);
    if (!obj.dept_id) obj.dept_id = sourceId;
    return obj;
  } catch {
    return { dept_id: sourceId };
  }
}

/** Return all cached records for the system. */
export function listFromCache(systemId: string): Record<string, any>[] {
  const db = new Database(REGISTRY_DB_PATH, { readonly: true });
  try {
    const rows = db.prepare(
      'SELECT source_id, normalised FROM attribute_cache WHERE system_id = ?'
    ).all(systemId) as Array<{ source_id: string; normalised: string }>;
    return rows.map(r => parseRecord(r.normalised, r.source_id));
  } finally {
    db.close();
  }
}

/** Return one cached record, or null if not present. */
export function getFromCache(systemId: string, sourceId: string): Record<string, any> | null {
  const db = new Database(REGISTRY_DB_PATH, { readonly: true });
  try {
    const row = db.prepare(
      'SELECT normalised FROM attribute_cache WHERE system_id = ? AND source_id = ?'
    ).get(systemId, sourceId) as { normalised: string } | null;
    if (!row) return null;
    return parseRecord(row.normalised, sourceId);
  } finally {
    db.close();
  }
}

/**
 * Search cached records by matching any of first_name, last_name, email, dept_id.
 * Applies limit after filtering.
 */
export function searchFromCache(
  systemId: string,
  query: string,
  limit: number
): Record<string, any>[] {
  const q = query.toLowerCase();
  return listFromCache(systemId)
    .filter(emp =>
      (emp.first_name  ?? '').toLowerCase().includes(q) ||
      (emp.last_name   ?? '').toLowerCase().includes(q) ||
      (emp.email       ?? '').toLowerCase().includes(q) ||
      String(emp.dept_id ?? '').toLowerCase().includes(q)
    )
    .slice(0, limit);
}

// ─── Write-through helpers ────────────────────────────────────────────────────

/**
 * Upsert a full record into attribute_cache (write-through after a dept db write).
 * Looks up cache_ttl_seconds from source_systems to compute expires_at.
 */
export function upsertToCache(
  systemId: string,
  sourceId: string,
  record: Record<string, any>
): void {
  const sysDb = new Database(REGISTRY_DB_PATH, { readonly: true });
  const sysRow = sysDb.prepare(
    'SELECT cache_ttl_seconds FROM source_systems WHERE system_id = ?'
  ).get(systemId) as { cache_ttl_seconds: number } | null;
  sysDb.close();

  const ttl = sysRow?.cache_ttl_seconds ?? 0;
  const now = new Date().toISOString();
  const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null;

  const db = new Database(REGISTRY_DB_PATH);
  try {
    db.prepare(`
      INSERT INTO attribute_cache (system_id, source_id, normalised, effective_at, received_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(system_id, source_id)
      DO UPDATE SET normalised    = excluded.normalised,
                    effective_at  = excluded.effective_at,
                    received_at   = excluded.received_at,
                    expires_at    = excluded.expires_at
    `).run(systemId, sourceId, JSON.stringify(record), now, now, expiresAt);
  } finally {
    db.close();
  }
  // M1: log the cache write
  if (systemId === 'engineering') {
    logEngineering('debug', ENGINEERING_EVENTS.CACHE_WRITE, {
      component:        'lib:dept-cache',
      cache_operation:  'write',
      records_affected: 1,
    });
  } else if (systemId === 'finance') {
    logFinance('debug', FINANCE_EVENTS.CACHE_WRITE, {
      component:        'lib:dept-cache',
      cache_operation:  'write',
      records_affected: 1,
    });
  }
}

/** Remove a record from attribute_cache (called after deleting from the dept db). */
export function deleteFromCache(systemId: string, sourceId: string): void {
  const db = new Database(REGISTRY_DB_PATH);
  try {
    db.prepare(
      'DELETE FROM attribute_cache WHERE system_id = ? AND source_id = ?'
    ).run(systemId, sourceId);
  } finally {
    db.close();
  }
}
