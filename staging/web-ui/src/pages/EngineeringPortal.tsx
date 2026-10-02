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
import { engineeringApi, EngineeringEmployee, EngineeringEmployeeInput } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import ConnectorCacheBar from '../components/ConnectorCacheBar';
import { useSortableTable } from '../hooks/useSortableTable';
import { usePagination } from '../hooks/usePagination';
import { SortTh } from '../components/SortTh';
import { GcuidRequestPanel } from '../components/GcuidRequestPanel';
import { ConnectorStatusPanel } from '../components/ConnectorStatusPanel';
import { ConnectorIntegrationTab } from '../components/ConnectorIntegrationTab';
import { Pagination } from '../components/Pagination';
import { UXScopeWrapper } from '../context/UXThemeContext';

const ENG_EMP_TYPES = ['FTE', 'Contractor', 'Inter-agency Detail'];
const ENG_ROLES = [
  'Backend Developer', 'Cloud Architect', 'Database Admin', 'DevOps Engineer',
  'Engineering Manager', 'Frontend Developer', 'Full Stack Developer', 'Intern',
  'Junior Developer', 'Mobile Developer', 'Network Engineer', 'Product Owner',
  'QA Engineer', 'Security Engineer', 'Senior Software Engineer',
  'Site Reliability Engineer', 'Software Engineer', 'Systems Analyst',
  'Technical Writer', 'UI/UX Designer',
];

const emptyEngForm = (): EngineeringEmployeeInput => ({
  first_name: '', last_name: '', email: '', role: 'Software Engineer',
  employment_type: 'FTE', start_date: new Date().toISOString().slice(0, 10),
  end_date: null, status: 'active', hr_employee_id: null, ldap_username: null,
  skills: [], manager_dept_id: null,
});

function EngineeringEmployeeModal({
  mode, initial, saving, error, onSave, onCancel,
}: {
  mode: 'create' | 'edit';
  initial: EngineeringEmployeeInput;
  saving: boolean;
  error: string | null;
  onSave: (data: EngineeringEmployeeInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EngineeringEmployeeInput>(initial);
  const set = <K extends keyof EngineeringEmployeeInput>(k: K, v: EngineeringEmployeeInput[K]) => setForm(f => ({ ...f, [k]: v }));
  const skillsStr = Array.isArray(form.skills) ? form.skills.join(', ') : (form.skills ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="w-full max-w-lg bg-ux-surface rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ux-border">
          <h2 className="text-base font-semibold text-ux-text">{mode === 'create' ? 'Add Engineering Employee' : 'Edit Engineering Employee'}</h2>
          <button onClick={onCancel} className="text-ux-text-sub">✕</button>
        </div>
        <div className="overflow-y-auto p-6 space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-3">{error}</div>}
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
              <label className="block text-xs font-medium text-ux-text mb-1">Role *</label>
              <select value={form.role} onChange={e => set('role', e.target.value)}
                title="Role"
                className="w-full px-3 py-2 border border-ux-border rounded text-sm">
                {ENG_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Employment Type *</label>
              <select value={form.employment_type} onChange={e => set('employment_type', e.target.value)}
                title="Employment Type"
                className="w-full px-3 py-2 border border-ux-border rounded text-sm">
                {ENG_EMP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Start Date *</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">End Date</label>
              <input type="date" value={form.end_date ?? ''} onChange={e => set('end_date', e.target.value || null)}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ux-text mb-1">Skills (comma-separated)</label>
            <textarea value={skillsStr}
              onChange={e => set('skills', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              className="w-full px-3 py-2 border border-ux-border rounded text-sm" rows={2}
              placeholder="TypeScript, React, Node.js" />
          </div>
          <div className="border-t border-ux-border pt-3">
            <p className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-2">Linkage (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ux-text mb-1">HR Employee ID</label>
                <input value={form.hr_employee_id ?? ''} onChange={e => set('hr_employee_id', e.target.value || null)}
                  className="w-full px-3 py-2 border border-ux-border rounded text-sm font-mono" placeholder="E10001" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ux-text mb-1">LDAP Username</label>
                <input value={form.ldap_username ?? ''} onChange={e => set('ldap_username', e.target.value || null)}
                  className="w-full px-3 py-2 border border-ux-border rounded text-sm font-mono" placeholder="jsmith" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-ux-border">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-ux-text border border-ux-border rounded-md hover:bg-ux-hover bg-ux-surface">Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-ux-btn text-ux-btn-on rounded-md hover:brightness-90 disabled:opacity-50">
            {saving ? 'Saving…' : mode === 'create' ? 'Add Employee' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EngineeringDetailPanel({ deptId, onClose }: { deptId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: employee, isLoading, error } = useQuery({
    queryKey: ['engineering-employee', deptId],
    queryFn: () => engineeringApi.viewEmployee(deptId),
  });

  const skillList: string[] = employee
    ? Array.isArray(employee.skills)
      ? employee.skills
      : (() => { try { return JSON.parse(employee.skills as string); } catch { return [employee.skills as string]; } })()
    : [];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black bg-opacity-30" onClick={onClose} />
      {/* Panel */}
      <div className="w-full max-w-xl bg-ux-surface shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ux-border bg-ux-surface-alt">
          <div>
            <h2 className="text-lg font-semibold text-ux-text">Engineering Employee</h2>
            <p className="text-xs text-ux-text-sub font-mono">{deptId}</p>
          </div>
          <button onClick={onClose} className="text-ux-text-sub">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading && <LoadingSpinner message="Loading employee details..." />}
          {error && <ErrorMessage message={error instanceof Error ? error.message : 'Failed to load'} />}
          {employee && (
            <>
              {/* Banner */}
              <div className="flex items-center gap-4 p-4 bg-ux-success-bg border border-ux-success-border rounded-lg">
                <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
                  {employee.first_name?.[0]}{employee.last_name?.[0]}
                </div>
                <div>
                  <div className="text-lg font-semibold text-ux-text">{employee.first_name} {employee.last_name}</div>
                  <div className="text-sm text-ux-text-sub">{employee.employment_type}</div>
                  <div className="text-xs text-ux-text-sub">{employee.email}</div>
                </div>
              </div>

              {/* Attributes */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">Department Attributes</h3>
                <dl className="space-y-2">
                  {[
                    { label: 'Dept ID',         value: employee.dept_id,         mono: true },
                    { label: 'First Name',       value: employee.first_name },
                    { label: 'Last Name',        value: employee.last_name },
                    { label: 'Email',            value: employee.email },
                    { label: 'Employment Type',  value: employee.employment_type },
                    { label: 'Start Date',       value: employee.start_date },
                    { label: 'HR ID',            value: employee.hr_employee_id,  mono: true },
                    { label: 'LDAP Username',    value: employee.ldap_username,   mono: true },
                  ].filter(f => f.value != null).map(field => (
                    <div key={field.label} className="flex justify-between items-start py-1.5 border-b border-ux-border">
                      <dt className="text-sm text-ux-text-sub w-36 flex-shrink-0">{field.label}</dt>
                      <dd className={`text-sm text-right ${field.mono ? 'font-mono text-ux-text' : 'text-ux-text'}`}>
                        {String(field.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              {/* Skills */}
              {skillList.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">Skills</h3>
                  <div className="flex flex-wrap gap-2">
                    {skillList.map((skill: string) => (
                      <span key={skill} className="px-2 py-1 bg-[#e8ede6] dark:bg-green-800/60 text-green-800 dark:text-green-200 rounded text-xs font-medium">{skill}</span>
                    ))}
                  </div>
                </section>
              )}

              {/* GCUID Linkage */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">GCUID Identity Linkage</h3>
                {employee.gcuid_details ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-ux-success-bg border border-ux-success-border rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-sm font-medium text-green-800 dark:text-green-200">Linked to GCUID</span>
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                          employee.gcuid_details.state === 'active' ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200' : 'bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200'
                        }`}>{employee.gcuid_details.state}</span>
                      </div>
                      <code className="text-xs font-mono text-ux-text break-all block">{employee.gcuid_details.gcuid}</code>
                    </div>
                    {employee.gcuid_details.source_mappings?.length > 0 && (
                      <div>
                        <p className="text-xs text-ux-text-sub mb-2">All source mappings for this identity:</p>
                        <div className="space-y-1">
                          {employee.gcuid_details.source_mappings.map((sm: any) => (
                            <div key={sm.source_system} className="flex items-center gap-2 px-3 py-1.5 bg-ux-surface-alt rounded border border-ux-border text-xs">
                              <span className="font-medium text-ux-text uppercase w-20">{sm.source_system}</span>
                              <code className="font-mono text-ux-text-sub">{sm.source_id}</code>
                              {sm.is_primary && <span className="ml-auto px-1.5 py-0.5 bg-blue-100 dark:bg-blue-800/60 text-blue-700 dark:text-blue-300 rounded text-xs">primary</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <GcuidRequestPanel
                    sourceSystem="engineering"
                    sourceId={employee.dept_id}
                    attributes={{ first_name: employee.first_name, last_name: employee.last_name, email: employee.email }}
                    onComplete={() => {
                      qc.invalidateQueries({ queryKey: ['engineering-employee', deptId] });
                      qc.invalidateQueries({ queryKey: ['engineering-employees'] });
                      qc.invalidateQueries({ queryKey: ['engineering-stats'] });
                      qc.invalidateQueries({ queryKey: ['engineering-coverage'] });
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

export default function EngineeringPortal() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'employees' | 'coverage' | 'stats' | 'connector' | 'integration'>('employees');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [gcuidFilter, setGcuidFilter] = useState('all');
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [empModal, setEmpModal] = useState<{ mode: 'create'; initial: EngineeringEmployeeInput } | { mode: 'edit'; id: string; initial: EngineeringEmployeeInput } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<EngineeringEmployee | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mgSearch, setMgSearch] = useState('');
  const [mgTypeFilter, setMgTypeFilter] = useState('');
  const [mhrSearch, setMhrSearch] = useState('');
  const [mhrTypeFilter, setMhrTypeFilter] = useState('');
  const [mlSearch, setMlSearch] = useState('');
  const [mlTypeFilter, setMlTypeFilter] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['engineering-employees'] });

  const createMutation = useMutation({
    mutationFn: engineeringApi.createEmployee,
    onSuccess: () => { invalidate(); setEmpModal(null); setMutationError(null); },
    onError: (e: any) => setMutationError(e?.message ?? 'Failed to create employee'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EngineeringEmployeeInput> }) => engineeringApi.updateEmployee(id, data),
    onSuccess: () => { invalidate(); setEmpModal(null); setMutationError(null); },
    onError: (e: any) => setMutationError(e?.message ?? 'Failed to update employee'),
  });
  const deleteMutation = useMutation({
    mutationFn: engineeringApi.deleteEmployee,
    onSuccess: () => { invalidate(); setDeleteConfirm(null); setMutationError(null); },
    onError: (e: any) => { setDeleteConfirm(null); setMutationError(e?.message ?? 'Failed to delete employee'); },
  });

  // Fetch employees
  const { data: employees, isLoading: employeesLoading, error: employeesError } = useQuery({
    queryKey: ['engineering-employees'],
    queryFn: engineeringApi.listEmployees,
  });

  // Fetch stats
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['engineering-stats'],
    queryFn: engineeringApi.getStats,
  });

  // Fetch coverage gaps
  const { data: coverageGaps, isLoading: coverageLoading, error: coverageError } = useQuery({
    queryKey: ['engineering-coverage'],
    queryFn: engineeringApi.getCoverageGaps,
  });

  // Fetch connector health
  const { data: connectorHealth, isLoading: connectorLoading } = useQuery({
    queryKey: ['engineering-connector-health'],
    queryFn: engineeringApi.getConnectorHealth,
    enabled: activeTab === 'connector',
    refetchInterval: activeTab === 'connector' ? 30000 : false,
  });

  const filteredEmployees = employees?.filter(emp => {
    const matchSearch = searchQuery === '' ||
      `${emp.first_name} ${emp.last_name} ${emp.email} ${emp.dept_id}`
        .toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = typeFilter === 'all' || emp.employment_type === typeFilter;
    const matchGcuid = gcuidFilter === 'all' || (gcuidFilter === 'linked' ? !!emp.gcuid : !emp.gcuid);
    return matchSearch && matchType && matchGcuid;
  });

  const { sorted: sortedEmployees, sortBy: empSortBy, sortDir: empSortDir, handleSort: handleEmpSort } = useSortableTable(filteredEmployees, 'dept_id');
  const { paginated: paginatedEmployees, page: engPage, setPage: setEngPage, pageSize: engPageSize, setPageSize: setEngPageSize, totalPages: engTotalPages, totalItems: engTotalItems } = usePagination(sortedEmployees);
  const filteredMissingGcuid = (() => {
    const raw = coverageGaps?.missing_gcuid;
    if (!raw) return raw;
    let data: any[] = raw;
    if (mgSearch) data = data.filter((e: any) =>
      `${e.dept_id} ${e.name} ${e.email}`.toLowerCase().includes(mgSearch.toLowerCase())
    );
    if (mgTypeFilter) data = data.filter((e: any) => e.employment_type === mgTypeFilter);
    return data;
  })();
  const filteredMissingHr = (() => {
    const raw = coverageGaps?.missing_hr;
    if (!raw) return raw;
    let data: any[] = raw;
    if (mhrSearch) data = data.filter((e: any) =>
      `${e.dept_id} ${e.name} ${e.email}`.toLowerCase().includes(mhrSearch.toLowerCase())
    );
    if (mhrTypeFilter) data = data.filter((e: any) => e.employment_type === mhrTypeFilter);
    return data;
  })();
  const filteredMissingLdap = (() => {
    const raw = coverageGaps?.missing_ldap;
    if (!raw) return raw;
    let data: any[] = raw;
    if (mlSearch) data = data.filter((e: any) =>
      `${e.dept_id} ${e.name} ${e.email}`.toLowerCase().includes(mlSearch.toLowerCase())
    );
    if (mlTypeFilter) data = data.filter((e: any) => e.employment_type === mlTypeFilter);
    return data;
  })();
  const { sorted: sortedMissingGcuid, sortBy: mgSortBy, sortDir: mgSortDir, handleSort: handleMgSort } = useSortableTable(filteredMissingGcuid, 'dept_id');
  const { paginated: paginatedMissingGcuid, page: mgPage, setPage: setMgPage, pageSize: mgPageSize, setPageSize: setMgPageSize, totalPages: mgTotalPages, totalItems: mgTotalItems } = usePagination(sortedMissingGcuid);
  const { sorted: sortedMissingHr, sortBy: mhrSortBy, sortDir: mhrSortDir, handleSort: handleMhrSort } = useSortableTable(filteredMissingHr, 'dept_id');
  const { paginated: paginatedMissingHr, page: mhrPage, setPage: setMhrPage, pageSize: mhrPageSize, setPageSize: setMhrPageSize, totalPages: mhrTotalPages, totalItems: mhrTotalItems } = usePagination(sortedMissingHr);
  const { sorted: sortedMissingLdap, sortBy: mlSortBy, sortDir: mlSortDir, handleSort: handleMlSort } = useSortableTable(filteredMissingLdap, 'dept_id');
  const { paginated: paginatedMissingLdap, page: mlPage, setPage: setMlPage, pageSize: mlPageSize, setPageSize: setMlPageSize, totalPages: mlTotalPages, totalItems: mlTotalItems } = usePagination(sortedMissingLdap);

  const getEmploymentTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      'FTE': 'bg-blue-100 dark:bg-blue-800/60 text-blue-800 dark:text-blue-200',
      'Contractor': 'bg-purple-100 dark:bg-purple-800/60 text-purple-800 dark:text-purple-200',
      'Inter-agency Detail': 'bg-indigo-100 dark:bg-indigo-800/60 text-indigo-800 dark:text-indigo-200',
    };
    return colors[type] || 'bg-ux-hover text-ux-text';
  };

  return (
    <UXScopeWrapper scopeId="conn-engineering">
    <>
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-ux-text">Engineering Department Portal</h1>
        <p className="mt-2 text-sm text-ux-text-sub">
          Department System - Monitor engineering employees and GCUID coverage
        </p>
        <div className="mt-3">
          <ConnectorCacheBar connectorId="conn-engineering" showSyncButton={false} />
        </div>
      </div>

      {/* Tabs */}
      <div className="card p-0">
        <div className="border-b border-ux-border">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('employees')}
              className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'employees'
                  ? 'border-ux-accent text-ux-accent'
                  : 'border-transparent text-ux-text-sub hover:text-ux-text hover:border-ux-border'
              }`}
            >
              Employees ({employees?.length || 0})
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
          {/* Employees Tab */}
          {activeTab === 'employees' && (
            <>
              {/* Search + Add */}
              <div className="mb-4 flex gap-3 items-start">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search by name, email, or ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 bg-ux-surface text-ux-text border border-ux-border rounded-md focus:ring-ux-accent focus:border-ux-accent"
                  />
                </div>
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value)}
                  title="Employment type filter"
                  className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn"
                >
                  <option value="all">All Types</option>
                  <option value="FTE">FTE</option>
                  <option value="Contractor">Contractor</option>
                  <option value="Inter-agency Detail">Inter-agency Detail</option>
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
                  onClick={() => { setMutationError(null); setEmpModal({ mode: 'create', initial: emptyEngForm() }); }}
                  className="px-4 py-2 text-sm font-medium bg-ux-btn text-ux-btn-on rounded-md hover:brightness-90 whitespace-nowrap"
                >
                  + Add Employee
                </button>
              </div>

              {employeesLoading && <LoadingSpinner message="Loading employees..." />}
              {employeesError && (
                <ErrorMessage
                  message={employeesError instanceof Error ? employeesError.message : 'Failed to load employees'}
                />
              )}
              {filteredEmployees && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-ux-border">
                    <thead className="bg-ux-table-header">
                      <tr>
                        <SortTh col="dept_id" sortBy={empSortBy} sortDir={empSortDir} onSort={handleEmpSort} activeClass="text-ux-nav-label">Dept ID</SortTh>
                        <SortTh col="last_name" sortBy={empSortBy} sortDir={empSortDir} onSort={handleEmpSort} activeClass="text-ux-nav-label">Name</SortTh>
                        <SortTh col="email" sortBy={empSortBy} sortDir={empSortDir} onSort={handleEmpSort} activeClass="text-ux-nav-label">Email</SortTh>
                        <SortTh col="employment_type" sortBy={empSortBy} sortDir={empSortDir} onSort={handleEmpSort} activeClass="text-ux-nav-label">Type</SortTh>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Coverage</th>
                        <SortTh col="gcuid" sortBy={empSortBy} sortDir={empSortDir} onSort={handleEmpSort} activeClass="text-ux-nav-label">GCUID</SortTh>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ux-border">
                      {paginatedEmployees.map((emp) => (
                        <tr
                          key={emp.dept_id}
                              className="cursor-pointer bg-ux-surface hover:bg-ux-hover transition-colors"
                          onClick={() => setSelectedDeptId(emp.dept_id)}
                        >
                          <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-ux-text">{emp.dept_id}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text">{emp.first_name} {emp.last_name}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub">{emp.email}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getEmploymentTypeBadge(emp.employment_type)}`}>{emp.employment_type}</span>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm">
                            <div className="flex items-center space-x-2">
                              <span className={`text-xs ${emp.hr_employee_id ? 'text-green-700 dark:text-green-400' : 'text-ux-text-sub'}`}>
                                {emp.hr_employee_id ? '✓' : '✗'} HR
                              </span>
                              <span className={`text-xs ${emp.ldap_username ? 'text-green-700 dark:text-green-400' : 'text-ux-text-sub'}`}>
                                {emp.ldap_username ? '✓' : '✗'} LDAP
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm">
                            {emp.gcuid ? <span className="text-green-700 dark:text-green-400 font-medium">✓ Active</span> : <span className="text-ux-text-sub">—</span>}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-right text-sm" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => { setMutationError(null); const skills = Array.isArray(emp.skills) ? emp.skills : (emp.skills ? (() => { try { return JSON.parse(emp.skills as string); } catch { return [emp.skills as string]; } })() : []); setEmpModal({ mode: 'edit', id: emp.dept_id, initial: { first_name: emp.first_name, last_name: emp.last_name, email: emp.email, role: emp.role, employment_type: emp.employment_type, start_date: emp.start_date, end_date: emp.end_date ?? null, status: emp.status, hr_employee_id: emp.hr_employee_id ?? null, ldap_username: emp.ldap_username ?? null, skills, manager_dept_id: emp.manager_dept_id ?? null } }); }}
                                className="px-2.5 py-1 text-xs font-medium text-ux-text-sub border border-ux-border rounded hover:bg-ux-hover bg-ux-surface/50">Edit</button>
                              <button onClick={() => setDeleteConfirm(emp)}
                                className="px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 dark:bg-transparent">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={engPage} totalPages={engTotalPages} totalItems={engTotalItems} pageSize={engPageSize} onPageChange={setEngPage} onPageSizeChange={setEngPageSize} />
                </div>
              )}
            </>
          )}

          {/* Coverage Gaps Tab */}
          {activeTab === 'coverage' && (
            <>
              {coverageLoading && <LoadingSpinner message="Loading coverage data..." />}
              {coverageError && (
                <ErrorMessage
                  message={coverageError instanceof Error ? coverageError.message : 'Failed to load coverage data'}
                />
              )}
              {coverageGaps && (
                <div className="space-y-6">
                  {/* Missing GCUID */}
                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-3">
                      Missing GCUID ({coverageGaps.missing_gcuid.length})
                    </h3>
                    {coverageGaps.missing_gcuid.length > 0 ? (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 border-b border-yellow-200 dark:border-yellow-700 flex flex-wrap gap-2 items-center">
                          <input type="search" placeholder="Search by ID, name or email…" value={mgSearch} onChange={e => setMgSearch(e.target.value)} title="Search employees missing GCUID" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn w-full sm:w-64" />
                          <select value={mgTypeFilter} onChange={e => setMgTypeFilter(e.target.value)} title="Filter by employment type" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                            <option value="">All Types</option>
                            {[...new Set<string>((coverageGaps?.missing_gcuid?.map((e: any) => e.employment_type) || []).filter(Boolean))].sort().map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <table className="min-w-full divide-y divide-ux-border">
                          <thead className="bg-ux-table-header">
                            <tr>
                              <SortTh col="dept_id" sortBy={mgSortBy} sortDir={mgSortDir} onSort={handleMgSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">ID</SortTh>
                              <SortTh col="name" sortBy={mgSortBy} sortDir={mgSortDir} onSort={handleMgSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Name</SortTh>
                              <SortTh col="email" sortBy={mgSortBy} sortDir={mgSortDir} onSort={handleMgSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Email</SortTh>
                              <SortTh col="employment_type" sortBy={mgSortBy} sortDir={mgSortDir} onSort={handleMgSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Type</SortTh>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ux-border">
                            {paginatedMissingGcuid.map((emp) => (
                              <tr key={emp.dept_id} className="cursor-pointer hover:bg-ux-hover transition-colors" onClick={() => setSelectedDeptId(emp.dept_id)}>
                                <td className="px-4 py-3 text-sm text-ux-text">{emp.dept_id}</td>
                                <td className="px-4 py-3 text-sm text-ux-text">{emp.name}</td>
                                <td className="px-4 py-3 text-sm text-ux-text-sub">{emp.email}</td>
                                <td className="px-4 py-3 text-sm text-ux-text-sub">{emp.employment_type}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <Pagination page={mgPage} totalPages={mgTotalPages} totalItems={mgTotalItems} pageSize={mgPageSize} onPageChange={setMgPage} onPageSizeChange={setMgPageSize} accentClass="text-yellow-700 dark:text-yellow-400" />
                      </div>
                    ) : (
                      <p className="text-sm text-ux-text-sub">All employees have GCUIDs assigned.</p>
                    )}
                  </div>

                  {/* Missing HR */}
                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-3">
                      Missing HR Record ({coverageGaps.missing_hr.length})
                    </h3>
                    {coverageGaps.missing_hr.length > 0 ? (
                      <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 border-b border-orange-200 dark:border-orange-700 flex flex-wrap gap-2 items-center">
                          <input type="search" placeholder="Search by ID, name or email…" value={mhrSearch} onChange={e => setMhrSearch(e.target.value)} title="Search employees missing HR record" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn w-full sm:w-64" />
                          <select value={mhrTypeFilter} onChange={e => setMhrTypeFilter(e.target.value)} title="Filter by employment type" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                            <option value="">All Types</option>
                            {[...new Set<string>((coverageGaps?.missing_hr?.map((e: any) => e.employment_type) || []).filter(Boolean))].sort().map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <table className="min-w-full divide-y divide-ux-border">
                          <thead className="bg-ux-table-header">
                            <tr>
                              <SortTh col="dept_id" sortBy={mhrSortBy} sortDir={mhrSortDir} onSort={handleMhrSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">ID</SortTh>
                              <SortTh col="name" sortBy={mhrSortBy} sortDir={mhrSortDir} onSort={handleMhrSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">Name</SortTh>
                              <SortTh col="email" sortBy={mhrSortBy} sortDir={mhrSortDir} onSort={handleMhrSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">Email</SortTh>
                              <SortTh col="employment_type" sortBy={mhrSortBy} sortDir={mhrSortDir} onSort={handleMhrSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">Type</SortTh>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ux-border">
                            {paginatedMissingHr.map((emp) => (
                              <tr key={emp.dept_id} className="cursor-pointer hover:bg-ux-hover transition-colors" onClick={() => setSelectedDeptId(emp.dept_id)}>
                                <td className="px-4 py-3 text-sm text-ux-text">{emp.dept_id}</td>
                                <td className="px-4 py-3 text-sm text-ux-text">{emp.name}</td>
                                <td className="px-4 py-3 text-sm text-ux-text-sub">{emp.email}</td>
                                <td className="px-4 py-3 text-sm"><span className={`px-2 py-1 text-xs font-medium rounded-full ${getEmploymentTypeBadge(emp.employment_type)}`}>{emp.employment_type}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <Pagination page={mhrPage} totalPages={mhrTotalPages} totalItems={mhrTotalItems} pageSize={mhrPageSize} onPageChange={setMhrPage} onPageSizeChange={setMhrPageSize} accentClass="text-orange-700 dark:text-orange-400" />
                      </div>
                    ) : (
                      <p className="text-sm text-ux-text-sub">All employees have HR records.</p>
                    )}
                  </div>

                  {/* Missing LDAP */}
                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-3">
                      Missing LDAP Account ({coverageGaps.missing_ldap.length})
                    </h3>
                    {coverageGaps.missing_ldap.length > 0 ? (
                      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 border-b border-red-200 dark:border-red-700 flex flex-wrap gap-2 items-center">
                          <input type="search" placeholder="Search by ID, name or email…" value={mlSearch} onChange={e => setMlSearch(e.target.value)} title="Search employees missing LDAP account" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn w-full sm:w-64" />
                          <select value={mlTypeFilter} onChange={e => setMlTypeFilter(e.target.value)} title="Filter by employment type" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                            <option value="">All Types</option>
                            {[...new Set<string>((coverageGaps?.missing_ldap?.map((e: any) => e.employment_type) || []).filter(Boolean))].sort().map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <table className="min-w-full divide-y divide-red-200">
                          <thead className="bg-ux-error-bg">
                            <tr>
                              <SortTh col="dept_id" sortBy={mlSortBy} sortDir={mlSortDir} onSort={handleMlSort} activeClass="text-red-700 dark:text-red-300" className="px-4">ID</SortTh>
                              <SortTh col="name" sortBy={mlSortBy} sortDir={mlSortDir} onSort={handleMlSort} activeClass="text-red-700 dark:text-red-300" className="px-4">Name</SortTh>
                              <SortTh col="email" sortBy={mlSortBy} sortDir={mlSortDir} onSort={handleMlSort} activeClass="text-red-700 dark:text-red-300" className="px-4">Email</SortTh>
                              <SortTh col="employment_type" sortBy={mlSortBy} sortDir={mlSortDir} onSort={handleMlSort} activeClass="text-red-700 dark:text-red-300" className="px-4">Type</SortTh>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-red-200">
                            {paginatedMissingLdap.map((emp) => (
                              <tr key={emp.dept_id} className="cursor-pointer hover:bg-ux-hover transition-colors" onClick={() => setSelectedDeptId(emp.dept_id)}>
                                <td className="px-4 py-3 text-sm text-ux-text">{emp.dept_id}</td>
                                <td className="px-4 py-3 text-sm text-ux-text">{emp.name}</td>
                                <td className="px-4 py-3 text-sm text-ux-text-sub">{emp.email}</td>
                                <td className="px-4 py-3 text-sm"><span className={`px-2 py-1 text-xs font-medium rounded-full ${getEmploymentTypeBadge(emp.employment_type)}`}>{emp.employment_type}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <Pagination page={mlPage} totalPages={mlTotalPages} totalItems={mlTotalItems} pageSize={mlPageSize} onPageChange={setMlPage} onPageSizeChange={setMlPageSize} accentClass="text-red-700 dark:text-red-400" />
                      </div>
                    ) : (
                      <p className="text-sm text-ux-text-sub">All employees have LDAP accounts.</p>
                    )}
                  </div>
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
                        <dt className="text-sm font-medium text-ux-text-sub truncate">Total Employees</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-text">
                          {stats.total_employees}
                        </dd>
                      </dl>
                    </div>
                    <div className="bg-ux-elevation1 overflow-hidden shadow rounded-lg border border-ux-border">
                      <dl className="p-5">
                        <dt className="text-sm font-medium text-ux-text-sub truncate">With HR Record</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-text">
                          {stats.coverage.with_hr}
                          <span className="ml-2 text-sm text-ux-text-sub">({stats.coverage.hr_percentage})</span>
                        </dd>
                      </dl>
                    </div>
                    <div className="bg-ux-elevation1 overflow-hidden shadow rounded-lg border border-ux-border">
                      <dl className="p-5">
                        <dt className="text-sm font-medium text-ux-text-sub truncate">With LDAP</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-text">
                          {stats.coverage.with_ldap}
                          <span className="ml-2 text-sm text-ux-text-sub">({stats.coverage.ldap_percentage})</span>
                        </dd>
                      </dl>
                    </div>
                    <div className="bg-ux-success-bg overflow-hidden shadow rounded-lg border border-ux-success-border">
                      <dl className="p-5">
                        <dt className="text-sm font-medium text-ux-text-sub truncate">With GCUID</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-success">
                          {stats.coverage.with_gcuid}
                          <span className="ml-2 text-sm text-ux-text-sub">({stats.coverage.gcuid_percentage})</span>
                        </dd>
                      </dl>
                    </div>
                  </div>

                  {/* Employment Types */}
                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-4">By Employment Type</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {Object.entries(stats.employment_types).map(([type, count]) => (
                        <div key={type} className="bg-ux-surface-alt rounded-lg p-4">
                          <div className="text-sm font-medium text-ux-text-sub">{type}</div>
                          <div className="mt-1 text-2xl font-semibold text-ux-text">{count}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Full Coverage */}
                  <div className="bg-ux-accent-subtle border border-ux-accent-subtle-border rounded-lg p-6">
                    <h3 className="text-lg font-medium text-ux-text mb-2">Full Coverage</h3>
                    <p className="text-sm text-ux-text-sub mb-4">
                      Employees with HR record, LDAP account, and active GCUID
                    </p>
                    <div className="text-4xl font-bold text-ux-nav-label">
                      {stats.coverage.full_coverage}
                      <span className="ml-3 text-2xl text-ux-text-sub">({stats.coverage.full_coverage_percentage})</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Connector Status Tab */}
          {activeTab === 'connector' && (
            <div className="space-y-6">
              {connectorLoading && <LoadingSpinner message="Checking connector status..." />}
              {connectorHealth && (
                <ConnectorStatusPanel
                  data={connectorHealth}
                  about="The Engineering department connector synchronises records from the department DB on a schedule and reports identity coverage gaps. The registry serves all attribute lookups from the local cache, reducing load on the department system."
                />
              )}
            </div>
          )}

          {/* Integration Tab */}
          {activeTab === 'integration' && (
            <ConnectorIntegrationTab connectorId="conn-engineering" />
          )}
        </div>
      </div>
      {selectedDeptId && (
        <EngineeringDetailPanel deptId={selectedDeptId} onClose={() => setSelectedDeptId(null)} />
      )}
    </div>

    {empModal && (
      <EngineeringEmployeeModal
        mode={empModal.mode}
        initial={empModal.initial}
        saving={createMutation.isPending || updateMutation.isPending}
        error={mutationError}
        onCancel={() => { setEmpModal(null); setMutationError(null); }}
        onSave={(data) => {
          if (empModal.mode === 'create') createMutation.mutate(data);
          else updateMutation.mutate({ id: empModal.id, data });
        }}
      />
    )}

    {deleteConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
        <div className="w-full max-w-sm bg-ux-surface rounded-xl shadow-2xl p-6">
          <h3 className="text-base font-semibold text-ux-text mb-2">Delete Employee?</h3>
          <p className="text-sm text-ux-text-sub mb-1">Permanently remove:</p>
          <p className="font-semibold text-ux-text mb-1">{deleteConfirm.first_name} {deleteConfirm.last_name}</p>
          <code className="block text-xs font-mono text-ux-text-sub mb-4">{deleteConfirm.dept_id}</code>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-ux-text border border-ux-border rounded-md hover:bg-ux-hover bg-ux-surface">Cancel</button>
            <button onClick={() => deleteMutation.mutate(deleteConfirm.dept_id)} disabled={deleteMutation.isPending}
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
