import { useMemo } from 'react';
import { useWallet } from '../hooks/useWallet.js';
import { isApiError } from '../api/client.js';
import { formatPoints } from '../utils/format.js';

export const WalletScreen = () => {
  const walletState = useWallet({ enabled: true });
  const { data, isLoading, error, refetch } = walletState;

  const authErrorMessage = useMemo(() => {
    if (!error || !isApiError(error)) {
      return null;
    }
    if (error.status === 401) {
      return 'Sign in to view your wallet.';
    }
    if (error.status === 403) {
      return 'You need participant access to view balances.';
    }
    return null;
  }, [error]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Wallet</h1>
        <p className="text-sm text-gray-600">Track your balance and earnings across the subreddit.</p>
        <button
          className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-slate-100"
          onClick={() => {
            void refetch();
          }}
          disabled={isLoading}
        >
          Refresh
        </button>
      </header>

      {authErrorMessage && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {authErrorMessage}
        </div>
      )}

      {error && !authErrorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed to load wallet. Try refreshing.
        </div>
      )}

      {isLoading && !data ? (
        <p className="text-sm text-gray-600">Loading wallet…</p>
      ) : data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Current Balance</h2>
            <p className="mt-2 text-3xl font-bold text-slate-900">{formatPoints(data.balance)}</p>
            <p className="text-xs text-gray-500">Updated {new Date(data.updatedAt).toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Lifetime Stats</h2>
            <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm text-gray-600">
              <div>
                <dt className="font-medium text-gray-700">Earned</dt>
                <dd>{formatPoints(data.lifetimeEarned)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700">Lost</dt>
                <dd>{formatPoints(data.lifetimeLost)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700">Weekly Earned</dt>
                <dd>{formatPoints(data.weeklyEarned)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700">Monthly Earned</dt>
                <dd>{formatPoints(data.monthlyEarned)}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:col-span-2">
            <h2 className="text-lg font-semibold text-gray-900">Active Bets</h2>
            <p className="mt-2 text-sm text-gray-600">{data.activeBets} currently active bet(s).</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};
