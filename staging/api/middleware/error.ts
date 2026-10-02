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
 * Global error-handling middleware.
 *
 * Mounts as the last `app.use(...)` in the chain (after all routes).
 * Catches every error thrown from upstream middleware or route handlers,
 * classifies it (4xx vs 5xx), emits a structured system log event, and
 * responds with a JSON envelope:
 *
 * ```json
 * {
 *   "error": {
 *     "message":    "string",
 *     "statusCode": 400,
 *     "timestamp":  "2026-09-23T12:00:00.000Z",
 *     "path":       "/api/...",
 *     "details":    { ... }   // optional, present if the error carries details
 *   }
 * }
 * ```
 *
 * Use {@link createError} in route handlers to throw an `ApiError`
 * with a specific HTTP status code and optional `details` payload.
 */

import { Request, Response, NextFunction } from 'express';
import { logSystem } from '../lib/logging/logger.js';
import { SYSTEM_EVENTS } from '../lib/logging/log-events.js';

/**
 * Error shape consumed by the global error handler.
 *
 * Throw one of these from a route handler (typically via
 * {@link createError}) to control the HTTP status code and the
 * `details` field of the JSON error response.
 */
export interface ApiError extends Error {
  /** HTTP status code; defaults to 500 if omitted. */
  statusCode?: number;
  /** Optional structured details (e.g. validation errors) returned to the client. */
  details?: any;
}

/**
 * Express error-handling middleware.
 *
 * Reads `err.statusCode` (defaults to 500), emits a system log event
 * (`HTTP_4XX` at info / `HTTP_5XX` at error), and writes a JSON error
 * envelope to the response.
 *
 * @param err    Error thrown from upstream middleware/route.
 * @param req    Inbound Express request.
 * @param res    Outbound Express response.
 * @param next   Next middleware (unused; required by Express signature).
 */
export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  const requestId = (req as any).requestId as string | undefined;
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
             ?? req.socket?.remoteAddress;

  if (statusCode >= 500) {
    logSystem('error', SYSTEM_EVENTS.HTTP_5XX, {
      component:    'middleware:logger',
      request_id:   requestId,
      ip_address:   ip,
      error_detail: message,
      context:      JSON.stringify({ method: req.method, path: req.path, status: statusCode }),
    });
  } else if (statusCode >= 400) {
    logSystem('info', SYSTEM_EVENTS.HTTP_4XX, {
      component:  'middleware:logger',
      request_id: requestId,
      ip_address: ip,
      error_detail: message,
      context:    JSON.stringify({ method: req.method, path: req.path, status: statusCode }),
    });
  }

  res.status(statusCode).json({
    error: {
      message,
      statusCode,
      timestamp: new Date().toISOString(),
      path: req.url,
      details: err.details
    }
  });
}

/**
 * Construct an `ApiError` from a message and HTTP status code.
 *
 * Idiomatic use inside route handlers:
 *
 * ```ts
 * throw createError('Record not found', 404);
 * throw createError('Validation failed', 400, { field: 'gcuid', reason: 'malformed' });
 * ```
 *
 * @param message     Human-readable error message (returned to client and logged).
 * @param statusCode  HTTP status code; defaults to 400.
 * @param details     Optional structured details returned to the client.
 * @returns The constructed error; ready to `throw`.
 */
export function createError(message: string, statusCode: number = 400, details?: any): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}
