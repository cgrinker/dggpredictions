# Outstanding Design Follow-Ups

Tracked from the latest review of the design documents (2025-11-11).

## High-Level Design
- [ ] Build observability/admin console tooling (metrics dashboards, scheduler views, archival maintenance UI).
	- [ ] Surface scheduler queue + auto-close outcomes in moderator console overview.
	- [ ] Expose key health metrics (markets open, unsettled, total wagers) via lightweight API.
- [ ] Design and implement nightly export/reporting pipelines once platform approvals land.
	- [ ] Draft allow-list request + backup strategy (CSV download fallback) for compliance review.

## Client UX Design
- [ ] Add moderator-facing archival controls and configuration editing panels into the console.
	- [ ] Maintenance tab with archive dry-run + execute actions.
	- [ ] Read/write config editor gated by feature flag.
- [ ] Flesh out observability affordances on the client (metrics/incident surfacing).
	- [ ] Metrics widget fed from `/internal/metrics/summary`.
	- [ ] Incident banner component pulling from new incident endpoint.
- [ ] Plan and scope longer-term UX enhancements (post-MVP): realtime odds updates, resolution notifications, localization, dark-mode parity.

## Server & API Design
- [ ] Surface archive maintenance workflows in the moderator console and expose dry-run reporting endpoints.
	- [ ] `/internal/markets/archive` enhancements: dry-run summary payload, pagination of affected markets.
	- [ ] Metrics endpoint publishing archive stats + Redis usage snapshot.
- [ ] Expand audit and metrics coverage around archival operations and advanced moderator tooling.
	- [ ] Record moderator + auto archive actions in audit log with before/after metadata.
- [ ] Continue hardening moderator workflow endpoints; close open questions around alternative APIs (GraphQL) and live update strategies (track as post-MVP investigation).

## Persistence & Data Integrity Design
- [ ] Automate retention schedules and pruning jobs; report key archival metrics back to moderators.
	- [ ] Scheduler job to prune resolved markets older than N days.
	- [ ] Redis usage monitor stored under `metrics:storage`.
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
