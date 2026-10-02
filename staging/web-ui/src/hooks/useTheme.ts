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
import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('gcuid-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    // Keep native browser elements (scrollbars, date pickers, form controls)
    // in sync with the app theme, overriding any OS-level preference.
    root.style.colorScheme = theme;
  }, [theme]);

  // Keep this instance in sync when another instance (e.g. the header toggle)
  // mutates the <html> class directly.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next: Theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
      setThemeState(prev => prev !== next ? next : prev);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // On mount, also listen for system preference changes (only when no manual override stored)
  useEffect(() => {
    const stored = localStorage.getItem('gcuid-theme');
    if (stored) return; // user has a manual preference, don't follow system

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setThemeState(e.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const setTheme = (t: Theme) => {
    localStorage.setItem('gcuid-theme', t);
    setThemeState(t);
  };

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, setTheme, toggle };
}
