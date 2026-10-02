/*!
 * GCUID — Government of Canada Unique Identifier System
 * Copyright (c) 2024-2026 NOETRONIQ Strategic Initiatives. All rights reserved.
 *
 * Centralized database path resolver.
 *
 * When GCUID_DB_PATH points to /mnt/efs (Lambda EFS mode), all database paths
 * are resolved relative to /mnt/efs so that runtime writes survive container
 * recycling and redeployment.  In local dev and Docker Compose the paths fall
 * back to ./data/ under process.cwd().
 *
 * Import this module instead of hard-coding path constants in route/lib files:
 *
 *   import { REGISTRY_DB_PATH, LOGS_DB_PATH, CONNECTORS_DIR } from '../lib/db-paths.js';
 */

import path from 'path';

// If GCUID_DB_PATH starts with /mnt/efs we are running inside Lambda with EFS
// mounted.  Use /mnt/efs as the base for all database files so every DB open
// hits persistent storage.  Otherwise fall back to process.cwd()/data/ which
// is used in local dev (tsx) and Docker Compose.
const efsBase = process.env['GCUID_DB_PATH']?.startsWith('/mnt/efs') ? '/mnt/efs' : null;

export const DB_BASE: string   = efsBase ?? path.join(process.cwd(), 'data');
export const IS_EFS_MODE: boolean = efsBase !== null;

export const REGISTRY_DB_PATH: string  = path.join(DB_BASE, 'registry.db');
export const LOGS_DB_PATH: string      = path.join(DB_BASE, 'logs.db');
// Source DBs live in staging/data/sources/ (separate from the registry DB).
// In this PoC the connector and its source DB share the same workspace, but
// the source-owned data lives in a dedicated subdirectory to make the
// ownership boundary explicit.
export const SOURCES_DIR: string       = path.join(DB_BASE, 'sources');
// CONNECTORS_DIR is kept as a deprecated alias of SOURCES_DIR so existing
// callers (route files, scripts) continue to resolve to the same on-disk path
// while the migration to the new layout completes.
export const CONNECTORS_DIR: string    = SOURCES_DIR;

/**
 * Resolve the absolute filesystem path for a connector's source SQLite database.
 *
 * @param connectorId Connector identifier (matches the file basename, e.g. `"conn-hr"`).
 * @returns Absolute path of the SQLite database file.
 */
export function connectorDbPath(connectorId: string): string {
  return path.join(SOURCES_DIR, `${connectorId}.db`);
}
