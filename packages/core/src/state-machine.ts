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
 * XState-based State Machine for GCUID Identity Lifecycle
 * 
 * State Flow:
 * - Initial -> RESERVED (mint)
 * - RESERVED -> ISSUED (bind)
 * - RESERVED -> NULLIFIED (error)
 * - ISSUED -> NULLIFIED (catastrophic)
 * - ISSUED -> SUPERSEDED (duplicate)
 */

import { setup, createActor } from 'xstate';

/**
 * Identity state tracking
 */
export enum IdentityState {
  RESERVED = 'reserved',    // Initial state after minting
  ISSUED = 'issued',        // Bound to an identity record
  SUPERSEDED = 'superseded', // Replaced by another GCUID (duplicate found)
  NULLIFIED = 'nullified'   // Invalidated due to error or catastrophic event
}

/**
 * State transition events
 */
export enum StateTransition {
  MINT = 'MINT',                // (initial) -> reserved
  BIND = 'BIND',                // reserved -> issued
  ERROR = 'ERROR',              // reserved -> nullified
  CATASTROPHIC = 'CATASTROPHIC', // issued -> nullified
  DUPLICATE = 'DUPLICATE'       // issued -> superseded
}

/**
 * Per-transition context carried through the state machine.
 *
 * `gcuid` is set by the registry once the identifier is minted;
 * `reason` is a free-text human note attached to every transition;
 * `supersededBy` is set on `DUPLICATE` to record the replacement
 * GCUID that took over from this one.
 */
export interface GCUIDContext {
  gcuid?: string;
  reason?: string;
  supersededBy?: string;
}

/**
 * Events accepted by `gcuidStateMachine`. Each carries an optional
 * `reason` field (audit log message); `DUPLICATE` additionally carries
 * the `supersededBy` GCUID of the replacement record.
 */
export type GCUIDEvent =
  | { type: 'MINT'; reason?: string }
  | { type: 'BIND'; reason?: string }
  | { type: 'ERROR'; reason?: string }
  | { type: 'CATASTROPHIC'; reason?: string }
  | { type: 'DUPLICATE'; reason?: string; supersededBy?: string };

/**
 * xState machine enforcing valid GCUID lifecycle transitions:
 *
 * - `initial` → `reserved` (on `MINT`)
 * - `reserved` → `issued` (on `BIND`)
 * - `reserved` → `nullified` (on `ERROR`)
 * - `issued` → `nullified` (on `CATASTROPHIC`)
 * - `issued` → `superseded` (on `DUPLICATE`)
 *
 * Both `superseded` and `nullified` are final states. Any other
 * transition throws via `validateTransition()`.
 */
export const gcuidStateMachine = setup({
  types: {} as {
    context: GCUIDContext;
    events: GCUIDEvent;
  },
}).createMachine({
  id: 'gcuid-lifecycle',
  initial: 'initial',
  context: {
    gcuid: undefined,
    reason: undefined,
    supersededBy: undefined,
  },
  states: {
    initial: {
      on: {
        MINT: {
          target: 'reserved',
        },
      },
    },
    reserved: {
      on: {
        BIND: {
          target: 'issued',
        },
        ERROR: {
          target: 'nullified',
        },
      },
    },
    issued: {
      on: {
        CATASTROPHIC: {
          target: 'nullified',
        },
        DUPLICATE: {
          target: 'superseded',
        },
      },
    },
    superseded: {
      type: 'final',
    },
    nullified: {
      type: 'final',
    },
  },
});

/**
 * Validate if a transition is allowed from the current state
 * 
 * @param currentState - The current state (null for initial)
 * @param transition - The transition to attempt
 * @returns The resulting state if valid
 * @throws Error if the transition is invalid
 */
export function validateTransition(
  currentState: IdentityState | null,
  transition: StateTransition
): IdentityState {
  const stateValue = currentState ? currentState : 'initial';
  
  // Use resolveState to check if transition is valid
  const currentSnapshot = gcuidStateMachine.resolveState({
    value: stateValue,
    context: {}
  });
  
  // Check if the transition is allowed
  const canDoTransition = currentSnapshot.can({ type: transition });
  
  if (!canDoTransition) {
    throw new Error(
      `Invalid state transition: cannot perform '${transition}' from state '${currentState || 'initial'}'. ` +
      `No valid transition exists for this event.`
    );
  }
  
  // Define the transition map based on our state machine
  const transitionMap: Record<StateTransition, IdentityState> = {
    [StateTransition.MINT]: IdentityState.RESERVED,
    [StateTransition.BIND]: IdentityState.ISSUED,
    [StateTransition.ERROR]: IdentityState.NULLIFIED,
    [StateTransition.CATASTROPHIC]: IdentityState.NULLIFIED,
    [StateTransition.DUPLICATE]: IdentityState.SUPERSEDED,
  };
  
  const resultState = transitionMap[transition];
  if (!resultState) {
    throw new Error(`Unable to determine resulting state for transition: ${transition}`);
  }
  
  return resultState;
}

/**
 * Get all valid transitions from the current state
 * 
 * @param currentState - The current state (null for initial)
 * @returns Array of valid transition event types
 */
export function getValidTransitions(currentState: IdentityState | null): StateTransition[] {
  const stateValue = currentState ? currentState : 'initial';
  
  const currentSnapshot = gcuidStateMachine.resolveState({
    value: stateValue,
    context: {}
  });
  
  // Check all possible transitions
  const validTransitions: StateTransition[] = [];
  for (const transition of Object.values(StateTransition)) {
    if (currentSnapshot.can({ type: transition })) {
      validTransitions.push(transition);
    }
  }
  
  return validTransitions;
}

/**
 * Check if a specific transition is valid from the current state
 * 
 * @param currentState - The current state (null for initial)
 * @param transition - The transition to check
 * @returns true if the transition is valid
 */
export function canTransition(
  currentState: IdentityState | null,
  transition: StateTransition
): boolean {
  const stateValue = currentState ? currentState : 'initial';
  
  const currentSnapshot = gcuidStateMachine.resolveState({
    value: stateValue,
    context: {}
  });
  
  return currentSnapshot.can({ type: transition });
}
