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
import type { SortDir } from '../hooks/useSortableTable';

interface SortThProps {
  /** Column key this header controls */
  col: string;
  /** Currently active sort column */
  sortBy: string;
  /** Current sort direction */
  sortDir: SortDir;
  /** Called when header is clicked */
  onSort: (col: string) => void;
  /** Text label */
  children: React.ReactNode;
  /** Tailwind text-color classes for the active-sort state, e.g. 'text-blue-700 dark:text-blue-300'.
   *  Defaults to violet to match the generic/neutral table palette. */
  activeClass?: string;
  /** Tailwind text-align class, e.g. 'text-left' or 'text-right' (default: 'text-left') */
  align?: 'text-left' | 'text-right' | 'text-center';
  /** Extra class names on the <th> */
  className?: string;
}

/**
 * A sortable <th> cell.  Highlights using the caller-supplied activeClass when
 * active and shows a directional chevron; shows a faint hover chevron on
 * inactive columns.  Pass activeClass matching the portal's accent colour so
 * the active-sort indicator is visually coherent with the table header and row
 * highlight colour scheme.
 */
export function SortTh({
  col,
  sortBy,
  sortDir,
  onSort,
  children,
  activeClass = 'text-violet-600 dark:text-violet-400',
  align = 'text-left',
  className = '',
}: SortThProps) {
  const active = col === sortBy;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap select-none cursor-pointer group ${align} ${
        active
          ? activeClass
          : 'text-ux-text-sub hover:text-ux-text'
      } ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
          {active && sortDir === 'asc' ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
            </svg>
          )}
        </span>
      </span>
    </th>
  );
}
