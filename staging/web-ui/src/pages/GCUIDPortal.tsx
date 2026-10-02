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
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, caesApi, systemApi, gcuidRequestApi, Identity, AdminStats, SourceMapping, AttributeResolution, IdentifierStateHistory, GCAlias, RegisterIdentityInput, SourceSystem, SystemVersions, LinkageCandidate, ScanLinkagesResult, StateHistory, AuditTrailEntry } from '../api/client';
import StateBadge from '../components/StateBadge';
import StateDiagram from '../components/StateDiagram';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import CopyButton from '../components/CopyButton';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { useDateTime } from '../context/DateTimeFormatContext';
import { useSortableTable } from '../hooks/useSortableTable';
import { usePagination } from '../hooks/usePagination';
import { SortTh } from '../components/SortTh';
import { Pagination } from '../components/Pagination';
import { UXScopeWrapper } from '../context/UXThemeContext';

// ─── Combined identity + identifier state interpretation ───────────────────────

type Severity = 'normal' | 'info' | 'warning' | 'critical';
interface CombinedStateInfo { meaning: string; implication: string; severity: Severity }

const COMBINED_STATE_MAP: Record<string, CombinedStateInfo> = {
  'provisional:reserved':   { severity: 'info',     meaning: 'Identity record exists but proofing and issuance have not yet been completed.',                                 implication: 'Pre-issuance state. The identifier may expire if onboarding is not completed.' },
  'provisional:issued':     { severity: 'info',     meaning: 'A GCUID has been issued to a subject that has not yet reached full confidence or completed onboarding.',        implication: 'Supports early linkage and controlled progression. Use should remain restricted until Active or Under Review.' },
  'provisional:superseded': { severity: 'warning',  meaning: 'The provisional record was determined to be non-canonical and merged into another identity path.',              implication: 'Redirect references to the surviving GCUID and preserve lineage.' },
  'provisional:nullified':  { severity: 'warning',  meaning: 'The onboarding or registration attempt was abandoned, rejected, or issued in error.',                           implication: 'Identifier retained as a non-reusable tombstone. Record remains for audit and traceability only.' },

  'under_review:reserved':  { severity: 'info',     meaning: 'Subject is under assessment before a GCUID has been released for operational use.',                            implication: 'Internal controlled state pending adjudication, proofing, or conflict resolution.' },
  'under_review:issued':    { severity: 'warning',  meaning: 'Subject has an issued GCUID but the identity is temporarily contained due to suspected duplication or anomaly.', implication: 'Dependent services should treat the subject as restricted while retaining traceability through the issued identifier.' },
  'under_review:superseded':{ severity: 'warning',  meaning: 'Review determined another GCUID is canonical; the current identifier has been superseded.',                     implication: 'Redirect to the surviving GCUID and preserve audit history of the non-canonical path.' },
  'under_review:nullified': { severity: 'critical', meaning: 'Investigation or adjudication determined that the issued GCUID should not remain valid.',                      implication: 'Block further use. Retain record for audit, failed proofing history, or forensic review.' },

  'suspended:reserved':     { severity: 'info',     meaning: 'Subject was placed on hold before the GCUID became operational.',                                              implication: 'Identity locked under governance. No identifier should be exposed to consuming systems.' },
  'suspended:issued':       { severity: 'warning',  meaning: 'Subject remains bound to a valid GCUID but operational use is temporarily restricted.',                        implication: 'Authentication, authorisation, and entitlements may be paused, but the identifier remains the anchor for audit and reinstatement.' },
  'suspended:superseded':   { severity: 'warning',  meaning: 'While the subject is suspended, the prior GCUID has been displaced by a canonical surviving identifier.',      implication: 'Maintain redirect and lineage so that any later reinstatement occurs against the correct canonical record.' },
  'suspended:nullified':    { severity: 'critical', meaning: 'Subject is suspended and the identifier has been invalidated due to erroneous issuance or governance action.', implication: 'Retain both records for traceability. No operational use remains.' },

  'active:reserved':        { severity: 'warning',  meaning: 'A valid subject exists but GCUID issuance has not yet been completed. This should be transitional.',           implication: 'Temporary holding pattern pending issuance or synchronisation.' },
  'active:issued':          { severity: 'normal',   meaning: 'The subject is valid for operational use, and the GCUID is the active enterprise identifier.',                  implication: 'Normal operational pairing. Full participation under applicable GC policies and controls.' },
  'active:superseded':      { severity: 'warning',  meaning: 'The subject remains active but the prior GCUID has been superseded through deduplication or governed merge.',  implication: 'Systems must resolve to the canonical surviving GCUID while preserving continuity of the active subject record.' },
  'active:nullified':       { severity: 'critical', meaning: 'The subject remains valid but the issued GCUID has been invalidated, e.g. due to identifier compromise.',      implication: 'A replacement GCUID may need to be issued under governance. Relying parties must be updated to preserve continuity.' },

  'retired:reserved':       { severity: 'info',     meaning: 'The subject record was closed before the reserved GCUID became operational.',                                  implication: 'Retention only. No operational use or federation exposure.' },
  'retired:issued':         { severity: 'info',     meaning: 'The subject is no longer active, but the GCUID remains associated with the historical record.',                implication: 'Record remains resolvable for audit, lineage, or archival reference. No active entitlements should exist.' },
  'retired:superseded':     { severity: 'info',     meaning: 'The subject is retired and the prior GCUID has been absorbed into a canonical successor path.',                implication: 'Maintain cross-reference for historical reporting, reconciliation, and look-back analysis.' },
  'retired:nullified':      { severity: 'info',     meaning: 'The subject is retired and the identifier has been invalidated under governance.',                             implication: 'Retain for audit and non-reuse only. No valid operational references remain.' },

  'archived:reserved':      { severity: 'info',     meaning: 'A historical subject record exists, but the reserved identifier never progressed to operational issuance.',    implication: 'Cold-retention case only. Not visible to operational services.' },
  'archived:issued':        { severity: 'info',     meaning: 'A historical subject record is retained with its issued GCUID for long-term reference.',                       implication: 'Read-only archival retention under strict access controls.' },
  'archived:superseded':    { severity: 'info',     meaning: 'The archived record points to a legacy GCUID that a new canonical identifier has since overtaken.',            implication: 'Maintain historical traceability and redirect logic where archival queries require lineage resolution.' },
  'archived:nullified':     { severity: 'info',     meaning: 'The subject is archived and the identifier has been invalidated.',                                             implication: 'Retain for audit and non-reuse only. No valid operational references remain.' },
};

const SEVERITY_STYLES: Record<Severity, { bg: string; border: string; icon: string; heading: string; text: string; label: string }> = {
  normal:   { bg: 'bg-ux-success-bg',  border: 'border-ux-success-border',  icon: '✓', heading: 'text-ux-success',  text: 'text-ux-success',  label: 'Normal' },
  info:     { bg: 'bg-ux-info-bg',     border: 'border-ux-info-border',     icon: 'ℹ', heading: 'text-ux-info',     text: 'text-ux-info',     label: 'Informational' },
  warning:  { bg: 'bg-ux-warning-bg',  border: 'border-ux-warning-border',  icon: '⚠', heading: 'text-ux-warning',  text: 'text-ux-warning',  label: 'Attention Required' },
  critical: { bg: 'bg-ux-error-bg',    border: 'border-ux-error-border',    icon: '✕', heading: 'text-ux-error',    text: 'text-ux-error',    label: 'Action Required' },
};

// ─── Avatar initials helper ───────────────────────────────────────────────────

function getAvatarInfo(
  entityType: string,
  metadata: Record<string, unknown> | string | null,
  resolved: AttributeResolution | undefined,
): { initials: string; fullName: string | null } {
  // Try CAES resolved attributes first (most authoritative)
  const rFirst = resolved?.attributes?.first_name?.value as string | undefined;
  const rLast  = resolved?.attributes?.last_name?.value  as string | undefined;
  if (rFirst || rLast) {
    const parts = [rFirst, rLast].filter(Boolean) as string[];
    return {
      initials: parts.map(n => n[0].toUpperCase()).join('') || entityType[0].toUpperCase(),
      fullName: parts.join(' '),
    };
  }
  // Fall back to metadata
  let meta: Record<string, unknown> = {};
  try {
    meta = typeof metadata === 'string'
      ? (JSON.parse(metadata) as Record<string, unknown>)
      : (metadata as Record<string, unknown>) ?? {};
  } catch { /* not parseable — ignore */ }
  const mFirst = meta.first_name as string | undefined;
  const mLast  = meta.last_name  as string | undefined;
  if (mFirst || mLast) {
    const parts = [mFirst, mLast].filter(Boolean) as string[];
    return {
      initials: parts.map(n => n[0].toUpperCase()).join('') || entityType[0].toUpperCase(),
      fullName: parts.join(' '),
    };
  }
  return { initials: entityType?.[0]?.toUpperCase() ?? 'G', fullName: null };
}

/**
 * Render a metadata value, recursing into objects/arrays so the right-pane
 * shows a proper sub-table instead of a `JSON.stringify` blob.
 *
 * Self-register metadata commonly contains a `matches` array of objects;
 * without this renderer each match is rendered as one inline JSON string,
 * which is unreadable (e.g. one self-registered identity had a `record`
 * field containing the entire 13-column HR row as a nested blob).
 *
 * @see staging/CLEANUP.md C-5 — the write-time side of the fix strips the
 *      `record` field before persisting; this renderer is the read-time
 *      side that displays the cleaned-up match summary as a sub-table.
 */
function MetadataValueRenderer({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-ux-text-sub italic">—</span>;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <>{String(value)}</>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-ux-text-sub italic">(empty)</span>;
    }
    // If the array contains objects, render as a sub-table (one row per object)
    if (typeof value[0] === 'object' && value[0] !== null) {
      const allKeys = Array.from(
        new Set(value.flatMap(item =>
          item && typeof item === 'object' ? Object.keys(item as Record<string, unknown>) : []
        ))
      );
      return (
        <table className="text-xs w-full border-collapse">
          <thead>
            <tr className="text-left text-ux-text-sub">
              {allKeys.map(k => (
                <th key={k} className="font-medium px-2 py-1 border-b border-ux-border whitespace-nowrap">{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.map((item, i) => (
              <tr key={i} className="align-top">
                {allKeys.map(k => (
                  <td key={k} className="px-2 py-1 border-b border-ux-border/50 align-top break-words">
                    <MetadataValueRenderer value={(item as Record<string, unknown>)?.[k]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    // Primitive array: render as comma-separated list
    return <>{value.map(String).join(', ')}</>;
  }
  // Plain object: render as a two-column key/value sub-table
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="text-ux-text-sub italic">(empty)</span>;
  }
  return (
    <table className="text-xs border-collapse">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="align-top">
            <td className="pr-2 py-0.5 text-ux-text-sub font-medium whitespace-nowrap">{k}</td>
            <td className="px-2 py-0.5">
              <MetadataValueRenderer value={v} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

export function GCUIDDetailPanel({ gcuid, onClose, onBack }: { gcuid: string; onClose: () => void; onBack?: () => void }) {
  const [actionReason, setActionReason] = useState('');
  const [diagOpen, setDiagOpen] = useState(false);
  const queryClient = useQueryClient();
  const { flags } = useFeatureFlags();
  const { fmt } = useDateTime();

  const { data: identity, isLoading: idLoading, error: idError } = useQuery({
    queryKey: ['gcuid-detail', gcuid],
    queryFn: () => adminApi.viewIdentity(gcuid),
  });

  const { data: sourceMappingData, isLoading: smLoading } = useQuery({
    queryKey: ['gcuid-source-mappings', gcuid],
    queryFn: () => adminApi.getSourceMappings(gcuid),
  });

  const { data: schema } = useQuery({
    queryKey: ['caes-schema'],
    queryFn: caesApi.getSchema,
  });

  const attributeKeys = schema ? Object.keys(schema.attributes) : [];

  const { data: resolved, isLoading: resolveLoading, error: resolveError } = useQuery({
    queryKey: ['gcuid-caes-resolved', gcuid, attributeKeys],
    queryFn: () => caesApi.resolveAttributes(gcuid, attributeKeys),
    enabled: attributeKeys.length > 0,
  });

  // ── Scan-for-linkages state ─────────────────────────────────────────────────
  const [scanResults, setScanResults] = useState<ScanLinkagesResult | null>(null);
  const [dismissedCandidates, setDismissedCandidates] = useState<Set<string>>(new Set());
  const [pendingFromRegistration, setPendingFromRegistration] = useState(false);

  // Pre-populate scan results from candidates captured during self-registration
  useEffect(() => {
    if (!identity || scanResults) return;
    try {
      const meta: Record<string, unknown> =
        typeof identity.metadata === 'string'
          ? JSON.parse(identity.metadata as string)
          : (identity.metadata as Record<string, unknown>) ?? {};
      if (Array.isArray(meta.pending_linkages) && (meta.pending_linkages as unknown[]).length > 0) {
        setScanResults({
          gcuid,
          attributes_used: {
            first_name: (meta.first_name as string) ?? null,
            last_name:  (meta.last_name  as string) ?? null,
            email:      (meta.email      as string) ?? null,
          },
          candidates: meta.pending_linkages as ScanLinkagesResult['candidates'],
        });
        setPendingFromRegistration(true);
      }
    } catch { /* metadata not parseable — ignore */ }
  }, [identity]);

  const scanMutation = useMutation({
    mutationFn: () => gcuidRequestApi.scanLinkages(gcuid),
    onSuccess: (data) => { setScanResults(data); setDismissedCandidates(new Set()); setPendingFromRegistration(false); },
  });

  const acceptLinkageMutation = useMutation({
    mutationFn: ({ source_system, source_id }: { source_system: string; source_id: string }) =>
      adminApi.addSourceMapping(gcuid, source_system, source_id, false),
    onSuccess: (_result, vars) => {
      setDismissedCandidates(prev => new Set([...prev, `${vars.source_system}:${vars.source_id}`]));
      queryClient.invalidateQueries({ queryKey: ['gcuid-source-mappings', gcuid] });
      queryClient.invalidateQueries({ queryKey: ['gcuid-detail', gcuid] });
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['gcuid-identities'] });
    queryClient.invalidateQueries({ queryKey: ['gcuid-stats'] });
    queryClient.invalidateQueries({ queryKey: ['gcuid-detail', gcuid] });
  };

  const invalidateAll = () => { invalidate(); setActionReason(''); };
  const approveMutation = useMutation({
    mutationFn: () => adminApi.approve(gcuid, 'admin', actionReason),
    onSuccess: invalidateAll,
  });
  const flagReviewMutation = useMutation({
    mutationFn: () => adminApi.flagReview(gcuid, actionReason),
    onSuccess: invalidateAll,
  });
  const suspendMutation = useMutation({
    mutationFn: () => adminApi.suspend(gcuid, 'admin', actionReason),
    onSuccess: invalidateAll,
  });
  const clearSuspensionMutation = useMutation({
    mutationFn: () => adminApi.clearSuspension(gcuid, actionReason),
    onSuccess: invalidateAll,
  });
  const retireMutation = useMutation({
    mutationFn: () => adminApi.retire(gcuid, 'admin', actionReason),
    onSuccess: invalidateAll,
  });
  const rehireMutation = useMutation({
    mutationFn: () => adminApi.rehire(gcuid, actionReason),
    onSuccess: invalidateAll,
  });
  const archiveMutation = useMutation({
    mutationFn: () => adminApi.archive(gcuid, actionReason),
    onSuccess: invalidateAll,
  });

  const { data: identifierStateData, refetch: refetchIdentifierState } = useQuery({
    queryKey: ['identifier-state', gcuid],
    queryFn: () => adminApi.getIdentifierState(gcuid),
  });
  const [idReasonInput, setIdReasonInput] = useState('');
  const [supersedeTarget, setSupersedeTarget] = useState('');
  const invalidateIdentifier = () => {
    queryClient.invalidateQueries({ queryKey: ['identifier-state', gcuid] });
    queryClient.invalidateQueries({ queryKey: ['gcuid-detail', gcuid] });
    queryClient.invalidateQueries({ queryKey: ['gcuid-identities'] });
  };
  const bindMutation = useMutation({
    mutationFn: () => adminApi.bindIdentifier(gcuid, idReasonInput || undefined),
    onSuccess: () => { invalidateIdentifier(); setIdReasonInput(''); },
  });
  const nullifyMutation = useMutation({
    mutationFn: () => adminApi.nullifyIdentifier(
      gcuid,
      idReasonInput || undefined,
      identifierStateData?.identifier_state === 'issued' ? 'catastrophic' : 'error',
    ),
    onSuccess: () => { invalidateIdentifier(); setIdReasonInput(''); },
  });
  const supersedeMutation = useMutation({
    mutationFn: () => adminApi.supersedeIdentifier(gcuid, supersedeTarget, idReasonInput || undefined),
    onSuccess: () => { invalidateIdentifier(); setIdReasonInput(''); setSupersedeTarget(''); },
  });

  // Alias management
  const [aliasContext, setAliasContext] = useState('A');
  const [deleteAliasConfirm, setDeleteAliasConfirm] = useState<number | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<string | null>(null);
  const { data: aliases, isLoading: aliasesLoading } = useQuery({
    queryKey: ['gcuid-aliases', gcuid],
    queryFn: () => adminApi.getAliases(gcuid),
  });
  const invalidateAliases = () => {
    queryClient.invalidateQueries({ queryKey: ['gcuid-aliases', gcuid] });
    queryClient.invalidateQueries({ queryKey: ['gcuid-identities'] });
  };
  const generateAliasMutation = useMutation({
    mutationFn: () => adminApi.generateAlias(gcuid, aliasContext),
    onSuccess: invalidateAliases,
  });
  const deriveEmailAliasMutation = useMutation({
    mutationFn: () => adminApi.deriveEmailAlias(gcuid),
    onSuccess: (res) => {
      invalidateAliases();
      // Surface the deduped/created outcome so the user knows whether a new
      // alias was added or an existing one was simply returned.
      if (res?.deduped === false) {
      // Created a new alias.  No toast infra in this panel — the list
      // re-render below is the user-visible signal.
    }
  },
  });
  const deleteAliasMutation = useMutation({
    mutationFn: (id: number) => adminApi.deleteAlias(gcuid, id),
    onSuccess: invalidateAliases,
  });
  const enableAliasMutation = useMutation({
    mutationFn: (id: number) => adminApi.enableAlias(gcuid, id, 'Re-enabled by admin'),
    onSuccess: invalidateAliases,
  });

  // Group resolved attributes by source system for display
  // Build per-attribute list for the new multi-source display
  const attrRows: Array<{
    attr: string;
    schemaDesc: string;
    dataType: string;
    authoritativeSource: string | null;
    values: Array<{ source: string; value: any; is_authoritative: boolean }>;
    isMultiSource: boolean;
  }> = [];

  if (resolved) {
    Object.entries(resolved.attributes).forEach(([attr, info]) => {
      if (!info.values || info.values.length === 0) return;
      const schemaEntry = schema?.attributes?.[attr];
      attrRows.push({
        attr,
        schemaDesc: schemaEntry?.description ?? '',
        dataType: info.dataType,
        authoritativeSource: info.authoritative_source,
        values: info.values,
        isMultiSource: info.values.length > 1,
      });
    });
  }

  const sensitiveAttrs = new Set(
    schema ? Object.entries(schema.attributes).filter(([, v]) => v.sensitive).map(([k]) => k) : []
  );

  const avatarInfo = identity
    ? getAvatarInfo(identity.entity_type, identity.metadata, resolved)
    : { initials: 'G', fullName: null };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black bg-opacity-30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-2xl bg-ux-surface shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-ux-border bg-ux-surface-alt flex-shrink-0">
          <div className="min-w-0 flex-1">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-xs text-ux-nav-label hover:underline mb-1.5"
              >
                ← Back to audit entry
              </button>
            )}
            <h2 className="text-lg font-semibold text-ux-text">GCUID Identity Record</h2>
            <div className="flex items-center gap-1 mt-0.5">
              <p className="text-xs text-ux-text-sub font-mono break-all">{gcuid}</p>
              <CopyButton value={gcuid} label="Copy GCUID" />
            </div>
          </div>
          <button onClick={onClose} className="text-ux-text-sub">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {idLoading && <LoadingSpinner message="Loading identity..." />}
          {idError && <ErrorMessage message={idError instanceof Error ? idError.message : 'Failed to load identity'} />}

          {identity && (
            <>
              {/* Identity banner */}
              <div className="flex items-center gap-4 p-4 bg-ux-accent-subtle border border-ux-accent-subtle-border rounded-lg">
                <div
                  className={
                    avatarInfo.fullName
                      ? 'w-12 h-12 rounded-full bg-ux-btn flex items-center justify-center text-ux-btn-on text-sm font-bold flex-shrink-0'
                      : 'w-12 h-12 rounded-lg border-2 border-dashed border-ux-border-strong bg-ux-surface-alt flex items-center justify-center text-ux-text-sub text-sm italic flex-shrink-0'
                  }
                  title={avatarInfo.fullName ?? identity.entity_type}
                >
                  {avatarInfo.initials}
                </div>
                <div className="min-w-0 flex-1">
                  {avatarInfo.fullName && (
                    <p className="text-sm font-semibold text-ux-text mb-1">{avatarInfo.fullName}</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-ux-text-sub">Identity:</span>
                    <StateBadge state={identity.state} kind="identity" />
                    <span className="text-xs text-ux-muted">·</span>
                    <span className="text-ux-text-sub">Identifier:</span>
                    <StateBadge state={identity.identifier_state ?? 'reserved'} kind="identifier" />
                    <span className="px-2 py-0.5 text-xs font-medium bg-ux-accent-subtle text-ux-nav-label rounded-full capitalize">{identity.entity_type}</span>
                  </div>
                  <div className="text-ux-text-sub">
                    Created {fmt(identity.created_at)}
                    {' · '}Updated {fmt(identity.updated_at)}
                  </div>
                </div>
              </div>

              {/* Identity Metadata */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                  Identity Metadata
                </h3>
                <div className="bg-ux-surface-alt border border-ux-border rounded-lg divide-y divide-ux-border text-sm">
                  <div className="grid grid-cols-3 gap-2 px-4 py-2.5">
                    <span className="text-ux-text-sub font-medium">Entity Type</span>
                    <span className="col-span-2 text-ux-text capitalize">{identity.entity_type}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-4 py-2.5">
                    <span className="text-ux-text-sub font-medium">Identity State</span>
                    <span className="col-span-2 flex items-center gap-2">
                      <StateBadge state={identity.state} kind="identity" />
                      <span className="text-xs text-ux-text-sub">entity lifecycle</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-4 py-2.5">
                    <span className="text-ux-text-sub font-medium">Identifier State</span>
                    <span className="col-span-2 flex items-center gap-2">
                      <StateBadge state={identity.identifier_state ?? 'reserved'} kind="identifier" />
                      <span className="text-xs text-ux-text-sub">token lifecycle</span>
                    </span>
                  </div>
                  {identity.superseded_by && (
                    <div className="grid grid-cols-3 gap-2 px-4 py-2.5 bg-ux-warning-bg">
                      <span className="text-ux-text-sub font-medium">Superseded By</span>
                      <span className="col-span-2 flex items-center gap-1 font-mono text-xs text-ux-warning break-all">{identity.superseded_by}<CopyButton value={identity.superseded_by} label="Copy superseded-by GCUID" /></span>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 px-4 py-2.5">
                    <span className="text-ux-text-sub font-medium">Namespace</span>
                    <span className="col-span-2 font-mono text-ux-text">{identity.namespace || <span className="text-ux-text-sub italic">default</span>}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-4 py-2.5">
                    <span className="text-ux-text-sub font-medium">Created</span>
                    <span className="col-span-2 text-ux-text">{fmt(identity.created_at)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-4 py-2.5">
                    <span className="text-ux-text-sub font-medium">Last Updated</span>
                    <span className="col-span-2 text-ux-text">{fmt(identity.updated_at)}</span>
                  </div>
                  {identity.metadata && (() => {
                    // Keys stored as internal registration scaffolding — already surfaced in the
                    // Source Linkage Scan section below. Hide them from the metadata table.
                    const INTERNAL_META_KEYS = new Set(['pending_linkages', 'first_name', 'last_name', 'email']);
                    let parsed: Record<string, unknown> | null = null;
                    if (typeof identity.metadata === 'object' && identity.metadata !== null) {
                      parsed = identity.metadata as Record<string, unknown>;
                    } else {
                      try { parsed = JSON.parse(identity.metadata as string); } catch { /* ignore */ }
                    }
                    const rawString = typeof identity.metadata === 'string'
                      ? identity.metadata
                      : JSON.stringify(identity.metadata, null, 2);
                    if (parsed) {
                      const visible = Object.entries(parsed).filter(([key]) => !INTERNAL_META_KEYS.has(key));
                      if (visible.length === 0) return null;
                      return visible.map(([key, val]) => {
                        // Complex values (objects/arrays) get a full-width layout — label on its
                        // own row above, value spans the entire width below. This gives
                        // sub-tables enough room to render their columns without wrapping.
                        // Primitives stay on the standard two-column label/value layout.
                        const isComplex = val !== null && typeof val === 'object';
                        return (
                          <div key={key} className={isComplex ? 'px-4 py-2.5' : 'grid grid-cols-3 gap-2 px-4 py-2.5'}>
                            <div className="text-ux-text-sub font-medium capitalize mb-1">{key.replace(/_/g, ' ')}</div>
                            <div className="text-ux-text break-all">
                              <MetadataValueRenderer value={val} />
                            </div>
                          </div>
                        );
                      });
                    }
                    return (
                      <div className="px-4 py-2.5">
                        <span className="text-ux-text-sub font-medium block mb-1">Metadata</span>
                        <pre className="text-xs text-ux-text whitespace-pre-wrap break-all">{rawString}</pre>
                      </div>
                    );
                  })()}
                </div>

                {/* Combined state interpretation card */}
                {(() => {
                  const key = `${identity.state}:${identity.identifier_state ?? 'reserved'}`;
                  const info = COMBINED_STATE_MAP[key];
                  if (!info) return null;
                  const s = SEVERITY_STYLES[info.severity];
                  return (
                    <div className={`mt-3 rounded-lg border p-3 ${s.bg} ${s.border}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`text-xs font-bold ${s.heading}`}>{s.icon} {s.label}</span>
                        <span className="text-xs text-ux-text-sub">— combined state interpretation</span>
                      </div>
                      <p className={`text-xs ${s.heading} font-medium mb-1`}>{info.meaning}</p>
                      <p className={`text-xs ${s.text}`}><span className="font-medium">Operational: </span>{info.implication}</p>
                    </div>
                  );
                })()}
              </section>

              {/* Source Linkages */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                  Source Linkages
                </h3>
                {smLoading && <p className="text-sm text-ux-text-sub">Loading source mappings…</p>}
                {sourceMappingData && sourceMappingData.mappings.length === 0 && (
                  <p className="text-sm text-ux-text-sub italic">No source mappings linked to this GCUID.</p>
                )}
                {sourceMappingData && sourceMappingData.mappings.length > 0 && (
                  <div className="space-y-1">
                    {sourceMappingData.mappings.map((sm: SourceMapping) => (
                      <div key={sm.source_system} className="flex items-center gap-3 px-3 py-2 bg-ux-surface-alt border border-ux-border rounded text-sm">
                        {/* Source system badge — auto-sized to content so longer names
                            like "engineering" or "finance" don't overflow and overlap
                            the source_id value. min-w-20 keeps a consistent visual
                            column when shorter names like "hr" or "ldap" are shown. */}
                        <span className="px-2 py-0.5 bg-ux-info-bg text-ux-info rounded font-medium text-xs uppercase min-w-20 text-center flex-shrink-0">
                          {sm.source_system}
                        </span>
                        <code className="font-mono text-ux-text flex-1">{sm.source_id}</code>
                        {sm.is_primary && (
                          <span className="px-1.5 py-0.5 bg-ux-success-bg text-ux-success rounded text-xs font-medium">primary</span>
                        )}
                        {sm.verified_at && (
                          <span className="text-xs text-ux-text-sub">verified</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Source Linkage Scan */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider">
                    Source Linkage Scan
                  </h3>
                  <button
                    onClick={() => scanMutation.mutate()}
                    disabled={scanMutation.isPending}
                    className="px-3 py-1 text-xs font-medium bg-ux-btn-primary-bg hover:opacity-90 disabled:opacity-50 text-ux-btn-primary-text rounded"
                  >
                    {scanMutation.isPending ? 'Scanning…' : 'Scan for Matches'}
                  </button>
                </div>
                {scanMutation.isError && (
                  <p className="text-sm text-ux-error">Scan failed. Please try again.</p>
                )}
                {pendingFromRegistration && scanResults && (
                  <p className="text-xs text-ux-warning bg-ux-warning-bg border border-ux-warning-border rounded px-3 py-1.5 mb-2">
                    These candidates were identified during self-registration. Accept to link or dismiss to ignore.
                  </p>
                )}
                {scanResults && (() => {
                  const visible = scanResults.candidates.filter(
                    (c: LinkageCandidate) => !dismissedCandidates.has(`${c.source_system}:${c.source_id}`)
                  );
                  return visible.length === 0 ? (
                    <p className="text-sm text-ux-text-sub italic">
                      {scanResults.candidates.length === 0 ? 'No unlinked matches found.' : 'All candidates reviewed.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(scanResults.attributes_used.email || scanResults.attributes_used.first_name) && (
                        <p className="text-xs text-ux-text-muted mb-2">
                          Searched by: {[scanResults.attributes_used.first_name, scanResults.attributes_used.last_name].filter(Boolean).join(' ')}{scanResults.attributes_used.email ? ` · ${scanResults.attributes_used.email}` : ''}
                        </p>
                      )}
                      {visible.map((c: LinkageCandidate) => (
                        <div key={`${c.source_system}:${c.source_id}`} className="flex items-center gap-3 px-3 py-2 bg-ux-warning-bg border border-ux-warning-border rounded text-sm">
                          {/* Source system badge — auto-sized to content so longer names
                              like "engineering" or "finance" don't overflow and overlap
                              the candidate name/value. min-w-20 keeps a consistent
                              visual column when shorter names like "hr" or "ldap" are shown. */}
                          <span className="px-2 py-0.5 bg-ux-warning-bg text-ux-warning rounded font-medium text-xs uppercase min-w-20 text-center flex-shrink-0">{c.source_system}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-ux-text truncate">{c.first_name} {c.last_name}</p>
                            <p className="text-xs text-ux-text-muted truncate">{c.email} · <code>{c.source_id}</code></p>
                            <p className="text-xs text-ux-warning">{Math.round(c.match_score * 100)}% · {c.match_reasons.join(', ')}</p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              onClick={() => acceptLinkageMutation.mutate({ source_system: c.source_system, source_id: c.source_id })}
                              disabled={acceptLinkageMutation.isPending}
                              className="px-2 py-1 text-xs font-medium bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded"
                            >Accept</button>
                            <button
                              onClick={() => setDismissedCandidates(prev => new Set([...prev, `${c.source_system}:${c.source_id}`]))}
                              className="px-2 py-1 text-xs font-medium bg-ux-hover hover:brightness-90 text-ux-text rounded"
                            >Dismiss</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </section>

              {/* GC Aliases */}
              {flags.aliases.generated && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider">GC Aliases</h3>
                  {aliases && aliases.length > 0 && (
                    <span className="text-xs text-ux-text-sub">{aliases.length} alias{aliases.length !== 1 ? 'es' : ''}</span>
                  )}
                </div>
                {aliasesLoading && <p className="text-sm text-ux-text-sub">Loading aliases…</p>}
                {aliases && aliases.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {(aliases as GCAlias[]).map((a) => {
                      const disabled = a.status === 'disabled';
                      const isEmail = a.alias_type === 'email';
                      const isCustom = a.alias_type === 'custom';
                      const rowCls = disabled
                        ? 'bg-ux-surface-alt border-ux-border opacity-60'
                        : isEmail
                          ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-700'
                          : isCustom
                            ? 'bg-ux-accent-subtle border-ux-accent-subtle-border'
                            : 'bg-[#eeeaf3] dark:bg-violet-900/20 border-[#ddd5e7] dark:border-[#674b8a]';
                      const badgeCls = disabled
                        ? 'bg-ux-hover text-ux-text-muted'
                        : isEmail
                          ? 'bg-teal-100 dark:bg-teal-800/60 text-teal-700 dark:text-teal-300'
                          : isCustom
                            ? 'bg-ux-accent-muted text-ux-nav-label'
                            : 'bg-violet-100 dark:bg-violet-800/60 text-violet-700 dark:text-violet-300';
                      const valueCls = disabled
                        ? 'line-through text-ux-text-muted'
                        : isEmail
                          ? 'text-teal-900 dark:text-teal-200'
                          : isCustom
                            ? 'text-ux-text'
                            : 'text-violet-700 dark:text-violet-300';
                      return (
                        <div
                          key={a.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded border ${rowCls}`}
                        >
                          <span className={`px-2 py-0.5 rounded font-medium text-xs uppercase flex-shrink-0 ${badgeCls}`}>
                            {a.alias_type}
                          </span>
                          <code className={`font-mono flex-1 text-xs tracking-wider ${valueCls}`}>{a.alias_value}</code>
                          {disabled && (
                            <span className="text-xs font-medium text-ux-text-muted flex-shrink-0">disabled</span>
                          )}
                          {!disabled && <CopyButton value={a.alias_value} label="Copy alias" />}
                          {disabled ? (
                            <button
                              onClick={() => enableAliasMutation.mutate(a.id)}
                              disabled={enableAliasMutation.isPending}
                              className="text-xs px-2 py-0.5 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/20 flex-shrink-0 disabled:opacity-50"
                            >Re-enable</button>
                          ) : deleteAliasConfirm === a.id ? (
                            <>
                              <button
                                onClick={() => { setDeleteAliasConfirm(null); deleteAliasMutation.mutate(a.id); }}
                                disabled={deleteAliasMutation.isPending}
                                className="text-xs px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 flex-shrink-0"
                              >Confirm</button>
                              <button
                                onClick={() => setDeleteAliasConfirm(null)}
                                className="text-xs px-2 py-0.5 border border-ux-border rounded hover:bg-ux-hover flex-shrink-0"
                              >Cancel</button>
                            </>
                          ) : (
                            <button
                              onClick={() => setDeleteAliasConfirm(a.id)}
                              disabled={deleteAliasMutation.isPending}
                              className="text-xs text-red-400 hover:text-red-600 flex-shrink-0 px-1"
                              title="Disable alias"
                            >✕</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {aliases && aliases.length === 0 && (
                  <p className="text-ux-text-sub">No GC aliases generated yet.</p>
                )}

                {/* Smart "derive email from authoritative source" button.
                    Shows only when:
                      - Email alias feature is enabled
                      - No email alias exists yet for this GCUID
                      - The GCUID has at least one source_mapping for a
                        connector that *might* be authoritative for email.
                        We don't yet know which source is authoritative on
                        the client (that's an attribute_mappings concern);
                        we just check for any LDAP mapping and let the
                        server return 422 if LDAP isn't authoritative.
                */}
                {flags.aliases.email && (() => {
                  const hasEmailAlias = (aliases ?? []).some(a => a.alias_type === 'email' && a.status === 'enabled');
                  const hasLdapMapping = (sourceMappingData?.mappings ?? []).some(
                    m => m.source_system?.toLowerCase() === 'ldap'
                  );
                  if (hasEmailAlias) return null;
                  if (!hasLdapMapping) return null;
                  return (
                    <div className="mt-2 p-3 rounded border border-teal-200 dark:border-teal-700 bg-teal-50 dark:bg-teal-900/20">
                      <p className="text-xs text-ux-text-sub mb-2">
                        No email alias yet, but this identity has an LDAP source mapping. The LDAP record is authoritative for
                        {' '}<code className="font-mono text-xs">person.email</code>{' '}
                        — derive the email alias from the LDAP record now.
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => deriveEmailAliasMutation.mutate()}
                          disabled={deriveEmailAliasMutation.isPending}
                          className="btn bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 text-sm"
                        >
                          {deriveEmailAliasMutation.isPending
                            ? 'Deriving…'
                            : 'Create email alias from LDAP'}
                        </button>
                        {deriveEmailAliasMutation.isError && (
                          <span className="text-xs text-red-600">
                            {(deriveEmailAliasMutation.error as Error).message}
                          </span>
                        )}
                        {deriveEmailAliasMutation.isSuccess && !deriveEmailAliasMutation.data?.deduped && (
                          <span className="text-xs text-teal-700 dark:text-teal-300">
                            ✓ Email alias created.
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex items-center gap-2 flex-wrap mt-3">
                  <select
                    value={aliasContext}
                    onChange={(e) => setAliasContext(e.target.value)}
                    className="input bg-ux-surface text-ux-text text-sm flex-shrink-0 w-36"
                    title="Alias context"
                    aria-label="Alias context"
                  >
                    <option value="A">A — Default</option>
                    <option value="S">S — System</option>
                    <option value="Q">Q — QR Code</option>
                    <option value="T">T — Temporary</option>
                    <option value="P">P — Permanent</option>
                  </select>
                  <button
                    onClick={() => generateAliasMutation.mutate()}
                    disabled={generateAliasMutation.isPending}
                    className="btn bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {generateAliasMutation.isPending ? 'Generating…' : '+ Generate Alias'}
                  </button>
                  {generateAliasMutation.isError && (
                    <span className="text-xs text-red-600">{(generateAliasMutation.error as Error).message}</span>
                  )}
                </div>
              </section>
              )}

              {/* CAES Federated Attributes */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider">
                    CAES Federated Attributes
                  </h3>
                  {resolved && (
                    <span className="text-xs text-ux-text-sub">
                      {attrRows.length} resolved
                      {' · '}sources: {resolved.sources_used.join(', ') || 'none'}
                    </span>
                  )}
                </div>

                {resolveLoading && <LoadingSpinner message="Resolving attributes from sources…" />}

                {resolveError && (
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded text-sm text-yellow-800 dark:text-yellow-200">
                    Could not resolve attributes: {resolveError instanceof Error ? resolveError.message : 'Unknown error'}
                  </div>
                )}

                {resolved && attrRows.length === 0 && (
                  resolved.disabled_sources && resolved.disabled_sources.length > 0 ? (
                    <div className="p-3 bg-ux-surface-alt border border-ux-border rounded text-sm text-ux-text-sub">
                      <p className="font-medium mb-1">🔌 Connector{resolved.disabled_sources.length > 1 ? 's' : ''} disabled — attributes unavailable</p>
                      <p className="text-xs text-ux-muted">
                        The following source{resolved.disabled_sources.length > 1 ? 's are' : ' is'} linked to this identity but{' '}
                        {resolved.disabled_sources.length > 1 ? 'their connectors are' : 'its connector is'} currently disabled:{' '}
                        <span className="font-mono font-medium">{resolved.disabled_sources.join(', ')}</span>.
                        Re-enable the connector{resolved.disabled_sources.length > 1 ? 's' : ''} to restore attribute resolution.
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 bg-ux-surface-alt border border-ux-border rounded text-sm text-ux-text-sub italic">
                      No attribute values could be resolved. This GCUID may not be linked to any authoritative source records.
                    </div>
                  )
                )}

                {/* Attributes grouped by attribute, showing all source values */}
                {attrRows.length > 0 && (
                  <div className="space-y-2">
                    {attrRows.map(({ attr, schemaDesc, dataType, authoritativeSource, values, isMultiSource }) => (
                      <div key={attr} className="border border-ux-border rounded-lg overflow-hidden">
                        {/* Attribute header row */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-ux-surface-alt border-b border-ux-border">
                          <code className="text-xs font-mono text-indigo-700 dark:text-indigo-300 flex-1">{attr}</code>
                          {isMultiSource && (
                            <span className="text-ux-text-sub">
                              {values.length} sources
                            </span>
                          )}
                          <span className="text-xs text-ux-text-sub">{dataType}</span>
                        </div>
                        {schemaDesc && (
                          <p className="text-ux-text-sub">{schemaDesc}</p>
                        )}
                        {/* Source value rows */}
                        <div className={`divide-y divide-ux-border/50 ${schemaDesc ? 'mt-1' : ''}`}>
                          {values.map(({ source, value, is_authoritative }) => (
                            <div
                              key={source}
                              className={`flex items-center gap-3 px-3 py-2 ${
                                is_authoritative
                                  ? 'bg-amber-50 dark:bg-amber-900/20'
                                  : isMultiSource
                                  ? 'bg-ux-surface'
                                  : 'bg-ux-surface'
                              }`}
                            >
                              {/* Source badge — sized to its content so longer names like
                                  ENGINEERING or FINANCE don't overflow the box and overlap
                                  the value. Min-width preserves the visual column when
                                  short names like HR or LDAP are shown. */}
                              <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded min-w-14 text-center flex-shrink-0 ${
                                is_authoritative
                                  ? 'bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200'
                                  : 'bg-ux-hover text-ux-text-sub'
                              }`}>
                                {source}
                              </span>
                              {/* Authoritative star */}
                              {is_authoritative && isMultiSource && (
                                <span className="text-amber-500 text-xs font-bold flex-shrink-0" title={`${source.toUpperCase()} is the authoritative source for this attribute`}>
                                  ★
                                </span>
                              )}
                              {/* Value */}
                              <span className={`text-sm flex-1 ${is_authoritative ? 'text-ux-text font-medium' : 'text-ux-text-sub'}`}>
                                {sensitiveAttrs.has(attr) ? (
                                  <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700 rounded text-xs">
                                    {String(value)} — Sensitive
                                  </span>
                                ) : Array.isArray(value) ? (
                                  <span className="flex flex-wrap gap-1">
                                    {(value as string[]).map((v, i) => (
                                      <span key={i} className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded text-xs">{v}</span>
                                    ))}
                                  </span>
                                ) : (
                                  String(value)
                                )}
                              </span>
                              {/* Non-authoritative note */}
                              {!is_authoritative && isMultiSource && authoritativeSource && (
                                <span className="text-ux-text-sub">
                                  authoritative: <span className="font-medium text-amber-600 dark:text-amber-400">{authoritativeSource.toUpperCase()}</span>
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* State Management */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                  State Management
                </h3>

                {/* Identity entity lifecycle */}
                {identity.state !== 'archived' && (
                  <div className="p-4 bg-ux-surface-alt border border-ux-border rounded-lg space-y-3 mb-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Identity Lifecycle</p>
                      <StateBadge state={identity.state} kind="identity" />
                    </div>
                    <p className="text-xs text-ux-text-sub">Controls the entity's organisational status according to the GC identity state machine.</p>
                    <div>
                      <label className="block text-sm font-medium text-ux-text mb-1">Reason</label>
                      <textarea
                        value={actionReason}
                        onChange={(e) => setActionReason(e.target.value)}
                        className="input bg-ux-surface text-ux-text"
                        rows={2}
                        placeholder="Enter reason for state change…"
                      />
                    </div>
                    <div className="flex gap-2 flex-wrap">

                      {/* provisional → active */}
                      {(identity.state === 'provisional' || identity.state === 'under_review') && (
                        <button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}
                          className="btn bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                          title="Proofing + authoritative linkage met / cleared/corrected">
                          {approveMutation.isPending ? 'Approving…' : '✓ Approve → Active'}
                        </button>
                      )}

                      {/* provisional | active → under_review */}
                      {(identity.state === 'provisional' || identity.state === 'active') && (
                        <button onClick={() => flagReviewMutation.mutate()} disabled={flagReviewMutation.isPending}
                          className="btn bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                          title="Suspected duplicate / anomaly / attribute conflict detected">
                          {flagReviewMutation.isPending ? 'Flagging…' : '⚑ Flag → Under Review'}
                        </button>
                      )}

                      {/* active | under_review → suspended */}
                      {(identity.state === 'active' || identity.state === 'under_review') && (
                        <button onClick={() => suspendMutation.mutate()} disabled={suspendMutation.isPending}
                          className="btn bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
                          title="Deeper investigation / security hold / leave of absence">
                          {suspendMutation.isPending ? 'Suspending…' : '⏸ Suspend'}
                        </button>
                      )}

                      {/* suspended → active (remediation complete) — restorative not destructive */}
                      {identity.state === 'suspended' && (
                        <button onClick={() => clearSuspensionMutation.mutate()} disabled={clearSuspensionMutation.isPending} // destructive-audit-ignore
                          className="btn bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                          title="Remediation complete — lift the suspension and return to active">
                          {clearSuspensionMutation.isPending ? 'Clearing…' : '✓ Clear Suspension → Active'}
                        </button>
                      )}

                      {/* active | suspended → retired */}
                      {(identity.state === 'active' || identity.state === 'suspended') && (
                        <button
                          onClick={() => { if (confirmingAction === 'retire') { setConfirmingAction(null); retireMutation.mutate(); } else { setConfirmingAction('retire'); } }}
                          disabled={retireMutation.isPending}
                          className={`btn disabled:opacity-50 ${confirmingAction === 'retire' ? 'bg-red-700 text-white ring-2 ring-red-400 hover:bg-red-800' : 'bg-red-600 text-white hover:bg-red-700'}`}
                          title="Engagement ended / termination / offboard">
                          {retireMutation.isPending ? 'Retiring…' : confirmingAction === 'retire' ? '■ Confirm Retire?' : '■ Retire'}
                        </button>
                      )}
                      {confirmingAction === 'retire' && (
                        <button onClick={() => setConfirmingAction(null)} className="btn bg-ux-hover text-ux-text-sub hover:bg-gray-300 hover:bg-ux-hover">Cancel</button>
                      )}

                      {/* retired → under_review (rehire / re-engagement — same GCUID, needs re-validation) */}
                      {identity.state === 'retired' && (
                        <button onClick={() => rehireMutation.mutate()} disabled={rehireMutation.isPending}
                          className="btn bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-50"
                          title="Rehire or re-engagement — same GCUID preserved, placed Under Review for re-validation">
                          {rehireMutation.isPending ? 'Re-engaging…' : '↩ Rehire → Under Review'}
                        </button>
                      )}

                      {/* retired → archived */}
                      {identity.state === 'retired' && (
                        <button
                          onClick={() => { if (confirmingAction === 'archive') { setConfirmingAction(null); archiveMutation.mutate(); } else { setConfirmingAction('archive'); } }}
                          disabled={archiveMutation.isPending}
                          className={`btn disabled:opacity-50 ${confirmingAction === 'archive' ? 'bg-red-700 text-white ring-2 ring-red-400 hover:bg-red-800' : 'bg-slate-600 text-white hover:bg-slate-700'}`}
                          title="Retention threshold reached — long-term compliance archive">
                          {archiveMutation.isPending ? 'Archiving…' : confirmingAction === 'archive' ? '🗄 Confirm Archive?' : '🗄 Archive'}
                        </button>
                      )}
                      {confirmingAction === 'archive' && (
                        <button onClick={() => setConfirmingAction(null)} className="btn bg-ux-hover text-ux-text-sub hover:bg-gray-300 hover:bg-ux-hover">Cancel</button>
                      )}
                    </div>

                    {/* Transition guidance note per state */}
                    <div className="text-ux-text-sub">
                      {identity.state === 'provisional' && 'Limited use, heightened monitoring. Awaiting proofing and authoritative linkage.'}
                      {identity.state === 'active' && 'Fully validated, normal operations. Can be suspended, flagged for review, or retired.'}
                      {identity.state === 'under_review' && 'Propagation restricted pending investigation. Can be cleared to Active or escalated to Suspended.'}
                      {identity.state === 'suspended' && 'Operational use restricted; entitlements paused. Clear suspension when remediation is complete, or retire if offboarding.'}
                      {identity.state === 'retired' && 'No longer active. Record retained for audit. Rehire places the identity Under Review for re-validation before reactivation.'}
                    </div>

                    {[approveMutation, flagReviewMutation, suspendMutation, clearSuspensionMutation, retireMutation, rehireMutation, archiveMutation].some(m => m.isSuccess) && (
                      <p className="text-sm text-green-700 dark:text-green-300">Identity state updated successfully.</p>
                    )}
                    {[approveMutation, flagReviewMutation, suspendMutation, clearSuspensionMutation, retireMutation, rehireMutation, archiveMutation].find(m => m.isError) && (
                      <p className="text-sm text-red-600">
                        {([approveMutation, flagReviewMutation, suspendMutation, clearSuspensionMutation, retireMutation, rehireMutation, archiveMutation].find(m => m.isError)?.error as Error)?.message}
                      </p>
                    )}
                  </div>
                )}

                {identity.state === 'archived' && (
                  <div className="p-3 bg-ux-surface-alt border border-ux-border rounded-lg mb-3">
                    <p className="text-xs text-ux-muted italic">This identity is archived. It is immutable and maintained for compliance and audit purposes only.</p>
                  </div>
                )}

                {/* Identifier token lifecycle */}
                {(() => {
                  const ids = identity.identifier_state ?? 'reserved';
                  const isTerminal = ids === 'nullified' || ids === 'superseded';
                  return (
                    <div className="p-4 bg-ux-info-bg border border-ux-info-border rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-ux-info uppercase tracking-wide">Identifier Lifecycle</p>
                        <StateBadge state={ids} kind="identifier" />
                      </div>
                      <p className="text-xs text-ux-info">Controls the GCUID token itself — whether it is valid and in use.</p>
                      {isTerminal ? (
                        <p className="text-xs text-ux-text-sub italic">
                          This identifier is in a terminal state ({ids}) and cannot be transitioned further.
                          {identity.superseded_by && <> Canonical GCUID: <span className="font-mono">{identity.superseded_by}</span></>}
                        </p>
                      ) : (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-ux-text mb-1">Reason</label>
                            <textarea
                              value={idReasonInput}
                              onChange={(e) => setIdReasonInput(e.target.value)}
                              className="input bg-ux-surface text-ux-text"
                              rows={2}
                              placeholder="Enter reason for identifier transition…"
                            />
                          </div>
                          {ids === 'issued' && (
                            <div>
                              <label className="block text-sm font-medium text-ux-text mb-1">Supersede with GCUID</label>
                              <input
                                type="text"
                                value={supersedeTarget}
                                onChange={(e) => setSupersedeTarget(e.target.value)}
                                className="input bg-ux-surface text-ux-text font-mono text-xs"
                                placeholder="urn:gcuid:…"
                              />
                            </div>
                          )}
                          <div className="flex gap-2 flex-wrap">
                            {ids === 'reserved' && (
                              <button
                                onClick={() => bindMutation.mutate()}
                                disabled={bindMutation.isPending}
                                className="btn bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                              >
                                {bindMutation.isPending ? 'Binding…' : 'Bind → Issued'}
                              </button>
                            )}
                            <button
                              onClick={() => { if (confirmingAction === 'nullify') { setConfirmingAction(null); nullifyMutation.mutate(); } else { setConfirmingAction('nullify'); } }}
                              disabled={nullifyMutation.isPending}
                              className={`btn disabled:opacity-50 ${confirmingAction === 'nullify' ? 'bg-red-800 text-white ring-2 ring-red-400 hover:bg-red-900' : 'bg-red-700 text-white hover:bg-red-800'}`}
                            >
                              {nullifyMutation.isPending ? 'Nullifying…' : confirmingAction === 'nullify' ? 'Confirm Nullify?' : ids === 'issued' ? 'Nullify (catastrophic)' : 'Nullify (error)'}
                            </button>
                            {confirmingAction === 'nullify' && (
                              <button onClick={() => setConfirmingAction(null)} className="btn bg-ux-hover text-ux-text-sub hover:bg-gray-300 hover:bg-ux-hover">Cancel</button>
                            )}
                            {ids === 'issued' && (
                              <button
                                onClick={() => { if (confirmingAction === 'supersede') { setConfirmingAction(null); supersedeMutation.mutate(); } else { setConfirmingAction('supersede'); } }}
                                disabled={supersedeMutation.isPending || !supersedeTarget}
                                className={`btn disabled:opacity-50 ${confirmingAction === 'supersede' ? 'bg-red-700 text-white ring-2 ring-red-400 hover:bg-red-800' : 'bg-orange-600 text-white hover:bg-orange-700'}`}
                              >
                                {supersedeMutation.isPending ? 'Superseding…' : confirmingAction === 'supersede' ? 'Confirm Supersede?' : 'Mark Superseded'}
                              </button>
                            )}
                            {confirmingAction === 'supersede' && (
                              <button onClick={() => setConfirmingAction(null)} className="btn bg-ux-hover text-ux-text-sub hover:bg-gray-300 hover:bg-ux-hover">Cancel</button>
                            )}
                          </div>
                          {(bindMutation.isSuccess || nullifyMutation.isSuccess || supersedeMutation.isSuccess) && (
                            <p className="text-sm text-green-700 dark:text-green-300">Identifier state updated successfully.</p>
                          )}
                          {(bindMutation.isError || nullifyMutation.isError || supersedeMutation.isError) && (
                            <p className="text-sm text-red-700 dark:text-red-300">
                              {(bindMutation.error || nullifyMutation.error || supersedeMutation.error)?.message}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}
              </section>

              {/* State Diagrams */}
              <section>
                <button
                  onClick={() => setDiagOpen(o => !o)}
                  className="flex items-center gap-2 text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3 hover:text-gray-600 dark:hover:text-gray-300 transition-colors w-full text-left"
                >
                  <span>{diagOpen ? '▾' : '▸'}</span>
                  State Transition Diagrams
                  <span className="ml-auto text-ux-muted normal-case font-normal tracking-normal">
                    {diagOpen ? 'collapse' : 'expand'}
                  </span>
                </button>
                {diagOpen && (
                  <div className="p-4 bg-ux-surface-alt border border-ux-border rounded-lg">
                    <StateDiagram
                      identityState={identity.state}
                      identifierState={identity.identifier_state ?? 'reserved'}
                    />
                  </div>
                )}
              </section>

              {/* Identity State History */}
              {(identity as any).history && (identity as any).history.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                    Identity State History
                  </h3>
                  <div className="space-y-1">
                    {(identity as any).history.map((h: any) => (
                      <div key={h.id} className="flex items-center gap-3 text-xs px-3 py-1.5 bg-ux-surface-alt rounded">
                        <span className="text-ux-text-sub w-36 flex-shrink-0">{fmt(h.changed_at)}</span>
                        <span className="text-ux-text-sub">{h.from_state ?? 'null'} → </span>
                        <StateBadge state={h.to_state} kind="identity" />
                        <span className="text-ux-text-sub flex-1 truncate">{h.changed_by}</span>
                        {h.reason && <span className="text-ux-text-sub italic truncate">{h.reason}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Identifier State History */}
              {identifierStateData && identifierStateData.history.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                    Identifier State History
                  </h3>
                  <div className="space-y-1">
                    {identifierStateData.history.map((h: IdentifierStateHistory) => (
                      <div key={h.id} className="flex items-center gap-3 text-xs px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded">
                        <span className="text-ux-text-sub w-36 flex-shrink-0">{fmt(h.timestamp)}</span>
                        <span className="text-xs font-medium text-blue-600 uppercase w-20 flex-shrink-0">{h.transition}</span>
                        <span className="text-ux-text-sub">{h.from_state ?? 'null'} → </span>
                        <StateBadge state={h.to_state} kind="identifier" />
                        <span className="text-ux-text-sub flex-1 truncate">{h.changed_by}</span>
                        {h.reason && <span className="text-ux-text-sub italic truncate">{h.reason}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Audit entry detail panel ────────────────────────────────────────────────

const TRANSITION_TYPE_LABELS: Record<string, string> = {
  approve:        'Approval',
  suspend:        'Suspension',
  clear_suspension: 'Suspension Cleared',
  flag_review:    'Flagged for Review',
  retire:         'Retirement',
  rehire:         'Rehire / Reinstatement',
  archive:        'Archival',
  attribute_sync: 'Attribute Sync',
  register:       'Registration',
  bind:           'Identifier Bind',
  nullify:        'Identifier Nullification',
  supersede:      'Identifier Supersession',
};

function AuditTrailRow({ t, fmt, isHighlighted, sourceMark }: {
  t: AuditTrailEntry;
  fmt: (v: string) => string;
  isHighlighted?: boolean;
  sourceMark?: 'predecessor' | 'canonical';
}) {
  const isIdentifier = t.event_source === 'identifier';
  return (
    <div className={`flex gap-3 text-xs relative ${
      isHighlighted
        ? 'rounded-lg bg-ux-accent-subtle ring-1 ring-ux-accent px-2 py-1 -mx-2'
        : isIdentifier ? 'opacity-80' : ''
    }`}>
      {isHighlighted && (
        <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-4/5 rounded-full bg-ux-accent" />
      )}
      <div className="flex flex-col items-center">
        <span className={`w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 ${
          isHighlighted ? 'bg-ux-accent ring-2 ring-ux-accent ring-offset-1' :
          sourceMark === 'canonical' ? 'bg-emerald-400' :
          sourceMark === 'predecessor' ? 'bg-amber-400' :
          isIdentifier ? 'bg-violet-400' : 'bg-ux-accent'
        }`} />
        <div className="w-px flex-1 bg-ux-border mt-1" />
      </div>
      <div className="pb-4 min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            isIdentifier
              ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
              : 'bg-ux-accent-subtle text-ux-nav-label'
          }`}>
            {isIdentifier ? 'identifier' : 'identity'}
          </span>
          {sourceMark && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              sourceMark === 'predecessor'
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
            }`}>
              {sourceMark === 'predecessor' ? 'predecessor' : 'canonical'}
            </span>
          )}
          <span className="text-ux-text-sub">{t.from_state || 'null'}</span>
          <span className="text-ux-text-sub">→</span>
          <StateBadge state={t.to_state} />
          {t.transition && (
            <span className="text-ux-text-muted italic">
              ({TRANSITION_TYPE_LABELS[t.transition] ?? t.transition})
            </span>
          )}
          {isHighlighted && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-ux-accent text-white ml-1">
              this event
            </span>
          )}
        </div>
        <div className="mt-0.5 text-ux-text-sub">{fmt(t.timestamp)} • {t.actor ?? '—'}</div>
        {t.reason && <div className="mt-0.5 text-ux-text-muted">{t.reason}</div>}
      </div>
    </div>
  );
}

function AuditEntryDetailPanel({
  entry,
  onClose,
  onViewIdentity,
}: {
  entry: StateHistory;
  onClose: () => void;
  onViewIdentity: (gcuid: string) => void;
}) {
  const { fmt } = useDateTime();
  const [historyMode, setHistoryMode] = useState<'this' | 'canonical' | 'merged'>('this');

  const { data: gcuidAudit, isLoading: auditLoading } = useQuery({
    queryKey: ['audit-gcuid-detail', entry.gcuid],
    queryFn: () => adminApi.getAuditForGcuid(entry.gcuid),
    staleTime: 0,
  });

  const canonicalGcuid = gcuidAudit?.superseded_by ?? null;
  const { data: canonicalAudit, isLoading: canonicalLoading } = useQuery({
    queryKey: ['audit-gcuid-detail', canonicalGcuid],
    queryFn: () => adminApi.getAuditForGcuid(canonicalGcuid!),
    enabled: !!canonicalGcuid,
    staleTime: 0,
  });

  const displayTrail = useMemo<Array<AuditTrailEntry & { _sourceMark?: 'predecessor' | 'canonical' }>>(() => {
    if (historyMode === 'canonical') return canonicalAudit?.audit_trail ?? [];
    if (historyMode === 'merged') {
      const combined = [
        ...(gcuidAudit?.audit_trail ?? []).map(t => ({ ...t, _sourceMark: 'predecessor' as const })),
        ...(canonicalAudit?.audit_trail ?? []).map(t => ({ ...t, _sourceMark: 'canonical' as const })),
      ];
      return combined.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }
    return gcuidAudit?.audit_trail ?? [];
  }, [historyMode, gcuidAudit, canonicalAudit]);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black bg-opacity-30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-md bg-ux-surface shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-ux-border bg-ux-surface-alt flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ux-text">Audit Entry #{entry.id}</h2>
            <p className="text-xs text-ux-text-sub mt-0.5">State transition record</p>
          </div>
          <button onClick={onClose} className="text-ux-text-sub hover:text-ux-text ml-4">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* GCUID + identity link */}
          <div>
            <p className="text-xs font-medium text-ux-text-sub uppercase tracking-wide mb-1">GCUID</p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-sm text-ux-text break-all">{entry.gcuid}</p>
              <CopyButton value={entry.gcuid} label="Copy GCUID" />
            </div>
            <button
              onClick={() => { onClose(); onViewIdentity(entry.gcuid); }}
              className="mt-1.5 text-sm text-ux-nav-label hover:underline"
            >
              View full identity →
            </button>
          </div>

          {/* Identity snapshot (from rich audit endpoint) */}
          {gcuidAudit && (
            <div className="bg-ux-surface-alt border border-ux-border rounded-lg p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <p className="text-ux-text-sub mb-0.5">Identity state</p>
                <StateBadge state={gcuidAudit.current_state} />
              </div>
              {gcuidAudit.identifier_state && (
                <div>
                  <p className="text-ux-text-sub mb-0.5">Identifier state</p>
                  <StateBadge state={gcuidAudit.identifier_state} />
                </div>
              )}
              {gcuidAudit.entity_id && (
                <div className="col-span-2">
                  <p className="text-ux-text-sub mb-0.5">Entity ID</p>
                  <p className="font-mono text-ux-text">{gcuidAudit.entity_id}</p>
                </div>
              )}
              <div>
                <p className="text-ux-text-sub mb-0.5">Registered</p>
                <p className="text-ux-text">{fmt(gcuidAudit.created)}</p>
              </div>
              {gcuidAudit.superseded_by && (
                <div className="col-span-2">
                  <p className="text-ux-text-sub mb-0.5">Superseded by</p>
                  <button
                    onClick={() => setHistoryMode('canonical')}
                    className="font-mono text-xs text-ux-warning break-all hover:underline text-left w-full"
                    title="Click to view canonical identity's history"
                  >
                    {gcuidAudit.superseded_by}
                  </button>
                  <p className="text-[10px] text-ux-text-muted mt-0.5">↓ click to view canonical history</p>
                </div>
              )}
              {gcuidAudit.supersedes.length > 0 && (
                <div className="col-span-2">
                  <p className="text-ux-text-sub mb-0.5">Supersedes</p>
                  {gcuidAudit.supersedes.map(g => (
                    <p key={g} className="font-mono text-xs text-ux-text-sub break-all">{g}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Selected entry details */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-ux-text uppercase tracking-wide">This Event</p>

            <div>
              <p className="text-xs text-ux-text-sub mb-1">Transition</p>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-xs bg-ux-surface-alt border border-ux-border text-ux-text-sub">
                  {entry.from_state || 'null'}
                </span>
                <span className="text-ux-text-sub">→</span>
                <StateBadge state={entry.to_state} />
              </div>
            </div>

            {entry.transition_type && (
              <div>
                <p className="text-xs text-ux-text-sub mb-1">Operation</p>
                <span className="px-2 py-0.5 rounded text-xs bg-ux-accent-subtle border border-ux-accent-subtle-border text-ux-nav-label">
                  {TRANSITION_TYPE_LABELS[entry.transition_type] ?? entry.transition_type}
                </span>
              </div>
            )}

            <div>
              <p className="text-xs text-ux-text-sub mb-1">Timestamp</p>
              <p className="text-sm text-ux-text">{fmt(entry.changed_at)}</p>
            </div>

            <div>
              <p className="text-xs text-ux-text-sub mb-1">Changed By</p>
              <p className="text-sm text-ux-text">{entry.changed_by || '—'}</p>
            </div>

            <div>
              <p className="text-xs text-ux-text-sub mb-1">Reason</p>
              <p className="text-sm text-ux-text">{entry.reason || '—'}</p>
            </div>
          </div>

          {/* Full audit trail for this GCUID */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-ux-text uppercase tracking-wide">
                {historyMode === 'canonical' ? 'Canonical History' : historyMode === 'merged' ? 'Full Lineage' : 'Full History'}
                <span className="ml-2 font-normal text-ux-text-sub normal-case">
                  ({displayTrail.length} event{displayTrail.length !== 1 ? 's' : ''})
                </span>
              </p>
              {canonicalGcuid && (
                <div className="flex gap-1">
                  {(['this', 'canonical', 'merged'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setHistoryMode(mode)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        historyMode === mode
                          ? 'bg-ux-accent text-white'
                          : 'bg-ux-surface-alt border border-ux-border text-ux-text-sub hover:text-ux-text'
                      }`}
                    >
                      {mode === 'this' ? 'This' : mode === 'canonical' ? 'Canonical' : 'Merged'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {(auditLoading || (historyMode !== 'this' && canonicalLoading)) && (
              <LoadingSpinner message="Loading history…" />
            )}

            {gcuidAudit && (
              <div className="relative">
                {[...displayTrail].reverse().map((t, i) => (
                  <AuditTrailRow
                    key={`${t.event_source}-${t.id}-${t._sourceMark ?? 'this'}-${i}`}
                    t={t}
                    fmt={fmt}
                    isHighlighted={historyMode !== 'canonical' && t.event_source === 'identity' && t.id === entry.id}
                    sourceMark={historyMode === 'merged' ? t._sourceMark : undefined}
                  />
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Main portal ──────────────────────────────────────────────────────────────

// ─── Stats drilldown type ─────────────────────────────────────────────────────
type StatsDrilldown = { dimension: 'state' | 'type'; value: string; label: string; count: number };

export default function GCUIDPortal() {
  const [activeTab, setActiveTab] = useState<'identities' | 'pending-review' | 'duplicates' | 'stats' | 'audit' | 'source-mappings'>('identities');
  const [selectedGCUID, setSelectedGCUID] = useState<string | null>(null);
  const [previousAuditEntry, setPreviousAuditEntry] = useState<StateHistory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [identityStateFilter, setIdentityStateFilter] = useState('');
  const [identifierStateFilter, setIdentifierStateFilter] = useState('');
  const [statsDrilldown, setStatsDrilldown] = useState<StatsDrilldown | null>(null);
  const { flags } = useFeatureFlags();
  const { fmt, fmtDate } = useDateTime();

  // ── Register form state ────────────────────────────────────────────────────
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [regEntityType, setRegEntityType] = useState<RegisterIdentityInput['entity_type']>('person');
  const [regSourceLinks, setRegSourceLinks] = useState<Array<{ source_system: string; source_id: string; is_primary: boolean }>>([]);
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);
  const [smFilter, setSmFilter] = useState('');
  const [smSourceFilter, setSmSourceFilter] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditStateFilter, setAuditStateFilter] = useState('');
  const [selectedAuditEntry, setSelectedAuditEntry] = useState<StateHistory | null>(null);

  const queryClient = useQueryClient();

  // Fetch identities (or search results)
  const { data: identities, isLoading: identitiesLoading, error: identitiesError } = useQuery({
    queryKey: ['gcuid-identities', searchQuery],
    queryFn: searchQuery.trim() ? () => adminApi.searchIdentities(searchQuery.trim()) : adminApi.listIdentities,
  });

  // Fetch stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['gcuid-stats'],
    queryFn: adminApi.getStats,
  });

  // Fetch drilldown identities when a stat card / row is selected
  const { data: drilldownIdentities, isLoading: drilldownLoading } = useQuery({
    queryKey: ['gcuid-drilldown', statsDrilldown?.dimension, statsDrilldown?.value],
    queryFn: () => adminApi.listIdentitiesByFilter(
      statsDrilldown!.dimension === 'state'
        ? { state: statsDrilldown!.value }
        : { entity_type: statsDrilldown!.value }
    ),
    enabled: !!statsDrilldown,
  });
  const { sorted: sortedDrilldown, sortBy: ddSortBy, sortDir: ddSortDir, handleSort: handleDdSort } = useSortableTable(drilldownIdentities, 'created_at', 'desc');
  const { paginated: paginatedDrilldown, page: ddPage, setPage: setDdPage, pageSize: ddPageSize, setPageSize: setDdPageSize, totalPages: ddTotalPages, totalItems: ddTotalItems } = usePagination(sortedDrilldown);

  // Fetch duplicates
  const { data: duplicates, isLoading: duplicatesLoading } = useQuery({
    queryKey: ['duplicates'],
    queryFn: adminApi.detectDuplicates,
  });

  // Fetch audit log
  const { data: auditLog, isLoading: auditLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => adminApi.getAuditLog(),
  });

  const filteredIdentities = (() => {
    const raw = identities;
    if (!raw) return raw;
    let data = raw;
    if (entityTypeFilter) data = data.filter(id => id.entity_type === entityTypeFilter);
    if (identityStateFilter) data = data.filter(id => id.state === identityStateFilter);
    if (identifierStateFilter) data = data.filter(id => (id.identifier_state ?? 'reserved') === identifierStateFilter);
    return data;
  })();
  const { sorted: sortedIdentities, sortBy: idSortBy, sortDir: idSortDir, handleSort: handleIdSort } = useSortableTable(filteredIdentities, 'created_at', 'desc');
  const { paginated: paginatedIdentities, page: idPage, setPage: setIdPage, pageSize: idPageSize, setPageSize: setIdPageSize, totalPages: idTotalPages, totalItems: idTotalItems } = usePagination(sortedIdentities);
  const { sorted: sortedByType, sortBy: typeSortBy, sortDir: typeSortDir, handleSort: handleTypeSort } = useSortableTable(stats?.by_type, 'type');
  const filteredAudit = (() => {
    const raw = auditLog;
    if (!raw) return raw;
    let data = raw;
    const q = auditSearch.trim().toLowerCase();
    if (q) data = data.filter(e =>
      e.gcuid.toLowerCase().includes(q) ||
      e.changed_by.toLowerCase().includes(q) ||
      (e.reason ?? '').toLowerCase().includes(q)
    );
    if (auditStateFilter) data = data.filter(e => e.to_state === auditStateFilter);
    return data;
  })();
  const { sorted: sortedAudit, sortBy: auditSortBy, sortDir: auditSortDir, handleSort: handleAuditSort } = useSortableTable(filteredAudit, 'changed_at', 'desc');
  const { paginated: paginatedAudit, page: auditPage, setPage: setAuditPage, pageSize: auditPageSize, setPageSize: setAuditPageSize, totalPages: auditTotalPages, totalItems: auditTotalItems } = usePagination(sortedAudit);
  const auditStateOptions = auditLog ? [...new Set(auditLog.map(e => e.to_state))].sort() : [];

  // ── Pending / Review tab ───────────────────────────────────────────────────
  const [pendingConfirm, setPendingConfirm] = useState<{ gcuid: string; action: 'approve' | 'flag-review' | 'bind'; reason: string } | null>(null);
  const [prSearch, setPrSearch] = useState('');
  const [prEntityTypeFilter, setPrEntityTypeFilter] = useState('');
  const [prIdentityStateFilter, setPrIdentityStateFilter] = useState('');
  const [prIdentifierStateFilter, setPrIdentifierStateFilter] = useState('');
  const pendingRecords = identities?.filter(id =>
    id.state === 'provisional' || id.state === 'under_review' || (id.identifier_state ?? 'reserved') === 'reserved'
  );
  const filteredPendingRecords = (() => {
    const raw = pendingRecords;
    if (!raw) return raw;
    let data = raw;
    if (prSearch) data = data.filter(id => id.gcuid.toLowerCase().includes(prSearch.toLowerCase()));
    if (prEntityTypeFilter) data = data.filter(id => id.entity_type === prEntityTypeFilter);
    if (prIdentityStateFilter) data = data.filter(id => id.state === prIdentityStateFilter);
    if (prIdentifierStateFilter) data = data.filter(id => (id.identifier_state ?? 'reserved') === prIdentifierStateFilter);
    return data;
  })();
  const { sorted: sortedPending, sortBy: prSortBy, sortDir: prSortDir, handleSort: handlePrSort } = useSortableTable(filteredPendingRecords, 'created_at', 'desc');
  const { paginated: paginatedPending, page: prPage, setPage: setPrPage, pageSize: prPageSize, setPageSize: setPrPageSize, totalPages: prTotalPages, totalItems: prTotalItems } = usePagination(sortedPending);
  const pendingActionMutation = useMutation({
    mutationFn: ({ gcuid, action, reason }: { gcuid: string; action: 'approve' | 'flag-review' | 'bind'; reason: string }) => {
      const r = reason.trim() || undefined;
      if (action === 'approve') return adminApi.approve(gcuid, 'admin', r);
      if (action === 'flag-review') return adminApi.flagReview(gcuid, r);
      return adminApi.bindIdentifier(gcuid, r);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gcuid-identities'] });
      queryClient.invalidateQueries({ queryKey: ['gcuid-stats'] });
      setPendingConfirm(null);
    },
  });

  // Fetch source mappings
  const { data: sourceMappingsData, isLoading: mappingsLoading } = useQuery({
    queryKey: ['source-mappings'],
    queryFn: adminApi.listSourceMappings,
    enabled: activeTab === 'source-mappings',
  });

  const allSmEntries: [string, SourceMapping[]][] = sourceMappingsData
    ? Object.entries(sourceMappingsData.mappings).filter(([gcuid, mappings]) => {
        const q = smFilter.trim().toLowerCase();
        const meta = sourceMappingsData.gcuid_meta?.[gcuid];
        const textOk = !q ||
          gcuid.toLowerCase().includes(q) ||
          (mappings as SourceMapping[]).some(m => m.source_id.toLowerCase().includes(q)) ||
          (meta?.display_name ?? '').toLowerCase().includes(q) ||
          (meta?.email ?? '').toLowerCase().includes(q) ||
          (meta?.aliases ?? []).some((a: string) => a.toLowerCase().includes(q));
        const srcOk = !smSourceFilter || (mappings as SourceMapping[]).some(m => m.source_system === smSourceFilter);
        return textOk && srcOk;
      })
    : [];
  const { paginated: paginatedSmEntries, page: smPage, setPage: setSmPage, pageSize: smPageSize, setPageSize: setSmPageSize, totalPages: smTotalPages, totalItems: smTotalItems } = usePagination(allSmEntries);

  // Fetch source systems for register form dropdowns
  const { data: sourceSystems } = useQuery<SourceSystem[]>({
    queryKey: ['source-systems'],
    queryFn: adminApi.listSourceSystems,
    staleTime: 60_000,
  });

  // Fetch system versions for entity type list
  const { data: versionsData } = useQuery<SystemVersions>({
    queryKey: ['system-versions'],
    queryFn: systemApi.getVersions,
    staleTime: 5 * 60 * 1000,
  });

  // Register new identity mutation
  const registerMutation = useMutation({
    mutationFn: (data: RegisterIdentityInput) => adminApi.registerIdentity(data),
    onSuccess: (result) => {
      setRegSuccess(result.gcuid);
      setRegError(null);
      queryClient.invalidateQueries({ queryKey: ['gcuid-identities'] });
      queryClient.invalidateQueries({ queryKey: ['gcuid-stats'] });
    },
    onError: (err: Error) => {
      setRegError(err.message);
      setRegSuccess(null);
    },
  });

  return (
    <UXScopeWrapper scopeId="portal-gcuid">
    <div className="space-y-6">
      {selectedGCUID && (
        <GCUIDDetailPanel
          gcuid={selectedGCUID}
          onClose={() => { setSelectedGCUID(null); setPreviousAuditEntry(null); }}
          onBack={previousAuditEntry ? () => {
            setSelectedGCUID(null);
            setSelectedAuditEntry(previousAuditEntry);
            setPreviousAuditEntry(null);
          } : undefined}
        />
      )}
      {selectedAuditEntry && (
        <AuditEntryDetailPanel
          entry={selectedAuditEntry}
          onClose={() => setSelectedAuditEntry(null)}
          onViewIdentity={(gcuid) => {
            setPreviousAuditEntry(selectedAuditEntry);
            setSelectedAuditEntry(null);
            setSelectedGCUID(gcuid);
          }}
        />
      )}
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-ux-text">GCUID Registry Portal</h1>
        <p className="mt-2 text-sm text-ux-text-sub">
          Central GCUID management and coordination across authoritative sources and departments
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="bg-ux-elevation1 overflow-hidden shadow rounded-lg border border-ux-border">
            <dl className="p-5">
              <dt className="text-sm font-medium text-ux-text-sub truncate">Total Identities</dt>
              <dd className="mt-1 text-3xl font-semibold text-ux-text">
                {stats.overview.total_identities}
              </dd>
              <dd className="mt-1 text-sm text-ux-text-sub">
                {stats.overview.created_24h} created in last 24h
              </dd>
            </dl>
          </div>
          <div className="bg-ux-elevation1 overflow-hidden shadow rounded-lg border border-ux-border">
            <dl className="p-5">
              <dt className="text-sm font-medium text-ux-text-sub truncate">State Transitions</dt>
              <dd className="mt-1 text-3xl font-semibold text-ux-text">
                {stats.overview.transitions_24h}
              </dd>
              <dd className="mt-1 text-sm text-ux-text-sub">In last 24 hours</dd>
            </dl>
          </div>
          <div className="bg-ux-elevation1 overflow-hidden shadow rounded-lg border border-ux-border">
            <dl className="p-5">
              <dt className="text-sm font-medium text-ux-text-sub truncate">Active Identities</dt>
              <dd className="mt-1 text-3xl font-semibold text-ux-text">
                {stats.by_state.find((s) => s.state === 'active')?.count || 0}
              </dd>
            </dl>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="card p-0">
        <div className="border-b border-ux-border">
          <nav className="flex -mb-px">
            <button
              onClick={() => { setActiveTab('identities'); setStatsDrilldown(null); }}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'identities'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Identities
            </button>
            <button
              onClick={() => { setActiveTab('pending-review'); setStatsDrilldown(null); }}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'pending-review'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Pending / Review
              {pendingRecords && pendingRecords.length > 0 && (
                <span className="ml-2 bg-amber-100 dark:bg-amber-800/60 text-amber-700 dark:text-amber-300 py-0.5 px-2 rounded-full text-xs">
                  {pendingRecords.length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab('duplicates'); setStatsDrilldown(null); }}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'duplicates'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Duplicates
              {duplicates && duplicates.length > 0 && (
                <span className="ml-2 bg-red-100 dark:bg-red-800/60 text-red-600 py-0.5 px-2 rounded-full text-xs">
                  {duplicates.length}
                </span>
              )}
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
              onClick={() => { setActiveTab('audit'); setStatsDrilldown(null); }}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'audit'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Audit Log
            </button>
            <button
              onClick={() => { setActiveTab('source-mappings'); setStatsDrilldown(null); }}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'source-mappings'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Source Mappings
            </button>
          </nav>
        </div>

        <div className="p-6">
          {/* Identities Tab */}
          {activeTab === 'identities' && (
            <>
              {/* Search + filters + Register button row */}
              <div className="mb-4 flex flex-wrap gap-2 items-center">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by GCUID, entity ID, metadata, or alias…"
                  className="input bg-ux-surface text-ux-text flex-1 min-w-48"
                />
                <select
                  value={entityTypeFilter}
                  onChange={e => setEntityTypeFilter(e.target.value)}
                  title="Filter by entity type"
                  className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ux-btn"
                >
                  <option value="">All Types</option>
                  {[...new Set<string>((identities?.map(id => id.entity_type) ?? []).filter(Boolean))].sort().map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
                <select
                  value={identityStateFilter}
                  onChange={e => setIdentityStateFilter(e.target.value)}
                  title="Filter by identity state"
                  className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ux-btn"
                >
                  <option value="">All Identity States</option>
                  {[...new Set<string>((identities?.map(id => id.state) ?? []).filter(Boolean))].sort().map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                  value={identifierStateFilter}
                  onChange={e => setIdentifierStateFilter(e.target.value)}
                  title="Filter by identifier state"
                  className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ux-btn"
                >
                  <option value="">All Identifier States</option>
                  {[...new Set<string>((identities?.map(id => id.identifier_state ?? 'reserved') ?? []).filter(Boolean))].sort().map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  onClick={() => {
                    setShowRegisterForm((v) => !v);
                    setRegError(null);
                    setRegSuccess(null);
                  }}
                  className="btn btn-primary whitespace-nowrap ml-auto"
                >
                  {showRegisterForm ? '✕ Cancel' : '+ Register New Identity'}
                </button>
              </div>

              {/* Register form panel */}
              {showRegisterForm && (
                <div className="mb-6 p-5 border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg space-y-4">
                  <h3 className="text-base font-semibold text-indigo-800 dark:text-indigo-200">Register New Identity</h3>

                  {regSuccess && (
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded text-sm text-green-800 dark:text-green-200">
                      <p className="font-semibold">Identity registered successfully!</p>
                      <p className="font-mono mt-1">{regSuccess}</p>
                      <button
                        className="mt-2 text-indigo-600 underline text-xs"
                        onClick={() => { setSelectedGCUID(regSuccess); setShowRegisterForm(false); }}
                      >
                        View identity details →
                      </button>
                    </div>
                  )}

                  {regError && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded text-sm text-red-700 dark:text-red-300">
                      {regError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {/* Entity Type */}
                    <div>
                      <label className="block text-xs font-medium text-ux-text mb-1">
                        Entity Type <span className="text-red-500">*</span>
                      </label>
                      <select
                        aria-label="Entity type"
                        title="Entity type"
                        value={regEntityType}
                        onChange={(e) => setRegEntityType(e.target.value as RegisterIdentityInput['entity_type'])}
                        className="input bg-ux-surface text-ux-text w-full"
                      >
                        {(versionsData?.urn?.entity_types ?? ['person','org','asset','app','agent']).map(et => (
                          <option key={et} value={et}>{et.charAt(0).toUpperCase() + et.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Source Linkages */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-ux-text">Source Account Linkages</span>
                      <button
                        type="button"
                        onClick={() => setRegSourceLinks((prev) => [...prev, { source_system: sourceSystems?.[0]?.system_id ?? '', source_id: '', is_primary: false }])}
                        className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-200 font-medium"
                      >
                        + Add linkage
                      </button>
                    </div>

                    {regSourceLinks.length === 0 && (
                      <p className="text-ux-text-sub">No source accounts linked yet. Click "+ Add linkage" to associate this identity with an authoritative source.</p>
                    )}

                    {regSourceLinks.map((link, idx) => (
                      <div key={idx} className="flex gap-2 items-center mb-2">
                        <select
                          aria-label="Source system"
                          title="Source system"
                          value={link.source_system}
                          onChange={(e) => setRegSourceLinks((prev) => prev.map((l, i) => i === idx ? { ...l, source_system: e.target.value } : l))}
                          className="input bg-ux-surface text-ux-text w-40 text-sm"
                        >
                          {(sourceSystems ?? []).map(s => (
                            <option key={s.system_id} value={s.system_id}>{s.display_name}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          aria-label="Source ID"
                          title="Source account ID in the selected system"
                          placeholder="e.g. ENG-001, E10001, jsmith"
                          value={link.source_id}
                          onChange={(e) => setRegSourceLinks((prev) => prev.map((l, i) => i === idx ? { ...l, source_id: e.target.value } : l))}
                          className="input bg-ux-surface text-ux-text flex-1 text-sm"
                        />
                        <label className="flex items-center gap-1 text-xs text-ux-text-sub whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={link.is_primary}
                            onChange={(e) => setRegSourceLinks((prev) => prev.map((l, i) => i === idx ? { ...l, is_primary: e.target.checked } : l))}
                          />
                          Primary
                        </label>
                        <button
                          type="button"
                          onClick={() => setRegSourceLinks((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-600 text-lg leading-none"
                          title="Remove this linkage"
                          aria-label="Remove linkage"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-3">
                    <button
                      disabled={registerMutation.isPending}
                      onClick={() => {
                        setRegError(null);
                        setRegSuccess(null);
                        registerMutation.mutate({
                          entity_type: regEntityType,
                          source_links: regSourceLinks.filter((l) => l.source_id.trim()),
                        });
                      }}
                      className="btn btn-primary"
                    >
                      {registerMutation.isPending ? 'Registering…' : 'Register Identity'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRegEntityType('person');
                        setRegSourceLinks([]);
                        setRegError(null);
                        setRegSuccess(null);
                      }}
                      className="btn btn-secondary"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}

              {identitiesLoading && <LoadingSpinner message="Loading identities..." />}
              {identitiesError && (
                <ErrorMessage
                  message={identitiesError instanceof Error ? identitiesError.message : 'Failed to load identities'}
                />
              )}
              {identities && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-ux-border">
                    <thead className="bg-ux-table-header">
                      <tr>
                        <SortTh col="gcuid" sortBy={idSortBy} sortDir={idSortDir} onSort={handleIdSort} activeClass="text-ux-nav-label">GCUID</SortTh>
                        <SortTh col="entity_type" sortBy={idSortBy} sortDir={idSortDir} onSort={handleIdSort} activeClass="text-ux-nav-label">Type</SortTh>
                        <SortTh col="state" sortBy={idSortBy} sortDir={idSortDir} onSort={handleIdSort} activeClass="text-ux-nav-label">Identity State</SortTh>
                        <SortTh col="identifier_state" sortBy={idSortBy} sortDir={idSortDir} onSort={handleIdSort} activeClass="text-ux-nav-label">Identifier State</SortTh>
                        {(flags.aliases.generated || flags.aliases.userSelected || flags.aliases.email) && (
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Alias</th>
                        )}
                        <SortTh col="created_at" sortBy={idSortBy} sortDir={idSortDir} onSort={handleIdSort} activeClass="text-indigo-700 dark:text-indigo-300">Created</SortTh>
                      </tr>
                    </thead>
                    <tbody className="bg-ux-surface divide-y divide-ux-border">
                      {paginatedIdentities.map((identity) => {
                        const gcAliases = (identity.aliases as GCAlias[] | undefined)
                          ?.filter((a) => (flags.aliases.generated && a.alias_type?.startsWith('GC-'))
                            || (flags.aliases.userSelected && a.alias_type === 'custom')
                            || (flags.aliases.email && a.alias_type === 'email')) ?? [];
                        return (
                          <tr
                            key={identity.gcuid}
                            className="cursor-pointer hover:bg-ux-hover transition-colors"
                            onClick={() => setSelectedGCUID(identity.gcuid)}
                          >
                            <td className="px-3 py-4 whitespace-nowrap text-sm font-mono text-ux-text">
                              <span className="inline-flex items-center gap-1">
                                {identity.gcuid.slice(0, 30)}…
                                <CopyButton value={identity.gcuid} label="Copy GCUID" />
                              </span>
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub capitalize">
                              {identity.entity_type}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm">
                              <StateBadge state={identity.state} kind="identity" />
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm">
                              <StateBadge state={identity.identifier_state ?? 'reserved'} kind="identifier" />
                            </td>
                            {(flags.aliases.generated || flags.aliases.userSelected || flags.aliases.email) && (
                            <td className="px-3 py-4">
                              {gcAliases.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  {gcAliases.map((a) => (
                                    a.alias_type?.startsWith('GC-') ? (
                                      <span key={a.id} className="font-mono text-xs text-violet-700 dark:text-violet-300 bg-[#eeeaf3] dark:bg-violet-900/20 border border-[#ddd5e7] dark:border-[#674b8a] px-2 py-0.5 rounded whitespace-nowrap">
                                        {a.alias_value}
                                      </span>
                                    ) : a.alias_type === 'email' ? (
                                      <span key={a.id} className="font-mono text-xs text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 px-2 py-0.5 rounded whitespace-nowrap">
                                        {a.alias_value}
                                      </span>
                                    ) : (
                                      <span key={a.id} className="font-mono text-xs text-ux-nav-label bg-ux-accent-subtle border border-ux-accent-subtle-border px-2 py-0.5 rounded whitespace-nowrap">
                                        {a.alias_value}
                                      </span>
                                    )
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-ux-muted">—</span>
                              )}
                            </td>
                            )}
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub">
                              {fmtDate(identity.created_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <Pagination page={idPage} totalPages={idTotalPages} totalItems={idTotalItems} pageSize={idPageSize} onPageChange={setIdPage} onPageSizeChange={setIdPageSize} />
                </div>
              )}
              <p className="text-ux-text-sub">Click any row to view full identity details and resolved attributes</p>
            </>
          )}

          {/* Pending / Review Tab */}
          {activeTab === 'pending-review' && (
            <>
              <div className="mb-4">
                <p className="text-sm text-ux-text-sub">
                  Records with an identity in <strong>Provisional</strong> or <strong>Under Review</strong> state,
                  or with an identifier in <strong>Reserved</strong> state. Click a row to view full details.
                </p>
              </div>

              {identitiesLoading && <LoadingSpinner message="Loading records..." />}
              {identitiesError && (
                <ErrorMessage message={identitiesError instanceof Error ? identitiesError.message : 'Failed to load records'} />
              )}

              {!identitiesLoading && pendingRecords && pendingRecords.length === 0 && (
                <div className="text-center py-12 text-ux-text-sub">
                  <p className="text-lg font-medium mb-1">No records pending action</p>
                  <p className="text-sm">All identities and identifiers are in a resolved state.</p>
                </div>
              )}

              {pendingRecords && pendingRecords.length > 0 && (
                <>
                  <div className="mb-4 flex flex-wrap gap-2 items-center">
                    <input
                      type="search"
                      value={prSearch}
                      onChange={e => setPrSearch(e.target.value)}
                      placeholder="Search by GCUID…"
                      title="Search by GCUID"
                      className="input bg-ux-surface text-ux-text flex-1 min-w-48"
                    />
                    <select value={prEntityTypeFilter} onChange={e => setPrEntityTypeFilter(e.target.value)} title="Filter by entity type" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                      <option value="">All Types</option>
                      {[...new Set<string>((pendingRecords?.map(id => id.entity_type) ?? []).filter(Boolean))].sort().map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                    <select value={prIdentityStateFilter} onChange={e => setPrIdentityStateFilter(e.target.value)} title="Filter by identity state" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                      <option value="">All Identity States</option>
                      {[...new Set<string>((pendingRecords?.map(id => id.state) ?? []).filter(Boolean))].sort().map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={prIdentifierStateFilter} onChange={e => setPrIdentifierStateFilter(e.target.value)} title="Filter by identifier state" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                      <option value="">All Identifier States</option>
                      {[...new Set<string>((pendingRecords?.map(id => id.identifier_state ?? 'reserved') ?? []).filter(Boolean))].sort().map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {filteredPendingRecords && filteredPendingRecords.length === 0 ? (
                    <div className="text-center py-8 text-ux-text-sub text-sm">No records match the current filters.</div>
                  ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-ux-border">
                    <thead className="bg-ux-table-header">
                      <tr>
                        <SortTh col="gcuid" sortBy={prSortBy} sortDir={prSortDir} onSort={handlePrSort} activeClass="text-ux-nav-label">GCUID</SortTh>
                        <SortTh col="entity_type" sortBy={prSortBy} sortDir={prSortDir} onSort={handlePrSort} activeClass="text-ux-nav-label">Type</SortTh>
                        <SortTh col="state" sortBy={prSortBy} sortDir={prSortDir} onSort={handlePrSort} activeClass="text-ux-nav-label">Identity State</SortTh>
                        <SortTh col="identifier_state" sortBy={prSortBy} sortDir={prSortDir} onSort={handlePrSort} activeClass="text-ux-nav-label">Identifier State</SortTh>
                        <SortTh col="created_at" sortBy={prSortBy} sortDir={prSortDir} onSort={handlePrSort} activeClass="text-indigo-700 dark:text-indigo-300">Created</SortTh>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Identity Actions</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Identifier Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-ux-surface divide-y divide-ux-border">
                      {paginatedPending.map((id) => {
                        const idState = id.state;
                        const idenState = id.identifier_state ?? 'reserved';
                        const isConfirming = pendingConfirm?.gcuid === id.gcuid;

                        const identityActions: Array<{ key: 'approve' | 'flag-review'; label: string; title: string; style: string }> = [];
                        if (idState === 'provisional') {
                          identityActions.push({ key: 'approve',     label: 'Approve',     title: 'Advance identity to Active',    style: 'bg-green-600 hover:bg-green-700 text-white' });
                          identityActions.push({ key: 'flag-review', label: 'Flag Review', title: 'Move identity to Under Review', style: 'bg-purple-600 hover:bg-purple-700 text-white' });
                        }
                        if (idState === 'under_review') {
                          identityActions.push({ key: 'approve',     label: 'Approve',     title: 'Advance identity to Active',    style: 'bg-green-600 hover:bg-green-700 text-white' });
                        }

                        const identifierActions: Array<{ key: 'bind'; label: string; title: string; style: string }> = [];
                        if (idenState === 'reserved') {
                          identifierActions.push({ key: 'bind', label: 'Bind Identifier', title: 'Issue the GCUID identifier', style: 'bg-teal-600 hover:bg-teal-700 text-white' });
                        }

                        const renderActionButtons = (acts: typeof identityActions | typeof identifierActions) => (
                          <div className="flex flex-wrap gap-1.5">
                            {acts.map((act) => (
                              <button
                                key={act.key}
                                title={act.title}
                                onClick={() => setPendingConfirm(
                                  isConfirming && pendingConfirm?.action === act.key
                                    ? null
                                    : { gcuid: id.gcuid, action: act.key as 'approve' | 'flag-review' | 'bind', reason: '' }
                                )}
                                className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${act.style} ${isConfirming && pendingConfirm?.action === act.key ? 'ring-2 ring-offset-1 ring-current' : ''}`}
                              >
                                {act.label}
                              </button>
                            ))}
                          </div>
                        );

                        return (
                          <>
                            <tr
                              key={id.gcuid}
                              className={`cursor-pointer hover:bg-ux-hover transition-colors ${isConfirming ? 'bg-ux-accent-subtle' : ''}`}
                              onClick={() => setSelectedGCUID(id.gcuid)}
                            >
                              <td className="px-3 py-4 whitespace-nowrap text-sm font-mono text-ux-text">
                                <span className="inline-flex items-center gap-1">
                                  {id.gcuid.slice(0, 30)}…
                                  <CopyButton value={id.gcuid} label="Copy GCUID" />
                                </span>
                              </td>
                              <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub capitalize">{id.entity_type}</td>
                              <td className="px-3 py-4 whitespace-nowrap text-sm">
                                <StateBadge state={idState} kind="identity" />
                              </td>
                              <td className="px-3 py-4 whitespace-nowrap text-sm">
                                <StateBadge state={idenState} kind="identifier" />
                              </td>
                              <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub">{fmtDate(id.created_at)}</td>
                              <td className="px-3 py-4 whitespace-nowrap text-sm" onClick={(e) => e.stopPropagation()}>
                                {renderActionButtons(identityActions)}
                              </td>
                              <td className="px-3 py-4 whitespace-nowrap text-sm" onClick={(e) => e.stopPropagation()}>
                                {renderActionButtons(identifierActions)}
                              </td>
                            </tr>
                            {isConfirming && pendingConfirm && (
                              <tr key={`${id.gcuid}-confirm`} className="bg-ux-surface-alt">
                                <td colSpan={7} className="px-4 py-3">
                                  <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-xs font-medium text-ux-text-sub whitespace-nowrap">
                                      {pendingConfirm.action === 'approve'     ? 'Approve identity' :
                                       pendingConfirm.action === 'flag-review' ? 'Flag for review' :
                                       'Bind identifier'} — reason (optional):
                                    </span>
                                    <input
                                      type="text"
                                      className="input input-sm bg-ux-surface text-ux-text flex-1 text-xs py-1"
                                      placeholder="Enter reason…"
                                      value={pendingConfirm.reason}
                                      onChange={(e) => setPendingConfirm({ ...pendingConfirm, reason: e.target.value })}
                                    />
                                    <button
                                      disabled={pendingActionMutation.isPending}
                                      onClick={() => pendingActionMutation.mutate(pendingConfirm)}
                                      className="btn btn-primary btn-sm text-xs px-3 py-1 disabled:opacity-50"
                                    >
                                      {pendingActionMutation.isPending ? 'Processing…' : 'Confirm'}
                                    </button>
                                    <button
                                      onClick={() => setPendingConfirm(null)}
                                      className="btn btn-secondary btn-sm text-xs px-3 py-1"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                  {pendingActionMutation.isError && (
                                    <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                                      {pendingActionMutation.error instanceof Error ? pendingActionMutation.error.message : 'Action failed'}
                                    </p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                  <Pagination page={prPage} totalPages={prTotalPages} totalItems={prTotalItems} pageSize={prPageSize} onPageChange={setPrPage} onPageSizeChange={setPrPageSize} />
                </div>
                  )}
                </>
              )}
              <p className="mt-2 text-ux-text-sub">Click any row to view full identity details and resolved attributes</p>
            </>
          )}

          {/* Duplicates Tab */}
          {activeTab === 'duplicates' && (
            <>
              {duplicatesLoading && <LoadingSpinner message="Detecting duplicates..." />}
              {duplicates && duplicates.length === 0 && (
                <div className="text-center py-12">
                  <svg
                    className="mx-auto h-12 w-12 text-ux-text-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <h3 className="mt-2 text-sm font-medium text-ux-text">No duplicates found</h3>
                  <p className="mt-1 text-sm text-ux-text-sub">All identities are unique.</p>
                </div>
              )}
              {duplicates && duplicates.length > 0 && (
                <div className="space-y-4">
                  {duplicates.map((dup) => {
                    const isEntityId       = dup.kind === 'entity_id';
                    const isSourceConflict = dup.kind === 'source_id_conflict';
                    const isCrossSystem    = dup.kind === 'cross_system_id';

                    const borderCls = isEntityId       ? 'border-red-200 dark:border-red-700'
                                    : isSourceConflict ? 'border-orange-200 dark:border-orange-700'
                                    :                    'border-amber-200 dark:border-amber-600';
                    const bgCls    = isEntityId       ? 'bg-red-50 dark:bg-red-900/20'
                                   : isSourceConflict ? 'bg-orange-50 dark:bg-orange-900/20'
                                   :                    'bg-amber-50 dark:bg-amber-900/20';
                    const headCls  = isEntityId       ? 'text-red-900 dark:text-red-200'
                                   : isSourceConflict ? 'text-orange-900 dark:text-orange-200'
                                   :                    'text-amber-900 dark:text-amber-200';
                    const subCls   = isEntityId       ? 'text-red-700 dark:text-red-300'
                                   : isSourceConflict ? 'text-orange-700 dark:text-orange-300'
                                   :                    'text-amber-700 dark:text-amber-300';
                    const badgeCls = isEntityId       ? 'bg-red-100 dark:bg-red-800/60 text-red-800 dark:text-red-200'
                                   : isSourceConflict ? 'bg-orange-100 dark:bg-orange-800/60 text-orange-800 dark:text-orange-200'
                                   :                    'bg-amber-100 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200';
                    const badgeLabel = isEntityId       ? 'Entity ID clash'
                                     : isSourceConflict ? 'Source ID conflict'
                                     :                    'Cross-system collision';

                    return (
                      <div key={dup.key} className={`border ${borderCls} rounded-lg p-4 ${bgCls}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <h3 className={`text-sm font-medium ${headCls}`}>
                              {isEntityId       && <>Entity ID: <span className="font-mono">{dup.entity_id}</span></>}
                              {isSourceConflict && <>Source record: <span className="font-mono">{dup.source_system} / {dup.source_id}</span></>}
                              {isCrossSystem    && <>Cross-system ID: <span className="font-mono">{dup.source_id}</span></>}
                            </h3>
                            <p className={`mt-1 text-sm ${subCls}`}>{dup.reason}</p>
                            {isCrossSystem && dup.systems && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {dup.systems.map(s => (
                                  <span key={s} className="text-xs font-mono bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 rounded">{s}</span>
                                ))}
                              </div>
                            )}
                            <div className="mt-2 space-y-1">
                              {dup.gcuids.map((gcuid) => (
                                <button
                                  key={gcuid}
                                  className={`block text-xs font-mono ${subCls} hover:underline text-left`}
                                  onClick={() => setSelectedGCUID(gcuid)}
                                >
                                  {gcuid}
                                </button>
                              ))}
                            </div>
                          </div>
                          <span className={`ml-3 flex-shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeCls}`}>
                            {badgeLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Statistics Tab */}
          {activeTab === 'stats' && (
            <>
              {/* ── Drilled-down identity list ─────────────────────────────── */}
              {statsDrilldown ? (
                <div className="space-y-4">
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      onClick={() => { setStatsDrilldown(null); setSelectedGCUID(null); }}
                      className="flex items-center gap-1 text-ux-nav-label hover:text-ux-text font-medium transition-colors"
                    >
                      ← Statistics
                    </button>
                    <span className="text-ux-text-sub">›</span>
                    <span className="text-ux-text font-medium capitalize">
                      {statsDrilldown.dimension === 'state'
                        ? statsDrilldown.label.replace('_', ' ')
                        : statsDrilldown.label}{' '}
                      identities
                    </span>
                    <span className="ml-1 text-xs text-ux-text-sub">({statsDrilldown.count})</span>
                  </div>

                  {/* Drilldown table */}
                  {drilldownLoading && <LoadingSpinner message="Loading identities…" />}
                  {!drilldownLoading && sortedDrilldown && sortedDrilldown.length === 0 && (
                    <p className="text-sm text-ux-text-sub italic py-4">No identities found.</p>
                  )}
                  {!drilldownLoading && sortedDrilldown && sortedDrilldown.length > 0 && (
                    <>
                      <div className="overflow-x-auto rounded-lg border border-ux-border">
                        <table className="min-w-full divide-y divide-ux-border">
                          <thead className="bg-ux-table-header">
                            <tr>
                              <SortTh col="metadata" sortBy={ddSortBy} sortDir={ddSortDir} onSort={handleDdSort} activeClass="text-ux-nav-label">Name</SortTh>
                              <SortTh col="gcuid" sortBy={ddSortBy} sortDir={ddSortDir} onSort={handleDdSort} activeClass="text-ux-nav-label">GCUID</SortTh>
                              {statsDrilldown.dimension === 'state' && (
                                <SortTh col="entity_type" sortBy={ddSortBy} sortDir={ddSortDir} onSort={handleDdSort} activeClass="text-ux-nav-label">Type</SortTh>
                              )}
                              {statsDrilldown.dimension === 'type' && (
                                <SortTh col="state" sortBy={ddSortBy} sortDir={ddSortDir} onSort={handleDdSort} activeClass="text-ux-nav-label">State</SortTh>
                              )}
                              <SortTh col="identifier_state" sortBy={ddSortBy} sortDir={ddSortDir} onSort={handleDdSort} activeClass="text-ux-nav-label">ID State</SortTh>
                              <SortTh col="created_at" sortBy={ddSortBy} sortDir={ddSortDir} onSort={handleDdSort} activeClass="text-ux-nav-label">Created</SortTh>
                            </tr>
                          </thead>
                          <tbody className="bg-ux-surface divide-y divide-ux-border">
                            {paginatedDrilldown.map((id) => {
                              const meta = typeof id.metadata === 'object' && id.metadata !== null
                                ? id.metadata as Record<string, string>
                                : {};
                              const displayName = meta.display_name
                                ?? (meta.first_name || meta.last_name
                                  ? `${meta.first_name ?? ''} ${meta.last_name ?? ''}`.trim()
                                  : null);
                              return (
                                <tr
                                  key={id.gcuid}
                                  onClick={() => setSelectedGCUID(id.gcuid)}
                                  className="cursor-pointer hover:bg-ux-hover transition-colors"
                                >
                                  <td className="px-3 py-3 text-sm text-ux-text">
                                    {displayName
                                      ? <span className="font-medium">{displayName}</span>
                                      : <span className="text-ux-text-sub italic">—</span>}
                                    {meta.email && (
                                      <div className="text-xs text-ux-text-sub font-mono mt-0.5">{meta.email}</div>
                                    )}
                                  </td>
                                  <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-ux-text-sub">
                                    {id.gcuid.length > 36 ? id.gcuid.slice(0, 36) + '…' : id.gcuid}
                                  </td>
                                  {statsDrilldown.dimension === 'state' && (
                                    <td className="px-3 py-3 whitespace-nowrap text-sm capitalize text-ux-text">
                                      {id.entity_type}
                                    </td>
                                  )}
                                  {statsDrilldown.dimension === 'type' && (
                                    <td className="px-3 py-3 whitespace-nowrap">
                                      <StateBadge state={id.state} kind="identity" />
                                    </td>
                                  )}
                                  <td className="px-3 py-3 whitespace-nowrap">
                                    <StateBadge state={id.identifier_state ?? 'reserved'} kind="identifier" />
                                  </td>
                                  <td className="px-3 py-3 whitespace-nowrap text-xs text-ux-text-sub">
                                    {fmtDate(id.created_at)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <Pagination
                        page={ddPage}
                        totalPages={ddTotalPages}
                        totalItems={ddTotalItems}
                        pageSize={ddPageSize}
                        onPageChange={setDdPage}
                        onPageSizeChange={setDdPageSize}
                        accentClass="text-ux-nav-label"
                      />
                      <p className="text-xs text-ux-text-sub">Click any row to view full identity details</p>
                    </>
                  )}
                </div>
              ) : (
                /* ── Stats overview ───────────────────────────────────────── */
                <>
                  {statsLoading && <LoadingSpinner message="Loading statistics..." />}
                  {stats && (
                    <div className="space-y-6">
                      {/* By State */}
                      <div>
                        <h3 className="text-lg font-medium text-ux-text mb-1">Identities by State</h3>
                        <p className="text-xs text-ux-text-sub mb-4">Click a card to explore the identities in that state</p>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          {stats.by_state.map((item) => (
                            <div
                              key={item.state}
                              onClick={() => setStatsDrilldown({ dimension: 'state', value: item.state, label: item.state, count: item.count })}
                              className="bg-ux-surface overflow-hidden shadow rounded-lg cursor-pointer hover:shadow-md hover:ring-2 hover:ring-ux-nav-label/40 transition-all"
                            >
                              <div className="p-5">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-medium text-ux-text-sub truncate capitalize">
                                    {item.state.replace('_', ' ')}
                                  </p>
                                  <StateBadge state={item.state} kind="identity" />
                                </div>
                                <p className="mt-1 text-3xl font-semibold text-ux-text">{item.count}</p>
                                <p className="mt-2 text-xs text-ux-nav-label">View identities →</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* By Type */}
                      <div>
                        <h3 className="text-lg font-medium text-ux-text mb-1">Identities by Type</h3>
                        <p className="text-xs text-ux-text-sub mb-4">Click a row to explore the identities of that type</p>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-ux-border">
                            <thead className="bg-ux-table-header">
                              <tr>
                                <SortTh col="type" sortBy={typeSortBy} sortDir={typeSortDir} onSort={handleTypeSort} activeClass="text-ux-nav-label">Type</SortTh>
                                <SortTh col="count" sortBy={typeSortBy} sortDir={typeSortDir} onSort={handleTypeSort} activeClass="text-ux-nav-label">Count</SortTh>
                                <th className="px-3 py-3 text-right text-xs font-medium text-ux-text-sub uppercase tracking-wider"></th>
                              </tr>
                            </thead>
                            <tbody className="bg-ux-surface divide-y divide-ux-border">
                              {sortedByType.map((item) => (
                                <tr
                                  key={item.type}
                                  onClick={() => setStatsDrilldown({ dimension: 'type', value: item.type, label: item.type, count: item.count })}
                                  className="cursor-pointer hover:bg-ux-hover transition-colors"
                                >
                                  <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-ux-text capitalize">
                                    {item.type}
                                  </td>
                                  <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub">
                                    {item.count}
                                  </td>
                                  <td className="px-3 py-4 whitespace-nowrap text-right text-xs text-ux-nav-label">
                                    View identities →
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Audit Log Tab */}
          {activeTab === 'audit' && (
            <>
              {auditLoading && <LoadingSpinner message="Loading audit log..." />}
              {auditLog && (
                <>
                  {/* Search + filter bar */}
                  <div className="mb-4 flex flex-wrap gap-3">
                    <input
                      type="search"
                      value={auditSearch}
                      onChange={(e) => { setAuditSearch(e.target.value); setAuditPage(1); }}
                      placeholder="Search GCUID, changed by, reason…"
                      className="input bg-ux-surface text-ux-text flex-1 min-w-[200px]"
                    />
                    <select
                      aria-label="Filter by destination state"
                      title="Filter by destination state"
                      value={auditStateFilter}
                      onChange={(e) => { setAuditStateFilter(e.target.value); setAuditPage(1); }}
                      className="input bg-ux-surface text-ux-text w-48"
                    >
                      <option value="">All states</option>
                      {auditStateOptions.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    {(auditSearch || auditStateFilter) && (
                      <button
                        onClick={() => { setAuditSearch(''); setAuditStateFilter(''); setAuditPage(1); }}
                        className="px-3 py-1.5 text-sm text-ux-text-sub hover:text-ux-text border border-ux-border rounded"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-ux-border">
                      <thead className="bg-ux-table-header">
                        <tr>
                          <SortTh col="changed_at" sortBy={auditSortBy} sortDir={auditSortDir} onSort={handleAuditSort} activeClass="text-ux-nav-label">Timestamp</SortTh>
                          <SortTh col="gcuid" sortBy={auditSortBy} sortDir={auditSortDir} onSort={handleAuditSort} activeClass="text-ux-nav-label">GCUID</SortTh>
                          <SortTh col="from_state" sortBy={auditSortBy} sortDir={auditSortDir} onSort={handleAuditSort} activeClass="text-ux-nav-label">Transition</SortTh>
                          <SortTh col="changed_by" sortBy={auditSortBy} sortDir={auditSortDir} onSort={handleAuditSort} activeClass="text-ux-nav-label">Changed By</SortTh>
                          <SortTh col="reason" sortBy={auditSortBy} sortDir={auditSortDir} onSort={handleAuditSort} activeClass="text-ux-nav-label">Reason</SortTh>
                        </tr>
                      </thead>
                      <tbody className="bg-ux-surface divide-y divide-ux-border">
                        {paginatedAudit.map((entry) => (
                          <tr
                            key={entry.id}
                            onClick={() => setSelectedAuditEntry(entry)}
                            className="cursor-pointer transition-colors hover:bg-ux-hover"
                          >
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub">
                              {fmt(entry.changed_at)}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm font-mono text-ux-text">
                              {entry.gcuid.slice(0, 20)}…
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm">
                              <span className="text-ux-text-sub text-xs">{entry.from_state || 'null'}</span>
                              <span className="mx-1 text-ux-text-sub">→</span>
                              <StateBadge state={entry.to_state} />
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text">
                              {entry.changed_by}
                            </td>
                            <td className="px-3 py-4 text-sm text-ux-text-sub">
                              {entry.reason || '—'}
                            </td>
                          </tr>
                        ))}
                        {paginatedAudit.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-sm text-ux-text-sub">
                              No audit entries match the current filters.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <Pagination
                      page={auditPage}
                      totalPages={auditTotalPages}
                      totalItems={auditTotalItems}
                      pageSize={auditPageSize}
                      onPageChange={setAuditPage}
                      onPageSizeChange={setAuditPageSize}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* Source Mappings Tab */}
          {activeTab === 'source-mappings' && (
            <>
              <div className="mb-4">
                <h3 className="text-lg font-medium text-ux-text">Source Mappings</h3>
                <p className="mt-1 text-sm text-ux-text-sub">
                  Shows which GCUIDs are mapped to accounts in authoritative sources
                </p>
              </div>

              {mappingsLoading && <LoadingSpinner message="Loading source mappings..." />}

              {sourceMappingsData && (
                <div>
                  <div className="mb-4 grid grid-cols-3 gap-4">
                    <div className="bg-ux-info-bg p-4 rounded-lg">
                      <p className="text-sm text-ux-info font-medium">Total GCUIDs</p>
                      <p className="text-2xl font-bold text-ux-text">{sourceMappingsData.total_gcuids}</p>
                    </div>
                    <div className="bg-ux-success-bg p-4 rounded-lg">
                      <p className="text-sm text-ux-success font-medium">Total Mappings</p>
                      <p className="text-2xl font-bold text-ux-text">{sourceMappingsData.total_mappings}</p>
                    </div>
                    <div className="bg-ux-accent-subtle p-4 rounded-lg">
                      <p className="text-sm text-ux-nav-label font-medium">Avg per GCUID</p>
                      <p className="text-2xl font-bold text-ux-text">
                        {(sourceMappingsData.total_mappings / sourceMappingsData.total_gcuids).toFixed(1)}
                      </p>
                    </div>
                  </div>

                  {/* Search + source filter */}
                  <div className="mb-4 flex gap-3">
                    <input
                      type="search"
                      value={smFilter}
                      onChange={(e) => { setSmFilter(e.target.value); setSmPage(1); }}
                      placeholder="Search by GCUID or source ID…"
                      className="input bg-ux-surface text-ux-text flex-1"
                    />
                    <select
                      aria-label="Filter by source system"
                      title="Filter by source system"
                      value={smSourceFilter}
                      onChange={(e) => { setSmSourceFilter(e.target.value); setSmPage(1); }}
                      className="input bg-ux-surface text-ux-text w-48"
                    >
                      <option value="">All sources</option>
                      {[...new Set(Object.values(sourceMappingsData.mappings).flat().map((m: SourceMapping) => m.source_system))].sort().map(sys => (
                        <option key={sys} value={sys}>{sys.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>

                  {allSmEntries.length === 0 && (
                    <p className="text-sm text-ux-text-sub italic py-4">No mappings match your filter.</p>
                  )}

                  <div className="space-y-4">
                    {paginatedSmEntries.map(([gcuid, gcuidMappings]) => {
                      const meta = sourceMappingsData.gcuid_meta?.[gcuid];
                      const isSuperseded = meta?.identifier_state === 'superseded';
                      const canonicalId  = meta?.superseded_by ?? null;
                      return (
                      <div
                        key={gcuid}
                        className={`rounded-lg p-4 cursor-pointer transition-all border ${
                          isSuperseded
                            ? 'bg-ux-surface/50 border-ux-border opacity-75 hover:opacity-100 hover:border-ux-border-strong'
                            : 'bg-ux-surface border-ux-border hover:border-indigo-300 hover:shadow-sm'
                        }`}
                        onClick={() => setSelectedGCUID(isSuperseded && canonicalId ? canonicalId : gcuid)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            {meta?.display_name && (
                              <div className="text-sm font-semibold text-ux-text mb-0.5">{meta.display_name}</div>
                            )}
                            <div className="font-mono text-xs text-ux-text-muted">{gcuid}</div>
                            {isSuperseded && canonicalId && (
                              <div className="mt-1 flex items-center gap-1 text-xs text-ux-text-muted">
                                <span>→ Superseded by</span>
                                <button
                                  className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline truncate max-w-[260px]"
                                  onClick={(e) => { e.stopPropagation(); setSelectedGCUID(canonicalId); }}
                                >
                                  {canonicalId}
                                </button>
                              </div>
                            )}
                          </div>
                          {isSuperseded ? (
                            <span className="ml-3 flex-shrink-0 text-xs bg-ux-hover text-ux-text-muted border border-ux-border px-2 py-0.5 rounded-full font-medium">Superseded</span>
                          ) : (
                            <span className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-200">View details →</span>
                          )}
                        </div>
                        {(meta?.email || (meta?.aliases ?? []).length > 0) && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {meta?.email && (
                              <span className="text-xs text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 px-2 py-0.5 rounded font-mono">{meta.email}</span>
                            )}
                            {(meta?.aliases ?? []).map((alias: string) => (
                              <span key={alias} className="text-xs text-violet-700 dark:text-violet-300 bg-[#eeeaf3] dark:bg-violet-900/20 border border-[#ddd5e7] dark:border-[#674b8a] px-2 py-0.5 rounded font-mono">{alias}</span>
                            ))}
                          </div>
                        )}
                        <div className="space-y-2">
                          {gcuidMappings.map((mapping: SourceMapping, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-sm bg-ux-surface-alt p-2 rounded">
                              <div className="flex items-center gap-3">
                                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-800/60 text-blue-800 dark:text-blue-200 rounded font-medium">
                                  {mapping.source_system.toUpperCase()}
                                </span>
                                <span className="text-ux-text">
                                  ID: <span className="font-mono">{mapping.source_id}</span>
                                </span>
                                {mapping.is_primary && (
                                  <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200 rounded font-medium">
                                    Primary
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-ux-text-sub">
                                {fmtDate(mapping.created_at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                  <Pagination page={smPage} totalPages={smTotalPages} totalItems={smTotalItems} pageSize={smPageSize} onPageChange={setSmPage} onPageSizeChange={setSmPageSize} accentClass="text-indigo-600 dark:text-indigo-400" />
                  <p className="mt-2 text-ux-text-sub">Click any card to view full identity details and resolved CAES attributes</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </UXScopeWrapper>
  );
}
