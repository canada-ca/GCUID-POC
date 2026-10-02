/*!
 * GCUID — Government of Canada Unique Identifier System
 *
 * @license
 * Copyright (c) 2024-2026 NOETRONIQ Strategic Initiatives. All rights reserved.
 * Author: Philippe R. Beauchamp <prb@noetroniq.com>
 *
 * Licensed under the Treasury Board of Canada Secretariat terms.
 * See LICENSE in the project root for full terms.
 */
/**
 * UX Configuration API Routes
 *
 * Manages per-scope colour and appearance tokens for the GCUID portal.
 * Stored in the registry database config table (same pattern as flags).
 *
 * GET  /api/ux-config              — read full config
 * PUT  /api/ux-config              — replace full config
 * PATCH /api/ux-config/:scopeId    — update global or a named scope
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { REGISTRY_DB_PATH } from '../lib/db-paths.js';

const router = Router();
const CONFIG_KEY = 'ux_config';
const THEME_LIBRARY_KEY = 'ux_theme_library';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ThemeTokens {
  /** Main page / app shell background */
  bgPage: string;
  /** Card, panel, and modal background */
  bgSurface: string;
  /** Alternate surface (table row stripes, code blocks, sidebars) */
  bgSurfaceAlt: string;
  /** Interactive element hover background */
  bgHover: string;
  /** Selected or active element background */
  bgHighlight: string;
  /** Standard dividers, card and section borders */
  borderDefault: string;
  /** Focused input, prominent or selected borders */
  borderStrong: string;
  /** Headings and main body copy */
  textPrimary: string;
  /** Descriptions, labels, captions */
  textSecondary: string;
  /** Placeholders and disabled text */
  textMuted: string;
  /** Interactive links and action text */
  textLink: string;
  /** Active tabs, toggles on, primary buttons */
  accentPrimary: string;
  /** Text and icons on the primary accent colour */
  accentOnPrimary: string;
  /** Hover highlights, outline borders, badges */
  accentSecondary: string;
  /** Primary action button fill */
  btnPrimaryBg: string;
  /** Label on primary action button */
  btnPrimaryText: string;
  /** Secondary / ghost button fill */
  btnSecondaryBg: string;
  /** Label on secondary button */
  btnSecondaryText: string;
  /** Success badges, positive state indicators */
  statusSuccess: string;
  /** Warning badges and caution indicators */
  statusWarning: string;
  /** Error badges and danger indicators */
  statusError: string;
  /** Informational badges and neutral indicators */
  statusInfo: string;
  /** Coloured indicator dot next to nav group labels (global scope only) */
  navDotColor: string;
  /** Coloured text of nav group labels (global scope only) */
  navLabelColor: string;
  /** Table <thead> row background */
  tableHeaderBg: string;
  /** <input>, <select>, <textarea> fill (distinct from bgSurface for portals that want white inputs on tinted backgrounds) */
  inputBg: string;
  /** <code> and <pre> block background */
  codeBg: string;
  /** Neutral / default badge or chip fill */
  badgeNeutralBg: string;
  /** Neutral / default badge label text */
  badgeNeutralText: string;
  /** Toggle switch thumb (knob) colour */
  toggleThumb: string;
  /** Lightest portal-accent tinted background — pagination active, stat pills, row hover */
  accentSubtleBg: string;
  /** Border for portal-accent tinted panels and cards */
  accentSubtleBorder: string;
  /** Medium portal-accent tinted background — deeper badges and selected rows */
  accentMutedBg: string;
  /** Success alert / callout panel background */
  statusSuccessBg: string;
  /** Success alert / callout panel border */
  statusSuccessBorder: string;
  /** Warning alert / callout panel background */
  statusWarningBg: string;
  /** Warning alert / callout panel border */
  statusWarningBorder: string;
  /** Error alert / callout panel background */
  statusErrorBg: string;
  /** Error alert / callout panel border */
  statusErrorBorder: string;
  /** Informational alert / callout panel background */
  statusInfoBg: string;
  /** Informational alert / callout panel border */
  statusInfoBorder: string;
  /** Translucent level-1 elevation overlay — low-profile cards and inset panels (RGBA hex supported) */
  bgElevation1: string;
  /** Translucent level-2 elevation overlay — modals, popups, and distinctly raised panels (RGBA hex supported) */
  bgElevation2: string;
  /** Dropdown panel background for the Authoritative Sources nav group */
  navAuthSourcePanelBg: string;
  /** Active item accent colour for the Authoritative Sources nav dropdown */
  navAuthSourceAccent: string;
  /** Dropdown panel background for the Departments nav group */
  navDeptPanelBg: string;
  /** Active item accent colour for the Departments nav dropdown */
  navDeptAccent: string;
  /** Dropdown panel background for the System nav group */
  navSystemPanelBg: string;
  /** Active item accent colour for the System nav dropdown */
  navSystemAccent: string;
}

export interface ThemePair {
  light: ThemeTokens;
  dark: ThemeTokens;
}

export interface UXScopeConfig {
  id: string;
  label: string;
  type: 'global' | 'source' | 'department' | 'portal';
  /** When true, this scope overrides the global mid-section tokens */
  enabled: boolean;
  theme: ThemePair;
}

export interface UXConfig {
  global: ThemePair;
  /** Per-connector scope overrides; keyed by connector systemId */
  scopes: Record<string, UXScopeConfig>;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_LIGHT_TOKENS: ThemeTokens = {
  bgPage:           '#f2f5f9',
  bgSurface:        '#ffffff',
  bgSurfaceAlt:     '#f9fafb',
  bgHover:          '#f3f4f6',
  bgHighlight:      '#eff6ff',
  borderDefault:    '#e5e7eb',
  borderStrong:     '#d1d5db',
  textPrimary:      '#111827',
  textSecondary:    '#4b5563',
  textMuted:        '#9ca3af',
  textLink:         '#6d28d9',
  accentPrimary:    '#d4af37',
  accentOnPrimary:  '#001f3f',
  accentSecondary:  '#7c3aed',
  btnPrimaryBg:     '#d4af37',
  btnPrimaryText:   '#001f3f',
  btnSecondaryBg:   '#f3f4f6',
  btnSecondaryText: '#374151',
  statusSuccess:    '#16a34a',
  statusWarning:    '#d97706',
  statusError:      '#dc2626',
  statusInfo:       '#2563eb',
  navDotColor:       '#8b5cf6',
  navLabelColor:     '#6d28d9',
  tableHeaderBg:     '#eef1f6',
  inputBg:           '#ffffff',
  codeBg:            '#f1f5f9',
  badgeNeutralBg:    '#e2e8f0',
  badgeNeutralText:  '#475569',
  toggleThumb:       '#ffffff',
  // ── Accent tints (portal-specific, used for subtle panel backgrounds) ──────
  accentSubtleBg:     '#f4f7fa',   // noetroniq-blue-50  — default lightest accent tint
  accentSubtleBorder: '#d0dde9',   // noetroniq-blue-200 — accent tinted panel border
  accentMutedBg:      '#e7eef4',   // noetroniq-blue-100 — medium accent tint
  // ── Status panel backgrounds and borders (semantic / global) ────────────
  statusSuccessBg:     '#f5f7f4',  // noetroniq-green-50
  statusSuccessBorder: '#d1dccf',  // noetroniq-green-200
  statusWarningBg:     '#faf8f2',  // noetroniq-amber-50
  statusWarningBorder: '#e9e1c9',  // noetroniq-amber-200
  statusErrorBg:       '#fdf4f4',  // noetroniq-rose-50
  statusErrorBorder:   '#f1cccc',  // noetroniq-rose-200
  statusInfoBg:        '#f4f7fa',  // noetroniq-blue-50  — info always in blue family
  statusInfoBorder:    '#d0dde9',  // noetroniq-blue-200
  // ── Elevation overlays ──────────────────────────────────────────────────
  bgElevation1:        '#ffffff',  // opaque white — light mode lift is from shadow; token exists for customisation
  bgElevation2:        '#f8fafc',  // very light grey — secondary / inset panels in light mode
  // ── Nav dropdown panel colours ──────────────────────────────────────────
  navAuthSourcePanelBg: '#eff6ff', // blue-50 — Auth Sources dropdown panel
  navAuthSourceAccent:  '#2563eb', // blue-600 — active item in Auth Sources
  navDeptPanelBg:       '#f5f3ff', // violet-50 — Departments dropdown panel
  navDeptAccent:        '#7c3aed', // violet-600 — active item in Departments
  navSystemPanelBg:     '#fff1f2', // rose-50 — System dropdown panel
  navSystemAccent:      '#e11d48', // rose-600 — active item in System
};

export const DEFAULT_DARK_TOKENS: ThemeTokens = {
  bgPage:           '#001f3f',
  bgSurface:        '#1f2937',
  bgSurfaceAlt:     '#374151',
  bgHover:          '#374151',
  bgHighlight:      '#1e3a5f',
  borderDefault:    '#374151',
  borderStrong:     '#4b5563',
  textPrimary:      '#f9fafb',
  textSecondary:    '#d1d5db',
  textMuted:        '#6b7280',
  textLink:         '#a78bfa',
  accentPrimary:    '#d4af37',
  accentOnPrimary:  '#001f3f',
  accentSecondary:  '#7c3aed',
  btnPrimaryBg:     '#d4af37',
  btnPrimaryText:   '#001f3f',
  btnSecondaryBg:   '#374151',
  btnSecondaryText: '#e5e7eb',
  statusSuccess:    '#4ade80',
  statusWarning:    '#fbbf24',
  statusError:      '#f87171',
  statusInfo:       '#60a5fa',
  navDotColor:       '#a78bfa',
  navLabelColor:     '#c4b5fd',
  tableHeaderBg:     '#0d2347',
  inputBg:           '#001f3f',
  codeBg:            '#0f172a',
  badgeNeutralBg:    '#1e3a5f',
  badgeNeutralText:  '#94a3b8',
  toggleThumb:       '#ffffff',
  // ── Accent tints (portal-specific) ─────────────────────────────────────
  accentSubtleBg:     '#192231',   // custom dark muted-blue subtle panel
  accentSubtleBorder: '#334f6c',   // noetroniq-blue-800
  accentMutedBg:      '#1e3a5f',   // custom dark muted-blue muted panel
  // ── Status panel backgrounds and borders (semantic / global) ────────────
  statusSuccessBg:     '#0d1e0c',  // very dark sage-green
  statusSuccessBorder: '#3d5636',  // noetroniq-green-700
  statusWarningBg:     '#1c1600',  // very dark amber
  statusWarningBorder: '#a67f3d',  // noetroniq-amber-700
  statusErrorBg:       '#1f0808',  // very dark burgundy-red
  statusErrorBorder:   '#721817',  // noetroniq-rose-800 = brand burgundy
  statusInfoBg:        '#0e1d2e',  // very dark muted-blue
  statusInfoBorder:    '#334f6c',  // noetroniq-blue-800
  // ── Elevation overlays ──────────────────────────────────────────────────
  bgElevation1:        '#ffffff0d', // 5% white — lifts element above dark surface (RGBA)
  bgElevation2:        '#ffffff1f', // 12% white — stronger lift for modals and raised panels (RGBA)
  // ── Nav dropdown panel colours ──────────────────────────────────────────
  navAuthSourcePanelBg: '#0c1d38', // very dark blue tint — Auth Sources dropdown panel
  navAuthSourceAccent:  '#93c5fd', // blue-300 — active item in Auth Sources
  navDeptPanelBg:       '#180e30', // very dark purple tint — Departments dropdown panel
  navDeptAccent:        '#c4b5fd', // violet-300 — active item in Departments
  navSystemPanelBg:     '#2d0a12', // very dark rose tint — System dropdown panel
  navSystemAccent:      '#fda4af', // rose-300 — active item in System
};

export const DEFAULT_UX_CONFIG: UXConfig = {
  global: { light: DEFAULT_LIGHT_TOKENS, dark: DEFAULT_DARK_TOKENS },
  scopes: {
    'portal-self-service': {
      id: 'portal-self-service',
      label: 'Self-Service',
      type: 'portal',
      enabled: true,
      theme: {
        // ── Light — full teal palette (Tailwind teal scale) ────────────────
        light: {
          bgPage:           '#f0fdfa',   // teal-50  — page wash
          bgSurface:        '#ffffff',   // white    — card surfaces
          bgSurfaceAlt:     '#f0fdfa',   // teal-50  — alt sections / sidebars
          bgHover:          '#ccfbf1',   // teal-100 — hover state
          bgHighlight:      '#99f6e4',   // teal-200 — selection / focus ring fill
          borderDefault:    '#99f6e4',   // teal-200 — subtle teal-tinted border
          borderStrong:     '#14b8a6',   // teal-500 — emphasis border
          textPrimary:      '#134e4a',   // teal-900 — near-black body text
          textSecondary:    '#0f766e',   // teal-700 — supporting text
          textMuted:        '#6b7280',   // gray-500 — placeholders / disabled
          textLink:         '#0d9488',   // teal-600 — matches nav group link
          accentPrimary:    '#0d9488',   // teal-600 — primary brand
          accentOnPrimary:  '#ffffff',   // white on teal-600
          accentSecondary:  '#99f6e4',   // teal-200 — tag fills / highlights
          btnPrimaryBg:     '#0d9488',   // teal-600
          btnPrimaryText:   '#ffffff',
          btnSecondaryBg:   '#ccfbf1',   // teal-100
          btnSecondaryText: '#0f766e',   // teal-700
          statusSuccess:    '#16a34a',   // green-600
          statusWarning:    '#d97706',   // amber-600
          statusError:      '#dc2626',   // red-600
          statusInfo:       '#0891b2',   // cyan-600 — distinct from teal
          navDotColor:      '#14b8a6',   // teal-500 — matches Layout nav dot
          navLabelColor:    '#0f766e',   // teal-700 — matches Layout nav label
          tableHeaderBg:    '#ccfbf1',   // teal-100 — thead row fill
          inputBg:          '#ffffff',   // white    — input fields
          codeBg:           '#f0fdfa',   // teal-50  — <pre>/<code> blocks
          badgeNeutralBg:   '#ccfbf1',   // teal-100 — neutral chip / badge
          badgeNeutralText: '#115e59',   // teal-800 — badge label on teal-100
          toggleThumb:      '#ffffff',   // white    — switch knob
          // ── Accent tints — teal portal ─────────────────────────────────
          accentSubtleBg:     '#f0fdfa',   // teal-50  — lightest teal panel tint
          accentSubtleBorder: '#99f6e4',   // teal-200 — tinted panel border
          accentMutedBg:      '#ccfbf1',   // teal-100 — medium teal panel tint
          // ── Status panels — teal portal ──────────────────────────────────────
          statusSuccessBg:     '#f0fdf4',  // green-50
          statusSuccessBorder: '#dcfce7',  // green-100
          statusWarningBg:     '#fffbeb',  // amber-50
          statusWarningBorder: '#fde68a',  // amber-200
          statusErrorBg:       '#fef2f2',  // red-50
          statusErrorBorder:   '#fecaca',  // red-200
          statusInfoBg:        '#ecfeff',  // cyan-50 — matches statusInfo cyan-600
          statusInfoBorder:    '#cffafe',  // cyan-100
          // ── Nav dropdown panels — teal portal ────────────────────────────────
          navAuthSourcePanelBg: '#f0fdfa', // teal-50
          navAuthSourceAccent:  '#0d9488', // teal-600
          navDeptPanelBg:       '#f0fdfa', // teal-50
          navDeptAccent:        '#0d9488', // teal-600
          navSystemPanelBg:     '#f0fdfa', // teal-50
          navSystemAccent:      '#0d9488', // teal-600
          // ── Elevation overlays — teal portal ─────────────────────────────────
          bgElevation1:         '#ffffff',  // white — elevation via shadow in light mode
          bgElevation2:         '#f0fdfa',  // teal-50 — secondary/inset panels
        },
        // ── Dark — full teal palette ───────────────────────────────────────
        dark: {
          bgPage:           '#042f2e',   // teal-950 — deepest background
          bgSurface:        '#134e4a',   // teal-900 — card / panel surface
          bgSurfaceAlt:     '#115e59',   // teal-800 — sidebar / toolbar
          bgHover:          '#0d9488',   // teal-600 — row / item hover
          bgHighlight:      '#14b8a6',   // teal-500 — selected / focused state
          borderDefault:    '#0f766e',   // teal-700 — subtle border on dark bg
          borderStrong:     '#2dd4bf',   // teal-400 — emphasis border
          textPrimary:      '#f0fdfa',   // teal-50  — near-white body text
          textSecondary:    '#99f6e4',   // teal-200 — supporting text
          textMuted:        '#5eead4',   // teal-300 — muted / placeholder
          textLink:         '#5eead4',   // teal-300 — links on dark bg
          accentPrimary:    '#2dd4bf',   // teal-400
          accentOnPrimary:  '#042f2e',   // teal-950
          accentSecondary:  '#134e4a',   // teal-900
          btnPrimaryBg:     '#14b8a6',   // teal-500
          btnPrimaryText:   '#042f2e',   // teal-950
          btnSecondaryBg:   '#134e4a',   // teal-900
          btnSecondaryText: '#ccfbf1',   // teal-100
          statusSuccess:    '#4ade80',   // green-400
          statusWarning:    '#fbbf24',   // amber-400
          statusError:      '#f87171',   // red-400
          statusInfo:       '#38bdf8',   // sky-400
          navDotColor:      '#2dd4bf',   // teal-400 — matches Layout nav dot
          navLabelColor:    '#2dd4bf',   // teal-400 — matches Layout nav label
          tableHeaderBg:    '#115e59',   // teal-800 — thead, lighter than surface
          inputBg:          '#042f2e',   // teal-950 — flush with page bg
          codeBg:           '#021a18',   // near-black teal — <pre>/<code>
          badgeNeutralBg:   '#134e4a',   // teal-900
          badgeNeutralText: '#5eead4',   // teal-300
          toggleThumb:      '#ffffff',
          // ── Accent tints — teal portal dark ────────────────────────────
          accentSubtleBg:     '#0a2e2d',   // custom dark teal subtle panel
          accentSubtleBorder: '#0f766e',   // teal-700 — panel border
          accentMutedBg:      '#134e4a',   // teal-900 — medium teal panel tint
          // ── Status panels — teal portal dark ─────────────────────────────
          statusSuccessBg:     '#052e16',  // green-950
          statusSuccessBorder: '#166534',  // green-800
          statusWarningBg:     '#451a03',  // amber-950
          statusWarningBorder: '#92400e',  // amber-800
          statusErrorBg:       '#450a0a',  // red-950
          statusErrorBorder:   '#991b1b',  // red-800
          statusInfoBg:        '#083344',  // cyan-950
          statusInfoBorder:    '#155e75',  // cyan-800
          // ── Nav dropdown panels — teal portal dark ────────────────────────
          navAuthSourcePanelBg: '#042f2e', // teal-950
          navAuthSourceAccent:  '#2dd4bf', // teal-400
          navDeptPanelBg:       '#042f2e', // teal-950
          navDeptAccent:        '#2dd4bf', // teal-400
          navSystemPanelBg:     '#042f2e', // teal-950
          navSystemAccent:      '#2dd4bf', // teal-400
          // ── Elevation overlays — teal portal dark ────────────────────────
          bgElevation1:         '#ffffff0d', // 5% white — lifts above teal surface
          bgElevation2:         '#ffffff1f', // 12% white — modals and raised panels
        },
      },
    },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureTable(db: Database.Database): void {
  db.prepare(
    'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)'
  ).run();
}

// ─── Theme Library types + helpers ───────────────────────────────────────────

export interface ThemeLibraryEntry {
  id: string;
  name: string;
  createdAt: string;
  theme: ThemePair;
}

function readThemeLibrary(): ThemeLibraryEntry[] {
  let db: Database.Database | null = null;
  try {
    db = new Database(REGISTRY_DB_PATH, { readonly: true });
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(THEME_LIBRARY_KEY) as
      | { value: string }
      | undefined;
    if (!row) return [];
    return JSON.parse(row.value) as ThemeLibraryEntry[];
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function writeThemeLibrary(entries: ThemeLibraryEntry[]): void {
  const db = new Database(REGISTRY_DB_PATH);
  try {
    ensureTable(db);
    db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(THEME_LIBRARY_KEY, JSON.stringify(entries), new Date().toISOString());
  } finally {
    db.close();
  }
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (source === null || source === undefined) return target;
  if (typeof source !== 'object' || Array.isArray(source)) return source;
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const srcVal = (source as Record<string, unknown>)[key];
    if (typeof srcVal === 'object' && srcVal !== null && !Array.isArray(srcVal)) {
      result[key] = deepMerge((target as Record<string, unknown>)?.[key] ?? {}, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

export function readUXConfig(): UXConfig {
  let db: Database.Database | null = null;
  try {
    db = new Database(REGISTRY_DB_PATH, { readonly: true });
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(CONFIG_KEY) as
      | { value: string }
      | undefined;
    if (row) {
      const parsed = JSON.parse(row.value) as UXConfig;
      // Forward-compatibility: merge with defaults so new token keys are always present
      const merged = deepMerge(DEFAULT_UX_CONFIG, parsed) as UXConfig;
      // Ensure every saved scope theme also gets any new default tokens filled in
      for (const scope of Object.values(merged.scopes)) {
        scope.theme.light = { ...DEFAULT_LIGHT_TOKENS, ...scope.theme.light };
        scope.theme.dark  = { ...DEFAULT_DARK_TOKENS,  ...scope.theme.dark  };
      }
      return merged;
    }
  } catch {
    // Table may not exist yet on first run — fall through to defaults
  } finally {
    db?.close();
  }
  return structuredClone(DEFAULT_UX_CONFIG);
}

function writeUXConfig(config: UXConfig): void {
  const db = new Database(REGISTRY_DB_PATH);
  try {
    ensureTable(db);
    db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(CONFIG_KEY, JSON.stringify(config), new Date().toISOString());
  } finally {
    db.close();
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/ux-config
 *
 * Return the full UX configuration — `global` (light + dark
 * `ThemeTokens` pairs) plus every scope entry (`UXScopeConfig`).
 * Used by the UI on startup to inject CSS custom properties and
 * drive per-scope themes.
 *
 * @returns 200 — `{ success: true, data: { global: { light: ThemeTokens, dark: ThemeTokens }, scopes: { [scopeId]: UXScopeConfig } } }`
 * @throws  500 — disk read failure on the UX config file.
 */
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = readUXConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/ux-config
 *
 * Replace the entire UX configuration atomically. Both
 * `global.light` and `global.dark` are required (light/dark mode
 * is always available).
 *
 * @route   PUT /api/ux-config
 * @body    `UXConfig` (full): `{ global: { light: ThemeTokens, dark: ThemeTokens }, scopes: { [scopeId]: UXScopeConfig } }`
 * @returns 200 — `{ success: true, data: UXConfig }` after the file is written.
 * @throws  400 — `{ success: false, error: { message: 'Invalid UX config: missing global.light or global.dark', statusCode: 400 } }`.
 * @throws  500 — disk write failure.
 */
router.put('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as UXConfig;
    if (!body?.global?.light || !body?.global?.dark) {
      res.status(400).json({
        error: { message: 'Invalid UX config: missing global.light or global.dark', statusCode: 400 },
      });
      return;
    }
    writeUXConfig(body);
    res.json({ success: true, data: body });
  } catch (err) {
    next(err);
  }
});

// ─── Theme Library routes ────────────────────────────────────────────────────

/**
 * GET /api/ux-config/theme-library
 *
 * List every saved named theme in the library. Themes are stored
 * as `ThemeLibraryEntry` rows (id, name, createdAt, theme) and
 * ordered as in the file (no sort applied).
 *
 * @returns 200 — `{ success: true, data: ThemeLibraryEntry[] }` (empty array when no themes saved).
 * @throws  500 — disk read failure on the theme-library file.
 */
router.get('/theme-library', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: readThemeLibrary() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ux-config/theme-library
 *
 * Save a new named theme to the library. Upsert semantics on
 * `name` (case-insensitive, trimmed, capped at 80 chars): if a
 * theme with the same name exists, its `theme` is overwritten
 * in place; otherwise a new entry is appended with id
 * `theme-<ms>-<rand>`.
 *
 * @route   POST /api/ux-config/theme-library
 * @body    `{ name: string, theme: ThemePair }` — `name` is trimmed and capped at 80 chars.
 * @returns 200 — `{ success: true, data: ThemeLibraryEntry }` when an existing theme was overwritten.
 * @returns 201 — `{ success: true, data: ThemeLibraryEntry }` when a new theme was created.
 * @throws  400 — `name is required` or `theme.light and theme.dark are required`.
 * @throws  500 — disk write failure.
 */
router.post('/theme-library', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, theme } = req.body as { name?: string; theme?: ThemePair };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { message: 'name is required', statusCode: 400 } });
      return;
    }
    if (!theme?.light || !theme?.dark) {
      res.status(400).json({ error: { message: 'theme.light and theme.dark are required', statusCode: 400 } });
      return;
    }
    const entries = readThemeLibrary();
    const trimmedName = name.trim().slice(0, 80);
    const existingIdx = entries.findIndex(e => e.name.toLowerCase() === trimmedName.toLowerCase());
    if (existingIdx !== -1) {
      // Upsert: a theme with this name already exists — update its tokens in place
      entries[existingIdx] = { ...entries[existingIdx], theme };
      writeThemeLibrary(entries);
      res.json({ success: true, data: entries[existingIdx] });
      return;
    }
    const entry: ThemeLibraryEntry = {
      id: `theme-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: trimmedName,
      createdAt: new Date().toISOString(),
      theme,
    };
    entries.push(entry);
    writeThemeLibrary(entries);
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/ux-config/theme-library/:id
 *
 * Rename a saved theme. The new name must be unique
 * (case-insensitive) across the library.
 *
 * @route   PATCH /api/ux-config/theme-library/:id
 * @param   id — theme library entry id (path param).
 * @body    `{ name: string }` — trimmed and capped at 80 chars.
 * @returns 200 — `{ success: true, data: ThemeLibraryEntry }` after the rename.
 * @throws  400 — `name is required`.
 * @throws  404 — `Theme not found`.
 * @throws  409 — `A theme named "X" already exists`.
 * @throws  500 — disk write failure.
 */
router.patch('/theme-library/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { message: 'name is required', statusCode: 400 } });
      return;
    }
    const entries = readThemeLibrary();
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) {
      res.status(404).json({ error: { message: 'Theme not found', statusCode: 404 } });
      return;
    }
    const trimmedName = name.trim().slice(0, 80);
    const duplicate = entries.some(e => e.id !== id && e.name.toLowerCase() === trimmedName.toLowerCase());
    if (duplicate) {
      res.status(409).json({ error: { message: `A theme named "${trimmedName}" already exists`, statusCode: 409 } });
      return;
    }
    entries[idx] = { ...entries[idx], name: trimmedName };
    writeThemeLibrary(entries);
    res.json({ success: true, data: entries[idx] });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/ux-config/theme-library/:id
 *
 * Replace the token values (`light` + `dark` `ThemeTokens`) of a
 * saved theme. `name`, `id`, and `createdAt` are preserved.
 *
 * @route   PUT /api/ux-config/theme-library/:id
 * @param   id — theme library entry id (path param).
 * @body    `{ theme: ThemePair }` — both `light` and `dark` required.
 * @returns 200 — `{ success: true, data: ThemeLibraryEntry }` after the token replacement.
 * @throws  400 — `theme.light and theme.dark are required`.
 * @throws  404 — `Theme not found`.
 * @throws  500 — disk write failure.
 */
router.put('/theme-library/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { theme } = req.body as { theme?: ThemePair };
    if (!theme?.light || !theme?.dark) {
      res.status(400).json({ error: { message: 'theme.light and theme.dark are required', statusCode: 400 } });
      return;
    }
    const entries = readThemeLibrary();
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) {
      res.status(404).json({ error: { message: 'Theme not found', statusCode: 404 } });
      return;
    }
    entries[idx] = { ...entries[idx], theme };
    writeThemeLibrary(entries);
    res.json({ success: true, data: entries[idx] });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/ux-config/theme-library/:id
 *
 * Remove a saved theme from the library.
 *
 * @route   DELETE /api/ux-config/theme-library/:id
 * @param   id — theme library entry id (path param).
 * @returns 200 — `{ success: true }` (no `data` field).
 * @throws  404 — `Theme not found` (when the id is not in the library).
 * @throws  500 — disk write failure.
 */
router.delete('/theme-library/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const entries = readThemeLibrary();
    const next_entries = entries.filter(e => e.id !== id);
    if (next_entries.length === entries.length) {
      res.status(404).json({ error: { message: 'Theme not found', statusCode: 404 } });
      return;
    }
    writeThemeLibrary(next_entries);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/ux-config/:scopeId
 *
 * Update the global theme or a single named scope.
 *
 * - **`scopeId = "global"`** — deep-merges the request body into the
 *   current global `ThemePair` (so a `{ global: { light: { accentPrimary: "#..." } } }`
 *   shape only overwrites that one field; everything else is preserved).
 * - **`scopeId = <other>`** — if the scope doesn't exist yet, creates
 *   it as a `UXScopeConfig` (with `enabled: false` and a fresh clone
 *   of the current global theme); then deep-merges the request body
 *   into the scope. New scopes require `{ label, type }` in the body.
 *
 * **Routing note**: theme-library routes (`/theme-library`, `/theme-library/:id`)
 * are registered first so they match before this param route.
 *
 * @route   PATCH /api/ux-config/:scopeId
 * @param   scopeId — either the literal string `"global"` or any other scope id.
 * @body    For `global`: partial `ThemePair` (only the keys you want to update).
 *          For new non-global scopes: `{ label: string, type: string, ...partial UXScopeConfig }`.
 * @returns 200 — `{ success: true, data: UXConfig }` after the merge + write.
 * @throws  400 — `New scope requires label and type` when creating a new non-global scope without those fields.
 * @throws  500 — disk read/write failure on the UX config file.
 */
router.patch('/:scopeId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { scopeId } = req.params;
    const current = readUXConfig();

    if (scopeId === 'global') {
      current.global = deepMerge(current.global, req.body) as ThemePair;
    } else {
      if (!current.scopes[scopeId]) {
        const { label, type } = req.body as Partial<UXScopeConfig>;
        if (!label || !type) {
          res.status(400).json({
            error: { message: 'New scope requires label and type', statusCode: 400 },
          });
          return;
        }
        current.scopes[scopeId] = {
          id: scopeId,
          label,
          type,
          enabled: false,
          theme: {
            light: structuredClone(current.global.light),
            dark:  structuredClone(current.global.dark),
          },
        };
      }
      current.scopes[scopeId] = deepMerge(current.scopes[scopeId], req.body) as UXScopeConfig;
    }

    writeUXConfig(current);
    res.json({ success: true, data: current });
  } catch (err) {
    next(err);
  }
});

export { router as uxConfigRoutes };
