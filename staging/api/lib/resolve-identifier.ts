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
 * Shared identifier resolution utility.
 *
 * Resolves an alias value to a canonical GCUID string when the aliases feature
 * is enabled in system options.  Used by route param middlewares so that every
 * endpoint that accepts a :gcuid path parameter — or a gcuid body field —
 * transparently accepts an alias instead.
 *
 * Behaviour:
 *   - Identifiers that already start with 'urn:' are returned unchanged.
 *   - If aliases.enabled is false (Options portal), returns the identifier unchanged.
 *   - Otherwise performs an alias table lookup filtered by the active sub-flags
 *     (email, userSelected, generated).
 *   - Returns the canonical GCUID if found, or the original identifier if not.
 *     Returning the original unchanged means routes produce their natural 404
 *     rather than this helper throwing.
 */

import Database from 'better-sqlite3';
import { REGISTRY_DB_PATH as REGISTRY_DB } from './db-paths.js';
import { readFlags } from '../routes/flags.js';

/**
 * Returns the `identifier_mode` configured for a source system.
 * Falls back to `'gcuid'` if the system is not found or the DB cannot be
 * read.  Call sites can use this to decide whether to pass a canonical GCUID
 * or an alias when building outgoing responses for a specific department/source.
 */
export function getSystemIdentifierMode(systemId: string): 'gcuid' | 'alias' {
  try {
    const db = new Database(REGISTRY_DB, { readonly: true });
    try {
      const row = db.prepare(
        `SELECT identifier_mode FROM source_systems WHERE system_id = ?`
      ).get(systemId) as { identifier_mode: string } | undefined;
      return (row?.identifier_mode === 'alias') ? 'alias' : 'gcuid';
    } finally {
      db.close();
    }
  } catch {
    return 'gcuid';
  }
}

/**
 * Converts a canonical GCUID to the preferred identifier for a given source
 * system, based on that system's `identifier_mode` setting.
 *
 * - If `identifier_mode` is `'gcuid'` (or the system is not found): returns
 *   the GCUID unchanged.
 * - If `identifier_mode` is `'alias'`: looks up the best available alias for
 *   the GCUID (custom > GC-generated > email, in that preference order).
 *   Returns the alias value if found, or the original GCUID if none exists.
 *
 * The aliases feature-flag is respected: when aliases are globally disabled
 * the GCUID is always returned regardless of the system setting.
 */
export function resolveFromGcuid(gcuid: string, systemId: string): string {
  if (!gcuid) return gcuid;

  const flags = readFlags();
  if (!flags.aliases.enabled) return gcuid;
  if (getSystemIdentifierMode(systemId) !== 'alias') return gcuid;

  const db = new Database(REGISTRY_DB, { readonly: true });
  try {
    // Prefer custom aliases, then GC-generated, then email; only resolve enabled aliases
    const rows = db.prepare(
      `SELECT alias_value, alias_type FROM aliases WHERE gcuid = ? AND status = 'enabled' ORDER BY
         CASE alias_type
           WHEN 'custom' THEN 1
           WHEN 'email'  THEN 3
           ELSE 2
         END LIMIT 1`
    ).get(gcuid) as { alias_value: string; alias_type: string } | undefined;
    return rows?.alias_value ?? gcuid;
  } finally {
    db.close();
  }
}

/**
 * Resolve any identifier (canonical GCUID, alias, or empty) to the
 * canonical GCUID string the rest of the API expects.
 *
 * Behaviour:
 * - Empty / nullish input returns `""` unchanged.
 * - Identifiers starting with `urn:` are treated as already-canonical;
 *   the function follows the supersede chain up to 10 hops to land on
 *   the current canonical GCUID (cycle-safe).
 * - Otherwise, when `flags.aliases.enabled` is false (Options portal),
 *   returns the identifier unchanged.
 * - When aliases are enabled, looks up the identifier in the `aliases`
 *   table honouring the `userSelected`, `generated`, and `email`
 *   sub-flags. Returns the first matching `gcuid`, or the original
 *   identifier unchanged if no match is found. The "return original"
 *   shape means callers get a natural 404 from downstream rather than
 *   a thrown error from this helper.
 *
 * @param identifier Any GCUID, alias, or `undefined`/`null`/empty.
 * @returns Canonical GCUID string, or the original input on no match.
 */
export function resolveToGcuid(identifier: string | undefined | null): string {
  if (!identifier) return '';
  if (identifier.startsWith('urn:')) {
    // Follow the supersede chain to the canonical GCUID (max 10 hops, cycle guard).
    // Most GCUIDs are active, so we do one indexed PK lookup and exit immediately.
    const db = new Database(REGISTRY_DB, { readonly: true });
    try {
      let current = identifier;
      for (let depth = 0; depth < 10; depth++) {
        const row = db.prepare(
          `SELECT identifier_state, superseded_by FROM identities WHERE gcuid = ?`
        ).get(current) as { identifier_state: string; superseded_by: string | null } | undefined;
        if (!row || row.identifier_state !== 'superseded' || !row.superseded_by) break;
        current = row.superseded_by;
      }
      return current;
    } finally {
      db.close();
    }
  }

  const flags = readFlags();
  if (!flags.aliases.enabled) return identifier;

  const db = new Database(REGISTRY_DB, { readonly: true });
  try {
    // Build alias-type filter matching the active sub-flags; only resolve enabled aliases
    const conditions: string[] = ["status = 'enabled'"];
    if (!flags.aliases.userSelected) conditions.push("alias_type != 'custom'");
    if (!flags.aliases.generated)    conditions.push("alias_type NOT LIKE 'GC-%'");
    if (!flags.aliases.email)        conditions.push("alias_type != 'email'");

    const where = `WHERE alias_value = ? AND ${conditions.join(' AND ')}`;

    const row = db.prepare(`SELECT gcuid FROM aliases ${where}`).get(identifier) as
      { gcuid: string } | undefined;
    return row?.gcuid ?? identifier;
  } finally {
    db.close();
  }
}
