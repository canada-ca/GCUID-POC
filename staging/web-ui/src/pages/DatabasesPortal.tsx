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
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { databasesApi, DbPortalDatabase, DbPortalTableData, DbPortalColumn } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { UXScopeWrapper } from '../context/UXThemeContext';
import { Pagination } from '../components/Pagination';
import { SortTh } from '../components/SortTh';
import type { SortDir } from '../hooks/useSortableTable';

// --- Constants ----------------------------------------------------------------

const PAGE_SIZES = [25, 50, 100, 250] as const;

const COLOR_SCHEMES: Record<string, { dot: string; badge: string; active: string; hover: string }> = {
  amber:  { dot: 'bg-amber-400',  badge: 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300',  active: 'bg-amber-100 dark:bg-amber-800/30 border-l-2 border-amber-500', hover: 'hover:bg-amber-50 dark:hover:bg-amber-900/10' },
  blue:   { dot: 'bg-blue-400',   badge: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',    active: 'bg-blue-100 dark:bg-blue-800/30 border-l-2 border-blue-500',   hover: 'hover:bg-blue-50 dark:hover:bg-blue-900/10' },
  indigo: { dot: 'bg-indigo-400', badge: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300', active: 'bg-indigo-100 dark:bg-indigo-800/30 border-l-2 border-indigo-500', hover: 'hover:bg-indigo-50 dark:hover:bg-indigo-900/10' },
  slate:  { dot: 'bg-ux-muted',   badge: 'bg-ux-badge-neutral text-ux-badge-neutral-text',  active: 'bg-ux-highlight border-l-2 border-ux-border-strong', hover: 'hover:bg-ux-hover' },
  purple: { dot: 'bg-purple-400', badge: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300', active: 'bg-purple-100 dark:bg-purple-800/30 border-l-2 border-purple-500', hover: 'hover:bg-purple-50 dark:hover:bg-purple-900/10' },
  green:  { dot: 'bg-green-400',  badge: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',  active: 'bg-green-100 dark:bg-green-800/30 border-l-2 border-green-500',  hover: 'hover:bg-green-50 dark:hover:bg-green-900/10' },
};

function scheme(color: string) {
  return COLOR_SCHEMES[color] ?? COLOR_SCHEMES['slate'];
}

// --- Helpers ------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function cellClass(type: string): string {
  const t = type.toLowerCase();
  if (/int|real|num|float|double/.test(t)) return 'text-right font-mono text-violet-700 dark:text-violet-300';
  if (/bool/.test(t)) return 'text-center font-mono text-teal-700 dark:text-teal-300';
  return 'text-left';
}

function formatCellValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function NullBadge() {
  return (
    <span className="text-[10px] italic text-ux-text-sub bg-ux-hover/50 rounded px-1">
      NULL
    </span>
  );
}

// --- Row detail: JSON viewer ---------------------------------------------------

function JsonView({ value }: { value: string }) {
  const [collapsed, setCollapsed] = useState(false);
  let parsed: any;
  try { parsed = JSON.parse(value); } catch { return <span className="break-all text-xs">{value}</span>; }
  return (
    <div>
      <button
        onClick={() => setCollapsed(c => !c)}
        className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline mb-1 flex items-center gap-1"
      >
        <svg viewBox="0 0 16 16" className={`w-2.5 h-2.5 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4l4 4-4 4"/>
        </svg>
        {collapsed ? 'JSON (collapsed)' : 'JSON'}
      </button>
      {!collapsed && (
        <pre className="text-[10px] font-mono whitespace-pre-wrap break-all text-ux-text-sub max-h-48 overflow-y-auto leading-4">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  );
}

// --- Row detail: field view ----------------------------------------------------

function FieldView({ col, value }: { col: DbPortalColumn; value: any }) {
  const [fieldCopied, setFieldCopied] = useState(false);

  const isJsonStr = typeof value === 'string' &&
    (value.trimStart().startsWith('{') || value.trimStart().startsWith('[')) &&
    (() => { try { JSON.parse(value); return true; } catch { return false; } })();

  const isDateCol = /(_at|_date|_time|date|timestamp)/i.test(col.name) &&
    value !== null && value !== undefined;

  const copyField = () => {
    const text = value === null || value === undefined ? '' : String(value);
    navigator.clipboard.writeText(text).catch(() => undefined);
    setFieldCopied(true);
    setTimeout(() => setFieldCopied(false), 1500);
  };

  let renderedValue: React.ReactNode;
  if (value === null || value === undefined) {
    renderedValue = <NullBadge />;
  } else if (isJsonStr) {
    renderedValue = <JsonView value={value as string} />;
  } else if (isDateCol && typeof value === 'number') {
    const d = new Date(value * 1000);
    renderedValue = (
      <div>
        <span className="text-blue-700 dark:text-blue-300 block">{d.toLocaleString()}</span>
        <span className="text-ux-text-sub text-[9px]">unix: {value}</span>
      </div>
    );
  } else if (isDateCol && typeof value === 'string' && !isNaN(Date.parse(value))) {
    renderedValue = (
      <div>
        <span className="text-blue-700 dark:text-blue-300 block">{new Date(value).toLocaleString()}</span>
        <span className="text-ux-text-sub text-[9px]">{value}</span>
      </div>
    );
  } else if (typeof value === 'number') {
    renderedValue = <span className="font-mono text-violet-700 dark:text-violet-300">{value.toLocaleString()}</span>;
  } else {
    renderedValue = <span className="break-all whitespace-pre-wrap">{String(value)}</span>;
  }

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
          {col.pk && (
            <svg className="w-3 h-3 text-amber-500 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM8 8a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z"/>
            </svg>
          )}
          <span className="text-[11px] font-semibold text-ux-text font-mono truncate">{col.name}</span>
          <span className="flex-shrink-0 text-[9px] text-ux-text-sub bg-ux-hover/50 rounded px-1">{col.type || 'TEXT'}</span>
        </div>
        <button
          onClick={copyField}
          className="text-ux-text-sub"
          title="Copy value"
        >
          {fieldCopied ? '?' : 'copy'}
        </button>
      </div>
      <div className="rounded bg-ux-surface border border-ux-border px-2 py-1.5 text-xs min-h-[28px]">
        {renderedValue}
      </div>
    </div>
  );
}

// --- Row detail: panel ---------------------------------------------------------

function RowDetailPanel({
  row, rowIdx, columns, dbId, tableName, dbColor, onClose, onDeleted,
}: {
  row: Record<string, any>;
  rowIdx: number;
  columns: DbPortalColumn[];
  dbId: string;
  tableName: string;
  dbColor: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [rowCopied, setRowCopied] = useState(false);
  const queryClient = useQueryClient();
  const cs = scheme(dbColor);

  const pkCol = columns.find(c => c.pk);
  const pkValue = pkCol ? row[pkCol.name] : null;

  const deleteMutation = useMutation({
    mutationFn: () => databasesApi.deleteRow(dbId, tableName, String(pkValue)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-table', dbId, tableName] });
      onDeleted();
    },
  });

  const copyRow = () => {
    navigator.clipboard.writeText(JSON.stringify(row, null, 2)).catch(() => undefined);
    setRowCopied(true);
    setTimeout(() => setRowCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black bg-opacity-30" onClick={onClose} />
      <div className="w-full max-w-2xl bg-ux-surface shadow-2xl flex flex-col overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-ux-border bg-ux-surface-alt flex-shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-ux-text">Row {rowIdx + 1}</h2>
          {pkCol && (
            <p className="text-ux-text-sub">
              <span className={`${cs.badge} rounded px-1 mr-1`}>{pkCol.name}</span>
              {String(pkValue)}
            </p>
          )}
        </div>
        <button onClick={onClose} className="ml-4 text-ux-text-sub hover:text-ux-text flex-shrink-0" aria-label="Close panel">✕</button>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {columns.map(col => (
          <FieldView key={col.name} col={col} value={row[col.name]} />
        ))}
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 border-t border-ux-border p-3 bg-ux-surface space-y-2">
        <button
          onClick={copyRow}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded border border-ux-border bg-ux-surface text-ux-text hover:bg-gray-50 hover:bg-ux-hover transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {rowCopied ? 'Copied!' : 'Copy row as JSON'}
        </button>

        {pkCol && !deleteConfirm && (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete row
          </button>
        )}

        {pkCol && deleteConfirm && (
          <div className="space-y-1.5 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-2">
            <p className="text-[10px] text-red-600 dark:text-red-400 text-center font-medium">
              Delete where {pkCol.name} = {String(pkValue)}?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="flex-1 px-3 py-1.5 text-xs rounded border border-ux-border bg-ux-surface hover:bg-gray-100 hover:bg-ux-hover text-ux-text"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 font-medium"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
            {deleteMutation.isError && (
              <p className="text-[10px] text-red-600 dark:text-red-400">{(deleteMutation.error as Error).message}</p>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// --- Side panel: database list ------------------------------------------------

interface DbTreeProps {
  databases: DbPortalDatabase[];
  selectedDb: string | null;
  selectedTable: string | null;
  expandedDbs: Set<string>;
  onToggleDb: (id: string) => void;
  onSelectTable: (dbId: string, tableName: string) => void;
}

function DbTree({ databases, selectedDb, selectedTable, expandedDbs, onToggleDb, onSelectTable }: DbTreeProps) {
  const groups: Array<{ key: string; label: string; dbs: DbPortalDatabase[] }> = [
    { key: 'core',      label: 'Core Databases',      dbs: databases.filter(d => d.group === 'core') },
    { key: 'connector', label: 'Connector Databases',  dbs: databases.filter(d => d.group === 'connector') },
  ];

  return (
    <nav className="overflow-y-auto h-full py-2 space-y-4">
      {groups.map(group => (
        <div key={group.key}>
          <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-ux-text-sub">
            {group.label}
          </p>
          {group.dbs.map(db => {
            const cs = scheme(db.color);
            const expanded = expandedDbs.has(db.id);
            return (
              <div key={db.id}>
                {/* Database row */}
                <button
                  onClick={() => onToggleDb(db.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${cs.hover} ${!db.exists ? 'opacity-50' : ''}`}
                >
                  <span className={`flex-shrink-0 w-4 h-4 flex items-center justify-center text-ux-text-sub transition-transform ${expanded ? 'rotate-90' : ''}`}>
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                  <span className={`flex-shrink-0 w-2 h-2 rounded-full ${cs.dot} ${!db.exists ? 'opacity-40' : ''}`} />
                  <span className="flex-1 text-sm font-medium text-ux-text truncate">{db.label}</span>
                  <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded ${cs.badge}`}>
                    {db.exists ? db.size_formatted : 'absent'}
                  </span>
                </button>

                {/* Table list */}
                {expanded && db.exists && (
                  <ul className="ml-6 border-l border-ux-border pl-2 pb-1">
                    {db.tables.length === 0 && (
                      <li className="text-ux-text-sub">No tables</li>
                    )}
                    {db.tables.map(tbl => {
                      const isActive = selectedDb === db.id && selectedTable === tbl.name;
                      return (
                        <li key={tbl.name}>
                          <button
                            onClick={() => onSelectTable(db.id, tbl.name)}
                            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                              isActive
                                ? `${cs.active} font-semibold`
                                : `text-ux-text-sub hover:text-gray-900 dark:hover:text-gray-200 ${cs.hover}`
                            }`}
                          >
                            <span className="text-xs truncate">{tbl.name}</span>
                            <span className="text-ux-text-sub">{tbl.row_count.toLocaleString()}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// --- Table viewer -------------------------------------------------------------

interface TableViewerProps {
  dbId: string;
  dbLabel: string;
  tableName: string;
  dbColor: string;
}

function TableViewer({ dbId, dbLabel, tableName, dbColor }: TableViewerProps) {
  const [searchInput, setSearchInput] = useState('');
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(0);
  const [selectedRow, setSelectedRow] = useState<{ rowIdx: number; row: Record<string, any> } | null>(null);
  const [sortBy,  setSortBy]  = useState<string>('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const debouncedSearch = useDebounce(searchInput, 350);

  // Reset to page 0 and clear row selection when search or page size changes
  useEffect(() => { setPage(0); setSelectedRow(null); }, [debouncedSearch, pageSize]);

  const handleSort = (col: string) => {
    if (col === sortBy) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(0);
    setSelectedRow(null);
  };

  const { data, isLoading, isError, error } = useQuery<DbPortalTableData>({
    queryKey: ['db-table', dbId, tableName, debouncedSearch, pageSize, page, sortBy, sortDir],
    queryFn: () => databasesApi.queryTable(dbId, tableName, {
      q:        debouncedSearch || undefined,
      limit:    pageSize,
      offset:   page * pageSize,
      sort_by:  sortBy || undefined,
      sort_dir: sortBy ? sortDir : undefined,
    }),
    placeholderData: (prev) => prev,
  });

  const cs = scheme(dbColor);
  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-ux-border bg-ux-surface flex-shrink-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${cs.badge}`}>{dbLabel}</span>
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-ux-text-sub">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="font-semibold text-ux-text font-mono">{tableName}</span>
          {data && (
            <span className="text-ux-text-sub">
              {data.total.toLocaleString()} {data.total === 1 ? 'row' : 'rows'}
              {debouncedSearch && ` matching "${debouncedSearch}"`}
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2 top-1.5 h-4 w-4 text-ux-text-sub pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search all columns…"
            className="pl-7 pr-3 py-1.5 text-sm border border-ux-border rounded bg-ux-surface text-ux-text placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-ux-accent w-52"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="text-ux-text-sub"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 overflow-auto relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-ux-surface/60 z-10">
            <LoadingSpinner />
          </div>
        )}

        {isError && (
          <div className="p-6">
            <ErrorMessage message={(error as Error).message} />
          </div>
        )}

        {data && data.columns.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-ux-hover">
                {data.columns.map(col => (
                  <SortTh
                    key={col.name}
                    col={col.name}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="border-b border-ux-border"
                  >
                    {col.pk && (
                      <svg className="w-3 h-3 text-amber-500 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM8 8a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z"/>
                      </svg>
                    )}
                    {col.name}
                    {col.type && (
                      <span className="text-[9px] text-ux-text-sub font-normal font-sans ml-0.5">
                        {col.type.toUpperCase()}
                      </span>
                    )}
                  </SortTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={data.columns.length} className="px-3 py-8 text-center text-ux-text-sub italic">
                    No rows found{debouncedSearch ? ` for "${debouncedSearch}"` : ''}
                  </td>
                </tr>
              ) : (
                data.rows.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    onClick={() => setSelectedRow(prev => prev?.rowIdx === rowIdx ? null : { rowIdx, row })}
                    className={`border-b border-ux-border cursor-pointer transition-colors ${
                      selectedRow?.rowIdx === rowIdx
                        ? 'bg-ux-accent-subtle'
                        : 'hover:bg-ux-hover'
                    }`}
                  >
                    {data.columns.map(col => {
                      const value = row[col.name];
                      const isNull = value === null || value === undefined;
                      const display = formatCellValue(value);
                      // Truncate very long values
                      const truncated = display.length > 120;
                      return (
                        <td
                          key={col.name}
                          className={`px-3 py-1.5 align-top max-w-xs ${cellClass(col.type)}`}
                          title={truncated ? display : undefined}
                        >
                          {isNull ? (
                            <NullBadge />
                          ) : (
                            <span className={`break-all ${truncated ? 'line-clamp-2' : ''}`}>
                              {truncated ? display.slice(0, 120) + '…' : display}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
        </div>
      </div>

      {/* Pagination footer */}
      {data && data.total > 0 && (
        <Pagination
          page={page + 1}
          totalPages={totalPages}
          totalItems={data.total}
          pageSize={pageSize}
          onPageChange={(p) => setPage(p - 1)}
          onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
          pageSizeOptions={[25, 50, 100, 250]}
          accentClass="text-violet-600 dark:text-violet-400"
        />
      )}

      {selectedRow && data && (
        <RowDetailPanel
          row={selectedRow.row}
          rowIdx={selectedRow.rowIdx}
          columns={data.columns}
          dbId={dbId}
          tableName={tableName}
          dbColor={dbColor}
          onClose={() => setSelectedRow(null)}
          onDeleted={() => setSelectedRow(null)}
        />
      )}
    </div>
  );
}

// --- Main page ----------------------------------------------------------------

export default function DatabasesPortal() {
  const [selectedDb, setSelectedDb] = useState<string | null>('registry');
  const [selectedTable, setSelectedTable] = useState<string | null>('identities');
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());

  const { data: databases, isLoading, isError, error } = useQuery<DbPortalDatabase[]>({
    queryKey: ['databases'],
    queryFn: () => databasesApi.listDatabases(),
    staleTime: 30_000,
  });

  // Auto-expand core databases on first load
  useEffect(() => {
    if (databases && expandedDbs.size === 0) {
      const coreIds = databases.filter(d => d.group === 'core' && d.exists).map(d => d.id);
      const ids = new Set(coreIds);
      ids.add('registry');
      if (ids.size > 0) setExpandedDbs(ids);
    }
  }, [databases]);  // intentionally omit expandedDbs to run once

  const handleToggleDb = useCallback((id: string) => {
    setExpandedDbs(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectTable = useCallback((dbId: string, tableName: string) => {
    setSelectedDb(dbId);
    setSelectedTable(tableName);
  }, []);

  const selectedDbMeta = databases?.find(d => d.id === selectedDb);

  return (
    <UXScopeWrapper scopeId="portal-system">
    <div className="flex flex-col h-[calc(100vh-13rem)]">
      {/* Page header */}
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-ux-text">Databases</h1>
        <p className="text-sm text-ux-text-sub mt-0.5">
          Browse and search the contents of every SQLite database in the solution.
        </p>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      )}

      {isError && (
        <ErrorMessage message={(error as Error).message} />
      )}

      {databases && (
        <div className="flex flex-1 min-h-0 border border-ux-border rounded-lg overflow-hidden bg-ux-surface shadow-sm">
          {/* Left sidebar */}
          <div className="w-64 flex-shrink-0 border-r border-ux-border bg-ux-surface-alt overflow-y-auto">
            <div className="px-3 py-2.5 border-b border-ux-border bg-ux-surface">
              <p className="text-xs font-semibold text-ux-text-sub">
                {databases.length} databases · {databases.reduce((s, d) => s + d.tables.length, 0)} tables
              </p>
            </div>
            <DbTree
              databases={databases}
              selectedDb={selectedDb}
              selectedTable={selectedTable}
              expandedDbs={expandedDbs}
              onToggleDb={handleToggleDb}
              onSelectTable={handleSelectTable}
            />
          </div>

          {/* Right content area */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedDb && selectedTable && selectedDbMeta ? (
              <TableViewer
                key={`${selectedDb}::${selectedTable}`}
                dbId={selectedDb}
                dbLabel={selectedDbMeta.label}
                tableName={selectedTable}
                dbColor={selectedDbMeta.color}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-8 text-ux-text-sub">
                <svg className="w-12 h-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 7h16M4 12h16M4 17h16M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2M4 17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2" />
                </svg>
                <p className="text-sm font-medium">Select a table to view its contents</p>
                <p className="text-xs mt-1">Expand a database in the left panel, then click a table.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </UXScopeWrapper>
  );
}
