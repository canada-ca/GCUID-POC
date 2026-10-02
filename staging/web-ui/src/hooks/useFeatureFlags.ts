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
import { useState, useEffect, useCallback } from 'react';

// ─── Flag definitions (mirror server-side FeatureFlags interface) ─────────────

export interface GcuidGenerationFlags {
  format:     'v1' | 'v2';
  coreIdType: 'ulid' | 'uuid';
  encoding:   'crockford' | 'standard';
}

export interface IdentityMatchingFlags {
  strongMatchThreshold:  number;
  weakMatchThreshold:    number;
  existingGcuidBehavior: 'propose_link' | 'always_create';
  writeBackMode:         'immediate' | 'on_approval';
}

export interface FeatureFlags {
  aliases: {
    /** Master toggle — when false, all alias sub-features are suppressed */
    enabled: boolean;
    /** Email aliases auto-derived from authoritative source data */
    email: boolean;
    /** User-selected custom aliases entered via the self-service portal */
    userSelected: boolean;
    /** System-generated GC-style aliases (GC-{CONTEXT}-…) */
    generated: boolean;
  };
  gcuidGeneration:  GcuidGenerationFlags;
  identityMatching: IdentityMatchingFlags;
  /** Whether portals are presented as a single combined interface or separate windows */
  portalMode: 'single' | 'separate';
}

export const DEFAULT_FLAGS: FeatureFlags = {
  aliases:          { enabled: true, email: true, userSelected: true, generated: true },
  gcuidGeneration:  { format: 'v2', coreIdType: 'ulid', encoding: 'crockford' },
  identityMatching: { strongMatchThreshold: 0.90, weakMatchThreshold: 0.50, existingGcuidBehavior: 'propose_link', writeBackMode: 'immediate' },
  portalMode:       'single',
};

const CACHE_KEY = 'gcuid_poc_feature_flags';
const API_URL   = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/flags`;

function fromCache(): FeatureFlags {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_FLAGS;
    const stored = JSON.parse(raw) as Partial<FeatureFlags>;
    return {
      aliases:          { ...DEFAULT_FLAGS.aliases,          ...(stored.aliases ?? {}) },
      gcuidGeneration:  { ...DEFAULT_FLAGS.gcuidGeneration,  ...(stored.gcuidGeneration ?? {}) },
      identityMatching: { ...DEFAULT_FLAGS.identityMatching, ...(stored.identityMatching ?? {}) },
      portalMode:       stored.portalMode ?? DEFAULT_FLAGS.portalMode,
    };
  } catch {
    return DEFAULT_FLAGS;
  }
}

function toCache(flags: FeatureFlags): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(flags)); } catch { /* ignore */ }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFeatureFlags() {
  // Initialise from localStorage cache so there's no loading flicker
  const [flags, setFlags] = useState<FeatureFlags>(fromCache);
  const [loading, setLoading] = useState(true);

  // On mount, fetch the authoritative server-side values
  useEffect(() => {
    fetch(API_URL)
      .then((r) => r.json())
      .then((body) => {
        const serverFlags: FeatureFlags = {
          aliases:          { ...DEFAULT_FLAGS.aliases,          ...(body?.data?.aliases ?? {}) },
          gcuidGeneration:  { ...DEFAULT_FLAGS.gcuidGeneration,  ...(body?.data?.gcuidGeneration ?? {}) },
          identityMatching: { ...DEFAULT_FLAGS.identityMatching, ...(body?.data?.identityMatching ?? {}) },
          portalMode:       body?.data?.portalMode ?? DEFAULT_FLAGS.portalMode,
        };
        setFlags(serverFlags);
        toCache(serverFlags);
      })
      .catch(() => { /* server unreachable — keep cache */ })
      .finally(() => setLoading(false));
  }, []);

  const setFlag = useCallback(<K extends keyof FeatureFlags>(
    group: K,
    patch: Partial<FeatureFlags[K]>
  ) => {
    // Apply optimistic local update so the UI responds immediately
    setFlags((prev) => {
      const prevVal = prev[group];
      const merged = (typeof prevVal === 'object' && prevVal !== null)
        ? { ...(prevVal as Record<string, unknown>), ...(patch as Record<string, unknown>) }
        : patch;
      const next: FeatureFlags = { ...prev, [group]: merged };
      toCache(next);
      return next;
    });
    // Persist to server and reconcile with the authoritative response.
    // The server may apply cascade logic (e.g. master toggle sets all sub-flags),
    // so we must update local state from the response rather than assuming the
    // optimistic value is final.
    fetch(API_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [group]: patch }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (body?.data) {
          const serverFlags: FeatureFlags = {
            aliases:          { ...DEFAULT_FLAGS.aliases,          ...(body.data.aliases ?? {}) },
            gcuidGeneration:  { ...DEFAULT_FLAGS.gcuidGeneration,  ...(body.data.gcuidGeneration ?? {}) },
            identityMatching: { ...DEFAULT_FLAGS.identityMatching, ...(body.data.identityMatching ?? {}) },
            portalMode:       body.data.portalMode ?? DEFAULT_FLAGS.portalMode,
          };
          setFlags(serverFlags);
          toCache(serverFlags);
        }
      })
      .catch(() => { /* server unreachable — optimistic value remains */ });
  }, []);

  const reset = useCallback(() => {
    setFlags(DEFAULT_FLAGS);
    toCache(DEFAULT_FLAGS);
    fetch(API_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULT_FLAGS),
    })
      .then((r) => r.json())
      .then((body) => {
        if (body?.data) {
          const serverFlags: FeatureFlags = {
            aliases:          { ...DEFAULT_FLAGS.aliases,          ...(body.data.aliases ?? {}) },
            gcuidGeneration:  { ...DEFAULT_FLAGS.gcuidGeneration,  ...(body.data.gcuidGeneration ?? {}) },
            identityMatching: { ...DEFAULT_FLAGS.identityMatching, ...(body.data.identityMatching ?? {}) },
            portalMode:       body.data.portalMode ?? DEFAULT_FLAGS.portalMode,
          };
          setFlags(serverFlags);
          toCache(serverFlags);
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  return { flags, setFlag, reset, loading };
}

