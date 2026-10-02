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
 * Database Migration Script: V1 to V2
 * 
 * Migrates existing GCUID identity databases from V1 format to support V2:
 * - Adds alias, entity_type, and format_version columns (if missing)
 * - Populates entity_type from V1 GCUID parsing
 * - Generates aliases for existing identities
 * - Sets format_version based on GCUID format detection
 * - Creates new indexes for performance
 * 
 * Usage:
 *   npm run migrate -- --db-path ./data/identities.db [--generate-aliases] [--dry-run]
 */

import Database from 'better-sqlite3';
import { GCUIDManager } from './index';
import { generateAlias } from './alias';
import { logger, logInfo, logError, logWarn, logDebug } from './logger';

/**
 * Migration options
 */
export interface MigrationOptions {
  dbPath: string;
  generateAliases?: boolean;
  dryRun?: boolean;
  backupPath?: string;
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  recordsProcessed: number;
  recordsUpdated: number;
  aliasesGenerated: number;
  errors: string[];
  warnings: string[];
}

/**
 * Check if a column exists in a table
 */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const result = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return result.some((col: any) => col.name === column);
}

/**
 * Backup database before migration
 */
function backupDatabase(dbPath: string, backupPath?: string): string {
  const fs = require('fs');
  const path = require('path');
  
  if (!backupPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = dbPath.replace(/\.db$/, `-backup-${timestamp}.db`);
  }
  
  fs.copyFileSync(dbPath, backupPath);
  logInfo('Database backed up', { original: dbPath, backup: backupPath });
  
  return backupPath;
}

/**
 * Migrate database from V1 to V2 format
 */
export async function migrateToV2(options: MigrationOptions): Promise<MigrationResult> {
  const { dbPath, generateAliases = true, dryRun = false } = options;
  
  const result: MigrationResult = {
    success: false,
    recordsProcessed: 0,
    recordsUpdated: 0,
    aliasesGenerated: 0,
    errors: [],
    warnings: []
  };

  let db: Database.Database | null = null;
  let backupPath: string | null = null;

  try {
    logInfo('Starting V1 to V2 migration', { dbPath, dryRun, generateAliases });

    // Backup database (unless dry run)
    if (!dryRun) {
      backupPath = backupDatabase(dbPath, options.backupPath);
    }

    // Open database
    db = new Database(dbPath);
    
    // Start transaction
    if (!dryRun) {
      db.exec('BEGIN TRANSACTION');
    }

    // Step 1: Add columns if they don't exist
    logInfo('Step 1: Checking schema...');
    
    const needsAliasColumn = !columnExists(db, 'identity_entities', 'alias');
    const needsEntityTypeColumn = !columnExists(db, 'identity_entities', 'entity_type');
    const needsFormatVersionColumn = !columnExists(db, 'identity_entities', 'format_version');

    if (needsAliasColumn || needsEntityTypeColumn || needsFormatVersionColumn) {
      logInfo('Schema updates needed', { 
        needsAliasColumn, 
        needsEntityTypeColumn, 
        needsFormatVersionColumn 
      });

      if (!dryRun) {
        if (needsAliasColumn) {
          db.exec('ALTER TABLE identity_entities ADD COLUMN alias TEXT UNIQUE');
          logInfo('Added alias column');
        }
        if (needsEntityTypeColumn) {
          db.exec('ALTER TABLE identity_entities ADD COLUMN entity_type TEXT');
          logInfo('Added entity_type column');
        }
        if (needsFormatVersionColumn) {
          db.exec('ALTER TABLE identity_entities ADD COLUMN format_version INTEGER');
          logInfo('Added format_version column');
        }
      } else {
        logInfo('[DRY RUN] Would add missing columns');
      }
    } else {
      logInfo('Schema is up to date');
    }

    // Step 2: Create indexes if they don't exist
    if (!dryRun) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_identity_entities_alias ON identity_entities(alias);
        CREATE INDEX IF NOT EXISTS idx_identity_entities_entity_type ON identity_entities(entity_type);
      `);
      logInfo('Indexes created/verified');
    }

    // Step 3: Process existing records
    logInfo('Step 2: Processing existing records...');
    
    const records = db.prepare('SELECT * FROM identity_entities').all() as any[];
    result.recordsProcessed = records.length;
    
    logInfo(`Found ${records.length} records to process`);

    const manager = new GCUIDManager();
    const updateStmt = db.prepare(`
      UPDATE identity_entities 
      SET entity_type = ?, format_version = ?, alias = ?
      WHERE id = ?
    `);

    for (const record of records) {
      try {
        const gcuid = record.gcuid;
        let entityType = record.entity_type;
        let formatVersion = record.format_version;
        let alias = record.alias;

        // Detect format version if not set
        if (!formatVersion) {
          try {
            formatVersion = manager.getFormatVersion(gcuid);
            logDebug('Detected format version', { gcuid, formatVersion });
          } catch (error) {
            result.warnings.push(`Could not detect format version for ${gcuid}: ${(error as Error).message}`);
            logWarn('Format version detection failed', { gcuid, error: (error as Error).message });
            continue;
          }
        }

        // Extract entity type from V1 GCUIDs
        if (!entityType && formatVersion === 1) {
          try {
            const parsed = manager.parseV1(gcuid);
            entityType = parsed.entityType;
            logDebug('Extracted entity type from V1 GCUID', { gcuid, entityType });
          } catch (error) {
            result.warnings.push(`Could not parse V1 GCUID ${gcuid}: ${(error as Error).message}`);
            logWarn('V1 parsing failed', { gcuid, error: (error as Error).message });
            continue;
          }
        }

        // Generate alias if requested and not already present
        if (generateAliases && !alias) {
          try {
            const parsed = manager.parse(gcuid);
            alias = generateAlias(parsed.core);
            result.aliasesGenerated++;
            logDebug('Generated alias', { gcuid, alias });
          } catch (error) {
            result.warnings.push(`Could not generate alias for ${gcuid}: ${(error as Error).message}`);
            logWarn('Alias generation failed', { gcuid, error: (error as Error).message });
          }
        }

        // Update record
        if (!dryRun) {
          updateStmt.run(entityType, formatVersion, alias, record.id);
          result.recordsUpdated++;
        } else {
          logInfo('[DRY RUN] Would update record', { 
            id: record.id, 
            gcuid, 
            entityType, 
            formatVersion, 
            alias: alias || '(none)' 
          });
          result.recordsUpdated++;
        }

      } catch (error) {
        const errorMsg = `Failed to process record ${record.id}: ${(error as Error).message}`;
        result.errors.push(errorMsg);
        logError('Record processing error', { 
          recordId: record.id, 
          gcuid: record.gcuid, 
          error: (error as Error).message 
        });
      }
    }

    // Commit transaction
    if (!dryRun) {
      db.exec('COMMIT');
      logInfo('Transaction committed');
    } else {
      logInfo('[DRY RUN] Transaction not committed (no changes made)');
    }

    result.success = result.errors.length === 0;

    // Summary
    logInfo('Migration completed', {
      success: result.success,
      recordsProcessed: result.recordsProcessed,
      recordsUpdated: result.recordsUpdated,
      aliasesGenerated: result.aliasesGenerated,
      errors: result.errors.length,
      warnings: result.warnings.length
    });

    return result;

  } catch (error) {
    // Rollback on error
    if (db && !dryRun) {
      try {
        db.exec('ROLLBACK');
        logError('Transaction rolled back due to error');
      } catch (rollbackError) {
        logError('Rollback failed', { error: (rollbackError as Error).message });
      }
    }

    const errorMsg = `Migration failed: ${(error as Error).message}`;
    result.errors.push(errorMsg);
    logError('Migration error', { error: (error as Error).message, stack: (error as Error).stack });
    
    return result;

  } finally {
    // Close database
    if (db) {
      db.close();
      logDebug('Database closed');
    }
  }
}

/**
 * Rollback migration (restore from backup)
 */
export function rollbackMigration(dbPath: string, backupPath: string): boolean {
  try {
    const fs = require('fs');
    
    logWarn('Rolling back migration', { from: backupPath, to: dbPath });
    
    // Verify backup exists
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    // Replace current DB with backup
    fs.copyFileSync(backupPath, dbPath);
    
    logInfo('Migration rolled back successfully', { dbPath, backupPath });
    return true;
    
  } catch (error) {
    logError('Rollback failed', { error: (error as Error).message });
    return false;
  }
}

/**
 * CLI entry point for migration
 */
export async function runMigrationCLI() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const options: MigrationOptions = {
    dbPath: '',
    generateAliases: true,
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--db-path':
        options.dbPath = args[++i];
        break;
      case '--backup-path':
        options.backupPath = args[++i];
        break;
      case '--generate-aliases':
        options.generateAliases = true;
        break;
      case '--no-aliases':
        options.generateAliases = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
        console.log(`
GCUID Database Migration Tool - V1 to V2

Usage:
  node dist/migrate-to-v2.js --db-path <path> [options]

Options:
  --db-path <path>        Path to SQLite database file (required)
  --backup-path <path>    Path for backup file (optional, auto-generated if not provided)
  --generate-aliases      Generate aliases for existing identities (default)
  --no-aliases            Skip alias generation
  --dry-run               Preview changes without modifying database
  --help                  Show this help message

Examples:
  # Dry run to preview changes
  node dist/migrate-to-v2.js --db-path ./data/identities.db --dry-run

  # Run migration with alias generation
  node dist/migrate-to-v2.js --db-path ./data/identities.db

  # Run migration without generating aliases
  node dist/migrate-to-v2.js --db-path ./data/identities.db --no-aliases

  # Specify custom backup location
  node dist/migrate-to-v2.js --db-path ./data/identities.db --backup-path ./backups/identities-backup.db
        `);
        process.exit(0);
    }
  }

  // Validate required arguments
  if (!options.dbPath) {
    console.error('Error: --db-path is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  // Run migration
  console.log('\n=== GCUID Database Migration: V1 → V2 ===\n');
  
  const result = await migrateToV2(options);

  // Display results
  console.log('\n=== Migration Results ===');
  console.log(`Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`Records Processed: ${result.recordsProcessed}`);
  console.log(`Records Updated: ${result.recordsUpdated}`);
  console.log(`Aliases Generated: ${result.aliasesGenerated}`);
  
  if (result.warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${result.warnings.length}):`);
    result.warnings.forEach((warning, i) => {
      console.log(`  ${i + 1}. ${warning}`);
    });
  }

  if (result.errors.length > 0) {
    console.log(`\n❌ Errors (${result.errors.length}):`);
    result.errors.forEach((error, i) => {
      console.log(`  ${i + 1}. ${error}`);
    });
  }

  console.log('\n');
  process.exit(result.success ? 0 : 1);
}

// Run CLI if called directly
if (require.main === module) {
  runMigrationCLI().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
