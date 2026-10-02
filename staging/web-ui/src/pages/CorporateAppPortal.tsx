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
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { userApi, caesApi, policiesApi, Identity, UserAttributeEntry, PolicyValidateResult, PolicyValidateGcuidResult } from '../api/client';
import { UXScopeWrapper } from '../context/UXThemeContext';

// ─── Orange theme palette (one per app) ───────────────────────────────────────

interface AppTheme {
  accent: string;
  accentDim: string;
  panelBg: string;
  badgeBg: string;
  badgeText: string;
  bannerGradient: string;
  themeName: string;
}

const THEMES: Record<string, AppTheme> = {
  budget: {
    accent:         '#f97316',
    accentDim:      '#ea6906',
    panelBg:        'color-mix(in srgb, #f97316 7%, var(--ux-bg-surface))',
    badgeBg:        'color-mix(in srgb, #f97316 18%, transparent)',
    badgeText:      '#9a3e08',
    bannerGradient: 'linear-gradient(135deg, #7c2d12 0%, #c2410c 50%, #f97316 100%)',
    themeName:      'Flame',
  },
  projects: {
    accent:         '#fb923c',
    accentDim:      '#ea7c26',
    panelBg:        'color-mix(in srgb, #fb923c 7%, var(--ux-bg-surface))',
    badgeBg:        'color-mix(in srgb, #fb923c 18%, transparent)',
    badgeText:      '#9a4b10',
    bannerGradient: 'linear-gradient(135deg, #431407 0%, #9a3412 50%, #fb923c 100%)',
    themeName:      'Tangerine',
  },
  travel: {
    accent:         '#f98a18',
    accentDim:      '#e07410',
    panelBg:        'color-mix(in srgb, #f98a18 7%, var(--ux-bg-surface))',
    badgeBg:        'color-mix(in srgb, #f98a18 18%, transparent)',
    badgeText:      '#924d09',
    bannerGradient: 'linear-gradient(135deg, #431407 0%, #b45309 50%, #f98a18 100%)',
    themeName:      'Clementine',
  },
  assets: {
    accent:         '#ea6320',
    accentDim:      '#d45514',
    panelBg:        'color-mix(in srgb, #ea6320 7%, var(--ux-bg-surface))',
    badgeBg:        'color-mix(in srgb, #ea6320 18%, transparent)',
    badgeText:      '#8a3a0f',
    bannerGradient: 'linear-gradient(135deg, #431407 0%, #b44309 50%, #ea6320 100%)',
    themeName:      'Pumpkin',
  },
  hrconnect: {
    accent:         '#e87c3e',
    accentDim:      '#d46830',
    panelBg:        'color-mix(in srgb, #e87c3e 7%, var(--ux-bg-surface))',
    badgeBg:        'color-mix(in srgb, #e87c3e 18%, transparent)',
    badgeText:      '#8a4420',
    bannerGradient: 'linear-gradient(135deg, #311505 0%, #9a4524 50%, #e87c3e 100%)',
    themeName:      'Apricot',
  },
  procurement: {
    accent:         '#c2410c',
    accentDim:      '#a83508',
    panelBg:        'color-mix(in srgb, #c2410c 7%, var(--ux-bg-surface))',
    badgeBg:        'color-mix(in srgb, #c2410c 18%, transparent)',
    badgeText:      '#7a2808',
    bannerGradient: 'linear-gradient(135deg, #1c0700 0%, #7c2d12 50%, #c2410c 100%)',
    themeName:      'Ember',
  },
};

// ─── Source system branding ─────────────────────────────────────────────────────

const SOURCE_META: Record<string, { name: string; emoji: string; description: string; scopeId: string }> = {
  hr:          { name: 'HR System',               emoji: '👔', description: 'Federal government HR records portal',   scopeId: 'conn-hr' },
  ldap:        { name: 'LDAP / Active Directory',  emoji: '🏛️', description: 'Departmental network directory',          scopeId: 'conn-ldap' },
  engineering: { name: 'Engineering Department',   emoji: '⚙️', description: 'Engineering departmental portal',         scopeId: 'conn-engineering' },
  finance:     { name: 'Finance Department',        emoji: '📊', description: 'Finance departmental portal',              scopeId: 'conn-finance' },
};

// ─── App config ────────────────────────────────────────────────────────────────

interface AccessLevel {
  role: string;
  description: string;
  permissions: string[];
  /** Returns true if the user qualifies for this level (evaluated top-down; first match wins) */
  check: (dept: string, jobTitle: string, status: string) => boolean;
}

interface AppConfig {
  appId: string;
  name: string;
  emoji: string;
  description: string;
  vendor: string;
  requiredAttributes: string[];
  accessLevels: AccessLevel[]; // ordered highest → lowest privilege
}

function deptIs(dept: string, ...candidates: string[]) {
  const d = dept.toLowerCase();
  return candidates.some(c => d.includes(c.toLowerCase()));
}

function titleContains(title: string, ...keywords: string[]) {
  const t = title.toLowerCase();
  return keywords.some(k => t.includes(k.toLowerCase()));
}

const APP_CONFIGS: AppConfig[] = [
  {
    appId:      'budget',
    name:       'Budget Compass',
    emoji:      '💰',
    description:'Corporate budgeting, forecasting, and spend approval workflows for all cost centres.',
    vendor:     'Compass Financial Suite',
    requiredAttributes: ['person.employment.department', 'person.job.title', 'person.employment.status'],
    accessLevels: [
      {
        role: 'Finance Administrator',
        description: 'Full access to all budgets, cost centres, and reporting dashboards.',
        permissions: ['View All Budgets', 'Edit Budget Allocations', 'Approve Expenditures', 'Manage Cost Centres', 'Generate Finance Reports', 'Export Data'],
        check: (dept, title) => deptIs(dept, 'finance') || titleContains(title, 'cfo', 'finance director', 'comptroller'),
      },
      {
        role: 'Budget Approver',
        description: 'Approve expenditure requests and oversee team budget allocations.',
        permissions: ['Approve Expenditures', 'View Team Budgets', 'View Allocation Reports'],
        check: (_dept, title) => titleContains(title, 'manager', 'director', 'vp', 'vice president', 'executive', 'chief'),
      },
      {
        role: 'Budget Submitter',
        description: 'Submit expense and budget requests; view own cost centre lines.',
        permissions: ['Submit Expenses', 'View Own Budget Lines', 'Track Submission Status'],
        check: (_dept, _title, status) => status !== 'terminated' && status !== 'inactive',
      },
      {
        role: 'No Access',
        description: 'Account is inactive or terminated.',
        permissions: [],
        check: () => true,
      },
    ],
  },
  {
    appId:      'projects',
    name:       'Project Hub',
    emoji:      '📋',
    description:'Project tracking, resource allocation, milestone management, and cross-team collaboration.',
    vendor:     'NexGen Delivery Platform',
    requiredAttributes: ['person.employment.department', 'person.job.title', 'person.employment.status'],
    accessLevels: [
      {
        role: 'Project Manager',
        description: 'Create and manage projects, assign resources, track deliverables.',
        permissions: ['Create Projects', 'Assign Team Members', 'Set Milestones', 'View All Projects', 'Generate Reports', 'Manage Budgets'],
        check: (_dept, title) => titleContains(title, 'project manager', 'program manager', 'delivery manager', 'director', 'vp'),
      },
      {
        role: 'Technical Lead',
        description: 'Lead technical workstreams, update task status, and manage technical backlogs.',
        permissions: ['Update Task Status', 'Manage Technical Backlog', 'View Team Projects', 'Assign Technical Tasks'],
        check: (dept, title) => deptIs(dept, 'engineering', 'technology', 'it', 'software', 'infrastructure') || titleContains(title, 'lead', 'architect', 'principal'),
      },
      {
        role: 'Project Member',
        description: 'View assigned projects and update own task status.',
        permissions: ['View Assigned Projects', 'Update Own Task Status', 'Log Time', 'Add Comments'],
        check: (_dept, _title, status) => status !== 'terminated' && status !== 'inactive',
      },
      {
        role: 'No Access',
        description: 'Account is inactive or terminated.',
        permissions: [],
        check: () => true,
      },
    ],
  },
  {
    appId:      'travel',
    name:       'Travel & Expense',
    emoji:      '✈️',
    description:'Travel authorization requests, expense claim submissions, and reimbursement workflows.',
    vendor:     'Concord T&E Platform',
    requiredAttributes: ['person.employment.department', 'person.job.title', 'person.employment.status'],
    accessLevels: [
      {
        role: 'Finance Approver',
        description: 'Final approval authority for all travel and expense claims above policy threshold.',
        permissions: ['Approve All Claims', 'Set Policy Limits', 'View Org-Wide Reports', 'Flag Policy Exceptions', 'Export Expense Data'],
        check: (dept, title) => deptIs(dept, 'finance') || titleContains(title, 'cfo', 'finance director', 'comptroller'),
      },
      {
        role: 'Manager Approver',
        description: 'Approve team travel requests and expense claims up to delegated limit.',
        permissions: ['Approve Team Claims', 'View Team Expense Summary', 'Delegate Approval'],
        check: (_dept, title) => titleContains(title, 'manager', 'director', 'vp', 'vice president', 'executive', 'chief'),
      },
      {
        role: 'Employee',
        description: 'Submit travel requests and expense claims for reimbursement.',
        permissions: ['Submit Travel Requests', 'Submit Expense Claims', 'Upload Receipts', 'Track Claim Status'],
        check: (_dept, _title, status) => status !== 'terminated' && status !== 'inactive',
      },
      {
        role: 'No Access',
        description: 'Account is inactive or terminated.',
        permissions: [],
        check: () => true,
      },
    ],
  },
  {
    appId:      'assets',
    name:       'Asset Registry',
    emoji:      '🗄️',
    description:'Corporate asset lifecycle management — hardware, software licences, and facility equipment.',
    vendor:     'AssetIQ Enterprise',
    requiredAttributes: ['person.employment.department', 'person.job.title', 'person.employment.status'],
    accessLevels: [
      {
        role: 'Asset Administrator',
        description: 'Full control over asset records, assignments, and lifecycle workflows.',
        permissions: ['Create Asset Records', 'Retire Assets', 'Assign Assets', 'View All Assets', 'Run Audit Reports', 'Manage Categories'],
        check: (dept, title) => deptIs(dept, 'information technology', 'it', 'facilities', 'operations') || titleContains(title, 'it manager', 'asset manager', 'facilities manager'),
      },
      {
        role: 'Asset Custodian',
        description: 'Manage assets assigned to your department or team.',
        permissions: ['View Department Assets', 'Report Asset Issues', 'Request Asset Transfers', 'Acknowledge Assignments'],
        check: (_dept, title) => titleContains(title, 'manager', 'director', 'lead', 'supervisor'),
      },
      {
        role: 'Standard User',
        description: 'View personally assigned assets and submit maintenance requests.',
        permissions: ['View Own Assets', 'Submit Maintenance Requests', 'Acknowledge Assignment'],
        check: (_dept, _title, status) => status !== 'terminated' && status !== 'inactive',
      },
      {
        role: 'No Access',
        description: 'Account is inactive or terminated.',
        permissions: [],
        check: () => true,
      },
    ],
  },
  {
    appId:      'hrconnect',
    name:       'HR Connect',
    emoji:      '👤',
    description:'HR self-service portal — onboarding, leave management, benefits, and people analytics.',
    vendor:     'PeopleFirst HR Suite',
    requiredAttributes: ['person.employment.department', 'person.job.title', 'person.employment.status'],
    accessLevels: [
      {
        role: 'HR Administrator',
        description: 'Full access to employee records, org structure, benefits, and payroll data.',
        permissions: ['View All Employee Records', 'Edit Employee Data', 'Process Onboarding', 'Manage Benefits', 'Run HR Analytics', 'Access Payroll Summaries'],
        check: (dept) => deptIs(dept, 'human resources', 'hr', 'people & culture', 'talent'),
      },
      {
        role: 'People Manager',
        description: 'View and manage direct reports — leave, performance, and team analytics.',
        permissions: ["View Direct Reports' Profiles", 'Approve Leave Requests', 'Submit Performance Reviews', 'View Team Analytics'],
        check: (_dept, title) => titleContains(title, 'manager', 'director', 'vp', 'vice president', 'team lead', 'supervisor'),
      },
      {
        role: 'Employee Self-Service',
        description: 'Access personal profile, request leave, and update benefit elections.',
        permissions: ['View Own Profile', 'Request Leave', 'Update Emergency Contacts', 'View Pay Stubs', 'Update Benefit Elections'],
        check: (_dept, _title, status) => status !== 'terminated' && status !== 'inactive',
      },
      {
        role: 'No Access',
        description: 'Account is inactive or terminated.',
        permissions: [],
        check: () => true,
      },
    ],
  },
  {
    appId:      'procurement',
    name:       'Procurement Portal',
    emoji:      '🛒',
    description:'Purchase requisitions, vendor management, contract lifecycle, and spend analytics.',
    vendor:     'ProcureLink Enterprise',
    requiredAttributes: ['person.employment.department', 'person.job.title', 'person.employment.status'],
    accessLevels: [
      {
        role: 'Procurement Officer',
        description: 'Manage vendor relationships, contracts, and org-wide procurement workflows.',
        permissions: ['Create Vendor Records', 'Issue RFPs/RFQs', 'Manage Contracts', 'Approve Large Purchases', 'Access Spend Analytics', 'Generate Reports'],
        check: (dept, title) => deptIs(dept, 'finance', 'procurement', 'supply chain', 'operations') || titleContains(title, 'procurement', 'purchasing', 'supply chain'),
      },
      {
        role: 'Purchase Approver',
        description: 'Approve purchase requisitions up to delegated spending authority.',
        permissions: ['Approve Requisitions', 'View Team Spend', 'Delegate Authority'],
        check: (_dept, title) => titleContains(title, 'manager', 'director', 'vp', 'vice president', 'executive', 'chief'),
      },
      {
        role: 'Requester',
        description: 'Submit purchase requisitions and track order status.',
        permissions: ['Submit Requisitions', 'Track Order Status', 'View Approved Vendors'],
        check: (_dept, _title, status) => status !== 'terminated' && status !== 'inactive',
      },
      {
        role: 'No Access',
        description: 'Account is inactive or terminated.',
        permissions: [],
        check: () => true,
      },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAttrValue(attrs: Record<string, UserAttributeEntry> | undefined, key: string): string {
  if (!attrs) return '';
  const entry = attrs[key];
  if (!entry) return '';
  if (entry.value === null || entry.value === undefined) return '';
  return String(entry.value);
}

function resolveAccessLevel(app: AppConfig, attributes: Record<string, UserAttributeEntry> | undefined): AccessLevel {
  const dept   = getAttrValue(attributes, 'person.employment.department');
  const title  = getAttrValue(attributes, 'person.job.title');
  const status = getAttrValue(attributes, 'person.employment.status') || 'active';
  for (const level of app.accessLevels) {
    if (level.check(dept, title, status)) return level;
  }
  return app.accessLevels[app.accessLevels.length - 1];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AccessBadge({ role, theme }: { role: string; theme: AppTheme }) {
  const isNone = role === 'No Access';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={
        isNone
          ? { backgroundColor: 'var(--ux-status-error-bg)', color: 'var(--ux-status-error)', border: '1px solid var(--ux-status-error-border)' }
          : { backgroundColor: theme.badgeBg, color: theme.badgeText, border: `1px solid color-mix(in srgb, ${theme.accent} 30%, transparent)` }
      }
    >
      {isNone ? '🚫' : '✅'} {role}
    </span>
  );
}

function PermissionChip({ perm, theme }: { perm: string; theme: AppTheme }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
      style={{ backgroundColor: theme.badgeBg, color: theme.badgeText }}
    >
      <span style={{ color: theme.accent }}>✓</span> {perm}
    </span>
  );
}

/**
 * Renders the eligibility context (identity/identifier state + supersession
 * chain) returned by the GCUID login when access is denied. Helps the user
 * understand *why* their GCUID doesn't work — e.g. they used a superseded
 * identifier that points to a suspended successor, or the chain is broken.
 */
function GcuidEligibilityDetail({ detail, inputGcuid }: {
  detail: {
    effective_gcuid?:    string | null;
    identity_state?:     string | null;
    identifier_state?:   string | null;
    supersession_chain?: string[];
  };
  inputGcuid: string;
}) {
  const identity_state     = detail.identity_state     ?? null;
  const identifier_state   = detail.identifier_state   ?? null;
  const supersession_chain = detail.supersession_chain ?? [];
  const effective_gcuid    = detail.effective_gcuid    ?? null;
  const chainFollowed = supersession_chain.length > 1;
  const identityTone  = identity_state === 'active'      ? 'good' :
                        identity_state === 'suspended'    ? 'bad'  :
                        identity_state === 'archived'     ? 'bad'  :
                        identity_state === 'retired'      ? 'bad'  :
                        'neutral';
  const identifierTone = identifier_state === 'issued'      ? 'good' :
                         identifier_state === 'superseded'  ? 'warn' :
                         identifier_state === 'reserved'    ? 'bad'  :
                         identifier_state === 'nullified'   ? 'bad'  :
                         identifier_state === 'tombstoned'  ? 'bad'  :
                         'neutral';

  return (
    <div className="rounded-md border border-ux-border bg-ux-surface-alt p-3 text-xs text-ux-text space-y-2">
      <p className="font-semibold uppercase tracking-wider text-ux-text-sub">GCUID eligibility</p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
        <dt className="text-ux-text-sub">Identity state</dt>
        <dd>
          <StatePill value={identity_state} tone={identityTone} />
        </dd>
        <dt className="text-ux-text-sub">Identifier state</dt>
        <dd>
          <StatePill value={identifier_state} tone={identifierTone} />
        </dd>
        {effective_gcuid && effective_gcuid !== inputGcuid && (
          <>
            <dt className="text-ux-text-sub">Effective GCUID</dt>
            <dd className="font-mono text-ux-text break-all">{effective_gcuid}</dd>
          </>
        )}
      </dl>

      {chainFollowed && (
        <div className="pt-1 border-t border-ux-border/50">
          <p className="text-ux-text-sub mb-1">Supersession chain followed:</p>
          <ol className="space-y-0.5">
            {supersession_chain.map((g, i) => (
              <li key={g} className="font-mono flex items-start gap-2">
                <span className="text-ux-text-muted flex-shrink-0 w-4 text-right">{i + 1}.</span>
                <span className={`break-all ${g === effective_gcuid ? 'text-ux-text font-semibold' : 'text-ux-text-sub'}`}>
                  {g}
                  {g === effective_gcuid && <span className="ml-1 text-ux-text-muted">← effective</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function StatePill({ value, tone }: { value: string | null; tone: 'good' | 'bad' | 'warn' | 'neutral' }) {
  if (!value) return <span className="text-ux-text-muted">—</span>;
  const cls =
    tone === 'good'   ? 'bg-ux-success-bg text-ux-success'        :
    tone === 'bad'    ? 'bg-ux-error-bg text-ux-error'            :
    tone === 'warn'   ? 'bg-ux-warning-bg text-ux-warning'        :
                        'bg-ux-hover text-ux-text-sub';
  return <span className={`inline-block px-1.5 py-0.5 rounded font-mono font-semibold ${cls}`}>{value}</span>;
}

function AttrRow({ label, value, source, authoritative }: {
  label: string;
  value: string;
  source: string | null;
  authoritative: string | null;
}) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-ux-border last:border-0">
      <span className="text-xs text-ux-text-sub font-medium w-1/3">{label}</span>
      <span className="text-sm text-ux-text font-mono flex-1 text-right mr-3">{value || '—'}</span>
      <div className="flex flex-col items-end gap-0.5 min-w-[100px]">
        {source && (
          <span className="text-[10px] text-ux-text-muted bg-ux-bg-surface-alt px-1.5 py-0.5 rounded">{source}</span>
        )}
        {authoritative && authoritative !== source && (
          <span className="text-[10px] text-ux-text-muted">auth: {authoritative}</span>
        )}
      </div>
    </div>
  );
}

// ─── What-if Simulator ────────────────────────────────────────────────────────

function WhatIfSimulator({ app, theme, currentDept, currentTitle, currentStatus }: {
  app: AppConfig;
  theme: AppTheme;
  currentDept: string;
  currentTitle: string;
  currentStatus: string;
}) {
  const [dept,   setDept]   = useState(currentDept);
  const [title,  setTitle]  = useState(currentTitle);
  const [status, setStatus] = useState(currentStatus || 'active');

  const simulatedLevel = useMemo(() => {
    const mockAttrs: Record<string, UserAttributeEntry> = {
      'person.employment.department': { value: dept, source: 'simulation', fetch_mode: null, authoritative_source: null, self_service: false, writable: false },
      'person.job.title':             { value: title, source: 'simulation', fetch_mode: null, authoritative_source: null, self_service: false, writable: false },
      'person.employment.status':     { value: status, source: 'simulation', fetch_mode: null, authoritative_source: null, self_service: false, writable: false },
    };
    return resolveAccessLevel(app, mockAttrs);
  }, [app, dept, title, status]);

  const inputClass = "w-full text-sm px-2 py-1.5 rounded border border-ux-border bg-ux-input text-ux-text focus:outline-none focus:ring-1";

  return (
    <div className="rounded-lg border border-ux-border bg-ux-bg-surface-alt p-4 space-y-4">
      <p className="text-xs text-ux-text-sub">
        Modify the attribute values below to see how changes to a user's GCUID/CAES profile affect their access level in this application.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-ux-text-sub mb-1">Department</label>
          <input
            className={inputClass}
            value={dept}
            onChange={e => setDept(e.target.value)}
            placeholder="e.g. Finance"
            style={{ '--tw-ring-color': theme.accent } as React.CSSProperties}
          />
        </div>
        <div>
          <label className="block text-xs text-ux-text-sub mb-1">Job Title</label>
          <input
            className={inputClass}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Senior Manager"
            style={{ '--tw-ring-color': theme.accent } as React.CSSProperties}
          />
        </div>
        <div>
          <label className="block text-xs text-ux-text-sub mb-1">Employment Status</label>
          <select
            className={inputClass}
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="terminated">Terminated</option>
            <option value="on_leave">On Leave</option>
          </select>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-md p-3" style={{ backgroundColor: `color-mix(in srgb, ${theme.accent} 6%, var(--ux-bg-surface))`, border: `1px solid color-mix(in srgb, ${theme.accent} 25%, transparent)` }}>
        <span className="text-lg mt-0.5">→</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs text-ux-text-sub font-medium">Simulated Access:</span>
            <AccessBadge role={simulatedLevel.role} theme={theme} />
          </div>
          <p className="text-xs text-ux-text-sub">{simulatedLevel.description}</p>
          {simulatedLevel.permissions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {simulatedLevel.permissions.map(p => (
                <PermissionChip key={p} perm={p} theme={theme} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── App Selector (when no appId matched) ─────────────────────────────────────

function AppSelector() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ux-text">Corporate Applications</h1>
        <p className="text-ux-text-sub mt-1">
          Mock corporate applications demonstrating how GCUID Registry and CAES attribute resolution govern access control in realistic enterprise scenarios.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {APP_CONFIGS.map(app => {
          const theme = THEMES[app.appId];
          return (
            <Link
              key={app.appId}
              to={`/apps/${app.appId}`}
              className="block rounded-xl border border-ux-border bg-ux-bg-surface p-5 hover:shadow-md transition-shadow group"
              style={{ borderColor: `color-mix(in srgb, ${theme.accent} 20%, var(--ux-border-default))` }}
            >
              <div className="flex items-start gap-3">
                <span className="text-3xl">{app.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-base font-semibold text-ux-text group-hover:text-ux-accent transition-colors">{app.name}</h2>
                  </div>
                  <p className="text-xs text-ux-text-sub leading-snug">{app.description}</p>
                  <div className="mt-3 inline-flex items-center text-xs font-medium" style={{ color: theme.accent }}>
                    <span className="ml-1">{app.vendor}</span>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Portal Component ────────────────────────────────────────────────────

export default function CorporateAppPortal() {
  const { appId } = useParams<{ appId?: string }>();
  const app = appId ? APP_CONFIGS.find(a => a.appId === appId) ?? null : null;
  const theme = app ? THEMES[app.appId] : null;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGcuid, setSelectedGcuid] = useState<string | null>(null);

  // ── Login sessions — keyed by appId so each app has isolated auth ───────
  type AppSession = { credential: string; record: Record<string, unknown>; gcuid: string | null };
  const [sessions, setSessions] = useState<Record<string, AppSession>>({});
  const session = appId ? (sessions[appId] ?? null) : null;
  const setSession = (value: AppSession | null) => {
    if (!appId) return;
    setSessions(prev => {
      if (value === null) {
        const { [appId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [appId]: value };
    });
  };
  const [loginInput, setLoginInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  // 'authn' = account not found; 'authz' = account exists but access denied
  const [loginFailureType, setLoginFailureType] = useState<'authn' | 'authz' | 'service' | null>(null);
  /** GCUID-only: extra context from the eligibility gate (chain + states) shown on failure. */
  const [loginFailureDetail, setLoginFailureDetail] = useState<{
    effective_gcuid?:    string | null;
    identity_state?:     string | null;
    identifier_state?:   string | null;
    supersession_chain?: string[];
  } | null>(null);
  const [loginMethod, setLoginMethod] = useState<'credential' | 'gcuid'>('credential');
  const [gcuidInput, setGcuidInput] = useState('');

  // Reset form state when navigating between apps
  useEffect(() => {
    setLoginInput('');
    setGcuidInput('');
    setLoginError(null);
    setLoginFailureType(null);
    setLoginFailureDetail(null);
    setLoginMethod('credential');
  }, [appId]);

  // Policy for this app
  const { data: policyData, isLoading: policyLoading } = useQuery({
    queryKey: ['policy', appId],
    queryFn:  () => policiesApi.get(appId!),
    enabled:  !!appId && !!app,
    staleTime: 60_000,
  });
  const policy = policyData?.policy;

  // Validate credential against the source system
  const validateMutation = useMutation({
    mutationFn: (credential: string) => policiesApi.validate(appId!, credential),
    onSuccess: (result: PolicyValidateResult) => {
      if (result.granted) {
        setSession({ credential: loginInput.trim(), record: result.record ?? {}, gcuid: result.gcuid ?? null });
        setLoginError(null);
        setLoginFailureType(null);
        if (result.gcuid) setSelectedGcuid(result.gcuid);
      } else {
        setLoginError(result.reason);
        setLoginFailureType(result.found ? 'authz' : 'authn');
      }
    },
    onError: (err: unknown) => { setLoginError(err instanceof Error ? err.message : 'Authentication service error. Please try again.'); setLoginFailureType('service'); },
  });

  // Validate via GCUID / alias
  const validateGcuidMutation = useMutation({
    mutationFn: (gcuidOrAlias: string) => policiesApi.validateGcuid(appId!, gcuidOrAlias),
    onSuccess: (result: PolicyValidateGcuidResult) => {
      if (result.granted) {
        setSession({ credential: gcuidInput.trim(), record: result.record ?? {}, gcuid: result.gcuid ?? null });
        setLoginError(null);
        setLoginFailureType(null);
        setLoginFailureDetail(null);
        if (result.gcuid) setSelectedGcuid(result.gcuid);
      } else {
        setLoginError(result.reason);
        setLoginFailureType(result.found_gcuid ? 'authz' : 'authn');
        setLoginFailureDetail({
          effective_gcuid:    result.effective_gcuid    ?? null,
          identity_state:     result.identity_state     ?? null,
          identifier_state:   result.identifier_state   ?? null,
          supersession_chain: result.supersession_chain ?? [],
        });
      }
    },
    onError: (err: unknown) => { setLoginError(err instanceof Error ? err.message : 'Authentication service error. Please try again.'); setLoginFailureType('service'); },
  });

  // User search
  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ['user-search', searchQuery],
    queryFn: () => userApi.search(searchQuery),
    enabled: searchQuery.trim().length >= 2,
    staleTime: 30_000,
    retry: false,
  });

  // User attributes (GCUID native)
  const { data: userAttrs, isLoading: loadingAttrs } = useQuery({
    queryKey: ['user-attributes', selectedGcuid],
    queryFn: () => userApi.getAttributes(selectedGcuid!),
    enabled: !!selectedGcuid,
    staleTime: 60_000,
    retry: false,
  });

  // CAES-resolved attributes
  const caesAttrs = app?.requiredAttributes ?? [];
  const { data: caesResolved, isLoading: loadingCaes } = useQuery({
    queryKey: ['caes-resolved', selectedGcuid, caesAttrs],
    queryFn: () => caesApi.resolveAttributes(selectedGcuid!, caesAttrs),
    enabled: !!selectedGcuid && caesAttrs.length > 0,
    staleTime: 60_000,
    retry: false,
  });

  // Selected identity
  const { data: selectedIdentity } = useQuery({
    queryKey: ['user-lookup', selectedGcuid],
    queryFn: () => userApi.lookup(selectedGcuid!),
    enabled: !!selectedGcuid,
    staleTime: 60_000,
    retry: false,
  });

  if (!app || !theme) return <AppSelector />;

  // ── Login gate ─────────────────────────────────────────────────────────────
  if (!session) {
    const credLabel  = policy?.credential_label ?? 'Employee ID';
    const ruleLabel  = policy
      ? (policy.access_type === 'account_exists' ? 'Account exists' : `${policy.attribute_key} = "${policy.attribute_value}"`)
      : '…';
    const sourceMeta = SOURCE_META[policy?.source_system ?? ''] ?? { name: policy?.source_system?.toUpperCase() ?? '…', emoji: '🔐', description: '', scopeId: '' };
    return (
      <div className="space-y-4">
        {/* Login card — themed to the authoritative source system */}
        <div className="max-w-md mx-auto">
          <UXScopeWrapper scopeId={loginMethod === 'gcuid' ? 'portal-gcuid' : sourceMeta.scopeId}>
            <div className="rounded-xl border bg-ux-surface overflow-hidden border-ux-accent-subtle-border shadow-sm">

              {/* Source system identity header */}
              <div className="px-6 py-4 bg-ux-accent-subtle border-b border-ux-accent-subtle-border flex items-center gap-3">
                <span className="text-2xl">{sourceMeta.emoji}</span>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-ux-accent">{sourceMeta.name}</p>
                  <p className="text-xs text-ux-text-muted truncate">{sourceMeta.description}</p>
                </div>
                {policyLoading && <span className="ml-auto text-xs text-ux-text-muted">Loading…</span>}
              </div>

              {/* Login form */}
              <div className="p-6 space-y-4">
                <div className="text-center">
                  <span className="text-4xl">{app.emoji}</span>
                  <h2 className="text-lg font-semibold text-ux-text mt-2">Sign in to {app.name}</h2>
                </div>

                {/* Login method tabs */}
                <div className="flex rounded-lg border border-ux-border text-xs overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { setLoginMethod('credential'); setLoginError(null); setLoginFailureType(null); setLoginFailureDetail(null); }}
                    className={`flex-1 py-2 font-medium transition-colors ${
                      loginMethod === 'credential' ? 'bg-ux-btn text-ux-btn-on' : 'bg-transparent text-ux-text-muted hover:text-ux-text'
                    }`}
                  >
                    {credLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLoginMethod('gcuid'); setLoginError(null); setLoginFailureType(null); setLoginFailureDetail(null); }}
                    className={`flex-1 py-2 font-medium transition-colors border-l border-ux-border ${
                      loginMethod === 'gcuid' ? 'bg-ux-btn text-ux-btn-on' : 'bg-transparent text-ux-text-muted hover:text-ux-text'
                    }`}
                  >
                    GCUID / Alias
                  </button>
                </div>

                <form
                  onSubmit={e => {
                    e.preventDefault();
                    setLoginError(null);
                    setLoginFailureType(null);
                    if (loginMethod === 'credential') {
                      if (!loginInput.trim()) return;
                      validateMutation.mutate(loginInput.trim());
                    } else {
                      if (!gcuidInput.trim()) return;
                      validateGcuidMutation.mutate(gcuidInput.trim());
                    }
                  }}
                  className="space-y-3"
                >
                  {loginMethod === 'credential' ? (
                    <div>
                      <label className="block text-xs font-medium text-ux-text-sub mb-1">{credLabel}</label>
                      <input
                        type="text"
                        autoComplete="username"
                        className="w-full text-sm px-3 py-2 rounded-lg border border-ux-border bg-ux-input-bg text-ux-text focus:outline-none focus:ring-1 focus:ring-ux-accent focus:border-ux-accent"
                        value={loginInput}
                        onChange={e => setLoginInput(e.target.value)}
                        placeholder={credLabel}
                        disabled={validateMutation.isPending}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-ux-text-sub mb-1">GCUID or Alias</label>
                      <input
                        type="text"
                        autoComplete="username"
                        className="w-full text-sm px-3 py-2 rounded-lg border border-ux-border bg-ux-input-bg text-ux-text focus:outline-none focus:ring-1 focus:ring-ux-accent focus:border-ux-accent"
                        value={gcuidInput}
                        onChange={e => setGcuidInput(e.target.value)}
                        placeholder="urn:gcuid:… or GC-XXXXX or alias"
                        disabled={validateGcuidMutation.isPending}
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-ux-text-sub mb-1">
                      Password <span className="font-normal text-ux-text-muted">(demo — not verified)</span>
                    </label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      className="w-full text-sm px-3 py-2 rounded-lg border border-ux-border bg-ux-input-bg text-ux-text focus:outline-none focus:ring-1 focus:ring-ux-accent focus:border-ux-accent"
                      placeholder="••••••••"
                      disabled={validateMutation.isPending || validateGcuidMutation.isPending}
                    />
                  </div>
                  {loginError && loginFailureType === 'authn' && (
                    <div className="rounded-md p-3 bg-ux-error-bg border border-ux-error-border text-xs text-ux-error">
                      🔒 <span className="font-semibold">Authentication failed</span> — {loginError}
                    </div>
                  )}
                  {loginError && loginFailureType === 'authz' && (
                    <div className="space-y-2">
                      <div className="rounded-md p-3 bg-ux-warning-bg border border-ux-warning-border text-xs text-ux-warning">
                        ⛔ <span className="font-semibold">Access denied</span> — {loginError}
                      </div>
                      {/* GCUID-specific eligibility context: identity/identifier state + chain */}
                      {loginMethod === 'gcuid' && loginFailureDetail && (
                        <GcuidEligibilityDetail detail={loginFailureDetail} inputGcuid={gcuidInput.trim()} />
                      )}
                    </div>
                  )}
                  {loginError && loginFailureType === 'service' && (
                    <div className="rounded-md p-3 bg-ux-surface border border-ux-border text-xs text-ux-text-muted">
                      ⚠️ <span className="font-semibold text-ux-text">Service error</span> — {loginError}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={(loginMethod === 'credential' ? !loginInput.trim() : !gcuidInput.trim()) || validateMutation.isPending || validateGcuidMutation.isPending || policyLoading}
                    className="w-full py-2 rounded-lg text-sm font-semibold bg-ux-btn text-ux-btn-on transition-opacity disabled:opacity-50"
                  >
                    {(validateMutation.isPending || validateGcuidMutation.isPending) ? 'Verifying…' : 'Sign In'}
                  </button>
                </form>

                <div className="pt-2 border-t border-ux-border text-xs text-center text-ux-text-muted space-y-1">
                  <p>
                    Access governed by the{' '}
                    <Link to="/policies" className="text-ux-link hover:underline">System Access Policy</Link>.
                  </p>
                  {policy && (
                    <p>
                      Source: <span className="font-medium text-ux-text">{sourceMeta.name}</span>
                      {' · '}Rule: <span className="font-medium text-ux-text">{ruleLabel}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </UXScopeWrapper>
        </div>
      </div>
    );
  }

  // Merge CAES-resolved attributes into UserAttributeEntry format for access resolution
  const mergedAttrs: Record<string, UserAttributeEntry> = { ...(userAttrs?.attributes ?? {}) };
  if (caesResolved) {
    for (const [key, resolved] of Object.entries(caesResolved.attributes)) {
      const current = mergedAttrs[key];
      if (!current || resolved.authoritative_source) {
        mergedAttrs[key] = {
          value: resolved.value,
          source: resolved.source,
          fetch_mode: 'live',
          authoritative_source: resolved.authoritative_source,
          self_service: false,
          writable: false,
        };
      }
    }
  }

  const accessLevel = selectedGcuid ? resolveAccessLevel(app, mergedAttrs) : null;
  const dept   = getAttrValue(mergedAttrs, 'person.employment.department');
  const title  = getAttrValue(mergedAttrs, 'person.job.title');
  const status = getAttrValue(mergedAttrs, 'person.employment.status') || 'active';

  const loading = loadingAttrs || loadingCaes;

  return (
    <div className="space-y-6">
      {/* App banner */}
      <div className="rounded-xl overflow-hidden shadow-sm">
        <div className="px-6 py-5 flex items-start justify-between" style={{ background: theme.bannerGradient }}>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-4xl">{app.emoji}</span>
              <div>
                <h1 className="text-2xl font-bold text-white">{app.name}</h1>
                <p className="text-sm text-white/70">{app.vendor}</p>
              </div>
            </div>
            <p className="text-sm text-white/80 mt-2 max-w-xl">{app.description}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Link
              to="/apps"
              className="text-xs text-white/60 hover:text-white/90 transition-colors mt-1"
            >
              ← All Applications
            </Link>
            {session && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-white/80">
                  Signed in as <span className="font-semibold">{session.credential}</span>
                </span>
                <button
                  onClick={() => {
                    setSession(null);
                    setSelectedGcuid(null);
                    setLoginInput('');
                    setGcuidInput('');
                    setLoginMethod('credential');
                    setLoginError(null);
                    setLoginFailureType(null);
                  }}
                  className="text-[11px] px-2 py-0.5 rounded bg-white/20 text-white/90 hover:bg-white/30 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
        {/* GCUID/CAES tagline strip */}
        <div className="px-6 py-2 flex items-center gap-2 text-xs" style={{ backgroundColor: `color-mix(in srgb, ${theme.accent} 12%, var(--ux-bg-surface))`, borderBottom: `1px solid color-mix(in srgb, ${theme.accent} 20%, transparent)` }}>
          <span style={{ color: theme.accent }}>🔐</span>
          <span className="text-ux-text-sub">Access control governed by</span>
          <Link to="/gcuid" className="font-semibold hover:underline" style={{ color: theme.accent }}>GCUID Registry</Link>
          <span className="text-ux-text-muted">+</span>
          <Link to="/caes"  className="font-semibold hover:underline" style={{ color: theme.accent }}>CAES</Link>
          <span className="text-ux-text-sub">· Attribute resolution: live</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: User search + identity */}
        <div className="space-y-4">
          {/* Signed in banner */}
          {session && (
            <div
              className="rounded-lg p-3 text-xs space-y-1"
              style={{ backgroundColor: `color-mix(in srgb, ${theme.accent} 8%, var(--ux-bg-surface-alt))`, border: `1px solid color-mix(in srgb, ${theme.accent} 25%, transparent)` }}
            >
              <p className="font-semibold text-ux-text" style={{ color: theme.accentDim }}>
                🔓 Authenticated via {policy?.source_system.toUpperCase() ?? '…'}
              </p>
              <p className="text-ux-text-sub">
                <span className="font-medium text-ux-text">{session.credential}</span>
                {session.gcuid
                  ? <span className="ml-1 text-ux-text-muted">· GCUID linked</span>
                  : <span className="ml-1 text-ux-text-muted">· No GCUID linked — showing source record</span>}
              </p>
            </div>
          )}

          {/* Search */}
          <div className="rounded-lg border border-ux-border bg-ux-bg-surface p-4">
            <h2 className="text-sm font-semibold text-ux-text mb-3">Look Up a User</h2>
            <div className="relative">
              <input
                type="search"
                placeholder="Search by name or email…"
                className="w-full text-sm px-3 py-2 pl-8 rounded-md border border-ux-border bg-ux-input text-ux-text focus:outline-none focus:ring-1"
                style={{ '--tw-ring-color': theme.accent } as React.CSSProperties}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <span className="absolute left-2.5 top-2.5 text-ux-text-muted text-xs">🔍</span>
            </div>
            {searching && (
              <p className="text-xs text-ux-text-muted mt-2">Searching…</p>
            )}
            {searchResults && searchResults.length === 0 && searchQuery.length >= 2 && !searching && (
              <p className="text-xs text-ux-text-muted mt-2">No users found.</p>
            )}
            {searchResults && searchResults.length > 0 && (
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {searchResults.map((identity: Identity) => (
                  <li key={identity.gcuid}>
                    <button
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-ux-bg-hover transition-colors"
                      style={selectedGcuid === identity.gcuid ? { backgroundColor: theme.badgeBg, color: theme.badgeText } : undefined}
                      onClick={() => {
                        setSelectedGcuid(identity.gcuid);
                        setSearchQuery('');
                      }}
                    >
                      <div className="font-medium text-ux-text">{identity.entity_id}</div>
                      <div className="text-ux-text-muted truncate">{identity.gcuid}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Identity card */}
          {selectedIdentity && (
            <div className="rounded-lg border bg-ux-bg-surface p-4 space-y-2" style={{ borderColor: `color-mix(in srgb, ${theme.accent} 30%, var(--ux-border-default))` }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">🪪</span>
                <div>
                  <h3 className="text-sm font-semibold text-ux-text">{selectedIdentity.entity_id}</h3>
                  <p className="text-[10px] text-ux-text-muted font-mono break-all">{selectedIdentity.gcuid}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-ux-text-sub">Entity type</span>
                <span className="text-ux-text font-medium capitalize">{selectedIdentity.entity_type}</span>
                <span className="text-ux-text-sub">Identity state</span>
                <span className="font-medium" style={{ color: selectedIdentity.state === 'active' ? 'var(--ux-status-success)' : 'var(--ux-status-warning)' }}>
                  {selectedIdentity.state}
                </span>
                <span className="text-ux-text-sub">Identifier</span>
                <span className="font-medium" style={{ color: selectedIdentity.identifier_state === 'issued' ? 'var(--ux-status-success)' : 'var(--ux-status-warning)' }}>
                  {selectedIdentity.identifier_state}
                </span>
                <span className="text-ux-text-sub">Namespace</span>
                <span className="text-ux-text">{selectedIdentity.namespace}</span>
              </div>
              <div className="pt-2 flex gap-2">
                <Link
                  to={`/gcuid?gcuid=${encodeURIComponent(selectedIdentity.gcuid)}`}
                  className="text-xs hover:underline"
                  style={{ color: theme.accent }}
                >
                  View in Registry →
                </Link>
                <Link
                  to={`/caes`}
                  className="text-xs hover:underline"
                  style={{ color: theme.accentDim }}
                >
                  CAES →
                </Link>
              </div>
            </div>
          )}

          {!selectedGcuid && (
            <div className="rounded-lg border border-dashed border-ux-border p-6 text-center">
              <p className="text-sm text-ux-text-muted">Search for a user above to see their access level in {app.name}.</p>
            </div>
          )}
        </div>

        {/* Right columns: CAES attributes + access control */}
        <div className="lg:col-span-2 space-y-4">
          {selectedGcuid && (
            <>
              {/* CAES attributes */}
              <div className="rounded-lg border border-ux-border bg-ux-bg-surface p-4">
                <h2 className="text-sm font-semibold text-ux-text mb-1">CAES Resolved Attributes</h2>
                <p className="text-xs text-ux-text-muted mb-3">Canonical attribute values resolved by CAES from all linked authoritative sources.</p>
                {loading ? (
                  <p className="text-xs text-ux-text-muted">Resolving attributes…</p>
                ) : (
                  <div className="divide-y divide-ux-border">
                    {app.requiredAttributes.map(attrKey => {
                      const native = userAttrs?.attributes[attrKey];
                      const caes   = caesResolved?.attributes[attrKey];
                      const value  = caes?.value ?? native?.value;
                      const source = caes?.source ?? native?.source ?? null;
                      const auth   = caes?.authoritative_source ?? native?.authoritative_source ?? null;
                      const label  = attrKey.replace('person.employment.', '').replace('person.', '').replace(/\./g, ' ');
                      return (
                        <AttrRow
                          key={attrKey}
                          label={label}
                          value={value !== null && value !== undefined ? String(value) : ''}
                          source={source}
                          authoritative={auth}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Access control panel */}
              {accessLevel && (
                <div className="rounded-lg border bg-ux-bg-surface overflow-hidden" style={{ borderColor: `color-mix(in srgb, ${theme.accent} 25%, var(--ux-border-default))` }}>
                  <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: `color-mix(in srgb, ${theme.accent} 8%, var(--ux-bg-surface))` }}>
                    <h2 className="text-sm font-semibold text-ux-text">Access Control Decision</h2>
                    {!loading && <AccessBadge role={accessLevel.role} theme={theme} />}
                    {loading && <span className="text-xs text-ux-text-muted">Computing…</span>}
                  </div>
                  {!loading && (
                    <div className="p-4 space-y-3">
                      <p className="text-sm text-ux-text-sub">{accessLevel.description}</p>
                      {accessLevel.permissions.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-ux-text mb-2">Granted Permissions</p>
                          <div className="flex flex-wrap gap-1.5">
                            {accessLevel.permissions.map(p => (
                              <PermissionChip key={p} perm={p} theme={theme} />
                            ))}
                          </div>
                        </div>
                      )}
                      {accessLevel.role === 'No Access' && (
                        <div className="rounded-md p-3 bg-ux-status-error-bg border border-ux-status-error-border text-xs text-ux-status-error">
                          This user's GCUID identity state or employment status prevents access. Changes must be processed through the GCUID Registry or the authoritative HR source to restore access.
                        </div>
                      )}
                      <div className="pt-1 text-xs text-ux-text-muted">
                        Decision based on:{' '}
                        {dept   && <span className="mr-2">department: <span className="text-ux-text font-medium">{dept}</span></span>}
                        {title  && <span className="mr-2">title: <span className="text-ux-text font-medium">{title}</span></span>}
                        {status && <span>status: <span className="text-ux-text font-medium">{status}</span></span>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* What-if simulator */}
              <div className="rounded-lg border border-ux-border bg-ux-bg-surface p-4">
                <h2 className="text-sm font-semibold text-ux-text mb-1">What-If Simulator</h2>
                <WhatIfSimulator
                  app={app}
                  theme={theme}
                  currentDept={dept}
                  currentTitle={title}
                  currentStatus={status}
                />
              </div>

              {/* GCUID / CAES impact note */}
              <div
                className="rounded-lg p-4 text-xs space-y-1.5"
                style={{
                  backgroundColor: `color-mix(in srgb, ${theme.accent} 5%, var(--ux-bg-surface-alt))`,
                  border: `1px solid color-mix(in srgb, ${theme.accent} 20%, transparent)`,
                }}
              >
                <p className="font-semibold text-ux-text" style={{ color: theme.accentDim }}>🔗 GCUID & CAES Integration</p>
                <p className="text-ux-text-sub">
                  <span className="font-medium text-ux-text">Access is resolved at runtime</span> — not stored in this application. Every time a user signs in, {app.name} calls CAES to resolve their current canonical attributes from all linked authoritative sources (HR, LDAP, etc.).
                </p>
                <p className="text-ux-text-sub">
                  Changes to department or role in the HR system propagate automatically via CAES. Changes to GCUID identity state (e.g. suspension, retirement) immediately affect access regardless of HR attributes.
                </p>
                <div className="flex gap-4 pt-1">
                  <Link to="/gcuid" className="font-medium hover:underline" style={{ color: theme.accent }}>GCUID Registry →</Link>
                  <Link to="/caes"  className="font-medium hover:underline" style={{ color: theme.accent }}>CAES Attribute Engine →</Link>
                  <Link to="/sources" className="font-medium hover:underline" style={{ color: theme.accent }}>Authoritative Sources →</Link>
                </div>
              </div>
            </>
          )}

          {!selectedGcuid && (
            <div className="rounded-lg border border-dashed border-ux-border p-10 text-center">
              <p className="text-ux-text-muted text-sm">Select a user from the search panel to see their real-time access control decision in {app.name}.</p>
              <p className="text-xs text-ux-text-muted mt-2">Attributes are resolved live from CAES and all linked authoritative sources.</p>
            </div>
          )}
        </div>
      </div>

      {/* Access rules reference */}
      <div className="rounded-lg border border-ux-border bg-ux-bg-surface p-4">
        <h2 className="text-sm font-semibold text-ux-text mb-3">Access Level Reference — {app.name}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {app.accessLevels.filter(l => l.role !== 'No Access').map(level => (
            <div
              key={level.role}
              className="rounded-md p-3 space-y-2"
              style={{ backgroundColor: `color-mix(in srgb, ${theme.accent} 5%, var(--ux-bg-surface-alt))`, border: `1px solid color-mix(in srgb, ${theme.accent} 15%, transparent)` }}
            >
              <div className="text-xs font-semibold" style={{ color: theme.accentDim }}>{level.role}</div>
              <p className="text-xs text-ux-text-sub leading-snug">{level.description}</p>
              <ul className="space-y-0.5">
                {level.permissions.map(p => (
                  <li key={p} className="text-[11px] text-ux-text-sub flex items-start gap-1">
                    <span style={{ color: theme.accent }}>·</span> {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
