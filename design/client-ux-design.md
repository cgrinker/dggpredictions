# Client UX Design

## Objectives
- Deliver a Devvit Web experience that feels native to Reddit while supporting prediction market flows for participants and moderators.
- Provide clear navigation between lobby, market detail, wallet, bets history, leaderboards, and moderator tools.
- Offer responsive interactions (optimistic updates when safe) with graceful error handling.
- Respect Devvit platform constraints: layouts rendered via React/Tailwind, form interactions via `@devvit/web/client` helpers, no external scripts.

## Entry Points & Navigation
- Primary entry via interactive post or subreddit sidebar panel (configurable in `devvit.json`).
- Use Devvit client navigation helpers: `navigateToAppRoute('/route')` for in-app views, `navigateTo` for external links.
- Top-level routes (managed via React Router or custom state machine):
  1. `/` – Lobby (list of open markets)
  2. `/markets/:id` – Market detail
  3. `/wallet` – Wallet overview & recent ledger entries
  4. `/bets` – Active & settled bets
  5. `/leaderboard` – Leaderboard view
  6. `/admin` – Moderator console (gated)

- Maintain minimal global state using React context (`ClientAppContext`) capturing:
  - `currentUser` (username, userId, isModerator)
  - `config` (startingBalance, limits)
  - `refreshConfig()` helper

## Component Breakdown
```
src/client/
├─ App.tsx                // Router + layout shell
├─ routes/
│   ├─ LobbyScreen.tsx
│   ├─ MarketDetailScreen.tsx
│   ├─ WalletScreen.tsx
│   ├─ BetsScreen.tsx
│   ├─ LeaderboardScreen.tsx
│   └─ AdminConsoleScreen.tsx
├─ components/
│   ├─ MarketCard.tsx
│   ├─ MarketStatusBadge.tsx
│   ├─ OddsDisplay.tsx
│   ├─ BetSlip.tsx
│   ├─ BalanceChip.tsx
│   ├─ ErrorBanner.tsx
│   ├─ LoadingState.tsx
│   ├─ Table.tsx (generic)
│   └─ Dialog.tsx (form modal for moderator actions)
├─ hooks/
│   ├─ useCurrentUser.ts
│   ├─ useMarkets.ts (list & detail fetch)
│   ├─ useBets.ts
│   ├─ useWallet.ts
│   ├─ useLeaderboard.ts
│   └─ useAdminActions.ts
├─ api/
│   ├─ client.ts (fetch wrapper with base options, error mapping)
│   ├─ markets.ts
│   ├─ bets.ts
│   ├─ users.ts
│   └─ leaderboards.ts
└─ utils/
    ├─ formatters.ts (points, odds)
    └─ routing.ts
```

## Data Fetching Strategy
- Use lightweight custom hooks wrapping `fetch` (or `useSWR`-like pattern) to request `/api/*` endpoints.
- Hook responsibilities:
  - Manage loading/error state (`{ data, isLoading, error, refetch }`).
  - Provide optimistic update options where safe, by passing `onMutate` callbacks.
- Cache small data (user balance, config) in context; invalidate after mutations (bet placement, resolution notifications).

## Screens
### Lobby (`/`)
- Displays list of open markets grouped by closing soon vs newly launched.
- Each `MarketCard` shows title, closing countdown, pot totals, implied odds.
- `Bet` button navigates to detail.
- Include tabs to filter: `Open`, `Closed`, `Resolved` (lazy fetch when switching).
- Moderator-only `Create Market` button at top.

### Market Detail (`/markets/:id`)
- Sections:
  1. Header with title, status badge, close time, creator, total pot.
  2. Odds panel (Yes vs No) with dynamic payout multipliers.
  3. User bet state:
     - If no bet: display `BetSlip` with side selector, wager input, computed potential payout. Wager input defaults to min bet, with quick multiplier buttons (x0.5 pot, x2 min, etc.). Client-side validation ensures numeric and within balance/limits.
     - If existing bet: show summary (side, wager, potential payout), allow editing only if config allows (initial version likely locks after placement).
  4. Activity feed (optional): show recent bets with anonymized amounts (future phase).
  5. Moderator actions (if mod): buttons `Edit`, `Close`, `Resolve`, `Void`, launching forms/dialogs.
- Provide CTA for returning to lobby/back.

### Wallet (`/wallet`)
- Display current balance prominently, lifetime earnings/losses, and starting balance history.
- Show ledger table (paginated) with columns: Date, Type, Market, Delta, Balance After, Notes.
- Provide quick link to `Bets` for active bets.

### Bets (`/bets`)
- Two tabs: `Active`, `Settled`.
- Active list shows market name, side, wager, potential payout, status (open/closed awaiting resolution).
- Settled shows result (won/lost/refunded) with payout amounts.
- Provide filter by timeframe for settled (e.g., last 30 days).

### Leaderboard (`/leaderboard`)
- Tabs for `Weekly`, `Monthly`, `All-time`.
- Each shows top N entries with username, rank, metric (net earnings or balance), change vs prior period if available.
- Highlight current user position even if outside top N.
- Option to share (navigate to leaderboard post or comment if desired).

### Admin Console (`/admin`)
- Protected: if `!isModerator`, redirect to lobby with toast.
- Sections:
  1. `Open Markets` table with quick actions (close, resolve).
  2. `Drafts` list with resume editing option.
  3. `Create Market` form:
     - Title, description (rich text limited), close time (datetime picker), optional tags.
     - Form uses Devvit Forms or custom modal. On submit, call POST `/internal/markets`.
  4. `Resolution Queue`: closed markets awaiting resolution with aggregated metrics.
  5. `Config` panel (read-only in phase 1) showing current settings; future milestone might allow editing.
  6. `Audit Log` snippet (most recent actions) with link to full list.

## Moderator Workflows (UI)
- **Create Market**:
  - Show live preview card as user fills fields.
  - Validate close time minimum lead (server will also validate).
  - After creation, user can `Publish` immediately.
- **Publish/Close/Resolve/Void** actions triggered via mod-only buttons using `Dialog` component to capture confirmation and optional notes.
  - On success, show toast (`useToast` helper) and refetch relevant queries.
  - On error, surface message from API (includes code) with fallback text.

## Interaction Patterns
- **Optimistic updates**:
  - Bet placement: optimistically deduct wager from balance and update market pots, but rollback if API rejects.
  - Market publish/resolution: avoid optimistic updates due to complexity; rely on server response.
- **Polling**:
  - Lobby uses periodic refresh (e.g., 30s) for open markets to update pot totals. Provide `pause` when tab inactive.
  - Market detail polls for status every 15s while open/closed; stop once resolved.
- **Error handling**:
  - `ErrorBanner` component displays API error with retry button.
  - Network errors show toast + inline message.
- **Loading states**:
  - Skeleton cards for lobby, spinner for detail.
  - Loading overlay on form submission.

## Visual Language
- Tailwind-based design with Reddit-inspired palette:
  - Primary accent `#d93900` (Reddit orange) for CTAs.
  - Neutral grays for backgrounds, accessible text contrast.
- Use consistent spacing, typography classes from `global.ts`.
- Status badges colors:
  - `open`: green
  - `closed`: amber
  - `resolved`: blue
  - `void`: gray

## Accessibility
- Ensure `aria` labels on action buttons (`Resolve market`, etc.).
- Focus management when dialogs open/close.
- Support keyboard navigation for `BetSlip` (input focus, arrow keys for side selection).
- Provide textual odds information for screen readers (e.g., "Yes pays 1.8x").

## Telemetry & Feedback
- Use `useEffect` hooks to log important interactions via server metrics endpoint or console logs (e.g., bet attempt, market view) if needed for analytics.
- Provide user feedback to report issues (link to modmail or support).

## State Management Notes
- Keep shared state minimal: `UserContext`, `ConfigContext`.
- Use React Query-like pattern (build simple `useQuery`/`useMutation` wrappers) to handle caching/invalidation centrally.
- Deduplicate identical requests by caching pending promises.

## Testing Plan
- Component unit tests with Jest/React Testing Library covering:
  - BetSlip validation logic.
  - MarketCard renders correct status/odds.
  - Moderator dialogs trigger API calls.
- Integration tests using Devvit UI Simulator or Playtest for main flows (bet placement, market creation).
- Snapshot tests for key screens to catch styling regressions.

## Future Enhancements (Out of Scope Phase 1)
- Realtime odds/pot updates via Devvit Realtime channels.
- Push notifications (if platform exposes) for resolution updates.
- Localization support (i18n) once required.
- Dark mode theme depending on Reddit client settings (if accessible via Devvit). 

- ✅ Participant experiences (Markets lobby, Market detail with bet slip, Wallet, Bets, Leaderboard) are implemented and wired to live hooks/APIs with optimistic updates where appropriate.
- ✅ Moderator lifecycle console (`MarketLifecyclePanel`) now includes draft creation, publish/close/resolve/void controls, an integrated audit log viewer, and the manual balance adjustment form with dual-confirmation safeguards.
- ✅ Client API and hook layers cover markets, bets, wallet, leaderboard, audit log flows, moderator balance adjustments, and draft creation with consistent error handling utilities.
- ✅ Manual playtest validated: moderator creates/publishes markets, participants place opposing bets, and settlements pay winners while debiting losers.
- 🔄 Moderator-only extensions (archival tooling, config editing) and richer observability affordances are scheduled for upcoming work.
