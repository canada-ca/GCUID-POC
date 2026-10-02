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
const formats = {
    simple: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
        if (Object.keys(meta).length > 0) {
            msg += ` ${JSON.stringify(meta)}`;
        }
        return msg;
    })),
    json: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json())
};
// Console format with colors
const consoleFormat = winston.format.combine(winston.format.timestamp({ format: 'HH:mm:ss' }), winston.format.errors({ stack: true }), config.logging.console.colorize
    ? winston.format.colorize()
    : winston.format.uncolorize(), winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length > 0 && meta.stack === undefined) {
        msg += ` ${JSON.stringify(meta)}`;
    }
    if (meta.stack) {
        msg += `\n${meta.stack}`;
    }
    return msg;
}));
// Build transports array
const transports = [];
// Add console transport if enabled
if (config.logging.console.enabled) {
    transports.push(new winston.transports.Console({
        format: consoleFormat
    }));
}
// Add file transport if enabled
if (config.logging.file.enabled) {
    transports.push(new winston.transports.File({
        filename: config.logging.file.path,
        format: formats[config.logging.format],
        maxsize: config.logging.file.maxSize,
        maxFiles: config.logging.file.maxFiles
    }));
}
// Create the logger instance
const logger = winston.createLogger({
    level: config.logging.level,
    format: formats[config.logging.format],
    transports,
    exitOnError: false
});
/**
 * Log an error with optional metadata
 */
export function logError(message, meta) {
    logger.error(message, meta);
}
/**
 * Log a warning with optional metadata
 */
export function logWarn(message, meta) {
    logger.warn(message, meta);
}
/**
 * Log an info message with optional metadata
 */
export function logInfo(message, meta) {
    logger.info(message, meta);
}
/**
 * Log a debug message with optional metadata
 */
export function logDebug(message, meta) {
    logger.debug(message, meta);
}
/**
 * Log an HTTP request/response
 */
export function logHttp(message, meta) {
    logger.http(message, meta);
}
/**
 * Log verbose information
 */
export function logVerbose(message, meta) {
    logger.verbose(message, meta);
}
/**
 * Create a child logger with additional context
 */
export function createChildLogger(context) {
    return logger.child(context);
}
/**
 * Set the logging level dynamically
 */
export function setLogLevel(level) {
    logger.level = level;
}
/**
 * Get the current logging level
 */
export function getLogLevel() {
    return logger.level;
}
// Export the winston logger instance for advanced usage
export { logger };
// Export default logger
export default logger;
//# sourceMappingURL=logger.js.map