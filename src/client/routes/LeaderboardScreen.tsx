import { useCallback, useState } from 'react';
import { useLeaderboard } from '../hooks/useLeaderboard.js';
import { formatLeaderboardScore } from '../utils/format.js';
import { themeTokens } from '../utils/theme.js';
import { setLeaderboardFlair } from '../api/leaderboard.js';
import { isApiError } from '../api/client.js';

const WINDOWS: ReadonlyArray<{ readonly value: 'weekly' | 'monthly' | 'alltime'; readonly label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'alltime', label: 'All-time' },
];

export const LeaderboardScreen = () => {
  const [window, setWindow] = useState<'weekly' | 'monthly' | 'alltime'>('weekly');
  const leaderboardState = useLeaderboard(window);
  const { data, isLoading, error, refetch } = leaderboardState;
  const [isUpdatingFlair, setIsUpdatingFlair] = useState(false);
  const [flairFeedback, setFlairFeedback] = useState<
    { readonly type: 'success' | 'error'; readonly message: string }
    | null
  >(null);

  const handleSetFlair = useCallback(async () => {
    if (!data?.currentUser) {
      setFlairFeedback({
        type: 'error',
        message: 'You need a leaderboard rank before updating flair.',
      });
      return;
    }

    setIsUpdatingFlair(true);
    setFlairFeedback(null);

    try {
      const result = await setLeaderboardFlair({ window });
      setFlairFeedback({
        type: 'success',
        message: `Flair updated to “${result.flairText}”.`,
      });
    } catch (err) {
      if (isApiError(err)) {
        setFlairFeedback({ type: 'error', message: err.message });
      } else if (err instanceof Error) {
        setFlairFeedback({ type: 'error', message: err.message });
      } else {
        setFlairFeedback({
          type: 'error',
          message: 'Failed to update flair. Please try again.',
        });
      }
    } finally {
      setIsUpdatingFlair(false);
    }
  }, [data, window]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold theme-heading">Leaderboard</h1>
          <p className="text-sm theme-subtle">See who’s leading the pack for this subreddit.</p>
        </div>
        <button
          className="self-start btn-base btn-secondary px-3 py-2 text-sm"
          onClick={() => {
            void refetch();
          }}
          disabled={isLoading}
        >
          Refresh
        </button>
      </header>

      <div className="flex gap-2">
        {WINDOWS.map((option) => (
          <button
            key={option.value}
            className={`btn-base px-4 py-2 text-sm ${
              window === option.value ? 'btn-toggle-active' : 'btn-toggle-inactive'
            }`}
            onClick={() => setWindow(option.value)}
            disabled={window === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm feedback-error">
          Failed to load leaderboard. Try refreshing.
        </div>
      )}

      {isLoading && !data ? (
        <p className="text-sm theme-subtle">Loading leaderboard…</p>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-2xl theme-card p-0">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide" style={{ color: themeTokens.textSecondary, backgroundColor: 'var(--surface-muted)' }}>
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Δ</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.userId}>
                    <td className="px-4 py-3 font-semibold theme-heading">#{entry.rank}</td>
                    <td className="px-4 py-3">{entry.username}</td>
                    <td className="px-4 py-3">{formatLeaderboardScore(entry.score)}</td>
                    <td className="px-4 py-3 text-xs theme-muted">
                      {entry.delta !== undefined ? formatLeaderboardScore(entry.delta) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.currentUser && (
            <div className="rounded-md border theme-border bg-[color:var(--surface-muted)] px-4 py-3 text-sm" style={{ color: themeTokens.textSecondary }}>
              <p className="font-semibold theme-heading">Your position</p>
              <p>
                #{data.currentUser.rank} • {data.currentUser.username} —{' '}
                {formatLeaderboardScore(data.currentUser.score)} points
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  className="btn-base btn-primary px-3 py-2 text-sm"
                  onClick={() => {
                    void handleSetFlair();
                  }}
                  disabled={isUpdatingFlair}
                >
                  {isUpdatingFlair ? 'Updating flair…' : 'Set flair to rank'}
                </button>
                {flairFeedback && (
                  <div
                    className={`rounded px-3 py-2 text-xs ${
                      flairFeedback.type === 'success' ? 'feedback-success' : 'feedback-error'
                    }`}
                  >
                    {flairFeedback.message}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm theme-subtle">No leaderboard data yet.</p>
      )}
    </div>
  );
};
