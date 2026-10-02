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
 * Identity Registry
 * Manages Identity entities with their own lifecycle separate from GCUID identifiers
 * 
 * Identity Ent
    const now = new Date().toISOString();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO identity_entities (gcuid, state, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      gcuid,
      IdentityEntityState.PROVISIONAL,
      now,
      now,
      metadataJson
    );:1 relationship with GCUID
 * - Has its own state machine (provisional → under_review → active → suspended/retired → archived)
 * - Tracks identity-specific metadata and history
 */

import Database from 'better-sqlite3';
import { 
  IdentityEntityState, 
  IdentityTransition,
  validateIdentityTransition,
  getValidIdentityTransitions,
  getIdentityStateDescription
} from './identity-state-machine';
import { logger, logInfo, logError, logDebug } from './logger';

/**
 * Identity entity record structure
 */
export interface IdentityEntity {
  id: number;
  gcuid: string;
  alias?: string;
  entityType?: string;
  formatVersion?: number;
  state: IdentityEntityState;
  previousState?: IdentityEntityState;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Identity entity state history entry
 */
export interface IdentityEntityStateHistory {
  id: number;
  identityId: number;
  gcuid: string;
  fromState: IdentityEntityState;
  toState: IdentityEntityState;
  transition: IdentityTransition;
  reason?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * Options for creating an identity
 */
export interface CreateIdentityOptions {
  gcuid: string;
  alias?: string;
  entityType?: string;
  formatVersion?: number;
  metadata?: Record<string, any>;
  reason?: string;
}

/**
 * Options for transitioning an identity
 */
export interface TransitionIdentityOptions {
  gcuid: string;
  transition: IdentityTransition;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * Identity Entity Registry - manages identity entities and their lifecycle
 */
export class IdentityEntityRegistry {
  private db: Database.Database;
  
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeSchema();
    logDebug('IdentityEntityRegistry initialized', { dbPath });
  }

  /**
   * Initialize database schema for identities
   */
  private initializeSchema(): void {
    // Identity entities table (separate from GCUID identities table)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identity_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gcuid TEXT NOT NULL UNIQUE,
        alias TEXT UNIQUE,
        entity_type TEXT,
        format_version INTEGER,
        state TEXT NOT NULL,
        previous_state TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT
      )
    `);

    // Identity state history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identity_state_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_id INTEGER NOT NULL,
        gcuid TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        transition TEXT NOT NULL,
        reason TEXT,
        timestamp TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (identity_id) REFERENCES identity_entities(id)
      )
    `);

    // Indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_identity_entities_gcuid ON identity_entities(gcuid);
      CREATE INDEX IF NOT EXISTS idx_identity_entities_alias ON identity_entities(alias);
      CREATE INDEX IF NOT EXISTS idx_identity_entities_state ON identity_entities(state);
      CREATE INDEX IF NOT EXISTS idx_identity_entities_entity_type ON identity_entities(entity_type);
      CREATE INDEX IF NOT EXISTS idx_identity_history_identity_id ON identity_state_history(identity_id);
      CREATE INDEX IF NOT EXISTS idx_identity_history_gcuid ON identity_state_history(gcuid);
    `);

    logDebug('Identity registry schema initialized');
  }

  /**
   * Create a new identity (starts in PROVISIONAL state)
   */
  createIdentity(options: CreateIdentityOptions): IdentityEntity {
    const { gcuid, alias, entityType, formatVersion, metadata, reason } = options;

    // Check if identity already exists
    const existing = this.getIdentity(gcuid);
    if (existing) {
      throw new Error(`Identity already exists for GCUID: ${gcuid}`);
    }

    // Check if alias already exists
    if (alias) {
      const existingByAlias = this.findByAlias(alias);
      if (existingByAlias) {
        throw new Error(`Identity already exists with alias: ${alias}`);
      }
    }

    const now = new Date().toISOString();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO identity_entities (gcuid, alias, entity_type, format_version, state, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      gcuid,
      alias || null,
      entityType || null,
      formatVersion || null,
      IdentityEntityState.PROVISIONAL,
      now,
      now,
      metadataJson
    );

    // Record initial state in history
    this.recordStateChange({
      identityId: result.lastInsertRowid as number,
      gcuid,
      fromState: IdentityEntityState.PROVISIONAL,
      toState: IdentityEntityState.PROVISIONAL,
      transition: 'CREATED' as IdentityTransition,
      reason: reason || 'Identity created'
    });

    logInfo('Identity created', { gcuid, state: IdentityEntityState.PROVISIONAL });

    return this.getIdentity(gcuid)!;
  }

  /**
   * Get an identity by GCUID
   */
  getIdentity(gcuid: string): IdentityEntity | null {
    const stmt = this.db.prepare(`
      SELECT id, gcuid, alias, entity_type, format_version, state, previous_state, created_at, updated_at, metadata
      FROM identity_entities
      WHERE gcuid = ?
    `);

    const row = stmt.get(gcuid) as any;
    if (!row) return null;

    return {
      id: row.id,
      gcuid: row.gcuid,
      alias: row.alias || undefined,
      entityType: row.entity_type || undefined,
      formatVersion: row.format_version || undefined,
      state: row.state as IdentityEntityState,
      previousState: row.previous_state as IdentityEntityState | undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  }

  /**
   * Find an identity by alias
   */
  findByAlias(alias: string): IdentityEntity | null {
    const stmt = this.db.prepare(`
      SELECT id, gcuid, alias, entity_type, format_version, state, previous_state, created_at, updated_at, metadata
      FROM identity_entities
      WHERE alias = ?
    `);

    const row = stmt.get(alias) as any;
    if (!row) return null;

    return {
      id: row.id,
      gcuid: row.gcuid,
      alias: row.alias || undefined,
      entityType: row.entity_type || undefined,
      formatVersion: row.format_version || undefined,
      state: row.state as IdentityEntityState,
      previousState: row.previous_state as IdentityEntityState | undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  }

  /**
   * Transition an identity to a new state
   */
  transitionIdentity(options: TransitionIdentityOptions): IdentityEntity {
    const { gcuid, transition, reason, metadata } = options;

    const identity = this.getIdentity(gcuid);
    if (!identity) {
      throw new Error(`Identity not found: ${gcuid}`);
    }

    // Validate transition
    const validation = validateIdentityTransition(identity.state, transition);
    if (!validation.valid) {
      throw new Error(validation.error || `Invalid transition: ${transition}`);
    }

    const newState = validation.nextState!;
    if (!newState) {
      throw new Error(`No next state determined for transition: ${transition}`);
    }

    const now = new Date().toISOString();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    // Update identity state
    const stmt = this.db.prepare(`
      UPDATE identity_entities
      SET state = ?, previous_state = ?, updated_at = ?, metadata = COALESCE(?, metadata)
      WHERE gcuid = ?
    `);

    const updateResult = stmt.run(newState, identity.state, now, metadataJson, gcuid);
    
    if (updateResult.changes === 0) {
      throw new Error(`Failed to update identity: ${gcuid}`);
    }

    // Record state change in history
    this.recordStateChange({
      identityId: identity.id,
      gcuid,
      fromState: identity.state,
      toState: newState,
      transition,
      reason,
      metadata
    });

    logInfo('Identity transitioned', {
      gcuid,
      from: identity.state,
      to: newState,
      transition,
      reason
    });

    return this.getIdentity(gcuid)!;
  }

  /**
   * Record a state change in history
   */
  private recordStateChange(options: {
    identityId: number;
    gcuid: string;
    fromState: IdentityEntityState;
    toState: IdentityEntityState;
    transition: IdentityTransition | string;
    reason?: string;
    metadata?: Record<string, any>;
  }): void {
    const { identityId, gcuid, fromState, toState, transition, reason, metadata } = options;
    const timestamp = new Date().toISOString();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO identity_state_history (
        identity_id, gcuid, from_state, to_state, transition, reason, timestamp, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(identityId, gcuid, fromState, toState, transition, reason || null, timestamp, metadataJson);
  }

  /**
   * Get state history for an identity
   */
  getStateHistory(gcuid: string): IdentityEntityStateHistory[] {
    const stmt = this.db.prepare(`
      SELECT 
        id, identity_id, gcuid, from_state, to_state, transition, reason, timestamp, metadata
      FROM identity_state_history
      WHERE gcuid = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(gcuid) as any[];
    return rows.map(row => ({
      id: row.id,
      identityId: row.identity_id,
      gcuid: row.gcuid,
      fromState: row.from_state as IdentityEntityState,
      toState: row.to_state as IdentityEntityState,
      transition: row.transition as IdentityTransition,
      reason: row.reason || undefined,
      timestamp: new Date(row.timestamp),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  /**
   * Get all identities with a specific state
   */
  getIdentitiesByState(state: IdentityEntityState): IdentityEntity[] {
    const stmt = this.db.prepare(`
      SELECT id, gcuid, state, previous_state, created_at, updated_at, metadata
      FROM identity_entities
      WHERE state = ?
      ORDER BY updated_at DESC
    `);

    const rows = stmt.all(state) as any[];
    return rows.map(row => ({
      id: row.id,
      gcuid: row.gcuid,
      state: row.state as IdentityEntityState,
      previousState: row.previous_state as IdentityEntityState | undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  /**
   * Get all valid transitions for an identity
   */
  getValidTransitions(gcuid: string): IdentityTransition[] {
    const identity = this.getIdentity(gcuid);
    if (!identity) {
      throw new Error(`Identity not found: ${gcuid}`);
    }

    return getValidIdentityTransitions(identity.state);
  }

  /**
   * Get identity statistics
   */
  getStatistics(): Record<IdentityEntityState, number> & { total: number } {
    const stmt = this.db.prepare(`
      SELECT state, COUNT(*) as count
      FROM identity_entities
      GROUP BY state
    `);

    const rows = stmt.all() as any[];
    const stats: any = {
      total: 0,
      [IdentityEntityState.PROVISIONAL]: 0,
      [IdentityEntityState.UNDER_REVIEW]: 0,
      [IdentityEntityState.ACTIVE]: 0,
      [IdentityEntityState.SUSPENDED]: 0,
      [IdentityEntityState.RETIRED]: 0,
      [IdentityEntityState.ARCHIVED]: 0
    };

    for (const row of rows) {
      stats[row.state as IdentityEntityState] = row.count;
      stats.total += row.count;
    }

    return stats;
  }

  /**
   * Update identity metadata
   */
  updateMetadata(gcuid: string, metadata: Record<string, any>): void {
    const identity = this.getIdentity(gcuid);
    if (!identity) {
      throw new Error(`Identity not found: ${gcuid}`);
    }

    const metadataJson = JSON.stringify(metadata);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE identity_entities
      SET metadata = ?, updated_at = ?
      WHERE gcuid = ?
    `);

    stmt.run(metadataJson, now, gcuid);
    logDebug('Identity metadata updated', { gcuid });
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    logDebug('IdentityEntityRegistry closed');
  }
}
