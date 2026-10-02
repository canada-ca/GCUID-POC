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
import { useMutation } from '@tanstack/react-query';
import { registrationApi, RegistrationFormData, RegistrationResult, RegistrationOutcome } from '../api/client';
import StateBadge from '../components/StateBadge';
import CopyButton from '../components/CopyButton';
import { UXScopeWrapper } from '../context/UXThemeContext';

// ─── Source system options the user can pick when providing a dept ID ─────────
const DEPT_SOURCES = [
  { value: 'hr',          label: 'HR System (Employee ID)' },
  { value: 'ldap',        label: 'LDAP / Active Directory (Username)' },
  { value: 'engineering', label: 'Engineering Department' },
  { value: 'finance',     label: 'Finance Department' },
];

// ─── Outcome configuration ───────────────────────────────────────────────────

interface OutcomeConfig {
  icon: string;
  heading: string;
  borderColor: string;
  bgColor: string;
  iconColor: string;
}

const OUTCOME_CONFIG: Record<RegistrationOutcome, OutcomeConfig> = {
  gcuid_exists: {
    icon: '✓',
    heading: 'GCUID Already Exists',
    borderColor: 'border-green-300 dark:border-green-700',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    iconColor: 'text-green-700 dark:text-green-400',
  },
  high_confidence_match: {
    icon: '✦',
    heading: 'Identity Matched — Provisional GCUID Created',
    borderColor: 'border-blue-300 dark:border-blue-700',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  low_confidence_match: {
    icon: '⚑',
    heading: 'Possible Match Found — Under Review',
    borderColor: 'border-purple-300 dark:border-purple-700',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    iconColor: 'text-purple-600 dark:text-purple-400',
  },
  review_required: {
    icon: '⚑',
    heading: 'Submitted for Review',
    borderColor: 'border-purple-300 dark:border-purple-700',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    iconColor: 'text-purple-600 dark:text-purple-400',
  },
  no_match: {
    icon: '★',
    heading: 'New Identity Registered',
    borderColor: 'border-teal-300 dark:border-teal-700',
    bgColor: 'bg-teal-50 dark:bg-teal-900/20',
    iconColor: 'text-teal-600 dark:text-teal-400',
  },
};

// ─── Next-steps content per outcome ──────────────────────────────────────────

function NextSteps({ outcome }: { outcome: RegistrationOutcome }) {
  if (outcome === 'gcuid_exists') {
    return (
      <p className="text-sm text-ux-text-sub">
        You can use your existing GCUID to access services. Visit the{' '}
        <a href="/user" className="text-teal-600 dark:text-teal-400 underline hover:no-underline">
          User Portal
        </a>{' '}
        to look it up.
      </p>
    );
  }
  if (outcome === 'high_confidence_match') {
    return (
      <div className="space-y-1 text-sm text-ux-text-sub">
        <p>Your identity has been matched against our authoritative sources.</p>
        <p>
          Your provisional GCUID is now in the approval queue. An administrator will confirm the
          link between your GCUID and your existing records.
        </p>
        <p className="font-medium text-ux-text">
          Expected state transitions: <span className="font-mono text-xs">provisional → active</span>
        </p>
      </div>
    );
  }
  if (outcome === 'low_confidence_match' || outcome === 'review_required') {
    return (
      <div className="space-y-1 text-sm text-ux-text-sub">
        <p>
          Possible existing records were found that may match your details. Your registration has
          been placed in the <strong>under_review</strong> state.
        </p>
        <p>An administrator will compare the candidate records and either approve or reject the link.</p>
        <p className="font-medium text-ux-text">
          Expected state transitions:{' '}
          <span className="font-mono text-xs">under_review → active</span> or{' '}
          <span className="font-mono text-xs">under_review → provisional</span>
        </p>
      </div>
    );
  }
  // no_match
  return (
    <div className="space-y-1 text-sm text-ux-text-sub">
      <p>No existing record was found. A fresh provisional GCUID has been created for you.</p>
      <p>
        An administrator will verify your identity and activate your GCUID. You may be contacted
        to provide supporting documentation.
      </p>
      <p className="font-medium text-ux-text">
        Expected state transitions: <span className="font-mono text-xs">provisional → active</span>
      </p>
    </div>
  );
}

// ─── Result panel ─────────────────────────────────────────────────────────────

function ResultPanel({ result, onReset }: { result: RegistrationResult; onReset: () => void }) {
  const cfg = OUTCOME_CONFIG[result.outcome];

  return (
    <div className={`rounded-lg border-2 p-6 ${cfg.borderColor} ${cfg.bgColor}`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <span className={`text-2xl leading-none ${cfg.iconColor}`}>{cfg.icon}</span>
        <div>
          <h3 className="text-lg font-semibold text-ux-text">{cfg.heading}</h3>
          <p className="text-sm text-ux-text-sub mt-0.5">{result.message}</p>
        </div>
      </div>

      {/* GCUID + state */}
      {result.gcuid && (
        <div className="bg-ux-surface rounded-md border border-ux-border p-4 mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ux-text-sub uppercase tracking-wide w-28 shrink-0">
              GCUID
            </span>
            <span className="font-mono text-sm text-ux-text break-all">{result.gcuid}</span>
            <CopyButton value={result.gcuid} label="Copy GCUID" />
          </div>
          {result.identity_state && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-ux-text-sub uppercase tracking-wide w-28 shrink-0">
                Identity State
              </span>
              <StateBadge state={result.identity_state} kind="identity" />
            </div>
          )}
          {result.identifier_state && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-ux-text-sub uppercase tracking-wide w-28 shrink-0">
                Identifier State
              </span>
              <StateBadge state={result.identifier_state} kind="identifier" />
            </div>
          )}
        </div>
      )}

      {/* State transition diagram hint */}
      {result.gcuid && (
        <div className="bg-ux-surface-alt rounded border border-ux-border px-4 py-3 mb-4">
          <p className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide mb-2">
            State Flow
          </p>
          <StateFlowDiagram outcome={result.outcome} />
        </div>
      )}

      {/* Candidate matches */}
      {result.matches && result.matches.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide mb-2">
            Candidate Matches Found
          </p>
          <div className="space-y-2">
            {result.matches.map((m, i) => (
              <div
                key={i}
                className="bg-ux-surface rounded border border-ux-border p-3"
              >
                <div className="flex flex-wrap gap-3 text-sm mb-1">
                  <span>
                    <span className="text-ux-text-sub">Source: </span>
                    <span className="font-medium text-ux-text">{m.sourceSystem}</span>
                  </span>
                  <span>
                    <span className="text-ux-text-sub">ID: </span>
                    <span className="font-mono text-ux-text">{m.sourceId}</span>
                  </span>
                  <span>
                    <span className="text-ux-text-sub">Confidence: </span>
                    <ConfidenceBar confidence={m.confidence} />
                  </span>
                </div>
                {m.strategyDescription && (
                  <p className="text-xs text-ux-text-sub">{m.strategyDescription}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next steps */}
      <div className="border-t border-ux-border pt-4">
        <p className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide mb-2">
          What Happens Next
        </p>
        <NextSteps outcome={result.outcome} />
      </div>

      {/* Reset button */}
      <div className="mt-6">
        <button
          onClick={onReset}
          className="text-sm text-teal-600 dark:text-teal-400 hover:underline"
        >
          ← Start a new registration
        </button>
      </div>
    </div>
  );
}

// ─── Inline confidence bar ────────────────────────────────────────────────────

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(confidence * 100)));
  const color =
    pct >= 90 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-20 h-2 bg-ux-hover rounded-full overflow-hidden">
        <span
          className={`h-full block rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-xs font-medium text-ux-text">{pct}%</span>
    </span>
  );
}

// ─── Inline state-flow diagram ────────────────────────────────────────────────

function StateFlowDiagram({ outcome }: { outcome: RegistrationOutcome }) {
  type Step = { label: string; active?: boolean; dim?: boolean };

  let identitySteps: Step[];
  let identifierSteps: Step[];

  if (outcome === 'gcuid_exists') {
    return (
      <p className="text-xs text-ux-text-sub">
        Existing GCUID — no new state transitions initiated.
      </p>
    );
  }

  if (outcome === 'low_confidence_match' || outcome === 'review_required') {
    identitySteps = [
      { label: 'under_review', active: true },
      { label: 'active', dim: true },
    ];
    identifierSteps = [
      { label: 'reserved', active: true },
      { label: 'issued', dim: true },
    ];
  } else {
    // high_confidence_match and no_match both start provisional
    identitySteps = [
      { label: 'provisional', active: true },
      { label: 'active', dim: true },
    ];
    identifierSteps = [
      { label: 'reserved', active: true },
      { label: 'issued', dim: true },
    ];
  }

  return (
    <div className="space-y-2">
      <FlowRow label="Identity" steps={identitySteps} kind="identity" />
      <FlowRow label="Identifier" steps={identifierSteps} kind="identifier" />
    </div>
  );
}

function FlowRow({
  label,
  steps,
  kind,
}: {
  label: string;
  steps: Array<{ label: string; active?: boolean; dim?: boolean }>;
  kind: 'identity' | 'identifier';
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-ux-text-sub w-16 shrink-0">{label}:</span>
      {steps.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-ux-text-muted text-xs">→</span>}
          {s.active ? (
            <StateBadge state={s.label} kind={kind} />
          ) : (
            <span className="text-xs text-ux-text-muted font-mono">{s.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────────────

// Aligned with the API contract `RegistrationIdentityProof { id, source }`
// in src/api/client.ts. The UI lets a user list any number of these — up to
// all of the identifiers they are known by across departmental systems.
interface IdentityProofEntry {
  source: string;
  id: string;
}

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  // Re-declared here so the local form state references the local entry shape.
  identity_proofs: IdentityProofEntry[];
}

const EMPTY_FORM: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  identity_proofs: [{ source: 'hr', id: '' }],
};

function RegistrationForm({
  onResult,
}: {
  onResult: (result: RegistrationResult) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const mutation = useMutation({
    mutationFn: (data: RegistrationFormData) => registrationApi.register(data),
    onSuccess: (result) => onResult(result),
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function updateProof(index: number, field: keyof IdentityProofEntry, value: string) {
    setForm(prev => {
      const next = [...prev.identity_proofs];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, identity_proofs: next };
    });
  }

  function addProof() {
    setForm(prev => ({
      ...prev,
      identity_proofs: [
        ...prev.identity_proofs,
        { source: 'hr', id: '' },
      ],
    }));
  }

  function removeProof(index: number) {
    setForm(prev => {
      if (prev.identity_proofs.length <= 1) {
        // Keep at least one row so the user can re-add a value; clear instead of removing.
        return {
          ...prev,
        identity_proofs: [{ source: 'hr', id: '' }],
        };
      }
      return {
        ...prev,
        identity_proofs: prev.identity_proofs.filter((_, i) => i !== index),
      };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: RegistrationFormData = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
    };
    // Forward every non-empty (source, id) pair as an identity proof.
    // A user may list any number of these — up to all of the identifiers they are known by.
    const proofs: IdentityProofEntry[] = form.identity_proofs
      .map(p => ({
        source: p.source.trim(),
        id: p.id.trim(),
      }))
      .filter(p => p.id.length > 0);
    if (proofs.length > 0) {
      payload.identity_proofs = proofs;
    }
    mutation.mutate(payload);
  }

  const isValid = form.first_name.trim() && form.last_name.trim() && form.email.trim();

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="first_name"
            className="block text-sm font-medium text-ux-text-sub mb-1"
          >
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            id="first_name"
            name="first_name"
            type="text"
            autoComplete="given-name"
            value={form.first_name}
            onChange={handleChange}
            required
            className="w-full rounded-md border border-ux-border bg-ux-surface px-3 py-2 text-sm text-ux-text placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            placeholder="Jane"
          />
        </div>
        <div>
          <label
            htmlFor="last_name"
            className="block text-sm font-medium text-ux-text-sub mb-1"
          >
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            id="last_name"
            name="last_name"
            type="text"
            autoComplete="family-name"
            value={form.last_name}
            onChange={handleChange}
            required
            className="w-full rounded-md border border-ux-border bg-ux-surface px-3 py-2 text-sm text-ux-text placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            placeholder="Smith"
          />
        </div>
      </div>

      {/* Email */}
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-ux-text-sub mb-1"
        >
          Email Address <span className="text-red-500">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={handleChange}
          required
          className="w-full rounded-md border border-ux-border bg-ux-surface px-3 py-2 text-sm text-ux-text placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          placeholder="jane.smith@department.gc.ca"
        />
        <p className="mt-1 text-xs text-ux-text-sub">
          Used to check if a GCUID already exists and to link your identity record.
        </p>
      </div>

      {/* Departmental identifiers (optional, any number) */}
      <div className="border border-ux-border rounded-md overflow-hidden">
        <div className="px-4 py-3 bg-ux-surface flex items-center justify-between">
          <span className="text-sm font-medium text-ux-text-sub">
            Optional: Departmental Identifiers
          </span>
          <span className="text-xs text-ux-text-sub">
            {form.identity_proofs.filter(p => p.id.trim().length > 0).length} added
          </span>
        </div>
        <div className="px-4 py-4 space-y-3 bg-ux-page/20">
          <p className="text-xs text-ux-text-sub">
            If you know your identifiers in one or more department systems (e.g. employee number,
            username, asset tag), add them here. More identifiers improve matching accuracy. You
            can add as many as you know — or none at all.
          </p>

          {form.identity_proofs.map((proof, index) => (
            <div
              key={index}
              className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-3 items-end"
            >
              <div>
                <label
                  htmlFor={`dept_source_${index}`}
                  className="block text-xs font-medium text-ux-text-sub mb-1"
                >
                  System
                </label>
                <select
                  id={`dept_source_${index}`}
                  name={`dept_source_${index}`}
                  value={proof.source}
                  onChange={e => updateProof(index, 'source', e.target.value)}
                  className="w-full rounded-md border border-ux-border bg-ux-surface px-3 py-2 text-sm text-ux-text focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {DEPT_SOURCES.map(s => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor={`dept_id_${index}`}
                  className="block text-xs font-medium text-ux-text-sub mb-1"
                >
                  Identifier Value
                </label>
                <input
                  id={`dept_id_${index}`}
                  name={`dept_id_${index}`}
                  type="text"
                  value={proof.id}
                  onChange={e => updateProof(index, 'id', e.target.value)}
                  className="w-full rounded-md border border-ux-border bg-ux-surface px-3 py-2 text-sm text-ux-text placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="e.g. EMP001 or jsmith"
                />
              </div>
              <button
                type="button"
                onClick={() => removeProof(index)}
                aria-label={`Remove identifier ${index + 1}`}
                className="h-[38px] px-3 rounded-md border border-ux-border bg-ux-surface text-sm text-ux-text-sub hover:bg-ux-hover hover:text-red-600 dark:hover:text-red-400 transition-colors"
                title="Remove this identifier"
              >
                Remove
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addProof}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 dark:text-teal-400 hover:underline"
          >
            <span aria-hidden="true">+</span>
            <span>Add another identifier</span>
          </button>
        </div>
      </div>

      {/* Error */}
      {mutation.isError && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Registration failed. Please try again.'}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!isValid || mutation.isPending}
        className="w-full sm:w-auto rounded-md px-6 py-2.5 text-sm font-semibold bg-ux-btn text-ux-btn-on hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-ux-accent focus:ring-offset-2"
      >
        {mutation.isPending ? 'Checking…' : 'Check & Register'}
      </button>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HelpDeskRegistrationPortal() {
  const [result, setResult] = useState<RegistrationResult | null>(null);

  return (
    <UXScopeWrapper scopeId="portal-help-desk">
    <div className="max-w-2xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-ux-text">Help Desk Registration</h2>
        <p className="mt-1 text-sm text-ux-text-sub">
          Register a new identity or check whether a GCUID already exists for a constituent.
          </p>
      </div>

      {/* How it works */}
      {!result && (
        <div className="mb-6 bg-ux-info-bg border border-ux-info-border rounded-lg px-5 py-4">
          <h3 className="text-sm font-semibold text-ux-info mb-2">How registration works</h3>
          <ol className="text-sm text-ux-info space-y-1 list-decimal list-inside">
            <li>Your details are checked against the GCUID registry and any linked aliases.</li>
            <li>Your attributes are matched against authoritative source systems (HR, LDAP, etc.).</li>
            <li>
              Based on confidence:
              <ul className="ml-5 mt-1 space-y-0.5 list-disc">
                <li><strong>GCUID already exists</strong> — you're shown your existing identifier.</li>
                <li><strong>High-confidence match</strong> — a provisional GCUID is created, pending approval.</li>
                <li><strong>Possible match</strong> — placed under review for manual verification.</li>
                <li><strong>No match</strong> — a new provisional GCUID is created for you.</li>
              </ul>
            </li>
          </ol>
        </div>
      )}

      {/* Form or result */}
      <div className="bg-ux-surface rounded-lg shadow-sm border border-ux-border p-6">
        {result ? (
          <ResultPanel result={result} onReset={() => setResult(null)} />
        ) : (
          <RegistrationForm onResult={setResult} />
        )}
      </div>
    </div>
    </UXScopeWrapper>
  );
}
