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
import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { logsApi, logLevelsApi, systemApi, LogRow, LogRowDetail, LogsQueryParams, LOG_LEVEL_OPTIONS } from '../api/client';
import { useDateTime } from '../context/DateTimeFormatContext';
import { UXScopeWrapper } from '../context/UXThemeContext';
import { Pagination } from '../components/Pagination';

// --- Constants ----------------------------------------------------------------

const SYSTEMS = [
  { id: 'all',            label: 'All Systems',     color: 'gray' },
  { id: 'gcuid-registry', label: 'GCUID Registry',  color: 'amber' },
  { id: 'caes',           label: 'CAES',            color: 'violet' },
  { id: 'hr',            label: 'HR System',       color: 'blue' },
  { id: 'ldap',           label: 'LDAP / AD',       color: 'indigo' },
  { id: 'engineering',    label: 'Engineering',     color: 'purple' },
  { id: 'finance',        label: 'Finance',         color: 'green' },
  { id: 'system',         label: 'System',          color: 'slate' },
] as const;

type SystemId = (typeof SYSTEMS)[number]['id'];

const LEVELS = [
  { value: '',          label: 'All levels' },
  { value: 'debug',     label: 'Debug +',     code: 7 },
  { value: 'info',      label: 'Info +',      code: 6 },
  { value: 'notice',    label: 'Notice +',    code: 5 },
  { value: 'warning',   label: 'Warning +',   code: 4 },
  { value: 'error',     label: 'Error +',     code: 3 },
  { value: 'critical',  label: 'Critical +',  code: 2 },
  { value: 'alarm',     label: 'Alarm +',     code: 1 },
  { value: 'emergency', label: 'Emergency',   code: 0 },
] as const;

const PAGE_SIZES = [25, 50, 100, 250] as const;

const SYSTEM_TAB_STYLES: Record<string, { active: string; inactive: string; badge: string }> = {
  gray:   { active: 'border-gray-600 text-ux-text',   inactive: 'text-ux-text-sub hover:text-gray-700 dark:hover:text-gray-200',   badge: 'bg-ux-hover text-ux-text' },
  amber:  { active: 'border-amber-600 text-amber-800 dark:text-amber-200', inactive: 'text-ux-text-sub hover:text-amber-700 dark:text-amber-300',  badge: 'bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200' },
  violet: { active: 'border-violet-600 text-violet-800 dark:text-violet-200', inactive: 'text-ux-text-sub hover:text-violet-700', badge: 'bg-violet-100 dark:bg-violet-800/60 text-violet-800 dark:text-violet-200' },
  blue:   { active: 'border-blue-600 text-blue-800 dark:text-blue-200',   inactive: 'text-ux-text-sub hover:text-blue-700 dark:text-blue-300',   badge: 'bg-blue-100 dark:bg-blue-800/60 text-blue-800 dark:text-blue-200' },
  indigo: { active: 'border-indigo-600 text-indigo-800 dark:text-indigo-200', inactive: 'text-ux-text-sub hover:text-indigo-700 dark:text-indigo-300', badge: 'bg-indigo-100 dark:bg-indigo-800/60 text-indigo-800 dark:text-indigo-200' },
  purple: { active: 'border-purple-600 text-purple-800 dark:text-purple-200', inactive: 'text-ux-text-sub hover:text-purple-700 dark:text-purple-300', badge: 'bg-purple-100 dark:bg-purple-800/60 text-purple-800 dark:text-purple-200' },
  green:  { active: 'border-green-600 text-green-800 dark:text-green-200', inactive: 'text-ux-text-sub hover:text-green-700 dark:text-green-300',  badge: 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200' },
  slate:  { active: 'border-slate-600 text-slate-800 dark:text-slate-100', inactive: 'text-ux-text-sub hover:text-slate-700 dark:text-slate-200',  badge: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200' },
};

const LEVEL_STYLES: Record<string, string> = {
  debug:     'bg-ux-hover text-ux-text-sub',
  info:      'bg-blue-100 dark:bg-blue-800/60 text-blue-700 dark:text-blue-300',
  notice:    'bg-teal-100 dark:bg-teal-800/60 text-teal-700 dark:text-teal-300',
  warning:   'bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200',
  error:     'bg-red-100 dark:bg-red-800/60 text-red-700 dark:text-red-300',
  critical:  'bg-red-200 text-red-800 dark:text-red-200 font-semibold',
  alarm:     'bg-rose-200 text-rose-900 font-semibold',
  emergency: 'bg-red-600 text-white font-bold',
};

const OUTCOME_STYLES: Record<string, string> = {
  success: 'text-green-700 dark:text-green-300',
  failure: 'text-red-600',
  partial: 'text-amber-600 dark:text-amber-400',
  pending: 'text-blue-600',
  skipped: 'text-ux-text-sub',
};

// --- Helpers ------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// --- Level badge --------------------------------------------------------------

function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono uppercase tracking-wide ${LEVEL_STYLES[level] ?? 'bg-ux-hover text-ux-text-sub'}`}>
      {level}
    </span>
  );
}

// --- System badge -------------------------------------------------------------

function SystemBadge({ system }: { system: string }) {
  const meta = SYSTEMS.find(s => s.id === system);
  const style = meta ? SYSTEM_TAB_STYLES[meta.color].badge : 'bg-ux-hover text-ux-text-sub';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${style}`}>
      {meta?.label ?? system}
    </span>
  );
}

// --- Detail panel (right-side overlay) ----------------------------------------

function LogDetail({ logId }: { logId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['log-detail', logId],
    queryFn: () => logsApi.get(logId),
  });

  if (isLoading) return <div className="px-6 py-8 text-sm text-ux-text-sub">Loading detail...</div>;
  if (error || !data) return <div className="px-6 py-4 text-xs text-red-500">Could not load detail.</div>;

  const BASE_FIELDS: Array<[string, keyof LogRowDetail]> = [
    ['Log ID',         'log_id'],
    ['Timestamp',      'timestamp'],
    ['Level',          'level'],
    ['System',         'system'],
    ['Component',      'component'],
    ['Component type', 'component_type'],
    ['Event type',     'event_type'],
    ['Event code',     'event_code'],
    ['Message',        'message'],
    ['Session ID',     'session_id'],
    ['Transaction ID', 'transaction_id'],
    ['Correlation ID', 'correlation_id'],
    ['Request ID',     'request_id'],
    ['Actor',          'actor_id'],
    ['Actor type',     'actor_type'],
    ['Target',         'target_id'],
    ['Target type',    'target_type'],
    ['Outcome',        'outcome'],
    ['Duration (ms)',  'duration_ms'],
    ['IP address',     'ip_address'],
    ['User agent',     'user_agent'],
    ['Error code',     'error_code'],
    ['Error detail',   'error_detail'],
    ['Context',        'context'],
  ];

  const baseKeys = new Set(BASE_FIELDS.map(([, k]) => k as string).concat(['id', 'created_at']));
  const extraEntries = Object.entries(data).filter(([k]) => !baseKeys.has(k) && data[k] !== null && data[k] !== undefined);

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Base fields */}
      <div>
        <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">Base fields</h3>
        <div className="bg-ux-surface-alt border border-ux-border rounded-lg divide-y divide-ux-border text-sm">
          {BASE_FIELDS.filter(([, key]) => data[key] !== null && data[key] !== undefined && data[key] !== '').map(([label, key]) => {
            const str = typeof data[key] === 'object' ? JSON.stringify(data[key], null, 2) : String(data[key]);
            return (
              <div key={key} className="grid grid-cols-3 gap-2 px-4 py-2.5">
                <span className="text-ux-text-sub font-medium text-xs">{label}</span>
                <span className="col-span-2 text-ux-text text-xs font-mono break-all">{str}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* System-specific fields */}
      {extraEntries.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">System-specific fields</h3>
          <div className="bg-ux-surface-alt border border-ux-border rounded-lg divide-y divide-ux-border text-sm">
            {extraEntries.map(([key, value]) => {
              const str = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
              return (
                <div key={key} className="grid grid-cols-3 gap-2 px-4 py-2.5">
                  <span className="text-ux-text-sub font-medium text-xs">{key.replace(/_/g, ' ')}</span>
                  <span className="col-span-2 text-ux-text text-xs font-mono break-all">{str}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Log detail panel (right-side overlay) ------------------------------------

function LogDetailPanel({ logId, onClose }: { logId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black bg-opacity-30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-2xl bg-ux-surface shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-ux-border bg-ux-surface-alt flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ux-text">Log Entry Detail</h2>
            <p className="text-xs text-ux-text-sub font-mono mt-0.5 break-all">{logId}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-ux-text-sub hover:text-ux-text flex-shrink-0"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <LogDetail logId={logId} />
        </div>
      </div>
    </div>
  );
}

// --- Log table row ------------------------------------------------------------

function LogTableRow({
  row,
  isSelected,
  onClick,
}: {
  row: LogRow;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { fmt } = useDateTime();
  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors ${isSelected ? 'bg-ux-accent-subtle' : 'hover:bg-ux-hover even:bg-ux-surface-alt/50'}`}
    >
      <td className="px-3 py-2 whitespace-nowrap text-xs text-ux-text-sub font-mono">
        {fmt(row.timestamp)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <LevelBadge level={row.level} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <SystemBadge system={row.system} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs text-ux-text-sub font-mono">
        {row.component}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs text-ux-text-sub font-mono">
        {row.event_type}
      </td>
      <td className="px-3 py-2 text-xs text-ux-text max-w-xs truncate" title={row.message}>
        {row.message}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs">
        {row.outcome && (
          <span className={`font-medium ${OUTCOME_STYLES[row.outcome] ?? 'text-ux-text-sub'}`}>
            {row.outcome}
          </span>
        )}
      </td>
      <td className="text-ux-text-sub">
        {row.duration_ms != null ? `${row.duration_ms}ms` : ''}
      </td>
    </tr>
  );
}

// --- Stats bar ----------------------------------------------------------------

function StatsBar() {
  const { data } = useQuery({
    queryKey: ['log-stats'],
    queryFn: () => logsApi.stats(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (!data) return null;

  return (
    <div className="flex flex-wrap gap-3 text-xs">
      <span className="text-ux-text-sub">
        <span className="font-semibold text-ux-text">{data.total.toLocaleString()}</span> total entries
      </span>
      <span className="text-ux-muted">|</span>
      {data.bySystem.map(s => {
        const meta = SYSTEMS.find(x => x.id === s.system);
        const style = meta ? SYSTEM_TAB_STYLES[meta.color].badge : 'bg-ux-hover text-ux-text-sub';
        return (
          <span key={s.system} className={`px-1.5 py-0.5 rounded font-medium ${style}`}>
            {meta?.label ?? s.system}: {s.count.toLocaleString()}
          </span>
        );
      })}
    </div>
  );
}

// --- Main portal --------------------------------------------------------------

export default function LogsPortal() {
  const queryClient = useQueryClient();

  // -- Configured log levels (from Options) ---------------------------------
  const { data: configuredLevels } = useQuery({
    queryKey: ['log-levels'],
    queryFn:  logLevelsApi.get,
    staleTime: 30_000,
  });

  // -- Filter state ------------------------------------------------------------
  const [activeSystem,  setActiveSystem]  = useState<SystemId>('all');
  // Default level filter is derived from configured levels.  When the user has
  // set all systems to 'info' (or higher severity), we should not show debug
  // entries by default.  The user can always select 'Debug +' to see them.
  const [levelFilterOverride, setLevelFilterOverride] = useState<string | null>(null);
  const [componentRaw,  setComponentRaw]  = useState('');
  const [searchRaw,     setSearchRaw]     = useState('');
  const [fromDate,      setFromDate]      = useState('');
  const [toDate,        setToDate]        = useState('');
  const [pageSize,      setPageSize]      = useState<number>(50);
  const [offset,        setOffset]        = useState(0);
  const [autoRefresh,   setAutoRefresh]   = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [sortBy,        setSortBy]        = useState<string>('timestamp');
  const [sortDir,       setSortDir]       = useState<'asc' | 'desc'>('desc');
  const [clearConfirm,  setClearConfirm]  = useState(false);
  const [clearResult,   setClearResult]   = useState<{ deleted: number; system: string } | null>(null);

  // Compute the effective level filter:
  // - If the user has explicitly chosen a filter (levelFilterOverride), use that.
  // - Otherwise derive from the configured levels: use the most permissive level
  //   across all configured systems (so if some are 'info' and one is 'warning',
  //   default to 'info' — i.e. show the widest range without showing debug).
  const LOG_LEVEL_ORDER = [...LOG_LEVEL_OPTIONS].reverse().map(l => l.value);
  const derivedDefaultLevel = (() => {
    if (!configuredLevels) return 'info';
    const levels = Object.values(configuredLevels) as string[];
    // Find the most permissive (highest code = least severe) among configured levels
    let mostPermissive = 'emergency';
    for (const lvl of levels) {
      const idx = LOG_LEVEL_ORDER.indexOf(lvl as any);
      const curIdx = LOG_LEVEL_ORDER.indexOf(mostPermissive as any);
      if (idx > curIdx) mostPermissive = lvl;
    }
    return mostPermissive;
  })();

  const levelFilter = levelFilterOverride !== null ? levelFilterOverride : derivedDefaultLevel;

  const component = useDebounce(componentRaw, 400);
  const search    = useDebounce(searchRaw, 400);

  // Reset pagination when filters or sort change
  const resetPage = useCallback(() => setOffset(0), []);
  useEffect(resetPage, [activeSystem, levelFilter, component, search, fromDate, toDate, pageSize, sortBy, sortDir, resetPage]);

  // -- Query params ------------------------------------------------------------
  const params: LogsQueryParams = {
    ...(activeSystem !== 'all' ? { system: activeSystem } : {}),
    ...(levelFilter ? { level: levelFilter } : {}),
    ...(component   ? { component } : {}),
    ...(search      ? { search } : {}),
    ...(fromDate    ? { from: fromDate } : {}),
    ...(toDate      ? { to: toDate } : {}),
    limit:    pageSize,
    offset,
    sort_by:  sortBy,
    sort_dir: sortDir,
  };

  // -- Column sort handler -----------------------------------------------------
  // Default direction per column: timestamp + duration_ms sort desc; others asc
  const DEFAULT_DESC = new Set(['timestamp', 'duration_ms']);
  const handleSort = (col: string) => {
    if (col === sortBy) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir(DEFAULT_DESC.has(col) ? 'desc' : 'asc');
    }
  };

  const queryKey = ['logs', params];

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => logsApi.query(params),
    placeholderData: (prev) => prev,
    refetchInterval: autoRefresh ? 10_000 : false,
  });

  const rows  = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.ceil(total / pageSize);
  const currentPage = Math.floor(offset / pageSize) + 1;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['logs'] });
    queryClient.invalidateQueries({ queryKey: ['log-stats'] });
  };

  // -- Clear logs mutation ------------------------------------------------------
  const clearMutation = useMutation({
    mutationFn: (system: string) => systemApi.clearLogs(system),
    onSuccess: (data) => {
      setClearResult({ deleted: data.deleted, system: data.cleared });
      setClearConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['logs'] });
      queryClient.invalidateQueries({ queryKey: ['log-stats'] });
    },
  });

  // -- Export helpers ----------------------------------------------------------
  const [csvExporting, setCsvExporting] = useState(false);
  const [jsonExporting, setJsonExporting] = useState(false);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsv = async () => {
    setCsvExporting(true);
    try {
      const allData = await logsApi.query({ ...params, limit: 10_000, offset: 0 });
      const allRows = allData.rows;
      if (!allRows.length) return;
      const headers = ['log_id', 'timestamp', 'level', 'system', 'component', 'event_type', 'message', 'outcome', 'duration_ms', 'actor_id', 'gcuid'];
      const escape = (v: unknown) => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [
        headers.join(','),
        ...allRows.map((r: any) => headers.map(h => escape(r[h])).join(',')),
      ];
      const systemLabel = activeSystem === 'all' ? 'all-systems' : activeSystem;
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      triggerDownload(blob, `logs-${systemLabel}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
    } finally {
      setCsvExporting(false);
    }
  };

  const downloadJson = async () => {
    setJsonExporting(true);
    try {
      const allData = await logsApi.query({ ...params, limit: 10_000, offset: 0 });
      const allRows = allData.rows;
      if (!allRows.length) return;
      const systemLabel = activeSystem === 'all' ? 'all-systems' : activeSystem;
      const payload = {
        exported_at: new Date().toISOString(),
        system: activeSystem,
        total: allRows.length,
        rows: allRows,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
      triggerDownload(blob, `logs-${systemLabel}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`);
    } finally {
      setJsonExporting(false);
    }
  };

  const selectRow = (id: string) => setSelectedLogId(prev => prev === id ? null : id);

  // Auto-scroll-to-top ref when page changes
  const tableRef = useRef<HTMLDivElement>(null);

  return (
    <UXScopeWrapper scopeId="portal-system">
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ux-text">System Logs</h1>
          <p className="mt-1 text-sm text-ux-text-sub">
            View, search, and filter event logs across all system components.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Auto-refresh toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-ux-hover peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ux-accent rounded-full peer peer-checked:bg-ux-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4 relative" />
            <span className="text-xs text-ux-text-sub">Auto-refresh</span>
          </label>
          <button
            onClick={refresh}
            className="btn btn-secondary text-xs flex items-center gap-1"
            title="Refresh logs"
          >
            <svg className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <StatsBar />

      {/* System tabs */}
      <div className="border-b border-ux-border -mb-px overflow-x-auto">
        <nav className="flex gap-1 min-w-max">
          {SYSTEMS.map(sys => {
            const styles = SYSTEM_TAB_STYLES[sys.color];
            const isActive = activeSystem === sys.id;
            return (
              <button
                key={sys.id}
                onClick={() => setActiveSystem(sys.id)}
                className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? `${styles.active} border-current`
                    : `border-transparent ${styles.inactive}`
                }`}
              >
                {sys.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-end">
        {/* Level */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ux-text-sub">Min level</label>
          <select
            aria-label="Minimum log level"
            value={levelFilter}
            onChange={e => setLevelFilterOverride(e.target.value === derivedDefaultLevel ? null : e.target.value)}
            className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent min-w-[120px]"
          >
            {LEVELS.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        {/* Component */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ux-text-sub">Component</label>
          <input
            type="text"
            placeholder="e.g. api:hr"
            value={componentRaw}
            onChange={e => setComponentRaw(e.target.value)}
            className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface text-ux-text focus:outline-none focus:ring-2 focus:ring-ux-accent w-36 font-mono"
          />
        </div>

        {/* From date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ux-text-sub">From</label>
          <input
            type="datetime-local"
            aria-label="From date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
            className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface text-ux-text focus:outline-none focus:ring-2 focus:ring-ux-accent"
          />
        </div>

        {/* To date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ux-text-sub">To</label>
          <input
            type="datetime-local"
            aria-label="To date"
            value={toDate}
            onChange={e => setToDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
            className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface text-ux-text focus:outline-none focus:ring-2 focus:ring-ux-accent"
          />
        </div>

        {/* Search */}
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-ux-text-sub">Search</label>
          <div className="relative">
            <svg className="absolute left-2 top-2 h-4 w-4 text-ux-text-sub pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search message, event, component..."
              value={searchRaw}
              onChange={e => setSearchRaw(e.target.value)}
              className="w-full border border-ux-border rounded-md pl-8 pr-3 py-1.5 text-sm bg-ux-surface text-ux-text focus:outline-none focus:ring-2 focus:ring-ux-accent"
            />
          </div>
        </div>

        {/* Clear filters */}
        {(levelFilterOverride !== null || componentRaw || searchRaw || fromDate || toDate) && (
          <button
            onClick={() => {
              setLevelFilterOverride(null);
              setComponentRaw('');
              setSearchRaw('');
              setFromDate('');
              setToDate('');
            }}
            className="text-xs text-violet-600 hover:text-violet-800 dark:text-violet-200 font-medium mt-4"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div ref={tableRef} className="border border-ux-border rounded-lg overflow-hidden">
        {/* Table toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-ux-surface-alt border-b border-ux-border">
          <span className="text-xs text-ux-text-sub">
            {isLoading ? 'Loading...' : (
              <>
                <span className="font-semibold text-ux-text">{total.toLocaleString()}</span> result{total !== 1 ? 's' : ''}
              </>
            )}
          </span>
          <div className="flex items-center gap-3">
            {(['csv', 'json'] as const).map(fmt => {
              const exporting = fmt === 'csv' ? csvExporting : jsonExporting;
              const handler = fmt === 'csv' ? downloadCsv : downloadJson;
              return (
                <button
                  key={fmt}
                  type="button"
                  onClick={handler}
                  disabled={exporting || total === 0}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-ux-border text-ux-text-sub hover:bg-ux-hover disabled:opacity-40 disabled:cursor-not-allowed"
                  title={`Download current filter results as ${fmt.toUpperCase()} (up to 10,000 rows)`}
                >
                  {exporting ? (
                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                    </svg>
                  )}
                  {fmt.toUpperCase()}
                </button>
              );
            })}
            {/* Clear logs */}
            {!clearConfirm ? (
              <button
                type="button"
                onClick={() => { setClearResult(null); setClearConfirm(true); }}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                title={`Clear all log entries for: ${activeSystem === 'all' ? 'all systems' : activeSystem}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                </svg>
                Clear
              </button>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                  Delete {activeSystem === 'all' ? 'all logs' : `${activeSystem} logs`}?
                </span>
                <button
                  type="button"
                  onClick={() => clearMutation.mutate(activeSystem)}
                  disabled={clearMutation.isPending}
                  className="text-xs px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {clearMutation.isPending ? 'Clearing...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setClearConfirm(false)}
                  className="text-xs px-2 py-0.5 rounded border border-ux-border text-ux-text-sub hover:bg-ux-hover"
                >
                  Cancel
                </button>
              </span>
            )}
            {isFetching && !isLoading && (
              <svg className="animate-spin h-3.5 w-3.5 text-violet-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>
        </div>

        {/* Clear result banner */}
        {clearResult && (
          <div className="flex items-center justify-between px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-700 text-xs text-green-700 dark:text-green-300">
            <span>
              Cleared <strong>{clearResult.deleted.toLocaleString()}</strong> log entr{clearResult.deleted === 1 ? 'y' : 'ies'} from <strong>{clearResult.system === 'all' ? 'all systems' : clearResult.system}</strong>.
            </span>
            <button type="button" onClick={() => setClearResult(null)} className="text-green-500 hover:text-green-700 dark:hover:text-green-200 leading-none">?</button>
          </div>
        )}

        {/* Table content */}
        {isLoading ? (
          <div className="text-ux-text-sub">
            Loading logs...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12 text-red-500 text-sm">
            {(error as Error).message}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-ux-text-sub">
            <svg className="h-8 w-8 mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">No log entries match the current filters.</p>
            <p className="text-xs mt-1 opacity-60">
              {total === 0 && !levelFilter && !search && !component
                ? 'Log tables are empty — entries will appear here once the API starts writing logs.'
                : 'Try widening the filters or selecting a different system.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-ux-surface-alt border-b border-ux-border">
                <tr>
                  {([
                    { key: 'timestamp',  label: 'Timestamp',   align: 'left'  },
                    { key: 'level',      label: 'Level',       align: 'left'  },
                    { key: 'system',     label: 'System',      align: 'left'  },
                    { key: 'component',  label: 'Component',   align: 'left'  },
                    { key: 'event_type', label: 'Event Type',  align: 'left'  },
                    { key: 'message',    label: 'Message',     align: 'left'  },
                    { key: 'outcome',    label: 'Outcome',     align: 'left'  },
                    { key: 'duration_ms',label: 'Duration',    align: 'right' },
                  ] as const).map(({ key, label, align }) => {
                    const active = sortBy === key;
                    return (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        className={`px-3 py-2.5 text-${align} text-xs font-semibold uppercase tracking-wide whitespace-nowrap select-none cursor-pointer group ${
                          active
                            ? 'text-violet-600 dark:text-violet-400'
                            : 'text-ux-text-sub hover:text-gray-700 dark:hover:text-gray-200'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
                            {active && sortDir === 'asc'
                              ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3"><path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd" /></svg>
                              : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3"><path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd" /></svg>
                            }
                          </span>
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-ux-border/50">
                {rows.map(row => (
                  <LogTableRow
                    key={row.log_id}
                    row={row}
                    isSelected={selectedLogId === row.log_id}
                    onClick={() => selectRow(row.log_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <Pagination
          page={currentPage}
          totalPages={pageCount}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={(p) => setOffset((p - 1) * pageSize)}
          onPageSizeChange={(s) => { setPageSize(s); setOffset(0); }}
          pageSizeOptions={[25, 50, 100, 250]}
          accentClass="text-violet-600 dark:text-violet-400"
        />
      </div>

      {/* Info note */}
      <p className="text-xs text-ux-text-sub">
        Click any row to view full event details in the side panel. The table shows the most recent events first. Alarm, critical, and emergency events always appear regardless of the configured minimum log level.
      </p>
    </div>

    {/* Log detail overlay panel */}
    {selectedLogId && (
      <LogDetailPanel logId={selectedLogId} onClose={() => setSelectedLogId(null)} />
    )}
    </UXScopeWrapper>
  );
}
