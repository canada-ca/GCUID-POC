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
 * Pre-built theme palettes for connector portal scopes.
 *
 * Two families, cleanly separated by hue to ensure no visual ambiguity:
 *   Auth sources (blue family): hues 195–235° — unambiguously blue
 *   Departments (purple family): hues 263–316° — unambiguously violet/purple
 *
 * No indigo variants (hue ~244°) appear in either family — these sit
 * perceptually between blue and purple and would create confusion in the picker.
 *
 * Names are prefixed so the theme library can be filtered by family:
 *   'Auth: <name>'  → authoritative source portals
 *   'Dept: <name>'  → department portals
 */

import type { ThemePair, ThemeTokens } from '../api/client';

// ─── Exported preset type ─────────────────────────────────────────────────────

export interface ConnectorThemePreset {
  /** Stored as the theme library entry name (prefixed). */
  name: string;
  family: 'auth' | 'dept';
  description: string;
  /** Primary light-mode accent hex — used for swatch display in the picker. */
  accentHex: string;
  theme: ThemePair;
}

// ─── Blue-family light-mode builder ──────────────────────────────────────────
// All blue themes share the same noetroniq navy dark backgrounds.
// Neutral status colours (success/warning/error) are fixed across all variants.
// Only accent-derived tokens vary.

function bl(
  accent:    string,  // accentPrimary, textLink, btnPrimaryBg, statusInfo, navDotColor, navLabelColor
  page:      string,  // bgPage, bgSurfaceAlt, codeBg, accentSubtleBg, statusInfoBg
  hover:     string,  // bgHover, accentMutedBg, btnSecondaryBg, tableHeaderBg, badgeNeutralBg
  border:    string,  // bgHighlight, borderDefault, accentSubtleBorder, accentSecondary
  borderS:   string,  // borderStrong
  navPanel:  string,  // navAuthSourcePanelBg
  navAcc:    string,  // navAuthSourceAccent, statusInfoBorder
): ThemeTokens {
  return {
    bgPage: page, bgSurface: '#ffffff', bgSurfaceAlt: page,
    bgHover: hover, bgHighlight: border,
    borderDefault: border, borderStrong: borderS,
    textPrimary:   '#273c51', textSecondary: '#334f6c', textMuted: '#6b7280',
    textLink: accent, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: border, btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: hover, btnSecondaryText: '#334f6c',
    statusSuccess: '#43a047', statusWarning: '#c99a4a',
    statusError:   '#a52c25', statusInfo:    accent,
    navDotColor:   accent, navLabelColor: accent,
    tableHeaderBg: hover,  inputBg: '#ffffff', codeBg: page,
    badgeNeutralBg: hover, badgeNeutralText: '#1b2937', toggleThumb: '#ffffff',
    accentSubtleBg: page, accentSubtleBorder: border, accentMutedBg: hover,
    statusSuccessBg: '#f5f7f4', statusSuccessBorder: '#81c784',
    statusWarningBg: '#faf8f2', statusWarningBorder: '#e9e1c9',
    statusErrorBg:   '#fef2f2', statusErrorBorder:   '#e57373',
    statusInfoBg: page, statusInfoBorder: navAcc,
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#1e1030', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#1f2937', navSystemAccent: '#9ca3af',
    bgElevation1: hover, bgElevation2: border,
  };
}

// ─── Blue-family dark-mode builder ───────────────────────────────────────────
// Uses noetroniq deep-navy backgrounds for all blue dark variants.

function bd(
  accent:   string,  // accentPrimary, btnPrimaryBg, statusInfo, navDotColor
  link:     string,  // textLink, navLabelColor, statusInfoBorder
  borderD:  string,  // borderDefault, accentSubtleBorder
  borderS:  string,  // borderStrong
  navPanel: string,  // navAuthSourcePanelBg
  navAcc:   string,  // navAuthSourceAccent
): ThemeTokens {
  return {
    bgPage: '#000f20', bgSurface: '#001730', bgSurfaceAlt: '#001f3f',
    bgHover: '#003d70', bgHighlight: '#00558c',
    borderDefault: borderD, borderStrong: borderS,
    textPrimary:   '#e6eef5', textSecondary: '#99bbd1', textMuted: '#6699ba',
    textLink: link, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: '#001f3f', btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#001f3f', btnSecondaryText: '#99bbd1',
    statusSuccess: '#66bb6a', statusWarning: '#ffa726',
    statusError:   '#ef5350', statusInfo:    accent,
    navDotColor:   accent,  navLabelColor: link,
    tableHeaderBg: '#001f3f', inputBg: '#000f20', codeBg: '#00080c',
    badgeNeutralBg: '#001f3f', badgeNeutralText: '#99bbd1', toggleThumb: '#ffffff',
    accentSubtleBg: '#001730', accentSubtleBorder: borderD, accentMutedBg: '#003d70',
    statusSuccessBg: '#001f3f', statusSuccessBorder: '#66bb6a',
    statusWarningBg: '#001f3f', statusWarningBorder: '#ffa726',
    statusErrorBg:   '#001f3f', statusErrorBorder:   '#ef5350',
    statusInfoBg: '#001f3f', statusInfoBorder: link,
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#100818', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#111827', navSystemAccent: '#6b7280',
    bgElevation1: '#001f3f', bgElevation2: '#003d70',
  };
}

// ─── Purple-family light-mode builder ────────────────────────────────────────
// All purple themes share the noetroniq deep-purple dark backgrounds.
// Info status is kept a neutral blue so it doesn't blend with purple accents.

function pl(
  accent:   string,
  page:     string,
  hover:    string,
  border:   string,
  borderS:  string,
  navPanel: string,  // navDeptPanelBg
  navAcc:   string,  // navDeptAccent
): ThemeTokens {
  return {
    bgPage: page, bgSurface: '#ffffff', bgSurfaceAlt: page,
    bgHover: hover, bgHighlight: border,
    borderDefault: border, borderStrong: borderS,
    textPrimary:   '#3e2d52', textSecondary: '#523c6d', textMuted: '#6b7280',
    textLink: accent, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: border, btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: hover, btnSecondaryText: '#523c6d',
    statusSuccess: '#43a047', statusWarning: '#c99a4a',
    statusError:   '#a52c25', statusInfo:    '#4d7aa7',  // neutral blue info
    navDotColor:   accent, navLabelColor: accent,
    tableHeaderBg: hover, inputBg: '#ffffff', codeBg: page,
    badgeNeutralBg: hover, badgeNeutralText: '#3e2d52', toggleThumb: '#ffffff',
    accentSubtleBg: page, accentSubtleBorder: border, accentMutedBg: hover,
    statusSuccessBg: '#f5f7f4', statusSuccessBorder: '#81c784',
    statusWarningBg: '#faf8f2', statusWarningBorder: '#e9e1c9',
    statusErrorBg:   '#fef2f2', statusErrorBorder:   '#e57373',
    statusInfoBg: '#f4f7fa', statusInfoBorder: '#64b5f6',
    navAuthSourcePanelBg: '#1e3a8a', navAuthSourceAccent: '#93c5fd',
    navDeptPanelBg: navPanel, navDeptAccent: navAcc,
    navSystemPanelBg: '#1f2937', navSystemAccent: '#9ca3af',
    bgElevation1: hover, bgElevation2: border,
  };
}

// ─── Purple-family dark-mode builder ─────────────────────────────────────────
// Uses noetroniq deep-purple backgrounds (see web-ui/src/data/connectorThemePresets.ts purple-family definitions below).
// Info status stays blue so it contrasts clearly with purple accents in dark mode.

function pd(
  accent:   string,
  link:     string,
  borderD:  string,
  borderS:  string,
  navPanel: string,
  navAcc:   string,
): ThemeTokens {
  return {
    bgPage: '#16101d', bgSurface: '#2a1f38', bgSurfaceAlt: '#3e2d52',
    bgHover: '#523c6d', bgHighlight: '#674b8a',
    borderDefault: borderD, borderStrong: borderS,
    textPrimary:   '#f0ecf8', textSecondary: '#d8c8e8', textMuted: '#a894bc',
    textLink: link, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: '#3e2d52', btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#3e2d52', btnSecondaryText: '#d8c8e8',
    statusSuccess: '#66bb6a', statusWarning: '#ffa726',
    statusError:   '#ef5350', statusInfo:    '#42a5f5',  // neutral blue info
    navDotColor:   accent, navLabelColor: link,
    tableHeaderBg: '#3e2d52', inputBg: '#16101d', codeBg: '#100a16',
    badgeNeutralBg: '#3e2d52', badgeNeutralText: '#d8c8e8', toggleThumb: '#ffffff',
    accentSubtleBg: '#2a1f38', accentSubtleBorder: borderD, accentMutedBg: '#523c6d',
    statusSuccessBg: '#2a1f38', statusSuccessBorder: '#66bb6a',
    statusWarningBg: '#2a1f38', statusWarningBorder: '#ffa726',
    statusErrorBg:   '#2a1f38', statusErrorBorder:   '#ef5350',
    statusInfoBg: '#2a1f38', statusInfoBorder: '#42a5f5',
    navAuthSourcePanelBg: '#1e3a8a', navAuthSourceAccent: '#93c5fd',
    navDeptPanelBg: navPanel, navDeptAccent: navAcc,
    navSystemPanelBg: '#111827', navSystemAccent: '#6b7280',
    bgElevation1: '#3e2d52', bgElevation2: '#523c6d',
  };
}

// ─── Burgundy/Red-family light-mode builder ───────────────────────────────────
// All burgundy/red themes use warm dark backgrounds grounded in noetroniq burgundy.
// Status colours avoid red for error states to prevent confusion with the red accent.

function rl(
  accent:   string,  // accentPrimary, textLink, btnPrimaryBg, navDotColor
  page:     string,  // bgPage, bgSurfaceAlt, accentSubtleBg, codeBg
  hover:    string,  // bgHover, accentMutedBg, btnSecondaryBg, tableHeaderBg
  border:   string,  // bgHighlight, borderDefault, accentSubtleBorder, accentSecondary
  borderS:  string,  // borderStrong
  navPanel: string,  // navAuthSourcePanelBg
  navAcc:   string,  // navAuthSourceAccent
): ThemeTokens {
  return {
    bgPage: page, bgSurface: '#ffffff', bgSurfaceAlt: page,
    bgHover: hover, bgHighlight: border,
    borderDefault: border, borderStrong: borderS,
    textPrimary:   '#3d0c0c', textSecondary: '#721817', textMuted: '#6b7280',
    textLink: accent, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: border, btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: hover, btnSecondaryText: '#721817',
    statusSuccess: '#43a047', statusWarning: '#c99a4a',
    statusError:   '#b71c1c', statusInfo:    '#4d7aa7',
    navDotColor:   accent, navLabelColor: accent,
    tableHeaderBg: hover,  inputBg: '#ffffff', codeBg: page,
    badgeNeutralBg: hover, badgeNeutralText: '#3d0c0c', toggleThumb: '#ffffff',
    accentSubtleBg: page, accentSubtleBorder: border, accentMutedBg: hover,
    statusSuccessBg: '#f5f7f4', statusSuccessBorder: '#81c784',
    statusWarningBg: '#faf8f2', statusWarningBorder: '#e9e1c9',
    statusErrorBg:   '#fef2f2', statusErrorBorder:   '#e57373',
    statusInfoBg: '#f4f7fa', statusInfoBorder: '#64b5f6',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#1e1030', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#1f2937', navSystemAccent: '#9ca3af',
    bgElevation1: hover, bgElevation2: border,
  };
}

// ─── Burgundy/Red-family dark-mode builder ────────────────────────────────────
// Uses noetroniq deep-burgundy backgrounds.

function rd(
  accent:   string,  // accentPrimary, btnPrimaryBg, navDotColor
  link:     string,  // textLink, navLabelColor
  borderD:  string,  // borderDefault, accentSubtleBorder
  borderS:  string,  // borderStrong
  navPanel: string,  // navAuthSourcePanelBg
  navAcc:   string,  // navAuthSourceAccent
): ThemeTokens {
  return {
    bgPage: '#0d0202', bgSurface: '#1a0505', bgSurfaceAlt: '#280a0a',
    bgHover: '#4a1010', bgHighlight: '#6b1818',
    borderDefault: borderD, borderStrong: borderS,
    textPrimary:   '#fef2f2', textSecondary: '#fca5a5', textMuted: '#cd8888',
    textLink: link, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: '#280a0a', btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#280a0a', btnSecondaryText: '#fca5a5',
    statusSuccess: '#66bb6a', statusWarning: '#ffa726',
    statusError:   '#ef9a9a', statusInfo:    '#42a5f5',
    navDotColor:   accent, navLabelColor: link,
    tableHeaderBg: '#280a0a', inputBg: '#0d0202', codeBg: '#060101',
    badgeNeutralBg: '#280a0a', badgeNeutralText: '#fca5a5', toggleThumb: '#ffffff',
    accentSubtleBg: '#1a0505', accentSubtleBorder: borderD, accentMutedBg: '#4a1010',
    statusSuccessBg: '#1a0505', statusSuccessBorder: '#66bb6a',
    statusWarningBg: '#1a0505', statusWarningBorder: '#ffa726',
    statusErrorBg:   '#1a0505', statusErrorBorder:   '#ef9a9a',
    statusInfoBg: '#1a0505', statusInfoBorder: '#42a5f5',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#100818', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#111827', navSystemAccent: '#6b7280',
    bgElevation1: '#280a0a', bgElevation2: '#4a1010',
  };
}

// ─── Amber/Gold-family light-mode builder ────────────────────────────────────
// All amber/gold themes use warm cream light backgrounds and dark amber textures.

function al(
  accent:   string,
  page:     string,
  hover:    string,
  border:   string,
  borderS:  string,
  navPanel: string,
  navAcc:   string,
): ThemeTokens {
  return {
    bgPage: page, bgSurface: '#ffffff', bgSurfaceAlt: page,
    bgHover: hover, bgHighlight: border,
    borderDefault: border, borderStrong: borderS,
    textPrimary:   '#3d2a00', textSecondary: '#614b25', textMuted: '#6b7280',
    textLink: accent, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: border, btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: hover, btnSecondaryText: '#614b25',
    statusSuccess: '#43a047', statusWarning: '#a67f3d',
    statusError:   '#a52c25', statusInfo:    '#4d7aa7',
    navDotColor:   accent, navLabelColor: accent,
    tableHeaderBg: hover,  inputBg: '#ffffff', codeBg: page,
    badgeNeutralBg: hover, badgeNeutralText: '#3d2a00', toggleThumb: '#ffffff',
    accentSubtleBg: page, accentSubtleBorder: border, accentMutedBg: hover,
    statusSuccessBg: '#f5f7f4', statusSuccessBorder: '#81c784',
    statusWarningBg: '#faf8f2', statusWarningBorder: '#e9e1c9',
    statusErrorBg:   '#fef2f2', statusErrorBorder:   '#e57373',
    statusInfoBg: '#f4f7fa', statusInfoBorder: '#64b5f6',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#1e1030', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#1f2937', navSystemAccent: '#9ca3af',
    bgElevation1: hover, bgElevation2: border,
  };
}

// ─── Amber/Gold-family dark-mode builder ─────────────────────────────────────
// Uses noetroniq deep amber-black backgrounds.

function ad(
  accent:   string,
  link:     string,
  borderD:  string,
  borderS:  string,
  navPanel: string,
  navAcc:   string,
): ThemeTokens {
  return {
    bgPage: '#110e06', bgSurface: '#231c0d', bgSurfaceAlt: '#413318',
    bgHover: '#614b25', bgHighlight: '#836531',
    borderDefault: borderD, borderStrong: borderS,
    textPrimary:   '#fefcf5', textSecondary: '#daccaa', textMuted: '#c7b285',
    textLink: link, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: '#413318', btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#413318', btnSecondaryText: '#daccaa',
    statusSuccess: '#66bb6a', statusWarning: '#ffa726',
    statusError:   '#ef5350', statusInfo:    '#42a5f5',
    navDotColor:   accent, navLabelColor: link,
    tableHeaderBg: '#413318', inputBg: '#110e06', codeBg: '#080601',
    badgeNeutralBg: '#413318', badgeNeutralText: '#daccaa', toggleThumb: '#ffffff',
    accentSubtleBg: '#231c0d', accentSubtleBorder: borderD, accentMutedBg: '#614b25',
    statusSuccessBg: '#231c0d', statusSuccessBorder: '#66bb6a',
    statusWarningBg: '#231c0d', statusWarningBorder: '#ffa726',
    statusErrorBg:   '#231c0d', statusErrorBorder:   '#ef5350',
    statusInfoBg: '#231c0d', statusInfoBorder: '#42a5f5',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#100818', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#111827', navSystemAccent: '#6b7280',
    bgElevation1: '#413318', bgElevation2: '#614b25',
  };
}

// ─── Orange-family light-mode builder ────────────────────────────────────────
// All orange themes use pale peach light backgrounds (noetroniq-orange-50/100/200).
// Deep orange-brown text (#431407 / #7c2d12) distinguishes these from amber themes
// which use gold-brown text (#3d2a00 / #614b25) on cream (#fefcf5) pages.
// Hue range: ~14–28° — true orange, not amber (35–55°) and not red (0–13°).

function ol(
  accent:   string,
  page:     string,
  hover:    string,
  border:   string,
  borderS:  string,
  navPanel: string,
  navAcc:   string,
): ThemeTokens {
  return {
    bgPage: page, bgSurface: '#ffffff', bgSurfaceAlt: page,
    bgHover: hover, bgHighlight: border,
    borderDefault: border, borderStrong: borderS,
    textPrimary:   '#431407', textSecondary: '#7c2d12', textMuted: '#6b7280',
    textLink: accent, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: border, btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: hover, btnSecondaryText: '#7c2d12',
    statusSuccess: '#43a047', statusWarning: '#c99a4a',
    statusError:   '#a52c25', statusInfo:    '#4d7aa7',
    navDotColor:   accent, navLabelColor: accent,
    tableHeaderBg: hover,  inputBg: '#ffffff', codeBg: page,
    badgeNeutralBg: hover, badgeNeutralText: '#431407', toggleThumb: '#ffffff',
    accentSubtleBg: page, accentSubtleBorder: border, accentMutedBg: hover,
    statusSuccessBg: '#f5f7f4', statusSuccessBorder: '#81c784',
    statusWarningBg: '#faf8f2', statusWarningBorder: '#e9e1c9',
    statusErrorBg:   '#fef2f2', statusErrorBorder:   '#e57373',
    statusInfoBg: '#f4f7fa', statusInfoBorder: '#64b5f6',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#1e1030', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#1f2937', navSystemAccent: '#9ca3af',
    bgElevation1: hover, bgElevation2: border,
  };
}

// ─── Orange-family dark-mode builder ─────────────────────────────────────────
// Anchored to noetroniq deep orange-blacks (orange-975 → orange-800).
// Warm orange-white text series: orange-50 → orange-200 → orange-300.

function od(
  accent:   string,
  link:     string,
  borderD:  string,
  borderS:  string,
  navPanel: string,
  navAcc:   string,
): ThemeTokens {
  return {
    bgPage: '#150702', bgSurface: '#2a0f05', bgSurfaceAlt: '#4f1d0a',
    bgHover: '#7c2d12', bgHighlight: '#9a3412',
    borderDefault: borderD, borderStrong: borderS,
    textPrimary:   '#fff7ed', textSecondary: '#fed7aa', textMuted: '#fdba74',
    textLink: link, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: '#4f1d0a', btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#4f1d0a', btnSecondaryText: '#fed7aa',
    statusSuccess: '#66bb6a', statusWarning: '#ffa726',
    statusError:   '#ef5350', statusInfo:    '#42a5f5',
    navDotColor:   accent, navLabelColor: link,
    tableHeaderBg: '#4f1d0a', inputBg: '#150702', codeBg: '#0c0400',
    badgeNeutralBg: '#4f1d0a', badgeNeutralText: '#fed7aa', toggleThumb: '#ffffff',
    accentSubtleBg: '#2a0f05', accentSubtleBorder: borderD, accentMutedBg: '#7c2d12',
    statusSuccessBg: '#2a0f05', statusSuccessBorder: '#66bb6a',
    statusWarningBg: '#2a0f05', statusWarningBorder: '#ffa726',
    statusErrorBg:   '#2a0f05', statusErrorBorder:   '#ef5350',
    statusInfoBg: '#2a0f05', statusInfoBorder: '#42a5f5',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#100818', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#111827', navSystemAccent: '#6b7280',
    bgElevation1: '#4f1d0a', bgElevation2: '#7c2d12',
  };
}

// ─── Green/Teal-family light-mode builder ────────────────────────────────────
// All green/teal themes share the muted forest green palette.

function gl(
  accent:   string,
  page:     string,
  hover:    string,
  border:   string,
  borderS:  string,
  navPanel: string,
  navAcc:   string,
): ThemeTokens {
  return {
    bgPage: page, bgSurface: '#ffffff', bgSurfaceAlt: page,
    bgHover: hover, bgHighlight: border,
    borderDefault: border, borderStrong: borderS,
    textPrimary:   '#182216', textSecondary: '#3d5636', textMuted: '#6b7280',
    textLink: accent, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: border, btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: hover, btnSecondaryText: '#3d5636',
    statusSuccess: '#43a047', statusWarning: '#c99a4a',
    statusError:   '#a52c25', statusInfo:    '#4d7aa7',
    navDotColor:   accent, navLabelColor: accent,
    tableHeaderBg: hover,  inputBg: '#ffffff', codeBg: page,
    badgeNeutralBg: hover, badgeNeutralText: '#182216', toggleThumb: '#ffffff',
    accentSubtleBg: page, accentSubtleBorder: border, accentMutedBg: hover,
    statusSuccessBg: '#f5f7f4', statusSuccessBorder: '#81c784',
    statusWarningBg: '#faf8f2', statusWarningBorder: '#e9e1c9',
    statusErrorBg:   '#fef2f2', statusErrorBorder:   '#e57373',
    statusInfoBg: '#f4f7fa', statusInfoBorder: '#64b5f6',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#1e1030', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#1f2937', navSystemAccent: '#9ca3af',
    bgElevation1: hover, bgElevation2: border,
  };
}

// ─── Green/Teal-family dark-mode builder ─────────────────────────────────────
// Uses noetroniq deep forest-black backgrounds.

function gd(
  accent:   string,
  link:     string,
  borderD:  string,
  borderS:  string,
  navPanel: string,
  navAcc:   string,
): ThemeTokens {
  return {
    bgPage: '#070906', bgSurface: '#0e130d', bgSurfaceAlt: '#182216',
    bgHover: '#30442b', bgHighlight: '#3d5636',
    borderDefault: borderD, borderStrong: borderS,
    textPrimary:   '#f5f7f4', textSecondary: '#b3c3ae', textMuted: '#8fa588',
    textLink: link, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: '#182216', btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#182216', btnSecondaryText: '#b3c3ae',
    statusSuccess: '#66bb6a', statusWarning: '#ffa726',
    statusError:   '#ef5350', statusInfo:    '#42a5f5',
    navDotColor:   accent, navLabelColor: link,
    tableHeaderBg: '#182216', inputBg: '#070906', codeBg: '#030503',
    badgeNeutralBg: '#182216', badgeNeutralText: '#b3c3ae', toggleThumb: '#ffffff',
    accentSubtleBg: '#0e130d', accentSubtleBorder: borderD, accentMutedBg: '#30442b',
    statusSuccessBg: '#0e130d', statusSuccessBorder: '#66bb6a',
    statusWarningBg: '#0e130d', statusWarningBorder: '#ffa726',
    statusErrorBg:   '#0e130d', statusErrorBorder:   '#ef5350',
    statusInfoBg: '#0e130d', statusInfoBorder: '#42a5f5',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#100818', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#111827', navSystemAccent: '#6b7280',
    bgElevation1: '#182216', bgElevation2: '#30442b',
  };
}

// ─── Auth Source Presets (Blue family — hues 195–235°) ───────────────────────
// Deliberately free of indigo (hue ~244°) to prevent confusion with purple themes.
// Light page washes match the accent family: standard blue, sky, or cyan.

export const AUTH_SOURCE_PRESETS: ConnectorThemePreset[] = [

  {
    name: 'Steel Blue',
    family: 'auth',
    description: 'Muted steel blue — calm and composed, a grounded mid-tone anchor for the blue family.',
    accentHex: '#4d7aa7',
    theme: {
      light: bl('#4d7aa7', '#f4f7fa', '#e7eef4', '#d0dde9', '#6f8fb0', '#1e3a8a', '#93c5fd'),
      dark:  bd('#42a5f5', '#64b5f6', '#3377a3', '#42a5f5', '#0d1d47', '#bfdbfe'),
    },
  },

  {
    name: 'Navy',
    family: 'auth',
    description: 'Deep, rich navy — the darkest and most formal of the blue family.',
    accentHex: '#1e3a8a',
    theme: {
      light: bl('#1e3a8a', '#eef2ff', '#e0e7ff', '#c7d2fe', '#3b5b9e', '#0f1f50', '#a5b4fc'),
      dark:  bd('#93c5fd', '#bfdbfe', '#1d4ed8', '#93c5fd', '#0a0f30', '#dbeafe'),
    },
  },

  {
    name: 'Northern Sky',
    family: 'auth',
    description: 'Clear Canadian sky blue — open, approachable, distinctly northern.',
    accentHex: '#0284c7',
    theme: {
      light: bl('#0284c7', '#f0f9ff', '#e0f2fe', '#bae6fd', '#38bdf8', '#075985', '#7dd3fc'),
      dark:  bd('#38bdf8', '#7dd3fc', '#0284c7', '#38bdf8', '#041d30', '#bae6fd'),
    },
  },

  {
    name: 'Marine',
    family: 'auth',
    description: 'Deep marine blue — strong and composed, the blue of open ocean.',
    accentHex: '#0369a1',
    theme: {
      light: bl('#0369a1', '#f0f9ff', '#e0f2fe', '#bae6fd', '#0ea5e9', '#0c4a6e', '#7dd3fc'),
      dark:  bd('#0ea5e9', '#38bdf8', '#0369a1', '#0ea5e9', '#041a2e', '#bae6fd'),
    },
  },

  {
    name: 'Arctic',
    family: 'auth',
    description: 'Crystalline cyan-blue — crisp, precise, evoking the clarity of northern ice.',
    accentHex: '#0891b2',
    theme: {
      light: bl('#0891b2', '#ecfeff', '#cffafe', '#a5f3fc', '#22d3ee', '#164e63', '#67e8f9'),
      dark:  bd('#22d3ee', '#67e8f9', '#0891b2', '#22d3ee', '#031a22', '#a5f3fc'),
    },
  },

  {
    name: 'Sapphire',
    family: 'auth',
    description: 'Vivid sapphire blue — deeply saturated, the rich primary blue of the gemstone.',
    accentHex: '#2563eb',
    theme: {
      light: bl('#2563eb', '#eff6ff', '#dbeafe', '#bfdbfe', '#60a5fa', '#1e3a8a', '#93c5fd'),
      dark:  bd('#60a5fa', '#93c5fd', '#2563eb', '#60a5fa', '#0d1d47', '#bfdbfe'),
    },
  },

  {
    name: 'Delft',
    family: 'auth',
    description: 'Traditional Delft blue — a strong, refined artisan blue with centuries of recognition.',
    accentHex: '#1566c0',
    theme: {
      light: bl('#1566c0', '#eff6ff', '#dbeafe', '#bfdbfe', '#3b82f6', '#0e3d70', '#93c5fd'),
      dark:  bd('#4b87f9', '#60a5fa', '#1566c0', '#4b87f9', '#0a2040', '#bfdbfe'),
    },
  },

  {
    name: 'Cerulean',
    family: 'auth',
    description: 'Pure, vivid cerulean — clean and saturated, unmistakably blue.',
    accentHex: '#0066cc',
    theme: {
      light: bl('#0066cc', '#eff6ff', '#dbeafe', '#bfdbfe', '#2196f3', '#004a96', '#93c5fd'),
      dark:  bd('#40a3ff', '#6cb8ff', '#0066cc', '#40a3ff', '#002a5c', '#bfdbfe'),
    },
  },

  {
    name: 'Cornflower',
    family: 'auth',
    description: 'Soft cornflower blue — approachable and calm, a classic lighter accent.',
    accentHex: '#4a86c8',
    theme: {
      light: bl('#4a86c8', '#eff6ff', '#dbeafe', '#bfdbfe', '#78aade', '#1a4d80', '#bfdbfe'),
      dark:  bd('#6fa9e0', '#8fc2f0', '#4a86c8', '#6fa9e0', '#0e2d50', '#c7e3fa'),
    },
  },

  {
    name: 'Lapis',
    family: 'auth',
    description: 'Rich lapis lazuli — the deep, mineral blue of the ancient gemstone.',
    accentHex: '#1e40af',
    theme: {
      light: bl('#1e40af', '#eff6ff', '#dbeafe', '#bfdbfe', '#3b82f6', '#12266a', '#93c5fd'),
      dark:  bd('#3b82f6', '#60a5fa', '#1e40af', '#3b82f6', '#08123a', '#bfdbfe'),
    },
  },

];

// ─── Department Presets (Purple family — hues 263–316°) ──────────────────────
// Deliberately uses only violet, purple, and fuchsia hues — no indigo overlap.
// Light page washes use violet-50 or fuchsia-50 depending on the accent family.

export const DEPT_PRESETS: ConnectorThemePreset[] = [

  {
    name: 'Violet',
    family: 'dept',
    description: 'Pure, saturated violet — the definitive mid-point of the purple family.',
    accentHex: '#7c3aed',
    theme: {
      light: pl('#7c3aed', '#f5f3ff', '#ede9fe', '#ddd6fe', '#8b5cf6', '#4c1d95', '#c4b5fd'),
      dark:  pd('#a78bfa', '#c4b5fd', '#7c3aed', '#a78bfa', '#1e0a40', '#ddd6fe'),
    },
  },

  {
    name: 'Byzantium',
    family: 'dept',
    description: 'Deep Byzantine violet — the historic colour of imperial authority and distinction.',
    accentHex: '#6d28d9',
    theme: {
      light: pl('#6d28d9', '#f5f3ff', '#ede9fe', '#ddd6fe', '#7c3aed', '#3b0764', '#c4b5fd'),
      dark:  pd('#8b5cf6', '#c4b5fd', '#6d28d9', '#8b5cf6', '#180330', '#ddd6fe'),
    },
  },

  {
    name: 'Amethyst',
    family: 'dept',
    description: 'Deep amethyst violet — the rich, precious purple of the gemstone.',
    accentHex: '#7e22ce',
    theme: {
      light: pl('#7e22ce', '#faf5ff', '#f3e8ff', '#e9d5ff', '#9333ea', '#4a0072', '#d8b4fe'),
      dark:  pd('#a855f7', '#d8b4fe', '#7e22ce', '#a855f7', '#1e0033', '#e9d5ff'),
    },
  },

  {
    name: 'Damson',
    family: 'dept',
    description: 'Deep damson — the dark blue-purple of the damson plum, rich and intense.',
    accentHex: '#5b21b6',
    theme: {
      light: pl('#5b21b6', '#f5f3ff', '#ede9fe', '#ddd6fe', '#6d28d9', '#2e0568', '#c4b5fd'),
      dark:  pd('#7c3aed', '#c4b5fd', '#5b21b6', '#7c3aed', '#140228', '#ddd6fe'),
    },
  },

  {
    name: 'Iris',
    family: 'dept',
    description: 'Vivid iris purple — bold and saturated, the colour of the iris flower in full bloom.',
    accentHex: '#9333ea',
    theme: {
      light: pl('#9333ea', '#faf5ff', '#f3e8ff', '#e9d5ff', '#a855f7', '#5b21b6', '#d8b4fe'),
      dark:  pd('#c084fc', '#e9d5ff', '#9333ea', '#c084fc', '#240545', '#f3e8ff'),
    },
  },

  {
    name: 'Mauve',
    family: 'dept',
    description: 'Refined mauve — desaturated and understated, a calm muted violet.',
    accentHex: '#7d5ba6',
    theme: {
      light: pl('#7d5ba6', '#f7f5f9', '#eeeaf3', '#ddd5e7', '#947bb0', '#3e2d52', '#c4b5fd'),
      dark:  pd('#b59ed0', '#d4bde8', '#7d5ba6', '#b59ed0', '#1a1028', '#ddd6fe'),
    },
  },

  {
    name: 'Thistle',
    family: 'dept',
    description: 'Soft thistle violet — approachable and light, a classic mid-register purple.',
    accentHex: '#8b5cf6',
    theme: {
      light: pl('#8b5cf6', '#f5f3ff', '#ede9fe', '#ddd6fe', '#a78bfa', '#4c1d95', '#c4b5fd'),
      dark:  pd('#c4b5fd', '#ddd6fe', '#8b5cf6', '#c4b5fd', '#1e0a40', '#ede9fe'),
    },
  },

  {
    name: 'Mulberry',
    family: 'dept',
    description: 'Deep mulberry — the dark fuchsia-purple of the mulberry fruit, bold and vivid.',
    accentHex: '#86198f',
    theme: {
      light: pl('#86198f', '#fdf4ff', '#fae8ff', '#f5d0fe', '#a21caf', '#4a0072', '#f0abfc'),
      dark:  pd('#e879f9', '#f5d0fe', '#86198f', '#e879f9', '#250030', '#fae8ff'),
    },
  },

  {
    name: 'Orchid',
    family: 'dept',
    description: 'Vivid orchid — the fuchsia-purple of the orchid flower, bold and distinctive.',
    accentHex: '#a21caf',
    theme: {
      light: pl('#a21caf', '#fdf4ff', '#fae8ff', '#f5d0fe', '#c026d3', '#701a75', '#f0abfc'),
      dark:  pd('#d946ef', '#f5d0fe', '#a21caf', '#d946ef', '#300033', '#fae8ff'),
    },
  },

  {
    name: 'Plum',
    family: 'dept',
    description: 'Deep rose-purple plum — warm and distinguished, a refined departmental accent.',
    accentHex: '#673780',
    theme: {
      light: pl('#673780', '#fdf4ff', '#fae8ff', '#f3d2f5', '#9d6baa', '#3c1a4c', '#d8b4fe'),
      dark:  pd('#b07bc8', '#d4aadf', '#673780', '#b07bc8', '#1e0d2a', '#e9d5ff'),
    },
  },

];

// ─── Burgundy / Red Presets ───────────────────────────────────────────────────
// Hues ~340–15° (deep reds, crimsons, and burgundies).
// Three variants near the "cardinal" range, plus broader red spectrum coverage.

export const BURGUNDY_PRESETS: ConnectorThemePreset[] = [

  {
    name: 'Cardinal',
    family: 'auth',
    description: 'Deep cardinal red — bold and authoritative, the signature red of ceremonial distinction.',
    accentHex: '#9b1c1c',
    theme: {
      light: rl('#9b1c1c', '#fef2f2', '#fecaca', '#fca5a5', '#dc2626', '#5f0808', '#fca5a5'),
      dark:  rd('#ef4444', '#fca5a5', '#dc2626', '#ef4444', '#3f0808', '#fecaca'),
    },
  },

  {
    name: 'Crimson',
    family: 'auth',
    description: 'Vivid crimson — the saturated red of ceremony and command, bold and unmistakable.',
    accentHex: '#b91c1c',
    theme: {
      light: rl('#b91c1c', '#fff1f2', '#fecdd3', '#fda4af', '#e11d48', '#6f0014', '#fda4af'),
      dark:  rd('#fb7185', '#fda4af', '#e11d48', '#fb7185', '#3f000d', '#fecdd3'),
    },
  },

  {
    name: 'Scarlet',
    family: 'auth',
    description: 'Pure scarlet — vibrant and energetic, the red of urgency and strong statement.',
    accentHex: '#dc2626',
    theme: {
      light: rl('#dc2626', '#fff1f2', '#fecdd3', '#fda4af', '#f43f5e', '#7f1d1d', '#fda4af'),
      dark:  rd('#f87171', '#fca5a5', '#dc2626', '#f87171', '#4a0f0f', '#fecaca'),
    },
  },

  {
    name: 'Claret',
    family: 'auth',
    description: 'Deep claret — the dark wine red of refined restraint and sophisticated authority.',
    accentHex: '#721817',
    theme: {
      light: rl('#721817', '#fef2f2', '#fee2e2', '#fecaca', '#a52c25', '#3d0c0c', '#fca5a5'),
      dark:  rd('#ef4444', '#fca5a5', '#a52c25', '#ef4444', '#280808', '#fecaca'),
    },
  },

  {
    name: 'Garnet',
    family: 'auth',
    description: 'Dark garnet — the deep red of the gemstone, earthy and precious with warm undertones.',
    accentHex: '#7f1d1d',
    theme: {
      light: rl('#7f1d1d', '#fef2f2', '#fee2e2', '#fecaca', '#991b1b', '#450a0a', '#fca5a5'),
      dark:  rd('#fca5a5', '#fed7aa', '#991b1b', '#fca5a5', '#2d0808', '#fee2e2'),
    },
  },

];

// ─── Amber / Gold Presets ─────────────────────────────────────────────────────
// Hues ~35–55° (warm amber, gold, and harvest tones).
// Three variants near the "crown gold" range, plus deeper/lighter coverage.

export const AMBER_PRESETS: ConnectorThemePreset[] = [

  {
    name: 'Crown Gold',
    family: 'dept',
    description: 'Rich crown gold — the deep ceremonial gold of sovereign distinction and heritage.',
    accentHex: '#d4af37',
    theme: {
      light: al('#d4af37', '#fefcf5', '#faf8f2', '#e9e1c9', '#a67f3d', '#614b25', '#daccaa'),
      dark:  ad('#d4af37', '#daccaa', '#836531', '#a67f3d', '#3a2710', '#e9e1c9'),
    },
  },

  {
    name: 'Sovereign',
    family: 'dept',
    description: 'Deep sovereign amber — richer and warmer than gold, evocative of centuries of tradition.',
    accentHex: '#a67f3d',
    theme: {
      light: al('#a67f3d', '#faf8f2', '#f4f0e4', '#e9e1c9', '#836531', '#413318', '#e9e1c9'),
      dark:  ad('#c99a4a', '#daccaa', '#614b25', '#836531', '#231c0d', '#e9e1c9'),
    },
  },

  {
    name: 'Harvest',
    family: 'dept',
    description: 'Warm harvest gold — the golden-amber of ripe fields, earthy and abundant.',
    accentHex: '#c99a4a',
    theme: {
      light: al('#c99a4a', '#faf8f2', '#f4f0e4', '#daccaa', '#a67f3d', '#413318', '#e9e1c9'),
      dark:  ad('#daccaa', '#e9e1c9', '#836531', '#c99a4a', '#2d1d0a', '#f4f0e4'),
    },
  },

  {
    name: 'Saffron',
    family: 'dept',
    description: 'Vivid saffron — the bright, saturated gold of the precious spice, warm and bold.',
    accentHex: '#ea580c',
    theme: {
      light: al('#ea580c', '#fff7ed', '#ffedd5', '#fed7aa', '#f97316', '#431407', '#fdba74'),
      dark:  ad('#fb923c', '#fdba74', '#ea580c', '#fb923c', '#1c0a02', '#fed7aa'),
    },
  },

  {
    name: 'Marigold',
    family: 'dept',
    description: 'Bright marigold — the bold amber-orange of the flower, lively and energetic.',
    accentHex: '#f59e0b',
    theme: {
      light: al('#f59e0b', '#fffbeb', '#fef3c7', '#fde68a', '#d97706', '#451a03', '#fde68a'),
      dark:  ad('#fbbf24', '#fde68a', '#d97706', '#fbbf24', '#1c0d01', '#fef3c7'),
    },
  },

];

// ─── Orange Presets ───────────────────────────────────────────────────────────
// Hue range ~14–28° — true orange, perceptibly warmer than amber (35–55°) and
// cooler than red (0–13°). Pale peach page backgrounds (noetroniq-orange-50/100)
// and vivid orange-to-burnt accents make the family immediately distinct from
// amber's cream pages and gold-brown tones.
// Ten variants cover vivid, earthy, bright, light, and dark registers.

export const ORANGE_PRESETS: ConnectorThemePreset[] = [

  {
    name: 'Flame',
    family: 'dept',
    description: 'Pure vivid flame orange — the canonical saturated orange, energetic and unmistakable.',
    accentHex: '#f97316',
    theme: {
      light: ol('#f97316', '#fff7ed', '#ffedd5', '#fed7aa', '#fb923c', '#431407', '#fdba74'),
      dark:  od('#fb923c', '#fdba74', '#c2410c', '#f97316', '#220c02', '#fed7aa'),
    },
  },

  {
    name: 'Tangerine',
    family: 'dept',
    description: 'Bright tangerine — the vivid citrus orange of the fruit, lighter and fresher than flame.',
    accentHex: '#fb923c',
    theme: {
      light: ol('#fb923c', '#fff7ed', '#ffedd5', '#fed7aa', '#f97316', '#431407', '#fdba74'),
      dark:  od('#fdba74', '#fed7aa', '#ea580c', '#fb923c', '#220c02', '#fed7aa'),
    },
  },

  {
    name: 'Pumpkin',
    family: 'dept',
    description: 'Classic pumpkin orange — the earthy seasonal orange of the autumn harvest, grounded and warm.',
    accentHex: '#ea6320',
    theme: {
      light: ol('#ea6320', '#fff7ed', '#ffedd5', '#fed7aa', '#f97316', '#431407', '#fdba74'),
      dark:  od('#f77a38', '#fdba74', '#c2410c', '#ea6320', '#220c02', '#fed7aa'),
    },
  },

  {
    name: 'Ember',
    family: 'dept',
    description: 'Deep ember orange — the intense, smoldering orange of dying coals, rich and warming.',
    accentHex: '#c2410c',
    theme: {
      light: ol('#c2410c', '#fff7ed', '#ffedd5', '#fed7aa', '#ea580c', '#431407', '#fdba74'),
      dark:  od('#ea580c', '#fb923c', '#9a3412', '#c2410c', '#220c02', '#fed7aa'),
    },
  },

  {
    name: 'Forge',
    family: 'dept',
    description: 'Dark forge orange — the deep burnt orange of heated metal cooling, authoritative and intense.',
    accentHex: '#9a3412',
    theme: {
      light: ol('#9a3412', '#fff7ed', '#ffedd5', '#fed7aa', '#c2410c', '#431407', '#fdba74'),
      dark:  od('#c2410c', '#ea580c', '#7c2d12', '#9a3412', '#220c02', '#fed7aa'),
    },
  },

  {
    name: 'Clementine',
    family: 'dept',
    description: 'Vivid clementine — the bright, fresh orange of the small citrus fruit, lively and approachable.',
    accentHex: '#f98a18',
    theme: {
      light: ol('#f98a18', '#fff7ed', '#ffedd5', '#fed7aa', '#fb923c', '#431407', '#fdba74'),
      dark:  od('#fda048', '#fdba74', '#c2410c', '#f98a18', '#220c02', '#fed7aa'),
    },
  },

  {
    name: 'Copper',
    family: 'dept',
    description: 'Burnished copper — the warm, metallic orange-brown of the refined metal, dignified and distinctive.',
    accentHex: '#a83a10',
    theme: {
      light: ol('#a83a10', '#fff7ed', '#ffedd5', '#fed7aa', '#c2410c', '#431407', '#fdba74'),
      dark:  od('#d05018', '#fb923c', '#9a3412', '#a83a10', '#220c02', '#fed7aa'),
    },
  },

  {
    name: 'Persimmon',
    family: 'dept',
    description: 'Deep persimmon — the rich, warm orange of the ripened fruit, vivid and substantial.',
    accentHex: '#d14413',
    theme: {
      light: ol('#d14413', '#fff7ed', '#ffedd5', '#fed7aa', '#c2410c', '#431407', '#fdba74'),
      dark:  od('#e85e20', '#fb923c', '#9a3412', '#d14413', '#220c02', '#fed7aa'),
    },
  },

  {
    name: 'Apricot',
    family: 'dept',
    description: 'Warm apricot — a softer, lighter orange with peach undertones, welcoming and open.',
    accentHex: '#e87c3e',
    theme: {
      light: ol('#e87c3e', '#fff7ed', '#ffedd5', '#fed7aa', '#fb923c', '#431407', '#fdba74'),
      dark:  od('#f4a063', '#fdba74', '#c2410c', '#e87c3e', '#220c02', '#fed7aa'),
    },
  },

  {
    name: 'Cinnabar',
    family: 'dept',
    description: 'Bold cinnabar — the deep red-orange of the mineral pigment, the most red-leaning of the orange family.',
    accentHex: '#cc3310',
    theme: {
      light: ol('#cc3310', '#fff7ed', '#ffedd5', '#fed7aa', '#c2410c', '#431407', '#fdba74'),
      dark:  od('#e04c20', '#fb923c', '#9a3412', '#cc3310', '#220c02', '#fed7aa'),
    },
  },

];

// ─── Green / Teal Presets ─────────────────────────────────────────────────────
// Hues ~130–185° (forest green, sage, teal, and sea glass).
// Three variants near the "jade reef" range, plus broader coverage.

export const GREEN_PRESETS: ConnectorThemePreset[] = [

  {
    name: 'Jade Reef',
    family: 'dept',
    description: 'Deep jade reef — the lustrous green of jade stone meeting tropical water, rich and cool.',
    accentHex: '#0f766e',
    theme: {
      light: gl('#0f766e', '#f0fdfa', '#ccfbf1', '#99f6e4', '#14b8a6', '#042f2e', '#5eead4'),
      dark:  gd('#2dd4bf', '#5eead4', '#0f766e', '#2dd4bf', '#011714', '#99f6e4'),
    },
  },

  {
    name: 'Forest',
    family: 'dept',
    description: 'Deep forest green — the dark, rich green of old-growth timber and sheltered woodland.',
    accentHex: '#166534',
    theme: {
      light: gl('#166534', '#f0fdf4', '#dcfce7', '#bbf7d0', '#22c55e', '#052e16', '#86efac'),
      dark:  gd('#4ade80', '#86efac', '#166534', '#4ade80', '#011c0b', '#bbf7d0'),
    },
  },

  {
    name: 'Fern',
    family: 'dept',
    description: 'Muted fern green — the natural, desaturated green of ferns and forest undergrowth.',
    accentHex: '#4a6741',
    theme: {
      light: gl('#4a6741', '#f5f7f4', '#e8ede6', '#d1dccf', '#6e8667', '#182216', '#b3c3ae'),
      dark:  gd('#8fa588', '#b3c3ae', '#4a6741', '#8fa588', '#070906', '#d1dccf'),
    },
  },

  {
    name: 'Sage',
    family: 'dept',
    description: 'Soft sage — the muted, silvery grey-green of culinary herbs, calm and understated.',
    accentHex: '#6e8667',
    theme: {
      light: gl('#6e8667', '#f5f7f4', '#e8ede6', '#d1dccf', '#8fa588', '#243321', '#b3c3ae'),
      dark:  gd('#b3c3ae', '#d1dccf', '#6e8667', '#b3c3ae', '#0e130d', '#e8ede6'),
    },
  },

  {
    name: 'Verdigris',
    family: 'dept',
    description: 'Aged verdigris — the patinated blue-green of aged copper, distinguished and timeworn.',
    accentHex: '#4d7470',
    theme: {
      light: gl('#4d7470', '#f4f8f7', '#e6eeec', '#ceddd9', '#668b86', '#1a2624', '#aec5c1'),
      dark:  gd('#87a6a1', '#aec5c1', '#4d7470', '#87a6a1', '#070a09', '#ceddd9'),
    },
  },

];

// ─── Grey/Neutral-family light-mode builder ──────────────────────────────────
// Desaturated cool-grey page washes with grey or slate-grey accents.
// Info stays blue so it reads clearly against neutral backgrounds.

function nl(
  accent:   string,  // accentPrimary, textLink, btnPrimaryBg, navDotColor
  page:     string,  // bgPage, bgSurfaceAlt, accentSubtleBg, codeBg
  hover:    string,  // bgHover, accentMutedBg, btnSecondaryBg, tableHeaderBg
  border:   string,  // bgHighlight, borderDefault, accentSubtleBorder, accentSecondary
  borderS:  string,  // borderStrong
  navPanel: string,  // navAuthSourcePanelBg
  navAcc:   string,  // navAuthSourceAccent
): ThemeTokens {
  return {
    bgPage: page, bgSurface: '#ffffff', bgSurfaceAlt: page,
    bgHover: hover, bgHighlight: border,
    borderDefault: border, borderStrong: borderS,
    textPrimary:   '#111827', textSecondary: '#374151', textMuted: '#6b7280',
    textLink: accent, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: border, btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: hover, btnSecondaryText: '#374151',
    statusSuccess: '#43a047', statusWarning: '#c99a4a',
    statusError:   '#a52c25', statusInfo:    '#4d7aa7',
    navDotColor:   accent, navLabelColor: accent,
    tableHeaderBg: hover,  inputBg: '#ffffff', codeBg: page,
    badgeNeutralBg: hover, badgeNeutralText: '#111827', toggleThumb: '#ffffff',
    accentSubtleBg: page, accentSubtleBorder: border, accentMutedBg: hover,
    statusSuccessBg: '#f5f7f4', statusSuccessBorder: '#81c784',
    statusWarningBg: '#faf8f2', statusWarningBorder: '#e9e1c9',
    statusErrorBg:   '#fef2f2', statusErrorBorder:   '#e57373',
    statusInfoBg: '#f4f7fa', statusInfoBorder: '#64b5f6',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#1e1030', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#1f2937', navSystemAccent: '#9ca3af',
    bgElevation1: hover, bgElevation2: border,
  };
}

// ─── Grey/Neutral-family dark-mode builder ────────────────────────────────────
// Uses deep cool-grey backgrounds — not navy, not warm. Pure professional grey.

function nd(
  accent:   string,  // accentPrimary, btnPrimaryBg, navDotColor
  link:     string,  // textLink, navLabelColor
  borderD:  string,  // borderDefault, accentSubtleBorder
  borderS:  string,  // borderStrong
  navPanel: string,  // navAuthSourcePanelBg
  navAcc:   string,  // navAuthSourceAccent
): ThemeTokens {
  return {
    bgPage: '#090c14', bgSurface: '#111827', bgSurfaceAlt: '#1f2937',
    bgHover: '#374151', bgHighlight: '#4b5563',
    borderDefault: borderD, borderStrong: borderS,
    textPrimary:   '#f9fafb', textSecondary: '#d1d5db', textMuted: '#9ca3af',
    textLink: link, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: '#1f2937', btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#1f2937', btnSecondaryText: '#d1d5db',
    statusSuccess: '#66bb6a', statusWarning: '#ffa726',
    statusError:   '#ef5350', statusInfo:    '#42a5f5',
    navDotColor:   accent, navLabelColor: link,
    tableHeaderBg: '#1f2937', inputBg: '#090c14', codeBg: '#030508',
    badgeNeutralBg: '#1f2937', badgeNeutralText: '#d1d5db', toggleThumb: '#ffffff',
    accentSubtleBg: '#111827', accentSubtleBorder: borderD, accentMutedBg: '#374151',
    statusSuccessBg: '#111827', statusSuccessBorder: '#66bb6a',
    statusWarningBg: '#111827', statusWarningBorder: '#ffa726',
    statusErrorBg:   '#111827', statusErrorBorder:   '#ef5350',
    statusInfoBg: '#111827', statusInfoBorder: '#42a5f5',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#100818', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#111827', navSystemAccent: '#6b7280',
    bgElevation1: '#1f2937', bgElevation2: '#374151',
  };
}

// ─── Grey / Neutral Presets ───────────────────────────────────────────────────
// Achromatic and near-achromatic themes for minimal, professional interfaces.

export const GREY_PRESETS: ConnectorThemePreset[] = [

  {
    name: 'Graphite',
    family: 'auth',
    description: 'Deep graphite — the darkest neutral, clean and architectural, for serious professional contexts.',
    accentHex: '#374151',
    theme: {
      light: nl('#374151', '#f9fafb', '#f3f4f6', '#e5e7eb', '#9ca3af', '#1f2937', '#9ca3af'),
      dark:  nd('#9ca3af', '#d1d5db', '#4b5563', '#6b7280', '#0d1117', '#d1d5db'),
    },
  },

  {
    name: 'Slate',
    family: 'auth',
    description: 'Cool slate grey — a composed blue-grey neutral with quiet presence and reliable legibility.',
    accentHex: '#48627f',
    theme: {
      light: nl('#48627f', '#f8f9fb', '#edf0f3', '#d8dfe6', '#6e7d8f', '#1a2a38', '#a2aebc'),
      dark:  nd('#a2aebc', '#c1cad4', '#4a5866', '#6e7d8f', '#0d1319', '#c1cad4'),
    },
  },

  {
    name: 'Pewter',
    family: 'auth',
    description: 'Soft pewter — a warm mid-tone grey with understated refinement, light without being stark.',
    accentHex: '#6b7280',
    theme: {
      light: nl('#6b7280', '#f9fafb', '#f3f4f6', '#e5e7eb', '#9ca3af', '#374151', '#d1d5db'),
      dark:  nd('#d1d5db', '#e5e7eb', '#4b5563', '#9ca3af', '#090c14', '#e5e7eb'),
    },
  },

];

// ─── True-greyscale base / chromatic accent — light-mode builder ──────────────
// Page, surface, border, and text tokens are all achromatic (R ≈ G ≈ B).
// Only accent, button, link, and nav tokens carry colour.

function tgl(
  accent:     string,  // accentPrimary, btnPrimaryBg, navDotColor
  link:       string,  // textLink, navLabelColor
  subtleBg:   string,  // accentSubtleBg  (very light accent tint)
  subtleBdr:  string,  // accentSubtleBorder
  mutedBg:    string,  // accentMutedBg
  navPanel:   string,  // navAuthSourcePanelBg
  navAcc:     string,  // navAuthSourceAccent
): ThemeTokens {
  return {
    bgPage: '#fafafa', bgSurface: '#ffffff', bgSurfaceAlt: '#f5f5f5',
    bgHover: '#f5f5f5', bgHighlight: '#e5e5e5',
    borderDefault: '#e5e5e5', borderStrong: '#a3a3a3',
    textPrimary:   '#171717', textSecondary: '#404040', textMuted: '#737373',
    textLink: link, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: '#e5e5e5', btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#f5f5f5', btnSecondaryText: '#404040',
    statusSuccess: '#16a34a', statusWarning: '#d97706',
    statusError:   '#dc2626', statusInfo:    '#2563eb',
    navDotColor: accent, navLabelColor: link,
    tableHeaderBg: '#f5f5f5', inputBg: '#ffffff', codeBg: '#f5f5f5',
    badgeNeutralBg: '#e5e5e5', badgeNeutralText: '#171717', toggleThumb: '#ffffff',
    accentSubtleBg: subtleBg, accentSubtleBorder: subtleBdr, accentMutedBg: mutedBg,
    statusSuccessBg: '#f0fdf4', statusSuccessBorder: '#86efac',
    statusWarningBg: '#fffbeb', statusWarningBorder: '#fde68a',
    statusErrorBg:   '#fef2f2', statusErrorBorder:   '#fca5a5',
    statusInfoBg: '#eff6ff', statusInfoBorder: '#93c5fd',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#1e1030', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#262626', navSystemAccent: '#a3a3a3',
    bgElevation1: '#f5f5f5', bgElevation2: '#e5e5e5',
  };
}

// ─── True-greyscale base / chromatic accent — dark-mode builder ───────────────
// Same achromatic foundation; accent colour provides the only chromatic signal.

function tgd(
  accent:    string,  // accentPrimary, btnPrimaryBg, navDotColor
  link:      string,  // textLink, navLabelColor
  borderD:   string,  // borderDefault (slight accent warmth in dark mode)
  subtleBdr: string,  // accentSubtleBorder
  navPanel:  string,  // navAuthSourcePanelBg
  navAcc:    string,  // navAuthSourceAccent
): ThemeTokens {
  return {
    bgPage: '#0a0a0a', bgSurface: '#171717', bgSurfaceAlt: '#262626',
    bgHover: '#404040', bgHighlight: '#525252',
    borderDefault: borderD, borderStrong: '#737373',
    textPrimary:   '#fafafa', textSecondary: '#d4d4d4', textMuted: '#a3a3a3',
    textLink: link, accentPrimary: accent, accentOnPrimary: '#ffffff',
    accentSecondary: '#262626', btnPrimaryBg: accent, btnPrimaryText: '#ffffff',
    btnSecondaryBg: '#262626', btnSecondaryText: '#d4d4d4',
    statusSuccess: '#4ade80', statusWarning: '#fbbf24',
    statusError:   '#f87171', statusInfo:    '#60a5fa',
    navDotColor: accent, navLabelColor: link,
    tableHeaderBg: '#262626', inputBg: '#0a0a0a', codeBg: '#050505',
    badgeNeutralBg: '#262626', badgeNeutralText: '#d4d4d4', toggleThumb: '#ffffff',
    accentSubtleBg: '#171717', accentSubtleBorder: subtleBdr, accentMutedBg: '#404040',
    statusSuccessBg: '#171717', statusSuccessBorder: '#4ade80',
    statusWarningBg: '#171717', statusWarningBorder: '#fbbf24',
    statusErrorBg:   '#171717', statusErrorBorder:   '#f87171',
    statusInfoBg: '#171717', statusInfoBorder: '#60a5fa',
    navAuthSourcePanelBg: navPanel, navAuthSourceAccent: navAcc,
    navDeptPanelBg:   '#100818', navDeptAccent:   '#c084fc',
    navSystemPanelBg: '#0a0a0a', navSystemAccent: '#737373',
    bgElevation1: '#262626', bgElevation2: '#404040',
  };
}

// ─── Chrome Presets (true greyscale base + vivid accent) ─────────────────────
// All page/surface/border/text tokens are achromatic. The accent is the sole
// source of colour — giving each theme a distinct character on a neutral canvas.

export const CHROME_PRESETS: ConnectorThemePreset[] = [

  {
    name: 'Zinc',
    family: 'auth',
    description: 'Pure neutral grey base with a vivid violet accent — clean, modern, and decisive.',
    accentHex: '#7c3aed',
    theme: {
      light: tgl('#7c3aed', '#7c3aed', '#f5f3ff', '#ddd6fe', '#ede9fe', '#1e0a3c', '#c4b5fd'),
      dark:  tgd('#a78bfa', '#c4b5fd', '#3b2a6b', '#7c3aed', '#1e0a3c', '#c4b5fd'),
    },
  },

  {
    name: 'Titanium',
    family: 'auth',
    description: 'Pure neutral grey base with a deep teal accent — precise, technical, and composed.',
    accentHex: '#0d9488',
    theme: {
      light: tgl('#0d9488', '#0d9488', '#f0fdfa', '#99f6e4', '#ccfbf1', '#0d2e2b', '#5eead4'),
      dark:  tgd('#2dd4bf', '#5eead4', '#134e4a', '#0d9488', '#031a18', '#5eead4'),
    },
  },

  {
    name: 'Tungsten',
    family: 'auth',
    description: 'Pure neutral grey base with a warm amber accent — substantial, grounded, and authoritative.',
    accentHex: '#d97706',
    theme: {
      light: tgl('#d97706', '#b45309', '#fffbeb', '#fde68a', '#fef3c7', '#1c1007', '#fbbf24'),
      dark:  tgd('#fbbf24', '#fde68a', '#78350f', '#d97706', '#1c1007', '#fde68a'),
    },
  },

];

// ─── Combined export ──────────────────────────────────────────────────────────

export const ALL_CONNECTOR_PRESETS: ConnectorThemePreset[] = [
  ...AUTH_SOURCE_PRESETS,
  ...DEPT_PRESETS,
  ...BURGUNDY_PRESETS,
  ...AMBER_PRESETS,
  ...ORANGE_PRESETS,
  ...GREEN_PRESETS,
  ...GREY_PRESETS,
  ...CHROME_PRESETS,
];

// ─── Spectral sort utilities ─────────────────────────────────────────────────

/** HSL hue (0–360) derived from a #rrggbb hex string. */
export function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r)      h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else                h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/**
 * Spectral hue for sorting: deep reds (hue ≥ 330°) wrap to negative values so
 * they sort before orange-reds and before the blues/purples.
 * Result range: approximately −30 … 330, increasing red → orange → … → purple.
 */
function spectralHue(hex: string): number {
  const h = hexToHue(hex);
  return h >= 330 ? h - 360 : h;
}

/**
 * Sort theme entries (presets or library entries) into spectral (hue-ascending) order:
 * reds first → blues → deep purples last.
 * Reads the hue from `entry.theme.light.accentPrimary`.
 */
export function sortThemeEntriesByHue<T extends { theme: { light: { accentPrimary: string } } }>(
  entries: T[],
): T[] {
  return [...entries].sort(
    (a, b) => spectralHue(a.theme.light.accentPrimary) - spectralHue(b.theme.light.accentPrimary),
  );
}
