# GCUID - Government of Canada Unique Identifier

A TypeScript monorepo project for managing Government of Canada Unique Identifiers with federated attribute retrieval capabilities.

> **Public POC release.** This repository is the standalone POC build of the GCUID identity system — evaluation- and demonstration-ready without reference to any other repo.

## Quick Start

The fastest path to a running demo is the staging environment. Use the
root-level scripts (they're the canonical entry points and work the
same way across Windows PowerShell, cmd, and POSIX shells):

```powershell
# Windows PowerShell
./start-dev.ps1
```

```cmd
:: Windows cmd
start-dev.bat
```

```bash
# Linux / macOS
./start-dev.sh
```

Or, equivalently, from `staging/`:

```bash
npm install
npm run start-all        # API + Web UI + HR / LDAP / Engineering / Finance connectors
```

Then open:

- **Web UI**: <http://localhost:5181>
- **REST API**: <http://localhost:5182>

To stop everything: `./stop-dev.sh` (or `./stop-dev.bat`, or
`npm run stop-all` from `staging/`).

For the full startup reference (ports, individual services, troubleshooting) see [SysAdmin Guidebook §3.3 Starting and stopping the stack](docs/guidebook-sysadmin.md#33-starting-and-stopping-the-stack). For what the staging environment demonstrates, see [§2.3 Full use-case catalog](docs/guidebook-user.md#full-use-case-catalog-24-scenarios) and [SysAdmin Guidebook §3.1 Personas](docs/guidebook-sysadmin.md#personas-what-the-system-models-internally).

## What this repository contains

| Path | Purpose |
|---|---|
| `staging/` | End-to-end demonstration environment: Express API (port 5182), Vite + React web UI (port 5181), four departmental connectors (HR/LDAP/Engineering/Finance, ports 5183-5186), and a CLI. This is the only "live" runtime in the repo. |
| `docs/` | The five guidebooks (architect, developer, sysadmin, tester, user) — the authoritative reference for each audience. |
| `packages/core/` | **Library only.** Provides `connector-api.ts` and `mock-sources.ts` which the staging runtime loads from `dist/`. The rest of the package (CLI, identity registry, configuration) is not wired into staging. |

## Documentation map

### Guidebooks

Authoritative references for each audience:

- **Developer Guidebook** (engineers extending the codebase) → [`docs/guidebook-developer.md`](docs/guidebook-developer.md)
- **User Guidebook** (end users of the service) → [`docs/guidebook-user.md`](docs/guidebook-user.md)
- **System Administrator Guidebook** (operators, DevOps, you running locally) → [`docs/guidebook-sysadmin.md`](docs/guidebook-sysadmin.md)
- **Architect Guidebook** (design intent and trade-offs) → [`docs/guidebook-architect.md`](docs/guidebook-architect.md)
- **Tester Guidebook** (test surface, how to add tests) → [`docs/guidebook-tester.md`](docs/guidebook-tester.md)

### Staging reference

- **Run the demo** → [SysAdmin Guidebook §3.3 Starting and stopping the stack](docs/guidebook-sysadmin.md#33-starting-and-stopping-the-stack) (canonical start/stop scripts and options)
- **What the demo shows** → [§2.3 Full use-case catalog](docs/guidebook-user.md#full-use-case-catalog-24-scenarios) (24 scenarios across 6 categories) and [§3.1 Personas](docs/guidebook-sysadmin.md#personas-what-the-system-models-internally) (3 personas with token mappings)
- **CLI reference** → [Developer Guidebook §1.5 The staging CLI](docs/guidebook-developer.md#the-staging-cli-gcuid-staging) (`gcuid-staging` command reference)
- **REST API reference** → [Developer Guidebook §1.5 Full route catalog](docs/guidebook-developer.md#full-route-catalog-160-endpoints-18-route-files) (160 endpoints across 18 route files)

## License

Proprietary — Copyright (c) 2024–2026 NOETRONIQ Strategic Initiatives. All rights reserved.
Author: Philippe R. Beauchamp (<prb@noetroniq.com>)
Licensed for use, modification, and the creation of derivative works by the Treasury Board of Canada Secretariat.
See [LICENSE](LICENSE) for full terms.

## GCUID Format

GCUIDs support two formats for backward compatibility and enhanced usability:

### V2 Format (Current, Recommended)

**Format:** `urn:gcuid:{core}`

**Example (real seed-data entry):** `urn:gcuid:01J9K2M3N4P5Q6R7S8T9V0W1X2`

**Features:**
- Fixed length: 37 characters total (9-character prefix + 26-character core)
- Simplified structure: 26-character core only, no entity-type or version embedded
- Core encoding: `packages/core/src/crockford-base32.ts` exports `encodeCrockford(buffer, 26)` which produces a 26-character **Crockford Base32** string (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, excludes I/L/O/U to avoid confusion)
- Human-readable aliases: `GC-A-XXXX-XXXX-XXXX-C` format
- Metadata storage: Entity type and version stored separately
- Checksum validation: Built-in alias validation

> **Note on the seed data.** The 96 GCUIDs shipped in `staging/data/registry.db` were generated two ways: the first ~95 entries are deterministic hand-written identifiers (`01J9K2M3N4P5Q6R7S8T9V0W1X2` through `01KWY…`), and any additional random entries use `Math.random().toString(36)` in `staging/scripts/seed-data.ts:819`, which is plain JavaScript **base36** (all 36 alphanumeric, not 32). New GCUIDs created through the live API use the library's proper Crockford encoder. The format documentation here describes the library, not the seed generator.

#### Alias Format

V2 GCUIDs can have human-readable aliases for easier sharing:

```
GC-{CONTEXT}-{HASH}-{HASH}-{HASH}-{CHECKSUM}
```

- **GC**: Global Citizen prefix
- **CONTEXT**: Single letter (A=alias, S=system, Q=query, T=temporary, P=persistent)
- **HASH**: 12-character hash of core (3 groups of 4)
- **CHECKSUM**: ISO 7064 MOD 37,36 validation digit

**Example (real seed-data entry):** `GC-A-Y80J-CYQ9-KGT7-O`

### V1 Format (Legacy, Supported for backward compatibility)

**Format:** `urn:gc:uid:{entity-type}:{version}:{core}`

**Example:** `urn:gc:uid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV`

**Components:**
- `urn:gc:uid`: Fixed URN prefix (note the **lowercase** `gc`, vs V2's `gcuid`)
- `entity-type`: Type of entity (person, org, asset, app, agent, or custom)
- `version`: Version number (default: 1)
- `core`: 26-character identifier

> **Not exercised in the seed data.** The 96 pre-seeded identities are all V2 (`urn:gcuid:…`). The V1 parser path is implemented in `packages/core/src/gcuid.ts` and tested by unit tests, but no live V1 GCUIDs ship with the POC. New GCUIDs created through the live API use V2.

## Core Library

This repository also ships a reusable TypeScript library under
[`packages/core/`](packages/core/) that implements the GCUID format and
provides connector helpers. The live staging runtime imports two modules
from it:

```typescript
// Used by staging/scripts/start-connectors.ts to wire up the four
// departmental connectors.
import { ConnectorAPIServer, ConnectorAPIClient } from '@gcuid/core';
import {
  createHRSystemSource,
  createLDAPSource,
  createDepartmentSource,
} from '@gcuid/core';
```

For the full library API surface, including the Identity Registry
and CLI tools that are not wired into staging, see
[`packages/core/README.md`](packages/core/README.md).

> **Operational scope.** This POC's primary deliverable is the end-to-end
> staging demonstration. The library exports many types and helpers
> (`IdentityEntityRegistry`, the convict-based config system, the
> Winston logger, the enhanced-matching engine) that the staging
> runtime does **not** exercise. They are documented in the
> `packages/core/README.md` for users who want to consume the library
> from another project, but they are not part of what the staging
> demo itself shows.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation

From the repository root:

```bash
npm install                   # installs all workspace packages
./start-dev.sh                # Linux/macOS
# OR
./start-dev.ps1               # Windows PowerShell
# OR
start-dev.bat                 # Windows cmd
```

### Verify

The PoC ships pre-seeded with sample data. Once `start-dev` reports
all services healthy:

```bash
curl http://localhost:5182/health
curl http://localhost:5183/health
cd staging && npm run cli -- admin stats
```

`admin stats` should report `Total Identities: 96 (28 active + 49 provisional + 11 under_review + 5 suspended + 3 archived)`, and the four connector health endpoints
should return `{"status":"healthy",...}`.
