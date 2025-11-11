# Persistence & Data Integrity Design

## Objectives
- Provide reliable storage for markets, bets, user balances, and ledger entries using Devvit-managed infrastructure.
- Ensure atomicity and data consistency during high-contention operations (e.g., bet placement, settlement) despite Redis limitations (no Lua scripting, no pipelining).
- Respect per-installation quotas (500 MB storage, 40k commands/sec, scheduler limits) while allowing historical records and aggregations for leaderboards and audit.
- Make configuration and feature flags moderator-adjustable without code deployments, keeping read-path latency low.
- Support future extensibility (multi-outcome markets, archival to external systems) without major schema rewrites.

## Platform Constraints & Opportunities
- **Redis**: Namespaced per subreddit installation. Supports strings, hashes, sorted sets, transactions via `watch`/`multi`/`exec`. No Lua scripts or pipelining; limited command set (see Devvit docs). Storage capped at 500 MB per installation.
- **Scheduler**: Max 10 concurrent cron jobs; `runJob()` limited to ~60 creations and ~60 deliveries per minute. Jobs execute at best-effort minute resolution (optional seconds granularity). Must clean up completed jobs to stay under limits.
- **Settings & Secrets**: Devvit Settings provide moderator-editable config values; Secrets can store sensitive tokens if we later integrate external services.
- **HTTP Fetch**: External API calls require domain allow-listing. For now, persistence strictly uses Redis/Settings/Scheduler; external archival deferred.

## High-Level Storage Layout
```
Namespace: dggpm:<entity>:<subredditId>

Keys (Redis)
├─ balances:<userId> ─ Hash (balance, lifetimeEarned, lifetimeLost, updatedAt)
├─ markets ─ Sorted set (score = createdAt, member = marketId)
├─ market:<marketId>
│    ├ status
│    ├ title / description
│    ├ createdBy / createdAt / closesAt / resolvedAt
│    ├ resolution ("yes" | "no" | "void" | null)
│    ├ potYes / potNo / totalBets
│    └ metadata (JSON string for flexible extras)
├─ market:<marketId>:bets ─ Sorted set (score = createdAt, member = betId)
├─ bet:<betId>
│    ├ marketId / userId / side / wager
│    ├ status (active, lost, won, refunded)
│    ├ payout / settledAt
│    └ createdAt
├─ ledger:<userId> ─ Sorted set (score = timestamp, member = entryId)
├─ ledger-entry:<entryId>
│    ├ type (debit, credit, payout, refund, adjustment)
│    ├ delta / balanceAfter
│    ├ marketId / betId (optional)
│    └ memo JSON
├─ leaderboard:window:<weekly|monthly|alltime> ─ Sorted set (score = lifetimeEarned)
├─ lock:market:<marketId> ─ Temporary lock key (string with TTL) for coarse mutex
├─ scheduler:market:<marketId>:close ─ Stored jobId for cancellation/inspection
└─ audit:actions ─ List (trimmed) of moderator action IDs

Devvit Settings (per installation)
- startingBalance (default 10_000)
- minBet (default 100)
- maxBet (optional)
- maxOpenMarkets (optional)
- leaderboardWindow (enum)
- autoCloseGraceMinutes (default 5)
- feature flags (booleans)
```

## Entity Storage Strategy
### Markets
- **Primary record**: Hash at `market:<marketId>` plus insertion into `markets` sorted set for listing by creation time.
- **Indices**: Additional sorted sets by status (`markets:status:<status>`) enable quick filtered queries. `status` hash field mirrors membership.
- **Lifecycle updates**: Use transactions to update hash + zset membership atomically. E.g., when closing, remove from `markets:status:open`, add to `markets:status:closed`, update status field.
- **Metadata**: Optional JSON field inside hash (stored as string) for future extensibility (e.g., tags, resolution notes, lifecycle markers such as `publishedBy`, `lastPublishedAt`, `autoCloseOverrideMinutes`, `closedBy`, `lastClosedAt`, `autoClosedByScheduler`, `lastAutoClosedAt`).

### Bets
- **Primary record**: Hash at `bet:<betId>`.
- **Index**: Sorted set per market `market:<marketId>:bets` sorted by `createdAt`. Helps compute totals and iterate for settlement.
- **Uniqueness**: Store user’s active bet per market in hash key `market:<marketId>:user:<userId>` (string of betId). Set via transaction to prevent multiple active bets.
- **Totals tracking**: Market hash fields `potYes`, `potNo`, `totalBets` maintained via `hIncrBy`. Updates enclosed in transaction with ledger adjustments.

### User Balances & Ledger
- **Balance hash**: `balances:<userId>` stores numeric fields as strings (per Redis). Access via `hGetAll` or typed helper.
- **Ledger entries**: Hash per entry; sorted set `ledger:<userId>` for chronological retrieval. Trim older entries if necessary (policy TBD, e.g., keep last 5k entries, export older ones later).
- **Atomic updates**: Bet placement uses transaction sequence: watch balance key → fetch current balance → ensure >= wager → queue ledger entry creation, decrement balance, update pots → exec. Retry on conflict.
- **Ledger ID generation**: Use ULID/UUID v7 to maintain chronological order.

### Leaderboard
- **Sorted set**: `leaderboard:window:<window>` with score = metric (e.g., `lifetimeEarned - lifetimeLost` or `balance`). Update via `zIncrBy` as part of ledger writes.
- **Window management**: For weekly/monthly windows, scheduled job recalculates from ledger deltas (or maintains separate counters). Considering Redis storage, maintain derived counters in hash `balances:<userId>` fields (`weeklyEarned`, etc.) reset by scheduler.

### Moderator Actions & Audit
- **Audit log**: Store each action in hash `mod-action:<id>`; push `id` onto capped list `audit:actions` (e.g., max 5000) per installation.
- **Referential integrity**: `id` includes timestamp; store serialized before/after snapshots (with redacted data if needed) for compliance.

## Transactions & Consistency Patterns
### Bet Placement
1. `watch balances:<userId> market:<marketId> market:<marketId>:user:<userId>`
2. Read balance, market status/pots, existing user bet pointer.
3. Validate: status == `open`, no existing bet, balance ≥ wager, market not closing soon (optional).
4. `multi()`
   - `hIncrBy balances:<userId> balance -wager`
   - `hIncrBy balances:<userId> lifetimeLost +wager` (optional metric)
   - `hIncrBy market:<marketId> potYes/potNo` accordingly and increment `totalBets`
   - `set market:<marketId>:user:<userId> betId`
   - `hSet bet:<betId> ...`
   - `zAdd market:<marketId>:bets (createdAt, betId)`
   - `hSet ledger-entry:<entryId> ...`
   - `zAdd ledger:<userId> (timestamp, entryId)`
   - `zIncrBy leaderboard:window:weekly <userId> -wager` (if leaderboard uses net change)
5. `exec()`; on null response, retry limited times.

### Market Resolution
1. Acquire coarse lock using `setNX lock:market:<marketId>` with short TTL (e.g., 30s) to avoid double settlement.
2. Fetch all bets via `zRange market:<marketId>:bets` and corresponding hashes (batch `mGet`/`pipeline` not available → chunked `hMGet`).
3. Compute payouts server-side.
4. Use batched transactions per chunk (to stay within command/time limits):
   - For winners: credit balance, create ledger entry, update bet status/payout.
   - For losers: mark bet status as lost; ledger entry optional if already accounted via wager debit.
   - Update market hash (status → `resolved`, resolution field, resolvedAt).
   - Update leaderboard via `zIncrBy` for winners by payout delta.
5. Delete lock key.

### Refund/Void Flow
- Similar to resolution but ledger delta is positive refund amount returning original wager. Ensure idempotency via bet status guard (`refunded`).

## Scheduler Usage
- **Auto-close**: When publishing a market, schedule `market-close` one-off job at `closesAt + grace`. Store job ID in `scheduler:market:<marketId>:close`. Handler verifies market still `open`, flips to `closed` within transaction, clears the stored job ID, and annotates metadata (`autoClosedByScheduler`, `lastAutoClosedAt`) for audit/analytics.
- **Reminder/overdue**: Optional recurring job to list `closed` markets older than X hours without resolution and ping moderators via modmail (subject to API approval).
- **Leaderboard resets**: Weekly/monthly job to snapshot leaderboard, reset counters (`weeklyEarned`, etc.). Job ensures creation count stays within 60/min; batch operations.

## Configuration Flow
- Moderators adjust settings via Devvit Settings UI.
- On server start and periodically (e.g., TTL 5 minutes), cache settings into Redis key `config:fresh` for quick reads.
- Provide fallback to fetch settings directly if cache missing; refresh lazily.
- Feature flags retrieved alongside config.

## Data Retention & Archival
- Monitor Redis usage; if approaching 500 MB, implement pruning policies:
  - Trim `audit:actions` list length.
  - Archive resolved markets older than configurable window by deleting per-market bet hashes/zsets while keeping summary stats.
  - Optionally export to external storage via allow-listed webhook (future milestone).
- Provide manual mod action to purge old resolved markets (with safety checks).

## API Helpers (Server Layer)
- Create TypeScript repository modules (e.g., `MarketRepository`, `BetRepository`, `LedgerRepository`) encapsulating Redis operations and transaction patterns.
- Repositories return typed results (`Result<T, Error>`). All data access flows through repositories to keep invariants centralized.
- Provide helper to run transactions with retry/backoff (max 3 attempts) and to instrument metrics/logging.

## Testing Strategy
- Unit tests for repositories using Devvit-provided Redis test utilities or mocking layer.
- Integration tests executed via Devvit playtest or local Redis emulator (if supported) to validate transaction flows.
- Simulation tests for payout calculation with large participant sets to ensure command count stays under limits.

## Risks & Mitigations
- **Transaction contention**: High-frequency bets may cause transaction retries. Mitigate by keeping transaction scope minimal and using coarse locks only when necessary.
- **Redis quota exhaustion**: Track storage metrics; enforce retention policies. Consider storing minimal per-bet data (e.g., no verbose metadata) or compressing JSON fields.
- **Scheduler saturation**: Batch or coalesce jobs (e.g., one cron scanning for markets to close rather than per-market jobs) if volume grows.
- **Data recovery**: Without Lua/pipelining, recovery from partial failures requires careful error handling. Ensure all writes occur inside `multi` block; if failure occurs mid-settlement, mark market `pendingSettlement` and retry.
- **Allow-list dependency**: If future analytics export requires external service, plan allow-list request early or design in-app CSV download using post data.

## Deliverables
- Repository layer implementation in `src/server/core` (or similar) encapsulating Redis interactions.
- Type definitions in `src/shared/types` for entities and DTOs.
- Config cache module handling Devvit Settings reads/writes.
- Transaction helper utilities with logging/instrumentation.
- Tests covering bet placement, resolution, refund flows, leaderboard updates, and scheduler job scheduling/cancellation.

## Implementation Progress (Nov 11, 2025)
- ✅ Redis repositories and transaction utilities underpin markets, bets, balances, ledger entries, config caching, and scheduler job metadata.
- ✅ Config caching validated against shared schemas with TTL-backed snapshots for fast reads.
- ✅ Market repository maintains status indices and user bet pointers; bet repository powers wallet/history listings with per-user indexes.
- ✅ Balance/ledger helpers enforce atomic credit/debit workflows and keep leaderboard counters in sync.
- ✅ Settlement/refund flows execute within transactions, clearing pointers and updating ledger plus leaderboard state under unit coverage.
- ✅ Scheduler repository/service manage market-close jobs and now integrate with MarketsService to clean persistence when jobs fire.
- ✅ Market metadata schema expanded to track publish/close actors, overrides, and scheduler-driven closures for future archival policies.
- ✅ Archive pathway removes settled markets via transactional bet deletion, pointer cleanup, and metadata stamping, with repository/service helpers now exercised by tests.
- 🔄 Next up: automate retention scheduling, expose archival metrics, and explore long-term export options for deep history.
