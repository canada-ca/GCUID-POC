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
 * Configuration management using convict
 * Provides typed configuration with validation and defaults
 */
declare const config: any;
export interface Config {
    logging: {
        level: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';
        file: {
            enabled: boolean;
            path: string;
            maxSize: number;
            maxFiles: number;
        };
        console: {
            enabled: boolean;
            colorize: boolean;
        };
        format: 'json' | 'simple';
    };
    database: {
        path: string;
        verbose: boolean;
    };
    gcuid: {
        defaultNamespace: string;
        defaultVersion: number;
        defaultCoreType: 'ulid' | 'uuid';
    };
    cli: {
        styles: {
            headColor: string;
            boxWidth: number;
            listLimit: number;
        };
        messages: {
            mintSuccess: string;
            registrationSuccess: string;
            notFound: string;
            alreadyExists: string;
            invalidGcuid: string;
            validGcuid: string;
        };
        tableHeaders: {
            keyValue: [string, string];
            component: [string, string];
            property: [string, string];
            attribute: [string, string];
            entityTypes: [string];
            registryList: [string, string, string];
            stats: [string, string];
            history: [string, string, string, string, string];
        };
        columnWidths: {
            registryList: [number, number, number];
            history: [number, number, number, number, number];
        };
    };
    entities: {
        defaultTypes: string[];
    };
}
export declare function getConfig(): Config;
export declare function getDbPath(): string;
export default config;
//# sourceMappingURL=config.d.ts.map