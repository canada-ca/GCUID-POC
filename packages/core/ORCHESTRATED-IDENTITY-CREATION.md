# Orchestrated Identity Creation Workflow

Complete workflow for creating identities with duplicate detection, GCUID binding, and state management.

> **Note:** This workflow supports both GCUID V2 format (`urn:gcuid:{core}`) and V1 format (`urn:gc:uid:{entity-type}:{version}:{core}`).

## Overview

The Identity Orchestration system coordinates three separate components:
1. **Duplicate Detection** - Checks 3rd party repositories for existing identities
2. **GCUID Management** - Creates and binds global identifiers
3. **Identity Entity Management** - Tracks identity lifecycle and state

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   Identity Orchestrator                      │
│                                                              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Duplicate  │  │    GCUID     │  │    Identity      │   │
│  │ Detection  │  │   Registry   │  │  Entity Registry │   │
│  └────────────┘  └──────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Workflow Steps

### Step 1: Duplicate Detection

Before creating any identity, the system checks for potential duplicates in 3rd party repositories.

**Currently Stubbed** - Returns mock results based on:
- Email patterns (e.g., contains "test")
- Random sampling for demonstration

**Production Implementation** would query:
- HR systems
- Active Directory / LDAP
- External identity providers
- Previous GCUID registrations
- Biometric systems
- Other authoritative sources

**Confidence Levels:**
- **HIGH (≥70%)**: Creation blocked, manual intervention required
- **MEDIUM (40-69%)**: Manual review required
- **LOW (<40%)**: Proceeds with warning

### Step 2: GCUID Creation and Registration

If no high-confidence duplicates are found:

1. Generate new GCUID: `urn:gcuid:{core-id}`
2. Register in GCUID registry with state: **RESERVED**
3. Record creation in state history

**GCUID States:**
- `reserved` - Identifier created but not yet bound to active identity
- `issued` - Identifier bound and in use
- `nullified` - Identifier invalidated (error or catastrophic event)
- `superseded` - Identifier replaced by another

### Step 3: Manual Review Determination

The system determines if manual review is required based on:

**Current Logic (stubbed):**
- Forced review (`--force-review` flag)
- Medium/high confidence duplicates detected

**Production Logic** would include:
- Entity type policies (e.g., employees vs. contractors)
- Geographic restrictions
- Regulatory requirements
- High-privilege roles
- Time-based policies (after-hours creations)
- Risk scoring algorithms

### Step 4: Identity Entity Creation

Identity entity created in **PROVISIONAL** state:

```typescript
{
  gcuid: "urn:gcuid:01ABC...",
  state: "provisional",
  metadata: { name, email, ... },
  createdAt: timestamp,
  reason: "..."
}
```

### Step 5: State Transition

**Auto-Approval Path** (no manual review required):
1. GCUID: `reserved` → `issued` (BIND transition)
2. Identity: `provisional` → `active` (PROOFED transition)
3. Identity is ready to use immediately

**Manual Review Path** (review required):
1. GCUID: stays in `reserved` state
2. Identity: `provisional` → `under_review` (CORRELATION transition)
3. Awaits manual approval or rejection

## Command-Line Interface

### Create Identity (Auto-Approval)

```bash
node dist/cli.js identity create person \
  --name "Alice Smith" \
  --email "alice@example.com" \
  --reason "New employee onboarding"
```

**Output:**
```
✅ Identity creation complete!

GCUID: urn:gc:uid:person:1:01...
GCUID State: issued
Identity State: active
Auto-Approved: YES

✓ Identity is ACTIVE and ready to use
✓ GCUID is ISSUED
```

### Create Identity (Manual Review Required)

```bash
node dist/cli.js identity create person \
  --name "Bob Jones" \
  --email "bob@example.com" \
  --force-review \
  --reason "Contractor needs approval"
```

**Output:**
```
✅ Identity creation complete!

GCUID: urn:gc:uid:person:1:01...
GCUID State: reserved
Identity State: under_review
Manual Review Required: YES

⏸ Identity is UNDER REVIEW
⏸ GCUID is RESERVED

Next steps:
  • Approve: node dist/cli.js identity approve <gcuid> --reason "..."
  • Reject: node dist/cli.js identity reject <gcuid> --reason "..."
```

### Approve Identity

```bash
node dist/cli.js identity approve <gcuid> \
  --reason "Background check passed"
```

**Actions:**
1. Identity: `under_review` → `active` (CLEAR transition)
2. GCUID: `reserved` → `issued` (BIND transition)

### Reject Identity

```bash
node dist/cli.js identity reject <gcuid> \
  --reason "Failed background check"
```

**Actions:**
1. Identity: `under_review` → `suspended` (DEEPER_INVESTIGATION transition)
2. GCUID: `reserved` → `nullified` (ERROR transition)

## State Coordination

The orchestration ensures coordinated state management:

| Scenario | GCUID State | Identity State | Meaning |
|----------|-------------|----------------|---------|
| Auto-approved | issued | active | Ready to use |
| Pending review | reserved | under_review | Awaiting approval |
| Approved | issued | active | Review passed, activated |
| Rejected | nullified | suspended | Review failed, blocked |

## Code Examples

### Basic Creation (Auto-Approval)

```typescript
import { IdentityOrchestrator } from '@gcuid/core';

const orchestrator = new IdentityOrchestrator(
  gcuidRegistry,
  identityRegistry,
  gcuidManager
);

const result = await orchestrator.createIdentity({
  entityType: 'person',
  name: 'Alice Smith',
  email: 'alice@example.com',
  reason: 'New employee onboarding'
});

// result.autoApproved === true
// result.gcuid === "urn:gcuid:01ABC..."
// result.identity.state === "active"
// result.registryEntry.state === "issued"
```

### Creation with Manual Review

```typescript
const result = await orchestrator.createIdentity({
  entityType: 'person',
  name: 'Bob Jones',
  email: 'bob@example.com',
  forceManualReview: true,
  reason: 'Contractor onboarding'
});

// result.requiresManualReview === true
// result.identity.state === "under_review"
// result.registryEntry.state === "reserved"

// Later, after review:
await orchestrator.approveIdentity(
  result.gcuid,
  'Background check passed'
);
```

### Skip Duplicate Check (Testing/Override)

```typescript
const result = await orchestrator.createIdentity({
  entityType: 'person',
  name: 'Test User',
  skipDuplicateCheck: true,  // Skip duplicate detection
  reason: 'Test account'
});
```

## Duplicate Detection Results

```typescript
interface DuplicateDetectionResult {
  hasDuplicates: boolean;
  matches: DuplicateMatch[];
  confidence: 'low' | 'medium' | 'high';
}

interface DuplicateMatch {
  source: string;           // e.g., "HR System", "Active Directory"
  identifier: string;       // Identifier in that system
  matchedAttributes: string[];  // Which attributes matched
  confidence: number;       // 0-1 confidence score
  metadata?: Record<string, any>;
}
```

**Example Result:**
```typescript
{
  hasDuplicates: true,
  matches: [
    {
      source: "External Identity Provider",
      identifier: "ext-abc123",
      matchedAttributes: ["name", "email"],
      confidence: 0.65,
      metadata: { note: "Similar name and email" }
    }
  ],
  confidence: "medium"
}
```

## Audit Trail

All operations are logged and recorded:

### GCUID State History

```sql
SELECT old_state, new_state, transition, changed_at, reason
FROM state_history
WHERE gcuid = 'urn:gc:uid:person:1:01...'
ORDER BY changed_at;
```

### Identity Entity History

```sql
SELECT from_state, to_state, transition, reason, timestamp
FROM identity_state_history
WHERE gcuid = 'urn:gc:uid:person:1:01...'
ORDER BY timestamp;
```

## Error Handling

### High-Confidence Duplicates

```
Error: High confidence duplicate detected. Found 2 matching records.
Manual review required before creating new identity.
```

### Invalid Transitions

```
Error: Invalid transition 'PROOFED' from state 'under_review'
Valid transitions: CLEAR, DEEPER_INVESTIGATION
```

### Not Found

```
Error: Identity not found: urn:gcuid:01ABC...
```

## Future Enhancements

### Duplicate Detection
- Integration with external identity providers (LDAP, AD, SAML)
- Biometric matching algorithms
- Machine learning-based similarity scoring
- Configurable matching rules per entity type

### Policy Engine
- Configurable approval workflows
- Role-based access control
- Multi-step approval chains
- Escalation policies
- Time-based rules

### Validation Hooks
- Pre-transition validation
- Custom business rules
- Compliance checks
- Data quality validation

### Side Effects
- Post-transition actions
- Notifications (email, SMS, webhook)
- Integration with downstream systems
- Automated provisioning
- Access control updates

## Best Practices

1. **Always provide meaningful reasons** - Essential for audit trail
2. **Handle duplicate warnings appropriately** - Don't ignore them
3. **Use manual review for high-risk scenarios** - Better safe than sorry
4. **Monitor statistics regularly** - Identify bottlenecks
5. **Review state histories** - Understand workflow patterns
6. **Test with --skip-duplicate-check** - But not in production!
7. **Implement proper error handling** - Expect failures
8. **Log all operations** - Comprehensive audit trail

## See Also

- [Identity Entity Documentation](./IDENTITY-ENTITY.md)
- [Business Transitions](./IDENTITY-TRANSITIONS-BUSINESS.md)
- [Identity CLI Reference](./IDENTITY-CLI.md)
- [GCUID State Machine](./STATE-MACHINE.md)
