# User Guidebook

**For**: End users of the GCUID service — the people who register identities, look up records, and manage their profiles.
**Not for**: Developers (see [Developer Guidebook](guidebook-developer.md)), operators (see [SysAdmin Guidebook](guidebook-sysadmin.md)), or architects (see [Architect Guidebook](guidebook-architect.md)).

This guidebook is the friendly path through the system's user-facing surfaces.

## Table of contents

| # | Section | What's covered |
|---|---|---|
| 2.1 | [Welcome to GCUID](#21-welcome-to-gcuid) | What this system is, in plain language |
| 2.2 | [Getting started](#22-getting-started) | Open the Web UI, find the demo identities, navigate the portals |
| 2.3 | [Looking up a GCUID](#23-looking-up-a-gcuid) | The lookup flow — search by employee ID, name, email |
| 2.4 | [Registering a new identity](#24-registering-a-new-identity) | The self-registration flow, source-mapping, identity states |
| 2.5 | [Managing your profile](#25-managing-your-profile) | Update attributes, view your identity state, lifecycle transitions |
| 2.6 | [Browsing source systems](#26-browsing-source-systems) | The org-chart view — what sources exist, what they hold |
| 2.7 | [Troubleshooting](#27-troubleshooting) | What to do when a lookup fails, common error messages |

## See also

- [Developer Guidebook](guidebook-developer.md) — if you're an engineer
- [SysAdmin Guidebook](guidebook-sysadmin.md) — if you're running the system
- [Architect Guidebook](guidebook-architect.md) — design intent
- [Tester Guidebook](guidebook-tester.md) — the test surface
- [Full use-case catalog](#full-use-case-catalog-24-scenarios) — 24 scenarios across 6 categories

## 2.1 What is GCUID

This section is the **30-second orientation** for end users. If you're new to the system and want to understand what it does, start here.

### The one-paragraph summary

GCUID is a **federated identity registry** that consolidates information about people from multiple authoritative sources (HR, LDAP, asset management, finance) into a single canonical identity, while leaving each source in control of its own data. Each identity gets a unique GCUID (Government of Canada Unique Identifier) that the registry can use to look up that person across all connected sources.

### What you do with it

If you're an end user — an HR operator, an IT administrator, a department manager — you'll use GCUID through the **Web UI**. The UI is at http://localhost:5181/ when the system is running locally.

Common tasks:

- **Search for a person** by name, email, employee ID, or department.
- **View a person's attributes** — what HR says, what LDAP says, what the asset system says, all in one place.
- **Browse sources** — see which authoritative sources are connected and their health status.
- **Resolve duplicates** — when two records point to the same person, merge them.
- **Manage identity states** — provisional, active, suspended, retired, archived.

### What GCUID is NOT

- **Not a source of truth** — GCUID doesn't store the original records. It mirrors them from authoritative sources. The HR system remains the truth for HR data; LDAP remains the truth for LDAP data; GCUID just gives you a single view.
- **Not a write-pipe to sources** — you don't push data into GCUID and expect it to land in HR. GCUID is read-mostly. (Some sources do allow writes back, but that's per-source configuration.)
- **Not a replacement for HR** — GCUID complements HR. It answers "tell me everything you know about this person across all our systems," not "let me edit Jane's last name."
- **Not a public system** — GCUID is local-only and intended for internal use within an organization.

### The key concepts

Three concepts appear throughout the UI and are worth learning:

- **GCUID** — a unique identifier in the format `urn:gcuid:<26-char-crockford-base32>`. Every identity has one. It doesn't change.
- **Authoritative source** — a system that owns a particular type of data (HR, LDAP, etc.). GCUID connects to these via connectors.
- **Connector** — a small process that translates between GCUID and an authoritative source. You don't interact with connectors directly; they run in the background.

### The data flow

When you search for a person:

1. Your query goes from the Web UI to the GCUID API.
2. The API asks the relevant connectors: "do you know this person?"
3. Each connector queries its source (HR, LDAP, etc.).
4. Each connector returns what it knows.
5. The API merges the results, resolving conflicts.
6. The merged view comes back to the Web UI.

You see one unified record; behind the scenes, GCUID has done a multi-source merge.

### What you should expect to see

When the system is running and seeded:

- The dashboard shows the system status.
- The System → System page shows all 4 connected sources (HR, LDAP, Engineering, Finance) with green status indicators.
- The Identity → Search page lets you find people.
- The seeded data includes ~50 employees, ~80 LDAP entries, ~30 assets, ~25 finance records.

If you don't see this, the system may not be running. See [SysAdmin Guidebook §3.3](guidebook-sysadmin.md#33-starting-and-stopping-the-stack).

### See also

- §2.2 — Common tasks
- §2.3 — Use case walkthroughs
- [SysAdmin Guidebook §3.3](guidebook-sysadmin.md#33-starting-and-stopping-the-stack) — getting the system running

## 2.2 Common tasks

This section is the **task cookbook** for end users. Each task is a step-by-step procedure with screenshots references (when available) and troubleshooting tips.

### Task 1: Search for a person

**When to use**: You need to find someone's GCUID, contact info, or current attributes.

**Steps**:

1. Open http://localhost:5181/ in your browser.
2. Click **Identity → Search** in the top navigation.
3. In the search box, type one of:
   - Full or partial name (e.g. "Alice" or "Alice Smith")
   - Email address (e.g. "alice@example.com")
   - Employee ID (e.g. "EMP001")
   - Department (e.g. "Engineering")
4. Press Enter or click **Search**.
5. Browse the results. Each result shows:
   - The person's name and primary attributes.
   - Which sources have data for this person (HR, LDAP, etc.).
   - The person's GCUID (small text below the name).
6. Click a row to see the full attribute detail.

**What you see**: A list of matching identities, ranked by relevance. If your search is too broad, refine it. If it's too narrow, broaden it.

**Troubleshooting**:

- **0 results for an existing person**: The person may not be in any source yet. Check System → System to verify the sources are healthy. If HR is down, the person might be in HR but not queryable.
- **Too many results**: Add a more specific term (full name instead of first name).
- **Results don't match the name exactly**: GCUID uses fuzzy matching for names. "Alise" matches "Alice" with 70%+ similarity.

### Task 2: View a person's full profile

**When to use**: You searched and found someone; now you want the full attribute breakdown.

**Steps**:

1. From the search results, click the row of the person you want.
2. The detail view shows:
   - **GCUID**: The unique identifier. Click to copy.
   - **Identity state**: One of `provisional`, `active`, `under_review`, `suspended`, `retired`, `archived`.
   - **Attributes**: Grouped by source (HR, LDAP, Engineering, Finance).
   - **History**: When each attribute was last asserted and by which source.
3. Click any attribute to see its history (assertions from each source over time).

**What you see**: A multi-source view of the same person. If HR says the person is "Active" but LDAP says the account is "Disabled", both show — with the most recent assertion highlighted.

**Troubleshooting**:

- **Attribute is missing**: The source may not have that attribute. GCUID only mirrors what the source has.
- **Conflicting attributes**: Both show; the most recent assertion is highlighted. See Task 5 for resolving conflicts.

### Task 3: Browse sources

**When to use**: You want to know which sources are connected and whether they're healthy.

**Steps**:

1. Click **System → System** in the top navigation.
2. The page shows all 4 sources as cards:
   - **HR System** (port 5183, source on 5188)
   - **LDAP System** (port 5184, source on 5189)
   - **Engineering System** (port 5185, source on 5190)
   - **Finance System** (port 5186, source on 5191)
3. Each card shows:
   - **Status**: Green (healthy), yellow (degraded), red (unreachable).
   - **Record count**: Number of records in the source.
   - **Last sync**: When the connector last fetched data.
4. Click **Ping** or **Health** on any card to verify connectivity in real time.

**What you see**: A live dashboard of source health. If everything is green, the system is healthy. If a card is red, see [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting).

**Troubleshooting**:

- **All cards red**: The connectors or sources may have crashed. Restart with `./start-dev.sh`.
- **One card red**: That specific connector or source is down. Check the logs.
- **Cards green but data missing**: The source has no records for what you're searching. Not a bug.

### Task 4: Resolve duplicate identities

**When to use**: The same person appears as two separate identities (e.g. once from HR, once from LDAP, and they haven't been auto-merged).

**Steps**:

1. Search for the person by name or email.
2. If you see two similar results, they're candidates for merge.
3. Click the first identity, note its GCUID.
4. Click **Merge with…** in the top-right.
5. Search for and select the second identity (the candidate).
6. Review the side-by-side attribute comparison.
7. Choose which attribute wins for each conflicting field (or accept the system's recommendation).
8. Click **Confirm merge**.

**What happens next**: The two identities become one. The GCUID of the survivor stays; the loser is marked `merged_into_<survivor>` and won't appear in searches anymore. The merge is logged in the audit trail.

**Troubleshooting**:

- **Merge button is greyed out**: The two identities are already linked, or one is in a state that doesn't allow merge.
- **Attributes don't appear in the comparison**: Some attributes are present in only one identity. Those don't need a choice.
- **Merge fails with an error**: Check the API response. Common cause: a state transition that's not allowed (e.g. merging an `archived` identity with an `active` one).

### Task 5: Change an identity's state

**When to use**: An employee has left, been suspended, or needs review.

**Steps**:

1. Find the person via search.
2. Open their detail view.
3. Click **Change State** in the top-right.
4. Select the new state:
   - `provisional` → new identity, not yet confirmed.
   - `active` → confirmed and current.
   - `under_review` → needs manual review.
   - `suspended` → temporarily blocked.
   - `retired` → no longer active, but not removed.
   - `archived` → fully removed from active lookups.
5. Provide a reason (required for audit).
6. Click **Confirm**.

**What happens next**: The identity's state changes immediately. The change is logged with your username, the reason, and the timestamp.

**Troubleshooting**:

- **State transition not allowed**: Some transitions are forbidden (e.g. `archived` → `active`). Check the [Developer Guidebook §1.13 state machine](guidebook-developer.md#113-build-package-ship).
- **State change doesn't propagate to sources**: GCUID doesn't write back to sources by default. The state is local to GCUID.

### Task 6: Export data

**When to use**: You need a list of identities or attributes for a report.

**Steps**:

1. Navigate to the page with the data you want (search results, source detail, etc.).
2. Look for an **Export** or **Download** button (top-right of the data table).
3. Choose the format (CSV, JSON).
4. Choose the scope:
   - **Filtered** (current view): what you see on screen.
   - **All** (everything): the full set, ignoring filters.
5. Click **Export**.

**What happens next**: The file downloads to your browser's default download location.

**Troubleshooting**:

- **No Export button**: Some views don't support export yet. Use the API directly (`curl http://localhost:5182/api/...`).
- **Empty file**: The filtered view had 0 rows. Switch to "All" or check your filter.
- **Format not what you expected**: CSV vs JSON affects machine-readability. CSV for Excel, JSON for scripts.

### See also

- §2.1 — What is GCUID
- §2.3 — Use case walkthroughs (full scenarios)
- §2.7 — Frequently asked questions
- [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting) — when something's broken

## 2.3 Use case walkthroughs

This section walks through the **most common end-to-end scenarios** in GCUID. Each walkthrough is a real example with the steps you'd take in the UI.

For the **complete use-case catalog** (all 24 scenarios across 6 categories with metadata: actors, duration, starting state), see [Full use-case catalog](#full-use-case-catalog-24-scenarios) below. The walkthroughs above pick the 7 most relevant to daily use and present them with a UI-centric flow.

### Walkthrough 1: New employee joins

**Scenario**: A new employee (Jane Smith) is added to HR. The team needs her GCUID so other systems can refer to her.

**Step-by-step**:

1. **HR adds the employee to HR system** (this is in HR, not GCUID).
   - HR adds `Jane Smith`, employee ID `EMP031`, email `jane.smith@example.com`, department `Engineering`.
   - The connector picks this up automatically (every few minutes).
2. **Wait for the connector to sync**. Check System → System; the HR card should show "Last sync: just now".
3. **Search for Jane**: Identity → Search → "Jane Smith".
4. **Click her result** to see her detail view.
5. **Verify the attributes**: name, email, department all match what HR has.
6. **Copy her GCUID** for use in other systems.

**What you see**: A new identity with state `provisional` (because no human has confirmed it yet). The connector asserted the attributes automatically.

**What you do next**:

- Review the identity (Task 5 in §2.2) and change state from `provisional` → `active` if all attributes look correct.
- Or leave it as `provisional` and let another operator confirm.

**Reference**: UC-1.1 in [the catalog below](#full-use-case-catalog-24-scenarios).

### Walkthrough 2: Cross-source attribute merge

**Scenario**: Jane's HR record says her department is "Engineering". LDAP says her department is "Engineering Services" (an older name for the same group). GCUID needs to reconcile these.

**Step-by-step**:

1. Search for Jane and open her detail view.
2. Look at the **Attributes** section. You'll see:
   - HR: `department = "Engineering"` (most recent assertion)
   - LDAP: `department = "Engineering Services"` (older assertion)
3. Click the **department** attribute to see its history.
4. The history shows two assertions, with timestamps.
5. The most recent assertion (HR's "Engineering") is highlighted as the current value.
6. If you agree, no action needed — the system has already chosen the more recent value.
7. If you disagree (e.g. HR is wrong), you can manually override by clicking **Override** and entering the correct value.

**What you see**: Two sources with conflicting attributes, with the most recent one highlighted.

**Reference**: UC-2.2 in [the catalog below](#full-use-case-catalog-24-scenarios).

### Walkthrough 3: Duplicate detection and merge

**Scenario**: A new employee was added to HR but also exists in LDAP under a slightly different name ("Alise Smith" vs "Alice Smith"). GCUID detects them as duplicates and surfaces them for review.

**Step-by-step**:

1. Go to Identity → Duplicates (in the top navigation).
2. The page shows pairs of identities that GCUID thinks might be the same person.
3. Find the "Alise / Alice" pair.
4. Click **Review**.
5. The side-by-side comparison shows:
   - **Alise Smith** (from LDAP, state: active, account: disabled)
   - **Alice Smith** (from HR, state: provisional, employee_id: EMP031)
6. Review the matching attributes: name (85% similar), email (matches), department (matches).
7. Click **Confirm merge**.
8. Choose which identity survives (in this case, the HR identity with the employee ID).
9. Click **Confirm**.

**What happens next**:

- The two identities become one. The survivor is `Alice Smith` with state `active`.
- The merged-into identity is marked `merged_into_urn:gcuid:...` and won't appear in searches.
- The merge is logged with your username and timestamp.

**Reference**: UC-3.1, UC-3.2 in [the catalog below](#full-use-case-catalog-24-scenarios).

### Walkthrough 4: Employee leaves the organization

**Scenario**: An employee is being terminated. Their access should be revoked.

**Step-by-step**:

1. Search for the employee by name or employee ID.
2. Open their detail view.
3. Click **Change State** (top-right).
4. Select `retired` (for audit retention, no longer active).
5. Provide a reason: "Voluntary resignation, 2026-10-15".
6. Click **Confirm**.
7. (Optional, if you want full removal) Change state again to `archived`.

**What happens next**:

- The identity's state changes immediately.
- The change is logged with your username, the reason, and the timestamp.
- If the source has a write-back configured (e.g. LDAP can be updated), the connector may propagate the state to LDAP. By default, GCUID does NOT write back.

**What you should NOT do**:

- Don't manually edit the source's record from GCUID. Use the source's own system (HR system, LDAP admin, etc.).
- Don't `DELETE` the identity from GCUID — change state instead. The audit trail needs the history.

**Reference**: UC-1.3, UC-1.4 in [the catalog below](#full-use-case-catalog-24-scenarios).

### Walkthrough 5: Investigating why a connector is unhealthy

**Scenario**: The Engineering source shows "red" on the System → System page. Records from Engineering aren't showing up in search results.

**Step-by-step**:

1. Open System → System.
2. Find the Engineering card; it's red.
3. Click **Ping** on the card. The ping response shows why it's unreachable.
4. Common causes:
   - **Connector process crashed**: Check if port 5185 is listening.
   - **Source DB is locked**: Check if another process has `staging/data/sources/conn-engineering.db` open.
   - **Token mismatch**: The connector's token doesn't match the source's token.
5. If you can identify the cause, fix it (restart the process, kill the lock holder, fix the token).
6. Click **Health** to verify the connector is now healthy.

**What happens next**: After the fix, the card turns green and records start flowing.

**If you can't fix it**: See [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting) for detailed diagnostic steps.

**Reference**: UC-4.2 in [the catalog below](#full-use-case-catalog-24-scenarios).

### Walkthrough 6: Adding a new source (administrator task)

**Scenario**: The organization acquires a new system (say, "Facilities") and wants GCUID to mirror its data.

**Step-by-step**:

This is more of an admin task than a user task, but here's the outline:

1. (Admin) Configure the source server: create `staging/config/sources/src-facilities.json`.
2. (Admin) Configure the connector: create `staging/config/connectors/conn-facilities.json`.
3. (Admin) Add the source to the registry: insert into `source_systems` and `connector_auth_tokens`.
4. (Admin) Restart the API + new source + new connector.
5. (User) Verify on System → System that the Facilities card appears.
6. (User) Search for a Facilities record to confirm data flows.

**Reference**: UC-4.3, UC-6.2 in [the catalog below](#full-use-case-catalog-24-scenarios). Detailed steps in [Developer Guidebook §1.10](guidebook-developer.md#110-adding-a-new-connector-worked-example).

### Walkthrough 7: Reviewing the audit trail

**Scenario**: A central administrator wants to see who changed what in the last 24 hours.

**Step-by-step**:

1. Click **Admin → Audit Log** (in the top navigation).
2. The audit log shows a paginated list of recent events:
   - Identity created
   - State changed
   - Attribute asserted
   - Identity merged
   - Source added/removed
3. Filter by event type (top dropdown).
4. Filter by identity (search box).
5. Filter by date range (calendar picker).
6. Click any row to see the full event detail (old value, new value, who, when).

**What you see**: A chronological audit trail. Every state-changing action is logged.

**Troubleshooting**:

- **Audit log is empty**: The system just started, or no changes have been made yet.
- **Can't find an event**: The filter is too narrow. Clear filters and scroll.
- **Old events are missing**: The audit log doesn't rotate in the POC. Old events stay forever.

**Reference**: UC-5.1 in [the catalog below](#full-use-case-catalog-24-scenarios).

### Full use-case catalog (24 scenarios)

The 7 walkthroughs above are a curated subset. The complete use-case catalog spans 24 scenarios across 6 categories. Each entry shows the UC identifier, title, actors involved, and starting state. The walkthroughs above are UI-centric steps for the most common flows; this catalog is metadata-only (use it as an index, not as a step-by-step guide).

#### Category 1: Identity Lifecycle

- **UC-1.1: New Employee Onboarding (Happy Path)** — Actors: End User (Jane Smith), HR Operator, Central Administrator. Starting state: empty central registry, 30 employees in HR system. (See Walkthrough 1 above.)
- **UC-1.2: Identity Request Rejection** — Actors: End User (Unknown Person), Central Administrator. Starting state: registry with existing identities. A user requests an identity but no authoritative source matches; admin reviews and rejects.
- **UC-1.3: Identity Suspension & Reactivation** — Actors: Central Administrator. Starting state: active identity for employee on leave. State transitions: `active → suspended → active`.
- **UC-1.4: Identity Retirement & Archival** — Actors: HR Operator, Central Administrator. Starting state: active employee leaving organization. State transitions: `active → retired → archived`.

#### Category 2: Attribute Federation

- **UC-2.1: Cross-Source Attribute Query** — Actors: Central Administrator. Starting state: active identity linked to multiple sources. (See Walkthrough 2 above for the conflict-resolution variant.)
- **UC-2.2: Source Priority & Conflict Resolution** — Actors: Central Administrator. Starting state: identity with conflicting data across sources. (See Walkthrough 2 above.)

#### Category 3: Identity Matching

- **UC-3.1: Duplicate Detection (Strong Match)** — Actors: Central Administrator. Starting state: two identity requests for same person. (See Walkthrough 3 above.)
- **UC-3.2: Fuzzy Matching (Name Variations)** — Actors: Central Administrator. Starting state: employee with name variation in systems. Match engine applies Levenshtein similarity.

#### Category 4: Connector Operations

- **UC-4.1: Connector Health Monitoring** — Actors: Departmental Operator (HR Admin). Starting state: all connectors running. (See Walkthrough 5 above.)
- **UC-4.2: Connector Troubleshooting (Unhealthy)** — Actors: Departmental Operator, Central Administrator. Starting state: one connector not responding. (See Walkthrough 5 above.)
- **UC-4.3: Adding New Identity Source** — Actors: Central Administrator. Starting state: existing sources (HR, LDAP, Engineering, Finance). (See Walkthrough 6 above.)

#### Category 5: Security & Compliance

- **UC-5.1: Audit Trail Review** — Actors: Central Administrator. Starting state: system with activity history. (See Walkthrough 7 above.)
- **UC-5.2: Privacy-Preserving Queries** — Actors: Departmental Operator. Starting state: active identities with PII. Operator queries without PII access; elevated permissions require a reason logged in the audit trail.

#### Category 6: Departmental Integration

- **UC-6.1: Pre-Integration State (Department Standalone)** — Actors: HR Department. Starting state: HR system operating independently, no GCUID integration.
- **UC-6.2: Connector Installation & Registration** — Actors: HR Operator, Central Administrator. Starting state: department ready to integrate. Two-phase: department preparation (install, configure, test) + central system registration (register source, map attributes, authorize).
- **UC-6.3: Post-Integration State (Federated Identity)** — Actors: HR Department. Starting state: connector active, identities created. Federated identity state visible across both systems.
- **UC-6.4: New Employee Added (Department → Central)** — Actors: HR Operator. Starting state: connector integrated. Department adds new employee; central registry creates GCUID via CAES auto-link.
- **UC-6.5: Employee Updated (Department → Central Notification)** — Actors: HR Operator. Starting state: active employee with GCUID. Department updates employee data; central registry reflects the update.
- **UC-6.6: Employee Terminated (Department → Central Lifecycle)** — Actors: HR Operator, Central Administrator. Starting state: active employee. Department terminates employee; central registry transitions identity to `retired` and `archived`.
- **UC-6.7: GCUID Query Response (Central → Department)** — Actors: HR Operator (responding to central query). Starting state: connector active, identities exist. Central queries an attribute; department source provides the value.
- **UC-6.8: Connector Metrics & Monitoring (Department View)** — Actors: HR Operator. Starting state: connector running with history. Department dashboard shows error rate, latency, throughput.
- **UC-6.9: Connector Troubleshooting (Department Perspective)** — Actors: HR Operator. Starting state: connector experiencing issues. Department-side diagnosis (vs UC-4.2 which is central-side).
- **UC-6.10: Data Sovereignty & Compliance (Department Control)** — Actors: HR Operator, Compliance Officer. Starting state: integrated system, compliance requirements. Department owns its source data; central only has GCUIDs and attribute mappings.

### See also

- §2.1 — What is GCUID
- §2.2 — Common tasks
- [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting)
- [Developer Guidebook §1.10](guidebook-developer.md#110-adding-a-new-connector-worked-example) — adding new sources

## 2.4 Source system browser

This section is the **deep-dive on the System → System page** — the user-facing surface for browsing sources. If you spend a lot of time checking source health or debugging data flow, this is the section.

### The System → System page layout

The page shows all configured sources as a grid of cards. Each card represents one authoritative source (HR, LDAP, Engineering, Finance, etc.).

Each card has:

- **Title**: The source's display name (e.g. "HR System").
- **Status indicator**: A coloured dot — green (healthy), yellow (degraded), red (unreachable).
- **Source ID**: The internal ID (e.g. `conn-hr`). Click to copy.
- **Record count**: Number of records in the source.
- **Last sync timestamp**: When the connector last fetched data.
- **Latency**: How long the last fetch took (in milliseconds).
- **Action buttons**: Ping, Health, View records.

### What each action button does

#### Ping

Sends a quick "are you there?" message to the connector. Returns:

- `reachable: true/false` — did the connector respond?
- `latency_ms: <number>` — how long the round trip took.
- `error: <string>` (if unreachable) — what went wrong.

Use this for a quick sanity check. It's fast and lightweight.

#### Health

A more detailed check. Returns:

- `status: healthy/degraded/unreachable`.
- `recordCount: <number>` — current record count in the source.
- `lastSync: <iso-timestamp>` — last successful sync.
- `errors: <array>` — recent errors (last 24 hours).
- `uptime: <seconds>` — how long the source has been running.

Use this when Ping says "reachable" but you suspect something is wrong.

#### View records

Opens a paginated list of all records in the source. Useful for:

- Verifying a specific record exists.
- Spot-checking data quality.
- Debugging why a search isn't finding what you expect.

Note: this shows the **source's** records, not GCUID's view of them. They should match, but if the connector hasn't synced, they won't.

### What the status colors mean

| Color | Status | Meaning |
|---|---|---|
| Green | Healthy | Source is reachable AND recent sync succeeded. |
| Yellow | Degraded | Source is reachable BUT recent sync had warnings (partial data, slow). |
| Red | Unreachable | Source is not reachable. Records won't update until source comes back. |

A yellow card usually means the source is up but something is wrong with the data (schema drift, partial table, etc.). Investigate via Health → errors.

A red card means the connector can't reach the source at all. The source process may have crashed, or the network may be broken. See [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting).

### The "Last sync" timestamp

This tells you when the connector last successfully fetched data from the source. It updates:

- On a scheduled pull (every 5 minutes by default).
- On a dynamic pull (when the API queries the connector).
- On a push from the connector (if push-cache mode).

If the timestamp is more than 10 minutes old and the connector is supposed to be polling, something is wrong. Check the logs.

### Filters and search

The System → System page has filters at the top:

- **By status**: Show only healthy / degraded / unreachable.
- **By type**: Show only specific source types (HR, LDAP, etc.).
- **Search**: Free-text search across source names and IDs.

Filters apply client-side. They don't change what's in the database — they only change what you see.

### Refreshing the page

The page auto-refreshes every 30 seconds (configurable in `vite.config.ts` proxy settings). You can also force a refresh with F5 / Ctrl+R.

If the page shows stale data after a refresh, check:

- The connector's "Last sync" timestamp — is it updating?
- The API's `/api/system/dashboard` endpoint — does it return fresh data?
- The browser console for errors.

### Common questions

**Q: Why does the record count differ from what I see when I "View records"?**
A: The card shows the source's record count. View records shows up to 100 records at a time. For a 10,000-record source, the card says "10,000" but View records shows the first page of 100.

**Q: Can I edit records from this page?**
A: No. GCUID is read-mostly. Edit records in the source's own system.

**Q: Can I add a new source from this page?**
A: No. That's an admin task. See [Developer Guidebook §1.10](guidebook-developer.md#110-adding-a-new-connector-worked-example).

**Q: What if a source shows "Healthy" but my searches don't return its data?**
A: The connector may not have synced recently. Force a sync by clicking **Health** (which triggers a fresh fetch).

**Q: Can I see historical sync attempts?**
A: Yes, via the connector's logs at `staging/logs/connectors.log`. The card shows only the most recent sync.

### See also

- §2.2 Task 3 — Browse sources (task-level steps)
- §2.3 Walkthrough 5 — Investigating unhealthy connector
- [SysAdmin Guidebook §3.4 Port and process reference](guidebook-sysadmin.md#34-port-and-process-reference) — which process owns which port
- [Developer Guidebook §1.7 The connector system](guidebook-developer.md#17-the-connector-system-plan-b-b3)

## 2.5 Identity search and lookup

This section is the **deep-dive on the Identity → Search page** — the user-facing surface for finding people. If you spend a lot of time looking up identities, this section explains the search semantics, filters, and result interpretation.

### The search page layout

The page has:

- **Search box** (top): Free-text input for name, email, employee ID, or department.
- **Filter panel** (left side): Filter by source, state, department, etc.
- **Result list** (center): Paginated list of matching identities.
- **Detail panel** (right side, optional): Shows the selected identity's full profile.

The search uses **fuzzy matching** — you don't need to type the exact name. "Alise" matches "Alice" with 70%+ similarity.

### What you can search by

The search box accepts:

- **Name**: First name, last name, or full name. "Alice", "Smith", "Alice Smith".
- **Email**: Full or partial. "alice", "alice@example.com", "@example.com".
- **Employee ID**: Exact match. "EMP001".
- **Department**: Substring match. "Engineering", "Eng".
- **Phone number** (if present in source): Partial match.

Multiple terms are AND'd. Searching "Alice Engineering" finds Alice Smith who works in Engineering.

### Filters

The left filter panel has:

- **State**: One or more of `provisional`, `active`, `under_review`, `suspended`, `retired`, `archived`. Default: active + provisional.
- **Source**: One or more of the configured sources. Default: all.
- **Department**: Dropdown of all departments that have at least one identity.
- **Date range**: Filter by when the identity was created or last updated.
- **Has GCUID**: Yes / No / Either. Default: Either.

Filters are AND'd together. "Active + Engineering + last 30 days" finds identities that match all three.

### Result ranking

Results are ranked by relevance. The default ranking considers:

1. **Exact match** (highest priority): full email or employee ID.
2. **Prefix match**: name starts with the search term.
3. **Fuzzy match**: Levenshtein distance < threshold (default 70% similarity).
4. **Source coverage** (tie-breaker): identities with more sources rank higher.

If two identities have the same score, the more recently updated one wins.

### Reading a result

Each result row shows:

- **Name** (bold): The person's primary name.
- **Email**: Below the name.
- **Department**: To the right.
- **State badge**: Coloured chip indicating the identity's state.
- **Sources**: Small icons showing which sources have data for this person.
- **GCUID**: Small grey text below the name. Click to copy.

Click the row to open the detail view (§2.2 Task 2).

### Common search scenarios

#### "Find me everyone in Engineering"

1. Type "Engineering" in the search box.
2. Filter by state: active.
3. Result: All identities whose department is "Engineering" (substring match).
4. Refine: Click "Engineering" in the result list to see only that exact department.

#### "Find Alice Smith"

1. Type "Alice Smith".
2. Result: Identity(ies) with name matching "Alice Smith" exactly, or "Alice S..." prefix, or fuzzy "Alise Smith".
3. If multiple Alice Smiths exist, you see all of them.

#### "Find who has employee ID EMP001"

1. Type "EMP001" in the search box.
2. Result: The identity with that exact employee ID (HR source).
3. If EMP001 doesn't exist in any source, you see 0 results.

#### "Find suspended employees"

1. Filter by state: suspended.
2. Leave search box empty.
3. Result: All suspended identities.

### When you get 0 results

| Cause | What to check |
|---|---|
| The person isn't in any source yet | Search System → System to verify all sources are healthy. |
| The person is in a state you're filtering out | Clear the state filter. |
| The search term has typos the fuzzy matcher can't bridge | Try a different spelling, or use exact-match fields (employee ID). |
| The connector hasn't synced the latest source data | Wait a few minutes and try again. |

### When you get too many results

| Cause | What to check |
|---|---|
| Search term is too broad | Add more specific terms (full name instead of first name). |
| Too many filters set incorrectly | Clear filters and re-apply. |
| The system has many identities (10,000+) | Use the source filter to narrow to one source. |

### The "search history" feature

The search box remembers your last 10 searches (stored in browser localStorage). Click the dropdown arrow to see history. Click an entry to re-run that search.

This is a per-browser feature — it's not shared across users or devices.

### When to use the API instead of the UI

For scripted or bulk operations, use the API:

```bash
curl -X POST http://localhost:5182/api/identity/search \
  -H "Content-Type: application/json" \
  -d '{"query": "Alice", "limit": 100}'
```

Returns a JSON array of matching identities. Useful for:

- Bulk exports.
- Integration with other systems.
- Automated reporting.

For more details, see [Developer Guidebook §1.11 Adding a new API endpoint](guidebook-developer.md#111-adding-a-new-api-endpoint-worked-example).

### See also

- §2.2 Task 1 — Search for a person (task-level steps)
- §2.3 Walkthrough 3 — Duplicate detection
- [Developer Guidebook §1.11 Adding a new API endpoint](guidebook-developer.md#111-adding-a-new-api-endpoint-worked-example)
- [Architect Guidebook §4.6 Access modes](guidebook-architect.md#46-access-modes) — dynamic-pull vs scheduled-pull

## 2.6 Profile management

This section is the **deep-dive on a person's profile page** — the user-facing surface for viewing and managing a single identity. Most users spend 80% of their time on this page (or the search results leading to it).

### The profile page layout

The profile page has several zones:

- **Header** (top): Name, GCUID (click to copy), state badge, action buttons.
- **Attributes** (middle): Grouped by source.
- **History** (bottom-right): Audit trail for this identity.
- **Related identities** (bottom-left): Duplicates, aliases, merged-into.

### The header

- **Name** (large text): The person's primary name from the most recent assertion.
- **GCUID**: Below the name in smaller grey text. Click to copy to clipboard.
- **State badge**: Coloured chip — green (active), yellow (under_review), red (suspended), grey (retired/archived).
- **Action buttons**:
  - **Change state**: Move to a different state.
  - **Merge with…**: Merge with another identity.
  - **Export**: Download this identity's data as JSON or CSV.
  - **View audit log**: See all changes to this identity.

### The attributes zone

Grouped by source. Each source has its own collapsible section:

- **HR System**: Name, email, employee ID, department, title, hire date, status.
- **LDAP System**: cn, uid, mail, organizational unit, group memberships.
- **Engineering System**: Asset tag, model, assigned-to, status.
- **Finance System**: Cost center, finance code, last invoice date.

Each attribute shows:

- **Attribute name** (left): Canonical name (e.g. "person.email").
- **Value** (right): The current value (most recent assertion).
- **Source** (small icon): Which source asserted this.
- **Last updated** (tooltip on hover): When the value was last changed.

Click any attribute to see its **history** — every assertion ever made, with timestamps.

### The history zone

A chronological list of all changes to this identity:

- **2026-10-01 14:23**: state changed from `provisional` → `active` by `admin@example.com`
- **2026-10-01 14:20**: attribute `person.email` changed to `alice@example.com` from `HR`
- **2026-09-30 09:15**: identity created by `connector-hr`

Each entry shows:

- **Timestamp**: ISO format.
- **Action**: What happened.
- **Actor**: Who did it (user or connector).
- **Detail**: Old value → new value (for state and attribute changes).

### The related identities zone

Shows identities that are linked to this one:

- **Duplicates**: Other identities that might be the same person. Click to review and merge.
- **Aliases**: Older GCUIDs that have been merged INTO this one. Read-only.
- **Merged into**: If this identity was merged into another, the survivor is shown here.

This zone is critical for understanding the **identity graph** — the network of related records.

### Editing attributes

GCUID is **read-mostly**. You cannot edit attributes directly from this page. To change an attribute:

1. **Change it in the source system** (HR, LDAP, etc.).
2. **Wait for the connector to sync** (every few minutes).
3. **Refresh this page** to see the new value.

If the connector hasn't synced, click **Force refresh** (if available) to trigger an immediate sync.

### Manually overriding an attribute

In rare cases, you may need to override an attribute (e.g. HR has the wrong department). The pattern:

1. Open the attribute's history.
2. Click **Override** (if your role allows it).
3. Enter the new value.
4. Provide a reason.
5. Click **Confirm**.

The override is recorded as a manual assertion, with your username and the reason. The next time the connector syncs, the override may be overwritten by the source's value. Override with care.

### Changing identity state

Click **Change state** in the header. The state-change dialog shows:

- **Current state**: e.g. `active`.
- **New state**: dropdown of allowed transitions.
- **Reason**: required text field for audit.

Allowed transitions depend on the current state. Common transitions:

- `provisional` → `active`, `archived`
- `active` → `under_review`, `suspended`, `retired`
- `under_review` → `active`, `suspended`, `retired`
- `suspended` → `active`, `retired`
- `retired` → `archived` (or back to `active` if reinstatement)
- `archived` → (terminal, no transitions allowed)

Forbidden transitions are greyed out in the dropdown.

### Merging identities

Click **Merge with…** to merge this identity with another. The merge flow:

1. Search for the target identity (the one to merge into this one).
2. Review the side-by-side comparison.
3. Choose which attribute wins for each conflict (or accept the system's recommendation).
4. Click **Confirm merge**.

After the merge:

- This identity becomes the survivor (the GCUID doesn't change).
- The target identity is marked `merged_into_<this-identity>`.
- Both identities' audit trails are preserved.

### Common profile-management questions

**Q: Why does the profile show different values for the same attribute from different sources?**
A: Each source has its own copy of the attribute. GCUID highlights the most recent assertion. If you want to see all values, click the attribute to view its history.

**Q: Can I delete this identity?**
A: You can change its state to `archived` (terminal). You cannot hard-delete it because the audit trail needs the history.

**Q: Why is the GCUID so long?**
A: 26 characters of Crockford Base32 — that's the format. It encodes a ULID underneath. See [Developer Guidebook §1.4](guidebook-developer.md#14-the-core-packages) for the algorithm.

**Q: Can I change the GCUID?**
A: No. The GCUID is a one-way hash; changing it would break every reference to this identity. If you need to "rename" an identity, create a new one and merge.

**Q: Why is the state `provisional`?**
A: A connector created the identity but no human has confirmed it yet. Change to `active` after review.

**Q: How do I see who changed what?**
A: Click **View audit log** in the header, or scroll to the history zone. Every change is recorded.

### See also

- §2.2 Task 2 — View a person's full profile
- §2.2 Task 5 — Change an identity's state
- §2.2 Task 4 — Resolve duplicate identities
- [Developer Guidebook §1.4 The core packages](guidebook-developer.md#14-the-core-packages) — GCUID format
- [Developer Guidebook §1.7 The connector system](guidebook-developer.md#17-the-connector-system-plan-b-b3) — read-mostly design

## 2.7 Frequently asked questions

This section is the **quick answers** for the most common end-user questions. If you have a question that's not here, check [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting) for operational issues, or [Developer Guidebook §1.12](guidebook-developer.md#112-testing-and-debugging) for deeper debugging.

### Getting started

**Q: How do I open the system?**
A: Open http://localhost:5181/ in your browser. If you see "connection refused", the system isn't running. See [SysAdmin Guidebook §3.3](guidebook-sysadmin.md#33-starting-and-stopping-the-stack).

**Q: Do I need to log in?**
A: In the POC, no. The POC is local-only and uses demo tokens. For production, you'd authenticate with your organization's SSO.

**Q: What's a GCUID?**
A: A unique identifier for a person. Format: `urn:gcuid:<26-char-crockford-base32>`. It doesn't change.

**Q: How is GCUID different from an employee ID?**
A: An employee ID is from HR. A GCUID is from GCUID. They're different things. An employee has at most one employee ID per HR system, and at most one GCUID (forever).

### Searching

**Q: Why don't I get any results for a known person?**
A: Either they're not in any source yet, or the connector hasn't synced. Check System → System to verify sources are healthy, then wait a few minutes.

**Q: Can I search by partial name?**
A: Yes. The search uses fuzzy matching. "Alise" matches "Alice".

**Q: Can I export search results?**
A: Yes. Click **Export** in the result list. Choose CSV (Excel-friendly) or JSON (script-friendly).

**Q: Why are there multiple results for the same person?**
A: They haven't been merged yet. See §2.2 Task 4 — Resolve duplicates.

### Sources

**Q: Why is a source showing red?**
A: The connector can't reach the source. The source process may have crashed, or there's a network issue. See [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting).

**Q: How often do sources sync?**
A: Every 5 minutes by default. Some sources sync on-demand (when you query them).

**Q: Can I add a new source?**
A: That's an admin task. See [Developer Guidebook §1.10](guidebook-developer.md#110-adding-a-new-connector-worked-example).

**Q: Why does GCUID show "Engineering" but LDAP shows "Engineering Services"?**
A: They have different values for the same attribute. GCUID highlights the most recent. The history view shows all values with timestamps.

### Identities

**Q: Why is the state `provisional`?**
A: A connector created the identity but no human has confirmed it yet. Change to `active` after review.

**Q: Can I delete an identity?**
A: You can change its state to `archived` (terminal). You cannot hard-delete because the audit trail needs the history.

**Q: How do I merge two identities?**
A: See §2.2 Task 4 — Resolve duplicate identities.

**Q: Can I edit an attribute directly?**
A: GCUID is read-mostly. Edit attributes in the source system (HR, LDAP, etc.), then wait for the sync.

**Q: Why does the GCUID look random?**
A: It encodes a ULID with a Crockford Base32 prefix. The randomness prevents collisions. See [Developer Guidebook §1.4](guidebook-developer.md#14-the-core-packages) for the algorithm.

### Performance

**Q: Why is search slow?**
A: The system uses SQLite, not Postgres. For 10,000+ identities, expect search to take 100-200ms. If you're seeing >1s, check the logs.

**Q: Why does the Web UI take a while to load?**
A: Vite dev server is slow on first load. After the initial load, navigation is fast (cached).

**Q: Can I make it faster?**
A: The POC is sized for development, not production. For production performance, see [Architect Guidebook §4.9](guidebook-architect.md#49-mapping-to-a-real-deployment).

### Errors

**Q: I got "401 Unauthorized" when trying to do X. What does that mean?**
A: Your session expired, or the system has auth issues. Reload the page. If the issue persists, see [SysAdmin Guidebook §3.5 Authentication tokens](guidebook-sysadmin.md#35-authentication-tokens).

**Q: I got "404 Not Found" when clicking a button.**
A: The button links to a route that doesn't exist. This is a bug — file an issue. (Or it may be a known issue from Phase 2 cleanup.)

**Q: I got "500 Internal Server Error".**
A: Something on the server crashed. Check the API logs at `staging/logs/api.log`. File an issue with the log excerpt.

**Q: The page shows a loading spinner forever.**
A: The API isn't responding. Check `curl http://localhost:5182/health`. If it doesn't return, the API isn't running.

### Data

**Q: Where does GCUID get its data?**
A: From the connected sources (HR, LDAP, Engineering, Finance). GCUID doesn't generate data; it mirrors it.

**Q: How fresh is the data?**
A: Depends on the source. Some sync every 5 minutes; some sync on-demand. Check "Last sync" on the source card.

**Q: Can I see what GCUID has stored?**
A: Yes. Use the API: `curl http://localhost:5182/api/identity/<gcuid>`. Or use SQLite directly: `sqlite3 staging/data/registry.db "SELECT * FROM identities;"`.

**Q: Where are my search queries logged?**
A: In `staging/data/logs.db`, in the `request_log` table. See [SysAdmin Guidebook §3.8 Logging and observability](guidebook-sysadmin.md#38-logging-and-observability).

### Privacy

**Q: What data does GCUID store about me?**
A: Whatever your source systems have. GCUID mirrors HR records (name, email, employee ID, etc.) but doesn't store anything of its own.

**Q: Can I see what GCUID has about me?**
A: Yes. Search for your own name and review your profile. Every attribute GCUID has should also be in one of your source systems.

**Q: Can I delete my data?**
A: In the POC, no. In production, you'd request deletion through your organization's privacy process.

**Q: Does GCUID share data with third parties?**
A: No. GCUID is local-only and doesn't make external calls.

### Where to get more help

- **Operational issues**: [SysAdmin Guidebook §3.9 Troubleshooting](guidebook-sysadmin.md#39-troubleshooting)
- **Setup issues**: [SysAdmin Guidebook §3.3 Starting and stopping the stack](guidebook-sysadmin.md#33-starting-and-stopping-the-stack)
- **Design rationale**: [Architect Guidebook §4.x](guidebook-architect.md)
- **How a feature is implemented**: [Developer Guidebook §1.x](guidebook-developer.md)
- **Test scenarios**: [§2.3 Full use-case catalog](#full-use-case-catalog-24-scenarios) (24 scenarios across 6 categories)
- **Bug reporting**: [Tester Guidebook §5.10 Bug-hunting methodology](guidebook-tester.md#510-bug-hunting-methodology)
