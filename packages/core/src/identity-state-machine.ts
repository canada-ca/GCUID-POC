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
 * Identity State Machine
 * Manages the lifecycle of Identity entities (separate from GCUID state)
 * 
 * Identity has a 1:1 relationship with GCUID but maintains its own state
 * GCUID tracks identifier lifecycle (reserved → issued → nullified/superseded)
 * Identity tracks entity lifecycle (provisional → active → retired/archived)
 */

import { setup, fromPromise, assign } from 'xstate';

/**
 * Identity states representing the entity's lifecycle
 */
export enum IdentityEntityState {
  PROVISIONAL = 'provisional',
  UNDER_REVIEW = 'under_review',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  RETIRED = 'retired',
  ARCHIVED = 'archived'
}

/**
 * Identity state transitions (business logic)
 */
export enum IdentityTransition {
  // From Provisional
  PROOFED = 'PROOFED',                                    // provisional → active
  CORRELATION = 'CORRELATION',                            // provisional → under_review
  
  // From Under Review
  DEEPER_INVESTIGATION = 'DEEPER_INVESTIGATION',          // under_review → suspended
  CLEAR = 'CLEAR',                                        // under_review → active
  
  // From Active
  END_ENGAGEMENT = 'END_ENGAGEMENT',                      // active → retired
  SUSPEND = 'SUSPEND',                                    // active → suspended
  SUSPECTED_DUPLICATE = 'SUSPECTED_DUPLICATE',            // active → under_review
  
  // From Suspended
  REMEDIATION_COMPLETE = 'REMEDIATION_COMPLETE',          // suspended → active
  OFFBOARD = 'OFFBOARD',                                  // suspended → retired
  
  // From Retired
  REHIRE = 'REHIRE',                                      // retired → under_review
  RETENTION = 'RETENTION'                                 // retired → archived
}

/**
 * Identity state machine context
 */
export interface IdentityContext {
  gcuid: string;
  currentState: IdentityEntityState;
  previousState?: IdentityEntityState;
  reason?: string;
  metadata?: Record<string, any>;
  stateHistory: Array<{
    from: IdentityEntityState;
    to: IdentityEntityState;
    transition: IdentityTransition;
    timestamp: Date;
    reason?: string;
  }>;
}

/**
 * XState machine for Identity entity lifecycle
 */
export const identityStateMachine = setup({
  types: {
    context: {} as IdentityContext,
    input: {} as { gcuid: string; metadata?: Record<string, any> },
    events: {} as 
      | { type: IdentityTransition.PROOFED; reason?: string }
      | { type: IdentityTransition.CORRELATION; reason?: string }
      | { type: IdentityTransition.DEEPER_INVESTIGATION; reason?: string }
      | { type: IdentityTransition.CLEAR; reason?: string }
      | { type: IdentityTransition.END_ENGAGEMENT; reason?: string }
      | { type: IdentityTransition.SUSPEND; reason?: string }
      | { type: IdentityTransition.SUSPECTED_DUPLICATE; reason?: string }
      | { type: IdentityTransition.REMEDIATION_COMPLETE; reason?: string }
      | { type: IdentityTransition.OFFBOARD; reason?: string }
      | { type: IdentityTransition.REHIRE; reason?: string }
      | { type: IdentityTransition.RETENTION; reason?: string }
  },
  actions: {
    recordTransition: assign(({ context, event }) => ({
      previousState: context.currentState,
      stateHistory: [
        ...context.stateHistory,
        {
          from: context.currentState,
          to: context.currentState, // Will be updated by state change
          transition: event.type as IdentityTransition,
          timestamp: new Date(),
          reason: 'reason' in event ? event.reason : undefined
        }
      ]
    }))
  }
}).createMachine({
  id: 'identity',
  initial: IdentityEntityState.PROVISIONAL,
  context: ({ input }) => ({
    gcuid: input.gcuid,
    currentState: IdentityEntityState.PROVISIONAL,
    metadata: input.metadata,
    stateHistory: []
  }),
  states: {
    [IdentityEntityState.PROVISIONAL]: {
      entry: assign({ currentState: IdentityEntityState.PROVISIONAL }),
      on: {
        [IdentityTransition.PROOFED]: {
          target: IdentityEntityState.ACTIVE,
          actions: 'recordTransition'
        },
        [IdentityTransition.CORRELATION]: {
          target: IdentityEntityState.UNDER_REVIEW,
          actions: 'recordTransition'
        }
      }
    },
    [IdentityEntityState.UNDER_REVIEW]: {
      entry: assign({ currentState: IdentityEntityState.UNDER_REVIEW }),
      on: {
        [IdentityTransition.CLEAR]: {
          target: IdentityEntityState.ACTIVE,
          actions: 'recordTransition'
        },
        [IdentityTransition.DEEPER_INVESTIGATION]: {
          target: IdentityEntityState.SUSPENDED,
          actions: 'recordTransition'
        }
      }
    },
    [IdentityEntityState.ACTIVE]: {
      entry: assign({ currentState: IdentityEntityState.ACTIVE }),
      on: {
        [IdentityTransition.SUSPEND]: {
          target: IdentityEntityState.SUSPENDED,
          actions: 'recordTransition'
        },
        [IdentityTransition.END_ENGAGEMENT]: {
          target: IdentityEntityState.RETIRED,
          actions: 'recordTransition'
        },
        [IdentityTransition.SUSPECTED_DUPLICATE]: {
          target: IdentityEntityState.UNDER_REVIEW,
          actions: 'recordTransition'
        }
      }
    },
    [IdentityEntityState.SUSPENDED]: {
      entry: assign({ currentState: IdentityEntityState.SUSPENDED }),
      on: {
        [IdentityTransition.REMEDIATION_COMPLETE]: {
          target: IdentityEntityState.ACTIVE,
          actions: 'recordTransition'
        },
        [IdentityTransition.OFFBOARD]: {
          target: IdentityEntityState.RETIRED,
          actions: 'recordTransition'
        }
      }
    },
    [IdentityEntityState.RETIRED]: {
      entry: assign({ currentState: IdentityEntityState.RETIRED }),
      on: {
        [IdentityTransition.REHIRE]: {
          target: IdentityEntityState.UNDER_REVIEW,
          actions: 'recordTransition'
        },
        [IdentityTransition.RETENTION]: {
          target: IdentityEntityState.ARCHIVED,
          actions: 'recordTransition'
        }
      }
    },
    [IdentityEntityState.ARCHIVED]: {
      entry: assign({ currentState: IdentityEntityState.ARCHIVED }),
      type: 'final'
    }
  }
});

/**
 * Validate if a transition is allowed from the current state
 */
export function validateIdentityTransition(
  currentState: IdentityEntityState,
  transition: IdentityTransition
): { valid: boolean; nextState?: IdentityEntityState; error?: string } {
  const machine = identityStateMachine;
  const stateNode = machine.states[currentState];
  
  if (!stateNode) {
    return { valid: false, error: `Invalid state: ${currentState}` };
  }

  const transitions = stateNode.on || {};
  const transitionConfigs = transitions[transition];

  if (!transitionConfigs || transitionConfigs.length === 0) {
    return {
      valid: false,
      error: `Transition ${transition} not allowed from state ${currentState}`
    };
  }

  // XState v5 returns arrays of transition configs
  const transitionConfig = transitionConfigs[0] as any;
  const targetStateNode = transitionConfig.target?.[0];
  
  if (!targetStateNode) {
    return {
      valid: false,
      error: `No target state found for transition ${transition}`
    };
  }

  // Extract state name from StateNode object
  const nextState = targetStateNode.key as IdentityEntityState;

  return { valid: true, nextState };
}

/**
 * Get all valid transitions from the current state
 */
export function getValidIdentityTransitions(
  currentState: IdentityEntityState
): IdentityTransition[] {
  const machine = identityStateMachine;
  const stateNode = machine.states[currentState];
  
  if (!stateNode) {
    return [];
  }

  const transitions = stateNode.on || {};
  return Object.keys(transitions) as IdentityTransition[];
}

/**
 * Check if a specific transition is valid
 */
export function canTransitionIdentity(
  currentState: IdentityEntityState,
  transition: IdentityTransition
): boolean {
  const result = validateIdentityTransition(currentState, transition);
  return result.valid;
}

/**
 * Get the next state for a transition
 */
export function getNextIdentityState(
  currentState: IdentityEntityState,
  transition: IdentityTransition
): IdentityEntityState | null {
  const result = validateIdentityTransition(currentState, transition);
  return result.nextState || null;
}

/**
 * Check if a state is terminal (no outgoing transitions)
 */
export function isTerminalIdentityState(state: IdentityEntityState): boolean {
  return state === IdentityEntityState.ARCHIVED;
}

/**
 * Get a human-readable description of the state
 */
export function getIdentityStateDescription(state: IdentityEntityState): string {
  const descriptions: Record<IdentityEntityState, string> = {
    [IdentityEntityState.PROVISIONAL]: 'Initial state - identity is being set up',
    [IdentityEntityState.UNDER_REVIEW]: 'Identity is being reviewed for activation',
    [IdentityEntityState.ACTIVE]: 'Identity is active and operational',
    [IdentityEntityState.SUSPENDED]: 'Identity is temporarily suspended',
    [IdentityEntityState.RETIRED]: 'Identity has been retired from active use',
    [IdentityEntityState.ARCHIVED]: 'Identity is archived and cannot be modified'
  };
  return descriptions[state] || 'Unknown state';
}

/**
 * Get a human-readable description of the transition
 */
export function getIdentityTransitionDescription(transition: IdentityTransition): string {
  const descriptions: Record<IdentityTransition, string> = {
    [IdentityTransition.PROOFED]: 'Identity proofed and activated directly',
    [IdentityTransition.CORRELATION]: 'Identity needs correlation/verification',
    [IdentityTransition.DEEPER_INVESTIGATION]: 'Identity requires deeper investigation',
    [IdentityTransition.CLEAR]: 'Identity cleared and activated',
    [IdentityTransition.END_ENGAGEMENT]: 'End engagement and retire identity',
    [IdentityTransition.SUSPEND]: 'Suspend identity',
    [IdentityTransition.SUSPECTED_DUPLICATE]: 'Suspected duplicate identity',
    [IdentityTransition.REMEDIATION_COMPLETE]: 'Remediation complete, reactivate identity',
    [IdentityTransition.OFFBOARD]: 'Offboard suspended identity',
    [IdentityTransition.REHIRE]: 'Rehire retired identity',
    [IdentityTransition.RETENTION]: 'Archive identity for retention'
  };
  return descriptions[transition] || 'Unknown transition';
}
