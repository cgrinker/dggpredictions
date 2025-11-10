# DestinyGG Prediction Market – High-Level Design

## Goals & Scope
- Deliver a Reddit-native prediction market experience for the r/Destiny community via Devvit.
- Support moderator-created yes/no markets with configurable close and resolve times.
- Allow subreddit members to wager points, track balances, and receive proportional payouts on market resolution.
- Provide guardrails for moderation, anti-abuse, and transparent audit trails.
- Lay the groundwork for future feature growth (multi-outcome markets, leaderboards, seasonal resets).

## Actors & Personas
- **Moderator**: Creates, manages, and resolves markets; can adjust metadata when necessary.
- **Participant**: Places wagers with points, monitors market status, withdraws winnings upon resolution.
- **Spectator**: Views markets and historical outcomes without betting (read-only experience).
- **System**: Executes scheduled jobs (auto-close, auto-resolve checklist), enforces business rules, maintains ledger.

## Success Criteria
- Reliable storage of markets, bets, and ledgers with eventual consistency under Devvit quotas.
- Sub-second feedback for common interactions (view markets, place bets) on typical subreddit traffic.
- Deterministic payout logic with auditability: every point movement traceable in the ledger.
- Moderator tooling to review pending markets and resolve with confidence.

## Out of Scope (Phase 1)
- Real-money wagering or integrations with external currencies.
- Complex market types (multi-outcome, continuous order books, limit orders).
- Cross-subreddit betting or multi-subreddit user balances.
- Full-fledged analytics dashboards (beyond essential metrics and exports).

## System Architecture Overview
```
┌────────────────────────┐
│ Reddit Client (Web/App)│
└──────────┬─────────────┘
           │ Devvit UI (React + Tailwind)
┌──────────▼─────────────┐
│ Devvit Client Bundle   │
│ - Screens & Hooks      │
│ - Local state/cache    │
└──────────┬─────────────┘
           │ Devvit app bridge (platform RPC handlers)
┌──────────▼─────────────┐
│ Devvit Server Runtime  │
│ - Router/Handlers      │
│ - Business services    │
│ - Validation & auth    │
└──────────┬─────────────┘
           │ Storage SDKs (KV, Redis, Scheduler)
┌──────────▼─────────────┐
│ Persistence Layer      │
│ - Redis (tabular data) │
│ - KV (config blobs)    │
│ - Scheduler (jobs)     │
└────────────────────────┘
```

## Component Responsibilities
- **Client (`src/client`)**
  - Deliver Devvit React screens: lobby, market detail, bet placement, wallet view, moderator console.
  - Fetch data via typed fetch helpers hitting internal `/api/*` endpoints exposed by the Devvit server bundle.
  - Perform optimistic UI updates where safe (bet placement) with rollback on failure.
  - Enforce client-side validation (e.g., minimum bet, insufficient balance warnings).

- **Server (`src/server`)**
  - Expose typed RPC endpoints for market CRUD, betting, resolution, and leaderboards.
  - Enforce authorization using Reddit user roles, subreddit membership, and Devvit mod checks.
  - Maintain business invariants: one active bet per user per market, no wagers after close.
  - Own payout settlement, ledger generation, and scheduler registration for autop-run tasks.

- **Shared (`src/shared`)**
  - Cross-platform TypeScript types for DTOs, enums, and validation schemas (e.g., Zod).
  - Business utility modules (odds calculations, payout formulas, date helpers).
  - Error/result primitives to ensure consistent error handling between client/server.

- **Persistence**
  - Redis tables for structured entities (markets, bets, user balances, ledger entries).
  - Devvit Settings for moderator-configurable values (starting balance, limits) with Redis-backed caching for fast reads.
  - Scheduler jobs for market auto-close reminders and overdue resolution alerts (subject to Devvit scheduler limits).

## Platform Capabilities Alignment
- **Storage**: Leverage Devvit Redis (per-installation 500 MB quota, no Lua/pipelining) with `watch`/`multi`/`exec` transactions to keep ledger updates atomic. Use sorted sets for leaderboards and hashes for market/bet records.
- **Configuration**: Store long-lived subreddit-specific configuration via Devvit Settings; mirror hot values in Redis for low-latency access. Feature flags live alongside settings.
- **Scheduling**: Devvit scheduler supports cron and one-off jobs with ~60 job creations/deliveries per minute and 10 concurrent recurring jobs—market auto-close jobs must respect the limit and clean up after execution.
- **Networking**: Client↔server communication stays inside the Devvit app via registered `/internal` and `/api` routes. External integrations require allow-listed `httpFetch` calls; anything beyond the allowlist (e.g., third-party storage) would need a companion backend.
- **Realtime UX**: Default plan uses client polling after mutations. For near-live updates we can opt into Devvit Realtime channels if needed.
- **Auth & Identity**: Use Devvit context (user, subreddit, mod status) and Reddit API helpers to enforce moderator-only mutations and to fetch profile data.

## Domain Model
| Entity | Key Fields | Notes |
|--------|------------|-------|
| `UserBalance` | `userId`, `subredditId`, `balance`, `lifetimeEarned`, `lifetimeLost`, `updatedAt` | Initialized with configurable starting balance; updated via ledger only. |
| `Market` | `marketId`, `title`, `description`, `createdBy`, `subredditId`, `status`, `closesAt`, `resolvedAt`, `resolution`, `potYes`, `potNo`, `totalBets` | `status` in {`draft`, `open`, `closed`, `resolved`, `void`}. |
| `Bet` | `betId`, `marketId`, `userId`, `side`, `wager`, `createdAt`, `payout`, `settledAt`, `status` | One active bet per user per market; `status` mirrors market state. |
| `LedgerEntry` | `entryId`, `userId`, `marketId`, `type`, `delta`, `balanceAfter`, `timestamp`, `metadata` | `type` in {`credit`, `debit`, `refund`, `adjustment`, `payout`}. |
| `ModeratorAction` | `actionId`, `marketId`, `performedBy`, `action`, `payload`, `timestamp` | Audit log for compliance and dispute resolution. |
| `Config` | `subredditId`, `startingBalance`, `minBet`, `maxBet`, `cooldowns`, `leaderboardWindow` | Stored via Devvit Settings; cached in Redis/client for fast reads.

## Core Workflows
- **Market Creation**: Moderator enters metadata → server validates (duplicate title, schedule sanity) → market persisted as `draft` → optional preview → `open` state on publish.
- **Bet Placement**: Client fetches market status & user balance → validates locally → server re-validates (balance, closure) → creates bet record + ledger debit → updates market pot totals → responds with updated odds/balance.
- **Market Closure**: Triggered manually by moderator or automatically via scheduler at `closesAt` → server flips market to `closed`, prevents new bets, queues resolution reminder.
- **Resolution & Settlement**: Moderator selects `yes`/`no` → server computes winnings per eligible bet → credits winners via ledger entries and updates `UserBalance`/`Bet` statuses → losing bets recorded as `lost` with zero payout.
- **Void/Refund Flow**: Moderator flags market as `void` (e.g., ambiguous outcome) → server refunds wagers via ledger entries and resets bet statuses accordingly.
- **Leaderboard Generation**: Server aggregates `UserBalance` and `lifetimeEarned` to produce weekly/monthly leaderboards; cached in KV with short TTL.

## API Surface (Initial)
- `GET /markets?status=open|closed|resolved`
- `GET /markets/{id}`
- `POST /markets` (mods)
- `POST /markets/{id}/publish` (mods)
- `POST /markets/{id}/close` (mods/system)
- `POST /markets/{id}/resolve` (mods)
- `POST /markets/{id}/void` (mods)
- `POST /markets/{id}/bets` (participants)
- `GET /users/me/balance`
- `GET /users/me/bets?status=active|settled`
- `GET /leaderboard?window=weekly`

Requests/responses will use shared DTOs with schema validation (Zod) on server entry points.

_Note: These are internal Devvit Web routes mounted under `/api/*` (or `/internal/*` for privileged handlers) and are not accessible from the public internet._

## Points Economy & Risk Controls
- Default starting balance (e.g., 10,000 points) assigned on first bet attempt; configurable per subreddit.
- Minimum bet enforced to prevent spam; optional maximum bet per market.
- Pot ratios determine payout multiplier: `payout = wager * (totalOpposingPot / totalSupportingPot)`.
- Configurable cooldown for repeat market creation per moderator to avoid flooding.
- Anti-abuse hooks: rate limiting by user, moderator dual-control for large payouts, anomaly detection metrics.

## Moderation & Compliance
- Require Reddit moderator role for market management endpoints via Devvit permissions.
- Log every moderator action with before/after snapshots for dispute review.
- Provide manual override operations (balance adjust, bet cancel) with mandatory reason field.
- Nightly export of logs to modmail or cloud storage (future phase) contingent on approved Reddit APIs or an allow-listed external webhook.

## Observability & Tooling
- Structured logging with correlation IDs (per request, per market) for traceability.
- Metric counters: markets created/resolved, bets placed, total volume, payouts (persisted in Redis for dashboarding).
- Error alerts for failed settlements or storage latency spikes.
- Admin console page to review scheduler job status and pending resolutions.

## Deployment & Environments
- Single Devvit app deployed to production subreddit; optional staging subreddit for QA.
- Feature flags gated via KV config to enable incremental rollout (e.g., partial user cohort).
- Automated test suite run via `npm test` covering shared logic and server handlers.
- Manual smoke tests before enabling in production.

## Risks & Open Questions
- Devvit storage limits: confirm Redis size/quota; plan archival strategy for older markets.
- Concurrency: ensure Redis operations are atomic (Lua scripts or MULTI/EXEC) to prevent double payouts.
- Time synchronization: rely on server-side timestamps; avoid client-supplied times beyond user intent.
- Regulatory considerations: confirm subreddit rules and Reddit ToS compliance for point-based wagering.

## Initial Milestones (Draft)
1. Foundations: shared types, config plumbing, starting balance creation, health check endpoint.
2. Market Lifecycle: moderator UI + endpoints for create/publish/close, market listing on client.
3. Betting & Ledger: bet placement flow, ledger bookkeeping, wallet view.
4. Resolution & Payouts: settlement logic, moderator resolution screen, payout distribution tests.
5. Quality & Ops: leaderboards, logging/metrics, scheduler jobs, moderation tools polish.

## Next Steps
- Validate domain model with moderation team and confirm point economy rules.
- Break milestones into detailed design docs (client, server, persistence, moderation) with acceptance criteria.
- Prototype key flows in staging subreddit to ensure Devvit platform assumptions hold.
