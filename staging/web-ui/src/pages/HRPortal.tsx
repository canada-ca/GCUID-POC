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
import { hrApi, HREmployee, HREmployeeInput } from '../api/client';
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

const HR_EMP_TYPES = ['FTE', 'Contractor', 'Inter-agency Detail', 'Temp'];

const emptyHRForm = (): HREmployeeInput => ({
  employee_id: '', first_name: '', last_name: '', email: '',
  department: 'Engineering', job_title: '', employment_type: 'FTE',
  hire_date: new Date().toISOString().slice(0, 10), status: 'active', salary: null, manager_id: null,
});

function HREmployeeModal({
  mode, initial, saving, error, onSave, onCancel, departments,
}: {
  mode: 'create' | 'edit';
  initial: HREmployeeInput;
  saving: boolean;
  error: string | null;
  onSave: (data: HREmployeeInput) => void;
  onCancel: () => void;
  departments: string[];
}) {
  const [form, setForm] = useState<HREmployeeInput>(initial);
  const set = <K extends keyof HREmployeeInput>(k: K, v: HREmployeeInput[K]) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="w-full max-w-lg bg-ux-surface rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ux-border">
          <h2 className="text-base font-semibold text-ux-text">{mode === 'create' ? 'Add HR Employee' : 'Edit HR Employee'}</h2>
          <button onClick={onCancel} className="text-ux-text-sub">✕</button>
        </div>
        <div className="overflow-y-auto p-6 space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-3">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Employee ID *</label>
              <input value={form.employee_id} onChange={e => set('employee_id', e.target.value)}
                disabled={mode === 'edit'}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm disabled:bg-ux-hover" placeholder="E10001" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Status</label>
              <select value={form.status ?? 'active'} onChange={e => set('status', e.target.value)}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm">
                {['active', 'leave', 'terminated'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
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
                className="w-full px-3 py-2 border border-ux-border rounded text-sm">
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Employment Type *</label>
              <select value={form.employment_type} onChange={e => set('employment_type', e.target.value)}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm">
                {HR_EMP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ux-text mb-1">Job Title *</label>
            <input value={form.job_title} onChange={e => set('job_title', e.target.value)}
              className="w-full px-3 py-2 border border-ux-border rounded text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Hire Date *</label>
              <input type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ux-text mb-1">Salary</label>
              <input type="number" value={form.salary ?? ''} onChange={e => set('salary', e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-ux-border rounded text-sm" placeholder="Optional" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ux-text mb-1">Manager ID</label>
            <input value={form.manager_id ?? ''} onChange={e => set('manager_id', e.target.value || null)}
              className="w-full px-3 py-2 border border-ux-border rounded text-sm" placeholder="Optional — e.g. E10001" />
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

function HRDetailPanel({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: employee, isLoading, error } = useQuery({
    queryKey: ['hr-employee', employeeId],
    queryFn: () => hrApi.viewEmployee(employeeId),
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
            <h2 className="text-lg font-semibold text-ux-text">Employee Record</h2>
            <p className="text-xs text-ux-text-sub font-mono">{employeeId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-ux-text-sub"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading && <LoadingSpinner message="Loading employee details..." />}
          {error && <ErrorMessage message={error instanceof Error ? error.message : 'Failed to load'} />}
          {employee && (
            <>
              {/* Identity banner */}
              <div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white text-lg font-bold">
                  {employee.first_name?.[0]}{employee.last_name?.[0]}
                </div>
                <div>
                  <div className="text-lg font-semibold text-ux-text">
                    {employee.first_name} {employee.last_name}
                  </div>
                  <div className="text-sm text-ux-text-sub">{(employee as any).job_title || ''}</div>
                  <div className="text-xs text-ux-text-sub">{employee.department}</div>
                </div>
              </div>

              {/* Personal & Employment */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                  Employment Attributes
                </h3>
                <dl className="space-y-2">
                  {[
                    { label: 'Employee ID', value: employee.employee_id, mono: true },
                    { label: 'First Name', value: employee.first_name },
                    { label: 'Last Name', value: employee.last_name },
                    { label: 'Email', value: employee.email },
                    { label: 'Department', value: employee.department },
                    { label: 'Job Title', value: (employee as any).job_title },
                    { label: 'Employment Type', value: (employee as any).employment_type },
                    { label: 'Status', value: employee.status },
                    { label: 'Hire Date', value: employee.hire_date },
                    { label: 'Salary', value: employee.salary != null ? `$${Number(employee.salary).toLocaleString()}` : null, sensitive: true },
                    { label: 'Manager ID', value: (employee as any).manager_id },
                    { label: 'Created At', value: fmt((employee as any).created_at) },
                    { label: 'Updated At', value: fmt((employee as any).updated_at) },
                  ].filter(f => f.value != null).map(field => (
                    <div key={field.label} className="flex justify-between items-start py-1.5 border-b border-ux-border">
                      <dt className="text-sm text-ux-text-sub w-36 flex-shrink-0">{field.label}</dt>
                      <dd className={`text-sm text-right ${field.mono ? 'font-mono text-ux-text' : 'text-ux-text'}`}>
                        {field.sensitive ? (
                          <span className="px-2 py-0.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded text-xs">
                            {field.value} — Sensitive
                          </span>
                        ) : field.label === 'Status' ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            String(field.value) === 'active' ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200' :
                            String(field.value) === 'Leave' ? 'bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200' :
                            'bg-red-100 dark:bg-red-800/60 text-red-800 dark:text-red-200'
                          }`}>{field.value}</span>
                        ) : String(field.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              {/* CAES Standard Attribute Names */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                  CAES Standard Attributes
                </h3>
                <div className="space-y-1">
                  {[
                    { caes: 'person.name.given', value: employee.first_name },
                    { caes: 'person.name.family', value: employee.last_name },
                    { caes: 'person.email', value: employee.email },
                    { caes: 'person.employment.department', value: employee.department },
                    { caes: 'person.employment.status', value: employee.status },
                    { caes: 'person.employment.hireDate', value: employee.hire_date },
                    { caes: 'person.employment.salary', value: '(sensitive — CAES read-only)', isSensitive: true },
                  ].map(m => (
                    <div key={m.caes} className="flex items-center justify-between py-1 px-3 bg-indigo-50 dark:bg-indigo-900/20 rounded">
                      <code className="text-xs font-mono text-indigo-700 dark:text-indigo-300">{m.caes}</code>
                      <span className={`text-xs ${m.isSensitive ? 'text-yellow-600 italic' : 'text-ux-text-sub'}`}>
                        {m.isSensitive ? m.value : m.value}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* GCUID Linkage */}
              <section>
                <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wider mb-3">
                  GCUID Identity Linkage
                </h3>
                {employee.gcuid_details ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-ux-success-bg border border-ux-success-border rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-sm font-medium text-green-800 dark:text-green-200">Linked to GCUID</span>
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                          employee.gcuid_details.state === 'active' ? 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200' :
                          'bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200'
                        }`}>{employee.gcuid_details.state}</span>
                      </div>
                      <code className="text-xs font-mono text-ux-text break-all block">
                        {employee.gcuid_details.gcuid}
                      </code>
                      <CopyButton value={employee.gcuid_details.gcuid} label="Copy GCUID" className="mt-1" />
                    </div>
                    {employee.gcuid_details.source_mappings?.length > 0 && (
                      <div>
                        <p className="text-xs text-ux-text-sub mb-2">All source mappings for this identity:</p>
                        <div className="space-y-1">
                          {employee.gcuid_details.source_mappings.map((sm: any) => (
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
                    sourceSystem="hr"
                    sourceId={employee.employee_id}
                    attributes={{ first_name: employee.first_name, last_name: employee.last_name, email: employee.email, entity_id: employee.employee_id }}
                    onComplete={() => {
                      qc.invalidateQueries({ queryKey: ['hr-employee', employeeId] });
                      qc.invalidateQueries({ queryKey: ['hr-employees'] });
                      qc.invalidateQueries({ queryKey: ['hr-stats'] });
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

export default function HRPortal() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'employees' | 'stats' | 'coverage' | 'connector' | 'integration'>('employees');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [gcuidFilter, setGcuidFilter] = useState('all');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [empModal, setEmpModal] = useState<{ mode: 'create'; initial: HREmployeeInput } | { mode: 'edit'; id: string; initial: HREmployeeInput } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<HREmployee | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [hrGapSearch, setHrGapSearch] = useState('');
  const [hrGapDeptFilter, setHrGapDeptFilter] = useState('');
  const [hrGapStatusFilter, setHrGapStatusFilter] = useState('');
  const [hrDegSearch, setHrDegSearch] = useState('');
  const [hrDegStateFilter, setHrDegStateFilter] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['hr-employees'] });

  const createMutation = useMutation({
    mutationFn: hrApi.createEmployee,
    onSuccess: () => { invalidate(); setEmpModal(null); setMutationError(null); },
    onError: (e: any) => setMutationError(e?.message ?? 'Failed to create employee'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<HREmployeeInput> }) => hrApi.updateEmployee(id, data),
    onSuccess: () => { invalidate(); setEmpModal(null); setMutationError(null); },
    onError: (e: any) => setMutationError(e?.message ?? 'Failed to update employee'),
  });
  const deleteMutation = useMutation({
    mutationFn: hrApi.deleteEmployee,
    onSuccess: () => { invalidate(); setDeleteConfirm(null); },
    onError: (e: any) => setMutationError(e?.message ?? 'Failed to delete employee'),
  });

  // Fetch employees
  const { data: employees, isLoading: employeesLoading, error: employeesError } = useQuery({
    queryKey: ['hr-employees'],
    queryFn: hrApi.listEmployees,
  });

  // Fetch stats
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['hr-stats'],
    queryFn: hrApi.getStats,
  });

  // Fetch connector health
  const { data: connectorHealth, isLoading: healthLoading } = useQuery({
    queryKey: ['hr-connector-health'],
    queryFn: hrApi.getConnectorHealth,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch coverage gaps
  const { data: coverageGaps, isLoading: coverageLoading } = useQuery({
    queryKey: ['hr-coverage-gaps'],
    queryFn: hrApi.getCoverageGaps,
    enabled: activeTab === 'coverage',
  });

  const hrDepartments = employees && employees.length > 0
    ? [...new Set(employees.map(e => e.department))].sort()
    : stats?.by_department?.map(d => d.department).sort() ?? [];

  const filteredEmployees = employees?.filter(emp => {
    const matchSearch = searchQuery === '' ||
      `${emp.first_name} ${emp.last_name} ${emp.email} ${emp.employee_id}`
        .toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = statusFilter === 'all' || emp.status?.toLowerCase() === statusFilter;
    const matchGcuid = gcuidFilter === 'all' || (gcuidFilter === 'linked' ? !!emp.gcuid : !emp.gcuid);
    return matchSearch && matchStatus && matchGcuid;
  });

  const { sorted: sortedEmployees, sortBy, sortDir, handleSort } = useSortableTable(filteredEmployees, 'employee_id');
  const { paginated: paginatedEmployees, page: hrPage, setPage: setHrPage, pageSize: hrPageSize, setPageSize: setHrPageSize, totalPages: hrTotalPages, totalItems: hrTotalItems } = usePagination(sortedEmployees);

  // Sort + pagination for coverage gap tables
  const filteredHrGap = (() => {
    const raw = (coverageGaps as any)?.gaps?.without_gcuid?.employees;
    if (!raw) return raw;
    let data = raw;
    if (hrGapSearch) data = data.filter((e: any) =>
      `${e.employee_id} ${e.first_name} ${e.last_name} ${e.email} ${e.department}`.toLowerCase().includes(hrGapSearch.toLowerCase())
    );
    if (hrGapDeptFilter) data = data.filter((e: any) => e.department === hrGapDeptFilter);
    if (hrGapStatusFilter) data = data.filter((e: any) => e.status === hrGapStatusFilter);
    return data;
  })();
  const filteredHrDeg = (() => {
    const raw = (coverageGaps as any)?.gaps?.degraded_coverage?.records;
    if (!raw) return raw;
    let data = raw;
    if (hrDegSearch) data = data.filter((r: any) =>
      `${r.employee_id} ${r.gcuid}`.toLowerCase().includes(hrDegSearch.toLowerCase())
    );
    if (hrDegStateFilter) data = data.filter((r: any) => r.state === hrDegStateFilter);
    return data;
  })();
  const { sorted: hrGapSorted, sortBy: hrGapSortBy, sortDir: hrGapSortDir, handleSort: handleHrGapSort } = useSortableTable(filteredHrGap, 'employee_id');
  const { paginated: hrGapPaginated, page: hrGapPage, setPage: setHrGapPage, pageSize: hrGapPageSize, setPageSize: setHrGapPageSize, totalPages: hrGapTotalPages, totalItems: hrGapTotalItems } = usePagination(hrGapSorted);
  const { sorted: hrDegSorted, sortBy: hrDegSortBy, sortDir: hrDegSortDir, handleSort: handleHrDegSort } = useSortableTable(filteredHrDeg, 'employee_id');
  const { paginated: hrDegPaginated, page: hrDegPage, setPage: setHrDegPage, pageSize: hrDegPageSize, setPageSize: setHrDegPageSize, totalPages: hrDegTotalPages, totalItems: hrDegTotalItems } = usePagination(hrDegSorted);

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      'Active': 'bg-green-100 dark:bg-green-800/60 text-green-800 dark:text-green-200',
      'Leave': 'bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200',
      'Terminated': 'bg-red-100 dark:bg-red-800/60 text-red-800 dark:text-red-200',
    };
    return colors[status] || 'bg-ux-hover text-ux-text';
  };

  return (
    <UXScopeWrapper scopeId="conn-hr">
    <>
    <div className="space-y-6">
      {selectedEmployeeId && (
        <HRDetailPanel
          employeeId={selectedEmployeeId}
          onClose={() => setSelectedEmployeeId(null)}
        />
      )}
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-ux-text">HR System Portal</h1>
            <p className="mt-2 text-sm text-ux-text-sub">
              Authoritative Source - HR Management System
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
                    placeholder="Search by name, email, or employee ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 bg-ux-surface text-ux-text border border-ux-border rounded-md focus:ring-ux-accent focus:border-ux-accent"
                  />
                  <p className="text-ux-text-sub">Click any row to view full attribute details</p>
                </div>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  title="Status filter"
                  className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="leave">Leave</option>
                  <option value="terminated">Terminated</option>
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
                  onClick={() => { setMutationError(null); setEmpModal({ mode: 'create', initial: emptyHRForm() }); }}
                  className="px-4 py-2 text-sm font-medium bg-ux-btn text-ux-btn-on rounded-md hover:brightness-90 whitespace-nowrap"
                >
                  + Add Employee
                </button>
              </div>

              {employeesLoading && <LoadingSpinner message="Loading HR employees..." />}
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
                        <SortTh col="employee_id" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Employee ID</SortTh>
                        <SortTh col="last_name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Name</SortTh>
                        <SortTh col="email" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Email</SortTh>
                        <SortTh col="department" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Department</SortTh>
                        <SortTh col="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">Status</SortTh>
                        <SortTh col="gcuid" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} activeClass="text-ux-nav-label">GCUID</SortTh>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-ux-text-sub uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ux-border">
                      {paginatedEmployees.map((emp) => (
                        <tr
                          key={emp.employee_id}
                              className="cursor-pointer bg-ux-surface hover:bg-ux-hover transition-colors"
                          onClick={() => setSelectedEmployeeId(emp.employee_id)}
                        >
                          <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-ux-text">{emp.employee_id}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text">{emp.first_name} {emp.last_name}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub">{emp.email}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm text-ux-text-sub">{emp.department}</td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(emp.status)}`}>{emp.status}</span>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-sm">
                            {emp.gcuid ? <span className="text-green-700 dark:text-green-400 font-medium">✓ {emp.gcuid_state}</span> : <span className="text-ux-text-sub">—</span>}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-right text-sm" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => { setMutationError(null); setEmpModal({ mode: 'edit', id: emp.employee_id, initial: { employee_id: emp.employee_id, first_name: emp.first_name, last_name: emp.last_name, email: emp.email, department: emp.department, job_title: (emp as any).job_title ?? '', employment_type: (emp as any).employment_type ?? 'FTE', hire_date: (emp as any).hire_date ?? '', status: emp.status, salary: emp.salary, manager_id: (emp as any).manager_id ?? null } }); }}
                                className="px-2.5 py-1 text-xs font-medium text-ux-text-sub border border-ux-border rounded hover:bg-ux-hover bg-ux-surface/50">Edit</button>
                              <button onClick={() => setDeleteConfirm(emp)}
                                className="px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 dark:bg-transparent">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={hrPage} totalPages={hrTotalPages} totalItems={hrTotalItems} pageSize={hrPageSize} onPageChange={setHrPage} onPageSizeChange={setHrPageSize} accentClass="text-blue-600 dark:text-blue-400" />
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
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="bg-ux-elevation1 overflow-hidden shadow rounded-lg border border-ux-border">
                      <dl className="p-5">
                        <dt className="text-sm font-medium text-ux-text-sub truncate">Total Employees</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-text">
                          {stats.total_employees}
                        </dd>
                      </dl>
                    </div>
                    <div className="bg-ux-success-bg overflow-hidden shadow rounded-lg border border-ux-success-border">
                      <dl className="p-5">
                        <dt className="text-sm font-medium text-ux-text-sub truncate">With GCUID</dt>
                        <dd className="mt-1 text-3xl font-semibold text-ux-success">
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

                  {/* By Department */}
                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-4">By Department</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {stats.by_department.map((dept) => (
                        <div key={dept.department} className="bg-ux-surface-alt rounded-lg p-4">
                          <div className="text-sm font-medium text-ux-text-sub">{dept.department}</div>
                          <div className="mt-1 text-2xl font-semibold text-ux-text">{dept.count}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* By Status */}
                  <div>
                    <h3 className="text-lg font-medium text-ux-text mb-4">By Status</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {stats.by_status.map((status) => (
                        <div key={status.status} className="bg-ux-surface-alt rounded-lg p-4">
                          <div className="text-sm font-medium text-ux-text-sub">{status.status}</div>
                          <div className="mt-1 text-2xl font-semibold text-ux-text">{status.count}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Coverage Indicator */}
                  <div className="bg-ux-accent-subtle border border-ux-accent-subtle-border rounded-lg p-6">
                    <h3 className="text-lg font-medium text-ux-text mb-2">Authoritative Source Coverage</h3>
                    <p className="text-sm text-ux-text-sub mb-4">
                      HR System is an authoritative source providing {stats.gcuid_percentage} GCUID coverage
                    </p>
                    <div className="text-4xl font-bold text-ux-nav-label">
                      {stats.gcuid_percentage ?? '—'}
                      <span className="ml-3 text-lg text-ux-text-sub">of connected employees</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Coverage Gaps Tab */}
          {activeTab === 'coverage' && (
            <div className="space-y-6">
              {coverageLoading && <LoadingSpinner message="Analysing HR coverage..." />}
              {coverageGaps && (
                <>
                  <div className="bg-ux-warning-bg border border-ux-warning-border rounded-lg p-4">
                    <h3 className="text-base font-semibold text-ux-text mb-1">Coverage Gaps — {coverageGaps.source}</h3>
                    <p className="text-sm text-ux-text-sub">
                      Employees in the HR authoritative source that have not yet been issued a GCUID, or whose issued GCUID is in a degraded state.
                    </p>
                  </div>

                  {/* Without GCUID */}
                  <div>
                    <h3 className="text-base font-semibold text-ux-text mb-3">
                      Employees Without a GCUID
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200">
                        {coverageGaps.gaps.without_gcuid.count}
                      </span>
                    </h3>
                    {coverageGaps.gaps.without_gcuid.count === 0 ? (
                      <p className="text-sm text-ux-success bg-ux-success-bg border border-ux-success-border rounded p-3">
                        ✓ All HR employees have been issued a GCUID.
                      </p>
                    ) : (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 border-b border-yellow-200 dark:border-yellow-700 flex flex-wrap gap-2 items-center">
                          <input type="search" placeholder="Search by ID, name, email or department…" value={hrGapSearch} onChange={e => setHrGapSearch(e.target.value)} title="Search employees without GCUID" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn w-full sm:w-64" />
                          <select value={hrGapDeptFilter} onChange={e => setHrGapDeptFilter(e.target.value)} title="Filter by department" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                            <option value="">All Departments</option>
                            {[...new Set<string>(((coverageGaps as any)?.gaps?.without_gcuid?.employees ?? []).map((e: any) => e.department).filter(Boolean))].sort().map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <select value={hrGapStatusFilter} onChange={e => setHrGapStatusFilter(e.target.value)} title="Filter by status" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                            <option value="">All Statuses</option>
                            {[...new Set<string>(((coverageGaps as any)?.gaps?.without_gcuid?.employees ?? []).map((e: any) => e.status).filter(Boolean))].sort().map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                          </select>
                        </div>
                        <table className="min-w-full divide-y divide-ux-border text-sm">
                          <thead className="bg-ux-table-header">
                            <tr>
                              <SortTh col="employee_id" sortBy={hrGapSortBy} sortDir={hrGapSortDir} onSort={handleHrGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Employee ID</SortTh>
                              <SortTh col="first_name" sortBy={hrGapSortBy} sortDir={hrGapSortDir} onSort={handleHrGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Name</SortTh>
                              <SortTh col="email" sortBy={hrGapSortBy} sortDir={hrGapSortDir} onSort={handleHrGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Email</SortTh>
                              <SortTh col="department" sortBy={hrGapSortBy} sortDir={hrGapSortDir} onSort={handleHrGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Department</SortTh>
                              <SortTh col="status" sortBy={hrGapSortBy} sortDir={hrGapSortDir} onSort={handleHrGapSort} activeClass="text-yellow-800 dark:text-yellow-300" className="px-4">Status</SortTh>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ux-border">
                            {hrGapPaginated.map((emp: any) => (
                              <tr key={emp.employee_id} className="cursor-pointer hover:bg-ux-hover transition-colors" onClick={() => setSelectedEmployeeId(emp.employee_id)}>
                                <td className="px-4 py-2 font-mono text-xs text-ux-text-sub">{emp.employee_id}</td>
                                <td className="px-4 py-2 text-ux-text">{emp.first_name} {emp.last_name}</td>
                                <td className="px-4 py-2 text-ux-text-sub">{emp.email}</td>
                                <td className="px-4 py-2 text-ux-text-sub">{emp.department}</td>
                                <td className="px-4 py-2 capitalize text-ux-text-sub">{emp.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <Pagination page={hrGapPage} totalPages={hrGapTotalPages} totalItems={hrGapTotalItems} pageSize={hrGapPageSize} onPageChange={setHrGapPage} onPageSizeChange={setHrGapPageSize} accentClass="text-yellow-700 dark:text-yellow-400" />
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
                        ✓ No HR-backed identities are in a degraded state.
                      </p>
                    ) : (
                      <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 border-b border-orange-200 dark:border-orange-700 flex flex-wrap gap-2 items-center">
                          <input type="search" placeholder="Search by employee ID or GCUID…" value={hrDegSearch} onChange={e => setHrDegSearch(e.target.value)} title="Search degraded coverage records" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn w-full sm:w-64" />
                          <select value={hrDegStateFilter} onChange={e => setHrDegStateFilter(e.target.value)} title="Filter by state" className="text-sm rounded border border-ux-border bg-ux-surface text-ux-text px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ux-btn">
                            <option value="">All States</option>
                            {[...new Set<string>(((coverageGaps as any)?.gaps?.degraded_coverage?.records ?? []).map((r: any) => r.state).filter(Boolean))].sort().map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                          </select>
                        </div>
                        <table className="min-w-full divide-y divide-orange-200 dark:divide-orange-800 text-sm">
                          <thead className="bg-ux-table-header">
                            <tr>
                              <SortTh col="employee_id" sortBy={hrDegSortBy} sortDir={hrDegSortDir} onSort={handleHrDegSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">Employee ID</SortTh>
                              <SortTh col="gcuid" sortBy={hrDegSortBy} sortDir={hrDegSortDir} onSort={handleHrDegSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">GCUID</SortTh>
                              <SortTh col="state" sortBy={hrDegSortBy} sortDir={hrDegSortDir} onSort={handleHrDegSort} activeClass="text-orange-700 dark:text-orange-300" className="px-4">State</SortTh>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-orange-100 dark:divide-orange-900">
                            {hrDegPaginated.map((r: any) => (
                              <tr key={r.employee_id + r.gcuid} className="cursor-pointer hover:bg-ux-hover transition-colors" onClick={() => setSelectedEmployeeId(r.employee_id)}>
                                <td className="px-4 py-2 font-mono text-xs text-ux-text-sub">{r.employee_id}</td>
                                <td className="px-4 py-2 font-mono text-xs text-ux-text-sub">{r.gcuid}</td>
                                <td className="px-4 py-2 capitalize text-ux-text-sub">{r.state}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <Pagination page={hrDegPage} totalPages={hrDegTotalPages} totalItems={hrDegTotalItems} pageSize={hrDegPageSize} onPageChange={setHrDegPage} onPageSizeChange={setHrDegPageSize} accentClass="text-orange-700 dark:text-orange-400" />
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
                  about="The HR System is an authoritative source that the GCUID registry queries live on demand. Every attribute lookup triggers a direct call to the HR connector endpoint — no data is cached in the registry. This ensures real-time accuracy for all identity decisions."
                />
              )}
            </div>
          )}

          {/* Integration Tab */}
          {activeTab === 'integration' && (
            <ConnectorIntegrationTab connectorId="conn-hr" />
          )}
        </div>
      </div>
    </div>

    {empModal && (
      <HREmployeeModal
        mode={empModal.mode}
        initial={empModal.initial}
        saving={createMutation.isPending || updateMutation.isPending}
        error={mutationError}
        departments={hrDepartments}
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
          <code className="block text-xs font-mono text-ux-text-sub mb-4">{deleteConfirm.employee_id}</code>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-ux-text border border-ux-border rounded-md hover:bg-ux-hover bg-ux-surface">Cancel</button>
            <button onClick={() => deleteMutation.mutate(deleteConfirm.employee_id)} disabled={deleteMutation.isPending}
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
