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
 * Authoritative Source HTTP API
 *
 * Exposes the source-system's record data over HTTP so that connector
 * intermediaries can fetch it across the network. This is the "real"
 * implementation of the `Src` actor in the connector sequence diagrams.
 *
 * The source server is what was previously collapsed into the connector
 * process: it owns the SQLite database file, the schema, and the seed
 * data. Connectors are thin HTTP intermediaries that proxy requests
 * here, do access-mode normalisation, and forward to the central registry.
 *
 * HTTP surface (5 endpoints):
 *   GET  /health           - Liveness + record count + last sync
 *   POST /search           - Search records by attribute values
 *   GET  /records/:id      - Get a single record by primary key
 *   GET  /records?since=   - Fetch all records (optionally modified since timestamp)
 *   PUT  /records/:id      - Update fields on a record (optional, write-enabled sources)
 *
 * The 5-endpoint shape mirrors the `ConnectorDataProvider` interface
 * defined in `connector-api.ts` exactly, so the connector's HTTP
 * client can use the same request/response types.
 */

import express, { Express, Request, Response } from 'express';
import {
  ConnectorRecord,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  ConnectorHealthResponse,
  ConnectorDataProvider,
} from './connector-api';

// ==================== Types ====================

/**
 * Configuration for a departmental source server.
 *
 * `database.path` is opened via `better-sqlite3` at server startup;
 * the source server is the only process that touches this file directly.
 */
export interface SourceConfig {
  /** Stable identifier used in URL paths and as the `sourceId` field in responses. */
  sourceId: string;
  /** Human-readable display name shown in admin UIs and `/info` responses. */
  sourceName: string;
  /** Source category; used for routing and for filtering in the central registry. */
  sourceType: 'hr' | 'ldap' | 'customer-db' | 'erp' | 'custom';
  /** TCP port the source HTTP server binds to. */
  port: number;
  /** Bearer token required on every authenticated endpoint. */
  authToken: string;
  /** Database configuration. The source server owns this file. */
  database: {
    /** Filesystem path to the SQLite database file (absolute or relative to cwd). */
    path: string;
    /** Table name to query (e.g. "employees", "users"). */
    tableName: string;
    /** Column name used as the primary identifier (e.g. "employee_id"). */
    primaryKey: string;
  };
}

/**
 * Response body for `GET /health` on a source server.
 * Same shape as connector health, with an extra `database` field for ops visibility.
 */
export interface SourceHealthResponse extends Omit<ConnectorHealthResponse, 'sourceId'> {
  /** Absolute path to the SQLite file backing this source. */
  databasePath: string;
  /** Number of rows currently in the source table. */
  recordCount: number;
}

// ==================== Data Provider Interface (server-side) ====================

/**
 * Interface the source server uses to talk to its underlying database.
 *
 * Decoupled from `SQLiteAuthoritativeSourceAdapter` so the source
 * server could (in principle) front a real HR/LDAP system instead
 * of a SQLite file. The default implementation uses SQLite; the
 * connector↔source HTTP boundary is what matters for the design
 * intent.
 */
export interface SourceDataProvider {
  /**
   * Search for records matching the given attributes
   */
  search(attributes: Record<string, any>, options?: { limit?: number; fuzzy?: boolean }): Promise<ConnectorRecord[]>;

  /**
   * Get a specific record by ID
   */
  getRecord(recordId: string): Promise<ConnectorRecord | null>;

  /**
   * Get health/status information
   */
  getHealth(): Promise<SourceHealthResponse>;

  /**
   * Fetch all records (optionally modified after `since` ISO timestamp).
   * Used by scheduled-pull connectors to populate the attribute cache.
   */
  fetchAll?(since?: string): Promise<ConnectorRecord[]>;

  /**
   * Update fields on a specific record (optional - for write-enabled sources)
   */
  updateRecord?(recordId: string, fields: Record<string, any>): Promise<void>;
}

// ==================== Source API Server ====================

/**
 * HTTP server that exposes authoritative source data via REST API.
 *
 * Runs as a separate process from the connector intermediary. The
 * registry's flow becomes:
 *
 *   Registry ─HTTP─▶ Connector ─HTTP─▶ SourceAPIServer ─SQLite─▶ data/sources/conn-*.db
 *
 * The SourceAPIServer accepts the same request shapes as
 * ConnectorAPIServer's `/health`, `/search`, `/records/:id`,
 * `/records?since=...`, and `PUT /records/:id` endpoints, so the
 * connector-side HTTP client is a thin shim.
 */
export class SourceAPIServer {
  private app: Express;
  private config: SourceConfig;
  private dataProvider: SourceDataProvider;
  private server: any;
  private startTime: Date;
  private requestCount: number = 0;

  constructor(config: SourceConfig, dataProvider: SourceDataProvider) {
    this.config = config;
    this.dataProvider = dataProvider;
    this.app = express();
    this.startTime = new Date();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());

    // Authentication middleware
    this.app.use((req: Request, res: Response, next: any) => {
      if (req.path === '/health') {
        return next(); // Health check doesn't require auth
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
      }

      const token = authHeader.substring(7);
      if (token !== this.config.authToken) {
        return res.status(403).json({ error: 'Invalid authentication token' });
      }

      next();
    });

    // Request logging
    this.app.use((req: Request, res: Response, next: any) => {
      this.requestCount++;
      const start = Date.now();
      res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`[${this.config.sourceId}] ${req.method} ${req.path} - ${res.statusCode} (${ms}ms)`);
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health endpoint
    this.app.get('/health', async (req: Request, res: Response) => {
      try {
        const health = await this.dataProvider.getHealth();
        const response: ConnectorHealthResponse = {
          sourceId: this.config.sourceId,
          status: health.status,
          uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
          lastSync: health.lastSync,
          recordCount: health.recordCount,
          cacheHitRate: health.cacheHitRate,
        };
        res.json(response);
      } catch (error) {
        res.status(500).json({
          sourceId: this.config.sourceId,
          status: 'unhealthy',
          error: (error as Error).message,
        });
      }
    });

    // Search endpoint
    this.app.post('/search', async (req: Request, res: Response) => {
      try {
        const searchRequest: ConnectorSearchRequest = req.body;
        if (!searchRequest.attributes || Object.keys(searchRequest.attributes).length === 0) {
          return res.status(400).json({ error: 'Attributes required for search' });
        }
        const startTime = Date.now();
        const records = await this.dataProvider.search(searchRequest.attributes, {
          limit: searchRequest.limit,
          fuzzy: searchRequest.fuzzy,
        });
        const response: ConnectorSearchResponse = {
          sourceId: this.config.sourceId,
          records,
          searchTime: Date.now() - startTime,
          fromCache: false,
        };
        res.json(response);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Get specific record endpoint
    this.app.get('/records/:recordId', async (req: Request, res: Response) => {
      try {
        const recordId = req.params.recordId as string;
        const record = await this.dataProvider.getRecord(recordId);
        if (!record) {
          return res.status(404).json({ error: 'Record not found' });
        }
        res.json(record);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Fetch all records endpoint
    this.app.get('/records', async (req: Request, res: Response) => {
      try {
        if (!this.dataProvider.fetchAll) {
          return res.status(501).json({ error: 'fetchAll not implemented by this source' });
        }
        const since = req.query.since as string | undefined;
        const records = await this.dataProvider.fetchAll(since);
        res.json({ sourceId: this.config.sourceId, records, count: records.length });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Update record endpoint (optional)
    this.app.put('/records/:recordId', async (req: Request, res: Response) => {
      try {
        if (!this.dataProvider.updateRecord) {
          return res.status(501).json({ error: 'updateRecord not implemented by this source' });
        }
        const recordId = req.params.recordId as string;
        const fields = req.body;
        await this.dataProvider.updateRecord(recordId, fields);
        res.json({ updated: true, recordId });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Info endpoint (unauthenticated for ops visibility)
    this.app.get('/info', (req: Request, res: Response) => {
      res.json({
        sourceId: this.config.sourceId,
        sourceName: this.config.sourceName,
        sourceType: this.config.sourceType,
        databasePath: this.config.database.path,
        uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
        requestCount: this.requestCount,
      });
    });
  }

  /**
   * Start the source HTTP server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        console.log(`[${this.config.sourceId}] Source API listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the source HTTP server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log(`[${this.config.sourceId}] Source API stopped`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the Express app (for testing)
   */
  getApp(): Express {
    return this.app;
  }
}

// ==================== Source API Client ====================

/**
 * HTTP client for talking to a source server from a connector process.
 *
 * Implements `ConnectorDataProvider` (the same interface
 * ConnectorAPIServer accepts) but routes every call over HTTP to
 * the upstream source server instead of opening a local SQLite file.
 *
 * Use this instead of `createHRSystemSource(dbPath)` etc. when wiring
 * a connector that fronts a separate source process.
 */
export class SourceAPIClient implements ConnectorDataProvider {
  private baseUrl: string;
  private authToken: string;
  private sourceId: string;
  private timeout: number;

  constructor(baseUrl: string, authToken: string, sourceId: string, timeout: number = 5000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authToken = authToken;
    this.sourceId = sourceId;
    this.timeout = timeout;
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404) {
          return null as T;
        }
        const errText = await response.text();
        throw new Error(`Source ${this.sourceId} ${method} ${path} -> ${response.status}: ${errText}`);
      }
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async search(attributes: Record<string, any>, options?: { limit?: number; fuzzy?: boolean }): Promise<ConnectorRecord[]> {
    // The connector-api.ts server calls us with a single-arg signature
    // (treating attributes as a SourceQuery-shaped object). The SourceAPIServer
    // accepts a single ConnectorSearchRequest body. To bridge these two shapes
    // cleanly, accept BOTH the two-arg form and the single-arg form.
    let attrs: Record<string, any>;
    let opts: { limit?: number; fuzzy?: boolean };
    if (attributes && typeof attributes === 'object' && ('attributes' in attributes || 'limit' in attributes || 'fuzzy' in attributes)) {
      // Single-arg SourceQuery shape
      attrs = attributes.attributes ?? {};
      opts = { limit: attributes.limit, fuzzy: attributes.fuzzy };
    } else {
      // Two-arg ConnectorDataProvider shape
      attrs = attributes ?? {};
      opts = options ?? {};
    }
    const response = await this.request<ConnectorSearchResponse>('POST', '/search', {
      attributes: attrs,
      limit: opts.limit ?? 100,
      fuzzy: opts.fuzzy !== false,
    });
    return response.records ?? [];
  }

  async getRecord(recordId: string): Promise<ConnectorRecord | null> {
    try {
      return await this.request<ConnectorRecord>('GET', `/records/${encodeURIComponent(recordId)}`);
    } catch (e) {
      if ((e as Error).message.includes('-> 404')) {
        return null;
      }
      throw e;
    }
  }

  async getHealth(): Promise<Omit<ConnectorHealthResponse, 'sourceId'>> {
    return await this.request<Omit<ConnectorHealthResponse, 'sourceId'>>('GET', '/health');
  }

  async fetchAll(since?: string): Promise<ConnectorRecord[]> {
    const path = since ? `/records?since=${encodeURIComponent(since)}` : '/records';
    const response = await this.request<{ records: ConnectorRecord[]; count: number }>('GET', path);
    return response.records ?? [];
  }

  async updateRecord(recordId: string, fields: Record<string, any>): Promise<void> {
    await this.request('PUT', `/records/${encodeURIComponent(recordId)}`, fields);
  }
}

export default SourceAPIServer;
