# Tester Guidebook

**For**: Testers, QA engineers, developers running regression on GCUID-POC.
**Not for**: End users (see [User Guidebook](guidebook-user.md)), developers extending the codebase (see [Developer Guidebook](guidebook-developer.md)), or operators running the stack (see [SysAdmin Guidebook](guidebook-sysadmin.md)).

This guidebook is the reference for the test surface — what's tested, how tests run, how to add tests, how to interpret failures.

## Table of contents

| # | Section | What's covered |
|---|---|---|
| 5.1 | [Who this is for](#51-who-this-is-for) | Audience model, prerequisites |
| 5.2 | [What is testable in this system](#52-what-is-testable-in-this-system) | Surface inventory: unit, smoke, invariants, manual |
| 5.3 | [Unit tests (jest)](#53-unit-tests-jest) | What's tested, what's known-broken (21/25), the `hr.test.ts` failures |
| 5.4 | [Smoke tests](#54-smoke-tests) | cs-1.1 through cs-4.1 — what each verifies, how to read its output |
| 5.5 | [The invariants smoke](#55-the-invariants-smoke) | `smoke-invariants-runtime.ts` — what it would have caught (`e5c3b8c` history) |
| 5.6 | [The orchestrator](#56-the-orchestrator) | `npm run smoke`, `run-smokes.sh` / `.bat` / `.ps1`, the exclusion list |
| 5.7 | [Manual testing surfaces](#57-manual-testing-surfaces) | The Web UI Testing Portal, System → Ping/Health, the Dashboard |
| 5.8 | [Adding a smoke test](#58-adding-a-smoke-test) | Worked example: extending the invariants smoke for a new check |
| 5.9 | [Adding a unit test](#59-adding-a-unit-test) | Jest patterns in this codebase, fixture conventions |
| 5.10 | [Interpreting failures](#510-interpreting-failures) | Symptom → diagnostic catalog for common failure modes |
| 5.11 | [Local-only stance](#511-local-only-stance) | What we don't run (CI), why |

## See also

- [Developer Guidebook](guidebook-developer.md) — code-level walkthrough
- [SysAdmin Guidebook](guidebook-sysadmin.md) — operations
- [Architect Guidebook](guidebook-architect.md) — design intent
- [User Guidebook](guidebook-user.md) — end-user flows

## 5.1 Test architecture overview

This section is the **map of all automated tests** in the POC. If you're new to the project and want to understand what is tested, where, and how, start here.

### The three layers of testing

The POC uses a **3-layer testing model**:

1. **Unit tests** (`packages/core/src/__tests__/*.test.ts` + `staging/api/__tests__/unit/*.test.ts`): test individual functions in isolation. Pure logic, no I/O, no DB, no HTTP.
2. **API integration tests** (`staging/api/__tests__/routes/*.test.ts`): test API routes via supertest. Uses in-memory SQLite + a stub connector. Verifies request/response shape, status codes, auth, and route logic.
3. **Runtime-invariant smokes** (`scripts/smoke-*.ts`): test the live stack via real HTTP. Reads from the running API + connectors + sources, no mocks.

The principle: **a bug caught at layer 1 stays at layer 1** (fast feedback). A bug caught at layer 3 means we don't have enough coverage at layers 1-2.

### Test inventory

| Layer | Count | Files | Runner |
|---|---|---|---|
| Unit (core) | 4 | `packages/core/src/__tests__/` | jest |
| Unit (api) | 1 | `staging/api/__tests__/unit/` | jest |
| Integration (api) | 3 | `staging/api/__tests__/routes/` | jest + supertest |
| Harness smoke | 1 | `staging/api/__tests__/00-harness-smoke.test.ts` | jest |
| Smoke | 5 | `scripts/smoke-cs-*.ts` + `smoke-invariants-runtime.ts` | `npm run smoke` |

**Totals**: 8 jest test files + 5 smoke scripts = 13 distinct test artifacts.

### What each layer catches

#### Layer 1: Unit tests (8 files)

Catches:

- Logic bugs in `crockford-base32.ts` (encoding edge cases).
- Logic bugs in `gcuid-manager.ts` (V1 vs V2 parsing, validation).
- Logic bugs in `connector-api.search.ts` (search algorithm).
- Logic bugs in `source-scan.ts` (DB row scanning).
- Logic bugs in `alias.ts` (entity alias resolution).

Doesn't catch:

- Bugs in route handlers.
- Bugs in DB schema or migrations.
- Bugs in cross-process coordination.

#### Layer 2: API integration tests (3 files)

Catches:

- Route handler bugs (status codes, error responses).
- Auth middleware bugs (401/403 paths).
- DB schema issues that surface during query.
- API contract changes (breaking shape).

Doesn't catch:

- Cross-source merge logic (no real sources wired up in tests).
- Performance regressions.
- Multi-process races.

#### Layer 3: Runtime-invariant smokes (5 scripts)

Catches:

- Cross-process bugs (connector→source HTTP, API→connector HTTP).
- Configuration drift (tokens out of sync, ports stale).
- DB invariant violations (e.g. e5c3b8c pre-port-remap bug).
- Stack liveness regressions (process won't start).

Doesn't catch:

- UI bugs (the smokes don't drive the browser).
- Performance regressions in the dev server (cs-4.1 covers startup only).
- Build/lint regressions (those are CI concerns).

### What is NOT tested

The POC explicitly does NOT cover:

- **End-to-end UI tests** — no Playwright/Cypress. The Web UI is tested manually (see §5.5).
- **Visual regression tests** — no screenshot diffs. The UI is reviewed by humans.
- **Load tests** — no k6/Artillery. The performance baseline in §3.11 is the only guidance.
- **Security tests** — no SAST/DAST. The POC is local-only and the security model is documented but not penetration-tested.
- **Mutation tests** — no Stryker. The unit test coverage is the only guidance.
- **Property-based tests** — no fast-check. The seed data provides the canonical scenarios.

Each of these is **out-of-scope for the POC**. For production, see [Architect Guidebook §4.9](guidebook-architect.md#49-mapping-to-a-real-deployment).

### Architectural invariants under test

Every test, regardless of layer, is written to defend one of the following invariants. They are the arms-length architecture requirements that define what the GCUID system is and how it must behave. When a test references "I-1" / "I-2" / etc. (e.g., `Invariants defended: I-1, I-5`), it means this invariant was the design driver for that test.

- **I-1: No source system auto-creates a GCUID on record creation.** GCUIDs are created only by explicit user self-registration or by an explicit admin-issued `POST /api/gcuid-request/submit` (action=create_new). Adding a row to a connector's source DB never causes a GCUID to appear in the registry.
- **I-2: An alias represents a confirmed, for-life identity reference.** User claims during self-registration go into `identities.metadata.email` only, not into `aliases`. A typo or mistyped email must never become a permanent alias.
- **I-3: Corporate-app access requires `identity.state = 'active'` AND `identifier_state = 'issued'` (post-chain).** A superseded identifier follows the chain to its issued successor; a broken chain denies access.
- **I-4: Cross-source detection uses the connector layer, not the registry.** The registry holds `source_mappings`; matching a new record to an existing identity is always done by CAES → connector → source record → registry lookup of the `source_mappings` for that source record.
- **I-5: Source data is arms-length from GCUID/CAES.** The HR portal can be reset independently of the GCUID registry; LDAP can be edited without writing to the GCUID system; the only bridges are (a) the connector HTTP servers and (b) the explicit `/api/gcuid-request/*` endpoints.
- **I-6: GCUIDs are real, durable identifiers.** A typo or self-claim must not be allowed to introduce a second identity for the same person when the source system already has a matching record. The match engine (CAES) is the only mechanism that decides "this is the same person" across sources.

These invariants are also documented in the architect guidebook (see [Architect Guidebook §4.3 Architecture overview](guidebook-architect.md#43-architecture-overview)) as the system's design contract.

### Test isolation principle

Each test is expected to start from a **clean baseline**:

1. Unit tests: no setup, run in isolation by jest.
2. Integration tests: in-memory SQLite + stub connector, no real processes.
3. Smokes that touch the user's stack: excluded from default `npm run smoke` (cs-1.1, cs-2.1, cs-3.1).
4. Smokes that observe the stack: included by default (cs-4.1, invariants).

Tests that violate this principle — for example, smokes that mutate `registry.db` without resetting — are flagged in §5.6 (Writing new tests).

### Test execution order

When running the full test suite:

```bash
# 1. Unit + integration (jest)
npm test

# 2. Smoke (default — observation only)
npm run smoke

# 3. Smoke (full — including destructive)
./stop-dev.sh
npm run smoke -- --all
./start-dev.sh
```

The order matters: jest tests are pure logic (no dependencies), so they run first. Smokes depend on the stack being up (or being cleanly taken down for the destructive ones).

### See also

- §5.2 — Unit test inventory
- §5.3 — Smoke test inventory
- §5.7 — Running test suites
- [Developer Guidebook §1.12 Testing and debugging](guidebook-developer.md#112-testing-and-debugging)

## 5.2 Unit test inventory

This section walks through each unit test file: what it covers, how to run it, and what a failure looks like.

### packages/core/src/__tests__/

#### `alias.test.ts`

Tests entity alias resolution (`packages/core/src/alias.ts`).

What's covered:

- Single-source alias extraction.
- Multi-source alias merge with conflict detection.
- Alias normalization (case, whitespace, punctuation).
- Empty-source handling.

Run: `npx jest alias`

#### `connector-api.search.test.ts`

Tests the connector's search algorithm (`packages/core/src/connector-api.search.ts`).

What's covered:

- Exact-match search.
- Prefix search.
- Fuzzy-match search (Levenshtein distance).
- Empty result set handling.
- Result ordering and relevance scoring.

Run: `npx jest connector-api.search`

#### `crockford-base32.test.ts`

Tests the Crockford Base32 encoder used for GCUID cores (`packages/core/src/crockford-base32.ts`).

What's covered:

- Encode/decode round-trip for various input lengths.
- Validation of input characters (alphabet excludes `I`, `L`, `O`, `U`).
- UUID and ULID conversion to/from Crockford.
- Edge cases: empty strings, single characters, 26-char strings.
- Format with hyphen separators.

Run: `npx jest crockford-base32`

This is one of the most-tested files — encoding bugs would break every GCUID in the system, so the test count is intentionally high.

#### `gcuid-manager.test.ts`

Tests the GCUID manager (`packages/core/src/gcuid-manager.ts`).

What's covered:

- V1 GCUID generation and parsing (legacy format).
- V2 GCUID generation and parsing (current format).
- Validation (length, characters, checksum).
- Round-trip: generate → parse → validate.
- Error cases: invalid checksum, invalid length, invalid characters.

Run: `npx jest gcuid-manager`

### staging/api/__tests__/unit/

#### `source-scan.test.ts`

Tests the API's source-scanning helper (`staging/api/lib/source-scan.ts`).

What's covered:

- Reading rows from a SQLite source DB.
- Handling missing tables gracefully.
- Handling empty tables.
- Returning consistent shape regardless of table contents.

Run: `npx jest source-scan`

### Total unit-test count

The 4 core files + 1 API file contain approximately 100+ individual assertions. The exact count varies as tests are added. Run `npx jest --listTests` to enumerate and `npx jest --verbose` to see each assertion.

### Test-data conventions

Unit tests use **in-memory fixtures** — no files, no DB. The Crockford tests construct strings inline; the GCUID tests generate new GCUIDs at test time. The source-scan test uses a small in-memory SQLite via `:memory:`.

This is intentional: unit tests should be fast (under 1 second total), and any test that touches the filesystem is by definition not a unit test.

### When unit tests fail

If `npx jest` fails:

1. **Read the assertion** — most failures include the expected vs actual value.
2. **Check the input** — many tests use generated inputs; if the generator changes, tests may need updates.
3. **Run that test in isolation** — `npx jest --testPathPattern=alias` narrows to one file.
4. **Look at recent changes** — `git log -p packages/core/src/alias.ts` shows recent modifications.

If a unit test fails on a clean checkout, that's a real bug — file an issue with the failure output.

### What is NOT unit-tested

The following core files do NOT have dedicated unit tests:

- `authoritative-source.ts` — partially covered by integration tests.
- `fuzzy-matching.ts` — covered indirectly via `connector-api.search.test.ts`.
- `enhanced-matching-engine.ts` — covered indirectly via API integration tests.
- `identity-state-machine.ts` — partially covered by `gcuid-manager.test.ts`.
- `state-machine.ts` — generic xstate wrapper; tests live in xstate's own test suite.
- `push-client.ts` — covered by integration tests via the live connector.
- `identity-orchestration.ts` — covered by the smoke `cs-2.1-all-sources.ts`.
- `registry.ts` — covered by API integration tests.
- `data-normalization.ts` — covered by `connector-api.search.test.ts` (normalization runs as a search pre-step).

If a code change touches one of these files, the corresponding integration test or smoke is the regression gate.

### See also

- §5.1 — Test architecture overview
- §5.6 — Writing new tests
- [Developer Guidebook §1.13 Build, package, ship](guidebook-developer.md#113-build-package-ship)

## 5.3 API integration test inventory

This section walks through each API integration test file: what it covers, the scenarios it tests, and how the test harness is structured.

### The test harness

The API integration tests use a shared harness at `staging/api/__tests__/setup.ts`. The harness:

1. Creates a temporary data directory in `os.tmpdir()`.
2. Initializes an in-memory SQLite for the registry.
3. Mounts the requested routes via `app.use(...)`.
4. Returns a `TestContext` with `{app, dataDir, db, cleanup}`.

This means **each test file gets its own isolated data dir** — tests don't interfere with each other, and they don't touch the developer's `staging/data/`.

### staging/api/__tests__/routes/

#### `hr.test.ts`

Tests the HR portal routes (`/api/hr/...`).

Scenarios (from `TEST_PLAN.md`):

- **SC-HR-1**: Creating a new HR employee does NOT provision a GCUID.
- **SC-HR-2**: Deleting an HR employee does NOT unbind the source_mapping.

What's covered:

- `POST /api/hr/employees` — creates an HR employee; verifies the registry's `identities` table is untouched.
- `DELETE /api/hr/employees/:id` — deletes an HR employee; verifies the registry's `source_mappings` row remains (the GCUID stays bound).

Run: `npx jest hr`

#### `policies.test.ts`

Tests the policy routes (`/api/policies/...`).

What's covered:

- Policy creation, listing, deletion.
- Policy evaluation against identity attributes (ABAC).
- Policy scope: per-source vs per-department vs global.
- Conflict detection between overlapping policies.

Run: `npx jest policies`

#### `00-harness-smoke.test.ts`

Tests the test harness itself. If this test fails, **the entire integration test suite is suspect** — the harness is broken.

What's covered:

- `setupTestEnv` correctly mounts routes.
- `TestContext.cleanup` correctly tears down the temp data dir.
- The harness is idempotent across multiple `setupTestEnv` calls.

Run: `npx jest 00-harness-smoke`

This test should run **first** in the suite. The `00-` prefix ensures jest picks it up first by default sort order.

### staging/api/__tests__/unit/

#### `source-scan.test.ts`

Already covered in §5.2 (Unit test inventory). It's in the `unit/` subdir but uses a slightly different harness (pure-function test, not full app).

### Total integration-test count

The 3 route test files contain approximately 50+ individual assertions across ~15 scenarios. Run `npx jest --verbose` to enumerate.

### Scenario notation

The integration tests reference scenarios by ID (`SC-HR-1`, etc.). These IDs come from `staging/TEST_PLAN.md` (a separate document that describes the test scenarios in detail). When a test fails:

1. Note the scenario ID (e.g. `SC-HR-1`).
2. Look up the scenario in `staging/TEST_PLAN.md`.
3. The scenario description will tell you what was supposed to happen.

If `TEST_PLAN.md` doesn't have the scenario, the test was written ad-hoc — file an issue to update the plan.

### When integration tests fail

If `npx jest` integration tests fail:

1. **Read the assertion** — the harness uses supertest; the response body is in the failure output.
2. **Check the data dir** — `os.tmpdir()` gets cleaned up after each test; if you need to inspect, add `console.log(ctx.dataDir)` to the failing test (it'll print before the cleanup).
3. **Run that test in isolation** — `npx jest --testPathPattern=hr`.
4. **Verify the schema** — the harness creates the schema from `admin.ts` migrations. If migrations changed, the harness may need updates.

Integration tests are slower than unit tests (typically 200ms-1s per test). If a single integration test takes >5s, something is wrong with the test, not the code under test.

### What is NOT integration-tested

The following API routes do NOT have dedicated integration tests:

- `/api/identity/search` — covered by smoke `cs-2.1-all-sources.ts`.
- `/api/sources/ping` and `/api/sources/health` — covered by smoke `smoke-invariants-runtime.ts`.
- `/api/admin/...` — admin routes are operator-only; tested manually via the Web UI.
- `/api/departments/...` — read-only routes; covered indirectly by other tests.
- `/api/hr/departments` and other HR sub-routes — covered by `hr.test.ts` indirectly.

For a new API endpoint, the canonical pattern is to add a test in `staging/api/__tests__/routes/` following the existing pattern (see §5.6).

### See also

- §5.1 — Test architecture overview
- §5.6 — Writing new tests
- §5.7 — Running test suites
- `staging/TEST_PLAN.md` — scenario catalog

## 5.4 Smoke test inventory

This section walks through each smoke test script: what it verifies, whether it's safe to run against the user's live stack, and what a failure indicates.

### scripts/smoke-invariants-runtime.ts

The canonical runtime-invariant smoke. Verifies the data + connectivity invariants the System → System page's Ping/Health buttons depend on. **Catches the class of bug** where the connectors are healthy but the registry's view of them is stale (the e5c3b8c bug class).

**Safe to run against the live stack** — does NOT spawn or kill processes, does NOT mutate `registry.db` (read-only), does NOT mock anything. If the stack isn't up, the smoke fails with a clear error message.

What's verified (39 assertions):

- **Section A — Stack liveness**: API on :5182, 4 connectors on :5183-:5186, 4 sources on :5188-:5191.
- **Section B — Registry data integrity**: For each connector row, the `system_id`, `api_url`, and `api_secret` match the config files.
- **Section C — UI-equivalent probe**: `/api/connectors/{id}/ping` and `/health` return reachable=true with <500ms latency.

Run: `npm run smoke` (default — included)

### scripts/smoke-cs-1.1-hr-source.ts

Tests the HR source's full read flow.

What's covered:

- Start a HR connector process.
- Start the HR source process.
- Verify the connector can fetch from the source.
- Verify the registry receives the connector's push.
- Verify the HR data appears in the registry's `identities` table.

**NOT safe to run against the live stack** — spawns its own HR connector and source on the standard ports. If the user's stack is up, this conflicts.

Run: `npm run smoke -- --all` (excluded by default)

### scripts/smoke-cs-2.1-all-sources.ts

Tests all 4 sources end-to-end.

What's covered:

- Start all 4 connectors + all 4 sources.
- Verify each connector fetches from its source.
- Verify the registry has data from all 4 sources.
- Verify cross-source attribute reconciliation works (HR.name vs LDAP.cn).

**NOT safe to run against the live stack** — spawns 8 processes on the standard ports.

Run: `npm run smoke -- --all` (excluded by default)

### scripts/smoke-cs-3.1-self-bootstrap.ts

Tests the source-server self-bootstrap pattern (auto-seeding on start).

What's covered:

- Stop the source server.
- Delete the source DB.
- Restart the source server.
- Verify the source DB is recreated and seeded automatically.

**NOT safe to run against the live stack** — mutates source DBs. The user's stack would lose its data.

Run: `npm run smoke -- --all` (excluded by default)

### scripts/smoke-cs-4.1-startup-cycle.ts

Tests the full start → stop → start cycle of all processes.

What's covered (20 assertions):

- Start all 9 processes via `start-dev.sh`.
- Verify all 9 ports are listening.
- Stop all 9 processes via `stop-dev.sh`.
- Verify all 9 ports are free.
- Restart and verify all 9 ports are listening again.

**Safe to run against the live stack** — uses PID-scoped cleanup, doesn't touch other processes.

Run: `npm run smoke` (default — included)

### scripts/run-smokes.js

The smoke orchestrator. NOT a smoke itself — it's the runner that picks which smokes to run.

Usage:

```bash
# Run default smokes (cs-4.1 + invariants)
npm run smoke

# Run all smokes (including cs-1.1, cs-2.1, cs-3.1 — DESTRUCTIVE)
npm run smoke -- --all

# List available smokes
npm run smoke -- --list

# Run smokes matching a substring
npm run smoke -- invariants
npm run smoke -- startup
```

The orchestrator has a hardcoded `STACK_CONFLICTING` list (cs-1.1, cs-2.1, cs-3.1) that's excluded from default runs.

### When a smoke fails

Each smoke prints a clear assertion-level failure. The output format:

```
✗ [B3] HR api_url port 8101 != 5183
✓ [A1] API server reachable on :5182
✓ [A2] HR connector reachable on :5183
✗ [C1] HR ping returned reachable=false: HR source unreachable
```

The first failing assertion is usually the root cause — fix it, then re-run.

### Smoke vs jest: when to use which

| Symptom | Use jest | Use smoke |
|---|---|---|
| "Pure function returns wrong value" | ✓ | |
| "API route returns wrong status code" | ✓ | |
| "Connector can't reach source" | | ✓ |
| "Tokens are out of sync" | | ✓ |
| "Database state is corrupted" | | ✓ |
| "Process won't start" | | ✓ |
| "Web UI is broken" | | (manual) |

The split: jest for logic, smokes for cross-process + state.

### Adding a new smoke

See §5.6 (Writing new tests). New smokes that need port isolation follow the same pattern as cs-1.1 / cs-2.1 / cs-3.1 — they get excluded from default runs.

### See also

- §5.1 — Test architecture overview
- §5.6 — Writing new tests
- §5.7 — Running test suites
- [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting) — smoke failure modes

## 5.5 Testing the Web UI

This section describes the **manual UI testing** approach used in the POC. The POC does NOT have automated E2E browser tests (Playwright, Cypress, etc.) — UI testing is a human-driven exercise. This section is the canonical reference for what to verify, in what order, when changing the Web UI.

### Why no E2E tests?

Three reasons:

1. **POC scope**: E2E tests add significant tooling overhead (test runner, browser drivers, screenshots). For a POC that's local-only, this is high cost for low value.
2. **UI changes frequently**: The Web UI is still being designed. Adding E2E tests during rapid iteration creates maintenance burden.
3. **The smoke covers most of what matters**: The runtime-invariant smoke verifies the API behavior that the UI depends on. UI-specific bugs (rendering, layout, event handlers) are best caught by humans.

For production, see [Architect Guidebook §4.9](guidebook-architect.md#49-mapping-to-a-real-deployment) — E2E tests should be added when the UI stabilizes.

### The 7-step manual smoke for any UI change

When you change a Web UI component, run through this checklist before declaring done:

1. **Does the page load?** Open it in the browser. Verify no console errors, no broken images, no missing CSS.
2. **Does the API data render?** If the page depends on API data (most do), verify the data shows up. If the API returns 0 rows, that's a bug — check the API endpoint and the React Query.
3. **Does interaction work?** Click every button, fill every form, trigger every dropdown. Verify the expected behavior.
4. **Does the modal/dialog/panel close correctly?** Every modal needs a working close button that returns to the parent route (no 404). See the FR #118 / Phase 2 fix in commit history for the canonical 404 pattern.
5. **Does navigation work?** Click the breadcrumb. Click back. Verify the URL changes as expected and the new page loads.
6. **Does it work in dark mode?** Toggle dark mode in the Web UI. Verify the component renders correctly (no white text on white background, no missing contrast).
7. **Does it work with empty data?** If the page handles "no results" or "0 rows," verify that path renders. The smoke `cs-3.1-self-bootstrap.ts` can give you an empty registry temporarily.

### Browser matrix

The POC supports modern Chromium-based browsers and Firefox:

- Chrome 110+
- Edge 110+
- Firefox 110+

Safari is **not officially supported** but should work for the React app (Vite + React + React Query is cross-browser).

Internet Explorer is **not supported** (the React app uses features that IE doesn't have).

### Mobile and responsive testing

The POC's Web UI is designed for **desktop use**. The responsive layout has limited support for tablet (768px) and no support for mobile (<768px).

For mobile testing, use Chrome DevTools' device emulation (F12 → Toggle device toolbar → iPhone/iPad). The layout will degrade gracefully but not be optimized.

### The "before commit" UI checklist

Before committing any Web UI change:

- [ ] Page loads without console errors.
- [ ] API data renders correctly.
- [ ] All buttons/forms/dropdowns work.
- [ ] Close/back navigation works (no 404s).
- [ ] Dark mode renders correctly.
- [ ] Empty-data path renders correctly.
- [ ] No `// TODO` or `console.log` debug statements left in the code.
- [ ] No unused imports or dead code.

### When to add automated UI tests

Despite the POC's manual-only approach, there are cases where automated UI tests are warranted:

- **Critical user journeys** (e.g. "create a new identity and verify it appears in the list"). For the POC, this is the canonical "happy path" — worth automating when the UI stabilizes.
- **Bug fix verification** (e.g. "the close button on this modal 404s" — add a test to prevent regression).
- **Visual regression** (e.g. "the topbar was redesigned, ensure the new design renders consistently"). Screenshots + diff.

For now, the manual checklist above is the gate. When the UI stabilizes, consider adding Playwright + screenshot diffs as a CI gate.

### Visual review process

For non-trivial UI changes (new page, redesign, new component), the canonical review process is:

1. **Self-review**: Run through the 7-step checklist above.
2. **Screenshot capture**: Take screenshots of:
   - The page in default (light) mode.
   - The page in dark mode.
   - The page with no data (empty state).
   - The page with data (typical state).
3. **Code review**: Get another developer to review the component for accessibility (keyboard nav, ARIA labels), responsive layout, and code quality.
4. **Commit**: Include the screenshots in the PR description.

### Common UI bugs to watch for

Based on past PRs in this project:

- **404 on close/back** — Phase 2 cleanup found 78 of these. Always test close/back navigation.
- **White text on white background in dark mode** — many CSS variables are mode-specific. Verify both modes.
- **Empty-data state shows "0 results" instead of a meaningful empty-state UI** — design an empty state from the start.
- **React Query not invalidating after mutation** — verify the new state appears without manual refresh. See the React Query invalidation key matching rule (Developer Guidebook §1.12).
- **Breadcrumb missing on a branch of the component** — verify ALL return branches of a multi-branch component.
- **Modal stays open after successful submit** — close the modal and reset its state.
- **Form validation error not visible** — the error should be visible without scrolling, ideally with `role="alert"`.

### See also

- §5.1 — Test architecture overview
- §5.6 — Writing new tests
- [Developer Guidebook §1.6 The Web UI layer](guidebook-developer.md#16-the-web-ui-layer)
- [User Guidebook §2.x](guidebook-user.md) — what the user sees

## 5.6 Writing new tests

This section is the **how-to** for adding new tests at each layer. It codifies the patterns established by the existing tests so new tests fit the codebase.

### When to add a unit test

Add a unit test when:

- You're adding a new function to `packages/core/src/`.
- You're modifying an existing function and the change has more than one branch.
- You find a bug and want a regression test.

The test file lives next to the source: `packages/core/src/__tests__/<name>.test.ts`.

Pattern:

```typescript
import { myFunction } from '../my-module';

describe('myFunction', () => {
  test('handles the typical case', () => {
    expect(myFunction('input')).toBe('expected');
  });

  test('handles the empty case', () => {
    expect(myFunction('')).toBe('');
  });

  test('throws on invalid input', () => {
    expect(() => myFunction(null)).toThrow();
  });
});
```

Conventions:

- Use `describe` for the function name.
- Use `test` for individual cases (or `it` — both work; the codebase uses `test`).
- One assertion per `test` (more is OK if they're testing the same behavior).
- No `beforeAll`/`afterAll` unless you really need shared setup (and if you do, scope it narrowly).

### When to add an API integration test

Add an integration test when:

- You're adding a new API route.
- You're modifying an existing route and the response shape changes.
- You're adding new auth middleware.

The test file lives at `staging/api/__tests__/routes/<route>.test.ts`.

Pattern (from `hr.test.ts`):

```typescript
import request from 'supertest';
import { setupTestEnv, TestContext, insertIdentity, insertSourceMapping } from '../setup';

describe('MyRoute (/api/my-route/...)', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = setupTestEnv({ mountRoutes: ['my-route'] });
  });
  afterAll(() => { ctx.cleanup(); });

  test('GET /api/my-route returns 200 with the expected shape', async () => {
    const res = await request(ctx.app).get('/api/my-route');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ /* expected shape */ });
  });
});
```

Conventions:

- Use `setupTestEnv({ mountRoutes: [...] })` to mount only the routes you need.
- Use `insertIdentity`, `insertSourceMapping`, etc. helpers to seed the test DB.
- Reference the scenario ID from `staging/TEST_PLAN.md` in the test name or as a comment.
- Don't open external connections — the harness is hermetic.

### When to add a smoke

Add a smoke when:

- You're adding a new cross-process flow (e.g. a new connector ↔ source interaction).
- You're adding a new invariant that should hold across stack restarts.
- You're fixing a config-drift bug (the e5c3b8c pattern).

The smoke file lives at `scripts/smoke-<topic>.ts`.

Pattern (from `smoke-invariants-runtime.ts`):

```typescript
import * as http from 'node:http';

interface SmokeResult { passed: boolean; label: string; detail?: string }
const results: SmokeResult[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  results.push({ passed: condition, label, detail });
  console.log(`${condition ? '✓' : '✗'} [${label}]${detail ? ' ' + detail : ''}`);
}

// ... actual assertions ...

const failed = results.filter(r => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} assertions passed`);
process.exit(failed > 0 ? 1 : 0);
```

Conventions:

- Use `assert(label, condition, detail)` for each check.
- Group assertions by section (A, B, C, ...) — the section letter appears in the label.
- Print a summary at the end.
- Exit 1 on failure, 0 on success.
- Read-only by default — don't spawn or kill processes unless necessary.
- If you must spawn processes, use ephemeral ports and PID-scoped cleanup.

### When to skip a test

Don't write a test when:

- The code is a one-line wrapper around an existing tested function.
- The test would be testing the framework (e.g. "does supertest work?").
- The behavior is already covered by an existing test at a different layer.

If you find yourself wanting to test `expect(1 + 1).toBe(2)`, delete the test.

### Naming conventions

- **Unit tests**: `<module-name>.test.ts` next to the module.
- **Integration tests**: `<route-name>.test.ts` under `staging/api/__tests__/routes/`.
- **Smokes**: `smoke-<topic>.ts` under `scripts/`.
- **Test descriptions**: Start with a verb in present tense ("returns", "creates", "fails when").

### Anti-patterns

Things to avoid:

- **Don't test private functions** — test through the public interface.
- **Don't mock the entire stack** — use real integration tests for cross-process flows.
- **Don't write flaky tests** — if a test fails 1 in 100 runs, fix it or delete it.
- **Don't write tests that depend on test order** — each test should be independent.
- **Don't write tests that depend on the host machine** — use temp dirs, mock time, etc.
- **Don't write tests that take >10s** — split into smaller tests or move to a smoke.

### The TDD workflow

For complex changes, the recommended workflow:

1. **Write the test first** (red): Write a failing test that captures the desired behavior.
2. **Make it pass** (green): Write the minimal code to pass the test.
3. **Refactor** (refactor): Clean up the code without changing the test.
4. **Commit**: One commit per red-green-refactor cycle.

This is the canonical pattern from [Developer Guidebook §1.13](guidebook-developer.md#113-build-package-ship) and the `test-driven-development` skill. The POC doesn't enforce it, but adopting it for new features reduces regression bugs.

### What to do when you don't know where the test belongs

Ask:

- "Does this test depend on the filesystem or network?" → It's a smoke or integration test, not a unit test.
- "Does this test touch multiple processes?" → It's a smoke.
- "Does this test only exercise one function?" → It's a unit test.
- "Does this test touch the API but not the database?" → It could be either; if it's testing request/response, integration; if it's testing logic in route handlers, integration.

When in doubt, write a smoke — they're the highest-value test in the POC because they catch the most user-impacting bugs.

### See also

- §5.1 — Test architecture overview
- §5.2 — Unit test inventory
- §5.3 — API integration test inventory
- §5.4 — Smoke test inventory
- §5.7 — Running test suites
- [Developer Guidebook §1.13 Build, package, ship](guidebook-developer.md#113-build-package-ship) — TDD workflow reference

## 5.7 Running test suites

This section is the **recipe** for running tests in different combinations and contexts.

### The four canonical commands

```bash
# 1. Run all jest tests (unit + integration)
npm test

# 2. Run default smokes (cs-4.1 + invariants)
npm run smoke

# 3. List available smokes
npm run smoke:list

# 4. Run all smokes (including destructive)
./stop-dev.sh
npm run smoke -- --all
./start-dev.sh
```

These four commands cover 90% of testing scenarios. The remaining 10% is debugging individual tests or running a smoke against a specific scenario.

### Running specific jest tests

```bash
# Run one test file
npx jest hr

# Run one test by name pattern
npx jest -t "SC-HR-1"

# Run tests matching a path pattern
npx jest --testPathPattern=api/__tests__/routes

# Run with verbose output (every assertion)
npx jest --verbose

# Run with coverage
npx jest --coverage
```

Coverage output lands in `coverage/`. Open `coverage/lcov-report/index.html` in a browser for the full HTML report.

### Running specific smokes

```bash
# Run all default smokes (cs-4.1 + invariants)
npm run smoke

# Run all smokes including destructive
npm run smoke -- --all

# Run a single smoke by name
tsx scripts/smoke-invariants-runtime.ts
tsx scripts/smoke-cs-4.1-startup-cycle.ts

# Filter smokes by substring
npm run smoke -- invariants
npm run smoke -- startup
npm run smoke -- 4.1
```

### Cross-platform smoke wrappers

The root-level wrappers work the same way:

```bash
# Linux/macOS
./run-smokes.sh
./run-smokes.sh --all
./run-smokes.sh invariants

# Windows cmd
run-smokes.bat
run-smokes.bat --all

# Windows PowerShell
.\run-smokes.ps1
.\run-smokes.ps1 --all
```

The wrappers handle MSYS path translation on Windows automatically.

### Running tests in CI (future)

The POC doesn't have CI configured yet (out of scope per [Architect Guidebook §4.9](guidebook-architect.md#49-mapping-to-a-real-deployment)). When CI is added, the recommended commands are:

```yaml
# .github/workflows/test.yml
- name: Unit + integration tests
  run: npm test

- name: Build
  run: npm run build

- name: Smoke (default)
  run: npm run smoke
```

The destructive smokes (`cs-1.1`, `cs-2.1`, `cs-3.1`) are NOT run in CI — they need exclusive port access that's hard to guarantee in a CI runner.

### Running tests in parallel

The POC's test suite is small enough that parallelism is unnecessary. `npm test` runs jest with `--maxWorkers=2` by default; smokes run sequentially.

If you need to speed up the suite:

- Split `packages/core/src/__tests__/` into more granular files.
- Run smokes in parallel via `concurrently` (but watch for port conflicts).
- Move pure logic to more isolated modules (jest can parallelize better).

### When a test hangs

A test that hangs is usually one of:

1. **The smoke tried to connect to a port that's not listening** — the smoke waits indefinitely for a response. Add a timeout.
2. **A jest test is holding a file lock** — usually a SQLite file in `os.tmpdir()`. The cleanup didn't run.
3. **A node process spawned by a smoke didn't exit** — the smoke's child process needs a SIGKILL.

To diagnose:

```bash
# Find the hung process
ps aux | grep tsx       # Linux/macOS
Get-Process -Name node  # Windows PowerShell

# Look at what it's doing
# (Linux/macOS) - check if it's stuck on a syscall
strace -p <pid> -e trace=network,read,write

# Or just kill it
kill -9 <pid>          # Linux/macOS
taskkill /F /PID <pid> # Windows
```

After killing, run the failing test in isolation (`npx jest <name>` or `tsx scripts/<smoke>.ts`) to reproduce.

### Where to find the output

| Test layer | Output location |
|---|---|
| jest | stdout + `coverage/` (if --coverage) |
| Smoke | stdout + `staging/logs/*.log` (if smoke spawns processes) |
| Manual UI | Browser console + DevTools Network tab |

### See also

- §5.1 — Test architecture overview
- §5.2 — Unit test inventory
- §5.3 — API integration test inventory
- §5.4 — Smoke test inventory
- §5.9 — CI integration (future)

## 5.8 Test data management

This section covers the **test data lifecycle** — where it lives, how to reset it, and how to keep tests independent.

### The three categories of test data

1. **In-memory fixtures** (jest unit tests) — created in the test, destroyed when the test ends. No cleanup needed.

2. **Temp dir fixtures** (jest integration tests) — created in `os.tmpdir()` by the harness, cleaned up by `TestContext.cleanup()`. Cleanup is automatic.

3. **Live stack state** (smokes) — the actual `staging/data/registry.db` + per-source DBs. **The canonical state** for development; smokes that touch it are gated behind `--all`.

### Why we use temp dirs for integration tests

Integration tests need a registry DB + connector configs to function, but they should NOT pollute the developer's `staging/data/`. The harness uses `os.tmpdir()` to keep tests hermetic.

```typescript
// staging/api/__tests__/setup.ts (excerpt)
const dataDir = path.join(os.tmpdir(), `gcuid-test-${process.pid}-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });
```

Each test file gets its own dir, named with PID + timestamp. Cleanup deletes the dir.

### When temp dir cleanup fails

Sometimes a test fails before `cleanup()` runs (e.g. an unhandled exception in `beforeAll`). The temp dir leaks.

To clean up leaked temp dirs:

```bash
# Linux/macOS
rm -rf /tmp/gcuid-test-*

# Windows
rmdir /s /q %TEMP%\gcuid-test-*
```

Don't worry about deleting these aggressively — they're regenerated on every test run.

### Live stack test data

For smokes that touch the live stack (`cs-4.1`, `invariants`):

- **Read-only**: don't modify `registry.db` or source DBs. The invariants smoke is read-only.
- **Process management**: PID-scoped cleanup (cs-4.1). See [Developer Guidebook §1.12](guidebook-developer.md#112-testing-and-debugging).

For smokes that mutate the live stack (`cs-1.1`, `cs-2.1`, `cs-3.1`):

- **Destructive**: only run with `--all`, after `./stop-dev.sh`.
- **Reset between runs**: the registry reset workflow from [SysAdmin Guidebook §3.6](guidebook-sysadmin.md#36-database-management) is the canonical reset.

### Seed data and tests

The seed data (`staging/scripts/seed-data.ts`) provides:

- HR: ~50 employees with mixed departments.
- LDAP: ~80 entries with org-unit hierarchy.
- Engineering: ~30 assets.
- Finance: ~25 records.

These counts are deterministic per source but the **exact values may drift** between commits (test scenarios can add/remove rows). Don't write tests that depend on a specific row count.

### Test isolation principles

For each test:

1. **Don't assume registry state** — insert what you need via the harness helpers.
2. **Don't assume source state** — the source DBs are seeded automatically on first source-server start.
3. **Don't assume token state** — use the documented demo tokens.
4. **Don't assume the stack is running** — the harness sets up the app in-process; smokes fail explicitly if the stack isn't up.

### The "test scenario" pattern

For complex multi-step scenarios:

```typescript
describe('SC-MINE-1: ConflictMerge', () => {
  beforeAll(() => {
    ctx = setupTestEnv({ mountRoutes: ['identity', 'sources'] });
    // Seed 2 identities with conflicting attributes
    insertIdentity(ctx, { gcuid: 'g-1', source: 'hr', attr: 'name', value: 'Alice' });
    insertIdentity(ctx, { gcuid: 'g-2', source: 'ldap', attr: 'cn', value: 'Alice' });
  });

  test('the resolver merges them', async () => {
    const res = await request(ctx.app).post('/api/identity/resolve').send({ gcuid: 'g-1' });
    expect(res.status).toBe(200);
    expect(res.body.mergedGcuids).toContain('g-2');
  });
});
```

The scenario ID (`SC-MINE-1`) should be added to `staging/TEST_PLAN.md` so future readers can find the scenario description.

### Resetting the registry between destructive smokes

If you've run destructive smokes and want to start fresh:

```bash
# Reset the registry
./stop-dev.sh
rm staging/data/registry.db staging/data/registry.db-shm staging/data/registry.db-wal
./start-dev.sh

# Reset a specific source DB
./stop-dev.sh
rm staging/data/sources/conn-hr.db
./start-dev.sh
# (The HR source will re-seed automatically.)
```

For the source DBs, deleting the file is enough — the source server auto-seeds on startup if the file is missing.

### Snapshot tests (not used)

The POC does not use snapshot tests (e.g. `expect(output).toMatchSnapshot()`). Snapshot tests are sensitive to incidental changes (whitespace, formatting) and add maintenance burden without adding much value for a small POC.

If you find yourself wanting to write a snapshot test, prefer an explicit assertion (`expect(output).toBe(expected)`) — it documents the expected value in the test code.

### See also

- §5.1 — Test architecture overview
- §5.6 — Writing new tests
- §5.7 — Running test suites
- [SysAdmin Guidebook §3.6 Database management](guidebook-sysadmin.md#36-database-management) — reset workflow

## 5.9 CI integration

This section is the **forward-looking** view of CI for the POC. CI is **not currently configured** — the POC is local-only and the developer runs tests manually. When CI is added (likely as part of production hardening), this section is the reference.

### Why no CI today

The POC is local-only and the developer drives all testing. CI adds:

- A runner that needs the same Node/npm setup as the developer machine.
- Network access for npm install.
- Port allocation (CI runners don't have free ports by default).
- Time per run (CI minutes cost money).

For a POC with one developer, this overhead exceeds the value. CI becomes worthwhile when:

- Multiple developers are committing.
- Pre-merge gates are needed (to prevent broken commits landing).
- Public deployment is approaching.

### Recommended CI workflow (when added)

```yaml
# .github/workflows/test.yml
name: Test
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
      - run: npm run build
      - name: Smoke (default)
        run: ./start-dev.sh && npm run smoke && ./stop-dev.sh
```

The matrix tests against Node 20.x and 22.x — the two LTS versions the POC supports.

### What CI should run

| Step | Why |
|---|---|
| `npm ci` | Reproducible install (uses `package-lock.json`). |
| `npm test` | Unit + integration tests. |
| `npm run build` | Workspace build. |
| `./start-dev.sh` | Bring up the stack. |
| `npm run smoke` | Default smoke (cs-4.1 + invariants). |
| `./stop-dev.sh` | Tear down the stack. |

### What CI should NOT run

| Step | Why not |
|---|---|
| `npm run smoke -- --all` | Destructive smokes need exclusive port access. CI runners don't guarantee that. |
| UI tests | No E2E browser tests in the POC. |
| Load tests | Out of scope. |
| Security scans | Out of scope. |

### Port allocation in CI

The CI workflow above runs `./start-dev.sh`, which uses ports 5181-5191. These are usually free on a fresh GitHub Actions runner, but not guaranteed. If the CI fails on "EADDRINUSE", add a pre-step that kills any process holding the ports:

```yaml
- name: Free up GCUID ports
  run: |
    for port in 5181 5182 5183 5184 5185 5186 5188 5189 5190 5191; do
      lsof -ti:$port | xargs -r kill -9 || true
    done
```

### Caching

For faster CI, cache `node_modules/`:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20.x
    cache: 'npm'
```

This reduces install time from ~60s to ~10s on warm cache.

### Reporting

For PR-triggered CI runs, the recommended reporters:

- `npm test` output → GitHub Actions log (default).
- `npm run smoke` output → GitHub Actions log (default).
- Coverage → CodeCov or Coveralls (optional, post-POC).

### Branch protection

When CI is added, the recommended branch protection for `main`:

- Require CI to pass before merge.
- Require 1 reviewer (the POC has 1 developer + AI; reviewer is optional).
- Require linear history (rebase-merge or squash).

### Cost estimate

For a small POC, GitHub-hosted runners cost ~$0.008/minute. A full CI run (install + test + lint + build + smoke + teardown) takes ~5-10 minutes. That's ~$0.04-0.08 per run.

For a developer pushing 5-10 PRs/day, that's ~$1-2/day, ~$30-60/month. Not free, but not significant.

### See also

- §5.7 — Running test suites
- [SysAdmin Guidebook §3.6 Database management](guidebook-sysadmin.md#36-database-management) — registry reset workflow used by CI
- [Architect Guidebook §4.9 Mapping to a real deployment](guidebook-architect.md#49-mapping-to-a-real-deployment) — when CI becomes necessary

## 5.10 Bug-hunting methodology

This section is the **systematic approach to finding and fixing bugs** in the POC. It's the cookbook for "I see a bug — what do I do now?"

### The 4-phase debugging ladder

When you encounter a bug:

1. **Reproduce** — get the bug to happen on demand.
2. **Localize** — find the smallest system that exhibits the bug.
3. **Diagnose** — understand WHY it happens.
4. **Fix and verify** — make the change and prove it sticks.

This is the [systematic-debugging](https://en.wikipedia.org/wiki/Debugging) workflow, adapted for the POC's stack.

### Phase 1: Reproduce

Before you can fix a bug, you need to make it happen on demand.

Questions to ask:

- What did the user do?
- What did the user expect?
- What did they see instead?
- How often does it happen? Always? Sometimes?

For a POC bug, **always try to reproduce on the developer's machine first** — local reproduction is the fastest path to a fix. If it only happens in a specific environment, capture the env state (OS, Node version, browser version).

Reproduction commands:

```bash
# Restart the stack to a known state
./stop-dev.sh
./start-dev.sh

# Trigger the bug (specific API call or UI flow)
curl http://localhost:5182/api/identity/search \
  -X POST -H "Content-Type: application/json" \
  -d '{"name": "Alice"}'

# Capture the output
# (compare to expected output)
```

If you can't reproduce, file the bug with the symptom report and mark it "cannot reproduce".

### Phase 2: Localize

Find the smallest piece of the system that exhibits the bug.

Techniques:

- **Binary search**: comment out half the code, see if the bug goes away. Repeat.
- **Logging**: add `console.log` at strategic points. Run, see where the log appears (or doesn't).
- **Mocks**: replace the failing component with a mock. If the bug goes away, the component is the cause.
- **Smoke vs jest**: run the smoke (cross-process) vs the jest test (in-process). Which layer exhibits the bug?

For cross-process bugs (most POC bugs), the localization question is: **which process is the source?** Add `console.log` to each process, trigger the bug, see which process prints the unexpected value.

For in-process bugs (less common), the localization question is: **which function?** Use `console.log` or a debugger to step through.

### Phase 3: Diagnose

Understand WHY the bug happens.

Common root causes (from past PRs in this project):

1. **Configuration drift** — tokens out of sync, ports stale. Check `staging/config/`. The e5c3b8c fix recipe is the canonical example.
2. **State corruption** — DB invariant violated. Run `npm run smoke` to verify which invariants are broken.
3. **Schema mismatch** — code expects a field that doesn't exist (or vice versa). Compare code to schema.
4. **Auth mismatch** — token wrong, missing, or in wrong config. See [SysAdmin Guidebook §3.5](guidebook-sysadmin.md#35-authentication-tokens).
5. **Race condition** — two processes wrote simultaneously. SQLite WAL helps; check `registry.db-shm` and `registry.db-wal`.
6. **Path bug** — file path resolves wrong on Windows/MSYS. See [SysAdmin Guidebook §3.9 "Cannot find module /e/GitHub/..."](guidebook-sysadmin.md#39-troubleshooting).
7. **Missing seed** — DB is empty. Run `tsx staging/scripts/seed-data.ts --source=<name>`.
8. **Missing migration** — schema version out of sync. Run the migrations manually or reset the DB.

### Phase 4: Fix and verify

Make the smallest possible change that fixes the bug, then verify it sticks.

Verify steps:

1. **Reproduce the bug** (Phase 1) — confirm the bug still happens.
2. **Apply the fix**.
3. **Reproduce again** — confirm the bug is gone.
4. **Run the regression suite** — `npm test` + `npm run smoke`.
5. **Add a regression test** — write a test that fails on the pre-fix code and passes on the post-fix code. This prevents the bug from coming back.

### The "bug already happened" rule

If you find a bug in the developer's environment that's been there for a while:

1. **Check git history** — `git log --all --oneline | head -30` shows recent commits. `git blame <file>` shows who changed what.
2. **Check the smokes** — is the smoke supposed to catch this? If not, that's a smoke-coverage gap; add the assertion.
3. **Check the test plan** — `staging/TEST_PLAN.md` lists the scenarios. Is the scenario covered? If not, add it.
4. **Check related PRs** — was this bug fixed in a related branch?

If the bug is **in production data** (not code), follow the [SysAdmin Guidebook §3.6 Database management](guidebook-sysadmin.md#36-database-management) reset workflow.

### The "bug only happens sometimes" rule

Intermittent bugs are usually one of:

1. **Race condition** — see Phase 3 #5.
2. **Timing-dependent** — the smoke runs faster than the production code; the production code occasionally loses a race the smoke never sees.
3. **State-dependent** — the bug only happens when the DB has certain rows. Reproduce with a specific row pattern.
4. **Environment-dependent** — only on Windows, only on certain Node versions.

For intermittent bugs:

- Add logging to capture the state at the moment of the bug.
- Run the failing test in a loop: `for i in {1..100}; do npm run smoke; done`.
- If the smoke passes 100/100, the bug isn't reproducible in tests — capture the production state and inspect.

### The "I can't reproduce on my machine" rule

If the user reports a bug you can't reproduce:

1. **Get the exact reproduction steps** — what they clicked, what they typed, what they saw.
2. **Get the exact environment** — OS version, Node version, browser version, screenshot if UI.
3. **Compare to your setup** — what differs?
4. **Use the user's data** — if they can share a snapshot of `registry.db` or the relevant source DB, run your smoke against their data.

If still can't reproduce, file the bug with the report and mark it "cannot reproduce on developer's machine — needs user environment".

### Tools of the trade

| Tool | Use |
|---|---|
| `console.log` | First-pass debug. Add liberally, remove when done. |
| `node --inspect` | Chrome DevTools debugger for Node processes. |
| Browser DevTools | For Web UI bugs. Console, Network, React DevTools, Sources tab. |
| `tail -F staging/logs/*.log` | Real-time log monitoring. |
| `sqlite3 staging/data/registry.db` | Direct DB inspection. |
| `curl -i http://localhost:5182/api/...` | Direct API calls. |
| `git log -p <file>` | Recent changes to a file. |
| `git bisect` | Binary search through git history for the commit that introduced a bug. |

### The "git bisect" workflow

When a bug appeared recently and you're not sure which commit:

```bash
# Start bisect
git bisect start

# Mark current as bad
git bisect bad

# Mark a known-good commit (e.g. the last release)
git bisect good v1.0.0

# Git will checkout a midpoint commit. Test it.
npm test && npm run smoke
# If passing: git bisect good
# If failing: git bisect bad

# Repeat until git identifies the offending commit.

# When done
git bisect reset
```

`git bisect` is underused but extremely effective for tracking down regressions.

### Reporting bugs

When you file a bug, include:

1. **What you did** (steps to reproduce).
2. **What you expected**.
3. **What you saw** (actual behavior, error message, screenshot).
4. **Your environment** (OS, Node version, browser version).
5. **Relevant logs** (`staging/logs/api.log` excerpt, browser console output).
6. **The smoke result** (`npm run smoke` output).

A bug report without these is hard to triage. Spend 5 minutes on the report; save an hour of back-and-forth.

### See also

- §5.1 — Test architecture overview
- §5.5 — Testing the Web UI
- §5.6 — Writing new tests (regression test patterns)
- [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting) — common failure modes
- [Developer Guidebook §1.12 Testing and debugging](guidebook-developer.md#112-testing-and-debugging) — debugging ladder
- [Architect Guidebook §4.10 Open questions](guidebook-architect.md#410-open-questions-and-known-limitations) — known limitations
