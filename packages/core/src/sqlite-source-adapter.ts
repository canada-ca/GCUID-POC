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
 * SQLite-backed implementation of `SourceDataProvider`.
 *
 * This is the default server-side data provider for the `SourceAPIServer`.
 * It opens the existing source SQLite file (`staging/data/sources/conn-*.db`)
 * via `better-sqlite3` and serves the rows directly.
 *
 * Used during the PoC. In a real deployment, the source server could
 * front a real HR/LDAP system via this same `SourceDataProvider`
 * interface — the connector↔source HTTP boundary is what matters for
 * the design intent.
 */

import Database from 'better-sqlite3';
import {
  SourceDataProvider,
  SourceHealthResponse,
} from './source-api';
import {
  ConnectorRecord,
} from './connector-api';
import { logError } from './logger';

interface SqliteSourceAdapterOptions {
  databasePath: string;
  tableName: string;
  primaryKey: string;
  sourceId: string;
  sourceName: string;
}

/**
 * Build a SourceDataProvider that reads from a local SQLite file.
 * Returns a fully-initialised provider; no further setup needed.
 */
export function createSqliteSourceProvider(opts: SqliteSourceAdapterOptions): SourceDataProvider {
  let db: Database.Database | null = null;
  const startTime = new Date();

  function getDb(): Database.Database {
    if (!db) {
      db = new Database(opts.databasePath, { readonly: true, fileMustExist: true });
    }
    return db;
  }

  function getColumnNames(): string[] {
    const stmt = getDb().prepare(`PRAGMA table_info(${opts.tableName})`);
    return (stmt.all() as any[]).map((row) => row.name);
  }

  function rowToConnectorRecord(row: Record<string, any>): ConnectorRecord {
    const { id, created_at, updated_at, ...attributes } = row;
    return {
      recordId: String(row[opts.primaryKey] ?? row.id),
      attributes,
      normalizedAttributes: attributes,
      lastModified: updated_at ? new Date(updated_at) : (created_at ? new Date(created_at) : new Date()),
    };
  }

  return {
    async search(attributes, options) {
      const conditions: string[] = [];
      const params: any[] = [];
      const columns = getColumnNames();

      for (const [key, value] of Object.entries(attributes)) {
        if (columns.includes(key)) {
          conditions.push(`${key} LIKE ?`);
          params.push(`%${value}%`);
        }
      }

      if (conditions.length === 0) {
        return [];
      }

      const limit = options?.limit ?? 100;
      const sql = `SELECT * FROM ${opts.tableName} WHERE ${conditions.join(' AND ')} LIMIT ?`;
      params.push(limit);

      try {
        const rows = getDb().prepare(sql).all(...params) as Record<string, any>[];
        return rows.map(rowToConnectorRecord);
      } catch (error) {
        logError('source search failed', {  source: opts.sourceId, error  });
        return [];
      }
    },

    async getRecord(recordId) {
      try {
        const row = getDb()
          .prepare(`SELECT * FROM ${opts.tableName} WHERE ${opts.primaryKey} = ?`)
          .get(recordId) as Record<string, any> | undefined;
        if (!row) return null;
        return rowToConnectorRecord(row);
      } catch (error) {
        logError('source getRecord failed', {  source: opts.sourceId, error  });
        return null;
      }
    },

    async getHealth() {
      const response: SourceHealthResponse = {
        status: 'healthy',
        uptime: Math.floor((Date.now() - startTime.getTime()) / 1000),
        lastSync: new Date(),
        recordCount: 0,
        databasePath: opts.databasePath,
      };
      try {
        const row = getDb()
          .prepare(`SELECT COUNT(*) AS count FROM ${opts.tableName}`)
          .get() as { count: number };
        response.recordCount = row.count;
        return response;
      } catch (error) {
        logError('source health check failed', {  source: opts.sourceId, error  });
        response.status = 'unhealthy';
        return response;
      }
    },

    async fetchAll(since) {
      try {
        let sql = `SELECT * FROM ${opts.tableName}`;
        const params: any[] = [];
        if (since) {
          sql += ` WHERE updated_at > ? OR created_at > ?`;
          params.push(since, since);
        }
        const rows = getDb().prepare(sql).all(...params) as Record<string, any>[];
        return rows.map(rowToConnectorRecord);
      } catch (error) {
        logError('source fetchAll failed', {  source: opts.sourceId, error  });
        return [];
      }
    },

    async updateRecord(recordId, fields) {
      const columns = getColumnNames();
      const setClauses: string[] = [];
      const params: any[] = [];
      for (const [key, value] of Object.entries(fields)) {
        if (columns.includes(key) && key !== opts.primaryKey && key !== 'id') {
          setClauses.push(`${key} = ?`);
          params.push(value);
        }
      }
      if (setClauses.length === 0) {
        return; // nothing to update
      }
      params.push(recordId);
      // Open in writable mode for this operation
      const writable = new Database(opts.databasePath);
      try {
        writable
          .prepare(`UPDATE ${opts.tableName} SET ${setClauses.join(', ')} WHERE ${opts.primaryKey} = ?`)
          .run(...params);
      } finally {
        writable.close();
      }
    },
  };
}
