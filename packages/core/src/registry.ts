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
 * Identity Registry - Persistent storage for GCUIDs
 * Uses SQLite as a mock implementation for eventual highly reliable database
 */

import Database from 'better-sqlite3';
import { GCUIDManager, Identity, EntityType } from './index';
import * as path from 'path';
import * as fs from 'fs';
import { IdentityState, StateTransition, validateTransition, getValidTransitions, canTransition } from './state-machine';

// Re-export for backwards compatibility
export { IdentityState, StateTransition };

/**
 * Registry entry with state management
 */
export interface RegistryEntry {
  gcuid: string;
  alias?: string;
  entityType: string;
  formatVersion?: number;
  state: IdentityState;
  createdAt: Date;
  updatedAt: Date;
  stateChangedAt: Date;
  metadata?: Record<string, any>;
  stateReason?: string;
  supersededBy?: string;  // GCUID that supersedes this one (for SUPERSEDED state)
}

/**
 * Query options for registry searches
 */
export interface RegistryQuery {
  entityType?: string;
  state?: IdentityState;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Registry statistics
 */
export interface RegistryStats {
  total: number;
  byEntityType: Record<string, number>;
  byState: Record<string, number>;
}

/**
 * Identity Registry for managing GCUID lifecycle
 */
export class IdentityRegistry {
  private db: Database.Database;
  private gcuidManager: GCUIDManager;

  constructor(dbPath: string = ':memory:', gcuidManager?: GCUIDManager) {
    // Create directory if it doesn't exist
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(dbPath);
    this.gcuidManager = gcuidManager || new GCUIDManager();
    this.initializeDatabase();
  }

  /**
   * Initialize database schema
   */
  private initializeDatabase(): void {
    // Create base tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identities (
        gcuid TEXT PRIMARY KEY,
        alias TEXT UNIQUE,
        entity_type TEXT NOT NULL,
        format_version INTEGER,
        state TEXT NOT NULL DEFAULT 'reserved',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        state_changed_at INTEGER NOT NULL,
        metadata TEXT,
        state_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_alias ON identities(alias);
      CREATE INDEX IF NOT EXISTS idx_entity_type ON identities(entity_type);
      CREATE INDEX IF NOT EXISTS idx_state ON identities(state);
      CREATE INDEX IF NOT EXISTS idx_created_at ON identities(created_at);
      CREATE INDEX IF NOT EXISTS idx_state_changed_at ON identities(state_changed_at);

      CREATE TABLE IF NOT EXISTS state_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gcuid TEXT NOT NULL,
        old_state TEXT,
        new_state TEXT NOT NULL,
        changed_at INTEGER NOT NULL,
        reason TEXT,
        FOREIGN KEY (gcuid) REFERENCES identities(gcuid)
      );

      CREATE INDEX IF NOT EXISTS idx_state_history_gcuid ON state_history(gcuid);
      CREATE INDEX IF NOT EXISTS idx_state_history_changed_at ON state_history(changed_at);
    `);

    // Run migrations to add new columns/features
    this.runMigrations();
  }

  /**
   * Run database migrations to update schema
   */
  private runMigrations(): void {
    // Migration 1: Add superseded_by column
    const hasSupersededBy = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM pragma_table_info('identities') 
      WHERE name='superseded_by'
    `).get() as { count: number };

    if (hasSupersededBy.count === 0) {
      console.log('Running migration: Adding superseded_by column...');
      this.db.exec(`
        ALTER TABLE identities ADD COLUMN superseded_by TEXT 
        REFERENCES identities(gcuid);
        CREATE INDEX IF NOT EXISTS idx_superseded_by ON identities(superseded_by);
      `);
      console.log('Migration complete: superseded_by column added');
    }

    // Migration 2: Add transition column to state_history
    const hasTransition = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM pragma_table_info('state_history') 
      WHERE name='transition'
    `).get() as { count: number };

    if (hasTransition.count === 0) {
      console.log('Running migration: Adding transition column to state_history...');
      this.db.exec(`
        ALTER TABLE state_history ADD COLUMN transition TEXT NOT NULL DEFAULT 'unknown';
      `);
      console.log('Migration complete: transition column added');
    }
  }

  /**
   * Validate state transition using XState machine
   */
  private validateTransition(currentState: IdentityState | null, transition: StateTransition): IdentityState {
    return validateTransition(currentState, transition);
  }

  /**
   * Record state change in history with transition type
   */
  private recordStateChange(
    gcuid: string,
    oldState: IdentityState | null,
    newState: IdentityState,
    transition: StateTransition,
    reason?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO state_history (gcuid, old_state, new_state, transition, changed_at, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      gcuid,
      oldState,
      newState,
      transition,
      Date.now(),
      reason || null
    );
  }

  /**
   * Register a new identity in the registry (MINT transition: initial -> reserved)
   */
  register(identity: Identity, reason?: string): RegistryEntry {
    const newState = this.validateTransition(null, StateTransition.MINT);
    const now = Date.now();
    
    // Support both Identity (V1) and IdentityV2 formats
    const alias = (identity as any).alias || null;
    const formatVersion = (identity as any).formatVersion || null;
    
    const stmt = this.db.prepare(`
      INSERT INTO identities (gcuid, alias, entity_type, format_version, state, created_at, updated_at, state_changed_at, metadata, state_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      identity.gcuid,
      alias,
      identity.entityType,
      formatVersion,
      newState,
      identity.createdAt.getTime(),
      identity.updatedAt.getTime(),
      now,
      identity.metadata ? JSON.stringify(identity.metadata) : null,
      reason || 'Initial registration (mint)'
    );

    // Record initial state in history
    this.recordStateChange(identity.gcuid, null, newState, StateTransition.MINT, reason);

    return this.get(identity.gcuid)!;
  }

  /**
   * Get an identity from the registry
   */
  get(gcuid: string): RegistryEntry | null {
    const stmt = this.db.prepare(`
      SELECT gcuid, alias, entity_type, format_version, state, created_at, updated_at, state_changed_at, metadata, state_reason, superseded_by
      FROM identities
      WHERE gcuid = ?
    `);

    const row = stmt.get(gcuid) as any;
    if (!row) return null;

    return this.rowToEntry(row);
  }

  /**
   * Find an identity by its alias
   */
  findByAlias(alias: string): RegistryEntry | null {
    const stmt = this.db.prepare(`
      SELECT gcuid, alias, entity_type, format_version, state, created_at, updated_at, state_changed_at, metadata, state_reason, superseded_by
      FROM identities
      WHERE alias = ?
    `);

    const row = stmt.get(alias) as any;
    if (!row) return null;

    return this.rowToEntry(row);
  }

  /**
   * Check if an identity exists in the registry
   */
  exists(gcuid: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM identities WHERE gcuid = ?');
    return stmt.get(gcuid) !== undefined;
  }

  /**
   * Bind a reserved GCUID to an identity record (BIND transition: reserved -> issued)
   */
  bind(gcuid: string, reason?: string): boolean {
    return this.performTransition(gcuid, StateTransition.BIND, reason);
  }

  /**
   * Mark a reserved GCUID as nullified due to error (ERROR transition: reserved -> nullified)
   */
  markError(gcuid: string, reason?: string): boolean {
    return this.performTransition(gcuid, StateTransition.ERROR, reason);
  }

  /**
   * Mark an issued GCUID as nullified due to catastrophic event (CATASTROPHIC transition: issued -> nullified)
   */
  markCatastrophic(gcuid: string, reason?: string): boolean {
    return this.performTransition(gcuid, StateTransition.CATASTROPHIC, reason);
  }

  /**
   * Mark an issued GCUID as superseded by another (DUPLICATE transition: issued -> superseded)
   */
  markDuplicate(gcuid: string, supersededBy: string, reason?: string): boolean {
    const entry = this.get(gcuid);
    if (!entry) return false;

    // Validate the transition
    const newState = this.validateTransition(entry.state, StateTransition.DUPLICATE);
    const now = Date.now();

    // Update with superseded_by reference
    const stmt = this.db.prepare(`
      UPDATE identities
      SET state = ?, state_changed_at = ?, updated_at = ?, state_reason = ?, superseded_by = ?
      WHERE gcuid = ?
    `);

    stmt.run(newState, now, now, reason || 'Duplicate identity found', supersededBy, gcuid);

    // Record state change in history
    this.recordStateChange(gcuid, entry.state, newState, StateTransition.DUPLICATE, reason);

    return true;
  }

  /**
   * Perform a state transition with validation
   */
  private performTransition(gcuid: string, transition: StateTransition, reason?: string): boolean {
    const entry = this.get(gcuid);
    if (!entry) return false;

    // Validate and get new state
    const newState = this.validateTransition(entry.state, transition);
    const now = Date.now();

    const stmt = this.db.prepare(`
      UPDATE identities
      SET state = ?, state_changed_at = ?, updated_at = ?, state_reason = ?
      WHERE gcuid = ?
    `);

    stmt.run(newState, now, now, reason || `Transition: ${transition}`, gcuid);

    // Record state change in history
    this.recordStateChange(gcuid, entry.state, newState, transition, reason);

    return true;
  }

  /**
   * Update identity state (deprecated - use specific transition methods instead)
   * @deprecated Use bind(), markError(), markCatastrophic(), or markDuplicate() instead
   */
  updateState(gcuid: string, newState: IdentityState, reason?: string): boolean {
    console.warn('updateState() is deprecated. Use specific transition methods: bind(), markError(), markCatastrophic(), markDuplicate()');
    const entry = this.get(gcuid);
    if (!entry) return false;

    const now = Date.now();
    
    const stmt = this.db.prepare(`
      UPDATE identities
      SET state = ?, state_changed_at = ?, updated_at = ?, state_reason = ?
      WHERE gcuid = ?
    `);

    stmt.run(newState, now, now, reason || null, gcuid);

    return true;
  }

  /**
   * Update identity metadata
   */
  updateMetadata(gcuid: string, metadata: Record<string, any>): boolean {
    const exists = this.exists(gcuid);
    if (!exists) return false;

    const stmt = this.db.prepare(`
      UPDATE identities
      SET metadata = ?, updated_at = ?
      WHERE gcuid = ?
    `);

    stmt.run(JSON.stringify(metadata), Date.now(), gcuid);
    return true;
  }

  /**
   * Query identities with filters
   */
  query(options: RegistryQuery = {}): RegistryEntry[] {
    const { entityType, state, createdAfter, createdBefore, limit = 100, offset = 0 } = options;

    let sql = 'SELECT * FROM identities WHERE 1=1';
    const params: any[] = [];

    if (entityType) {
      sql += ' AND entity_type = ?';
      params.push(entityType);
    }

    if (state) {
      sql += ' AND state = ?';
      params.push(state);
    }

    if (createdAfter) {
      sql += ' AND created_at >= ?';
      params.push(createdAfter.getTime());
    }

    if (createdBefore) {
      sql += ' AND created_at <= ?';
      params.push(createdBefore.getTime());
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.rowToEntry(row));
  }

  /**
   * Get state history for an identity
   */
  getStateHistory(gcuid: string): Array<{
    oldState: IdentityState | null;
    newState: IdentityState;
    changedAt: Date;
    reason?: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT old_state, new_state, changed_at, reason
      FROM state_history
      WHERE gcuid = ?
      ORDER BY changed_at DESC
    `);

    const rows = stmt.all(gcuid) as any[];

    return rows.map(row => ({
      oldState: row.old_state as IdentityState | null,
      newState: row.new_state as IdentityState,
      changedAt: new Date(row.changed_at),
      reason: row.reason || undefined
    }));
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM identities');
    const total = (totalStmt.get() as any).count;

    const byTypeStmt = this.db.prepare(`
      SELECT entity_type, COUNT(*) as count
      FROM identities
      GROUP BY entity_type
    `);
    const typeRows = byTypeStmt.all() as any[];
    const byEntityType: Record<string, number> = {};
    typeRows.forEach(row => {
      byEntityType[row.entity_type] = row.count;
    });

    const byStateStmt = this.db.prepare(`
      SELECT state, COUNT(*) as count
      FROM identities
      GROUP BY state
    `);
    const stateRows = byStateStmt.all() as any[];
    const byState: Record<string, number> = {};
    stateRows.forEach(row => {
      byState[row.state] = row.count;
    });

    return { total, byEntityType, byState };
  }

  /**
   * Delete an identity from the registry
   * Note: In production, this should be a soft delete or state change
   */
  delete(gcuid: string): boolean {
    // Delete state history first (foreign key constraint)
    const historyStmt = this.db.prepare('DELETE FROM state_history WHERE gcuid = ?');
    historyStmt.run(gcuid);

    // Delete identity
    const stmt = this.db.prepare('DELETE FROM identities WHERE gcuid = ?');
    const result = stmt.run(gcuid);

    return result.changes > 0;
  }

  /**
   * Clear all identities (use with caution!)
   */
  clear(): void {
    this.db.exec('DELETE FROM state_history');
    this.db.exec('DELETE FROM identities');
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Convert database row to RegistryEntry
   */
  private rowToEntry(row: any): RegistryEntry {
    return {
      gcuid: row.gcuid,
      alias: row.alias || undefined,
      entityType: row.entity_type,
      formatVersion: row.format_version || undefined,
      state: row.state as IdentityState,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      stateChangedAt: new Date(row.state_changed_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      stateReason: row.state_reason || undefined,
      supersededBy: row.superseded_by || undefined
    };
  }

  /**
   * Get GCUID manager instance
   */
  getGCUIDManager(): GCUIDManager {
    return this.gcuidManager;
  }

  /**
   * Convenience method: Mint and register a new identity in one step
   */
  mintAndRegister(options: {
    entityType: string;
    version?: number;
    metadata?: Record<string, any>;
    initialState?: IdentityState;
  }): RegistryEntry {
    const identity = this.gcuidManager.createIdentity({
      entityType: options.entityType,
      version: options.version,
      metadata: options.metadata
    });

    return this.register(identity, options.initialState);
  }
}

export default IdentityRegistry;
