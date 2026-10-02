#!/usr/bin/env tsx
/**
 * Start Connector Servers for GCUID Staging Environment
 *
 * Starts four HTTP connector servers for federal architecture demonstration:
 * - HR System (Authoritative Source) on port 5183
 * - LDAP/AD (Authoritative Source) on port 5184
 * - Engineering Department on port 5185
 * - Finance Department on port 5186
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import from compiled dist using require (CommonJS)
const { ConnectorAPIServer } = require('../../packages/core/dist/connector-api.js');
const { SourceAPIClient } = require('../../packages/core/dist/source-api.js');
// Note: createHRSystemSource, createLDAPSource, createDepartmentSource are
// intentionally NOT imported here anymore. With Plan B option B3, every
// connector talks to its dedicated source process over HTTP. The factories
// remain in @gcuid/core for direct use by source-server launchers only.

// Plan B option B3 — connector↔source HTTP boundary
// Every source runs in its own process now; connectors are thin HTTP intermediaries.
const HTTP_SOURCES: Record<string, { baseUrl: string; authToken: string }> = {
  'conn-hr':          { baseUrl: 'http://127.0.0.1:5188', authToken: 'gcuid_source_hr_token_12345' },
  'conn-ldap':        { baseUrl: 'http://127.0.0.1:5189', authToken: 'gcuid_source_ldap_token_12345' },
  'conn-engineering': { baseUrl: 'http://127.0.0.1:5190', authToken: 'gcuid_source_engineering_token_12345' },
  'conn-finance':     { baseUrl: 'http://127.0.0.1:5191', authToken: 'gcuid_source_finance_token_12345' },
};

const STAGING_ROOT = path.join(__dirname, '..');
// Source DBs live in staging/data/sources/
const DATA_DIR = path.join(STAGING_ROOT, 'data', 'sources');

console.log('🚀 Starting GCUID Connector Servers');
console.log('===================================');
console.log('Federal Architecture: 2 Authoritative Sources + 2 Departments\n');

interface ConnectorConfig {
  sourceId: string;
  sourceName: string;
  sourceType: 'hr' | 'ldap' | 'customer-db' | 'erp' | 'custom';
  port: number;
  authToken: string;
  cacheTTL?: number;
}

interface ConnectorSetup {
  name: string;
  config: ConnectorConfig;
  dbPath: string;
  sourceType: 'hr' | 'ldap' | 'department-eng' | 'department-fin';
}

const connectorSetups: ConnectorSetup[] = [
  {
    name: 'HR System',
    config: {
      sourceId: 'conn-hr',
      sourceName: 'HR Management System (Authoritative)',
      sourceType: 'hr',
      port: 5183,
      authToken: 'staging_hr_token_12345',
      cacheTTL: 300
    },
    dbPath: path.join(DATA_DIR, 'conn-hr.db'),
    sourceType: 'hr'
  },
  {
    name: 'LDAP/AD',
    config: {
      sourceId: 'conn-ldap',
      sourceName: 'LDAP/Active Directory (Authoritative)',
      sourceType: 'ldap',
      port: 5184,
      authToken: 'staging_ldap_token_12345',
      cacheTTL: 300
    },
    dbPath: path.join(DATA_DIR, 'conn-ldap.db'),
    sourceType: 'ldap'
  },
  {
    name: 'Engineering Department',
    config: {
      sourceId: 'conn-engineering',
      sourceName: 'Engineering Department System',
      sourceType: 'custom',
      port: 5185,
      authToken: 'staging_eng_token_12345',
      cacheTTL: 300
    },
    dbPath: path.join(DATA_DIR, 'conn-engineering.db'),
    sourceType: 'department-eng'
  },
  {
    name: 'Finance Department',
    config: {
      sourceId: 'conn-finance',
      sourceName: 'Finance Department System',
      sourceType: 'custom',
      port: 5186,
      authToken: 'staging_fin_token_12345',
      cacheTTL: 300
    },
    dbPath: path.join(DATA_DIR, 'conn-finance.db'),
    sourceType: 'department-fin'
  }
];

const servers: any[] = [];

// Start each connector
async function main() {
  for (const setup of connectorSetups) {
    console.log(`📡 Starting ${setup.name} Connector...`);
    console.log(`   Port: ${setup.config.port}`);
    console.log(`   Source: ${setup.config.sourceId}`);
    console.log(`   Type: ${setup.config.sourceType}`);
    console.log(`   Database: ${setup.dbPath}`);
    
    // Create the appropriate data provider.
    // Plan B option B3 — every connector now proxies to its dedicated source
    // process via HTTP. The connector no longer opens SQLite directly.
    const upstream = HTTP_SOURCES[setup.config.sourceId];
    let dataProvider;
    if (upstream) {
      console.log(`   Upstream: ${upstream.baseUrl} (HTTP)`);
      dataProvider = new SourceAPIClient(upstream.baseUrl, upstream.authToken, setup.config.sourceId);
    } else {
      // Defensive fallback: no upstream configured — fail loudly rather than
      // silently opening SQLite (which would defeat the whole refactor).
      throw new Error(
        `No upstream source configured for ${setup.config.sourceId}. ` +
        `Add an entry to HTTP_SOURCES in start-connectors.ts.`
      );
    }
    
    const server = new ConnectorAPIServer(setup.config, dataProvider);
    await server.start();
    servers.push(server);
    
    console.log(`✅ ${setup.name} Connector running at http://localhost:${setup.config.port}\n`);
  }

console.log('✨ All Connectors Started!');
console.log('=========================\n');
console.log('📦 Authoritative Sources:');
console.log(`  - HR System:    http://localhost:5183/health`);
console.log(`  - LDAP/AD:      http://localhost:5184/health`);
console.log('\n🏢 Department Systems:');
console.log(`  - Engineering:  http://localhost:5185/health`);
console.log(`  - Finance:      http://localhost:5186/health`);
console.log('\n🔑 Authentication Tokens:');
console.log(`  - HR:           staging_hr_token_12345`);
console.log(`  - LDAP:         staging_ldap_token_12345`);
console.log(`  - Engineering:  staging_eng_token_12345`);
console.log(`  - Finance:      staging_fin_token_12345`);
console.log('\nPress Ctrl+C to stop all connectors\n');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Stopping connector servers...');
  
  for (const server of servers) {
    await server.stop();
  }
  
  console.log('✅ All connectors stopped');
  process.exit(0);
});

// Keep process running
main().then(() => {
  process.stdin.resume();
}).catch((error) => {
  console.error('❌ Error starting connectors:', error);
  process.exit(1);
});
