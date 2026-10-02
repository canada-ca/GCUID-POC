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
// ─── Portal group definitions ─────────────────────────────────────────────────
// Shared between PortalLayout (separate-mode per-portal header) and
// PortalIndexPage (separate-mode landing page).

export interface PortalTab {
  to: string;
  label: string;
}

export type PortalColorId = 'teal' | 'blue' | 'purple' | 'amber' | 'violet' | 'orange';

export interface PortalGroup {
  id: string;
  label: string;
  description: string;
  colorId: PortalColorId;
  /** All route paths that belong to this portal */
  routes: string[];
  /** The route to open when launching this portal */
  defaultRoute: string;
  /** Tabs shown in the portal-specific header */
  tabs: PortalTab[];
}

export const PORTAL_GROUPS: PortalGroup[] = [
  {
    id: 'self-service',
    label: 'Self-Service',
    description:
      'User self-service functions including profile lookup and identity registration.',
    colorId: 'teal',
    routes: ['/user', '/register'],
    defaultRoute: '/user',
    tabs: [
      { to: '/user',     label: 'User Portal'  },
      { to: '/register', label: 'Registration' },
    ],
  },
  {
    id: 'help-desk',
    label: 'Help Desk',
    description:
      'Help desk support portal — profile lookup and identity registration for assisted workflows.',
    colorId: 'teal',
    routes: ['/helpdesk', '/helpdesk/register'],
    defaultRoute: '/helpdesk',
    tabs: [
      { to: '/helpdesk',          label: 'Help Desk'    },
      { to: '/helpdesk/register', label: 'Registration' },
    ],
  },
  {
    id: 'hr',
    label: 'HR System',
    description:
      'Human Resources management system — authoritative source for employee records.',
    colorId: 'blue',
    routes: ['/hr'],
    defaultRoute: '/hr',
    tabs: [{ to: '/hr', label: 'HR System' }],
  },
  {
    id: 'ldap',
    label: 'LDAP / Active Directory',
    description:
      'Directory services — authoritative source for network accounts and groups.',
    colorId: 'blue',
    routes: ['/ldap'],
    defaultRoute: '/ldap',
    tabs: [{ to: '/ldap', label: 'LDAP / AD' }],
  },
  {
    id: 'engineering',
    label: 'Engineering',
    description: 'Engineering department identity records and roster management.',
    colorId: 'purple',
    routes: ['/engineering'],
    defaultRoute: '/engineering',
    tabs: [{ to: '/engineering', label: 'Engineering' }],
  },
  {
    id: 'finance',
    label: 'Finance',
    description: 'Finance department identity records and roster management.',
    colorId: 'purple',
    routes: ['/finance'],
    defaultRoute: '/finance',
    tabs: [{ to: '/finance', label: 'Finance' }],
  },
  {
    id: 'gcuid',
    label: 'GCUID Services',
    description: 'GCUID Registry, CAES federation, and source system management.',
    colorId: 'amber',
    routes: ['/gcuid', '/caes', '/sources'],
    defaultRoute: '/gcuid',
    tabs: [
      { to: '/gcuid',   label: 'GCUID Registry'  },
      { to: '/caes',    label: 'CAES'             },
      { to: '/sources', label: 'Sources & Depts'  },
    ],
  },
  {
    id: 'corp-apps',
    label: 'Corporate Applications',
    description: 'Corporate apps, project hubs, asset registries, and procurement tools that consume GCUID-resolved identities.',
    colorId: 'orange',
    routes: ['/apps', '/apps/budget', '/apps/projects', '/apps/travel', '/apps/assets', '/apps/hrconnect', '/apps/procurement'],
    defaultRoute: '/apps/budget',
    tabs: [
      { to: '/apps/budget',      label: 'Budget Compass'     },
      { to: '/apps/projects',    label: 'Project Hub'        },
      { to: '/apps/travel',      label: 'Travel & Expense'   },
      { to: '/apps/assets',      label: 'Asset Registry'     },
      { to: '/apps/hrconnect',   label: 'HR Connect'         },
      { to: '/apps/procurement', label: 'Procurement Portal' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    description: 'System options, audit logs, dashboard, diagnostic tools, and administrative tooling.',
    colorId: 'violet',
    routes: [
      '/dashboard', '/logs', '/testing', '/databases', '/tools',
      '/ux', '/options', '/system', '/policies', '/about',
    ],
    defaultRoute: '/dashboard',
    tabs: [
      { to: '/dashboard', label: 'Dashboard'   },
      { to: '/logs',      label: 'Logs'        },
      { to: '/testing',   label: 'API Testing' },
      { to: '/databases', label: 'Databases'   },
      { to: '/tools',     label: 'Tools'       },
      { to: '/ux',        label: 'UX'          },
      { to: '/options',   label: 'Options'     },
      { to: '/system',    label: 'System'      },
      { to: '/policies',  label: 'Policies'    },
      { to: '/about',     label: 'About'       },
    ],
  },
];

/** Return the portal group that owns the given pathname, or undefined. */
export function findPortalGroup(pathname: string): PortalGroup | undefined {
  return PORTAL_GROUPS.find((g) =>
    g.routes.some((r) => pathname === r || pathname.startsWith(r + '/'))
  );
}

// ─── Tailwind colour tokens per portal colour ─────────────────────────────────

export interface ColorTokens {
  dot: string;
  label: string;
  activeTab: string;
  badge: string;
  cardBorder: string;
}

export const COLOR_TOKENS: Record<PortalColorId, ColorTokens> = {
  teal: {
    dot:       'bg-teal-500',
    label:     'text-teal-700 dark:text-teal-400',
    activeTab: 'border-teal-600 text-teal-700 dark:text-teal-300',
    badge:     'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200',
    cardBorder:
      'border-teal-300 dark:border-teal-700 hover:border-teal-500 dark:hover:border-teal-400',
  },
  blue: {
    dot:       'bg-blue-500',
    label:     'text-blue-700 dark:text-blue-300',
    activeTab: 'border-blue-600 text-blue-700 dark:text-blue-300',
    badge:     'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200',
    cardBorder:
      'border-blue-300 dark:border-blue-700 hover:border-blue-500 dark:hover:border-blue-400',
  },
  purple: {
    dot:       'bg-purple-500',
    label:     'text-purple-700 dark:text-purple-300',
    activeTab: 'border-purple-600 text-purple-700 dark:text-purple-300',
    badge:     'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200',
    cardBorder:
      'border-purple-300 dark:border-purple-700 hover:border-purple-500 dark:hover:border-purple-400',
  },
  amber: {
    dot:       'bg-amber-500',
    label:     'text-amber-800 dark:text-amber-400',
    activeTab: 'border-amber-600 text-amber-700 dark:text-amber-300',
    badge:     'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200',
    cardBorder:
      'border-amber-300 dark:border-amber-700 hover:border-amber-500 dark:hover:border-amber-400',
  },
  violet: {
    dot:       'bg-violet-500',
    label:     'text-violet-700 dark:text-violet-300',
    activeTab: 'border-violet-600 text-violet-700 dark:text-violet-300',
    badge:     'bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200',
    cardBorder:
      'border-violet-300 dark:border-violet-700 hover:border-violet-500 dark:hover:border-violet-400',
  },
  orange: {
    dot:       'bg-orange-500',
    label:     'text-orange-700 dark:text-orange-300',
    activeTab: 'border-orange-600 text-orange-700 dark:text-orange-300',
    badge:     'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200',
    cardBorder:
      'border-orange-300 dark:border-orange-700 hover:border-orange-500 dark:hover:border-orange-400',
  },
};
