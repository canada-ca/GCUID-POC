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
 * Departmental Identity Source Connector API
 * Provides HTTP-based bridge between central GCUID system and departmental sources
 */

import express, { Express, Request, Response } from 'express';
import { Identity } from './index';

// ==================== Types ====================

/**
 * Configuration for a departmental connector server.
 *
 * Passed to `ConnectorAPIServer` at construction time. `authToken` is
 * required for every endpoint except `/health` and is matched against
 * the `Authorization: Bearer <token>` header on inbound requests.
 */
export interface ConnectorConfig {
  /** Stable identifier used in URL paths and as the `sourceId` field in responses. */
  sourceId: string;
  /** Human-readable display name shown in admin UIs and `/info` responses. */
  sourceName: string;
  /** Connector category; used for routing and for filtering in the central registry. */
  sourceType: 'hr' | 'ldap' | 'customer-db' | 'erp' | 'custom';
  /** TCP port the connector HTTP server binds to. */
  port: number;
  /** Bearer token required on every authenticated endpoint. */
  authToken: string;
  /** Cache TTL in seconds for records served by this connector (advisory). */
  cacheTTL?: number;
}

/**
 * Request body for `POST /search` on a connector server.
 */
export interface ConnectorSearchRequest {
  /** Standard attribute name → value pairs used to filter records. */
  attributes: Record<string, any>;
  /** Maximum records to return; default on the server is 100. */
  limit?: number;
  /** When true, allow fuzzy matching on attribute values. */
  fuzzy?: boolean;
}

/**
 * Response body for `POST /search`.
 */
export interface ConnectorSearchResponse {
  /** Identifier of the connector that produced this response. */
  sourceId: string;
  /** Matching records, in the `ConnectorRecord` shape. */
  records: ConnectorRecord[];
  /** Server-side wall-clock time taken for the search, in milliseconds. */
  searchTime: number;
  /** Whether the result was served from a local cache (false by default). */
  fromCache: boolean;
}

/**
 * A single normalised record exchanged between a connector and the
 * central GCUID registry.
 */
export interface ConnectorRecord {
  /** Primary key for this record in the source system. */
  recordId: string;
  /** Raw attributes as returned by the source system. */
  attributes: Record<string, any>;
  /** Attributes normalised to canonical GCUID attribute names. */
  normalizedAttributes: Record<string, any>;
  /** Last modification timestamp reported by the source. */
  lastModified: Date;
  /** Optional confidence score in the range 0..1 (higher is better). */
  confidence?: number;
}

/**
 * Response body for `GET /health`.
 */
export interface ConnectorHealthResponse {
  /** Identifier of the connector that produced this response. */
  sourceId: string;
  /** Current lifecycle status of the connector. */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Seconds elapsed since the server started. */
  uptime: number;
  /** Last successful sync timestamp, if the connector maintains a cache. */
  lastSync?: Date;
  /** Total records currently known to this connector. */
  recordCount?: number;
  /** Cache hit rate (0..1) over the recent request window, when available. */
  cacheHitRate?: number;
}

/**
 * Push notification payload used by `ConnectorDataProvider.onUpdate`
 * to inform the central registry of record changes.
 */
export interface ConnectorUpdateNotification {
  /** Identifier of the connector emitting the notification. */
  sourceId: string;
  /** Primary key of the affected record in the source system. */
  recordId: string;
  /** Kind of mutation that occurred. */
  operation: 'create' | 'update' | 'delete';
  /** New attribute values (omitted for `delete`). */
  attributes: Record<string, any>;
  /** Timestamp the source assigned to the mutation. */
  timestamp: Date;
}

// ==================== Data Provider Interface ====================

/**
 * Interface that departmental systems must implement
 */
export interface ConnectorDataProvider {
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
  getHealth(): Promise<Omit<ConnectorHealthResponse, 'sourceId'>>;

  /**
   * Fetch all records (optionally modified after `since` ISO timestamp).
   * Used by scheduled-pull connectors to populate the attribute cache.
   */
  fetchAll?(since?: string): Promise<ConnectorRecord[]>;

  /**
   * Update fields on a specific record (optional - for write-enabled connectors)
   */
  updateRecord?(recordId: string, fields: Record<string, any>): Promise<void>;

  /**
   * Subscribe to updates (optional - for push notifications)
   */
  onUpdate?(callback: (notification: ConnectorUpdateNotification) => void): void;
}

// ==================== Connector API Server ====================

/**
 * HTTP server that exposes departmental data via REST API
 * Runs at each department, communicates with central GCUID system
 */
export class ConnectorAPIServer {
  private app: Express;
  private config: ConnectorConfig;
  private dataProvider: ConnectorDataProvider;
  private server: any;
  private startTime: Date;
  private requestCount: number = 0;

  constructor(config: ConnectorConfig, dataProvider: ConnectorDataProvider) {
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
        const duration = Date.now() - start;
        console.log(`[${this.config.sourceId}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req: Request, res: Response) => {
      try {
        const health = await this.dataProvider.getHealth();
        const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
        
        const response: ConnectorHealthResponse = {
          sourceId: this.config.sourceId,
          status: health.status,
          uptime,
          lastSync: health.lastSync,
          recordCount: health.recordCount,
          cacheHitRate: health.cacheHitRate,
        };

        res.json(response);
      } catch (error) {
        res.status(500).json({ 
          sourceId: this.config.sourceId,
          status: 'unhealthy',
          error: (error as Error).message 
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
        // The dataProvider returns a wrapped result object: { records, ... }.
        // The connector API exposes a flatter { records, searchTime, ... } shape,
        // so unwrap before re-wrapping. This also matches the contract documented
        // in `SourceQuery` / `SourceSearchResult`.
        //
        // Each record carries `primaryIdentifier` from the dataProvider, but the
        // public `ConnectorRecord` contract requires a `recordId` field. CAES
        // and the GCUID request preview both rely on `recordId` to look up
        // source_mappings, so we map it here. Attributes are also exposed as
        // `normalizedAttributes` for clients that want the canonical view.
        const searchResult: any = await this.dataProvider.search({
          attributes: searchRequest.attributes,
          limit:      searchRequest.limit || 100,
          fuzzy:      searchRequest.fuzzy !== false,
        });
        const rawRecords: any[] = Array.isArray(searchResult) ? searchResult : (searchResult.records ?? []);
        const records: ConnectorRecord[] = rawRecords.map((r: any) => ({
          recordId:            r.recordId ?? r.primaryIdentifier,
          attributes:          r.attributes ?? {},
          normalizedAttributes: r.normalizedAttributes ?? r.attributes ?? {},
          lastModified:        r.lastModified ?? r.retrievedAt ?? null,
        }));
        const searchTime = Date.now() - startTime;

        const response: ConnectorSearchResponse = {
          sourceId: this.config.sourceId,
          records,
          searchTime,
          fromCache: false, // Data provider can override this
        };

        res.json(response);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Update record endpoint
    this.app.patch('/record/:recordId', async (req: Request, res: Response) => {
      try {
        const recordId = req.params.recordId as string;
        const { fields } = req.body as { fields?: Record<string, any> };
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
          return res.status(400).json({ error: 'fields object required' });
        }
        if (!this.dataProvider.updateRecord) {
          return res.status(501).json({ error: 'updateRecord not implemented by this data provider' });
        }
        await this.dataProvider.updateRecord(recordId, fields);
        res.json({ updated: true, recordId });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Get specific record endpoint
    this.app.get('/record/:recordId', async (req: Request, res: Response) => {
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

    // Fetch all records endpoint (for scheduled-pull cache population)
    this.app.get('/records', async (req: Request, res: Response) => {
      try {
        if (!this.dataProvider.fetchAll) {
          return res.status(501).json({ error: 'fetchAll not implemented by this data provider' });
        }
        const since = req.query.since as string | undefined;
        const records = await this.dataProvider.fetchAll(since);
        res.json({ sourceId: this.config.sourceId, records, count: records.length });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Info endpoint
    this.app.get('/info', (req: Request, res: Response) => {
      res.json({
        sourceId: this.config.sourceId,
        sourceName: this.config.sourceName,
        sourceType: this.config.sourceType,
        uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
        requestCount: this.requestCount,
      });
    });
  }

  /**
   * Start the connector server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        console.log(`[${this.config.sourceId}] Connector API listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the connector server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log(`[${this.config.sourceId}] Connector API stopped`);
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

// ==================== Connector API Client ====================

/**
 * Client for communicating with departmental connector APIs
 * Used by central GCUID system
 */
export class ConnectorAPIClient {
  private baseUrl: string;
  private authToken: string;
  private timeout: number;

  constructor(baseUrl: string, authToken: string, timeout: number = 5000) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authToken = authToken;
    this.timeout = timeout;
  }

  /**
   * Search for records
   */
  async search(request: ConnectorSearchRequest): Promise<ConnectorSearchResponse> {
    const response = await this.makeRequest('/search', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return response as ConnectorSearchResponse;
  }

  /**
   * Fetch all records (optionally since a given ISO timestamp).
   * Used by the central registry to populate the attribute cache for scheduled-pull connectors.
   */
  async fetchAll(since?: string): Promise<ConnectorRecord[]> {
    const path = since ? `/records?since=${encodeURIComponent(since)}` : '/records';
    const response = await this.makeRequest(path, { method: 'GET' }) as any;
    return (response.records ?? []) as ConnectorRecord[];
  }

  /**
   * Update fields on a specific record
   */
  async updateRecord(recordId: string, fields: Record<string, any>): Promise<void> {
    await this.makeRequest(`/record/${encodeURIComponent(recordId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    });
  }

  /**
   * Get a specific record
   */
  async getRecord(recordId: string): Promise<ConnectorRecord | null> {
    try {
      const response = await this.makeRequest(`/record/${recordId}`, {
        method: 'GET',
      });
      return response as ConnectorRecord;
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check connector health
   */
  async health(): Promise<ConnectorHealthResponse> {
    const response = await this.makeRequest('/health', {
      method: 'GET',
      skipAuth: true, // Health check doesn't require auth
    });

    return response as ConnectorHealthResponse;
  }

  /**
   * Get connector info
   */
  async info(): Promise<any> {
    const response = await this.makeRequest('/info', {
      method: 'GET',
    });

    return response;
  }

  /**
   * Make HTTP request with timeout and error handling
   */
  private async makeRequest(path: string, options: {
    method: string;
    body?: string;
    skipAuth?: boolean;
  }): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (!options.skipAuth) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body: options.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        
        try {
          const errorBody = await response.json();
          error.details = errorBody;
        } catch {
          // Ignore JSON parse errors
        }
        
        throw error;
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      
      throw error;
    }
  }
}

export default ConnectorAPIServer;
