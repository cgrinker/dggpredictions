import { useState } from 'react';
import { useUserBets } from '../hooks/useUserBets.js';
import { isApiError } from '../api/client.js';
import { formatDateTime, formatPoints } from '../utils/format.js';
import { themeTokens } from '../utils/theme.js';

type BetsView = 'active' | 'settled';

const VIEW_OPTIONS: ReadonlyArray<{ readonly value: BetsView; readonly label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'settled', label: 'Settled' },
];

const statusLabel: Record<string, string> = {
  active: 'Active',
  won: 'Won',
  lost: 'Lost',
  refunded: 'Refunded',
};

export const BetsScreen = () => {
  const [view, setView] = useState<BetsView>('active');
  const betsState = useUserBets(view);
  const { data, isLoading, error, refetch } = betsState;

  const authError = error && isApiError(error) && (error.status === 401 || error.status === 403);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold theme-heading">My Bets</h1>
          <p className="text-sm theme-subtle">Review your active wagers and historical outcomes.</p>
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
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`btn-base px-4 py-2 text-sm ${
              view === option.value ? 'btn-toggle-active' : 'btn-toggle-inactive'
            }`}
            onClick={() => setView(option.value)}
            disabled={view === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      {authError && (
        <div className="rounded-md px-4 py-3 text-sm feedback-error">
          Sign in to view your bet history.
        </div>
      )}

      {error && !authError && (
        <div className="rounded-md px-4 py-3 text-sm feedback-error">
          Failed to load bets. Try refreshing.
        </div>
      )}

      {isLoading && data.length === 0 ? (
        <p className="text-sm theme-subtle">Loading bets…</p>
      ) : data.length === 0 ? (
        <p className="text-sm theme-subtle">
          {view === 'active' ? 'No active bets.' : 'No settled bets yet.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl theme-card p-0">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide" style={{ color: themeTokens.textSecondary, backgroundColor: 'var(--surface-muted)' }}>
              <tr>
                <th className="px-4 py-3">Market</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3">Wager</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map((bet) => (
                <tr key={bet.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium theme-heading">{bet.marketTitle}</div>
                    <div className="text-xs theme-muted">Status: {bet.marketStatus}</div>
                  </td>
                  <td className="px-4 py-3 uppercase">{bet.side}</td>
                  <td className="px-4 py-3">{formatPoints(bet.wager)}</td>
                  <td className="px-4 py-3">{statusLabel[bet.status] ?? bet.status}</td>
                  <td className="px-4 py-3 text-xs theme-muted">{formatDateTime(bet.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
