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
 * Authoritative Source System
 * 
 * Represents external systems that contain pre-existing identity information.
 * Each authoritative source has its own schema, identifiers, and attributes
 * that the Identity Registry and Attribute Broker use for:
 * - Duplicate detection
 * - Attribute retrieval
 * - Identity correlation
 * - Data synchronization
 */

import { logger, logInfo, logError, logDebug, logWarn } from './logger';

/**
 * Schema definition for an authoritative source
 * Describes the structure of identity data in the external system
 */
export interface AuthoritativeSourceSchema {
  /** Name of the source system */
  sourceName: string;
  
  /** Primary identifier field name in the source system */
  primaryIdentifier: string;
  
  /** Available attribute fields */
  attributes: AttributeDefinition[];
  
  /** Optional secondary identifiers for correlation */
  secondaryIdentifiers?: string[];
  
  /** API version or schema version */
  version?: string;
}

/**
 * Definition of an attribute in the authoritative source
 */
export interface AttributeDefinition {
  /** Field name in the source system */
  fieldName: string;
  
  /** Mapped field name in GCUID system (if different) */
  mappedName?: string;
  
  /** Data type */
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  
  /** Whether this field can be used for matching */
  matchable?: boolean;
  
  /** Weight for similarity matching (0-1) */
  matchWeight?: number;
  
  /** Whether this field is required */
  required?: boolean;
  
  /** Whether this field is personally identifiable information */
  isPII?: boolean;
  
  /** Description of the attribute */
  description?: string;
}

/**
 * Identity record from an authoritative source
 */
export interface SourceIdentityRecord {
  /** Source system identifier */
  sourceId: string;
  
  /** Source system name */
  sourceName: string;
  
  /** Primary identifier value from the source */
  primaryIdentifier: string;
  
  /** All attributes from the source */
  attributes: Record<string, any>;
  
  /** When this record was retrieved */
  retrievedAt: Date;
  
  /** Metadata about the source record */
  metadata?: {
    lastModified?: Date;
    status?: string;
    recordVersion?: string;
    [key: string]: any;
  };
}

/**
 * Query for searching authoritative sources
 */
export interface SourceQuery {
  /** Attributes to match */
  attributes: Record<string, any>;
  
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
  
  /** Maximum number of results */
  limit?: number;
  
  /** Whether to perform exact or fuzzy matching */
  matchType?: 'exact' | 'fuzzy' | 'hybrid';
}

/**
 * Result of a search in an authoritative source
 */
export interface SourceSearchResult {
  /** Matching records */
  records: SourceIdentityRecord[];
  
  /** Confidence scores for each record (0-1) */
  confidenceScores: number[];
  
  /** Which attributes matched for each record */
  matchedAttributes: string[][];
  
  /** Total number of records searched */
  totalSearched: number;
  
  /** Query execution time in milliseconds */
  executionTime: number;
}

/**
 * Configuration for an authoritative source connection
 */
export interface AuthoritativeSourceConfig {
  /** Unique identifier for this source */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Type of source */
  type: 'hr' | 'ldap' | 'database' | 'api' | 'saml' | 'oauth' | 'custom';
  
  /** Schema definition */
  schema: AuthoritativeSourceSchema;
  
  /** Connection settings */
  connection: {
    endpoint?: string;
    credentials?: Record<string, any>;
    timeout?: number;
    retryAttempts?: number;
    [key: string]: any;
  };
  
  /** Whether this source is enabled */
  enabled: boolean;
  
  /** Priority for searching (higher = searched first) */
  priority?: number;
  
  /** Rate limiting settings */
  rateLimit?: {
    maxRequestsPerSecond?: number;
    maxRequestsPerMinute?: number;
  };
}

/**
 * Abstract base class for authoritative source adapters
 * Subclasses implement specific integration logic for each source type
 */
export abstract class AuthoritativeSourceAdapter {
  protected config: AuthoritativeSourceConfig;
  protected connected: boolean = false;

  constructor(config: AuthoritativeSourceConfig) {
    this.config = config;
  }

  /**
   * Get the source configuration
   */
  getConfig(): AuthoritativeSourceConfig {
    return { ...this.config };
  }

  /**
   * Get the schema definition
   */
  getSchema(): AuthoritativeSourceSchema {
    return { ...this.config.schema };
  }

  /**
   * Connect to the authoritative source
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the authoritative source
   */
  abstract disconnect(): Promise<void>;

  /**
   * Test the connection
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Search for identity records matching the query
   */
  abstract search(query: SourceQuery): Promise<SourceSearchResult>;

  /**
   * Get a specific identity record by its source identifier
   */
  abstract getById(identifier: string): Promise<SourceIdentityRecord | null>;

  /**
   * Get attributes for a specific identity
   */
  abstract getAttributes(identifier: string, attributeNames: string[]): Promise<Record<string, any>>;

  /**
   * Check if the adapter is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Validate the configuration
   */
  protected validateConfig(): void {
    if (!this.config.id || !this.config.name) {
      throw new Error('Source id and name are required');
    }
    if (!this.config.schema) {
      throw new Error('Schema definition is required');
    }
    if (!this.config.schema.primaryIdentifier) {
      throw new Error('Primary identifier must be defined in schema');
    }
  }

  /**
   * Map source attributes to GCUID attribute names
   */
  protected mapAttributes(sourceAttributes: Record<string, any>): Record<string, any> {
    const mapped: Record<string, any> = {};
    
    for (const attr of this.config.schema.attributes) {
      const sourceValue = sourceAttributes[attr.fieldName];
      if (sourceValue !== undefined) {
        const targetName = attr.mappedName || attr.fieldName;
        mapped[targetName] = sourceValue;
      }
    }
    
    return mapped;
  }

  /**
   * Calculate confidence score for a match
   */
  protected calculateConfidence(
    query: Record<string, any>,
    record: Record<string, any>,
    matchedAttributes: string[]
  ): number {
    if (matchedAttributes.length === 0) {
      return 0;
    }

    let totalWeight = 0;
    let matchedWeight = 0;

    for (const attr of this.config.schema.attributes) {
      if (attr.matchable && query[attr.fieldName] !== undefined) {
        const weight = attr.matchWeight || 1.0;
        totalWeight += weight;

        if (matchedAttributes.includes(attr.fieldName)) {
          matchedWeight += weight;
        }
      }
    }

    return totalWeight > 0 ? matchedWeight / totalWeight : 0;
  }
}

/**
 * Mock authoritative source adapter for testing
 * Stores data in memory
 */
export class MockAuthoritativeSourceAdapter extends AuthoritativeSourceAdapter {
  private records: Map<string, SourceIdentityRecord> = new Map();

  constructor(config: AuthoritativeSourceConfig, mockData?: SourceIdentityRecord[]) {
    super(config);
    this.validateConfig();
    
    if (mockData) {
      mockData.forEach(record => {
        this.records.set(record.primaryIdentifier, record);
      });
    }
  }

  async connect(): Promise<void> {
    logDebug(`Connecting to mock source: ${this.config.name}`);
    this.connected = true;
    logInfo(`Connected to mock source: ${this.config.name}`);
  }

  async disconnect(): Promise<void> {
    logDebug(`Disconnecting from mock source: ${this.config.name}`);
    this.connected = false;
    logInfo(`Disconnected from mock source: ${this.config.name}`);
  }

  async testConnection(): Promise<boolean> {
    return true;
  }

  async search(query: SourceQuery): Promise<SourceSearchResult> {
    const startTime = Date.now();
    
    logDebug('Searching mock source', {
      source: this.config.name,
      query: query.attributes
    });

    const results: SourceIdentityRecord[] = [];
    const confidenceScores: number[] = [];
    const matchedAttributes: string[][] = [];

    for (const record of this.records.values()) {
      const matches = this.findMatches(query.attributes, record.attributes);
      
      if (matches.length > 0) {
        const confidence = this.calculateConfidence(
          query.attributes,
          record.attributes,
          matches
        );

        if (!query.minConfidence || confidence >= query.minConfidence) {
          results.push(record);
          confidenceScores.push(confidence);
          matchedAttributes.push(matches);
        }
      }

      if (query.limit && results.length >= query.limit) {
        break;
      }
    }

    const executionTime = Date.now() - startTime;

    logInfo('Mock source search complete', {
      source: this.config.name,
      resultsFound: results.length,
      executionTime
    });

    return {
      records: results,
      confidenceScores,
      matchedAttributes,
      totalSearched: this.records.size,
      executionTime
    };
  }

  async getById(identifier: string): Promise<SourceIdentityRecord | null> {
    const record = this.records.get(identifier);
    
    if (record) {
      logDebug(`Retrieved record ${identifier} from ${this.config.name}`);
      return { ...record };
    }
    
    logDebug(`Record ${identifier} not found in ${this.config.name}`);
    return null;
  }

  async getAttributes(
    identifier: string,
    attributeNames: string[]
  ): Promise<Record<string, any>> {
    const record = await this.getById(identifier);
    
    if (!record) {
      throw new Error(`Record not found: ${identifier}`);
    }

    const attributes: Record<string, any> = {};
    
    for (const attrName of attributeNames) {
      if (record.attributes[attrName] !== undefined) {
        attributes[attrName] = record.attributes[attrName];
      }
    }

    return attributes;
  }

  /**
   * Add a mock record for testing
   */
  addMockRecord(record: SourceIdentityRecord): void {
    this.records.set(record.primaryIdentifier, record);
    logDebug(`Added mock record to ${this.config.name}`, {
      identifier: record.primaryIdentifier
    });
  }

  /**
   * Find matching attributes between query and record
   */
  private findMatches(
    query: Record<string, any>,
    record: Record<string, any>
  ): string[] {
    const matches: string[] = [];

    for (const [key, value] of Object.entries(query)) {
      if (record[key] !== undefined) {
        // Simple exact match for now
        if (this.valuesMatch(value, record[key])) {
          matches.push(key);
        }
      }
    }

    return matches;
  }

  /**
   * Check if two values match
   */
  private valuesMatch(a: any, b: any): boolean {
    if (typeof a === 'string' && typeof b === 'string') {
      return a.toLowerCase() === b.toLowerCase();
    }
    return a === b;
  }
}

/**
 * Manager for multiple authoritative sources
 * Coordinates searching across multiple sources
 */
export class AuthoritativeSourceManager {
  private sources: Map<string, AuthoritativeSourceAdapter> = new Map();
  private enabledSources: AuthoritativeSourceAdapter[] = [];

  /**
   * Register an authoritative source
   */
  registerSource(adapter: AuthoritativeSourceAdapter): void {
    const config = adapter.getConfig();
    
    if (this.sources.has(config.id)) {
      logWarn(`Source ${config.id} already registered, replacing`);
    }

    this.sources.set(config.id, adapter);
    
    if (config.enabled) {
      this.enabledSources.push(adapter);
      // Sort by priority (higher first)
      this.enabledSources.sort((a, b) => {
        const priorityA = a.getConfig().priority || 0;
        const priorityB = b.getConfig().priority || 0;
        return priorityB - priorityA;
      });
    }

    logInfo(`Registered authoritative source: ${config.name}`, {
      id: config.id,
      enabled: config.enabled
    });
  }

  /**
   * Unregister a source
   */
  unregisterSource(sourceId: string): void {
    const adapter = this.sources.get(sourceId);
    
    if (adapter) {
      this.sources.delete(sourceId);
      this.enabledSources = this.enabledSources.filter(
        s => s.getConfig().id !== sourceId
      );
      logInfo(`Unregistered source: ${sourceId}`);
    }
  }

  /**
   * Get a source by ID
   */
  getSource(sourceId: string): AuthoritativeSourceAdapter | undefined {
    return this.sources.get(sourceId);
  }

  /**
   * Get all registered sources
   */
  getAllSources(): AuthoritativeSourceAdapter[] {
    return Array.from(this.sources.values());
  }

  /**
   * Get all enabled sources
   */
  getEnabledSources(): AuthoritativeSourceAdapter[] {
    return [...this.enabledSources];
  }

  /**
   * Connect to all enabled sources
   */
  async connectAll(): Promise<void> {
    logInfo('Connecting to all enabled authoritative sources');
    
    const promises = this.enabledSources.map(async (source) => {
      try {
        await source.connect();
      } catch (error) {
        logError(`Failed to connect to ${source.getConfig().name}`, {
          error: (error as Error).message
        });
      }
    });

    await Promise.all(promises);
  }

  /**
   * Disconnect from all sources
   */
  async disconnectAll(): Promise<void> {
    logInfo('Disconnecting from all authoritative sources');
    
    const promises = Array.from(this.sources.values()).map(async (source) => {
      try {
        if (source.isConnected()) {
          await source.disconnect();
        }
      } catch (error) {
        logError(`Failed to disconnect from ${source.getConfig().name}`, {
          error: (error as Error).message
        });
      }
    });

    await Promise.all(promises);
  }

  /**
   * Search across all enabled sources
   */
  async searchAll(query: SourceQuery): Promise<Map<string, SourceSearchResult>> {
    logInfo('Searching all enabled authoritative sources', {
      sourcesCount: this.enabledSources.length
    });

    const results = new Map<string, SourceSearchResult>();

    // Search sources in parallel
    const promises = this.enabledSources.map(async (source) => {
      const config = source.getConfig();
      
      try {
        if (!source.isConnected()) {
          await source.connect();
        }

        const result = await source.search(query);
        results.set(config.id, result);
        
        logDebug(`Search complete for ${config.name}`, {
          resultsFound: result.records.length
        });
      } catch (error) {
        logError(`Search failed for ${config.name}`, {
          error: (error as Error).message
        });
      }
    });

    await Promise.all(promises);

    return results;
  }

  /**
   * Search a specific source by ID
   */
  async searchSource(
    sourceId: string,
    query: SourceQuery
  ): Promise<SourceSearchResult> {
    const source = this.sources.get(sourceId);
    
    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    if (!source.getConfig().enabled) {
      throw new Error(`Source is disabled: ${sourceId}`);
    }

    if (!source.isConnected()) {
      await source.connect();
    }

    return await source.search(query);
  }

  /**
   * Get consolidated results from all sources
   * Merges and ranks results by confidence
   */
  async searchAllConsolidated(query: SourceQuery): Promise<{
    records: SourceIdentityRecord[];
    sources: string[];
    confidenceScores: number[];
    totalSources: number;
    sourcesSearched: number;
  }> {
    const allResults = await this.searchAll(query);
    
    const consolidated: Array<{
      record: SourceIdentityRecord;
      source: string;
      confidence: number;
    }> = [];

    for (const [sourceId, result] of allResults) {
      for (let i = 0; i < result.records.length; i++) {
        consolidated.push({
          record: result.records[i],
          source: sourceId,
          confidence: result.confidenceScores[i]
        });
      }
    }

    // Sort by confidence (highest first)
    consolidated.sort((a, b) => b.confidence - a.confidence);

    // Apply limit if specified
    const limited = query.limit
      ? consolidated.slice(0, query.limit)
      : consolidated;

    return {
      records: limited.map(r => r.record),
      sources: limited.map(r => r.source),
      confidenceScores: limited.map(r => r.confidence),
      totalSources: this.enabledSources.length,
      sourcesSearched: allResults.size
    };
  }
}

/**
 * Helper function to create a mock HR system source
 */
export function createMockHRSource(mockData?: SourceIdentityRecord[]): MockAuthoritativeSourceAdapter {
  const config: AuthoritativeSourceConfig = {
    id: 'hr-system',
    name: 'HR System',
    type: 'hr',
    enabled: true,
    priority: 10,
    schema: {
      sourceName: 'HR System',
      primaryIdentifier: 'employeeId',
      secondaryIdentifiers: ['email', 'username'],
      attributes: [
        {
          fieldName: 'employeeId',
          type: 'string',
          required: true,
          matchable: true,
          matchWeight: 1.0,
          description: 'Unique employee identifier'
        },
        {
          fieldName: 'email',
          type: 'string',
          required: true,
          matchable: true,
          matchWeight: 0.9,
          isPII: true,
          description: 'Employee email address'
        },
        {
          fieldName: 'firstName',
          mappedName: 'given_name',
          type: 'string',
          required: true,
          matchable: true,
          matchWeight: 0.6,
          isPII: true,
          description: 'First name'
        },
        {
          fieldName: 'lastName',
          mappedName: 'family_name',
          type: 'string',
          required: true,
          matchable: true,
          matchWeight: 0.6,
          isPII: true,
          description: 'Last name'
        },
        {
          fieldName: 'username',
          type: 'string',
          matchable: true,
          matchWeight: 0.8,
          description: 'System username'
        },
        {
          fieldName: 'department',
          type: 'string',
          matchable: false,
          description: 'Department name'
        },
        {
          fieldName: 'title',
          type: 'string',
          matchable: false,
          description: 'Job title'
        },
        {
          fieldName: 'startDate',
          type: 'date',
          matchable: false,
          description: 'Employment start date'
        },
        {
          fieldName: 'status',
          type: 'string',
          matchable: false,
          description: 'Employment status'
        }
      ],
      version: '1.0'
    },
    connection: {
      endpoint: 'https://hr.internal/api',
      timeout: 5000,
      retryAttempts: 3
    }
  };

  return new MockAuthoritativeSourceAdapter(config, mockData);
}

/**
 * Helper function to create a mock LDAP/Active Directory source
 */
export function createMockLDAPSource(mockData?: SourceIdentityRecord[]): MockAuthoritativeSourceAdapter {
  const config: AuthoritativeSourceConfig = {
    id: 'ldap-ad',
    name: 'Active Directory',
    type: 'ldap',
    enabled: true,
    priority: 8,
    schema: {
      sourceName: 'Active Directory',
      primaryIdentifier: 'distinguishedName',
      secondaryIdentifiers: ['sAMAccountName', 'userPrincipalName', 'mail'],
      attributes: [
        {
          fieldName: 'distinguishedName',
          type: 'string',
          required: true,
          matchable: false,
          description: 'LDAP distinguished name'
        },
        {
          fieldName: 'sAMAccountName',
          mappedName: 'username',
          type: 'string',
          required: true,
          matchable: true,
          matchWeight: 0.9,
          description: 'SAM account name'
        },
        {
          fieldName: 'userPrincipalName',
          type: 'string',
          matchable: true,
          matchWeight: 0.85,
          description: 'User principal name'
        },
        {
          fieldName: 'mail',
          mappedName: 'email',
          type: 'string',
          matchable: true,
          matchWeight: 0.9,
          isPII: true,
          description: 'Email address'
        },
        {
          fieldName: 'givenName',
          mappedName: 'given_name',
          type: 'string',
          matchable: true,
          matchWeight: 0.6,
          isPII: true,
          description: 'Given name'
        },
        {
          fieldName: 'sn',
          mappedName: 'family_name',
          type: 'string',
          matchable: true,
          matchWeight: 0.6,
          isPII: true,
          description: 'Surname'
        },
        {
          fieldName: 'displayName',
          type: 'string',
          matchable: false,
          isPII: true,
          description: 'Display name'
        },
        {
          fieldName: 'memberOf',
          type: 'array',
          matchable: false,
          description: 'Group memberships'
        }
      ],
      version: '1.0'
    },
    connection: {
      endpoint: 'ldap://ad.internal:389',
      timeout: 5000,
      retryAttempts: 3
    }
  };

  return new MockAuthoritativeSourceAdapter(config, mockData);
}
