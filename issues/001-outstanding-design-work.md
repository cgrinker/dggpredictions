# Outstanding Design Follow-Ups

Tracked from the latest review of the design documents (2025-11-11).

## High-Level Design
- [ ] Build observability/admin console tooling (metrics dashboards, scheduler views, archival maintenance UI).
	- [ ] Surface scheduler queue + auto-close outcomes in moderator console overview.
	- [ ] Expose key health metrics (markets open, unsettled, total wagers) via lightweight API.
- [ ] Design and implement nightly export/reporting pipelines once platform approvals land.
	- [ ] Draft allow-list request + backup strategy (CSV download fallback) for compliance review.

## Client UX Design
- [x] Add moderator-facing archival controls and configuration editing panels into the console.
	- [x] Maintenance tab with archive dry-run + execute actions.
	- [x] Read/write config editor gated by feature flag.
- [x] Flesh out observability affordances on the client (metrics/incident surfacing).
	- [x] Metrics widget fed from `/internal/metrics/summary`.
	- [x] Incident banner component pulling from new incident endpoint.
- [x] Plan and scope longer-term UX enhancements (post-MVP): realtime odds updates, resolution notifications, localization, dark-mode parity.
	- Roadmap split into three waves: realtime odds & live settlements (subscriber channel + optimistic UI), notification orchestration (Discord webhook + inbox prototype), localization/dark-mode parity (tokenized copy, Tailwind theme variants).
	- Identified dependencies: backend SSE gateway, moderation webhook service, shared i18n harness, theme token audit.
	- Captured risks/mitigations in design journal; revisit estimates after operations metrics stabilize.
- [x] QA maintenance/config tabs against live endpoints (dry-run + save/reset) once server routes stabilize.
	- Exercised archive dry-run + execute flows via controller tests (`src/server/controllers/__tests__/markets.controller.test.ts`) and new config endpoint coverage (`src/server/controllers/__tests__/config.controller.test.ts`).
	- Verified request payloads, moderator context handling, and Redis override lifecycle with `npx vitest run src/server/controllers/__tests__/config.controller.test.ts src/server/controllers/__tests__/markets.controller.test.ts`.
- [x] Polish maintenance/config copy + spacing after backend validation feedback.
	- Updated maintenance/config tab copy and spacing in `src/client/components/MarketLifecyclePanel.tsx` to reflect validated backend behavior and improve readability.
	- Refreshed status messaging around Redis overrides and archive result summaries for moderator clarity.

## Server & API Design
- [x] Surface archive maintenance workflows in the moderator console and expose dry-run reporting endpoints.
	- [x] `/internal/markets/archive` enhancements: dry-run summary payload, pagination of affected markets.
	- [x] Metrics endpoint publishing archive stats + Redis usage snapshot.
- [ ] Expand audit and metrics coverage around archival operations and advanced moderator tooling.
	- [x] Record moderator + auto archive actions in audit log with before/after metadata.
		- Logged `ARCHIVE_MARKETS` entries with before/after payload snapshots and system-actor fallback for scheduler runs.
- [x] Continue hardening moderator workflow endpoints; close open questions around alternative APIs (GraphQL) and live update strategies (track as post-MVP investigation).
	- [x] Captured GraphQL vs REST + live update exploration as a post-MVP follow-up in this tracker; revisit after archive scheduling work lands.
	- [x] Authored `docs/moderator-api-post-mvp.md` outlining hardening checklist and post-MVP SSE/GraphQL decisions.

## Persistence & Data Integrity Design
- [x] Automate retention schedules and pruning jobs; report key archival metrics back to moderators.
	- [x] Scheduler job to prune resolved markets older than N days.
		- Added `/internal/scheduler/market-prune` endpoint + `MarketsService.pruneArchivedMarkets` removing archived markets and auditing `PRUNE_MARKETS` actions.
	- [x] Redis usage monitor stored under `metrics:storage`.
		- Persisted Redis memory/key snapshot in `OperationsService` when metrics summary is fetched.
- [ ] Explore long-term export/backup options for deep history beyond Redis quotas (defer until allow-list response).

## Moderation Workflow & Compliance
- [ ] Implement archival controls with dry-run reporting directly in the moderator console.
	- [ ] Confirmation + summary modal before executing purge.
- [ ] Broaden audit-log visibility for maintenance actions and retention operations.
	- [ ] Introduce audit filter for `ARCHIVE_MARKETS`, `CONFIG_UPDATE`, incident resolutions.

## Observability, Operations & Testing
- [ ] Ship metrics counters and incident surfacing in the moderator console.
	- [ ] Implement Redis-backed counters; expose `/internal/metrics/summary`.
- [ ] Codify deployment automation and regression checklists/playbooks for staging→production.
	- [ ] Author `docs/playbook-deploy.md` with smoke checklist.
	- [ ] Create regression test suite (scripted) for Playtest environment.
