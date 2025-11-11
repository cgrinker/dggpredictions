# Current Project Status (2025-11-10)

- Scheduler-aware publish/close flows are implemented in `src/server/services/markets.service.ts`, including auto-close job scheduling with override support.
- Lifecycle unit coverage lives in `src/server/services/__tests__/markets.service.test.ts`; all lint and Vitest suites pass (`npm run lint`, `npx vitest run`).
- Next immediate work: expose publish/close actions via controllers/routes and wire scheduler callbacks for automatic market closures; follow-on tasks include archival policies, moderator workflow, and observability.
