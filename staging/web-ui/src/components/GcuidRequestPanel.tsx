/**
 * GcuidRequestPanel
 * A two-step panel for requesting a GCUID from any authoritative source or
 * department portal.
 *
 * Step 1 — Preview: runs a dry-run CAES match + registry search, presents results
 * Step 2 — Confirm: user selects an action, submits, sees outcome
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  gcuidRequestApi,
  GcuidRequestPreviewResult,
  GcuidRequestSubmitResult,
} from '../api/client.js';

type Step = 'idle' | 'previewing' | 'results' | 'submitting' | 'done' | 'error';

interface Props {
  sourceSystem:  string;
  sourceId:      string;
  /** Attributes to match on: first_name, last_name, email, entity_id, etc. */
  attributes:    Record<string, string>;
  /** Called after a successful submit so the parent can refresh the employee query. */
  onComplete:    () => void;
}

function confidenceBadge(c: number) {
  const pct  = Math.round(c * 100);
  const cls  = c >= 0.90 ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200'
             : c >= 0.50 ? 'bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200'
             :              'bg-red-100 dark:bg-red-800/60 text-red-800 dark:text-red-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {pct}%
    </span>
  );
}

function matchBasisLabel(basis: string) {
  const map: Record<string, string> = {
    source_mapping: 'Already linked',
    email_alias:    'Email match',
    entity_id:      'Employee ID match',
  };
  return map[basis] ?? basis;
}

function recommendationBanner(rec: GcuidRequestPreviewResult['recommendation']) {
  switch (rec) {
    case 'link_existing_strong':
      return { color: 'green',  text: 'High-confidence match found — recommend linking to existing identity' };
    case 'link_existing_weak':
      return { color: 'yellow', text: 'Low-confidence existing match — review before linking' };
    case 'create_strong':
      return { color: 'blue',   text: 'Cross-source match found — recommend creating a new GCUID' };
    case 'create_weak':
      return { color: 'yellow', text: 'Weak match found — a new GCUID will require admin review' };
    case 'create_no_match':
      return { color: 'gray',   text: 'No match found — new GCUID will be created as provisional' };
  }
}

export function GcuidRequestPanel({ sourceSystem, sourceId, attributes, onComplete }: Props) {
  const [step, setStep]               = useState<Step>('idle');
  const [preview, setPreview]         = useState<GcuidRequestPreviewResult | null>(null);
  const [selectedGcuid, setSelectedGcuid] = useState<string | null>(null);
  const [actionChoice, setActionChoice] = useState<'link_existing' | 'create_new' | null>(null);
  const [result, setResult]           = useState<GcuidRequestSubmitResult | null>(null);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: () => gcuidRequestApi.preview({ source_system: sourceSystem, source_id: sourceId, attributes }),
    onSuccess: (data) => {
      setPreview(data);
      // Pre-select recommended action
      if (data.recommendation.startsWith('link_existing') && data.existing_gcuid_matches.length > 0) {
        setActionChoice('link_existing');
        setSelectedGcuid(data.existing_gcuid_matches[0].gcuid);
      } else {
        setActionChoice('create_new');
        setSelectedGcuid(null);
      }
      setStep('results');
    },
    onError: (e: any) => {
      setErrorMsg(e?.message ?? 'Preview failed');
      setStep('error');
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => gcuidRequestApi.submit({
      source_system:  sourceSystem,
      source_id:      sourceId,
      attributes,
      action:         actionChoice!,
      target_gcuid:   actionChoice === 'link_existing' ? selectedGcuid ?? undefined : undefined,
      reason:         'Requested from portal',
    }),
    onSuccess: (data) => {
      setResult(data);
      setStep('done');
      onComplete();
    },
    onError: (e: any) => {
      setErrorMsg(e?.message ?? 'Submit failed');
      setStep('error');
    },
  });

  // ── Idle ───────────────────────────────────────────────────────────────────
  if (step === 'idle') {
    return (
      <div className="p-3 bg-ux-surface border border-ux-border rounded-lg">
        <p className="text-sm text-ux-text-sub mb-3">
          No GCUID assigned. Request one to link this record to the federated identity registry.
        </p>
        <button
          onClick={() => { setStep('previewing'); previewMutation.mutate(); }}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Request GCUID
        </button>
      </div>
    );
  }

  // ── Previewing (loading) ───────────────────────────────────────────────────
  if (step === 'previewing') {
    return (
      <div className="p-3 bg-ux-surface border border-ux-border rounded-lg">
        <div className="flex items-center gap-3 text-sm text-ux-text-sub">
          <svg className="animate-spin h-4 w-4 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Searching for identity matches…
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
        <p className="text-sm text-red-700 dark:text-red-300 mb-2">{errorMsg ?? 'An error occurred'}</p>
        <button
          onClick={() => { setStep('idle'); setErrorMsg(null); }}
          className="text-xs text-red-600 dark:text-red-400 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    return (
      <div className={`p-3 border rounded-lg ${result.needs_review ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700' : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-2 h-2 rounded-full ${result.needs_review ? 'bg-yellow-500' : 'bg-green-500'}`} />
          <span className={`text-sm font-medium ${result.needs_review ? 'text-yellow-800 dark:text-yellow-200' : 'text-green-800 dark:text-green-200'}`}>
            {result.action_taken === 'linked_to_existing' ? 'Linked to existing GCUID' : 'Provisional GCUID created'}
          </span>
          {result.needs_review && (
            <span className="ml-auto px-2 py-0.5 text-xs rounded-full font-medium bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200">
              Pending review
            </span>
          )}
        </div>
        <code className="text-xs font-mono text-ux-text break-all block">{result.gcuid}</code>
        {result.needs_review && (
          <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-2">
            This identity is provisional and requires admin review before it becomes active.
          </p>
        )}
      </div>
    );
  }

  // ── Results (two-step confirm) ────────────────────────────────────────────
  if (step === 'results' && preview) {
    const banner = recommendationBanner(preview.recommendation);
    const bannerCls: Record<string, string> = {
      green:  'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-800 dark:text-green-200',
      blue:   'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-200',
      yellow: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200',
      gray:   'bg-ux-surface-alt border-ux-border text-ux-text-sub',
    };

    const isSubmitting = step === 'results' && submitMutation.isPending;

    return (
      <div className="space-y-3">

        {/* Recommendation banner */}
        <div className={`flex items-start gap-2 p-3 border rounded-lg text-xs ${bannerCls[banner.color]}`}>
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {banner.text}
        </div>

        {/* Existing GCUID candidates */}
        {preview.existing_gcuid_matches.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-ux-text-sub mb-1.5">Existing GCUID matches</p>
            <div className="space-y-1.5">
              {preview.existing_gcuid_matches.map((m) => (
                <label key={m.gcuid}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    actionChoice === 'link_existing' && selectedGcuid === m.gcuid
                      ? 'bg-violet-50 dark:bg-violet-900/30 border-violet-300 dark:border-violet-600'
                      : 'bg-ux-surface border-ux-border hover:border-violet-200 dark:hover:border-violet-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="gcuid-choice"
                    value={m.gcuid}
                    checked={actionChoice === 'link_existing' && selectedGcuid === m.gcuid}
                    onChange={() => { setActionChoice('link_existing'); setSelectedGcuid(m.gcuid); }}
                    className="mt-0.5 accent-violet-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {confidenceBadge(m.confidence)}
                      <span className="text-xs text-ux-text-muted">{matchBasisLabel(m.match_basis)}</span>
                      <span className={`ml-auto px-1.5 py-0.5 text-xs rounded-full font-medium ${
                        m.state === 'active' ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200'
                                             : 'bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200'
                      }`}>{m.state}</span>
                    </div>
                    <code className="text-xs font-mono text-ux-text break-all">{m.gcuid}</code>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* CAES source matches (informational) */}
        {preview.caes_source_matches.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-ux-text-sub mb-1.5">Cross-source matches</p>
            <div className="space-y-1">
              {preview.caes_source_matches.slice(0, 5).map((m, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-ux-surface rounded border border-ux-border text-xs">
                  <span className="font-medium text-ux-text-sub w-20 shrink-0 uppercase">{m.sourceSystem}</span>
                  <code className="text-ux-text-muted truncate">{m.sourceId}</code>
                  <span className="ml-auto shrink-0">{confidenceBadge(m.confidence)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Create new option */}
        <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
          actionChoice === 'create_new'
            ? 'bg-violet-50 dark:bg-violet-900/30 border-violet-300 dark:border-violet-600'
            : 'bg-ux-surface border-ux-border hover:border-violet-200 dark:hover:border-violet-700'
        }`}>
          <input
            type="radio"
            name="gcuid-choice"
            value="create_new"
            checked={actionChoice === 'create_new'}
            onChange={() => { setActionChoice('create_new'); setSelectedGcuid(null); }}
            className="mt-0.5 accent-violet-600"
          />
          <div>
            <p className="text-xs font-semibold text-ux-text">Create a new provisional GCUID</p>
            <p className="text-xs text-ux-text-muted mt-0.5">
              {preview.recommendation === 'create_no_match'
                ? 'No matches found — identity will require admin review before becoming active.'
                : 'A provisional GCUID will be created and may require admin review.'}
            </p>
          </div>
        </label>

        {/* Threshold info */}
        <p className="text-xs text-ux-text-muted">
          Thresholds — strong: {Math.round(preview.thresholds.strong * 100)}%,
          weak: {Math.round(preview.thresholds.weak * 100)}%
        </p>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => submitMutation.mutate()}
            disabled={!actionChoice || isSubmitting}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isSubmitting ? 'Submitting…' : 'Confirm & Submit'}
          </button>
          <button
            onClick={() => { setStep('idle'); setPreview(null); setActionChoice(null); setSelectedGcuid(null); }}
            disabled={isSubmitting}
            className="px-4 py-2 bg-ux-btn2 border border-ux-border text-ux-btn2-on text-sm font-medium rounded-lg hover:brightness-90 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>

        {submitMutation.isError && (
          <p className="text-xs text-red-600 dark:text-red-400">{(submitMutation.error as any)?.message ?? 'Submit failed'}</p>
        )}
      </div>
    );
  }

  return null;
}
