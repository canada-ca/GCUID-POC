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
 * PushConnectorClient
 * Used by source systems (departments) to push record batches to the GCUID
 * attribute cache via POST /api/connectors/:id/ingest.
 *
 * Pair this with the read-side `ConnectorAPIClient` (in connector-api.ts):
 * a connector server fetches its own records with `ConnectorAPIClient`, then
 * pushes them upstream with `PushConnectorClient.pushAll(...)`.
 */

import type { GCUIDRecord } from './connector.js';

/**
 * Configuration for a `PushConnectorClient`.
 *
 * The `systemId` and `authToken` together authenticate the upstream
 * request; `authToken` must match the value configured for this
 * connector in the registry's connector registry.
 */
export interface PushConnectorClientConfig {
  /** Full base URL of the GCUID registry API, e.g. http://localhost:5182 */
  registryUrl: string;
  /** Connector `systemId` (e.g. "conn-finance"). */
  systemId: string;
  /** Bearer auth token matching `connectorServer.authToken` in the connector JSON. */
  authToken: string;
  /** Request timeout in ms — default 30 000. */
  timeout?: number;
}

/** One normalised record ready to be ingested by the GCUID attribute cache. */
export interface IngestRecord {
  /** Stable source-system identifier for this record. */
  source_id: string;
  /** Normalised payload in the shape the registry expects. */
  normalised: Record<string, any>;
  /** ISO-8601 timestamp at which the source believes this record became effective. */
  effective_at?: string;
}

/** Aggregated outcome of an ingest call or batched ingest run. */
export interface IngestResult {
  /** Records the registry accepted and wrote to the attribute cache. */
  accepted: number;
  /** Records the registry rejected (validation, auth, schema). */
  rejected: number;
  /** Per-record error messages for the rejected entries. */
  errors: string[];
}

/**
 * HTTP client used by connector servers to push normalised records
 * upstream into the GCUID attribute cache.
 *
 * @example
 * ```ts
 * const client = new PushConnectorClient({
 *   registryUrl: 'http://localhost:5182',
 *   systemId: 'conn-finance',
 *   authToken: process.env.CONNECTOR_TOKEN!,
 * });
 * const result = await client.pushAll(records);
 * console.log(`accepted=${result.accepted} rejected=${result.rejected}`);
 * ```
 */
export class PushConnectorClient {
  private readonly baseUrl: string;
  private readonly systemId: string;
  private readonly authToken: string;
  private readonly timeout: number;

  /**
   * @param config Connection settings; see `PushConnectorClientConfig`.
   */
  constructor(config: PushConnectorClientConfig) {
    this.baseUrl = config.registryUrl.replace(/\/$/, '');
    this.systemId = config.systemId;
    this.authToken = config.authToken;
    this.timeout = config.timeout ?? 30_000;
  }

  /**
   * Push a batch of normalised records to the GCUID attribute cache.
   *
   * Performs a single POST. For larger inputs prefer `pushAll` which
   * batches automatically and aggregates the results.
   *
   * @param records Records to ingest.
   * @returns Per-batch accepted/rejected counts and any error messages.
   * @throws Error if the HTTP request fails or the registry returns a non-2xx status.
   */
  async push(records: IngestRecord[]): Promise<IngestResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(
        `${this.baseUrl}/api/connectors/${encodeURIComponent(this.systemId)}/ingest`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.authToken}`,
          },
          body: JSON.stringify({ records }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const err: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
        err.status = response.status;
        throw err;
      }

      const body = await response.json() as any;
      return body.data as IngestResult;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Push records in batches of `batchSize` (default 500).
   * Returns aggregated totals across all batches.
   *
   * @param records Records to ingest.
   * @param batchSize Maximum records per individual POST.
   * @returns Aggregated accepted/rejected counts and error messages across all batches.
   */
  async pushAll(records: IngestRecord[], batchSize = 500): Promise<IngestResult> {
    const result: IngestResult = { accepted: 0, rejected: 0, errors: [] };

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const batchResult = await this.push(batch);
      result.accepted += batchResult.accepted;
      result.rejected += batchResult.rejected;
      result.errors.push(...batchResult.errors);
    }

    return result;
  }

  /**
   * Convert `GCUIDRecord` array (from `ConnectorAPIClient.fetchAll`) to
   * `IngestRecord` array ready for `push`/`pushAll`.
   *
   * @param records Records fetched from a connector server.
   * @returns Records in the ingest shape, with `effective_at` taken from the source's `modifiedAt`.
   */
  static fromGCUIDRecords(records: GCUIDRecord[]): IngestRecord[] {
    return records.map(r => ({
      source_id: r.sourceId,
      normalised: r.normalised,
      effective_at: r.modifiedAt,
    }));
  }
}
