# Server & API Design

## Objectives
- Provide a well-structured Devvit Web server bundle that exposes internal REST-like endpoints for the client UI and scheduler tasks.
- Enforce authorization (moderator vs participant) and business invariants before invoking persistence operations.
- Coordinate with the persistence layer to execute transactions safely, returning typed responses and actionable errors to the client.
- Surface metrics, logging, and audit hooks for observability and compliance.
- Keep within Devvit platform constraints (registered routes, `/internal` namespace for privileged handlers, rate limits).

## Server Architecture Overview
```
src/server/
├─ index.ts            // Entry point registering routes and tasks
├─ router.ts           // Express-like router factory (Devvit Web)
├─ context.ts          // Request context enrichment (user, subreddit, config cache)
├─ middleware/
│   ├─ auth.ts         // Moderator/participant checks
│   ├─ validation.ts   // Zod schema validation for request bodies/params
│   └─ tracing.ts      // Correlation ID propagation & logging helpers
├─ controllers/
│   ├─ markets.controller.ts
│   ├─ bets.controller.ts
│   ├─ users.controller.ts
│   ├─ leaderboards.controller.ts
│   └─ scheduler.controller.ts
├─ services/
│   ├─ markets.service.ts
│   ├─ bets.service.ts
│   ├─ ledger.service.ts
│   ├─ config.service.ts
│   ├─ auth.service.ts
│   └─ scheduler.service.ts
├─ repositories/       // Implements persistence design (Redis interactions)
│   └─ ...
├─ dto/                // Request/response DTOs shared with client (mirrors src/shared)
│   └─ ...
├─ errors.ts           // Error classes (NotFound, Forbidden, ValidationError, Conflict)
└─ logging.ts          // Structured logger wired to Devvit console
```

The server entry point configures:
- Route registration using Devvit Web router.
- Scheduler task handlers (registered under `/internal/scheduler/*`).
- Global middleware: tracing → context hydration → route-specific validation/auth.

## Route Catalog & Contracts
> All routes respond with JSON. Success payloads wrap data using `{ data, meta? }`; errors standardize `{ error: { code, message, details? } }`.

### Public (participant) routes
| Method & Path | Purpose | Auth | Request Body | Response |
|---------------|---------|------|--------------|----------|
| `GET /api/markets` | List markets filtered by status, with pagination | Logged-in subreddit member | Query: `status=open|closed|resolved`, `page`, `pageSize` | `MarketSummary[]`, paging meta |
| `GET /api/markets/:id` | Fetch full market detail incl. odds, user’s bet | Member | Params: `marketId` | `MarketDetail` |
| `POST /api/markets/:id/bets` | Place wager on market | Member | Body: `{ side: 'yes'|'no', wager: number }` validated vs config | `{ bet, balance, market }` |
| `GET /api/users/me/balance` | Retrieve wallet state | Member | – | `{ balance, lifetimeEarned, lifetimeLost, activeBets }` |
| `GET /api/users/me/bets` | List bets filtered by `active`/`settled` | Member | Query: `status` | `BetSummary[]` |
| `GET /api/leaderboard` | Fetch leaderboard for window | Member | Query: `window=weekly|monthly|alltime` | `{ entries: LeaderboardEntry[], asOf }` |

### Moderator routes (require mod role)
| Method & Path | Purpose | Request Body | Notes |
|---------------|---------|--------------|-------|
| `POST /internal/markets` | Create draft market | `{ title, description, closesAt, options? }` | Responds with draft market |
| `POST /internal/markets/:id/publish` | Publish draft market | optional `{ autoCloseOverride? }` | Schedules close job |
| `POST /internal/markets/:id/update` | Update open market metadata (title, close time) | Partial updates validated for state | For record changes prior to close |
| `POST /internal/markets/:id/close` | Manually close market | – | Cancels existing close job if any |
| `POST /internal/markets/:id/resolve` | Resolve market with outcome | `{ resolution: 'yes'|'no', notes? }` | Triggers payouts |
| `POST /internal/markets/:id/void` | Void market | `{ reason }` | Initiates refunds |
| `POST /internal/users/:id/adjust-balance` | Manual corrections | `{ delta, reason }` | Creates audit log |
| `GET /internal/audit/logs` | Fetch recent moderator actions | Query `limit` | For audit UI |

### Scheduler endpoints (invoked by platform)
- `POST /internal/scheduler/market-close`: Body includes `{ subredditId, marketId }`; verifies market state then calls service to close & cleanup job record.
- `POST /internal/scheduler/leaderboard-rollover`: Runs weekly/monthly maintenance.
- Additional tasks (overdue resolution reminders) share `/internal/scheduler/*` namespace.

Scheduler handlers require shared secret? Not necessary; accessible only by Devvit runtime. Still keep them under `/internal` to avoid client invocation.

## Middleware & Request Lifecycle
1. **Tracing**: Assign correlation ID (UUID v4) per request; add to console logs + response headers.
2. **Context hydration**: Enrich request with Devvit-provided metadata (userId, username, subredditId, mod status) via `@devvit/web/server` API. Fetch config cache (from Redis or Devvit Settings) and attach.
3. **Auth check**: For moderator routes, ensure `isModerator === true`. For participant routes, ensure user is logged in and member of subreddit (if membership info available) else allow but degrade features.
4. **Validation**: Use Zod schemas matched to DTO definitions; respond with 400 upon failure.
5. **Controller**: Invoke corresponding service method.
6. **Service**: Coordinate with repositories; handle domain logic; convert domain errors to typed errors.
7. **Error handling**: Global handler maps domain errors to HTTP codes and response format; logs with correlation ID.

## Services Responsibilities
- **MarketsService**
  - `listMarkets(filter, pagination)` → uses repository to fetch sorted set and hydrates market summaries.
  - `getMarketDetail(id, userId)` → loads market and optional user bet; enrich with odds.
  - `createDraft(payload, context)` → validates schedule (closesAt > now + min lead), ensures max open markets limit.
  - `publishMarket(id, context)` → ensures state `draft`, schedules close job via `SchedulerService`, updates status and audit log, allowing optional override to disable or adjust auto-close window.
  - `closeMarket(id, source)` → ensures state `open`, updates to `closed`, cancels pending close job, and records moderator metadata.
  - `autoCloseMarket(subredditId, id)` → invoked by scheduler callback to close open markets, cleanup job persistence, and annotate metadata for later auditing.
  - `resolveMarket(id, outcome, context)` → obtains lock, delegates settlement to `LedgerService`, updates audit log.
  - `voidMarket(id, reason, context)` → triggers refund flow.
  - `updateMarketMetadata(id, patch)` → only allowed fields; ensures no bets yet if certain fields change.

- **BetsService**
  - `placeBet(marketId, userId, side, wager, config)` → orchestrates validation and calls repository transaction.
  - `listUserBets(userId, status)`.

- **LedgerService**
  - Encapsulates payout/refund/adjustment flows; ensures atomic operations per persistence design.

- **ConfigService**
  - `getConfig(subredditId)` (with Redis cache); `updateConfig` (if we expose UI later).

- **AuthService**
  - Helper to verify mod rights, maybe check allow-list of supermods for advanced actions.

- **SchedulerService**
  - Wraps Devvit `scheduler.runJob`, `cancelJob`, `listJobs` with error handling. Stores job IDs via persistence repository.

## Error Model
- `ValidationError` (400) – request schema violation / business rule failure (e.g., bet below min).
- `ForbiddenError` (403) – insufficient permissions.
- `NotFoundError` (404) – missing market/bet.
- `ConflictError` (409) – state transition invalid (e.g., publish closed market).
- `RateLimitError` (429) – if we add per-user throttling.
- `InternalError` (500) – unexpected failures; log stack + correlation ID, return generic message.

Errors raised by services should include machine-readable `code` (e.g., `MARKET_NOT_OPEN`) so client UX can tailor messaging.

## Logging & Metrics
- Inject `logger` (wrapping `console.log`) that prefixes logs with `[{level}] [corrId] [module] message`.
- Log key events: market state changes, bet placement success/failure, scheduler job scheduling/cancellation, transaction retries.
- Maintain simple metrics counters in Redis (e.g., `metrics:betPlacements`) updated asynchronously to avoid affecting request latency.
- Optionally emit structured JSON logs for easier parsing in future ingestion.

## Security Considerations
- All privileged routes under `/internal/...` even if invoked by mod UI to signal higher trust; client fetch helper must include sanity checks to prevent general users from invoking them (mod UI gated by mod role in client state).
- Server still verifies mod status server-side; never rely solely on client gating.
- Use config-defined wager limits; guard against negative wagers or out-of-range floats.
- Ensure scheduler endpoints verify authenticity via context (they run inside Devvit runtime; still validate payload structure to avoid misuse if inadvertently exposed).

## Testing Plan
- **Unit tests** for services with mocked repositories (validate business logic, error mappings).
- **Integration tests** using Devvit Web test harness (or local Playtest) hitting registered endpoints with fake context to ensure middleware + controllers interplay correctly.
- **Contract tests** verifying DTOs align with `src/shared/types` – possibly generate types from shared package to avoid drift.
- **Scheduler tests** verifying job creation/cancellation sequences and auto-close logic (simulate time-based triggers).
- **Negative tests** for authorization (non-mod hitting mod routes), invalid wagers, double resolution attempts.

## Open Questions
- Should we expose GraphQL-like aggregator endpoint, or keep REST? (Current plan: REST via fetch helpers.)
- How aggressively should we trim historical responses (e.g., `GET /markets` default to open markets; require explicit filter for resolved)?
- Do we need WebSocket/Realtime integration for live odds updates? If yes, add Realtime service and channel definitions.

## Deliverables
- Server module structure scaffolded in `src/server/` per architecture above.
- DTO definitions co-located with shared types to enforce server/client parity.
- Middleware pipeline implemented with Zod validation and correlation IDs.
- Controller/service/repository skeletons with TODOs referencing persistence functions.
- Automated tests covering core flows.

## Implementation Progress (Nov 11, 2025)
- ✅ Core services (`ConfigService`, `MarketsService`, `BetsService`, `LedgerService`) and repositories handle config reads, bet placement, settlements, and ledger writes under transactional helpers.
- ✅ Middleware stack (tracing, context hydration, auth, error handling) and public controllers expose participant routes for markets, wallet, bets, and leaderboards.
- ✅ Moderator resolve/void flows execute settlements/refunds with ledger integration and accompanying Vitest coverage.
- ✅ Scheduler service and repository persist Devvit job metadata with unit tests guarding schedule/cancel behavior.
- ✅ Markets service now orchestrates publish/close lifecycle end-to-end, including scheduler job scheduling, cancellation, and auto-close metadata cleanup.
- ✅ Moderator publish/close endpoints plus the `/internal/scheduler/market-close` handler are live, invoking the enhanced service methods and logging skipped jobs.
- ✅ Lifecycle test suite expanded to cover publish, manual close, scheduler auto-close, and override handling.
- ✅ Archive tooling in `MarketsService` and `/internal/markets/archive` now prunes aged resolved/void markets with transactional cleanup, surfaced through new service and controller tests.
- 🔄 Remaining work: wire archival maintenance into the moderator console, expand audit/metrics coverage around archive runs, and continue hardening moderator workflow tooling.
