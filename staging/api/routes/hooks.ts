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
/**
 * Hooks API Routes — Event-Driven Architecture (7.6)
 *
 * 7.6.1  POST   /api/hooks/subscriptions        — Register for event notices
 * 7.6.1  GET    /api/hooks/subscriptions        — List subscriptions (optionally filter by subscriber_id)
 * 7.6.1  GET    /api/hooks/subscriptions/:id    — Get single subscription
 * 7.6.1  PATCH  /api/hooks/subscriptions/:id    — Update subscription (events / callback_url / status)
 * 7.6.1  DELETE /api/hooks/subscriptions/:id    — Unsubscribe / revoke
 * 7.6.2  GET    /api/hooks/events               — Pull event list for downstream polling
 * 7.6.3  POST   /api/hooks/verify               — Verify webhook / JWT / SAML signature
 */

import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { createError } from '../middleware/error.js';
import { logRegistry } from '../lib/logging/logger.js';
import { REGISTRY_EVENTS } from '../lib/logging/log-events.js';

import { REGISTRY_DB_PATH as REGISTRY_DB } from '../lib/db-paths.js';

const router = Router();

// ─── Supported event types ────────────────────────────────────────────────────

const VALID_EVENT_TYPES = new Set([
  'identity.created',
  'identity.activated',
  'identity.suspended',
  'identity.retired',
  'identity.archived',
  'identity.rehired',
  'identity.flagged',
  'identifier.issued',
  'identifier.nullified',
  'identifier.tombstoned',
  'identifier.superseded',
  'alias.created',
  'alias.removed',
  'mapping.created',
  'mapping.removed',
  '*',                 // wildcard — receive all events
]);

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

function ensureSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hook_subscriptions (
      id            TEXT    PRIMARY KEY,
      subscriber_id TEXT    NOT NULL,
      callback_url  TEXT    NOT NULL,
      events        TEXT    NOT NULL,
      secret        TEXT,
      status        TEXT    NOT NULL DEFAULT 'active',
      created_at    TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hook_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id   TEXT    NOT NULL UNIQUE,
      event_type TEXT    NOT NULL,
      gcuid      TEXT,
      payload    TEXT    NOT NULL,
      emitted_at TEXT    NOT NULL,
      sequence   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hook_events_type     ON hook_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_hook_events_emitted  ON hook_events(emitted_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_gcuid    ON hook_events(gcuid);
    CREATE INDEX IF NOT EXISTS idx_hook_subscriptions_sub ON hook_subscriptions(subscriber_id);
  `);
}

// ─── state_history → event_type mapping ──────────────────────────────────────

function transitionToEventType(transition: string, source: 'identity' | 'identifier'): string | null {
  if (source === 'identity') {
    const map: Record<string, string> = {
      register:        'identity.created',
      import:          'identity.created',
      approve:         'identity.activated',
      activate:        'identity.activated',
      suspend:         'identity.suspended',
      retire:          'identity.retired',
      archive:         'identity.archived',
      rehire:          'identity.rehired',
      'flag-review':   'identity.flagged',
      'flag_review':   'identity.flagged',
      merge:           'identity.retired',
      mapping_added:   'mapping.created',
      mapping_removed: 'mapping.removed',
      alias_created:   'alias.created',
      alias_removed:   'alias.removed',
    };
    return map[transition] ?? null;
  } else {
    const map: Record<string, string> = {
      issue:    'identifier.issued',
      bind:     'identifier.issued',
      nullify:  'identifier.nullified',
      supersede:'identifier.superseded',
      retire:   'identifier.tombstoned',
      merge:    'identifier.tombstoned',
    };
    return map[transition] ?? null;
  }
}

// ─── 7.6.1  POST /api/hooks/subscriptions — Register ─────────────────────────

router.post('/subscriptions', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subscriber_id, callback_url, events, secret } = req.body ?? {};

    if (!subscriber_id || typeof subscriber_id !== 'string') {
      return next(createError(400, 'subscriber_id is required'));
    }
    if (!callback_url || typeof callback_url !== 'string') {
      return next(createError(400, 'callback_url is required'));
    }
    if (!Array.isArray(events) || events.length === 0) {
      return next(createError(400, 'events must be a non-empty array of event type strings'));
    }

    // Validate each event type
    const invalid = events.filter((e: unknown) => typeof e !== 'string' || !VALID_EVENT_TYPES.has(e));
    if (invalid.length > 0) {
      return next(createError(400, `Unknown event type(s): ${invalid.join(', ')}. Valid: ${[...VALID_EVENT_TYPES].join(', ')}`));
    }

    // Validate callback_url structure (must be http/https)
    try {
      const url = new URL(callback_url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return next(createError(400, 'callback_url must use http or https'));
      }
    } catch {
      return next(createError(400, 'callback_url is not a valid URL'));
    }

    const db = new Database(REGISTRY_DB);
    ensureSchema(db);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO hook_subscriptions (id, subscriber_id, callback_url, events, secret, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, subscriber_id, callback_url, JSON.stringify(events), secret ?? null, now, now);

    db.close();

    logRegistry(REGISTRY_EVENTS.ADMIN_ACTION, {
      action: 'hook.subscribe', subscription_id: id, subscriber_id, events,
    });

    return res.status(201).json({
      subscription_id: id,
      subscriber_id,
      callback_url,
      events,
      status: 'active',
      has_secret: !!secret,
      created_at: now,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── 7.6.1  GET /api/hooks/subscriptions — List ──────────────────────────────

router.get('/subscriptions', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subscriber_id, status } = req.query as Record<string, string>;

    const db = new Database(REGISTRY_DB, { readonly: true });
    ensureSchema(db as unknown as InstanceType<typeof Database>);

    let sql = 'SELECT id, subscriber_id, callback_url, events, status, created_at, updated_at FROM hook_subscriptions WHERE 1=1';
    const params: string[] = [];
    if (subscriber_id) { sql += ' AND subscriber_id = ?'; params.push(subscriber_id); }
    if (status)        { sql += ' AND status = ?';        params.push(status); }
    sql += ' ORDER BY created_at DESC';

    const rows = db.prepare(sql).all(...params) as Array<{
      id: string; subscriber_id: string; callback_url: string;
      events: string; status: string; created_at: string; updated_at: string;
    }>;
    db.close();

    return res.json({
      subscriptions: rows.map(r => ({ ...r, events: JSON.parse(r.events) })),
      count: rows.length,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── 7.6.1  GET /api/hooks/subscriptions/:id — Get one ───────────────────────

router.get('/subscriptions/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = new Database(REGISTRY_DB, { readonly: true });
    ensureSchema(db as unknown as InstanceType<typeof Database>);

    const row = db.prepare(
      'SELECT id, subscriber_id, callback_url, events, status, created_at, updated_at FROM hook_subscriptions WHERE id = ?'
    ).get(req.params.id) as { id: string; subscriber_id: string; callback_url: string; events: string; status: string; created_at: string; updated_at: string; } | undefined;
    db.close();

    if (!row) return next(createError(404, 'Subscription not found'));

    return res.json({ ...row, events: JSON.parse(row.events) });
  } catch (err) {
    return next(err);
  }
});

// ─── 7.6.1  PATCH /api/hooks/subscriptions/:id — Update ─────────────────────

router.patch('/subscriptions/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { callback_url, events, status, secret } = req.body ?? {};

    const db = new Database(REGISTRY_DB);
    ensureSchema(db);

    const existing = db.prepare(
      'SELECT id, events FROM hook_subscriptions WHERE id = ?'
    ).get(req.params.id) as { id: string; events: string } | undefined;

    if (!existing) { db.close(); return next(createError(404, 'Subscription not found')); }

    if (callback_url !== undefined) {
      try {
        const url = new URL(callback_url);
        if (!['http:', 'https:'].includes(url.protocol)) {
          db.close(); return next(createError(400, 'callback_url must use http or https'));
        }
      } catch {
        db.close(); return next(createError(400, 'callback_url is not a valid URL'));
      }
    }

    if (events !== undefined) {
      if (!Array.isArray(events) || events.length === 0) {
        db.close(); return next(createError(400, 'events must be a non-empty array'));
      }
      const invalid = events.filter((e: unknown) => typeof e !== 'string' || !VALID_EVENT_TYPES.has(e));
      if (invalid.length > 0) {
        db.close(); return next(createError(400, `Unknown event type(s): ${invalid.join(', ')}`));
      }
    }

    if (status !== undefined && !['active', 'paused', 'revoked'].includes(status)) {
      db.close(); return next(createError(400, 'status must be active, paused, or revoked'));
    }

    const now = new Date().toISOString();
    const setParts: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (callback_url !== undefined) { setParts.push('callback_url = ?'); values.push(callback_url); }
    if (events     !== undefined) { setParts.push('events = ?');       values.push(JSON.stringify(events)); }
    if (status     !== undefined) { setParts.push('status = ?');       values.push(status); }
    if (secret     !== undefined) { setParts.push('secret = ?');       values.push(secret || null); }

    values.push(req.params.id);
    db.prepare(`UPDATE hook_subscriptions SET ${setParts.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare(
      'SELECT id, subscriber_id, callback_url, events, status, created_at, updated_at FROM hook_subscriptions WHERE id = ?'
    ).get(req.params.id) as { id: string; subscriber_id: string; callback_url: string; events: string; status: string; created_at: string; updated_at: string; };
    db.close();

    return res.json({ ...updated, events: JSON.parse(updated.events) });
  } catch (err) {
    return next(err);
  }
});

// ─── 7.6.1  DELETE /api/hooks/subscriptions/:id — Unsubscribe ────────────────

router.delete('/subscriptions/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = new Database(REGISTRY_DB);
    ensureSchema(db);

    const existing = db.prepare(
      'SELECT id, subscriber_id FROM hook_subscriptions WHERE id = ?'
    ).get(req.params.id) as { id: string; subscriber_id: string } | undefined;

    if (!existing) { db.close(); return next(createError(404, 'Subscription not found')); }

    db.prepare('DELETE FROM hook_subscriptions WHERE id = ?').run(req.params.id);
    db.close();

    logRegistry(REGISTRY_EVENTS.ADMIN_ACTION, {
      action: 'hook.unsubscribe', subscription_id: req.params.id,
      subscriber_id: existing.subscriber_id,
    });

    return res.json({
      deleted: true,
      subscription_id: req.params.id,
      subscriber_id: existing.subscriber_id,
      revoked_at: new Date().toISOString(),
    });
  } catch (err) {
    return next(err);
  }
});

// ─── 7.6.2  GET /api/hooks/events — Pull event list (polling) ────────────────

router.get('/events', (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      since,
      until,
      gcuid: filterGcuid,
      event_type: filterType,
      after_id,
      limit: limitStr,
    } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitStr ?? '100', 10) || 100, 1000);

    const db = new Database(REGISTRY_DB, { readonly: true });
    ensureSchema(db as unknown as InstanceType<typeof Database>);

    // ── Derive events from state_history (identity events) ──────────────────
    interface RawHistoryRow {
      id: number;
      gcuid: string;
      from_state: string | null;
      to_state: string;
      transition_type: string;
      reason: string | null;
      changed_by: string | null;
      changed_at: string;
    }

    let identSql = `SELECT id, gcuid, from_state, to_state, transition_type, reason, changed_by, changed_at
                    FROM state_history WHERE 1=1`;
    const identParams: unknown[] = [];

    if (since)       { identSql += ' AND changed_at >= ?'; identParams.push(since); }
    if (until)       { identSql += ' AND changed_at <= ?'; identParams.push(until); }
    if (filterGcuid) { identSql += ' AND gcuid = ?';       identParams.push(filterGcuid); }
    if (after_id)    { identSql += ' AND id > ?';          identParams.push(parseInt(after_id, 10)); }

    let identRows: RawHistoryRow[] = [];
    try {
      identRows = db.prepare(identSql).all(...identParams) as RawHistoryRow[];
    } catch {
      // state_history may not exist in all environments
    }

    // ── Derive events from identifier_state_history ──────────────────────────
    interface RawIdStateRow {
      id: number;
      gcuid: string;
      from_state: string | null;
      to_state: string;
      transition: string;
      reason: string | null;
      changed_at: string;
    }

    let idStateSql = `SELECT id, gcuid, from_state, to_state, transition, reason, changed_at
                      FROM identifier_state_history WHERE 1=1`;
    const idStateParams: unknown[] = [];

    if (since)       { idStateSql += ' AND changed_at >= ?'; idStateParams.push(since); }
    if (until)       { idStateSql += ' AND changed_at <= ?'; idStateParams.push(until); }
    if (filterGcuid) { idStateSql += ' AND gcuid = ?';       idStateParams.push(filterGcuid); }

    let idStateRows: RawIdStateRow[] = [];
    try {
      idStateRows = db.prepare(idStateSql).all(...idStateParams) as RawIdStateRow[];
    } catch {
      // table may not exist yet
    }

    db.close();

    // ── Map to unified event objects ─────────────────────────────────────────
    interface HookEvent {
      event_id: string;
      event_type: string;
      source: 'identity' | 'identifier';
      gcuid: string;
      payload: Record<string, unknown>;
      emitted_at: string;
      cursor: string;
    }

    const events: HookEvent[] = [];

    for (const row of identRows) {
      const eventType = transitionToEventType(row.transition_type, 'identity');
      if (!eventType) continue;
      if (filterType && filterType !== eventType && filterType !== '*') continue;

      events.push({
        event_id:   `ident-${row.id}`,
        event_type: eventType,
        source:     'identity',
        gcuid:      row.gcuid,
        payload: {
          from_state:      row.from_state,
          to_state:        row.to_state,
          transition_type: row.transition_type,
          reason:          row.reason,
          changed_by:      row.changed_by,
        },
        emitted_at: row.changed_at,
        cursor:     `ident-${row.id}`,
      });
    }

    for (const row of idStateRows) {
      const eventType = transitionToEventType(row.transition, 'identifier');
      if (!eventType) continue;
      if (filterType && filterType !== eventType && filterType !== '*') continue;

      events.push({
        event_id:   `idstate-${row.id}`,
        event_type: eventType,
        source:     'identifier',
        gcuid:      row.gcuid,
        payload: {
          from_state: row.from_state,
          to_state:   row.to_state,
          transition: row.transition,
          reason:     row.reason,
        },
        emitted_at: row.changed_at,
        cursor:     `idstate-${row.id}`,
      });
    }

    // Sort by emitted_at ascending (oldest first — consumers advance a cursor forward)
    events.sort((a, b) => a.emitted_at.localeCompare(b.emitted_at));

    const page = events.slice(0, limit);
    const lastCursor = page.length > 0 ? page[page.length - 1].cursor : (after_id ?? null);

    return res.json({
      events: page,
      count:    page.length,
      has_more: events.length > limit,
      cursor:   lastCursor,
      filters: {
        since:      since ?? null,
        until:      until ?? null,
        gcuid:      filterGcuid ?? null,
        event_type: filterType ?? null,
        after_id:   after_id ?? null,
        limit,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// ─── 7.6.3  POST /api/hooks/verify — Verify signatures ───────────────────────

router.post('/verify', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type } = req.body ?? {};

    if (!type || !['webhook', 'jwt', 'saml'].includes(type)) {
      return next(createError(400, "type must be 'webhook', 'jwt', or 'saml'"));
    }

    const verified_at = new Date().toISOString();

    // ── Webhook HMAC-SHA256 verification ─────────────────────────────────────
    if (type === 'webhook') {
      const { subscription_id, payload, signature, algorithm = 'sha256' } = req.body;

      if (!subscription_id) return next(createError(400, 'subscription_id required for webhook verification'));
      if (!payload)         return next(createError(400, 'payload required'));
      if (!signature)       return next(createError(400, 'signature required'));

      const db = new Database(REGISTRY_DB, { readonly: true });
      ensureSchema(db as unknown as InstanceType<typeof Database>);

      const sub = db.prepare('SELECT secret FROM hook_subscriptions WHERE id = ?').get(subscription_id) as
        { secret: string | null } | undefined;
      db.close();

      if (!sub) return next(createError(404, 'Subscription not found'));
      if (!sub.secret) {
        return res.json({ valid: false, verified_at, type, reason: 'Subscription has no secret configured' });
      }

      const supportedAlgorithms = ['sha256', 'sha512'];
      if (!supportedAlgorithms.includes(algorithm)) {
        return next(createError(400, `algorithm must be one of: ${supportedAlgorithms.join(', ')}`));
      }

      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expected = crypto.createHmac(algorithm, sub.secret).update(payloadStr).digest('hex');

      // Constant-time comparison to prevent timing attacks
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      const valid  = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

      return res.json({ valid, verified_at, type, algorithm });
    }

    // ── JWT structural verification ───────────────────────────────────────────
    if (type === 'jwt') {
      const { token, issuer: expectedIssuer, audience: expectedAudience } = req.body;

      if (!token || typeof token !== 'string') return next(createError(400, 'token required'));

      const parts = token.split('.');
      if (parts.length !== 3) {
        return res.json({ valid: false, verified_at, type, reason: 'Malformed JWT: expected 3 dot-separated segments' });
      }

      let header: Record<string, unknown>;
      let claims: Record<string, unknown>;

      try {
        header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      } catch {
        return res.json({ valid: false, verified_at, type, reason: 'Malformed JWT: cannot decode header/payload' });
      }

      const now = Math.floor(Date.now() / 1000);
      const errors: string[] = [];

      if (typeof claims.exp === 'number' && claims.exp < now) {
        errors.push(`Token expired at ${new Date(claims.exp * 1000).toISOString()}`);
      }
      if (typeof claims.nbf === 'number' && claims.nbf > now) {
        errors.push(`Token not valid before ${new Date(claims.nbf * 1000).toISOString()}`);
      }
      if (expectedIssuer && claims.iss !== expectedIssuer) {
        errors.push(`Issuer mismatch: expected "${expectedIssuer}", got "${claims.iss}"`);
      }
      if (expectedAudience) {
        const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (!aud.includes(expectedAudience)) {
          errors.push(`Audience mismatch: "${expectedAudience}" not in ${JSON.stringify(aud)}`);
        }
      }

      const valid = errors.length === 0;
      return res.json({
        valid,
        verified_at,
        type,
        algorithm: header.alg ?? null,
        note: 'Structural and claims validation only — cryptographic signature verification requires a public key. Provide the public key via JWKS or PEM if full verification is required.',
        claims: {
          sub:   claims.sub ?? null,
          iss:   claims.iss ?? null,
          aud:   claims.aud ?? null,
          exp:   claims.exp ?? null,
          iat:   claims.iat ?? null,
          jti:   claims.jti ?? null,
          scope: claims.scope ?? claims.scp ?? null,
        },
        ...(errors.length > 0 ? { errors } : {}),
      });
    }

    // ── SAML token structural verification ───────────────────────────────────
    if (type === 'saml') {
      const { token } = req.body;

      if (!token || typeof token !== 'string') return next(createError(400, 'token required'));

      let xml: string;
      try {
        xml = Buffer.from(token, 'base64').toString('utf8');
      } catch {
        return res.json({ valid: false, verified_at, type, reason: 'token must be a base64-encoded SAML assertion' });
      }

      const isSaml        = xml.includes('saml:Assertion') || xml.includes('samlp:Response') || xml.includes('urn:oasis:names:tc:SAML');
      const hasSig        = xml.includes('<ds:Signature') || xml.includes('<Signature');
      const notOnOrAfter  = xml.match(/NotOnOrAfter="([^"]+)"/)?.[1] ?? null;
      const issuer        = xml.match(/<saml:Issuer[^>]*>([^<]+)<\/saml:Issuer>/)?.[1] ??
                            xml.match(/<Issuer[^>]*>([^<]+)<\/Issuer>/)?.[1] ?? null;
      const nameId        = xml.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/)?.[1] ??
                            xml.match(/<NameID[^>]*>([^<]+)<\/NameID>/)?.[1] ?? null;

      if (!isSaml) {
        return res.json({ valid: false, verified_at, type, reason: 'Payload does not appear to be a SAML assertion or response' });
      }

      const errors: string[] = [];
      if (!hasSig) errors.push('No XML digital signature element found (ds:Signature)');
      if (notOnOrAfter && new Date(notOnOrAfter) < new Date()) {
        errors.push(`Assertion expired at ${notOnOrAfter}`);
      }

      return res.json({
        valid: errors.length === 0,
        verified_at,
        type,
        note: 'Structural validation only — cryptographic XML-DSig verification requires the IdP public key certificate.',
        has_signature: hasSig,
        claims: { issuer, name_id: nameId, not_on_or_after: notOnOrAfter },
        ...(errors.length > 0 ? { errors } : {}),
      });
    }

    return next(createError(400, 'Unknown type'));
  } catch (err) {
    return next(err);
  }
});

export { router as hooksRoutes };
