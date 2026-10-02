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
import { userApi, caesApi, GCAlias, SelfServiceAttribute } from '../api/client';
import StateBadge from '../components/StateBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import CopyButton from '../components/CopyButton';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { useDateTime } from '../context/DateTimeFormatContext';
import { UXScopeWrapper } from '../context/UXThemeContext';

// Human-readable labels for the profile view
const ATTR_LABELS: Record<string, string> = {
  'person.name.given':            'First Name (Legal)',
  'person.name.family':           'Last Name',
  'person.email':                 'Email Address',
  'person.employment.department': 'Department',
  'person.employment.status':     'Employment Status',
  'person.account.username':      'Network Username',
  'person.account.enabled':       'Account Status',
  'person.job.title':             'Job Title (HR)',
};

const SELF_SERVICE_LABELS: Record<string, string> = {
  'person.name.given': 'Preferred First Name',
  'person.job.title':  'Preferred Job Title',
};

const SELF_SERVICE_HELP: Record<string, string> = {
  'person.name.given': 'This updates your display name in the directory. HR holds your legal name.',
  'person.job.title':  'Set how your title appears in the directory. Your official HR title is shown above.',
};

const FALLBACK_SELF_SERVICE_ATTRS = ['person.name.given', 'person.job.title'];

function formatAttrValue(attrKey: string, value: any): string {
  if (value === null || value === undefined) return '—';
  if (attrKey === 'person.account.enabled') return value === true || value === 1 ? 'Enabled' : 'Disabled';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

const SOURCE_LABELS: Record<string, string> = {
  hr: 'HR System',
  ldap: 'LDAP / AD',
  engineering: 'Engineering',
  finance: 'Finance',
};

function SourceBadge({ source, fetchMode }: { source: string | null; fetchMode: 'live' | 'cache' | null }) {
  if (!source) return null;
  const label = SOURCE_LABELS[source] ?? source;
  return (
    <div className="flex items-center gap-1 mt-1">
      {fetchMode !== null && (
        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${fetchMode === 'live' ? 'bg-green-400' : 'bg-amber-400'}`} />
      )}
      <span className="text-[10px] font-medium tracking-wide text-ux-text-muted">
        {label}{fetchMode !== null ? <>&nbsp;&middot;&nbsp;{fetchMode === 'live' ? 'Live' : 'Cached'}</> : null}
      </span>
    </div>
  );
}

export default function UserPortal() {
  const queryClient = useQueryClient();
  const { flags } = useFeatureFlags();
  const { fmt } = useDateTime();
  const [searchInput, setSearchInput] = useState('');
  const [searchId, setSearchId] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasCheckValue, setAliasCheckValue] = useState('');

  // Debounce alias availability check
  useEffect(() => {
    const t = setTimeout(() => setAliasCheckValue(aliasInput.trim().toLowerCase()), 400);
    return () => clearTimeout(t);
  }, [aliasInput]);

  // Lookup identity.
  // Alias flags are part of the query key: when any flag changes, TanStack Query treats
  // it as a new cache entry and fetches fresh from the server — even if UserPortal was
  // unmounted when the flag was toggled (e.g. on OptionsPortal).
  const { data: identity, isLoading, error, refetch } = useQuery({
    queryKey: ['identity', searchId, flags.aliases.enabled, flags.aliases.email, flags.aliases.userSelected, flags.aliases.generated],
    queryFn: () => userApi.lookup(searchId),
    enabled: searchId.length > 0,
    retry: false,   // surface errors (e.g. flag-gated 404) immediately
  });

  // Fetch self-service attribute definitions
  const { data: selfServiceAttrDefs } = useQuery({
    queryKey: ['caes-self-service-attributes'],
    queryFn: caesApi.getSelfServiceAttributes,
    staleTime: 5 * 60 * 1000,
  });

  const selfServiceAttrs: string[] = selfServiceAttrDefs
    ? selfServiceAttrDefs.map((a: SelfServiceAttribute) => a.standardAttribute)
    : FALLBACK_SELF_SERVICE_ATTRS;

  // Fetch CAES-resolved attribute profile
  const { data: attrProfile, isLoading: attrsLoading } = useQuery({
    queryKey: ['user-attributes', identity?.gcuid],
    queryFn: () => userApi.getAttributes(identity!.gcuid),
    enabled: !!identity?.gcuid,
  });

  // Get history
  const { data: history } = useQuery({
    queryKey: ['history', identity?.gcuid],
    queryFn: () => userApi.getHistory(identity!.gcuid),
    enabled: !!identity?.gcuid,
  });

  // Self-service update mutation
  const updateMutation = useMutation({
    mutationFn: (attrs: Record<string, string>) =>
      userApi.updateAttributes(identity!.gcuid, attrs),
    onSuccess: (result) => {
      const rejectedCount = Object.keys(result.rejected ?? {}).length;
      if (rejectedCount > 0) {
        const msgs = Object.entries(result.rejected!).map(([k, v]) => `${SELF_SERVICE_LABELS[k] ?? k}: ${v}`);
        setSaveError(msgs.join('; '));
      } else {
        setSaveError(null);
        setSaveSuccess(true);
        setEditMode(false);
        setTimeout(() => setSaveSuccess(false), 4000);
      }
      queryClient.invalidateQueries({ queryKey: ['user-attributes', identity?.gcuid] });
    },
    onError: (err) => {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    },
  });

  // Custom aliases for this identity
  const { data: customAliases, isLoading: aliasesLoading } = useQuery({
    queryKey: ['user-custom-aliases', identity?.gcuid],
    queryFn: () => userApi.getAliases(identity!.gcuid),
    enabled: !!identity?.gcuid && flags.aliases.userSelected,
  });

  // Live availability check (debounced via aliasCheckValue)
  const { data: aliasCheck, isFetching: aliasChecking, isError: aliasCheckError } = useQuery({
    queryKey: ['alias-check', aliasCheckValue, identity?.gcuid],
    queryFn: () => userApi.checkAlias(aliasCheckValue, identity!.gcuid),
    enabled: aliasCheckValue.length >= 3 && !!identity?.gcuid && flags.aliases.userSelected,
  });

  const saveAliasMutation = useMutation({
    mutationFn: (value: string) => userApi.saveAlias(identity!.gcuid, value),
    onSuccess: () => {
      setAliasInput('');
      setAliasCheckValue('');
      queryClient.removeQueries({ queryKey: ['alias-check'] });
      queryClient.invalidateQueries({ queryKey: ['user-custom-aliases', identity?.gcuid] });
    },
  });

  const disableAliasMutation = useMutation({
    mutationFn: (id: number) => userApi.disableAlias(identity!.gcuid, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-custom-aliases', identity?.gcuid] });
    },
  });

  const enableAliasMutation = useMutation({
    mutationFn: (id: number) => userApi.enableAlias(identity!.gcuid, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-custom-aliases', identity?.gcuid] });
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setSearchId(searchInput.trim());
      setEditMode(false);
      setSaveSuccess(false);
      setSaveError(null);
    }
  };

  const handleStartEdit = () => {
    // Pre-populate with current self-service values
    const initial: Record<string, string> = {};
    if (attrProfile) {
      for (const attrKey of selfServiceAttrs) {
        const entry = attrProfile.attributes[attrKey];
        if (entry) {
          // Use self_service_value if it exists (LDAP copy), otherwise fall back to authoritative
          const current = entry.self_service_value ?? entry.value;
          initial[attrKey] = current != null ? String(current) : '';
        }
      }
    }
    setEditValues(initial);
    setSaveError(null);
    setEditMode(true);
  };

  const handleSave = () => {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(editValues)) {
      if (v.trim()) payload[k] = v.trim();
    }
    if (Object.keys(payload).length === 0) return;
    updateMutation.mutate(payload);
  };

  const attrs = attrProfile?.attributes ?? {};

  // Group attributes by the source that actually provided the value.
  // When a value is present, group under entry.source (where the data came from).
  // When a value is null, group under authoritative_source (where it should come from),
  // so missing attributes appear in the section of the system expected to supply them.
  const attrsBySource = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const [attrKey, entry] of Object.entries(attrs)) {
      const src = (entry.value !== null && entry.value !== undefined && entry.source)
        ? entry.source
        : (entry.authoritative_source ?? entry.source ?? 'unknown');
      if (!groups[src]) groups[src] = [];
      groups[src].push(attrKey);
    }
    return groups;
  }, [attrs]);

  // hr first, ldap second, then any other sources alphabetically
  const orderedSources = useMemo(() => {
    const priority = ['hr', 'ldap'];
    const keys = Object.keys(attrsBySource);
    return [
      ...priority.filter(k => keys.includes(k)),
      ...keys.filter(k => !priority.includes(k)).sort(),
    ];
  }, [attrsBySource]);

  // Derive candidate aliases from the user's own attributes to show as clickable starting points.
  // Candidates are sanitized, validated against the alias character rules, and deduplicated.
  const aliasSuggestions = useMemo(() => {
    const strip = (v: any) =>
      typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const given   = strip(attrProfile?.attributes['person.name.given']?.value);
    const family  = strip(attrProfile?.attributes['person.name.family']?.value);
    const username = strip(attrProfile?.attributes['person.account.username']?.value);
    const candidates: string[] = [];
    if (given && family) {
      candidates.push(`${given}.${family}`);
      if (given.length >= 1 && family.length >= 2) candidates.push(`${given[0]}.${family}`);
    }
    if (username) candidates.push(username);
    if (given && given.length >= 3) candidates.push(given);
    return [...new Set(candidates)]
      .filter(c => c.length >= 3 && /^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(c))
      .slice(0, 4);
  }, [attrProfile]);

  return (
    <UXScopeWrapper scopeId="portal-self-service">
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-ux-text">User Portal</h1>
        <p className="mt-2 text-sm text-ux-text-sub">
          View your identity and update the information you control
        </p>
      </div>

      {/* Search Form */}
      <div className="card">
        <h2 className="text-lg font-semibold text-ux-text mb-4">Identity Lookup</h2>
        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={flags.aliases.email ? 'GCUID, alias, entity ID (e.g. ENG-001), or email' : 'GCUID, alias, or entity ID (e.g. ENG-001)'}
            className="input flex-1"
          />
          <button type="submit" className="btn btn-primary">
            Search
          </button>
        </form>
        <p className="mt-2 text-sm text-ux-text-sub">
          You can look up an identity using any of the following: full GCUID (<span className="font-mono text-xs">urn:gcuid:…</span>), a custom alias you have set, a departmental or authoritative source identifier (e.g. <span className="font-mono text-xs">ENG-001</span>, <span className="font-mono text-xs">E10001</span>){flags.aliases.email && <>, or an email address linked to the identity</>}.
        </p>
      </div>

      {/* Loading State */}
      {isLoading && <LoadingSpinner message="Looking up identity..." />}

      {/* Error State */}
      {error && (
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to lookup identity'}
          onRetry={() => refetch()}
        />
      )}

      {/* Identity found — hide if the current query has an error (avoids showing stale cache on flag-gated 404) */}
      {identity && !error && (
        <div className="space-y-6">
          {/* Save success banner */}
          {saveSuccess && (
            <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 p-4">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Your preferences were saved successfully and updated in the directory.
              </p>
            </div>
          )}

          {/* Identity Card */}
          <div className="card">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold text-ux-text">Your Identity</h2>
              <StateBadge state={identity.state} />
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-ux-text-sub">GCUID</dt>
                <dd className="mt-1 flex items-center gap-1">
                  <span className="text-sm text-ux-text font-mono break-all">{identity.gcuid}</span>
                  <CopyButton value={identity.gcuid} label="Copy GCUID" />
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-ux-text-sub">Entity ID</dt>
                <dd className="mt-1 text-sm text-ux-text">{identity.entity_id}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-ux-text-sub">Created</dt>
                <dd className="mt-1 text-sm text-ux-text">
                  {fmt(identity.created_at)}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-ux-text-sub">Last Updated</dt>
                <dd className="mt-1 text-sm text-ux-text">
                  {fmt(identity.updated_at)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Attribute Profile */}
          {attrsLoading && <LoadingSpinner message="Loading profile..." />}
          {attrProfile && (
            <div className="card space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ux-text">Your Profile</h2>
                {!editMode && (
                  <button onClick={handleStartEdit} className="btn btn-secondary text-sm">
                    Edit My Preferences
                  </button>
                )}
              </div>

              {/* Source-grouped attribute sections — ordered and grouped dynamically by authoritative_source */}
              {orderedSources.map((src, idx) => (
                <div key={src} className={idx > 0 ? 'pt-4 border-t border-ux-border' : ''}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-ux-text-sub">
                      {SOURCE_LABELS[src] ?? src}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-ux-hover text-ux-text-sub">
                      Read-only
                    </span>
                  </div>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    {attrsBySource[src].map(attrKey => {
                      const entry = attrs[attrKey];
                      if (!entry) return null;
                      return (
                        <div key={attrKey}>
                          <dt>
                            <span className="text-sm font-medium text-ux-text-sub">{ATTR_LABELS[attrKey] ?? attrKey}</span>
                            <span className="block font-mono text-[10px] text-ux-text-muted select-all mt-0.5">{attrKey}</span>
                          </dt>
                          <dd className="mt-0.5">
                            <span className="text-sm text-ux-text">{formatAttrValue(attrKey, entry.value)}</span>
                            <SourceBadge source={entry.source} fetchMode={entry.fetch_mode ?? null} />
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ))}

              {/* Self-Service Preferences Section */}
              <div className="pt-4 border-t border-ux-border">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-ux-text-sub">
                    Your Preferences
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-[#e7eef4] dark:bg-blue-800/60 text-blue-700 dark:text-blue-300">
                    You can edit these
                  </span>
                </div>

                {!editMode ? (
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    {selfServiceAttrs.map(attrKey => {
                      const entry = attrs[attrKey];
                      if (!entry) return null;
                      const prefValue = entry.self_service_value ?? entry.value;
                      const prefSource = entry.self_service_value != null
                        ? (entry.self_service_source ?? entry.source)
                        : entry.source;
                      const prefFetchMode = entry.self_service_value != null
                        ? (entry.self_service_fetch_mode ?? entry.fetch_mode ?? null)
                        : (entry.fetch_mode ?? null);
                      return (
                        <div key={attrKey}>
                          <dt>
                            <span className="text-sm font-medium text-ux-text-sub">{SELF_SERVICE_LABELS[attrKey] ?? attrKey}</span>
                            <span className="block font-mono text-[10px] text-ux-text-muted select-all mt-0.5">{attrKey}</span>
                          </dt>
                          <dd className="mt-0.5">
                            <span className="text-sm text-ux-text">
                              {formatAttrValue(attrKey, prefValue)}
                              {entry.self_service_value != null &&
                               entry.self_service_value !== entry.value && (
                                <span className="text-ux-text-sub">
                                  (HR: {formatAttrValue(attrKey, entry.value)})
                                </span>
                              )}
                            </span>
                            <SourceBadge source={prefSource} fetchMode={prefFetchMode} />
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : (
                  <div className="space-y-4">
                    {selfServiceAttrs.map(attrKey => {
                      const entry = attrs[attrKey];
                      if (!entry) return null;
                      return (
                        <div key={attrKey}>
                          <label className="block text-sm font-medium text-ux-text">
                            {SELF_SERVICE_LABELS[attrKey]}
                          </label>
                          <input
                            type="text"
                            value={editValues[attrKey] ?? ''}
                            onChange={(e) =>
                              setEditValues(prev => ({ ...prev, [attrKey]: e.target.value }))
                            }
                            maxLength={255}
                            title={SELF_SERVICE_LABELS[attrKey]}
                            placeholder={SELF_SERVICE_LABELS[attrKey]}
                            className="input mt-1 w-full sm:max-w-sm"
                          />
                          <p className="mt-1 text-xs text-ux-text-sub">
                            {SELF_SERVICE_HELP[attrKey]}
                          </p>
                        </div>
                      );
                    })}

                    {saveError && (
                      <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-3">
                        <p className="text-sm text-red-700 dark:text-red-300">{saveError}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={handleSave}
                        disabled={updateMutation.isPending}
                        className="btn btn-primary"
                      >
                        {updateMutation.isPending ? 'Saving…' : 'Save Preferences'}
                      </button>
                      <button
                        onClick={() => { setEditMode(false); setSaveError(null); }}
                        className="btn btn-secondary"
                        disabled={updateMutation.isPending}
                      >
                        Cancel
                      </button>
                    </div>

                    <p className="text-ux-text-sub">
                      Updates are written directly to the directory via CAES attribute routing.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Aliases */}
          <div className="card space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ux-text">Aliases</h2>
                <p className="mt-0.5 text-sm text-ux-text-sub">Friendly identifiers that point to your GCUID</p>
              </div>
            </div>

            {/* System-assigned GC aliases (read-only) */}
            {identity.aliases && identity.aliases.filter(a => a.alias_type !== 'custom').length > 0 && (
              <div>
                <p className="text-ux-text-sub">System-Assigned</p>
                <div className="flex flex-wrap gap-2">
                  {identity.aliases.filter(a => a.alias_type !== 'custom').map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full text-xs font-mono bg-[#eeeaf3] dark:bg-violet-800/60 text-violet-800 dark:text-violet-200">
                      {a.alias_value}
                      <CopyButton value={a.alias_value} label="Copy alias" className="text-violet-400 dark:text-violet-500 hover:text-violet-700 dark:hover:text-violet-300" />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Custom aliases */}
            {flags.aliases.userSelected && (
            <div>
              <p className="text-ux-text-sub">Your Custom Aliases</p>
              {aliasesLoading ? (
                <p className="text-sm text-ux-text-sub">Loading…</p>
              ) : customAliases && customAliases.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {customAliases.map((a: GCAlias) => {
                    const isDisabled = a.status === 'disabled';
                    const isTogglingThis =
                      (disableAliasMutation.isPending || enableAliasMutation.isPending);
                    return (
                      <span
                        key={a.id}
                        className={`inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-sm font-mono border transition-all ${
                          isDisabled
                            ? 'bg-ux-surface/60 text-ux-text-muted border-ux-border line-through'
                            : 'bg-[#e7eef4] dark:bg-blue-800/60 text-blue-800 dark:text-blue-200 border-[#d0dde9] dark:border-[#3f6489]'
                        }`}
                      >
                        {a.alias_value}
                        <CopyButton value={a.alias_value} label="Copy alias" className={isDisabled ? 'text-gray-400 hover:text-gray-500' : 'text-blue-400 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-200'} />
                        {isDisabled && (
                          <span className="text-[10px] font-sans font-semibold uppercase tracking-wide text-ux-text-muted px-1 py-0.5 rounded bg-ux-hover leading-none">
                            off
                          </span>
                        )}
                        {isDisabled ? (
                          <button
                            type="button"
                            onClick={() => enableAliasMutation.mutate(a.id)}
                            disabled={isTogglingThis}
                            className="text-ux-text-sub"
                            title="Re-enable alias"
                            aria-label={`Re-enable alias ${a.alias_value}`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                            </svg>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => disableAliasMutation.mutate(a.id)}
                            disabled={isTogglingThis}
                            className="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full text-blue-300 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors"
                            title="Disable alias"
                            aria-label={`Disable alias ${a.alias_value}`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                              <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524L13.478 14.89zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-ux-text-sub">No custom aliases yet.</p>
              )}
            </div>
            )}

            {/* Add new alias */}
            {flags.aliases.userSelected && (
            <div className="pt-3 border-t border-ux-border space-y-2">
              <p className="text-ux-text-sub">Add a Custom Alias</p>
              <p className="text-xs text-ux-text-sub">
                3–64 characters — letters, numbers, dots, underscores. Must start and end with a letter or number.
              </p>
              {aliasSuggestions.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-ux-text-sub">Try:</span>
                  {aliasSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAliasInput(s)}
                      className="text-xs px-2 py-0.5 rounded border border-ux-border font-mono hover:border-blue-400 hover:text-blue-700 dark:text-blue-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                  <input
                    type="text"
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value.toLowerCase())}
                    placeholder={aliasSuggestions.length > 0 ? `e.g. ${aliasSuggestions[0]}` : 'e.g. john.doe or jsmith'}
                    title="Custom alias value"
                    aria-label="Custom alias value"
                    maxLength={64}
                    className={`input w-full pr-8 ${
                      aliasCheckValue.length >= 3
                        ? aliasCheck?.available
                          ? 'border-green-400 focus:ring-green-300'
                          : aliasCheck?.alreadyOwned
                            ? 'border-blue-400 focus:ring-blue-300'
                            : aliasCheck
                              ? 'border-red-400 focus:ring-red-300'
                              : ''
                        : ''
                    }`}
                  />
                  {aliasCheckValue.length >= 3 && (
                    <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-sm select-none ${
                      aliasChecking       ? 'text-ux-text-sub'
                      : aliasCheckError  ? 'text-yellow-500'
                      : aliasCheck?.available ? 'text-green-600'
                      : aliasCheck?.alreadyOwned ? 'text-blue-500'
                      : aliasCheck       ? 'text-red-500'
                      : 'text-ux-text-sub'
                    }`}>
                      {aliasChecking ? '…' : aliasCheckError ? '?' : aliasCheck?.available ? '✓' : aliasCheck?.alreadyOwned ? '↩' : aliasCheck ? '✗' : '…'}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => saveAliasMutation.mutate(aliasInput.trim().toLowerCase())}
                  disabled={!aliasCheck?.available || aliasChecking || aliasCheckError || saveAliasMutation.isPending}
                  className="btn btn-primary"
                >
                  {saveAliasMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>

              {/* Feedback: server error */}
              {aliasCheckValue.length >= 3 && !aliasChecking && aliasCheckError && (
                <p className="text-sm text-yellow-700 dark:text-yellow-300 bg-[#f4f0e4] dark:bg-yellow-900/20 border border-[#e9e1c9] dark:border-[#a67f3d] rounded px-3 py-2">
                  Could not verify availability — the API server may need to be restarted.
                </p>
              )}

              {/* Feedback: already owned by this user */}
              {aliasCheckValue.length >= 3 && !aliasChecking && !aliasCheckError && aliasCheck?.alreadyOwned && (
                <div className="space-y-1.5">
                  <p className="text-sm text-blue-600 dark:text-blue-400">
                    You already have this alias assigned to your identity.
                  </p>
                  {aliasCheck.suggestions && aliasCheck.suggestions.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-ux-text-sub">Available alternatives:</span>
                      {aliasCheck.suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setAliasInput(s)}
                          className="text-xs px-2 py-0.5 rounded border border-ux-border font-mono hover:border-blue-400 hover:text-blue-700 dark:text-blue-300"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Feedback: taken by someone else + suggestions */}
              {aliasCheckValue.length >= 3 && !aliasChecking && !aliasCheckError && aliasCheck && !aliasCheck.available && !aliasCheck.alreadyOwned && (
                <div className="space-y-1.5">
                  {aliasCheck.reason && (
                    <p className="text-sm text-red-600">{aliasCheck.reason}</p>
                  )}
                  {aliasCheck.suggestions && aliasCheck.suggestions.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-ux-text-sub">Available alternatives:</span>
                      {aliasCheck.suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setAliasInput(s)}
                          className="text-xs px-2 py-0.5 rounded border border-ux-border font-mono hover:border-blue-400 hover:text-blue-700 dark:text-blue-300"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {saveAliasMutation.isError && (
                <p className="text-sm text-red-600">
                  {saveAliasMutation.error instanceof Error ? saveAliasMutation.error.message : 'Save failed'}
                </p>
              )}
            </div>
            )}
          </div>

          {/* State History */}
          {history && history.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-ux-text mb-4">State History</h2>
              <div className="overflow-hidden">
                <table className="min-w-full divide-y divide-ux-border">
                  <thead className="bg-ux-surface-alt">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-medium text-ux-text-sub uppercase tracking-wider">Date</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-ux-text-sub uppercase tracking-wider">Transition</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-ux-text-sub uppercase tracking-wider">Changed By</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-ux-text-sub uppercase tracking-wider">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="bg-ux-surface divide-y divide-ux-border">
                    {history.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text">
                          {fmt(item.changed_at)}
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap text-sm">
                          <span className="text-ux-text-sub">{item.from_state || 'null'}</span>
                          {' → '}
                          <StateBadge state={item.to_state} />
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text">{item.changed_by}</td>
                        <td className="px-3 py-4 text-sm text-ux-text-sub">{item.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info Box */}
      {!searchId && (
        <div className="card bg-ux-info-bg border border-ux-info-border">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-ux-info" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-ux-info">About GCUID</h3>
              <p className="mt-2 text-sm text-ux-info">
                The Government of Canada Unified Identifier (GCUID) is your unique identity
                within the federal government systems. Look up your identity to view your profile
                and update the directory preferences you control (preferred name and job title).
              </p>
              <p className="mt-2 text-sm text-ux-info">
                <strong>Accepted identifiers:</strong> full GCUID (<span className="font-mono text-xs">urn:gcuid:…</span>), a custom alias (e.g. <span className="font-mono text-xs">john.smith</span>), a departmental or authoritative source entity ID (e.g. <span className="font-mono text-xs">ENG-001</span>, <span className="font-mono text-xs">FIN-001</span>, <span className="font-mono text-xs">E10001</span>){flags.aliases.email && <>, or an email address registered to the identity</>}.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
    </UXScopeWrapper>
  );
}
