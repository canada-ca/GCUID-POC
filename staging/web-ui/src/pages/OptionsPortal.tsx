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
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import {
  DATE_FORMAT_OPTIONS, TIME_FORMAT_OPTIONS, TIMEZONE_OPTIONS,
  formatDateTime,
} from '../hooks/useDateTimeFormat';
import { useDateTime } from '../context/DateTimeFormatContext';
import {
  connectorsApi, sourceSystemsApi, ConnectorConfig, ConnectorPatch, SourceSystem,
  logLevelsApi, LogLevelsConfig, LOG_LEVEL_OPTIONS, SYSTEM_LOG_LEVEL_LABELS, ACCESS_MODE_LABELS,
} from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import ConnectorSequenceDiagram from '../components/ConnectorSequenceDiagram';
import { UXScopeWrapper } from '../context/UXThemeContext';

// --- Reusable toggle row ------------------------------------------------------

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between px-5 py-4 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="pr-8">
        <p className="text-sm font-medium text-ux-text">{label}</p>
        <p className="text-xs text-ux-text-sub mt-0.5">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer shrink-0">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
        />
        <div className="w-10 h-6 bg-ux-hover peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ux-accent rounded-full peer peer-checked:bg-ux-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
      </label>
    </div>
  );
}

// --- Section header row (master toggle) --------------------------------------

function SectionHeader({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4 bg-ux-surface-alt border-b border-ux-border">
      <div>
        <p className="text-sm font-semibold text-ux-text">{label}</p>
        <p className="text-xs text-ux-text-sub mt-0.5">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={`Enable ${label}`}
        />
        <div className="w-10 h-6 bg-ux-hover peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ux-accent rounded-full peer peer-checked:bg-ux-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
      </label>
    </div>
  );
}

// --- Connector configure modal ------------------------------------------------

function ConnectorModal({
  connector,
  onSave,
  onClose,
  isPending,
  error,
}: {
  connector: ConnectorConfig;
  onSave: (patch: ConnectorPatch) => void;
  onClose: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState({
    displayName:      connector.displayName,
    description:      connector.description,
    accessMode:       connector.accessMode,
    registryUrl:      connector.gcuidIntegration.registryUrl,
    registryToken:    connector.gcuidIntegration.registryAuthToken,
    connectorPort:    connector.connectorServer.port,
    connectorToken:   connector.connectorServer.authToken,
  });

  const mappings = Object.entries(connector.gcuidIntegration.attributeMappings);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      displayName:  form.displayName,
      description:  form.description,
      accessMode:   form.accessMode as ConnectorConfig['accessMode'],
      gcuidIntegration: {
        registryUrl:        form.registryUrl,
        registryAuthToken:  form.registryToken,
      },
      connectorServer: {
        port:       Number(form.connectorPort),
        authToken:  form.connectorToken,
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-ux-surface rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ux-border shrink-0">
          <h2 className="text-lg font-semibold text-ux-text">Configure: {connector.displayName}</h2>
          <button onClick={onClose} className="text-ux-text-sub hover:text-gray-800 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="px-6 py-5 space-y-6">

            {/* Identity */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Identity</h3>
              <div>
                <label className="block text-sm font-medium text-ux-text mb-1">Display name</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={e => setForm(p => ({ ...p, displayName: e.target.value }))}
                  placeholder="e.g. HR Management System"
                  className="w-full border border-ux-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ux-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ux-text mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="Describe the purpose and data held by this connector"
                  className="w-full border border-ux-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ux-accent resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ux-text mb-1">Access mode</label>
                <select
                  value={form.accessMode}
                  onChange={e => setForm(p => ({ ...p, accessMode: e.target.value as ConnectorConfig['accessMode'] }))}
                  title="Access mode"
                  className="w-full border border-ux-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ux-accent bg-ux-surface"
                >
                  <option value="dynamic-pull">Dynamic Pull — registry queries on demand</option>
                  <option value="scheduled-pull">Scheduled Pull — registry fetches on a schedule</option>
                  <option value="push-cache">Push to Cache — department pushes records to registry</option>
                </select>
              </div>
            </div>

            {/* GCUID integration */}
            <div className="space-y-4 pt-4 border-t border-ux-border">
              <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">GCUID Registry integration</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ux-text mb-1">Registry URL</label>
                  <input
                    type="url"
                    value={form.registryUrl}
                    onChange={e => setForm(p => ({ ...p, registryUrl: e.target.value }))}
                    placeholder="http://localhost:5182"
                    className="w-full border border-ux-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ux-accent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ux-text mb-1">Auth token</label>
                  <input
                    type="text"
                    value={form.registryToken}
                    onChange={e => setForm(p => ({ ...p, registryToken: e.target.value }))}
                    placeholder="Bearer token for registry auth"
                    className="w-full border border-ux-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ux-accent"
                    required
                  />
                </div>
              </div>
              {/* Attribute mappings — read-only; set by the connector developer */}
              <div>
                <p className="text-sm font-medium text-ux-text mb-2">
                  Attribute mappings
                  <span className="text-ux-text-sub">(defined by connector developer — read-only)</span>
                </p>
                <div className="border border-ux-border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-ux-surface-alt text-ux-text-sub">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Standard attribute</th>
                        <th className="text-left px-3 py-2 font-medium">Source field</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ux-border/50">
                      {mappings.map(([attr, field]) => (
                        <tr key={attr}>
                          <td className="px-3 py-1.5 font-mono text-violet-700 dark:text-violet-300">{attr}</td>
                          <td className="px-3 py-1.5 font-mono text-ux-text-sub">{field}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Connector server */}
            <div className="space-y-4 pt-4 border-t border-ux-border">
              <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Connector server</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ux-text mb-1">Port</label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={form.connectorPort}
                    onChange={e => setForm(p => ({ ...p, connectorPort: Number(e.target.value) }))}
                    placeholder="8101"
                    className="w-full border border-ux-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ux-accent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ux-text mb-1">Auth token</label>
                  <input
                    type="text"
                    value={form.connectorToken}
                    onChange={e => setForm(p => ({ ...p, connectorToken: e.target.value }))}
                    placeholder="Bearer token for connector auth"
                    className="w-full border border-ux-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ux-accent"
                    required
                  />
                </div>
              </div>
              {/* Source connection — informational only */}
              <div className="bg-ux-surface-alt rounded-md px-4 py-3 text-xs text-ux-text-sub space-y-0.5">
                <p className="font-medium text-ux-text-sub">Source connection (read-only)</p>
                {connector.sourceConnection.upstreamSource ? (
                  <>
                    {/* Plan B option B3: connector proxies to a source server over HTTP */}
                    <p>Mode: <span className="font-mono">http-upstream (Plan B)</span></p>
                    <p>Source URL: <span className="font-mono">{connector.sourceConnection.upstreamSource.baseUrl}</span></p>
                    <p>Source token: <span className="font-mono">{connector.sourceConnection.upstreamSource.authToken}</span></p>
                    {connector.sourceConnection.dbPath && (
                      <p>Backing DB: <span className="font-mono">{connector.sourceConnection.dbPath}</span> <span className="opacity-70">(owned by source server)</span></p>
                    )}
                    {connector.sourceConnection.primaryTable && (
                      <p>Table: <span className="font-mono">{connector.sourceConnection.primaryTable}</span> — key: <span className="font-mono">{connector.sourceConnection.primaryKeyField}</span></p>
                    )}
                  </>
                ) : (
                  <>
                    {/* Pre-Plan-B direct mode (legacy) */}
                    <p>Type: <span className="font-mono">{connector.sourceConnection.type}</span></p>
                    {connector.sourceConnection.dbPath && (
                      <p>DB path: <span className="font-mono">{connector.sourceConnection.dbPath}</span></p>
                    )}
                    {connector.sourceConnection.apiUrl && (
                      <p>API URL: <span className="font-mono">{connector.sourceConnection.apiUrl}</span></p>
                    )}
                    {connector.sourceConnection.primaryTable && (
                      <p>Table: <span className="font-mono">{connector.sourceConnection.primaryTable}</span> — key: <span className="font-mono">{connector.sourceConnection.primaryKeyField}</span></p>
                    )}
                  </>
                )}
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-ux-border bg-ux-surface-alt shrink-0">
            <button type="button" onClick={onClose} className="btn btn-secondary text-sm">
              Cancel
            </button>
            <button type="submit" disabled={isPending} className="btn btn-primary text-sm">
              {isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Connector row -------------------------------------------------------------

const TYPE_COLORS: Record<string, { badge: string; dot: string }> = {
  authoritative_source: { badge: 'bg-blue-100 dark:bg-blue-800/60 text-blue-800 dark:text-blue-200',   dot: 'bg-blue-500' },
  department:           { badge: 'bg-purple-100 dark:bg-purple-800/60 text-purple-800 dark:text-purple-200', dot: 'bg-purple-500' },
};

const TYPE_LABELS: Record<string, string> = {
  authoritative_source: 'Authoritative Source',
  department:           'Department',
};

function ConnectorRow({
  connector,
  runtimeState,
  onToggle,
  onConfigure,
  onSync,
  isSyncing,
}: {
  connector: ConnectorConfig;
  runtimeState?: SourceSystem | null;
  onToggle: (enabled: boolean) => void;
  onConfigure: () => void;
  onSync?: () => void;
  isSyncing?: boolean;
}) {
  const colors = TYPE_COLORS[connector.systemType] ?? TYPE_COLORS.department;
  const mappingCount = Object.keys(connector.gcuidIntegration.attributeMappings).length;
  const showSync = connector.accessMode === 'scheduled-pull' && typeof onSync === 'function';
  const { fmt } = useDateTime();
  const lastSync = runtimeState?.last_sync_at ? fmt(runtimeState.last_sync_at) : null;

  return (
    <div className={`px-5 py-4 flex items-start gap-4 ${!connector.enabled ? 'opacity-60' : ''}`}>
      {/* Status dot */}
      <div className="mt-1 shrink-0">
        <div className={`w-2.5 h-2.5 rounded-full ${connector.enabled ? colors.dot : 'bg-ux-muted'}`} />
      </div>

      {/* Info block */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ux-text">{connector.displayName}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors.badge}`}>
            {TYPE_LABELS[connector.systemType]}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-ux-hover text-ux-text-sub">
            {ACCESS_MODE_LABELS[connector.accessMode] ?? connector.accessMode}
          </span>
        </div>
        <p className="mt-1 text-xs text-ux-text-sub line-clamp-2">{connector.description}</p>
        <div className="text-ux-text-sub">
          <span>Port <span className="font-mono">{connector.connectorServer.port}</span></span>
          <span>Registry <span className="font-mono">{connector.gcuidIntegration.registryUrl}</span></span>
          <span>{mappingCount} attribute{mappingCount !== 1 ? 's' : ''} mapped</span>
        </div>
        {runtimeState && (
          <div className="text-ux-text-sub">
            {runtimeState.cache_record_count > 0 && (
              <span>{runtimeState.cache_record_count.toLocaleString()} cached record{runtimeState.cache_record_count !== 1 ? 's' : ''}</span>
            )}
            {lastSync && <span>Last sync: {lastSync}</span>}
            {!lastSync && connector.accessMode !== 'dynamic-pull' && (
              <span className="text-amber-500">Never synced</span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 shrink-0">
        {showSync && (
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="text-xs text-teal-600 hover:text-teal-800 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSyncing ? 'Syncing…' : 'Sync Now'}
          </button>
        )}
        <button
          onClick={onConfigure}
          className="text-xs text-violet-600 hover:text-violet-800 dark:text-violet-200 font-medium"
        >
          Configure
        </button>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={connector.enabled}
            onChange={e => onToggle(e.target.checked)}
            aria-label={`${connector.enabled ? 'Disable' : 'Enable'} ${connector.displayName}`}
          />
          <div className="w-10 h-6 bg-ux-hover peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ux-accent rounded-full peer peer-checked:bg-ux-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
        </label>
      </div>
    </div>
  );
}

// --- Connectors tab panel -----------------------------------------------------

function ConnectorsPanel() {
  const queryClient = useQueryClient();
  const [configuring, setConfiguring] = useState<ConnectorConfig | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const { data: connectors, isLoading, error } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => connectorsApi.list(),
  });

  const { data: sourceSystems } = useQuery({
    queryKey: ['source-systems'],
    queryFn: () => sourceSystemsApi.list(),
    refetchInterval: 30_000,
  });

  // Build a lookup: connector_id ? SourceSystem row
  const runtimeByConnectorId = (sourceSystems ?? []).reduce<Record<string, SourceSystem>>(
    (acc, s) => { if (s.connector_id) acc[s.connector_id] = s; return acc; },
    {}
  );

  const updateMutation = useMutation({
    mutationFn: ({ systemId, patch }: { systemId: string; patch: ConnectorPatch }) =>
      connectorsApi.update(systemId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      setConfiguring(null);
      setModalError(null);
    },
    onError: (err: Error) => setModalError(err.message),
  });

  const syncMutation = useMutation({
    mutationFn: (systemId: string) => connectorsApi.sync(systemId),
    onSettled: () => setSyncingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['source-systems'] });
    },
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={(error as Error).message} />;
  if (!connectors?.length) return (
    <p className="text-sm text-ux-text-sub">No connector configs found in <code>config/connectors/</code>.</p>
  );

  const authSources = connectors.filter(c => c.systemType === 'authoritative_source');
  const departments  = connectors.filter(c => c.systemType === 'department');

  return (
    <div className="space-y-6">
      <p className="text-sm text-ux-text-sub">
        Each connector links a department or authoritative source to the GCUID identity registry.
        Config files live in <code className="text-xs bg-ux-hover px-1 py-0.5 rounded">config/connectors/</code>.
        Changes to the enable toggle take effect immediately; port and token changes require a connector restart.
      </p>

      {/* Authoritative sources */}
      {authSources.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide mb-3">
            Authoritative Sources
          </h3>
          <div className="border border-ux-border rounded-lg overflow-hidden divide-y divide-ux-border/50">
            {authSources.map(c => (
              <ConnectorRow
                key={c.systemId}
                connector={c}
                runtimeState={runtimeByConnectorId[c.systemId] ?? null}
                onToggle={enabled =>
                  updateMutation.mutate({ systemId: c.systemId, patch: { enabled } })
                }
                onConfigure={() => { setConfiguring(c); setModalError(null); }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Departments */}
      {departments.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide mb-3">
            Departments
          </h3>
          <div className="border border-ux-border rounded-lg overflow-hidden divide-y divide-ux-border/50">
            {departments.map(c => (
              <ConnectorRow
                key={c.systemId}
                connector={c}
                runtimeState={runtimeByConnectorId[c.systemId] ?? null}
                onToggle={enabled =>
                  updateMutation.mutate({ systemId: c.systemId, patch: { enabled } })
                }
                onConfigure={() => { setConfiguring(c); setModalError(null); }}
                onSync={c.accessMode === 'scheduled-pull' ? () => {
                  setSyncingId(c.systemId);
                  syncMutation.mutate(c.systemId);
                } : undefined}
                isSyncing={syncingId === c.systemId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Integration sequence diagrams */}
      {connectors.length > 0 && (() => {
        const modes = [...new Set(connectors.map(c => c.accessMode))] as Array<'dynamic-pull' | 'scheduled-pull' | 'push-cache'>;
        return (
          <div className="pt-2 border-t border-ux-border">
            <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide mb-4">
              Integration Sequence Diagrams
            </h3>
            <ConnectorSequenceDiagram availableModes={modes} />
          </div>
        );
      })()}

      {configuring && (
        <ConnectorModal
          connector={configuring}
          onSave={patch => updateMutation.mutate({ systemId: configuring.systemId, patch })}
          onClose={() => { setConfiguring(null); setModalError(null); }}
          isPending={updateMutation.isPending}
          error={modalError}
        />
      )}
    </div>
  );
}

// --- Logging tab panel --------------------------------------------------------

const ALWAYS_EMIT_NOTE = 'Alarm, critical, and emergency events always write to the log regardless of this setting.';

function LoggingPanel() {
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: levels, isLoading, error } = useQuery({
    queryKey: ['log-levels'],
    queryFn: () => logLevelsApi.get(),
  });

  const patchMutation = useMutation({
    mutationFn: (patch: Partial<LogLevelsConfig>) => logLevelsApi.patch(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['log-levels'], updated);
      setSaveError(null);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={(error as Error).message} />;
  if (!levels) return null;

  const systemIds = Object.keys(SYSTEM_LOG_LEVEL_LABELS) as (keyof typeof SYSTEM_LOG_LEVEL_LABELS)[];

  return (
    <div className="space-y-4">
      <p className="text-sm text-ux-text-sub">
        Set the minimum log level for each system. Only events at or above the selected severity are
        written to the database. {ALWAYS_EMIT_NOTE}
      </p>

      <div className="border border-ux-border rounded-lg overflow-hidden divide-y divide-ux-border/50">
        {/* Header row */}
        <div className="flex items-center px-5 py-2.5 bg-ux-surface-alt">
          <span className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide flex-1">System</span>
          <span className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide w-52">Minimum level</span>
        </div>

        {systemIds.map(systemId => {
          const current = (levels[systemId] ?? 'info') as string;
          const isSaving = patchMutation.isPending && patchMutation.variables?.[systemId] !== undefined;

          return (
            <div key={systemId} className="flex items-center px-5 py-3.5 gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-ux-text">{SYSTEM_LOG_LEVEL_LABELS[systemId]}</p>
                <p className="text-ux-text-sub">{systemId}</p>
              </div>
              <div className="w-52 flex items-center gap-2">
                <select
                  value={current}
                  disabled={isSaving}
                  onChange={e => patchMutation.mutate({ [systemId]: e.target.value })}
                  className="flex-1 border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`Log level for ${SYSTEM_LOG_LEVEL_LABELS[systemId]}`}
                >
                  {LOG_LEVEL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {isSaving && (
                  <svg className="animate-spin h-4 w-4 text-violet-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {saveError && (
        <p className="text-sm text-red-600 mt-1">{saveError}</p>
      )}

      {/* Level reference table */}
      <div className="border border-ux-border rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-ux-surface-alt">
          <span className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Level reference (RFC 5424)</span>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
          {LOG_LEVEL_OPTIONS.map(opt => (
            <div key={opt.value} className="flex items-start px-4 py-2 gap-3">
              <span className="text-xs font-mono font-semibold text-ux-text w-20 shrink-0 mt-0.5">{opt.label}</span>
              <span className="text-xs text-ux-text-sub">{opt.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Page ---------------------------------------------------------------------

type Tab = 'flags' | 'connectors' | 'logging' | 'display';

export default function OptionsPortal() {
  const { flags, setFlag, reset } = useFeatureFlags();
  const { prefs, setPrefs, reset: resetDateTime } = useDateTime();
  const [activeTab, setActiveTab] = useState<Tab>('flags');

  // Live preview using current in-flight values (before save — all changes are instant)
  const PREVIEW_TS = '2026-05-02T14:05:09Z';

  return (
    <UXScopeWrapper scopeId="portal-system">
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold text-ux-text">System Options</h1>
        <p className="mt-2 text-sm text-ux-text-sub">
          System-level configuration for the GCUID proof-of-concept. Settings are shared across all
          users and take effect immediately unless otherwise noted.
        </p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-ux-border">
        <nav className="-mb-px flex gap-6">
          {([ ['flags', 'Feature Flags'], ['connectors', 'Connectors'], ['logging', 'Logging'], ['display', 'Display'] ] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* -- Feature Flags tab --------------------------------------------- */}
      {activeTab === 'flags' && (
        <>
          <section>
            <h2 className="text-xs font-semibold text-ux-text-sub mb-3 uppercase tracking-wide">
              Feature Flags
            </h2>

            {/* Aliases group */}
            <div className="border border-ux-border rounded-lg overflow-hidden">
              <SectionHeader
                label="Aliases"
                description="Master toggle for all identifier alias capabilities across the GCUID Registry and User Portal."
                checked={flags.aliases.enabled}
                onChange={(v) => setFlag('aliases', { enabled: v })}
              />

              <div className="divide-y divide-ux-border/50">
                <ToggleRow
                  label="Email aliases"
                  description="Aliases automatically derived from email addresses in authoritative sources (e.g. john.smith@department.gc.ca)."
                  checked={flags.aliases.email}
                  onChange={(v) => setFlag('aliases', { email: v })}
                  disabled={!flags.aliases.enabled}
                />
                <ToggleRow
                  label="User-selected aliases"
                  description="Custom aliases chosen by the subject through the self-service User Portal."
                  checked={flags.aliases.userSelected}
                  onChange={(v) => setFlag('aliases', { userSelected: v })}
                  disabled={!flags.aliases.enabled}
                />
                <ToggleRow
                  label="System-generated aliases"
                  description="Deterministic GC-style aliases generated by the GCUID Registry (e.g. GC-A-XXXX-XXXX-XXXX-C)."
                  checked={flags.aliases.generated}
                  onChange={(v) => setFlag('aliases', { generated: v })}
                  disabled={!flags.aliases.enabled}
                />
              </div>
            </div>
          </section>

          {/* GCUID Generation group */}
          <section>
            <h2 className="text-xs font-semibold text-ux-text-sub mb-3 uppercase tracking-wide">
              GCUID Generation
            </h2>
            <div className="border border-ux-border rounded-lg overflow-hidden">
              <div className="px-5 py-4 bg-ux-surface-alt border-b border-ux-border">
                <p className="text-sm font-semibold text-ux-text">Identifier defaults</p>
                <p className="text-xs text-ux-text-sub mt-0.5">
                  System-wide defaults applied when registering new identities. Each registration can override these per-request.
                </p>
              </div>
              <div className="divide-y divide-ux-border/50">

                {/* Format */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="pr-8">
                    <p className="text-sm font-medium text-ux-text">Identifier format</p>
                    <p className="text-xs text-ux-text-sub mt-0.5">
                      V2 (<code className="text-xs bg-ux-hover px-1 rounded">urn:gcuid:{'<core>'}</code>) is the current standard.
                      V1 (<code className="text-xs bg-ux-hover px-1 rounded">urn:gc:uid:{'<entity-type>'}:{'<version>'}:{'<core>'}</code>) is the legacy format with entity type and version embedded in the URN.
                    </p>
                  </div>
                  <select
                    value={flags.gcuidGeneration.format}
                    onChange={(e) => setFlag('gcuidGeneration', { format: e.target.value as 'v1' | 'v2' })}
                    className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-44 shrink-0"
                    aria-label="Identifier format"
                  >
                    <option value="v2">V2 — Current</option>
                    <option value="v1">V1 — Legacy</option>
                  </select>
                </div>

                {/* Core ID type */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="pr-8">
                    <p className="text-sm font-medium text-ux-text">Core identifier type</p>
                    <p className="text-xs text-ux-text-sub mt-0.5">
                      ULID is timestamp-prefixed and lexicographically sortable by creation time.
                      UUID v4 is cryptographically random with no embedded timestamp.
                    </p>
                  </div>
                  <select
                    value={flags.gcuidGeneration.coreIdType}
                    onChange={(e) => setFlag('gcuidGeneration', { coreIdType: e.target.value as 'ulid' | 'uuid' })}
                    className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-44 shrink-0"
                    aria-label="Core identifier type"
                  >
                    <option value="ulid">ULID (time-sortable)</option>
                    <option value="uuid">UUID v4 (random)</option>
                  </select>
                </div>

                {/* Encoding */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="pr-8">
                    <p className="text-sm font-medium text-ux-text">Base32 encoding</p>
                    <p className="text-xs text-ux-text-sub mt-0.5">
                      Crockford removes ambiguous characters (I, L, O, U) for improved human readability and transcription accuracy.
                      Standard uses the RFC 4648 Base32 alphabet (A–Z + 2–7).
                    </p>
                  </div>
                  <select
                    value={flags.gcuidGeneration.encoding}
                    onChange={(e) => setFlag('gcuidGeneration', { encoding: e.target.value as 'crockford' | 'standard' })}
                    className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-44 shrink-0"
                    aria-label="Base32 encoding"
                  >
                    <option value="crockford">Crockford Base32</option>
                    <option value="standard">Standard (RFC 4648)</option>
                  </select>
                </div>

              </div>
            </div>
          </section>

          {/* Identity Matching */}
          <section>
            <h2 className="text-xs font-semibold text-ux-text-sub mb-3 uppercase tracking-wide">
              Identity Matching
            </h2>
            <div className="border border-ux-border rounded-lg overflow-hidden">
              <div className="px-5 py-4 bg-ux-surface-alt border-b border-ux-border">
                <p className="text-sm font-semibold text-ux-text">CAES matching thresholds &amp; behaviour</p>
                <p className="text-xs text-ux-text-sub mt-0.5">
                  Controls how the Central Attribute Exchange Service confidence scores are interpreted when requesting a GCUID from a source portal.
                </p>
              </div>
              <div className="divide-y divide-ux-border/50">

                {/* Strong match threshold */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="pr-8">
                    <p className="text-sm font-medium text-ux-text">Strong match threshold</p>
                    <p className="text-xs text-ux-text-sub mt-0.5">
                      Confidence score at or above which a CAES match is automatically recommended for linking without additional review.
                      Range: 0.50 – 1.00.
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0.5}
                    max={1.0}
                    step={0.05}
                    value={flags.identityMatching.strongMatchThreshold}
                    onChange={(e) => setFlag('identityMatching', { strongMatchThreshold: Math.min(1, Math.max(0.5, parseFloat(e.target.value) || 0.9)) })}
                    className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-24 shrink-0 text-center"
                    aria-label="Strong match threshold"
                  />
                </div>

                {/* Weak match threshold */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="pr-8">
                    <p className="text-sm font-medium text-ux-text">Weak match threshold</p>
                    <p className="text-xs text-ux-text-sub mt-0.5">
                      Confidence score at or above which a CAES match is flagged for manual review before linking. Scores below this value are treated as no match.
                      Must be = strong match threshold. Range: 0.50 – 1.00.
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0.5}
                    max={flags.identityMatching.strongMatchThreshold}
                    step={0.05}
                    value={flags.identityMatching.weakMatchThreshold}
                    onChange={(e) => setFlag('identityMatching', { weakMatchThreshold: Math.min(flags.identityMatching.strongMatchThreshold, Math.max(0.5, parseFloat(e.target.value) || 0.5)) })}
                    className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-24 shrink-0 text-center"
                    aria-label="Weak match threshold"
                  />
                </div>

                {/* Existing GCUID behaviour */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="pr-8">
                    <p className="text-sm font-medium text-ux-text">Existing GCUID behaviour</p>
                    <p className="text-xs text-ux-text-sub mt-0.5">
                      When a source record already has a GCUID, determines whether to propose linking it to the matched identity or always create a new provisional GCUID.
                    </p>
                  </div>
                  <select
                    value={flags.identityMatching.existingGcuidBehavior}
                    onChange={(e) => setFlag('identityMatching', { existingGcuidBehavior: e.target.value as 'propose_link' | 'always_create' })}
                    className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-52 shrink-0"
                    aria-label="Existing GCUID behaviour"
                  >
                    <option value="propose_link">Propose link to existing GCUID</option>
                    <option value="always_create">Always create new GCUID</option>
                  </select>
                </div>

                {/* Write-back mode */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="pr-8">
                    <p className="text-sm font-medium text-ux-text">Source write-back mode</p>
                    <p className="text-xs text-ux-text-sub mt-0.5">
                      Controls when a newly assigned GCUID is written back to the originating source system. Immediate mode updates the connector database at request time; on-approval mode defers until an administrator approves the provisional identity.
                    </p>
                  </div>
                  <select
                    value={flags.identityMatching.writeBackMode}
                    onChange={(e) => setFlag('identityMatching', { writeBackMode: e.target.value as 'immediate' | 'on_approval' })}
                    className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-52 shrink-0"
                    aria-label="Source write-back mode"
                  >
                    <option value="immediate">Immediate (write on creation)</option>
                    <option value="on_approval">On approval (deferred)</option>
                  </select>
                </div>

              </div>
            </div>
          </section>

          {/* Interface Mode */}
          <section>
            <h2 className="text-xs font-semibold text-ux-text-sub mb-3 uppercase tracking-wide">
              Interface Mode
            </h2>
            <div className="border border-ux-border rounded-lg overflow-hidden">
              <ToggleRow
                label="Separate portal windows"
                description="When enabled, the root URL shows a portal launcher and each portal opens as an independent interface with its own navigation. When disabled, all portals share the combined single-interface layout (default behaviour)."
                checked={flags.portalMode === 'separate'}
                onChange={(v) => setFlag('portalMode', v ? 'separate' : 'single')}
              />
            </div>
            <p className="mt-2 text-xs text-ux-text-muted">
              This is a system-wide setting stored in the database and shared across all users.
            </p>
          </section>

          {/* Reset */}
          <div className="flex items-center gap-4 pt-2 border-t border-ux-border">
            <button onClick={reset} className="btn btn-secondary text-sm">
              Reset all to defaults
            </button>
            <span className="text-xs text-ux-text-sub">
              Flags are stored in the database and shared across all users. Resetting restores all defaults immediately.
            </span>
          </div>
        </>
      )}

      {/* -- Connectors tab ------------------------------------------------ */}
      {activeTab === 'connectors' && <ConnectorsPanel />}

      {/* -- Logging tab --------------------------------------------------- */}
      {activeTab === 'logging' && <LoggingPanel />}

      {/* -- Display tab --------------------------------------------------- */}
      {activeTab === 'display' && (
        <div className="space-y-6">
          <p className="text-sm text-ux-text-sub">
            Control how dates and times appear throughout the interface. These preferences are stored
            locally in your browser and apply only to this device.
            <br />
            <span className="text-ux-text-sub">
              APIs always exchange timestamps in ISO 8601 format (e.g.{' '}
              <code className="bg-ux-hover px-1 rounded">2026-05-02T14:05:09.000Z</code>
              ) regardless of this setting.
            </span>
          </p>

          {/* Date format */}
          <section>
            <h2 className="text-xs font-semibold text-ux-text-sub mb-3 uppercase tracking-wide">
              Date &amp; Time Format
            </h2>
            <div className="border border-ux-border rounded-lg overflow-hidden divide-y divide-ux-border/50">

              {/* Date format row */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="pr-8">
                  <p className="text-sm font-medium text-ux-text">Date format</p>
                  <p className="text-xs text-ux-text-sub mt-0.5">
                    <span className="font-semibold text-violet-600 dark:text-violet-400">YYYY-MM-DD</span> is the
                    Canadian Government standard (ISO 8601) and the recommended default.
                  </p>
                </div>
                <select
                  value={prefs.dateFormat}
                  onChange={e => setPrefs({ dateFormat: e.target.value as typeof prefs.dateFormat })}
                  className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-48 shrink-0"
                  aria-label="Date format"
                >
                  {DATE_FORMAT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label} — e.g. {o.example}</option>
                  ))}
                </select>
              </div>

              {/* Time format row */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="pr-8">
                  <p className="text-sm font-medium text-ux-text">Time format</p>
                  <p className="text-xs text-ux-text-sub mt-0.5">
                    24-hour clock is preferred for unambiguous government records.
                  </p>
                </div>
                <select
                  value={prefs.timeFormat}
                  onChange={e => setPrefs({ timeFormat: e.target.value as typeof prefs.timeFormat })}
                  className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-48 shrink-0"
                  aria-label="Time format"
                >
                  {TIME_FORMAT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Timezone row */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="pr-8">
                  <p className="text-sm font-medium text-ux-text">Timezone</p>
                  <p className="text-xs text-ux-text-sub mt-0.5">
                    Timestamps from the server are always stored in UTC. This setting controls how they
                    are displayed in the interface.
                  </p>
                </div>
                <select
                  value={prefs.timezone}
                  onChange={e => setPrefs({ timezone: e.target.value })}
                  className="border border-ux-border rounded-md px-2.5 py-1.5 text-sm bg-ux-surface focus:outline-none focus:ring-2 focus:ring-ux-accent w-48 shrink-0"
                  aria-label="Timezone"
                >
                  {TIMEZONE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

            </div>
          </section>

          {/* Live preview */}
          <section>
            <h2 className="text-xs font-semibold text-ux-text-sub mb-3 uppercase tracking-wide">
              Preview
            </h2>
            <div className="border border-ux-border rounded-lg overflow-hidden divide-y divide-ux-border/50">
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-xs text-ux-text-sub">Date &amp; time</span>
                <span className="text-sm font-mono text-ux-text">
                  {formatDateTime(PREVIEW_TS, prefs)}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-xs text-ux-text-sub">Date only</span>
                <span className="text-sm font-mono text-ux-text">
                  {formatDateTime(PREVIEW_TS, { ...prefs }).split(' ')[0]}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-xs text-ux-text-sub">Raw (API / storage)</span>
                <span className="text-sm font-mono text-ux-text-sub">{PREVIEW_TS}</span>
              </div>
            </div>
          </section>

          {/* Reset */}
          <div className="flex items-center gap-4 pt-2 border-t border-ux-border">
            <button
              onClick={resetDateTime}
              className="btn btn-secondary text-sm"
            >
              Reset to defaults
            </button>
            <span className="text-xs text-ux-text-sub">
              Restores YYYY-MM-DD date format, 24-hour time, and browser local timezone.
            </span>
          </div>
        </div>
      )}
    </div>
    </UXScopeWrapper>
  );
}
