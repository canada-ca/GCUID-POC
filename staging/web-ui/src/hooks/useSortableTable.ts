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
import { useState, useMemo } from 'react';

export type SortDir = 'asc' | 'desc';

/**
 * Client-side sortable table hook.
 *
 * Accepts a data array and returns a sorted copy plus state/handlers
 * for wiring up column header click-to-sort buttons.
 *
 * @param data          The array to sort (may be undefined/null while loading).
 * @param defaultSortBy Initial sort column key.
 * @param defaultDir    Initial sort direction (default: 'asc').
 */
export function useSortableTable<T extends object>(
  data: T[] | undefined | null,
  defaultSortBy: string,
  defaultDir: SortDir = 'asc',
) {
  const [sortBy,  setSortBy]  = useState<string>(defaultSortBy);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const handleSort = (col: string) => {
    if (col === sortBy) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const sorted = useMemo<T[]>(() => {
    const arr = data ?? [];
    if (!arr.length) return arr;
    return [...arr].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortBy];
      const bv = (b as Record<string, unknown>)[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortBy, sortDir]);

  return { sorted, sortBy, sortDir, handleSort };
}
