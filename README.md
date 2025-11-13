## dggpredictions

This is a **play money** prediction market intended for use on the /r/destiny subreddit. As a politics subreddit /r/destiny users make strong predictions, some might even say *hot takes* about political predictions. This app offers and opportunity for redditers to put their (fake) money where their mouth is.

## The UX Flow Of The App Is as follows:
1) A Moderator Creates a Prediction:
```
Will there be a vote on extended ACA Credits in December?
This market resolves to YES if the senate votes on extending enhanced ACA credits before Janurary 1st, 2026.
Market Closes no later Janurary 1st, 2026
```
2) Users open the app and are credited a base balance of points.
3) Users may select YES or NO and allocate a percentage of their points to a market
4) A moderator determines that a market's condition has resolved and chooses YES or NO.
4) Users who selected incorrectly lose their points allocated.
5) Users who selected correctly get their allocated points back and a portion of the losing side with the following formula:
```tsx
const totalPool = supportingPot + opposingPot;
const raw = (wager / supportingPot) * totalPool;
const payout = Math.max(wager, Math.floor(raw));
```
6) For the duration of a season of play (until people get bored or we run out of redis space) users total winnings and losses are tallied on a ledger and displayed on a leaderboard. Users have the option of setting their subreddit flair to their current leaderboard ranking for some fun community engagement.


## Data usage and privacy
* This app makes uses of the Redis storage (for app state) and the reddit CDN for storing splash images for the markets. Currently no information about users is stored outside of Reddit. We've run some rough calculations about data usage:

| Data slice | Per-item footprint | Example volume | Approx usage | Notes |
| - | - | - | - | - |
| Market record | ≈1.2 KB | 500 concurrent markets | ≈0.6 MB | Includes hash + status/all indices; scheduler key adds a few bytes while open |
| Settled bet (incl. ledger) | ≈0.8 KB | 50 000 lifetime bets | ≈40 MB | Covers bet hash, market/user indices, ledger entry; active bets add ~0.1 KB for pointers |
| User balance snapshot | ≈0.2 KB | 5 000 participants | ≈1.0 MB | Balance hash with lifetime/period deltas |
| Leaderboard entry (3 windows) | ≈0.18 KB | 5 000 participants | ≈0.9 MB | Weekly, monthly, all-time sorted sets + metadata |
| Moderator audit log | ≈0.45 KB | 2 000 actions retained | ≈0.9 MB | Payload dominates; trim list to reclaim space |
| Config, metrics, misc. | — | — | ≈1.5 MB | Cached settings, reset bookkeeping, incident feed, safety headroom |


