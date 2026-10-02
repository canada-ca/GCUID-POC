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
 * Logging configuration using Winston
 * Provides configurable, structured logging for GCUID
 */

import winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from './config';

// Load configuration
const config = getConfig();

// Ensure log directory exists if file logging is enabled
if (config.logging.file.enabled) {
  const logDir = path.dirname(config.logging.file.path);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// Define log formats
const formats: { [key: string]: winston.Logform.Format } = {
  simple: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
      if (Object.keys(meta).length > 0) {
        msg += ` ${JSON.stringify(meta)}`;
      }
      return msg;
    })
  ),
  json: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  )
};

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  config.logging.console.colorize 
    ? winston.format.colorize()
    : winston.format.uncolorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length > 0 && meta.stack === undefined) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    if (meta.stack) {
      msg += `\n${meta.stack}`;
    }
    return msg;
  })
);

// Build transports array
const transports: winston.transport[] = [];

// Add console transport if enabled
if (config.logging.console.enabled) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat
    })
  );
}

// Add file transport if enabled
if (config.logging.file.enabled) {
  transports.push(
    new winston.transports.File({
      filename: config.logging.file.path,
      format: formats[config.logging.format],
      maxsize: config.logging.file.maxSize,
      maxFiles: config.logging.file.maxFiles
    })
  );
}

// Create the logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: formats[config.logging.format],
  transports,
  exitOnError: false
});

// Add helper methods for structured logging

/**
 * Arbitrary key/value metadata attached to a log line.
 *
 * Each entry becomes a top-level field on the structured log record
 * (`simple` format prints it as JSON; `json` format emits it natively).
 */
export interface LogMetadata {
  [key: string]: any;
}

/**
 * Log an error message with optional structured metadata.
 * @param message Human-readable description of the failure.
 * @param meta Optional structured fields (request id, user id, etc.).
 */
export function logError(message: string, meta?: LogMetadata): void {
  logger.error(message, meta);
}

/**
 * Log a warning message with optional structured metadata.
 * @param message Human-readable description of the unexpected state.
 * @param meta Optional structured fields.
 */
export function logWarn(message: string, meta?: LogMetadata): void {
  logger.warn(message, meta);
}

/**
 * Log an informational message with optional structured metadata.
 * @param message Human-readable description of the event.
 * @param meta Optional structured fields.
 */
export function logInfo(message: string, meta?: LogMetadata): void {
  logger.info(message, meta);
}

/**
 * Log a debug-level message with optional structured metadata.
 * Only emitted when the configured log level includes `debug`.
 * @param message Human-readable description of the diagnostic event.
 * @param meta Optional structured fields.
 */
export function logDebug(message: string, meta?: LogMetadata): void {
  logger.debug(message, meta);
}

/**
 * Log an HTTP request/response at the `http` level.
 * @param message Short description (method + path).
 * @param meta Optional structured fields (status code, duration, request id).
 */
export function logHttp(message: string, meta?: LogMetadata): void {
  logger.http(message, meta);
}

/**
 * Log a verbose-level message with optional structured metadata.
 * Only emitted when the configured log level includes `verbose`.
 * @param message Human-readable description.
 * @param meta Optional structured fields.
 */
export function logVerbose(message: string, meta?: LogMetadata): void {
  logger.verbose(message, meta);
}

/**
 * Create a child winston logger that automatically attaches the given
 * context fields to every subsequent log call.
 *
 * @param context Default fields for the child logger (e.g. `{ source: 'conn-hr' }`).
 * @returns A winston `Logger` whose records inherit `context`.
 */
export function createChildLogger(context: LogMetadata): winston.Logger {
  return logger.child(context);
}

/**
 * Set the logging level dynamically at runtime.
 *
 * Accepts any standard winston/NPM level name (`error`, `warn`, `info`,
 * `http`, `verbose`, `debug`, `silly`). Invalid levels are silently
 * ignored by winston.
 *
 * @param level New level name.
 */
export function setLogLevel(level: string): void {
  logger.level = level;
}

/**
 * Return the currently configured log level name.
 * @returns Current level (e.g. `info`, `debug`).
 */
export function getLogLevel(): string {
  return logger.level;
}

// Export the winston logger instance for advanced usage
export { logger };

// Export default logger
export default logger;
