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
 * Regression tests for the connector API /search endpoint.
 *
 * SC-CONN-1..4 in TEST_PLAN.md
 *
 * The /search endpoint is the bridge between the central CAES match engine
 * and the per-source connector HTTP servers. Three interlocking bugs had
 * accumulated in `connector-api.ts:198-216`:
 *
 *   1. dataProvider.search was called with (attributes, {limit, fuzzy})
 *      but the dataProvider contract is search(query) where query is one
 *      wrapped object. The wrong shape caused "Cannot convert undefined
 *      or null to object" inside the dataProvider.
 *
 *   2. The dataProvider returns { records, ... }, not an array. The
 *      connector was assigning the whole wrapped object to response.records,
 *      which caused "records.map is not a function" downstream.
 *
 *   3. Records were forwarded with the dataProvider's `primaryIdentifier`
 *      field, but the public ConnectorRecord contract uses `recordId`.
 *      CAES and the gcuid-request preview both rely on `recordId` to look
 *      up source_mappings, so this silent mis-shape meant cross-source
 *      detection never worked.
 */

import express from 'express';
import request from 'supertest';
import { ConnectorAPIServer } from '../connector-api';
import {
  AuthoritativeSourceAdapter,
  AuthoritativeSourceConfig,
  SourceQuery,
  SourceSearchResult,
  SourceIdentityRecord,
} from '../authoritative-source';

const TEST_TOKEN='***';

function buildFakeRecord(primaryIdentifier: string, attrs: Record<string, any>): SourceIdentityRecord {
  return {
    sourceId: 'fake-hr',
    sourceName: 'Fake HR',
    primaryIdentifier,
    attributes: attrs,
    retrievedAt: new Date(),
  };
}

class FakeSource extends AuthoritativeSourceAdapter {
  public static lastQuery: SourceQuery | null = null;
  public static returnResult: SourceSearchResult | SourceIdentityRecord[] | null = null;
  public static throwOnSearch: Error | null = null;

  constructor(config: AuthoritativeSourceConfig) {
    super(config);
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async getById(_id: string): Promise<SourceIdentityRecord | null> { return null; }
  async getAttributes(_id: string, _names: string[]): Promise<Record<string, any>> { return {}; }

  async search(query: SourceQuery): Promise<SourceSearchResult> {
    FakeSource.lastQuery = query;
    if (FakeSource.throwOnSearch) throw FakeSource.throwOnSearch;
    return (FakeSource.returnResult as SourceSearchResult) ?? {
      records: [],
      confidenceScores: [],
      matchedAttributes: [],
      totalSearched: 0,
      executionTime: 1,
    };
  }

  async listRecords(): Promise<SourceIdentityRecord[]> { return []; }
  async updateRecord(): Promise<void> {}
  async testConnection(): Promise<boolean> { return true; }
}

function buildApp(): express.Express {
  const fakeConfig: AuthoritativeSourceConfig = {
    id: 'fake-hr',
    name: 'Fake HR',
    type: 'hr',
    schema: {
      sourceName: 'Fake HR',
      primaryIdentifier: 'employee_id',
      attributes: [
        { fieldName: 'employee_id', mappedName: 'person.employment.employee_id', type: 'string', matchable: true, matchWeight: 1.0 },
        { fieldName: 'email',       mappedName: 'person.email',                    type: 'string', matchable: true, matchWeight: 1.0 },
      ],
    },
    connection: { endpoint: ':memory:' },
    enabled: true,
  };
  const dataProvider = new FakeSource(fakeConfig);
  const server = new ConnectorAPIServer(
    { sourceId: 'fake-hr', sourceName: 'Fake HR', sourceType: 'hr', port: 0, authToken: TEST_TOKEN },
    dataProvider as any,
  );
  return (server as any).app as express.Express;
}

const bearer = () => `Bearer ${TEST_TOKEN}`;

describe('ConnectorAPIServer /search', () => {
  let app: express.Express;

  beforeEach(() => {
    FakeSource.lastQuery = null;
    FakeSource.returnResult = null;
    FakeSource.throwOnSearch = null;
    app = buildApp();
  });

  test('SC-CONN-4: rejects empty attributes with 400', async () => {
    const res = await request(app)
      .post('/search')
      .set('Authorization', bearer())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/attributes/i);
    expect(FakeSource.lastQuery).toBeNull();
  });

  test('SC-CONN-1: dataProvider receives the full wrapped query object', async () => {
    FakeSource.returnResult = { records: [], confidenceScores: [], matchedAttributes: [], totalSearched: 0, executionTime: 0 };
    await request(app)
      .post('/search')
      .set('Authorization', bearer())
      .send({ attributes: { email: 'a@b.com' }, limit: 5, fuzzy: false });

    expect(FakeSource.lastQuery).toBeTruthy();
    expect(typeof FakeSource.lastQuery).toBe('object');
    expect((FakeSource.lastQuery as any).attributes).toEqual({ email: 'a@b.com' });
    expect((FakeSource.lastQuery as any).limit).toBe(5);
    expect((FakeSource.lastQuery as any).fuzzy).toBe(false);
  });

  test('SC-CONN-2: response records expose recordId, not primaryIdentifier', async () => {
    FakeSource.returnResult = {
      records: [
        buildFakeRecord('E11013', { employee_id: 'E11013', email: 'emma@example.com' }),
        buildFakeRecord('E11014', { employee_id: 'E11014', email: 'other@example.com' }),
      ],
      confidenceScores: [0.98, 0.95],
      matchedAttributes: [['email'], ['email']],
      totalSearched: 100,
      executionTime: 5,
    };
    const res = await request(app)
      .post('/search')
      .set('Authorization', bearer())
      .send({ attributes: { email: 'emma@example.com' } });

    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(2);
    for (const r of res.body.records) {
      expect(r).toHaveProperty('recordId');
      expect(r).toHaveProperty('attributes');
      expect(r).toHaveProperty('normalizedAttributes');
      expect(r).not.toHaveProperty('primaryIdentifier');
    }
    expect(res.body.records[0].recordId).toBe('E11013');
    expect(res.body.records[1].recordId).toBe('E11014');
  });

  test('SC-CONN-3: empty match returns empty array (not the wrapped object)', async () => {
    FakeSource.returnResult = { records: [], confidenceScores: [], matchedAttributes: [], totalSearched: 0, executionTime: 0 };
    const res = await request(app)
      .post('/search')
      .set('Authorization', bearer())
      .send({ attributes: { email: 'noone@nowhere.com' } });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.records)).toBe(true);
    expect(res.body.records).toHaveLength(0);
  });

  test('SC-CONN-2 (defensive): a dataProvider that returns a raw array still works', async () => {
    (FakeSource as any).returnResult = [
      buildFakeRecord('X1', { id: 'X1' }),
    ];
    const res = await request(app)
      .post('/search')
      .set('Authorization', bearer())
      .send({ attributes: { id: 'X1' } });

    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].recordId).toBe('X1');
  });

  test('dataProvider exception surfaces as 500 with the error message', async () => {
    FakeSource.throwOnSearch = new Error('synthetic upstream failure');
    const res = await request(app)
      .post('/search')
      .set('Authorization', bearer())
      .send({ attributes: { email: 'x@y.com' } });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('synthetic upstream failure');
  });
});
