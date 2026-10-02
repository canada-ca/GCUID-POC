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
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { PORTAL_GROUPS, COLOR_TOKENS, PortalGroup, PortalTab } from '../config/portals';
import { UXScopeWrapper } from '../context/UXThemeContext';
import { usePortalModeContext } from '../context/PortalModeContext';
import { getEnvironmentLabel } from '../utils/environment';

declare const __BUILD_VERSION__: string;

// ─── Single-launch card (groups with one tab) ───────────────────────────────

function PortalCard({ portal }: { portal: PortalGroup }) {
  const tokens = COLOR_TOKENS[portal.colorId];
  const { mode } = usePortalModeContext();
  const navigate = useNavigate();

  function handleOpen() {
    // In unified (single-window) mode, navigate inside this window so the
    // user gets the combined Layout with the global sidebar. In separate
    // (per-window) mode, open the portal in a new window so it has its own
    // PortalLayout / navigation.
    if (mode === 'single') {
      navigate(portal.defaultRoute);
    } else {
      window.open(portal.defaultRoute, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <button
      onClick={handleOpen}
      className={`text-left w-full border-2 rounded-xl p-5 bg-ux-surface/60 transition-all duration-150 shadow-sm hover:shadow-md ${tokens.cardBorder} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ux-accent`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 mt-0.5 ${tokens.dot}`} />
          <span className="font-semibold text-ux-text text-base">
            {portal.label}
          </span>
        </div>
        {/* External link icon */}
        <svg
          className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </div>
      <p className="mt-2 text-sm text-ux-text-sub pl-[18px]">
        {portal.description}
      </p>
    </button>
  );
}

// ─── Per-tab link (groups with multiple tabs) ────────────────────────────────

function TabLink({ portal, tab }: { portal: PortalGroup; tab: PortalTab }) {
  const tokens = COLOR_TOKENS[portal.colorId];
  const { mode } = usePortalModeContext();
  const navigate = useNavigate();

  function handleClick() {
    if (mode === 'single') {
      navigate(tab.to);
    } else {
      window.open(tab.to, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center justify-between gap-2 text-left border-2 rounded-lg px-4 py-2.5 bg-ux-surface/60 transition-all duration-150 shadow-sm hover:shadow-md ${tokens.cardBorder} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ux-accent`}
    >
      <span className={`text-sm font-medium ${tokens.label}`}>{tab.label}</span>
      <svg
        className="h-3.5 w-3.5 text-gray-400 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// ─── Portal group section (renders card for 1-tab groups, tab list for multi) ─

function PortalGroupSection({ portal }: { portal: PortalGroup }) {
  if (portal.tabs.length === 1) {
    return <PortalCard portal={portal} />;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-ux-text-sub pl-[18px]">{portal.description}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 pl-[18px]">
        {portal.tabs.map((tab) => (
          <TabLink key={tab.to} portal={portal} tab={tab} />
        ))}
      </div>
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({
  label,
  dotClass,
  labelClass,
}: {
  label: string;
  dotClass: string;
  labelClass: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <h2 className={`text-xs font-bold uppercase tracking-widest ${labelClass}`}>{label}</h2>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const self_service  = PORTAL_GROUPS.find((g) => g.id === 'self-service')!;
const help_desk     = PORTAL_GROUPS.find((g) => g.id === 'help-desk')!;
const hr            = PORTAL_GROUPS.find((g) => g.id === 'hr')!;
const ldap          = PORTAL_GROUPS.find((g) => g.id === 'ldap')!;
const engineering   = PORTAL_GROUPS.find((g) => g.id === 'engineering')!;
const finance       = PORTAL_GROUPS.find((g) => g.id === 'finance')!;
const gcuid         = PORTAL_GROUPS.find((g) => g.id === 'gcuid')!;
const corp_apps     = PORTAL_GROUPS.find((g) => g.id === 'corp-apps')!;
const system        = PORTAL_GROUPS.find((g) => g.id === 'system')!;

export default function PortalIndexPage() {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const { mode, setMode } = usePortalModeContext();

  return (
    <UXScopeWrapper scopeId="portal-system">
    <div className="min-h-screen bg-ux-page flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-ux-page shadow-sm dark:shadow-black/40 border-b border-ux-border-strong">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1
                className="text-2xl font-heading font-bold text-ux-text"
                style={{ textShadow: '0 0 12px color-mix(in srgb, var(--ux-accent-primary) 50%, transparent), 0 0 32px color-mix(in srgb, var(--ux-accent-primary) 25%, transparent)' }}
              >
                GCUID Proof of Concept
              </h1>
              <p className="text-sm text-ux-text-sub mt-0.5">
                Identity Management System — Portal Selection
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* System settings shortcut */}
              <button
                onClick={() => navigate('/options')}
                aria-label="Open System portal"
                title="System portal"
                className="p-2 rounded-lg text-ux-text-sub hover:text-gray-800 dark:hover:text-gray-100 hover:bg-ux-hover transition-colors"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

              {/* Theme toggle */}
              <button
                onClick={toggle}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                className="p-2 rounded-lg text-ux-text-sub hover:text-gray-800 dark:hover:text-gray-100 hover:bg-ux-hover transition-colors"
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
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        <div>
          <h2 className="text-xl font-semibold text-ux-text">
            Select a Portal
          </h2>
          <p className="mt-1 text-sm text-ux-text-sub">
            Each portal opens in a new window. Click a card to launch, or switch to the
            {' '}
            <button
              onClick={() => setMode('single')}
              className="underline hover:text-ux-accent transition-colors"
            >
              unified single-window view
            </button>
            {' '}via the footer below.
          </p>
        </div>

        {/* Self-Service */}
        <section aria-label="Self-Service">
          <SectionHeading
            label="Self-Service"
            dotClass="bg-teal-500"
            labelClass="text-teal-700 dark:text-teal-400"
          />
          <PortalGroupSection portal={self_service} />
        </section>

        {/* Help Desk */}
        <section aria-label="Help Desk">
          <SectionHeading
            label="Help Desk"
            dotClass="bg-teal-500"
            labelClass="text-teal-700 dark:text-teal-400"
          />
          <PortalGroupSection portal={help_desk} />
        </section>

        {/* Authoritative Sources */}
    <section aria-label="Authoritative Sources">
      <SectionHeading
        label="Authoritative Sources"
        dotClass="bg-blue-500"
        labelClass="text-blue-700 dark:text-blue-300"
      />
          <div className="grid sm:grid-cols-2 gap-4">
            <PortalCard portal={hr} />
            <PortalCard portal={ldap} />
          </div>
        </section>

        {/* Departments */}
        <section aria-label="Departments">
          <SectionHeading
            label="Departments"
            dotClass="bg-purple-500"
            labelClass="text-purple-700 dark:text-purple-300"
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <PortalCard portal={engineering} />
            <PortalCard portal={finance} />
          </div>
        </section>

        {/* Corporate Applications */}
        <section aria-label="Corporate Applications">
          <SectionHeading
            label="Corporate Applications"
            dotClass="bg-orange-500"
            labelClass="text-orange-700 dark:text-orange-300"
          />
          <PortalGroupSection portal={corp_apps} />
        </section>

        {/* GCUID Services */}
        <section aria-label="GCUID Services">
          <SectionHeading
            label="GCUID Services"
            dotClass="bg-amber-500"
            labelClass="text-amber-700 dark:text-amber-300"
          />
          <PortalGroupSection portal={gcuid} />
        </section>

        {/* System */}
        <section aria-label="System">
          <SectionHeading
            label="System"
            dotClass="bg-violet-500"
            labelClass="text-violet-700 dark:text-violet-300"
          />
          <PortalGroupSection portal={system} />
        </section>

      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="bg-ux-page border-t border-ux-border-strong">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-center sm:text-left text-sm text-ux-text-sub">
              GCUID {getEnvironmentLabel()} v{__BUILD_VERSION__} · Portal Selection
            </p>
            <div className="flex items-center gap-3 text-xs text-ux-text-sub">
              <span>Window mode:</span>
              <button
                onClick={() => setMode('separate')}
                aria-pressed={mode === 'separate'}
                className={`px-2 py-0.5 rounded transition-colors ${
                  mode === 'separate'
                    ? 'bg-ux-accent text-ux-accent-on font-medium'
                    : 'hover:text-ux-text'
                }`}
                title="Each portal opens in its own window"
              >
                Separate
              </button>
              <button
                onClick={() => setMode('single')}
                aria-pressed={mode === 'single'}
                className={`px-2 py-0.5 rounded transition-colors ${
                  mode === 'single'
                    ? 'bg-ux-accent text-ux-accent-on font-medium'
                    : 'hover:text-ux-text'
                }`}
                title="All portals share one window with the combined Layout"
              >
                Unified
              </button>
              <span className="text-ux-text-muted">·</span>
              <button
                onClick={() => navigate('/options')}
                className="underline hover:text-ux-text transition-colors"
              >
                Open Options
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>    </UXScopeWrapper>  );
}
