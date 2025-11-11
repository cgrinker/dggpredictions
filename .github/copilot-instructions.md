# Current Project Status (2025-11-11)

- Market publish/close flows now drive scheduler jobs end-to-end via `src/server/services/markets.service.ts`, including automatic closures with metadata cleanup.
- Moderator endpoints live in `src/server/controllers/markets.controller.ts` for publish/close actions, and `/internal/scheduler/market-close` handles Devvit scheduler callbacks.
- Lifecycle coverage expanded in `src/server/services/__tests__/markets.service.test.ts`; lint and Vitest remain green (`npm run lint`, `npx vitest run`).
- Next immediate work: surface lifecycle controls in client/admin UI, add archival policies, flesh out moderator workflow tooling, and deepen observability hooks.
