/**
 * Returns a human-readable environment label for display in the footer and
 * any other UI that needs to surface the current deployment context.
 *
 * Resolution order:
 *   1. VITE_APP_ENV build-time variable (set via .env.staging / .env.production
 *      or by passing --mode <name> to `vite build`)
 *   2. Runtime hostname detection
 *   3. Default: "Development"
 */
export function getEnvironmentLabel(): string {
  // 1. Explicit build-time override
  const explicit = import.meta.env.VITE_APP_ENV;
  if (explicit) {
    return explicit.charAt(0).toUpperCase() + explicit.slice(1).toLowerCase();
  }

  // 2. Runtime hostname detection
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
      return 'Development';
    }
    if (host.startsWith('staging.')) {
      return 'Staging';
    }
    if (host === 'noetroniq.com' || host === 'www.noetroniq.com') {
      return 'Production';
    }
  }

  return 'Development';
}
