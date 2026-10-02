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
import { useState, useCallback, useEffect } from 'react';

/**
 * Client-side pagination hook.
 *
 * Accepts a (pre-sorted/filtered) array and returns a page-sliced copy
 * plus state and handlers for rendering a page control UI.
 *
 * @param items           The full sorted/filtered array to paginate.
 * @param defaultPageSize Number of rows per page (default: 25).
 */
export function usePagination<T>(items: T[] | undefined | null, defaultPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const arr = items ?? [];
  const totalItems = arr.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  // Clamp page to valid range (handles size/filter changes)
  const safePage = Math.min(page, totalPages);

  const paginated = arr.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Reset to page 1 whenever the source array length changes (filter applied)
  useEffect(() => {
    setPage(1);
  }, [totalItems]);

  const reset = useCallback(() => setPage(1), []);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  }, []);

  return {
    paginated,
    page: safePage,
    setPage,
    pageSize,
    setPageSize: handlePageSizeChange,
    totalPages,
    totalItems,
    reset,
  };
}
