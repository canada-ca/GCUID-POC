# Authoritative Source Integration

## Overview

The Authoritative Source system enables the Identity Orchestrator to query external identity repositories (HR systems, LDAP/Active Directory, CRM systems, databases, etc.) for duplicate detection and attribute retrieval.

## Architecture

### Core Components

1. **AuthoritativeSourceAdapter** - Abstract base class for all source implementations
2. **MockAuthoritativeSourceAdapter** - In-memory implementation for testing
3. **AuthoritativeSourceManager** - Coordinates multiple sources
4. **Schema Definitions** - Describe structure and attributes of each source

### Key Interfaces

```typescript
// Schema for an authoritative source
interface AuthoritativeSourceSchema {
  sourceName: string;
  primaryIdentifier: string;
  attributes: AttributeDefinition[];
  secondaryIdentifiers?: string[];
  version?: string;
}

// Attribute definition with match weighting
interface AttributeDefinition {
  fieldName: string;
  mappedName?: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  matchable?: boolean;
  matchWeight?: number;  // 0-1, higher = more important for matching
  required?: boolean;
  isPII?: boolean;
  description?: string;
}

// Identity record from a source
interface SourceIdentityRecord {
  sourceId: string;
  sourceName: string;
  primaryIdentifier: string;
  attributes: Record<string, any>;
  retrievedAt: Date;
  metadata?: Record<string, any>;
}
```

## Usage

### 1. Create and Configure Sources

```typescript
import {
  AuthoritativeSourceManager,
  createMockHRSource,
  createMockLDAPSource
} from '@gcuid/core';

// Create source manager
const sourceManager = new AuthoritativeSourceManager();

// Register pre-configured mock sources
const hrSource = createMockHRSource();
await sourceManager.registerSource(hrSource);

const ldapSource = createMockLDAPSource();
await sourceManager.registerSource(ldapSource);
```

### 2. Search Across Sources

```typescript
import { SourceQuery } from '@gcuid/core';

// Query by email
const query: SourceQuery = {
  attributes: {
    email: 'john.doe@example.com'
  },
  minConfidence: 0.3,  // Minimum confidence threshold
  limit: 10
};

// Search all registered sources
const results = await sourceManager.searchAllConsolidated(query);

console.log('Results:', {
  sourcesSearched: results.sourcesSearched,
  totalRecords: results.records.length,
  records: results.records.map((r, i) => ({
    source: results.sources[i],
    identifier: r.primaryIdentifier,
    confidence: results.confidenceScores[i]
  }))
});
```

### 3. Integrate with Identity Orchestrator

```typescript
import {
  IdentityOrchestrator,
  IdentityRegistry,
  IdentityEntityRegistry,
  GCUIDManager,
  EntityType
} from '@gcuid/core';

// Create orchestrator with source manager
const gcuidRegistry = new IdentityRegistry();
const identityRegistry = new IdentityEntityRegistry(dbPath);
const gcuidManager = new GCUIDManager();

const orchestrator = new IdentityOrchestrator(
  gcuidRegistry,
  identityRegistry,
  gcuidManager,
  sourceManager  // Pass the source manager
);

// Create identity with automatic duplicate detection
const result = await orchestrator.createIdentity({
  entityType: EntityType.PERSON,
  name: 'Jane Smith',
  email: 'jane.smith@example.com'
});

console.log('Result:', {
  gcuid: result.gcuid,
  requiresManualReview: result.requiresManualReview,
  autoApproved: result.autoApproved,
  duplicateDetection: result.duplicateDetectionResult
});
```

## Duplicate Detection Workflow

When the Identity Orchestrator creates a new identity with an `AuthoritativeSourceManager` configured:

1. **Query Construction** - Builds a source query from provided attributes (email, name, etc.)
2. **Source Search** - Calls `sourceManager.searchAllConsolidated()` to query all sources
3. **Result Consolidation** - Combines and ranks results by confidence score
4. **Confidence Assessment** - Determines overall confidence level:
   - **High** (≥0.7): Rejects creation, requires manual review
   - **Medium** (0.4-0.7): Flags for manual review, creates in `under_review` state
   - **Low** (<0.4): Proceeds with creation, may auto-approve

5. **GCUID State**:
   - Auto-approved → GCUID `issued`, Identity `active`
   - Manual review → GCUID `reserved`, Identity `under_review`

## Creating Custom Sources

Extend `AuthoritativeSourceAdapter` or use `MockAuthoritativeSourceAdapter` for testing:

```typescript
import {
  MockAuthoritativeSourceAdapter,
  AuthoritativeSourceSchema
} from '@gcuid/core';

// Define schema
const customSchema: AuthoritativeSourceSchema = {
  sourceName: 'Custom CRM System',
  primaryIdentifier: 'customerId',
  attributes: [
    {
      fieldName: 'customerId',
      type: 'string',
      required: true,
      matchable: true,
      matchWeight: 1.0,
      isPII: false
    },
    {
      fieldName: 'email',
      type: 'string',
      required: true,
      matchable: true,
      matchWeight: 0.9,
      isPII: true
    },
    {
      fieldName: 'fullName',
      type: 'string',
      required: true,
      matchable: true,
      matchWeight: 0.7,
      isPII: true
    }
  ],
  secondaryIdentifiers: ['email']
};

// Create adapter
const customSource = new MockAuthoritativeSourceAdapter({
  name: 'Custom CRM System',
  enabled: true,
  priority: 3,
  schema: customSchema
});

// Register with manager
await sourceManager.registerSource(customSource);
```

## Stub Behavior (No Sources Configured)

If no `AuthoritativeSourceManager` is provided to the Identity Orchestrator, it falls back to stub duplicate detection:

- Simple pattern matching (emails containing "test" flagged as suspicious)
- No external source queries
- Low confidence results
- Useful for development/testing

## Source Priority

Sources are queried in priority order (lower number = higher priority):

1. Priority 1: HR Systems (employee records)
2. Priority 2: LDAP/Active Directory (authentication)
3. Priority 3+: Custom sources, legacy systems

Results are consolidated and sorted by confidence score, with higher priority sources weighted more heavily.

## Configuration Options

```typescript
interface AuthoritativeSourceConfig {
  name: string;
  enabled: boolean;
  priority: number;  // 1 = highest priority
  schema: AuthoritativeSourceSchema;
}
```

## Best Practices

1. **Start with Mock Sources** - Use `createMockHRSource()` and `createMockLDAPSource()` for testing
2. **Configure Match Weights** - Tune `matchWeight` values based on attribute reliability
3. **Set Appropriate Thresholds** - Adjust `minConfidence` based on false positive tolerance
4. **Implement Concrete Adapters** - Extend `AuthoritativeSourceAdapter` for production sources
5. **Monitor Performance** - Log search times and result counts for optimization
6. **Handle PII Carefully** - Mark `isPII: true` for sensitive attributes

## Future Enhancements

- LDAP/AD production adapter
- REST API adapter for external services
- Database connector adapter
- Caching layer for frequently accessed records
- Advanced fuzzy matching algorithms
- Bi-directional synchronization
- Federated attribute retrieval

## Related Documentation

- [ORCHESTRATED-IDENTITY-CREATION.md](./ORCHESTRATED-IDENTITY-CREATION.md) - Full orchestration workflow
- [STATE-MACHINE.md](./STATE-MACHINE.md) - GCUID state transitions
- [CLI-REFERENCE.md](./CLI-REFERENCE.md) - Command-line interface
