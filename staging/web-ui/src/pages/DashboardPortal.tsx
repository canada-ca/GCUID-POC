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
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { systemApi, SystemDashboard, SYSTEM_LOG_LEVEL_LABELS } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { useDateTime } from '../context/DateTimeFormatContext';
import { UXScopeWrapper } from '../context/UXThemeContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-ux-text-sub px-1 mb-3">
      {children}
    </h2>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-ux-surface border border-ux-border rounded-lg shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function StatPill({
  label,
  value,
  sub,
  color = 'gray',
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: 'gray' | 'violet' | 'green' | 'amber' | 'red' | 'blue';
}) {
  const ring: Record<string, string> = {
    gray:   'bg-ux-surface-alt border-ux-border',
    violet: 'bg-[#eeeaf3] dark:bg-violet-900/20 border-[#ddd5e7]',
    green:  'bg-[#e8ede6] dark:bg-green-900/20 border-[#d1dccf] dark:border-[#3d5636]',
    amber:  'bg-[#f4f0e4] dark:bg-amber-900/20 border-[#e9e1c9] dark:border-[#a67f3d]',
    red:    'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700',
    blue:   'bg-[#e7eef4] dark:bg-blue-900/20 border-[#d0dde9] dark:border-[#3f6489]',
  };
  const textColor: Record<string, string> = {
    gray:   'text-ux-text',
    violet: 'text-violet-800 dark:text-violet-200',
    green:  'text-green-800 dark:text-green-200',
    amber:  'text-amber-800 dark:text-amber-200',
    red:    'text-red-800 dark:text-red-200',
    blue:   'text-blue-800 dark:text-blue-200',
  };
  return (
    <div className={`border rounded-lg px-4 py-3 ${ring[color]}`}>
      <p className="text-xs text-ux-text-sub font-medium mb-1">{label}</p>
      <p className={`text-xl font-bold ${textColor[color]}`}>{value}</p>
      {sub && <p className="text-xs text-ux-text-sub mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── DB Sizes grid ────────────────────────────────────────────────────────────

function DatabaseSizesSection({ data }: { data: SystemDashboard }) {
  const { files, total_formatted } = data.databases;
  const coreFiles = [
    { label: files.registry.label, formatted: files.registry.formatted, bytes: files.registry.file_bytes },
    { label: files.hr.label,       formatted: files.hr.formatted,       bytes: files.hr.file_bytes },
    { label: files.ldap.label,     formatted: files.ldap.formatted,     bytes: files.ldap.file_bytes },
    { label: files.logs.label,     formatted: files.logs.formatted,     bytes: files.logs.file_bytes,
      exists: files.logs.exists },
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionTitle>Database Sizes</SectionTitle>
        <span className="text-xs text-ux-text-sub">Total: {total_formatted}</span>
      </div>
      <Card>
        <div className="divide-y divide-ux-border/50">
          {coreFiles.map((f) => (
            <div key={f.label} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ux-text font-medium">{f.label}</span>
                {f.exists === false && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 bg-[#f4f0e4] dark:bg-amber-900/20 border border-[#e9e1c9] dark:border-[#a67f3d] px-1.5 rounded">not initialised</span>
                )}
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold text-ux-text">{f.formatted}</span>
                <span className="text-xs text-ux-text-sub ml-2">({f.bytes.toLocaleString()} B)</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {files.connectors.length > 0 && (
        <Card>
          <div className="px-5 py-3 border-b border-ux-border">
            <p className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Connector Databases</p>
          </div>
          <div className="divide-y divide-ux-border/50">
            {files.connectors.map((c) => (
              <div key={c.label} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-ux-text-sub">{c.label}</span>
                <div className="text-right">
                  <span className="text-sm font-semibold text-ux-text">{c.formatted}</span>
                  <span className="text-xs text-ux-text-sub ml-2">({c.file_bytes.toLocaleString()} B)</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}

// ─── Log counts section ───────────────────────────────────────────────────────

const LOG_SYSTEM_KEYS = Object.keys(SYSTEM_LOG_LEVEL_LABELS);

function LogSizesSection({
  data,
  onClear,
  clearing,
}: {
  data: SystemDashboard;
  onClear: (system: string) => void;
  clearing: string | null;
}) {
  const [confirmSystem, setConfirmSystem] = useState<string | null>(null);
  const { by_system, total, db_formatted, db_exists } = data.logs;

  function handleClear(system: string) {
    if (confirmSystem === system) {
      setConfirmSystem(null);
      onClear(system);
    } else {
      setConfirmSystem(system);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionTitle>Log Counts</SectionTitle>
        <span className="text-xs text-ux-text-sub">
          {db_exists ? `Log DB: ${db_formatted}` : 'Log DB not initialised'}
        </span>
      </div>
      {!db_exists ? (
        <Card>
          <div className="px-5 py-4 text-sm text-ux-text-sub">
            Log database has not been initialised. Start the API server to create it.
          </div>
        </Card>
      ) : (
        <Card>
          <div className="px-5 py-3 border-b border-ux-border flex items-center justify-between">
            <p className="text-sm font-semibold text-ux-text">
              Total: {total.toLocaleString()} entries
            </p>
            <button
              onClick={() => handleClear('all')}
              disabled={clearing !== null || total === 0}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                confirmSystem === 'all'
                  ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                  : 'text-red-600 border-red-300 dark:border-red-700 hover:bg-red-50 dark:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {clearing === 'all'
                ? 'Clearing…'
                : confirmSystem === 'all'
                ? 'Confirm — clear ALL logs?'
                : 'Clear all logs'}
            </button>
          </div>
          <div className="divide-y divide-ux-border/50">
            {LOG_SYSTEM_KEYS.map((key) => {
              const count = by_system[key] ?? 0;
              const label = SYSTEM_LOG_LEVEL_LABELS[key] ?? key;
              const isClearing = clearing === key;
              const isConfirm  = confirmSystem === key;
              return (
                <div key={key} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm text-ux-text font-medium w-36 shrink-0">{label}</span>
                    <span className="text-sm text-ux-text-sub">{count.toLocaleString()} entries</span>
                  </div>
                  <button
                    onClick={() => handleClear(key)}
                    disabled={clearing !== null || count === 0}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors shrink-0 ml-4 ${
                      isConfirm
                        ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                        : 'text-red-500 border-red-200 dark:border-red-700 hover:bg-red-50 dark:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed'
                    }`}
                  >
                    {isClearing
                      ? 'Clearing…'
                      : isConfirm
                      ? 'Confirm clear?'
                      : 'Clear'}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {confirmSystem && (
        <div className="text-xs text-amber-800 dark:text-amber-300 bg-[#f4f0e4] dark:bg-amber-900/20 border border-[#e9e1c9] dark:border-[#a67f3d] rounded px-4 py-2 flex items-center justify-between">
          <span>
            Click <strong>Confirm</strong> again to delete{' '}
            {confirmSystem === 'all'
              ? 'all log entries'
              : `all logs for ${SYSTEM_LOG_LEVEL_LABELS[confirmSystem] ?? confirmSystem}`}.
            This cannot be undone.
          </span>
          <button
            onClick={() => setConfirmSystem(null)}
            className="ml-4 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:text-amber-200 font-medium"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

// ─── Record counts section ────────────────────────────────────────────────────

function RecordCountsSection({ data }: { data: SystemDashboard }) {
  const { record_counts, identities } = data;
  const stateMap = Object.fromEntries(
    (identities.by_state ?? []).map((s) => [s.state, s.count])
  );

  return (
    <section className="space-y-3">
      <SectionTitle>Record Counts</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatPill
          label="Identities (total)"
          value={identities.total.toLocaleString()}
          color="violet"
        />
        <StatPill
          label="Active"
          value={(stateMap['active'] ?? 0).toLocaleString()}
          color="green"
        />
        <StatPill
          label="Staged"
          value={(stateMap['staged'] ?? 0).toLocaleString()}
          color="amber"
        />
        <StatPill
          label="HR Employees"
          value={record_counts.hr_employees.toLocaleString()}
          color="blue"
        />
        <StatPill
          label="LDAP Users"
          value={record_counts.ldap_users.toLocaleString()}
          color="blue"
        />
        <StatPill
          label="Engineering (cache)"
          value={(record_counts.cache_entries['engineering'] ?? 0).toLocaleString()}
        />
        <StatPill
          label="Finance (cache)"
          value={(record_counts.cache_entries['finance'] ?? 0).toLocaleString()}
        />
        <StatPill
          label="Connector records"
          value={Object.values(record_counts.connector_records).reduce((s, n) => s + n, 0).toLocaleString()}
          sub="across all connector DBs"
        />
      </div>
    </section>
  );
}

// ─── Source systems section ───────────────────────────────────────────────────

function SourceSystemsSection({ data }: { data: SystemDashboard }) {
  const { fmt } = useDateTime();
  return (
    <section className="space-y-3">
      <SectionTitle>Source Systems</SectionTitle>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ux-text-sub uppercase tracking-wide border-b border-ux-border">
                <th className="px-5 py-3 font-semibold">System</th>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Access Mode</th>
                <th className="px-5 py-3 font-semibold">Cache TTL</th>
                <th className="px-5 py-3 font-semibold">Last Sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {data.source_systems.map((ss) => (
                <tr key={ss.system_id} className="hover:bg-ux-hover bg-ux-surface/50">
                  <td className="px-5 py-3 font-medium text-ux-text">{ss.display_name}</td>
                  <td className="px-5 py-3 text-ux-text-sub">{ss.system_type}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                        ss.access_mode === 'direct'
                          ? 'bg-[#e8ede6] dark:bg-green-800/60 text-green-700 dark:text-green-300'
                          : ss.access_mode === 'cache-only'
                          ? 'bg-[#f4f0e4] dark:bg-amber-800/60 text-amber-800 dark:text-amber-300'
                          : 'bg-[#e7eef4] dark:bg-blue-800/60 text-blue-700 dark:text-blue-300'
                      }`}
                    >
                      {ss.access_mode}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ux-text-sub">
                    {ss.cache_ttl_seconds != null ? `${ss.cache_ttl_seconds}s` : '—'}
                  </td>
                  <td className="px-5 py-3 text-ux-text-sub text-xs">
                    {ss.last_sync_at
                      ? fmt(ss.last_sync_at)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Plan B option B3 — Source server reachability (separate processes on :5188-5191) */}
      <Card title="Source Servers (Plan B HTTP Boundary)" data-testid="card-source-servers">
        <p className="text-xs text-ux-text-sub mb-3">
          Each connector proxies to a dedicated source server process. Health below is the live HTTP
          reachability of those source servers, not the connector.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ux-text-sub uppercase tracking-wide border-b border-ux-border">
                <th className="px-5 py-3 font-semibold">Source</th>
                <th className="px-5 py-3 font-semibold">Port</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Records</th>
                <th className="px-5 py-3 font-semibold">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {(data.sources ?? []).map((s) => (
                <tr key={s.sourceId} className="hover:bg-ux-hover bg-ux-surface/50">
                  <td className="px-5 py-3 font-medium text-ux-text">{s.label}</td>
                  <td className="px-5 py-3 text-ux-text-sub">:{s.port}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                        s.status === 'healthy'
                          ? 'bg-[#e8ede6] dark:bg-green-800/60 text-green-700 dark:text-green-300'
                          : s.status === 'degraded'
                          ? 'bg-[#f4f0e4] dark:bg-amber-800/60 text-amber-800 dark:text-amber-300'
                          : 'bg-[#f4e4e4] dark:bg-red-800/60 text-red-700 dark:text-red-300'
                      }`}
                      title={s.error ?? ''}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ux-text-sub">
                    {s.recordCount != null ? s.recordCount.toLocaleString() : '—'}
                  </td>
                  <td className="px-5 py-3 text-ux-text-sub text-xs">
                    {s.responseTimeMs != null ? `${s.responseTimeMs} ms` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

// ─── Main portal ──────────────────────────────────────────────────────────────

export default function DashboardPortal() {
  const queryClient = useQueryClient();
  const { fmt } = useDateTime();

  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ['system-dashboard'],
    queryFn:  systemApi.getDashboard,
    refetchInterval: 30_000,
  });

  const [clearing, setClearing] = useState<string | null>(null);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const clearMutation = useMutation({
    mutationFn: (system: string) => systemApi.clearLogs(system),
    onMutate: (system) => setClearing(system),
    onSuccess: (result, system) => {
      setClearing(null);
      const label = system === 'all'
        ? 'All logs'
        : SYSTEM_LOG_LEVEL_LABELS[system] ?? system;
      setClearResult(`${label} cleared — ${result.deleted.toLocaleString()} entries removed.`);
      queryClient.invalidateQueries({ queryKey: ['system-dashboard'] });
      setTimeout(() => setClearResult(null), 5000);
    },
    onError: () => {
      setClearing(null);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <ErrorMessage message={(error as Error)?.message ?? 'Failed to load dashboard'} />
      </div>
    );
  }

  const { server } = data;

  return (
    <UXScopeWrapper scopeId="portal-system">
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ux-text">System Dashboard</h1>
          <p className="text-sm text-ux-text-sub mt-1">Operational snapshot across all services</p>
        </div>
        <div className="text-right text-xs text-ux-text-sub">
          <p>Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</p>
          <p>Refreshes every 30s</p>
        </div>
      </div>

      {/* Server health */}
      <section className="space-y-3">
        <SectionTitle>Server</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatPill label="Uptime" value={server.uptime_human} color="green" />
          <StatPill label="Node.js" value={server.node_version} />
          <StatPill label="PID" value={server.pid} />
          <StatPill
            label="Started"
            value={fmt(new Date(new Date(server.timestamp).getTime() - server.uptime_seconds * 1000))}
          />
        </div>
      </section>

      {/* Clear result toast */}
      {clearResult && (
        <div className="bg-[#e8ede6] dark:bg-green-900/20 border border-[#d1dccf] dark:border-[#3d5636] text-green-800 dark:text-green-200 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
          <span>{clearResult}</span>
          <button onClick={() => setClearResult(null)} className="ml-4 text-green-600 hover:text-green-800 dark:text-green-200">✕</button>
        </div>
      )}

      {/* Record counts */}
      <RecordCountsSection data={data} />

      {/* DB sizes */}
      <DatabaseSizesSection data={data} />

      {/* Log sizes + clear */}
      <LogSizesSection
        data={data}
        onClear={(system) => clearMutation.mutate(system)}
        clearing={clearing}
      />

      {/* Source systems */}
      <SourceSystemsSection data={data} />

    </div>
    </UXScopeWrapper>
  );
}
