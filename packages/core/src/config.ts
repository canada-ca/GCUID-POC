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

import * as path from 'path';
const convict = require('convict');

// Define the configuration schema
const configSchema = {
  // Logging configuration
  logging: {
    level: {
      doc: 'Logging level (error, warn, info, http, verbose, debug, silly)',
      format: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
      default: 'info',
      env: 'GCUID_LOG_LEVEL'
    },
    file: {
      enabled: {
        doc: 'Enable logging to file',
        format: Boolean,
        default: false,
        env: 'GCUID_LOG_FILE_ENABLED'
      },
      path: {
        doc: 'Path to log file',
        format: String,
        default: './logs/gcuid.log',
        env: 'GCUID_LOG_FILE_PATH'
      },
      maxSize: {
        doc: 'Maximum size of log file in bytes (0 = no limit)',
        format: 'int',
        default: 5242880, // 5MB
        env: 'GCUID_LOG_FILE_MAX_SIZE'
      },
      maxFiles: {
        doc: 'Maximum number of log files to keep',
        format: 'int',
        default: 5,
        env: 'GCUID_LOG_FILE_MAX_FILES'
      }
    },
    console: {
      enabled: {
        doc: 'Enable logging to console',
        format: Boolean,
        default: true,
        env: 'GCUID_LOG_CONSOLE_ENABLED'
      },
      colorize: {
        doc: 'Colorize console output',
        format: Boolean,
        default: true,
        env: 'GCUID_LOG_COLORIZE'
      }
    },
    format: {
      doc: 'Log format (json or simple)',
      format: ['json', 'simple'],
      default: 'simple',
      env: 'GCUID_LOG_FORMAT'
    }
  },

  // Database configuration
  database: {
    path: {
      doc: 'Path to the SQLite database file',
      format: String,
      default: './data/registry.db',
      env: 'GCUID_DB_PATH'
    },
    verbose: {
      doc: 'Enable verbose database logging',
      format: Boolean,
      default: false,
      env: 'GCUID_DB_VERBOSE'
    }
  },

  // GCUID default settings
  gcuid: {
    defaultNamespace: {
      doc: 'Default URN namespace for GCUIDs',
      format: String,
      default: 'gc',
      env: 'GCUID_NAMESPACE'
    },
    defaultFormat: {
      doc: 'Default GCUID format (v1 or v2)',
      format: ['v1', 'v2'],
      default: 'v2',
      env: 'GCUID_FORMAT'
    },
    defaultVersion: {
      doc: 'Default GCUID version (for V1 format)',
      format: 'int',
      default: 1,
      env: 'GCUID_VERSION'
    },
    defaultCoreType: {
      doc: 'Default core identifier type (ulid or uuid)',
      format: ['ulid', 'uuid'],
      default: 'ulid',
      env: 'GCUID_CORE_TYPE'
    },
    alias: {
      enabled: {
        doc: 'Enable alias generation feature',
        format: Boolean,
        default: true,
        env: 'GCUID_ALIAS_ENABLED'
      },
      defaultContext: {
        doc: 'Default alias context code',
        format: String,
        default: 'A',
        env: 'GCUID_ALIAS_CONTEXT'
      },
      hashAlgorithm: {
        doc: 'Hash algorithm for alias generation',
        format: ['sha256', 'sha512'],
        default: 'sha256',
        env: 'GCUID_ALIAS_HASH_ALGO'
      }
    },
    v2: {
      enabled: {
        doc: 'Enable V2 format support',
        format: Boolean,
        default: true,
        env: 'GCUID_V2_ENABLED'
      },
      aliasOnCreation: {
        doc: 'Automatically generate alias when creating V2 GCUIDs',
        format: Boolean,
        default: false,
        env: 'GCUID_V2_AUTO_ALIAS'
      }
    },
    v1: {
      enabled: {
        doc: 'Enable V1 format support (backward compatibility)',
        format: Boolean,
        default: true,
        env: 'GCUID_V1_ENABLED'
      },
      deprecated: {
        doc: 'Mark V1 format as deprecated (show warnings)',
        format: Boolean,
        default: false,
        env: 'GCUID_V1_DEPRECATED'
      }
    }
  },

  // CLI styling configuration
  cli: {
    styles: {
      headColor: {
        doc: 'Table header color',
        format: ['cyan', 'blue', 'green', 'yellow', 'red', 'magenta', 'white', 'gray'],
        default: 'cyan'
      },
      boxWidth: {
        doc: 'Default width for box displays',
        format: 'int',
        default: 59
      },
      listLimit: {
        doc: 'Default limit for list results',
        format: 'int',
        default: 20
      }
    },
    messages: {
      mintSuccess: {
        doc: 'Message displayed when GCUID is successfully minted',
        format: String,
        default: 'GCUID minted successfully!'
      },
      registrationSuccess: {
        doc: 'Message displayed when identity is registered',
        format: String,
        default: '✓ Registered in database with state: {state}'
      },
      notFound: {
        doc: 'Message displayed when GCUID is not found',
        format: String,
        default: '✗ GCUID not found in registry'
      },
      alreadyExists: {
        doc: 'Message displayed when GCUID already exists',
        format: String,
        default: '✗ GCUID already exists in registry'
      },
      invalidGcuid: {
        doc: 'Message displayed when GCUID is invalid',
        format: String,
        default: '✗ GCUID is invalid'
      },
      validGcuid: {
        doc: 'Message displayed when GCUID is valid',
        format: String,
        default: '✓ GCUID is valid'
      }
    },
    tableHeaders: {
      keyValue: {
        doc: 'Default key-value table headers',
        format: Array,
        default: ['Key', 'Value']
      },
      component: {
        doc: 'Component table headers for parse command',
        format: Array,
        default: ['Component', 'Value']
      },
      property: {
        doc: 'Property table headers for registry entries',
        format: Array,
        default: ['Property', 'Value']
      },
      attribute: {
        doc: 'Attribute table headers for identity details',
        format: Array,
        default: ['Attribute', 'Value']
      },
      entityTypes: {
        doc: 'Entity types table header',
        format: Array,
        default: ['Entity Type']
      },
      registryList: {
        doc: 'Registry list table headers',
        format: Array,
        default: ['GCUID', 'Type', 'State']
      },
      stats: {
        doc: 'Statistics table headers',
        format: Array,
        default: ['Category', 'Count']
      },
      history: {
        doc: 'State history table headers',
        format: Array,
        default: ['#', 'From', 'To', 'Changed At', 'Reason']
      }
    },
    columnWidths: {
      registryList: {
        doc: 'Column widths for registry list',
        format: Array,
        default: [50, 12, 12]
      },
      history: {
        doc: 'Column widths for history table',
        format: Array,
        default: [5, 12, 12, 28, 30]
      }
    }
  },

  // Entity types configuration
  entities: {
    defaultTypes: {
      doc: 'Default registered entity types',
      format: Array,
      default: ['person', 'org', 'asset', 'app', 'agent']
    }
  }
};

// Create and validate the configuration
const config = convict(configSchema);

// Try to load from config file (optional)
try {
  const configPath = path.join(__dirname, '..', 'config', 'default.json');
  config.loadFile(configPath);
} catch (error) {
  // Config file is optional, use defaults if not found
}

// Validate configuration
config.validate({ allowed: 'strict' });

/**
 * Typed shape of the resolved configuration.
 *
 * Each property mirrors the corresponding convict schema defined
 * above; convict validates that runtime values match these types at
 * load time. Use {@link getConfig} to obtain a `Config` instance.
 */
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

/**
 * Returns the current resolved configuration as a typed object.
 *
 * Values come from convict defaults overlaid with environment variables
 * (`GCUID_*`) and any optional `config/default.json` next to the package.
 *
 * @returns The full configuration tree; safe to read repeatedly.
 */
export function getConfig(): Config {
  return config.get() as Config;
}

/**
 * Returns the SQLite database path from configuration, resolved to an
 * absolute path against the current working directory if relative.
 *
 * @returns Absolute filesystem path to the SQLite database file.
 */
export function getDbPath(): string {
  const dbPath = config.get('database.path');
  return path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
}

// Export the convict instance for advanced usage (custom validation,
// hot reload, programmatic property writes). Most callers should
// prefer the typed `getConfig()` helper above.
export default config;
