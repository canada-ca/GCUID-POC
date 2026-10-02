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
 * Unified connector type hierarchy for GCUID federation.
 * Defines the three access modes: dynamic-pull, push-cache, scheduled-pull.
 */

export type AccessMode = 'dynamic-pull' | 'push-cache' | 'scheduled-pull';

/**
 * A single normalised record fetched from (or cached from) a source system.
 */
export interface GCUIDRecord {
  /** Primary key in the source system */
  sourceId: string;
  /** Raw attributes as returned by the source */
  attributes: Record<string, any>;
  /** Attributes normalised to GCUID standard attribute names */
  normalised: Record<string, any>;
  /** ISO-8601 last-modified timestamp */
  modifiedAt: string;
  /** Optional confidence score (0–1) */
  confidence?: number;
}

/**
 * Lifecycle status reported by a connector at `healthCheck()` time.
 *
 * `recordCount` and `lastSyncAt` are advisory and not present for
 * `dynamic-pull` connectors that don't maintain a local cache.
 */
export interface ConnectorHealth {
  /** Current health status of the connector. */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Approximate record count currently known to GCUID for this source. */
  recordCount?: number;
  /** ISO-8601 timestamp of the most recent successful sync with the source. */
  lastSyncAt?: string;
  /** Optional human-readable message accompanying the status. */
  message?: string;
}

/**
 * Filter / shape parameters for `search()` calls on a connector.
 */
export interface ConnectorQuery {
  /** Standard attribute name → value pairs used to filter records. */
  attributes: Record<string, any>;
  /** Maximum number of records to return. */
  limit?: number;
  /** When true, allow fuzzy matching on attribute values. */
  fuzzy?: boolean;
}

// ── Base ──────────────────────────────────────────────────────────────────────

/**
 * Properties and behaviour every connector exposes, regardless of access mode.
 *
 * `healthCheck()` must always be implemented; the access-mode-specific
 * variants add `search` / `fetchRecord` / `fetchAll` as needed.
 */
export interface BaseConnector {
  readonly systemId: string;
  readonly displayName: string;
  readonly accessMode: AccessMode;
  healthCheck(): Promise<ConnectorHealth>;
}

// ── Access-mode variants ──────────────────────────────────────────────────────

/**
 * Queries the source system live on every attribute request.
 * Requires the source system to expose a ConnectorAPIServer.
 */
export interface DynamicPullConnector extends BaseConnector {
  readonly accessMode: 'dynamic-pull';
  search(query: ConnectorQuery): Promise<GCUIDRecord[]>;
  fetchRecord(sourceId: string): Promise<GCUIDRecord | null>;
}

/**
 * Source system periodically syncs all records into the GCUID attribute cache.
 * Requires the source system to expose a ConnectorAPIServer with GET /records.
 */
export interface ScheduledPullConnector extends BaseConnector {
  readonly accessMode: 'scheduled-pull';
  search(query: ConnectorQuery): Promise<GCUIDRecord[]>;
  fetchRecord(sourceId: string): Promise<GCUIDRecord | null>;
  fetchAll(since?: string): Promise<GCUIDRecord[]>;
}

/**
 * Source system pushes updates to GCUID via POST /api/connectors/:id/ingest.
 * GCUID never polls; only serves from cache.
 */
export interface PushCacheConnector extends BaseConnector {
  readonly accessMode: 'push-cache';
}

/**
 * Discriminated union of every concrete connector access mode.
 *
 * Use the `accessMode` field to narrow the type before calling
 * mode-specific methods (`fetchAll` is only valid for
 * `ScheduledPullConnector`, etc.).
 */
export type GCUIDConnector = DynamicPullConnector | ScheduledPullConnector | PushCacheConnector;
