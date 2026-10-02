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
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { caesApi, systemApi, AttributeMapping, AttributeMappingInput, IdentityMatchResult, MatchStrategy, SourceMatchConfig } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { UXScopeWrapper } from '../context/UXThemeContext';

// --- Mapping form -------------------------------------------------------------

const ALL_OPERATIONS = ['read', 'write', 'update', 'delete'] as const;

const emptyForm = (): AttributeMappingInput => ({
  standardAttribute: '',
  sourceSystem: '',
  sourceField: '',
  sourceTable: '',
  keyField: '',
  is_authoritative: false,
  operations: ['read'],
  searchable: false,
  indexed: false,
});

function mappingToForm(m: AttributeMapping): AttributeMappingInput {
  return {
    standardAttribute: m.standardAttribute,
    sourceSystem: m.sourceSystem,
    sourceField: m.sourceField,
    sourceTable: m.sourceTable,
    keyField: m.keyField,
    is_authoritative: m.is_authoritative,
    operations: m.operations,
    transformations: m.transformations,
    searchable: m.searchable,
    indexed: m.indexed,
  };
}

interface MappingModalProps {
  mode: 'create' | 'edit';
  initial: AttributeMappingInput;
  knownAttributes: string[];
  knownSourceSystems: string[];
  onSave: (data: AttributeMappingInput) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    connected:   'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    available:   'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    degraded:    'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    unavailable: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    disabled:    'bg-ux-surface-alt border border-ux-border text-ux-text-muted',
    error:       'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    disconnected:'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-ux-surface-alt text-ux-text-sub'}`}>
      {status}
    </span>
  );
}

// ─── Health detail panel ───────────────────────────────────────────────────────

type HealthSelection =
  | { kind: 'registry' }
  | { kind: 'api' }
  | { kind: 'connector'; connectorId: string };

type HealthSnapshot = {
  timestamp: string;
  attribute_schema_version: string;
  attribute_mappings_loaded: number;
  services: { registry: { status: string; identity_count: number } };
  connectors: Array<{ connector_id: string; system_id: string; display_name: string; enabled: boolean; status: string }>;
};

function HealthDetailPanel({ selection, health, onClose }: {
  selection: HealthSelection;
  health: HealthSnapshot;
  onClose: () => void;
}) {
  const reg = health.services.registry;
  const connector = selection.kind === 'connector'
    ? health.connectors.find(c => c.connector_id === selection.connectorId) ?? null
    : null;

  const title =
    selection.kind === 'registry' ? 'Identity Registry' :
    selection.kind === 'api'      ? 'GCUID API Server' :
    connector?.display_name       ?? 'Connector';

  const subtitle =
    selection.kind === 'registry' ? 'SQLite (better-sqlite3) — local data store' :
    selection.kind === 'api'      ? 'Express.js + tsx — co-located with registry' :
    connector?.connector_id       ?? '';

  const pillStatus =
    selection.kind === 'registry' ? (reg.status === 'connected' ? 'connected' : 'error') :
    selection.kind === 'api'      ? (reg.status === 'connected' ? 'connected' : 'error') :
    connector?.status             ?? 'unavailable';

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black bg-opacity-30" onClick={onClose} />
      <div className="w-full max-w-xl bg-ux-surface shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-ux-border bg-ux-surface-alt flex-shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ux-text-sub mb-1 uppercase tracking-wide">System Health</p>
            <h2 className="text-lg font-semibold text-ux-text">{title}</h2>
            <p className="text-xs text-ux-text-sub font-mono mt-0.5 break-all">{subtitle}</p>
          </div>
          <button onClick={onClose} className="ml-4 text-ux-text-sub hover:text-ux-text">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Status card */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ux-text-sub mb-3">Current Status</p>
            <div className="card p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ux-text">
                  {selection.kind === 'registry' ? 'Registry connection' :
                   selection.kind === 'api'       ? 'API availability' :
                                                    'Connector reachability'}
                </p>
                <p className="text-xs text-ux-text-sub mt-0.5">
                  Last checked {new Date(health.timestamp).toLocaleTimeString()}
                </p>
              </div>
              <StatusPill status={pillStatus} />
            </div>
          </div>

          {/* Registry details */}
          {selection.kind === 'registry' && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ux-text-sub mb-3">Registry Details</p>
              <div className="card divide-y divide-ux-border">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-ux-text-sub">Identity count</span>
                  <span className="text-sm font-semibold text-ux-text">{reg.identity_count.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-ux-text-sub">Attribute schema version</span>
                  <span className="text-sm font-mono text-ux-text">{health.attribute_schema_version}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-ux-text-sub">Attribute mappings loaded</span>
                  <span className="text-sm font-semibold text-ux-text">{health.attribute_mappings_loaded}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-ux-text-sub">Storage engine</span>
                  <span className="text-sm text-ux-text">SQLite (better-sqlite3)</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-ux-text-sub">Mode</span>
                  <span className="text-sm text-ux-text">Co-located (EFS / local file)</span>
                </div>
              </div>
            </div>
          )}

          {/* API details */}
          {selection.kind === 'api' && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ux-text-sub mb-3">API Details</p>
              <div className="card divide-y divide-ux-border">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-ux-text-sub">Runtime</span>
                  <span className="text-sm text-ux-text">Express.js (tsx)</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-ux-text-sub">Deployment</span>
                  <span className="text-sm text-ux-text">Co-located with registry</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-ux-text-sub">Health dependency</span>
                  <span className="text-sm text-ux-text">Identity Registry</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-ux-text-sub">Routes registered</span>
                  <span className="text-sm text-ux-text">Admin · CAES · Requests</span>
                </div>
              </div>
            </div>
          )}

          {/* Connector details */}
          {selection.kind === 'connector' && connector && (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ux-text-sub mb-3">Connector Details</p>
                <div className="card divide-y divide-ux-border">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-ux-text-sub">Display name</span>
                    <span className="text-sm font-medium text-ux-text">{connector.display_name}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-ux-text-sub">Connector ID</span>
                    <span className="text-sm font-mono text-ux-text">{connector.connector_id}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-ux-text-sub">System ID</span>
                    <span className="text-sm font-mono text-ux-text">{connector.system_id}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-ux-text-sub">Enabled</span>
                    <span className={`text-sm font-medium ${connector.enabled ? 'text-green-600 dark:text-green-400' : 'text-ux-text-muted'}`}>
                      {connector.enabled ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ux-text-sub mb-3">Schema Coverage</p>
                <div className="card p-4">
                  <p className="text-sm text-ux-text-sub">
                    {health.attribute_mappings_loaded} total attribute mapping{health.attribute_mappings_loaded !== 1 ? 's' : ''} are
                    loaded across all connectors in this registry.
                  </p>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

function MappingModal({ mode, initial, knownAttributes, knownSourceSystems, onSave, onCancel, saving, error }: MappingModalProps) {
  const [form, setForm] = useState<AttributeMappingInput>(initial);

  const set = <K extends keyof AttributeMappingInput>(key: K, val: AttributeMappingInput[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  const toggleOp = (op: typeof ALL_OPERATIONS[number]) => {
    const ops = form.operations as string[];
    set('operations', ops.includes(op) ? ops.filter(o => o !== op) as any : [...ops, op] as any);
  };

  const transRead = form.transformations?.read ?? '';
  const transWrite = form.transformations?.write ?? '';
  const setTrans = (field: 'read' | 'write', val: string) => {
    set('transformations', {
      ...form.transformations,
      [field]: val || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="w-full max-w-xl bg-ux-surface rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ux-border">
          <h2 className="text-base font-semibold text-ux-text">
            {mode === 'create' ? 'Add Attribute Mapping' : 'Edit Attribute Mapping'}
          </h2>
          <button onClick={onCancel} className="text-ux-text-sub">×</button>
        </div>

        <div className="overflow-y-auto p-6 space-y-4">
          {/* Standard Attribute */}
          <div>
            <label className="block text-xs font-medium text-ux-text mb-1">CAES Attribute *</label>
            <input
              list="attr-suggestions"
              value={form.standardAttribute}
              onChange={e => set('standardAttribute', e.target.value)}
              placeholder="e.g. person.name.given"
              className="w-full px-3 py-2 border border-ux-border rounded-md text-sm font-mono text-ux-text bg-ux-surface focus:ring-ux-accent focus:border-ux-accent"
            />
            <datalist id="attr-suggestions">
              {knownAttributes.map(a => <option key={a} value={a} />)}
            </datalist>
            <p className="text-ux-text-sub">
              Pick a <span className="text-ux-nav-label font-medium">Standard</span> attribute from the CAES schema (e.g.{' '}
              <code className="font-mono">person.name.given</code>), select an existing{' '}
              <span className="text-teal-600 dark:text-teal-400 font-medium">Extended</span> attribute, or type a new dot-separated name to create one.
            </p>
          </div>

          {/* Source System + Is Authoritative */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Source System *</label>
              <input
                list="source-suggestions"
                value={form.sourceSystem}
                onChange={e => set('sourceSystem', e.target.value)}
                placeholder="e.g. hr"
                className="w-full px-3 py-2 border border-ux-border rounded-md text-sm text-ux-text bg-ux-surface focus:ring-ux-accent focus:border-ux-accent"
              />
              <datalist id="source-suggestions">
                {knownSourceSystems.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="flex flex-col justify-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.is_authoritative}
                  onChange={e => set('is_authoritative', e.target.checked)}
                  className="rounded border-ux-border text-amber-500 focus:ring-amber-400"
                />
                <span className="text-sm font-medium text-ux-text">Authoritative source</span>
              </label>
              <p className="text-ux-text-sub">This source takes precedence for this attribute</p>
            </div>
          </div>

          {/* Table + Field */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Source Table *</label>
              <input
                value={form.sourceTable}
                onChange={e => set('sourceTable', e.target.value)}
                placeholder="e.g. employees"
                className="w-full px-3 py-2 border border-ux-border rounded-md text-sm font-mono text-ux-text bg-ux-surface focus:ring-ux-accent focus:border-ux-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Source Field *</label>
              <input
                value={form.sourceField}
                onChange={e => set('sourceField', e.target.value)}
                placeholder="e.g. first_name"
                className="w-full px-3 py-2 border border-ux-border rounded-md text-sm font-mono text-ux-text bg-ux-surface focus:ring-ux-accent focus:border-ux-accent"
              />
            </div>
          </div>

          {/* Key Field */}
          <div>
            <label className="block text-xs font-medium text-ux-text mb-1">Key Field *</label>
            <input
              value={form.keyField}
              onChange={e => set('keyField', e.target.value)}
              placeholder="e.g. employee_id"
              className="w-full px-3 py-2 border border-ux-border rounded-md text-sm font-mono text-ux-text bg-ux-surface focus:ring-ux-accent focus:border-ux-accent"
            />
            <p className="text-ux-text-sub">Column used to look up a record by source_id from source_mappings</p>
          </div>

          {/* Operations */}
          <div>
            <label className="block text-xs font-medium text-ux-text mb-1">Supported Operations</label>
            <div className="flex gap-3">
              {ALL_OPERATIONS.map(op => (
                <label key={op} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={(form.operations as string[]).includes(op)}
                    onChange={() => toggleOp(op)}
                    className="rounded border-ux-border text-ux-accent"
                  />
                  <span className="text-sm text-ux-text capitalize">{op}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Searchable + Indexed */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.searchable}
                onChange={e => set('searchable', e.target.checked)}
                className="rounded border-ux-border text-ux-accent"
              />
              <span className="text-sm text-ux-text">Searchable</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.indexed}
                onChange={e => set('indexed', e.target.checked)}
                className="rounded border-ux-border text-ux-accent"
              />
              <span className="text-sm text-ux-text">Indexed</span>
            </label>
          </div>

          {/* Transformations */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Transform (read) <span className="text-ux-text-sub">optional</span></label>
              <input
                value={transRead}
                onChange={e => setTrans('read', e.target.value)}
                placeholder="e.g. JSON.parse()"
                className="w-full px-3 py-2 border border-ux-border rounded-md text-sm font-mono text-ux-text bg-ux-surface focus:ring-ux-accent focus:border-ux-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Transform (write) <span className="text-ux-text-sub">optional</span></label>
              <input
                value={transWrite}
                onChange={e => setTrans('write', e.target.value)}
                placeholder="e.g. boolean to int"
                className="w-full px-3 py-2 border border-ux-border rounded-md text-sm font-mono text-ux-text bg-ux-surface focus:ring-ux-accent focus:border-ux-accent"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded px-3 py-2">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-ux-border bg-ux-surface-alt">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-ux-text border border-ux-border rounded-md hover:bg-ux-hover bg-ux-surface">
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.standardAttribute || !form.sourceSystem || !form.sourceField || !form.sourceTable || !form.keyField}
            className="px-4 py-2 text-sm font-medium bg-ux-btn text-ux-btn-on rounded-md hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : mode === 'create' ? 'Add Mapping' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CAESPortal() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'attributes' | 'resolve' | 'match' | 'match-config' | 'stats' | 'health'>('attributes');
  const [selectedHealthItem, setSelectedHealthItem] = useState<HealthSelection | null>(null);
  const [resolveRawOpen, setResolveRawOpen] = useState(false);
  const [selectedGCUID, setSelectedGCUID] = useState('');
  const [attributesToResolve, setAttributesToResolve] = useState<string[]>([]);
  const [resolutionResult, setResolutionResult] = useState<any>(null);
  const [strategiesCollapsed, setStrategiesCollapsed] = useState(true);

  // Collapse state — all attribute cards default to collapsed once data arrives
  const [collapsedAttrs, setCollapsedAttrs] = useState<Set<string>>(new Set());
  const toggleAttrCard = (name: string) => setCollapsedAttrs(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s; });

  // Search / filter state (declared here; derived values computed after queries below)
  const [attrSearch, setAttrSearch] = useState('');
  const [attrCollapseSeeded, setAttrCollapseSeeded] = useState(false);
  // Active quick-filters: 'standard' | 'mapped' | 'multi-source' | <sourceSystemName>
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const toggleFilter = (key: string) =>
    setActiveFilters(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  // Identity match state
  const [matchAttributes, setMatchAttributes] = useState<Record<string, string>>({});
  const [matchLinkGCUID, setMatchLinkGCUID] = useState('');
  const [matchLinkRequestedBy, setMatchLinkRequestedBy] = useState('');
  const [matchResult, setMatchResult] = useState<IdentityMatchResult | null>(null);
  const [matchLinkResult, setMatchLinkResult] = useState<any>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  // Match strategy config editor state
  // Local editable copies — keyed by sourceSystem
  const [mcEdits, setMcEdits] = useState<Record<string, SourceMatchConfig & { connectorId: string }>>({});
  const [mcDirty, setMcDirty] = useState<Set<string>>(new Set());
  const [mcSaving, setMcSaving] = useState<Set<string>>(new Set());
  const [mcError, setMcError] = useState<Record<string, string>>({});
  // Collapsed state — tracks which source panels are expanded (empty = all collapsed by default)
  const [mcExpanded, setMcExpanded] = useState<Set<string>>(new Set());
  const toggleMcExpanded = (src: string) =>
    setMcExpanded(prev => { const s = new Set(prev); s.has(src) ? s.delete(src) : s.add(src); return s; });
  // New-source form
  const [addSrcOpen, setAddSrcOpen] = useState(false);
  const [addSrcForm, setAddSrcForm] = useState({ sourceSystem: '', connectorId: '', sourceTable: '', keyField: '' });
  const [addSrcError, setAddSrcError] = useState('');

  // Mapping CRUD state
  const [mappingModal, setMappingModal] = useState<
    | { mode: 'create'; initial: AttributeMappingInput }
    | { mode: 'edit'; id: number; initial: AttributeMappingInput }
    | null
  >(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AttributeMapping | null>(null);
  const [clearAuthConfirm, setClearAuthConfirm] = useState<number | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const invalidateMappings = () => {
    qc.invalidateQueries({ queryKey: ['caes-attribute-mappings'] });
    qc.invalidateQueries({ queryKey: ['caes-stats'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: AttributeMappingInput) => caesApi.createMapping(data),
    onSuccess: () => { invalidateMappings(); setMappingModal(null); setMutationError(null); },
    onError: (e: Error) => setMutationError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<AttributeMappingInput> }) => caesApi.updateMapping(id, data),
    onSuccess: () => { invalidateMappings(); setMappingModal(null); setMutationError(null); },
    onError: (e: Error) => setMutationError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => caesApi.deleteMapping(id),
    onSuccess: () => { invalidateMappings(); setDeleteConfirm(null); },
    onError: (e: Error) => setMutationError(e.message),
  });

  const setAuthoritativeMutation = useMutation({
    mutationFn: (id: number) => caesApi.setMappingAuthoritative(id),
    onSuccess: () => invalidateMappings(),
    onError: (e: Error) => setMutationError(e.message),
  });

  const clearAuthoritativeMutation = useMutation({
    mutationFn: (id: number) => caesApi.updateMapping(id, { is_authoritative: false }),
    onSuccess: () => invalidateMappings(),
    onError: (e: Error) => setMutationError(e.message),
  });

  // Fetch schema
  const { data: schema, isLoading: schemaLoading, error: schemaError } = useQuery({
    queryKey: ['caes-schema'],
    queryFn: caesApi.getSchema,
  });

  // Fetch attribute mappings
  const { data: attributeMappings, isLoading: mappingsLoading, error: mappingsError } = useQuery({
    queryKey: ['caes-attribute-mappings'],
    queryFn: caesApi.getAttributeMappings,
  });

  // Fetch stats
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['caes-stats'],
    queryFn: caesApi.getStats,
  });

  // Fetch health
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['caes-health'],
    queryFn: caesApi.getHealth,
    refetchInterval: 30000,
  });

  // Fetch match configs (strategies per source)
  const { data: matchConfigs } = useQuery({
    queryKey: ['caes-match-configs'],
    queryFn: caesApi.getMatchConfigs,
  });

  // Fetch system versions for CAES schema version
  const { data: versionsData } = useQuery({
    queryKey: ['system-versions'],
    queryFn: systemApi.getVersions,
    staleTime: 5 * 60 * 1000,
  });

  // Seed attribute collapsed state once on first data load (all collapsed by default)
  useEffect(() => {
    if ((schema || attributeMappings) && !attrCollapseSeeded) {
      const allKeys = new Set([
        ...(schema ? Object.keys(schema.attributes) : []),
        ...(attributeMappings ? Object.keys(attributeMappings.grouped_by_attribute) : []),
      ]);
      setCollapsedAttrs(allKeys);
      setAttrCollapseSeeded(true);
    }
  }, [schema, attributeMappings, attrCollapseSeeded]);

  // Seed mcEdits from loaded matchConfigs (don't overwrite sources the user is actively editing)
  useEffect(() => {
    if (!matchConfigs) return;
    setMcEdits(prev => {
      const next = { ...prev };
      for (const c of matchConfigs.configs) {
        if (!mcDirty.has(c.sourceSystem)) {
          next[c.sourceSystem] = { ...c, connectorId: c.connectorId ?? `conn-${c.sourceSystem}` };
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchConfigs]);

  // Union of schema attributes + mapped-only extended attributes, filtered by search + quick-filters
  const filteredAttrEntries = useMemo(() => {
    const allKeys = new Set([
      ...(schema ? Object.keys(schema.attributes) : []),
      ...(attributeMappings ? Object.keys(attributeMappings.grouped_by_attribute) : []),
    ]);
    const q = attrSearch.trim().toLowerCase();
    return Array.from(allKeys).filter(attr => {
      const schemaAttr = schema?.attributes[attr];
      const mappings = attributeMappings?.grouped_by_attribute[attr] ?? [];

      // Text search
      if (q && !(
        attr.toLowerCase().includes(q) ||
        schemaAttr?.description.toLowerCase().includes(q) ||
        schemaAttr?.dataType.toLowerCase().includes(q) ||
        mappings.some(m =>
          m.sourceSystem.toLowerCase().includes(q) ||
          m.sourceField.toLowerCase().includes(q) ||
          m.sourceTable.toLowerCase().includes(q)
        )
      )) return false;

      // Quick-filters (AND)
      if (activeFilters.has('standard') && !schemaAttr) return false;
      if (activeFilters.has('mapped') && mappings.length === 0) return false;
      if (activeFilters.has('multi-source') && mappings.length < 2) return false;
      // Source system filters — keep if attr has a mapping for ANY of the active source filters
      const sourcesInFilter = Array.from(activeFilters).filter(
        f => f !== 'standard' && f !== 'mapped' && f !== 'multi-source'
      );
      if (sourcesInFilter.length > 0 &&
          !sourcesInFilter.some(src => mappings.some(m => m.sourceSystem === src)))
        return false;

      return true;
    });
  }, [schema, attributeMappings, attrSearch, activeFilters]);

  const handleMatch = async () => {
    const provided = Object.fromEntries(
      Object.entries(matchAttributes).filter(([, v]) => v.trim() !== '')
    );
    if (Object.keys(provided).length === 0) return;
    setMatchLoading(true);
    setMatchError(null);
    setMatchResult(null);
    setMatchLinkResult(null);
    try {
      const result = await caesApi.matchIdentity(provided);
      setMatchResult(result);
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : 'Match failed');
    } finally {
      setMatchLoading(false);
    }
  };

  const handleMatchAndLink = async () => {
    if (!matchLinkGCUID.trim()) return;
    const provided = Object.fromEntries(
      Object.entries(matchAttributes).filter(([, v]) => v.trim() !== '')
    );
    if (Object.keys(provided).length === 0) return;
    setMatchLoading(true);
    setMatchError(null);
    setMatchLinkResult(null);
    try {
      const result = await caesApi.matchAndLink(matchLinkGCUID, provided, matchLinkRequestedBy || undefined);
      setMatchLinkResult(result);
      setMatchResult(null);
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : 'Match-and-link failed');
    } finally {
      setMatchLoading(false);
    }
  };

  const handleResolveAttributes = async () => {
    if (!selectedGCUID || attributesToResolve.length === 0) {
      return;
    }

    try {
      const result = await caesApi.resolveAttributes(selectedGCUID, attributesToResolve);
      setResolutionResult(result);
    } catch (error) {
      console.error('Error resolving attributes:', error);
      setResolutionResult({ error: error instanceof Error ? error.message : 'Resolution failed' });
    }
  };

  const toggleAttribute = (attr: string) => {
    setAttributesToResolve(prev =>
      prev.includes(attr) ? prev.filter(a => a !== attr) : [...prev, attr]
    );
  };

  return (
    <UXScopeWrapper scopeId="portal-gcuid">
    <>
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-ux-text">CAES Portal</h1>
            <p className="mt-2 text-sm text-ux-text-sub">
              Common Attribute Exchange Service - Standardized attribute federation across authoritative sources
            </p>
          </div>
          {health && (
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${
                health.status === 'operational' ? 'bg-green-500' :
                health.status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'
              }`} />
              <span className="text-sm font-medium text-ux-text capitalize">
                {health.status}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="card p-0">
        <div className="border-b border-ux-border">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('attributes')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'attributes'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Attributes &amp; Mappings
            </button>
            <button
              onClick={() => setActiveTab('resolve')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'resolve'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Resolve Attributes
            </button>
            <button
              onClick={() => setActiveTab('match')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'match'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Identity Match
            </button>
            <button
              onClick={() => setActiveTab('match-config')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'match-config'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Match Strategies
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'stats'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Statistics
            </button>
            <button
              onClick={() => setActiveTab('health')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'health'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              System Health
            </button>
          </nav>
        </div>

        <div className="p-6">
          {/* Attributes & Mappings Tab */}
          {activeTab === 'attributes' && (
            <>
              {/* Loading / error states */}
              {(schemaLoading || mappingsLoading) && <LoadingSpinner message="Loading attributes..." />}
              {schemaError && <ErrorMessage message={schemaError instanceof Error ? schemaError.message : 'Failed to load schema'} />}
              {mappingsError && <ErrorMessage message={mappingsError instanceof Error ? mappingsError.message : 'Failed to load mappings'} />}

              {(schema || attributeMappings) && (
                <div className="space-y-6">
                  {/* About CAES banner */}
                  <div className="bg-ux-accent-subtle border border-ux-accent-subtle-border rounded-lg p-6">
                    <h3 className="text-lg font-medium text-ux-text mb-2">About CAES</h3>
                    <p className="text-sm text-ux-text mb-4">
                      The Common Attribute Exchange Service provides standardized naming conventions for
                      person attributes and federates attribute retrieval across authoritative sources.
                      When a department requests an attribute for a GCUID, CAES resolves it from the
                      appropriate authoritative source automatically.
                    </p>
                    <div className="grid grid-cols-4 gap-4 mt-4">
                      {/* Schema Attributes — filters to standard attrs only */}
                      <button
                        type="button"
                        onClick={() => toggleFilter('standard')}
                        className={`rounded p-3 text-left transition-all ${
                          activeFilters.has('standard')
                            ? 'bg-ux-btn-primary-bg ring-2 ring-ux-accent ring-offset-1'
                            : 'bg-ux-surface hover:bg-ux-accent-subtle ring-1 ring-ux-accent-subtle-border'
                        }`}
                      >
                        <div className={`text-sm ${activeFilters.has('standard') ? 'text-ux-btn-primary-text' : 'text-ux-text-sub'}`}>Schema Attributes</div>
                        <div className={`text-2xl font-bold ${activeFilters.has('standard') ? 'text-ux-btn-primary-text' : 'text-ux-nav-label'}`}>{schema?.totalAttributes ?? '—'}</div>
                        {activeFilters.has('standard') && <div className="text-xs text-ux-btn-primary-text mt-0.5">✓ filtering</div>}
                      </button>
                      {/* Total Mappings — clears all active filters */}
                      <button
                        type="button"
                        onClick={() => setActiveFilters(new Set())}
                        className="bg-ux-surface hover:bg-ux-accent-subtle rounded p-3 text-left transition-all ring-1 ring-ux-accent-subtle-border"
                      >
                        <div className="text-sm text-ux-text-sub">Total Attribute Mappings</div>
                        <div className="text-2xl font-bold text-ux-nav-label">{attributeMappings?.total_mappings ?? '—'}</div>
                      </button>
                      {/* Source Systems — individual clickable chips */}
                      <div className="bg-ux-surface rounded p-3 ring-1 ring-ux-accent-subtle-border">
                        <div className="text-sm text-ux-text-sub mb-1.5">Source Systems</div>
                        <div className="flex flex-wrap gap-1">
                          {(attributeMappings?.source_systems ?? []).map(src => (
                            <button
                              key={src}
                              type="button"
                              onClick={() => toggleFilter(src)}
                              className={`text-xs font-semibold uppercase px-2 py-0.5 rounded transition-all ${
                                activeFilters.has(src)
                                  ? 'bg-ux-btn-primary-bg text-ux-btn-primary-text ring-1 ring-ux-accent'
                                  : 'bg-ux-accent-subtle text-ux-nav-label hover:bg-ux-hover'
                              }`}
                            >
                              {src}
                            </button>
                          ))}
                          {!attributeMappings && <span className="text-2xl font-bold text-ux-nav-label">—</span>}
                        </div>
                      </div>
                      {/* Multi-Source — filters to attrs with >1 source */}
                      <button
                        type="button"
                        onClick={() => toggleFilter('multi-source')}
                        className={`rounded p-3 text-left transition-all ${
                          activeFilters.has('multi-source')
                            ? 'bg-ux-btn-primary-bg ring-2 ring-ux-accent ring-offset-1'
                            : 'bg-ux-surface hover:bg-ux-accent-subtle ring-1 ring-ux-accent-subtle-border'
                        }`}
                      >
                        <div className={`text-sm ${activeFilters.has('multi-source') ? 'text-ux-btn-primary-text' : 'text-ux-text-sub'}`}>Multi-Source</div>
                        <div className={`text-2xl font-bold ${activeFilters.has('multi-source') ? 'text-ux-btn-primary-text' : 'text-ux-nav-label'}`}>
                          {attributeMappings ? Object.values(attributeMappings.grouped_by_attribute).filter(m => m.length > 1).length : '—'}
                        </div>
                        {activeFilters.has('multi-source') && <div className="text-xs text-ux-btn-primary-text mt-0.5">✓ filtering</div>}
                      </button>
                    </div>
                    {/* Active filter indicator */}
                    {activeFilters.size > 0 && (
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-ux-text-sub">Active filters:</span>
                        {Array.from(activeFilters).map(f => (
                          <span key={f} className="inline-flex items-center gap-1 text-xs bg-ux-accent-subtle text-ux-nav-label px-2 py-0.5 rounded-full">
                            {f}
                            <button type="button" onClick={() => toggleFilter(f)} className="ml-0.5 text-ux-nav-label hover:text-ux-text leading-none">×</button>
                          </span>
                        ))}
                        <button type="button" onClick={() => setActiveFilters(new Set())} className="text-xs text-ux-text-sub hover:text-ux-text underline">Clear all</button>
                      </div>
                    )}
                    <div className="mt-2 text-xs text-ux-text-sub">Schema version {versionsData?.schema?.caes?.version ?? '1.0.0'}</div>
                  </div>

                  {/* Toolbar: search + collapse controls + Add Mapping */}
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ux-text-sub">&#x1F50D;</span>
                      <input
                        type="search"
                        value={attrSearch}
                        onChange={e => setAttrSearch(e.target.value)}
                        placeholder="Filter by name, description, type, source, table or field..."
                        className="w-full pl-9 pr-3 py-2 text-sm border border-ux-border rounded-md bg-ux-surface text-ux-text placeholder-gray-400 focus:ring-ux-accent focus:border-ux-accent"
                      />
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          const allKeys = new Set([
                            ...(schema ? Object.keys(schema.attributes) : []),
                            ...(attributeMappings ? Object.keys(attributeMappings.grouped_by_attribute) : []),
                          ]);
                          setCollapsedAttrs(allKeys);
                        }}
                        className="text-xs text-ux-text-sub hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded hover:bg-ux-hover"
                      >Collapse all</button>
                      <button
                        onClick={() => setCollapsedAttrs(new Set())}
                        className="text-xs text-ux-text-sub hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded hover:bg-ux-hover"
                      >Expand all</button>
                    </div>
                    <button
                      onClick={() => { setMutationError(null); setMappingModal({ mode: 'create', initial: emptyForm() }); }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-ux-btn text-ux-btn-on text-sm font-medium rounded-md hover:brightness-90 flex-shrink-0"
                    >
                      <span className="text-base leading-none">+</span> Add Mapping
                    </button>
                  </div>

                  {mutationError && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded text-sm text-red-700 dark:text-red-300">{mutationError}</div>
                  )}

                  {filteredAttrEntries.length === 0 && (
                    <p className="text-sm text-ux-text-muted py-4 text-center">
                      No attributes match
                      {attrSearch ? <> &ldquo;{attrSearch}&rdquo;</> : null}
                      {activeFilters.size > 0 ? <> the active {activeFilters.size === 1 ? 'filter' : 'filters'}</> : null}.{' '}
                      {activeFilters.size > 0 && (
                        <button type="button" onClick={() => setActiveFilters(new Set())} className="underline hover:text-ux-text">Clear filters</button>
                      )}
                    </p>
                  )}

                  {/* Attribute cards */}
                  <div className="space-y-2">
                    {filteredAttrEntries.map(attr => {
                      const schemaAttr   = schema?.attributes[attr];
                      const attrMappings = attributeMappings?.grouped_by_attribute[attr] ?? [];
                      const isStandard   = !!schemaAttr;
                      const isCollapsed  = collapsedAttrs.has(attr);
                      const isMultiSource  = attrMappings.length > 1;
                      const authCount      = attrMappings.filter(m => m.is_authoritative).length;
                      const noAuthority    = attrMappings.length > 0 && isMultiSource && authCount === 0;
                      const multiAuthority = authCount > 1;

                      return (
                        <div key={attr} className={`bg-ux-surface border rounded-lg overflow-hidden ${
                          multiAuthority ? 'border-red-400 dark:border-red-600'
                          : noAuthority  ? 'border-amber-300 dark:border-amber-700'
                          : 'border-ux-border'
                        }`}>
                          {/* Card header — always visible, click to collapse/expand */}
                          <button
                            type="button"
                            onClick={() => toggleAttrCard(attr)}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-left ${
                              multiAuthority ? 'bg-red-50 dark:bg-red-900/20'
                              : noAuthority  ? 'bg-amber-50 dark:bg-amber-900/20'
                              : 'bg-ux-surface-alt'
                            } ${!isCollapsed ? 'border-b border-inherit' : ''} hover:brightness-95 transition-all`}
                          >
                            <span className={`text-ux-text-muted text-xs transition-transform flex-shrink-0 ${isCollapsed ? '' : 'rotate-90'}`}>›</span>
                            <code className={`text-sm font-mono font-semibold flex-1 ${
                              isStandard ? 'text-indigo-700 dark:text-indigo-300' : 'text-teal-700 dark:text-teal-300'
                            }`}>{attr}</code>

                            {/* Standard / Extended badge */}
                            {isStandard ? (
                              <span className="flex items-center gap-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-800/60 px-2 py-0.5 rounded-full flex-shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span> Standard
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-300 bg-teal-100 dark:bg-teal-800/40 px-2 py-0.5 rounded-full flex-shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 inline-block"></span> Extended
                              </span>
                            )}

                            {/* Data type */}
                            {schemaAttr && (
                              <span className="text-xs font-medium text-ux-text-sub flex-shrink-0">{schemaAttr.dataType}</span>
                            )}

                            {/* Sensitive */}
                            {schemaAttr?.sensitive && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-800/60 text-red-800 dark:text-red-200 rounded flex-shrink-0">Sensitive</span>
                            )}

                            {/* Description (truncated) */}
                            {schemaAttr && (
                              <span className="text-xs text-ux-text-sub truncate max-w-xs hidden sm:block">{schemaAttr.description}</span>
                            )}

                            {/* Source count badges */}
                            {isMultiSource && (
                              <span className="text-xs bg-purple-100 dark:bg-purple-800/60 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded font-medium flex-shrink-0">
                                {attrMappings.length} sources
                              </span>
                            )}
                            {multiAuthority && (
                              <span className="text-xs bg-red-100 dark:bg-red-800/60 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-600 px-2 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1">
                                <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                                {authCount} authoritative
                              </span>
                            )}
                            {noAuthority && (
                              <span className="text-xs bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 px-2 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1">
                                <svg className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                                no authoritative source
                              </span>
                            )}
                            {attrMappings.length === 0 && (
                              <span className="text-ux-text-sub">no mappings</span>
                            )}
                          </button>

                          {/* Expanded body */}
                          {!isCollapsed && (
                            <div>
                              {/* Schema description row */}
                              {schemaAttr && (
                                <div className="px-10 py-2.5 text-sm text-ux-text-sub border-b border-ux-border bg-ux-surface">
                                  {schemaAttr.description}
                                </div>
                              )}

                              {/* Mapping rows */}
                              {attrMappings.length > 0 ? (
                                <div className="divide-y divide-ux-border/50">
                                  {attrMappings.map(mapping => (
                                    <div
                                      key={mapping.id}
                                      className={`flex items-start gap-4 px-4 py-3 ${mapping.is_authoritative ? 'bg-amber-50 dark:bg-amber-900/30' : ''}`}
                                    >
                                      {/* Source + authoritative badge */}
                                      <div className="flex flex-col items-start gap-1 w-28 flex-shrink-0">
                                        <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${
                                          mapping.is_authoritative
                                            ? 'bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200'
                                            : 'bg-ux-hover text-ux-text-sub'
                                        }`}>
                                          {mapping.sourceSystem}
                                        </span>
                                        {mapping.is_authoritative && (
                                          <span className="flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
                                            <span>★</span> Authoritative
                                          </span>
                                        )}
                                      </div>

                                      {/* Field details */}
                                      <div className="flex-1 min-w-0 text-xs text-ux-text-sub space-y-1">
                                        <div>
                                          <span className="font-medium text-ux-text">Field: </span>
                                          <code className="font-mono">{mapping.sourceTable}.{mapping.sourceField}</code>
                                          <span className="text-ux-text-sub ml-2">key: <code className="font-mono">{mapping.keyField}</code></span>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                          {mapping.operations.map(op => (
                                            <span key={op} className="px-1.5 py-0.5 bg-ux-hover text-ux-text-sub rounded">{op}</span>
                                          ))}
                                          {mapping.searchable && <span className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded">searchable</span>}
                                          {mapping.indexed && <span className="px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-600 rounded">indexed</span>}
                                          {mapping.transformations?.read && (
                                            <span className="px-1.5 py-0.5 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 rounded" title={mapping.transformations.read}>transform</span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Actions */}
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        {isMultiSource && !mapping.is_authoritative && (
                                          <button
                                            onClick={() => { setMutationError(null); setAuthoritativeMutation.mutate(mapping.id); }}
                                            disabled={setAuthoritativeMutation.isPending}
                                            title="Set as authoritative source for this attribute"
                                            className="px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded hover:bg-amber-100 dark:hover:bg-amber-800/60 disabled:opacity-50"
                                          >
                                            ★ Set authoritative
                                          </button>
                                        )}
                                        {multiAuthority && mapping.is_authoritative && (
                                          <button
                                            onClick={() => { if (clearAuthConfirm === mapping.id) { setClearAuthConfirm(null); setMutationError(null); clearAuthoritativeMutation.mutate(mapping.id); } else { setClearAuthConfirm(mapping.id); } }}
                                            disabled={clearAuthoritativeMutation.isPending}
                                            title="Remove authoritative flag from this source"
                                            className={`px-2.5 py-1 text-xs font-medium rounded disabled:opacity-50 ${clearAuthConfirm === mapping.id ? 'bg-red-700 text-white border border-red-700 hover:bg-red-800 ring-2 ring-red-400' : 'text-red-600 dark:text-red-400 border border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-800/60'}`}
                                          >
                                            {clearAuthConfirm === mapping.id ? 'Confirm clear?' : '★ Clear authoritative'}
                                          </button>
                                        )}
                                        {clearAuthConfirm === mapping.id && (
                                          <button
                                            onClick={() => setClearAuthConfirm(null)}
                                            className="px-2.5 py-1 text-xs font-medium text-ux-text-sub border border-ux-border rounded hover:bg-ux-hover"
                                          >
                                            Cancel
                                          </button>
                                        )}
                                        <button
                                          onClick={() => { setMutationError(null); setMappingModal({ mode: 'edit', id: mapping.id, initial: mappingToForm(mapping) }); }}
                                          className="px-2.5 py-1 text-xs font-medium text-ux-text-sub border border-ux-border rounded hover:bg-ux-hover bg-ux-surface/50"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          onClick={() => { setMutationError(null); setDeleteConfirm(mapping); }}
                                          className="px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 dark:bg-transparent"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                /* No mappings yet — prompt to add one */
                                <div className="px-10 py-3 flex items-center gap-3">
                                  <span className="text-ux-text-sub">No source mappings configured for this attribute.</span>
                                  <button
                                    onClick={() => { setMutationError(null); setMappingModal({ mode: 'create', initial: { ...emptyForm(), standardAttribute: attr } }); }}
                                    className="text-xs text-ux-nav-label hover:underline font-medium"
                                  >
                                    + Add mapping
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Resolve Attributes Tab */}
          {activeTab === 'resolve' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-ux-text">Resolve Attributes</h3>
                <p className="mt-1 text-sm text-ux-text-sub">
                  Retrieve live attribute values for a GCUID from authoritative sources. Select any combination of standard and extended attributes.
                </p>
              </div>

              {/* GCUID input */}
              <div>
                <label className="block text-sm font-medium text-ux-text mb-1">GCUID *</label>
                <input
                  type="text"
                  placeholder="urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X2"
                  value={selectedGCUID}
                  onChange={(e) => { setSelectedGCUID(e.target.value); setResolutionResult(null); }}
                  className="w-full px-4 py-2 bg-ux-surface text-ux-text border border-ux-border rounded-md focus:ring-ux-accent focus:border-ux-accent font-mono text-sm"
                />
              </div>

              {/* Attribute selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-ux-text">Attributes to Resolve</label>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      onClick={() => {
                        const all = [
                          ...(schema ? Object.keys(schema.attributes) : []),
                          ...Object.keys(attributeMappings?.grouped_by_attribute ?? {}).filter(a => !schema?.attributes[a]),
                        ];
                        setAttributesToResolve(all);
                      }}
                      className="text-ux-nav-label hover:underline"
                    >Select all</button>
                    <button
                      onClick={() => setAttributesToResolve([])}
                      className="text-ux-text-sub hover:underline"
                    >Clear</button>
                    <span className="text-ux-text-sub">{attributesToResolve.length} selected</span>
                  </div>
                </div>
                {/* Standard */}
                {schema && (
                  <>
                    <p className="text-xs font-semibold text-ux-nav-label mb-1 mt-2">Standard attributes</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mb-3">
                      {Object.keys(schema.attributes).map(attr => (
                        <label key={attr} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={attributesToResolve.includes(attr)}
                            onChange={() => toggleAttribute(attr)}
                            className="rounded border-ux-border text-ux-accent focus:ring-ux-accent"
                          />
                          <code className="text-xs font-mono text-ux-nav-label truncate">{attr}</code>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {/* Extended */}
                {attributeMappings && Object.keys(attributeMappings.grouped_by_attribute).filter(a => !schema?.attributes[a]).length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-teal-700 dark:text-teal-300 mb-1">Extended attributes</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                      {Object.keys(attributeMappings.grouped_by_attribute).filter(a => !schema?.attributes[a]).map(attr => (
                        <label key={attr} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={attributesToResolve.includes(attr)}
                            onChange={() => toggleAttribute(attr)}
                            className="rounded border-ux-border text-teal-500 focus:ring-teal-400"
                          />
                          <code className="text-xs font-mono text-teal-600 dark:text-teal-400 truncate">{attr}</code>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => { setResolveRawOpen(false); handleResolveAttributes(); }}
                disabled={!selectedGCUID || attributesToResolve.length === 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Resolve
              </button>

              {/* Results */}
              {resolutionResult && !resolutionResult.error && (
                <div className="space-y-3">
                  {/* Legend: shown when any attribute has multiple source values */}
                  {Object.values(resolutionResult.attributes).some((v: any) => v.values?.length > 1) && (
                    <p className="text-xs text-ux-text-sub px-1 flex items-start gap-1.5">
                      <span className="text-amber-500 mt-0.5">★</span>
                      <span>
                        The resolved value is always taken from the <span className="font-semibold">authoritative source (★)</span>.
                        Other sources that also returned data are listed below it — any value that differs from the authoritative result is shown as{' '}
                        <span className="text-orange-500 italic font-medium">? …</span>.
                      </span>
                    </p>
                  )}
                  {/* Friendly result cards */}
                  <div className="grid grid-cols-1 gap-2">
                    {(Object.entries(resolutionResult.attributes) as [string, { value: any; source: string | null; dataType: string; values: { source: string; value: any; is_authoritative: boolean }[]; authoritative_source: string | null }][]).map(([attr, result]) => {
                      const isStandard = !!schema?.attributes[attr];
                      const hasValue = result.value !== null && result.value !== undefined;
                      return (
                        <div key={attr} className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${
                          hasValue
                            ? 'bg-ux-surface border-ux-border'
                            : 'bg-ux-surface-alt border-ux-border'
                        }`}>
                          {/* Attribute name */}
                          <div className="w-56 flex-shrink-0">
                            <code className={`text-xs font-mono font-semibold ${
                              isStandard ? 'text-indigo-600 dark:text-indigo-400' : 'text-teal-600 dark:text-teal-400'
                            }`}>{attr}</code>
                          </div>
                          {/* Value */}
                          <div className="flex-1 min-w-0">
                            {hasValue ? (
                              <span className="text-sm text-ux-text break-all">
                                {typeof result.value === 'object' ? JSON.stringify(result.value) : String(result.value)}
                              </span>
                            ) : (
                              <span className="text-ux-text-sub">no value</span>
                            )}
                          </div>
                          {/* Source badges — one per source that returned a value */}
                          <div className="flex-shrink-0 flex flex-col items-end gap-1 min-w-[7rem]">
                            {result.values && result.values.length > 0 ? (
                              result.values.map((v: { source: string; value: any; is_authoritative: boolean }) => {
                                const isAuth = v.source === result.authoritative_source;
                                const differsFromWinner = result.values!.length > 1 && String(v.value) !== String(result.value);
                                return (
                                  <div key={v.source} className="flex flex-col items-end gap-0.5">
                                    <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${
                                      isAuth
                                        ? 'bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200'
                                        : 'bg-ux-hover text-ux-text-sub'
                                    }`}>
                                      {isAuth && <span className="mr-0.5">★</span>}
                                      {v.source}
                                    </span>
                                    {differsFromWinner && (
                                      <span className="text-xs text-orange-500 dark:text-orange-400 italic max-w-[12rem] truncate text-right" title={String(v.value)}>
                                        ? {String(v.value)}
                                      </span>
                                    )}
                                  </div>
                                );
                              })
                            ) : result.source ? (
                              <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${
                                result.source === result.authoritative_source
                                  ? 'bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200'
                                  : 'bg-ux-hover text-ux-text-sub'
                              }`}>
                                {result.source === result.authoritative_source && <span className="mr-0.5">★</span>}
                                {result.source}
                              </span>
                            ) : (
                              <span className="text-xs text-ux-text-sub">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Sources used / disabled */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ux-text-sub">
                    <span>Sources queried:</span>
                    {resolutionResult.sources_used?.map((s: string) => (
                      <span key={s} className="px-2 py-0.5 bg-ux-hover rounded font-medium text-ux-text uppercase">{s}</span>
                    ))}
                    {resolutionResult.disabled_sources?.length > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        ? disabled: {resolutionResult.disabled_sources.join(', ')}
                      </span>
                    )}
                  </div>

                  {/* Collapsible raw JSON */}
                  <div className="border border-ux-border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setResolveRawOpen(o => !o)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left bg-ux-surface-alt text-sm text-ux-text-sub hover:bg-ux-hover"
                    >
                      <span className={`text-xs text-ux-text-sub transition-transform ${resolveRawOpen ? 'rotate-90' : ''}`}>›</span>
                      Raw JSON response
                    </button>
                    {resolveRawOpen && (
                      <pre className="text-xs bg-ux-surface p-4 overflow-auto max-h-96">
                        {JSON.stringify(resolutionResult, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              )}

              {resolutionResult?.error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded text-sm text-red-700 dark:text-red-300">
                  {resolutionResult.error}
                </div>
              )}
            </div>
          )}

          {/* Identity Match Tab */}
          {activeTab === 'match' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-ux-text">Identity Match Search</h3>
                <p className="mt-1 text-sm text-ux-text-sub">
                  Provide known identity attributes to search authoritative sources. The CAES uses
                  compound attribute combinations as surrogate keys to locate an individual and return
                  their source-specific identifier — enabling identity linking without a prior GCUID.
                </p>
              </div>

              {/* Match Strategy Reference */}
              {matchConfigs && (
                <div className="bg-ux-accent-subtle border border-ux-accent-subtle-border rounded-lg">
                  <button
                    type="button"
                    onClick={() => setStrategiesCollapsed(c => !c)}
                    className="w-full flex items-center justify-between p-4 text-left"
                  >
                    <h4 className="text-sm font-semibold text-ux-nav-label">Configured Match Strategies (highest confidence first)</h4>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className={`w-4 h-4 text-ux-nav-label transition-transform ${strategiesCollapsed ? '' : 'rotate-180'}`}
                    >
                      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" clipRule="evenodd" />
                    </svg>
                  </button>
                  {!strategiesCollapsed && (
                    <div className="px-4 pb-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {matchConfigs.configs.map(config => (
                          <div key={config.sourceSystem} className="bg-ux-surface rounded border border-ux-accent-subtle-border p-3">
                            <div className="text-xs font-bold text-ux-nav-label uppercase mb-2">
                              {config.sourceSystem} ? returns <code className="font-mono">{config.keyField}</code>
                            </div>
                            <div className="space-y-1">
                              {config.strategies.map((s, i) => (
                                <div key={s.strategyId} className="flex items-start gap-2 text-xs text-ux-text-sub">
                                  <span className="text-ux-text-sub font-mono">{i + 1}.</span>
                                  <div>
                                    <span className="font-medium text-ux-text">{s.description}</span>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <div className="flex-1 bg-ux-hover rounded-full h-1.5">
                                        <div
                                          className="bg-ux-accent h-1.5 rounded-full"
                                          style={{ width: `${s.confidence * 100}%` }}
                                        />
                                      </div>
                                      <span className="text-ux-text-sub">{Math.round(s.confidence * 100)}%</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Attribute Input Form */}
              <div className="bg-ux-surface border border-ux-border rounded-lg p-6">
                <h4 className="text-sm font-semibold text-ux-text mb-4">Enter Known Identity Attributes</h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {[
                    { key: 'person.name.given', label: 'Given Name', placeholder: 'e.g. John' },
                    { key: 'person.name.family', label: 'Family Name', placeholder: 'e.g. Smith' },
                    { key: 'person.email', label: 'Email Address', placeholder: 'e.g. john.smith@example.com' },
                    { key: 'person.employment.department', label: 'Department', placeholder: 'e.g. Engineering' },
                    { key: 'person.account.username', label: 'Username (LDAP)', placeholder: 'e.g. jsmith' },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="block text-xs font-medium text-ux-text-sub mb-1">
                        <code className="font-mono text-ux-nav-label">{field.key}</code>
                        <span className="text-ux-text-sub ml-1">· {field.label}</span>
                      </label>
                      <input
                        type="text"
                        placeholder={field.placeholder}
                        value={matchAttributes[field.key] ?? ''}
                        onChange={e => setMatchAttributes(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className="w-full px-3 py-2 bg-ux-surface text-ux-text border border-ux-border rounded-md text-sm focus:ring-ux-accent focus:border-ux-accent"
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={handleMatch}
                    disabled={matchLoading || Object.values(matchAttributes).every(v => !v.trim())}
                    className="px-4 py-2 bg-ux-btn text-ux-btn-on text-sm font-medium rounded-md hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {matchLoading ? 'Searching...' : 'Search Sources'}
                  </button>
                  <button
                    onClick={() => { setMatchAttributes({}); setMatchResult(null); setMatchLinkResult(null); setMatchError(null); }}
                    className="px-4 py-2 border border-ux-border text-ux-text text-sm font-medium rounded-md hover:bg-ux-hover bg-ux-surface/50"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {matchError && <ErrorMessage message={matchError} />}

              {/* Match Results */}
              {matchResult && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                      matchResult.summary.total_matches > 0
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-700'
                        : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-700'
                    }`}>
                      {matchResult.summary.total_matches > 0
                        ? `${matchResult.summary.total_matches} match${matchResult.summary.total_matches > 1 ? 'es' : ''} found`
                        : 'No matches found'}
                    </div>
                    {matchResult.summary.unique_match_found && (
                      <span className="px-3 py-1 bg-ux-accent-subtle text-ux-nav-label text-xs font-medium rounded-full">
                        Unique match across all sources
                      </span>
                    )}
                  </div>

                  {matchResult.matches.length > 0 && (
                    <div className="space-y-3">
                      {matchResult.matches.map((m, i) => (
                        <div key={i} className="bg-ux-surface border border-ux-border rounded-lg p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <span className="px-2 py-1 bg-ux-info-bg text-ux-info text-xs font-semibold rounded uppercase">
                                {m.sourceSystem}
                              </span>
                              <code className="ml-2 text-sm font-mono text-ux-text font-bold">{m.sourceId}</code>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-24 bg-ux-hover rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${
                                    m.confidence >= 0.9 ? 'bg-green-500' : m.confidence >= 0.7 ? 'bg-yellow-500' : 'bg-orange-400'
                                  }`}
                                  style={{ width: `${m.confidence * 100}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-ux-text-sub">
                                {Math.round(m.confidence * 100)}% confidence
                              </span>
                            </div>
                          </div>
                          <div className="text-xs text-ux-text-sub mb-2">
                            Strategy: <span className="font-medium text-ux-text">{m.strategyDescription}</span>
                          </div>
                          <div className="text-xs text-ux-text-sub mb-3">
                            Matched on:{' '}
                            {m.matchedAttributes.map(a => (
                              <code key={a} className="ml-1 px-1.5 py-0.5 bg-ux-accent-subtle text-ux-nav-label rounded font-mono">
                                {a}
                              </code>
                            ))}
                          </div>
                          <details className="text-xs">
                            <summary className="cursor-pointer text-ux-text-sub hover:text-gray-700 dark:hover:text-gray-200">
                              View source record
                            </summary>
                            <pre className="mt-2 p-3 bg-ux-surface-alt rounded overflow-auto text-ux-text">
                              {JSON.stringify(m.record, null, 2)}
                            </pre>
                          </details>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Link to GCUID panel */}
                  {matchResult.matches.length > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-3">Link Matches to a GCUID</h4>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
                        Only matches with =75% confidence will be written to source_mappings.
                        Matches below threshold are reported but not linked.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="text"
                          placeholder="GCUID (urn:gcuid:...)"
                          value={matchLinkGCUID}
                          onChange={e => setMatchLinkGCUID(e.target.value)}
                          className="flex-1 px-3 py-2 bg-ux-surface text-ux-text border border-amber-300 dark:border-amber-700 rounded-md text-sm font-mono focus:ring-amber-500 focus:border-amber-500"
                        />
                        <input
                          type="text"
                          placeholder="Requested by (optional)"
                          value={matchLinkRequestedBy}
                          onChange={e => setMatchLinkRequestedBy(e.target.value)}
                          className="flex-1 px-3 py-2 bg-ux-surface text-ux-text border border-amber-300 dark:border-amber-700 rounded-md text-sm focus:ring-amber-500 focus:border-amber-500"
                        />
                        <button
                          onClick={handleMatchAndLink}
                          disabled={!matchLinkGCUID.trim() || matchLoading}
                          className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          Match &amp; Link
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Match-and-link result */}
              {matchLinkResult && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4 space-y-2">
                  <h4 className="text-sm font-semibold text-green-800 dark:text-green-200">Link Complete</h4>
                  <div className="text-sm text-green-700 dark:text-green-300">
                    GCUID <code className="font-mono">{matchLinkResult.gcuid}</code> linked to{' '}
                    <strong>{matchLinkResult.sources_linked.length}</strong> source(s):{' '}
                    {matchLinkResult.sources_linked.join(', ')}
                  </div>
                  {matchLinkResult.low_confidence_matches.length > 0 && (
                    <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                      {matchLinkResult.low_confidence_matches.length} low-confidence match(es) were found but not linked.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Statistics Tab */}
          {activeTab === 'stats' && (
            <>
              {statsLoading && <LoadingSpinner message="Loading statistics..." />}
              {statsError && (
                <ErrorMessage
                  message={statsError instanceof Error ? statsError.message : 'Failed to load statistics'}
                />
              )}
              {stats && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
                    <div className="bg-ux-elevation1 overflow-hidden shadow rounded-lg border border-ux-border">
                      <div className="p-5">
                        <div className="text-sm font-medium text-ux-text-sub truncate">Total Attribute Mappings</div>
                        <div className="mt-1 text-3xl font-semibold text-ux-text">
                          {stats.overview.total_attribute_mappings}
                        </div>
                      </div>
                    </div>
                    <div className="bg-ux-info-bg overflow-hidden shadow rounded-lg border border-ux-info-border">
                      <div className="p-5">
                        <div className="text-sm font-medium text-ux-text-sub truncate">Unique Attributes</div>
                        <div className="mt-1 text-3xl font-semibold text-ux-info">
                          {stats.overview.unique_attributes}
                        </div>
                      </div>
                    </div>
                    <div className="bg-ux-success-bg overflow-hidden shadow rounded-lg border border-ux-success-border">
                      <div className="p-5">
                        <div className="text-sm font-medium text-ux-text-sub truncate">Multi-Source Attributes</div>
                        <div className="mt-1 text-3xl font-semibold text-ux-success">
                          {stats.overview.multi_source_attributes}
                        </div>
                      </div>
                    </div>
                    <div className="bg-ux-accent-subtle overflow-hidden shadow rounded-lg border border-ux-accent-subtle-border">
                      <div className="p-5">
                        <div className="text-sm font-medium text-ux-text-sub truncate">Source Systems</div>
                        <div className="mt-1 text-3xl font-semibold text-ux-nav-label">
                          {stats.overview.source_systems}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-4">Mappings by Source System</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {stats.by_source.map((source) => (
                        <div key={source.source_system} className="bg-ux-surface-alt rounded-lg p-4">
                          <div className="text-sm font-medium text-ux-text-sub uppercase">{source.source_system}</div>
                          <div className="mt-1 text-2xl font-semibold text-ux-text">{source.mapping_count} mappings</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-4">Multi-Source Attributes</h3>
                    <div className="space-y-3">
                      {stats.multi_source_attributes.map((attr) => (
                        <div key={attr.attribute} className="bg-ux-success-bg rounded-lg p-4 border border-ux-success-border">
                          <div className="flex items-start justify-between gap-4">
                            <div className="font-mono text-sm font-medium text-ux-text">{attr.attribute}</div>
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              {attr.sources.map(s => {
                                const isAuth = (attributeMappings?.grouped_by_attribute[attr.attribute] ?? []).some(
                                  m => m.sourceSystem === s && m.is_authoritative
                                );
                                return (
                                  <span
                                    key={s}
                                    className={`px-2 py-0.5 text-xs font-medium rounded ${
                                      isAuth
                                        ? 'bg-ux-warning-bg text-ux-warning ring-1 ring-ux-warning-border'
                                        : 'bg-ux-info-bg text-ux-info'
                                    }`}
                                  >
                                    {isAuth ? '★ ' : ''}{s.toUpperCase()}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-4">Operation Support</h3>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      {stats.operation_support.map((op) => (
                        <div key={op.operation} className="bg-ux-info-bg rounded-lg p-4 border border-ux-info-border">
                          <div className="text-sm font-medium text-ux-info capitalize">{op.operation}</div>
                          <div className="mt-1 text-2xl font-semibold text-ux-text">
                            {op.mappings_supporting}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-4">Index & Search Capabilities</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-ux-accent-subtle rounded-lg p-4 border border-ux-accent-subtle-border">
                        <div className="text-sm font-medium text-ux-nav-label">Searchable Mappings</div>
                        <div className="mt-1 text-2xl font-semibold text-ux-text">
                          {stats.searchable_mappings}
                        </div>
                      </div>
                      <div className="bg-ux-accent-subtle rounded-lg p-4 border border-ux-accent-subtle-border">
                        <div className="text-sm font-medium text-ux-nav-label">Indexed Mappings</div>
                        <div className="mt-1 text-2xl font-semibold text-ux-text">
                          {stats.indexed_mappings}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Match Strategies Config Tab */}
          {activeTab === 'match-config' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-ux-text">Match Strategy Configuration</h3>
                <p className="mt-1 text-sm text-ux-text-sub">
                  Configure the compound-attribute strategies used to locate an individual in each source system.
                  Strategies are tried highest-confidence first; the first match per source is returned.
                  Changes take effect immediately on the next match request.
                </p>
              </div>

              {/* Per-source cards */}
              {(matchConfigs?.configs ?? []).map(cfg => {
                const src = cfg.sourceSystem;
                const edit = mcEdits[src] ?? cfg;
                const dirty = mcDirty.has(src);
                const saving = mcSaving.has(src);

                const setEdit = (patch: Partial<typeof edit>) =>
                  setMcEdits(prev => ({ ...prev, [src]: { ...prev[src], ...patch } }));
                const markDirty = () => setMcDirty(prev => { const s = new Set(prev); s.add(src); return s; });

                const updateStrategy = (idx: number, patch: Partial<MatchStrategy>) => {
                  const strategies = [...(edit.strategies ?? [])];
                  strategies[idx] = { ...strategies[idx], ...patch };
                  setEdit({ strategies });
                  markDirty();
                };

                const addStrategy = () => {
                  const strategies = [...(edit.strategies ?? [])];
                  strategies.push({
                    strategyId: `${src}-new-${Date.now()}`,
                    description: '',
                    standardAttributes: [],
                    matchType: 'exact',
                    confidence: 0.5,
                    requiresUnique: true,
                  });
                  setEdit({ strategies });
                  markDirty();
                };

                const removeStrategy = (idx: number) => {
                  const strategies = [...(edit.strategies ?? [])].filter((_, i) => i !== idx);
                  setEdit({ strategies });
                  markDirty();
                };

                const save = async () => {
                  setMcSaving(prev => { const s = new Set(prev); s.add(src); return s; });
                  setMcError(prev => { const n = { ...prev }; delete n[src]; return n; });
                  try {
                    // Auto-slug strategyIds from description if they look like the placeholder
                    const strategies = edit.strategies.map(s => ({
                      ...s,
                      strategyId: s.strategyId.startsWith(`${src}-new-`)
                        ? `${src}-${s.description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 40) || Date.now()}`
                        : s.strategyId,
                    }));
                    await caesApi.updateMatchConfig(src, {
                      sourceTable: edit.sourceTable,
                      keyField: edit.keyField,
                      strategies,
                    });
                    setMcDirty(prev => { const s = new Set(prev); s.delete(src); return s; });
                    qc.invalidateQueries({ queryKey: ['caes-match-configs'] });
                  } catch (err) {
                    setMcError(prev => ({ ...prev, [src]: err instanceof Error ? err.message : 'Save failed' }));
                  } finally {
                    setMcSaving(prev => { const s = new Set(prev); s.delete(src); return s; });
                  }
                };

                const discard = () => {
                  setMcEdits(prev => ({ ...prev, [src]: { ...cfg, connectorId: cfg.connectorId ?? `conn-${src}` } }));
                  setMcDirty(prev => { const s = new Set(prev); s.delete(src); return s; });
                  setMcError(prev => { const n = { ...prev }; delete n[src]; return n; });
                };

                return (
                  <div key={src} className={`bg-ux-surface border rounded-lg overflow-hidden transition-all ${dirty ? 'border-amber-400 dark:border-amber-500' : 'border-ux-border'}`}>
                    {/* Source header */}
                    <button
                      type="button"
                      onClick={() => toggleMcExpanded(src)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-ux-surface-alt border-b border-ux-border text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold uppercase bg-ux-accent-subtle text-ux-nav-label px-2 py-0.5 rounded">{src}</span>
                        <span className="text-xs text-ux-text-sub font-mono">{edit.connectorId}</span>
                        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">● unsaved changes</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {dirty && mcExpanded.has(src) && (
                          <>
                            <button type="button" onClick={e => { e.stopPropagation(); discard(); }} className="text-xs px-3 py-1 rounded border border-ux-border text-ux-text-sub hover:bg-ux-hover">Discard</button>
                            <button type="button" onClick={e => { e.stopPropagation(); save(); }} disabled={saving} className="text-xs px-3 py-1 rounded bg-ux-btn text-ux-btn-on hover:brightness-90 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                          </>
                        )}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className={`w-4 h-4 text-ux-muted transition-transform flex-shrink-0 ${mcExpanded.has(src) ? 'rotate-180' : ''}`}
                        >
                          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </button>

                    {mcExpanded.has(src) && (
                    <div className="p-4 space-y-4">
                      {mcError[src] && (
                        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded px-3 py-2">{mcError[src]}</div>
                      )}

                      {/* Source meta fields */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-ux-text-sub mb-1">Source Table</label>
                          <input
                            type="text"
                            title="Source table name"
                            value={edit.sourceTable}
                            onChange={e => { setEdit({ sourceTable: e.target.value }); markDirty(); }}
                            className="w-full px-2 py-1.5 text-sm border border-ux-border rounded bg-ux-surface text-ux-text font-mono focus:ring-ux-accent focus:border-ux-accent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-ux-text-sub mb-1">Key Field (returned ID)</label>
                          <input
                            type="text"
                            title="Key field (identifier returned)"
                            value={edit.keyField}
                            onChange={e => { setEdit({ keyField: e.target.value }); markDirty(); }}
                            className="w-full px-2 py-1.5 text-sm border border-ux-border rounded bg-ux-surface text-ux-text font-mono focus:ring-ux-accent focus:border-ux-accent"
                          />
                        </div>
                      </div>

                      {/* Strategies table */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-ux-text uppercase tracking-wide">Strategies (highest confidence first)</span>
                          <button type="button" onClick={addStrategy} className="text-xs px-2 py-1 rounded bg-ux-accent-subtle text-ux-nav-label border border-ux-accent-subtle-border hover:bg-ux-hover">+ Add strategy</button>
                        </div>
                        {(edit.strategies ?? []).length === 0 && (
                          <p className="text-xs text-ux-text-muted italic py-2">No strategies configured — add one above.</p>
                        )}
                        <div className="space-y-2">
                          {(edit.strategies ?? []).map((s, idx) => (
                            <div key={idx} className="border border-ux-border rounded p-3 space-y-2 bg-ux-surface-alt">
                              <div className="flex items-start gap-2">
                                <span className="text-ux-text-sub">{idx + 1}.</span>
                                <div className="flex-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div>
                                    <label className="block text-xs text-ux-text-sub mb-0.5">Description</label>
                                    <input
                                      type="text"
                                      value={s.description}
                                      placeholder="e.g. Exact match on email"
                                      onChange={e => updateStrategy(idx, { description: e.target.value })}
                                      className="w-full px-2 py-1 text-sm border border-ux-border rounded bg-ux-surface text-ux-text focus:ring-ux-accent focus:border-ux-accent"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-ux-text-sub mb-0.5">Standard Attributes (comma-separated)</label>
                                    <input
                                      type="text"
                                      value={s.standardAttributes.join(', ')}
                                      placeholder="e.g. person.email"
                                      onChange={e => updateStrategy(idx, { standardAttributes: e.target.value.split(',').map(a => a.trim()).filter(Boolean) })}
                                      className="w-full px-2 py-1 text-sm border border-ux-border rounded bg-ux-surface text-ux-text font-mono focus:ring-ux-accent focus:border-ux-accent"
                                    />
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="flex-1">
                                      <label className="block text-xs text-ux-text-sub mb-0.5">Match Type</label>
                                      <select
                                        title="Match type"
                                        value={s.matchType}
                                        onChange={e => updateStrategy(idx, { matchType: e.target.value as 'exact' | 'contains' })}
                                        className="w-full px-2 py-1 text-sm border border-ux-border rounded bg-ux-surface text-ux-text focus:ring-ux-accent focus:border-ux-accent"
                                      >
                                        <option value="exact">exact</option>
                                        <option value="contains">contains</option>
                                      </select>
                                    </div>
                                    <div className="flex-1">
                                      <label className="block text-xs text-ux-text-sub mb-0.5">Confidence ({Math.round(s.confidence * 100)}%)</label>
                                      <input
                                        type="range"
                                        title="Confidence level"
                                        min="0"
                                        max="100"
                                        step="1"
                                        value={Math.round(s.confidence * 100)}
                                        onChange={e => updateStrategy(idx, { confidence: Number(e.target.value) / 100 })}
                                        className="w-full accent-indigo-600"
                                      />
                                    </div>
                                    <div className="flex items-center gap-1 pt-4">
                                      <input
                                        type="checkbox"
                                        id={`req-unique-${src}-${idx}`}
                                        checked={s.requiresUnique}
                                        onChange={e => updateStrategy(idx, { requiresUnique: e.target.checked })}
                                        className="accent-indigo-600"
                                      />
                                      <label htmlFor={`req-unique-${src}-${idx}`} className="text-xs text-ux-text-sub whitespace-nowrap">Unique only</label>
                                    </div>
                                  </div>
                                </div>
                                <button type="button" onClick={() => removeStrategy(idx)} className="text-ux-text-sub hover:text-red-500 dark:hover:text-red-400 text-sm pt-1 flex-shrink-0" title="Remove strategy">×</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}

              {/* Add new source */}
              <div className="border border-dashed border-ux-border rounded-lg p-4">
                {!addSrcOpen ? (
                  <button type="button" onClick={() => setAddSrcOpen(true)} className="text-sm text-ux-nav-label hover:underline">+ Add source system</button>
                ) : (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-ux-text">New Source System</h4>
                    {addSrcError && <div className="text-sm text-red-600 dark:text-red-400">{addSrcError}</div>}
                    <div className="grid grid-cols-2 gap-3">
                      {(['sourceSystem', 'connectorId', 'sourceTable', 'keyField'] as const).map(field => (
                        <div key={field}>
                          <label className="block text-xs text-ux-text-sub mb-0.5 capitalize">{field.replace(/([A-Z])/g, ' $1').trim()}</label>
                          <input
                            type="text"
                            value={addSrcForm[field]}
                            placeholder={field === 'connectorId' ? 'auto-filled if blank' : ''}
                            onChange={e => setAddSrcForm(prev => ({ ...prev, [field]: e.target.value }))}
                            className="w-full px-2 py-1.5 text-sm border border-ux-border rounded bg-ux-surface text-ux-text font-mono focus:ring-ux-accent focus:border-ux-accent"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setAddSrcError('');
                          if (!addSrcForm.sourceSystem || !addSrcForm.sourceTable || !addSrcForm.keyField) {
                            setAddSrcError('sourceSystem, sourceTable, and keyField are required');
                            return;
                          }
                          try {
                            await caesApi.addMatchConfig({
                              ...addSrcForm,
                              strategies: [],
                            });
                            setAddSrcOpen(false);
                            setAddSrcForm({ sourceSystem: '', connectorId: '', sourceTable: '', keyField: '' });
                            qc.invalidateQueries({ queryKey: ['caes-match-configs'] });
                          } catch (err) {
                            setAddSrcError(err instanceof Error ? err.message : 'Failed to add source');
                          }
                        }}
                        className="px-3 py-1.5 text-sm bg-ux-btn text-ux-btn-on rounded hover:brightness-90"
                      >
                        Add Source
                      </button>
                      <button type="button" onClick={() => { setAddSrcOpen(false); setAddSrcError(''); setAddSrcForm({ sourceSystem: '', connectorId: '', sourceTable: '', keyField: '' }); }} className="px-3 py-1.5 text-sm border border-ux-border text-ux-text-sub rounded hover:bg-ux-hover">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* System Health Tab */}
          {activeTab === 'health' && (
            <div className="space-y-6">
              {healthLoading && <LoadingSpinner message="Checking system health..." />}
              {health && health.services && health.connectors && (
                <>
                  {/* Overall status banner */}
                  <div className={`flex items-center gap-3 rounded-lg px-5 py-4 border ${
                    health.status === 'operational'
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
                      : health.status === 'degraded'
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'
                      : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
                  }`}>
                    <span className={`w-3 h-3 rounded-full shrink-0 ${
                      health.status === 'operational' ? 'bg-green-500' :
                      health.status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ux-text capitalize">{health.status}</p>
                      <p className="text-xs text-ux-text-sub">
                        Last checked {new Date(health.timestamp).toLocaleTimeString()} ·
                        Schema v{health.attribute_schema_version} ·
                        {health.attribute_mappings_loaded} mapping{health.attribute_mappings_loaded !== 1 ? 's' : ''} loaded
                      </p>
                    </div>
                  </div>

                  {/* GCUID Services */}
                  <div className="bg-ux-surface overflow-hidden shadow rounded-lg">
                    <div className="px-5 py-4 border-b border-ux-border">
                      <h3 className="text-sm font-semibold text-ux-text">GCUID Services</h3>
                      <p className="text-xs text-ux-text-sub mt-0.5">Core identity registry and API layer</p>
                    </div>
                    <div className="divide-y divide-ux-border">
                      <button
                        type="button"
                        onClick={() => setSelectedHealthItem({ kind: 'registry' })}
                        className={`w-full flex items-center justify-between px-5 py-3 text-left transition-colors hover:bg-ux-hover ${
                          selectedHealthItem?.kind === 'registry' ? 'bg-ux-hover ring-1 ring-inset ring-ux-accent' : ''
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium text-ux-text">Identity Registry (SQLite)</p>
                          <p className="text-xs text-ux-text-sub">
                            {health.services.registry?.status === 'connected'
                              ? `${health.services.registry.identity_count.toLocaleString()} identities`
                              : 'Unable to connect'}
                          </p>
                        </div>
                        <StatusPill status={health.services.registry?.status === 'connected' ? 'connected' : 'error'} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedHealthItem({ kind: 'api' })}
                        className={`w-full flex items-center justify-between px-5 py-3 text-left transition-colors hover:bg-ux-hover ${
                          selectedHealthItem?.kind === 'api' ? 'bg-ux-hover ring-1 ring-inset ring-ux-accent' : ''
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium text-ux-text">GCUID API</p>
                          <p className="text-xs text-ux-text-sub">Co-located — available when registry is connected</p>
                        </div>
                        <StatusPill status={health.services.registry?.status === 'connected' ? 'connected' : 'error'} />
                      </button>
                    </div>
                  </div>

                  {/* Connectors */}
                  <div className="bg-ux-surface overflow-hidden shadow rounded-lg">
                    <div className="px-5 py-4 border-b border-ux-border flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-ux-text">Authoritative Source Connectors</h3>
                        <p className="text-xs text-ux-text-sub mt-0.5">
                          {health.connectors.filter(c => c.status === 'connected').length} of {health.connectors.length} reachable
                        </p>
                      </div>
                    </div>
                    <div className="divide-y divide-ux-border">
                      {health.connectors.map(c => (
                        <button
                          key={c.connector_id}
                          type="button"
                          onClick={() => setSelectedHealthItem({ kind: 'connector', connectorId: c.connector_id })}
                          className={`w-full flex items-center justify-between px-5 py-3 text-left transition-colors hover:bg-ux-hover ${
                            selectedHealthItem?.kind === 'connector' && selectedHealthItem.connectorId === c.connector_id
                              ? 'bg-ux-hover ring-1 ring-inset ring-ux-accent'
                              : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ux-text">{c.display_name}</p>
                            <p className="text-xs text-ux-text-sub font-mono">{c.connector_id}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-4">
                            <span className={`text-xs px-2 py-0.5 rounded border ${
                              c.enabled
                                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300'
                                : 'bg-ux-surface-alt border-ux-border text-ux-text-muted'
                            }`}>
                              {c.enabled ? 'enabled' : 'disabled'}
                            </span>
                            <StatusPill status={c.status} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Health Detail Panel */}
    {selectedHealthItem && health && health.services && health.connectors && (
      <HealthDetailPanel
        selection={selectedHealthItem}
        health={health}
        onClose={() => setSelectedHealthItem(null)}
      />
    )}

    {/* Create / Edit Mapping Modal */}
    {mappingModal && (
      <MappingModal
        mode={mappingModal.mode}
        initial={mappingModal.initial}
        knownAttributes={[
            ...(schema ? Object.keys(schema.attributes) : []),
            ...Object.keys(attributeMappings?.grouped_by_attribute ?? {}).filter(a => !schema?.attributes[a]),
          ]}
        knownSourceSystems={attributeMappings?.source_systems ?? []}
        saving={createMutation.isPending || updateMutation.isPending}
        error={mutationError}
        onCancel={() => { setMappingModal(null); setMutationError(null); }}
        onSave={(data) => {
          if (mappingModal.mode === 'create') {
            createMutation.mutate(data);
          } else {
            updateMutation.mutate({ id: mappingModal.id, data });
          }
        }}
      />
    )}

    {/* Delete Confirm Dialog */}
    {deleteConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
        <div className="w-full max-w-sm bg-ux-surface rounded-xl shadow-2xl p-6">
          <h3 className="text-base font-semibold text-ux-text mb-2">Delete Mapping?</h3>
          <p className="text-sm text-ux-text-sub mb-1">
            This will permanently remove the <span className="font-semibold text-indigo-700 dark:text-indigo-300">{deleteConfirm.sourceSystem.toUpperCase()}</span> mapping for:
          </p>
          <code className="block text-sm font-mono text-ux-text bg-ux-surface-alt px-3 py-2 rounded mb-4">{deleteConfirm.standardAttribute}</code>
          <p className="text-xs text-ux-text-sub mb-4">Attribute resolution from this source will stop working until the mapping is recreated.</p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="px-4 py-2 text-sm font-medium text-ux-text border border-ux-border rounded-md hover:bg-ux-hover bg-ux-surface"
            >
              Cancel
            </button>
            <button
              onClick={() => deleteMutation.mutate(deleteConfirm.id)}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Mapping'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
    </UXScopeWrapper>
  );
}
