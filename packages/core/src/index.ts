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
 * Core GCUID (Government of Canada Unique Identifier) module
 * Handles identifier creation, validation, and lifecycle management
 * 
 * GCUID Format V2 (Current): urn:gcuid:{core}
 * - core: 26-character ULID or UUIDv4 in Crockford Base32
 * 
 * GCUID Format V1 (Legacy): urn:{namespace}:{entity-type}:{version}:{core}
 * - namespace: configurable namespace (default: "gc")
 * - entity-type: person, org, asset, app, agent (extensible)
 * - version: version number of the GCUID specification
 * - core: 26-character UUIDv4 or ULID base32 string
 * 
 * Alias Format: GC-{CONTEXT}-{HASH}-{CHECKSUM}
 * - Human-readable alternative to GCUID
 * - Example: GC-A-ABCD-EFGH-IJKL-M
 */

import { ulid } from 'ulid';
import { v4 as uuidv4 } from 'uuid';

// Export Crockford Base32 utilities
export {
  encodeCrockford,
  decodeCrockford,
  isValidCrockford,
  isValidGCUIDCore,
  uuidToCrockford,
  ulidToCrockford,
  normalizeCrockford,
  formatCrockford,
  CROCKFORD_ALPHABET,
  CROCKFORD_REGEX,
  CROCKFORD_26_REGEX
} from './crockford-base32';

// Export Alias utilities
export {
  generateAlias,
  parseAlias,
  validateAlias,
  formatAlias,
  getAliasHash,
  getAliasContext,
  isAliasFormat,
  verifyAliasForCore,
  compareAliases,
  generateMultipleAliases,
  AliasComponents,
  AliasGenerationOptions,
  AliasContext,
  ALIAS_REGEX
} from './alias';

// Export GCUID state machine types and functions
export { IdentityState, StateTransition, validateTransition, getValidTransitions, canTransition, gcuidStateMachine } from './state-machine';

// Export Identity entity state machine types and functions
export { 
  IdentityEntityState, 
  IdentityTransition,
  identityStateMachine,
  validateIdentityTransition,
  getValidIdentityTransitions,
  canTransitionIdentity,
  getNextIdentityState,
  isTerminalIdentityState,
  getIdentityStateDescription,
  getIdentityTransitionDescription
} from './identity-state-machine';

// Export Identity entity registry
export { 
  IdentityEntityRegistry,
  IdentityEntity,
  IdentityEntityStateHistory,
  CreateIdentityOptions,
  TransitionIdentityOptions
} from './identity-registry';

// Export configuration management
export { getConfig, getDbPath, Config } from './config';
export { default as config } from './config';

// Export logging
export { 
  logger, 
  logError, 
  logWarn, 
  logInfo, 
  logDebug, 
  logHttp, 
  logVerbose, 
  createChildLogger,
  setLogLevel,
  getLogLevel,
  LogMetadata 
} from './logger';

// Export connector infrastructure
export {
  ConnectorAPIServer,
  ConnectorAPIClient,
} from './connector-api';
export type {
  ConnectorConfig,
  ConnectorRecord,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  ConnectorHealthResponse,
  ConnectorDataProvider,
  ConnectorUpdateNotification,
} from './connector-api';

// Export source infrastructure (Plan B option B3 — connector↔source HTTP boundary)
export {
  SourceAPIServer,
  SourceAPIClient,
} from './source-api';
export type {
  SourceConfig,
  SourceHealthResponse,
  SourceDataProvider,
} from './source-api';

// Export SQLite-backed server-side adapter (the default SourceDataProvider impl)
export {
  createSqliteSourceProvider,
} from './sqlite-source-adapter';

// Export unified connector types
export type {
  AccessMode,
  GCUIDRecord,
  ConnectorHealth,
  ConnectorQuery,
  BaseConnector,
  DynamicPullConnector,
  ScheduledPullConnector,
  PushCacheConnector,
  GCUIDConnector,
} from './connector';

// Export push client
export { PushConnectorClient } from './push-client';
export type { PushConnectorClientConfig, IngestRecord, IngestResult } from './push-client';

/**
 * Valid entity types for GCUID
 */
export enum EntityType {
  PERSON = 'person',
  ORG = 'org',
  ASSET = 'asset',
  APP = 'app',
  AGENT = 'agent'
}

/**
 * Core identifier types
 */
export enum CoreIdType {
  ULID = 'ulid',
  UUID = 'uuid'
}

/**
 * GCUID format versions.
 *
 * Use `V2_CURRENT` for new identifiers; `V1_LEGACY` only exists for
 * backward compatibility with previously-minted GCUIDs.
 */
export enum GCUIDFormatVersion {
  V1_LEGACY = 1,
  V2_CURRENT = 2
}

/**
 * Options for GCUID generation (V1 Legacy)
 */
export interface GCUIDOptions {
  entityType: EntityType | string;
  version?: number;
  coreIdType?: CoreIdType;
  customCore?: string;
  namespace?: string;
}

/**
 * Options for GCUID generation (V2 Current)
 */
export interface GCUIDOptionsV2 {
  coreIdType?: CoreIdType;
  customCore?: string;
  generateAlias?: boolean;
  aliasContext?: string;
}

/**
 * Result of GCUID generation with optional alias
 */
export interface GCUIDGenerationResult {
  gcuid: string;
  alias?: string;
  core: string;
  formatVersion: GCUIDFormatVersion;
}

/**
 * Parsed GCUID components (V1 Legacy)
 */
export interface ParsedGCUIDV1 {
  urn: 'urn';
  namespace: string;
  entityType: string;
  version: number;
  core: string;
  raw: string;
  formatVersion: GCUIDFormatVersion.V1_LEGACY;
}

/**
 * Parsed GCUID components (V2 Current)
 */
export interface ParsedGCUIDV2 {
  urn: 'urn';
  namespace: 'gcuid';
  core: string;
  raw: string;
  formatVersion: GCUIDFormatVersion.V2_CURRENT;
}

/**
 * Parsed GCUID components (union type for both versions)
 */
export type ParsedGCUID = ParsedGCUIDV1 | ParsedGCUIDV2;

/**
 * Identity record with GCUID (V1 Legacy)
 */
export interface Identity {
  gcuid: string;
  entityType: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Identity record with GCUID (V2 Current)
 */
export interface IdentityV2 {
  gcuid: string;
  alias?: string;
  entityType?: string;
  createdAt: Date;
  updatedAt: Date;
  formatVersion: GCUIDFormatVersion;
  metadata?: Record<string, any>;
}

// Import local modules
import { uuidToCrockford as convertUuidToCrockford, ulidToCrockford as convertUlidToCrockford, isValidGCUIDCore } from './crockford-base32';
import { generateAlias as createAlias, validateAlias as checkAlias } from './alias';

/**
 * Regex pattern matching a valid V2 GCUID:
 *   `urn:gcuid:{26-char Crockford Base32 core}`
 */
export const GCUID_V2_REGEX = /^urn:gcuid:[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Regex pattern matching a valid V1 GCUID:
 *   `urn:{namespace}:{entity-type}:{version}:{26-char core}`
 */
export const GCUID_V1_REGEX = /^urn:[a-z0-9]+:[a-z]+:\d+:[0-9A-Z]{26}$/;

/**
 * Convert UUID v4 to base32-like 26 character string (Legacy - use uuidToCrockford instead)
 * @deprecated Use uuidToCrockford from crockford-base32 module
 */
function uuidToBase32(uuid: string): string {
  return convertUuidToCrockford(uuid);
}

/*!
 * GCUID Generator and Manager.
 *
 * The `GCUIDManager` class bundles identifier generation, parsing,
 * validation, and conversion between the V1 (legacy) and V2 (current)
 * GCUID formats. Use {@link generateV2} for new identifiers;
 * {@link generate} and the `parseV1`/`parse` methods remain for
 * compatibility with previously-minted V1 records.
 */
export class GCUIDManager {
  private static readonly DEFAULT_NAMESPACE = 'gcuid';
  private static readonly DEFAULT_VERSION = 1;
  private static readonly CORE_LENGTH = 26;
  
  private registeredEntityTypes: Set<string>;
  private namespace: string;

  /**
   * Construct a GCUID manager.
   *
   * The default namespace is `"gcuid"`. The default version is `1`
   * (used only by the legacy V1 generator). The constructor seeds
   * the entity-type registry with the built-in `EntityType` enum
   * values; call `registerEntityType()` to add custom types.
   *
   * @param namespace URN namespace for V1 identifiers. Must match `^[a-z0-9]+$`.
   * @throws Error if `namespace` is empty or contains disallowed characters.
   */
  constructor(namespace: string = GCUIDManager.DEFAULT_NAMESPACE) {
    // Initialize with default entity types
    this.registeredEntityTypes = new Set(Object.values(EntityType));
    
    // Validate and set namespace
    if (!namespace || namespace.trim() === '') {
      throw new Error('Namespace cannot be empty');
    }
    
    if (!/^[a-z0-9]+$/.test(namespace)) {
      throw new Error('Namespace must contain only lowercase letters and numbers');
    }
    
    this.namespace = namespace;
  }

  /**
   * Get the current namespace
   */
  getNamespace(): string {
    return this.namespace;
  }

  /**
   * Get the URN prefix for this manager
   */
  getUrnPrefix(): string {
    return `urn:${this.namespace}`;
  }

  /**
   * Register a new custom entity type
   */
  registerEntityType(entityType: string): void {
    if (!entityType || entityType.trim() === '') {
      throw new Error('Entity type cannot be empty');
    }
    
    if (!/^[a-z]+$/.test(entityType)) {
      throw new Error('Entity type must contain only lowercase letters');
    }
    
    this.registeredEntityTypes.add(entityType);
  }

  /**
   * Check if an entity type is registered
   */
  isEntityTypeRegistered(entityType: string): boolean {
    return this.registeredEntityTypes.has(entityType);
  }

  /**
   * Get all registered entity types
   */
  getRegisteredEntityTypes(): string[] {
    return Array.from(this.registeredEntityTypes).sort();
  }

  /**
   * Generate a new GCUID V1 (Legacy format)
   * Format: urn:{namespace}:uid:{entity-type}:{version}:{core}
   * @deprecated Use generateV2() for new implementations
   */
  generateV1(options: GCUIDOptions): string {
    return this.generate(options);
  }

  /**
   * Generate a new GCUID V2 (Current format)
   * Format: urn:gcuid:{core}
   * 
   * @param options Generation options
   * @returns GCUID string or generation result with alias
   */
  generateV2(options: GCUIDOptionsV2 = {}): string | GCUIDGenerationResult {
    const { 
      coreIdType = CoreIdType.ULID, 
      customCore,
      generateAlias: genAlias = false,
      aliasContext = 'A'
    } = options;

    let core: string;
    
    if (customCore !== undefined) {
      // Validate custom core (including empty string check)
      if (customCore === '' || !isValidGCUIDCore(customCore)) {
        throw new Error('Custom core must be 26-character Crockford Base32');
      }
      core = customCore.toUpperCase();
    } else {
      // Generate core based on type
      switch (coreIdType) {
        case CoreIdType.ULID:
          core = convertUlidToCrockford(ulid());
          break;
        case CoreIdType.UUID:
          core = convertUuidToCrockford(uuidv4());
          break;
        default:
          throw new Error(`Unknown core ID type: ${coreIdType}`);
      }
    }

    const gcuid = `urn:gcuid:${core}`;
    
    if (genAlias) {
      const alias = createAlias(core, { context: aliasContext });
      return {
        gcuid,
        alias,
        core,
        formatVersion: GCUIDFormatVersion.V2_CURRENT
      };
    }
    
    return gcuid;
  }

  /**
   * Generate a new GCUID in V1 (Legacy) format.
   *
   * Format: `urn:{namespace}:{entity-type}:{version}:{core}`
   *
   * @param options Generation options (entity type, version, core source, namespace).
   * @returns The full V1 GCUID string.
   * @throws Error if `entityType` is unregistered, `version` is not a positive integer, or `customCore` is malformed.
   * @deprecated Use `generateV2` for new identifiers; this method remains for compatibility with V1 records.
   */
  generate(options: GCUIDOptions): string {
    const { 
      entityType, 
      version = GCUIDManager.DEFAULT_VERSION, 
      coreIdType = CoreIdType.ULID, 
      customCore,
      namespace = this.namespace 
    } = options;

    // Validate namespace if provided in options
    if (namespace !== this.namespace) {
      if (!namespace || namespace.trim() === '') {
        throw new Error('Namespace cannot be empty');
      }
      if (!/^[a-z0-9]+$/.test(namespace)) {
        throw new Error('Namespace must contain only lowercase letters and numbers');
      }
    }

    // Validate entity type
    if (!this.isEntityTypeRegistered(entityType)) {
      throw new Error(`Entity type '${entityType}' is not registered. Available types: ${this.getRegisteredEntityTypes().join(', ')}`);
    }

    // Validate version
    if (version < 1 || !Number.isInteger(version)) {
      throw new Error('Version must be a positive integer');
    }

    // Generate or validate core identifier
    let core: string;
    
    if (customCore) {
      // Validate custom core
      if (customCore.length !== GCUIDManager.CORE_LENGTH) {
        throw new Error(`Core identifier must be exactly ${GCUIDManager.CORE_LENGTH} characters`);
      }
      if (!/^[0-9A-Z]+$/.test(customCore)) {
        throw new Error('Core identifier must contain only uppercase alphanumeric characters (base32)');
      }
      core = customCore;
    } else {
      // Generate core based on type
      switch (coreIdType) {
        case CoreIdType.ULID:
          core = ulid();
          break;
        case CoreIdType.UUID:
          core = uuidToBase32(uuidv4());
          break;
        default:
          throw new Error(`Unknown core ID type: ${coreIdType}`);
      }
    }

    // Construct GCUID URN
    return `urn:${namespace}:${entityType}:${version}:${core}`;
  }

  /**
   * Parse a GCUID string into its components (auto-detects version)
   * 
   * @param gcuid GCUID string to parse
   * @returns Parsed GCUID components
   */
  parse(gcuid: string): ParsedGCUID {
    if (!gcuid || typeof gcuid !== 'string') {
      throw new Error('GCUID must be a non-empty string');
    }

    // Auto-detect format version
    if (GCUID_V2_REGEX.test(gcuid)) {
      return this.parseV2(gcuid);
    } else if (GCUID_V1_REGEX.test(gcuid)) {
      return this.parseV1(gcuid);
    } else {
      throw new Error('Unknown or invalid GCUID format');
    }
  }

  /**
   * Parse a GCUID V1 string into its components (Legacy format)
   * Format: urn:{namespace}:uid:{entity-type}:{version}:{core}
   * 
   * @param gcuid GCUID V1 string to parse
   * @returns Parsed GCUID V1 components
   */
  parseV1(gcuid: string): ParsedGCUIDV1 {
    if (!gcuid || typeof gcuid !== 'string') {
      throw new Error('GCUID must be a non-empty string');
    }

    const parts = gcuid.split(':');
    
    if (parts.length !== 5) {
      throw new Error(`Invalid GCUID format. Expected: urn:{namespace}:{entity-type}:{version}:{core}`);
    }

    const [urn, namespace, entityType, versionStr, core] = parts;

    // Validate URN structure
    if (urn !== 'urn') {
      throw new Error(`Invalid GCUID prefix. Expected: urn:{namespace}`);
    }

    // Validate namespace format
    if (!namespace || !/^[a-z0-9]+$/.test(namespace)) {
      throw new Error('Invalid namespace. Must contain only lowercase letters and numbers');
    }

    // Validate version
    const version = parseInt(versionStr, 10);
    if (isNaN(version) || version < 1) {
      throw new Error('Invalid version number');
    }

    // Validate core
    if (core.length !== GCUIDManager.CORE_LENGTH) {
      throw new Error(`Core identifier must be exactly ${GCUIDManager.CORE_LENGTH} characters`);
    }

    return {
      urn: 'urn',
      namespace,
      entityType,
      version,
      core,
      raw: gcuid,
      formatVersion: GCUIDFormatVersion.V1_LEGACY
    };
  }

  /**
   * Parse a GCUID V2 string into its components (Current format)
   * Format: urn:gcuid:{core}
   * 
   * @param gcuid GCUID V2 string to parse
   * @returns Parsed GCUID V2 components
   */
  parseV2(gcuid: string): ParsedGCUIDV2 {
    if (!gcuid || typeof gcuid !== 'string') {
      throw new Error('GCUID must be a non-empty string');
    }

    const match = gcuid.match(GCUID_V2_REGEX);
    
    if (!match) {
      throw new Error('Invalid V2 GCUID format. Expected: urn:gcuid:{core}');
    }

    const core = gcuid.substring(10); // Extract core after 'urn:gcuid:' prefix (10 chars)

    return {
      urn: 'urn',
      namespace: 'gcuid',
      core,
      raw: gcuid,
      formatVersion: GCUIDFormatVersion.V2_CURRENT
    };
  }

  /**
   * Detect the format version of a GCUID
   * 
   * @param gcuid GCUID string
   * @returns Format version
   */
  getFormatVersion(gcuid: string): GCUIDFormatVersion {
    if (GCUID_V2_REGEX.test(gcuid)) {
      return GCUIDFormatVersion.V2_CURRENT;
    } else if (GCUID_V1_REGEX.test(gcuid)) {
      return GCUIDFormatVersion.V1_LEGACY;
    } else {
      throw new Error('Unknown or invalid GCUID format');
    }
  }

  /**
   * Convert V1 GCUID to V2 format
   * Preserves the core identifier
   * 
   * @param v1Gcuid V1 GCUID string (or V2 GCUID, which will be returned as-is)
   * @param generateAlias Whether to generate an alias
   * @returns Conversion result
   */
  convertToV2(v1Gcuid: string, generateAlias: boolean = false): {
    gcuid: string;
    entityType: string;
    alias?: string;
    core: string;
  } {
    // Check if already V2 format
    if (this.getFormatVersion(v1Gcuid) === GCUIDFormatVersion.V2_CURRENT) {
      const parsed = this.parseV2(v1Gcuid);
      const result: any = {
        gcuid: v1Gcuid,
        entityType: '', // V2 doesn't encode entity type
        core: parsed.core
      };
      
      if (generateAlias) {
        result.alias = createAlias(parsed.core);
      }
      
      return result;
    }
    
    // Convert V1 to V2
    const parsed = this.parseV1(v1Gcuid);
    const v2Gcuid = `urn:gcuid:${parsed.core}`;
    
    const result: any = {
      gcuid: v2Gcuid,
      entityType: parsed.entityType,
      core: parsed.core
    };
    
    if (generateAlias) {
      result.alias = createAlias(parsed.core);
    }
    
    return result;
  }

  /**
   * Validate a GCUID string (supports both V1 and V2)
   * 
   * @param gcuid GCUID string to validate
   * @param options Validation options
   * @returns True if valid
   */
  validate(gcuid: string, options?: { strictEntityType?: boolean }): boolean {
    try {
      const parsed = this.parse(gcuid);
      
      // For V1, optionally validate entity type is registered
      if ('entityType' in parsed && options?.strictEntityType) {
        if (!this.isEntityTypeRegistered(parsed.entityType)) {
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate an alias for an existing GCUID
   * 
   * @param gcuid GCUID string (V1 or V2)
   * @param context Alias context code (default: 'A')
   * @returns Generated alias
   */
  generateAliasForGCUID(gcuid: string, context: string = 'A'): string {
    const parsed = this.parse(gcuid);
    return createAlias(parsed.core, { context });
  }

  /**
   * Validate an alias
   * 
   * @param alias Alias string to validate
   * @returns True if valid (correct format and checksum)
   */
  validateAlias(alias: string): boolean {
    return checkAlias(alias);
  }

  /**
   * Get the core identifier from a GCUID (V1 or V2)
   * 
   * @param gcuid GCUID string
   * @returns Core identifier
   */
  getCore(gcuid: string): string {
    const parsed = this.parse(gcuid);
    return parsed.core;
  }

  /**
   * Extract entity type from a GCUID (V1 only)
   * For V2, this returns undefined as entity type is stored in metadata
   * 
   * @param gcuid GCUID string
   * @returns Entity type or undefined
   */
  getEntityType(gcuid: string): string | undefined {
    const parsed = this.parse(gcuid);
    return 'entityType' in parsed ? parsed.entityType : undefined;
  }

  /**
   * Extract version from a GCUID (V1 only)
   * For V2, this returns undefined as version is not in URN
   * 
   * @param gcuid GCUID string
   * @returns Version number or undefined
   */
  getVersion(gcuid: string): number | undefined {
    const parsed = this.parse(gcuid);
    return 'version' in parsed ? parsed.version : undefined;
  }

  /**
   * Create a new identity with a GCUID (V1 format - Legacy)
   * @deprecated Use createIdentityV2() for new implementations
   */
  createIdentity(options: GCUIDOptions & { metadata?: Record<string, any> }): Identity {
    const { metadata, ...gcuidOptions } = options;
    const gcuid = this.generate(gcuidOptions);
    const now = new Date();

    return {
      gcuid,
      entityType: options.entityType,
      createdAt: now,
      updatedAt: now,
      metadata
    };
  }

  /**
   * Create a new identity with a GCUID (V2 format - Current)
   * 
   * @param options Creation options
   * @returns Identity V2 record
   */
  createIdentityV2(options: GCUIDOptionsV2 & { 
    entityType?: string;
    metadata?: Record<string, any>;
  }): IdentityV2 {
    const { entityType, metadata, ...gcuidOptions } = options;
    const result = this.generateV2(gcuidOptions);
    const now = new Date();

    if (typeof result === 'string') {
      return {
        gcuid: result,
        entityType,
        createdAt: now,
        updatedAt: now,
        formatVersion: GCUIDFormatVersion.V2_CURRENT,
        metadata
      };
    } else {
      return {
        gcuid: result.gcuid,
        alias: result.alias,
        entityType,
        createdAt: now,
        updatedAt: now,
        formatVersion: GCUIDFormatVersion.V2_CURRENT,
        metadata
      };
    }
  }

  /**
   * Compare two GCUIDs for equality
   */
  equals(gcuid1: string, gcuid2: string): boolean {
    return gcuid1 === gcuid2;
  }
}

/**
 * Default `GCUIDManager` instance preconfigured with the `"gcuid"` namespace.
 * Convenient for callers who don't need a custom namespace.
 */
export const gcuidManager = new GCUIDManager();

/**
 * Type alias kept for backward compatibility with code that imported the
 * V1 `Identity` shape under the shorter `GCUID` name.
 */
export type GCUID = Identity;

/**
 * Default export is the manager class itself. Use `gcuidManager`
 * (above) for a ready-made instance, or `new GCUIDManager(...)` if
 * a custom namespace is required.
 */
export default GCUIDManager;

// Export registry
export { IdentityRegistry } from './registry';
export type { RegistryEntry, RegistryQuery, RegistryStats } from './registry';

// Export identity orchestration
export { 
  IdentityOrchestrator,
  CreateIdentityOptions as OrchestratorCreateOptions,
  IdentityCreationResult,
  DuplicateDetectionResult,
  DuplicateMatch
} from './identity-orchestration';

// Export authoritative source system
export {
  AuthoritativeSourceSchema,
  AttributeDefinition,
  SourceIdentityRecord,
  SourceQuery,
  SourceSearchResult,
  AuthoritativeSourceConfig,
  AuthoritativeSourceAdapter,
  MockAuthoritativeSourceAdapter,
  AuthoritativeSourceManager,
  createMockHRSource,
  createMockLDAPSource
} from './authoritative-source';

// Export matching configuration and profiles
export {
  AttributeMatchingStrategy,
  SourceMatchingProfile,
  GlobalMatchingHeuristics,
  DEFAULT_MATCHING_PROFILES,
  DEFAULT_GLOBAL_HEURISTICS,
  getMatchingProfile
} from './matching-config';

// Export data normalization
export {
  NormalizedRecord,
  Normalizer,
  EmailNormalizer,
  NameNormalizer,
  PhoneNormalizer,
  DateNormalizer,
  AddressNormalizer,
  IdentifierNormalizer,
  NormalizerRegistry,
  RecordNormalizer,
  normalizerRegistry,
  recordNormalizer
} from './data-normalization';

// Export fuzzy matching
export {
  MatchResult,
  StringSimilarity,
  CentralizedMatcher,
  centralizedMatcher
} from './fuzzy-matching';

// Export enhanced matching engine
export {
  EnhancedMatchResult,
  EnhancedMatchingEngine,
  enhancedMatchingEngine
} from './enhanced-matching-engine';
