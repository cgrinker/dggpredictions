# Shared Types & Validation Design

## Objectives
- Maintain a single source of truth for data contracts between client and server.
- Provide runtime validation for inputs/outputs to guard against malformed data.
- Facilitate TypeScript type reuse across client, server, and tests via project references.
- Ensure schema versions and migrations are tracked as entities evolve.

## Directory Structure
```
src/shared/
├─ types/
│   ├─ entities.ts        // Market, Bet, LedgerEntry, UserBalance, LeaderboardEntry
│   ├─ dto.ts             // Request/response DTOs for API routes
│   ├─ config.ts          // AppConfig, FeatureFlags definitions
│   ├─ moderation.ts      // ModeratorAction types, audit record shapes
│   └─ errors.ts          // Error codes/enums shared with client for messaging
├─ schema/
│   ├─ entities.schema.ts // Zod schemas mirroring types
│   ├─ dto.schema.ts
│   ├─ config.schema.ts
│   └─ moderation.schema.ts
├─ validation.ts          // Helper functions to parse/validate
├─ result.ts              // `Result<T, E>` helper types
└─ index.ts               // Barrel exports
```

## Type Strategy
- Define TypeScript interfaces for core entities using `Readonly` fields where appropriate.
- Use discriminated unions for status-heavy entities (e.g., `MarketStatus = 'draft' | 'open' | ...`).
- Keep ID fields typed as branded strings (e.g., `type MarketId = string & { __brand: 'MarketId' }`) to reduce mixups.

## DTO Contracts
- For each API endpoint, define request/response shapes in `dto.ts`.
  - Example:
    ```ts
    export interface PlaceBetRequest {
      marketId: MarketId;
      side: BetSide; // 'yes' | 'no'
      wager: number;
    }
    
    export interface PlaceBetResponse {
      bet: BetSummary;
      balance: UserBalanceSnapshot;
      market: MarketOddsSummary;
    }
    ```
- Server controllers import DTO types and corresponding Zod schemas to validate incoming payloads, ensuring compile-time and runtime alignment.
- Client API hooks import same DTO types for typed responses, leaning on `zod` inference for strong typing.

## Validation & Parsing Helpers
- Use `zod` for runtime validation; schemas live in `schema/` directory. Example:
  ```ts
  export const PlaceBetRequestSchema = z.object({
    marketId: MarketIdSchema,
    side: z.enum(['yes', 'no']),
    wager: z.number().int().positive().max(MAX_WAGER_LIMIT),
  });
  ```
- Provide helper `validateRequest(schema, data)` returning typed result or throwing `ValidationError` mapped by server middleware.
- Server responses validated before sending (optional, but useful for critical flows) using `parse` to ensure contract compliance.

## Enum & Code Registries
- Define error codes in `errors.ts` as const enums: `MARKET_NOT_FOUND`, `INSUFFICIENT_BALANCE`, etc. Export type `ErrorCode` for client to map messages.
- Action enums (`ModeratorActionType`, `LedgerEntryType`) defined once and re-used across modules.

## Versioning & Migration
- Assign `schemaVersion` field to persisted entities (markets, bets) to support future migrations. Defaults to `1`. Migration utilities should exist in persistence layer to upgrade records lazily when read.
- Document schema changes in `docs/changelog-schema.md` (future file) to track updates.
- Provide utility to detect incompatible schema versions and log warnings.

## Type Safety Enhancements
- Use `ReadonlyDeep` (via utility type) for data returned to client to prevent accidental mutation.
- For numeric fields stored as strings in Redis, define helper `toNumber`/`toString` conversions with validation (guard against `NaN`).

## Testing
- Add tests verifying Zod schemas align with TypeScript definitions using `expectTypeOf` or by inferring types from schemas.
- Unit tests for validation helpers to ensure rejection of malformed payloads.

## Tooling
- Configure `tsconfig.json` to treat `src/shared` as referenced project consumed by client/server packages.
- Consider generating OpenAPI-like docs by translating Zod schemas (optional future enhancement).
- Provide script to ensure DTO exports remain tree-shakeable to keep bundle small.

## Deliverables
- Shared types and schema files scaffolded with initial entity definitions.
- Validation helpers integrated into server middleware.
- Client API hooks using DTO types for strong typing.
- Documentation for schema versioning and update process.
