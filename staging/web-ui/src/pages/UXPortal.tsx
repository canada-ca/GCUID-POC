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
import { useState, useEffect, useLayoutEffect, useCallback, useRef, memo, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  uxConfigApi,
  connectorsApi,
  themeLibraryApi,
  UXConfig,
  ThemeTokens,
  ThemePair,
  UXScopeConfig,
  ThemeLibraryEntry,
} from '../api/client';
import { UXScopeWrapper } from '../context/UXThemeContext';
import { useTheme } from '../hooks/useTheme';
import { sortThemeEntriesByHue } from '../data/connectorThemePresets';

/** Deep-clone a JSON-serializable value. */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─── Token metadata ───────────────────────────────────────────────────────────

interface TokenMeta {
  label: string;
  description: string;
}

const TOKEN_META: Record<keyof ThemeTokens, TokenMeta> = {
  bgPage:           { label: 'Page Background',      description: 'Main page / canvas background colour' },
  bgSurface:        { label: 'Surface Background',   description: 'Cards, panels, and dialog backgrounds' },
  bgSurfaceAlt:     { label: 'Alt Surface',          description: 'Alternating row or section background' },
  bgHover:          { label: 'Hover',                description: 'Background applied on element hover' },
  bgHighlight:      { label: 'Highlight',            description: 'Selected items and active-state backgrounds' },
  borderDefault:    { label: 'Default Border',       description: 'Standard element outlines and dividers' },
  borderStrong:     { label: 'Strong Border',        description: 'Emphasis borders and heavy dividers' },
  textPrimary:      { label: 'Primary Text',         description: 'Main body and heading text' },
  textSecondary:    { label: 'Secondary Text',       description: 'Supporting text and labels' },
  textMuted:        { label: 'Muted Text',           description: 'De-emphasised text and placeholders' },
  textLink:         { label: 'Link Text',            description: 'Hyperlinks and interactive text colour' },
  accentPrimary:    { label: 'Primary Accent',       description: 'Brand colour — buttons and key indicators' },
  accentOnPrimary:  { label: 'On Accent',            description: 'Text / icons displayed on primary accent' },
  accentSecondary:  { label: 'Secondary Accent',     description: 'Supporting accent for highlights and tags' },
  btnPrimaryBg:     { label: 'Primary Button BG',    description: 'Primary action button background' },
  btnPrimaryText:   { label: 'Primary Button Text',  description: 'Text on primary action buttons' },
  btnSecondaryBg:   { label: 'Secondary Button BG',  description: 'Secondary / ghost button background' },
  btnSecondaryText: { label: 'Secondary Button Text',description: 'Text on secondary buttons' },
  statusSuccess:    { label: 'Success',              description: 'Positive actions and success-state colour' },
  statusWarning:    { label: 'Warning',              description: 'Caution and warning state colour' },
  statusError:      { label: 'Error',                description: 'Error and failure state colour' },
  statusInfo:       { label: 'Info',                 description: 'Informational callout colour' },
  navDotColor:      { label: 'Nav Dot',              description: 'Active navigation indicator dot colour (portal overrides apply within scope)' },
  navLabelColor:    { label: 'Nav Label / Accent Text', description: 'Navigation label and portal accent text colour — used for highlighted labels, links, and inline badges' },
  navAuthSourcePanelBg: { label: 'Auth Sources Dropdown BG',   description: 'Background of the Authoritative Sources nav dropdown panel' },
  navAuthSourceAccent:  { label: 'Auth Sources Active Colour', description: 'Active item text and trigger border colour for the Authoritative Sources dropdown' },
  navDeptPanelBg:       { label: 'Departments Dropdown BG',    description: 'Background of the Departments nav dropdown panel' },
  navDeptAccent:        { label: 'Departments Active Colour',  description: 'Active item text and trigger border colour for the Departments dropdown' },
  navSystemPanelBg:     { label: 'System Dropdown BG',         description: 'Background of the System nav dropdown panel' },
  navSystemAccent:      { label: 'System Active Colour',       description: 'Active item text and trigger border colour for the System dropdown' },
  tableHeaderBg:    { label: 'Table Header BG',      description: 'thead row fill colour' },
  inputBg:          { label: 'Input Background',     description: '<input> and <select> field fill' },
  codeBg:           { label: 'Code Block BG',        description: '<code> and <pre> block background' },
  badgeNeutralBg:   { label: 'Badge BG (Neutral)',   description: 'Default neutral badge fill colour' },
  badgeNeutralText: { label: 'Badge Text (Neutral)', description: 'Default neutral badge label colour' },
  toggleThumb:      { label: 'Toggle Thumb',         description: 'Toggle switch knob colour' },
  // Accent tints
  accentSubtleBg:      { label: 'Accent Subtle BG',     description: 'Lightest portal-tint — pagination active btn, stat panels, row hover' },
  accentSubtleBorder:  { label: 'Accent Subtle Border',  description: 'Border for portal-accent-tinted panels and cards' },
  accentMutedBg:       { label: 'Accent Muted BG',       description: 'Deeper portal-accent tint for badges and selected rows' },
  // Status panels
  statusSuccessBg:     { label: 'Success Panel BG',      description: 'Success alert and callout panel background' },
  statusSuccessBorder: { label: 'Success Panel Border',  description: 'Success alert and callout panel border colour' },
  statusWarningBg:     { label: 'Warning Panel BG',      description: 'Warning alert and callout panel background' },
  statusWarningBorder: { label: 'Warning Panel Border',  description: 'Warning alert and callout panel border colour' },
  statusErrorBg:       { label: 'Error Panel BG',        description: 'Error alert and callout panel background' },
  statusErrorBorder:   { label: 'Error Panel Border',    description: 'Error alert and callout panel border colour' },
  statusInfoBg:        { label: 'Info Panel BG',         description: 'Informational alert and callout panel background' },
  statusInfoBorder:    { label: 'Info Panel Border',     description: 'Informational alert and callout panel border colour' },
  // Elevation overlays
  bgElevation1:        { label: 'Elevation 1 (Low)',      description: 'Translucent overlay for low-profile cards and inset panels — supports RGBA hex (e.g. #ffffff0d)' },
  bgElevation2:        { label: 'Elevation 2 (Mid)',      description: 'Translucent overlay for modals and raised panels — supports RGBA hex (e.g. #ffffff1f)' },
};

// ─── Token groups ─────────────────────────────────────────────────────────────

interface TokenGroup {
  title: string;
  tokens: (keyof ThemeTokens)[];
  globalOnly?: boolean;
}

const TOKEN_GROUPS: TokenGroup[] = [
  { title: 'Backgrounds', tokens: ['bgPage', 'bgSurface', 'bgSurfaceAlt', 'bgHover', 'bgHighlight', 'bgElevation1', 'bgElevation2'] },
  { title: 'Borders',     tokens: ['borderDefault', 'borderStrong'] },
  { title: 'Text',        tokens: ['textPrimary', 'textSecondary', 'textMuted', 'textLink'] },
  { title: 'Accent',       tokens: ['accentPrimary', 'accentOnPrimary', 'accentSecondary'] },
  { title: 'Accent Tints', tokens: ['accentSubtleBg', 'accentSubtleBorder', 'accentMutedBg'] },
  { title: 'Buttons',      tokens: ['btnPrimaryBg', 'btnPrimaryText', 'btnSecondaryBg', 'btnSecondaryText'] },
  { title: 'Status',       tokens: ['statusSuccess', 'statusWarning', 'statusError', 'statusInfo'] },
  { title: 'Status Panels', tokens: ['statusSuccessBg', 'statusSuccessBorder', 'statusWarningBg', 'statusWarningBorder', 'statusErrorBg', 'statusErrorBorder', 'statusInfoBg', 'statusInfoBorder'] },
  { title: 'Navigation',  tokens: ['navDotColor', 'navLabelColor', 'navAuthSourcePanelBg', 'navAuthSourceAccent', 'navDeptPanelBg', 'navDeptAccent', 'navSystemPanelBg', 'navSystemAccent'] },
  { title: 'Tables & Data', tokens: ['tableHeaderBg'] },
  { title: 'Forms & Inputs', tokens: ['inputBg'] },
  { title: 'Code Blocks',  tokens: ['codeBg'] },
  { title: 'Badges & Tags', tokens: ['badgeNeutralBg', 'badgeNeutralText'] },
  { title: 'Widgets',      tokens: ['toggleThumb'] },
];

// ─── Library dropdown swatch weights ──────────────────────────────────────────
// flex reflects proportional visual coverage on a typical rendered page:
// backgrounds dominate → borders and status colours are the narrowest slices.
const LOAD_SWATCH_TOKENS: { key: keyof ThemeTokens; flex: number }[] = [
  { key: 'bgPage',        flex: 4   },  // entire page background
  { key: 'bgSurface',     flex: 2.5 },  // cards and panels
  { key: 'accentPrimary', flex: 1.5 },  // interactive / brand colour
  { key: 'btnPrimaryBg',  flex: 1   },  // primary action buttons
  { key: 'textPrimary',   flex: 1.2 },  // body text
  { key: 'borderDefault', flex: 0.5 },  // borders and dividers
];

// ─── ColorRow ─────────────────────────────────────────────────────────────────

function ColorRow({
  tokenKey,
  value,
  resetValue,
  onChange,
  onReset,
}: {
  tokenKey: keyof ThemeTokens;
  value: string;
  resetValue: string;
  onChange: (key: keyof ThemeTokens, hex: string) => void;
  onReset: (key: keyof ThemeTokens) => void;
}) {
  const meta = TOKEN_META[tokenKey];

  // Guard: stored config may be missing newly-added tokens — fall back through defaults to a safe grey
  const safeValue = (value ?? resetValue ?? '#808080') as string;

  const isDirty = safeValue !== resetValue;

  return (
    <div className="flex items-center gap-3 py-2.5 px-4 hover:bg-ux-hover/40 rounded-md group">
      {/* Swatch — the color input is absolutely overlaid so the browser anchors
          the picker popup at the swatch's actual screen position, not the top
          of the document (which is what sr-only / position:absolute causes). */}
      <div className="relative shrink-0 w-8 h-8">
        <div
          className="w-8 h-8 rounded border-2 border-ux-border shadow-sm transition-all group-hover:scale-105"
          style={{ backgroundColor: safeValue }}
        />
        <input
          type="color"
          value={safeValue.length === 9 ? safeValue.slice(0, 7) : safeValue}
          onChange={e => {
            // Native color picker always returns 6-digit #RRGGBB.
            // Preserve any alpha suffix (#RRGGBBAA) the user may have typed.
            const alpha = safeValue.length === 9 ? safeValue.slice(7) : '';
            onChange(tokenKey, e.target.value + alpha);
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded"
          title={`Pick colour for ${meta.label}`}
          aria-label={`Colour picker for ${meta.label}`}
        />
      </div>
      {/* Labels */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ux-text leading-tight">
          {meta.label}
        </p>
        <p className="text-xs text-ux-text-muted truncate">{meta.description}</p>
      </div>
      {/* Hex value */}
      <input
        type="text"
        value={safeValue}
        onChange={e => {
          const v = e.target.value;
          if (/^#[0-9a-fA-F]{0,8}$/.test(v)) onChange(tokenKey, v);
        }}
        onBlur={e => {
          if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(e.target.value)) onChange(tokenKey, resetValue);
        }}
        maxLength={9}
        className="w-24 text-xs font-mono text-center border border-ux-border rounded px-2 py-1 bg-ux-surface text-ux-text focus:outline-none focus:ring-1 focus:ring-ux-accent"
        aria-label={`Hex value for ${meta.label}`}
      />
      {/* Alpha slider */}
      {(() => {
        const alphaHex = safeValue.length === 9 ? safeValue.slice(7) : 'ff';
        const alphaInt = parseInt(alphaHex, 16);
        const alphaPct = Math.round(alphaInt / 255 * 100);
        return (
          <div className="flex items-center gap-1 shrink-0" title="Opacity / alpha channel">
            <input
              type="range"
              min={0}
              max={255}
              value={alphaInt}
              onChange={e => {
                const a = Number(e.target.value);
                const rgb = safeValue.slice(0, 7);
                if (a >= 255) {
                  onChange(tokenKey, rgb);
                } else {
                  onChange(tokenKey, rgb + a.toString(16).padStart(2, '0'));
                }
              }}
              className="w-16 h-1.5 accent-ux-accent cursor-pointer"
              aria-label={`Alpha for ${meta.label}`}
            />
            <span className="text-[10px] font-mono text-ux-text-muted w-7 text-right leading-none">
              {alphaPct}%
            </span>
          </div>
        );
      })()}
      {/* Reset */}
      <button
        type="button"
        onClick={() => onReset(tokenKey)}
        disabled={!isDirty}
        title="Reset to default"
        className="shrink-0 text-xs text-ux-text-muted hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-0 disabled:pointer-events-none transition-opacity"
      >
        ↩
      </button>
    </div>
  );
}

// ─── TokenGroupSection ────────────────────────────────────────────────────────

function TokenGroupSection({
  group,
  tokens,
  globalTokens,
  onChange,
  onReset,
}: {
  group: TokenGroup;
  tokens: ThemeTokens;
  globalTokens: ThemeTokens;
  onChange: (key: keyof ThemeTokens, hex: string) => void;
  onReset: (key: keyof ThemeTokens) => void;
}) {
  return (
    <div className="border border-ux-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-ux-surface-alt border-b border-ux-border">
        <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider">
          {group.title}
        </h3>
      </div>
      <div className="divide-y divide-ux-border/50">
        {group.tokens.map(key => (
          <ColorRow
            key={key}
            tokenKey={key}
            value={tokens[key]}
            resetValue={globalTokens[key]}
            onChange={onChange}
            onReset={onReset}
          />
        ))}
      </div>
    </div>
  );
}

// ─── ScopeNavItem ─────────────────────────────────────────────────────────────

function ScopeNavItem({
  id: _id,
  label,
  isSelected,
  isDirty,
  typeColor,
  onClick,
}: {
  id: string;
  label: string;
  isSelected: boolean;
  isDirty: boolean;
  typeColor: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-md flex items-center gap-2.5 text-sm transition-colors ${
        isSelected
          ? 'bg-[#d4af37]/15 dark:bg-[#d4af37]/20 text-ux-text font-medium'
          : 'text-ux-text-sub hover:bg-ux-hover/50'
      }`}
    >
      <span className={`shrink-0 w-2 h-2 rounded-full ${typeColor}`} />
      <span className="flex-1 truncate">{label}</span>
      {isDirty && (
        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved changes" />
      )}
    </button>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

/** Static portal scopes that don't come from the connectors list. */
const STATIC_PORTALS = [
  { id: 'portal-self-service', label: 'Self-Service',    description: 'Public identity registration and lookup portal' },
  { id: 'portal-help-desk',    label: 'Help Desk',       description: 'Assisted identity lookup and registration portal' },
  { id: 'portal-gcuid',        label: 'GCUID Services',  description: 'Identity administration and lifecycle management' },
  { id: 'portal-corp-apps',    label: 'Corporate Apps',  description: 'Corporate application catalogue (budget, travel, procurement, …)' },
  { id: 'portal-system',       label: 'System',          description: 'Options, logs, dashboard, tools, and databases' },
] as const;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ─── Theme Preview Overlay ────────────────────────────────────────────────────
// Renders ONCE. Navigation and mode changes mutate CSS custom properties and text
// nodes directly via refs — zero React re-renders after mount.

interface ThemePreviewOverlayProps {
  entries:     ThemeLibraryEntry[];
  initialIdx:  number;
  initialMode: 'light' | 'dark';
  onClose:     () => void;
}

const _statusBg = (base: string, bg: string | undefined) => bg || base + '20';

function buildPreviewVars(t: ThemeTokens): Record<string, string> {
  return {
    '--p-bgPage':        t.bgPage,
    '--p-bgSurface':     t.bgSurface,
    '--p-textPrimary':   t.textPrimary,
    '--p-textSecondary': t.textSecondary,
    '--p-textMuted':     t.textMuted,
    '--p-textLink':      t.textLink,
    '--p-borderDefault': t.borderDefault,
    '--p-accentPrimary': t.accentPrimary,
    '--p-btnPrimaryBg':  t.btnPrimaryBg,
    '--p-btnPrimaryText':t.btnPrimaryText,
    '--p-btnSecBg':      t.btnSecondaryBg,
    '--p-btnSecText':    t.btnSecondaryText,
    '--p-statusSuccess': t.statusSuccess,
    '--p-statusWarning': t.statusWarning,
    '--p-statusError':   t.statusError,
    // derived
    '--p-accentA20':    t.accentPrimary + '20',
    '--p-accentA22':    t.accentPrimary + '22',
    '--p-tableHeader':  t.tableHeaderBg || t.bgSurfaceAlt || t.bgHover || t.bgSurface,
    '--p-ssBg':         _statusBg(t.statusSuccess, t.statusSuccessBg),
    '--p-swBg':         _statusBg(t.statusWarning, t.statusWarningBg),
    '--p-seBg':         _statusBg(t.statusError,   t.statusErrorBg),
    '--p-bgHighlight':  t.bgHighlight || t.accentSubtleBg || t.accentPrimary + '18',
    '--p-modeHover':    t.bgHover || t.accentPrimary + '18',
  };
}

const ARROW_ON = { backgroundColor: 'rgba(255,255,255,0.20)', color: 'white', cursor: 'pointer' } as const;

const ThemePreviewOverlay = memo(function ThemePreviewOverlay({
  entries, initialIdx, initialMode, onClose,
}: ThemePreviewOverlayProps) {
  const idxRef  = useRef(initialIdx);
  const modeRef = useRef<'light' | 'dark'>(initialMode);

  const containerRef  = useRef<HTMLDivElement>(null);
  const nameRef       = useRef<HTMLSpanElement>(null);
  const counterRef    = useRef<HTMLSpanElement>(null);
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const prevRef       = useRef<HTMLButtonElement>(null);
  const nextRef       = useRef<HTMLButtonElement>(null);

  /** Apply current idx/mode to the DOM without any React re-render. */
  const applyState = useCallback(() => {
    const idx   = idxRef.current;
    const mode  = modeRef.current;
    const entry = entries[idx];
    const t     = entry?.theme[mode];
    const el    = containerRef.current;
    if (!entry || !t || !el) return;

    // Swap all colour tokens in one pass
    for (const [k, v] of Object.entries(buildPreviewVars(t))) el.style.setProperty(k, v ?? '');

    // Update the few text nodes that change between themes
    if (nameRef.current)    nameRef.current.textContent    = entry.name;
    if (counterRef.current) counterRef.current.textContent = `${idx + 1} / ${entries.length}`;
    if (modeButtonRef.current) {
      modeButtonRef.current.textContent = mode === 'light' ? '\u2600 Light' : '\u263e Dark';
      modeButtonRef.current.title       = mode === 'light' ? 'Switch to dark' : 'Switch to light';
    }
  }, [entries]);

  // Sync DOM if entries prop changes (TanStack Query re-fetch)
  useLayoutEffect(() => { applyState(); }, [applyState]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const i = idxRef.current;
      if      (e.key === 'Escape')     onClose();
      else if (e.key === 'ArrowLeft')  { idxRef.current = (i - 1 + entries.length) % entries.length; applyState(); }
      else if (e.key === 'ArrowRight') { idxRef.current = (i + 1) % entries.length; applyState(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entries.length, onClose, applyState]);

  const entry0 = entries[initialIdx];
  const t0     = entry0?.theme[initialMode];
  if (!entry0 || !t0) return null;

  // Initial inline style: sets the CSS vars on first paint
  const initStyle = {
    ...buildPreviewVars(t0),
    backgroundColor: 'var(--p-bgPage)',
  } as unknown as React.CSSProperties;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center gap-3 w-full max-w-5xl" onClick={e => e.stopPropagation()}>

        {/* Left arrow — only shown when browsing multiple entries */}
        {entries.length > 1 && (
          <button ref={prevRef} type="button"
            onClick={() => { const i = idxRef.current; idxRef.current = (i - 1 + entries.length) % entries.length; applyState(); }}
            className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-2xl backdrop-blur-sm select-none"
            style={ARROW_ON} title="Previous theme (←)">&#8249;</button>
        )}

        {/* Modal — colours driven entirely by CSS custom properties; never re-renders */}
        <div ref={containerRef}
          className="flex-1 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
          style={initStyle}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
          style={{ backgroundColor: 'var(--p-bgSurface)', borderColor: 'var(--p-borderDefault)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--p-accentPrimary)' }} />
            <span ref={nameRef} className="text-sm font-semibold" style={{ color: 'var(--p-textPrimary)' }}>{entry0.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--p-accentA20)', color: 'var(--p-accentPrimary)' }}>Preview</span>
          </div>
          <div className="flex items-center gap-3">
            {entries.length > 1 && (
              <span ref={counterRef} className="text-xs" style={{ color: 'var(--p-textMuted)' }}>
                {initialIdx + 1} / {entries.length}
              </span>
            )}
            <button ref={modeButtonRef} type="button"
              onClick={() => { modeRef.current = modeRef.current === 'light' ? 'dark' : 'light'; applyState(); }}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
              style={{ backgroundColor: 'var(--p-modeHover)', color: 'var(--p-textSecondary)' }}
              title="Toggle light / dark">
              {initialMode === 'light' ? '\u2600 Light' : '\u263e Dark'}
            </button>
            <button type="button" onClick={onClose}
              className="text-base leading-none opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: 'var(--p-textPrimary)' }} title="Close (Esc)">&#x2715;</button>
          </div>
        </div>

        {/* Mock page */}
        <div className="flex overflow-hidden" style={{ height: 500 }}>

          {/* Sidebar */}
          <div className="w-44 shrink-0 flex flex-col border-r"
            style={{ backgroundColor: 'var(--p-bgSurface)', borderColor: 'var(--p-borderDefault)' }}>
            <div className="px-4 py-3 border-b flex items-center gap-2.5"
              style={{ borderColor: 'var(--p-borderDefault)' }}>
              <div className="w-5 h-5 rounded" style={{ backgroundColor: 'var(--p-accentPrimary)' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--p-textPrimary)' }}>GCUID</span>
            </div>
            <nav className="p-2 flex flex-col gap-0.5 flex-1">
              {(['Dashboard', 'Identities', 'Attributes', 'Sources', 'Reports', 'Settings'] as const).map((label, i) => (
                <div key={label} className="px-2.5 py-1.5 rounded text-xs"
                  style={{
                    backgroundColor: i === 0 ? 'var(--p-accentA22)' : i === 1 ? 'var(--p-modeHover)' : 'transparent',
                    color:           i === 0 ? 'var(--p-accentPrimary)' : 'var(--p-textSecondary)',
                    fontWeight:      i === 0 ? 600 : 400,
                  }}>{label}</div>
              ))}
            </nav>
          </div>

          {/* Main area */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Topbar */}
            <div className="px-4 py-2.5 flex items-center justify-between border-b shrink-0"
              style={{ backgroundColor: 'var(--p-bgSurface)', borderColor: 'var(--p-borderDefault)' }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--p-textPrimary)' }}>Dashboard</p>
                <p className="text-[10px]" style={{ color: 'var(--p-textMuted)' }}>Government of Canada Identity Registry</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1 rounded text-xs font-medium"
                  style={{ backgroundColor: 'var(--p-btnSecBg)', color: 'var(--p-btnSecText)', border: '1px solid var(--p-borderDefault)' }}>
                  Export
                </button>
                <button className="px-3 py-1 rounded text-xs font-medium"
                  style={{ backgroundColor: 'var(--p-btnPrimaryBg)', color: 'var(--p-btnPrimaryText)' }}>
                  + New ID
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 p-4 overflow-hidden flex flex-col gap-4"
              style={{ backgroundColor: 'var(--p-bgPage)' }}>

              {/* Stat cards */}
              <div className="grid grid-cols-4 gap-3 shrink-0">
                {([
                  { label: 'Total',   value: '12,481', note: '+2.3% this month', cv: 'var(--p-statusSuccess)' },
                  { label: 'Active',  value: '11,904', note: '95.4%',            cv: 'var(--p-statusSuccess)' },
                  { label: 'Pending', value: '244',    note: 'Awaiting review',  cv: 'var(--p-statusWarning)' },
                  { label: 'Errors',  value: '33',     note: 'Action required',  cv: 'var(--p-statusError)'   },
                ] as const).map(s => (
                  <div key={s.label} className="rounded-lg p-3"
                    style={{ backgroundColor: 'var(--p-bgSurface)', border: '1px solid var(--p-borderDefault)' }}>
                    <p className="text-[10px] mb-1" style={{ color: 'var(--p-textMuted)' }}>{s.label}</p>
                    <p className="text-lg font-bold leading-none mb-1" style={{ color: 'var(--p-textPrimary)' }}>{s.value}</p>
                    <p className="text-[10px]" style={{ color: s.cv }}>{s.note}</p>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="rounded-lg overflow-hidden flex-1"
                style={{ backgroundColor: 'var(--p-bgSurface)', border: '1px solid var(--p-borderDefault)' }}>
                <div className="px-3 py-2 flex items-center justify-between border-b"
                  style={{ backgroundColor: 'var(--p-tableHeader)', borderColor: 'var(--p-borderDefault)' }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--p-textPrimary)' }}>Recent Records</span>
                  <span className="text-xs" style={{ color: 'var(--p-textLink)' }}>View all &#x2192;</span>
                </div>
                {([
                  { name: 'Dupont, Marie',  dept: 'Treasury Board', id: 'gc-per-01a2b', bgv: 'var(--p-ssBg)', cv: 'var(--p-statusSuccess)', status: 'Active',  rowState: 'selected' as const },
                  { name: 'Smith, John A.', dept: 'Public Safety',  id: 'gc-per-03c4d', bgv: 'var(--p-ssBg)', cv: 'var(--p-statusSuccess)', status: 'Active',  rowState: null },
                  { name: 'Chen, Alex',     dept: 'Revenue Agency', id: 'gc-per-05e6f', bgv: 'var(--p-swBg)', cv: 'var(--p-statusWarning)', status: 'Pending', rowState: 'hover' as const },
                  { name: 'Okonkwo, Emeka', dept: 'Health Canada',  id: 'gc-per-07g8h', bgv: 'var(--p-seBg)', cv: 'var(--p-statusError)',   status: 'Error',   rowState: null },
                ] as const).map((row, i, arr) => (
                  <div key={row.id} className="px-3 py-2 flex items-center gap-3"
                    style={{
                      backgroundColor: row.rowState === 'selected' ? 'var(--p-bgHighlight)' : row.rowState === 'hover' ? 'var(--p-modeHover)' : undefined,
                      borderBottom: i < arr.length - 1 ? '1px solid var(--p-borderDefault)' : undefined,
                    }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--p-textPrimary)' }}>{row.name}</p>
                      <p className="text-[10px] truncate" style={{ color: 'var(--p-textMuted)' }}>{row.dept}</p>
                    </div>
                    <p className="text-[10px] font-mono shrink-0" style={{ color: 'var(--p-textSecondary)' }}>{row.id}</p>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                      style={{ backgroundColor: row.bgv, color: row.cv }}>{row.status}</span>
                    {row.rowState && (
                      <span className="text-[9px] shrink-0" style={{ color: 'var(--p-textMuted)', opacity: 0.6 }}>
                        {row.rowState === 'hover' ? '▸ hover' : '✓ selected'}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Interaction states legend */}
              <div className="flex items-center gap-4 shrink-0 pt-1">
                <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--p-textMuted)' }}>States</span>
                {([
                  { label: 'Hover',    v: 'var(--p-modeHover)',   round: false },
                  { label: 'Selected', v: 'var(--p-bgHighlight)', round: false },
                  { label: 'Active',   v: 'var(--p-accentA22)',   round: false },
                  { label: 'Link',     v: 'var(--p-textLink)',    round: true  },
                ] as const).map(s => (
                  <div key={s.label} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 shrink-0 border"
                      style={{ backgroundColor: s.v, borderColor: 'var(--p-borderDefault)', borderRadius: s.round ? '50%' : 2 }} />
                    <span className="text-[9px]" style={{ color: 'var(--p-textMuted)' }}>{s.label}</span>
                  </div>
                ))}
              </div>

            </div>
          </div>
        </div>
      </div>

        {/* Right arrow — only shown when browsing multiple entries */}
        {entries.length > 1 && (
          <button ref={nextRef} type="button"
            onClick={() => { const i = idxRef.current; idxRef.current = (i + 1) % entries.length; applyState(); }}
            className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-2xl backdrop-blur-sm select-none"
            style={ARROW_ON} title="Next theme (→)">&#8250;</button>
        )}
      </div>
    </div>
  );
});

export default function UXPortal() {
  const queryClient = useQueryClient();

  // Load config
  const { data: config, isLoading: isLoadingConfig } = useQuery({
    queryKey: ['ux-config'],
    queryFn: () => uxConfigApi.get(),
    staleTime: 5 * 60 * 1000,
  });

  // Load connectors for dynamic scope list
  const { data: connectors = [], isLoading: isLoadingConnectors } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => connectorsApi.list(),
    staleTime: 5 * 60 * 1000,
  });

  const { theme } = useTheme();

  // Local editable copy
  const [editedConfig, setEditedConfig] = useState<UXConfig | undefined>(undefined);
  const [selectedScopeId, setSelectedScopeId] = useState<string>('global');
  const [activeMode, setActiveMode] = useState<'light' | 'dark'>('light');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Import / export
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Theme library — save dialog
  const [showSaveDialog, setShowSaveDialog]   = useState(false);
  const [saveDialogName, setSaveDialogName]   = useState('');
  const [saveLibStatus, setSaveLibStatus]     = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveLibErrorMsg, setSaveLibErrorMsg] = useState('');

  // Theme library — load popover
  const [showLoadMenu, setShowLoadMenu]       = useState(false);
  const loadMenuRef                           = useRef<HTMLDivElement>(null);

  // Theme library — per-scope last-used {id, name} (persisted); enables direct update without a dialog
  const [lastLibraryByScope, setLastLibraryByScope] = useState<Record<string, { id: string; name: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('ux-portal-last-library-by-scope') ?? '{}'); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('ux-portal-last-library-by-scope', JSON.stringify(lastLibraryByScope)); } catch { /**/ }
  }, [lastLibraryByScope]);
  const [directSaveStatus, setDirectSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Theme library — library management panel
  const [libView, setLibView]                         = useState<'list' | 'edit'>('list');
  const [libIsNewEntry, setLibIsNewEntry]             = useState(false);
  const [libEditEntry, setLibEditEntry]               = useState<ThemeLibraryEntry | null>(null);
  const [libEditName, setLibEditName]                 = useState('');
  const [libEditTokens, setLibEditTokens]             = useState<ThemePair | null>(null);
  const [libEditMode, setLibEditMode]                 = useState<'light' | 'dark'>('light');
  const [libSaveStatus, setLibSaveStatus]             = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [libSaveErrorMsg, setLibSaveErrorMsg]         = useState('');
  const [libDeleteConfirmId, setLibDeleteConfirmId]   = useState<string | null>(null);

  // Theme preview overlay (library)
  const [previewEntryIdx, setPreviewEntryIdx] = useState<number | null>(null);
  // Scope preview overlay (current edited scope)
  const [showScopePreview, setShowScopePreview] = useState(false);

  // Theme library data
  const { data: themeLibrary = [] } = useQuery({
    queryKey: ['theme-library'],
    queryFn: () => themeLibraryApi.list(),
    staleTime: 30 * 1000,
  });
  const sortedLibrary = sortThemeEntriesByHue(themeLibrary as ThemeLibraryEntry[]);

  const saveToLibraryMutation = useMutation({
    mutationFn: ({ name, theme }: { name: string; theme: ThemePair }) =>
      themeLibraryApi.save(name, theme),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['theme-library'] }),
  });

  const updateLibraryEntryMutation = useMutation({
    mutationFn: ({ id, theme }: { id: string; theme: ThemePair }) =>
      themeLibraryApi.update(id, theme),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['theme-library'] }),
  });

  const deleteLibraryEntryMutation = useMutation({
    mutationFn: (id: string) => themeLibraryApi.delete(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['theme-library'] });
      if (libEditEntry?.id === id) setLibView('list');
    },
  });

  // Initialise editedConfig once when config first becomes available
  const hasInitialised = useRef(false);
  useEffect(() => {
    if (config && !hasInitialised.current) {
      hasInitialised.current = true;
      setEditedConfig(deepClone(config));
    }
  }, [config]);

  const isDirtyGlobal = useCallback((): boolean => {
    if (!editedConfig || !config) return false;
    return JSON.stringify(editedConfig.global) !== JSON.stringify(config.global);
  }, [editedConfig, config]);

  const isScopeDirty = useCallback((scopeId: string): boolean => {
    if (!editedConfig || !config) return false;
    if (scopeId === 'global') return isDirtyGlobal();
    const edited = editedConfig.scopes[scopeId];
    const original = config.scopes[scopeId];
    return JSON.stringify(edited) !== JSON.stringify(original);
  }, [editedConfig, config, isDirtyGlobal]);

  const anyDirty = useCallback((): boolean => {
    if (!editedConfig || !config) return false;
    if (isDirtyGlobal()) return true;
    for (const key of Object.keys(editedConfig.scopes)) {
      if (isScopeDirty(key)) return true;
    }
    return false;
  }, [editedConfig, config, isDirtyGlobal, isScopeDirty]);

  // Select a scope — auto-create the scope entry if it doesn't exist yet
  const handleSelectScope = (scopeId: string) => {
    setSelectedScopeId(scopeId);
    if (scopeId === 'global' || !editedConfig) return;
    if (editedConfig.scopes[scopeId]) return;
    // Try dynamic connector first, then fall back to static portals
    const connector = connectors.find(c => c.systemId === scopeId);
    const staticPortal = STATIC_PORTALS.find(p => p.id === scopeId);
    if (!connector && !staticPortal) return;
    const label = connector?.displayName ?? staticPortal!.label;
    const type: UXScopeConfig['type'] = connector
      ? (connector.systemType === 'authoritative_source' ? 'source' : 'department')
      : 'portal';
    setEditedConfig(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      next.scopes[scopeId] = {
        id: scopeId,
        label,
        type,
        enabled: false,
        theme: deepClone(next.global),
      };
      return next;
    });
  };

  // Get the tokens currently being edited for the active scope + mode
  const getCurrentTokens = (): ThemeTokens | undefined => {
    if (!editedConfig) return undefined;
    if (selectedScopeId === 'global') return editedConfig.global[activeMode];
    return editedConfig.scopes[selectedScopeId]?.theme[activeMode];
  };

  // Get the "reset" baseline — for global it's the factory default, for scopes it's the current global
  const getResetTokens = (): ThemeTokens | undefined => {
    if (!editedConfig) return undefined;
    if (selectedScopeId === 'global') return config?.global[activeMode];
    return editedConfig.global[activeMode];
  };

  const handleTokenChange = (key: keyof ThemeTokens, hex: string) => {
    setEditedConfig(prev => {
      if (!prev) return prev;
    const next = deepClone(prev);
    if (selectedScopeId === 'global') {
        next.global[activeMode][key] = hex;
      } else if (next.scopes[selectedScopeId]) {
        next.scopes[selectedScopeId].theme[activeMode][key] = hex;
      }
      return next;
    });
    setSaveStatus('idle');
  };

  const handleTokenReset = (key: keyof ThemeTokens) => {
    const baseline = getResetTokens();
    if (!baseline) return;
    handleTokenChange(key, baseline[key]);
  };

  const handleScopeEnabledToggle = (enabled: boolean) => {
    if (selectedScopeId === 'global') return;
    setEditedConfig(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      if (next.scopes[selectedScopeId]) {
        next.scopes[selectedScopeId].enabled = enabled;
      }
      return next;
    });
    setSaveStatus('idle');
  };

  const handleSave = async () => {
    if (!editedConfig) return;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await uxConfigApi.put(editedConfig);
      await queryClient.invalidateQueries({ queryKey: ['ux-config'] });
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleDiscardChanges = () => {
    if (!config) return;
    setEditedConfig(deepClone(config));
    setSaveStatus('idle');
  };

  // ── Export / import ───────────────────────────────────────────────────────

  const handleExport = () => {
    if (!editedConfig) return;
    const theme = isGlobal
      ? { light: editedConfig.global.light, dark: editedConfig.global.dark }
      : editedConfig.scopes[selectedScopeId]?.theme ?? { light: editedConfig.global.light, dark: editedConfig.global.dark };
    const scopeLabel = isGlobal ? 'Global' : (selectedScope?.label ?? selectedScopeId);
    const payload = {
      schema: 'gcuid-ux-theme/1',
      scope: selectedScopeId,
      label: scopeLabel,
      exportedAt: new Date().toISOString(),
      theme,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ux-theme-${selectedScopeId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-selecting the same file
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!parsed?.theme || typeof parsed.theme !== 'object') throw new Error('Missing "theme" object');
        if (!parsed.theme.light || typeof parsed.theme.light !== 'object') throw new Error('Missing "theme.light" token set');
        if (!parsed.theme.dark  || typeof parsed.theme.dark  !== 'object') throw new Error('Missing "theme.dark" token set');
        // Sanity-check at least one well-known key
        const knownKeys: (keyof ThemeTokens)[] = ['bgPage', 'bgSurface', 'accentPrimary'];
        const hasKnown = knownKeys.some(k => k in parsed.theme.light);
        if (!hasKnown) throw new Error('File does not look like a GCUID UX theme export');
        setEditedConfig(prev => {
          if (!prev) return prev;
          const next = deepClone(prev);
          if (isGlobal) {
            next.global.light = { ...next.global.light, ...(parsed.theme.light as ThemeTokens) };
            next.global.dark  = { ...next.global.dark,  ...(parsed.theme.dark  as ThemeTokens) };
          } else if (next.scopes[selectedScopeId]) {
            next.scopes[selectedScopeId].theme.light = { ...next.scopes[selectedScopeId].theme.light, ...(parsed.theme.light as ThemeTokens) };
            next.scopes[selectedScopeId].theme.dark  = { ...next.scopes[selectedScopeId].theme.dark,  ...(parsed.theme.dark  as ThemeTokens) };
          }
          return next;
        });
        setSaveStatus('idle');
        setImportStatus('success');
        setImportError(null);
      } catch (err) {
        setImportStatus('error');
        setImportError(err instanceof Error ? err.message : 'Import failed');
      }
    };
    reader.readAsText(file);
  };

  // ── Theme Library ─────────────────────────────────────────────────────────

  const setLastLibraryForScope = (scopeId: string, entry: { id: string; name: string } | null) => {
    setLastLibraryByScope(prev => {
      const next = { ...prev };
      if (entry) next[scopeId] = entry;
      else delete next[scopeId];
      return next;
    });
  };

  const handleSaveToLibrary = async () => {
    const name = saveDialogName.trim();
    if (!name || !editedConfig) return;
    setSaveLibStatus('saving');
    const theme: ThemePair = isGlobal
      ? { light: editedConfig.global.light, dark: editedConfig.global.dark }
      : editedConfig.scopes[selectedScopeId]?.theme ?? { light: editedConfig.global.light, dark: editedConfig.global.dark };
    try {
      const saved = await saveToLibraryMutation.mutateAsync({ name, theme });
      setLastLibraryForScope(selectedScopeId, { id: saved.id, name });
      setSaveLibStatus('saved');
      setTimeout(() => {
        setShowSaveDialog(false);
        setSaveDialogName('');
        setSaveLibStatus('idle');
      }, 1200);
    } catch (err) {
      setSaveLibErrorMsg(err instanceof Error ? err.message : 'Save failed — please try again.');
      setSaveLibStatus('error');
    }
  };

  const handleLoadFromLibrary = (entry: ThemeLibraryEntry) => {
    setShowLoadMenu(false);
    setLastLibraryForScope(selectedScopeId, { id: entry.id, name: entry.name });
    setEditedConfig(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      if (isGlobal) {
        next.global.light = { ...next.global.light, ...entry.theme.light };
        next.global.dark  = { ...next.global.dark,  ...entry.theme.dark  };
      } else if (next.scopes[selectedScopeId]) {
        next.scopes[selectedScopeId].theme.light = { ...next.scopes[selectedScopeId].theme.light, ...entry.theme.light };
        next.scopes[selectedScopeId].theme.dark  = { ...next.scopes[selectedScopeId].theme.dark,  ...entry.theme.dark  };
      }
      return next;
    });
    setSaveStatus('idle');
  };

  const handleDirectSaveToLibrary = async () => {
    const lastLibEntry = lastLibraryByScope[selectedScopeId];
    if (!lastLibEntry || !editedConfig) return;
    setDirectSaveStatus('saving');
    const theme: ThemePair = isGlobal
      ? { light: editedConfig.global.light, dark: editedConfig.global.dark }
      : editedConfig.scopes[selectedScopeId]?.theme ?? { light: editedConfig.global.light, dark: editedConfig.global.dark };
    try {
      await updateLibraryEntryMutation.mutateAsync({ id: lastLibEntry.id, theme });
      setDirectSaveStatus('saved');
      setTimeout(() => setDirectSaveStatus('idle'), 1500);
    } catch {
      setDirectSaveStatus('error');
      setTimeout(() => {
        setDirectSaveStatus('idle');
        setLastLibraryForScope(selectedScopeId, null); // clear stale binding on failure
      }, 2000);
    }
  };

  // ── Library management panel handlers ────────────────────────────────────

  const handleLibNewEntry = () => {
    const base: ThemePair = editedConfig?.global
      ? deepClone(editedConfig.global)
      : { light: {} as ThemeTokens, dark: {} as ThemeTokens };
    setLibIsNewEntry(true);
    setLibEditEntry(null);
    setLibEditName('');
    setLibEditTokens(base);
    setLibEditMode('light');
    setLibSaveStatus('idle');
    setLibView('edit');
  };

  const handleLibOpenEntry = (entry: ThemeLibraryEntry) => {
    setLibIsNewEntry(false);
    setLibEditEntry(entry);
    setLibEditName(entry.name);
    setLibEditTokens(deepClone(entry.theme));
    setLibEditMode('light');
    setLibSaveStatus('idle');
    setLibView('edit');
  };

  const handleLibTokenChange = (key: keyof ThemeTokens, hex: string) => {
    setLibEditTokens(prev => {
      if (!prev) return prev;
      const next = deepClone(prev);
      next[libEditMode][key] = hex;
      return next;
    });
    setLibSaveStatus('idle');
  };

  const handleLibTokenReset = (key: keyof ThemeTokens) => {
    setLibEditTokens(prev => {
      if (!prev) return prev;
      const baseline = libEditEntry
        ? libEditEntry.theme[libEditMode]
        : editedConfig?.global[libEditMode];
      if (!baseline) return prev;
      const next = deepClone(prev);
      next[libEditMode][key] = baseline[key];
      return next;
    });
    setLibSaveStatus('idle');
  };

  const handleLibSaveEntry = async () => {
    const name = libEditName.trim();
    if (!name || !libEditTokens) return;
    setLibSaveStatus('saving');
    try {
      if (libIsNewEntry) {
        await saveToLibraryMutation.mutateAsync({ name, theme: libEditTokens });
        setLibIsNewEntry(false);
        setLibSaveStatus('saved');
        setTimeout(() => { setLibView('list'); setLibSaveStatus('idle'); }, 800);
      } else if (libEditEntry) {
        if (name !== libEditEntry.name) {
          await themeLibraryApi.rename(libEditEntry.id, name);
        }
        await updateLibraryEntryMutation.mutateAsync({ id: libEditEntry.id, theme: libEditTokens });
        setLibEditEntry(prev => prev ? { ...prev, name, theme: libEditTokens } : prev);
        setLibSaveStatus('saved');
      }
    } catch (err) {
      setLibSaveErrorMsg(err instanceof Error ? err.message : 'Save failed — please try again.');
      setLibSaveStatus('error');
    }
  };

  // Close load menu on outside click
  useEffect(() => {
    if (!showLoadMenu) return;
    function handleOutside(e: MouseEvent) {
      if (loadMenuRef.current && !loadMenuRef.current.contains(e.target as Node)) {
        setShowLoadMenu(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showLoadMenu]);

  // ── Connector groups for sidebar ──────────────────────────────────────────
  const sources      = connectors.filter(c => c.systemType === 'authoritative_source');
  const departments  = connectors.filter(c => c.systemType === 'department');

  const isLoading = isLoadingConfig || isLoadingConnectors;
  const currentTokens = getCurrentTokens();
  const resetTokens   = getResetTokens();

  const selectedScope =
    selectedScopeId === 'global'
      ? null
      : editedConfig?.scopes[selectedScopeId] ?? null;

  const isGlobal = selectedScopeId === 'global';
  const scopeEnabled = isGlobal ? true : (selectedScope?.enabled ?? false);
  const lastLibEntry = lastLibraryByScope[selectedScopeId] ?? null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
    <UXScopeWrapper scopeId="portal-system">
    {/* Hidden file input for import */}
    <input
      ref={importFileRef}
      type="file"
      accept=".json,application/json"
      className="hidden"
      onChange={handleImportFile}
      aria-label="Import theme file"
    />
    <div className="h-full flex flex-col bg-ux-page">

      {/* Page header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 bg-ux-surface border-b border-ux-border shadow-sm">
        <div>
          <h1 className="text-lg font-semibold text-ux-text">UX Configuration</h1>
          <p className="text-xs text-ux-text-muted mt-0.5">
            Customise look-and-feel for the global application, authoritative sources, departments, and built-in portals
          </p>
        </div>
        <div className="flex items-center gap-3">
          {anyDirty() && (
            <>
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">● Unsaved changes</span>
              <button
                type="button"
                onClick={handleDiscardChanges}
                className="btn btn-secondary text-sm"
              >
                Discard
              </button>
            </>
          )}
          {saveStatus === 'saved' && !anyDirty() && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Saved</span>
          )}
          {saveStatus === 'error' && saveError && (
            <span className="text-xs text-red-600 dark:text-red-400" title={saveError}>⚠ Save failed</span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!anyDirty() || saveStatus === 'saving'}
            className="btn btn-primary text-sm"
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-ux-text-muted">Loading configuration…</p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">

          {/* ── Left scope navigation sidebar ─────────────────────────── */}
          <nav
            className="shrink-0 w-56 bg-ux-surface border-r border-ux-border overflow-y-auto flex flex-col"
            aria-label="UX configuration scopes"
          >
            <div className="p-3 space-y-1">
              {/* Global */}
              <p className="px-2 py-1 text-xs font-semibold text-ux-text-muted uppercase tracking-wider">Application</p>
              <ScopeNavItem
                id="global"
                label="Global — GCUID"
                isSelected={selectedScopeId === 'global'}
                isDirty={isDirtyGlobal()}
                typeColor="bg-ux-accent"
                onClick={() => handleSelectScope('global')}
              />

              {/* Authoritative Sources */}
              {sources.length > 0 && (
                <>
                  <p className="px-2 pt-3 pb-1 text-xs font-semibold text-ux-text-muted uppercase tracking-wider">
                    Authoritative Sources
                  </p>
                  {sources.map(c => (
                    <ScopeNavItem
                      key={c.systemId}
                      id={c.systemId}
                      label={c.displayName}
                      isSelected={selectedScopeId === c.systemId}
                      isDirty={isScopeDirty(c.systemId)}
                      typeColor="bg-blue-500"
                      onClick={() => handleSelectScope(c.systemId)}
                    />
                  ))}
                </>
              )}

              {/* Departments */}
              {departments.length > 0 && (
                <>
                  <p className="px-2 pt-3 pb-1 text-xs font-semibold text-ux-text-muted uppercase tracking-wider">
                    Departments
                  </p>
                  {departments.map(c => (
                    <ScopeNavItem
                      key={c.systemId}
                      id={c.systemId}
                      label={c.displayName}
                      isSelected={selectedScopeId === c.systemId}
                      isDirty={isScopeDirty(c.systemId)}
                      typeColor="bg-violet-500"
                      onClick={() => handleSelectScope(c.systemId)}
                    />
                  ))}
                </>
              )}

              {/* Built-in portals */}
              <p className="px-2 pt-3 pb-1 text-xs font-semibold text-ux-text-muted uppercase tracking-wider">
                Portals
              </p>
              {STATIC_PORTALS.map(p => (
                <ScopeNavItem
                  key={p.id}
                  id={p.id}
                  label={p.label}
                  isSelected={selectedScopeId === p.id}
                  isDirty={isScopeDirty(p.id)}
                  typeColor="bg-emerald-500"
                  onClick={() => handleSelectScope(p.id)}
                />
              ))}

              {/* Theme Library */}
              <div className="mt-4 pt-2 border-t border-ux-border/50">
                <button
                  type="button"
                  onClick={() => { setSelectedScopeId('__library__'); setLibView('list'); }}
                  className={`w-full text-left px-3 py-2.5 rounded-md flex items-center gap-2.5 text-sm transition-colors ${
                    selectedScopeId === '__library__'
                      ? 'bg-ux-accent/10 text-ux-text font-medium ring-1 ring-ux-accent/30'
                      : 'text-ux-text-sub hover:bg-ux-hover/50'
                  }`}
                >
                  <span className="shrink-0 text-base leading-none">🎨</span>
                  <span className="flex-1 truncate">Theme Library</span>
                  {themeLibrary.length > 0 && (
                    <span className="shrink-0 text-[10px] bg-ux-accent/20 text-ux-accent px-1.5 py-0.5 rounded-full font-medium">
                      {themeLibrary.length}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </nav>

          {/* ── Right editor pane ──────────────────────────────────────── */}
          <main className="flex-1 overflow-y-auto">
            {selectedScopeId === '__library__' ? (
              <div className="max-w-4xl mx-auto px-6 py-6">

                {libView === 'list' ? (
                  <>
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <div>
                        <h2 className="text-base font-semibold text-ux-text">Theme Library</h2>
                        <p className="text-xs text-ux-text-muted mt-0.5">
                          Define and manage reusable named colour themes. Select one to edit its values.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleLibNewEntry}
                        className="btn btn-primary text-sm flex items-center gap-1.5 shrink-0"
                      >
                        + New Theme
                      </button>
                    </div>

                    {themeLibrary.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                        <div className="text-5xl opacity-25">🎨</div>
                        <p className="text-sm font-medium text-ux-text-sub">No saved themes yet</p>
                        <p className="text-xs text-ux-text-muted max-w-xs">
                          Click <strong>+ New Theme</strong> to define a theme from scratch, or select any
                          scope from the sidebar and use <strong>★ Save to Library</strong>.
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        {sortedLibrary.map((entry, idx) => {
                          return (
                            <div
                              key={entry.id}
                              className="bg-ux-surface border border-ux-border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col cursor-pointer"
                              onClick={() => setPreviewEntryIdx(idx)}
                            >
                              {/* Proportional swatch strip — widths reflect visual dominance on a typical page */}
                              <div className="h-8 flex">
                                {([
                                  ['bgPage',        30],
                                  ['bgSurface',     22],
                                  ['textPrimary',   14],
                                  ['borderDefault', 10],
                                  ['accentPrimary',  9],
                                  ['btnPrimaryBg',   7],
                                  ['statusSuccess',  4],
                                  ['statusError',    4],
                                ] as const).map(([k, weight]) => (
                                  <div key={k} style={{ flexGrow: weight, backgroundColor: entry.theme[theme][k] }} title={k} />
                                ))}
                              </div>
                              <div className="p-3 flex flex-col gap-2 flex-1">
                                <div className="flex items-start justify-between gap-1">
                                  <p className="text-sm font-semibold text-ux-text truncate">{entry.name}</p>
                                  <span className="shrink-0 text-[10px] text-ux-text-muted whitespace-nowrap">
                                    {new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </span>
                                </div>
                                {/* Stop card-click propagation so buttons open editor/delete, not preview */}
                                <div className="mt-auto pt-2 border-t border-ux-border/50 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => handleLibOpenEntry(entry)}
                                    className="flex-1 btn btn-secondary text-xs py-1"
                                  >
                                    Edit
                                  </button>
                                  {libDeleteConfirmId === entry.id ? (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <span className="text-[10px] text-red-600 dark:text-red-400">Delete?</span>
                                      <button
                                        type="button"
                                        onClick={() => { deleteLibraryEntryMutation.mutate(entry.id); setLibDeleteConfirmId(null); }}
                                        className="text-xs px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700"
                                      >Yes</button>
                                      <button
                                        type="button"
                                        onClick={() => setLibDeleteConfirmId(null)}
                                        className="text-xs px-2 py-0.5 bg-ux-hover text-ux-text-sub rounded"
                                      >No</button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setLibDeleteConfirmId(entry.id)}
                                      className="shrink-0 text-xs text-ux-text-muted hover:text-red-600 dark:hover:text-red-400 transition-colors px-1"
                                    >Delete</button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : libEditTokens ? (
                  <>
                    {/* Edit-view breadcrumb */}
                    <div className="mb-5 flex items-center gap-2 text-sm">
                      <button
                        type="button"
                        onClick={() => { setLibView('list'); setLibSaveStatus('idle'); }}
                        className="text-ux-text-muted hover:text-ux-text transition-colors"
                      >
                        ← Library
                      </button>
                      <span className="text-ux-text-muted/40">/</span>
                      <span className="font-medium text-ux-text truncate">
                        {libEditName || (libIsNewEntry ? 'New Theme' : 'Edit Theme')}
                      </span>
                    </div>

                    <div className="space-y-5">
                      {/* Name + save row */}
                      <div className="flex items-end gap-4 flex-wrap">
                        <div className="flex-1 min-w-[200px]">
                          <label className="block text-xs font-medium text-ux-text-muted mb-1">Theme name</label>
                          <input
                            type="text"
                            value={libEditName}
                            onChange={e => { setLibEditName(e.target.value); setLibSaveStatus('idle'); setLibSaveErrorMsg(''); }}
                            placeholder="e.g. Sovereign, Cobalt, Cardinal…"
                            maxLength={80}
                            autoFocus
                            className="w-full text-sm border border-ux-border rounded px-3 py-1.5 bg-ux-page text-ux-text placeholder:text-ux-text-muted focus:outline-none focus:ring-1 focus:ring-ux-accent"
                          />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {libSaveStatus === 'saved' && (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Saved</span>
                          )}
                          {libSaveStatus === 'error' && (
                            <span className="text-xs text-red-600 dark:text-red-400">{libSaveErrorMsg || 'Save failed'}</span>
                          )}
                          <button
                            type="button"
                            onClick={handleLibSaveEntry}
                            disabled={!libEditName.trim() || libSaveStatus === 'saving'}
                            className="btn btn-primary text-sm"
                          >
                            {libSaveStatus === 'saving' ? 'Saving…' : libIsNewEntry ? 'Save to Library' : 'Save changes'}
                          </button>
                        </div>
                      </div>

                      {/* Light / Dark mode tabs */}
                      <div className="flex gap-1 p-1 bg-ux-hover/60 rounded-lg w-fit">
                        {(['light', 'dark'] as const).map(mode => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setLibEditMode(mode)}
                            className={`px-5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                              libEditMode === mode
                                ? 'bg-ux-surface text-ux-text shadow-sm'
                                : 'text-ux-text-muted hover:text-ux-text'
                            }`}
                          >
                            {mode === 'light' ? '☀ Light' : '🌙 Dark'}
                          </button>
                        ))}
                      </div>

                      {/* Token groups */}
                      <div className="space-y-4">
                        {TOKEN_GROUPS.map(group => (
                          <TokenGroupSection
                            key={group.title}
                            group={group}
                            tokens={libEditTokens[libEditMode]}
                            globalTokens={
                              libEditEntry
                                ? libEditEntry.theme[libEditMode]
                                : (editedConfig?.global[libEditMode] ?? libEditTokens[libEditMode])
                            }
                            onChange={handleLibTokenChange}
                            onReset={handleLibTokenReset}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>

            ) : editedConfig && currentTokens && resetTokens ? (
              <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">

                {/* Scope header */}
                <div className="space-y-2">
                  {/* Row 1: title + override toggle */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-ux-text">
                        {isGlobal
                          ? 'Global GCUID Application Theme'
                          : selectedScope?.label ?? selectedScopeId}
                      </h2>
                      <p className="text-xs text-ux-text-muted mt-0.5">
                        {isGlobal
                          ? 'These tokens apply to the entire application including headers and footers.'
                          : 'These tokens override the mid-section of this portal when overrides are enabled.'}
                      </p>
                    </div>

                    {/* Per-scope override toggle — kept in title row */}
                    {!isGlobal && (
                      <label className="flex items-center gap-2.5 cursor-pointer shrink-0 mt-0.5">
                        <span className="text-sm text-ux-text font-medium">Overrides enabled</span>
                        <span className="relative inline-flex items-center">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={scopeEnabled}
                            onChange={e => handleScopeEnabledToggle(e.target.checked)}
                            aria-label="Enable theme overrides for this scope"
                          />
                          <div className="w-10 h-6 bg-ux-hover peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ux-accent rounded-full peer peer-checked:bg-ux-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
                        </span>
                      </label>
                    )}
                  </div>

                  {/* Row 2: action buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Preview current scope theme */}
                    <button
                      type="button"
                      onClick={() => setShowScopePreview(true)}
                      className="btn btn-secondary text-xs flex items-center gap-1.5"
                      title="Preview the current theme colours in a full-page mock-up"
                    >
                      &#128065; Preview
                    </button>

                    {/* Export */}
                    <button
                      type="button"
                      onClick={handleExport}
                      className="btn btn-secondary text-xs flex items-center gap-1.5"
                      title="Download theme as JSON"
                    >
                      ↓ Export
                    </button>

                    {/* Import */}
                    <button
                      type="button"
                      onClick={() => importFileRef.current?.click()}
                      className="btn btn-secondary text-xs flex items-center gap-1.5"
                      title="Upload a previously exported theme JSON file"
                    >
                      ↑ Import
                    </button>

                    {/* Save to Library — direct update if a theme is linked, otherwise open dialog */}
                    {lastLibEntry ? (
                      <>
                        <button
                          type="button"
                          onClick={handleDirectSaveToLibrary}
                          disabled={directSaveStatus === 'saving'}
                          className="btn btn-secondary text-xs flex items-center gap-1.5 max-w-[200px]"
                          title={`Update "${lastLibEntry.name}" in the library with the current colours`}
                        >
                          <span className="shrink-0">
                            {directSaveStatus === 'saving' ? '…' : directSaveStatus === 'saved' ? '✓' : '★'}
                          </span>
                          <span className="truncate">
                            {directSaveStatus === 'saved' ? 'Saved' : directSaveStatus === 'error' ? 'Failed — cleared' : lastLibEntry.name}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowSaveDialog(true); setSaveDialogName(''); setSaveLibStatus('idle'); setSaveLibErrorMsg(''); }}
                          className="btn btn-secondary text-xs flex items-center gap-1.5"
                          title="Save current scope colours as a new named theme in the library"
                        >
                          Save as new…
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setShowSaveDialog(true); setSaveDialogName(''); setSaveLibStatus('idle'); setSaveLibErrorMsg(''); }}
                        className="btn btn-secondary text-xs flex items-center gap-1.5"
                        title="Save current scope colours as a named theme in the library"
                      >
                        ★ Save to Library
                      </button>
                    )}

                    {/* Load from Library */}
                    <div className="relative" ref={loadMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowLoadMenu(v => !v)}
                        className="btn btn-secondary text-xs flex items-center gap-1.5"
                        title="Load a theme from the library into this scope"
                        disabled={themeLibrary.length === 0}
                      >
                        ☰ Load from Library
                        {themeLibrary.length > 0 && (
                          <span className="ml-1 text-[10px] bg-ux-accent/20 text-ux-accent px-1.5 py-0.5 rounded-full">
                            {themeLibrary.length}
                          </span>
                        )}
                      </button>
                      {showLoadMenu && themeLibrary.length > 0 && (
                        <div className="absolute right-0 mt-1 z-50 bg-ux-surface border border-ux-border rounded-lg shadow-xl py-1 min-w-[220px] max-h-64 overflow-y-auto">
                          <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-ux-text-muted uppercase tracking-wider">
                            Library themes
                          </p>
                          {sortedLibrary.map((entry: ThemeLibraryEntry) => (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => handleLoadFromLibrary(entry)}
                              className="w-full flex flex-col gap-1.5 px-3 py-2 text-left hover:bg-ux-hover transition-colors"
                            >
                              <div className="flex items-baseline justify-between gap-2 min-w-0">
                                <p className="text-sm font-medium text-ux-text truncate">{entry.name}</p>
                                <p className="shrink-0 text-[10px] text-ux-text-muted">
                                  {new Date(entry.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                              {/* Swatch strip — full width, proportional to page colour coverage */}
                              <div
                                className="flex w-full rounded overflow-hidden border border-black/10"
                                style={{ height: '0.5rem' }}
                              >
                                {LOAD_SWATCH_TOKENS.map(({ key, flex }) => (
                                  <div
                                    key={key}
                                    title={key}
                                    style={{ flex, backgroundColor: entry.theme[theme][key] }}
                                  />
                                ))}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Import status feedback */}
                {importStatus !== 'idle' && (
                  <div
                    className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                      importStatus === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-300'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50 text-red-800 dark:text-red-300'
                    }`}
                  >
                    <span className="shrink-0">{importStatus === 'success' ? '✓' : '⚠'}</span>
                    <div>
                      {importStatus === 'success'
                        ? <><strong>Theme imported.</strong> Review the colours below, then click Save changes to apply.</>                        : <><strong>Import failed:</strong> {importError}</>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setImportStatus('idle')}
                      className="ml-auto shrink-0 opacity-60 hover:opacity-100"
                      aria-label="Dismiss"
                    >✕</button>
                  </div>
                )}

                {/* Save-to-Library dialog */}
                {showSaveDialog && (
                  <div className="flex items-start gap-3 p-4 bg-ux-surface border border-ux-border rounded-lg shadow-sm">
                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-medium text-ux-text">Save current colours as a library theme</p>
                      <input
                        type="text"
                        value={saveDialogName}
                        onChange={e => { setSaveDialogName(e.target.value); setSaveLibErrorMsg(''); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveToLibrary();
                          if (e.key === 'Escape') setShowSaveDialog(false);
                        }}
                        placeholder="Theme name…"
                        maxLength={80}
                        autoFocus
                        className="w-full text-sm border border-ux-border rounded px-3 py-1.5 bg-ux-page text-ux-text placeholder:text-ux-text-muted focus:outline-none focus:ring-1 focus:ring-ux-accent"
                      />
                      {saveLibStatus === 'error' && (
                        <p className="text-xs text-red-600 dark:text-red-400">{saveLibErrorMsg || 'Save failed — please try again.'}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 pt-6">
                      {saveLibStatus === 'saved' ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Saved</span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleSaveToLibrary}
                          disabled={!saveDialogName.trim() || saveLibStatus === 'saving'}
                          className="btn btn-primary text-xs"
                        >
                          {saveLibStatus === 'saving' ? 'Saving…' : 'Save'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSaveDialog(false)}
                        className="btn btn-secondary text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Non-global info banner */}
                {!isGlobal && (
                  <div className="flex items-start gap-2.5 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/50 rounded-lg text-xs text-blue-800 dark:text-blue-300">
                    <span className="shrink-0 mt-0.5">ℹ</span>
                    <p>
                      These overrides only affect the <strong>mid-section</strong> of this portal's pages.
                      Headers and footers always use the global theme. Reset any token to restore it to the
                      current global value.
                    </p>
                  </div>
                )}

                {/* Light / Dark mode tabs */}
                <div className="flex gap-1 p-1 bg-ux-hover/60 rounded-lg w-fit">
                  {(['light', 'dark'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setActiveMode(mode)}
                      className={`px-5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        activeMode === mode
                          ? 'bg-ux-surface text-ux-text shadow-sm'
                          : 'text-ux-text-muted hover:text-ux-text'
                      }`}
                    >
                      {mode === 'light' ? '☀ Light' : '🌙 Dark'}
                    </button>
                  ))}
                </div>

                {/* Token groups */}
                <div className="space-y-4">
                  {TOKEN_GROUPS.filter(g => !g.globalOnly || isGlobal).map(group => (
                    <TokenGroupSection
                      key={group.title}
                      group={group}
                      tokens={currentTokens}
                      globalTokens={resetTokens}
                      onChange={handleTokenChange}
                      onReset={handleTokenReset}
                    />
                  ))}
                </div>

                {/* Bottom save row */}
                {anyDirty() && (
                  <div className="flex items-center justify-end gap-3 pt-2 border-t border-ux-border">
                    <button
                      type="button"
                      onClick={handleDiscardChanges}
                      className="btn btn-secondary text-sm"
                    >
                      Discard all changes
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saveStatus === 'saving'}
                      className="btn btn-primary text-sm"
                    >
                      {saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center h-full">
                <p className="text-sm text-ux-text-muted">Select a scope to configure its theme.</p>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
    </UXScopeWrapper>

    {/* ── Theme preview overlay (library) ───────────────────────────────── */}
    {previewEntryIdx !== null && (
      <ThemePreviewOverlay
        entries={sortedLibrary}
        initialIdx={previewEntryIdx}
        initialMode={theme}
        onClose={() => setPreviewEntryIdx(null)}
      />
    )}

    {/* ── Scope preview overlay (current edited scope) ─────────────────── */}
    {showScopePreview && editedConfig && (() => {
      const scopeTheme: ThemePair = isGlobal
        ? { light: editedConfig.global.light, dark: editedConfig.global.dark }
        : (editedConfig.scopes[selectedScopeId]?.theme
            ?? { light: editedConfig.global.light, dark: editedConfig.global.dark });
      const scopeName = isGlobal ? 'Global Theme' : (selectedScope?.label ?? selectedScopeId);
      const previewEntry: ThemeLibraryEntry = {
        id: '__scope-preview__',
        name: scopeName,
        theme: scopeTheme,
        createdAt: new Date().toISOString(),
      };
      return (
        <ThemePreviewOverlay
          entries={[previewEntry]}
          initialIdx={0}
          initialMode={theme}
          onClose={() => setShowScopePreview(false)}
        />
      );
    })()}
    </>
  );
}
