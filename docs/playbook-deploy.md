# Deployment Playbook

_Last updated: 2025-11-12_

This playbook covers the end-to-end flow for promoting the predictions bot from development into the Playtest and production environments. Run through the smoke checklist before each push and capture any anomalies in the incident feed.

## Prerequisites
- Logged in via `devvit login` with credentials that can access the destination subreddit.
- Locally installed dependencies (`npm install`) and a clean `git status`.
- Access to Playtest environment configuration (secrets, environment variables, and scheduler settings).

## Smoke Checklist
1. `npm run build` – ensure both client and server bundles emit successfully.
2. `npm run playtest:regression` – run the scripted Vitest suites against the key moderator endpoints.
3. Launch a local Playtest session (`npm run dev`) and visit the moderator console maintenance tab to confirm metrics/incident cards hydrate.
4. Exercise the market lifecycle panel search/sort flows, confirm tag badges render, and expand/collapse recent audit payloads.
5. Hit `/api/internal/metrics/summary` and `/api/internal/incidents/recent` through Playtest to confirm they return `200` with fresh data.
6. Perform an archive dry-run followed by cancel (modal) to verify guardrails are intact, then run a system reset to ensure deterministic Redis key deletions complete without errors.

## Promotion Steps
1. `npm run deploy` to push the latest bundle into Playtest.
2. Re-run `npm run playtest:regression` pointing at the hosted instance (`PLAYTEST_VITEST_ARGS="--reporter verbose"`).
3. Execute the smoke actions above against Playtest UI; capture screenshots of metrics/incident widgets and market lifecycle search results.
4. If stable, run `npm run launch` to build, upload, and publish to production.
5. Record deployment outcome, version hash, bet history spot checks, and metric snapshots in the deployment journal.

## Rollback Guidance
- If metrics counters stall or incidents fail to fetch, invalidate the cached counters via Redis (`DEL dggpm:metrics:<subredditId>:counters`) and retry.
- For UI regressions, redeploy the last known good commit via `npm run deploy` and annotate the incident log.
- Capture `npm run playtest:regression` output and attach to the incident ticket before escalating.
