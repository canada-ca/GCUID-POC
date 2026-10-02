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
import {
  connectorsApi,
  ConnectorConfig,
  ConnectorPatch,
  ConnectorTransformation,
} from '../api/client';
import LoadingSpinner from './LoadingSpinner';
import ErrorMessage from './ErrorMessage';

// ─── Constants ────────────────────────────────────────────────────────────────

const TRANSFORM_TYPES: Array<ConnectorTransformation['type']> = [
  'lowercase', 'uppercase', 'trim',
  'value_map', 'date_format',
  'regex_replace', 'prefix', 'suffix', 'substring',
  'conditional', 'pipeline', 'expression',
];

const TRANSFORM_SHORT: Record<ConnectorTransformation['type'], string> = {
  lowercase:     'Lowercase',
  uppercase:     'Uppercase',
  trim:          'Trim whitespace',
  value_map:     'Value map',
  date_format:   'Date format',
  regex_replace: 'Regex replace',
  prefix:        'Prefix',
  suffix:        'Suffix',
  substring:     'Substring',
  conditional:   'Conditional',
  pipeline:      'Pipeline',
  expression:    'Expression (JEXL)',
};

// Types that cannot be used as pipeline steps
const PIPELINE_STEP_TYPES = TRANSFORM_TYPES.filter(t => t !== 'pipeline');

const DIRECTION_OPTIONS: Array<{ value: ConnectorTransformation['direction']; label: string; badge: string }> = [
  { value: 'both',  label: 'Both directions — read ↔ write (inverse applied on write)', badge: '↕ both' },
  { value: 'read',  label: 'Read only — applied when fetching from source',               badge: '↓ read' },
  { value: 'write', label: 'Write only — applied before storing to source',               badge: '↑ write' },
];

const DIRECTION_BADGE_COLORS: Record<string, string> = {
  both:  'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
  read:  'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  write: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
};

const CONNECTION_TYPE_LABELS: Record<string, string> = {
  sqlite:    'SQLite Database',
  'rest-api': 'REST API',
  ldap:      'LDAP / Active Directory',
};

const CONNECTION_TYPE_COLORS: Record<string, string> = {
  sqlite:    'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  'rest-api': 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  ldap:      'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
};

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
  badge,
  editing,
  onEdit,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  editing: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between px-5 py-3 bg-ux-surface-alt border-b border-ux-border">
      <div>
        <h3 className="text-sm font-semibold text-ux-text">{title}</h3>
        <p className="text-xs text-ux-text-sub mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        {badge && <span className="text-xs text-ux-muted">{badge}</span>}
        {!editing && (
          <button
            onClick={onEdit}
            className="px-3 py-1.5 text-xs font-medium border border-ux-border rounded hover:bg-ux-hover bg-ux-surface text-ux-text-sub"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

function SectionFooter({
  onSave,
  onCancel,
  saving,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="px-5 py-3 border-t border-ux-border/50 flex items-center gap-2 bg-ux-surface-alt/40">
      <button
        onClick={onSave}
        disabled={saving}
        className="px-3 py-1.5 text-xs font-medium bg-ux-btn text-ux-btn-on rounded hover:brightness-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Apply changes'}
      </button>
      <button
        onClick={onCancel}
        className="px-3 py-1.5 text-xs font-medium border border-ux-border rounded hover:bg-ux-hover text-ux-text-sub"
      >
        Cancel
      </button>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="text-xs text-ux-text-sub w-36 shrink-0 mt-1.5">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function MonoValue({ value }: { value?: string }) {
  return value
    ? <code className="text-xs font-mono text-ux-text">{value}</code>
    : <span className="text-xs text-ux-muted italic">—</span>;
}

function InlineInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50"
    />
  );
}

// ─── Source Connection Section ────────────────────────────────────────────────

function SourceConnectionSection({
  config,
  onSave,
  saving,
}: {
  config: ConnectorConfig;
  onSave: (sc: Partial<ConnectorConfig['sourceConnection']>) => void;
  saving: boolean;
}) {
  const sc = config.sourceConnection;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...sc });

  const startEdit = () => { setDraft({ ...config.sourceConnection }); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = () => { onSave(draft); setEditing(false); };
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) =>
    setDraft(d => ({ ...d, [k]: v }));

  const showDbPath = sc.type === 'sqlite' || !!sc.dbPath;
  const showApiUrl = sc.type === 'rest-api' || sc.type === 'ldap' || !!sc.apiUrl;
  const urlLabel = sc.type === 'ldap' ? 'LDAP host URL' : 'API base URL';

  return (
    <div className="rounded-lg border border-ux-border bg-ux-surface overflow-hidden">
      <SectionHeader
        title="Source Connection"
        subtitle="How the connector reads records from your system"
        editing={editing}
        onEdit={startEdit}
      />
      <div className="px-5 py-4 space-y-0.5">

        {/* Connection type — always read-only */}
        <FieldRow label="Connection type">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              CONNECTION_TYPE_COLORS[sc.type] ?? 'bg-ux-hover text-ux-text-sub'
            }`}>
              {CONNECTION_TYPE_LABELS[sc.type] ?? sc.type}
            </span>
            <span className="text-xs text-ux-muted">(contact your connector developer to change)</span>
          </div>
        </FieldRow>

        {/* Database path */}
        {(showDbPath || editing) && (
          <FieldRow label="Database path">
            {editing
              ? <InlineInput
                  value={draft.dbPath ?? ''}
                  placeholder="./data/sources/conn-my-system.db"
                  onChange={v => set('dbPath', v || undefined)}
                />
              : <MonoValue value={sc.dbPath} />
            }
          </FieldRow>
        )}

        {/* API / LDAP URL */}
        {(showApiUrl || (editing && sc.type !== 'sqlite')) && (
          <FieldRow label={urlLabel}>
            {editing
              ? <InlineInput
                  value={draft.apiUrl ?? ''}
                  placeholder="https://your-api.example.com"
                  onChange={v => set('apiUrl', v || undefined)}
                />
              : <MonoValue value={sc.apiUrl} />
            }
          </FieldRow>
        )}

        {/* Primary table */}
        <FieldRow label="Primary table">
          {editing
            ? <InlineInput
                value={draft.primaryTable ?? ''}
                placeholder="employees"
                onChange={v => set('primaryTable', v || undefined)}
              />
            : <MonoValue value={sc.primaryTable} />
          }
        </FieldRow>

        {/* Primary key field */}
        <FieldRow label="Primary key field">
          {editing
            ? <InlineInput
                value={draft.primaryKeyField ?? ''}
                placeholder="employee_id"
                onChange={v => set('primaryKeyField', v || undefined)}
              />
            : <MonoValue value={sc.primaryKeyField} />
          }
        </FieldRow>
      </div>

      {editing && <SectionFooter onSave={save} onCancel={cancel} saving={saving} />}
    </div>
  );
}

// ─── Attribute Mappings Section ───────────────────────────────────────────────

type MappingRow = { id: number; caes: string; source: string };

function AttributeMappingsSection({
  config,
  onSave,
  saving,
}: {
  config: ConnectorConfig;
  onSave: (mappings: Record<string, string>) => void;
  saving: boolean;
}) {
  const toRows = (m: Record<string, string>): MappingRow[] =>
    Object.entries(m).map(([caes, source], i) => ({ id: i, caes, source }));

  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [nextId, setNextId] = useState(0);

  const currentMappings = config.gcuidIntegration.attributeMappings;
  const viewRows = editing ? rows : toRows(currentMappings);

  const startEdit = () => {
    const r = toRows(currentMappings);
    setRows(r);
    setNextId(r.length);
    setEditing(true);
  };

  const cancel = () => setEditing(false);

  const addRow = () => {
    setRows(rs => [...rs, { id: nextId, caes: '', source: '' }]);
    setNextId(n => n + 1);
  };

  const removeRow = (id: number) => setRows(rs => rs.filter(r => r.id !== id));

  const updateRow = (id: number, field: 'caes' | 'source', value: string) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r));

  const save = () => {
    const mappings: Record<string, string> = {};
    for (const r of rows) {
      if (r.caes.trim() && r.source.trim()) {
        mappings[r.caes.trim()] = r.source.trim();
      }
    }
    onSave(mappings);
    setEditing(false);
  };

  return (
    <div className="rounded-lg border border-ux-border bg-ux-surface overflow-hidden">
      <SectionHeader
        title="Attribute Mappings"
        subtitle="Maps standard CAES / GCUID attribute names to field names in your source system"
        badge={`${Object.keys(currentMappings).length} mapped`}
        editing={editing}
        onEdit={startEdit}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-ux-border bg-ux-surface-alt/50">
              <th className="px-5 py-2.5 text-left font-medium text-ux-text-sub w-1/2">
                CAES / GCUID attribute
              </th>
              <th className="px-5 py-2.5 text-left font-medium text-ux-text-sub">
                Source field name
              </th>
              {editing && <th className="px-3 py-2.5 w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-ux-border/30">
            {viewRows.map(row => (
              <tr key={row.id} className="hover:bg-ux-hover/40">
                <td className="px-5 py-2">
                  {editing
                    ? <input
                        value={row.caes}
                        onChange={e => updateRow(row.id, 'caes', e.target.value)}
                        className="w-full px-2 py-1 font-mono text-xs border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50"
                        placeholder="person.name.given"
                      />
                    : <code className="font-mono text-ux-accent">{row.caes}</code>
                  }
                </td>
                <td className="px-5 py-2">
                  {editing
                    ? <input
                        value={row.source}
                        onChange={e => updateRow(row.id, 'source', e.target.value)}
                        className="w-full px-2 py-1 font-mono text-xs border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50"
                        placeholder="first_name"
                      />
                    : <code className="font-mono text-ux-text">{row.source}</code>
                  }
                </td>
                {editing && (
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => removeRow(row.id)}
                      className="text-red-500 hover:text-red-700 text-sm leading-none"
                      title="Remove mapping"
                    >✕</button>
                  </td>
                )}
              </tr>
            ))}
            {viewRows.length === 0 && (
              <tr>
                <td colSpan={editing ? 3 : 2} className="px-5 py-8 text-center text-xs text-ux-muted">
                  No attribute mappings configured
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="px-5 py-3 border-t border-ux-border/50 flex items-center justify-between gap-2 bg-ux-surface-alt/40">
          <button
            onClick={addRow}
            className="px-3 py-1.5 text-xs font-medium border border-ux-border rounded hover:bg-ux-hover text-ux-text-sub"
          >
            + Add mapping
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium bg-ux-btn text-ux-btn-on rounded hover:brightness-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Apply changes'}
            </button>
            <button
              onClick={cancel}
              className="px-3 py-1.5 text-xs font-medium border border-ux-border rounded hover:bg-ux-hover text-ux-text-sub"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Value Map Sub-editor ─────────────────────────────────────────────────────

function ValueMapEditor({
  map,
  onChange,
}: {
  map: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
}) {
  const pairs = Object.entries(map);

  const addPair = () => onChange({ ...map, '': '' });

  const updateKey = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
  };

  const updateVal = (key: string, val: string) => onChange({ ...map, [key]: val });

  const removePair = (key: string) => {
    const next = { ...map };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="mt-2 pl-3 border-l-2 border-ux-border space-y-1.5">
      <div className="text-xs text-ux-muted mb-1">Value mapping pairs</div>
      {pairs.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={k}
            onChange={e => updateKey(k, e.target.value)}
            className="w-24 px-1.5 py-0.5 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
            placeholder="source code"
          />
          <span className="text-ux-muted text-xs shrink-0">→</span>
          <input
            value={v}
            onChange={e => updateVal(k, e.target.value)}
            className="w-32 px-1.5 py-0.5 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
            placeholder="normalised label"
          />
          <button
            onClick={() => removePair(k)}
            className="text-red-500 hover:text-red-700 text-xs"
            title="Remove entry"
          >✕</button>
        </div>
      ))}
      <button
        onClick={addPair}
        className="text-xs text-ux-accent hover:underline"
      >
        + Add entry
      </button>
    </div>
  );
}

// ─── Pipeline Step Editor ─────────────────────────────────────────────────────

/** Compact inline editor for a single pipeline step (no direction, no nested pipeline). */
function PipelineStepEditor({
  step,
  index,
  onChange,
  onRemove,
}: {
  step: ConnectorTransformation;
  index: number;
  onChange: (s: ConnectorTransformation) => void;
  onRemove: () => void;
}) {
  const changeStepType = (type: ConnectorTransformation['type']) => {
    onChange({
      type,
      map:         type === 'value_map'    ? (step.map ?? {})               : undefined,
      fromFormat:  type === 'date_format'  ? (step.fromFormat ?? '')        : undefined,
      toFormat:    type === 'date_format'  ? (step.toFormat ?? 'YYYY-MM-DD'): undefined,
      pattern:     (type === 'regex_replace' || type === 'conditional') ? (step.pattern ?? '') : undefined,
      replacement: type === 'regex_replace' ? (step.replacement ?? '')      : undefined,
      affixValue:  (type === 'prefix' || type === 'suffix') ? (step.affixValue ?? '') : undefined,
      start:       type === 'substring'    ? (step.start ?? 0)              : undefined,
      end:         type === 'substring'    ? step.end                       : undefined,
      thenValue:   type === 'conditional'  ? (step.thenValue ?? '')         : undefined,
      elseValue:   type === 'conditional'  ? step.elseValue                 : undefined,
      expr:        type === 'expression'   ? (step.expr ?? '')              : undefined,
    });
  };

  return (
    <div className="flex items-start gap-2 pl-3 py-2 border-l-2 border-ux-border">
      {/* Step index */}
      <span className="mt-1.5 text-xs text-ux-muted w-5 shrink-0 text-right">{index + 1}.</span>

      {/* Type selector */}
      <select
        value={step.type}
        onChange={e => changeStepType(e.target.value as ConnectorTransformation['type'])}
        title="Step type"
        className="px-2 py-1 text-xs border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50"
      >
        {PIPELINE_STEP_TYPES.map(t => (
          <option key={t} value={t}>{TRANSFORM_SHORT[t]}</option>
        ))}
      </select>

      {/* Type-specific inline fields */}
      <div className="flex-1 min-w-0 flex flex-wrap gap-2 items-center">
        {(step.type === 'regex_replace' || step.type === 'conditional') && (
          <input
            value={step.pattern ?? ''}
            onChange={e => onChange({ ...step, pattern: e.target.value })}
            placeholder="Regex pattern"
            className="flex-1 min-w-0 px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
          />
        )}
        {step.type === 'regex_replace' && (
          <input
            value={step.replacement ?? ''}
            onChange={e => onChange({ ...step, replacement: e.target.value })}
            placeholder="Replacement ($1…)"
            className="flex-1 min-w-0 px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
          />
        )}
        {(step.type === 'prefix' || step.type === 'suffix') && (
          <input
            value={step.affixValue ?? ''}
            onChange={e => onChange({ ...step, affixValue: e.target.value })}
            placeholder={step.type === 'prefix' ? 'Text to prepend' : 'Text to append'}
            className="flex-1 min-w-0 px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
          />
        )}
        {step.type === 'substring' && (
          <>
            <input
              type="number"
              value={step.start ?? 0}
              min={0}
              onChange={e => onChange({ ...step, start: parseInt(e.target.value, 10) || 0 })}
              placeholder="Start"
              className="w-20 px-2 py-1 text-xs border border-ux-border rounded bg-ux-surface focus:outline-none"
            />
            <input
              type="number"
              value={step.end ?? ''}
              min={0}
              onChange={e => onChange({ ...step, end: e.target.value ? parseInt(e.target.value, 10) : undefined })}
              placeholder="End (opt)"
              className="w-24 px-2 py-1 text-xs border border-ux-border rounded bg-ux-surface focus:outline-none"
            />
          </>
        )}
        {step.type === 'conditional' && (
          <>
            <input
              value={step.thenValue ?? ''}
              onChange={e => onChange({ ...step, thenValue: e.target.value })}
              placeholder="Value if match"
              className="w-32 px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
            />
            <input
              value={step.elseValue ?? ''}
              onChange={e => onChange({ ...step, elseValue: e.target.value || undefined })}
              placeholder="Value if no match (opt)"
              className="w-36 px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
            />
          </>
        )}
        {step.type === 'expression' && (
          <input
            value={step.expr ?? ''}
            onChange={e => onChange({ ...step, expr: e.target.value })}
            placeholder="JEXL expression, e.g. 'EMP-' + value"
            className="flex-1 min-w-0 px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
          />
        )}
        {step.type === 'value_map' && (
          <span className="text-xs text-ux-muted italic">(edit map in view mode above)</span>
        )}
        {step.type === 'date_format' && (
          <>
            <input
              value={step.fromFormat ?? ''}
              onChange={e => onChange({ ...step, fromFormat: e.target.value })}
              placeholder="From (e.g. DD/MM/YYYY)"
              className="w-36 px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
            />
            <span className="text-xs text-ux-muted">→</span>
            <input
              value={step.toFormat ?? 'YYYY-MM-DD'}
              onChange={e => onChange({ ...step, toFormat: e.target.value })}
              placeholder="YYYY-MM-DD"
              className="w-32 px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none"
            />
          </>
        )}
      </div>

      <button
        onClick={onRemove}
        className="mt-1 text-red-500 hover:text-red-700 text-xs shrink-0"
        title="Remove step"
      >✕</button>
    </div>
  );
}

function PipelineEditor({
  steps,
  onChange,
}: {
  steps: ConnectorTransformation[];
  onChange: (steps: ConnectorTransformation[]) => void;
}) {
  const addStep = () => onChange([...steps, { type: 'trim' }]);
  const removeStep = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const updateStep = (i: number, s: ConnectorTransformation) =>
    onChange(steps.map((old, idx) => idx === i ? s : old));

  return (
    <div className="mt-2 space-y-1.5">
      <div className="text-xs text-ux-muted mb-1">Pipeline steps (applied in order)</div>
      {steps.map((step, i) => (
        <PipelineStepEditor
          key={i}
          step={step}
          index={i}
          onChange={s => updateStep(i, s)}
          onRemove={() => removeStep(i)}
        />
      ))}
      {steps.length < 10 && (
        <button
          onClick={addStep}
          className="text-xs text-ux-accent hover:underline pl-8"
        >
          + Add step
        </button>
      )}
    </div>
  );
}

// ─── Transformations Section ──────────────────────────────────────────────────

type TransformRow = { id: number; attribute: string; rule: ConnectorTransformation };

function TransformationsSection({
  config,
  onSave,
  saving,
}: {
  config: ConnectorConfig;
  onSave: (tr: Record<string, ConnectorTransformation>) => void;
  saving: boolean;
}) {
  const toRows = (tr: Record<string, ConnectorTransformation> | undefined): TransformRow[] =>
    Object.entries(tr ?? {}).map(([attr, rule], i) => ({ id: i, attribute: attr, rule: { ...rule } }));

  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<TransformRow[]>([]);
  const [nextId, setNextId] = useState(0);

  const count = Object.keys(config.transformations ?? {}).length;
  const viewRows = editing ? rows : toRows(config.transformations);

  const startEdit = () => {
    const r = toRows(config.transformations);
    setRows(r);
    setNextId(r.length);
    setEditing(true);
  };

  const cancel = () => setEditing(false);

  const addRow = () => {
    setRows(rs => [...rs, { id: nextId, attribute: '', rule: { type: 'trim', direction: 'both' } }]);
    setNextId(n => n + 1);
  };

  const removeRow = (id: number) => setRows(rs => rs.filter(r => r.id !== id));

  const updateAttr = (id: number, attr: string) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, attribute: attr } : r));

  const updateRule = (id: number, rule: ConnectorTransformation) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, rule } : r));

  const save = () => {
    const tr: Record<string, ConnectorTransformation> = {};
    for (const r of rows) {
      if (r.attribute.trim()) tr[r.attribute.trim()] = r.rule;
    }
    onSave(tr);
    setEditing(false);
  };

  const changeType = (id: number, type: ConnectorTransformation['type'], current: ConnectorTransformation) => {
    updateRule(id, {
      type,
      direction:   current.direction ?? 'both',
      description: current.description,
      // Preserve existing values for types that share fields; clear everything else
      map:         type === 'value_map'    ? (current.map ?? {})               : undefined,
      fromFormat:  type === 'date_format'  ? (current.fromFormat ?? '')        : undefined,
      toFormat:    type === 'date_format'  ? (current.toFormat ?? 'YYYY-MM-DD'): undefined,
      pattern:     (type === 'regex_replace' || type === 'conditional') ? (current.pattern ?? '') : undefined,
      replacement: type === 'regex_replace' ? (current.replacement ?? '')      : undefined,
      affixValue:  (type === 'prefix' || type === 'suffix') ? (current.affixValue ?? '') : undefined,
      start:       type === 'substring'    ? (current.start ?? 0)              : undefined,
      end:         type === 'substring'    ? current.end                       : undefined,
      thenValue:   type === 'conditional'  ? (current.thenValue ?? '')         : undefined,
      elseValue:   type === 'conditional'  ? current.elseValue                 : undefined,
      steps:       type === 'pipeline'     ? (current.steps ?? [])             : undefined,
      expr:        type === 'expression'   ? (current.expr ?? '')              : undefined,
    });
  };

  return (
    <div className="rounded-lg border border-ux-border bg-ux-surface overflow-hidden">
      <SectionHeader
        title="Field Transformations"
        subtitle="Optional normalisation rules applied to attribute values before they are stored in CAES"
        badge={count > 0 ? `${count} rule${count !== 1 ? 's' : ''}` : undefined}
        editing={editing}
        onEdit={startEdit}
      />

      {viewRows.length === 0 && !editing ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-ux-text-sub">No transformation rules defined.</p>
          <p className="text-xs text-ux-muted mt-1 max-w-sm mx-auto">
            Transformations normalise raw field values — such as mapping status codes or standardising
            date formats — before they are exposed through CAES attribute queries.
          </p>
          <button
            onClick={startEdit}
            className="mt-4 px-3 py-1.5 text-xs font-medium border border-ux-border rounded hover:bg-ux-hover text-ux-text-sub"
          >
            + Add transformation rules
          </button>
        </div>
      ) : (
        <div className="divide-y divide-ux-border/30">
          {viewRows.map(row => (
            <div key={row.id} className="px-5 py-4">
              {/* Attribute + type row */}
              <div className="flex items-start gap-3">
                <div className="flex-1 grid grid-cols-3 gap-3">
                  {/* Attribute */}
                  <div>
                    <div className="text-xs text-ux-muted mb-1">Attribute</div>
                    {editing
                      ? <input
                          value={row.attribute}
                          onChange={e => updateAttr(row.id, e.target.value)}
                          className="w-full px-2 py-1 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50"
                          placeholder="person.employment.status"
                        />
                      : <code className="text-xs font-mono text-ux-accent">{row.attribute}</code>
                    }
                  </div>

                  {/* Transformation type */}
                  <div>
                    <div className="text-xs text-ux-muted mb-1">Transformation type</div>
                    {editing
                      ? <select
                          value={row.rule.type}
                          onChange={e => changeType(row.id, e.target.value as ConnectorTransformation['type'], row.rule)}
                          title="Transformation type"
                          className="w-full px-2 py-1 text-xs border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50"
                        >
                          {TRANSFORM_TYPES.map(t => (
                            <option key={t} value={t}>{TRANSFORM_SHORT[t]}</option>
                          ))}
                        </select>
                      : <span className="text-xs font-medium text-ux-text">
                          {TRANSFORM_SHORT[row.rule.type]}
                        </span>
                    }
                  </div>

                  {/* Direction */}
                  <div>
                    <div className="text-xs text-ux-muted mb-1">Apply on</div>
                    {editing
                      ? <select
                          value={row.rule.direction ?? 'both'}
                          onChange={e => updateRule(row.id, { ...row.rule, direction: e.target.value as ConnectorTransformation['direction'] })}
                          title="Transformation direction"
                          className="w-full px-2 py-1 text-xs border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50"
                        >
                          {DIRECTION_OPTIONS.map(d => (
                            <option key={d.value} value={d.value}>{d.badge}</option>
                          ))}
                        </select>
                      : (() => {
                          const dir = row.rule.direction ?? 'both';
                          const opt = DIRECTION_OPTIONS.find(d => d.value === dir);
                          return (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                              DIRECTION_BADGE_COLORS[dir] ?? ''
                            }`}>
                              {opt?.badge ?? dir}
                            </span>
                          );
                        })()
                    }
                  </div>
                </div>

                {editing && (
                  <button
                    onClick={() => removeRow(row.id)}
                    className="mt-5 text-red-500 hover:text-red-700 text-sm leading-none shrink-0"
                    title="Remove rule"
                  >✕</button>
                )}
              </div>

              {/* Description */}
              {editing && (
                <div className="mt-2">
                  <input
                    value={row.rule.description ?? ''}
                    onChange={e => updateRule(row.id, { ...row.rule, description: e.target.value || undefined })}
                    className="w-full px-2 py-1 text-xs border border-ux-border rounded bg-ux-surface focus:outline-none"
                    placeholder="Description (e.g. Map single-char HR status codes to readable values)"
                  />
                </div>
              )}
              {!editing && row.rule.description && (
                <p className="mt-1 text-xs text-ux-text-sub">{row.rule.description}</p>
              )}

              {/* Value map entries */}
              {row.rule.type === 'value_map' && (
                editing
                  ? <ValueMapEditor
                      map={row.rule.map ?? {}}
                      onChange={m => updateRule(row.id, { ...row.rule, map: m })}
                    />
                  : (
                    <div className="mt-2">
                      <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs pl-1">
                        {Object.entries(row.rule.map ?? {}).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-1.5 py-0.5">
                            <code className="font-mono text-ux-muted shrink-0">{k}</code>
                            <span className="text-ux-muted shrink-0">→</span>
                            <code className="font-mono text-ux-text">{v}</code>
                          </div>
                        ))}
                      </div>
                      {(row.rule.direction ?? 'both') === 'both' && Object.keys(row.rule.map ?? {}).length > 0 && (
                        <p className="mt-1.5 text-xs text-ux-muted">
                          On write, the map is inverted automatically ({Object.entries(row.rule.map ?? {}).slice(0, 2).map(([k, v]) => `${v}→${k}`).join(', ')}{Object.keys(row.rule.map ?? {}).length > 2 ? '…' : ''}).
                        </p>
                      )}
                    </div>
                  )
              )}

              {/* Date format fields */}
              {row.rule.type === 'date_format' && editing && (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-ux-muted mb-1">From format</div>
                    <InlineInput
                      value={row.rule.fromFormat ?? ''}
                      placeholder="DD/MM/YYYY"
                      onChange={v => updateRule(row.id, { ...row.rule, fromFormat: v })}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-ux-muted mb-1">To format</div>
                    <InlineInput
                      value={row.rule.toFormat ?? 'YYYY-MM-DD'}
                      placeholder="YYYY-MM-DD"
                      onChange={v => updateRule(row.id, { ...row.rule, toFormat: v })}
                    />
                  </div>
                </div>
              )}
              {row.rule.type === 'date_format' && !editing && (
                <div className="mt-1">
                  <p className="text-xs text-ux-muted font-mono">
                    {row.rule.fromFormat ?? '?'} → {row.rule.toFormat ?? 'YYYY-MM-DD'}
                  </p>
                  {(row.rule.direction ?? 'both') === 'both' && (
                    <p className="text-xs text-ux-muted mt-0.5">
                      On write: {row.rule.toFormat ?? 'YYYY-MM-DD'} → {row.rule.fromFormat ?? '?'} (inverted).
                    </p>
                  )}
                </div>
              )}

              {/* Regex replace fields */}
              {row.rule.type === 'regex_replace' && editing && (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-ux-muted mb-1">Pattern (regex)</div>
                    <InlineInput
                      value={row.rule.pattern ?? ''}
                      placeholder="e.g. ^(\w+)-\d+$"
                      onChange={v => updateRule(row.id, { ...row.rule, pattern: v })}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-ux-muted mb-1">Replacement (supports $1, $2…)</div>
                    <InlineInput
                      value={row.rule.replacement ?? ''}
                      placeholder="e.g. $1"
                      onChange={v => updateRule(row.id, { ...row.rule, replacement: v })}
                    />
                  </div>
                </div>
              )}
              {row.rule.type === 'regex_replace' && !editing && (
                <p className="mt-1 text-xs text-ux-muted font-mono">
                  /{row.rule.pattern ?? '?'}/ → {row.rule.replacement ?? '""'}
                </p>
              )}

              {/* Prefix / suffix */}
              {(row.rule.type === 'prefix' || row.rule.type === 'suffix') && editing && (
                <div className="mt-2">
                  <div className="text-xs text-ux-muted mb-1">
                    {row.rule.type === 'prefix' ? 'Text to prepend' : 'Text to append'}
                  </div>
                  <InlineInput
                    value={row.rule.affixValue ?? ''}
                    placeholder={row.rule.type === 'prefix' ? 'e.g. EMP-' : 'e.g. -CA'}
                    onChange={v => updateRule(row.id, { ...row.rule, affixValue: v })}
                  />
                </div>
              )}
              {(row.rule.type === 'prefix' || row.rule.type === 'suffix') && !editing && (
                <p className="mt-1 text-xs text-ux-muted font-mono">
                  {row.rule.type === 'prefix'
                    ? <><code className="text-ux-accent">"{row.rule.affixValue ?? ''}"</code> + value</>
                    : <>value + <code className="text-ux-accent">"{row.rule.affixValue ?? ''}"</code></>
                  }
                </p>
              )}

              {/* Substring */}
              {row.rule.type === 'substring' && editing && (
                <div className="mt-2 flex items-center gap-3">
                  <div>
                    <div className="text-xs text-ux-muted mb-1">Start (0-based)</div>
                    <input
                      type="number"
                      min={0}
                      value={row.rule.start ?? 0}
                      onChange={e => updateRule(row.id, { ...row.rule, start: parseInt(e.target.value, 10) || 0 })}
                      title="Start index"
                      placeholder="0"
                      className="w-24 px-2 py-1 text-xs border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-ux-muted mb-1">End (exclusive, optional)</div>
                    <input
                      type="number"
                      min={0}
                      value={row.rule.end ?? ''}
                      onChange={e => updateRule(row.id, { ...row.rule, end: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                      title="End index"
                      placeholder="to end"
                      className="w-28 px-2 py-1 text-xs border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50"
                    />
                  </div>
                </div>
              )}
              {row.rule.type === 'substring' && !editing && (
                <p className="mt-1 text-xs text-ux-muted">
                  Characters [{row.rule.start ?? 0}…{row.rule.end !== undefined ? row.rule.end : 'end'}]
                </p>
              )}

              {/* Conditional */}
              {row.rule.type === 'conditional' && editing && (
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-ux-muted mb-1">Pattern (regex)</div>
                    <InlineInput
                      value={row.rule.pattern ?? ''}
                      placeholder="e.g. ^A$"
                      onChange={v => updateRule(row.id, { ...row.rule, pattern: v })}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-ux-muted mb-1">Value if matches</div>
                    <InlineInput
                      value={row.rule.thenValue ?? ''}
                      placeholder="Active"
                      onChange={v => updateRule(row.id, { ...row.rule, thenValue: v })}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-ux-muted mb-1">Value if no match (opt)</div>
                    <InlineInput
                      value={row.rule.elseValue ?? ''}
                      placeholder="pass-through"
                      onChange={v => updateRule(row.id, { ...row.rule, elseValue: v || undefined })}
                    />
                  </div>
                </div>
              )}
              {row.rule.type === 'conditional' && !editing && (
                <p className="mt-1 text-xs text-ux-muted font-mono">
                  /{row.rule.pattern ?? '?'}/ ? "{row.rule.thenValue ?? ''}" : {row.rule.elseValue !== undefined ? `"${row.rule.elseValue}"` : 'pass-through'}
                </p>
              )}

              {/* Pipeline */}
              {row.rule.type === 'pipeline' && editing && (
                <PipelineEditor
                  steps={row.rule.steps ?? []}
                  onChange={steps => updateRule(row.id, { ...row.rule, steps })}
                />
              )}
              {row.rule.type === 'pipeline' && !editing && (
                <div className="mt-2 space-y-1 pl-1">
                  {(row.rule.steps ?? []).map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-ux-muted">
                      <span className="text-ux-muted/60 w-5 text-right shrink-0">{i + 1}.</span>
                      <span className="font-medium text-ux-text-sub">{TRANSFORM_SHORT[step.type]}</span>
                      {step.type === 'regex_replace' && (
                        <span className="font-mono">/{step.pattern}/ → {step.replacement ?? '""'}</span>
                      )}
                      {(step.type === 'prefix' || step.type === 'suffix') && (
                        <span className="font-mono">"{step.affixValue ?? ''}"</span>
                      )}
                      {step.type === 'substring' && (
                        <span>[{step.start ?? 0}…{step.end ?? 'end'}]</span>
                      )}
                      {step.type === 'conditional' && (
                        <span className="font-mono">/{step.pattern}/ ? "{step.thenValue}" : {step.elseValue ?? 'pass-through'}</span>
                      )}
                      {step.type === 'expression' && (
                        <span className="font-mono truncate max-w-xs">{step.expr}</span>
                      )}
                    </div>
                  ))}
                  {(row.rule.steps ?? []).length === 0 && (
                    <span className="text-xs text-ux-muted italic">No steps configured</span>
                  )}
                </div>
              )}

              {/* Expression (JEXL) */}
              {row.rule.type === 'expression' && editing && (
                <div className="mt-2">
                  <div className="text-xs text-ux-muted mb-1">
                    JEXL expression — context: <code className="font-mono">value</code>, <code className="font-mono">field</code>
                  </div>
                  <textarea
                    value={row.rule.expr ?? ''}
                    onChange={e => updateRule(row.id, { ...row.rule, expr: e.target.value })}
                    rows={2}
                    placeholder={"e.g. value.length > 0 ? 'EMP-' + value.toUpperCase() : null"}
                    className="w-full px-2 py-1.5 text-xs font-mono border border-ux-border rounded bg-ux-surface focus:outline-none focus:ring-1 focus:ring-ux-accent/50 resize-y"
                  />
                  <p className="mt-1 text-xs text-ux-muted">
                    Safe sandboxed evaluation — no I/O, no globals. Operators: <code>+</code> <code>?</code> <code>|</code> <code>in</code>.
                    Forbidden: <code>require</code>, <code>eval</code>, <code>process</code>. Max 500 chars.
                  </p>
                </div>
              )}
              {row.rule.type === 'expression' && !editing && (
                <pre className="mt-1 text-xs font-mono text-ux-text-sub bg-ux-surface-alt rounded px-2 py-1 overflow-x-auto">
                  {row.rule.expr ?? '(empty)'}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="px-5 py-3 border-t border-ux-border/50 flex items-center justify-between gap-2 bg-ux-surface-alt/40">
          <button
            onClick={addRow}
            className="px-3 py-1.5 text-xs font-medium border border-ux-border rounded hover:bg-ux-hover text-ux-text-sub"
          >
            + Add rule
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium bg-ux-btn text-ux-btn-on rounded hover:brightness-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Apply changes'}
            </button>
            <button
              onClick={cancel}
              className="px-3 py-1.5 text-xs font-medium border border-ux-border rounded hover:bg-ux-hover text-ux-text-sub"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Connector Integration tab — shows and allows editing of a connector's:
 * - Source connection (DB path / API URL, primary table, key field)
 * - Attribute mappings (CAES attribute name → source field name)
 * - Field transformations (normalisation rules per attribute)
 *
 * Pass the connector JSON file ID (e.g. "conn-hr", "conn-ldap") as `connectorId`.
 */
export function ConnectorIntegrationTab({ connectorId }: { connectorId: string }) {
  const queryClient = useQueryClient();

  const { data: config, isLoading, error } = useQuery({
    queryKey: ['connector-config', connectorId],
    queryFn: () => connectorsApi.get(connectorId),
  });

  const saveMutation = useMutation({
    mutationFn: (patch: ConnectorPatch) => connectorsApi.update(connectorId, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connector-config', connectorId] }),
  });

  if (isLoading) return <LoadingSpinner message="Loading connector integration configuration…" />;
  if (error)     return <ErrorMessage message={error instanceof Error ? error.message : 'Failed to load connector configuration'} />;
  if (!config)   return null;

  return (
    <div className="space-y-6">

      {/* Save error banner */}
      {saveMutation.isError && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3">
          {saveMutation.error instanceof Error ? saveMutation.error.message : 'Save failed — please try again'}
        </div>
      )}

      {/* Intro callout */}
      <div className="bg-ux-surface-alt border border-ux-border rounded-lg px-5 py-3 text-sm text-ux-text-sub">
        <strong className="text-ux-text">Integration configuration for {config.displayName}.</strong>{' '}
        Changes here update the connector's JSON configuration file and take effect at the next connector restart.
        Attribute mappings are synchronised to CAES when you click{' '}
        <span className="font-medium text-ux-text">Register mappings</span> in the Connector Status tab.
      </div>

      <SourceConnectionSection
        config={config}
        onSave={sc => saveMutation.mutate({ sourceConnection: sc })}
        saving={saveMutation.isPending}
      />

      <AttributeMappingsSection
        config={config}
        onSave={am => saveMutation.mutate({ gcuidIntegration: { attributeMappings: am } })}
        saving={saveMutation.isPending}
      />

      <TransformationsSection
        config={config}
        onSave={tr => saveMutation.mutate({ transformations: tr })}
        saving={saveMutation.isPending}
      />
    </div>
  );
}
