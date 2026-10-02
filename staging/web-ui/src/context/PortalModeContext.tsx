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
import { createContext, useContext, ReactNode, useCallback } from 'react';
import { useFeatureFlags } from '../hooks/useFeatureFlags';

export type PortalMode = 'single' | 'separate';

interface PortalModeContextValue {
  mode: PortalMode;
  setMode: (m: PortalMode) => void;
}

const PortalModeContext = createContext<PortalModeContextValue | null>(null);

export function PortalModeProvider({ children }: { children: ReactNode }) {
  const { flags, setFlag } = useFeatureFlags();

  const setMode = useCallback((m: PortalMode) => {
    setFlag('portalMode', m);
  }, [setFlag]);

  const value: PortalModeContextValue = {
    mode: flags.portalMode,
    setMode,
  };

  return (
    <PortalModeContext.Provider value={value}>
      {children}
    </PortalModeContext.Provider>
  );
}

export function usePortalModeContext(): PortalModeContextValue {
  const ctx = useContext(PortalModeContext);
  if (!ctx) throw new Error('usePortalModeContext must be used within a PortalModeProvider');
  return ctx;
}
