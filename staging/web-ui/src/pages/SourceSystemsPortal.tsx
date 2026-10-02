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
import { useSortableTable } from '../hooks/useSortableTable';
import { usePagination } from '../hooks/usePagination';
import { SortTh } from '../components/SortTh';
import { Pagination } from '../components/Pagination';
import { adminApi, connectorsApi, uxConfigApi, SourceSystem, SourceSystemInput, ACCESS_MODE_LABELS, ConnectorPingResult, ConnectorHealthResult } from '../api/client';
import { ALL_CONNECTOR_PRESETS, sortThemeEntriesByHue } from '../data/connectorThemePresets';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { useDateTime } from '../context/DateTimeFormatContext';
import { UXScopeWrapper } from '../context/UXThemeContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  authoritative_source: 'Authoritative Source',
  department: 'Department',
};

const ACCESS_MODE_COLORS: Record<string, string> = {
  'dynamic-pull':   'bg-orange-50 dark:bg-orange-800/60 text-orange-700 dark:text-orange-300',
  'scheduled-pull': 'bg-[#e6eeec] dark:bg-teal-800/60 text-teal-700 dark:text-teal-300',
  'push-cache':     'bg-[#f4f0e4] dark:bg-amber-800/60 text-amber-800 dark:text-amber-300',
};

const STALE_POLICIES = [
  { value: 'serve-stale',  label: 'Serve stale (return cached even if expired)' },
  { value: 'reject-stale', label: 'Reject stale (refuse expired entries)' },
  { value: 'refresh',      label: 'Refresh (re-fetch on expiry)' },
];

const TYPE_COLORS: Record<string, { badge: string; dot: string; ring: string; btn: string }> = {
  authoritative_source: {
    badge: 'bg-[#e7eef4] dark:bg-blue-800/60 text-blue-800 dark:text-blue-200',
    dot:   'bg-blue-500',
    ring:  'ring-[#d0dde9]',
    btn:   'bg-ux-btn hover:brightness-90 text-ux-btn-on',
  },
  department: {
    badge: 'bg-[#eeeaf3] dark:bg-purple-800/60 text-purple-800 dark:text-purple-200',
    dot:   'bg-purple-500',
    ring:  'ring-[#ddd5e7]',
    btn:   'bg-purple-600 hover:bg-purple-700 text-white',
  },
};

type ModalData = SourceSystemInput & {
  id?: number;
  // read-only connector runtime info (edit mode only)
  connector_id?: string | null;
  access_mode?: string;
  allow_inbound?: boolean;
  cache_ttl_seconds?: number;
  cache_stale_policy?: string;
  last_sync_at?: string | null;
  cache_record_count?: number;
  identifier_mode?: 'gcuid' | 'alias';
  /** Theme library preset name to apply on create (e.g. 'Auth: Glacier'). */
  selectedThemePresetName?: string;
};

function emptyForm(): ModalData {
  return {
    system_id: '',
    display_name: '',
    system_type: 'authoritative_source',
    api_url: '',
    api_secret: '',
    description: '',
    identifier_mode: 'gcuid',
    selectedThemePresetName: undefined,
  };
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, colorClass, onClick, isActive,
}: { label: string; value: number | string; sub?: string; colorClass: string; onClick?: () => void; isActive?: boolean }) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`card text-left w-full transition-all ${
          isActive
            ? 'ring-2 ring-ux-nav-label bg-ux-accent-subtle'
            : 'hover:bg-ux-accent-subtle hover:ring-1 hover:ring-ux-accent-subtle-border'
        }`}
      >
        <p className="text-sm font-medium text-ux-text-sub">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${colorClass}`}>{value}</p>
        {sub && <p className="text-ux-text-sub">{sub}</p>}
      </button>
    );
  }
  return (
    <div className="card">
      <p className="text-sm font-medium text-ux-text-sub">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${colorClass}`}>{value}</p>
      {sub && <p className="text-ux-text-sub">{sub}</p>}
    </div>
  );
}

// ─── Source System Modal ──────────────────────────────────────────────────────

function SourceSystemModal({
  initial,
  onSave,
  onClose,
  isPending,
  error,
}: {
  initial: ModalData;
  onSave: (data: ModalData) => void;
  onClose: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<ModalData>(initial);
  const isEdit = !!initial.id;
  const hasConnector = !!initial.connector_id;
  const isCached = initial.access_mode === 'push-cache' || initial.access_mode === 'scheduled-pull';
  const { fmt } = useDateTime();

  const set = (field: keyof ModalData, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }));

  // Only show presets matching the currently selected system type
  const themePresets = sortThemeEntriesByHue(ALL_CONNECTOR_PRESETS.filter(p =>
    form.system_type === 'authoritative_source' ? p.family === 'auth' : p.family === 'dept',
  ));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-ux-surface rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ux-border">
          <h2 className="text-lg font-semibold text-ux-text">
            {isEdit ? `Edit: ${initial.display_name}` : 'Register Source System'}
          </h2>
          <button onClick={onClose} className="text-ux-text-sub hover:text-gray-800 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* System ID — immutable after creation */}
          <div>
            <label className="block text-sm font-medium text-ux-text">
              System ID <span className="text-ux-text-sub">(lowercase, used as key)</span>
            </label>
            <input
              type="text"
              value={form.system_id}
              onChange={e => set('system_id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              disabled={isEdit}
              required
              placeholder="e.g. hr, ldap, payroll"
              className={`input mt-1 w-full ${isEdit ? 'bg-ux-surface-alt text-ux-text-sub cursor-not-allowed' : ''}`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ux-text">Display Name</label>
            <input
              type="text"
              value={form.display_name}
              onChange={e => set('display_name', e.target.value)}
              required
              placeholder="e.g. Payroll System"
              className="input mt-1 w-full"
            />
          </div>

          <div>
            <label htmlFor="system_type" className="block text-sm font-medium text-ux-text">Type</label>
            <select
              id="system_type"
              value={form.system_type}
              onChange={e => {
                set('system_type', e.target.value as SourceSystemInput['system_type']);
                // Reset theme selection when type changes — presets are family-specific
                set('selectedThemePresetName', undefined);
              }}
              className="input mt-1 w-full"
            >
              <option value="authoritative_source">Authoritative Source</option>
              <option value="department">Department</option>
            </select>
            <p className="mt-1 text-xs text-ux-text-sub">
              Authoritative sources own identity attributes. Departments consume and link identities.
            </p>
          </div>

          {/* ── Portal Theme (create mode only) ──────────────────────── */}
          {!isEdit && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-ux-text">Portal Theme</label>
                {form.selectedThemePresetName && (
                  <button
                    type="button"
                    onClick={() => set('selectedThemePresetName', undefined)}
                    className="text-xs text-ux-text-sub hover:text-ux-text"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-xs text-ux-text-sub mb-3">
                Colour theme for this system's portal. Can be changed later in Appearance settings.
              </p>
              <div className="grid grid-cols-10 gap-1.5">
                {themePresets.map(preset => {
                  const shortName = preset.name.replace(/^(Auth|Dept): /, '');
                  const isSelected = form.selectedThemePresetName === preset.name;
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      title={shortName}
                      onClick={() => set('selectedThemePresetName', isSelected ? undefined : preset.name)}
                      className={`relative h-8 rounded-md border-2 transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ux-accent ${
                        isSelected
                          ? 'border-white shadow-md scale-110 ring-2 ring-ux-accent ring-offset-1'
                          : 'border-transparent hover:scale-105 hover:border-white/60'
                      }`}
                      style={{ backgroundColor: preset.accentHex }}
                      aria-pressed={isSelected ? 'true' : 'false'}
                      aria-label={shortName}
                    >
                      {isSelected && (
                        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <svg className="w-3.5 h-3.5 text-white drop-shadow" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {form.selectedThemePresetName && (
                <p className="mt-2 text-xs text-ux-text-sub">
                  Selected: <span className="font-medium text-ux-text">{form.selectedThemePresetName.replace(/^(Auth|Dept): /, '')}</span>
                </p>
              )}
              {!form.selectedThemePresetName && (
                <p className="mt-2 text-xs text-ux-text-sub italic">No theme selected — default portal styling will apply.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ux-text">Connector API URL</label>
              <input
                type="url"
                value={form.api_url ?? ''}
                onChange={e => set('api_url', e.target.value)}
                placeholder="http://localhost:5186"
                className="input mt-1 w-full font-mono text-sm"
              />
              <p className="mt-1 text-xs text-ux-text-sub">Full URL of the connector HTTP API</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-ux-text">
                API Secret {isEdit && <span className="text-ux-text-sub font-normal">(leave blank to keep)</span>}
              </label>
              <input
                type="password"
                value={form.api_secret ?? ''}
                onChange={e => set('api_secret', e.target.value)}
                placeholder={isEdit ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'shared-secret-token'}
                autoComplete="new-password"
                className="input mt-1 w-full"
              />
              <p className="mt-1 text-xs text-ux-text-sub">Shared secret sent as Bearer token</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ux-text">Description</label>
            <textarea
              value={form.description ?? ''}
              onChange={e => set('description', e.target.value)}
              rows={2}
              placeholder="Brief description of this system's role in the federation"
              className="input mt-1 w-full resize-none"
            />
          </div>

          {/* ── Connector Runtime (edit only) ─────────────────────────── */}
          {isEdit && hasConnector && (
            <div className="space-y-4 pt-4 border-t border-ux-border">
              <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Connector binding</h3>

              {/* Read-only connector info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-ux-text-sub mb-1">Connector ID</p>
                  <p className="text-sm font-mono text-ux-text bg-ux-surface-alt rounded px-2 py-1">{initial.connector_id}</p>
                </div>
                <div>
                  <p className="text-xs text-ux-text-sub mb-1">Access mode</p>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      ACCESS_MODE_COLORS[initial.access_mode ?? ''] ?? 'bg-ux-hover text-ux-text-sub'
                    }`}>
                      {ACCESS_MODE_LABELS[initial.access_mode ?? ''] ?? initial.access_mode}
                    </span>
                    <span className="text-xs text-ux-text-sub">(set via Options → Connectors)</span>
                  </div>
                </div>
              </div>

              {isCached && (
                <div className="grid grid-cols-2 gap-3 text-xs text-ux-text-sub">
                  {initial.last_sync_at && (
                    <div>
                      <p className="text-ux-text-sub mb-0.5">Last synced</p>
                      <p className="text-ux-text">{fmt(initial.last_sync_at)}</p>
                    </div>
                  )}
                  {(initial.cache_record_count ?? 0) > 0 && (
                    <div>
                      <p className="text-ux-text-sub mb-0.5">Cached records</p>
                      <p className="text-ux-text">{(initial.cache_record_count ?? 0).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Editable cache settings */}
              {isCached && (
                <div className="space-y-3">
                  {initial.access_mode === 'push-cache' && (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-ux-text">Allow inbound push</p>
                        <p className="text-xs text-ux-text-sub">Accept records pushed by this system to the attribute cache</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={form.allow_inbound ?? false}
                          onChange={e => set('allow_inbound', e.target.checked)}
                        />
                        <div className="w-10 h-6 bg-ux-hover peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ux-accent rounded-full peer peer-checked:bg-ux-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
                      </label>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-ux-text">Cache TTL (seconds)</label>
                      <input
                        type="number"
                        min={0}
                        value={form.cache_ttl_seconds ?? 300}
                        onChange={e => set('cache_ttl_seconds', parseInt(e.target.value) || 0)}
                        className="input mt-1 w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-ux-text">Stale policy</label>
                      <select
                        value={form.cache_stale_policy ?? 'serve-stale'}
                        onChange={e => set('cache_stale_policy', e.target.value)}
                        title="Cache stale policy"
                        className="input mt-1 w-full bg-ux-surface"
                      >
                        {STALE_POLICIES.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-3 text-sm text-red-700 dark:text-red-300">{error}</div>
          )}

          {/* ── Identifier Mode ──────────────────────────────────────── */}
          <div className="pt-4 border-t border-ux-border">
            <p className="text-sm font-medium text-ux-text mb-2">Communication identifier</p>
            <p className="text-xs text-ux-text-sub mb-3">
              Defines whether this system uses the canonical GCUID URN or an alias when exchanging
              identifiers with the GCUID platform (both incoming calls and outgoing responses).
            </p>
            <div className="flex gap-4">
              <label className={`flex items-start gap-3 flex-1 rounded-lg border-2 p-3 cursor-pointer transition-colors ${
                (form.identifier_mode ?? 'gcuid') === 'gcuid'
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                  : 'border-ux-border hover:border-gray-300 dark:hover:border-gray-600'
              }`}>
                <input
                  type="radio"
                  name="identifier_mode"
                  value="gcuid"
                  checked={(form.identifier_mode ?? 'gcuid') === 'gcuid'}
                  onChange={() => set('identifier_mode', 'gcuid')}
                  className="mt-0.5 accent-violet-600"
                />
                <div>
                  <p className="text-sm font-semibold text-ux-text">GCUID <span className="font-mono font-normal text-xs text-ux-text-sub">urn:gcuid:…</span></p>
                  <p className="text-xs text-ux-text-sub mt-0.5">Canonical URN — the stable, globally unique identifier. Use when the system can store and pass GCUIDs directly.</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 flex-1 rounded-lg border-2 p-3 cursor-pointer transition-colors ${
                form.identifier_mode === 'alias'
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                  : 'border-ux-border hover:border-gray-300 dark:hover:border-gray-600'
              }`}>
                <input
                  type="radio"
                  name="identifier_mode"
                  value="alias"
                  checked={form.identifier_mode === 'alias'}
                  onChange={() => set('identifier_mode', 'alias')}
                  className="mt-0.5 accent-amber-600"
                />
                <div>
                  <p className="text-sm font-semibold text-ux-text">Alias <span className="font-mono font-normal text-xs text-ux-text-sub">GC-A-…</span></p>
                  <p className="text-xs text-ux-text-sub mt-0.5">Human-readable alias — resolved to GCUID on ingest and converted back on outgoing responses. Requires aliases enabled in Options.</p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-ux-border">
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isPending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Register System'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── System Row ───────────────────────────────────────────────────────────────

function SystemRow({
  system,
  onEdit,
  onDelete,
  onSelect,
  onSync,
  isSyncing,
  isSelected,
}: {
  system: SourceSystem;
  onEdit: (s: SourceSystem) => void;
  onDelete: (s: SourceSystem) => void;
  onSelect: (s: SourceSystem) => void;
  onSync?: () => void;
  isSyncing?: boolean;
  isSelected?: boolean;
}) {
  const { fmt } = useDateTime();
  const colors = TYPE_COLORS[system.system_type];
  const modeColor = ACCESS_MODE_COLORS[system.access_mode ?? ''] ?? 'bg-ux-hover text-ux-text-sub';
  const modeLabel = ACCESS_MODE_LABELS[system.access_mode ?? ''] ?? system.access_mode;
  const isCached = system.access_mode === 'push-cache' || system.access_mode === 'scheduled-pull';
  const lastSync = system.last_sync_at ? fmt(system.last_sync_at) : null;
  const identifierMode = system.identifier_mode ?? 'gcuid';

  return (
    <tr
      className={`cursor-pointer transition-colors ${isSelected ? 'bg-ux-accent-subtle' : 'hover:bg-ux-hover'}`}
      onClick={() => onSelect(system)}
    >
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full flex-shrink-0 ${system.is_active ? colors.dot : 'bg-ux-muted'}`} />
          <div>
            <div className="text-sm font-medium text-ux-text">{system.display_name}</div>
            <div className="text-ux-text-sub">{system.system_id}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex flex-col gap-1">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.badge}`}>
            {TYPE_LABELS[system.system_type]}
          </span>
          {system.access_mode && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${modeColor}`}>
              {modeLabel}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-ux-text-sub max-w-xs truncate">
        {system.description ?? '—'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-ux-text text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span>{system.identity_mappings}</span>
          {isCached && system.cache_record_count > 0 && (
            <span className="text-xs text-ux-text-sub">{system.cache_record_count.toLocaleString()} cached</span>
          )}
          {isCached && !lastSync && (
            <span className="text-xs text-amber-500">Never synced</span>
          )}
          {lastSync && (
            <span className="text-xs text-ux-text-sub" title={lastSync}>Synced {lastSync}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-ux-text-sub">
        {system.api_url ? (
          <span className="font-mono text-xs" title={system.api_url}>{system.api_url}</span>
        ) : '—'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex flex-col gap-1">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            system.is_active ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200' : 'bg-ux-hover text-ux-text-sub'
          }`}>
            {system.is_active ? 'Active' : 'Inactive'}
          </span>
          {system.is_active && system.connector_enabled === false && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-ux-badge-neutral text-ux-badge-neutral-text">
              🔌 Connector disabled
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {identifierMode === 'alias' ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#f4f0e4] dark:bg-amber-800/60 text-amber-800 dark:text-amber-300"
            title="This system uses aliases for communication">
            Alias
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#eeeaf3] dark:bg-violet-800/60 text-violet-700 dark:text-violet-200"
            title="This system uses canonical GCUID URNs for communication">
            GCUID
          </span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
        <div className="flex items-center justify-end gap-2">
          {system.access_mode === 'scheduled-pull' && typeof onSync === 'function' && (
            <button
              onClick={e => { e.stopPropagation(); onSync(); }}
              disabled={isSyncing}
              className="px-2.5 py-1 text-xs font-medium text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-700 rounded hover:bg-teal-50 dark:hover:bg-teal-900/20 dark:bg-transparent disabled:opacity-50"
            >
              {isSyncing ? 'Syncing…' : 'Sync'}
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onEdit(system); }}
            className="px-2.5 py-1 text-xs font-medium text-ux-text-sub border border-ux-border rounded hover:bg-ux-hover bg-ux-surface/50"
          >
            Edit
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(system); }}
            className="px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 dark:bg-transparent"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Source System Detail Panel ─────────────────────────────────────────────

function SourceSystemDetailPanel({
  system,
  onClose,
  onEdit,
  onDelete,
}: {
  system: SourceSystem;
  onClose: () => void;
  onEdit: (s: SourceSystem) => void;
  onDelete: (s: SourceSystem) => void;
}) {
  const queryClient = useQueryClient();
  const { fmt } = useDateTime();
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pingResult, setPingResult] = useState<ConnectorPingResult | null>(null);
  const [healthResult, setHealthResult] = useState<ConnectorHealthResult | null>(null);

  const colors = TYPE_COLORS[system.system_type];
  const modeColor = ACCESS_MODE_COLORS[system.access_mode ?? ''] ?? 'bg-ux-hover text-ux-text-sub';
  const modeLabel = ACCESS_MODE_LABELS[system.access_mode ?? ''] ?? system.access_mode;
  const isCached = system.access_mode === 'push-cache' || system.access_mode === 'scheduled-pull';
  const identifierMode = system.identifier_mode ?? 'gcuid';

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['source-systems'] });

  const toggleActiveMutation = useMutation({
    mutationFn: () => adminApi.updateSourceSystem(system.id, { is_active: !system.is_active }),
    onSuccess: invalidate,
  });

  const syncMutation = useMutation({
    mutationFn: () => connectorsApi.sync(system.connector_id!),
    onSuccess: () => { invalidate(); setSyncError(null); },
    onError: (e) => setSyncError(e instanceof Error ? e.message : 'Sync failed'),
  });

  const pingMutation = useMutation({
    mutationFn: () => connectorsApi.ping(system.connector_id!),
    onSuccess: (data) => setPingResult(data),
  });

  const healthMutation = useMutation({
    mutationFn: () => connectorsApi.health(system.connector_id!),
    onSuccess: (data) => setHealthResult(data),
  });

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col bg-ux-surface shadow-2xl border-l border-ux-border overflow-hidden">

      {/* Header */}
      <div className="flex items-start justify-between px-6 py-4 border-b border-ux-border bg-ux-surface-alt flex-shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${system.is_active ? colors.dot : 'bg-ux-muted'}`} />
            <h2 className="text-base font-semibold text-ux-text truncate">{system.display_name}</h2>
          </div>
          <p className="text-xs font-mono text-ux-text-sub mt-0.5">{system.system_id}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          className="ml-4 text-ux-text-sub hover:text-ux-text text-lg leading-none"
        >✕</button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto divide-y divide-ux-border/50">

        {/* Status & Identity */}
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${colors.badge}`}>
              {TYPE_LABELS[system.system_type]}
            </span>
            {system.access_mode && (
              <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium ${modeColor}`}>
                {modeLabel}
              </span>
            )}
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
              system.is_active
                ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200'
                : 'bg-ux-hover text-ux-text-sub'
            }`}>
              {system.is_active ? 'Active' : 'Inactive'}
            </span>
            {system.is_active && system.connector_enabled === false && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-ux-badge-neutral text-ux-badge-neutral-text">
                🔌 Connector disabled
              </span>
            )}
          </div>

          {system.description && (
            <p className="text-sm text-ux-text-sub">{system.description}</p>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <p className="text-ux-muted mb-0.5">Created</p>
              <p className="text-ux-text">{fmt(system.created_at)}</p>
            </div>
            <div>
              <p className="text-ux-muted mb-0.5">Updated</p>
              <p className="text-ux-text">{fmt(system.updated_at)}</p>
            </div>
          </div>
        </div>

        {/* Connector Configuration */}
        <div className="px-6 py-4 space-y-3">
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Connector Configuration</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <dt className="text-ux-text-sub shrink-0">Connector ID</dt>
              <dd className={`font-mono text-xs text-right ${system.connector_id ? 'text-ux-text' : 'text-ux-muted italic'}`}>
                {system.connector_id ?? 'not bound'}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-2">
              <dt className="text-ux-text-sub shrink-0">API URL</dt>
              <dd className={`text-right ${system.api_url ? 'font-mono text-xs text-ux-text break-all' : 'text-ux-muted italic text-xs'}`}>
                {system.api_url ?? 'not configured'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ux-text-sub shrink-0">API Secret</dt>
              <dd className={`text-xs font-medium ${system.api_secret_configured ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {system.api_secret_configured ? '✓ configured' : '⚠ not set'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ux-text-sub shrink-0">Identifier mode</dt>
              <dd>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  identifierMode === 'alias'
                    ? 'bg-[#f4f0e4] dark:bg-amber-800/60 text-amber-800 dark:text-amber-300'
                    : 'bg-[#eeeaf3] dark:bg-violet-800/60 text-violet-700 dark:text-violet-200'
                }`}>
                  {identifierMode === 'alias' ? 'Alias' : 'GCUID'}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        {/* Connectivity */}
        {system.connector_id && (
          <div className="px-6 py-4 space-y-4">
            <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Connectivity</h3>

            {/* Ping */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ux-text-sub">Ping</span>
                <button
                  onClick={() => pingMutation.mutate()}
                  disabled={pingMutation.isPending || !system.api_url}
                  title={!system.api_url ? 'No API URL configured' : 'Test connectivity to the connector'}
                  className="px-2.5 py-1 text-xs font-medium border border-ux-border rounded hover:bg-ux-hover bg-ux-surface text-ux-text-sub disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pingMutation.isPending ? 'Pinging…' : '⬧ Ping'}
                </button>
              </div>
              {pingResult && (
                <div className={`text-xs rounded px-3 py-2 flex items-center justify-between gap-2 ${
                  pingResult.reachable
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                }`}>
                  <span>
                    {pingResult.reachable
                      ? `✓ Reachable — ${pingResult.latency_ms}ms (HTTP ${pingResult.status_code})`
                      : '✗ Unreachable'}
                  </span>
                  <span className="text-ux-muted shrink-0">{new Date(pingResult.checked_at).toLocaleTimeString()}</span>
                </div>
              )}
            </div>

            {/* Health Report */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ux-text-sub">Health report</span>
                <button
                  onClick={() => healthMutation.mutate()}
                  disabled={healthMutation.isPending || !system.api_url}
                  title={!system.api_url ? 'No API URL configured' : 'Fetch health report from connector'}
                  className="px-2.5 py-1 text-xs font-medium border border-ux-border rounded hover:bg-ux-hover bg-ux-surface text-ux-text-sub disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {healthMutation.isPending ? 'Fetching…' : healthResult ? '↻ Refresh' : '⊕ Health'}
                </button>
              </div>
              {healthResult && (
                <div className="rounded border border-ux-border bg-ux-surface-alt text-xs overflow-hidden">
                  <div className={`px-3 py-2 border-b border-ux-border/50 flex items-center justify-between ${
                    healthResult.reachable
                      ? 'text-green-700 dark:text-green-300'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    <span className="font-medium">
                      {healthResult.reachable
                        ? `✓ Connected — ${healthResult.latency_ms}ms`
                        : `✗ ${healthResult.error ?? 'Unreachable'}`}
                    </span>
                    <span className="text-ux-muted">{new Date(healthResult.checked_at).toLocaleTimeString()}</span>
                  </div>
                  {healthResult.health && (
                    <dl className="px-3 py-2 space-y-1">
                      {(Object.entries(healthResult.health) as [string, unknown][])
                        .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
                        .map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-2">
                            <dt className="text-ux-muted capitalize">{k.replace(/_/g, ' ')}</dt>
                            <dd className="text-ux-text font-mono text-right">{String(v)}</dd>
                          </div>
                        ))}
                    </dl>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cache & Sync */}
        {isCached && (
          <div className="px-6 py-4 space-y-3">
            <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Cache &amp; Sync</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ux-text-sub">Last synced</dt>
                <dd className="text-xs">
                  {system.last_sync_at
                    ? <span className="text-ux-text">{fmt(system.last_sync_at)}</span>
                    : <span className="text-amber-500">Never synced</span>}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ux-text-sub">Cached records</dt>
                <dd className="text-ux-text">{system.cache_record_count.toLocaleString()}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ux-text-sub">Cache TTL</dt>
                <dd className="text-ux-text">{system.cache_ttl_seconds}s</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ux-text-sub">Stale policy</dt>
                <dd className="text-xs text-ux-text">{STALE_POLICIES.find(p => p.value === system.cache_stale_policy)?.label ?? system.cache_stale_policy}</dd>
              </div>
              {system.access_mode === 'push-cache' && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-ux-text-sub">Allow inbound push</dt>
                  <dd className={`text-xs font-medium ${system.allow_inbound ? 'text-green-600 dark:text-green-400' : 'text-ux-text-sub'}`}>
                    {system.allow_inbound ? 'Yes' : 'No'}
                  </dd>
                </div>
              )}
            </dl>
            {system.access_mode === 'scheduled-pull' && system.connector_id && (
              <div className="pt-1">
                {syncError && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{syncError}</p>}
                <button
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  className="w-full px-3 py-1.5 text-xs font-medium text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-700 rounded hover:bg-teal-50 dark:hover:bg-teal-900/20 disabled:opacity-50"
                >
                  {syncMutation.isPending ? 'Syncing…' : '↻ Sync Now'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Federation Footprint */}
        <div className="px-6 py-4 space-y-2">
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Federation Footprint</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ux-text-sub">Identity mappings</dt>
              <dd className={`font-semibold ${system.identity_mappings > 0 ? 'text-ux-text' : 'text-ux-muted'}`}>
                {system.identity_mappings.toLocaleString()}
              </dd>
            </div>
          </dl>
          {system.identity_mappings > 0 && (
            <p className="text-xs text-ux-text-sub">
              All linkages must be removed before this system can be deleted from the registry.
            </p>
          )}
        </div>
      </div>

      {/* Action footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-ux-border bg-ux-surface-alt space-y-2">
        {toggleActiveMutation.isError && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {toggleActiveMutation.error instanceof Error ? toggleActiveMutation.error.message : 'Failed to update status'}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(system)}
            className="flex-1 px-3 py-2 text-xs font-medium text-ux-text border border-ux-border rounded hover:bg-ux-hover bg-ux-surface"
          >
            Edit
          </button>
          <button
            onClick={() => toggleActiveMutation.mutate()}
            disabled={toggleActiveMutation.isPending}
            className={`flex-1 px-3 py-2 text-xs font-medium rounded border disabled:opacity-50 ${
              system.is_active
                ? 'text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                : 'text-green-700 dark:text-green-300 border-green-200 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900/20'
            }`}
          >
            {toggleActiveMutation.isPending ? 'Updating…' : system.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button
            onClick={() => onDelete(system)}
            disabled={system.identity_mappings > 0}
            className="flex-1 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
            title={system.identity_mappings > 0 ? 'Cannot delete: has active identity mappings' : 'Remove from federation'}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Portal ───────────────────────────────────────────────────────────────────

export default function SourceSystemsPortal() {
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; data: ModalData } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<SourceSystem | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<'authoritative_source' | 'department' | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: systems = [], isLoading, error, refetch } = useQuery({
    queryKey: ['source-systems'],
    queryFn: adminApi.listSourceSystems,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['source-systems'] });

  const createMutation = useMutation({
    mutationFn: async ({ systemData, themePresetName }: { systemData: SourceSystemInput; themePresetName?: string }) => {
      await adminApi.createSourceSystem(systemData);
      if (themePresetName) {
        const preset = ALL_CONNECTOR_PRESETS.find(p => p.name === themePresetName);
        if (preset) {
          try {
            await uxConfigApi.patchScope(`conn-${systemData.system_id}`, { theme: preset.theme, enabled: true });
          } catch {
            // Theme application is best-effort — don't fail the registration
          }
        }
      }
    },
    onSuccess: () => { invalidate(); setModal(null); setMutationError(null); },
    onError: (e) => setMutationError(e instanceof Error ? e.message : 'Create failed'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SourceSystemInput> & { is_active?: boolean } }) =>
      adminApi.updateSourceSystem(id, data),
    onSuccess: () => { invalidate(); setModal(null); setMutationError(null); },
    onError: (e) => setMutationError(e instanceof Error ? e.message : 'Update failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminApi.deleteSourceSystem(id),
    onSuccess: () => { invalidate(); setDeleteConfirm(null); setMutationError(null); setSelectedSystemId(null); },
    onError: (e) => setMutationError(e instanceof Error ? e.message : 'Delete failed'),
  });

  const selectedSystem = selectedSystemId != null ? (systems.find(s => s.id === selectedSystemId) ?? null) : null;

  const syncMutation = useMutation({
    mutationFn: (connectorId: string) => connectorsApi.sync(connectorId),
    onSettled: () => setSyncingId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['source-systems'] }),
    onError: (e) => setMutationError(e instanceof Error ? e.message : 'Sync failed'),
  });

  const handleSave = (form: ModalData) => {
    setMutationError(null);
    if (form.id) {
      const { system_id: _sid, id, connector_id: _cid, access_mode: _am,
               last_sync_at: _ls, cache_record_count: _crc, selectedThemePresetName: _tp, ...rest } = form;
      updateMutation.mutate({ id, data: rest });
    } else {
      const { connector_id: _cid, access_mode: _am, last_sync_at: _ls,
               cache_record_count: _crc, selectedThemePresetName, ...rest } = form;
      createMutation.mutate({ systemData: rest, themePresetName: selectedThemePresetName });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const authSystems  = systems.filter(s => s.system_type === 'authoritative_source');
  const deptSystems  = systems.filter(s => s.system_type === 'department');
  const typeFiltered = typeFilter === 'all' ? systems : systems.filter(s => s.system_type === typeFilter);
  const displayedSystems = searchQuery === '' ? typeFiltered : typeFiltered.filter(s =>
    `${s.display_name} ${s.system_id} ${s.description ?? ''} ${s.api_url ?? ''}`.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const { sorted: sortedSystems, sortBy: sysSortBy, sortDir: sysSortDir, handleSort: handleSysSort } = useSortableTable(displayedSystems, 'display_name');
  const { paginated: paginatedSystems, page: sysPage, setPage: setSysPage, pageSize: sysPageSize, setPageSize: setSysPageSize, totalPages: sysTotalPages, totalItems: sysTotalItems } = usePagination(sortedSystems);
  const totalMappings = systems.reduce((sum, s) => sum + s.identity_mappings, 0);

  return (
    <UXScopeWrapper scopeId="portal-gcuid">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ux-text">Sources and Departments</h1>
          <p className="mt-1 text-sm text-ux-text-sub">
            Manage the authoritative sources and departments that participate in the GCUID federation
          </p>
        </div>
        <button
          onClick={() => { setMutationError(null); setModal({ mode: 'create', data: emptyForm() }); }}
          className="btn btn-primary"
        >
          + Register System
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Authoritative Sources" value={authSystems.length} colorClass="text-blue-600"
          sub={`${authSystems.filter(s => s.is_active).length} active`}
          onClick={() => setTypeFilter('authoritative_source')}
          isActive={typeFilter === 'authoritative_source'} />
        <SummaryCard label="Departments" value={deptSystems.length} colorClass="text-purple-600"
          sub={`${deptSystems.filter(s => s.is_active).length} active`}
          onClick={() => setTypeFilter('department')}
          isActive={typeFilter === 'department'} />
        <SummaryCard label="Total Systems" value={systems.length} colorClass="text-ux-text"
          sub={`${systems.filter(s => s.is_active).length} active`}
          onClick={() => setTypeFilter('all')}
          isActive={typeFilter === 'all'} />
        <SummaryCard label="Identity Mappings" value={totalMappings} colorClass="text-amber-800 dark:text-amber-400"
          sub="across all systems"
          onClick={() => setTypeFilter('all')}
          isActive={typeFilter === 'all'} />
      </div>

      {isLoading && <LoadingSpinner message="Loading source systems…" />}
      {error && (
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load source systems'}
          onRetry={() => refetch()}
        />
      )}

      {/* Systems List Section */}
      {!isLoading && (
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <span className={`h-3 w-3 rounded-full flex-shrink-0 ${
              typeFilter === 'department' ? 'bg-purple-500' :
              typeFilter === 'all'        ? 'bg-ux-text-sub' :
              'bg-blue-500'
            }`} />
            <h2 className="text-lg font-semibold text-ux-text">
              {typeFilter === 'all' ? 'All Systems' : TYPE_LABELS[typeFilter] + 's'}
            </h2>
            <span className="text-xs text-ux-text-sub hidden sm:inline">
              {typeFilter === 'authoritative_source'
                ? 'Own identity attributes and are the source of truth for their domain'
                : typeFilter === 'department'
                ? 'Consume identities from authoritative sources and maintain department-specific records'
                : 'All registered source systems'}
            </span>
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
              <input
                type="text"
                placeholder="Search systems…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-3 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn w-44"
              />
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}
                title="Filter by system type"
                className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn"
              >
                <option value="authoritative_source">Authoritative Sources</option>
                <option value="department">Departments</option>
                <option value="all">All Systems</option>
              </select>
            </div>
          </div>

          {sortedSystems.length === 0 ? (
            <p className="text-ux-text-sub">
              {searchQuery ? 'No systems match your search' :
               typeFilter === 'authoritative_source' ? 'No authoritative sources registered'
                : typeFilter === 'department' ? 'No departments registered'
                : 'No systems registered'}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-ux-border">
                  <thead className="bg-ux-table-header">
                    <tr>
                      <SortTh col="display_name" sortBy={sysSortBy} sortDir={sysSortDir} onSort={handleSysSort} activeClass="text-ux-nav-label">System</SortTh>
                      <SortTh col="system_type" sortBy={sysSortBy} sortDir={sysSortDir} onSort={handleSysSort} activeClass="text-ux-nav-label">Type / Mode</SortTh>
                      <SortTh col="description" sortBy={sysSortBy} sortDir={sysSortDir} onSort={handleSysSort} activeClass="text-ux-nav-label">Description</SortTh>
                      <SortTh col="identity_mappings" sortBy={sysSortBy} sortDir={sysSortDir} onSort={handleSysSort} activeClass="text-ux-nav-label" align="right">Identities / Cache</SortTh>
                      <SortTh col="api_url" sortBy={sysSortBy} sortDir={sysSortDir} onSort={handleSysSort} activeClass="text-ux-nav-label">Endpoint</SortTh>
                      <SortTh col="is_active" sortBy={sysSortBy} sortDir={sysSortDir} onSort={handleSysSort} activeClass="text-ux-nav-label">Status</SortTh>
                      <th className="px-4 py-3 text-left text-xs font-medium text-ux-text-sub uppercase tracking-wider">Identifier</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-ux-text-sub uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-ux-surface divide-y divide-ux-border/50">
                    {paginatedSystems.map(s => (
                      <SystemRow key={s.id} system={s}
                        onEdit={sys => { setMutationError(null); setModal({ mode: 'edit', data: { id: sys.id, system_id: sys.system_id, display_name: sys.display_name, system_type: sys.system_type, api_url: sys.api_url ?? '', api_secret: '', description: sys.description ?? '', connector_id: sys.connector_id, access_mode: sys.access_mode, allow_inbound: sys.allow_inbound, cache_ttl_seconds: sys.cache_ttl_seconds, cache_stale_policy: sys.cache_stale_policy, last_sync_at: sys.last_sync_at, cache_record_count: sys.cache_record_count, identifier_mode: sys.identifier_mode } }); }}
                        onDelete={sys => { setMutationError(null); setDeleteConfirm(sys); }}
                        onSelect={sys => setSelectedSystemId(prev => prev === sys.id ? null : sys.id)}
                        isSelected={selectedSystemId === s.id}
                        onSync={s.access_mode === 'scheduled-pull' && s.connector_id ? () => { setSyncingId(s.id); syncMutation.mutate(s.connector_id!); } : undefined}
                        isSyncing={syncingId === s.id}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={sysPage} onPageChange={setSysPage}
                pageSize={sysPageSize} onPageSizeChange={setSysPageSize}
                totalPages={sysTotalPages} totalItems={sysTotalItems}
                accentClass="text-ux-nav-label"
              />
            </>
          )}
        </div>
      )}

      {/* Federation Notes */}
      {!isLoading && systems.length > 0 && (
        <div className="card bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-3">
            <span className="text-amber-500 text-lg leading-tight">ℹ</span>
            <div className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
              <p className="font-medium">Federation Architecture Notes</p>
              <p>Adding a new system here registers it in the GCUID registry. To fully participate in CAES attribute exchange, attribute mappings must also be configured on the <strong>CAES</strong> tab.</p>
              <p>A source system with active identity mappings cannot be deleted — unlink all identities first via the GCUID Registry.</p>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modal && (
        <SourceSystemModal
          initial={modal.data}
          onSave={handleSave}
          onClose={() => { setModal(null); setMutationError(null); }}
          isPending={isPending}
          error={mutationError}
        />
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-ux-surface rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-ux-text mb-2">Delete Source System</h3>
            <p className="text-sm text-ux-text-sub mb-1">
              Remove <strong>{deleteConfirm.display_name}</strong> from the GCUID federation?
            </p>
            {deleteConfirm.identity_mappings > 0 && (
              <p className="text-sm text-red-600 mt-2">
                This system has <strong>{deleteConfirm.identity_mappings}</strong> active identity mapping(s) and cannot be deleted until they are removed.
              </p>
            )}
            {mutationError && (
              <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-2 mt-2">{mutationError}</p>
            )}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => { setDeleteConfirm(null); setMutationError(null); }} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending || deleteConfirm.identity_mappings > 0}
                className="btn bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {selectedSystem && (
      <SourceSystemDetailPanel
        system={selectedSystem}
        onClose={() => setSelectedSystemId(null)}
        onEdit={sys => { setMutationError(null); setModal({ mode: 'edit', data: { id: sys.id, system_id: sys.system_id, display_name: sys.display_name, system_type: sys.system_type, api_url: sys.api_url ?? '', api_secret: '', description: sys.description ?? '', connector_id: sys.connector_id, access_mode: sys.access_mode, allow_inbound: sys.allow_inbound, cache_ttl_seconds: sys.cache_ttl_seconds, cache_stale_policy: sys.cache_stale_policy, last_sync_at: sys.last_sync_at, cache_record_count: sys.cache_record_count, identifier_mode: sys.identifier_mode } }); }}
        onDelete={sys => { setMutationError(null); setDeleteConfirm(sys); }}
      />
    )}
    </UXScopeWrapper>
  );
}
