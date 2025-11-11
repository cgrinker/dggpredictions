# Current Project Status (2025-11-11)

- Market publish/close flows now drive scheduler jobs end-to-end via `src/server/services/markets.service.ts`, including automatic closures with metadata cleanup.
- Moderator endpoints live in `src/server/controllers/markets.controller.ts` for publish/close actions, and `/internal/scheduler/market-close` handles Devvit scheduler callbacks.
- Admin lifecycle console added in `src/client/components/MarketLifecyclePanel.tsx`, wiring the new endpoints into the client UI with publish/close actions and basic feedback states.
- Lifecycle coverage expanded in `src/server/services/__tests__/markets.service.test.ts`; lint and Vitest remain green (`npm run lint`, `npx vitest run`).
- Next immediate work: design and implement archival policies plus richer moderator workflow tooling around the new metadata, then broaden observability hooks.
