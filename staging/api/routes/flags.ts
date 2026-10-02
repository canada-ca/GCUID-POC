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
 * Feature Flags API Routes
 *
 * Exposes PoC feature flags stored in the registry database (config table).
 * GET  /api/flags        — read current flags
 * PATCH /api/flags       — update (deep-merge) flags
 *
 * Master toggle behaviour:
 *   aliases.enabled → false  sets all sub-flags (email, userSelected, generated) to false
 *   aliases.enabled → true   sets all sub-flags to true
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { logRegistry } from '../lib/logging/logger.js';
import { REGISTRY_EVENTS } from '../lib/logging/log-events.js';

const router = Router();
const REGISTRY_DB = path.join(process.cwd(), 'data/registry.db');
const CONFIG_KEY   = 'feature_flags';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AliasFlags {
  enabled: boolean;
  email: boolean;
  userSelected: boolean;
  generated: boolean;
}

export interface GcuidGenerationFlags {
  format:     'v1' | 'v2';
  coreIdType: 'ulid' | 'uuid';
  encoding:   'crockford' | 'standard';
}

export interface IdentityMatchingFlags {
  strongMatchThreshold:    number;  // 0.0–1.0, default 0.90
  weakMatchThreshold:      number;  // 0.0–1.0, default 0.50
  existingGcuidBehavior:   'propose_link' | 'always_create';  // default propose_link
  writeBackMode:           'immediate' | 'on_approval';       // default immediate
}

export interface FeatureFlags {
  aliases:          AliasFlags;
  gcuidGeneration:  GcuidGenerationFlags;
  identityMatching: IdentityMatchingFlags;
  portalMode:       'single' | 'separate';
}

const DEFAULT_FLAGS: FeatureFlags = {
  aliases:          { enabled: true, email: true, userSelected: true, generated: true },
  gcuidGeneration:  { format: 'v2', coreIdType: 'ulid', encoding: 'crockford' },
  identityMatching: { strongMatchThreshold: 0.90, weakMatchThreshold: 0.50, existingGcuidBehavior: 'propose_link', writeBackMode: 'immediate' },
  portalMode:       'single',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Ensure the config table exists (idempotent). Called lazily on first access. */
function ensureTable(db: Database.Database): void {
  db.prepare(
    'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)'
  ).run();
}

/** Read flags from the DB, falling back to defaults. */
export function readFlags(): FeatureFlags {
  const db = new Database(REGISTRY_DB, { readonly: true });
  try {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(CONFIG_KEY) as { value: string } | undefined;
    if (!row) return { aliases: { ...DEFAULT_FLAGS.aliases }, gcuidGeneration: { ...DEFAULT_FLAGS.gcuidGeneration }, identityMatching: { ...DEFAULT_FLAGS.identityMatching }, portalMode: DEFAULT_FLAGS.portalMode };
    const stored = JSON.parse(row.value) as Partial<FeatureFlags>;
    return {
      aliases:          { ...DEFAULT_FLAGS.aliases,          ...(stored.aliases ?? {}) },
      gcuidGeneration:  { ...DEFAULT_FLAGS.gcuidGeneration,  ...(stored.gcuidGeneration ?? {}) },
      identityMatching: { ...DEFAULT_FLAGS.identityMatching, ...(stored.identityMatching ?? {}) },
      portalMode:       stored.portalMode ?? DEFAULT_FLAGS.portalMode,
    };
  } catch {
    return { aliases: { ...DEFAULT_FLAGS.aliases }, gcuidGeneration: { ...DEFAULT_FLAGS.gcuidGeneration }, portalMode: DEFAULT_FLAGS.portalMode };
  } finally {
    db.close();
  }
}

/** Persist flags to the DB. */
function writeFlags(flags: FeatureFlags): void {
  const db = new Database(REGISTRY_DB);
  try {
    ensureTable(db);
    db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(CONFIG_KEY, JSON.stringify(flags), new Date().toISOString());
  } finally {
    db.close();
  }
}

/**
 * Apply master toggle cascade:
 *   enabled → false  forces all sub-flags to false
 *   enabled → true   forces all sub-flags to true
 * Individual sub-flag patches are only applied when enabled is not being toggled.
 */
function applyPatch(current: FeatureFlags, patch: Partial<FeatureFlags>): FeatureFlags {
  const aliasPatch = patch.aliases ?? {};
  const merged: AliasFlags = { ...current.aliases, ...aliasPatch };

  // Master toggle cascade
  if ('enabled' in aliasPatch) {
    if (!aliasPatch.enabled) {
      merged.email        = false;
      merged.userSelected = false;
      merged.generated    = false;
    } else {
      merged.email        = true;
      merged.userSelected = true;
      merged.generated    = true;
    }
  }

  const portalMode = patch.portalMode ?? current.portalMode;

  return {
    aliases:          merged,
    gcuidGeneration:  { ...current.gcuidGeneration,  ...(patch.gcuidGeneration ?? {}) },
    identityMatching: { ...current.identityMatching, ...(patch.identityMatching ?? {}) },
    portalMode,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: readFlags() });
});

router.patch('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const current = readFlags();
    const updated  = applyPatch(current, req.body as Partial<FeatureFlags>);
    writeFlags(updated);
    logRegistry('notice', REGISTRY_EVENTS.FLAG_CHANGED, {
      component:  'api:flags',
      target_id:  JSON.stringify(req.body),
      actor_id:   (req.ip ?? 'system'),
      request_id: (req as any).requestId,
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

export { router as flagsRoutes };
