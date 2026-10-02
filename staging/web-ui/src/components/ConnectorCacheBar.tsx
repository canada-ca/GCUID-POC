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
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { connectorsApi, sourceSystemsApi } from '../api/client';

const MODE_LABELS: Record<string, string> = {
  'scheduled-pull': 'Scheduled Pull',
  'push-cache':     'Push to Cache',
  'dynamic-pull':   'Dynamic Pull',
};

const MODE_COLORS: Record<string, string> = {
  'scheduled-pull': 'bg-[#e6eeec] dark:bg-teal-800/60 text-teal-700 dark:text-teal-300 border-[#ceddd9] dark:border-teal-700',
  'push-cache':     'bg-[#f4f0e4] dark:bg-amber-800/60 text-amber-800 dark:text-amber-300 border-[#e9e1c9] dark:border-amber-700',
  'dynamic-pull':   'bg-orange-50 dark:bg-orange-800/60 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700',
};

const BUTTON_LABELS: Record<string, string> = {
  'scheduled-pull': 'Sync Now',
  'push-cache':     'Push to Cache',
};

/**
 * ConnectorCacheBar
 *
 * A compact status bar for department portals whose connector uses a cache-backed
 * access mode (push-cache or scheduled-pull). Shows the current cache record count,
 * last sync time, and optionally a button to trigger an immediate sync/push.
 *
 * When the cache is stale a warning or error banner is shown below the main row,
 * driven by the system's cache_stale_policy:
 *   serve-stale       → no banner (silent, data served as-is)
 *   serve-stale-warn  → amber warning banner
 *   error-on-stale    → red error banner (API also returns 409 for reads)
 *
 * Silently renders nothing for dynamic-pull connectors (no cache to manage).
 */
export default function ConnectorCacheBar({
  connectorId,
  showSyncButton = true,
}: {
  connectorId: string;
  showSyncButton?: boolean;
}) {
  const qc = useQueryClient();

  const { data: systems } = useQuery({
    queryKey: ['source-systems'],
    queryFn: sourceSystemsApi.list,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: connectorConfig } = useQuery({
    queryKey: ['connector-config', connectorId],
    queryFn: () => connectorsApi.get(connectorId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => connectorsApi.sync(connectorId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['source-systems'] }),
  });

  const system = systems?.find(s => s.connector_id === connectorId);
  const connectorEnabled = connectorConfig?.enabled !== false;

  // Don't render for unknown or dynamic-pull connectors
  if (!system || system.access_mode === 'dynamic-pull') return null;

  const mode     = system.access_mode;
  const lastSync = system.last_sync_at ? new Date(system.last_sync_at) : null;

  // ── Staleness calculation ────────────────────────────────────────────────
  const ttl = system.cache_ttl_seconds ?? 0;
  const isStale =
    ttl > 0 &&
    lastSync !== null &&
    lastSync.getTime() + ttl * 1000 < Date.now();
  const stalePolicy = system.cache_stale_policy ?? 'serve-stale';

  const expiresAt = ttl > 0 && lastSync
    ? new Date(lastSync.getTime() + ttl * 1000)
    : null;
  const expiresLabel = expiresAt
    ? expiresAt.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : null;

  const lastSyncLabel = lastSync
    ? lastSync.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : null;

  const btnLabel = syncMutation.isPending
    ? 'Working…'
    : BUTTON_LABELS[mode] ?? 'Sync';

  return (
    <div className="space-y-1.5">
      {/* Main status row */}
      <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-xs ${MODE_COLORS[mode] ?? 'bg-ux-surface-alt text-ux-text-sub border-ux-border'}`}>
        {/* Mode badge */}
        <span className="font-semibold shrink-0">{MODE_LABELS[mode]}</span>

        <span className="text-current opacity-40">·</span>

        {/* Cache stats */}
        {system.cache_record_count > 0 ? (
          <span>
            <span className="font-medium">{system.cache_record_count.toLocaleString()}</span> records cached
          </span>
        ) : (
          <span>No records cached yet</span>
        )}

        {/* Last sync */}
        {lastSyncLabel ? (
          <>
            <span className="opacity-40">·</span>
            <span>Last synced {lastSyncLabel}</span>
          </>
        ) : (
          <>
            <span className="opacity-40">·</span>
            <span className="font-medium">Never synced</span>
          </>
        )}

        {/* Stale indicator in main row */}
        {isStale && (
          <>
            <span className="opacity-40">·</span>
            <span className={`font-semibold ${stalePolicy === 'error-on-stale' ? 'text-red-600' : 'text-amber-800 dark:text-amber-300'}`}>
              {stalePolicy === 'error-on-stale' ? '⛔ Cache stale' : '⚠ Cache stale'}
            </span>
          </>
        )}

        {/* Sync error */}
        {syncMutation.isError && (
          <>
            <span className="opacity-40">·</span>
            <span className="text-red-600 font-medium">
              Sync failed: {(syncMutation.error as Error).message}
            </span>
          </>
        )}

        {showSyncButton && (
          <div className="ml-auto shrink-0">
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="px-3 py-1 rounded font-medium text-xs bg-white/20 hover:bg-white/35 dark:bg-white/15 dark:hover:bg-white/25 border border-current disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {btnLabel}
            </button>
          </div>
        )}
      </div>

      {/* Staleness banner — only when stale and policy is not serve-stale (silent) */}
      {isStale && stalePolicy !== 'serve-stale' && (
        <div className={`flex items-start gap-2 px-4 py-2 rounded-lg border text-xs ${
          stalePolicy === 'error-on-stale'
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'
            : 'bg-[#f4f0e4] dark:bg-amber-900/20 border-[#e9e1c9] dark:border-amber-700 text-amber-800 dark:text-amber-300'
        }`}>
          <span className="text-sm shrink-0 mt-0.5">
            {stalePolicy === 'error-on-stale' ? '⛔' : '⚠️'}
          </span>
          <div>
            {stalePolicy === 'error-on-stale' ? (
              <>
                <span className="font-semibold">Cache is stale and reads are blocked.</span>{' '}
                The cache expired {expiresLabel ? `at ${expiresLabel}` : 'recently'}.
                A re-sync is required before data can be read from this system.
              </>
            ) : (
              <>
                <span className="font-semibold">Cache data may be out of date.</span>{' '}
                The cache expired {expiresLabel ? `at ${expiresLabel}` : 'recently'}.
                Data is still served from the cache. Re-sync to get the latest records.
              </>
            )}
          </div>
        </div>
      )}
      {/* Connector disabled banner */}
      {!connectorEnabled && (
        <div className="flex items-start gap-2 px-4 py-2 rounded-lg border text-xs bg-ux-surface-alt border-ux-border text-ux-text-sub">
          <span className="text-sm shrink-0 mt-0.5">🔌</span>
          <div>
            <span className="font-semibold">Connector is disabled.</span>{' '}
            Sync and ingest are blocked. Cached data is still readable and writable locally.
          </div>
        </div>
      )}
    </div>
  );
}
