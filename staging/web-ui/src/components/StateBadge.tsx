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
interface StateData {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

// Identity entity states (the person/org lifecycle)
const stateConfig: Record<string, StateData> = {
  provisional: {
    label: 'Provisional',
    color: 'text-yellow-800 dark:text-yellow-300',
    bgColor: 'bg-[#f4f0e4] dark:bg-yellow-900/20',
    borderColor: 'border-[#e9e1c9] dark:border-[#a67f3d]',
  },
  active: {
    label: 'Active',
    color: 'text-green-700 dark:text-green-300',
    bgColor: 'bg-[#e8ede6] dark:bg-green-900/20',
    borderColor: 'border-[#d1dccf] dark:border-green-700',
  },
  under_review: {
    label: 'Under Review',
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-[#eeeaf3] dark:bg-purple-900/20',
    borderColor: 'border-[#ddd5e7] dark:border-[#674b8a]',
  },
  suspended: {
    label: 'Suspended',
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
    borderColor: 'border-red-200 dark:border-red-700',
  },
  retired: {
    label: 'Retired',
    color: 'text-ux-text',
    bgColor: 'bg-ux-surface-alt',
    borderColor: 'border-ux-border',
  },
  archived: {
    label: 'Archived',
    color: 'text-ux-text-sub',
    bgColor: 'bg-ux-surface-alt',
    borderColor: 'border-ux-border',
  },
};

// Identifier token states (the GCUID token lifecycle)
const identifierStateConfig: Record<string, StateData> = {
  reserved: {
    label: 'Reserved',
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-[#e7eef4] dark:bg-blue-900/20',
    borderColor: 'border-[#d0dde9] dark:border-[#3f6489]',
  },
  issued: {
    label: 'Issued',
    color: 'text-teal-700 dark:text-teal-300',
    bgColor: 'bg-[#e6eeec] dark:bg-teal-900/20',
    borderColor: 'border-[#ceddd9] dark:border-teal-700',
  },
  superseded: {
    label: 'Superseded',
    color: 'text-orange-700 dark:text-orange-300',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    borderColor: 'border-orange-200 dark:border-orange-700',
  },
  nullified: {
    label: 'Nullified',
    color: 'text-red-900 dark:text-red-200',
    bgColor: 'bg-red-100 dark:bg-red-800/60',
    borderColor: 'border-red-300 dark:border-red-700',
  },
};

interface StateBadgeProps {
  state: string;
  /** Pass "identifier" to use the identifier token colour palette */
  kind?: 'identity' | 'identifier';
}

export default function StateBadge({ state, kind = 'identity' }: StateBadgeProps) {
  const map = kind === 'identifier' ? identifierStateConfig : stateConfig;
  const config = map[state] ?? {
    label: state,
    color: 'text-ux-text',
    bgColor: 'bg-ux-surface-alt',
    borderColor: 'border-ux-border',
  };
  
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.color} ${config.bgColor} ${config.borderColor}`}
    >
      {config.label}
    </span>
  );
}
