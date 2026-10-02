# System Administrator Guidebook

**For**: Operators, DevOps engineers, and the user themselves running GCUID-POC locally.
**Not for**: End users (see [User Guidebook](guidebook-user.md)), developers extending the codebase (see [Developer Guidebook](guidebook-developer.md)), or design reviewers (see [Architect Guidebook](guidebook-architect.md)).

This guidebook is the operational reference for the GCUID-POC stack — start, stop, configure, troubleshoot, back up.

## Table of contents

| # | Section | What's covered |
|---|---|---|
| 3.1 | [Who this is for](#31-who-this-is-for) | Audience model, what you should already know |
| 3.2 | [System overview](#32-system-overview) | The 9 processes, their ports and roles |
| 3.3 | [Starting and stopping the stack](#33-starting-and-stopping-the-stack) | Cross-platform startup via `start-dev.sh` / `start-dev.bat` / `start-dev.ps1` |
| 3.4 | [Port and process reference](#34-port-and-process-reference) | The full port allocation (5181-5191), 5187 reservation |
| 3.5 | [Authentication tokens](#35-authentication-tokens) | Registry admin, connector auth, source auth |
| 3.6 | [Database management](#36-database-management) | Schema overview, integrity checks, the `registry.db` reset workflow |
| 3.7 | [Seed data and scenarios](#37-seed-data-and-scenarios) | `seed-data.ts`, `--source=<name>` flag, per-source self-bootstrap |
| 3.8 | [Log files and observability](#38-log-files-and-observability) | `logs.db` schema, the dashboard, source-health card |
| 3.9 | [Troubleshooting common failures](#39-troubleshooting-common-failures) | Symptom → fix catalog |
| 3.10 | [Updating the stack](#310-updating-the-stack) | Port changes, schema migrations, breaking changes |
| 3.11 | [Security model](#311-security-model) | Token rotation, local-only posture, what NOT to do |

## See also

- [Developer Guidebook](guidebook-developer.md) — for engineers
- [User Guidebook](guidebook-user.md) — for end users
- [Architect Guidebook](guidebook-architect.md) — design intent
- [Tester Guidebook](guidebook-tester.md) — the test surface

## 3.1 Who this is for

This guidebook is the **operational reference for running the GCUID-POC stack**. It's for the people who start the stack, stop it, configure it, watch its logs, troubleshoot its failures, and prepare it for handoff to a client.

### Audience model

The primary audiences for this guidebook are:

- **The user themselves** — running the POC on their workstation to develop, demo, or evaluate.
- **Operators / DevOps engineers** (if any) — in the local-only deployment model, this is usually the same person as above. If the POC graduates to production, this would be a separate role.
- **Client handoff recipients** — the person or team who receives the POC and needs to run it locally after handoff.

The guidebook assumes the reader:

- Has shell access to a workstation (Windows, macOS, or Linux).
- Knows how to read and edit JSON files.
- Knows how to use `curl` or similar HTTP client to hit endpoints.
- Knows what a process is and how to kill one if it misbehaves.
- Has `node`, `npm`, and `git` installed (the codebase is Node + npm + git).

### What this guidebook is NOT

This guidebook is not:

- An **end-user manual** — for that, see the [User Guidebook](guidebook-user.md).
- A **developer reference** — for that, see the [Developer Guidebook](guidebook-developer.md).
- An **architectural deep-dive** — for that, see the [Architect Guidebook](guidebook-architect.md).
- A **test-writing guide** — for that, see the [Tester Guidebook](guidebook-tester.md).

If you're looking for "what does this button do" or "how do I add a new endpoint", you're in the wrong guidebook.

### How to use this guidebook

The guidebook is structured for **operators in motion** — someone who's actively running the stack and needs to find an answer quickly. Each section is a self-contained reference. Use the table of contents to jump to the topic; cross-links (§3.x) point to related operational concerns.

### Personas (what the system models internally)

The runtime models three operational personas, each with a distinct token and capability set:

| Persona | Demo identity | Token | Capability |
|---|---|---|---|
| **End User** (identity subject) | Jane Smith (`jane.smith@example.com`) | `staging_user_token_abc123` | Request identity, check status, view own info |
| **Departmental Operator** (connector manager) | HR Administrator (`hr.admin@example.com`) | `staging_dept_token_def456` | Monitor connectors, view queries, manage departmental data |
| **Central System Administrator** | System Administrator (`admin@example.com`) | `staging_admin_token_ghi789` | Approve identities, manage duplicates, configure sources, query attributes |

These tokens are configured at `staging/config/default.json:60-62` and `staging/config/users.json`. The persona-token mapping is what the API uses to enforce capability boundaries — every API request that touches a persona-gated route must carry one of these three tokens.

The pattern is: **problem → diagnosis → fix**. If something is broken, the relevant section tells you what to check first, what to look for, and what to do.

## 3.2 System overview

This section describes **what runs when the stack is up** — the 9-10 processes, their ports, and the dependency order. If you're new to the stack, read this section first.

### The runtime processes

The POC runs **9-10 processes** on a single workstation:

| Process | Port | Backing | Owner | Started by |
|---|---|---|---|---|
| Web UI | 5181 | none | `start-dev.sh` step 4 | Vite dev server |
| API | 5182 | `registry.db` + `logs.db` | `start-dev.sh` step 3 | `tsx staging/api/server.ts` |
| HR Connector | 5183 | HTTP → `:5188` | `staging/scripts/start-connectors.ts` | per-connector spawn |
| LDAP Connector | 5184 | HTTP → `:5189` | same | same |
| Engineering Connector | 5185 | HTTP → `:5190` | same | same |
| Finance Connector | 5186 | HTTP → `:5191` | same | same |
| HR Source | 5188 | `data/sources/conn-hr.db` | `staging/scripts/start-sources-all.ts` | per-source spawn |
| LDAP Source | 5189 | `data/sources/conn-ldap.db` | same | same |
| Engineering Source | 5190 | `data/sources/conn-engineering.db` | same | same |
| Finance Source | 5191 | `data/sources/conn-finance.db` | same | same |

Note: **5187 is reserved** for an unrelated tool (`ea-mcp-bridge`). The gap keeps the connector ports and source-server ports on clearly-defined number ranges.

### Startup dependency order

The processes must come up in this order:

1. **API first** (port 5182). The registry needs to be up before any connector registers with it.
2. **Source servers** (ports 5188-5191). Connectors need their upstream source to be reachable.
3. **Connectors** (ports 5183-5186). Each connector binds its port and registers with the API's connector catalog.
4. **Web UI last** (port 5181). Vite can start before the API is up, but it'll show "Service unavailable" until the API is reachable.

The `start-dev.sh` script handles this ordering automatically. Manual start should follow the same order.

### What each process is responsible for

#### API (`staging/api/server.ts`)

The central Express server. Responsibilities:

- Routes every `/api/*` endpoint (18 route groups).
- Owns `registry.db` (the central identity registry + source-system catalog).
- Owns `logs.db` (every request is logged here).
- Routes attribute lookups to connectors.
- Runs the seed migration on startup (idempotent — safe to run every time).
- Serves the Web UI bundle from `staging/web-ui/dist/` if it exists (production mode).

#### Connectors (4 processes, `start-connectors.ts` spawns them)

One process per authoritative source. Each loads its config from `staging/config/connectors/conn-<id>.json`, binds its port, and starts serving the `ConnectorAPIServer` HTTP surface.

Responsibilities:

- Expose `/health`, `/info`, `/search`, `/records/:id`, `/records?since=…` endpoints.
- Apply attribute mappings (GCUID ↔ source-specific primary keys).
- Proxy record lookups to the upstream source server.
- Log every request to its own stdout (captured by the spawn script).

#### Source servers (4 processes, `start-sources-all.ts` spawns them)

One process per authoritative source's data store. Each loads its config from `staging/config/sources/src-<id>.json`, binds its port, and starts serving the `SourceAPIServer` HTTP surface backed by SQLite.

Responsibilities:

- Expose `/health`, `/info`, `/search`, `/records/:id`, `/records?since=…` endpoints.
- Read from the per-source SQLite file (`data/sources/conn-<id>.db`).
- Self-bootstrap: if the SQLite file is missing, run `seed-data.ts --source=<id>` to recreate it.

#### Web UI (Vite dev server)

The React-based UI. Responsibilities:

- Serve the static HTML/JS/CSS bundle (or hot-reload from source in dev mode).
- Proxy `/api/*` to `:5182` (the API).
- Render the 27 routes across 24 page components.

### What runs where on disk

```
E:\GitHub\GCUID-POC\
├── staging/                       # the live runtime
│   ├── api/                       # the API server code
│   │   └── server.ts              # entry point
│   ├── web-ui/                    # the Web UI code
│   │   └── src/                   # source
│   ├── scripts/                   # the orchestration scripts
│   │   ├── start-sources-all.ts       # source-server spawner
│   │   └── start-connectors.ts    # connector spawner
│   ├── config/                    # runtime config
│   │   ├── connectors/            # 4 connector JSON configs
│   │   └── sources/               # 4 source JSON configs
│   ├── data/                      # runtime data (created on startup)
│   │   ├── registry.db            # central registry
│   │   ├── logs.db                # structured logs
│   │   └── sources/               # per-source SQLite files
│   └── (operational scripts: start-dev, stop-dev, run-smokes)
├── packages/                      # the @gcuid/* libraries
│   └── core/                      # the runtime library
│       └── dist/                  # compiled output
├── scripts/                       # the smoke tests
└── docs/                          # the documentation
    ├── guidebook-developer.md
    ├── guidebook-sysadmin.md     # (this document)
    ├── guidebook-user.md
    ├── guidebook-architect.md
    └── guidebook-tester.md
```

### What lives in `staging/data/` at runtime

After a successful startup, `staging/data/` contains:

| File | Owner | Purpose |
|---|---|---|
| `registry.db` | API | The central identity registry + source-system catalog |
| `logs.db` | API | The structured log storage |
| `sources/conn-hr.db` | HR Source | The HR SQLite (seeded by `seed-data.ts`) |
| `sources/conn-ldap.db` | LDAP Source | The LDAP SQLite |
| `sources/conn-engineering.db` | Engineering Source | The Engineering SQLite |
| `sources/conn-finance.db` | Finance Source | The Finance SQLite |

If any of these files is missing on startup, the relevant component self-bootstraps (sources run `seed-data.ts`; the API runs the seed migration).

### Where logs go

- **API**: writes structured events to `staging/data/logs.db` via the Winston-backed logger.
- **Connectors**: write to their own stdout, captured by `start-connectors.ts` (look for the connector log file in the spawn script's config).
- **Sources**: same — captured by `start-sources-all.ts`.
- **Web UI**: writes to the browser console (visible in DevTools).

The structured logs in `logs.db` are queryable via:
- The Web UI's log viewer (`http://localhost:5181/logs`)
- Direct SQLite: `sqlite3 staging/data/logs.db "SELECT * FROM log_events ORDER BY timestamp DESC LIMIT 30;"`

### See also

- §3.3 — Starting and stopping the stack
- §3.4 — Port and process reference (full port allocation)
- §3.5 — Authentication tokens (where each token is configured)
- §3.6 — Database management
- §3.7 — Seed data and scenarios
- §3.8 — Log files and observability
- [Developer Guidebook §1.7 The connector system](guidebook-developer.md#17-the-connector-system-plan-b-b3) — developer view of the runtime
- [Architect Guidebook §4.3 Architecture overview](guidebook-architect.md#43-architecture-overview) — architecture view

## 3.3 Starting and stopping the stack

This section is the **operational recipe** for getting the stack up and taking it down. The POC ships with cross-platform operational scripts (`start-dev.{sh,bat,ps1}` and `stop-dev.{sh,bat}`) that handle the multi-process orchestration.

### The canonical start commands

#### Linux / macOS

```bash
./start-dev.sh
```

That's it. The script:
1. Locates the repo root from its own location.
2. Spawns the API (port 5182) in the background, writes its PID to `staging/data/.api.pid`.
3. Spawns the 4 source servers (ports 5188-5191), writes each PID to `staging/data/.source-<id>.pid`.
4. Spawns the 4 connectors (ports 5183-5186), writes each PID to `staging/data/.connectors.pid`.
5. Spawns the Web UI (port 5181) via Vite.

Each child process's stdout is captured to a per-service log file under `staging/logs/`.

#### Windows (cmd)

```cmd
start-dev.bat
```

Same orchestration, using `taskkill` for cleanup and `concurrently` for process management.

#### Windows (PowerShell)

```powershell
.\start-dev.ps1
```

Same orchestration, using PowerShell's process management primitives.

### Start-script options

| Option | What it does |
|---|---|
| `--skip-sources` | Don't start the 4 source servers (useful if you want to debug API-only) |
| `--skip-connectors` | Don't start the 4 connectors (useful if you want to test API ↔ source directly) |
| `--skip-web` | Don't start the Web UI (useful if you're testing the API only) |
| `--help` / `-h` | Print the usage |

You can combine flags: `./start-dev.sh --skip-web --skip-sources` starts only the API and the connectors (useful for testing connector-to-source interaction without the API's resolver logic in the way).

### Typical development session

The most common pattern:

```bash
# Day 1: Initial setup
cd staging
npm install
npm run seed-data

# Go back to repo root and run the canonical scripts
cd ..
./start-dev.sh            # Linux/macOS — or ./start-dev.ps1 / start-dev.bat

# When done for the day
./stop-dev.sh             # Linux/macOS — or stop-dev.bat (no .ps1 equivalent)

# Day 2+: Just start services (from anywhere)
npm run start-all         # Or, from repo root: ./start-dev.sh

# When done
npm run stop-all          # Or, from repo root: ./stop-dev.sh
```

`npm run start-all` / `npm run stop-all` work from any directory because npm switches into `staging/` before running the script; they internally invoke the root-level scripts via `../scripts/run-dev.js`.

### Where the logs go

When you use the auto startup scripts (`start-dev.*` or `npm run start-all`), service output is written to `staging/logs/`:

| Log file | What it captures |
|---|---|
| `staging/logs/api.log` | The central API server (port 5182) |
| `staging/logs/web.log` | The Web UI dev server (port 5181) |
| `staging/logs/connectors.log` | All 4 connectors (HR/LDAP/Engineering/Finance on 5183-5186) |
| `staging/logs/sources.log` | All 4 source servers (HR/LDAP/Engineering/Finance on 5188-5191) |

On Windows, each service also writes to its own PowerShell window if you launched with `start-dev.ps1`. On Linux/macOS the log files are the canonical source of truth — `tail -f staging/logs/*.log` from the repo root gives you live output.

The `staging/logs/` directory is **gitignored** — it's runtime-only output, not deliverable to the client.

### Verifying the stack is up

After running `./start-dev.sh`, wait ~3-5 seconds for all processes to bind their ports, then check:

```bash
# All ports listening?
netstat -an | grep -E "5181|5182|5183|5184|5185|5186|5188|5189|5190|5191"
# Expected: 9-10 lines, one per process

# API health (should return {"status":"ok"})
curl http://localhost:5182/health

# HR connector health (should return connector metadata)
curl http://localhost:5183/health

# HR source health (requires source token)
curl -H "Authorization: Bearer gcuid_source_hr_token_***" \
     http://localhost:5188/health

# Web UI (should return HTML)
curl -I http://localhost:5181/
```

If any check fails, see §3.9 (Troubleshooting).

### The canonical stop commands

#### Linux / macOS

```bash
./stop-dev.sh
```

The script:
1. Reads every PID file under `staging/data/` and kills the corresponding process.
2. Falls back to port-based cleanup if any PID file is missing or stale (looks up the process listening on each port and kills it).
3. Verifies all 10 ports are free.
4. Cleans up the PID files.

**Important**: `stop-dev.sh` does NOT touch port 5187 (reserved for `ea-mcp-bridge`). It only kills processes on ports 5181-5186 and 5188-5191.

#### Windows (cmd)

```cmd
stop-dev.bat
```

Same logic, using `taskkill /F /PID` for PID-based cleanup and `netstat` for port-based fallback.

### Stop-script behaviour

The stop scripts are **safe to run multiple times** — they check if the PID is alive before killing. If a process is already gone, the script just removes the PID file.

The stop scripts are **NOT safe to run while another `start-dev.sh` is in progress** — there's no lock file. If you're scripting both, add your own lock.

### What gets stopped

The stop script kills:

- All processes with PID files matching `staging/data/.*.pid`.
- Any process listening on the standard GCUID ports (5181-5186, 5188-5191).
- The Web UI's Vite process.

The stop script does NOT kill:

- Processes listening on port 5187 (ea-mcp-bridge).
- The user's other Node apps or any unrelated processes on other ports.
- The shell that started `./start-dev.sh`.

### Restart vs stop-then-start

For most changes, `stop-dev.sh && start-dev.sh` is the canonical restart. The Vite dev server hot-reloads on its own (no restart needed for `staging/web-ui/src/` changes). The API does NOT hot-reload — it requires a full restart for any change to `staging/api/`.

### Manual start (when the scripts don't fit)

Sometimes you need to start a single process manually — for example, when debugging a connector's startup error. The pattern:

```bash
# API only
tsx staging/api/server.ts

# Single source (when debugging the source server)
tsx staging/scripts/start-sources-all.ts --only=src-hr
```

For these manual starts, you'll also need to manage the PID yourself (or just kill by port when you're done).

### Cross-platform script coexistence

The POC ships **3 variants** of the start script and **2 variants** of the stop script:

| Script | Linux/macOS | Windows cmd | Windows PowerShell |
|---|---|---|---|
| Start | `start-dev.sh` | `start-dev.bat` | `start-dev.ps1` |
| Stop | `stop-dev.sh` | `stop-dev.bat` | (use Task Manager) |

The client receiving the POC may run on any of these platforms. The scripts are kept functionally equivalent — the same options, the same process ordering, the same PID files.

### MSYS path translation (bash on Windows)

When `start-dev.sh` is run under MSYS (git-bash on Windows), the paths use Unix-style (`/e/GitHub/...`) but Node.js expects Windows-style (`C:/...`). The bash scripts detect MSYS and call `cygpath -w` to convert paths before passing them to Node.js.

If you see `cannot find module /e/GitHub/...` errors, the path translation is broken — check that `cygpath` is in your PATH.

### What NOT to do

- **Don't run multiple `start-dev.sh` instances in parallel** — they'll fight over ports. The script doesn't have a lock file.
- **Don't kill processes by hand without updating the PID files** — the next `stop-dev.sh` will try to kill a dead PID and fail silently.
- **Don't run `start-dev.sh` from a directory other than the repo root** — the script uses `$BASH_SOURCE` to locate itself; running it via a relative path may break.
- **Don't add a `set -x` to the start script** — the verbose output will flood your terminal.

### See also

- §3.4 — Port and process reference
- §3.5 — Authentication tokens
- §3.6 — Database management
- §3.8 — Log files and observability
- §3.9 — Troubleshooting common failures

## 3.4 Port and process reference

This section is the **canonical port allocation table** plus the per-process responsibilities. If you ever see a port conflict, a misbehaving service, or a question about which process owns which port, this is the reference.

### Master port allocation

| Port | Process | Owns | Backing | Started by |
|---|---|---|---|---|
| 5181 | Web UI | Vite dev server (browser-facing) | none | `start-dev.sh` step 5 |
| 5182 | API Server | All `/api/*` routes | `registry.db`, `logs.db` | `start-dev.sh` step 2 |
| 5183 | HR Connector | `conn-hr` source adapter | HTTP → source | `start-sources-all.ts → start-connectors.ts` |
| 5184 | LDAP Connector | `conn-ldap` source adapter | HTTP → source | same |
| 5185 | Engineering Connector | `conn-engineering` source adapter | HTTP → source | same |
| 5186 | Finance Connector | `conn-finance` source adapter | HTTP → source | same |
| 5187 | (reserved) | ea-mcp-bridge | (out of POC scope) | n/a — see §3.10 |
| 5188 | HR Source | `conn-hr.db` (read/write) | SQLite | `start-sources-all.ts` |
| 5189 | LDAP Source | `conn-ldap.db` (read/write) | SQLite | same |
| 5190 | Engineering Source | `conn-engineering.db` (read/write) | SQLite | same |
| 5191 | Finance Source | `conn-finance.db` (read/write) | SQLite | same |

**Reserved port 5187 is critical**: ea-mcp-bridge runs on it independently. The GCUID scripts never touch 5187, and if you see anything listening on 5187 from a GCUID process, that's a bug.

### How port numbers were chosen

- 5180-5190 is an unusual range — most dev tools default to 3000, 8000, 8080, 8888, etc. Picking 5180+ keeps the POC from colliding with other local development on the same machine.
- 5181 (Web UI) and 5182 (API) are intentionally adjacent and easy to remember.
- 5183-5186 (connectors) are sequential in alphabetical order of the connector name.
- 5188-5191 (sources) mirror the connector ports and are 5 numbers higher — same ordering.
- 5187 is sandwiched between connectors and sources because it's reserved for the unrelated ea-mcp-bridge tool and shouldn't be allocated to either group.

### Per-process responsibilities

#### Web UI (5181)

- Serves the React app via Vite.
- Proxies `/api/*` to `http://localhost:5182` (see `staging/web-ui/vite.config.ts`).
- Hot-reloads on file changes in `staging/web-ui/src/`.
- Does NOT process business logic — the API does.

#### API Server (5182)

- 19 route files (each covering a domain: hr, identity, sources, departments, admin, etc.).
- 18 route groups under `staging/api/routes/`.
- Backed by `registry.db` (canonical state) and `logs.db` (audit trail).
- Reads configs from `staging/config/` and `staging/config/connectors/`.
- Does NOT know how to talk to source DBs — it asks the connectors.

#### Connectors (5183-5186)

- 1 process per authoritative source.
- HTTP server providing `/health`, `/search`, `/record/:id`, `/records?since=...`, `/records/:id` (PUT for updates).
- Reads configs from `staging/config/connectors/conn-<id>.json`.
- Uses the connector-API library to talk to the source via HTTP (port 5188-5191).
- Maintains a small in-memory cache; not persistent.

#### Source Servers (5188-5191)

- 1 process per authoritative source.
- HTTP server with 5 endpoints + info (see Developer Guidebook §1.7).
- Backed by a per-source SQLite file: `staging/data/sources/conn-<id>.db`.
- Authenticated by source tokens (`gcuid_source_<name>_token_***`).
- Does NOT know about the registry — it only knows about its own records.

### Per-port health checks

```bash
# Web UI (no auth)
curl -I http://localhost:5181/

# API (no auth for /health)
curl http://localhost:5182/health
# Expected: {"status":"ok"}

# HR connector (no auth for /health)
curl http://localhost:5183/health
# Expected: {"sourceId":"hr","status":"healthy",...}

# HR source (requires source token)
curl -H "Authorization: Bearer gcuid_source_hr_token_***" \
     http://localhost:5188/health
# Expected: {"status":"ok","records":<n>}
```

### Port-collision recovery

If `start-dev.sh` fails with `EADDRINUSE` on a specific port, the typical cause is a leftover process from a previous run. To diagnose:

```bash
# Linux/macOS
lsof -i :5183

# Windows (cmd)
netstat -ano | findstr :5183

# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 5183 -State Listen
```

Then kill the offending PID. If you're sure the conflict is from a prior GCUID run, `./stop-dev.sh` should clean it up.

### The port registry

The canonical port allocation for the GCUID stack lives in `/e/github/.dev-ports.json` (outside the repo — managed by the user's workspace tooling). When adding new services, allocate the next free port in the 5190+ range and update the registry.

### See also

- §3.3 — Starting and stopping the stack (the start/stop scripts that use these ports)
- §3.5 — Authentication tokens
- §3.9 — Troubleshooting (EADDRINUSE, port conflicts)
- [Architect Guidebook §4.3 Architecture overview](guidebook-architect.md#43-architecture-overview) — design rationale
- [Developer Guidebook §1.7 The connector system](guidebook-developer.md#17-the-connector-system-plan-b-b3) — developer perspective on the ports

## 3.5 Authentication tokens

This section is the **token map** — which process authenticates to which, with which token, and where the token lives. If you're debugging a 401 or 403, start here.

### Token taxonomy

The POC uses **three classes of Bearer tokens**:

| Class | Format | Purpose |
|---|---|---|
| Source token | `gcuid_source_<name>_token_<random>` | Source server authenticates the connector calling it |
| Connector token | `staging_<name>_token_<random>` | Registry API authenticates the connector pushing state |
| Admin token | (none in POC) | Reserved for future — currently no admin-only endpoints |

Both `gcuid_source_*` and `staging_*` are **demo tokens** (e.g. `gcuid_source_hr_token_12345`). They're trivially guessable because the POC is **local-only** and never exposed to a network. See §3.8 for why this is fine in the POC context.

### Source tokens (connector → source)

The connector authenticates to the source server using the source's auth token. The token is in two places:

1. **The source's config file**: `staging/config/sources/src-<name>.json` (the source reads it).
2. **The connector's config file**: `staging/config/connectors/conn-<name>.json` (the connector reads it).

Both must agree. If they drift, the connector gets 401 from the source.

Example:

```json
// staging/config/sources/src-hr.json
{
  "sourceId": "conn-hr",
  "authToken": "gcuid_source_hr_token_12345",
  ...
}

// staging/config/connectors/conn-hr.json — relevant excerpt
{
  "sourceConnection": {
    "upstreamSource": {
      "baseUrl": "http://127.0.0.1:5188",
      "authToken": "gcuid_source_hr_token_12345"
    }
  }
}
```

### Connector tokens (connector → registry)

The connector authenticates to the registry API using its connector token. The token is in two places:

1. **The connector's config file**: `staging/config/connectors/conn-<name>.json` (the connector reads it).
2. **The registry's `connector_auth_tokens` table**: stored in `registry.db` (the API validates against it).

Both must agree. The seed migration `004_connector_auth_tokens_seed.sql` (in `staging/api/routes/admin.ts:2414`) inserts the canonical mapping for all 4 connectors.

### Token rotation (not implemented)

The POC does **not** implement token rotation. To change a token:

1. Generate a new token (any random string; the POC accepts any non-empty value).
2. Update BOTH copies (source config + connector config, OR connector config + DB).
3. Restart the affected processes.

For production, the design includes a `tokens.rotate_at` column and an admin endpoint, but those are not implemented in the POC.

### Adding a new source's tokens

To add tokens for a new source (e.g. `conn-facilities`):

1. Generate two strings: `gcuid_source_facilities_token_<random>` (source-side) and `staging_facilities_token_<random>` (connector-side).
2. Create `staging/config/sources/src-facilities.json` with the source token.
3. Create `staging/config/connectors/conn-facilities.json` with both tokens.
4. Add a row to the `connector_auth_tokens` table in `registry.db` for the connector token.
5. Restart API + new source + new connector.

Step 4 is the **load-bearing** step that's easy to miss. Without it, the API rejects every push from the connector with 401.

### Verifying tokens work

```bash
# Source token: connector → source
curl -H "Authorization: Bearer gcuid_source_hr_token_12345" \
     http://localhost:5188/health
# Expected: 200 OK with body

# Wrong token: should fail
curl -H "Authorization: Bearer wrong-token" \
     http://localhost:5188/health
# Expected: 401 Unauthorized

# Connector token: connector → registry
curl -H "Authorization: Bearer staging_hr_token_12345" \
     http://localhost:5182/api/system/dashboard
# Expected: 200 OK
```

### Tokens in the development environment

In the POC's default config, all tokens are **trivially guessable demo strings** (e.g. `_12345`, `_abcdef`). This is intentional — the POC is local-only and the goal is reproducibility, not security.

**For production or any internet-facing deployment, replace ALL tokens with high-entropy secrets and rotate them regularly.** The config-loader accepts any non-empty string, so you can swap in JWTs, UUIDs, or a Vault-managed secret without code changes.

### What the POC does NOT do

The POC explicitly does NOT implement:

- Token expiration / TTL.
- Token refresh flows.
- Per-source rate limiting.
- Audit logging of token use (the registry logs all requests by route, not by token).
- Token revocation (a leaked token stays valid until you rotate it).
- Scoped tokens (every source token has the same permissions).

These are listed as **out-of-scope** for the POC — see [Architect Guidebook §4.9 Mapping to a real deployment](guidebook-architect.md#49-mapping-to-a-real-deployment) for how each would be addressed.

### See also

- §3.4 — Port and process reference
- §3.6 — Database management (where the connector auth tokens live in `registry.db`)
- §3.8 — Why the POC is local-only
- [Architect Guidebook §4.7 Security model](guidebook-architect.md#47-security-model)

## 3.6 Database management

This section is the **schema overview, integrity checks, and the `registry.db` reset workflow**. The POC uses SQLite for all persistence — `registry.db` (canonical state), `logs.db` (audit trail), and 4 per-source DBs (`conn-<id>.db`).

### Database inventory

| DB | Location | Owner | Schema source | Purpose |
|---|---|---|---|---|
| `registry.db` | `staging/data/` | API Server | `staging/api/routes/admin.ts` migrations | Canonical identity + source state |
| `logs.db` | `staging/data/` | API Server | same | Audit trail (request log, attribute log) |
| `conn-hr.db` | `staging/data/sources/` | HR Source Server | `start-sources-all.ts` seed | HR employee records |
| `conn-ldap.db` | `staging/data/sources/` | LDAP Source Server | same | LDAP entries |
| `conn-engineering.db` | `staging/data/sources/` | Engineering Source Server | same | Engineering assets |
| `conn-finance.db` | `staging/data/sources/` | Finance Source Server | same | Finance records |

Total: 6 SQLite databases. 1 canonical (`registry.db`), 1 audit (`logs.db`), 4 per-source.

### Schema overview

The full schema lives in `staging/api/routes/admin.ts` (CREATE TABLE statements scattered through the file) and `staging/scripts/start-sources-all.ts` (per-source DDL). The full schema walkthrough is in [Developer Guidebook §1.9 Database schema](guidebook-developer.md#19-database-schema) — this section covers the operations side.

The key tables in `registry.db`:

- `identities` — canonical identity rows (one per GCUID).
- `attributes` — identity attribute history (who-asserted-what-when).
- `identity_states` — current state per identity (`provisional`, `active`, `under_review`, `suspended`, `retired`, `archived`).
- `identifier_states` — current state per GCUID (`reserved`, `issued`, `nullified`, `superseded`, `tombstoned`).
- `source_systems` — registered sources (id, type, baseUrl, status).
- `connector_auth_tokens` — bearer tokens for the connectors.
- `connectors` — per-source connector config mirror (so the registry can introspect without re-reading JSON).
- `audit_log` — append-only event log (state changes, attribute changes).
- `person_attributes` — denormalized view of the most-recent attribute per (person, attribute).
- `departments` — department/department lookup.
- `dept_sources` — many-to-many between departments and sources.
- `policies` — policy rows (ABAC decisions).
- `policies_test_seed` — test data for the policy engine.
- `logs` — request log (written by `logs.db`, but conceptually similar).

Plus 15+ auxiliary tables (`migrations`, `correlations`, `alerts`, etc.) — see §1.9 for the full list.

### Database integrity checks

The runtime-invariant smoke (`scripts/smoke-invariants-runtime.ts`) verifies 8 database invariants:

1. `source_systems.api_url` resolves to a live port.
2. Every connector in `source_systems` has a matching `connector_auth_tokens` row.
3. Every `connector_auth_tokens` row has a matching config file on disk.
4. The 4 source DBs exist and contain their seed table.
5. The `identities` row count matches the sum of `person_attributes` rows (per identity).
6. No identity has more than one `active` state row.
7. No `identifier_states` row has `nullified` status while still having a non-tombstoned `issued` row.
8. `logs.db` has at least one entry from the last 24 hours (sanity check the API is writing).

The smoke fails loudly if any of these break. If you see a smoke failure pointing at "B-section" — that's a DB invariant check.

### Resetting the registry (the dangerous operation)

Sometimes you need to start fresh — for example, after a destructive test or when the seed data has drifted. The reset workflow:

```bash
# 1. Stop the API (release the SQLite file lock)
./stop-dev.sh

# 2. Delete the registry (this is irreversible!)
rm staging/data/registry.db staging/data/registry.db-shm staging/data/registry.db-wal

# 3. Restart the API — it will auto-create the schema + run migrations + seed
./start-dev.sh
```

After step 3, the API will:
1. Create a fresh `registry.db` with the schema from `admin.ts`.
2. Run the seed migrations (connector_auth_tokens, departments, etc.).
3. Have an empty `identities` table — you'll need to trigger a connector push to populate it.

**This wipes all registered identities**. If you have test data you want to preserve, snapshot first:

```bash
cp staging/data/registry.db staging/data/snapshots/registry-<timestamp>.db
```

### Schema reset vs data reset

Two different operations:

| Operation | What it changes | When to use |
|---|---|---|
| Schema reset | Drop the DB and let it recreate from `admin.ts` | After schema changes (rare in POC) |
| Data reset | Delete rows from specific tables, keep the schema | When the seed data has drifted but the schema is correct |

For data reset, use SQLite directly:

```bash
sqlite3 staging/data/registry.db

sqlite> DELETE FROM identities;
sqlite> DELETE FROM attributes;
sqlite> DELETE FROM identity_states;
sqlite> DELETE FROM identifier_states;
sqlite> VACUUM;
sqlite> .quit
```

This is faster than a full schema reset and preserves the schema-version tracking.

### Source DBs (per-authoritative-source)

The 4 source DBs are independently managed by their respective source servers. Each one:

- Lives in `staging/data/sources/conn-<id>.db`.
- Has a single primary table (e.g. `employees` for HR, `entries` for LDAP, `assets` for Engineering, `records` for Finance).
- Is read/written by its source server only.
- The connector fetches from it via the source's HTTP API (port 5188-5191).
- The connector NEVER reads the source DB directly — that would defeat the source-separation.

To reset a single source DB:

```bash
# 1. Stop the source server for that source
# (kill the process listening on the source's port)

# 2. Delete its DB
rm staging/data/sources/conn-hr.db

# 3. Restart the source — it will re-seed from start-sources-all.ts
./start-dev.sh
```

### Backup-and-restore (manual, recommended pattern)

The POC ships with a `backups/` directory at the repo root (preserved on disk, not advertised in user-facing docs). The canonical backup pattern:

```bash
# Before any destructive operation:
TS=$(date +%Y%m%d-%H%M%S)
cp staging/data/registry.db backups/registry-${TS}.db
cp staging/data/logs.db backups/logs-${TS}.db

# Restore:
cp backups/registry-${TS}.db staging/data/registry.db
# (and restart the API to release file locks)
```

For the source DBs, the same pattern with `staging/data/sources/conn-<id>.db`.

### What NOT to do

- **Don't open the registry DB while the API is running and write to it directly** — you can read (in a separate connection) but writes can cause lock contention. If you need to write, stop the API first.
- **Don't `rm` `registry.db` without restarting the API afterward** — the SQLite file handles (`.db-shm`, `.db-wal`) will be orphaned.
- **Don't edit `registry.db` from a script that holds the connection open for >10 seconds** — long-running writes block the API.
- **Don't try to migrate from MySQL/Postgres** — the schema uses SQLite-specific features (WAL mode, AUTOINCREMENT, JSON1 extension).
- **Don't put the registry on a network filesystem** — SQLite requires local-disk semantics for the WAL.

### See also

- [Developer Guidebook §1.9 Database schema](guidebook-developer.md#19-database-schema) — full DDL walkthrough
- §3.7 — Seed data and scenarios
- §3.9 — Troubleshooting (DB-specific failures)
- [Architect Guidebook §4.10 Open questions](guidebook-architect.md#410-open-questions-and-known-limitations) — known DB limitations

## 3.7 Seed data and scenarios

This section describes the **seed data** that ships with the POC and how to control it for testing scenarios. Seed data is what makes the system look "real" out of the box — without it, the Web UI shows empty tables.

### What gets seeded

Three categories of seed data:

1. **Registry seed** — departments, source registrations, connector auth tokens. Lives in `staging/api/routes/admin.ts` (the migration step). Runs automatically on first API startup.

2. **Source seed** — the per-source DB contents (employees for HR, entries for LDAP, etc.). Lives in `staging/scripts/seed-data.ts`. Runs automatically when a source server starts and finds its DB missing or empty.

3. **Identity seed** — none by default. Identities are created when a connector pushes a record that doesn't yet exist. There's no separate seed script for `identities` rows.

### The seed-data.ts script

`staging/scripts/seed-data.ts` is the canonical source-seed script. It accepts a `--source=<name>` flag and seeds the corresponding per-source DB.

```bash
# Seed HR (creates conn-hr.db with ~50 sample employees)
tsx staging/scripts/seed-data.ts --source=hr

# Seed LDAP
tsx staging/scripts/seed-data.ts --source=ldap

# Seed all four (in sequence)
for s in hr ldap engineering finance; do
  tsx staging/scripts/seed-data.ts --source=$s
done
```

The script is **idempotent** — it checks if the DB exists and has rows; if so, it skips seeding. You can run it multiple times without duplicating rows.

### Auto-seeding on source-server start

When `start-sources-all.ts` brings up a source server, it first checks whether the source's DB exists and has rows. If not, it spawns `seed-data.ts --source=<name>` to populate the DB before the source server binds to its port.

This is the canonical **self-bootstrap** pattern: zero configuration, just run `start-dev.sh` and the sources come up seeded.

To skip auto-seeding (e.g. when debugging an empty-source scenario):

```bash
# Start the source server without seeding (use --only to launch just one)
tsx staging/scripts/start-sources-all.ts --only=src-hr
```

### Source-specific seed profiles

Each source has a different seed profile. The `seed-data.ts` switch maps the `--source=<name>` argument to a hard-coded profile.

| Source | Profile | Sample rows | Notable characteristics |
|---|---|---|---|
| HR | Federal employees | ~50 | Mix of departments, employment types, statuses (active/terminated) |
| LDAP | LDAP entries | ~80 | Includes org-unit hierarchy, group memberships |
| Engineering | Engineering assets | ~30 | Mix of laptops, servers, peripherals; assigned-to employees |
| Finance | Finance records | ~25 | Per-quarter records tied to HR employee IDs |

The exact row counts are hard-coded in `seed-data.ts` and may drift between commits — don't rely on them as a strict invariant.

### Loading custom seed data

To replace the default seed with your own data, the canonical pattern is:

```bash
# 1. Make sure the source is stopped
./stop-dev.sh

# 2. Replace the seed DB with your own
cp my-data/conn-hr-custom.db staging/data/sources/conn-hr.db

# 3. Restart
./start-dev.sh
# The source server will detect the DB exists and skip auto-seeding.
```

Your custom DB must match the expected schema (see `seed-data.ts` for the per-source CREATE TABLE statements). Mismatched schemas cause startup errors.

### Identity-scenario seed scripts

The original build used `staging/scripts/scenarios/scenario-*.ts` scripts to inject specific conflict / duplicate / lifecycle scenarios for visual testing. Those scripts were archived during the pre-handoff cleanup (removed from the repo) and are no longer part of the POC operational workflow.

For demonstrating the same shapes today, use the seeded data directly:

- **Conflict examples** (same identity, different `attribute_value` across sources): see `registry.db` identities `state=affected` — these already carry multiple `source_attributes` rows that show the merge decision panel UI.
- **Duplicate examples** (same person, different `entity_id` per source): see `registry.db` identities whose `source_mappings` rows point at the same employee in HR + LDAP + Engineering + Finance but resolve to distinct GCUIDs — the duplicates page lists them.
- **Lifecycle examples** (active → provisional → suspended): the Web UI State Workflow page lets any operator transition an identity through every transition the state machine allows.

If a regression needs an exact pre-test state that the seed doesn't cover, the fallback is the **registry reset workflow** in §3.6: stop the stack, restore the pre-test DB snapshot, restart.

### The "test isolation" principle

Each smoke test (`scripts/smoke-cs-*.ts`) is expected to start from a **clean baseline**:

1. `registry.db` is in its seeded state.
2. Source DBs are in their seeded state.
3. No leftover identities from prior runs.

The smokes that need exclusive port access (cs-1.1, cs-2.1, cs-3.1) are excluded from `npm run smoke` by default because they mutate the source DBs in ways that would corrupt other smokes' assumptions.

### Seed data is NOT production data

The seed data in `seed-data.ts` is fictional — the names, employee IDs, departments, and records are invented for the POC. **Do not** rely on any specific row in the seed data being a real person, account, or transaction.

For production:

- Replace the seed step with a one-time import from your authoritative sources.
- Remove the `seedSourceIfEmpty()` helper from `staging/scripts/start-sources-all.ts` (or gate it behind a `--no-seed` flag if you want to keep development-time seeding).
- Keep `seed-data.ts` around for development environments only.

### See also

- §3.6 — Database management
- §3.9 — Troubleshooting (when seeding fails)
- [Developer Guidebook §1.10 Adding a new connector](guidebook-developer.md#110-adding-a-new-connector-worked-example) — connector authoring with seed data
- [Tester Guidebook §5.8 Test data management](guidebook-tester.md#58-test-data-management) — systematic seed-data management for tests

## 3.8 Logging and observability

This section describes the **log files** and what they contain. The POC ships with simple per-process log files — enough to debug common issues without a full observability stack (no Prometheus, no Grafana, no APM).

### Log file inventory

| File | Owner | What it contains | Rotation |
|---|---|---|---|
| `staging/logs/api.log` | API Server | API requests, route hits, errors, migrations | None (POC) |
| `staging/logs/connectors.log` | Connectors (all 4) | Connector requests, source fetches, push attempts | None (POC) |
| `staging/logs/sources.log` | Source Servers (all 4) | Source requests, DB queries, errors | None (POC) |
| `staging/logs/web.log` | Web UI (Vite) | Vite output, HMR events, proxy logs | None (POC) |
| `staging/logs/start-connectors.log` | Connector orchestrator | Process spawn output (legacy) | None (POC) |

**Log files do NOT rotate in the POC**. They grow unbounded. For long-running deployments, see the cleanup procedure below.

### Log format

Each log line is `JSON-ish` (some processes write structured JSON, others write text). Example from `api.log`:

```json
{"timestamp":"2026-10-01T14:23:45.123Z","level":"info","route":"/api/identity/search","method":"POST","status":200,"durationMs":42}
{"timestamp":"2026-10-01T14:23:50.456Z","level":"warn","route":"/api/sources/ping","status":503,"message":"HR source unreachable"}
{"timestamp":"2026-10-01T14:24:01.789Z","level":"error","stack":"Error: ...","message":"Migration failed"}
```

The connectors and sources write similar JSON lines. The Web UI log is plain text (Vite's native format).

### Live tail

To follow a log file in real time:

```bash
# Linux/macOS
tail -F staging/logs/api.log

# Windows (PowerShell)
Get-Content staging/logs/api.log -Wait

# Windows (git-bash)
tail -f staging/logs/api.log
```

To follow all log files at once:

```bash
# Linux/macOS (requires `multitail` or similar)
multitail staging/logs/*.log

# Cross-platform alternative
tail -F staging/logs/*.log | grep --line-buffered <pattern>
```

### Filtering logs

The most useful filter is **level**:

```bash
# Show only errors and warnings from the API
tail -F staging/logs/api.log | grep -E '"level":"(error|warn)"'
```

Other useful filters:

```bash
# All requests for a specific route
grep '"/api/identity/search"' staging/logs/api.log

# All 5xx responses
grep '"status":5' staging/logs/api.log

# All errors mentioning a specific module
grep -A5 '"level":"error"' staging/logs/api.log | grep -B2 -A3 'connector-resolver'
```

### The `logs.db` audit trail

The API also writes to a SQLite database: `staging/data/logs.db`. This is a separate channel from the file logs — it's structured for queryability and is the canonical record of API requests.

Schema (simplified):

```sql
CREATE TABLE request_log (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER,
  caller_token TEXT,
  response_size INTEGER
);

CREATE TABLE attribute_log (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  attribute_name TEXT NOT NULL,
  action TEXT NOT NULL,  -- 'assert' | 'merge' | 'reject'
  source_id TEXT,
  old_value TEXT,
  new_value TEXT
);
```

Querying:

```bash
# All requests in the last hour
sqlite3 staging/data/logs.db \
  "SELECT * FROM request_log WHERE timestamp > datetime('now', '-1 hour') ORDER BY timestamp DESC LIMIT 50;"

# All attribute changes for an identity
sqlite3 staging/data/logs.db \
  "SELECT * FROM attribute_log WHERE identity_id = 'abc-123' ORDER BY timestamp DESC;"

# Error rate per route (last 24 hours)
sqlite3 staging/data/logs.db \
  "SELECT route, COUNT(*) as total, SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as errors FROM request_log WHERE timestamp > datetime('now', '-1 day') GROUP BY route ORDER BY errors DESC;"
```

The `logs.db` table does NOT include request bodies or response bodies — only metadata. For body inspection, the file logs are the place.

### Log levels

The processes write at 4 levels:

- `debug` — verbose internal state (off by default; enable with `LOG_LEVEL=debug`).
- `info` — normal operation (request hits, successful operations).
- `warn` — recoverable problems (retry attempts, fallback paths, validation warnings).
- `error` — unrecoverable problems (exceptions, failed migrations, crashes).

To enable debug logging for one process:

```bash
# Set environment variable before starting
LOG_LEVEL=debug ./start-dev.sh
# Or for a single source:
LOG_LEVEL=debug tsx staging/scripts/start-sources-all.ts --only=src-hr
```

### Log cleanup (POC-specific)

Since logs don't rotate in the POC, they grow unbounded. The cleanup pattern:

```bash
# Truncate all log files (loses history, but keeps the files)
> staging/logs/api.log
> staging/logs/connectors.log
> staging/logs/sources.log
> staging/logs/web.log

# Or archive-then-clear
mv staging/logs/api.log staging/logs/api-$(date +%Y%m%d-%H%M%S).log
# (then start-dev.sh will create a fresh api.log on next startup)
```

For long-running deployments, set up a cron/Task Scheduler entry to truncate logs weekly.

### What's NOT in the logs

The POC does NOT log:

- Request or response bodies (only metadata).
- Authentication headers (tokens are stripped before logging).
- WebSocket traffic (the POC doesn't use WebSockets).
- Web UI client-side errors (those go to the browser console, not the server logs).
- Source DB query results (only the query parameters).

If you need body-level logging for debugging, that's an instrumentation step — see [Developer Guidebook §1.12 Testing and debugging](guidebook-developer.md#112-testing-and-debugging).

### See also

- §3.9 — Troubleshooting (common patterns from logs)
- [Developer Guidebook §1.12 Testing and debugging](guidebook-developer.md#112-testing-and-debugging) — debugging ladder

## 3.9 Troubleshooting

This section is the **problem → diagnosis → fix** cookbook for the operational issues you'll hit most often. Each entry is a failure mode with the symptom, the root cause, and the resolution.

### "EADDRINUSE" on startup

**Symptom**: `start-dev.sh` fails with `Error: listen EADDRINUSE: address already in use :::5183` (or another port).

**Diagnosis**: A process from a previous run is still bound to that port.

**Resolution**:

```bash
# Find the process holding the port
lsof -i :5183            # Linux/macOS
netstat -ano | findstr :5183    # Windows cmd
Get-NetTCPConnection -LocalPort 5183 -State Listen   # Windows PowerShell

# If it's a stale GCUID process, ./stop-dev.sh should clean it up
./stop-dev.sh

# If ./stop-dev.sh doesn't find it, kill manually
kill <pid>               # Linux/macOS
taskkill /F /PID <pid>   # Windows
```

After the kill, `./start-dev.sh` should succeed.

### "Cannot find module /e/GitHub/..." on Windows MSYS

**Symptom**: `start-dev.sh` under MSYS reports `Cannot find module /e/GitHub/GCUID-POC/staging/api/server.ts` even though the file exists.

**Diagnosis**: MSYS path translation is broken. The bash script passes Unix-style paths to `node.exe`, which expects Windows-style.

**Resolution**:

```bash
# Verify cygpath is in PATH
which cygpath

# If not, your MSYS install is incomplete — re-install MSYS2 or git-bash

# Workaround: use a Windows-native shell (cmd.exe or PowerShell) for the start scripts
.\start-dev.bat
# or
.\start-dev.ps1
```

### "Port 5187 already in use" — ea-mcp-bridge collision

**Symptom**: GCUID processes complain about port 5187 (you'd see this in any code that mistakenly tried to use 5187).

**Diagnosis**: Port 5187 is reserved for ea-mcp-bridge. The GCUID scripts never use it, so this is a bug, not a config issue.

**Resolution**: Open an issue against the script that tried to use 5187. The fix is to allocate a different port and update `/e/github/.dev-ports.json`.

### Connectors show "Unreachable" in the Web UI

**Symptom**: System → System page shows red "Unreachable" for all 4 connectors. Ping/Health buttons return `fetch failed`.

**Diagnosis**: Usually one of:

1. The connector's source process is not running.
2. The connector's `upstreamSource.baseUrl` in `staging/config/connectors/conn-<id>.json` is wrong (stale port).
3. The source token in the connector config doesn't match the source config.

**Resolution**:

```bash
# 1. Are the source servers running?
curl -H "Authorization: Bearer gcuid_source_hr_token_12345" \
     http://localhost:5188/health
# If this fails, the source server isn't running. Restart.

# 2. Verify the connector's configured baseUrl matches the actual port
grep -A1 upstreamSource staging/config/connectors/conn-hr.json

# 3. Verify the token matches
grep authToken staging/config/sources/src-hr.json
grep authToken staging/config/connectors/conn-hr.json
# (both should show the same token)
```

If step 2 shows a stale port (e.g. 8101 instead of 5188), the registry's `source_systems.api_url` migration didn't catch the stale value. Re-run the API startup migration or see the e5c3b8c fix recipe below.

### "401 Unauthorized" from source server

**Symptom**: Connector gets `401` when calling source's `/search` or `/records` endpoint.

**Diagnosis**: Source token mismatch.

**Resolution**:

```bash
# Check source config
cat staging/config/sources/src-hr.json | grep authToken
# Output: "authToken": "gcuid_source_hr_token_12345"

# Check connector config (the upstreamSource.authToken field)
cat staging/config/connectors/conn-hr.json | grep -A2 upstreamSource | grep authToken
# Output: "authToken": "gcuid_source_hr_token_12345"

# If they differ, update both to the same value and restart
```

### "401 Unauthorized" from registry API

**Symptom**: Connector gets `401` when pushing state to `/api/...` endpoints.

**Diagnosis**: Connector token mismatch — the connector's token doesn't match a row in `connector_auth_tokens`.

**Resolution**:

```bash
# Check connector config
cat staging/config/connectors/conn-hr.json | grep registryAuthToken
# Output: "registryAuthToken": "staging_hr_token_12345"

# Check the registry's token table
sqlite3 staging/data/registry.db \
  "SELECT * FROM connector_auth_tokens WHERE system_id = 'conn-hr';"
# Output should show a matching row

# If missing, run the seed migration (restart the API)
./stop-dev.sh && ./start-dev.sh
```

### "Cannot open database" errors

**Symptom**: API startup fails with `SqliteError: unable to open database file`.

**Diagnosis**: Usually the API can't write to `staging/data/` (permissions) or the path is wrong.

**Resolution**:

```bash
# Check permissions
ls -la staging/data/        # Linux/macOS
icacls staging\data\        # Windows

# Check the path the API is using
grep -r "registry.db" staging/api/lib/db-paths.ts

# If the path resolves to outside the repo, you have a config drift
```

### "Migration failed" on startup

**Symptom**: API exits with `Error: Migration 005 failed: ...`.

**Diagnosis**: A migration script is failing on the existing `registry.db`.

**Resolution**:

```bash
# 1. Read the migration in staging/api/routes/admin.ts to understand what it does
# 2. Try opening the DB manually to see the current state
sqlite3 staging/data/registry.db ".tables"

# 3. If the migration is buggy and the data is corrupted, reset:
./stop-dev.sh
rm staging/data/registry.db staging/data/registry.db-shm staging/data/registry.db-wal
./start-dev.sh
# (you've lost all identity data — restore from backup if you have one)
```

### Source DB seeding fails silently

**Symptom**: `start-dev.sh` succeeds, the source server is up, but querying it returns 0 records.

**Diagnosis**: The auto-seed either failed or was skipped.

**Resolution**:

```bash
# Manually seed
tsx staging/scripts/seed-data.ts --source=hr

# Check the result
ls -la staging/data/sources/conn-hr.db
sqlite3 staging/data/sources/conn-hr.db "SELECT COUNT(*) FROM employees;"
```

### Web UI shows empty data even though DB has rows

**Symptom**: `registry.db` has identities but the Web UI shows "0 results".

**Diagnosis**: React Query cache is stale, OR the Web UI is hitting the wrong API endpoint.

**Resolution**:

1. Hard-refresh the browser (Ctrl+Shift+R / Cmd+Shift+R).
2. Check the Web UI's API client:
   ```bash
   grep -r "api/identity" staging/web-ui/src/api/client.ts | head
   ```
3. Verify the API proxy is forwarding:
   ```bash
   curl http://localhost:5181/api/identity/search  # (should proxy to 5182)
   curl http://localhost:5182/api/identity/search  # (should return data)
   ```

### Pre-port-remap migration bug (e5c3b8c)

**Symptom**: After a fresh checkout of an older commit, the System → System page shows "Unreachable" even though everything is running.

**Diagnosis**: The `source_systems.api_url` values in `registry.db` are stale (e.g. `http://localhost:8101` instead of `http://localhost:5183`). The migration that updates these only handled `NULL OR empty`, not stale-but-non-empty values.

**Resolution**:

```bash
# Apply the e5c3b8c fix recipe manually
sqlite3 staging/data/registry.db <<'SQL'
UPDATE source_systems SET api_url = 'http://localhost:5183' WHERE system_id = 'hr'
  AND (api_url IS NULL OR api_url = '' OR api_url = 'http://localhost:8101');
UPDATE source_systems SET api_url = 'http://localhost:5184' WHERE system_id = 'ldap'
  AND (api_url IS NULL OR api_url = '' OR api_url = 'http://localhost:8102');
UPDATE source_systems SET api_url = 'http://localhost:5185' WHERE system_id = 'engineering'
  AND (api_url IS NULL OR api_url = '' OR api_url = 'http://localhost:8201');
UPDATE source_systems SET api_url = 'http://localhost:5186' WHERE system_id = 'finance'
  AND (api_url IS NULL OR api_url = '' OR api_url = 'http://localhost:8202');
SQL
```

In modern checkouts, the migration in `staging/api/routes/admin.ts:2414-2428` already handles this — but if you checked out an older commit, run the recipe above.

### Smoke orchestrator destroys the user's stack

**Symptom**: Running `npm run smoke -- --all` while the user's stack is running causes the user's processes to be killed.

**Diagnosis**: The smokes `cs-1.1`, `cs-2.1`, `cs-3.1` use port-based process cleanup, which has no notion of "my children" — they kill anything on the port.

**Resolution**: Don't run smokes that need port isolation while the user's stack is running. Either:

1. `./stop-dev.sh` first, run smokes, `./start-dev.sh` after.
2. Use `npm run smoke` (default) — it excludes the destructive smokes.

See [Developer Guidebook §1.12 Testing and debugging](guidebook-developer.md#112-testing-and-debugging) for the full smoke-orchestrator design.

### Web UI 404 on close/back buttons

**Symptom**: Clicking close or back in a React modal leads to a 404 page.

**Diagnosis**: React Router was given a route that only exists in the legacy Nunjucks-rendered pages. The fix is to add a corresponding React route.

**Resolution**: See [Developer Guidebook §1.13 Build, package, ship](guidebook-developer.md#113-build-package-ship) — the close/back buttons must use `useNavigate()` to a known React route, not a Nunjucks-only path.

### "FS_READDIR" / "EBUSY" on Windows

**Symptom**: File operations fail with `EBUSY: resource busy or locked` on Windows.

**Diagnosis**: Some process has the file open. On Windows, file locks are exclusive.

**Resolution**:

```bash
# Find the process holding the file
fsutil file queryProcessesUsing 

# Or via PowerShell
Get-Process | Where-Object { $_.Modules.FileName -like '**' }

# Kill the holding process
taskkill /F /PID <pid>
```

For `staging/data/registry.db`, the most common holder is a leftover Node process from a previous run.

### "TypeError: BetterSQLite3 is not a constructor"

**Symptom**: Any process that uses `better-sqlite3` fails to start with this error.

**Diagnosis**: The native module wasn't rebuilt for the current Node.js version.

**Resolution**:

```bash
# Rebuild native modules
npm rebuild better-sqlite3

# If that fails, nuke node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### "Cannot read properties of undefined (reading 'taggedValues')"

**Symptom**: A script that touches `e.taggedValues` throws on `undefined`.

**Diagnosis**: `taggedValues` is a `Map`, not a plain object. Use `.forEach((v, k) => ...)`.

**Resolution**:

```typescript
// Wrong
for (const [k, v] of Object.entries(e.taggedValues ?? {})) { ... }

// Right
e.taggedValues.forEach((value, key) => { ... })
```

### Where to look first

When something breaks:

1. **`staging/logs/api.log`** — most API issues surface here.
2. **`staging/logs/connectors.log`** — most connector-side issues.
3. **`staging/logs/sources.log`** — most source-server issues.
4. **`staging/logs/web.log`** — most Web UI / Vite issues.
5. **`npm run smoke`** — automated regression detection.
6. **Browser DevTools console** — client-side errors that don't reach the server logs.

### See also

- §3.6 — Database management
- §3.8 — Logging and observability
- [Developer Guidebook §1.12 Testing and debugging](guidebook-developer.md#112-testing-and-debugging) — debugging ladder
- [Tester Guidebook §5.10 Bug-hunting methodology](guidebook-tester.md#510-bug-hunting-methodology) — systematic bug hunt

## 3.10 Client handoff

This section is the **delivery checklist** for handing the POC to a client. It covers what the client needs (files, environment, instructions) and what they don't (the proprietary source code, the internal design notes).

### What's in the delivery

The client receives a **complete repository** including:

- All source code (`packages/`, `staging/api/`, `staging/web-ui/src/`, `staging/scripts/`).
- All operational scripts (`start-dev.{sh,bat,ps1}`, `stop-dev.{sh,bat}`).
- All smoke tests (`scripts/smoke-*.ts`).
- All documentation (`docs/`, including this guidebook).
- Configuration templates (`staging/config/connectors/`, `staging/config/sources/`).
- `LICENSE` file (NOETRONIQ proprietary).
- `README.md` (project overview + quickstart).
- `.gitignore` (excludes node_modules, dist, .archive, backups).

### What's NOT in the delivery

The client does NOT receive:

- Any upstream or proprietary source repos (the POC is standalone).
- The NOETRONIQ-internal Sparx EA model.
- The user's real data (the seed data is fictional).
- The `backups/` directory (operational artifacts not for the client).
- The `.archive/` directories (legacy historical files).
- Any token rotation scripts or production-deployment tooling (those are out of POC scope).

### Pre-handoff checklist

Before sending the repo to the client:

1. **Run the full smoke suite**:
   ```bash
   ./stop-dev.sh
   ./start-dev.sh
   npm run smoke -- --all
   ```
   All smokes should pass.

2. **Verify the Web UI loads**:
   - Open http://localhost:5181/ in a browser.
   - Verify the dashboard renders.
   - Verify System → System shows all 4 sources healthy.

3. **Verify the API responds**:
   ```bash
   curl http://localhost:5182/health
   curl http://localhost:5182/api/system/dashboard
   ```

4. **Verify the token format** — confirm tokens are the documented demo values, not real production secrets.

5. **Verify the LICENSE file** is present and references the correct owner.

6. **Verify the .gitignore** — confirm node_modules, dist, .archive, backups are all excluded.

7. **Strip internal references** from any docs that mention any upstream or proprietary repo (this should already be done; verify with `grep -rE "phi-beta/GCUID|proprietary" --include="*.md"`).

8. **Verify the docs/ documentation map** — open `README.md` and confirm the 5 guidebooks + plan-doc are linked.

### The handoff package

The recommended delivery format:

```bash
# Create a clean tarball (excluding node_modules, dist, .archive, backups, registry.db)
cd ..
tar --exclude='GCUID-POC/node_modules' \
    --exclude='GCUID-POC/dist' \
    --exclude='GCUID-POC/.archive' \
    --exclude='GCUID-POC/staging/.archive' \
    --exclude='GCUID-POC/packages/*/dist' \
    --exclude='GCUID-POC/backups' \
    --exclude='GCUID-POC/staging/data/registry.db' \
    --exclude='GCUID-POC/staging/data/logs.db' \
    --exclude='GCUID-POC/staging/data/sources/*.db' \
    --exclude='GCUID-POC/staging/logs/*.log' \
    --exclude='GCUID-POC/.git' \
    -czf GCUID-POC-<version>.tar.gz GCUID-POC/
```

The client extracts and follows the README's quickstart. On first run, the API creates a fresh `registry.db` and the source servers seed their own DBs.

### What the client should do first

1. **Read `README.md`** — gives the 30-second overview + links to docs.
2. **Read `docs/guidebook-user.md`** — if they're going to USE the system.
3. **Read `docs/guidebook-sysadmin.md` (this file)** — if they're going to OPERATE the system.
4. **Read `docs/guidebook-architect.md`** — if they want to understand the design rationale.
5. **Read `docs/guidebook-developer.md`** — if they're going to MODIFY the system.
6. **Read `docs/guidebook-tester.md`** — if they're going to TEST the system.

### Where to get help

The POC is delivered as-is. There is no SLA, no support contract, no warranty. For the client:

- **Operational issues**: this SysAdmin Guidebook (§3.9 Troubleshooting).
- **Setup issues**: this SysAdmin Guidebook (§3.1, §3.2, §3.3).
- **Understanding what a feature does**: the User Guidebook (§2.x).
- **Why a feature is designed the way it is**: the Architect Guidebook (§4.x).
- **How a feature is implemented**: the Developer Guidebook (§1.x).
- **How to test a feature**: the Tester Guidebook (§5.x).

For issues NOT covered by the documentation, the client is expected to read the source code. The POC source is well-commented and the guidebooks cross-reference file:line locations for everything.

### License and redistribution

The POC is licensed under the **NOETRONIQ Proprietary License** (see `LICENSE` file). Key terms:

- Use: permitted for the recipient organization.
- Modification: permitted; modifications become part of the licensed codebase.
- Redistribution: NOT permitted without NOETRONIQ's written consent.
- Warranty: NONE — the POC is provided "as-is".

The client must read the LICENSE file before deploying.

### Environment assumptions

The client is expected to provide:

- A POSIX-compatible shell (Linux, macOS, or Windows with git-bash/WSL).
- Node.js 20.x or later.
- npm 10.x or later.
- A git client (for the optional `.git` history).
- A modern browser for the Web UI.

The POC does NOT require:

- A cloud account.
- Docker or any container runtime.
- A database server (SQLite is embedded).
- An external authentication provider (the demo tokens are local-only).

### Known deferred items

These items are **open at handoff**. They were considered during the pre-handoff cleanup pass but deferred — they're pre-existing, scoped to specific surfaces, or judgement calls rather than cleanup. Listed here so the next maintainer knows what's intentionally not fixed.

| Item | Where | Severity |
|---|---|---|
| 4 pre-existing `hr.test.ts` failures | `staging/api/__tests__/routes/hr.test.ts` | Tests pass for 21/25 cases. 3 are 500-instead-of-200/201 on `POST/PATCH/DELETE /api/hr/employees` (route handlers may have bugs OR test assertions may have drifted from handler behavior — needs investigation). 1 is `GET /api/hr/stats` returning an empty object (counter names in the seed data may have changed). |
| 2 `attribute_mappings` rows with no authority set | `person.employment.role`, `person.employment.start_date` (DB) | When a `standard_attribute` is mapped by multiple sources with no `is_authoritative=1` row, the resolver at `GET /api/user/attributes/:gcuid` falls back to `values[0]` in iteration order (currently `engineering`). The response includes `authoritative_source: null` to flag this. Clients should set authority via `PUT /api/caes/attribute-mappings/:id/authoritative` per the CAES CRUD surface. |
| Pre-existing TS errors | `staging/cli/commands/user.ts` (~26 of 251 staging errors); 13 more in `staging/web-ui/src/` (`LogsPortal.tsx`, `OptionsPortal.tsx`, `SourceSystemsPortal.tsx`) | Compile-failures that don't block runtime. Verify with `npx tsc --noEmit -p staging/tsconfig.json` — count should be 251 (unchanged from before cleanup). |
| `npm run cli` script points at archived CLI stub | `packages/core/package.json:17` | The `cli` script builds `dist/cli.js` from the archived `cli-new.ts` stub (10 lines, license header only). It builds successfully and exits silently. Cosmetic — drop the script or rebuild a real CLI before exposing this to a client. |
| 66 files with `: any` or `as any` casts | `packages/*/src/` (non-test, non-archive) | Many are intentional (SQLite row types, dynamic schema). High regression surface to fix in bulk; defer to per-module cleanup. |

### See also

- §3.1 — Who this is for (audience model)
- §3.9 — Troubleshooting (where the client will land first when something breaks)
- `README.md` — quickstart
- `LICENSE` — license terms

## 3.11 Performance and tuning

This section covers **performance characteristics** and **tuning knobs** in the POC. Most of these are out-of-scope for development use, but documenting them prevents future cargo-culting.

### Performance baseline

The POC is sized for **local development**, not production. Realistic numbers on a developer laptop (Intel i7 / M1, SSD, 32 GB RAM):

| Operation | Typical | Notes |
|---|---|---|
| API startup | 800-1200 ms | Migrations + seed |
| Source server startup | 200-400 ms per source | SQLite open + seed |
| Web UI initial load | 1.5-2.5 s | Vite dev server, no production build |
| Identity search (small DB) | 30-80 ms | 100 identities |
| Identity search (full DB) | 80-200 ms | 10,000 identities |
| Cross-source attribute merge | 50-150 ms | per identity |
| Connector push to registry | 20-50 ms | per record |
| Source `/search` call | 10-30 ms | small source DB |
| Smoke (`cs-4.1`) | 5-10 s | full startup cycle |
| Smoke (`invariants`) | 2-3 s | 39 assertions |

For comparison, a more scalable setup (Postgres, Redis, multiple replicas) would target <50ms for identity search and <10ms for source calls. The POC's numbers are 5-20x slower than those targets — that's fine for a POC, not fine for a high-traffic service.

### Where the time goes

When an API request takes longer than expected, the typical breakdown is:

1. **SQLite disk I/O** (40-60% of request time): the registry DB is on local SSD, but every request still does disk reads.
2. **Connector HTTP call** (20-30%): every attribute fetch goes API → connector → source, with TCP/HTTP overhead.
3. **Fuzzy matching** (10-20%): `fuzzy-matching.ts` and `enhanced-matching-engine.ts` do Levenshtein distance for cross-source attribute reconciliation.
4. **JSON serialization** (5-10%): Express + the registry's serializer.
5. **Auth + routing** (<5%): token check + route dispatch.

If your bottleneck is #1, the fix is a faster disk (SSD already assumed). If your bottleneck is #3, the fix is to pre-compute matches at write time instead of read time.

### Tuning knobs

#### SQLite (registry.db)

The `registry.db` connection in `staging/api/lib/registry-db.ts` configures SQLite with:

- `journal_mode = WAL` — write-ahead logging, allows concurrent reads.
- `synchronous = NORMAL` — slight durability trade-off for speed.
- `cache_size = -20000` — ~20 MB cache.
- `temp_store = MEMORY` — temp tables in RAM.

To tune for your machine, edit the connection config. The POC ships with sensible defaults for SSDs.

#### Fuzzy matching

The fuzzy-matching threshold is in `packages/core/src/matching-config.ts`. Default is `0.7` (70% similarity). Lower thresholds = more matches, higher thresholds = fewer matches. For testing, lower it to see more candidate matches; for production, raise it to reduce false positives.

#### HTTP connection pooling

The API uses `http.Agent` with default settings. For high-throughput production, you'd want `keep-alive: true` and `maxSockets: 25`. The POC defaults to per-request connections — fine for development, slow for production.

#### Vite (Web UI)

The dev server has no production-mode caching. For production, run `npm run build` and serve `dist/` from a static host.

### What NOT to tune in the POC

The POC is not the place to:

- Add Redis or Memcached. The SQLite cache is sufficient.
- Add a reverse proxy (nginx). Vite proxies to the API in dev; production builds have it baked in.
- Add a queue (Bull, RabbitMQ). The connector pushes are synchronous in the POC; production would have async ingestion.
- Optimize the fuzzy-matching algorithm. It's already O(n*m) for small n, m.
- Migrate to Postgres. The schema is SQLite-specific.

These are all **correct moves for production** but premature for the POC. See [Architect Guidebook §4.9 Mapping to a real deployment](guidebook-architect.md#49-mapping-to-a-real-deployment) for the production checklist.

### When to revisit performance

The POC's performance characteristics are acceptable as long as:

- Identity search returns in <300ms for any query.
- Connector push completes in <2s per record.
- Smoke tests complete in <30s.
- Web UI interactions feel responsive (no perceived lag >500ms).

If any of these thresholds are crossed, that's the signal to investigate. The first place to look is the `staging/logs/api.log` for slow-request warnings (logged at >500ms by default).

### Memory and disk footprint

Typical resource usage on the developer machine:

| Resource | Usage | Notes |
|---|---|---|
| RAM (all 9 processes) | ~250-400 MB | Vite is the heaviest at ~120 MB |
| Disk (`registry.db` + 4 source DBs) | ~5-15 MB | depends on seed size |
| Disk (`logs/*.log`) | grows unbounded | truncate weekly |
| Disk (`staging/data/.pid` files) | <1 KB | negligible |
| Disk (`node_modules/`) | ~400 MB | excluded from handoff |
| Disk (`packages/*/dist/`) | ~10-20 MB per package | excluded from handoff |

For a fresh checkout, expect ~1.5 GB of disk usage including node_modules. For a long-running POC, the logs/ directory will be the largest growth factor.

### See also

- §3.6 — Database management (SQLite tuning knobs)
- §3.8 — Logging and observability (slow-request warnings)
- [Architect Guidebook §4.9 Mapping to a real deployment](guidebook-architect.md#49-mapping-to-a-real-deployment) — production performance checklist
- [Developer Guidebook §1.13 Build, package, ship](guidebook-developer.md#113-build-package-ship) — build configuration for dev vs prod
