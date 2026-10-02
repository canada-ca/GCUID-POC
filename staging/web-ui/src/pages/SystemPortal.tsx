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
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  connectorsApi,
  ConnectorConfig,
  ConnectorPatch,
  ConnectorPingResult,
  ConnectorHealthResult,
} from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { UXScopeWrapper } from '../context/UXThemeContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACCESS_MODE_LABELS: Record<ConnectorConfig['accessMode'], string> = {
  'dynamic-pull':    'Dynamic Pull',
  'scheduled-pull':  'Scheduled Pull',
  'push-cache':      'Push to Cache',
};

function Badge({ label, variant }: { label: string; variant: 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'gray' }) {
  const cls: Record<typeof variant, string> = {
    green:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    red:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    amber:  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    blue:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
    gray:   'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls[variant]}`}>
      {label}
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-ux-surface border border-ux-border rounded-lg px-5 py-4">
      <p className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-ux-text mt-1">{value}</p>
      {sub && <p className="text-xs text-ux-text-sub mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Ping / Health status display ─────────────────────────────────────────────

function PingResult({ result }: { result: ConnectorPingResult | null }) {
  if (!result) return null;
  return (
    <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded border ${
      result.reachable
        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
        : 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300'
    }`}>
      <span>{result.reachable ? '✓' : '✗'}</span>
      <span>{result.reachable ? `Reachable` : 'Unreachable'}</span>
      {result.latency_ms !== null && <span className="text-ux-text-sub">· {result.latency_ms} ms</span>}
    </div>
  );
}

function HealthResult({ result }: { result: ConnectorHealthResult | null }) {
  if (!result) return null;
  return (
    <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded border ${
      result.reachable
        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
        : 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300'
    }`}>
      <span>{result.reachable ? '✓' : '✗'}</span>
      <span>{result.reachable ? 'Healthy' : (result.error ?? 'Unhealthy')}</span>
      {result.latency_ms !== null && <span className="text-ux-text-sub">· {result.latency_ms} ms</span>}
    </div>
  );
}

// ─── Field input helpers ──────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ux-text-sub mb-1">
        {label}
        {hint && <span className="ml-1 font-normal text-ux-text-sub/70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const INPUT_CLS =
  'w-full border border-ux-border rounded-md px-3 py-1.5 text-sm bg-ux-surface text-ux-text focus:outline-none focus:ring-2 focus:ring-ux-accent';
const MONO_INPUT_CLS = INPUT_CLS + ' font-mono';

// ─── Connector card ───────────────────────────────────────────────────────────

type ConnectorFormState = {
  displayName:     string;
  description:     string;
  accessMode:      ConnectorConfig['accessMode'];
  registryUrl:     string;
  registryToken:   string;
  connectorPort:   number;
  connectorToken:  string;
  sourceType:      ConnectorConfig['sourceConnection']['type'];
  sourceDbPath:    string;
  sourceApiUrl:    string;
  sourceTable:     string;
  sourceKeyField:  string;
};

function formFromConfig(c: ConnectorConfig): ConnectorFormState {
  return {
    displayName:    c.displayName,
    description:    c.description,
    accessMode:     c.accessMode,
    registryUrl:    c.gcuidIntegration.registryUrl,
    registryToken:  c.gcuidIntegration.registryAuthToken,
    connectorPort:  c.connectorServer.port,
    connectorToken: c.connectorServer.authToken,
    sourceType:     c.sourceConnection.type,
    sourceDbPath:   c.sourceConnection.dbPath  ?? '',
    sourceApiUrl:   c.sourceConnection.apiUrl  ?? '',
    sourceTable:    c.sourceConnection.primaryTable    ?? '',
    sourceKeyField: c.sourceConnection.primaryKeyField ?? '',
  };
}

function isDirty(a: ConnectorFormState, b: ConnectorFormState): boolean {
  return (Object.keys(a) as (keyof ConnectorFormState)[]).some(k => a[k] !== b[k]);
}

function formToPatch(form: ConnectorFormState): ConnectorPatch {
  return {
    displayName:  form.displayName,
    description:  form.description,
    accessMode:   form.accessMode,
    gcuidIntegration: {
      registryUrl:       form.registryUrl,
      registryAuthToken: form.registryToken,
    },
    connectorServer: {
      port:      form.connectorPort,
      authToken: form.connectorToken,
    },
    sourceConnection: {
      type:              form.sourceType,
      dbPath:            form.sourceDbPath  || undefined,
      apiUrl:            form.sourceApiUrl  || undefined,
      primaryTable:      form.sourceTable   || undefined,
      primaryKeyField:   form.sourceKeyField || undefined,
    },
  };
}

// ─── ConnectorCard ─────────────────────────────────────────────────────────────

function ConnectorCard({
  connector,
  onSaved,
}: {
  connector: ConnectorConfig;
  onSaved: () => void;
}) {
  const baseline = formFromConfig(connector);
  const [form, setForm] = useState<ConnectorFormState>(baseline);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [pingResult,   setPingResult]   = useState<ConnectorPingResult   | null>(null);
  const [healthResult, setHealthResult] = useState<ConnectorHealthResult | null>(null);
  const [pinging,   setPinging]   = useState(false);
  const [healthing, setHealthing] = useState(false);
  const [enabled, setEnabled] = useState(connector.enabled);

  const queryClient = useQueryClient();

  // Keep local form in sync if the connector data changes from outside
  useEffect(() => {
    const next = formFromConfig(connector);
    setForm(next);
    setEnabled(connector.enabled);
    setSavedOk(false);
    setSaveError(null);
  }, [connector]);

  const saveMutation = useMutation({
    mutationFn: (patch: ConnectorPatch) =>
      connectorsApi.update(connector.systemId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      setSavedOk(true);
      setSaveError(null);
      setTimeout(() => setSavedOk(false), 2500);
      onSaved();
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (nextEnabled: boolean) =>
      connectorsApi.update(connector.systemId, { enabled: nextEnabled }),
    onSuccess: (updated) => {
      setEnabled(updated.enabled);
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(formToPatch(form));
  };

  const handlePing = async () => {
    setPinging(true);
    setPingResult(null);
    try {
      const res = await connectorsApi.ping(connector.systemId);
      setPingResult(res);
    } catch (err) {
      setPingResult({ reachable: false, latency_ms: null, status_code: null, checked_at: new Date().toISOString(), base_url: '' });
    } finally {
      setPinging(false);
    }
  };

  const handleHealth = async () => {
    setHealthing(true);
    setHealthResult(null);
    try {
      const res = await connectorsApi.health(connector.systemId);
      setHealthResult(res);
    } catch (err) {
      setHealthResult({ reachable: false, status_code: null, latency_ms: null, checked_at: new Date().toISOString(), base_url: '', health: null, error: (err as Error).message });
    } finally {
      setHealthing(false);
    }
  };

  const dirty = isDirty(form, baseline) || form.displayName !== connector.displayName;

  const set = <K extends keyof ConnectorFormState>(key: K, value: ConnectorFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const typeColor: Record<ConnectorConfig['systemType'], 'blue' | 'violet'> = {
    authoritative_source: 'blue',
    department: 'violet',
  };

  return (
    <form
      onSubmit={handleSave}
      className="bg-ux-surface border border-ux-border rounded-lg overflow-hidden"
    >
      {/* ── Card header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 bg-ux-surface-alt border-b border-ux-border">
        {/* Enable/disable toggle */}
        <label className="relative inline-flex items-center cursor-pointer shrink-0" title={enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}>
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            onChange={e => {
              setEnabled(e.target.checked);
              toggleMutation.mutate(e.target.checked);
            }}
            aria-label={`${enabled ? 'Disable' : 'Enable'} ${connector.displayName}`}
          />
          <div className="w-10 h-6 bg-ux-hover peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ux-accent rounded-full peer peer-checked:bg-ux-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
        </label>

        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          <h2 className="text-base font-semibold text-ux-text truncate">{connector.displayName}</h2>
          <Badge
            label={connector.systemType === 'authoritative_source' ? 'Auth Source' : 'Department'}
            variant={typeColor[connector.systemType]}
          />
          <Badge label={ACCESS_MODE_LABELS[connector.accessMode]} variant="gray" />
          <code className="text-xs text-ux-text-sub font-mono">{connector.systemId}</code>
        </div>

        {/* Connectivity test buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handlePing}
            disabled={pinging}
            className="text-xs px-3 py-1.5 rounded-md border border-ux-border text-ux-text-sub hover:text-ux-text hover:bg-ux-hover disabled:opacity-50 transition-colors"
          >
            {pinging ? 'Pinging…' : 'Ping'}
          </button>
          <button
            type="button"
            onClick={handleHealth}
            disabled={healthing}
            className="text-xs px-3 py-1.5 rounded-md border border-ux-border text-ux-text-sub hover:text-ux-text hover:bg-ux-hover disabled:opacity-50 transition-colors"
          >
            {healthing ? 'Checking…' : 'Health'}
          </button>
        </div>
      </div>

      {/* Connectivity results */}
      {(pingResult || healthResult) && (
        <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-ux-border bg-ux-page/40">
          <PingResult result={pingResult} />
          <HealthResult result={healthResult} />
        </div>
      )}

      <div className="px-5 py-5 space-y-6">

        {/* ── Identity ───────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Identity</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Display name">
              <input
                type="text"
                value={form.displayName}
                onChange={e => set('displayName', e.target.value)}
                className={INPUT_CLS}
                title="Display name"
                required
              />
            </Field>
            <Field label="Access mode">
              <select
                value={form.accessMode}
                onChange={e => set('accessMode', e.target.value as ConnectorConfig['accessMode'])}
                className={INPUT_CLS}
                title="Access mode"
              >
                <option value="dynamic-pull">Dynamic Pull</option>
                <option value="scheduled-pull">Scheduled Pull</option>
                <option value="push-cache">Push to Cache</option>
              </select>
            </Field>
            <Field label="Description" hint="(optional)">
              <textarea
                value={form.description}
                onChange={e => set('description', e.target.value)}
                rows={2}
                title="Description"
                className={INPUT_CLS + ' resize-none'}
              />
            </Field>
          </div>
        </div>

        {/* ── Connector server ───────────────────────────────────────── */}
        <div className="space-y-3 pt-4 border-t border-ux-border">
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">
            Connector Server
            <span className="ml-2 font-normal normal-case tracking-normal text-ux-text-sub/70">
              — port and token changes require a connector restart
            </span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Port">
              <input
                type="number"
                min={1024}
                max={65535}
                value={form.connectorPort}
                onChange={e => set('connectorPort', Number(e.target.value))}
                className={INPUT_CLS}
                title="Connector server port"
                required
              />
            </Field>
            <Field label="Auth token">
              <input
                type="text"
                value={form.connectorToken}
                onChange={e => set('connectorToken', e.target.value)}
                className={MONO_INPUT_CLS}
                title="Connector server auth token"
                required
              />
            </Field>
          </div>
        </div>

        {/* ── Source connection ──────────────────────────────────────── */}
        <div className="space-y-3 pt-4 border-t border-ux-border">
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Source Connection</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Type">
              <select
                value={form.sourceType}
                onChange={e => set('sourceType', e.target.value as ConnectorConfig['sourceConnection']['type'])}
                className={INPUT_CLS}
                title="Source type"
              >
                <option value="sqlite">SQLite</option>
                <option value="rest-api">REST API</option>
                <option value="ldap">LDAP</option>
              </select>
            </Field>
            {form.sourceType === 'sqlite' ? (
              <Field label="Database path">
                <input
                  type="text"
                  value={form.sourceDbPath}
                  onChange={e => set('sourceDbPath', e.target.value)}
                  className={MONO_INPUT_CLS}
                  placeholder="./data/sources/conn-hr.db"
                />
              </Field>
            ) : (
              <Field label="API URL">
                <input
                  type="url"
                  value={form.sourceApiUrl}
                  onChange={e => set('sourceApiUrl', e.target.value)}
                  className={MONO_INPUT_CLS}
                  placeholder="http://host:port"
                />
              </Field>
            )}
            <Field label="Primary table" hint="(for SQLite / REST)">
              <input
                type="text"
                value={form.sourceTable}
                onChange={e => set('sourceTable', e.target.value)}
                className={INPUT_CLS}
                placeholder="employees"
              />
            </Field>
            <Field label="Primary key field">
              <input
                type="text"
                value={form.sourceKeyField}
                onChange={e => set('sourceKeyField', e.target.value)}
                className={INPUT_CLS}
                placeholder="employee_id"
              />
            </Field>
          </div>
        </div>

        {/* ── GCUID registry integration ─────────────────────────────── */}
        <div className="space-y-3 pt-4 border-t border-ux-border">
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">GCUID Registry Integration</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Registry URL">
              <input
                type="url"
                value={form.registryUrl}
                onChange={e => set('registryUrl', e.target.value)}
                className={MONO_INPUT_CLS}
                title="GCUID registry URL"
                placeholder="http://localhost:5182"
                required
              />
            </Field>
            <Field label="Auth token">
              <input
                type="text"
                value={form.registryToken}
                onChange={e => set('registryToken', e.target.value)}
                className={MONO_INPUT_CLS}
                title="Registry auth token"
                required
              />
            </Field>
          </div>

          {/* Attribute mappings — read-only */}
          <div>
            <p className="text-xs font-medium text-ux-text-sub mb-2">
              Attribute mappings <span className="font-normal text-ux-text-sub/70">(defined by connector developer — read-only)</span>
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
                  {Object.entries(connector.gcuidIntegration.attributeMappings).map(([attr, field]) => (
                    <tr key={attr} className="bg-ux-surface">
                      <td className="px-3 py-1.5 font-mono text-violet-700 dark:text-violet-300">{attr}</td>
                      <td className="px-3 py-1.5 font-mono text-ux-text-sub">{field}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Save row ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-3 border-t border-ux-border">
          <div className="text-xs text-ux-text-sub">
            {dirty
              ? 'You have unsaved changes.'
              : savedOk
              ? <span className="text-emerald-600 dark:text-emerald-400">✓ Saved.</span>
              : 'No changes.'}
          </div>
          <div className="flex items-center gap-3">
            {saveError && <p className="text-xs text-red-600 max-w-xs text-right">{saveError}</p>}
            {dirty && (
              <button
                type="button"
                onClick={() => setForm(formFromConfig(connector))}
                className="text-xs px-3 py-1.5 rounded-md border border-ux-border text-ux-text-sub hover:text-ux-text hover:bg-ux-hover transition-colors"
              >
                Discard
              </button>
            )}
            <button
              type="submit"
              disabled={!dirty || saveMutation.isPending}
              className="text-xs px-4 py-1.5 rounded-md bg-ux-accent text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SystemPortal() {
  const queryClient = useQueryClient();

  const { data: connectors, isLoading, error } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => connectorsApi.list(),
    staleTime: 30_000,
  });

  if (isLoading) return (
    <UXScopeWrapper scopeId="portal-system">
      <LoadingSpinner />
    </UXScopeWrapper>
  );

  if (error) return (
    <UXScopeWrapper scopeId="portal-system">
      <ErrorMessage message={(error as Error).message} />
    </UXScopeWrapper>
  );

  const list       = connectors ?? [];
  const enabled    = list.filter(c => c.enabled).length;
  const authSrc    = list.filter(c => c.systemType === 'authoritative_source').length;
  const depts      = list.filter(c => c.systemType === 'department').length;

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['connectors'] });
  };

  return (
    <UXScopeWrapper scopeId="portal-system">
      <div className="space-y-6">

        {/* ── Page header ──────────────────────────────────────────── */}
        <div>
          <h1 className="text-3xl font-bold text-ux-text">System Configuration</h1>
          <p className="mt-2 text-sm text-ux-text-sub">
            Manage connector settings: server ports, source connection details, and GCUID registry
            integration. Config files live in{' '}
            <code className="text-xs bg-ux-hover px-1.5 py-0.5 rounded">config/connectors/</code>.{' '}
            Port and auth token changes take effect after restarting the connector process.
          </p>
        </div>

        {/* ── Stats ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total connectors"  value={list.length}     />
          <StatCard label="Enabled"           value={enabled}          sub={enabled < list.length ? `${list.length - enabled} disabled` : 'all active'} />
          <StatCard label="Auth sources"      value={authSrc}          />
          <StatCard label="Departments"       value={depts}            />
        </div>

        {/* ── Connector cards ──────────────────────────────────────── */}
        {list.length === 0 ? (
          <p className="text-sm text-ux-text-sub">
            No connector configs found in <code>config/connectors/</code>.
          </p>
        ) : (
          <div className="space-y-6">
            {list.map(connector => (
              <ConnectorCard
                key={connector.systemId}
                connector={connector}
                onSaved={handleSaved}
              />
            ))}
          </div>
        )}
      </div>
    </UXScopeWrapper>
  );
}
