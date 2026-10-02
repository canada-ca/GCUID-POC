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
import { Outlet, NavLink, Link, useLocation } from 'react-router-dom';
import { getEnvironmentLabel } from '../utils/environment';
import { useTheme } from '../hooks/useTheme';
import { useUXTheme } from '../context/UXThemeContext';
import { findPortalGroup, COLOR_TOKENS, PORTAL_GROUPS } from '../config/portals';

export default function PortalLayout() {
  const { theme, toggle } = useTheme();
  const { getScopeStyle, activeScopeId } = useUXTheme();
  const midStyle = getScopeStyle(activeScopeId);
  const location = useLocation();

  // Determine the portal group from the current path; fall back to self-service
  const group = findPortalGroup(location.pathname) ?? PORTAL_GROUPS[0];
  const tokens = COLOR_TOKENS[group.colorId];
  const multiTab = group.tabs.length > 1;

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-ux-page shadow-sm dark:shadow-black/40 border-b border-ux-border-strong">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3">

            {/* Left: breadcrumb + portal name */}
            <div className="flex items-center gap-3 min-w-0">
              <Link
                to="/"
                className="flex items-center gap-1 text-xs text-ux-text-muted hover:text-ux-text-sub transition-colors shrink-0"
                title="Back to portal selection"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                All Portals
              </Link>

              <span className="text-gray-300 dark:text-gray-600 select-none" aria-hidden="true">/</span>

              <h1 className={`text-xl font-heading font-bold truncate ${tokens.label}`}>
                {group.label}
              </h1>
            </div>

            {/* Right: theme toggle */}
            <button
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-2 rounded-lg text-ux-text-sub hover:text-ux-text hover:bg-ux-hover transition-colors shrink-0"
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

          {/* Portal-specific tab bar — only shown when the portal has more than one section */}
          {multiTab && (
            <nav
              aria-label={`${group.label} navigation`}
              className="border-t border-ux-border-strong mt-2"
            >
              <div className="flex items-stretch">
                {group.tabs.map((tab) => (
                  <NavLink
                    key={tab.to}
                    to={tab.to}
                    className={({ isActive }) =>
                      `py-3 px-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy ${
                        isActive
                          ? tokens.activeTab
                          : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
                      }`
                    }
                  >
                    {tab.label}
                  </NavLink>
                ))}
              </div>
            </nav>
          )}
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-ux-page" style={midStyle}>
        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Outlet />
        </main>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="bg-ux-page border-t border-ux-border-strong">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-sm text-ux-text-sub">
            GCUID {getEnvironmentLabel()} v{__BUILD_VERSION__} · {group.label}
          </p>
        </div>
      </footer>
    </div>
  );
}
