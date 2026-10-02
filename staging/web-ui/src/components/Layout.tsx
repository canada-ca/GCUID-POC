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
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { getEnvironmentLabel } from '../utils/environment';
import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { systemApi, policiesApi } from '../api/client';
import { useTheme } from '../hooks/useTheme';
import { useUXTheme } from '../context/UXThemeContext';
import { useScopeNavTheme } from '../theme/useScopeNavTheme';


// Vertical divider between nav groups
function NavDivider() {
  return <div className="w-px bg-ux-border mx-1 self-stretch mt-2 mb-0" />;
}


const SYSTEM_ROUTES = ['/dashboard', '/logs', '/testing', '/databases', '/tools', '/ux', '/options', '/system', '/policies', '/about'];
const SYSTEM_ITEMS = [
  { to: '/dashboard',  label: 'Dashboard',     emoji: '📊' },
  { to: '/logs',       label: 'Logs',          emoji: '📋' },
  { to: '/testing',    label: 'API Testing',   emoji: '🧪' },
  { to: '/databases',  label: 'Databases',     emoji: '🗄' },
  { to: '/tools',      label: 'Tools',         emoji: '🔧' },
  { to: '/ux',         label: 'UX',            emoji: '🎨' },
  { to: '/options',    label: 'Options',       emoji: '⚙'  },
  { to: '/system',     label: 'System',        emoji: '🔌' },
  { to: '/policies',   label: 'Policies',      emoji: '📜' },
  { to: '/about',      label: 'About',         emoji: 'ℹ️'  },
];

const AUTH_SOURCE_ITEMS = [
  { to: '/hr',   label: 'HR System' },
  { to: '/ldap', label: 'LDAP / AD' },
];

const HELP_DESK_ITEMS = [
  { to: '/helpdesk',          label: 'Help Desk' },
  { to: '/helpdesk/register', label: 'Registration' },
];

const SELF_SERVICE_ITEMS = [
  { to: '/user',     label: 'User Portal' },
  { to: '/register', label: 'Registration' },
];

const GCUID_SERVICES_ITEMS = [
  { to: '/gcuid',   label: 'GCUID Registry' },
  { to: '/caes',    label: 'CAES' },
  { to: '/sources', label: 'Sources & Depts' },
];

const DEPARTMENT_ITEMS = [
  { to: '/engineering', label: 'Engineering' },
  { to: '/finance',     label: 'Finance' },
];

const CORP_APP_ITEMS = [
  { to: '/apps/budget',      label: 'Budget Compass',     emoji: '💰', accent: '#f97316' },
  { to: '/apps/projects',    label: 'Project Hub',        emoji: '📋', accent: '#fb923c' },
  { to: '/apps/travel',      label: 'Travel & Expense',   emoji: '✈️', accent: '#f98a18' },
  { to: '/apps/assets',      label: 'Asset Registry',     emoji: '🗄️', accent: '#ea6320' },
  { to: '/apps/hrconnect',   label: 'HR Connect',         emoji: '👤', accent: '#e87c3e' },
  { to: '/apps/procurement', label: 'Procurement Portal', emoji: '🛒', accent: '#c2410c' },
];

const CORP_APP_ROUTES = CORP_APP_ITEMS.map(i => i.to);

// Corporate Applications dropdown — colors derived from the
// portal-corp-apps scope so the dropdown reads as part of the
// orange-themed corporate apps pages.
const CORP_APPS_SCOPE_ID = 'portal-corp-apps';

function CorporateAppsDropdown() {
  const [open, setOpen] = useState(false);
  const [triggerHover, setTriggerHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = 'corp-apps-dropdown-menu';
  const location = useLocation();
  const isActive = CORP_APP_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));
  const activeItem = CORP_APP_ITEMS.find(i => location.pathname === i.to || location.pathname.startsWith(i.to + '/'));

  // All title/panel/accent colors derive from the System portal theme.
  const nav = useScopeNavTheme(CORP_APPS_SCOPE_ID);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  // Theme-derived colors (live: update when scope theme or light/dark mode changes)
  const titleColor = nav.current.title;
  const accentColor = nav.current.accent;

  // Fetch policies — same query key as PolicyPortal so invalidations propagate here automatically
  const { data: policiesData } = useQuery({
    queryKey: ['policies'],
    queryFn:  () => policiesApi.list(),
    staleTime: 30_000,
  });
  const policyByAppId = Object.fromEntries(
    (policiesData?.policies ?? []).map(p => [p.app_id, p])
  );

  // Read live UX config — source system badge colors reflect their portal theme (System→UX)
  const { config: uxConfig } = useUXTheme();
  const { theme: themeMode } = useTheme();
  const uxMode = themeMode;

  // Scope IDs and short labels for each source system
  const SOURCE_SYSTEM_META: Record<string, { scopeId: string; label: string; fallbackLight: string; fallbackDark: string }> = {
    hr:          { scopeId: 'conn-hr',          label: 'HR',  fallbackLight: '#16a34a', fallbackDark: '#4ade80' },
    ldap:        { scopeId: 'conn-ldap',        label: 'AD',  fallbackLight: '#2563eb', fallbackDark: '#60a5fa' },
    engineering: { scopeId: 'conn-engineering', label: 'Eng', fallbackLight: '#7c3aed', fallbackDark: '#a78bfa' },
    finance:     { scopeId: 'conn-finance',     label: 'Fin', fallbackLight: '#d97706', fallbackDark: '#fbbf24' },
  };

  function getSourceAccent(sourceSystem: string): string {
    const meta = SOURCE_SYSTEM_META[sourceSystem];
    if (!meta) return '#6b7280';
    const live = uxConfig?.scopes[meta.scopeId]?.theme?.[uxMode]?.accentPrimary;
    return live ?? (themeMode === 'dark' ? meta.fallbackDark : meta.fallbackLight);
  }

  return (
    <div className="flex flex-col relative" ref={ref}>
      {/* Group label row */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-0.5">
        <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: titleColor }} aria-hidden="true" />
        <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: titleColor }}>
          Corporate Apps
        </span>
      </div>
      {/* Trigger tab button */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onMouseEnter={() => setTriggerHover(true)}
        onMouseLeave={() => setTriggerHover(false)}
        className={`py-3 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ux-accent ${
          isActive || triggerHover ? '' : 'border-transparent text-ux-text-sub'
        }`}
        style={
          isActive
            ? { borderColor: titleColor, color: titleColor }
            : triggerHover
            ? { borderColor: `color-mix(in srgb, ${titleColor} 55%, transparent)`, color: titleColor }
            : undefined
        }
      >
      {isActive && activeItem
        ? (<><span aria-hidden="true">{activeItem.emoji}</span>{' '}{activeItem.label}</>)
        : 'Applications'}
      <svg
        className={`h-3.5 w-3.5 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        viewBox="0 0 20 20"
        fill="currentColor"
          aria-hidden="true"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {/* Dropdown panel */}
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute top-full left-0 mt-0.5 z-50 rounded-lg shadow-lg py-1 min-w-[230px]"
          style={{
            background: nav.current.panel,
            border: `1px solid color-mix(in srgb, ${accentColor} 40%, transparent)`
          }}
        >
          <style>{`#${menuId} a:not([aria-current="page"]) { color: color-mix(in srgb, ${accentColor} 75%, var(--ux-text)); } #${menuId} a:not([aria-current="page"]):hover { background-color: color-mix(in srgb, ${accentColor} 12%, transparent); color: ${accentColor}; }`}</style>
          {CORP_APP_ITEMS.map(({ to, label, emoji }) => {
            const appId  = to.split('/').pop()!;
            const policy = policyByAppId[appId];
            const badge  = policy
              ? (() => {
                  const accent = getSourceAccent(policy.source_system);
                  return {
                    bg:    `color-mix(in srgb, ${accent} 18%, transparent)`,
                    color: accent,
                    label: SOURCE_SYSTEM_META[policy.source_system]?.label ?? policy.source_system,
                  };
                })()
              : null;
            return (
              <NavLink
                key={to}
                to={to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={({ isActive: ia }) =>
                  `flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                    ia ? 'font-medium' : ''
                  }`
                }
                style={({ isActive: ia }: { isActive: boolean }) =>
                  ia
                    ? { color: accentColor, backgroundColor: `color-mix(in srgb, ${accentColor} 18%, transparent)` }
                    : undefined
                }
              >
                <span aria-hidden="true" className="text-base">{emoji}</span>
                <span className="flex-1 min-w-0">{label}</span>
                {badge && (
                  <span
                    title={policy!.credential_label}
                    style={{ background: badge.bg, color: badge.color }}
                    className="text-[10px] font-semibold rounded px-1.5 py-0.5 uppercase tracking-wide shrink-0"
                  >
                    {badge.label}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Generic nav-group dropdown — same visual pattern as SystemDropdown
function NavGroupDropdown({
  label,
  scopeId,
  panelBgVar,
  accentVar,
  panelBgColor,
  accentColor,
  accentColorLight,
  accentColorDark,
  panelBgColorLight,
  panelBgColorDark,
  titleAccentColorLight,
  titleAccentColorDark,
  panelAccentColorLight,
  panelAccentColorDark,
  menuId,
  items,
}: {
  label: string;
  /**
   * If supplied, derive the title/panel/accent colors from this scope's
   * theme palette.  Manual color props below still take precedence.
   */
  scopeId?: string;
  /** Either a CSS var name like "--ux-nav-auth-panel-bg" or omit when panelBgColor is set. */
  panelBgVar?: string;
  /** Either a CSS var name like "--ux-nav-auth-accent" or omit when accentColor is set. */
  accentVar?: string;
  /** Literal panel background colour (single value, mode-agnostic). Takes precedence over panelBgVar. */
  panelBgColor?: string;
  /** Literal accent colour (single value, mode-agnostic). Takes precedence over accentVar. */
  accentColor?: string;
  /** Light-mode accent colour. Used when both light and dark variants are supplied. */
  accentColorLight?: string;
  /** Dark-mode accent colour. */
  accentColorDark?: string;
  /** Light-mode panel background. */
  panelBgColorLight?: string;
  /** Dark-mode panel background. */
  panelBgColorDark?: string;
  /**
   * Light-mode accent for the GROUP TITLE (rendered on the page header
   * `bgPage` background — needs WCAG-AA contrast against light bg).
   * Falls back to accentColorLight when not set.
   */
  titleAccentColorLight?: string;
  /** Dark-mode title accent (rendered on dark bgPage). */
  titleAccentColorDark?: string;
  /**
   * Light-mode accent for the DROPDOWN PANEL CONTENTS (item text, hover,
   * active highlight, underline — rendered on the dark dropdown panel bg).
   * Falls back to accentColorLight when not set.
   */
  panelAccentColorLight?: string;
  /** Dark-mode panel accent. */
  panelAccentColorDark?: string;
  menuId: string;
  items: { to: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [triggerHover, setTriggerHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const routes = items.map(i => i.to);
  const isActive = routes.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));
  const activeItem = items.find(i => location.pathname === i.to || location.pathname.startsWith(i.to + '/'));

  // Subscribe to light/dark mode so colour pair overrides switch instantly
  const { theme } = useTheme();

  // If a scopeId is provided, derive title/panel/accent from that scope's
  // own theme tokens.  Otherwise callers must supply explicit colours.
  const scopeNavTheme = useScopeNavTheme(scopeId ?? '');
  const scopeLight = scopeNavTheme.light;
  const scopeDark  = scopeNavTheme.dark;

  // Resolve a colour source from literal / literal-light+dark / CSS var.
  // If only one of (literalLight, literalDark) is supplied, treat it as a
  // single-value override (mode-agnostic).  This is the common case when the
  // literal already references a CSS var like var(--ux-bg-surface) that
  // handles its own light/dark switching via the global theme.
  const resolveColor = (
    literal: string | undefined,
    literalLight: string | undefined,
    literalDark: string | undefined,
    cssVar: string | undefined,
    fallbackLight?: string,
  ): string => {
    if (literalLight && literalDark) {
      return theme === 'dark' ? literalDark : literalLight;
    }
    if (literalLight) return literalLight;
    if (literalDark)  return literalDark;
    if (literal) return literal;
    if (cssVar) return `var(${cssVar})`;
    return theme === 'dark'
      ? (fallbackLight ? '#ffffff' : '#9ca3af')
      : (fallbackLight || '#6b7280');
  };

  // The TITLE accent is rendered on the page header bgPage, so it must pass
  // WCAG-AA contrast against that background.  When a scopeId is supplied,
  // use the scope's derived title colour.  Manual colour props still
  // override.  Falls back to the generic accent pair so existing call
  // sites keep working.
  const titleAccentResolved = resolveColor(
    undefined,
    titleAccentColorLight ?? accentColorLight ?? (scopeId ? scopeLight.title : undefined),
    titleAccentColorDark ?? accentColorDark ?? (scopeId ? scopeDark.title : undefined),
    accentVar,
    '#166534',
  );
  // The PANEL accent is rendered inside the dropdown menu on the dark
  // dropdown-panel background — needs contrast against that dark surface.
  const panelAccentResolved = resolveColor(
    accentColor,
    panelAccentColorLight ?? accentColorLight ?? (scopeId ? scopeLight.accent : undefined),
    panelAccentColorDark ?? accentColorDark ?? (scopeId ? scopeDark.accent : undefined),
    accentVar,
    '#0f766e',
  );
  const accentResolved = panelAccentResolved; // legacy alias for the rest of the JSX
  const panelResolved = resolveColor(
    panelBgColor,
    panelBgColorLight ?? (scopeId ? scopeLight.panel : undefined),
    panelBgColorDark ?? (scopeId ? scopeDark.panel : undefined),
    panelBgVar,
  );

  // When a literal colour is supplied, expose it as a per-component CSS var
  // so colour-mix() can reference it via var(--...) without needing a
  // second string-substitution layer.  Only emit the var when a single,
  // mode-agnostic literal is provided (mode-pair overrides resolve at render).
  const wrapperStyle: React.CSSProperties =
    accentColor || panelBgColor
      ? {
          ...(accentColor ? { ['--ux-nav-this-accent' as any]: accentColor } : {}),
          ...(panelBgColor ? { ['--ux-nav-this-panel-bg' as any]: panelBgColor } : {}),
        }
      : {};
  
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="flex flex-col relative" ref={ref} style={wrapperStyle}>
    {/* Title row — rendered on the page header (bgPage), so use titleAccent
        which is tuned for contrast on that surface. */}
    <div className="flex items-center gap-1 px-2 pt-2 pb-0.5">
      <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: titleAccentResolved }} aria-hidden="true" />
      <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: titleAccentResolved }}>
        {label}
      </span>
    </div>
    <button
      onClick={() => setOpen(v => !v)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={menuId}
      onMouseEnter={() => setTriggerHover(true)}
      onMouseLeave={() => setTriggerHover(false)}
      className={`py-3 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ux-accent ${
        isActive || triggerHover ? '' : 'border-transparent text-ux-text-sub'
      }`}
      style={
        isActive
          ? { borderColor: titleAccentResolved, color: titleAccentResolved }
          : triggerHover
          ? { borderColor: `color-mix(in srgb, ${titleAccentResolved} 55%, transparent)`, color: titleAccentResolved }
          : undefined
      }
    >
      {isActive && activeItem ? activeItem.label : label}
      <svg
        className={`h-3.5 w-3.5 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </button>
    {open && (
      <div
        id={menuId}
        role="menu"
        className="absolute top-full left-0 mt-0.5 z-50 rounded-lg shadow-lg py-1 min-w-[160px]"
        style={{
          background: panelResolved,
          border: `1px solid color-mix(in srgb, ${accentResolved} 40%, transparent)`
        }}
      >
        <style>{`#${menuId} a:not([aria-current="page"]) { color: color-mix(in srgb, ${accentResolved} 75%, var(--ux-text)); } #${menuId} a:not([aria-current="page"]):hover { background-color: color-mix(in srgb, ${accentResolved} 12%, transparent); color: ${accentResolved}; }`}</style>
        {items.map(({ to, label: itemLabel }) => (
          <NavLink
            key={to}
            to={to}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={({ isActive: ia }) =>
              `flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                ia ? 'font-medium' : ''
              }`
            }
            style={({ isActive: ia }: { isActive: boolean }) =>
              ia
                ? { color: accentResolved, backgroundColor: `color-mix(in srgb, ${accentResolved} 18%, transparent)` }
                : undefined
            }
          >
            {itemLabel}
          </NavLink>
        ))}
      </div>
    )}
    </div>
  );
  }

// Dropdown replacement for the System nav group — colors derived from the
// System portal's theme so the dropdown reads as part of the page.
function SystemDropdown() {
  const [open, setOpen] = useState(false);
  const [triggerHover, setTriggerHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = 'system-dropdown-menu';
  const location = useLocation();
  const isActive = SYSTEM_ROUTES.some(r => location.pathname === r);
  const activeItem = SYSTEM_ITEMS.find(i => i.to === location.pathname);

  // All title/panel/accent colors derive from the System portal theme.
  const nav = useScopeNavTheme('portal-system');
  const titleColor = nav.current.title;
  const accentColor = nav.current.accent;

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="flex flex-col relative" ref={ref}>
      {/* Group label row */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-0.5">
        <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: titleColor }} aria-hidden="true" />
        <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: titleColor }}>
          System
        </span>
      </div>
      {/* Trigger tab button */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onMouseEnter={() => setTriggerHover(true)}
        onMouseLeave={() => setTriggerHover(false)}
        className={`py-3 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ux-accent ${
          isActive || triggerHover ? '' : 'border-transparent text-ux-text-sub'
        }`}
        style={
          isActive
            ? { borderColor: titleColor, color: titleColor }
            : triggerHover
            ? { borderColor: `color-mix(in srgb, ${titleColor} 55%, transparent)`, color: titleColor }
            : undefined
        }
      >
      {isActive && activeItem
        ? (<><span aria-hidden="true">{activeItem.emoji}</span>{' '}{activeItem.label}</>)
        : 'System'}
      <svg
        className={`h-3.5 w-3.5 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </button>
      {/* Dropdown panel */}
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute top-full right-0 mt-0.5 z-50 rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{
            background: nav.current.panel,
            border: `1px solid color-mix(in srgb, ${accentColor} 40%, transparent)`
          }}
        >
          <style>{`#${menuId} a:not([aria-current="page"]) { color: color-mix(in srgb, ${accentColor} 75%, var(--ux-text)); } #${menuId} a:not([aria-current="page"]):hover { background-color: color-mix(in srgb, ${accentColor} 12%, transparent); color: ${accentColor}; }`}</style>
          {SYSTEM_ITEMS.map(({ to, label, emoji }) => (
            <NavLink
              key={to}
              to={to}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                  isActive ? 'font-medium' : ''
                }`
              }
              style={({ isActive }: { isActive: boolean }) =>
                isActive
                  ? { color: accentColor, backgroundColor: `color-mix(in srgb, ${accentColor} 18%, transparent)` }
                  : undefined
              }
            >
              <span aria-hidden="true">{emoji}</span>
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { theme, toggle } = useTheme();
  const { getScopeStyle, activeScopeId } = useUXTheme();
  const midStyle = getScopeStyle(activeScopeId);
  const { data: stats } = useQuery({
    queryKey: ['system', 'stats'],
    queryFn: () => systemApi.getStats(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-ux-page shadow-sm dark:shadow-black/40 border-b border-ux-border-strong">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <h1 className="text-2xl font-heading font-bold text-ux-accent">GCUID Proof of Concept</h1>
              <span className="ml-3 text-sm text-ux-text-sub">Identity Management System</span>
            </div>
            <button
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-2 rounded-lg text-ux-text-sub hover:text-ux-text hover:bg-ux-hover transition-colors"
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>
          </div>

          {/* Grouped Navigation */}
          <nav aria-label="Main navigation" className="border-t border-ux-border-strong mt-4">
            <div className="flex items-stretch">
              
              {/* ── Self-Service ──────────────────────────── */}
              <NavGroupDropdown
                label="Self-Service"
                scopeId="portal-self-service"
                menuId="self-service-dropdown"
                items={SELF_SERVICE_ITEMS}
              />

              <NavDivider />
              
              {/* ── Help Desk ─────────────────────────────── */}
              <NavGroupDropdown
                label="Help Desk"
                scopeId="portal-help-desk"
                menuId="helpdesk-dropdown"
                items={HELP_DESK_ITEMS}
              />
              
              <NavDivider />

              {/* ── Authoritative Sources ─────────────────── */}
              <NavGroupDropdown
                label="Authoritative Sources"
                scopeId="conn-hr"
                menuId="auth-sources-dropdown"
                items={AUTH_SOURCE_ITEMS}
              />
              
              <NavDivider />
              
              {/* ── Departments ───────────────────────────── */}
              <NavGroupDropdown
                label="Departments"
                scopeId="conn-engineering"
                menuId="departments-dropdown"
                items={DEPARTMENT_ITEMS}
              />

              <NavDivider />

              {/* ── Corporate Applications ───────────────── */}
              <CorporateAppsDropdown />

              <NavDivider />

              {/* ── GCUID Services ────────────────────────── */}
              <NavGroupDropdown
                label="GCUID Services"
                scopeId="portal-gcuid"
                menuId="gcuid-services-dropdown"
                items={GCUID_SERVICES_ITEMS}
              />
              {/* ── System ───────────────────────────────── */}
              <div className="ml-auto">
                <SystemDropdown />
              </div>

            </div>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-ux-page" style={midStyle}>
        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Outlet />
        </main>
      </div>

      {/* Footer */}
      <footer className="bg-ux-page border-t border-ux-border-strong">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-sm text-ux-text-sub">
            GCUID {getEnvironmentLabel()} v{__BUILD_VERSION__} · Federal Architecture: {stats?.authoritative_sources ?? '—'} Authoritative Source{stats?.authoritative_sources !== 1 ? 's' : ''} · {stats?.departments ?? '—'} Department{stats?.departments !== 1 ? 's' : ''} · GCUID Services
          </p>
        </div>
      </footer>
    </div>
  );
}
