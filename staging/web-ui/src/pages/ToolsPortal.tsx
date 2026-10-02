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
import { useMutation } from '@tanstack/react-query';
import { toolsApi, ToolsGcuidSearchResult, ToolsDeleteResponse } from '../api/client';
import { GCUIDDetailPanel } from './GCUIDPortal';
import StateBadge from '../components/StateBadge';
import ErrorMessage from '../components/ErrorMessage';
import CopyButton from '../components/CopyButton';
import { useSortableTable } from '../hooks/useSortableTable';
import { usePagination } from '../hooks/usePagination';
import { SortTh } from '../components/SortTh';
import { Pagination } from '../components/Pagination';
import { UXScopeWrapper } from '../context/UXThemeContext';

// --- Constants ----------------------------------------------------------------

const ENTITY_TYPES = ['', 'person', 'org', 'asset', 'app', 'agent'];
const STATES = ['', 'provisional', 'active', 'under_review', 'suspended', 'retired', 'archived'];

// --- Small UI primitives ------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-ux-text-muted mb-1">
      {children}
    </h2>
  );
}

function ToolCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-ux-border rounded-xl bg-ux-surface/60 shadow-sm overflow-hidden">
      {children}
    </div>
  );
}

function ToolCardHeader({ title, subtitle, danger = false }: { title: string; subtitle?: string; danger?: boolean }) {
  return (
    <div className={`px-5 py-4 border-b ${danger ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-ux-border bg-ux-surface-alt'}`}>
      <div className="flex items-center gap-2">
        {danger && (
          <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        )}
        <span className={`font-semibold text-sm ${danger ? 'text-red-700 dark:text-red-300' : 'text-ux-text'}`}>{title}</span>
      </div>
      {subtitle && <p className="mt-0.5 text-xs text-ux-text-muted pl-6">{subtitle}</p>}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded border border-ux-border bg-ux-hover text-ux-text-sub">
      {children}
    </kbd>
  );
}

// --- Deletion summary table ---------------------------------------------------

function DeletionSummary({ data }: { data: ToolsDeleteResponse }) {
  const entries = Object.entries(data.summary);
  const found    = entries.filter(([, v]) => !v.not_found);
  const missing  = entries.filter(([, v]) => v.not_found);

  return (
    <div className="space-y-3">
      {data.dry_run && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-xs font-medium">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Dry-run preview — no data has been deleted
        </div>
      )}
      {!data.dry_run && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 text-xs font-medium">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {found.length} GCUID{found.length !== 1 ? 's' : ''} deleted from all databases
        </div>
      )}

      {missing.length > 0 && (
        <div className="px-3 py-2 rounded-lg bg-ux-surface-alt border border-ux-border text-xs text-ux-text-muted">
          {missing.length} GCUID{missing.length !== 1 ? 's' : ''} not found in registry (skipped)
        </div>
      )}

      {found.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-ux-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-ux-border bg-ux-surface-alt">
                <th className="text-left px-3 py-2 font-medium text-ux-text-sub">GCUID</th>
                <th className="text-left px-3 py-2 font-medium text-ux-text-sub">Registry rows</th>
                <th className="text-left px-3 py-2 font-medium text-ux-text-sub">Connector records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ux-border">
              {found.map(([gcuid, v]) => {
                const regTotal = Object.values(v.registry).reduce((a, b) => a + b, 0);
                const conTotal = Object.values(v.connectors).reduce((a, b) => a + b, 0);
                return (
                  <tr key={gcuid} className="bg-ux-surface">
                    <td className="px-3 py-2 font-mono text-violet-700 dark:text-violet-300 whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        {gcuid}
                        <CopyButton value={gcuid} />
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {regTotal === 0 ? <span className="text-ux-muted">—</span> : (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(v.registry).map(([tbl, n]) => (
                            <span key={tbl} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700">
                              {tbl} <span className="font-semibold">×{n}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {conTotal === 0 ? <span className="text-ux-muted">—</span> : (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(v.connectors).map(([conn, n]) => (
                            <span key={conn} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                              {conn} <span className="font-semibold">×{n}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- GCUID Purge Tool ---------------------------------------------------------

function GcuidPurgeTool() {
  // Search criteria
  const [query,      setQuery]      = useState('');
  const [entityType, setEntityType] = useState('');
  const [state,      setState]      = useState('');

  // Search results + selection
  const [results,     setResults]     = useState<ToolsGcuidSearchResult[] | null>(null);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [detailGcuid, setDetailGcuid] = useState<string | null>(null);

  // Workflow state
  const [phase,        setPhase]        = useState<'idle' | 'searched' | 'preview' | 'confirm' | 'done'>('idle');
  const [previewData,  setPreviewData]  = useState<ToolsDeleteResponse | null>(null);
  const [deleteResult, setDeleteResult] = useState<ToolsDeleteResponse | null>(null);
  const [reason,       setReason]       = useState('');

  // -- Search mutation --
  const searchMutation = useMutation({
    mutationFn: () => toolsApi.searchGcuids({
      q:           query.trim()      || undefined,
      entity_type: entityType        || undefined,
      state:       state             || undefined,
      limit: 500,
    }),
    onSuccess: (data) => {
      setResults(data.results);
      setSelected(new Set());
      setPhase('searched');
      setPreviewData(null);
      setDeleteResult(null);
    },
  });

  // -- Preview (dry-run) mutation --
  const previewMutation = useMutation({
    mutationFn: (gcuids: string[]) => toolsApi.deleteGcuids(gcuids, { dry_run: true }),
    onSuccess: (data) => {
      setPreviewData(data);
      setPhase('confirm');
    },
  });

  // -- Execute deletion mutation --
  const deleteMutation = useMutation({
    mutationFn: (gcuids: string[]) =>
      toolsApi.deleteGcuids(gcuids, { dry_run: false, reason: reason.trim() || 'Administrative purge via Tools portal' }),
    onSuccess: (data) => {
      setDeleteResult(data);
      setPhase('done');
      // Remove deleted GCUIDs from results list
      const deletedSet = new Set(
        Object.entries(data.summary).filter(([, v]) => !v.not_found).map(([g]) => g)
      );
      setResults(prev => prev ? prev.filter(r => !deletedSet.has(r.gcuid)) : null);
      setSelected(new Set());
    },
  });

  // -- Sort + paginate --
  const { sorted, sortBy, sortDir, handleSort } = useSortableTable(results, 'created_at', 'desc');
  const { paginated, page, setPage, pageSize, setPageSize, totalPages, totalItems } = usePagination(sorted, 25);

  // -- Selection helpers --
  const allSelected = results !== null && results.length > 0 && results.every(r => selected.has(r.gcuid));
  const someSelected = selected.size > 0;

  const toggleAll = useCallback(() => {
    if (!results) return;
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map(r => r.gcuid)));
    }
  }, [results, allSelected]);

  const toggleOne = useCallback((gcuid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(gcuid)) next.delete(gcuid); else next.add(gcuid);
      return next;
    });
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchMutation.mutate();
  };

  const handlePreview = () => {
    const gcuids = Array.from(selected);
    previewMutation.mutate(gcuids);
    setPhase('preview');
  };

  const handleConfirmDelete = () => {
    const gcuids = Array.from(selected);
    deleteMutation.mutate(gcuids);
  };

  const handleReset = () => {
    setPhase(results ? 'searched' : 'idle');
    setPreviewData(null);
    setDeleteResult(null);
  };

  return (
  <>
    <ToolCard>
      <ToolCardHeader
        danger
        title="Remove GCUID from Databases"
        subtitle="Search for matching identities, select one or more, preview what will be removed, then confirm. Audit log entries are preserved."
      />

      <div className="p-5 space-y-5">

        {/* -- Search form -- */}
        <form onSubmit={handleSearch} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-ux-text-sub mb-1">
                Free-text search
                <span className="ml-1 text-ux-muted font-normal">(GCUID, entity ID, or alias)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="e.g. urn:gcuid:01K… or EMP-023 or jane.doe@…"
                  className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-ux-border bg-ux-surface text-ux-text focus:outline-none focus:ring-2 focus:ring-ux-accent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text-sub mb-1">Entity type</label>
              <select
                value={entityType}
                onChange={e => setEntityType(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-ux-border bg-ux-surface text-ux-text focus:outline-none focus:ring-2 focus:ring-ux-accent"
              >
                {ENTITY_TYPES.map(t => (
                  <option key={t} value={t}>{t || '— any —'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text-sub mb-1">State</label>
              <select
                value={state}
                onChange={e => setState(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-ux-border bg-ux-surface text-ux-text focus:outline-none focus:ring-2 focus:ring-ux-accent"
              >
                {STATES.map(s => (
                  <option key={s} value={s}>{s || '— any —'}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={searchMutation.isPending}
                className="w-full px-4 py-1.5 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {searchMutation.isPending ? 'Searching…' : 'Search'}
              </button>
            </div>
          </div>
        </form>

        {searchMutation.isError && <ErrorMessage message={(searchMutation.error as Error).message} />}

        {/* -- Results table -- */}
        {results !== null && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ux-text-muted">
                {totalItems} result{totalItems !== 1 ? 's' : ''}
                {selected.size > 0 && (
                  <span className="ml-2 font-medium text-violet-600 dark:text-violet-400">
                    · {selected.size} selected
                  </span>
                )}
              </span>
              {someSelected && phase !== 'confirm' && phase !== 'done' && (
                <button
                  onClick={handlePreview}
                  disabled={previewMutation.isPending}
                  className="px-3 py-1 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors"
                >
                  {previewMutation.isPending ? 'Checking…' : `Preview deletion of ${selected.size} GCUID${selected.size !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>

            {results.length === 0 ? (
              <p className="text-sm text-ux-text-muted text-center py-6">No matching identities found.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-ux-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-ux-border bg-ux-surface-alt">
                      <th className="w-8 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                          onChange={toggleAll}
                          className="rounded border-ux-border text-violet-600 cursor-pointer"
                        />
                      </th>
                      <SortTh col="gcuid" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-violet-600 dark:text-violet-400">GCUID</SortTh>
                      <SortTh col="entity_id" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-violet-600 dark:text-violet-400">Entity ID</SortTh>
                      <SortTh col="entity_type" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-violet-600 dark:text-violet-400">Type</SortTh>
                      <SortTh col="state" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-violet-600 dark:text-violet-400">State</SortTh>
                      <SortTh col="alias_value" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-violet-600 dark:text-violet-400">Alias</SortTh>
                      <SortTh col="created_at" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-violet-600 dark:text-violet-400">Created</SortTh>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ux-border">
                    {paginated.map(row => (
                      <tr
                        key={row.gcuid}
                        onClick={() => setDetailGcuid(row.gcuid)}
                        className={`cursor-pointer transition-colors ${
                          selected.has(row.gcuid)
                            ? 'bg-red-50 dark:bg-red-900/20'
                            : detailGcuid === row.gcuid
                              ? 'bg-ux-accent-subtle'
                              : 'bg-ux-surface hover:bg-ux-hover/30'
                        }`}
                      >
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(row.gcuid)}
                            onChange={() => toggleOne(row.gcuid)}
                            className="rounded border-ux-border text-violet-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-violet-700 dark:text-violet-300 whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            <span className="truncate max-w-[18rem]" title={row.gcuid}>{row.gcuid}</span>
                            <span onClick={e => e.stopPropagation()}>
                              <CopyButton value={row.gcuid} />
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ux-text-sub max-w-[16rem] truncate" title={row.entity_id}>
                          {row.entity_id}
                        </td>
                        <td className="px-3 py-2 text-ux-text-muted">{row.entity_type}</td>
                        <td className="px-3 py-2">
                          <StateBadge state={row.state} />
                        </td>
                        <td className="px-3 py-2 text-ux-text-muted max-w-[14rem] truncate" title={row.alias_value ?? ''}>
                          {row.alias_value ? (
                            <span className="font-mono text-[11px]">{row.alias_value}</span>
                          ) : (
                            <span className="italic text-ux-text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ux-muted whitespace-nowrap">
                          {row.created_at.slice(0, 10)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalItems > 0 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                accentClass="text-violet-600 dark:text-violet-400"
                pageSizeOptions={[25, 50, 100]}
              />
            )}
          </div>
        )}

        {previewMutation.isError && <ErrorMessage message={(previewMutation.error as Error).message} />}

        {/* -- Confirmation + dry-run preview -- */}
        {phase === 'confirm' && previewData && (
          <div className="space-y-4 border border-red-200 dark:border-red-700 rounded-xl p-4 bg-red-50 dark:bg-red-900/10">
            <div className="flex items-start gap-3">
              <svg className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-300">Confirm permanent deletion</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  The following rows will be removed from the registry and connector databases. Audit log entries are kept.
                  <span className="block mt-1">Press <Kbd>Esc</Kbd> or "Cancel" to abort.</span>
                </p>
              </div>
            </div>

            <DeletionSummary data={previewData} />

            <div>
                <label className="block text-xs font-medium text-ux-text-sub mb-1">
                Reason <span className="font-normal text-ux-muted">(optional — recorded with the operation)</span>
              </label>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. Test record — self-service registration during PoC"
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-ux-border bg-ux-surface text-ux-text focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? 'Deleting…' : `Delete ${selected.size} GCUID${selected.size !== 1 ? 's' : ''}`}
              </button>
              <button
                onClick={handleReset}
                disabled={deleteMutation.isPending}
                className="px-4 py-1.5 text-sm font-medium rounded-lg border border-ux-border text-ux-text-sub hover:bg-ux-hover/40 transition-colors"
              >
                Cancel
              </button>
            </div>

            {deleteMutation.isError && <ErrorMessage message={(deleteMutation.error as Error).message} />}
          </div>
        )}

        {/* -- Done / result -- */}
        {phase === 'done' && deleteResult && (
          <div className="space-y-3">
            <DeletionSummary data={deleteResult} />
            <button
              onClick={() => { setPhase('searched'); setDeleteResult(null); }}
              className="px-3 py-1 text-xs font-medium rounded-lg border border-ux-border text-ux-text-sub hover:bg-ux-hover/40 transition-colors"
            >
              ? Back to results
            </button>
          </div>
        )}

      </div>
    </ToolCard>

    {detailGcuid && (
      <GCUIDDetailPanel
        gcuid={detailGcuid}
        onClose={() => setDetailGcuid(null)}
      />
    )}
  </>
  );
}

// --- Page root ----------------------------------------------------------------

export default function ToolsPortal() {
  return (
    <UXScopeWrapper scopeId="portal-system">
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-ux-text">System Tools</h1>
        <p className="mt-1 text-sm text-ux-text-muted">
          Administrative tooling for the GCUID registry. All destructive operations require explicit confirmation.
        </p>
      </div>

      {/* Tools section */}
      <div className="space-y-3">
        <SectionTitle>Data Management</SectionTitle>
        <GcuidPurgeTool />
      </div>

    </div>
    </UXScopeWrapper>
  );
}
