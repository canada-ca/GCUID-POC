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
declare const logger: winston.Logger;
export interface LogMetadata {
    [key: string]: any;
}
/**
 * Log an error with optional metadata
 */
export declare function logError(message: string, meta?: LogMetadata): void;
/**
 * Log a warning with optional metadata
 */
export declare function logWarn(message: string, meta?: LogMetadata): void;
/**
 * Log an info message with optional metadata
 */
export declare function logInfo(message: string, meta?: LogMetadata): void;
/**
 * Log a debug message with optional metadata
 */
export declare function logDebug(message: string, meta?: LogMetadata): void;
/**
 * Log an HTTP request/response
 */
export declare function logHttp(message: string, meta?: LogMetadata): void;
/**
 * Log verbose information
 */
export declare function logVerbose(message: string, meta?: LogMetadata): void;
/**
 * Create a child logger with additional context
 */
export declare function createChildLogger(context: LogMetadata): winston.Logger;
/**
 * Set the logging level dynamically
 */
export declare function setLogLevel(level: string): void;
/**
 * Get the current logging level
 */
export declare function getLogLevel(): string;
export { logger };
export default logger;
//# sourceMappingURL=logger.d.ts.map