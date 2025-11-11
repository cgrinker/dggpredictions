import { useState } from 'react';
import { useUserBets } from '../hooks/useUserBets.js';
import { isApiError } from '../api/client.js';
import { formatDateTime, formatPoints } from '../utils/format.js';

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
          <h1 className="text-2xl font-bold text-gray-900">My Bets</h1>
          <p className="text-sm text-gray-600">Review your active wagers and historical outcomes.</p>
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
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              view === option.value
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-gray-700 border border-slate-200 hover:bg-slate-50'
            }`}
            onClick={() => setView(option.value)}
            disabled={view === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      {authError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Sign in to view your bet history.
        </div>
      )}

      {error && !authError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed to load bets. Try refreshing.
        </div>
      )}

      {isLoading && data.length === 0 ? (
        <p className="text-sm text-gray-600">Loading bets…</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-gray-600">
          {view === 'active' ? 'No active bets.' : 'No settled bets yet.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Market</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3">Wager</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-gray-700">
              {data.map((bet) => (
                <tr key={bet.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{bet.marketTitle}</div>
                    <div className="text-xs text-gray-500">Status: {bet.marketStatus}</div>
                  </td>
                  <td className="px-4 py-3 uppercase">{bet.side}</td>
                  <td className="px-4 py-3">{formatPoints(bet.wager)}</td>
                  <td className="px-4 py-3">{statusLabel[bet.status] ?? bet.status}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(bet.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
