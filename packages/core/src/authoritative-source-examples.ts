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
 * Authoritative Source Integration Examples
 * 
 * Demonstrates how to:
 * 1. Configure authoritative sources (HR systems, LDAP, etc.)
 * 2. Register sources with the manager
 * 3. Use sources for duplicate detection
 * 4. Integrate with Identity Orchestrator
 * 5. Handle different confidence levels
 */

import { 
  AuthoritativeSourceManager,
  createMockHRSource,
  createMockLDAPSource,
  MockAuthoritativeSourceAdapter,
  SourceQuery,
  AuthoritativeSourceSchema,
  SourceIdentityRecord
} from './authoritative-source';
import { IdentityOrchestrator } from './identity-orchestration';
import { IdentityRegistry } from './registry';
import { IdentityEntityRegistry } from './identity-registry';
import { EntityType, GCUIDManager } from './index';
import { getDbPath } from './config';
import { logger, logInfo, logDebug } from './logger';

/**
 * Example 1: Basic Authoritative Source Setup
 * Create and configure mock HR and LDAP sources
 */
async function example1_BasicSetup() {
  logInfo('=== Example 1: Basic Authoritative Source Setup ===');

  // Create manager
  const sourceManager = new AuthoritativeSourceManager();

  // Create and register HR source
  const hrSource = createMockHRSource();
  await sourceManager.registerSource(hrSource);

  // Create and register LDAP source
  const ldapSource = createMockLDAPSource();
  await sourceManager.registerSource(ldapSource);

  logInfo('Sources registered successfully', {
    hrSource: hrSource.name,
    ldapSource: ldapSource.name
  });

  return { sourceManager, hrSource, ldapSource };
}

/**
 * Example 2: Search Across Sources
 * Query multiple authoritative sources for identity records
 */
async function example2_SearchAcrossSources() {
  logInfo('=== Example 2: Search Across Sources ===');

  const { sourceManager } = await example1_BasicSetup();

  // Search by email
  const query: SourceQuery = {
    attributes: {
      email: 'john.doe@example.com'
    },
    minConfidence: 0.3,
    limit: 10
  };

  const results = await sourceManager.searchAllConsolidated(query);

  logInfo('Search results:', {
    sourcesSearched: results.sourcesSearched,
    totalRecords: results.records.length,
    records: results.records.map((r: SourceIdentityRecord, i: number) => ({
      source: results.sources[i],
      identifier: r.primaryIdentifier,
      confidence: results.confidenceScores[i],
      attributes: r.attributes
    }))
  });

  return results;
}

/**
 * Example 3: Identity Creation with Duplicate Detection
 * Use authoritative sources to detect duplicates during identity creation
 */
async function example3_IdentityCreationWithDuplicates() {
  logInfo('=== Example 3: Identity Creation with Duplicate Detection ===');

  const { sourceManager, hrSource } = await example1_BasicSetup();

  // Add a test record to HR source
  const existingRecord: SourceIdentityRecord = {
    sourceId: 'mock-hr',
    primaryIdentifier: 'E12345',
    sourceName: 'Mock HR System',
    attributes: {
      email: 'jane.smith@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
      employeeId: 'E12345',
      department: 'Engineering'
    },
    retrievedAt: new Date()
  };
  (hrSource as any).records.push(existingRecord);

  // Create orchestrator with source manager
  const gcuidRegistry = new IdentityRegistry();
  const identityRegistry = new IdentityEntityRegistry(getDbPath());
  const gcuidManager = new GCUIDManager();
  const orchestrator = new IdentityOrchestrator(
    gcuidRegistry,
    identityRegistry,
    gcuidManager,
    sourceManager
  );

  // Attempt to create identity with same email (should detect duplicate)
  logInfo('Creating identity with duplicate email...');
  const result1 = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Jane Smith',
    email: 'jane.smith@example.com',
    forceManualReview: false
  });

  logInfo('Creation result:', {
    gcuid: result1.gcuid,
    requiresManualReview: result1.requiresManualReview,
    autoApproved: result1.autoApproved,
    duplicateCheckPerformed: result1.duplicateCheckPerformed,
    duplicateDetectionResult: result1.duplicateDetectionResult
  });

  // Create identity with different email (should succeed)
  logInfo('\nCreating identity with unique email...');
  const result2 = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Bob Johnson',
    email: 'bob.johnson@example.com'
  });

  logInfo('Creation result:', {
    gcuid: result2.gcuid,
    requiresManualReview: result2.requiresManualReview,
    autoApproved: result2.autoApproved,
    duplicateCheckPerformed: result2.duplicateCheckPerformed
  });

  return { result1, result2 };
}

/**
 * Example 4: Custom Authoritative Source
 * Create a custom source adapter for a specific system
 */
async function example4_CustomSource() {
  logInfo('=== Example 4: Custom Authoritative Source ===');

  // Define custom schema for a CRM system
  const customSchema: AuthoritativeSourceSchema = {
    sourceName: 'Custom CRM System',
    primaryIdentifier: 'customerId',
    attributes: [
      {
        fieldName: 'customerId',
        type: 'string',
        required: true,
        matchable: true,
        matchWeight: 1.0,
        isPII: false
      },
      {
        fieldName: 'email',
        type: 'string',
        required: true,
        matchable: true,
        matchWeight: 0.9,
        isPII: true
      },
      {
        fieldName: 'fullName',
        type: 'string',
        required: true,
        matchable: true,
        matchWeight: 0.7,
        isPII: true
      },
      {
        fieldName: 'phone',
        type: 'string',
        required: false,
        matchable: true,
        matchWeight: 0.6,
        isPII: true
      },
      {
        fieldName: 'accountType',
        type: 'string',
        required: true,
        matchable: false,
        matchWeight: 0.0,
        isPII: false
      }
    ],
    secondaryIdentifiers: ['email', 'phone']
  };

  const customSource = new MockAuthoritativeSourceAdapter({
    name: 'Custom CRM System',
    description: 'Company CRM with customer records',
    enabled: true,
    priority: 3,
    schema: customSchema
  });

  // Add sample records via internal property
  const records: SourceIdentityRecord[] = [
    {
      sourceId: 'custom-crm',
      primaryIdentifier: 'CRM-001',
      sourceName: 'Custom CRM System',
      attributes: {
        customerId: 'CRM-001',
        email: 'customer@example.com',
        fullName: 'Alice Customer',
        phone: '+1-555-0123',
        accountType: 'Premium'
      },
      retrievedAt: new Date()
    },
    {
      sourceId: 'custom-crm',
      primaryIdentifier: 'CRM-002',
      sourceName: 'Custom CRM System',
      attributes: {
        customerId: 'CRM-002',
        email: 'support@example.com',
        fullName: 'Support Team',
        phone: '+1-555-0199',
        accountType: 'Internal'
      },
      retrievedAt: new Date()
    }
  ];

  (customSource as any).records = records;

  // Register with manager
  const sourceManager = new AuthoritativeSourceManager();
  await sourceManager.registerSource(customSource);

  // Search the custom source
  const query: SourceQuery = {
    attributes: {
      email: 'customer@example.com'
    },
    minConfidence: 0.3,
    limit: 10
  };

  const results = await sourceManager.searchAllConsolidated(query);

  logInfo('Custom source search results:', {
    totalRecords: results.records.length,
    records: results.records.map((r: SourceIdentityRecord, i: number) => ({
      identifier: r.primaryIdentifier,
      confidence: results.confidenceScores[i],
      attributes: r.attributes
    }))
  });

  return customSource;
}

/**
 * Example 5: Skip Duplicate Check
 * Create identity without checking authoritative sources
 */
async function example5_SkipDuplicateCheck() {
  logInfo('=== Example 5: Skip Duplicate Check ===');

  const { sourceManager } = await example1_BasicSetup();

  const gcuidRegistry = new IdentityRegistry();
  const identityRegistry = new IdentityEntityRegistry(getDbPath());
  const gcuidManager = new GCUIDManager();
  const orchestrator = new IdentityOrchestrator(
    gcuidRegistry,
    identityRegistry,
    gcuidManager,
    sourceManager
  );

  // Create identity with skipDuplicateCheck=true
  const result = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Skip Check User',
    email: 'skip@example.com',
    skipDuplicateCheck: true
  });

  logInfo('Result (no duplicate check):', {
    gcuid: result.gcuid,
    requiresManualReview: result.requiresManualReview,
    autoApproved: result.autoApproved,
    duplicateCheckPerformed: result.duplicateCheckPerformed
  });

  return result;
}

/**
 * Example 6: Fallback to Stub (No Sources Configured)
 * Show behavior when no authoritative sources are configured
 */
async function example6_NoSourcesFallback() {
  logInfo('=== Example 6: Fallback to Stub (No Sources Configured) ===');

  // Create orchestrator WITHOUT source manager
  const gcuidRegistry = new IdentityRegistry();
  const identityRegistry = new IdentityEntityRegistry(getDbPath());
  const gcuidManager = new GCUIDManager();
  const orchestrator = new IdentityOrchestrator(
    gcuidRegistry,
    identityRegistry,
    gcuidManager
    // No sourceManager parameter - will use stub
  );

  // Create identity - should use stub duplicate detection
  const result = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Test User',
    email: 'test@example.com'  // Contains 'test' - stub flags as duplicate
  });

  logInfo('Result (using stub detection):', {
    gcuid: result.gcuid,
    requiresManualReview: result.requiresManualReview,
    autoApproved: result.autoApproved,
    duplicateDetectionResult: result.duplicateDetectionResult,
    note: 'Stub flags emails containing "test" as suspicious'
  });

  return result;
}

/**
 * Run all examples
 */
async function runAllExamples() {
  try {
    await example1_BasicSetup();
    console.log('\n' + '='.repeat(80) + '\n');

    await example2_SearchAcrossSources();
    console.log('\n' + '='.repeat(80) + '\n');

    await example3_IdentityCreationWithDuplicates();
    console.log('\n' + '='.repeat(80) + '\n');

    await example4_CustomSource();
    console.log('\n' + '='.repeat(80) + '\n');

    await example5_SkipDuplicateCheck();
    console.log('\n' + '='.repeat(80) + '\n');

    await example6_NoSourcesFallback();
    console.log('\n' + '='.repeat(80) + '\n');

    logInfo('All examples completed successfully!');
  } catch (error) {
    logger.error('Error running examples:', error);
    throw error;
  }
}

// Export examples
export {
  example1_BasicSetup,
  example2_SearchAcrossSources,
  example3_IdentityCreationWithDuplicates,
  example4_CustomSource,
  example5_SkipDuplicateCheck,
  example6_NoSourcesFallback,
  runAllExamples
};

// Run if executed directly
if (require.main === module) {
  runAllExamples().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}


/**
 * Example 2: Search Across Sources
 * Query multiple authoritative sources for identity records
 */
async function example2_SearchAcrossSources() {
  logInfo('=== Example 2: Search Across Sources ===');

  const { sourceManager } = await example1_BasicSetup();

  // Search by email
  const query: SourceQuery = {
    attributes: {
      email: 'john.doe@example.com'
    },
    minConfidence: 0.3,
    limit: 10
  };

  const results = await sourceManager.searchAllConsolidated(query);

  logInfo('Search results:', {
    sourcesSearched: results.sourcesSearched,
    totalRecords: results.records.length,
    records: results.records.map((r, i) => ({
      source: results.sources[i],
      identifier: r.primaryIdentifier,
      confidence: results.confidenceScores[i],
      attributes: r.attributes
    }))
  });

  return results;
}

/**
 * Example 3: Identity Creation with Duplicate Detection
 * Use authoritative sources to detect duplicates during identity creation
 */
async function example3_IdentityCreationWithDuplicates() {
  logInfo('=== Example 3: Identity Creation with Duplicate Detection ===');

  const { sourceManager, hrSource } = await example1_BasicSetup();

  // Add a test record to HR source
  const existingRecord = {
    primaryIdentifier: 'E12345',
    sourceName: 'Mock HR System',
    attributes: {
      email: 'jane.smith@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
      employeeId: 'E12345',
      department: 'Engineering'
    },
    retrievedAt: new Date()
  };
  (hrSource as MockAuthoritativeSourceAdapter).addRecord(existingRecord);

  // Create orchestrator with source manager
  const gcuidRegistry = new IdentityRegistry();
  const identityRegistry = new IdentityEntityRegistry();
  const orchestrator = new IdentityOrchestrator(
    gcuidRegistry,
    identityRegistry,
    sourceManager  // Pass source manager
  );

  // Attempt to create identity with same email (should detect duplicate)
  logInfo('Creating identity with duplicate email...');
  const result1 = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Jane Smith',
    email: 'jane.smith@example.com',
    requireApproval: false  // Would auto-approve if no duplicates
  });

  logInfo('Creation result:', {
    success: result1.success,
    gcuid: result1.gcuid,
    identityState: result1.identityState,
    requiresApproval: result1.requiresApproval,
    duplicateDetection: result1.duplicateDetection
  });

  // Create identity with different email (should succeed)
  logInfo('\nCreating identity with unique email...');
  const result2 = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Bob Johnson',
    email: 'bob.johnson@example.com',
    requireApproval: false
  });

  logInfo('Creation result:', {
    success: result2.success,
    gcuid: result2.gcuid,
    identityState: result2.identityState,
    requiresApproval: result2.requiresApproval,
    duplicateDetection: result2.duplicateDetection
  });

  return { result1, result2 };
}

/**
 * Example 4: Custom Authoritative Source
 * Create a custom source adapter for a specific system
 */
async function example4_CustomSource() {
  logInfo('=== Example 4: Custom Authoritative Source ===');

  // Define custom schema for a CRM system
  const customSource = new MockAuthoritativeSourceAdapter({
    name: 'Custom CRM System',
    description: 'Company CRM with customer records',
    enabled: true,
    priority: 3,
    schema: {
      primaryIdentifier: 'customerId',
      attributes: [
        {
          name: 'customerId',
          type: 'string',
          required: true,
          matchable: true,
          matchWeight: 1.0,
          isPII: false
        },
        {
          name: 'email',
          type: 'string',
          required: true,
          matchable: true,
          matchWeight: 0.9,
          isPII: true
        },
        {
          name: 'fullName',
          type: 'string',
          required: true,
          matchable: true,
          matchWeight: 0.7,
          isPII: true
        },
        {
          name: 'phone',
          type: 'string',
          required: false,
          matchable: true,
          matchWeight: 0.6,
          isPII: true
        },
        {
          name: 'accountType',
          type: 'string',
          required: true,
          matchable: false,
          matchWeight: 0.0,
          isPII: false
        }
      ],
      secondaryIdentifiers: ['email', 'phone']
    }
  });

  // Add sample records
  customSource.addRecord({
    primaryIdentifier: 'CRM-001',
    sourceName: 'Custom CRM System',
    attributes: {
      customerId: 'CRM-001',
      email: 'customer@example.com',
      fullName: 'Alice Customer',
      phone: '+1-555-0123',
      accountType: 'Premium'
    },
    retrievedAt: new Date()
  });

  customSource.addRecord({
    primaryIdentifier: 'CRM-002',
    sourceName: 'Custom CRM System',
    attributes: {
      customerId: 'CRM-002',
      email: 'support@example.com',
      fullName: 'Support Team',
      phone: '+1-555-0199',
      accountType: 'Internal'
    },
    retrievedAt: new Date()
  });

  // Register with manager
  const sourceManager = new AuthoritativeSourceManager();
  await sourceManager.registerSource(customSource);

  // Search the custom source
  const query: SourceQuery = {
    attributes: {
      email: 'customer@example.com'
    },
    minConfidence: 0.3,
    limit: 10
  };

  const results = await sourceManager.searchAllConsolidated(query);

  logInfo('Custom source search results:', {
    totalRecords: results.records.length,
    records: results.records.map((r, i) => ({
      identifier: r.primaryIdentifier,
      confidence: results.confidenceScores[i],
      attributes: r.attributes
    }))
  });

  return customSource;
}

/**
 * Example 5: Confidence Levels and Manual Review
 * Handle different confidence levels with manual review workflow
 */
async function example5_ConfidenceLevels() {
  logInfo('=== Example 5: Confidence Levels and Manual Review ===');

  const { sourceManager, hrSource } = await example1_BasicSetup();

  // Add records with varying match quality
  const mockHR = hrSource as MockAuthoritativeSourceAdapter;
  
  // Exact match - high confidence
  mockHR.addRecord({
    primaryIdentifier: 'E11111',
    sourceName: 'Mock HR System',
    attributes: {
      email: 'exact.match@example.com',
      firstName: 'Exact',
      lastName: 'Match',
      employeeId: 'E11111'
    },
    retrievedAt: new Date()
  });

  // Partial match - medium confidence
  mockHR.addRecord({
    primaryIdentifier: 'E22222',
    sourceName: 'Mock HR System',
    attributes: {
      email: 'partial@example.com',
      firstName: 'Partial',
      lastName: 'Different',  // Different last name
      employeeId: 'E22222'
    },
    retrievedAt: new Date()
  });

  // Create orchestrator
  const gcuidRegistry = new IdentityRegistry();
  const identityRegistry = new IdentityEntityRegistry();
  const orchestrator = new IdentityOrchestrator(
    gcuidRegistry,
    identityRegistry,
    sourceManager
  );

  // Test exact match (high confidence) - requires manual approval
  logInfo('\nTest 1: Exact match (high confidence)');
  const result1 = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Exact Match',
    email: 'exact.match@example.com',
    requireApproval: false
  });

  logInfo('Result:', {
    gcuid: result1.gcuid,
    identityState: result1.identityState,
    requiresApproval: result1.requiresApproval,
    confidence: result1.duplicateDetection.confidence,
    matches: result1.duplicateDetection.matches.length
  });

  // Test partial match (medium confidence)
  logInfo('\nTest 2: Partial match (medium confidence)');
  const result2 = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Partial Match',
    email: 'partial@example.com',
    requireApproval: false
  });

  logInfo('Result:', {
    gcuid: result2.gcuid,
    identityState: result2.identityState,
    requiresApproval: result2.requiresApproval,
    confidence: result2.duplicateDetection.confidence,
    matches: result2.duplicateDetection.matches.length
  });

  // Test no match (low confidence)
  logInfo('\nTest 3: No match (low confidence)');
  const result3 = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'New Person',
    email: 'new.person@example.com',
    requireApproval: false
  });

  logInfo('Result:', {
    gcuid: result3.gcuid,
    identityState: result3.identityState,
    requiresApproval: result3.requiresApproval,
    confidence: result3.duplicateDetection.confidence,
    matches: result3.duplicateDetection.matches.length
  });

  return { result1, result2, result3 };
}

/**
 * Example 6: Source Priority and Consolidation
 * Demonstrate how multiple sources are prioritized and consolidated
 */
async function example6_SourcePriority() {
  logInfo('=== Example 6: Source Priority and Consolidation ===');

  const sourceManager = new AuthoritativeSourceManager();

  // Create sources with different priorities
  const hrSource = createMockHRSource();  // Priority 1 (highest)
  const ldapSource = createMockLDAPSource();  // Priority 2
  
  // Custom low-priority source
  const legacySource = new MockAuthoritativeSourceAdapter({
    name: 'Legacy Database',
    description: 'Old system being phased out',
    enabled: true,
    priority: 5,  // Lower priority
    schema: {
      primaryIdentifier: 'legacyId',
      attributes: [
        { name: 'legacyId', type: 'string', required: true, matchable: true, matchWeight: 1.0, isPII: false },
        { name: 'email', type: 'string', required: true, matchable: true, matchWeight: 0.9, isPII: true },
        { name: 'name', type: 'string', required: true, matchable: true, matchWeight: 0.7, isPII: true }
      ],
      secondaryIdentifiers: ['email']
    }
  });

  // Register sources (order doesn't matter, priority is in config)
  await sourceManager.registerSource(legacySource);
  await sourceManager.registerSource(hrSource);
  await sourceManager.registerSource(ldapSource);

  // Add same person to all sources
  const email = 'priority.test@example.com';

  (hrSource as MockAuthoritativeSourceAdapter).addRecord({
    primaryIdentifier: 'E99999',
    sourceName: 'Mock HR System',
    attributes: {
      email,
      firstName: 'Priority',
      lastName: 'Test',
      employeeId: 'E99999',
      department: 'HR Data'
    },
    retrievedAt: new Date()
  });

  (ldapSource as MockAuthoritativeSourceAdapter).addRecord({
    primaryIdentifier: 'CN=priority.test',
    sourceName: 'Mock LDAP/AD',
    attributes: {
      mail: email,
      givenName: 'Priority',
      sn: 'Test',
      cn: 'priority.test',
      ou: 'LDAP Data'
    },
    retrievedAt: new Date()
  });

  legacySource.addRecord({
    primaryIdentifier: 'LEG-123',
    sourceName: 'Legacy Database',
    attributes: {
      legacyId: 'LEG-123',
      email,
      name: 'Priority Test',
      notes: 'Legacy Data'
    },
    retrievedAt: new Date()
  });

  // Search across all sources
  const query: SourceQuery = {
    attributes: { email },
    minConfidence: 0.3,
    limit: 10
  };

  const results = await sourceManager.searchAllConsolidated(query);

  logInfo('Consolidated results (ordered by priority):', {
    totalRecords: results.records.length,
    records: results.records.map((r, i) => ({
      source: results.sources[i],
      identifier: r.primaryIdentifier,
      confidence: results.confidenceScores[i],
      priority: sourceManager.getRegisteredSources()
        .find(s => s.name === results.sources[i])?.config.priority
    }))
  });

  return results;
}

/**
 * Example 7: Skip Duplicate Check
 * Create identity without checking authoritative sources
 */
async function example7_SkipDuplicateCheck() {
  logInfo('=== Example 7: Skip Duplicate Check ===');

  const { sourceManager } = await example1_BasicSetup();

  const gcuidRegistry = new IdentityRegistry();
  const identityRegistry = new IdentityEntityRegistry();
  const orchestrator = new IdentityOrchestrator(
    gcuidRegistry,
    identityRegistry,
    sourceManager
  );

  // Create identity with skipDuplicateCheck=true
  const result = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Skip Check User',
    email: 'skip@example.com',
    requireApproval: false,
    skipDuplicateCheck: true  // Skip authoritative source check
  });

  logInfo('Result (no duplicate check):', {
    success: result.success,
    gcuid: result.gcuid,
    identityState: result.identityState,
    duplicateCheckPerformed: result.duplicateDetection.hasDuplicates === false &&
                            result.duplicateDetection.matches.length === 0
  });

  return result;
}

/**
 * Example 8: Fallback to Stub (No Sources Configured)
 * Show behavior when no authoritative sources are configured
 */
async function example8_NoSourcesFallback() {
  logInfo('=== Example 8: Fallback to Stub (No Sources Configured) ===');

  // Create orchestrator WITHOUT source manager
  const gcuidRegistry = new IdentityRegistry();
  const identityRegistry = new IdentityEntityRegistry();
  const orchestrator = new IdentityOrchestrator(
    gcuidRegistry,
    identityRegistry
    // No sourceManager parameter - will use stub
  );

  // Create identity - should use stub duplicate detection
  const result = await orchestrator.createIdentity({
    entityType: EntityType.PERSON,
    name: 'Test User',
    email: 'test@example.com',  // Contains 'test' - stub flags as duplicate
    requireApproval: false
  });

  logInfo('Result (using stub detection):', {
    success: result.success,
    gcuid: result.gcuid,
    identityState: result.identityState,
    requiresApproval: result.requiresApproval,
    duplicateDetection: result.duplicateDetection,
    note: 'Stub flags emails containing "test" as suspicious'
  });

  return result;
}

/**
 * Run all examples
 */
async function runAllExamples() {
  try {
    await example1_BasicSetup();
    console.log('\n' + '='.repeat(80) + '\n');

    await example2_SearchAcrossSources();
    console.log('\n' + '='.repeat(80) + '\n');

    await example3_IdentityCreationWithDuplicates();
    console.log('\n' + '='.repeat(80) + '\n');

    await example4_CustomSource();
    console.log('\n' + '='.repeat(80) + '\n');

    await example5_ConfidenceLevels();
    console.log('\n' + '='.repeat(80) + '\n');

    await example6_SourcePriority();
    console.log('\n' + '='.repeat(80) + '\n');

    await example7_SkipDuplicateCheck();
    console.log('\n' + '='.repeat(80) + '\n');

    await example8_NoSourcesFallback();
    console.log('\n' + '='.repeat(80) + '\n');

    logInfo('All examples completed successfully!');
  } catch (error) {
    logger.error('Error running examples:', error);
    throw error;
  }
}

// Export examples
export {
  example1_BasicSetup,
  example2_SearchAcrossSources,
  example3_IdentityCreationWithDuplicates,
  example4_CustomSource,
  example5_ConfidenceLevels,
  example6_SourcePriority,
  example7_SkipDuplicateCheck,
  example8_NoSourcesFallback,
  runAllExamples
};

// Run if executed directly
if (require.main === module) {
  runAllExamples().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
