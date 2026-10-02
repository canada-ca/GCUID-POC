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
import { policiesApi, AppPolicy } from '../api/client';
import { UXScopeWrapper } from '../context/UXThemeContext';

// ─── Static app metadata ──────────────────────────────────────────────────────

const APPS = [
  { appId: 'budget',      name: 'Budget Compass',     emoji: '💰', accentColor: '#f97316' },
  { appId: 'projects',    name: 'Project Hub',         emoji: '📋', accentColor: '#fb923c' },
  { appId: 'travel',      name: 'Travel & Expense',    emoji: '✈️', accentColor: '#f98a18' },
  { appId: 'assets',      name: 'Asset Registry',      emoji: '🗄️', accentColor: '#ea6320' },
  { appId: 'hrconnect',   name: 'HR Connect',          emoji: '👤', accentColor: '#e87c3e' },
  { appId: 'procurement', name: 'Procurement Portal',  emoji: '🛒', accentColor: '#c2410c' },
];

// ─── Source system options ────────────────────────────────────────────────────

const SOURCE_SYSTEMS = [
  { value: 'hr',          label: 'HR System',              hint: 'Authoritative HR source — employee records' },
  { value: 'ldap',        label: 'LDAP / Active Directory', hint: 'Network directory — user accounts' },
  { value: 'engineering', label: 'Engineering Dept',        hint: 'Engineering dept portal — dept_id accounts' },
  { value: 'finance',     label: 'Finance Dept',            hint: 'Finance dept portal — dept_id accounts' },
];

const CREDENTIAL_FIELDS: Record<string, { field: string; label: string }[]> = {
  hr:          [{ field: 'employee_id', label: 'Employee ID' }],
  ldap:        [{ field: 'username',    label: 'Network Username' }],
  engineering: [{ field: 'dept_id',     label: 'Engineering Dept ID' }],
  finance:     [{ field: 'dept_id',     label: 'Finance Dept ID' }],
};

const ATTRIBUTE_HINTS: Record<string, string[]> = {
  hr:          ['department', 'status', 'first_name'],
  ldap:        ['department', 'account_enabled', 'email'],
  engineering: ['status', 'department'],
  finance:     ['status', 'department'],
};

// ─── Row editor ───────────────────────────────────────────────────────────────

interface RowEditorState {
  source_system:   'hr' | 'ldap' | 'engineering' | 'finance';
  credential_field: string;
  credential_label: string;
  access_type:     'account_exists' | 'attribute_match';
  attribute_key:   string;
  attribute_value: string;
}

function policyToEditorState(p: AppPolicy): RowEditorState {
  return {
    source_system:   p.source_system as RowEditorState['source_system'],
    credential_field: p.credential_field,
    credential_label: p.credential_label,
    access_type:     p.access_type,
    attribute_key:   p.attribute_key ?? '',
    attribute_value: p.attribute_value ?? '',
  };
}

function PolicyRow({
  app,
  policy,
  onSave,
  onReset,
  isSaving,
}: {
  app: typeof APPS[0];
  policy: AppPolicy;
  onSave: (appId: string, state: RowEditorState) => void;
  onReset: (appId: string) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing]   = useState(false);
  const [state, setState]       = useState<RowEditorState>(() => policyToEditorState(policy));
  const [testResult, setTestResult] = useState<string | null>(null);

  // Reset editor state if policy changes from outside
  useEffect(() => { setState(policyToEditorState(policy)); }, [policy]);

  function handleSourceChange(newSource: 'hr' | 'ldap' | 'engineering' | 'finance') {
    const fields = CREDENTIAL_FIELDS[newSource];
    setState(s => ({
      ...s,
      source_system:   newSource,
      credential_field: fields[0].field,
      credential_label: fields[0].label,
    }));
  }

  function handleSave() {
    onSave(app.appId, state);
    setEditing(false);
  }

  function handleCancel() {
    setState(policyToEditorState(policy));
    setEditing(false);
    setTestResult(null);
  }

  const isConfigured = !!policy.updated_at;
  const credFields = CREDENTIAL_FIELDS[state.source_system];
  const attrHints  = ATTRIBUTE_HINTS[state.source_system] ?? [];

  const inputClass = "text-sm px-2 py-1.5 rounded border border-ux-border bg-ux-input text-ux-text focus:outline-none focus:ring-1 focus:ring-orange-400 w-full";
  const selectClass = inputClass;

  return (
    <div
      className="rounded-xl border bg-ux-bg-surface overflow-hidden"
      style={{ borderColor: `color-mix(in srgb, ${app.accentColor} ${editing ? '35%' : '15%'}, var(--ux-border-default))` }}
    >
      {/* App header row */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: `color-mix(in srgb, ${app.accentColor} 7%, var(--ux-bg-surface))` }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{app.emoji}</span>
          <div>
            <h3 className="text-sm font-semibold text-ux-text">{app.name}</h3>
            <p className="text-xs text-ux-text-muted">
              {policy.source_system.toUpperCase()} · {policy.credential_field} ·{' '}
              {policy.access_type === 'account_exists' ? 'Account exists' : `${policy.attribute_key} = ${policy.attribute_value}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConfigured && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${app.accentColor} 15%, transparent)`, color: app.accentColor }}>
              Custom
            </span>
          )}
          {!editing && (
            <>
              <button
                onClick={() => { setEditing(true); setTestResult(null); }}
                className="text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors hover:bg-ux-bg-hover"
                style={{ borderColor: `color-mix(in srgb, ${app.accentColor} 40%, transparent)`, color: app.accentColor }}
              >
                Edit Policy
              </button>
              {isConfigured && (
                <button
                  onClick={() => onReset(app.appId)}
                  className="text-xs px-2 py-1.5 rounded-lg border border-ux-border text-ux-text-muted hover:bg-ux-bg-hover transition-colors"
                  title="Reset to default policy"
                >
                  Reset
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Editor panel */}
      {editing && (
        <div className="px-4 py-4 space-y-4 border-t border-ux-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Source System */}
            <div>
              <label className="block text-xs font-medium text-ux-text-sub mb-1">Authoritative Source</label>
              <select
                className={selectClass}
                value={state.source_system}
                onChange={e => handleSourceChange(e.target.value as RowEditorState['source_system'])}
              >
                {SOURCE_SYSTEMS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-ux-text-muted mt-1">{SOURCE_SYSTEMS.find(s => s.value === state.source_system)?.hint}</p>
            </div>

            {/* Credential field */}
            <div>
              <label className="block text-xs font-medium text-ux-text-sub mb-1">Login Identifier Field</label>
              <select
                className={selectClass}
                value={state.credential_field}
                onChange={e => {
                  const chosen = credFields.find(f => f.field === e.target.value)!;
                  setState(s => ({ ...s, credential_field: chosen.field, credential_label: chosen.label }));
                }}
              >
                {credFields.map(f => (
                  <option key={f.field} value={f.field}>{f.field} — "{f.label}"</option>
                ))}
              </select>
              <p className="text-[11px] text-ux-text-muted mt-1">Login form label: <span className="font-mono">{state.credential_label}</span></p>
            </div>

            {/* Access type */}
            <div>
              <label className="block text-xs font-medium text-ux-text-sub mb-1">Access Rule</label>
              <div className="flex gap-3 mt-1">
                {(['account_exists', 'attribute_match'] as const).map(at => (
                  <label key={at} className="flex items-center gap-2 cursor-pointer text-sm text-ux-text">
                    <input
                      type="radio"
                      name={`access-type-${app.appId}`}
                      value={at}
                      checked={state.access_type === at}
                      onChange={() => setState(s => ({ ...s, access_type: at }))}
                      className="accent-orange-500"
                    />
                    {at === 'account_exists' ? 'Account exists' : 'Attribute match'}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Attribute match sub-form */}
          {state.access_type === 'attribute_match' && (
            <div className="rounded-lg border border-ux-border p-3 space-y-3 bg-ux-bg-surface-alt">
              <p className="text-xs text-ux-text-sub font-medium">Attribute Match Condition</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-ux-text-muted mb-1">Attribute Key</label>
                  <input
                    className={inputClass}
                    list={`attr-hints-${app.appId}`}
                    value={state.attribute_key}
                    onChange={e => setState(s => ({ ...s, attribute_key: e.target.value }))}
                    placeholder="e.g. department"
                  />
                  <datalist id={`attr-hints-${app.appId}`}>
                    {attrHints.map(h => <option key={h} value={h} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-[11px] text-ux-text-muted mb-1">Expected Value</label>
                  <input
                    className={inputClass}
                    value={state.attribute_value}
                    onChange={e => setState(s => ({ ...s, attribute_value: e.target.value }))}
                    placeholder="e.g. Human Resources"
                  />
                </div>
              </div>
              <p className="text-[11px] text-ux-text-muted">
                Access is granted only if the source record's <span className="font-mono text-ux-text">{state.attribute_key || 'attribute'}</span> equals <span className="font-mono text-ux-text">"{state.attribute_value || '...'}"</span> (case-insensitive).
              </p>
            </div>
          )}

          {testResult && (
            <div className={`text-xs rounded-md px-3 py-2 ${testResult.startsWith('✅') ? 'bg-ux-status-success-bg text-ux-status-success border border-ux-status-success-border' : 'bg-ux-status-error-bg text-ux-status-error border border-ux-status-error-border'}`}>
              {testResult}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="text-sm px-4 py-1.5 rounded-lg font-medium text-white transition-opacity disabled:opacity-50"
              style={{ backgroundColor: app.accentColor }}
            >
              {isSaving ? 'Saving…' : 'Save Policy'}
            </button>
            <button
              onClick={handleCancel}
              className="text-sm px-3 py-1.5 rounded-lg border border-ux-border text-ux-text-sub hover:bg-ux-bg-hover transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PolicyPortal() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['policies'],
    queryFn:  () => policiesApi.list(),
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: ({ appId, state }: { appId: string; state: RowEditorState }) =>
      policiesApi.save(appId, {
        source_system:   state.source_system,
        credential_field: state.credential_field,
        credential_label: state.credential_label,
        access_type:     state.access_type,
        attribute_key:   state.attribute_key || null,
        attribute_value: state.attribute_value || null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const resetMutation = useMutation({
    mutationFn: (appId: string) => policiesApi.reset(appId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const policiesByAppId = Object.fromEntries(
    (data?.policies ?? []).map(p => [p.app_id, p])
  );

  return (
    <UXScopeWrapper scopeId="portal-system">
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ux-text">Application Access Policies</h1>
        <p className="text-ux-text-sub mt-1 max-w-2xl">
          Define which authoritative source system controls access to each corporate application.
          When a user opens an application, they are prompted to authenticate with their account in the configured source.
          Access is determined by account existence or specific attribute values — not by the GCUID directly.
        </p>
      </div>

      {/* Architecture note */}
      <div className="rounded-lg border border-ux-border bg-ux-bg-surface-alt p-4 text-sm text-ux-text-sub space-y-1">
        <p className="font-medium text-ux-text">🔐 How Policy-Based Access Works</p>
        <ul className="list-disc list-inside space-y-0.5 text-xs">
          <li>Each application is configured with a single <span className="font-medium text-ux-text">source system</span> (HR, LDAP, Engineering, or Finance).</li>
          <li>Users log in using their account identifier in that source (Employee ID, username, or dept ID).</li>
          <li>The system validates the credential against the source system's records.</li>
          <li>If <span className="font-mono text-ux-text">account_exists</span>: any active account in the source grants entry.</li>
          <li>If <span className="font-mono text-ux-text">attribute_match</span>: the account must also have a specific attribute value (e.g., department = Finance).</li>
          <li>Once authenticated, CAES resolves the user's canonical attributes to determine their <span className="font-medium text-ux-text">access level</span> within the app.</li>
          <li>The GCUID is used only for attribute resolution — not as the login credential.</li>
        </ul>
      </div>

      {/* Policy rows */}
      {isLoading && <p className="text-sm text-ux-text-muted">Loading policies…</p>}
      {error && <p className="text-sm text-ux-status-error">Failed to load policies.</p>}

      {!isLoading && (
        <div className="space-y-4">
          {APPS.map(app => {
            const policy = policiesByAppId[app.appId];
            if (!policy) return null;
            return (
              <PolicyRow
                key={app.appId}
                app={app}
                policy={policy}
                isSaving={saveMutation.isPending}
                onSave={(appId, state) => saveMutation.mutate({ appId, state })}
                onReset={appId => resetMutation.mutate(appId)}
              />
            );
          })}
        </div>
      )}

      {/* Reference: source system schemas */}
      <div className="rounded-xl border border-ux-border bg-ux-bg-surface p-5 space-y-3">
        <h2 className="text-sm font-semibold text-ux-text">Source System Credential Reference</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { system: 'HR System', key: 'employee_id', example: 'EMP-001', extras: ['department', 'status', 'email'], color: 'text-blue-600 dark:text-blue-400' },
            { system: 'LDAP / AD', key: 'username', example: 'jsmith', extras: ['department', 'account_enabled', 'email'], color: 'text-violet-600 dark:text-violet-400' },
            { system: 'Engineering', key: 'dept_id', example: 'ENG-001', extras: ['status', 'hr_employee_id', 'ldap_username'], color: 'text-emerald-600 dark:text-emerald-400' },
            { system: 'Finance', key: 'dept_id', example: 'FIN-001', extras: ['status', 'hr_employee_id', 'ldap_username'], color: 'text-amber-600 dark:text-amber-400' },
          ].map(s => (
            <div key={s.system} className="rounded-lg bg-ux-bg-surface-alt p-3 text-xs space-y-1.5">
              <p className={`font-semibold ${s.color}`}>{s.system}</p>
              <p className="text-ux-text-sub">Login field: <span className="font-mono text-ux-text">{s.key}</span></p>
              <p className="text-ux-text-muted">Example: <span className="font-mono">{s.example}</span></p>
              <div>
                <p className="text-ux-text-muted font-medium">Available attributes:</p>
                <ul className="mt-0.5 space-y-0.5">
                  {s.extras.map(a => <li key={a} className="font-mono text-ux-text">{a}</li>)}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    </UXScopeWrapper>
  );
}
