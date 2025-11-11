# Moderation Workflow & Compliance Design

## Objectives
- Equip subreddit moderators with streamlined tools to create, manage, and audit prediction markets.
- Ensure every privileged action is traceable with immutable audit records and supporting metadata.
- Provide safeguards against mistakes (confirmation dialogs, dual controls for sensitive operations) and pathways to resolve disputes (voiding, balance adjustments).
- Maintain compliance with Reddit policies and community expectations by logging, exposing settings, and enabling exports if required.

## Moderator Personas & Use Cases
- **Lead Moderator**: Oversees market pipeline, configures app defaults, resolves high-profile markets, handles disputes.
- **Event Moderator**: Focuses on day-to-day market creation and resolution during live streams/events.
- **Audit Moderator**: Reviews historical actions, handles user complaints, ensures fairness.

## Privileged Actions & UI Placement
| Action | UI Entry Point | Server Endpoint | Notes |
|--------|----------------|-----------------|-------|
| Create draft market | Admin Console → "Create Market" form | `POST /internal/markets` | Requires title, description, close time; optional tags. |
| Publish market | Draft row actions; Market detail mod toolbar | `POST /internal/markets/:id/publish` | Confirmation modal showing summary and close schedule. |
| Update market metadata | Draft + open markets (limited fields) | `POST /internal/markets/:id/update` | Edits limited to description/close time before first bet. |
| Close market early | Admin Console / Market detail | `POST /internal/markets/:id/close` | Requires reason text; cancels scheduled auto-close. |
| Resolve market | Admin Console / Market detail | `POST /internal/markets/:id/resolve` | Requires outcome (yes/no), optional resolution notes. |
| Void market | Admin Console / Market detail | `POST /internal/markets/:id/void` | Requires detailed reason; warns about refunds. |
| Archive settled markets | Admin Console → Maintenance tools | `POST /internal/markets/archive` | Supports dry-run or destructive pruning of aged resolved/void markets using lifecycle metadata. |
| Adjust user balance | Admin Console "Manual Adjustments" panel | `POST /internal/users/:id/adjust-balance` | Dual confirmation (second moderator or typed confirmation). |
| Reopen market (optional) | Not in Phase 1 (deferred) | – | Would require additional policy review. |
| Modify config | Phase 2 (read-only now) | – | Form to edit starting balance etc. |

## Moderator Console Structure
- **Overview Tab**
  - Summary metrics: number of open/draft/closed markets, total outstanding volume.
  - Quick links to action queues.
- **Markets Tab**
  - Sections for Drafts, Open, Closed (awaiting resolution).
  - Table columns: Title, Status, Bets placed, Pot total, Closes at (countdown), Assigned mod (optional future).
  - Row actions with icon buttons (Publish, Close, Resolve, Void, Edit). Disabled based on status.
- **Resolution Queue**
  - Filtered list of closed markets pending resolution > X hours; highlighted in red.
  - Bulk actions not allowed (require per-market confirmation).
- **Manual Overrides**
  - Balance adjustment form: search user by username (auto-complete hitting `/api/users/search` if built later).
  - Adjustment requires reason dropdown + free-text memo. Display disclaimers.
  - Show recent manual adjustments in table for transparency.
- **Audit Log**
  - Paginated view of recent moderator actions (fetched via `/internal/audit/logs`).
  - Columns: Timestamp, Moderator, Action, Target, Notes, Correlation ID.
  - Export button (CSV download) limited to first N entries due to Devvit constraints (generate CSV client-side from fetched data).
- **Settings (Read-only for Phase 1)**
  - Display current `startingBalance`, `minBet`, `maxBet`, etc.
  - Provide link/instructions for request to change (until UI editing implemented).

## Lifecycle Metadata & Workflow Automation
- Persisted metadata fields (`publishedBy`, `lastPublishedAt`, `autoCloseOverrideMinutes`, `closedBy`, `lastClosedAt`, `autoClosedByScheduler`, `lastAutoClosedAt`) power the moderator console and upcoming automation.
- UI treatment:
  - Draft grid shows `lastPublishedAt` when re-publishing attempts occur and surfaces override state (“Auto-close disabled”).
  - Open market table highlights rows with `autoClosedByScheduler === true` in the last 24 hours to signal follow-up for resolution.
- Scheduler callbacks stamp `autoClosedByScheduler` and `lastAutoClosedAt`; the console will display a “Auto closed” badge and automatically move items into the resolution queue.
- Metadata feeds notification logic: if `lastClosedAt` exceeds configurable SLA without resolution, surface an `Overdue` badge and optionally send modmail in future phase.
- For archival planning, capture `lastSettledAt` plus lifecycle timestamps to determine when markets can be pruned (e.g., delete bets N days after `lastSettledAt` and `lastAutoClosedAt`). Metadata enables tiered retention policies (recent vs. aged markets) without scanning bets.
- All lifecycle mutations append an entry to the audit log referencing these metadata fields so moderators can reconstruct timelines quickly.

## Confirmation & Safeguards
- All destructive operations (close, resolve, void, adjust balance) require confirmation dialog with summary of consequences.
- Double confirmation for manual balance adjust: 
  1. Standard modal collecting amount/reason.
  2. Secondary prompt requiring `type CONFIRM` or entering moderator username.
- Display warnings if market has large pot (e.g., > threshold) before resolution/void.
- On resolution, show computed payouts preview (top 3 winners) to reassure moderator before submitting.
- Lock UI button while request pending to prevent duplicate submissions.

## Audit Logging Strategy
- For each privileged endpoint:
  1. Record `ModeratorAction` entry via persistence layer containing:
     - `actionId` (ULID)
     - `performedBy` (mod Reddit ID, username)
     - `action` (enum: `CREATE_MARKET`, `PUBLISH_MARKET`, `CLOSE_MARKET`, `RESOLVE_MARKET`, `VOID_MARKET`, `ADJUST_BALANCE`, `UPDATE_MARKET`)
     - `targetId` (marketId, userId)
     - `payload` (JSON of request body + key derived data, sanitized for PII)
     - `before`/`after` snapshots for relevant entities when feasible (e.g., market status) – stored as JSON strings, truncated if large.
     - `timestamp`
     - `correlationId`
  2. Push actionId onto `audit:actions` list for chronological retrieval.

- Provide API to fetch audit entries with pagination and optional filters (by moderator, action type, market).
- Consider TTL or size limit for payload fields to stay within Redis quota (e.g., limit snapshot length to 4 KB).

## Notifications & Escalations
- Show toast messages for moderators after performing actions (success/failure).
- Optional future enhancement: send modmail when markets remain unresolved > threshold (requires Reddit API allow-list and compliance review).
- Provide `Overdue` badge in UI to surface priority items.

## Compliance Considerations
- Ensure every market has human moderator involvement for resolution; no auto-resolve without mod confirmation.
- Provide transparency to participants: expose resolution notes and moderator username in market detail once resolved.
- Maintain rolling audit log accessible to full mod team.
- Balance adjustments must include reason codes (enum): `DISPUTE_REFUND`, `BUG_FIX`, `MOD_REWARD`, `OTHER`. These help with later compliance reporting.
- For exports: allow moderators to click `Download CSV` (client generates from fetched audit entries). Limit to e.g., last 1000 rows per download to stay within memory/time constraints.

## Error Handling & Recovery
- Moderator UI should display descriptive errors (including server error codes) with next steps (e.g., "Market already resolved by another mod" → prompt to refresh).
- If settlement fails mid-process (server marks `pendingSettlement`), UI should surface warning and provide retry button (calls dedicated endpoint to resume settlement).
- Provide fallback contact instructions if manual override fails (e.g., instruct to contact Devvit support or admin).

## Permissions & Access Control
- Server verifies `context.user.isModerator` for all `/internal/*` routes.
- Optionally maintain allow-list of supermods for sensitive operations (balance adjustments) in config (Phase 1: require `isModerator`).
- Client hides admin console routes for non-mods; server still enforces.
- Consider storing mod action rate limiting per moderator to prevent abuse (e.g., max adjustments per hour). Implement simple counter in Redis if needed.

## Usability Enhancements
- Provide search/filter within admin tables (by market title, status).
- Display relative times ("closes in 45m") with tooltip showing exact timestamp.
- For create market, allow duplicates detection by offering suggestions if title similar to existing one.
- Provide context hints (hover tooltips) explaining outcomes: e.g., "Resolving as YES will pay 1.8× to 54 bettors".

## Testing Plan
- Unit tests for moderator components (forms, dialogs) verifying validation and API invocation.
- Integration tests simulating mod flows: create → publish → close → resolve; void scenario; balance adjustment.
- Tests verifying audit log entries created per action (via mocked repository in server tests).
- Manual QA in staging subreddit with multiple moderator accounts to ensure concurrency handling (one mod resolves while another attempts same action).

## Risks & Mitigations
- **Concurrent moderator actions**: Use server-side locking to prevent double resolution; UI should show action already taken.
- **Human error**: Double confirmation + preview reduces misclick risk; audit logs enable rollback via manual adjustments if necessary.
- **Audit data volume**: Implement trimming/archival policy; provide export before delete.
- **Sensitive data exposure**: Ensure audit payloads redact user notes containing PII; limit to necessary fields.
- **Moderator turnover**: Provide documentation/training within console (link to help page) to onboard new mods.

## Deliverables
- Admin console screens defined in client design wired to moderator workflows.
- Server endpoints enforcing moderator checks and writing audit logs.
- Persistence keys for `ModeratorAction` implemented.
- Tests verifying audit trail integrity and moderator flows.

## Implementation Progress (Nov 11, 2025)
- ✅ Moderator lifecycle console covers publish, close, resolve, and void flows with UI wiring to the refreshed API layer.
- ✅ Archive maintenance endpoint is live server-side with schema validation and controller tests, paving the way for console tooling.
- 🔄 Next up: expose archival controls and dry-run reporting in the moderator console and broaden audit log surfacing for maintenance actions.
