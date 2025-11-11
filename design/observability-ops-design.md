# Observability, Operations & Testing Strategy

## Objectives
- Provide visibility into application health, performance, and user activity within Devvit platform constraints.
- Establish operational playbooks for incident response, data retention, and configuration changes.
- Define automated and manual testing strategies ensuring quality across client, server, and persistence layers.
- Plan deployment workflow for staging and production subreddits with rollback procedures.

## Telemetry & Logging
### Structured Logging
- Use centralized logger (`src/server/logging.ts`) adding correlation ID, user ID (where applicable), subreddit ID, request path, and severity level.
- Log categories:
  - `event.market.created`, `event.market.resolved`, `event.market.voided`
  - `event.bet.placed`, `event.bet.rejected`
  - `event.balance.adjusted`
  - `scheduler.job.scheduled`, `scheduler.job.executed`, `scheduler.job.failed`
  - `error.transaction.retry`, `error.transaction.failed`
- Log payloads kept small (<= 2 KB) to avoid console truncation; include key identifiers (marketId, userId) not full objects.
- Use `console.info` for normal events, `console.warn` for anomalies, `console.error` for failures. Devvit log streaming (via CLI) can filter by severity.

### Metrics (via Redis counters)
- Increment counters on key events; stored under `metrics:<name>` (e.g., `metrics:marketsCreated`, `metrics:betsPlaced`, `metrics:settlementFailures`).
- Maintain per-period metrics using sorted sets or hashes for quick reporting (e.g., `metrics:daily:YYYY-MM-DD`).
- Provide `/internal/metrics/summary` endpoint (mods only) returning current counts for dashboard view in admin console.
- Consider storing historical aggregates weekly/monthly to avoid unbounded growth.

### Alerts & Anomaly Detection
- Daily scheduled job `scheduler.job.metrics-report` to assess metrics and push summary to mod console (or optionally log to modmail in future).
- Flag conditions triggering alert log entries:
  - Settlement failure or retry > N times.
  - Redis storage usage approaching quota (if API available; otherwise track key counts/payload sizes heuristically).
  - Sudden spike in bets (potential abuse) – compare to rolling average, log `warn`.

## Operational Playbooks
### Deployment Workflow
1. Develop locally using Playtest or staging subreddit `r/DestinyDev`.
2. Run automated test suite (`npm test`).
3. Use Devvit CLI to deploy to staging installation, run smoke tests (market lifecycle, bet, resolution).
4. Obtain moderator sign-off.
5. Deploy to production subreddit via CLI `devvit deploy`. Keep prior version accessible for rollback.
6. After deploy, monitor logs for 1 hour for anomalies.

### Rollback Procedure
- If critical issue arises, rollback using Devvit CLI to previous app version (`devvit deploy --version <previous>` or via Devvit dashboard).
- Disable market creation temporarily via feature flag in Devvit Settings if needed.
- Communicate with moderators via mod console banner (set feature flag `maintenanceMode` to display message).

### Configuration Changes
- Config values stored in Devvit Settings; modifications by lead moderators only (policy). Until UI implemented, changes done via Devvit console or `devvit settings set` CLI.
- After config change, server caches new values within 5 minutes; provide manual `Refresh` button in admin console to invalidate cache immediately.
- Log config changes via audit log (if we expose endpoint for updates; for now maintain manual change log).

### Data Retention & Pruning (Ops)
- Monthly maintenance job to evaluate Redis usage:
  - Trim `audit:actions` list to last ~10k entries after ensuring export.
  - Archive resolved markets older than configurable window by summarizing (store aggregated stats, delete per-bet hashes). Provide mod action to trigger manually.
- Ensure backup/export policy: moderators can download audit log and resolved market summaries regularly for offline storage.

## Testing Strategy
### Automated Tests
- **Unit tests (Jest)**
  - Repositories: simulate Redis interactions using in-memory mocks or Devvit-provided test harness.
  - Services: confirm business logic (e.g., bet placement validations, settlement calculations).
  - Client components: use React Testing Library to ensure forms validate and render state correctly.

- **Integration tests**
  - Use Devvit Playtest environment to run end-to-end flows against actual runtime.
  - Scenario coverage: market lifecycle, bet conflict (double bet), resolution payouts, void refunds, scheduler auto-close.
  - Consider building scriptable test harness using CLI to create markets and assert responses.

- **Contract tests**
  - Ensure `src/shared/types` align with server DTOs by generating runtime validation or using TypeScript project references.
  - Validate Zod schemas for server requests/responses.

- **Performance tests**
  - Simulate high bet volume (via script calling API) to ensure transaction retry rate acceptable and no rate limits triggered.
  - Measure settlement time for large markets; ensure processing stays within scheduler job limits.

### Manual QA Checklists
- Pre-release manual smoke test:
  1. Create draft market, publish, place bets from two test accounts, close, resolve yes.
  2. Void a market and confirm refunds.
  3. Adjust balance manually; verify ledger entry.
  4. Leaderboard update after payouts.
  5. Scheduler auto-close triggers as expected (simulate by setting close time near future).
- Regression checklist maintained in `docs/testing-checklist.md` (to create later) for consistent QA before deployments.

## Monitoring Dashboard (Admin Console)
- Provide `Metrics` tab summarizing counters (markets open, total points wagered, outstanding payouts).
- Display scheduler job status by calling `/internal/scheduler/list` (limit fields to avoid overloading UI).
- Show health indicators: `Last settlement success`, `Pending settlements`, `Redis key count` (if accessible).
- For anomalies (recent errors), display alert banner with link to logs.

## Incident Response
- When severe error logged (`error.transaction.failed`, `error.scheduler.failed`), system should:
  - Persist incident record in Redis (`incidents:<id>` with details).
  - Highlight incident in admin console (requires UI component).
  - Provide `Retry` button for certain incidents (e.g., settlement) invoking dedicated endpoint.
- Document runbook detailing steps to investigate (check logs, inspect redis keys, contact Devvit support if platform issue).

## Security & Compliance Ops
- Periodically audit moderator access: list actions per moderator and confirm membership. Provide script/endpoint to compile usage stats.
- Ensure secrets (if added later) managed via Devvit Secrets store; restrict to necessary scope.
- Confirm adherence to Reddit ToS: no off-platform data sharing without consent; feature flags to disable markets quickly if policy changes.

## Future Enhancements
- Integrate with external monitoring (if Devvit exposes webhooks/log streaming) to forward logs to third-party analytics.
- Build anomaly detection ML/heuristics (out of scope now).
- Automate release notes generation from audit log of deployments.

## Implementation Progress (Nov 11, 2025)
- ✅ Structured logging, error handling, and correlation-aware responses are live in the server bundle and covered by unit tests.
- ✅ Scheduler service tests exercise job scheduling/cancellation logging to confirm telemetry hooks function.
- 🔄 Metrics counters, incident surfacing in the moderator console, and automated operational runbooks remain on the roadmap.
- 🔄 Deployment/staging automation and regression checklists need codifying before broader rollout.
