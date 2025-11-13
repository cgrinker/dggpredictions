## dggpredictions

Prediction market companion for the r/Destiny subreddit built on Reddit's Devvit platform. The web client lets participants browse markets, place bets, monitor their wallet, and climb the leaderboard, while moderators manage market lifecycles from the same bundle.

### Features

- Participant navigation with quick access to Markets, Market Detail, Wallet, My Bets, and Leaderboard screens, including inline bet history and current-position highlights.
- Moderator lifecycle console with search and sort controls, market tag badges, collapsible audit payloads, and one-click lifecycle actions.
- Shared API layer and hooks for markets, bets, wallet balances, bet history intervals, and leaderboard snapshots.
- Tailwind-styled React UI bundled through Vite for both client and server webviews, backed by deterministic Redis reset tooling and image upload helpers.

### Prerequisites

- Node.js 22+
- Reddit developer account with Devvit CLI access (`npm install -g devvit`)

### Installation

```bash
npm install
```

### Common Scripts

- `npm run dev` – run client, server, and Devvit playtest watchers.
- `npm run dev:vite` – start a local Vite dev server for the client UI only.
- `npm run build` – build client and server bundles.
- `npm exec vitest run` – execute the test suite.
- `npm run check` – type-check, lint (with autofix), and format the repo.

### Workflow Notes

The React app (`src/client`) renders a top-level navigation bar. Participant tabs (Markets, Wallet, My Bets, Leaderboard) fetch data via hooks in `src/client/hooks`. Selecting a market swaps the lobby for `MarketDetailScreen`, where bets can be placed against the current wallet balance. Moderators can jump to the lifecycle console tab to publish, close, or resolve markets while reviewing recent audit metadata.

Server-side controllers and services live under `src/server`. Vitest-based unit tests cover controllers, services, and scheduler orchestration. Use `npm exec vitest run` after changes to verify behavior; linting is available via `npm run lint`.

### Current Progress

- Operations reset flow now walks Redis deterministically, collapsing wildcard scans into targeted key discovery with regression coverage (`operations.service.test.ts`).
- Moderator lifecycle console ships searchable/sortable market tables, tag metadata, collapsible action payloads, and inline bet summaries on the market detail form.
- Client hooks expanded to include market bet history (`useMarketHistory`), enabling interval-aware charts and re-fetch controls.
- Market imagery pipeline accepts optional extensionless URLs, proxies uploads through Devvit media, and falls back to refreshed default artwork.
