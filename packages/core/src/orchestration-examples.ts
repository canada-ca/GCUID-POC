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
 * Orchestrated Identity Creation Examples
 * Demonstrates the complete workflow with duplicate detection, GCUID binding, and state management
 */

import { 
  IdentityOrchestrator,
  IdentityRegistry,
  IdentityEntityRegistry,
  GCUIDManager,
  EntityType
} from './index';
import { join } from 'path';

const dbPath = join(__dirname, '../data/examples-orchestration.db');

// Initialize components
const gcuidManager = new GCUIDManager();
const gcuidRegistry = new IdentityRegistry(dbPath, gcuidManager);
const identityRegistry = new IdentityEntityRegistry(dbPath);
const orchestrator = new IdentityOrchestrator(gcuidRegistry, identityRegistry, gcuidManager);

console.log('='.repeat(80));
console.log('Orchestrated Identity Creation Examples');
console.log('='.repeat(80));

/**
 * Example 1: Auto-Approval Path
 * No duplicates detected, meets auto-approval criteria
 */
async function example1_AutoApproval() {
  console.log('\n📋 Example 1: Auto-Approval Path');
  console.log('-'.repeat(80));

  const result = await orchestrator.createIdentity({
    entityType: 'person' as EntityType,
    name: 'Alice Smith',
    email: 'alice@example.com',
    reason: 'New employee onboarding'
  });

  console.log('\n✅ Creation Result:');
  console.log(`   GCUID: ${result.gcuid}`);
  console.log(`   GCUID State: ${result.registryEntry.state}`);
  console.log(`   Identity State: ${result.identity.state}`);
  console.log(`   Auto-Approved: ${result.autoApproved}`);
  console.log(`   Manual Review: ${result.requiresManualReview}`);
  console.log(`   Duplicate Check: ${result.duplicateCheckPerformed}`);

  if (result.duplicateDetectionResult?.hasDuplicates) {
    console.log(`\n⚠️  Duplicates Found: ${result.duplicateDetectionResult.matches.length}`);
    console.log(`   Confidence: ${result.duplicateDetectionResult.confidence}`);
  }

  console.log('\n📊 Final States:');
  console.log(`   GCUID: reserved → issued (auto-approved)`);
  console.log(`   Identity: provisional → active (PROOFED)`);
  console.log('\n✓ Identity is ACTIVE and ready to use!');
}

/**
 * Example 2: Manual Review Path (Forced)
 * Explicitly requires manual review
 */
async function example2_ManualReview() {
  console.log('\n📋 Example 2: Manual Review Path (Forced)');
  console.log('-'.repeat(80));

  const result = await orchestrator.createIdentity({
    entityType: 'person' as EntityType,
    name: 'Bob Jones',
    email: 'bob@contractor.com',
    forceManualReview: true,
    reason: 'Contractor onboarding - requires approval'
  });

  console.log('\n✅ Creation Result:');
  console.log(`   GCUID: ${result.gcuid}`);
  console.log(`   GCUID State: ${result.registryEntry.state}`);
  console.log(`   Identity State: ${result.identity.state}`);
  console.log(`   Auto-Approved: ${result.autoApproved}`);
  console.log(`   Manual Review: ${result.requiresManualReview}`);

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach(w => console.log(`   • ${w}`));
  }

  console.log('\n📊 Final States:');
  console.log(`   GCUID: reserved (awaiting approval)`);
  console.log(`   Identity: provisional → under_review (CORRELATION)`);
  console.log('\n⏸  Identity requires manual approval before activation');

  return result.gcuid;
}

/**
 * Example 3: Approval Workflow
 * Approve an identity that's under review
 */
async function example3_Approval(gcuid: string) {
  console.log('\n📋 Example 3: Approval Workflow');
  console.log('-'.repeat(80));

  console.log(`\n⏳ Approving identity: ${gcuid}`);
  
  await orchestrator.approveIdentity(
    gcuid,
    'Background check passed, references verified'
  );

  console.log('\n✅ Approval Complete!');

  // Check final states
  const identityEntity = identityRegistry.getIdentity(gcuid);
  const gcuidEntry = gcuidRegistry.get(gcuid);

  console.log('\n📊 Final States:');
  console.log(`   GCUID: ${gcuidEntry?.state}`);
  console.log(`   Identity: ${identityEntity?.state}`);
  console.log('\n✓ Identity is now ACTIVE and ready to use!');
  console.log('✓ GCUID is now ISSUED!');
}

/**
 * Example 4: Rejection Workflow
 * Reject an identity that fails review
 */
async function example4_Rejection() {
  console.log('\n📋 Example 4: Rejection Workflow');
  console.log('-'.repeat(80));

  // Create identity for review
  const result = await orchestrator.createIdentity({
    entityType: 'person' as EntityType,
    name: 'Charlie Brown',
    email: 'charlie@test.com',
    forceManualReview: true,
    reason: 'Contractor onboarding'
  });

  console.log(`\n⏳ Created identity for review: ${result.gcuid}`);
  console.log(`   State: ${result.identity.state}`);

  // Reject it
  console.log('\n❌ Rejecting identity...');
  
  await orchestrator.rejectIdentity(
    result.gcuid,
    'Background check failed - criminal record found'
  );

  // Check final states
  const identityEntity = identityRegistry.getIdentity(result.gcuid);
  const gcuidEntry = gcuidRegistry.get(result.gcuid);

  console.log('\n📊 Final States:');
  console.log(`   GCUID: ${gcuidEntry?.state}`);
  console.log(`   Identity: ${identityEntity?.state}`);
  console.log('\n⚠️  Identity is now SUSPENDED');
  console.log('⚠️  GCUID is now NULLIFIED');
}

/**
 * Example 5: Duplicate Detection (Simulated)
 * Shows handling of potential duplicates
 */
async function example5_DuplicateDetection() {
  console.log('\n📋 Example 5: Duplicate Detection');
  console.log('-'.repeat(80));

  // Email with "test" triggers low-confidence duplicate
  const result = await orchestrator.createIdentity({
    entityType: 'person' as EntityType,
    name: 'Test User',
    email: 'test@example.com',
    reason: 'Testing duplicate detection'
  });

  console.log('\n✅ Creation Result:');
  console.log(`   GCUID: ${result.gcuid}`);
  
  if (result.duplicateDetectionResult?.hasDuplicates) {
    console.log('\n⚠️  Duplicate Detection Results:');
    console.log(`   Duplicates Found: ${result.duplicateDetectionResult.matches.length}`);
    console.log(`   Confidence Level: ${result.duplicateDetectionResult.confidence.toUpperCase()}`);
    
    result.duplicateDetectionResult.matches.forEach((match, i) => {
      console.log(`\n   Match ${i + 1}:`);
      console.log(`     Source: ${match.source}`);
      console.log(`     Identifier: ${match.identifier}`);
      console.log(`     Confidence: ${(match.confidence * 100).toFixed(0)}%`);
      console.log(`     Matched Attributes: ${match.matchedAttributes.join(', ')}`);
    });

    if (result.duplicateDetectionResult.confidence === 'low') {
      console.log('\n✓ Low confidence - proceeding with creation');
    } else if (result.duplicateDetectionResult.confidence === 'medium') {
      console.log('\n⚠️  Medium confidence - manual review required');
    }
  }

  console.log(`\n📊 Final State: ${result.identity.state}`);
  console.log(`   Auto-Approved: ${result.autoApproved}`);
}

/**
 * Example 6: Skip Duplicate Check (Testing/Override)
 * For testing or administrative overrides
 */
async function example6_SkipDuplicateCheck() {
  console.log('\n📋 Example 6: Skip Duplicate Check');
  console.log('-'.repeat(80));

  const result = await orchestrator.createIdentity({
    entityType: 'person' as EntityType,
    name: 'Admin User',
    email: 'admin@system.local',
    skipDuplicateCheck: true,
    reason: 'System account - skip duplicate check'
  });

  console.log('\n✅ Creation Result:');
  console.log(`   GCUID: ${result.gcuid}`);
  console.log(`   Duplicate Check: ${result.duplicateCheckPerformed ? 'PERFORMED' : 'SKIPPED'}`);
  console.log(`   State: ${result.identity.state}`);

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach(w => console.log(`   • ${w}`));
  }
}

/**
 * Example 7: Complete Workflow with History
 * Shows full lifecycle with audit trail
 */
async function example7_CompleteWorkflow() {
  console.log('\n📋 Example 7: Complete Workflow with History');
  console.log('-'.repeat(80));

  // Step 1: Create with manual review
  console.log('\n1️⃣ Creating identity...');
  const result = await orchestrator.createIdentity({
    entityType: 'person' as EntityType,
    name: 'David Wilson',
    email: 'david@company.com',
    forceManualReview: true,
    reason: 'New senior executive'
  });

  console.log(`   ✓ Created: ${result.gcuid}`);
  console.log(`   ✓ State: ${result.identity.state}`);

  // Step 2: Approve
  console.log('\n2️⃣ Approving identity...');
  await orchestrator.approveIdentity(
    result.gcuid,
    'Executive approval completed'
  );

  const approved = identityRegistry.getIdentity(result.gcuid);
  console.log(`   ✓ Approved: ${approved?.state}`);

  // Step 3: Show complete history
  console.log('\n3️⃣ Complete History:');
  const history = identityRegistry.getStateHistory(result.gcuid);
  
  console.log(`\n   Found ${history.length} transitions:\n`);
  history.reverse().forEach((entry, i) => {
    console.log(`   ${i + 1}. ${entry.fromState} → ${entry.toState}`);
    console.log(`      Transition: ${entry.transition}`);
    console.log(`      Reason: ${entry.reason || 'N/A'}`);
    console.log(`      Time: ${entry.timestamp.toISOString()}`);
    console.log();
  });

  // Show GCUID history too
  const gcuidHistory = gcuidRegistry.getStateHistory(result.gcuid);
  console.log(`   GCUID State History (${gcuidHistory.length} transitions):\n`);
  gcuidHistory.reverse().forEach((entry, i) => {
    console.log(`   ${i + 1}. ${entry.oldState || 'initial'} → ${entry.newState}`);
    console.log(`      Reason: ${entry.reason || 'N/A'}`);
    console.log(`      Time: ${entry.changedAt.toISOString()}`);
    console.log();
  });
}

/**
 * Example 8: Statistics and Reporting
 * View system-wide statistics
 */
async function example8_Statistics() {
  console.log('\n📋 Example 8: Statistics and Reporting');
  console.log('-'.repeat(80));

  // Identity entity statistics
  const identityStats = identityRegistry.getStatistics();
  console.log('\n📊 Identity Entity Statistics:');
  console.log(`   Total Identities: ${identityStats.total}`);
  console.log('\n   By State:');
  console.log(`     Provisional: ${identityStats.provisional}`);
  console.log(`     Under Review: ${identityStats.under_review}`);
  console.log(`     Active: ${identityStats.active}`);
  console.log(`     Suspended: ${identityStats.suspended}`);
  console.log(`     Retired: ${identityStats.retired}`);
  console.log(`     Archived: ${identityStats.archived}`);

  // GCUID registry statistics
  const gcuidStats = gcuidRegistry.getStats();
  console.log('\n📊 GCUID Registry Statistics:');
  console.log(`   Total GCUIDs: ${gcuidStats.total}`);
  console.log('\n   By Entity Type:');
  Object.entries(gcuidStats.byEntityType).forEach(([type, count]) => {
    console.log(`     ${type}: ${count}`);
  });
  console.log('\n   By State:');
  Object.entries(gcuidStats.byState).forEach(([state, count]) => {
    console.log(`     ${state}: ${count}`);
  });
}

/**
 * Run all examples
 */
async function runAllExamples() {
  try {
    await example1_AutoApproval();
    
    const pendingGcuid = await example2_ManualReview();
    
    await example3_Approval(pendingGcuid);
    
    await example4_Rejection();
    
    await example5_DuplicateDetection();
    
    await example6_SkipDuplicateCheck();
    
    await example7_CompleteWorkflow();
    
    await example8_Statistics();

    console.log('\n' + '='.repeat(80));
    console.log('✅ All examples completed successfully!');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('\n❌ Error:', (error as Error).message);
    console.error((error as Error).stack);
  } finally {
    orchestrator.close();
  }
}

// Run examples if executed directly
if (require.main === module) {
  runAllExamples();
}

export {
  example1_AutoApproval,
  example2_ManualReview,
  example3_Approval,
  example4_Rejection,
  example5_DuplicateDetection,
  example6_SkipDuplicateCheck,
  example7_CompleteWorkflow,
  example8_Statistics
};
