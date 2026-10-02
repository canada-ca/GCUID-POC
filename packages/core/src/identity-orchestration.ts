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
 * Identity Orchestration
 * Coordinates the complete identity creation workflow:
 * 1. Duplicate detection in 3rd party repositories
 * 2. GCUID creation and binding
 * 3. Identity entity creation and activation
 */

import { GCUIDManager, Identity, EntityType } from './index';
import { IdentityRegistry } from './registry';
import { IdentityEntityRegistry } from './identity-registry';
import { IdentityTransition } from './identity-state-machine';
import { logger, logInfo, logError, logDebug, logWarn } from './logger';
import {
  AuthoritativeSourceManager,
  SourceQuery,
  SourceIdentityRecord
} from './authoritative-source';

/**
 * Result of duplicate detection
 */
export interface DuplicateDetectionResult {
  hasDuplicates: boolean;
  matches: DuplicateMatch[];
  confidence: 'low' | 'medium' | 'high';
}

/**
 * A potential duplicate match
 */
export interface DuplicateMatch {
  source: string;  // e.g., "HR System", "Active Directory", "External DB"
  identifier: string;  // The identifier in that system
  matchedAttributes: string[];  // Which attributes matched
  confidence: number;  // 0-1 confidence score
  metadata?: Record<string, any>;
}

/**
 * Options for creating an identity with full orchestration
 */
export interface CreateIdentityOptions {
  entityType: EntityType;
  name?: string;
  email?: string;
  metadata?: Record<string, any>;
  reason?: string;
  skipDuplicateCheck?: boolean;  // For testing/manual overrides
  forceManualReview?: boolean;  // Force manual review even if auto-approval criteria met
}

/**
 * Result of identity creation orchestration
 */
export interface IdentityCreationResult {
  gcuid: string;
  identity: any;  // Identity entity
  registryEntry: any;  // GCUID registry entry
  requiresManualReview: boolean;
  duplicateCheckPerformed: boolean;
  duplicateDetectionResult?: DuplicateDetectionResult;
  autoApproved: boolean;
  warnings: string[];
}

/**
 * Orchestrates complete identity lifecycle operations
 */
export class IdentityOrchestrator {
  private gcuidManager: GCUIDManager;
  private gcuidRegistry: IdentityRegistry;
  private identityRegistry: IdentityEntityRegistry;
  private sourceManager?: AuthoritativeSourceManager;

  constructor(
    gcuidRegistry: IdentityRegistry,
    identityRegistry: IdentityEntityRegistry,
    gcuidManager?: GCUIDManager,
    sourceManager?: AuthoritativeSourceManager
  ) {
    this.gcuidRegistry = gcuidRegistry;
    this.identityRegistry = identityRegistry;
    this.gcuidManager = gcuidManager || new GCUIDManager();
    this.sourceManager = sourceManager;
  }

  /**
   * Create a new identity with full workflow orchestration
   * 
   * Workflow:
   * 1. Capture identity information and check for duplicates
   * 2. Create and bind GCUID if no duplicates found
   * 3. Create identity entity and transition to appropriate state
   */
  async createIdentity(options: CreateIdentityOptions): Promise<IdentityCreationResult> {
    const warnings: string[] = [];
    let duplicateDetectionResult: DuplicateDetectionResult | undefined;
    
    logInfo('Starting identity creation orchestration', {
      entityType: options.entityType,
      name: options.name,
      email: options.email
    });

    // STEP 1: Duplicate Detection
    const duplicateCheckPerformed = !options.skipDuplicateCheck;
    if (duplicateCheckPerformed) {
      logDebug('Performing duplicate detection');
      duplicateDetectionResult = await this.detectDuplicates({
        name: options.name,
        email: options.email,
        metadata: options.metadata
      });

      if (duplicateDetectionResult.hasDuplicates) {
        logWarn('Potential duplicates detected', {
          matchCount: duplicateDetectionResult.matches.length,
          confidence: duplicateDetectionResult.confidence
        });

        // If high confidence duplicates found, reject creation
        if (duplicateDetectionResult.confidence === 'high') {
          throw new Error(
            `High confidence duplicate detected. Found ${duplicateDetectionResult.matches.length} matching records. ` +
            `Manual review required before creating new identity.`
          );
        }

        // Medium/low confidence - flag for review
        if (duplicateDetectionResult.confidence === 'medium') {
          warnings.push(
            `Medium confidence duplicates detected (${duplicateDetectionResult.matches.length} matches). ` +
            `Identity will require manual review.`
          );
        } else {
          warnings.push(
            `Low confidence potential duplicates detected (${duplicateDetectionResult.matches.length} matches). ` +
            `Proceeding with creation.`
          );
        }
      } else {
        logDebug('No duplicates detected');
      }
    } else {
      logWarn('Duplicate detection skipped', { reason: 'skipDuplicateCheck=true' });
      warnings.push('Duplicate detection was skipped');
    }

    // STEP 2: Create and bind GCUID
    logDebug('Creating GCUID', { entityType: options.entityType });
    
    // Generate new GCUID
    const identity: Identity = this.gcuidManager.createIdentity({
      entityType: options.entityType,
      metadata: options.metadata
    });

    logInfo('GCUID created', { gcuid: identity.gcuid });

    // Register GCUID in registry (starts in RESERVED state)
    const registryEntry = this.gcuidRegistry.register(
      identity,
      options.reason || 'Identity creation workflow'
    );

    logDebug('GCUID registered in reserved state', { gcuid: identity.gcuid, state: registryEntry.state });

    // STEP 3: Determine if manual review is needed
    const requiresManualReview = this.shouldRequireManualReview({
      duplicateDetectionResult,
      forceManualReview: options.forceManualReview,
      metadata: options.metadata
    });

    logDebug('Manual review determination', { requiresManualReview });

    // STEP 4: Create Identity entity
    const identityMetadata = {
      ...options.metadata,
      name: options.name,
      email: options.email
    };

    const identityEntity = this.identityRegistry.createIdentity({
      gcuid: identity.gcuid,
      metadata: identityMetadata,
      reason: options.reason || 'Identity creation workflow'
    });

    logInfo('Identity entity created', {
      gcuid: identity.gcuid,
      state: identityEntity.state
    });

    // STEP 5: Bind GCUID and transition identity to appropriate state
    let autoApproved = false;

    if (!requiresManualReview) {
      // Auto-approval path: GCUID reserved->issued, Identity provisional->active
      logDebug('Auto-approval path: binding GCUID and activating identity');

      // Bind GCUID (reserved -> issued)
      const bound = this.gcuidRegistry.bind(
        identity.gcuid,
        'Auto-approved: No manual review required'
      );

      if (!bound) {
        throw new Error('Failed to bind GCUID');
      }

      logInfo('GCUID bound (issued)', { gcuid: identity.gcuid });

      // Transition identity to active (provisional -> active)
      this.identityRegistry.transitionIdentity({
        gcuid: identity.gcuid,
        transition: IdentityTransition.PROOFED,
        reason: 'Auto-approved: Identity verified and activated'
      });

      logInfo('Identity activated', { gcuid: identity.gcuid });
      autoApproved = true;

    } else {
      // Manual review path: GCUID stays reserved, Identity goes to under_review
      logDebug('Manual review path: identity requires correlation');

      // Transition identity to under_review (provisional -> under_review)
      this.identityRegistry.transitionIdentity({
        gcuid: identity.gcuid,
        transition: IdentityTransition.CORRELATION,
        reason: duplicateDetectionResult
          ? `Manual review required: ${duplicateDetectionResult.confidence} confidence duplicates detected`
          : 'Manual review required per policy'
      });

      logInfo('Identity submitted for review', { gcuid: identity.gcuid });
      warnings.push('Identity requires manual review before activation');
    }

    // Get final states
    const finalRegistryEntry = this.gcuidRegistry.get(identity.gcuid);
    const finalIdentityEntity = this.identityRegistry.getIdentity(identity.gcuid);

    logInfo('Identity creation complete', {
      gcuid: identity.gcuid,
      gcuidState: finalRegistryEntry?.state,
      identityState: finalIdentityEntity?.state,
      autoApproved,
      requiresManualReview
    });

    return {
      gcuid: identity.gcuid,
      identity: finalIdentityEntity,
      registryEntry: finalRegistryEntry,
      requiresManualReview,
      duplicateCheckPerformed,
      duplicateDetectionResult,
      autoApproved,
      warnings
    };
  }

  /**
   * Approve an identity that's under review
   * Transitions: Identity under_review->active, GCUID reserved->issued
   */
  async approveIdentity(gcuid: string, reason?: string): Promise<void> {
    logInfo('Approving identity', { gcuid });

    const identityEntity = this.identityRegistry.getIdentity(gcuid);
    if (!identityEntity) {
      throw new Error(`Identity not found: ${gcuid}`);
    }

    if (identityEntity.state !== 'under_review') {
      throw new Error(
        `Identity is in ${identityEntity.state} state. Can only approve identities in under_review state.`
      );
    }

    // Transition identity to active
    this.identityRegistry.transitionIdentity({
      gcuid,
      transition: IdentityTransition.CLEAR,
      reason: reason || 'Manual review approved'
    });

    // Bind GCUID (reserved -> issued)
    const registryEntry = this.gcuidRegistry.get(gcuid);
    if (registryEntry && registryEntry.state === 'reserved') {
      this.gcuidRegistry.bind(gcuid, reason || 'Identity approved');
      logInfo('GCUID bound after approval', { gcuid });
    }

    logInfo('Identity approved and activated', { gcuid });
  }

  /**
   * Reject an identity that's under review
   * Marks GCUID as error (reserved->nullified) and potentially suspends identity
   */
  async rejectIdentity(gcuid: string, reason: string): Promise<void> {
    logInfo('Rejecting identity', { gcuid, reason });

    const identityEntity = this.identityRegistry.getIdentity(gcuid);
    if (!identityEntity) {
      throw new Error(`Identity not found: ${gcuid}`);
    }

    if (identityEntity.state !== 'under_review') {
      throw new Error(
        `Identity is in ${identityEntity.state} state. Can only reject identities in under_review state.`
      );
    }

    // Transition identity to suspended (under_review -> suspended)
    this.identityRegistry.transitionIdentity({
      gcuid,
      transition: IdentityTransition.DEEPER_INVESTIGATION,
      reason
    });

    // Mark GCUID as error (reserved -> nullified)
    const registryEntry = this.gcuidRegistry.get(gcuid);
    if (registryEntry && registryEntry.state === 'reserved') {
      this.gcuidRegistry.markError(gcuid, `Identity rejected: ${reason}`);
      logInfo('GCUID nullified after rejection', { gcuid });
    }

    logInfo('Identity rejected and suspended', { gcuid });
  }

  /**
   * Detect duplicates in authoritative sources
   * Uses Authoritative Source Manager if available, otherwise falls back to stub
   */
  private async detectDuplicates(attributes: {
    name?: string;
    email?: string;
    metadata?: Record<string, any>;
  }): Promise<DuplicateDetectionResult> {
    // Use Authoritative Source Manager if configured
    if (this.sourceManager) {
      return await this.detectDuplicatesWithSources(attributes);
    }

    // Fall back to stub implementation
    return await this.detectDuplicatesStub(attributes);
  }

  /**
   * Detect duplicates using Authoritative Source Manager
   */
  private async detectDuplicatesWithSources(attributes: {
    name?: string;
    email?: string;
    metadata?: Record<string, any>;
  }): Promise<DuplicateDetectionResult> {
    logDebug('Detecting duplicates using authoritative sources', {
      email: attributes.email,
      name: attributes.name
    });

    // Build query for source search
    const query: SourceQuery = {
      attributes: {},
      minConfidence: 0.3,  // Include low-confidence matches
      limit: 10
    };

    // Add searchable attributes
    if (attributes.email) {
      query.attributes.email = attributes.email;
      query.attributes.mail = attributes.email;  // LDAP field name
    }

    if (attributes.name) {
      // Try to split name into first/last
      const nameParts = attributes.name.split(' ');
      if (nameParts.length >= 2) {
        query.attributes.firstName = nameParts[0];
        query.attributes.givenName = nameParts[0];  // LDAP field name
        query.attributes.lastName = nameParts[nameParts.length - 1];
        query.attributes.sn = nameParts[nameParts.length - 1];  // LDAP field name
      }
    }

    // Add any other metadata attributes
    if (attributes.metadata) {
      Object.assign(query.attributes, attributes.metadata);
    }

    // Search all sources
    const results = await this.sourceManager!.searchAllConsolidated(query);

    logDebug('Authoritative source search complete', {
      sourcesSearched: results.sourcesSearched,
      resultsFound: results.records.length
    });

    // Convert results to duplicate matches
    const matches: DuplicateMatch[] = results.records.map((record, index) => ({
      source: results.sources[index],
      identifier: record.primaryIdentifier,
      matchedAttributes: this.getMatchedAttributes(query.attributes, record.attributes),
      confidence: results.confidenceScores[index],
      metadata: {
        sourceName: record.sourceName,
        retrievedAt: record.retrievedAt,
        ...record.metadata
      }
    }));

    // Determine overall confidence level
    const maxConfidence = matches.length > 0
      ? Math.max(...matches.map(m => m.confidence))
      : 0;

    const confidence: 'low' | 'medium' | 'high' =
      maxConfidence >= 0.7 ? 'high' :
      maxConfidence >= 0.4 ? 'medium' :
      'low';

    return {
      hasDuplicates: matches.length > 0,
      matches,
      confidence
    };
  }

  /**
   * Helper to determine which attributes matched between query and result
   */
  private getMatchedAttributes(
    queryAttrs: Record<string, any>,
    resultAttrs: Record<string, any>
  ): string[] {
    const matched: string[] = [];

    for (const [key, queryValue] of Object.entries(queryAttrs)) {
      const resultValue = resultAttrs[key];
      
      if (resultValue !== undefined && resultValue !== null) {
        // Simple equality check (could be enhanced with fuzzy matching)
        const queryStr = String(queryValue).toLowerCase();
        const resultStr = String(resultValue).toLowerCase();
        
        if (queryStr === resultStr) {
          matched.push(key);
        }
      }
    }

    return matched;
  }

  /**
   * Stub implementation for duplicate detection (when no sources configured)
   */
  private async detectDuplicatesStub(attributes: {
    name?: string;
    email?: string;
    metadata?: Record<string, any>;
  }): Promise<DuplicateDetectionResult> {
    // Simulate async API call
    await new Promise(resolve => setTimeout(resolve, 100));

    logDebug('Using stub duplicate detection');

    const matches: DuplicateMatch[] = [];
    
    // Simple stub logic: flag if email looks suspicious
    if (attributes.email?.includes('test')) {
      matches.push({
        source: 'Email Validation System',
        identifier: attributes.email,
        matchedAttributes: ['email'],
        confidence: 0.3,
        metadata: {
          note: 'Test email detected'
        }
      });
    }

    // Stub: Random low-confidence match sometimes
    if (attributes.name && Math.random() > 0.8) {
      matches.push({
        source: 'External Identity Provider',
        identifier: 'ext-' + Math.random().toString(36).substr(2, 9),
        matchedAttributes: ['name'],
        confidence: 0.4,
        metadata: {
          note: 'Similar name found in external system'
        }
      });
    }

    const hasDuplicates = matches.length > 0;
    const maxConfidence = matches.length > 0
      ? Math.max(...matches.map(m => m.confidence))
      : 0;

    const confidence: 'low' | 'medium' | 'high' =
      maxConfidence >= 0.7 ? 'high' :
      maxConfidence >= 0.4 ? 'medium' :
      'low';

    return {
      hasDuplicates,
      matches,
      confidence
    };
  }

  /**
   * Determine if manual review is required
   * STUBBED: Uses simple logic for now
   */
  private shouldRequireManualReview(options: {
    duplicateDetectionResult?: DuplicateDetectionResult;
    forceManualReview?: boolean;
    metadata?: Record<string, any>;
  }): boolean {
    // Force manual review if explicitly requested
    if (options.forceManualReview) {
      return true;
    }

    // Require review if medium/high confidence duplicates detected
    if (options.duplicateDetectionResult?.hasDuplicates) {
      if (options.duplicateDetectionResult.confidence === 'medium' ||
          options.duplicateDetectionResult.confidence === 'high') {
        return true;
      }
    }

    // STUB: Additional policy-based review triggers could include:
    // - Certain entity types always require review
    // - High-privilege roles require review
    // - Geographic restrictions
    // - Regulatory requirements
    // - Time-based policies (e.g., after-hours requires review)
    
    // For now: auto-approve if no duplicates or only low-confidence matches
    return false;
  }

  /**
   * Close database connections
   */
  close(): void {
    this.gcuidRegistry.close();
    this.identityRegistry.close();
  }
}
