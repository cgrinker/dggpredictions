import { useMemo } from 'react';
import { useWallet } from '../hooks/useWallet.js';
import { isApiError } from '../api/client.js';
import { formatPoints } from '../utils/format.js';
import { themeTokens } from '../utils/theme.js';

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
        <h1 className="text-2xl font-bold theme-heading">Wallet</h1>
        <p className="text-sm theme-subtle">Track your balance and earnings across the subreddit.</p>
        <button
          className="w-fit btn-base btn-secondary px-3 py-2 text-sm"
          onClick={() => {
            void refetch();
          }}
          disabled={isLoading}
        >
          Refresh
        </button>
      </header>

      {authErrorMessage && (
        <div className="rounded-md px-4 py-3 text-sm feedback-error">
          {authErrorMessage}
        </div>
      )}

      {error && !authErrorMessage && (
        <div className="rounded-md px-4 py-3 text-sm feedback-error">
          Failed to load wallet. Try refreshing.
        </div>
      )}

      {isLoading && !data ? (
        <p className="text-sm theme-subtle">Loading wallet…</p>
      ) : data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl theme-card p-5">
            <h2 className="text-lg font-semibold theme-heading">Current Balance</h2>
            <p className="mt-2 text-3xl font-bold" style={{ color: themeTokens.textPrimary }}>
              {formatPoints(data.balance)}
            </p>
            <p className="text-xs theme-muted">Updated {new Date(data.updatedAt).toLocaleString()}</p>
          </div>
          <div className="rounded-2xl theme-card p-5">
            <h2 className="text-lg font-semibold theme-heading">Lifetime Stats</h2>
            <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm theme-muted">
              <div>
                <dt className="font-medium theme-heading text-xs">Earned</dt>
                <dd>{formatPoints(data.lifetimeEarned)}</dd>
              </div>
              <div>
                <dt className="font-medium theme-heading text-xs">Lost</dt>
                <dd>{formatPoints(data.lifetimeLost)}</dd>
              </div>
              <div>
                <dt className="font-medium theme-heading text-xs">Weekly Earned</dt>
                <dd>{formatPoints(data.weeklyEarned)}</dd>
              </div>
              <div>
                <dt className="font-medium theme-heading text-xs">Monthly Earned</dt>
                <dd>{formatPoints(data.monthlyEarned)}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-2xl theme-card p-5 md:col-span-2">
            <h2 className="text-lg font-semibold theme-heading">Active Bets</h2>
            <p className="mt-2 text-sm theme-subtle">{data.activeBets} currently active bet(s).</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};
