# Developer Guidebook

**For**: Engineers extending, debugging, or contributing to the GCUID-POC codebase.
**Not for**: End users (see [User Guidebook](guidebook-user.md)), operators (see [SysAdmin Guidebook](guidebook-sysadmin.md)), or design reviewers (see [Architect Guidebook](guidebook-architect.md)).

This guidebook walks the codebase so you can make changes confidently.

## Table of contents

| # | Section | What's covered |
|---|---|---|
| 1.1 | [Who this is for](#11-who-this-is-for) | Audience model, prerequisites, what you should already know |
| 1.2 | [How the project is organized](#12-how-the-project-is-organized) | Top-level directory map, workspace model, build artifacts |
| 1.3 | [Setting up a local dev environment](#13-setting-up-a-local-dev-environment) | Dependencies, `start-dev.sh`/`start-dev.bat`/`start-dev.ps1`, port allocation |
| 1.4 | [The core packages](#14-the-core-packages) | `@gcuid/core` deep dive: source API, connector API, sqlite-source-adapter |
| 1.5 | [The API layer](#15-the-api-layer) | Express routes in `staging/api/routes/`, shared lib in `staging/api/lib/` |
| 1.6 | [The Web UI layer](#16-the-web-ui-layer) | React + Vite, pages and components, the API client |
| 1.7 | [The connector system](#17-the-connector-system) | Plan B B3 architecture, how connectors proxy to sources |
| 1.8 | [Library & dependency catalog](#18-library--dependency-catalog) | Custom modules, third-party deps (`better-sqlite3`, `express`, `xstate`, `winston`), and why each was chosen |
| 1.9 | [Database schema](#19-database-schema) | `registry.db` and source DBs, db-paths resolver |
| 1.10 | [Adding a new connector](#110-adding-a-new-connector) | Worked example: clone `conn-hr` to add a new department source |
| 1.11 | [Adding a new API endpoint](#111-adding-a-new-api-endpoint) | Worked example: extending `/api/hr/employees` |
| 1.12 | [Testing and debugging](#112-testing-and-debugging) | Running smokes, jest, reading logs, the invariants smoke |
| 1.13 | [Build, package, ship](#113-build-package-ship) | `npm run build`, workspace boundaries |

## 1.1 Who this is for

This guidebook is for engineers who need to **modify, debug, or extend** the GCUID-POC codebase. That includes:

- Engineers adding a new connector (department source)
- Engineers adding a new API endpoint
- Engineers investigating a bug in the lookup flow
- Engineers porting the local-only stack to a deployment target
- Engineers maintaining this POC and shipping fixes or new features

### What you should already know

- **TypeScript / Node.js**: comfortable with ES modules, async/await, and the Node ecosystem. The codebase targets Node 18+ (uses native `fetch`).
- **SQL**: comfortable reading and writing SQLite queries. The runtime uses `better-sqlite3`.
- **React**: basic component model, hooks, JSX. The Web UI is Vite + React + TypeScript.
- **Express**: familiar with middleware-based routing. The API layer is Express.
- **Git**: the project uses a multi-commit cadence (one phase = one commit) so you can review and bisect at the phase boundary.

### What you do NOT need to know

- The federal identity domain. The [Architect Guidebook](guidebook-architect.md) explains the GCUID domain model in plain language; you can read it if a particular identity-state transition or attribute-mapping decision looks puzzling.
- The previous proprietary source. This is the public POC fork; the canonical doc for "what's in the original that's not here" is the README's "Public POC release" notice.

### How to use this guidebook

Each section is self-contained. If you're adding a connector, you can read §1.7 (the connector system) and §1.9 (adding a new connector) without reading §1.5 (the API layer) end-to-end. The "See also" links at the bottom of each section point at the canonical reference docs for the topic — when this guidebook says "see the architecture doc," follow the link rather than re-deriving the content.

The companion to this guidebook is the [Tester Guidebook](guidebook-tester.md) — once you've made a change, that's where to find the recipes for verifying it (smokes, jest, the invariants smoke).

## 1.2 How the project is organized

GCUID-POC is a **TypeScript monorepo** with a single workspace pattern. The top-level layout is:

```
E:\GitHub\GCUID-POC\
├── README.md                  # the project's front door
├── package.json               # workspace root (workspaces: ["packages/*"])
├── tsconfig.json              # base TS config; per-package overrides via tsconfig.json
├── start-dev.sh               # canonical entry point — POSIX
├── start-dev.bat              # canonical entry point — Windows cmd
├── start-dev.ps1              # canonical entry point — Windows PowerShell
├── stop-dev.sh                # canonical stop — POSIX
├── stop-dev.bat               # canonical stop — Windows cmd
├── run-smokes.sh              # canonical smoke runner — POSIX
├── run-smokes.bat             # canonical smoke runner — Windows cmd
├── run-smokes.ps1             # canonical smoke runner — Windows PowerShell
├── scripts/                   # cross-platform dispatchers + smoke tests
│   ├── run-dev.js             # dispatch start-dev / stop-dev by OS
│   ├── run-smokes.js          # orchestrator for smokes
│   └── smoke-*.ts             # the 5 smokes
├── docs/                      # project-level reference docs + guidebooks
│   └── guidebook-*.md         # the 5 guidebooks (this one, plus 4 siblings)
├── packages/                  # npm workspaces
│   └── core/                  # the @gcuid/core library
│       ├── src/               # TS source
│       ├── dist/              # build output (consumed by staging/)
│       └── (legacy historical artifacts preserved but not part of the active codebase)
├── staging/                   # the live runtime
│   ├── api/                   # Express server (port 5182)
│   ├── web-ui/                # Vite + React UI (port 5181)
│   ├── scripts/               # start-* and seed-data launchers
│   ├── config/                # JSON configs (connectors, sources, seed)
│   ├── data/                  # runtime SQLite files (registry.db, logs.db, sources/*.db)
│   ├── logs/                  # per-service log files (when running)
│   ├── __tests__/             # jest test suites
│   ├── package.json           # staging's package.json — npm scripts live here
│   ├── STARTUP-GUIDE.md       # canonical operational doc
│   └── USE-CASES.md           # the demo personas and end-to-end flows
├── (root scripts: start-dev, stop-dev, run-smokes + their .bat/.ps1 variants)
```

### Workspace model

The root `package.json` declares `workspaces: ["packages/*"]` — this is **a flat npm workspace**. The actual runtime (`staging/`) is **NOT a workspace package**; it has its own `package.json` and is treated as a sibling project. This is intentional:

- `packages/core` is a **library** that the staging runtime imports (the staging `tsconfig.json` points at `packages/core/dist/` for compiled JS types)
- `staging/` is the **application** — it has its own deps, scripts, and build

The npm scripts you use day-to-day (`npm run start-all`, `npm run stop-all`, `npm run smoke`) **are at the staging package level**, not the workspace root. The workspace root only runs `npm run build`, `npm run test`, `npm run clean` — all of which delegate to the workspace packages.

### Build artifacts

- `packages/core/dist/` is regenerated by `npm run build` at the workspace root (which runs `tsc -p tsconfig.json` for each workspace package). The staging runtime imports compiled JS from this directory.
- `staging/api/` has no compile step — `tsx` runs the TS source directly.
- `staging/web-ui/dist/` is regenerated by Vite's `npm run build` (not run by default; only for production-bundle testing).

### Where to find what

| Looking for… | Look in… |
|---|---|
| The HTTP API server | `staging/api/server.ts` (entry point) |
| API routes | `staging/api/routes/<resource>.ts` |
| API shared logic | `staging/api/lib/<topic>.ts` |
| Connector code | `packages/core/src/connector-api.ts` (compiled to `packages/core/dist/`) |
| Source-server code | `packages/core/src/source-api.ts` + `sqlite-source-adapter.ts` |
| Web UI pages | `staging/web-ui/src/pages/<Page>.tsx` |
| Web UI components | `staging/web-ui/src/components/<Component>.tsx` |
| Database schema (DDL) | `staging/data/schema/*.sql` |
| Connector configs | `staging/config/connectors/conn-<id>.json` |
| Source configs | `staging/config/sources/src-<id>.json` |
| Smoke tests | `scripts/smoke-*.ts` |
| Unit tests | `staging/**/__tests__/*.test.ts` |

### Legacy historical artifacts (out of scope)

The codebase may contain historical artifacts (legacy directories and files preserved from earlier iterations). These are **not part of the active POC** — they're kept for reference only. The active POC uses only the directories shown in the tree above.

If you encounter unfamiliar files or directories while exploring the codebase, they're likely legacy artifacts and can be ignored. The active POC scope is the directories documented in this section.

## 1.3 Setting up a local dev environment

This section is the canonical recipe for getting the project from "I just cloned the repo" to "the stack is running and I can hit the Web UI."

### Prerequisites

- **Node.js 18+** (the API uses native `fetch`, AbortSignal.timeout, and other Node 18 features). Node 20 LTS recommended.
- **npm 9+** (workspaces + overrides support).
- **A POSIX-ish shell** for running the shell scripts. On Windows, use **git-bash** (which Hermes provides out of the box) for any `bash` commands. PowerShell and cmd are also supported for the canonical ops scripts via `start-dev.ps1` / `start-dev.bat`.
- **SQLite CLI** (optional, only for manual DB inspection). The runtime uses `better-sqlite3` which ships its own native binding.

### Initial clone + install

```bash
git clone https://github.com/phi-beta/GCUID-POC.git
cd GCUID-POC
cd staging
npm install
cd ..
```

The `staging/npm install` is the only install step — it pulls `better-sqlite3`, `express`, `react`, `vite`, `tsx`, and friends. The root `package.json` has no runtime deps (its devDependencies are just `typescript` for workspace builds).

### First start

From the repo root:

```bash
./start-dev.sh         # POSIX / git-bash
# or
./start-dev.bat        # Windows cmd
# or
./start-dev.ps1        # Windows PowerShell
```

What this does (in order):

1. **Starts the API server** on `:5182` (registers 4 source_systems, runs the seed migration from `e5c3b8c` if needed, binds to port)
2. **Starts the four source servers** on `:5188-5191` (each one self-bootstraps its DB if missing, then binds to its port)
3. **Starts the four connector servers** on `:5183-5186` (each loads its connector JSON config, binds to its port, and registers with the API's `/api/connectors` catalog)
4. **Starts the Web UI** on `:5181` (Vite dev server with hot reload)

The whole startup takes about 8-12 seconds. When it's ready you'll see logs in your terminal saying "✅ Source server running at http://localhost:5188" (etc.) and "Local: http://localhost:5181/" from Vite.

### Verify the stack is up

After startup, hit these URLs in a browser:

| URL | What you should see |
|---|---|
| `http://localhost:5181/` | The Web UI dashboard (4 source servers, all healthy) |
| `http://localhost:5182/health` | `{"status":"ok"}` JSON |
| `http://localhost:5182/api/system/dashboard` | Full system state including the 4 source-server health entries |
| `http://localhost:5188/health` | HR source server health (unauthenticated `/health` probe) |

Or run the orchestrator's invariants smoke from a separate terminal:

```bash
./run-smokes.sh
```

Expected: `=== smoke-invariants-runtime: 39/39 assertions passed ===` and `=== smoke-cs-4.1-startup-cycle: 20/20 assertions passed ===`.

### Ports you'll need to know

| Port | Service | Auth |
|---|---|---|
| 5181 | Web UI (Vite dev server) | None |
| 5182 | API server (Express) | Bearer token for `/api/admin/*` and `/api/connectors/*` |
| 5183 | HR connector | `staging_hr_token_12345` |
| 5184 | LDAP connector | `staging_ldap_token_12345` |
| 5185 | Engineering connector | `staging_eng_token_12345` |
| 5186 | Finance connector | `staging_fin_token_12345` |
| 5187 | **reserved** for `ea-mcp-bridge` (do not use) | — |
| 5188 | HR source server | `gcuid_source_hr_token_12345` |
| 5189 | LDAP source server | `gcuid_source_ldap_token_12345` |
| 5190 | Engineering source server | `gcuid_source_engineering_token_12345` |
| 5191 | Finance source server | `gcuid_source_finance_token_12345` |
| 11434 | (often) Ollama if you have it — irrelevant to GCUID | — |

If you're behind a port conflict, the canonical port registry lives at `E:\github\.dev-ports.json` (outside this repo, at `e:\github\`). Update it if you remap.

### Stopping the stack

```bash
./stop-dev.sh          # POSIX / git-bash
# or
./stop-dev.bat         # Windows cmd
```

This iterates through the canonical port list and force-kills whatever is listening. **It does not gracefully shut down** — the API's WAL mode ensures SQLite consistency on next start, but you may see "Address already in use" warnings on the next `./start-dev.sh` if a previous instance didn't fully release its port. Re-run stop-dev and try again.

### Common dev-environment issues

**"EADDRINUSE :5182"** — port 5182 is held by a previous API instance. Run `./stop-dev.sh` and try again. On Windows, occasionally `taskkill /F` is needed if a tsx.cmd shim is holding the port.

**"Cannot find module 'better-sqlite3'"** — `npm install` in `staging/` was skipped. Run it.

**"Module 'foo' not found" at startup** — the staged build of `@gcuid/core` is out of sync with the source. Run `npm run build` at the repo root to recompile `packages/core/dist/`, then restart.

**The Web UI starts but shows "Unreachable" for all sources** — the source servers didn't bind. Check the `start-dev.sh`/`start-dev.bat` console output for EADDRINUSE or seed errors. (Per-source log files are not produced — all sources log to the parent terminal.) See the [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md) for the recipe.

**Web UI hot reload doesn't pick up changes** — Vite's file watcher sometimes misses files added after start. Restart `./start-dev.sh` if you add a new file under `staging/web-ui/src/`.

### What's in your dev environment after first start

- 9 node processes (1 API + 4 connectors + 4 sources); the Web UI is Vite's dev server, also a node process
- 6 SQLite databases under `staging/data/` (`registry.db`, `logs.db`, and `sources/conn-{hr,ldap,engineering,finance}.db`)
- 9 PID files under `staging/data/` (`.api.pid`, `.connectors.pid`, `.web.pid`, `.sources.pid`, `.source-*.pid`) — used by `stop-dev` to identify and kill processes. These are `.gitignore`d.
- Log files under `staging/logs/` (when running) — useful for post-mortem

### Next: editing

Now that the stack is up, you're ready to make changes. The next sections walk you through the codebase:

- §1.4 — the `@gcuid/core` library
- §1.5 — the API layer
- §1.6 — the Web UI layer
- §1.7 — the connector system (Plan B B3)

When you change code, the **Vite dev server hot-reloads** the Web UI on file save; the **API server does not** — restart `./start-dev.sh` after any change to `staging/api/` to pick up the change. Connector / source server code lives in `packages/core/dist/` (compiled from `packages/core/src/`); run `npm run build` at the repo root then restart.

## 1.4 The core packages

This section is the deep dive into `packages/core/` — the `@gcuid/core` library that the staging runtime loads from.

### What `@gcuid/core` actually does in this POC

The staging runtime uses **only two compiled entry points** from the core library:

| Staging caller | Imports from `@gcuid/core/dist/` | Purpose |
|---|---|---|
| `staging/scripts/start-sources-all.ts` | `SourceAPIServer`, `createSqliteSourceProvider`, `SourceConfig` (via `index.js`) | Each of the 4 source servers |
| `staging/scripts/start-connectors.ts` | `ConnectorAPIServer`, `SourceAPIClient` | Each of the 4 connector servers |

That's it. **Every other file in `packages/core/src/` is library-only** — it's available for other consumers but not wired into the staging runtime. The README's "What this repository contains" table calls this out: `packages/core/` provides `connector-api.ts` and `mock-sources.ts` (plus everything else that compiles) but the staging runtime only loads from `dist/` for the symbols listed above.

### The two wired-in modules

#### `connector-api.ts` — `ConnectorAPIServer` + `SourceAPIClient`

`packages/core/src/connector-api.ts` (~17 KB / ~470 lines) defines the **connector HTTP server**. Each of the 4 connector processes loads this. Its surface:

```
GET    /health          — unauthenticated, returns { status: 'ok', sourceId, ... }
GET    /info            — authenticated, returns connector metadata
POST   /search          — authenticated, body: { sourceId, attributes }
GET    /records/:id     — authenticated, returns the entity record
PATCH  /record/:id      — authenticated, mutates one attribute field
GET    /records?since=… — authenticated, returns delta since timestamp
```

The connector server is intentionally thin — its main responsibility is **HTTP proxying to its upstream source server** (the `SourceAPIClient` does the actual HTTP call to `:5188-5191`).

#### `source-api.ts` — `SourceAPIServer` + `SourceAPIClient` + `createSqliteSourceProvider` + `SourceConfig`

`packages/core/src/source-api.ts` (~15 KB / ~417 lines) defines the **source HTTP server** and its typed client. Each of the 4 source-server processes loads `SourceAPIServer` with a `SourceDataProvider` (constructed via `createSqliteSourceProvider`) and a `SourceConfig` (loaded from `staging/config/sources/src-<id>.json`).

The source server's surface mirrors the connector's (intentionally — they're the same wire format):

```
GET    /health          — unauthenticated, returns { sourceId, status, recordCount, latencyMs }
GET    /info            — authenticated
POST   /search          — body: { attributes }
GET    /records/:id     — singular record
PATCH  /records/:id     — mutate one field
GET    /records?since=… — delta
```

`SourceAPIClient` is the typed client used by the connector server when it needs to fetch from the upstream. Same symbols, opposite role.

#### `sqlite-source-adapter.ts` — `createSqliteSourceProvider`

`packages/core/src/sqlite-source-adapter.ts` (~5.8 KB / ~206 lines) is the **SQLite-backed implementation of `SourceDataProvider`**. It opens a SQLite file (e.g. `staging/data/sources/conn-hr.db`) and exposes the record operations the source server needs. This is what makes the source server pluggable: the `SourceAPIServer` doesn't know it's reading SQLite; it just calls the `SourceDataProvider` interface.

### The unwired library

The other ~30 source files in `packages/core/src/` are **library exports that nothing in staging consumes today**. They include:

| File | What it provides | Used by staging? |
|---|---|---|
| `registry.ts` | The identity registry's storage layer | ❌ No — staging has its own `staging/api/lib/db-*.ts` |
| `identity-registry.ts`, `identity-state-machine.ts` | Identity CRUD + state transitions | ❌ No |
| `fuzzy-matching.ts`, `enhanced-matching-engine.ts` | Fuzzy attribute matching | ❌ No — staging uses exact-match lookups |
| `alias.ts`, `crockford-base32.ts` | GCUID encoding (V1/V2 format) | ❌ No — staging generates IDs differently |
| `data-normalization.ts` | Attribute normalization for matching | ❌ No |
| `push-client.ts` | Push-cache client helper | ❌ No |
| `migrate-to-v2.ts` | Schema migration tooling | ❌ No |
| `examples-*.ts`, `*-examples.ts`, `authoritative-source-examples.ts` | Demo / example code | ❌ No |
| `cli-new.ts` | archived (see commit `750486c`) | ❌ No — placeholder, never built out |
| `connector-test-utils.ts`, `connector-integration-tests.ts` | Test helpers for connector developers | ❌ No — not exercised by staging smoke tests |

These files are part of the **public surface of `@gcuid/core`** but they're not used by this POC's staging runtime. If you're looking at the code and wondering "why isn't this wired up?" — it's because the staging POC was deliberately scoped down to demonstrate the connector-source separation (Plan B B3), not the full matching/registry/encoding stack. The README's "Public POC release" notice is the high-level explanation; see the [Architect Guidebook §4.8 Trade-offs taken](guidebook-architect.md) for why each was deferred.

### The other workspace packages

The monorepo has **4 workspace packages** declared in `package.json` at the root, not just `@gcuid/core`. The other three are smaller libraries that **no staging code currently imports** but are still built as part of `npm run build --workspaces`:

| Package | Source files | What it provides | Used by staging? |
|---|---|---|---|
| `@gcuid/core` | 32 .ts files in `packages/core/src/` | The runtime library — see [§1.4 above](#14-the-core-packages) | ✅ Yes (via dist/) |
| `@gcuid/federation` | 1 .ts file (`packages/federation/src/index.ts`, 78 lines, 2.2 KB) | `FederationManager` class — a federated-entity coordinator. Exports `FederatedEntity`, `FederationAdapter` interfaces and the `FederationManager` class. The class itself is a thin shell that delegates to registered adapters (no adapters ship today) | ❌ No — declared but no consumers |
| `@gcuid/attributes` | 2 .ts files (`packages/attributes/src/index.ts` 7 KB / 274 lines + `examples.ts` 11 KB) | `AttributeManager` class — attribute-level CRUD with `Attribute` and `AttributeQuery` types. Wraps registry lookups with attribute-specific helpers | ❌ No — declared but no consumers |
| `@gcuid/api` | 1 .ts file (`packages/api/src/index.ts`, 73 lines, 2 KB) | `GCUIDAPI` class — a thin wrapper that composes `FederationManager` + `AttributeManager` + registry + matching into a single API object. Has the dependency graph: depends on `@gcuid/core`, `@gcuid/federation`, `@gcuid/attributes` | ❌ No — declared but no consumers |

These three packages are **declared in the workspace graph and built by `npm run build`** but not imported by anything in `staging/`. They exist as the "next layer up" that would compose `@gcuid/core`'s primitives into a higher-level API. Whether they're "needed" depends on what you want to build next:

- If you want a **single-process library** that wires up `GCUIDManager` + `IdentityRegistry` + `FederationManager` + `AttributeManager` into a unified object — that's what `@gcuid/api` is for. The staging POC skipped it because the staging runtime is HTTP-first (every operation crosses a process boundary to enforce the connector→source split).
- If you want **federation across multiple identity registries** — that's what `@gcuid/federation` is for. The staging POC skipped it because all 4 source DBs are local SQLite files, not separate registries.
- If you want **attribute-level ergonomics over the registry** — that's what `@gcuid/attributes` is for. The staging POC uses direct SQL via `staging/api/lib/connector-resolver.ts` instead.

When you change `@gcuid/core` source code, the build order is: `core` → `federation` (depends on core) → `attributes` (depends on core + federation) → `api` (depends on core + federation + attributes). `npm run build --workspaces` handles this automatically. None of `federation`, `attributes`, or `api` are imported by staging, so changes to those packages are non-load-bearing for the running stack.

### The full `packages/core/src/` inventory

Beyond the 2 wired-in modules (§1.4 above), `@gcuid/core/src/` contains **30 more source files** spanning registries, identity lifecycle, fuzzy matching, encoding, examples, and CLI stubs. Below is the complete catalog with the major algorithms explained.

#### Identity & encoding primitives

| File | Size | Exports | What it does |
|---|---|---|---|
| `index.ts` | 25 KB / 928 lines | `GCUIDManager`, `Identity`, `IdentityV2`, `EntityType`, `CoreIdType`, `GCUIDFormatVersion`, ~20 types | The barrel + main `GCUIDManager` class (V1 + V2 generation, parsing, validation). V2 is `urn:gcuid:{26-char Crockford core}`; V1 is the legacy 5-segment form. Also defines `GCUID_V1_REGEX` and `GCUID_V2_REGEX` for parse/validate. |
| `alias.ts` | 9 KB / ~310 lines | `generateAlias`, `validateAlias` | Human-friendly alias generation for GCUIDs (e.g. `urn:gcuid:abc123 → @alice@hr`). V1 only; V2 makes aliases optional. |
| `crockford-base32.ts` | 6 KB / 231 lines | `CROCKFORD_ALPHABET`, `uuidToCrockford`, `ulidToCrockford`, `isValidCrockford` | The **Crockford Base32 encoder** — converts 128-bit UUID/ULID cores into 26-character base32 strings (omits I/L/O/U to avoid confusion). Used by `GCUIDManager` for V2 generation. |
| `logger.ts` | 6 KB / ~225 lines | `logger`, `logDebug`, `logError` | The core's winston-based logger. The staging API uses its own logger (`staging/api/lib/logging/logger.ts`) rather than this one. |

#### Identity lifecycle & state machine

| File | Size | Exports | What it does |
|---|---|---|---|
| `state-machine.ts` | 6.3 KB / 224 lines | `IdentityState`, `StateTransition`, `validateTransition`, `getValidTransitions`, `canTransition`, `gcuidStateMachine` | The base **identity state machine** (xstate-based). Defines states (`provisional`, `active`, `under_review`, `suspended`, `retired`, `archived`) and the allowed transitions. `validateTransition(state, event)` returns the next state or throws. |
| `identity-state-machine.ts` | 11 KB / 319 lines | `IdentityEntityState` enum, state machine | A second state machine for **identity entities** (separate from `IdentityState`). Likely the per-entity lifecycle (provisioning → linking → active → purged). |
| `identity-registry.ts` | 14 KB / ~440 lines | `IdentityRegistry`, `RegistryEntry`, `RegistryQuery`, `RegistryStats` | The storage layer for identities. Wraps `better-sqlite3` with type-safe queries. Staging doesn't use this — staging has its own `staging/api/lib/db-*.ts` registry. |
| `registry.ts` | 16 KB / ~520 lines | `IdentityOrchestrator`, `CentralizedMatcher`, plus others | The orchestration layer — composes registry + matching + state-machine into a higher-level API. Staging doesn't use this directly. |
| `identity-orchestration.ts` | 18 KB / 568 lines | `DuplicateDetectionResult`, `IdentityOrchestrator` | Multi-step orchestration (provision → match → link → activate). Includes **duplicate detection** logic (find identities with overlapping attributes). |
| `migrate-to-v2.ts` | 13 KB / ~430 lines | migration CLI | Tooling to migrate V1 GCUIDs to V2 format. Run via `npm run migrate -w @gcuid/core`. |

#### Matching algorithms (the major algorithms)

| File | Size | Algorithm |
|---|---|---|
| `fuzzy-matching.ts` | 16 KB / 535 lines | **Levenshtein-based fuzzy match** with attribute weighting. The exported `MatchResult` interface scores candidates by string similarity (Levenshtein distance normalized to 0..1) + per-field weights from `matching-config.ts`. Returns top-N candidates above a configurable threshold. |
| `enhanced-matching-engine.ts` | 16 KB / 559 lines | **Enhanced match** — combines fuzzy + exact + phonetic + abbreviation-expansion. Returns `EnhancedMatchResult` with score breakdown. Designed for typo-tolerant search. |
| `data-normalization.ts` | 12 KB / 452 lines | **Normalization pipeline** — strips diacritics, lowercases, removes punctuation, normalizes whitespace, handles common abbreviations ("St" → "Street"). Input to both matchers. Exports `RecordNormalizer` + `NormalizedRecord`. |
| `matching-config.ts` | 11 KB / 431 lines | **Matching config** — `AttributeMatchingStrategy` per attribute (which algorithm, what threshold, what field weight). Default config plus per-attribute overrides. |
| `authoritative-source.ts` | 22 KB / 868 lines | **Source schema definition** — `AuthoritativeSourceSchema` describes the table/columns/keys for an authoritative source, plus transformation helpers. The schema model that `connector-api.ts` consumes at runtime. |

#### Push-cache client + connector helpers

| File | Size | Exports |
|---|---|---|
| `push-client.ts` | 5.9 KB / 172 lines | `PushConnectorClient`, `PushConnectorClientConfig`, `IngestRecord`, `IngestResult` — the typed client a source uses to push records to a connector. Used in the `push-cache` access mode (sources notify connectors of changes rather than being polled). |
| `connector.ts` | 4.3 KB / ~135 lines | The **base connector class** that `connector-api.ts` extends. Defines the lifecycle hooks (`onSearch`, `onGet`, `onUpdate`, `onSync`). |
| `authoritative-source.d.ts` | 9 KB / ~225 lines | TypeScript declaration file for `authoritative-source.ts`. |
| `connector-test-utils.ts` | 7.2 KB / ~240 lines | Test helpers for connector developers (mock SourceAPIClient, fixture builders). Not currently exercised by staging smoke tests. |
| `connector-integration-tests.ts` | 11 KB / ~360 lines | Integration tests for connectors. Not exercised by staging smoke tests (depends on test fixtures from earlier iterations). |

#### Examples & demos

| File | Size | Purpose |
|---|---|---|
| `examples.ts` | 9.2 KB / ~290 lines | Working examples of `GCUIDManager`, `IdentityRegistry`, basic identity flow. Run via `npm run example -w @gcuid/core`. |
| `examples-v2.ts` | 15 KB / ~470 lines | V2-specific examples — V2 generation, parsing, alias flow. Run via `npm run example:v2 -w @gcuid/core`. |
| `identity-examples.ts` | 12 KB / ~380 lines | Identity lifecycle examples (provision, link, retire). |
| `registry-examples.ts` | 0.4 KB | Stub (1-line re-export). |
| `orchestration-examples.ts` | 12 KB / ~410 lines | Orchestration examples (multi-step flows). |
| `authoritative-source-examples.ts` | 27 KB / ~870 lines | The biggest example file — walks through authoring an authoritative-source schema + connector + matching config end-to-end. |
| `cli-new.ts` | 0.4 KB | CLI stub (only `#!/usr/bin/env node`). |

#### Out-of-scope example/test files

The following source files exist in `packages/core/src/` but are **not exercised by the active POC**:

- `mock-sources.ts` (and its compiled `.js` + `.d.ts` + `MOCK-SOURCES.md`) — earlier-iteration mock-source code superseded by Plan B B3; not imported
- `cli.ts` (legacy 2,486-line CLI) — not imported; superseded by `staging/cli/`
- `enhanced-matching-examples.ts`, `integration-demo.ts`, `test-mock-sources.ts` — example/test files that depended on out-of-scope symbols; not imported

These files are kept in the source tree but not part of the active POC scope. Treat them as **read-only reference** — don't add new imports of them. If you need to bring any of them into the active POC, copy the relevant logic into the appropriate active file rather than importing directly.

### Why so many unwired files?

The `@gcuid/core` library is a **full identity-platform kit**: registry + matching + state-machine + encoding + orchestration + push-cache. The staging POC wires up **only the connector/source layer** because that's the architectural decision being demonstrated. The other components are kept as a public surface so future deployments can compose them differently (single-process, federated, attribute-centric, etc.) without re-deriving them.

For the staging POC's scope, treat the unwired modules as **read-only reference**: don't add staging imports of them (it'd violate the connector-source boundary). If you need to add a new algorithm or storage layer to the library, edit the source and rebuild — the staged compilation chain will surface type errors immediately.

### The build pipeline

The `packages/core/dist/` directory is regenerated by:

```bash
# from the repo root
npm run build
```

This runs `tsc -p tsconfig.json` for `@gcuid/core` and `@gcuid/federation` (the only workspace packages). The output is JS + d.ts files in `dist/` that staging imports via `require('../../packages/core/dist/connector-api.js')`.

When you change a file in `packages/core/src/`:

1. Run `npm run build` at the repo root (or `cd packages/core && npm run build`)
2. Restart `./start-dev.sh` so the connectors/sources reload the new compiled JS

The connectors and source servers load their compiled core at startup; there's no hot-reload for compiled modules.

### Out-of-scope source files in the tree

The codebase contains some legacy source files that exist in `packages/core/src/` but are **not part of the active POC**. All of these were removed from the live source in earlier cleanup commits but are mentioned here for historical reference:

- `mock-sources.ts` — earlier-iteration "fake source" code that the connector used to call directly before Plan B B3 split source servers into separate processes. Superseded by the active source-server architecture (§1.7). Archived in commit `14acdda` (sub-phase 6.1).
- `mock-sources.{js,d.ts,d.ts.map}` — pre-built artifacts of the above. Archived in `14acdda`.
- `cli.ts` — a 2,486-line legacy CLI for `@gcuid/core` (NOT used by staging; staging has its own `staging/cli/`). Archived in `14acdda`.
- `cli-new.ts` — placeholder stub for a planned replacement CLI; never built out. Archived in `750486c`.
- `connector-test-utils.ts`, `connector-integration-tests.ts` — test scaffolding not wired into jest. Archived in `750486c`.
- `enhanced-matching-examples.ts`, `integration-demo.ts`, `test-mock-sources.ts` — example code that depended on out-of-scope symbols. Archived in `14acdda`.
- `MOCK-SOURCES.md` — documentation that went with `mock-sources.ts`. Archived in `14acdda`.
- `__tests__/mock-sources.factories.test.ts` — test file for the now-out-of-scope factory functions. Archived in `14acdda`.

If you need any of the archived logic, `git checkout <commit>^ -- <file>` brings it back into the working tree. The archived versions are preserved in git history (commits `14acdda`, `750486c`).

### Quick reference: when you change core code

| Change | Steps |
|---|---|
| Add a new HTTP route to the connector | Edit `packages/core/src/connector-api.ts`, run `npm run build`, restart `./start-dev.sh` |
| Add a new HTTP route to the source server | Edit `packages/core/src/source-api.ts`, run `npm run build`, restart |
| Change the SQLite schema or add a column | Edit `packages/core/src/sqlite-source-adapter.ts`, update `staging/data/schema/*.sql`, regenerate seed (`tsx staging/scripts/seed-data.ts --source=<name>`), restart |
| Add a new type or interface | Edit `packages/core/src/*.ts`, run `npm run build` to emit `dist/*.d.ts` so staging's TypeScript sees the new types |

The hot-reload boundaries: Vite picks up `staging/web-ui/src/` changes; `tsx` runs `staging/api/` and `staging/scripts/` directly (no compile step — restart picks them up); `packages/core/` requires `npm run build` then restart.

## 1.5 The API layer

This section is the walkthrough of `staging/api/` — the Express server that fronts every backend.

### Server entry point: `staging/api/server.ts`

`server.ts` (~375 lines) is where every route gets registered. The interesting parts:

- **Port**: defaults to `5182`; override with `PORT=<n> node ...`.
- **Base path**: `process.env.BASE_PATH` — optional URL prefix (empty in local mode).
- **App base URL**: `process.env.APP_BASE_URL` — for absolute URLs in responses (e.g. `https://example.com`).
- **Bootstrap admin**: if `GCUID_BOOTSTRAP_ADMIN_EMAIL` is set, ensures that email exists in `staging/config/users.json` with role `admin` at startup. Idempotent.
- **DB path**: defaults to local SQLite; can be redirected via `GCUID_DB_PATH` for a different storage location (loopback process, separate machine, etc.).
- **CORS + JSON body parsing**: open by default (`cors()` with no options); `express.json()` parses bodies up to the default limit.
- **Static UI**: serves `staging/web-ui/dist/` if it exists (production build); the dev mode is Vite on `:5181` which proxies `/api/*` to `:5182`.

The route registrations (from `server.ts:231-248`):

```typescript
app.use('/api/user',         userRoutes);          // User Portal (public lookup)
app.use('/api/hr',           hrRoutes);            // HR System (authoritative source)
app.use('/api/ldap',         ldapRoutes);          // LDAP/AD (authoritative source)
app.use('/api/engineering',  engineeringRoutes);   // Engineering Department
app.use('/api/finance',      financeRoutes);       // Finance Department
app.use('/api/gcuid',        adminRoutes);         // GCUID Portal (central coordination)
app.use('/api/caes',         caesRoutes);          // CAES (Common Attribute Exchange Service)
app.use('/api/flags',        flagsRoutes);         // PoC feature flags
app.use('/api/log-levels',   logLevelsRoutes);     // Runtime log level settings
app.use('/api/logs',         logsRoutes);          // Log viewer (read-only)
app.use('/api/connectors',   connectorsRoutes);    // Connector configurations
app.use('/api/system',       systemDashboardRoutes); // System dashboard + log mgmt
app.use('/api/bulk',         bulkRoutes);          // Bulk import/export
app.use('/api/hooks',        hooksRoutes);          // Event-driven hooks (subscribe/poll/verify)
app.use('/api/gcuid-request', gcuidRequestRoutes); // Portal GCUID request (preview + submit)
app.use('/api/tools',        toolsRoutes);         // System tools (GCUID purge, etc.)
app.use('/api/ux-config',     uxConfigRoutes);      // UX appearance configuration
app.use('/api/policies',     policiesRoutes);      // Application access policies
```

That's **18 route groups** at 19 source files (one of those files — `caes.ts` — also exports `upsertConnectorMappings` for the seed-migration flow). The error handler is registered last so all routes bubble through it.

### Route inventory

#### Route file summary

| Route file | Size | Purpose |
|---|---|---|
| `routes/user.ts` | 78 KB | Self-registration, profile lookup, identity lifecycle, attribute updates — the bulk of the end-user surface |
| `routes/admin.ts` | 125 KB | The biggest route file; manages identities, source systems, connectors, admin operations, the seed migration (`e5c3b8c`'s `seedSourceSystems`) |
| `routes/caes.ts` | 98 KB | Common Attribute Exchange Service — query, bulk fetch, attribute mappings, `upsertConnectorMappings` |
| `routes/connectors.ts` | 42 KB | The connector-config API: `GET /:id/ping`, `GET /:id/health`, `GET /:id/sync`, CRUD on connector configs |
| `routes/system-dashboard.ts` | 46 KB | The dashboard payload: connector health, source-server health, log-management endpoints |
| `routes/gcuid-request.ts` | 38 KB | The user-facing GCUID-request flow: preview-then-submit, source-link bundling |
| `routes/engineering.ts`, `routes/finance.ts`, `routes/hr.ts`, `routes/ldap.ts` | ~30 KB each | Per-system portals (CRUD on source records, connector-info proxy) |
| `routes/policies.ts` | 29 KB | Application access policies (RBAC, attribute-access control) |
| `routes/bulk.ts` | 20 KB | Bulk import/export (CSV/JSON) |
| `routes/hooks.ts` | 25 KB | Event-driven hooks (subscribe/poll/verify) |
| `routes/ux-config.ts` | 35 KB | UX appearance config (theme tokens, runtime overrides) |
| `routes/tools.ts` | 9 KB | System tools (GCUID purge, etc.) |
| `routes/logs.ts` | 10 KB | Log viewer (read-only — queries `logs.db`) |
| `routes/log-levels.ts` | 6 KB | Runtime log level configuration |
| `routes/flags.ts` | 7 KB | PoC feature flags |

Some route files are larger than others because they encode domain logic that didn't fit in `lib/`. When you add a new endpoint, prefer placing it in the existing route file that already owns the resource, not in `lib/`.

### Full route catalog (160 endpoints, 18 route files)

Below is the complete endpoint inventory, grouped by URL prefix. Each row shows method + path. Read-endpoints (GET) are the most numerous; mutation endpoints (POST/PUT/PATCH/DELETE) are usually per-resource.

#### `/api/gcuid` (36 endpoints)

- `DELETE /api/gcuid/source-mappings/{gcuid}/{id}`
- `DELETE /api/gcuid/source-systems/{id}`
- `GET    /api/gcuid/aliases/{gcuid}`
- `GET    /api/gcuid/audit`
- `GET    /api/gcuid/audit/{auditGcuid}`
- `GET    /api/gcuid/detect-duplicates`
- `GET    /api/gcuid/health`
- `GET    /api/gcuid/identifier-state/{gcuid}`
- `GET    /api/gcuid/list`
- `GET    /api/gcuid/search`
- `GET    /api/gcuid/source-mappings`
- `GET    /api/gcuid/source-mappings/{gcuid}`
- `GET    /api/gcuid/source-systems`
- `GET    /api/gcuid/stats`
- `GET    /api/gcuid/subject/{gcuid}`
- `GET    /api/gcuid/view/{gcuid}`
- `PATCH  /api/gcuid/aliases/{gcuid}/{id}/disable`
- `PATCH  /api/gcuid/aliases/{gcuid}/{id}/enable`
- `PATCH  /api/gcuid/attributes/{gcuid}`
- `POST   /api/gcuid/aliases/{gcuid}`
- `POST   /api/gcuid/aliases/{gcuid}/derive-email`
- `POST   /api/gcuid/approve/{gcuid}`
- `POST   /api/gcuid/archive/{gcuid}`
- `POST   /api/gcuid/clear-suspension/{gcuid}`
- `POST   /api/gcuid/flag-review/{gcuid}`
- `POST   /api/gcuid/identifier-state/{gcuid}/bind`
- `POST   /api/gcuid/identifier-state/{gcuid}/nullify`
- `POST   /api/gcuid/identifier-state/{gcuid}/supersede`
- `POST   /api/gcuid/merge`
- `POST   /api/gcuid/register`
- `POST   /api/gcuid/rehire/{gcuid}`
- `POST   /api/gcuid/retire/{gcuid}`
- `POST   /api/gcuid/source-mappings/{gcuid}`
- `POST   /api/gcuid/source-systems`
- `POST   /api/gcuid/suspend/{gcuid}`
- `PUT    /api/gcuid/source-systems/{id}`

#### `/api/caes` (15 endpoints)

- `DELETE /api/caes/attribute-mappings/{id}`
- `GET    /api/caes/attribute-mappings`
- `GET    /api/caes/health`
- `GET    /api/caes/match-configs`
- `GET    /api/caes/schema`
- `GET    /api/caes/self-service-attributes`
- `GET    /api/caes/stats`
- `POST   /api/caes/attribute-mappings`
- `POST   /api/caes/match`
- `POST   /api/caes/match-and-link`
- `POST   /api/caes/match-configs`
- `POST   /api/caes/resolve`
- `PUT    /api/caes/attribute-mappings/{id}`
- `PUT    /api/caes/attribute-mappings/{id}/authoritative`
- `PUT    /api/caes/match-configs/{sourceSystem}`

#### `/api/engineering` (12 endpoints)

- `DELETE /api/engineering/employees/{id}`
- `GET    /api/engineering/connector/health`
- `GET    /api/engineering/coverage-gaps`
- `GET    /api/engineering/employees`
- `GET    /api/engineering/employees/{id}`
- `GET    /api/engineering/search`
- `GET    /api/engineering/stats`
- `PATCH  /api/engineering/employees/{id}/linkage`
- `POST   /api/engineering/employees`
- `POST   /api/engineering/request-gcuid`
- `POST   /api/engineering/request-gcuid/confirm`
- `PUT    /api/engineering/employees/{id}`

#### `/api/finance` (12 endpoints)

- `DELETE /api/finance/employees/{id}`
- `GET    /api/finance/connector/health`
- `GET    /api/finance/coverage-gaps`
- `GET    /api/finance/employees`
- `GET    /api/finance/employees/{id}`
- `GET    /api/finance/search`
- `GET    /api/finance/stats`
- `PATCH  /api/finance/employees/{id}/linkage`
- `POST   /api/finance/employees`
- `POST   /api/finance/request-gcuid`
- `POST   /api/finance/request-gcuid/confirm`
- `PUT    /api/finance/employees/{id}`

#### `/api/user` (12 endpoints)

- `GET    /api/user/aliases/check`
- `GET    /api/user/aliases/{gcuid}`
- `GET    /api/user/attributes/{gcuid}`
- `GET    /api/user/history/{gcuid}`
- `GET    /api/user/lookup/{id}`
- `GET    /api/user/search`
- `GET    /api/user/verify/{gcuid}`
- `PATCH  /api/user/aliases/{gcuid}/{id}/disable`
- `PATCH  /api/user/aliases/{gcuid}/{id}/enable`
- `PATCH  /api/user/attributes/{gcuid}`
- `POST   /api/user/aliases/{gcuid}`
- `POST   /api/user/self-register`

#### `/api/hr` (10 endpoints)

- `DELETE /api/hr/employees/{id}`
- `GET    /api/hr/connector/health`
- `GET    /api/hr/connector/info`
- `GET    /api/hr/coverage-gaps`
- `GET    /api/hr/employees`
- `GET    /api/hr/employees/{id}`
- `GET    /api/hr/search`
- `GET    /api/hr/stats`
- `POST   /api/hr/employees`
- `PUT    /api/hr/employees/{id}`

#### `/api/ldap` (10 endpoints)

- `DELETE /api/ldap/users/{username}`
- `GET    /api/ldap/connector/health`
- `GET    /api/ldap/connector/info`
- `GET    /api/ldap/coverage-gaps`
- `GET    /api/ldap/search`
- `GET    /api/ldap/stats`
- `GET    /api/ldap/users`
- `GET    /api/ldap/users/{username}`
- `POST   /api/ldap/users`
- `PUT    /api/ldap/users/{username}`

#### `/api/connectors` (9 endpoints)

- `GET    /api/connectors/`
- `GET    /api/connectors/{id}`
- `GET    /api/connectors/{id}/health`
- `GET    /api/connectors/{id}/ping`
- `PATCH  /api/connectors/{id}`
- `POST   /api/connectors/{id}/event`
- `POST   /api/connectors/{id}/ingest`
- `POST   /api/connectors/{id}/register`
- `POST   /api/connectors/{id}/sync`

#### `/api/system` (9 endpoints)

- `DELETE /api/system/databases/{dbId}/tables/{tableName}/rows/{pkValue}`
- `DELETE /api/system/logs/{system}`
- `GET    /api/system/dashboard`
- `GET    /api/system/databases`
- `GET    /api/system/databases/{dbId}/tables/{tableName}`
- `GET    /api/system/health`
- `GET    /api/system/policy`
- `GET    /api/system/stats`
- `GET    /api/system/versions`

#### `/api/ux-config` (8 endpoints)

- `DELETE /api/ux-config/theme-library/{id}`
- `GET    /api/ux-config/`
- `GET    /api/ux-config/theme-library`
- `PATCH  /api/ux-config/theme-library/{id}`
- `PATCH  /api/ux-config/{scopeId}`
- `POST   /api/ux-config/theme-library`
- `PUT    /api/ux-config/`
- `PUT    /api/ux-config/theme-library/{id}`

#### `/api/hooks` (7 endpoints)

- `DELETE /api/hooks/subscriptions/{id}`
- `GET    /api/hooks/events`
- `GET    /api/hooks/subscriptions`
- `GET    /api/hooks/subscriptions/{id}`
- `PATCH  /api/hooks/subscriptions/{id}`
- `POST   /api/hooks/subscriptions`
- `POST   /api/hooks/verify`

#### `/api/policies` (6 endpoints)

- `DELETE /api/policies/{appId}`
- `GET    /api/policies/`
- `GET    /api/policies/{appId}`
- `POST   /api/policies/validate`
- `POST   /api/policies/validate-gcuid`
- `PUT    /api/policies/{appId}`

#### `/api/gcuid-request` (3 endpoints)

- `POST   /api/gcuid-request/preview`
- `POST   /api/gcuid-request/scan-linkages`
- `POST   /api/gcuid-request/submit`

#### `/api/logs` (3 endpoints)

- `GET    /api/logs/`
- `GET    /api/logs/stats`
- `GET    /api/logs/{log_id}`

#### `/api/bulk` (2 endpoints)

- `GET    /api/bulk/export`
- `POST   /api/bulk/import`

#### `/api/flags` (2 endpoints)

- `GET    /api/flags/`
- `PATCH  /api/flags/`

#### `/api/log-levels` (2 endpoints)

- `GET    /api/log-levels/`
- `PATCH  /api/log-levels/`

#### `/api/tools` (2 endpoints)

- `GET    /api/tools/gcuid/search`
- `POST   /api/tools/gcuid/delete`

### Shared logic in `staging/api/lib/`

The `lib/` directory holds the cross-route shared code. The interesting files:

| File | Size | What it does |
|---|---|---|
| `connector-resolver.ts` | 19 KB | The lookup pipeline: takes a (gcuid, attribute) request, walks the connector chain, returns the resolved attribute. Handles the direct-DB fallback path (when the GCUID_DB_PATH points at a non-loopback location, the resolver can short-circuit the source HTTP call). The `e5c3b8c` migration lives in `admin.ts` but the resolver is what calls it |
| `source-scan.ts` | 35 KB | Walks the connector/source/registry tree to discover what's running and how it relates. Used by `system-dashboard.ts` to construct the dashboard payload |
| `logging/log-events.ts` | 58 KB | The exhaustive log-event catalog: every event ID, every level, every category. Used by the logger middleware and the log viewer |
| `logging/log-types.ts` | 18 KB | The TypeScript types for log events |
| `logging/logger.ts` | 21 KB | The logger itself (writes to `logs.db`) |
| `dept-cache.ts` | 11 KB | The attribute-cache layer (push-cache / scheduled-pull modes use this for read-side caching) |
| `resolve-identifier.ts` | 6 KB | Identifier resolution helpers |
| `apply-transformation.ts` | 8 KB | Transformation helpers for connector attribute mapping |
| `db-paths.ts` | 2.4 KB | The canonical DB-path resolver (REGISTRY_DB_PATH, LOGS_DB_PATH, SOURCES_DIR, connectorDbPath) |
| `version.ts` | 1.6 KB | Build version constants |

The `db-paths.ts` module is the central DB-path resolver. Every SQLite file in the system is accessed via a path returned by this module:

```typescript
// from staging/api/lib/db-paths.ts
export const DB_BASE: string = efsBase ?? path.join(process.cwd(), 'data');
export const REGISTRY_DB_PATH: string  = path.join(DB_BASE, 'registry.db');
export const LOGS_DB_PATH: string      = path.join(DB_BASE, 'logs.db');
export const SOURCES_DIR: string       = path.join(DB_BASE, 'sources');

export function connectorDbPath(connectorId: string): string {
  return path.join(SOURCES_DIR, `${connectorId}.db`);
}
```

If you add a new SQLite file, add a getter here rather than hard-coding the path. The `dbPath` variable honours the `GCUID_DB_PATH` environment variable — point it at a different storage location to switch.

### Auth model

The API uses **Bearer token** auth for admin/connector routes. The token verification lives in each route file (or its middleware). The canonical tokens:

- `gcuid_admin_token_demo` — for `/api/admin/*`, `/api/connectors/*`, etc.
- `staging_hr_token_12345` — for the HR connector
- `staging_ldap_token_12345` — for the LDAP connector
- `staging_eng_token_12345` — for the Engineering connector
- `staging_fin_token_12345` — for the Finance connector
- `gcuid_source_<id>_token_<n>` — for the source servers (set in `staging/config/sources/src-<id>.json`)

The token comparison is constant-time in some routes, plain `===` in others. Don't change auth comparisons without understanding the security implications — see the [Architect Guidebook §4.10 Open questions](guidebook-architect.md) for the local-only stance on this.

### How a request flows

For a typical lookup (`GET /api/gcuid/<id>`):

1. Express receives the request, runs `cors()` and `express.json()` middleware
2. The `logger` middleware records the request to `logs.db`
3. `adminRoutes` (`/api/gcuid`) matches `/api/gcuid/<id>` via its router
4. The route handler reads `source_systems` from `registry.db` to find the connector_id and access_mode
5. If the access mode is `push-cache` or `scheduled-pull`, it returns from the attribute cache (via `dept-cache.ts`)
6. Otherwise, it calls `ConnectorAPIClient` (from `packages/core/dist/connector-api.js`) which proxies to the connector server on `:5183-5186`
7. The connector proxies to the source server on `:5188-5191` (via `SourceAPIClient`)
8. The source server reads from `data/sources/conn-<id>.db` and returns the record
9. The connector transforms the record per its `attributeMappings` config and returns to the API
10. The API optionally writes the attribute to the cache and returns the response to the client

Each step is logged via the structured logger. The full event chain is in `logs.db` and visible via the Web UI's log viewer (or `GET /api/logs`).

### Common dev tasks

**Add a new route to an existing resource**: edit the corresponding file in `routes/`, restart `./start-dev.sh` (the API doesn't hot-reload). The new route is available at the registered path; no other registration needed.

**Add a new route group** (e.g. `/api/audit-log`): create `routes/audit-log.ts`, export a Router, add `app.use('/api/audit-log', auditLogRoutes);` in `server.ts`. Restart.

**Add a new DB column**: edit the table-creation DDL in `admin.ts` (or wherever the table is created), update the type definitions, update the seed migration if needed. Restart.

**Change auth**: search the route file for `Authorization` / `Bearer` / token-comparison logic. Be conservative — auth changes are high-risk.

**Add a new shared helper**: put it in `lib/` if it's used by 2+ routes; put it in the route file if it's used by only 1.

### See also

- §1.4 — what `@gcuid/core` provides
- §1.7 — the connector system
- §1.9 — adding a new connector (worked example)
- §1.10 — adding a new API endpoint (worked example)
- [Architect Guidebook §4.6 Access modes](guidebook-architect.md) — what `dynamic-pull` / `scheduled-pull` / `push-cache` mean
- [SysAdmin Guidebook §3.5 Authentication tokens](guidebook-sysadmin.md) — where the tokens are configured

### The staging CLI (`gcuid-staging`)

The `gcuid-staging` CLI is the command-line operator for the staging registry. It runs against the same SQLite files that the API server uses, so it shares data state with the live HTTP API.

#### Quick start

```bash
# Via npm script (works from staging/)
npm run cli -- <command>

# Or directly
npx tsx cli/index.ts <command>
```

The CLI resolves paths relative to the current working directory, so run it from `staging/` (or anywhere whose `data/` subtree mirrors the staging SQLite layout).

#### Subcommands

Three persona-flavoured subcommand groups:

| Subcommand | Persona | Read-only? | Writes? |
|---|---|---|---|
| `user` | End user / auditor | Yes | No |
| `dept` | HR / LDAP / Engineering / Finance operator | Yes (most), No (data) | `dept data` is read-only |
| `admin` | Central GCUID registry admin | Yes (most) | `approve` / `suspend` / `retire` mutate the registry |

The CLI is wired against `data/registry.db` (central GCUID registry: `identities`, `state_history`, `source_mappings`, `audit_log`) and `data/sources/conn-hr.db` (HR connector database: `employees` table). The other connector databases (LDAP, Engineering, Finance) are read by the API but not by this CLI — use the API at `/api/ldap/*`, `/api/engineering/*`, `/api/finance/*` or the web UI for those.

#### `user` — End-user identity queries

- `user lookup <id>` — Look up by employee ID, email, or GCUID. Tries each shape in order (identities → source_mappings → email prefix) and returns the first match. Options: `-f, --format <table|json>`.
- `user search <query>` — Substring search across `identities` (name, email, entity_id). Returns up to 50 results.
- `user history <gcuid>` — State-transition history for an identity.
- `user verify <gcuid>` — Validate the GCUID format and check whether it is currently `active`.

Example: `npm run cli -- user lookup E11001` returns a table with GCUID, entity ID, state, email, name, source, created/updated timestamps.

#### `admin` — Central registry administration

- `admin list [--state <state>] [--limit <n>] [--format <table|json>]` — List identities, optionally filtered by state (`provisional`, `active`, `under_review`, `suspended`, `retired`, `archived`). Default limit: 50.
- `admin view <gcuid> [--with-history]` — Detailed identity view.
- `admin approve <gcuid> [--reason <reason>]` — Transition `provisional` / `under_review` → `active`. Default reason: `"Administrator approval"`.
- `admin suspend <gcuid>` — Transition `active` → `suspended` (also permitted from `under_review`).
- `admin retire <gcuid>` — Transition → `retired`. Tombstones the identifier token. (Allowed from `active`, `suspended`, `under_review`.)
- `admin detect-duplicates` — Scan the registry for potential duplicate groups. Reports exact `entity_id` matches and fuzzy matches based on source mappings.
- `admin search <query>` — Substring search across all `identities` fields, including JSON metadata.
- `admin audit <gcuid>` — Complete audit trail (creation + every state transition).
- `admin stats` — Comprehensive registry statistics: counts by state, by entity type, by source system, integration coverage.
- `admin health` — Health check: validates registry file, GCUID formats, checks for orphaned history rows.

#### `dept` — Departmental operator commands

The `dept` subcommands operate on the HR connector's SQLite file (`data/sources/conn-hr.db`). The cross-connector coverage report in `dept data stats` also reads the central registry.

- `dept data list [--limit <n>] [--format <table|json>]` — List all employees in the HR connector.
- `dept data view <id> [--with-gcuid]` — One employee record. `--with-gcuid` includes integration status (looks up in central registry).
- `dept data search <query> [--limit <n>] [--with-gcuid]` — Substring search across HR employee fields (name, email, department). Default limit: 20.
- `dept data stats` — HR data statistics: total employees, count by department, integration rate (joins HR employee ids against `identities.entity_id`).
- `dept connector status` — Connector status: registry online, HR DB online, integration rate. Notes that the live HTTP connector service must be started via `npm run start-connectors`.
- `dept connector test` — Run 4 connectivity tests (registry DB on disk, HR DB on disk, can query each).
- `dept connector info` — Connector configuration: type, protocol, DB paths, working directory.
- `dept monitor dashboard` — Top-line operational dashboard: total employees, total GCUIDs, counts by state, integration coverage.
- `dept monitor stats` — 24-hour activity stats: identity-state counts (with percentages) and transition volume.

#### Relationship to the HTTP API

| Operation | CLI | HTTP API |
|---|---|---|
| Identity lookup | `user lookup <id>` | `GET /api/user/lookup/{id}` |
| Identity history | `user history <gcuid>` | `GET /api/user/history/{gcuid}` |
| GCUID verify | `user verify <gcuid>` | `GET /api/user/verify/{gcuid}` |
| Search identities | `admin search <q>` | `GET /api/gcuid/search` |
| Approve identity | `admin approve <gcuid>` | `POST /api/gcuid/approve/{gcuid}` |
| Duplicate check | `admin detect-duplicates` | `GET /api/gcuid/detect-duplicates` |
| Registry stats | `admin stats` | `GET /api/gcuid/stats` |

Mutating CLI commands (`approve`, `suspend`, `retire`) write directly to `data/registry.db` — the next API call sees the change because they share the same SQLite file. The CLI does not currently update the `audit_log` table the same way the API does; use the API for full audit compliance.

#### When to use which surface

- **CLI** — fastest for read-only inspection, scripted operations, or ops automation that doesn't need the full audit log.
- **HTTP API** — use for any state mutation that needs the full audit trail and the per-system logging (`data/logs.db`).
- **Web UI** — use for ad-hoc human review and demonstrations; same data, but visualised.

#### Source files

- `staging/cli/index.ts` — entry point, command registration
- `staging/cli/commands/user.ts` — `user` subcommands
- `staging/cli/commands/dept.ts` — `dept` subcommands
- `staging/cli/commands/admin.ts` — `admin` subcommands

## 1.6 The Web UI layer

This section is the walkthrough of `staging/web-ui/` — the React + Vite frontend that surfaces every API endpoint.

### Stack

- **React 18** with **TypeScript** (strict mode)
- **Vite 5** dev server + bundler (configured in `staging/web-ui/vite.config.ts`)
- **React Router v6** for client-side routing (`App.tsx` declares the route map)
- **React Query** for server-state caching (used per-page; not centralized)
- **No component library** — every component is hand-rolled. There is no Material-UI / Tailwind / Ant Design.

### Source layout

```
staging/web-ui/src/
├── App.tsx                    (5.4 KB, the route map)
├── main.tsx                   (1.5 KB, the React root + providers)
├── api/
│   └── client.ts              (2,036 lines, the only file that talks to the API)
├── components/                (14 .tsx files, shared UI)
├── config/
│   └── portals.ts             (8 KB, route → portal metadata table)
├── context/                   (3 .tsx files: theme, datetime, portal mode)
├── data/
│   └── connectorThemePresets.ts  (57 KB, theme presets for connectors)
├── hooks/                     (6 .ts files: feature flags, pagination, sortable tables, theme)
├── pages/                     (28 .tsx files, one per route)
├── theme/                     (navTheme.ts, useScopeNavTheme.ts)
└── utils/
    └── environment.ts         (1 KB, NODE_ENV helpers)
```

Total: **48 .tsx files, 1 .ts file in api/** across `pages/` + `components/` + `context/` + `hooks/` + `theme/` + `utils/`. The biggest files are the page-level data grids (`GCUIDPortal.tsx` is 164 KB, `CAESPortal.tsx` is 122 KB, `TestingPortal.tsx` is 100 KB) — they encode their own table state, columns, and filters rather than using a shared table primitive.

### The API client (`api/client.ts`, 2,036 lines)

`client.ts` is the only file in the Web UI that talks to the API. Every other component/page imports from `api/client.ts` instead of calling `fetch` directly. The pattern:

```typescript
// example usage from any page
import { api } from '../api/client';
const result = await api.listConnectors();
```

The client exposes one class (`api`) with ~80 methods, organized by resource:

| Method group | Example methods |
|---|---|
| Identity | `getIdentity(gcuid)`, `updateIdentity(gcuid, attrs)` |
| Source systems | `listSourceSystems()`, `getSourceSystem(id)` |
| Connectors | `listConnectors()`, `getConnector(id)`, `pingConnector(id)`, `healthConnector(id)` |
| GCUID request | `previewGcuidRequest(req)`, `submitGcuidRequest(req)` |
| Bulk | `importBulk(payload)`, `exportBulk(query)` |
| Logs | `listLogs(filter)`, `getLog(id)` |
| Tools | `purgeGcuid(gcuid)`, `resetConnector(id)` |
| UX config | `getUXConfig()`, `updateUXConfig(...)` |
| Policies | `listPolicies()`, `getPolicy(id)` |
| System | `getSystemDashboard()` |

The client adds the bearer-token header from `localStorage` (or session state) and constructs URLs against `/api/...` — the Vite dev proxy on `:5181` rewrites those to `http://localhost:5182` (the API). In production, `vite build` produces a static bundle in `dist/` and the API serves it (see `server.ts` `WEB_UI_DIST` static handler).

### Routes (App.tsx)

The full route map (extracted from `App.tsx`):

| Path | Page component | Purpose |
|---|---|---|
| `/` | `PortalIndexPage.tsx` | Landing page — index of portals |
| `/user` | `UserPortal.tsx` | User lookup by attribute |
| `/register` | `RegistrationPortal.tsx` | New-identity self-registration |
| `/helpdesk` | `HelpDeskPortal.tsx` | Internal staff lookup |
| `/helpdesk/register` | `HelpDeskRegistrationPortal.tsx` | Staff-assisted registration |
| `/hr` | `HRPortal.tsx` | HR system records |
| `/ldap` | `LDAPPortal.tsx` | LDAP/AD records |
| `/engineering` | `EngineeringPortal.tsx` | Engineering dept records |
| `/finance` | `FinancePortal.tsx` | Finance dept records |
| `/gcuid` | `GCUIDPortal.tsx` | Central GCUID lookup + admin |
| `/caes` | `CAESPortal.tsx` | Common Attribute Exchange Service |
| `/sources` | `SourceConnectorPortal.tsx` | Source-connector browse |
| `/options` | `OptionsPortal.tsx` | User options / preferences |
| `/logs` | `LogsPortal.tsx` | System log viewer |
| `/dashboard` | `DashboardPortal.tsx` | Aggregate dashboard |
| `/testing` | `TestingPortal.tsx` | API testing surface (curl-equivalent) |
| `/databases` | `DatabasesPortal.tsx` | Database browser (read-only) |
| `/tools` | `ToolsPortal.tsx` | System tools (purge, reset) |
| `/ux` | `UXPortal.tsx` | UX theme admin |
| `/system` | `SystemPortal.tsx` | System admin (services, processes) |
| `/apps` / `/apps/:appId` | `CorporateAppPortal.tsx` | Corporate applications registry |
| `/policies` | `PolicyPortal.tsx` | Application access policies |
| `/about` | `AboutPortal.tsx` | About / license / version |

**27 routes** across **24 distinct page components** (`PortalIndexPage.tsx` covers `/`; the rest are 1:1 with their path). `CorporateAppPortal.tsx` is the only page with a parameter — `/apps/:appId` selects which corporate app to show.

### Shared components

The 14 components in `components/`:

| Component | Size | Used by |
|---|---|---|
| `Layout.tsx` | 31 KB | App shell — top bar, side nav, portal switcher (used by every page) |
| `ConnectorIntegrationTab.tsx` | 50 KB | Connector detail view (sources/options/testing pages) |
| `ConnectorSequenceDiagram.tsx` | 12 KB | Mermaid sequence diagrams for connector flows |
| `ConnectorStatusPanel.tsx` | 12 KB | Per-connector health badge + ping/health buttons |
| `ConnectorCacheBar.tsx` | 8 KB | Cache controls (purge, refresh) for connectors |
| `GcuidRequestPanel.tsx` | 15 KB | The user-facing GCUID-request form (preview-then-submit) |
| `StateDiagram.tsx` | 10 KB | State machine visualizer for identity state transitions |
| `UXThemeContext` (provider) | 7.6 KB | Theme tokens (light/dark + custom themes) |
| `PortalLayout.tsx` | 6.3 KB | Per-portal layout wrapper (top-of-page header + portal-specific nav) |
| `navTheme.ts` (data, not component) | 6.8 KB | Theme tokens for nav/topbar |
| `useScopeNavTheme` | 1 KB | Hook for scoped theme overrides |
| `StateBadge.tsx` | 3.2 KB | Identity-state badge (provisional, active, etc.) |
| `Pagination.tsx` | 4.2 KB | Cursor-based pagination control |
| `SortTh.tsx` | 3.0 KB | Sortable table header |
| `ErrorMessage.tsx` | 1.6 KB | Error banner component |
| `LoadingSpinner.tsx` | 1.0 KB | Loading spinner |
| `CopyButton.tsx` | 2.9 KB | Copy-to-clipboard button |

### State management

The Web UI uses **React Query** for server state (cached, invalidated on mutation, refetched on focus). Theme and portal mode use React Context (`UXThemeContext`, `PortalModeContext`). Date/time formatting uses `DateTimeFormatContext`. There is **no Redux, Zustand, or other global store**.

Pagination, sorting, and filtering are page-local state managed via `useState` + custom hooks (`usePagination`, `useSortableTable`, `useFeatureFlags`). Cross-page state survives via React Query's cache (keyed by query string).

### Vite proxy

`staging/web-ui/vite.config.ts` configures the dev proxy:

```typescript
server: {
  port: 5181,
  proxy: {
    '/api': { target: 'http://localhost:5182', changeOrigin: true }
  }
}
```

When you `curl http://localhost:5181/api/connectors` in dev mode, Vite forwards it to `:5182`. In production (`vite build`), the proxy is gone; the API serves the static `dist/` files and routes `/api/*` itself.

### Hot-reload and the dev cycle

- **`staging/web-ui/src/`** — Vite hot-reloads on every save. No restart needed.
- **`staging/api/`** — Restart `./start-dev.sh` after any change (API doesn't hot-reload).
- **`packages/core/`** — `npm run build` then restart (compile step required).

### Common dev tasks

**Add a new page**: create `pages/MyPage.tsx`, register a route in `App.tsx` (`<Route path="my-page" element={<MyPage />} />`), add a metadata entry in `config/portals.ts` if it should show in the portal nav.

**Add a new API client method**: edit `api/client.ts`, add a method to the `api` class, type the request/response. TypeScript will surface the new method in every page that imports `api`.

**Add a new component**: create `components/MyComponent.tsx`, import it where needed. No central registry.

**Add a new hook**: create `hooks/useMyHook.ts`, export the hook function. Hooks are conventional `useXxx` names.

### See also

- §1.5 — the API layer that the client calls
- §1.7 — the connector system surfaced in the UI
- §1.10 — extending the Web UI (worked example)
- [User Guidebook §2.4 The Web UI tour](guidebook-user.md) — what end users see

## 1.7 The connector system (Plan B B3)

This section is the developer-facing walkthrough of the **connector system** — the 4 connector processes and the 4 source-server processes they proxy to. This is the central architectural decision of the POC.

> **Where this lives in design docs**: The *why* and the alternatives considered are in [Architect Guidebook §4.5 Plan B B3](guidebook-architect.md#45-plan-b-b3-source-server-separation). The access-mode taxonomy is in [Architect Guidebook §4.6 Access modes](guidebook-architect.md#46-access-modes). This section is the **how to work with it** companion.

### The 4 + 4 process model

The POC runs **4 connector processes** (one per authoritative source) and **4 source-server processes** (one per source data store):

| Connector process | Port | Source it proxies | Source-server process | Source-server port | Backing DB |
|---|---|---|---|---|---|
| HR | 5183 | HR system | src-hr | 5188 | `data/sources/conn-hr.db` |
| LDAP | 5184 | LDAP/AD | src-ldap | 5189 | `data/sources/conn-ldap.db` |
| Engineering | 5185 | Eng department | src-engineering | 5190 | `data/sources/conn-engineering.db` |
| Finance | 5186 | Finance department | src-finance | 5191 | `data/sources/conn-finance.db` |

**Both processes are started by `start-dev.sh`** (the canonical local stack script). The orchestration scripts (`staging/scripts/start-connectors.ts` and `staging/scripts/start-sources-all.ts`) read the per-system configs and spawn them with the right port + token + DB path.

### The data flow

For a request to `GET /api/gcuid/<id>`:

```
┌────────┐  HTTP    ┌────────┐  HTTP    ┌────────┐  HTTP   ┌────────┐  SQLite ┌────────┐
│        │  :5182   │        │  :5183   │        │  :5188  │        │  read   │        │
│ API    │─────────▶│ HR     │─────────▶│ src-hr │────────▶│ Source │────────▶│ conn-  │
│ server │          │ connector│        │ server │         │ Data   │         │ hr.db  │
│        │          │        │◀─────────│        │◀────────│ Provider│◀────────│        │
└────────┘          └────────┘  response└────────┘  JSON   └────────┘         └────────┘
```

That's **4 hops**: API → connector → source server → SQLite. Each hop is HTTP. Each is independently restartable.

### The configs

Each connector + source is configured by **two files** (in `staging/config/connectors/` and `staging/config/sources/`):

**Connector config** (`conn-hr.json`):

```json
{
  "id": "conn-hr",
  "label": "HR System Connector",
  "connectorServer": {
    "port": 5183,
    "authToken": "staging_hr_token_12345"
  },
  "upstreamSource": {
    "baseUrl": "http://localhost:5188",
    "authToken": "gcuid_source_hr_token_9999"
  },
  "attributeMappings": {
    "primaryKeyField": "employee_id",
    "tables": { "employees": { "alias": "person", "primaryKey": "employee_id" } }
  },
  "accessMode": "dynamic-pull"
}
```

**Source config** (`src-hr.json`):

```json
{
  "id": "src-hr",
  "label": "HR Authoritative Source",
  "sourceServer": {
    "port": 5188,
    "authToken": "gcuid_source_hr_token_9999"
  },
  "dataProvider": {
    "type": "sqlite",
    "dbPath": "./data/sources/conn-hr.db",
    "table": "employees",
    "primaryKey": "employee_id"
  }
}
```

The `authToken` on the source side (`gcuid_source_*`) **must match** the `upstreamSource.authToken` on the connector side — that's the bearer-token handshake between them. The connector token (`staging_hr_*`) is separate and authenticates connector-to-API calls.

### How to add a new connector + source

This is the canonical "extend the POC with a new authoritative source" workflow. Worked example: adding `conn-parking` + `src-parking`.

#### 1. Pick a port and tokens

- Connector port: next free in `:5183-5186` (5187 is reserved for `ea-mcp-bridge`)
- Source-server port: next free in `:5188-5191`
- Connector token: `staging_parking_token_<n>`
- Source token: `gcuid_source_parking_token_<n>`

#### 2. Write the source config

Create `staging/config/sources/src-parking.json` with the schema above. Adjust `dbPath` / `table` / `primaryKey` to match your source data.

#### 3. Write the connector config

Create `staging/config/connectors/conn-parking.json`. The `upstreamSource` block must reference the source-server's port + the matching token.

#### 4. Create the source DB

Either:
- **Manual**: write a SQLite file at `staging/data/sources/conn-parking.db` with the schema your data provider expects (see `staging/data/schema/source-employees.sql` for the HR template), and seed rows.
- **Seeded**: write a seed script `staging/scripts/seed-data.ts --source=parking` that calls `seedSourceIfEmpty('conn-parking', ...)`. See §1.7 for the seed-file format.

#### 5. Register the new connector in the registry

The registry (`data/registry.db` table `source_systems`) needs a row for `conn-parking`. Add it via the seed migration in `admin.ts:2414-2428`. Pattern:

```typescript
db.prepare(`
  INSERT OR IGNORE INTO source_systems (system_id, display_name, system_type, api_url, api_secret)
  VALUES ('conn-parking', 'Parking System', 'department', 'http://localhost:5183', 'staging_parking_token_<n>')
`).run();
```

Idempotent — safe to re-run. Authority for any specific attribute (e.g. "HR is canonical for `person.employment.employee_id`") is **not** set here — it's a property of the `attribute_mappings` row, not the source-system row. To declare a source authoritative for an attribute, use the CAES service:

```
PUT /api/caes/attribute-mappings/<mapping_id>/authoritative
```

This sets `is_authoritative=1` on the chosen mapping and atomically clears it on every other mapping for the same `standard_attribute` (the CAES route implementation at `staging/api/routes/caes.ts:1046-1071` wraps both updates in a transaction).

#### 6. No code change needed

Both `staging/scripts/start-connectors.ts` and `staging/scripts/start-sources-all.ts` discover configs from the config directories. They iterate over the files in `staging/config/connectors/*.json` and `staging/config/sources/*.json` and spawn one process per config. Adding the JSON is enough.

#### 7. Restart `./start-dev.sh`

This picks up the new files in both directories, spawns the new connector + source processes, and the dashboard reflects them on next refresh.

#### 8. Smoke-test

```bash
curl http://localhost:5182/api/connectors/conn-parking/ping
# → { reachable: true, base_url: "http://localhost:5183", ... }

curl -H "Authorization: Bearer gcuid_source_parking_token_<n>" \
     http://localhost:5188/health
# → { sourceId: "src-parking", status: "ok", recordCount: <n>, latencyMs: <ms> }
```

#### 9. (Optional) Add a portal route

If you want a portal page for the new source (e.g. `/parking/lookup`), copy one of the per-system route files (`routes/hr.ts` is the smallest), rename, and register it in `server.ts`. Skip if the new source is read-only via `/api/gcuid/<id>`.

### How connectors transform attributes

The connector doesn't just proxy records — it **transforms** them per the `attributeMappings` config. This is the policy layer: the source DB might use `employee_id` as the primary key; the GCUID system uses `gcuid`. The connector maps between the two.

The mapping is per-table (or per-record-set). Each table can declare:

- `alias` — the logical name the API exposes (e.g. `person`)
- `primaryKey` — the source-side key field
- `attributeMap` — a per-field transformation spec

The transformation lives in `packages/core/src/connector-api.ts` — see `applyTransformations()` and `mapAttribute()`. If you need a new transformation type, add it there and rebuild `@gcuid/core`.

### Common connector issues

#### Connector reports `reachable: false` but the source server is up

**Cause**: token mismatch. The connector's `upstreamSource.authToken` doesn't match the source's `sourceServer.authToken`. Check both configs.

**Diagnostic**: `curl -H "Authorization: Bearer <connector-token>" http://localhost:5188/health` returns 200 (the connector token shouldn't grant access; if it does, the configs are misaligned).

#### Source server returns 401

**Cause**: missing/wrong `Authorization` header on the source-server call. The `SourceAPIClient` adds the bearer token automatically; if you bypass it (e.g. via `curl`), you need to pass it manually.

#### Source DB is empty

**Cause**: self-bootstrap not run, or seed-data script failed silently. Re-run:

```bash
tsx staging/scripts/seed-data.ts --source=parking
```

The `seedSourceIfEmpty()` helper in `start-sources-all.ts` is supposed to call this automatically on startup; if the DB exists but is empty, it skips seeding (assumes you cleared it deliberately).

#### Connector process dies silently

**Cause**: usually a startup error — port already in use, bad config (JSON syntax), or DB path missing. Check `logs.db` (`SELECT * FROM log_events WHERE component = 'connector' ORDER BY timestamp DESC LIMIT 20`) or the Web UI log viewer.

#### Pings pass but data lookups fail

**Cause**: the source server's `dataProvider` table name or primary key doesn't match the source config. The `/health` endpoint doesn't actually query the table (it returns metadata); only `/search` / `/records/:id` exercise the DB.

### Why "Plan B B3"?

The original POC design (Plan A) had the connector calling the source DB **directly** — no separate source server. Plan B B3 split that into:

- A1 — Direct DB call, same process (kept the source DB in-process)
- B1 — Direct DB call, separate process (file-system access across processes)
- B3 — **HTTP API call, separate process** (the chosen path)

B3 was chosen because:

1. **Process isolation**: a bug in the connector can't corrupt the source DB file.
2. **Network boundary**: the connector can be deployed to a different host than the source DB (future-proof for cloud).
3. **Independent restart**: the source DB can be re-seeded without restarting the connector.
4. **Testable in isolation**: each source server can be smoke-tested directly via `curl` without spinning up a connector.

The trade-off is **latency**: an extra HTTP hop adds ~5ms per request. For the POC this is acceptable; in production you'd cache frequently-fetched attributes.

### See also

- §1.4 — the connector server type (`ConnectorAPIServer`)
- §1.5 — the API layer (calls into the connector)
- [Architect Guidebook §4.5 Plan B B3](guidebook-architect.md) — why B3 was chosen
- [Architect Guidebook §4.6 Access modes](guidebook-architect.md) — the access-mode taxonomy
- [SysAdmin Guidebook §3.4 Logs and diagnostics](guidebook-sysadmin.md) — log events for connector failures

## 1.8 Library & dependency catalog

This section is the **definitive catalog of every external library and dependency** the POC actually uses, why each was chosen, and where to find its call sites. It's the answer to "what does this codebase depend on, and what's it for?".

> **Two layers**: §1.4 covers the **custom modules** built in-repo (under `packages/`). This section (§1.8) covers the **third-party dependencies** the custom modules + the staging runtime depend on.

### Runtime dependencies at a glance

The POC pulls in dependencies from **two layers** of `package.json` files: the workspace-package level (`packages/core/package.json` declares what `@gcuid/core` needs) and the staging-runtime level (`staging/api/package.json` + `staging/web-ui/package.json` declare what the running services need).

#### `@gcuid/core/package.json` (10 dependencies)

| Package | Version | Used by source files | What it does |
|---|---|---|---|
| `better-sqlite3` | ^12.6.2 | `connector-api.ts`, `registry.ts`, `identity-registry.ts`, `sqlite-source-adapter.ts` (and any file that opens a `.db`) | **Synchronous SQLite** — the entire storage layer. Chosen for its synchronous API (no callback/Promise overhead) and predictable performance under load. The staging API and the source servers both use `new Database(path)` + prepared statements. |
| `express` | ^5.2.1 | `connector-api.ts` (the connector HTTP server) | The connector HTTP server. The source servers use Node's built-in `http` module directly (smaller surface, no Express dependency). The staging API uses Express 5 too (separate dependency at the staging layer). |
| `winston` | ^3.19.0 | `logger.ts` (and indirectly `staging/api/lib/logging/logger.ts`) | **Structured logger** with levels, transports, and JSON formatting. The core library uses winston; the staging API has its own wrapper (`staging/api/lib/logging/`) that writes to `logs.db`. |
| `xstate` | ^5.25.1 | `state-machine.ts`, `identity-state-machine.ts` | **State-machine library** — declarative state definitions + transition guards. The identity-state-machines in core are xstate machines. |
| `convict` | ^6.2.4 | `config.ts` | **Config validation** — schema-driven config with type-checking and defaults. Used by core's config layer; staging has its own JSON-only config approach. |
| `cli-table3` | ^0.6.5 | (declared for example CLIs / legacy `cli.ts`) | Pretty-printed tables for CLI output. Not currently used by any wired-in code; declared for the example/CLI surface. |
| `commander` | ^14.0.2 | (declared for example CLIs / legacy `cli.ts`) | CLI argument parser. Not currently used by any wired-in code; declared for the example/CLI surface. |
| `ulid` | ^3.0.2 | `index.ts` (`GCUIDManager` can generate from a ULID core) | **ULID generator** — lexicographically-sortable unique IDs. Used as one of the two core-ID sources (the other is UUID v4). |
| `uuid` | ^13.0.0 | `index.ts` (`v4` import) | **UUID v4 generator** — the other core-ID source. |
| `@types/express` | ^5.0.6 | (TypeScript types only — no runtime impact) | Express types for the connector server. |

#### `@gcuid/federation/package.json` (1 dependency)

| Package | Version | Notes |
|---|---|---|
| `@gcuid/core` | ^0.1.0 | Workspace dependency. The federation layer composes core primitives. |

#### `@gcuid/attributes/package.json` (2 dependencies)

| Package | Version | Notes |
|---|---|---|
| `@gcuid/core` | ^0.1.0 | Workspace dependency. |
| `@gcuid/federation` | ^0.1.0 | Workspace dependency. The attribute layer uses federation internally. |

#### `@gcuid/api/package.json` (3 dependencies)

| Package | Version | Notes |
|---|---|---|
| `@gcuid/core` | ^0.1.0 | Workspace dependency. |
| `@gcuid/federation` | ^0.1.0 | Workspace dependency. |
| `@gcuid/attributes` | ^0.1.0 | Workspace dependency. |

#### `staging/api/package.json` (Express runtime layer)

The staging API is its own Node project. Its dependencies are separate from `@gcuid/core`'s. The staging runtime depends on:

| Package | Where used | What it does |
|---|---|---|
| `express` | `staging/api/server.ts` | The HTTP server. |
| `cors` | `staging/api/server.ts:179` | Open CORS (any origin) for local dev. |
| `better-sqlite3` | Every route file that opens `registry.db` or `logs.db` | The DB driver. |
| (No Express middleware beyond `cors` and `express.json()`) | | No `helmet`, no `express-rate-limit`, no `body-parser`. The POC keeps the middleware stack minimal. |

The staging API uses **Node built-ins** for everything else: `crypto` for hashing, `fs` for file ops, `path` for path resolution, `url` for `fileURLToPath`. No `lodash`, no `axios`, no `moment`.

#### `staging/web-ui/package.json` (React frontend)

The Web UI pulls in:

| Package | Where used | What it does |
|---|---|---|
| `react`, `react-dom` | Every page/component | The UI framework (React 18). |
| `react-router-dom` | `App.tsx`, `Layout.tsx` | Client-side routing. |
| `@tanstack/react-query` | Every page that fetches data | Server-state caching. |
| `vite`, `@vitejs/plugin-react` | `vite.config.ts`, dev server | The dev server + bundler. |
| `typescript` | tsconfig.json | TypeScript compilation. |

There is **no state-management library** beyond React Query + Context — no Redux, no Zustand, no Jotai. There is **no UI component library** — no Material-UI, no Tailwind, no Ant Design. There is **no date library** beyond `Intl.DateTimeFormat` (native browser API) wrapped in `useDateTimeFormat`.

### Why these dependencies?

Each runtime dep was chosen for a specific reason. The rationale table:

| Package | Why this and not an alternative |
|---|---|
| `better-sqlite3` | Synchronous API = simpler code (no async/await ceremony) + faster for small queries. The staging runtime is single-process and local-only; the async-overhead tax isn't worth it. Alternatives (`sqlite3`, `node-sqlite3`) are async-callback based. |
| `express` | The connector server needs HTTP routing; Express is the de-facto Node standard. Alternatives (Koa, Fastify, raw `http`) were considered — Express won on familiarity + ecosystem. |
| `winston` | Structured logging with multiple transports (console, file, HTTP) out-of-the-box. Alternatives (`pino`, `bunyan`) are faster but winston's API is more approachable for the POC. |
| `xstate` | Declarative state machines with visualizer support. Alternatives (hand-rolled `switch` statements) don't give you the static-analysis benefits (xstate machines are inspectable at runtime via `inspect()`). |
| `convict` | Schema-driven config validation. Alternatives (hand-rolled JSON load + check) lose the type-safety and the env-var interpolation. |
| `ulid` + `uuid` | Two different ID formats — ULID is time-sortable (good for log/event ordering), UUID v4 is the universal default. The `CoreIdType` enum lets you pick either. |
| `cli-table3` + `commander` | Declared for the example/CLI surface (legacy `cli.ts` + the `examples-*.ts` files). Not currently exercised by staging; carried forward so the example scripts continue to work. |
| `react` + `react-dom` | React 18's concurrent features (`useTransition`, `Suspense`) are useful for the data-grid pages with their heavy filter state. |
| `react-router-dom` | The de-facto React router; familiar API. |
| `@tanstack/react-query` | Caching + invalidation without writing fetch wrappers. |
| `vite` | Fast dev server + simple config. No webpack config to maintain. |

### What is NOT a dependency

The POC deliberately avoids:

- **No `dotenv`** — config is via JSON files (`staging/config/`) and env vars read directly via `process.env`.
- **No `helmet`** / **no `express-rate-limit`** / **no `csurf`** — the API is local-only.
- **No `axios`** — the API client uses native `fetch` (with `Authorization` headers constructed manually).
- **No `lodash`** — small utility code is hand-rolled; the project doesn't need lodash's breadth.
- **No date library** (`moment`, `date-fns`, `luxon`) — `Intl.DateTimeFormat` covers the needs; `useDateTimeFormat` wraps it.
- **No ORM** (Prisma, TypeORM, Drizzle, Knex) — direct `better-sqlite3` prepared statements throughout. The schema is small enough that an ORM would add overhead without value.
- **No test framework beyond Jest** (declared in `@gcuid/core/package.json`) — the staging layer uses hand-rolled `scripts/smoke-*.ts` smoke tests instead of adding Jest to the staging runtime.

### How to add a new dependency

For `@gcuid/core` (or any workspace package):

```bash
cd packages/core
npm install --save <package>
npm run build  # rebuilds dist/
# staging/api now needs the dep too:
cd ../../staging/api
npm install --save <package>
```

For `staging/api`:

```bash
cd staging/api
npm install --save <package>
# restart ./start-dev.sh
```

For `staging/web-ui`:

```bash
cd staging/web-ui
npm install --save <package>
# Vite hot-reloads; if Vite fails to pick up, restart ./start-dev.sh
```

**Avoid adding deps for things you could do with Node built-ins.** The POC has a deliberate "small deps" stance; each new dep adds attack surface, install time, and maintenance burden.

### How to audit what's used

To see what a particular package actually depends on at runtime:

```bash
# from the staging runtime perspective:
grep -rE "require\(|from '" /e/GitHub/GCUID-POC/staging/api/ \
  --include='*.ts' | grep -vE "from '\./|from '\.\./|require\('\./|require\('\.\./"

# from the core library perspective:
grep -rE "^import .* from ['\"]" /e/GitHub/GCUID-POC/packages/core/src/ \
  | sed -E "s/.*from ['\"]([^'\"]*)['\"].*/\1/" | grep -vE "^\./|^\.\./" | sort -u
```

The first command lists every non-relative import in staging. The second lists every non-relative import in `@gcuid/core/src/`. If a dependency is declared in `package.json` but doesn't appear in either output, it's **declared-but-unused** — a candidate for removal if the intent was purely to enable the example scripts.

### See also

- §1.4 — the custom modules (`@gcuid/core`, `@gcuid/federation`, `@gcuid/attributes`, `@gcuid/api`)
- §1.5 — where Express + better-sqlite3 are used in the staging API
- §1.6 — where React + Vite + React Query are used in the Web UI
- §1.9 — the database schema (what better-sqlite3 opens)
- [SysAdmin Guidebook §3.2 Dependency versions](guidebook-sysadmin.md) — how to bump a dep
- [Architect Guidebook §4.8 Trade-offs taken](guidebook-architect.md) — why the "small deps" stance

## 1.9 Database schema

This section is the canonical reference for the SQLite databases the POC uses. The DBs fall into three groups: the **registry** (central identity coordination), the **per-source DBs** (one per authoritative source), and **auxiliary DBs** (logs, hooks, policies, UX config).

### Database inventory

| DB file | Backing module | Owner | Purpose |
|---|---|---|---|
| `data/registry.db` | `staging/api/routes/admin.ts` (DDL at L2340-2400) | API (read/write) | The central identity registry + source-system catalog + attribute cache. **All four client processes (HR, LDAP, Engineering, Finance) ultimately resolve through this.** |
| `data/logs.db` | `staging/api/lib/logging/log-events.ts` + `logger.ts` | API (write), UI (read) | The structured log storage. Every API request, connector health check, and source-server ping lands here. |
| `data/sources/conn-<id>.db` | `packages/core/src/sqlite-source-adapter.ts` | Source server (read/write) | One per authoritative source: `conn-hr.db`, `conn-ldap.db`, `conn-engineering.db`, `conn-finance.db`. Holds the raw employee/identity records. |
| Hooks/policies/flags/log-levels/ux-config | `staging/api/routes/{hooks,policies,flags,log-levels,ux-config}.ts` | API | Smaller auxiliary tables. Often co-located in `registry.db` as separate tables (default) — see `db-paths.ts` if they need to be split. |

In practice, **most auxiliary DBs are co-located in `registry.db`** as separate tables (since they're all under the same SQLite file by default). The `db-paths.ts` resolver controls where each table lives; check that module if you need to split.

### `registry.db` — the central coordination DB

`registry.db` holds the schema that ties everything together. The biggest table is `source_systems`:

```sql
-- staging/api/routes/admin.ts:2341-2365
CREATE TABLE IF NOT EXISTS source_systems (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id           TEXT    UNIQUE NOT NULL,
  display_name        TEXT    NOT NULL,
  system_type         TEXT    NOT NULL CHECK(system_type IN ('authoritative_source','department')),
  db_path             TEXT,
  api_port            INTEGER,
  api_url             TEXT,
  api_secret          TEXT,
  description         TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  connector_id        TEXT,
  access_mode         TEXT    NOT NULL DEFAULT 'dynamic-pull'
                              CHECK(access_mode IN ('dynamic-pull','push-cache','scheduled-pull')),
  cache_ttl_seconds   INTEGER NOT NULL DEFAULT 300,
  pull_schedule       TEXT,
  allow_inbound       INTEGER NOT NULL DEFAULT 0,
  last_sync_at        TEXT,
  cache_stale_policy  TEXT    NOT NULL DEFAULT 'serve-stale',
  identifier_mode     TEXT    NOT NULL DEFAULT 'gcuid'
                              CHECK(identifier_mode IN ('gcuid','alias')),
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
)
```

This is the table the API's resolver consults to decide where to route a lookup request. **Critical columns**:

- `system_id` — the connector ID (e.g. `conn-hr`, `conn-ldap`). **Stable identifier** — never changes after seed.
- `access_mode` — which fetching strategy the connector uses (`dynamic-pull`, `push-cache`, `scheduled-pull`).
- `api_url` + `api_secret` — the URL + bearer-token the API uses to call the connector. **This is the column with the pre-port-remap bug** (fixed in `e5c3b8c`) — see §1.12.
- `connector_id` — currently a free-text field; the JSON config in `staging/config/connectors/` is the source of truth for runtime wiring.

Other key registry tables:

| Table | DDL location | Purpose |
|---|---|---|
| `identities` | `staging/scripts/seed-data.ts:758-768` | The central GCUID identity table. One row per identity. Columns: `gcuid` (PK), `entity_type`, `entity_id`, `state`, `identifier_state` (V1/V2), `created_at`, `updated_at`, `metadata` (JSON). |
| `state_history` | `staging/scripts/seed-data.ts:769-779` | The identity-state-transition audit log. One row per state change. Indexed on `gcuid`. |
| `identifier_state_history` | `staging/api/routes/admin.ts:1989-2002` | A separate audit table for **identifier-state** transitions (V1↔V2). Tracks `gcuid`, `from_state`, `to_state`, `transition`, `changed_by`, `reason`, `timestamp`. |
| `aliases` | `staging/scripts/seed-data.ts:781-792` | GCUID aliases. One row per alias. Indexed on `gcuid` and `alias_value` for fast lookup-by-alias. |
| `source_mappings` | `staging/scripts/seed-data.ts:793-803` | The map between a GCUID and its source-system record (e.g. `gcuid=urn:gcuid:abc123 → conn-hr/employee_id=42`). Indexed on `gcuid` and `(source_system, source_id)`. |
| `attribute_mappings` | `staging/api/routes/caes.ts:59` | CAES-side attribute mappings. Used by the Common Attribute Exchange Service. |
| `match_configs` | `staging/api/routes/caes.ts:1861` | Per-source matching configuration (which attributes to match on, what algorithm, what threshold). |
| `attribute_cache` | `staging/api/routes/admin.ts:2387` | The cache for `push-cache` and `scheduled-pull` access modes. Stores (gcuid, attribute_name) → resolved value with TTL. |
| `hook_subscriptions` + `hook_events` | `staging/api/routes/hooks.ts:60-83` | The hook subscription registry + emitted-event log. Indexed on `event_type`, `emitted_at`, `gcuid`, `subscriber_id`. |
| `app_policies` | `staging/api/routes/policies.ts:70` | Application-level access policies. `app_id` is PK. |
| `config` (multiple variants) | `flags.ts`, `log-levels.ts`, `ux-config.ts` | Generic `(key TEXT PK, value TEXT, updated_at)` for runtime overrides. Three separate tables by design (different access patterns, different consumers). |

### `data/sources/conn-<id>.db` — per-source authoritative DBs

Each connector points at one source DB. The schemas are **per-source** — HR's `employees` table may differ from Engineering's. They're seeded by `staging/scripts/seed-data.ts` (the self-bootstrapping helper).

#### HR (`conn-hr.db`) — the canonical example

```sql
-- staging/scripts/seed-data.ts:901-918
CREATE TABLE employees (
  employee_id     TEXT PRIMARY KEY,
  gcuid           TEXT UNIQUE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  department      TEXT,
  job_title       TEXT,
  manager_gcuid   TEXT,
  hire_date       TEXT,
  termination_date TEXT,
  -- + extensions per HR config
);
CREATE INDEX idx_employees_dept ON employees(department);
CREATE INDEX idx_employees_email ON employees(email);
```

The `employee_id` is the **primary key** that the connector's `attributeMappings.primaryKeyField` refers to. The `gcuid` is the linkage back to the registry. **The source DB doesn't enforce the gcuid linkage** — that's a registry concern; the source DB just stores the gcuid as an opaque string.

#### LDAP (`conn-ldap.db`)

LDAP uses a different schema (the LDAP/AD model):

```sql
-- users table (LDAP-style)
CREATE TABLE users (
  -- username, email, full_name, groups, etc.
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_dept ON users(department);
```

#### Engineering (`conn-engineering.db`)

Engineering's employees table extends HR's with engineering-specific fields:

```sql
CREATE TABLE employees (
  -- base fields (employee_id, gcuid, first_name, last_name, email)
  hr_employee_id   TEXT,         -- FK back to HR's employee_id
  clearance_level  TEXT,
  project_codes    TEXT,         -- comma-separated
  ...
);
CREATE INDEX idx_eng_email ON employees(email);
CREATE INDEX idx_eng_hr_id ON employees(hr_employee_id);
CREATE INDEX idx_eng_gcuid ON employees(gcuid);
```

#### Finance (`conn-finance.db`)

Finance's employees table also extends HR's, with finance-specific fields:

```sql
CREATE TABLE employees (
  -- base fields
  hr_employee_id     TEXT,
  clearance_level    TEXT,
  cost_center        TEXT,
  ...
);
CREATE INDEX idx_fin_email ON employees(email);
CREATE INDEX idx_fin_hr_id ON employees(hr_employee_id);
CREATE INDEX idx_fin_gcuid ON employees(gcuid);
CREATE INDEX idx_fin_clearance ON employees(clearance_level);
```

### How the API schema migrations work

The registry schema is **idempotent** — every table is `CREATE TABLE IF NOT EXISTS`, every index is `CREATE INDEX IF NOT EXISTS`. This means:

- Fresh DB → tables created on first API startup
- Existing DB → no-op (preserves data)
- Schema change → add a new `CREATE TABLE IF NOT EXISTS` block; the migration runs on next startup

Column additions are wrapped in try/catch with explicit `PRAGMA table_info(...)` checks (the pattern at `admin.ts:2006-2007`). The try/catch + warning-on-error pattern means a read-only bundled DB doesn't prevent module load — it just warns.

### The pre-port-remap migration pattern (e5c3b8c lesson)

The seed migration in `admin.ts:2414-2428` initializes `source_systems.api_url` to the canonical port (5183-5186). The original migration used `WHERE api_url IS NULL OR api_url = ''` — which is **exclusion-based, not validation-based**. It caught fresh-DB state but not stale-but-non-empty state from a prior port assignment (the pre-remap ports 8101/8102/8201/8202).

The fix (commit `e5c3b8c`) extended each UPDATE to also catch the known stale values:

```sql
UPDATE source_systems SET api_url = 'http://localhost:5183' WHERE system_id = 'conn-hr'
  AND (api_url IS NULL OR api_url = '' OR api_url = 'http://localhost:8101')
```

**General rule** for any future migration that updates a value with a known-default: **enumerate the stale values that pre-date the migration**, don't rely on `IS NULL OR = ''` alone. The runtime-invariant smoke (`scripts/smoke-invariants-runtime.ts`) catches this class of bug — see §1.12.

### The DB path resolver

Every SQLite file path goes through `staging/api/lib/db-paths.ts`:

```typescript
// from staging/api/lib/db-paths.ts
export const DB_BASE: string = efsBase ?? path.join(process.cwd(), 'data');
export const REGISTRY_DB_PATH: string  = path.join(DB_BASE, 'registry.db');
export const LOGS_DB_PATH: string      = path.join(DB_BASE, 'logs.db');
export const SOURCES_DIR: string       = path.join(DB_BASE, 'sources');

export function connectorDbPath(connectorId: string): string {
  return path.join(SOURCES_DIR, `${connectorId}.db`);
}
```

**Always use these getters** in your code rather than hard-coding `'./data/registry.db'` or similar. The path resolver honours `GCUID_DB_PATH` to switch storage locations automatically; hard-coded paths break this.

### Reading and modifying the DBs

For interactive inspection, use `sqlite3` (CLI) or the Web UI's `DatabasesPortal`:

```bash
# from /e/GitHub/GCUID-POC
sqlite3 staging/data/registry.db "SELECT * FROM source_systems;"
sqlite3 staging/data/registry.db ".schema"
sqlite3 staging/data/sources/conn-hr.db "SELECT COUNT(*) FROM employees;"
```

For modifications in code, every route uses `better-sqlite3` (synchronous). The pattern is `db.prepare(sql).get(...)` for single rows, `db.prepare(sql).all(...)` for lists, `db.prepare(sql).run(...)` for mutations.

### Database state and the registry

The smoke test `smoke-cs-3.1-self-bootstrap.ts` does NOT touch the registry — it touches the source DBs. Source DBs are regenerated by `seed-data.ts --source=<name>` if they go missing. The registry (`registry.db`) is the canonical state for the API; if it gets corrupted, see the [SysAdmin Guidebook §3.5 Database management](guidebook-sysadmin.md) for the reset procedure.

### See also

- §1.4 — where `better-sqlite3` is used (storage layer)
- §1.5 — how routes open the DB
- §1.7 — how connectors read from `data/sources/conn-<id>.db`
- §1.11 — the runtime-invariant smoke that catches pre-port-remap style bugs
- [SysAdmin Guidebook §3.5 Database administration](guidebook-sysadmin.md) — backup/restore, migrations
- [Architect Guidebook §4.7 Data model](guidebook-architect.md) — why this schema shape

## 1.10 Adding a new connector (worked example)

This section is a **step-by-step walkthrough** of adding a new connector + source pair. The 9-step recipe is in §1.7 (the connector system); this section re-presents it as a worked example with the **concrete files you'll create/modify**.

### Goal

Add a new authoritative source `conn-it-helpdesk` (IT helpdesk) backed by SQLite, port 5183 (the original HR port) — wait, that port is taken. Let me pick a fresh scenario: add `conn-facilities` (Facilities department) on connector port 5192, source-server port 5193, with a new SQLite DB `data/sources/conn-facilities.db`.

**Note**: 5192/5193 are outside the standard `5183-5186` / `5188-5191` allocation. Real additions stay inside the allocation; the example just illustrates the mechanics with unused port numbers.

### Step 1 — Pick identifiers

| What | Value |
|---|---|
| Connector ID | `conn-facilities` |
| Connector port | `5192` |
| Source ID | `src-facilities` |
| Source-server port | `5193` |
| Connector token | `staging_facilities_token_7777` |
| Source token | `gcuid_source_facilities_token_8888` |
| Backing DB | `data/sources/conn-facilities.db` |
| Primary table | `facilities_employees` |
| Primary key | `facility_employee_id` |

**Check ports are free**: `netstat -an | grep 5192` (Windows) or `lsof -iTCP:5192 -sTCP:LISTEN` (macOS/Linux). If a port is taken, pick the next free one and update the dev-ports registry (`.dev-ports.json` at the repo root — see [SysAdmin Guidebook §3.7 Port management](guidebook-sysadmin.md)).

### Step 2 — Write the source config

Create `staging/config/sources/src-facilities.json`:

```json
{
  "id": "src-facilities",
  "label": "Facilities Authoritative Source",
  "sourceServer": {
    "port": 5193,
    "authToken": "gcuid_source_facilities_token_8888"
  },
  "dataProvider": {
    "type": "sqlite",
    "dbPath": "./data/sources/conn-facilities.db",
    "table": "facilities_employees",
    "primaryKey": "facility_employee_id"
  }
}
```

**Validate**: `node -e "JSON.parse(require('fs').readFileSync('staging/config/sources/src-facilities.json'))"` should print nothing if the JSON is valid.

### Step 3 — Write the connector config

Create `staging/config/connectors/conn-facilities.json`:

```json
{
  "id": "conn-facilities",
  "label": "Facilities Connector",
  "connectorServer": {
    "port": 5192,
    "authToken": "staging_facilities_token_7777"
  },
  "upstreamSource": {
    "baseUrl": "http://localhost:5193",
    "authToken": "gcuid_source_facilities_token_8888"
  },
  "attributeMappings": {
    "primaryKeyField": "facility_employee_id",
    "tables": {
      "facilities_employees": {
        "alias": "facility_person",
        "primaryKey": "facility_employee_id"
      }
    }
  },
  "accessMode": "dynamic-pull"
}
```

The `upstreamSource.authToken` **must match** the source's `sourceServer.authToken`. The `connectorServer.authToken` is separate (the API authenticates with it).

### Step 4 — Create the source DB

Either write the schema yourself:

```bash
sqlite3 staging/data/sources/conn-facilities.db <<'SQL'
CREATE TABLE facilities_employees (
  facility_employee_id TEXT PRIMARY KEY,
  gcuid                TEXT UNIQUE,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  email                TEXT UNIQUE NOT NULL,
  department           TEXT,
  building             TEXT,
  floor                TEXT,
  office_number        TEXT,
  manager_gcuid        TEXT,
  hire_date            TEXT
);
CREATE INDEX idx_fac_email ON facilities_employees(email);
CREATE INDEX idx_fac_building ON facilities_employees(building);
SQL
```

Or extend `staging/scripts/seed-data.ts` with a `seedFacilities()` function and call `tsx staging/scripts/seed-data.ts --source=facilities`. The second approach is what HR/LDAP/Engineering/Finance use; it auto-runs via `seedSourceIfEmpty()` when the source server starts up.

### Step 5 — Register in the registry

Open `staging/api/routes/admin.ts` and find the seed migration block around line 2414-2428. Add an UPDATE for `conn-facilities`:

```typescript
db.prepare(`
  INSERT OR IGNORE INTO source_systems
    (system_id, display_name, system_type, api_url, api_secret)
  VALUES
    ('conn-facilities', 'Facilities Department', 'authoritative_source',
     'http://localhost:5192', 'staging_facilities_token_7777')
`).run();
```

The `INSERT OR IGNORE` makes this idempotent — re-running won't error if the row already exists. **Important**: the `api_url` here is the **connector's** URL (port 5192), not the source-server's URL (port 5193).

To mark a specific attribute authoritative for this connector (e.g. make `conn-facilities` the canonical source for `person.security.clearance_level`), call CAES after the row exists:

```
PUT /api/caes/attribute-mappings/<mapping_id>/authoritative
```

where `<mapping_id>` is the `attribute_mappings.id` for the `(standard_attribute=person.security.clearance_level, source_system=conn-facilities)` row. This sets `is_authoritative=1` on that mapping and clears the flag on any other mapping for the same `standard_attribute`.

### Step 6 — No code change needed

`staging/scripts/start-connectors.ts` and `staging/scripts/start-sources-all.ts` iterate over the config directories at runtime — new connector/source JSON files are picked up automatically on the next `start-dev.sh` invocation. Verify the all-launcher finds them with:

```bash
ls staging/config/connectors/conn-facilities.json
ls staging/config/sources/src-facilities.json
```

(Replace `facilities` with whatever your system name is.)

### Step 7 — Restart the stack

```bash
./start-dev.sh stop   # or ./stop-dev.sh
./start-dev.sh        # or ./run-dev.js
```

This picks up the new config files and spawns the new connector + source-server processes. Check the logs for "Facilities Connector bound to 5192" and "src-facilities bound to 5193".

### Step 8 — Smoke-test the new pair

```bash
# Connector ping (uses the API's connector-ping route)
curl http://localhost:5182/api/connectors/conn-facilities/ping
# → { reachable: true, base_url: "http://localhost:5192", status: 200, latency: <ms> }

# Source-server health (uses the source token directly)
curl -H "Authorization: Bearer gcuid_source_facilities_token_8888" \
     http://localhost:5193/health
# → { sourceId: "src-facilities", status: "ok", recordCount: <n>, latencyMs: <ms> }

# Source-server info (requires auth)
curl -H "Authorization: Bearer gcuid_source_facilities_token_8888" \
     http://localhost:5193/info
# → { sourceId: "src-facilities", dbPath: "...", table: "facilities_employees", primaryKey: "..." }

# Lookup via the connector (uses the connector token)
curl -H "Authorization: Bearer staging_facilities_token_7777" \
     "http://localhost:5192/records/fac-employee-001"
# → { ... the record ... }

# End-to-end via the API (uses the admin token)
curl -H "Authorization: Bearer gcuid_admin_token_demo" \
     "http://localhost:5182/api/connectors/conn-facilities/records/fac-employee-001"
# → { ... same record ... }
```

If any of these return errors, see §1.12 (testing and debugging) for the diagnostic flow.

### Step 9 — Add a portal route (optional)

If users need a dedicated page for Facilities (not just lookups via `/api/gcuid`), create `staging/api/routes/facilities.ts` modeled on `routes/hr.ts`. Register it in `staging/api/server.ts`:

```typescript
app.use('/api/facilities', facilitiesRoutes);  // Facilities Portal
```

Create the corresponding page in `staging/web-ui/src/pages/FacilitiesPortal.tsx` and register a route in `App.tsx`. **This step is optional** — many sources are usable via `/api/gcuid/<id>` without a dedicated portal.

### What could go wrong

| Symptom | Likely cause |
|---|---|
| Connector doesn't appear in dashboard | JSON syntax error in `conn-facilities.json` — validate with `node -e "JSON.parse(...)"` |
| `ping` returns `reachable: false` | Token mismatch between connector's `upstreamSource.authToken` and source's `sourceServer.authToken` |
| `ping` returns 502 | Source server isn't running — check `start-dev.sh` output for it spawning successfully |
| Lookups return `null` | Source DB is empty — run `tsx staging/scripts/seed-data.ts --source=facilities` |
| Lookups return `500` | The source server's `dataProvider.table` doesn't match the actual table name in the SQLite DB |
| Registry doesn't have the `conn-facilities` row | Migration didn't run — restart `./start-dev.sh` (migrations fire on API startup) |

### See also

- §1.7 — the connector system architecture (the 9-step recipe lives here too)
- §1.11 — the runtime-invariant smoke catches missing-from-registry bugs automatically
- [SysAdmin Guidebook §3.4 Logs and diagnostics](guidebook-sysadmin.md) — where to find per-process logs

## 1.11 Adding a new API endpoint (worked example)

This section is a **step-by-step walkthrough** of adding a new API endpoint. The example: extend the HR Portal with `GET /api/hr/employees/by-department/:dept` — a server-side filter that returns all HR employees in a given department.

### Goal

Add a new route that joins `employees` (from `data/sources/conn-hr.db`) with the registry's `identities` table to return a list of `{gcuid, first_name, last_name, email, department, job_title, identity_state}` for a given department. Useful for "show me all the HR people in Finance" queries.

### The 5-step recipe

#### 1. Decide where the route belongs

The endpoint reads from HR's source DB and the registry. The natural home is **`staging/api/routes/hr.ts`** (HR Portal) — it's an HR-flavoured query. If you wanted to filter across all sources, you'd put it in `routes/admin.ts` (the GCUID Portal).

#### 2. Add the route to the existing router

Open `staging/api/routes/hr.ts` and add a new handler:

```typescript
/**
 * GET /api/hr/employees/by-department/:dept
 *
 * Returns all employees in the given department, joined with the
 * registry's identities table to expose the GCUID and identity state.
 */
router.get('/employees/by-department/:dept', (req: Request, res: Response, next: NextFunction) => {
  try {
    const dept = req.params.dept;
    if (!dept || dept.length > 64) {
      throw createError(400, 'Department name must be 1-64 chars');
    }

    // Open both DBs (synchronous, better-sqlite3)
    const hrDb = new Database(HR_DB, { readonly: true });
    const regDb = new Database(REGISTRY_DB, { readonly: true });

    try {
      // Query: employees in this department + their registry identity
      const rows = hrDb.prepare(`
        SELECT
          e.employee_id, e.gcuid, e.first_name, e.last_name,
          e.email, e.department, e.job_title,
          i.identifier_state, i.state AS identity_state
        FROM employees e
        LEFT JOIN identities i ON e.gcuid = i.gcuid
        WHERE e.department = ?
        ORDER BY e.last_name, e.first_name
      `).all(dept);

      logHR(HR_EVENTS.EMPLOYEE_DEPARTMENT_QUERY, {
        department: dept,
        resultCount: rows.length
      });

      res.json({
        department: dept,
        count: rows.length,
        employees: rows
      });
    } finally {
      hrDb.close();
      regDb.close();
    }
  } catch (err) {
    next(err);
  }
});
```

**Conventions used** (matching the rest of `routes/hr.ts`):

- `readonly: true` on both DBs — we're not mutating anything
- `try/finally` with explicit `db.close()` — `better-sqlite3` is sync but connections still need closing
- The `logHR(HR_EVENTS.EMPLOYEE_DEPARTMENT_QUERY, {...})` call adds a structured log entry (the log event catalog lives in `staging/api/lib/logging/log-events.ts`; add a new event ID if the existing one doesn't fit)
- `createError(400, ...)` throws a typed error that the global error handler converts to a 400 response
- The handler is wrapped in `try/catch` calling `next(err)` so the global error handler in `middleware/error.ts` sees it

#### 3. Add the log event (if needed)

If `HR_EVENTS.EMPLOYEE_DEPARTMENT_QUERY` doesn't exist, add it to `staging/api/lib/logging/log-events.ts`. Find the `HR_EVENTS` block and add:

```typescript
export const HR_EVENTS = {
  // ... existing events ...
  EMPLOYEE_DEPARTMENT_QUERY: { id: 'HR-DEPT-QUERY-001', level: 'info', category: 'hr' },
} as const;
```

The `id` is human-readable (matches the catalog numbering convention); `level` is one of `info`/`warn`/`error`/`debug`; `category` is the broad bucket (used for filtering in the log viewer).

#### 4. Restart the API

```bash
./start-dev.sh stop
./start-dev.sh
```

The API doesn't hot-reload — you need a restart for new routes. (The Web UI hot-reloads automatically, but we're adding an API route, not a UI route.)

#### 5. Test the endpoint

```bash
# Direct curl
curl http://localhost:5182/api/hr/employees/by-department/Engineering
# → { department: "Engineering", count: 4, employees: [...] }

# Wrong department
curl -i http://localhost:5182/api/hr/employees/by-department/XYZ
# → 404 (no employees in XYZ)

# Bad input (empty after URL decode)
curl -i "http://localhost:5182/api/hr/employees/by-department/"
# → 404 (Express doesn't match the empty path)
```

For browser-accessible testing, the Web UI's `TestingPortal` page is the canonical UI. Add a button or form there if you want users to trigger it from the UI.

### What if the endpoint needs an API client method?

If the Web UI is going to call this endpoint, add a method to `staging/web-ui/src/api/client.ts`:

```typescript
async listHrEmployeesByDepartment(department: string): Promise<{
  department: string;
  count: number;
  employees: Array<{...}>;
}> {
  return this.request(`/api/hr/employees/by-department/${encodeURIComponent(department)}`);
}
```

Then call it from your page/component:

```typescript
import { api } from '../api/client';
const result = await api.listHrEmployeesByDepartment('Engineering');
```

The `encodeURIComponent` is important — department names with spaces, slashes, or non-ASCII need URL encoding.

### What if the endpoint needs auth?

Some routes check the bearer token. The pattern (from `routes/admin.ts`):

```typescript
const ADMIN_TOKEN = 'gcuid_admin_token_demo';

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Use it on specific routes
router.get('/admin/something', requireAdmin, (req, res) => { ... });
```

For the HR Portal's department query, **read-only is the default** — no auth check needed (matches the other HR routes). If you need admin-only, add `requireAdmin` as middleware on the specific route.

### What if the endpoint is a new resource group (not an addition to an existing route)?

If you're adding a brand-new resource (e.g. `/api/audit-log` doesn't exist yet), create `staging/api/routes/audit-log.ts`:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
const router = Router();

router.get('/', (req, res) => { /* list */ });
router.get('/:id', (req, res) => { /* get one */ });

export const auditLogRoutes = router;
```

Then register it in `staging/api/server.ts`:

```typescript
import { auditLogRoutes } from './routes/audit-log.js';
// ...
app.use('/api/audit-log', auditLogRoutes);
```

Restart, and `/api/audit-log` is live.

### Common dev mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Forgot to restart the API | New route returns 404 | `./start-dev.sh stop && ./start-dev.sh` |
| Used `app.use(...)` instead of `router.get(...)` | All routes inside that file return 404 | Use the exported `router` object |
| Forgot `try/finally` around `Database` | Process exits with "too many open files" under load | Always `db.close()` in `finally` |
| Typo in route path | Browser console shows 404 on the API path | Check the registration in `server.ts` AND the handler's path string |
| Used `'` in a SQL string | SQLite throws a syntax error | Use `?` placeholders with `.all(arg)` or template literals for identifiers |
| Returning raw DB rows | UI gets `Date` objects as strings (timestamps) | Cast dates to ISO strings before returning |

### See also

- §1.5 — the API layer (where new routes plug in)
- §1.6 — the API client (where new client methods go)
- §1.9 — the database schema (what tables to query)
- §1.12 — testing and debugging the new endpoint
- [SysAdmin Guidebook §3.4 Logs and diagnostics](guidebook-sysadmin.md) — where your log event lands

## 1.12 Testing and debugging

This section is the **operational reference for testing changes and diagnosing failures**. It covers the smoke test surface (smoke tests, unit tests, runtime-invariant checks), the debugging workflow (where to look when something goes wrong), and the diagnostic patterns the project uses (PID-scoped cleanup, log-first debugging, config-file vs. state).

### Three layers of testing

The POC has three distinct testing layers, each with a different scope:

| Layer | What it tests | How to run | When to use |
|---|---|---|---|
| **Unit tests** (Jest) | Functions and modules in `packages/core/src/` (e.g. Crockford encoding, state-machine transitions, fuzzy matching) | `npm test` (at repo root) — runs Jest across the workspace | After changing any `@gcuid/core` function. Catches logic bugs. |
| **Smoke tests** (`scripts/smoke-*.ts`) | End-to-end behavior — source-server liveness, connector API, the runtime invariants (registry data + UI-equivalent API) | `./run-smokes.sh` (or `npm run smoke`) — runs the default 2/5 smokes | After changing anything that touches the running stack. Catches wiring bugs. |
| **Runtime invariants** (`scripts/smoke-invariants-runtime.ts`) | Cross-layer consistency: registry data matches connector configs matches port registry; pings succeed against the live stack | `./run-smokes.sh invariants` (or included in default `npm run smoke`) | After any DB migration, port remap, or config change. Catches pre-port-remap-class bugs. |

### Unit tests

The Jest tests live in `packages/core/__tests__/` and `packages/core/src/**/__tests__/`. The current count:

- 21 tests pass
- 4 tests fail (`hr.test.ts` — relative path issues, pre-existing)

Run from the repo root: `npm test`. Or from inside `packages/core`: `jest`.

The Jest config is in `packages/core/jest.config.js`. Tests use the standard Jest pattern (`describe` + `it` + `expect`).

### Smoke tests

Five smoke scripts under `scripts/`:

| Smoke | What it tests | Runs by default? |
|---|---|---|
| `smoke-cs-1.1-hr-source.ts` | Spawns an HR connector on port 5183 from scratch, verifies it serves a record | ❌ No (needs port isolation — run with `npm run smoke:all`) |
| `smoke-cs-2.1-all-sources.ts` | Spawns all 4 connectors + all 4 sources, verifies the full topology | ❌ No (needs port isolation) |
| `smoke-cs-3.1-self-bootstrap.ts` | Mutates the source DBs to verify `seedSourceIfEmpty()` reseeds them on next startup | ❌ No (mutates state) |
| `smoke-cs-4.1-startup-cycle.ts` | **Structural smoke** — verifies the startup scripts discover configs and the orchestration pipeline works, without actually spawning processes | ✅ Yes (default orchestrator) |
| `smoke-invariants-runtime.ts` | The 39-assertion runtime invariant check (see below) | ✅ Yes (default orchestrator) |

**Run via**:

```bash
# Default (PID-safe, runs against the live stack)
./run-smokes.sh
# or
npm run smoke

# List available smokes
./run-smokes.sh --list
# or
npm run smoke:list

# Run everything including port-conflicting smokes
./run-smokes.sh --all
# or
npm run smoke:all

# Run a specific smoke
./run-smokes.sh invariants
```

**The orchestrator** is `scripts/run-smokes.js`. It discovers every `scripts/smoke-*.ts` automatically, runs them in sequence, and aggregates pass/fail. Exit code is non-zero if any smoke fails.

**Three smokes are excluded by default** (the `STACK_CONFLICTING` constant in `run-smokes.js`): cs-1.1, cs-2.1, cs-3.1. They conflict with the user's running stack on the same ports or mutate state. Use `npm run smoke:all` to run them, but only when you're OK with the stack being down/mutated.

### The runtime invariants smoke (the load-bearing one)

`scripts/smoke-invariants-runtime.ts` is **the smoke that catches pre-port-remap-class bugs**. It has 39 assertions across 3 sections:

**Section A — Stack liveness** (9 assertions)

TCP-probes each service port: API (5182), 4 connectors (5183-5186), 4 source servers (5188-5191). If any port is closed, the smoke fails with `port 5183 not listening`.

**Section B — Registry data integrity** (8 assertions)

For each connector, reads `registry.db` and `connector.json`, then asserts:

- `source_systems.api_url` matches `connector.json.connectorServer.port`
- `source_systems.api_secret` matches `connector.json.connectorServer.authToken`
- `connector.json.connectorServer.port` is in `.dev-ports.json` (the port registry)
- The source config exists at `staging/config/sources/src-<id>.json`
- The source config's `port` is also in `.dev-ports.json`
- The source config's `authToken` matches the connector's `upstreamSource.authToken`

**Section C — UI-equivalent probe** (4 + 4 = 8 assertions)

For each connector, calls:

- `GET /api/connectors/<id>/ping` — asserts `reachable=true`, `base_url` matches expected port
- `GET /api/connectors/<id>/health` — asserts `status=healthy`, no `error` field

**Total**: 39 assertions that catch the class of bug where the code is right but the data/config is stale.

**How it caught the pre-port-remap bug**: when `source_systems.api_url` was `http://localhost:8101` (the pre-remap value) instead of `http://localhost:5183`, the smoke failed at the Section B assertion that `api_url` must match the connector's port (5183), with a clear `expected 5183, got 8101` message.

### PID-scoped process management (in smokes)

The smokes do NOT kill processes by port. They kill by **PID-scoped** taskkill:

```typescript
// from scripts/smoke-cs-3.1-self-bootstrap.ts
function cleanupProcesses(childPids: number[]) {
  for (const pid of childPids) {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)]);
  }
}
```

**Why PID-scoped, not port-based?** Port-based cleanup (e.g. `Get-NetTCPConnection | Where-Object LocalPort -in 5183-5186 | Stop-Process`) would kill ANY process listening on those ports — including the user's own running stack. The smoke isn't supposed to fight the user's stack; it should only clean up its own children.

The default orchestrator excludes smokes that need port isolation (cs-1.1, cs-2.1, cs-3.1) so the default run is observation-only.

### Debugging workflow

When something doesn't work, follow this diagnostic ladder:

#### 1. Is the stack up?

```bash
# Quick check
curl http://localhost:5182/health
# or (more detailed)
./run-smokes.sh invariants
```

If the API isn't responding, check `data/logs.db` (the API's log table). If the API process isn't running at all, check `./start-dev.sh` output and look for spawn errors.

#### 2. Is the specific service running?

For a connector/source, probe its port directly:

```bash
# Connector
curl http://localhost:5183/health

# Source server
curl -H "Authorization: Bearer gcuid_source_hr_token_***" \
     http://localhost:5188/health
```

If the port is closed but the API can see it, the connector died after startup. Check `data/logs.db` for the connector's last log entry.

#### 3. Is the data correct?

For pre-port-remap-class bugs:

```bash
sqlite3 staging/data/registry.db "SELECT system_id, api_url, api_port, api_secret FROM source_systems;"
```

Compare with the JSON in `staging/config/connectors/conn-<id>.json`. They should match.

#### 4. Is the request routing correctly?

Trace a single request via the logs:

```bash
sqlite3 staging/data/logs.db "SELECT timestamp, component, event_id, level, message FROM log_events ORDER BY timestamp DESC LIMIT 30;"
```

Look for the request in the log — which component handled it, which event ID, what was the response.

#### 5. Is the issue in the Web UI or the API?

Test the API directly with curl (skipping the UI):

```bash
curl http://localhost:5182/api/connectors/conn-hr/ping
```

If the API works but the UI doesn't, the issue is in `staging/web-ui/src/api/client.ts` or the page's component. Open the browser dev tools Network tab and check the actual request/response.

#### 6. Is the issue a caching problem?

React Query caches aggressively. Force a refresh:

- Browser: Cmd-Shift-R (hard reload)
- React Query: `queryClient.invalidateQueries(...)` in the dev console

If the API returns fresh data but the UI shows stale, the React Query cache key is wrong. See §1.6 for the query-key pattern.

### Reading the logs

Three log sources to know about:

| Source | What it logs | How to query |
|---|---|---|
| `data/logs.db` (`log_events` table) | Every API request, every connector health check, every source-server event | `sqlite3 staging/data/logs.db "SELECT * FROM log_events ORDER BY timestamp DESC LIMIT 30;"` |
| Per-process stdout | The connector/source-server processes log to stdout (captured by `start-connectors.ts`/`start-sources-all.ts` PID files). | `cat staging/data/logs/.connectors.log` or similar (paths are in the start script config) |
| `logs.db` via the Web UI | The log viewer (`/logs` page) queries `log_events` with filters | Open `http://localhost:5181/logs` |

The structured log event catalog is `staging/api/lib/logging/log-events.ts`. Every event ID maps to a category + level. When debugging, search by event category first (`hr`, `connector`, `source`, `api`), then by event ID, then by message text.

### Common issues and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Stack says it's up but API returns 502 | Source server isn't bound on its port | Check `start-dev.sh` output; restart |
| `ping` returns `reachable: false base_url: 8101` | Pre-port-remap-style stale port in `source_systems.api_url` | Run `./run-smokes.sh invariants` to confirm; restart API to fire the migration |
| API returns 200 but UI shows old data | React Query cache key mismatch | Hard-reload browser; check query key in dev tools |
| New route returns 404 | Forgot to restart API | `./start-dev.sh stop && ./start-dev.sh` |
| Source DB is empty | `seedSourceIfEmpty()` skipped (DB existed but was empty) | Manually run `tsx staging/scripts/seed-data.ts --source=<id>` |
| Connector process dies silently | Startup error (port in use, bad config, missing DB) | Check `data/logs.db` for the component's startup log line |
| `npm run build` fails with TS errors in `packages/core/` | Type mismatch between staged TS and staged code | Run `npm run build --workspace=@gcuid/core` to see the specific errors |

### Adding a new smoke

Create `scripts/smoke-<topic>.ts`:

```typescript
#!/usr/bin/env -S npx tsx
import assert from 'node:assert/strict';

async function smokeTest() {
  // ... your assertions ...
  assert.equal(actual, expected, 'message');
  console.log('  ✓ assertion passed');
}

smokeTest().then(() => {
  console.log('PASS: smoke-<topic>');
}).catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
```

The orchestrator (`scripts/run-smokes.js`) picks it up automatically. If your smoke needs port isolation or mutates state, add it to the `STACK_CONFLICTING` array (it'll be excluded from default runs).

### See also

- §1.5 — how to add a new API endpoint to test
- §1.10 — how to add a new connector (the worked example for what to smoke)
- §1.11 — how to add a new API endpoint (the worked example for what to smoke)
- [Tester Guidebook](guidebook-tester.md) — the test authoring reference
- [SysAdmin Guidebook §3.4 Logs and diagnostics](guidebook-sysadmin.md) — log event catalog
- [SysAdmin Guidebook §3.5 Database administration](guidebook-sysadmin.md) — debugging DB issues

## 1.13 Build, package, ship

This section is the **build pipeline reference** — how the workspace packages compile, how the staging runtime assembles, and how the Web UI bundles for production.

### Workspace build

The repo root has a `package.json` with workspace-aware scripts:

```json
{
  "scripts": {
    "build":   "npm run build --workspaces",
    "test":    "npm run test --workspaces",
    "clean":   "npm run clean --workspaces && rm -rf node_modules",
    "smoke":   "node scripts/run-smokes.js",
    "smoke:list": "node scripts/run-smokes.js --list",
    "smoke:all":  "node scripts/run-smokes.js --all"
  }
}
```

`npm run build --workspaces` builds each package in dependency order:

1. `@gcuid/core` (no internal deps) → `packages/core/dist/`
2. `@gcuid/federation` (depends on core) → `packages/federation/dist/`
3. `@gcuid/attributes` (depends on core + federation) → `packages/attributes/dist/`
4. `@gcuid/api` (depends on core + federation + attributes) → `packages/api/dist/`

The staging API imports `packages/core/dist/connector-api.js` and `packages/core/dist/source-api.js` directly via `require()` paths, so it picks up the rebuilt code on next start.

### Building the Web UI for production

```bash
cd staging/web-ui
npm run build
# → staging/web-ui/dist/ (static HTML/JS/CSS)
```

The Vite build produces a static bundle. The staging API serves this directly when `NODE_ENV=production`:

```typescript
// from staging/api/server.ts (production mode block)
if (WEB_UI_DIST_EXISTS) {
  app.use(express.static(WEB_UI_DIST));
  app.get('*', (req, res) => res.sendFile(path.join(WEB_UI_DIST, 'index.html')));
}
```

In dev mode (`./start-dev.sh`), Vite serves on `:5181` with the `/api` proxy to `:5182` — no static bundle needed.

### What staging/ builds (and what it doesn't)

- **`staging/api/`** — TypeScript files run via `tsx` (no compile step in dev). For production you'd `tsc` them into `dist/`. The current POC skips this since it's local-only.
- **`staging/cli/`** — Separate CLI executable. Builds via `npm run build` (its own `package.json`).
- **`staging/web-ui/`** — Vite bundles to `dist/` on `npm run build`.
- **`staging/scripts/`** — Run via `tsx` directly. No build step.

### Building a single workspace package

```bash
# Just @gcuid/core
npm run build --workspace=@gcuid/core

# Just @gcuid/attributes
npm run build --workspace=@gcuid/attributes
```

Useful when you've only changed one package and don't want to rebuild the whole workspace.

### Clean rebuild

If a build is in a bad state:

```bash
# Clean all workspace packages
npm run clean --workspaces

# Clean one
npm run clean --workspace=@gcuid/core

# Nuclear option: blow away node_modules and reinstall
rm -rf node_modules packages/*/node_modules
npm install
```

### The dev/prod boundary

The POC is **local-only by design**. The README's "local-only" notice is the binding constraint.

What this means in practice:

- **Don't add Dockerfile or `deploy.yml` files** — they imply production deployment and conflict with the local-only stance.
- **Don't add HTTPS termination code** — the local stack runs HTTP only.
- **Don't add production middleware** (helmet, rate-limit, csrf) — the API is local-only.
- **Do keep the dev scripts working** — `./start-dev.sh`, `./run-smokes.sh`, `./stop-dev.sh` are the canonical local workflow.

### Workspace boundaries (when to add code where)

| If you're adding... | Put it in... | Why |
|---|---|---|
| A new identifier format | `packages/core/src/index.ts` (GCUIDManager) or `packages/core/src/crockford-base32.ts` (encoding) | These are library code; multiple consumers may want it |
| A new connector HTTP route | `packages/core/src/connector-api.ts` | It's the connector HTTP server's surface |
| A new source HTTP route | `packages/core/src/source-api.ts` | Same, for sources |
| A new staging API endpoint | `staging/api/routes/<resource>.ts` (existing or new file) + register in `server.ts` | The staging layer is the consumer-facing API |
| A new page | `staging/web-ui/src/pages/<Name>Portal.tsx` + register route in `App.tsx` | Each page is its own file |
| A new operational script | `start-dev.sh` (start) / `stop-dev.sh` (stop) / `run-smokes.sh` (smokes) / `scripts/smoke-<topic>.ts` (smoke) | Canonical script layout |
| A new docs file | `docs/<topic>.md` | Operational docs live in `docs/`, code-adjacent docs can live next to the code |

### See also

- §1.4 — the workspace packages and how they compile
- §1.5 — the staging runtime (where staging imports `dist/` from)
- §1.8 — the third-party dependency catalog
- §1.12 — how to test the build (smokes + invariants)
- [SysAdmin Guidebook §3.1 Local install](guidebook-sysadmin.md) — operational counterpart
- [Architect Guidebook §4.8 Why local-only](guidebook-architect.md) — the local-only rationale

## See also

- [User Guidebook](guidebook-user.md) — what end users see
- [SysAdmin Guidebook](guidebook-sysadmin.md) — operating the stack
- [Architect Guidebook](guidebook-architect.md) — design intent and trade-offs
- [Tester Guidebook](guidebook-tester.md) — test surface and how to add tests
