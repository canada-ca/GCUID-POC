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

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Accent colour classes for active/selected elements, e.g. 'text-indigo-600 dark:text-indigo-400' */
  accentClass?: string;
  /** Override the available page-size options. Defaults to [10, 25, 50, 100]. */
  pageSizeOptions?: number[];
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * Pagination controls: page-size selector, record range label, prev/next buttons,
 * and numbered page buttons with ellipsis truncation.
 */
export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  accentClass = 'text-ux-nav-label',
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: PaginationProps) {
  if (totalItems === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);

  // Build page number list with ellipsis
  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  const btnBase =
    'inline-flex items-center justify-center min-w-[2rem] h-8 px-2 text-xs font-medium rounded border transition-colors';
  const btnInactive =
    'border-ux-border text-ux-text-sub hover:bg-ux-hover bg-ux-surface';
  const btnActive =
    `border-current ${accentClass} bg-ux-accent-subtle`;
  const btnDisabled =
    'border-ux-border text-ux-text-muted cursor-not-allowed bg-ux-surface';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 border-t border-ux-border text-xs text-ux-text-sub">
      {/* Left: rows-per-page */}
      <div className="flex items-center gap-2">
        <span>Rows per page:</span>
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-7 rounded border border-ux-border bg-ux-surface text-ux-text text-xs px-1.5 focus:outline-none focus:ring-1 focus:ring-ux-accent"
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Center: record range */}
      <span className="text-ux-text-muted">
        {first}–{last} of {totalItems} records
      </span>

      {/* Right: page controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          className={`${btnBase} ${page === 1 ? btnDisabled : btnInactive}`}
        >
          ‹
        </button>

        {pages.map((p, idx) =>
          p === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-1 text-ux-text-muted">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              aria-label={`Page ${p}`}
              aria-current={p === page ? 'page' : undefined}
              className={`${btnBase} ${p === page ? btnActive : btnInactive}`}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
          className={`${btnBase} ${page === totalPages ? btnDisabled : btnInactive}`}
        >
          ›
        </button>
      </div>
    </div>
  );
}
