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
export declare abstract class AuthoritativeSourceAdapter {
    protected config: AuthoritativeSourceConfig;
    protected connected: boolean;
    constructor(config: AuthoritativeSourceConfig);
    /**
     * Get the source configuration
     */
    getConfig(): AuthoritativeSourceConfig;
    /**
     * Get the schema definition
     */
    getSchema(): AuthoritativeSourceSchema;
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
    isConnected(): boolean;
    /**
     * Validate the configuration
     */
    protected validateConfig(): void;
    /**
     * Map source attributes to GCUID attribute names
     */
    protected mapAttributes(sourceAttributes: Record<string, any>): Record<string, any>;
    /**
     * Calculate confidence score for a match
     */
    protected calculateConfidence(query: Record<string, any>, record: Record<string, any>, matchedAttributes: string[]): number;
}
/**
 * Mock authoritative source adapter for testing
 * Stores data in memory
 */
export declare class MockAuthoritativeSourceAdapter extends AuthoritativeSourceAdapter {
    private records;
    constructor(config: AuthoritativeSourceConfig, mockData?: SourceIdentityRecord[]);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    testConnection(): Promise<boolean>;
    search(query: SourceQuery): Promise<SourceSearchResult>;
    getById(identifier: string): Promise<SourceIdentityRecord | null>;
    getAttributes(identifier: string, attributeNames: string[]): Promise<Record<string, any>>;
    /**
     * Add a mock record for testing
     */
    addMockRecord(record: SourceIdentityRecord): void;
    /**
     * Find matching attributes between query and record
     */
    private findMatches;
    /**
     * Check if two values match
     */
    private valuesMatch;
}
/**
 * Manager for multiple authoritative sources
 * Coordinates searching across multiple sources
 */
export declare class AuthoritativeSourceManager {
    private sources;
    private enabledSources;
    /**
     * Register an authoritative source
     */
    registerSource(adapter: AuthoritativeSourceAdapter): void;
    /**
     * Unregister a source
     */
    unregisterSource(sourceId: string): void;
    /**
     * Get a source by ID
     */
    getSource(sourceId: string): AuthoritativeSourceAdapter | undefined;
    /**
     * Get all registered sources
     */
    getAllSources(): AuthoritativeSourceAdapter[];
    /**
     * Get all enabled sources
     */
    getEnabledSources(): AuthoritativeSourceAdapter[];
    /**
     * Connect to all enabled sources
     */
    connectAll(): Promise<void>;
    /**
     * Disconnect from all sources
     */
    disconnectAll(): Promise<void>;
    /**
     * Search across all enabled sources
     */
    searchAll(query: SourceQuery): Promise<Map<string, SourceSearchResult>>;
    /**
     * Search a specific source by ID
     */
    searchSource(sourceId: string, query: SourceQuery): Promise<SourceSearchResult>;
    /**
     * Get consolidated results from all sources
     * Merges and ranks results by confidence
     */
    searchAllConsolidated(query: SourceQuery): Promise<{
        records: SourceIdentityRecord[];
        sources: string[];
        confidenceScores: number[];
        totalSources: number;
        sourcesSearched: number;
    }>;
}
/**
 * Helper function to create a mock HR system source
 */
export declare function createMockHRSource(mockData?: SourceIdentityRecord[]): MockAuthoritativeSourceAdapter;
/**
 * Helper function to create a mock LDAP/Active Directory source
 */
export declare function createMockLDAPSource(mockData?: SourceIdentityRecord[]): MockAuthoritativeSourceAdapter;
//# sourceMappingURL=authoritative-source.d.ts.map