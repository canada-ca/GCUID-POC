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
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  CSSProperties,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { uxConfigApi, UXConfig, ThemeTokens } from '../api/client';
import { useTheme } from '../hooks/useTheme';

// ─── CSS variable map ─────────────────────────────────────────────────────────

/** Maps each ThemeTokens key to its corresponding CSS custom property name. */
const CSS_VAR_MAP: Record<keyof ThemeTokens, string> = {
  bgPage:           '--ux-bg-page',
  bgSurface:        '--ux-bg-surface',
  bgSurfaceAlt:     '--ux-bg-surface-alt',
  bgHover:          '--ux-bg-hover',
  bgHighlight:      '--ux-bg-highlight',
  borderDefault:    '--ux-border-default',
  borderStrong:     '--ux-border-strong',
  textPrimary:      '--ux-text-primary',
  textSecondary:    '--ux-text-secondary',
  textMuted:        '--ux-text-muted',
  textLink:         '--ux-text-link',
  accentPrimary:    '--ux-accent-primary',
  accentOnPrimary:  '--ux-accent-on-primary',
  accentSecondary:  '--ux-accent-secondary',
  btnPrimaryBg:     '--ux-btn-primary-bg',
  btnPrimaryText:   '--ux-btn-primary-text',
  btnSecondaryBg:   '--ux-btn-secondary-bg',
  btnSecondaryText: '--ux-btn-secondary-text',
  statusSuccess:    '--ux-status-success',
  statusWarning:    '--ux-status-warning',
  statusError:      '--ux-status-error',
  statusInfo:       '--ux-status-info',
  navDotColor:       '--ux-nav-dot-color',
  navLabelColor:     '--ux-nav-label-color',
  tableHeaderBg:     '--ux-table-header-bg',
  inputBg:           '--ux-input-bg',
  codeBg:            '--ux-code-bg',
  badgeNeutralBg:    '--ux-badge-neutral-bg',
  badgeNeutralText:  '--ux-badge-neutral-text',
  toggleThumb:       '--ux-toggle-thumb',
  accentSubtleBg:     '--ux-accent-subtle-bg',
  accentSubtleBorder: '--ux-accent-subtle-border',
  accentMutedBg:      '--ux-accent-muted-bg',
  statusSuccessBg:     '--ux-status-success-bg',
  statusSuccessBorder: '--ux-status-success-border',
  statusWarningBg:     '--ux-status-warning-bg',
  statusWarningBorder: '--ux-status-warning-border',
  statusErrorBg:       '--ux-status-error-bg',
  statusErrorBorder:   '--ux-status-error-border',
  statusInfoBg:        '--ux-status-info-bg',
  statusInfoBorder:    '--ux-status-info-border',
  navAuthSourcePanelBg: '--ux-nav-auth-panel-bg',
  navAuthSourceAccent:  '--ux-nav-auth-accent',
  navDeptPanelBg:       '--ux-nav-dept-panel-bg',
  navDeptAccent:        '--ux-nav-dept-accent',
  navSystemPanelBg:     '--ux-nav-system-panel-bg',
  navSystemAccent:      '--ux-nav-system-accent',
  bgElevation1:         '--ux-elevation1',
  bgElevation2:         '--ux-elevation2',
};

// ─── Context value type ───────────────────────────────────────────────────────

interface UXThemeContextValue {
  /** Full config loaded from the API (undefined while loading). */
  config: UXConfig | undefined;
  isLoading: boolean;
  /**
   * Returns an inline-style object with CSS custom properties for the given
   * scope's current theme mode.  When the scope is not found or not enabled,
   * returns an empty object (global CSS vars remain in effect).
   */
  getScopeStyle: (scopeId: string) => CSSProperties;
  /** The scope ID currently active (set by the mounted UXScopeWrapper). */
  activeScopeId: string;
  setActiveScopeId: (id: string) => void;
}

const UXThemeContext = createContext<UXThemeContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function UXThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const [activeScopeId, setActiveScopeId] = useState('');

  const { data: config, isLoading } = useQuery({
    queryKey: ['ux-config'],
    queryFn: () => uxConfigApi.get(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Inject global CSS vars on :root whenever config or light/dark mode changes
  useEffect(() => {
    if (!config) return;
    const tokens = config.global[theme];
    const root = document.documentElement;
    for (const [tokenKey, cssVar] of Object.entries(CSS_VAR_MAP)) {
      root.style.setProperty(cssVar, tokens[tokenKey as keyof ThemeTokens]);
    }
  }, [config, theme]);

  /** Build a CSSProperties object for a specific scope's tokens. */
  const getScopeStyle = (scopeId: string): CSSProperties => {
    if (!config) return {};
    const scope = config.scopes[scopeId];
    if (!scope?.enabled) return {};
    const tokens = scope.theme[theme];
    const style: Record<string, string> = {};
    for (const [tokenKey, cssVar] of Object.entries(CSS_VAR_MAP)) {
      style[cssVar] = tokens[tokenKey as keyof ThemeTokens];
    }
    return style as CSSProperties;
  };

  return (
    <UXThemeContext.Provider value={{ config, isLoading, getScopeStyle, activeScopeId, setActiveScopeId }}>
      {children}
    </UXThemeContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useUXTheme(): UXThemeContextValue {
  const ctx = useContext(UXThemeContext);
  if (!ctx) throw new Error('useUXTheme must be used within a UXThemeProvider');
  return ctx;
}

// ─── Scope wrapper component ─────────────────────────────────────────────────

/**
 * Wraps mid-section portal content and applies the connector's UX scope
 * overrides as CSS custom properties.  When the scope is not configured or
 * not enabled, the component renders a transparent pass-through wrapper.
 *
 * Usage:
 *   <UXScopeWrapper scopeId="connector-hr">
 *     <HRPortal />
 *   </UXScopeWrapper>
 */
export function UXScopeWrapper({
  scopeId,
  children,
  className,
}: {
  scopeId: string;
  children: ReactNode;
  className?: string;
}) {
  const { getScopeStyle, setActiveScopeId } = useUXTheme();
  const style = getScopeStyle(scopeId);
  const hasOverride = Object.keys(style).length > 0;

  // Bubble the active scope ID up to the layout so the outer bg wrapper can
  // also receive the CSS variable overrides (CSS vars only flow downward).
  useEffect(() => {
    setActiveScopeId(hasOverride ? scopeId : '');
    return () => { setActiveScopeId(''); };
  }, [scopeId, hasOverride, setActiveScopeId]);

  // Default to 'contents' so the wrapper is layout-neutral; CSS vars still
  // inherit to all descendants because custom properties propagate through
  // display:contents elements.
  const cls = className ?? 'contents';
  return (
    <div
      style={hasOverride ? style : undefined}
      className={cls}
      data-ux-scope={hasOverride ? scopeId : undefined}
    >
      {children}
    </div>
  );
}
