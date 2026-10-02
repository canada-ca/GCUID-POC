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
import { createContext, useContext, ReactNode } from 'react';
import { useDateTimeFormat } from '../hooks/useDateTimeFormat';

type DateTimeFormatContextValue = ReturnType<typeof useDateTimeFormat>;

const DateTimeFormatContext = createContext<DateTimeFormatContextValue | null>(null);

export function DateTimeFormatProvider({ children }: { children: ReactNode }) {
  const value = useDateTimeFormat();
  return (
    <DateTimeFormatContext.Provider value={value}>
      {children}
    </DateTimeFormatContext.Provider>
  );
}

/**
 * Access the active date/time formatting preferences and helper functions.
 *
 * - `prefs`   – the current DateTimePrefs object
 * - `setPrefs` – update one or more preference fields
 * - `reset`   – restore defaults
 * - `fmt(ts)` – format a timestamp as "date time"
 * - `fmtDate(ts)` – format a timestamp as date only
 */
export function useDateTime(): DateTimeFormatContextValue {
  const ctx = useContext(DateTimeFormatContext);
  if (!ctx) throw new Error('useDateTime must be used within a DateTimeFormatProvider');
  return ctx;
}
