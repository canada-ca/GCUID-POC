# Connector Communication Testing Guide

This guide explains how to test the HTTP communication between the central GCUID system and departmental identity source connectors.

## Overview

The connector testing framework provides:
- **Mock Connector Servers**: Simulated departmental systems (HR, LDAP, Customer DB)
- **API Clients**: HTTP clients for querying connectors
- **Integration Tests**: Comprehensive test suite covering all communication patterns
- **Performance Tests**: Latency and throughput measurements

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Central GCUID System                      │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
│  │ Client (HR)  │   │ Client (LDAP)│   │Client (CustDB)│   │
│  └──────┬───────┘   └──────┬───────┘   └──────┬────────┘   │
│         │                  │                   │            │
└─────────┼──────────────────┼───────────────────┼────────────┘
          │ HTTP/REST        │ HTTP/REST         │ HTTP/REST
          │ Bearer Token     │ Bearer Token      │ Bearer Token
          │                  │                   │
┌─────────▼──────────────────▼───────────────────▼────────────┐
│              Departmental Connectors (Mocked)               │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
│  │  HR Server   │   │ LDAP Server  │   │ CustDB Server│   │
│  │  Port: 3001  │   │  Port: 3002  │   │  Port: 3003  │   │
│  └──────┬───────┘   └──────┬───────┘   └──────┬────────┘   │
│         │                  │                   │            │
│  ┌──────▼──────────────────▼───────────────────▼────────┐  │
│  │          Mock Data Providers                          │  │
│  │  (Simulates departmental data sources)               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Run All Tests

**PowerShell (Windows):**
```powershell
cd packages/core
./test-connectors.ps1
```

**Bash (Linux/Mac):**
```bash
cd packages/core
./test-connectors.sh
```

### Manual Test Execution

```bash
# Build the project
npm run build

# Run integration tests
node dist/connector-integration-tests.js
```

## Test Suite

### Test 1: Health Checks
Verifies that all connectors are healthy and responsive.

**Tests:**
- GET `/health` endpoint (no auth required)
- Status = 'healthy'
- Uptime reporting
- Record count reporting

### Test 2: Authentication
Tests Bearer token authentication.

**Tests:**
- Valid token accepted
- Invalid token rejected (403)
- Missing token rejected (401)
- Health endpoint accessible without auth

### Test 3: Search Functionality
Tests record searching capabilities.

**Tests:**
- Exact match search
- Fuzzy match search
- Multiple attribute search
- Empty results handling
- Result limit enforcement

### Test 4: Parallel Queries
Simulates duplicate detection across multiple sources.

**Tests:**
- Query 3 connectors simultaneously
- Measure total time vs sequential time
- Verify performance gain (should be 2-3x faster)
- Aggregate results from all sources

**Example Output:**
```
Queried 3 connectors in parallel
Total time: 120ms
Sequential would take: ~300ms
Performance gain: 250%
```

### Test 5: Get Specific Record
Tests fetching individual records by ID.

**Tests:**
- GET `/record/:recordId` endpoint
- Existing record retrieval
- Non-existent record returns null (404)

### Test 6: Performance and Latency
Measures response times and throughput.

**Tests:**
- 10 iterations of search queries
- Average, min, max response times
- Response time < 500ms threshold
- Consistency verification

### Test 7: Error Handling
Tests error conditions and edge cases.

**Tests:**
- Empty search attributes (400)
- Invalid record IDs (404)
- Malformed requests (400)
- Timeout handling

### Test 8: Connector Info
Tests metadata endpoint.

**Tests:**
- GET `/info` endpoint
- Source ID, name, type
- Request count tracking
- Uptime reporting

## API Reference

### Connector API Server

Each departmental connector exposes the following HTTP endpoints:

#### `GET /health`
Health check endpoint (no authentication required).

**Response:**
```json
{
  "sourceId": "hr-system",
  "status": "healthy",
  "uptime": 3600,
  "lastSync": "2026-01-26T10:00:00Z",
  "recordCount": 1500,
  "cacheHitRate": 0.75
}
```

#### `POST /search`
Search for records matching attributes.

**Request:**
```json
{
  "attributes": {
    "email": "john.smith@company.com",
    "department": "Engineering"
  },
  "limit": 100,
  "fuzzy": true
}
```

**Response:**
```json
{
  "sourceId": "hr-system",
  "records": [
    {
      "recordId": "HR-001",
      "attributes": {
        "employeeId": "E12345",
        "firstName": "John",
        "lastName": "Smith",
        "email": "john.smith@company.com"
      },
      "normalizedAttributes": {
        "email": "john.smith@company.com",
        "name": "John Smith",
        "phone": "+1-555-0100"
      },
      "lastModified": "2024-01-15T00:00:00Z"
    }
  ],
  "searchTime": 45,
  "fromCache": false
}
```

#### `GET /record/:recordId`
Get a specific record by ID.

**Response:**
```json
{
  "recordId": "HR-001",
  "attributes": { ... },
  "normalizedAttributes": { ... },
  "lastModified": "2024-01-15T00:00:00Z"
}
```

#### `GET /info`
Get connector metadata.

**Response:**
```json
{
  "sourceId": "hr-system",
  "sourceName": "HR System",
  "sourceType": "hr",
  "uptime": 3600,
  "requestCount": 150
}
```

### Authentication

All endpoints except `/health` require Bearer token authentication:

```
Authorization: Bearer <token>
```

**Example:**
```bash
curl -H "Authorization: Bearer hr-token-123" \
     -H "Content-Type: application/json" \
     -d '{"attributes":{"email":"test@example.com"}}' \
     http://localhost:3001/search
```

## Custom Tests

### Create a Custom Mock Data Provider

```typescript
import { ConnectorDataProvider, ConnectorRecord } from './connector-api';

class MyCustomProvider implements ConnectorDataProvider {
  async search(attributes: Record<string, any>): Promise<ConnectorRecord[]> {
    // Your custom search logic
    return [];
  }

  async getRecord(recordId: string): Promise<ConnectorRecord | null> {
    // Your custom record retrieval
    return null;
  }

  async getHealth() {
    return {
      status: 'healthy' as const,
      uptime: 1000,
      recordCount: 100,
    };
  }
}
```

### Start a Custom Connector

```typescript
import { ConnectorAPIServer } from './connector-api';
import { MyCustomProvider } from './my-custom-provider';

const provider = new MyCustomProvider();
const server = new ConnectorAPIServer(
  {
    sourceId: 'my-source',
    sourceName: 'My Custom Source',
    sourceType: 'custom',
    port: 3004,
    authToken: 'my-secret-token',
  },
  provider
);

await server.start();
```

### Test a Single Connector

```typescript
import { ConnectorAPIClient } from './connector-api';

const client = new ConnectorAPIClient(
  'http://localhost:3001',
  'hr-token-123',
  5000 // timeout ms
);

// Test health
const health = await client.health();
console.log('Status:', health.status);

// Test search
const results = await client.search({
  attributes: { email: 'test@example.com' },
  limit: 10,
});
console.log('Found:', results.records.length, 'records');
```

## Performance Testing

### Load Test Example

```typescript
import { ConnectorAPIClient } from './connector-api';
import { measureTime } from './connector-test-utils';

async function loadTest(client: ConnectorAPIClient, requests: number) {
  const times: number[] = [];

  for (let i = 0; i < requests; i++) {
    const { duration } = await measureTime(async () => {
      return client.search({
        attributes: { department: 'Engineering' },
      });
    });
    times.push(duration);
  }

  const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
  const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  console.log(`Requests: ${requests}`);
  console.log(`Average: ${avgTime.toFixed(1)}ms`);
  console.log(`P95: ${p95}ms`);
}
```

### Concurrent Request Test

```typescript
async function concurrentTest(client: ConnectorAPIClient, concurrency: number) {
  const promises = Array(concurrency)
    .fill(null)
    .map(() =>
      client.search({
        attributes: { email: 'test@example.com' },
      })
    );

  const { duration } = await measureTime(async () => {
    return Promise.all(promises);
  });

  console.log(`${concurrency} concurrent requests in ${duration}ms`);
  console.log(`Throughput: ${((concurrency / duration) * 1000).toFixed(1)} req/s`);
}
```

## Mock Data

The test framework includes pre-defined mock data for three departmental sources:

### HR System
```typescript
MOCK_HR_RECORDS = [
  {
    recordId: 'HR-001',
    attributes: {
      employeeId: 'E12345',
      firstName: 'John',
      lastName: 'Smith',
      email: 'john.smith@company.com',
      department: 'Engineering',
    },
    // ...
  },
];
```

### LDAP/Active Directory
```typescript
MOCK_LDAP_RECORDS = [
  {
    recordId: 'LDAP-001',
    attributes: {
      cn: 'john.smith',
      displayName: 'John Smith',
      mail: 'john.smith@company.com',
      // ...
    },
  },
];
```

### Customer Database
```typescript
MOCK_CUSTOMER_RECORDS = [
  {
    recordId: 'CUST-001',
    attributes: {
      customerId: 'C98765',
      name: 'Alice Johnson',
      email: 'alice.j@example.com',
      // ...
    },
  },
];
```

## Troubleshooting

### Port Already in Use

If you see "EADDRINUSE" errors, another process is using the test ports (3001-3003).

**Solution:**
```powershell
# Windows
netstat -ano | findstr ":3001"
taskkill /PID <pid> /F

# Linux/Mac
lsof -ti:3001 | xargs kill -9
```

### Timeout Errors

If tests timeout, increase the timeout value:

```typescript
const client = new ConnectorAPIClient(
  'http://localhost:3001',
  'token',
  10000 // 10 seconds instead of 5
);
```

### Authentication Failures

Verify the Bearer token matches between server config and client:

```typescript
// Server
authToken: 'hr-token-123'

// Client
new ConnectorAPIClient('http://localhost:3001', 'hr-token-123')
```

## Next Steps

1. **Implement Real Connectors**: Replace mock providers with actual departmental system integrations
2. **Add Cache Layer**: Implement central cache for connector responses
3. **Deploy Connectors**: Package connectors as Docker containers
4. **Add Monitoring**: Integrate Prometheus metrics and health checks
5. **Scale Testing**: Test with thousands of concurrent requests

## References

- [Connector API contract](./src/connector-api.ts) — shared connector↔registry types
