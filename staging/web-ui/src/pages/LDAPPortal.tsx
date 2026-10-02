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
import { ldapApi, LDAPUser, LDAPUserInput } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import CopyButton from '../components/CopyButton';
import { useDateTime } from '../context/DateTimeFormatContext';
import { useSortableTable } from '../hooks/useSortableTable';
import { usePagination } from '../hooks/usePagination';
import { GcuidRequestPanel } from '../components/GcuidRequestPanel';
import { ConnectorStatusPanel } from '../components/ConnectorStatusPanel';
import { ConnectorIntegrationTab } from '../components/ConnectorIntegrationTab';
import { SortTh } from '../components/SortTh';
import { Pagination } from '../components/Pagination';
import { UXScopeWrapper } from '../context/UXThemeContext';

const emptyLDAPForm = (): LDAPUserInput => ({
  username: '', distinguished_name: '', email: '', first_name: '', last_name: '',
  department: 'Engineering', title: '', account_enabled: true, groups: [],
});

function LDAPUserModal({
  mode, initial, saving, error, onSave, onCancel, departments,
}: {
  mode: 'create' | 'edit';
  initial: LDAPUserInput;
  saving: boolean;
  error: string | null;
  onSave: (data: LDAPUserInput) => void;
  onCancel: () => void;
  departments: string[];
}) {
  const [form, setForm] = useState<LDAPUserInput>(initial);
  const [dnTouched, setDnTouched] = useState(false);
  const DN_SUFFIX = 'OU=Users,DC=agency,DC=gov';
  const set = <K extends keyof LDAPUserInput>(k: K, v: LDAPUserInput[K]) => setForm(f => ({ ...f, [k]: v }));
  const groupsStr = Array.isArray(form.groups) ? form.groups.join(', ') : (form.groups ?? '');

  function handleUsernameChange(value: string) {
    set('username', value);
    if (mode === 'create' && !dnTouched) {
      set('distinguished_name', value ? `CN=${value},${DN_SUFFIX}` : '');
    }
  }

  function handleDnChange(value: string) {
    setDnTouched(true);
    set('distinguished_name', value);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="w-full max-w-lg bg-ux-surface rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ux-border">
          <h2 className="text-base font-semibold text-ux-text">{mode === 'create' ? 'Add LDAP User' : 'Edit LDAP User'}</h2>
          <button onClick={onCancel} className="text-ux-text-sub">✕</button>
        </div>
        <div className="overflow-y-auto p-6 space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-3">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Username *</label>
              <input value={form.username} onChange={e => handleUsernameChange(e.target.value)}
                disabled={mode === 'edit'}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm disabled:bg-ux-hover" placeholder="jsmith" />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <input type="checkbox" id="ldap-acct-enabled" checked={form.account_enabled === true || form.account_enabled as unknown as number === 1}
                onChange={e => set('account_enabled', e.target.checked)}
                className="rounded border-ux-border" />
              <label htmlFor="ldap-acct-enabled" className="text-sm font-medium text-ux-text">Account Enabled</label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ux-text mb-1">Distinguished Name *</label>
            <input value={form.distinguished_name} onChange={e => handleDnChange(e.target.value)}
              className="w-full px-3 py-2 border border-ux-border rounded text-sm font-mono" placeholder="CN=John Smith,OU=Users,DC=agency,DC=gov" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">First Name *</label>
              <input value={form.first_name} onChange={e => set('first_name', e.target.value)}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Last Name *</label>
              <input value={form.last_name} onChange={e => set('last_name', e.target.value)}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ux-text mb-1">Email *</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
              className="w-full px-3 py-2 border border-ux-border rounded text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Department *</label>
              <select value={form.department} onChange={e => set('department', e.target.value)}
                title="Department"
                className="w-full px-3 py-2 border border-ux-border rounded text-sm">
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Title</label>
              <input value={form.title ?? ''} onChange={e => set('title', e.target.value || null)}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm" placeholder="Optional" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ux-text mb-1">Groups (comma-separated)</label>
            <textarea value={groupsStr}
              onChange={e => set('groups', e.target.value.split(',').map(g => g.trim()).filter(Boolean))}
              className="w-full px-3 py-2 border border-ux-border rounded text-sm" rows={2}
              placeholder="group-a, group-b" />
          </div>
        </div>
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-ux-border">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-ux-text border border-ux-border rounded-md hover:bg-ux-hover bg-ux-surface">Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-ux-btn text-ux-btn-on rounded-md hover:brightness-90 disabled:opacity-50">
            {saving ? 'Saving…' : mode === 'create' ? 'Add User' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LDAPDetailPanel({ username, onClose }: { username: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['ldap-user', username],
    queryFn: () => ldapApi.viewUser(username),
  });
  const { fmt } = useDateTime();

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black bg-opacity-30" onClick={onClose} />
      {/* Panel */}
      <div className="w-full max-w-xl bg-ux-surface shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ux-border bg-ux-surface-alt">
          <div>
            <h2 className="text-lg font-semibold text-ux-text">LDAP User Record</h2>
            <p className="text-xs text-ux-text-sub font-mono">{username}</p>
          </div>
          <button
            onClick={onClose}
            className="text-ux-text-sub"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading && <LoadingSpinner message="Loading user details..." />}
          {error && <ErrorMessage message={error instanceof Error ? error.message : 'Failed to load'} />}
          {user && (
            <>
              {/* Identity banner */}
              <div className="flex items-center gap-4 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg">
                <div className="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center text-white text-lg font-bold">
                  {(user as any).first_name?.[0]}{(user as any).last_name?.[0] || user.username[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-lg font-semibold text-ux-text">
                    {(user as any).first_name && (user as any).last_name
                      ? `${(user as any).first_name} ${(user as any).last_name}`
                      : user.username}
                  </div>
                  <div className="text-sm text-ux-text-sub">{(user as any).title || ''}</div>
                  <div className="text-xs text-ux-text-sub">{(user as any).department || ''}</div>
                </div>
              </div>

              {/* Directory Attributes */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                  Directory Attributes
                </h3>
                <dl className="space-y-2">
                  {[
                    { label: 'Username', value: user.username, mono: true },
                    { label: 'First Name', value: (user as any).first_name },
                    { label: 'Last Name', value: (user as any).last_name },
                    { label: 'Email', value: user.email },
                    { label: 'Distinguished Name', value: (user as any).distinguished_name || (user as any).dn },
                    { label: 'Department', value: (user as any).department },
                    { label: 'Title', value: (user as any).title },
                    { label: 'Account Status', value: user.account_enabled === 1 ? 'Enabled' : 'Disabled', badge: true, enabled: user.account_enabled },
                    { label: 'Last Logon', value: user.last_logon },
                    { label: 'Created At', value: fmt((user as any).created_at) },
                    { label: 'Updated At', value: fmt((user as any).updated_at) },
                  ].filter(f => f.value != null).map(field => (
                    <div key={field.label} className="flex justify-between items-start py-1.5 border-b border-ux-border">
                      <dt className="text-sm text-ux-text-sub w-40 flex-shrink-0">{field.label}</dt>
                      <dd className={`text-sm text-right ${field.mono ? 'font-mono text-ux-text' : 'text-ux-text'}`}>
                        {field.badge ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            field.enabled === 1 ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-800/60 text-red-800 dark:text-red-200'
                          }`}>{field.value}</span>
                        ) : String(field.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              {/* Group Memberships */}
              {user.groups && (
                <section>
                  <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                    Group Memberships
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {(Array.isArray(user.groups) ? user.groups : [user.groups]).map((g: string) => (
                      <span key={g} className="px-2 py-1 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 text-purple-800 dark:text-purple-200 rounded text-xs font-mono">
                        {g}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* CAES Standard Attribute Names */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                  CAES Standard Attributes
                </h3>
                <div className="space-y-1">
                  {[
                    { caes: 'person.name.given', value: (user as any).first_name },
                    { caes: 'person.name.family', value: (user as any).last_name },
                    { caes: 'person.email', value: user.email },
                    { caes: 'person.employment.department', value: (user as any).department },
                    { caes: 'person.directory.username', value: user.username },
                    { caes: 'person.directory.dn', value: (user as any).distinguished_name || (user as any).dn },
                  ].filter(m => m.value).map(m => (
                    <div key={m.caes} className="flex items-center justify-between py-1 px-3 bg-indigo-50 dark:bg-indigo-900/20 rounded">
                      <code className="text-xs font-mono text-indigo-700 dark:text-indigo-300">{m.caes}</code>
                      <span className="text-xs text-ux-text-sub">{m.value}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* GCUID Linkage */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                  GCUID Identity Linkage
                </h3>
                {user.gcuid_details ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-ux-success-bg border border-ux-success-border rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-sm font-medium text-green-800 dark:text-green-200">Linked to GCUID</span>
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                          user.gcuid_details.state === 'active' ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200' :
                          'bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200'
                        }`}>{user.gcuid_details.state}</span>
                      </div>
                      <code className="text-xs font-mono text-ux-text break-all block">
                        {user.gcuid_details.gcuid}
                      </code>
                      <CopyButton value={user.gcuid_details.gcuid} label="Copy GCUID" className="mt-1" />
                    </div>
                    {user.gcuid_details.source_mappings?.length > 0 && (
                      <div>
                        <p className="text-xs text-ux-text-sub mb-2">All source mappings for this identity:</p>
                        <div className="space-y-1">
                          {user.gcuid_details.source_mappings.map((sm: any) => (
                            <div key={sm.source_system} className="flex items-center gap-2 px-3 py-1.5 bg-ux-surface-alt rounded border border-ux-border text-xs">
                              <span className="font-medium text-ux-text uppercase w-20">{sm.source_system}</span>
                              <code className="font-mono text-ux-text-sub">{sm.source_id}</code>
                              {sm.is_primary && (
                                <span className="ml-auto px-1.5 py-0.5 bg-blue-100 dark:bg-blue-800/60 text-blue-700 dark:text-blue-300 rounded text-xs">primary</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <GcuidRequestPanel
                    sourceSystem="ldap"
                    sourceId={user.username}
                    attributes={{ first_name: user.first_name, last_name: user.last_name, email: user.email }}
                    onComplete={() => {
                      qc.invalidateQueries({ queryKey: ['ldap-user', username] });
                      qc.invalidateQueries({ queryKey: ['ldap-users'] });
                      qc.invalidateQueries({ queryKey: ['ldap-stats'] });
                    }}
                  />
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LDAPPortal() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'users' | 'stats' | 'coverage' | 'connector' | 'integration'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [gcuidFilter, setGcuidFilter] = useState('all');
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [userModal, setUserModal] = useState<{ mode: 'create'; initial: LDAPUserInput } | { mode: 'edit'; username: string; initial: LDAPUserInput } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<LDAPUser | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [ldapGapSearch, setLdapGapSearch] = useState('');
  const [ldapGapDeptFilter, setLdapGapDeptFilter] = useState('');
  const [ldapGapEnabledFilter, setLdapGapEnabledFilter] = useState('');
  const [ldapDegSearch, setLdapDegSearch] = useState('');
  const [ldapDegStateFilter, setLdapDegStateFilter] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ldap-users'] });

  const createMutation = useMutation({
    mutationFn: ldapApi.createUser,
    onSuccess: () => { invalidate(); setUserModal(null); setMutationError(null); },
    onError: (e: any) => setMutationError(e?.message ?? 'Failed to create user'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ username, data }: { username: string; data: Partial<LDAPUserInput> }) => ldapApi.updateUser(username, data),
    onSuccess: () => { invalidate(); setUserModal(null); setMutationError(null); },
    onError: (e: any) => setMutationError(e?.message ?? 'Failed to update user'),
  });
  const deleteMutation = useMutation({
    mutationFn: ldapApi.deleteUser,
    onSuccess: () => { invalidate(); setDeleteConfirm(null); },
    onError: (e: any) => setMutationError(e?.message ?? 'Failed to delete user'),
  });

  // Fetch users
  const { data: users, isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ['ldap-users'],
    queryFn: ldapApi.listUsers,
  });

  // Fetch stats
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['ldap-stats'],
    queryFn: ldapApi.getStats,
  });

  // Fetch connector health
  const { data: connectorHealth, isLoading: healthLoading } = useQuery({
    queryKey: ['ldap-connector-health'],
    queryFn: ldapApi.getConnectorHealth,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch coverage gaps
  const { data: coverageGaps, isLoading: coverageLoading } = useQuery({
    queryKey: ['ldap-coverage-gaps'],
    queryFn: ldapApi.getCoverageGaps,
    enabled: activeTab === 'coverage',
  });

  const ldapDepartments = users && users.length > 0
    ? [...new Set(users.map(u => (u as any).department as string).filter(Boolean))].sort()
    : [];

  const filteredUsers = users?.filter(user => {
    const matchSearch = searchQuery === '' ||
      `${user.username} ${(user as any).first_name || ''} ${(user as any).last_name || ''} ${user.email} ${(user as any).distinguished_name || (user as any).dn || ''}`
        .toLowerCase().includes(searchQuery.toLowerCase());
    const matchAccount = accountFilter === 'all' || (accountFilter === 'enabled' ? user.account_enabled === 1 : user.account_enabled === 0);
    const matchGcuid = gcuidFilter === 'all' || (gcuidFilter === 'linked' ? !!user.gcuid : !user.gcuid);
    return matchSearch && matchAccount && matchGcuid;
  });

  const { sorted: sortedUsers, sortBy, sortDir, handleSort } = useSortableTable(filteredUsers, 'username');
  const { paginated: paginatedUsers, page: ldapPage, setPage: setLdapPage, pageSize: ldapPageSize, setPageSize: setLdapPageSize, totalPages: ldapTotalPages, totalItems: ldapTotalItems } = usePagination(sortedUsers);

  // Sort + pagination for coverage gap tables
  const filteredLdapGap = (() => {
    const raw = (coverageGaps as any)?.gaps?.without_gcuid?.users;
    if (!raw) return raw;
    let data = raw;
    if (ldapGapSearch) data = data.filter((u: any) =>
      `${u.username} ${u.first_name} ${u.last_name} ${u.email} ${u.department}`.toLowerCase().includes(ldapGapSearch.toLowerCase())
    );
    if (ldapGapDeptFilter) data = data.filter((u: any) => u.department === ldapGapDeptFilter);
    if (ldapGapEnabledFilter !== '') data = data.filter((u: any) => u.account_enabled === Number(ldapGapEnabledFilter));
    return data;
  })();
  const filteredLdapDeg = (() => {
    const raw = (coverageGaps as any)?.gaps?.degraded_coverage?.records;
    if (!raw) return raw;
    let data = raw;
    if (ldapDegSearch) data = data.filter((r: any) =>
      `${r.username} ${r.gcuid}`.toLowerCase().includes(ldapDegSearch.toLowerCase())
    );
    if (ldapDegStateFilter) data = data.filter((r: any) => r.state === ldapDegStateFilter);
    return data;
  })();
  const { sorted: ldapGapSorted, sortBy: ldapGapSortBy, sortDir: ldapGapSortDir, handleSort: handleLdapGapSort } = useSortableTable(filteredLdapGap, 'username');
  const { paginated: ldapGapPaginated, page: ldapGapPage, setPage: setLdapGapPage, pageSize: ldapGapPageSize, setPageSize: setLdapGapPageSize, totalPages: ldapGapTotalPages, totalItems: ldapGapTotalItems } = usePagination(ldapGapSorted);
  const { sorted: ldapDegSorted, sortBy: ldapDegSortBy, sortDir: ldapDegSortDir, handleSort: handleLdapDegSort } = useSortableTable(filteredLdapDeg, 'username');
  const { paginated: ldapDegPaginated, page: ldapDegPage, setPage: setLdapDegPage, pageSize: ldapDegPageSize, setPageSize: setLdapDegPageSize, totalPages: ldapDegTotalPages, totalItems: ldapDegTotalItems } = usePagination(ldapDegSorted);

  const getAccountBadge = (enabled: number) => {
    return enabled === 1
      ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200'
      : 'bg-red-100 dark:bg-red-800/60 text-red-800 dark:text-red-200';
  };

  const formatGroups = (groups: string[] | string) => {
    if (Array.isArray(groups)) {
      return groups.join(', ');
    }
    return groups;
  };

  return (
    <UXScopeWrapper scopeId="conn-ldap">
    <>
    <div className="space-y-6">
      {selectedUsername && (
        <LDAPDetailPanel
          username={selectedUsername}
          onClose={() => setSelectedUsername(null)}
        />
      )}
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-ux-text">LDAP/AD Portal</h1>
            <p className="mt-2 text-sm text-ux-text-sub">
              Authoritative Source - LDAP/Active Directory
            </p>
          </div>
          {connectorHealth && (
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${
                connectorHealth.status === 'operational' ? 'bg-green-500' : 
                connectorHealth.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
              }`} />
              <span className="text-sm font-medium text-ux-text capitalize">
                Connector {connectorHealth.status}
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
              onClick={() => setActiveTab('users')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'users'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Users ({users?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('coverage')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'coverage'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Coverage Gaps
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
              onClick={() => setActiveTab('connector')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'connector'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Connector Status
            </button>
            <button
              onClick={() => setActiveTab('integration')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'integration'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Integration
            </button>
          </nav>
        </div>

        <div className="p-6">
          {/* Users Tab */}
          {activeTab === 'users' && (
            <>
              {/* Search + Add */}
              <div className="mb-4 flex gap-3 items-start">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search by username, display name, email, or DN..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 bg-ux-surface text-ux-text border border-ux-border rounded-md focus:ring-ux-accent focus:border-ux-accent"
                  />
                  <p className="text-ux-text-sub">Click any row to view full attribute details</p>
                </div>
                <select
                  value={accountFilter}
                  onChange={e => setAccountFilter(e.target.value)}
                  title="Account status filter"
                  className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn"
                >
                  <option value="all">All Accounts</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
                <select
                  value={gcuidFilter}
                  onChange={e => setGcuidFilter(e.target.value)}
                  title="GCUID status filter"
                  className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn"
                >
                  <option value="all">All GCUID</option>
                  <option value="linked">Has GCUID</option>
                  <option value="unlinked">No GCUID</option>
                </select>
                <button
                  onClick={() => { setMutationError(null); setUserModal({ mode: 'create', initial: emptyLDAPForm() }); }}
                  className="px-4 py-2 text-sm font-medium bg-ux-btn text-ux-btn-on rounded-md hover:brightness-90 whitespace-nowrap"
                >
                  + Add User
                </button>
              </div>

              {usersLoading && <LoadingSpinner message="Loading LDAP users..." />}
              {usersError && (
                <ErrorMessage
                  message={usersError instanceof Error ? usersError.message : 'Failed to load users'}
                />
              )}
              {filteredUsers && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-ux-border">
                    <thead className="bg-ux-table-header">
                      <tr>
                        <SortTh col="username" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Username</SortTh>
                        <SortTh col="last_name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Name</SortTh>
                        <SortTh col="email" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Email</SortTh>
                        <SortTh col="department" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Department</SortTh>
                        <SortTh col="account_enabled" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Status</SortTh>
                        <SortTh col="gcuid" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">GCUID</SortTh>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ux-border">
                      {paginatedUsers.map((user) => (
                        <tr
                          key={user.username}
                          className="cursor-pointer bg-ux-surface hover:bg-ux-hover transition-colors"
                          onClick={() => setSelectedUsername(user.username)}
                        >
                          <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-ux-text">{user.username}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text">
                            {(user as any).first_name && (user as any).last_name
                              ? `${(user as any).first_name} ${(user as any).last_name}`
                              : (user as any).display_name || '—'}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub">{user.email}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub">{(user as any).department || '—'}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getAccountBadge(user.account_enabled)}`}>
                              {user.account_enabled === 1 ? 'Enabled' : 'Disabled'}
                            </span>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm">
                            {user.gcuid ? <span className="text-green-700 dark:text-green-400 font-medium">✓ {user.gcuid_state}</span> : <span className="text-ux-text-sub">—</span>}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-right text-sm" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => { setMutationError(null); setUserModal({ mode: 'edit', username: user.username, initial: { username: user.username, distinguished_name: (user as any).distinguished_name ?? '', email: user.email, first_name: (user as any).first_name ?? '', last_name: (user as any).last_name ?? '', department: (user as any).department ?? 'Engineering', title: (user as any).title ?? null, account_enabled: user.account_enabled === 1, groups: (user as any).groups ?? [] } }); }}
                                className="px-2.5 py-1 text-xs font-medium text-ux-text-sub border border-ux-border rounded hover:bg-ux-hover bg-ux-surface/50">Edit</button>
                              <button onClick={() => setDeleteConfirm(user)}
                                className="px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 dark:bg-transparent">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={ldapPage} totalPages={ldapTotalPages} totalItems={ldapTotalItems} pageSize={ldapPageSize} onPageChange={setLdapPage} onPageSizeChange={setLdapPageSize} />
                </div>
              )}
            </>
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
                  {/* Overview Cards */}
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="bg-ux-elevation1 overflow-hidden shadow rounded-lg border border-ux-border">
                      <dl className="p-5">
                        <dt className="text-sm font-medium text-ux-text-sub truncate">Total Users</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-text">
                          {stats.total_users}
                        </dd>
                      </dl>
                    </div>
                    <div className="bg-ux-success-bg overflow-hidden shadow rounded-lg border border-ux-success-border">
                      <dl className="p-5">
                        <dt className="text-sm font-medium text-ux-text-sub truncate">Enabled Accounts</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-success">
                          {stats.enabled_accounts}
                        </dd>
                      </dl>
                    </div>
                    <div className="bg-ux-info-bg overflow-hidden shadow rounded-lg border border-ux-info-border">
                      <dl className="p-5">
                        <dt className="text-sm font-medium text-ux-text-sub truncate">With GCUID</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-info">
                          {stats.with_gcuid}
                          <span className="ml-2 text-sm text-ux-text-sub">({stats.gcuid_percentage})</span>
                        </dd>
                      </dl>
                    </div>
                    <div className="bg-ux-elevation1 overflow-hidden shadow rounded-lg border border-ux-border">
                      <dl className="p-5">
                        <dt className="text-sm font-medium text-ux-text-sub truncate">Without GCUID</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-text-sub">
                          {stats.without_gcuid}
                        </dd>
                      </dl>
                    </div>
                  </div>

                  {/* Account Status Breakdown */}
                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-4">Account Status</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="bg-ux-success-bg rounded-lg p-6 border border-ux-success-border">
                        <div className="text-sm font-medium text-ux-success">Enabled Accounts</div>
                        <div className="mt-2 text-3xl font-semibold text-ux-success">{stats.enabled_accounts}</div>
                      </div>
                      <div className="bg-ux-error-bg rounded-lg p-6 border border-ux-error-border">
                        <div className="text-sm font-medium text-ux-error">Disabled Accounts</div>
                        <div className="mt-2 text-3xl font-semibold text-ux-error">{stats.disabled_accounts}</div>
                      </div>
                    </div>
                  </div>

                  {/* Coverage Indicator */}
                  <div className="bg-ux-accent-subtle border border-ux-accent-subtle-border rounded-lg p-6">
                    <h3 className="text-lg font-medium text-ux-text mb-2">Authoritative Source Coverage</h3>
                    <p className="text-sm text-ux-text-sub mb-4">
                      LDAP/AD is an authoritative source providing {stats.gcuid_percentage} GCUID coverage
                    </p>
                    <div className="text-4xl font-bold text-ux-nav-label">
                      ~34%
                      <span className="ml-3 text-lg text-ux-text-sub">of federal workforce</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Coverage Gaps Tab */}
          {activeTab === 'coverage' && (
            <div className="space-y-6">
              {coverageLoading && <LoadingSpinner message="Analysing LDAP coverage..." />}
              {coverageGaps && (
                <>
                  <div className="bg-ux-warning-bg border border-ux-warning-border rounded-lg p-4">
                    <h3 className="text-base font-semibold text-ux-text mb-1">Coverage Gaps — {coverageGaps.source}</h3>
                    <p className="text-sm text-ux-text-sub">
                      LDAP accounts in the directory that have not yet been issued a GCUID, or whose issued GCUID is in a degraded state.
                    </p>
                  </div>

                  {/* Without GCUID */}
                  <div>
                    <h3 className="text-base font-semibold text-ux-text mb-3">
                      Accounts Without a GCUID
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200">
                        {coverageGaps.gaps.without_gcuid.count}
                      </span>
                    </h3>
                    {coverageGaps.gaps.without_gcuid.count === 0 ? (
                      <p className="text-sm text-ux-success bg-ux-success-bg border border-ux-success-border rounded p-3">
                        ✓ All LDAP accounts have been issued a GCUID.
                      </p>
                    ) : (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 border-b border-yellow-200 dark:border-yellow-700 flex flex-wrap gap-2 items-center">
                          <input type="search" placeholder="Search by username, name, email or department…" value={ldapGapSearch} onChange={e => setLdapGapSearch(e.target.value)} title="Search accounts without GCUID" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn w-full sm:w-64" />
                          <select value={ldapGapDeptFilter} onChange={e => setLdapGapDeptFilter(e.target.value)} title="Filter by department" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                            <option value="">All Departments</option>
                            {[...new Set<string>(((coverageGaps as any)?.gaps?.without_gcuid?.users ?? []).map((u: any) => u.department).filter(Boolean))].sort().map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <select value={ldapGapEnabledFilter} onChange={e => setLdapGapEnabledFilter(e.target.value)} title="Filter by account status" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                            <option value="">All Accounts</option>
                            <option value="1">Enabled</option>
                            <option value="0">Disabled</option>
                          </select>
                        </div>
                        <table className="min-w-full divide-y divide-yellow-200 dark:divide-yellow-800 text-sm">
                          <thead className="bg-ux-table-header">
                            <tr>
                              <SortTh col="username" sortBy={ldapGapSortBy} sortDir={ldapGapSortDir} onSort={handleLdapGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Username</SortTh>
                              <SortTh col="first_name" sortBy={ldapGapSortBy} sortDir={ldapGapSortDir} onSort={handleLdapGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Name</SortTh>
                              <SortTh col="email" sortBy={ldapGapSortBy} sortDir={ldapGapSortDir} onSort={handleLdapGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Email</SortTh>
                              <SortTh col="department" sortBy={ldapGapSortBy} sortDir={ldapGapSortDir} onSort={handleLdapGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Department</SortTh>
                              <SortTh col="account_enabled" sortBy={ldapGapSortBy} sortDir={ldapGapSortDir} onSort={handleLdapGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Enabled</SortTh>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-yellow-100 dark:divide-yellow-900">
                            {ldapGapPaginated.map((u: any) => (
                              <tr key={u.username} className="cursor-pointer hover:bg-ux-hover transition-colors" onClick={() => setSelectedUsername(u.username)}>
                                <td className="px-4 py-2 font-mono text-xs text-ux-text-sub">{u.username}</td>
                                <td className="px-4 py-2 text-ux-text">{u.first_name} {u.last_name}</td>
                                <td className="px-4 py-2 text-ux-text-sub">{u.email}</td>
                                <td className="px-4 py-2 text-ux-text-sub">{u.department}</td>
                                <td className="px-4 py-2">{u.account_enabled ? '✓' : '✕'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <Pagination page={ldapGapPage} totalPages={ldapGapTotalPages} totalItems={ldapGapTotalItems} pageSize={ldapGapPageSize} onPageChange={setLdapGapPage} onPageSizeChange={setLdapGapPageSize} accentClass="text-yellow-700 dark:text-yellow-400" />
                      </div>
                    )}
                  </div>

                  {/* Degraded Coverage */}
                  <div>
                    <h3 className="text-base font-semibold text-ux-text mb-3">
                      Degraded Coverage
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 dark:bg-orange-800/60 text-orange-800 dark:text-orange-200">
                        {coverageGaps.gaps.degraded_coverage.count}
                      </span>
                    </h3>
                    {coverageGaps.gaps.degraded_coverage.count === 0 ? (
                      <p className="text-sm text-ux-success bg-ux-success-bg border border-ux-success-border rounded p-3">
                        ✓ No LDAP-backed identities are in a degraded state.
                      </p>
                    ) : (
                      <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 border-b border-orange-200 dark:border-orange-700 flex flex-wrap gap-2 items-center">
                          <input type="search" placeholder="Search by username or GCUID…" value={ldapDegSearch} onChange={e => setLdapDegSearch(e.target.value)} title="Search degraded coverage records" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn w-full sm:w-64" />
                          <select value={ldapDegStateFilter} onChange={e => setLdapDegStateFilter(e.target.value)} title="Filter by state" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                            <option value="">All States</option>
                            {[...new Set<string>(((coverageGaps as any)?.gaps?.degraded_coverage?.records ?? []).map((r: any) => r.state).filter(Boolean))].sort().map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                          </select>
                        </div>
                        <table className="min-w-full divide-y divide-orange-200 dark:divide-orange-800 text-sm">
                          <thead className="bg-ux-table-header">
                            <tr>
                              <SortTh col="username" sortBy={ldapDegSortBy} sortDir={ldapDegSortDir} onSort={handleLdapDegSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">Username</SortTh>
                              <SortTh col="gcuid" sortBy={ldapDegSortBy} sortDir={ldapDegSortDir} onSort={handleLdapDegSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">GCUID</SortTh>
                              <SortTh col="state" sortBy={ldapDegSortBy} sortDir={ldapDegSortDir} onSort={handleLdapDegSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">State</SortTh>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-orange-100 dark:divide-orange-900">
                            {ldapDegPaginated.map((r: any) => (
                              <tr key={r.username + r.gcuid} className="cursor-pointer hover:bg-ux-hover transition-colors" onClick={() => setSelectedUsername(r.username)}>
                                <td className="px-4 py-2 font-mono text-xs text-ux-text-sub">{r.username}</td>
                                <td className="px-4 py-2 font-mono text-xs text-ux-text-sub">{r.gcuid}</td>
                                <td className="px-4 py-2 capitalize text-ux-text-sub">{r.state}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <Pagination page={ldapDegPage} totalPages={ldapDegTotalPages} totalItems={ldapDegTotalItems} pageSize={ldapDegPageSize} onPageChange={setLdapDegPage} onPageSizeChange={setLdapDegPageSize} accentClass="text-orange-700 dark:text-orange-400" />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Connector Status Tab */}
          {activeTab === 'connector' && (
            <div className="space-y-6">
              {healthLoading && <LoadingSpinner message="Checking connector health..." />}
              {connectorHealth && (
                <ConnectorStatusPanel
                  data={connectorHealth}
                  about="LDAP / Active Directory is an authoritative source that the GCUID registry queries live on demand. Account status and group membership are security-sensitive and must always reflect the current directory state — no caching is applied. Every identity lookup goes directly to the LDAP connector."
                />
              )}
            </div>
          )}

          {/* Integration Tab */}
          {activeTab === 'integration' && (
            <ConnectorIntegrationTab connectorId="conn-ldap" />
          )}
        </div>
      </div>
    </div>

    {userModal && (
      <LDAPUserModal
        mode={userModal.mode}
        initial={userModal.initial}
        saving={createMutation.isPending || updateMutation.isPending}
        error={mutationError}
        departments={ldapDepartments}
        onCancel={() => { setUserModal(null); setMutationError(null); }}
        onSave={(data) => {
          if (userModal.mode === 'create') createMutation.mutate(data);
          else updateMutation.mutate({ username: userModal.username, data });
        }}
      />
    )}

    {deleteConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
        <div className="w-full max-w-sm bg-ux-surface rounded-xl shadow-2xl p-6">
          <h3 className="text-base font-semibold text-ux-text mb-2">Delete User?</h3>
          <p className="text-sm text-ux-text-sub mb-1">Permanently remove:</p>
          <p className="font-semibold text-ux-text mb-1">{(deleteConfirm as any).first_name} {(deleteConfirm as any).last_name}</p>
          <code className="block text-xs font-mono text-ux-text-sub mb-4">{deleteConfirm.username}</code>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-ux-text border border-ux-border rounded-md hover:bg-ux-hover bg-ux-surface">Cancel</button>
            <button onClick={() => deleteMutation.mutate(deleteConfirm.username)} disabled={deleteMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
    </UXScopeWrapper>
  );
}
