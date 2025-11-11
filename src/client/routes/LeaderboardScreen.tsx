import { useState } from 'react';
import { useLeaderboard } from '../hooks/useLeaderboard.js';
import { formatLeaderboardScore } from '../utils/format.js';

const WINDOWS: ReadonlyArray<{ readonly value: 'weekly' | 'monthly' | 'alltime'; readonly label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'alltime', label: 'All-time' },
];

export const LeaderboardScreen = () => {
  const [window, setWindow] = useState<'weekly' | 'monthly' | 'alltime'>('weekly');
  const leaderboardState = useLeaderboard(window);
  const { data, isLoading, error, refetch } = leaderboardState;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leaderboard</h1>
          <p className="text-sm text-gray-600">See who’s leading the pack for this subreddit.</p>
        </div>
        <button
          className="self-start rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-slate-100"
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
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              window === option.value
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-gray-700 border border-slate-200 hover:bg-slate-50'
            }`}
            onClick={() => setWindow(option.value)}
            disabled={window === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed to load leaderboard. Try refreshing.
        </div>
      )}

      {isLoading && !data ? (
        <p className="text-sm text-gray-600">Loading leaderboard…</p>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-gray-700">
                {data.entries.map((entry) => (
                  <tr key={entry.userId}>
                    <td className="px-4 py-3 font-semibold text-gray-900">#{entry.rank}</td>
                    <td className="px-4 py-3">{entry.username}</td>
                    <td className="px-4 py-3">{formatLeaderboardScore(entry.score)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {entry.delta !== undefined ? formatLeaderboardScore(entry.delta) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.currentUser && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-gray-700">
              <p className="font-semibold text-gray-900">Your position</p>
              <p>
                #{data.currentUser.rank} • {data.currentUser.username} —{' '}
                {formatLeaderboardScore(data.currentUser.score)} points
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-600">No leaderboard data yet.</p>
      )}
    </div>
  );
};
