# Moderator Workflow API Hardening & Post-MVP Exploration

_Last updated: 2025-11-12_

## Current State
- Moderator endpoints remain REST-based (Express) and are now covered by validation schemas in `src/shared/schema/*.ts`.
- Archival workflows log detailed audit entries (`ARCHIVE_MARKETS`) including before/after snapshots and system fallbacks.
- Metrics and incident reporting endpoints back the moderator console widgets.
- Scheduler prune job available via `/internal/scheduler/market-prune`, removing aged archived markets and logging `PRUNE_MARKETS` actions.
- Moderator console adds purge confirmation modal, targeted audit filters (retention, config, resolutions), and logs `CONFIG_UPDATE` actions.

## Hardening Checklist
- [x] Enforce request validation for all moderator write endpoints (publish, close, resolve, void, archive).
- [x] Capture moderator identity (ID + username) on archival mutations for traceability.
- [ ] Add integration smoke tests hitting the Express router with auth middlewares once staging infra is ready.
- [ ] Introduce rate limiting / abuse protection for sensitive endpoints (`/internal/markets/archive`, balance adjustments).

## Alternative API Options (Post-MVP)

### GraphQL Gateway
- **Pros**: Strong typing across client/server, built-in introspection, flexible moderation dashboard queries.
- **Cons**: Requires new auth gateway, schema federation with existing REST, time-intensive migration of current clients.
- **Decision**: Defer until after MVP launch; revisit when realtime dashboards become a priority.

### Live Update Strategies
- **Server-Sent Events (SSE)**: Lightweight for broadcasting market lifecycle changes; works with existing Redis pub/sub.
- **WebSockets**: Suitable for bidirectional moderator tools (e.g., real-time settlement coordination) but adds connection management overhead.
- **Polling Enhancements**: Short-term fallback; increase cache headers + ETag handling to minimize payload size.
- **Decision**: Prototype SSE channel post-MVP for market lifecycle notifications; keep WebSockets in backlog pending scale tests.

## Next Steps
1. Ship moderator auth middleware updates to surface usernames consistently (in progress).
2. Draft staging checklist covering the remaining hardening bullets above.
3. Re-evaluate GraphQL/SSE during the operations stabilization milestone (target: Q1 2026).
