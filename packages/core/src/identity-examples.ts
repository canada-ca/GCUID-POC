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
 * Identity Entity Examples
 * Demonstrates the Identity entity lifecycle management system
 * 
 * Note: Examples use V2 GCUID format (urn:gcuid:{core}).
 * V1 format (urn:gcuid:{entity-type}:{version}:{core}) is also supported for backward compatibility.
 */

import { 
  IdentityEntityRegistry,
  IdentityEntityState,
  IdentityTransition,
  getValidIdentityTransitions,
  validateIdentityTransition,
  getIdentityStateDescription
} from './index';

/**
 * Example 1: Basic Identity Creation and Activation
 */
export function exampleBasicLifecycle() {
  console.log('\n=== Example 1: Basic Identity Lifecycle ===\n');
  
  const registry = new IdentityEntityRegistry('./data/registry.db');
  const gcuid = 'urn:gcuid:01HQXYZ123ABC456DEF789GHI';
  
  // Create identity (starts in PROVISIONAL state)
  const identity = registry.createIdentity({
    gcuid,
    metadata: {
      name: 'Alice Smith',
      email: 'alice@example.com',
      registrationDate: new Date().toISOString()
    },
    reason: 'New user registration'
  });
  
  console.log(`✓ Identity created: ${identity.gcuid}`);
  console.log(`  State: ${identity.state}`);
  console.log(`  Description: ${getIdentityStateDescription(identity.state)}`);
  
  // Direct activation (proofed)
  const activated = registry.transitionIdentity({
    gcuid,
    transition: IdentityTransition.PROOFED,
    reason: 'Identity proofed and validated',
    metadata: { approvalType: 'automatic' }
  });
  
  console.log(`\n✓ Identity activated: ${activated.state}`);
  console.log(`  Previous state: ${activated.previousState}`);
  
  registry.close();
}

/**
 * Example 2: Approval Workflow
 */
export function exampleApprovalWorkflow() {
  console.log('\n=== Example 2: Approval Workflow ===\n');
  
  const registry = new IdentityEntityRegistry('./data/registry.db');
  const gcuid = 'urn:gcuid:01HQXYZ789DEF012GHI345JKL';
  
  // Create provisional identity
  const identity = registry.createIdentity({
    gcuid,
    metadata: {
      name: 'Bob Johnson',
      email: 'bob@example.com',
      country: 'US'
    },
    reason: 'Registration requiring KYC'
  });
  
  console.log(`✓ Identity created: ${identity.state}`);
  
  // Submit for correlation/review
  const underReview = registry.transitionIdentity({
    gcuid,
    transition: IdentityTransition.CORRELATION,
    reason: 'Email verified, documents uploaded - needs correlation',
    metadata: {
      documents: ['passport', 'utility_bill'],
      verificationId: 'KYC-2024-001'
    }
  });
  
  console.log(`✓ Submitted for review: ${underReview.state}`);
  
  // Show valid transitions
  const validTransitions = getValidIdentityTransitions(underReview.state);
  console.log(`  Valid transitions: ${validTransitions.join(', ')}`);
  
  // Clear (approve)
  const approved = registry.transitionIdentity({
    gcuid,
    transition: IdentityTransition.CLEAR,
    reason: 'Correlation complete - identity cleared',
    metadata: {
      approvedBy: 'admin@example.com',
      verificationScore: 0.98
    }
  });
  
  console.log(`✓ Identity cleared and approved: ${approved.state}`);
  
  // Show state history
  const history = registry.getStateHistory(gcuid);
  console.log(`\n✓ State history (${history.length} entries):`);
  history.forEach(entry => {
    console.log(`  ${entry.timestamp.toISOString()}: ${entry.fromState} → ${entry.toState}`);
    console.log(`    Transition: ${entry.transition}`);
    console.log(`    Reason: ${entry.reason}`);
  });
  
  registry.close();
}

/**
 * Example 3: Suspension and Reinstatement
 */
export function exampleSuspension() {
  console.log('\n=== Example 3: Suspension and Reinstatement ===\n');
  
  const registry = new IdentityEntityRegistry('./data/registry.db');
  const gcuid = 'urn:gcuid:01HQXYZ456GHI789JKL012MNO';
  
  // Create and activate identity
  registry.createIdentity({
    gcuid,
    metadata: { name: 'Charlie Brown', email: 'charlie@example.com' },
    reason: 'User registration'
  });
  
  const active = registry.transitionIdentity({
    gcuid,
    transition: IdentityTransition.PROOFED,
    reason: 'Identity proofed'
  });
  
  console.log(`✓ Identity active: ${active.state}`);
  
  // Suspend due to policy violation
  const suspended = registry.transitionIdentity({
    gcuid,
    transition: IdentityTransition.SUSPEND,
    reason: 'Multiple failed login attempts detected',
    metadata: {
      violationType: 'security',
      failedAttempts: 5,
      suspensionDuration: '24 hours',
      ticketId: 'SEC-2024-042'
    }
  });
  
  console.log(`\n✓ Identity suspended: ${suspended.state}`);
  console.log(`  Reason: ${suspended.metadata?.reason || 'See history'}`);
  
  // Check valid transitions from suspended state
  const validTransitions = registry.getValidTransitions(gcuid);
  console.log(`  Can: ${validTransitions.join(', ')}`);
  
  // Remediation complete - reinstate
  const reinstated = registry.transitionIdentity({
    gcuid,
    transition: IdentityTransition.REMEDIATION_COMPLETE,
    reason: 'Issue resolved - password reset completed',
    metadata: {
      resolvedBy: 'security@example.com',
      resolution: 'Password compromised, user notified'
    }
  });
  
  console.log(`\n✓ Identity reinstated: ${reinstated.state}`);
  
  registry.close();
}

/**
 * Example 4: Retirement and Archival
 */
export function exampleRetirement() {
  console.log('\n=== Example 4: Retirement and Archival ===\n');
  
  const registry = new IdentityEntityRegistry('./data/registry.db');
  const gcuid = 'urn:gcuid:01HQXYZ012MNO345PQR678STU';
  
  // Create and activate
  registry.createIdentity({
    gcuid,
    metadata: { name: 'Diana Prince', email: 'diana@example.com' },
    reason: 'User registration'
  });
  
  registry.transitionIdentity({
    gcuid,
    transition: IdentityTransition.PROOFED,
    reason: 'Identity proofed'
  });
  
  console.log('✓ Identity created and activated');
  
  // User requests account closure - end engagement
  const retired = registry.transitionIdentity({
    gcuid,
    transition: IdentityTransition.END_ENGAGEMENT,
    reason: 'User requested account closure',
    metadata: {
      requestedAt: new Date().toISOString(),
      requestMethod: 'account_settings',
      retentionPeriod: '90 days'
    }
  });
  
  console.log(`\n✓ Identity retired: ${retired.state}`);
  console.log(`  Previous state: ${retired.previousState}`);
  
  // After retention period, archive permanently
  const archived = registry.transitionIdentity({
    gcuid,
    transition: IdentityTransition.RETENTION,
    reason: 'Retention period expired',
    metadata: {
      archivedAt: new Date().toISOString(),
      archivalLocation: 's3://archive/identities/'
    }
  });
  
  console.log(`\n✓ Identity archived: ${archived.state}`);
  console.log('  This is a terminal state - no further transitions allowed');
  
  // Verify no transitions available
  const validTransitions = getValidIdentityTransitions(archived.state);
  console.log(`  Valid transitions: ${validTransitions.length === 0 ? 'none' : validTransitions.join(', ')}`);
  
  registry.close();
}

/**
 * Example 5: Transition Validation
 */
export function exampleValidation() {
  console.log('\n=== Example 5: Transition Validation ===\n');
  
  // Test various transition validations
  const testCases = [
    {
      state: IdentityEntityState.PROVISIONAL,
      transition: IdentityTransition.CORRELATION,
      expected: true
    },
    {
      state: IdentityEntityState.PROVISIONAL,
      transition: IdentityTransition.SUSPEND,
      expected: false
    },
    {
      state: IdentityEntityState.ACTIVE,
      transition: IdentityTransition.END_ENGAGEMENT,
      expected: true
    },
    {
      state: IdentityEntityState.ARCHIVED,
      transition: IdentityTransition.REHIRE,
      expected: false
    }
  ];
  
  testCases.forEach(({ state, transition, expected }) => {
    const result = validateIdentityTransition(state, transition);
    const icon = result.valid === expected ? '✓' : '✗';
    console.log(`${icon} ${state} + ${transition}:`);
    console.log(`  Valid: ${result.valid} (expected: ${expected})`);
    if (result.valid) {
      console.log(`  Next state: ${result.nextState}`);
    } else {
      console.log(`  Error: ${result.error}`);
    }
  });
}

/**
 * Example 6: Bulk Operations and Statistics
 */
export function exampleStatistics() {
  console.log('\n=== Example 6: Statistics and Bulk Operations ===\n');
  
  const registry = new IdentityEntityRegistry('./data/registry.db');
  
  // Create multiple identities in different states
  const identities = [
    { gcuid: 'urn:gcuid:01HSTAT001AAAAAAAAAAAAAAAA', name: 'User 1', finalState: IdentityEntityState.PROVISIONAL },
    { gcuid: 'urn:gcuid:01HSTAT002BBBBBBBBBBBBBBBB', name: 'User 2', finalState: IdentityEntityState.UNDER_REVIEW },
    { gcuid: 'urn:gcuid:01HSTAT003CCCCCCCCCCCCCCCC', name: 'User 3', finalState: IdentityEntityState.ACTIVE },
    { gcuid: 'urn:gcuid:01HSTAT004DDDDDDDDDDDDDDDD', name: 'User 4', finalState: IdentityEntityState.ACTIVE },
    { gcuid: 'urn:gcuid:01HSTAT005EEEEEEEEEEEEEEEE', name: 'User 5', finalState: IdentityEntityState.SUSPENDED },
  ];
  
  identities.forEach(({ gcuid, name, finalState }) => {
    registry.createIdentity({
      gcuid,
      metadata: { name },
      reason: 'Bulk creation for statistics example'
    });
    
    // Transition to final state
    if (finalState === IdentityEntityState.UNDER_REVIEW) {
      registry.transitionIdentity({
        gcuid,
        transition: IdentityTransition.CORRELATION,
        reason: 'Submitted for correlation'
      });
    } else if (finalState === IdentityEntityState.ACTIVE) {
      registry.transitionIdentity({
        gcuid,
        transition: IdentityTransition.PROOFED,
        reason: 'Proofed and activated'
      });
    } else if (finalState === IdentityEntityState.SUSPENDED) {
      registry.transitionIdentity({
        gcuid,
        transition: IdentityTransition.PROOFED,
        reason: 'Activated'
      });
      registry.transitionIdentity({
        gcuid,
        transition: IdentityTransition.SUSPEND,
        reason: 'Suspended for testing'
      });
    }
  });
  
  console.log('✓ Created 5 test identities\n');
  
  // Get statistics
  const stats = registry.getStatistics();
  console.log('Identity Statistics:');
  console.log(`  Total: ${stats.total}`);
  console.log(`  Provisional: ${stats.provisional}`);
  console.log(`  Under Review: ${stats.under_review}`);
  console.log(`  Active: ${stats.active}`);
  console.log(`  Suspended: ${stats.suspended}`);
  console.log(`  Retired: ${stats.retired}`);
  console.log(`  Archived: ${stats.archived}`);
  
  // Get identities by state
  const activeIdentities = registry.getIdentitiesByState(IdentityEntityState.ACTIVE);
  console.log(`\n✓ Found ${activeIdentities.length} active identities:`);
  activeIdentities.forEach(identity => {
    console.log(`  - ${identity.gcuid}`);
    console.log(`    Name: ${identity.metadata?.name || 'N/A'}`);
    console.log(`    Created: ${identity.createdAt.toISOString()}`);
  });
  
  registry.close();
}

/**
 * Run all examples
 */
export function runAllExamples() {
  try {
    exampleBasicLifecycle();
    exampleApprovalWorkflow();
    exampleSuspension();
    exampleRetirement();
    exampleValidation();
    exampleStatistics();
    
    console.log('\n✓ All examples completed successfully!\n');
  } catch (error) {
    console.error('\n✗ Error running examples:', error);
    throw error;
  }
}

// Run examples if executed directly
if (require.main === module) {
  runAllExamples();
}
