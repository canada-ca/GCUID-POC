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
import { ConnectorHealthData, ACCESS_MODE_LABELS } from '../api/client';
import { useDateTime } from '../context/DateTimeFormatContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_PILL: Record<string, string> = {
  operational:  'bg-green-100  dark:bg-green-800/60  text-green-800  dark:text-green-200',
  degraded:     'bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200',
  disabled:     'bg-ux-surface-alt text-ux-text-sub',
  unavailable:  'bg-red-100    dark:bg-red-800/60     text-red-800    dark:text-red-200',
  unregistered: 'bg-red-100    dark:bg-red-800/60     text-red-800    dark:text-red-200',
};

const ENDPOINT_PILL: Record<string, string> = {
  reachable:   'bg-green-100  dark:bg-green-800/60  text-green-800  dark:text-green-200',
  error:       'bg-yellow-100 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200',
  unreachable: 'bg-red-100    dark:bg-red-800/60     text-red-800    dark:text-red-200',
};

const MODE_DESCRIPTIONS: Record<string, string> = {
  'dynamic-pull':
    'The registry queries this source live on every attribute lookup. No data is cached — ' +
    'each request goes directly to the connector endpoint in real time.',
  'scheduled-pull':
    'The registry synchronises all records from this source on a schedule and serves ' +
    'attribute lookups from the local cache. Data is periodically refreshed.',
  'push-cache':
    'This source pushes record updates to the registry via the ingest endpoint. ' +
    'The registry serves all attribute lookups from the cached copy; no inbound connections are made to the source.',
};

// ─── Main component ───────────────────────────────────────────────────────────

interface ConnectorStatusPanelProps {
  data: ConnectorHealthData;
  /** Optional contextual blurb shown at the bottom instead of the generic mode description. */
  about?: React.ReactNode;
}

export function ConnectorStatusPanel({ data, about }: ConnectorStatusPanelProps) {
  const { fmt: formatDateTime } = useDateTime();
  const modeLabel = ACCESS_MODE_LABELS[data.access_mode] ?? data.access_mode;

  const modePill =
    data.access_mode === 'dynamic-pull'   ? <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Live</span>
    : data.access_mode === 'scheduled-pull' ? <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">Cached</span>
    : <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Cache</span>;

  // ── Section 1 — Registration & Status ───────────────────────────────────
  const registrationSection = (
    <div className="bg-ux-surface overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <h3 className="text-lg font-medium text-ux-text mb-4">
          Connector Registration
        </h3>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm font-medium text-ux-text-sub">System ID</dt>
            <dd className="mt-1 text-sm text-ux-text font-mono">{data.system_id}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ux-text-sub">Display Name</dt>
            <dd className="mt-1 text-sm text-ux-text">{data.display_name}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ux-text-sub">Access Mode</dt>
            <dd className="mt-1 text-sm text-ux-text font-medium">
              {modeLabel}{modePill}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ux-text-sub">Status</dt>
            <dd className="mt-1">
              <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${STATUS_PILL[data.status] ?? STATUS_PILL.unavailable}`}>
                {data.status}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ux-text-sub">Local Records (active)</dt>
            <dd className="mt-1 text-sm text-ux-text">{data.local_record_count ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ux-text-sub">Registry GCUIDs Linked</dt>
            <dd className="mt-1 text-sm text-ux-text">{data.registry_gcuid_count ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ux-text-sub">DB Probe</dt>
            <dd className="mt-1 text-sm text-ux-text">{data.db_message ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ux-text-sub">Registry Active</dt>
            <dd className="mt-1 text-sm text-ux-text">{data.is_active ? 'Yes' : 'No'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );

  // ── Section 2 — Mode-specific details ───────────────────────────────────
  let modeSection: React.ReactNode = null;

  if (data.access_mode === 'dynamic-pull') {
    modeSection = (
      <div className="bg-ux-surface overflow-hidden shadow rounded-lg">
        <div className="p-5">
          <h3 className="text-lg font-medium text-ux-text mb-4">
            Live Query Endpoint
          </h3>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Connector Endpoint</dt>
              <dd className="mt-1 text-ux-text font-mono text-xs break-all">{data.connector_url ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Port</dt>
              <dd className="mt-1 text-sm text-ux-text">{data.connector_port ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Endpoint Probe</dt>
              <dd className="mt-1">
                {data.endpoint_status
                  ? <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${ENDPOINT_PILL[data.endpoint_status] ?? ENDPOINT_PILL.error}`}>{data.endpoint_status}</span>
                  : <span className="text-ux-text-muted italic text-sm">EFS / local mode</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Response Latency</dt>
              <dd className="mt-1 text-sm text-ux-text">
                {data.endpoint_latency_ms != null ? `${data.endpoint_latency_ms} ms` : <span className="text-ux-text-muted italic">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Cache TTL</dt>
              <dd className="mt-1 text-sm text-ux-text-muted italic">Not applicable — live queries only</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Last Sync</dt>
              <dd className="mt-1 text-sm text-ux-text-muted italic">Not applicable — live queries only</dd>
            </div>
          </dl>
        </div>
      </div>
    );
  } else if (data.access_mode === 'scheduled-pull') {
    modeSection = (
      <div className="bg-ux-surface overflow-hidden shadow rounded-lg">
        <div className="p-5">
          <h3 className="text-lg font-medium text-ux-text mb-4">
            Sync Schedule &amp; Cache
          </h3>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Last Sync</dt>
              <dd className="mt-1 text-sm text-ux-text">
                {data.last_sync_at ? formatDateTime(data.last_sync_at) : <span className="text-ux-text-muted italic">Never synced</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Pull Schedule</dt>
              <dd className="mt-1 text-sm text-ux-text">
                {data.pull_schedule ? <span className="font-mono text-xs">{data.pull_schedule}</span> : <span className="text-ux-text-muted italic">Manual / not scheduled</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Cache TTL</dt>
              <dd className="mt-1 text-sm text-ux-text">{data.cache_ttl_seconds != null ? `${data.cache_ttl_seconds} s` : '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Stale Cache Policy</dt>
              <dd className="mt-1 text-sm text-ux-text capitalize">{data.cache_stale_policy ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </div>
    );
  } else if (data.access_mode === 'push-cache') {
    modeSection = (
      <div className="bg-ux-surface overflow-hidden shadow rounded-lg">
        <div className="p-5">
          <h3 className="text-lg font-medium text-ux-text mb-4">
            Ingest Cache
          </h3>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Last Ingest</dt>
              <dd className="mt-1 text-sm text-ux-text">
                {data.last_sync_at ? formatDateTime(data.last_sync_at) : <span className="text-ux-text-muted italic">No data pushed yet</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Accept Inbound Push</dt>
              <dd className="mt-1 text-sm">
                {data.allow_inbound
                  ? <span className="text-green-700 dark:text-green-400">Yes</span>
                  : <span className="text-red-600 dark:text-red-400">No</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Cache TTL</dt>
              <dd className="mt-1 text-sm text-ux-text">{data.cache_ttl_seconds != null ? `${data.cache_ttl_seconds} s` : '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-ux-text-sub">Stale Cache Policy</dt>
              <dd className="mt-1 text-sm text-ux-text capitalize">{data.cache_stale_policy ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </div>
    );
  }

  // ── Section 3 — About / mode explanation ────────────────────────────────
  const aboutSection = (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-6">
      <h3 className="text-lg font-medium text-ux-text mb-2">
        About — {modeLabel} connector
      </h3>
      <p className="text-sm text-ux-text">
        {about ?? MODE_DESCRIPTIONS[data.access_mode]}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      {registrationSection}
      {modeSection}
      {aboutSection}
    </div>
  );
}
