# @gcuid/core

Core GCUID (Government of Canada Unique Identifier) implementation for generating and managing identifiers with a standardized URN format.

## GCUID Formats

### V2 Format (Current - Recommended)

```
urn:gcuid:{core}
```

**Components:**
- **urn**: Fixed URN prefix
- **gcuid**: GCUID namespace identifier
- **core**: 26-character universally unique identifier in Crockford Base32 (ULID or UUID)

**Examples:**
```
urn:gcuid:01JBQM3E9XYZ123456789ABCDE
urn:gcuid:7ZZZZZZZZZVWXYZ123456789A
```

**Alias Format (Human-Readable):**
```
GC-{CONTEXT}-{HASH}-{CHECKSUM}
```

- **GC**: Fixed prefix (Global Citizen)
- **CONTEXT**: Single-character context code (A=Alias, S=System, Q=Query, T=Temporary, P=Persistent, etc.)
- **HASH**: 12-character hash derived from the core identifier (3 groups of 4)
- **CHECKSUM**: ISO 7064 MOD 37,36 validation digit

**Example Aliases:**
```
GC-A-ABCD-EFGH-1234-X
GC-S-5678-9ABC-DEFG-Y
```

### V1 Format (Legacy - Backward Compatible)

```
urn:{namespace}:uid:{entity-type}:{version}:{core}
```

**Components:**
- **urn**: Fixed URN prefix
- **namespace**: Configurable namespace identifier (default: "gc")
- **uid**: Fixed identifier type
- **entity-type**: Type of entity (person, org, asset, app, agent, or custom)
- **version**: Version number (always 1)
- **core**: 26-character identifier in Crockford Base32

**Examples:**
```
urn:gc:uid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV
urn:myorg:uid:org:1:7ZZZZZZZZZZZZZZZZZZZZZZZZZ
```

> **Note:** V1 format is fully supported for backward compatibility, but V2 is recommended for new implementations.

## Installation

```bash
npm install @gcuid/core
```

## Usage

### Basic Usage (V2 Format - Recommended)

```typescript
import { GCUIDManager, EntityType } from '@gcuid/core';

const manager = new GCUIDManager();

// Generate a V2 GCUID (simplified format)
const gcuid = manager.generateV2();
// Result: urn:gcuid:01JBQM3E9XYZ123456789ABCDE

// Generate with an alias
const result = manager.generateV2({ 
  generateAlias: true,
  aliasContext: 'A' 
});
console.log(result.gcuid);  // urn:gcuid:01JBQM3E9XYZ123456789ABCDE
console.log(result.alias);  // GC-A-ABCD-EFGH-1234-X

// Parse a V2 GCUID
const parsed = manager.parseV2(gcuid);
console.log(parsed.namespace);     // "gcuid"
console.log(parsed.core);          // "01JBQM3E9XYZ123456789ABCDE"
console.log(parsed.formatVersion); // "v2"

// Validate a V2 GCUID
const isValid = manager.validateV2(gcuid); // true

// Parse and validate an alias
const aliasInfo = manager.parseAlias('GC-A-ABCD-EFGH-1234-X');
console.log(aliasInfo.isValid);  // true
console.log(aliasInfo.context);  // 'A'
console.log(aliasInfo.hash);     // 'ABCDEFGH1234'
```

### V1 Format (Legacy - For Backward Compatibility)

```typescript
// Generate a V1 GCUID with entity type
const gcuidV1 = manager.generate({
  entityType: EntityType.PERSON,
});
// Result: urn:gc:uid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV

// Parse a V1 GCUID
const parsedV1 = manager.parse(gcuidV1);
console.log(parsedV1.namespace);  // "gc"
console.log(parsedV1.entityType); // "person"
console.log(parsedV1.version);    // 1
console.log(parsedV1.core);       // "01ARZ3NDEKTSV4RRFFQ69G5FAV"

// Validate a V1 GCUID
const isValidV1 = manager.validate(gcuidV1); // true
```

### Format Conversion

```typescript
// Convert V1 to V2
const v1Gcuid = 'urn:gc:uid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const converted = manager.convertV1ToV2(v1Gcuid, { generateAlias: true });

console.log(converted.v2Gcuid);      // urn:gcuid:01ARZ3NDEKTSV4RRFFQ69G5FAV
console.log(converted.alias);        // GC-A-XXXX-YYYY-ZZZZ-C
console.log(converted.entityType);   // person
console.log(converted.v1Format);     // urn:gc:uid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV

// Auto-detect format and parse
const autoDetected = manager.autoDetectAndParse(gcuid);
console.log(autoDetected.formatVersion); // "v1" or "v2"
```

### Alias Operations

```typescript
// Generate alias for existing GCUID
const alias = manager.generateAliasForGCUID(gcuid, 'S'); // S = System context
console.log(alias); // GC-S-XXXX-YYYY-ZZZZ-C

// Validate alias
const isValidAlias = manager.validateAlias(alias);
console.log(isValidAlias); // true

// Parse alias
const aliasInfo = manager.parseAlias(alias);
console.log(aliasInfo.context);   // 'S'
console.log(aliasInfo.hash);      // Full hash string
console.log(aliasInfo.checksum);  // Validation digit
console.log(aliasInfo.isValid);   // true/false
```

### Entity Types (V1 Format Only)

> **Note:** Entity types are only used in V1 format. V2 format stores entity type separately in the database or application layer.

Built-in entity types for V1:
- `person` - Individual persons
- `org` - Organizations
- `asset` - Physical or digital assets
- `app` - Applications
- `agent` - Software agents or bots

```typescript
// Generate GCUIDs for different entity types
const personId = manager.generate({ entityType: EntityType.PERSON });
const orgId = manager.generate({ entityType: EntityType.ORG });
const assetId = manager.generate({ entityType: EntityType.ASSET });
const appId = manager.generate({ entityType: EntityType.APP });
const agentId = manager.generate({ entityType: EntityType.AGENT });
```

### Custom Entity Types

Register custom entity types for your specific use case:

```typescript
// Register a custom entity type
manager.registerEntityType('device');
manager.registerEntityType('location');

// Use the custom type
const deviceId = manager.generate({ entityType: 'device' });
// Result: urn:gc:uid:device:1:01ARZ3NDEKTSV4RRFFQ69G5FAV

// List all registered types
const types = manager.getRegisteredEntityTypes();
// ["agent", "app", "asset", "device", "location", "org", "person"]
```

### Core Identifier Types

Choose between ULID (default) or UUID for the core identifier:

```typescript
import { CoreIdType } from '@gcuid/core';

// V2 with ULID (default) - time-sortable
const ulidGCUID = manager.generateV2({
  coreIdType: CoreIdType.ULID,
});

// V2 with UUID - random
const uuidGCUID = manager.generateV2({
  coreIdType: CoreIdType.UUID,
});

// V1 with ULID
const v1UlidGCUID = manager.generate({
  entityType: EntityType.PERSON,
  coreIdType: CoreIdType.ULID,
});
```

### Creating Identities with V2

Create complete identity records with metadata using V2 format:

```typescript
const identity = manager.createIdentityV2({
  entityType: 'person',  // Stored in metadata, not in GCUID
  metadata: {
    name: 'John Doe',
    email: 'john@example.com',
  },
  generateAlias: true,
  aliasContext: 'A'
});

console.log(identity);
// {
//   gcuid: "urn:gcuid:01ARZ3NDEKTSV4RRFFQ69G5FAV",
//   alias: "GC-A-XXXX-YYYY-ZZZZ-C",
//   entityType: "person",
//   createdAt: Date,
//   updatedAt: Date,
//   metadata: { name: "John Doe", email: "john@example.com" }
// }
```

### Validation

```typescript
// Basic validation
const isValid = manager.validate('urn:gc:uid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV');

// Strict validation (check if entity type is registered)
const isValidStrict = manager.validate(gcuid, { strictEntityType: true });
```

### Extracting Components

```typescript
const gcuid = 'urn:gc:uid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV';

const entityType = manager.getEntityType(gcuid); // "person"
const version = manager.getVersion(gcuid);       // 1
const core = manager.getCore(gcuid);             // "01ARZ3NDEKTSV4RRFFQ69G5FAV"
```

### Comparison

```typescript
const gcuid1 = manager.generate({ entityType: EntityType.PERSON });
const gcuid2 = manager.generate({ entityType: EntityType.PERSON });

manager.equals(gcuid1, gcuid2); // false (different identifiers)
manager.equals(gcuid1, gcuid1); // true (same identifier)
```

## Configuration

GCUID Core uses [convict](https://www.npmjs.com/package/convict) for robust configuration management.

### Configuration File

Default configuration is in `config/default.json`. You can customize:

- **Database settings**: Path and logging options
- **GCUID defaults**: 
  - `defaultFormat`: Set to "v1" or "v2" (default: "v2")
  - `defaultCoreType`: "ulid" or "uuid" (default: "ulid")
  - `defaultNamespace`: For V1 format (default: "gc")
- **Alias settings**:
  - `enabled`: Enable/disable alias generation
  - `defaultContext`: Default alias context code
  - `hashAlgorithm`: Hash algorithm for aliases (sha256 or sha512)
- **V2 settings**:
  - `enabled`: Enable V2 format support
  - `aliasOnCreation`: Auto-generate alias when creating V2 GCUIDs
- **V1 settings**:
  - `enabled`: Enable V1 format support (backward compatibility)
  - `deprecated`: Mark V1 as deprecated (show warnings)
- **CLI styling**: Colors, widths, table headers
- **CLI messages**: Customizable success/error messages

### Environment Variables

Override configuration via environment variables:

```bash
export GCUID_DB_PATH=/custom/path/registry.db
export GCUID_FORMAT=v2
export GCUID_CORE_TYPE=uuid
export GCUID_ALIAS_ENABLED=true
export GCUID_ALIAS_CONTEXT=S
export GCUID_V2_AUTO_ALIAS=true
```

### Using Configuration in Code

```typescript
import { getConfig, getDbPath } from '@gcuid/core';

const config = getConfig();
const dbPath = getDbPath(); // Resolves to absolute path
const namespace = config.gcuid.defaultNamespace;
```

**See [CONFIGURATION.md](./CONFIGURATION.md) for complete documentation.**

## Logging

GCUID Core uses [Winston](https://www.npmjs.com/package/winston) for robust logging with multiple levels and transports.

### Quick Start

```bash
# Set log level
export GCUID_LOG_LEVEL=debug

# Enable file logging
export GCUID_LOG_FILE_ENABLED=true

# Use JSON format
export GCUID_LOG_FORMAT=json
```

### Programmatic Usage

```typescript
import { logInfo, logError, logDebug } from '@gcuid/core';

logInfo('GCUID minted', { gcuid: id, entityType: 'person' });
logError('Operation failed', { error: err.message });
logDebug('Validating parameters', { params });
```

**See [LOGGING.md](./LOGGING.md) for complete documentation.**

## API Reference

### GCUIDManager

#### V2 Methods (Recommended)

- `generateV2(options?: V2Options): string | V2Result` - Generate a new V2 GCUID
- `parseV2(gcuid: string): ParsedV2GCUID` - Parse a V2 GCUID into components
- `validateV2(gcuid: string): boolean` - Validate a V2 GCUID
- `createIdentityV2(options: V2IdentityOptions): IdentityV2` - Create identity with V2 GCUID
- `convertV1ToV2(v1Gcuid: string, options?: ConversionOptions): ConversionResult` - Convert V1 to V2
- `autoDetectAndParse(gcuid: string): ParsedGCUID` - Auto-detect format and parse

#### Alias Methods

- `generateAliasForGCUID(gcuid: string, context?: string): string` - Generate alias for GCUID
- `validateAlias(alias: string): boolean` - Validate alias checksum
- `parseAlias(alias: string): AliasInfo` - Parse alias into components

#### V1 Methods (Legacy Support)

- `generate(options: GCUIDOptions): string` - Generate a new V1 GCUID
- `parse(gcuid: string): ParsedGCUID` - Parse a V1 GCUID into components
- `validate(gcuid: string, options?: ValidationOptions): boolean` - Validate a V1 GCUID
- `createIdentity(options: GCUIDOptions & { metadata?: any }): Identity` - Create identity with V1 GCUID

#### Entity Type Methods (V1 Only)

- `registerEntityType(entityType: string): void` - Register a custom entity type
- `isEntityTypeRegistered(entityType: string): boolean` - Check if entity type is registered
- `getRegisteredEntityTypes(): string[]` - Get all registered entity types
- `getEntityType(gcuid: string): string` - Extract entity type from V1 GCUID

#### Utility Methods

- `getCore(gcuid: string): string` - Extract core identifier
- `equals(gcuid1: string, gcuid2: string): boolean` - Compare two GCUIDs

### Types

```typescript
// V2 Types
interface V2Options {
  coreIdType?: CoreIdType;
  customCore?: string;
  generateAlias?: boolean;
  aliasContext?: string;
}

interface V2Result {
  gcuid: string;
  alias?: string;
  core: string;
}

interface ParsedV2GCUID {
  urn: string;
  namespace: string;
  core: string;
  formatVersion: 'v2';
  raw: string;
}

interface IdentityV2 {
  gcuid: string;
  alias?: string;
  entityType?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

interface AliasInfo {
  isValid: boolean;
  context: string;
  hash: string;
  checksum: string;
  formatted: string;
}

interface ConversionResult {
  v2Gcuid: string;
  alias?: string;
  entityType: string;
  v1Format: string;
  core: string;
}

// V1 Types
interface GCUIDOptions {
  entityType: EntityType | string;
  namespace?: string;
  version?: number;
  coreIdType?: CoreIdType;
  customCore?: string;
}

interface ParsedGCUID {
  urn: string;
  namespace: string;
  identifier: string;
  entityType: string;
  version: number;
  core: string;
  formatVersion: 'v1';
  raw: string;
}

interface Identity {
  gcuid: string;
  entityType: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

enum EntityType {
  PERSON = 'person',
  ORG = 'org',
  ASSET = 'asset',
  APP = 'app',
  AGENT = 'agent'
}

enum CoreIdType {
  ULID = 'ulid',
  UUID = 'uuid'
}
```

## Design Decisions

### State Machine

GCUIDs follow a strict state lifecycle with proper transitions:
- **Reserved**: Minted but not yet bound to an identity
- **Issued**: Bound to an identity record and active
- **Superseded**: Replaced by another GCUID (duplicate found)
- **Nullified**: Invalidated due to error or catastrophic event

Valid state transitions:
- `mint`: initial → reserved
- `bind`: reserved → issued  
- `error`: reserved → nullified
- `catastrophic`: issued → nullified
- `duplicate`: issued → superseded

See [State Machine Documentation](./STATE-MACHINE.md) for complete details.

### Why ULID by default?

ULID (Universally Unique Lexicographically Sortable Identifier) offers several advantages:
- **Time-sortable**: ULIDs are sortable by creation time
- **URL-safe**: Uses Crockford's base32 alphabet
- **Compact**: 26 characters in base32
- **Compatible**: Can be converted to/from UUID

### Why 26 characters?

- ULID naturally uses 26 characters
- Provides 128 bits of uniqueness (same as UUID)
- Compact yet readable

## Running Examples

```bash
npm run build
node dist/examples.js
```

## Command Line Interface

The package includes a command-line utility for testing and working with GCUIDs.

### Installation

After building the package, you can run the CLI directly:

```bash
npm run build
node dist/cli.js <command> [options]
```

Or run the test script:

```bash
# PowerShell
.\test-cli.ps1

# Bash/sh
bash test-cli.sh
```

### CLI Commands

#### Mint a new GCUID

```bash
# Basic minting
node dist/cli.js mint person
node dist/cli.js mint org

# With UUID instead of ULID
node dist/cli.js mint person --type uuid

# With specific version
node dist/cli.js mint asset --version 2

# With metadata
node dist/cli.js mint person --metadata '{"name":"John Doe","email":"john@example.com"}'
```

#### Parse a GCUID

```bash
node dist/cli.js parse "urn:gc:uid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV"
```

#### Validate a GCUID

```bash
node dist/cli.js validate "urn:gc:uid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV"
```

#### List registered entity types

```bash
node dist/cli.js types
```

#### Register a custom entity type

```bash
node dist/cli.js register device
```

#### Show help

```bash
node dist/cli.js help
```

### CLI Output Examples

**Minting:**
```
GCUID minted successfully!
┌─────────────────────────────────────────────────────────┐
│ urn:gc:uid:person:1:01KFKM1XDKPDAWJEE2VTF5REQ9         │
└─────────────────────────────────────────────────────────┘

Entity Type: person
Version:     1
Core Type:   ulid
```

**Parsing:**
```
GCUID parsed successfully!
┌─────────────────────────────────────────────────────────┐
│ URN:         urn                                        │
│ Namespace:   gc                                         │
│ Identifier:  uid                                        │
│ Entity Type: person                                     │
│ Version:     1                                          │
│ Core:        01KFKM1XDKPDAWJEE2VTF5REQ9                 │
└─────────────────────────────────────────────────────────┘
```

**Validation:**
```
✓ GCUID is valid
  Entity Type: person
  Version: 1
  Registered Type: Yes
```

## License

Proprietary — Copyright (c) 2024–2026 NOETRONIQ Strategic Initiatives. All rights reserved.  
Author: Philippe R. Beauchamp (<prb@noetroniq.com>)  
Licensed for use and modification by the Treasury Board of Canada Secretariat.  
See [LICENSE](../../LICENSE) for full terms.
