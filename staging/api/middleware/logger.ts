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
 * Request logging middleware
 *
 * Attaches a unique request_id to every request so that downstream route
 * handlers can reference it in their own log calls.  Emits structured log
 * events to log_system via logSystem() for every inbound request and outbound
 * response, including 4xx/5xx classification and slow-request detection.
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logSystem } from '../lib/logging/logger.js';
import { SYSTEM_EVENTS } from '../lib/logging/log-events.js';

// Extend Express Request so downstream code can read req.requestId
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

// Slow-request threshold (ms) — hard-coded fallback; logger.ts reads the
// same value from levels.json but we keep this middleware self-contained.
const SLOW_REQUEST_MS = 2_000;

/**
 * Express middleware that logs every inbound HTTP request and its
 * corresponding response.
 *
 * Behaviour:
 * - Generates a UUIDv4 request id, attaches it to `req.requestId` so
 *   downstream route handlers and the error middleware can reference
 *   it in their own log calls.
 * - Emits an `HTTP_REQUEST` event at debug level when the request is
 *   received.
 * - On response `finish`, emits `HTTP_RESPONSE` (debug) plus one of
 *   `HTTP_4XX` (info), `HTTP_5XX` (error), or `HTTP_SLOW_REQUEST`
 *   (warning) when the corresponding condition fires.
 * - Honours `X-Forwarded-For` for client IP, falling back to the
 *   socket's remote address.
 *
 * Must be mounted before the routes it should observe but after any
 * middleware that sets the response object (e.g. body parsers).
 *
 * @param req   Inbound request (mutated: `req.requestId` is set).
 * @param res   Outbound response.
 * @param next  Next middleware in the chain.
 */
export function logger(req: Request, res: Response, next: NextFunction): void {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  const t0 = Date.now();
  const method = req.method;
  const path   = req.path;
  const ip     = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
                 ?? req.socket.remoteAddress;

  // Emit HTTP_REQUEST at debug level
  logSystem('debug', SYSTEM_EVENTS.HTTP_REQUEST, {
    component:  'middleware:logger',
    request_id: requestId,
    ip_address: ip,
    user_agent: req.headers['user-agent'],
    context:    JSON.stringify({ method, path }),
  });

  res.on('finish', () => {
    const duration_ms = Date.now() - t0;
    const status      = res.statusCode;

    // Always emit response summary
    logSystem('debug', SYSTEM_EVENTS.HTTP_RESPONSE, {
      component:  'middleware:logger',
      request_id: requestId,
      duration_ms,
      context:    JSON.stringify({ method, path, status }),
    });

    // 4xx
    if (status >= 400 && status < 500) {
      logSystem('info', SYSTEM_EVENTS.HTTP_4XX, {
        component:  'middleware:logger',
        request_id: requestId,
        ip_address: ip,
        context:    JSON.stringify({ method, path, status }),
      });
    }

    // 5xx
    if (status >= 500) {
      logSystem('error', SYSTEM_EVENTS.HTTP_5XX, {
        component:  'middleware:logger',
        request_id: requestId,
        context:    JSON.stringify({ method, path, status }),
      });
    }

    // Slow request
    if (duration_ms > SLOW_REQUEST_MS) {
      logSystem('warning', SYSTEM_EVENTS.HTTP_SLOW_REQUEST, {
        component:  'middleware:logger',
        request_id: requestId,
        duration_ms,
        context:    JSON.stringify({ method, path, status }),
      });
    }
  });

  next();
}
