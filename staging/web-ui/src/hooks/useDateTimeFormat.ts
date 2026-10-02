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
import { useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Date-only format options */
export type DateFormat = 'ISO' | 'EU' | 'US' | 'LONG';

/** Time format options */
export type TimeFormat = '24h' | '12h';

export interface DateTimePrefs {
  /** Date portion format */
  dateFormat: DateFormat;
  /** Time portion format */
  timeFormat: TimeFormat;
  /** IANA timezone string — empty string means browser local time */
  timezone: string;
}

export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string; example: string }[] = [
  { value: 'ISO',  label: 'YYYY-MM-DD',     example: '2026-05-02'      },
  { value: 'EU',   label: 'DD/MM/YYYY',     example: '02/05/2026'      },
  { value: 'US',   label: 'MM/DD/YYYY',     example: '05/02/2026'      },
  { value: 'LONG', label: 'Month D, YYYY',  example: 'May 2, 2026'     },
];

export const TIME_FORMAT_OPTIONS: { value: TimeFormat; label: string; example: string }[] = [
  { value: '24h', label: '24-hour (HH:mm:ss)', example: '14:05:09' },
  { value: '12h', label: '12-hour (h:mm:ss AM/PM)', example: '2:05:09 PM' },
];

// Canonical list of timezones surfaced in the UI.
// Subset: UTC + Canadian zones + common international zones.
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: '',                    label: 'Browser local time'            },
  { value: 'UTC',                 label: 'UTC'                           },
  { value: 'America/St_Johns',    label: 'Newfoundland (UTC−3:30/−2:30)' },
  { value: 'America/Halifax',     label: 'Atlantic (UTC−4/−3)'          },
  { value: 'America/Toronto',     label: 'Eastern (UTC−5/−4)'           },
  { value: 'America/Winnipeg',    label: 'Central (UTC−6/−5)'           },
  { value: 'America/Edmonton',    label: 'Mountain (UTC−7/−6)'          },
  { value: 'America/Vancouver',   label: 'Pacific (UTC−8/−7)'           },
  { value: 'America/New_York',    label: 'US Eastern'                   },
  { value: 'America/Chicago',     label: 'US Central'                   },
  { value: 'America/Los_Angeles', label: 'US Pacific'                   },
  { value: 'Europe/London',       label: 'London (UTC+0/+1)'            },
  { value: 'Europe/Paris',        label: 'Central Europe (UTC+1/+2)'    },
  { value: 'Asia/Tokyo',          label: 'Japan (UTC+9)'                },
];

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_DATETIME_PREFS: DateTimePrefs = {
  dateFormat: 'ISO',   // Canadian Government standard: YYYY-MM-DD
  timeFormat: '24h',
  timezone:   '',      // browser local time by default
};

const STORAGE_KEY = 'gcuid_datetime_prefs';

// ─── Persistence helpers ──────────────────────────────────────────────────────

function load(): DateTimePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DATETIME_PREFS;
    const stored = JSON.parse(raw) as Partial<DateTimePrefs>;
    return {
      dateFormat: stored.dateFormat ?? DEFAULT_DATETIME_PREFS.dateFormat,
      timeFormat: stored.timeFormat ?? DEFAULT_DATETIME_PREFS.timeFormat,
      timezone:   stored.timezone   ?? DEFAULT_DATETIME_PREFS.timezone,
    };
  } catch {
    return DEFAULT_DATETIME_PREFS;
  }
}

function save(prefs: DateTimePrefs): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ─── Core formatting helpers (exported for use outside React) ─────────────────

/**
 * Format an ISO timestamp string (or Date) as a date-only string using
 * the supplied preferences.
 */
export function formatDateOnly(
  ts: string | Date | null | undefined,
  prefs: DateTimePrefs,
): string {
  if (!ts) return '—';
  try {
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    if (isNaN(d.getTime())) return String(ts);

    const tz = prefs.timezone || undefined;

    switch (prefs.dateFormat) {
      case 'ISO': {
        // Always produce YYYY-MM-DD regardless of locale
        const parts = new Intl.DateTimeFormat('en-CA', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          ...(tz ? { timeZone: tz } : {}),
        }).formatToParts(d);
        const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
        return `${p.year}-${p.month}-${p.day}`;
      }
      case 'EU': {
        const parts = new Intl.DateTimeFormat('en-GB', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          ...(tz ? { timeZone: tz } : {}),
        }).formatToParts(d);
        const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
        return `${p.day}/${p.month}/${p.year}`;
      }
      case 'US': {
        const parts = new Intl.DateTimeFormat('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          ...(tz ? { timeZone: tz } : {}),
        }).formatToParts(d);
        const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
        return `${p.month}/${p.day}/${p.year}`;
      }
      case 'LONG': {
        return new Intl.DateTimeFormat('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
          ...(tz ? { timeZone: tz } : {}),
        }).format(d);
      }
    }
  } catch {
    return String(ts);
  }
}

/**
 * Format an ISO timestamp string (or Date) as a full date-time string using
 * the supplied preferences.
 */
export function formatDateTime(
  ts: string | Date | null | undefined,
  prefs: DateTimePrefs,
): string {
  if (!ts) return '—';
  try {
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    if (isNaN(d.getTime())) return String(ts);

    const tz = prefs.timezone || undefined;
    const h12 = prefs.timeFormat === '12h';

    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: h12,
      ...(tz ? { timeZone: tz } : {}),
    }).formatToParts(d);

    const p: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') p[part.type] = part.value;
      // collect dayperiod for 12h
    }

    let dateStr: string;
    switch (prefs.dateFormat) {
      case 'ISO':  dateStr = `${p.year}-${p.month}-${p.day}`; break;
      case 'EU':   dateStr = `${p.day}/${p.month}/${p.year}`; break;
      case 'US':   dateStr = `${p.month}/${p.day}/${p.year}`; break;
      case 'LONG': {
        dateStr = new Intl.DateTimeFormat('en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
          ...(tz ? { timeZone: tz } : {}),
        }).format(d);
        break;
      }
    }

    const timeStr = h12
      ? `${p.hour}:${p.minute}:${p.second} ${p.dayPeriod ?? ''}`
      : `${p.hour}:${p.minute}:${p.second}`;

    return `${dateStr} ${timeStr.trim()}`;
  } catch {
    return String(ts);
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDateTimeFormat() {
  const [prefs, setPrefsState] = useState<DateTimePrefs>(load);

  const setPrefs = useCallback((patch: Partial<DateTimePrefs>) => {
    setPrefsState(prev => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPrefsState(DEFAULT_DATETIME_PREFS);
    save(DEFAULT_DATETIME_PREFS);
  }, []);

  return {
    prefs,
    setPrefs,
    reset,
    /** Format a timestamp as date + time */
    fmt: (ts: string | Date | null | undefined) => formatDateTime(ts, prefs),
    /** Format a timestamp as date only */
    fmtDate: (ts: string | Date | null | undefined) => formatDateOnly(ts, prefs),
  };
}
