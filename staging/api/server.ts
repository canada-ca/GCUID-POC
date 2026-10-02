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
/*!
 * GCUID Staging REST API Server
 * 
 * Provides HTTP REST endpoints for identity management operations.
 * Mirrors CLI functionality with JSON responses.
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { logSystem } from './lib/logging/logger.js';
import { SYSTEM_EVENTS } from './lib/logging/log-events.js';
import { REGISTRY_DB_PATH } from './lib/db-paths.js';
import { userRoutes } from './routes/user.js';
import { adminRoutes } from './routes/admin.js';
import { hrRoutes } from './routes/hr.js';
import { ldapRoutes } from './routes/ldap.js';
import { engineeringRoutes } from './routes/engineering.js';
import { financeRoutes } from './routes/finance.js';
import { caesRoutes } from './routes/caes.js';
import { flagsRoutes } from './routes/flags.js';
import { logLevelsRoutes } from './routes/log-levels.js';
import { logsRoutes } from './routes/logs.js';
import { connectorsRoutes, listConfigs } from './routes/connectors.js';
import { systemDashboardRoutes } from './routes/system-dashboard.js';
import { bulkRoutes } from './routes/bulk.js';
import { hooksRoutes } from './routes/hooks.js';
import { gcuidRequestRoutes } from './routes/gcuid-request.js';
import { toolsRoutes } from './routes/tools.js';
import { uxConfigRoutes } from './routes/ux-config.js';
import { policiesRoutes } from './routes/policies.js';
import { upsertConnectorMappings } from './routes/caes.js';
import { errorHandler } from './middleware/error.js';
import { logger } from './middleware/logger.js';

const app: Express = express();
export { app };

const PORT = process.env.PORT || 5182;
const SERVER_START_TIME = Date.now();
// BASE_PATH: CloudFront path prefix under which this app is mounted.
// Used for generating correct redirect URLs and self-referential links.
// Empty string means the app is served from the root.
export const BASE_PATH: string = process.env['NOETRONIQ_BASE_PATH'] ?? '';

// APP_BASE_URL: public-facing origin (e.g. https://staging.noetroniq.com).
// Used when constructing absolute URLs that must resolve through CloudFront.
export const APP_BASE_URL: string = process.env['NOETRONIQ_APP_BASE_URL'] ?? '';

// ── Bootstrap admin user ──────────────────────────────────────────────────────
// When GCUID_BOOTSTRAP_ADMIN_EMAIL is set, ensure that email exists in the
// users config with role "admin" at startup.  Idempotent — safe to run on
// every cold start.  Matches the Standards Manager bootstrap pattern.
//
// In Lambda (EFS) mode, persist to /mnt/efs/config/users.json so the record
// survives container recycling.  In local/container mode, write to the bundled
// config/users.json instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveUsersConfigPath(): string {
  const dbPath = process.env['GCUID_DB_PATH'] ?? '';
  if (dbPath.startsWith('/mnt/efs')) {
    return path.join('/mnt/efs', 'config', 'users.json');
  }
  return path.join(__dirname, '..', 'config', 'users.json');
}

function bootstrapAdminUser(): void {
  const bootstrapEmail = process.env['GCUID_BOOTSTRAP_ADMIN_EMAIL'];
  if (!bootstrapEmail) return;

  const email = bootstrapEmail.trim().toLowerCase();
  const usersPath = resolveUsersConfigPath();

  let config: { users: Array<{ id: string; username: string; email: string; role: string; token: string; displayName: string; department: string | null; createdAt: string }> };

  // Ensure parent directory exists (important for EFS path on first cold start).
  fs.mkdirSync(path.dirname(usersPath), { recursive: true });

  try {
    config = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
  } catch {
    // Seed from bundled image copy if EFS copy doesn't exist yet.
    const bundledPath = path.join(__dirname, '..', 'config', 'users.json');
    try {
      config = JSON.parse(fs.readFileSync(bundledPath, 'utf-8'));
    } catch {
      config = { users: [] };
    }
  }

  const existing = config.users.find(u => u.email.toLowerCase() === email);
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      fs.writeFileSync(usersPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`[bootstrap] Updated ${email} → role=admin`);
    } else {
      console.log(`[bootstrap] ${email} already has role=admin`);
    }
    return;
  }

  const localPart = email.split('@')[0].replace(/[^a-z0-9.]/gi, '.');
  config.users.push({
    id:          `bootstrap_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
    username:    localPart,
    email,
    role:        'admin',
    token:       `bootstrap_token_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    displayName: localPart,
    department:  null,
    createdAt:   new Date().toISOString(),
  });
  fs.writeFileSync(usersPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`[bootstrap] Provisioned ${email} with role=admin`);
}

try {
  bootstrapAdminUser();
} catch (err: any) {
  console.warn('[server] bootstrapAdminUser failed (non-fatal):', err?.message);
}

// ── EFS database seeding (belt-and-suspenders) ────────────────────────────────
// Primary seeding happens in lambda-handler.js BEFORE this module is imported.
// This secondary seeding covers: connectors/ directory creation, and any
// scenario where server.ts is started directly without going through lambda-handler.js.
function ensureEfsDatabases(): void {
  const dbPath = process.env['GCUID_DB_PATH'] ?? '';
  if (!dbPath.startsWith('/mnt/efs')) return;

  const efsBase     = '/mnt/efs';
  const bundledData  = path.join(__dirname, '..', 'data');

  function seedIfMissing(src: string, dst: string): void {
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      console.log(`[efs-seed] ${path.basename(dst)} seeded from bundled image copy`);
    }
  }

  seedIfMissing(path.join(bundledData, 'registry.db'), path.join(efsBase, 'registry.db'));
  seedIfMissing(path.join(bundledData, 'logs.db'),     path.join(efsBase, 'logs.db'));

  const srcConn = path.join(bundledData, 'connectors');
  const dstConn = path.join(efsBase, 'connectors');
  if (!fs.existsSync(dstConn) && fs.existsSync(srcConn)) {
    fs.mkdirSync(dstConn, { recursive: true });
    for (const file of fs.readdirSync(srcConn)) {
      fs.copyFileSync(path.join(srcConn, file), path.join(dstConn, file));
    }
    console.log('[efs-seed] connectors/ seeded from bundled image copy');
  }
}

try {
  ensureEfsDatabases();
} catch (err: any) {
  console.warn('[server] ensureEfsDatabases failed (non-fatal):', err?.message);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(logger);

// ── Forwarded-auth hook (noetroniq portal mode) ───────────────────────────────
// When NOETRONIQ_FORWARDED_AUTH=1 the auth-check Lambda@Edge has already
// validated the Cognito JWT and injected x-noetroniq-* identity headers into
// every request.  Trust those headers to establish user identity; do not start
// a separate session or JWT flow.  Fail closed (401) if the header is absent.
if (process.env['NOETRONIQ_FORWARDED_AUTH'] === '1') {
  app.use((req: Request, res: Response, next) => {
    // Health endpoint is exempt — it must respond without requiring identity
    // context (used by ALB health checks and the deploy smoke-test).
    // All other paths — including / and /assets/* — are auth-gated at
    // Lambda@Edge before reaching this handler, so x-noetroniq-email is
    // always present for legitimate traffic.
    if (req.path === '/health') return next();

    const email = req.headers['x-noetroniq-email'];
    if (!email || typeof email !== 'string') {
      res.status(401).json({ error: 'Missing identity header' });
      return;
    }

    // Attach identity to response locals for downstream route handlers.
    res.locals['noetroniqEmail'] = email;
    res.locals['noetroniqName']  = req.headers['x-noetroniq-name'] ?? email;
    next();
  });
}

// Health check — performs a minimal DB liveness check on the registry database
// before returning 200 so a failed EFS mount returns 503 instead of 200.
// This prevents the smoke test from passing when EFS is not mounted.
app.get('/health', (req: Request, res: Response) => {
  try {
    const db = new Database(REGISTRY_DB_PATH, { readonly: true });
    db.prepare('SELECT 1').get();
    db.close();
  } catch (err) {
    console.error('[health] db liveness check failed:', err);
    return res.status(503).json({ status: 'error', detail: 'db unavailable' });
  }
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/user', userRoutes);  // User Portal (public lookup)
app.use('/api/hr', hrRoutes);  // HR Portal (HR System authoritative source)
app.use('/api/ldap', ldapRoutes);  // LDAP Portal (LDAP/AD authoritative source)
app.use('/api/engineering', engineeringRoutes);  // Engineering Department Portal
app.use('/api/finance', financeRoutes);  // Finance Department Portal
app.use('/api/gcuid', adminRoutes);  // GCUID Portal (central coordination)
app.use('/api/caes', caesRoutes);  // CAES Portal (Common Attribute Exchange Service)
app.use('/api/flags', flagsRoutes);  // PoC Feature Flags
app.use('/api/log-levels', logLevelsRoutes);  // Runtime log level settings
app.use('/api/logs', logsRoutes);             // Log viewer (read-only)
app.use('/api/connectors', connectorsRoutes);  // Connector configurations
app.use('/api/system', systemDashboardRoutes); // System dashboard & log management
app.use('/api/bulk', bulkRoutes);              // Bulk import & export
app.use('/api/hooks', hooksRoutes);            // Event-driven hooks (subscribe / poll / verify)
app.use('/api/gcuid-request', gcuidRequestRoutes);  // Portal GCUID request (preview + submit)
app.use('/api/tools', toolsRoutes);                 // System tools (GCUID purge, etc.)
app.use('/api/ux-config', uxConfigRoutes);          // UX appearance configuration
app.use('/api/policies', policiesRoutes);           // Application access policies

// ── Static web UI (React SPA) ─────────────────────────────────────────────────
// Serve the pre-built React SPA from web-ui-dist/ (staged by deploy_gcuid_app.py
// before docker build).  This block MUST come after all /api/* route registrations
// so API paths take precedence over the static-file middleware.
//
// In local dev (tsx api/server.ts without a prior build) web-ui-dist/ does not
// exist; the block is skipped and developers run the web UI separately via
// `npm run start-web` (Vite dev server on :5181, proxies /api → :5182).
const WEB_UI_DIST = path.resolve(__dirname, '..', '..', 'web-ui-dist');

if (fs.existsSync(WEB_UI_DIST)) {
  // Serve JS/CSS bundles, images, fonts from the Vite build output.
  app.use(express.static(WEB_UI_DIST));

  // SPA fallback: any path not matched by /api/* routes or static assets
  // serves index.html so React Router can handle client-side navigation.
  // This MUST be registered after express.static so actual asset files are
  // served directly rather than falling through to index.html.
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(WEB_UI_DIST, 'index.html'));
  });
}

// Error handling (must be last)
app.use(errorHandler);

// ─── Graceful shutdown ─────────────────────────────────────────────────────────────

function onShutdown(signal: string) {
  logSystem('notice', SYSTEM_EVENTS.SERVER_STOPPING, {
    component: 'middleware:logger',
    context: JSON.stringify({ service_name: 'gcuid-api', signal }),
  });
  const duration_ms = Date.now() - SERVER_START_TIME;
  logSystem('notice', SYSTEM_EVENTS.SERVER_STOPPED, {
    component: 'middleware:logger',
    duration_ms,
    context: JSON.stringify({ service_name: 'gcuid-api' }),
  });
  process.exit(0);
}

// ─── Standalone entrypoint — skip when imported as a module (e.g. by Lambda handler) ──

const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1]?.endsWith('server.ts') ||
                     process.argv[1]?.endsWith('server.js') ||
                     process.argv[1] === __filename;

if (isMainModule) {
// Start server
app.listen(PORT, () => {
  // ── Seed CAES attribute_mappings from connector JSON configs ──────────────
  // Any connector whose JSON declares attributeMappings is registered into CAES
  // on startup.  This is idempotent: existing rows are updated structurally;
  // CAES-curated fields (operations, self_service, transformations) are kept.
  try {
    const connectors = listConfigs().filter(c => c.enabled);
    let totalInserted = 0;
    let totalUpdated  = 0;
    for (const c of connectors) {
      const r = upsertConnectorMappings(
        c.systemId,
        c.sourceConnection,
        c.systemType === 'authoritative_source',
        c.gcuidIntegration.attributeMappings,
      );
      totalInserted += r.inserted;
      totalUpdated  += r.updated;
    }
    if (connectors.length > 0) {
      console.log(`🔗 Connector mappings seeded: ${connectors.length} connectors, ${totalInserted} inserted, ${totalUpdated} updated`);
    }
  } catch (err) {
    console.warn('⚠️  Could not seed connector mappings:', (err as Error).message);
  }

  logSystem('notice', SYSTEM_EVENTS.SERVER_STARTED, {
    component: 'middleware:logger',
    context: JSON.stringify({ service_name: 'gcuid-api', service_version: '1.0.0', host: '0.0.0.0', port: PORT }),
  });
  logSystem('notice', SYSTEM_EVENTS.SERVER_READY, {
    component: 'middleware:logger',
    context: JSON.stringify({ service_name: 'gcuid-api', host: '0.0.0.0', port: PORT }),
  });

  console.log(`🚀 GCUID Staging API Server`);
  console.log(`📡 Listening on port ${PORT}`);
  console.log(`🔗 http://localhost:${PORT}`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('Federal Architecture Endpoints:');
  console.log('  User Portal:         /api/user/*');
  console.log('  HR System:           /api/hr/* (Authoritative Source)');
  console.log('  LDAP/AD:             /api/ldap/* (Authoritative Source)');
  console.log('  Engineering Dept:    /api/engineering/*');
  console.log('  Finance Dept:        /api/finance/*');
  console.log('  GCUID Portal:        /api/gcuid/*');
  console.log('  CAES:                /api/caes/* (Attribute Exchange)');
});

process.on('SIGTERM', () => onShutdown('SIGTERM'));
process.on('SIGINT',  () => onShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logSystem('emergency', SYSTEM_EVENTS.SERVER_CRASH, {
    component:    'middleware:logger',
    error_code:   err.name,
    error_detail: err.stack ?? err.message,
    context:      JSON.stringify({ service_name: 'gcuid-api' }),
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logSystem('emergency', SYSTEM_EVENTS.SERVER_CRASH, {
    component:    'middleware:logger',
    error_code:   'UnhandledRejection',
    error_detail: String(reason),
    context:      JSON.stringify({ service_name: 'gcuid-api' }),
  });
  process.exit(1);
});
} // end isMainModule

export default app;
