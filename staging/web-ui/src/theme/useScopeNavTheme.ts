import { useMemo } from 'react';
import { useUXTheme } from '../context/UXThemeContext';
import { useTheme } from '../hooks/useTheme';
import { deriveNavTheme, type NavDropdownColors } from './navTheme';

/**
 * Resolve a nav-dropdown palette for a scope, with live updates when the
 * UX config or theme mode changes.
 *
 * @param scopeId  e.g. 'conn-hr' or 'portal-system'.  If the scope isn't
 *                 enabled, falls back to a safe Titanium-derived palette.
 */
export function useScopeNavTheme(scopeId: string): {
  light: NavDropdownColors;
  dark:  NavDropdownColors;
  current: NavDropdownColors;
} {
  const { config } = useUXTheme();
  const { theme } = useTheme();

  const light = useMemo(
    () => deriveNavTheme(config?.scopes?.[scopeId]?.theme as any, 'light'),
    [config, scopeId],
  );
  const dark = useMemo(
    () => deriveNavTheme(config?.scopes?.[scopeId]?.theme as any, 'dark'),
    [config, scopeId],
  );

  return {
    light,
    dark,
    current: theme === 'dark' ? dark : light,
  };
}