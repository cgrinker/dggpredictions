import { FormEvent, useMemo, useState } from 'react';
import type { BetSide } from '../../shared/types/entities.js';
import { placeBet } from '../api/markets.js';
import { isApiError, type ApiError } from '../api/client.js';
import { useMarketDetail } from '../hooks/useMarketDetail.js';
import { useWallet } from '../hooks/useWallet.js';
import { formatDateTime, formatPoints, formatRelativeTime } from '../utils/format.js';

interface MarketDetailScreenProps {
  readonly marketId: string | null;
  readonly onBack: () => void;
}

interface FeedbackState {
  readonly type: 'success' | 'error';
  readonly message: string;
}

const isAuthError = (error: ApiError | Error | null): error is ApiError => {
  if (!error || !isApiError(error)) {
    return false;
  }
  return error.status === 401 || error.status === 403;
};

export const MarketDetailScreen = ({ marketId, onBack }: MarketDetailScreenProps) => {
  const detailState = useMarketDetail(marketId);
  const { data: market, isLoading, error, refetch, setData } = detailState;

  const walletState = useWallet({ enabled: true });
  const { data: wallet, error: walletError, refetch: refreshWallet } = walletState;

  const [selectedSide, setSelectedSide] = useState<BetSide>('yes');
  const [wager, setWager] = useState<string>('100');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const bettingDisabledReason = useMemo(() => {
    if (!market) {
      return null;
    }
    if (market.status !== 'open') {
      return 'This market is no longer accepting bets.';
    }
    if (walletError && isAuthError(walletError)) {
      return 'Sign in to place a bet.';
    }
    if (wallet && wallet.balance <= 0) {
      return 'Insufficient balance to place a bet.';
    }
    return null;
  }, [market, wallet, walletError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!market) {
      return;
    }

    const wagerValue = Number.parseInt(wager, 10);
    if (!Number.isFinite(wagerValue) || wagerValue <= 0) {
      setFeedback({ type: 'error', message: 'Enter a valid wager above zero.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const response = await placeBet({
        marketId: market.id,
        side: selectedSide,
        wager: wagerValue,
      });

      setData(response.market);
      await refreshWallet();
      setFeedback({ type: 'success', message: 'Bet placed successfully!' });
      setWager(String(wagerValue));
    } catch (err) {
      if (isApiError(err)) {
        setFeedback({ type: 'error', message: `${err.code}: ${err.message}` });
      } else if (err instanceof Error) {
        setFeedback({ type: 'error', message: err.message });
      } else {
        setFeedback({ type: 'error', message: 'Failed to place bet.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!marketId) {
    return (
      <div className="flex flex-col gap-4">
        <button
          className="self-start rounded-md border border-slate-300 px-3 py-2 text-sm text-gray-700 transition hover:bg-slate-100"
          onClick={onBack}
        >
          Back to markets
        </button>
        <p className="text-sm text-gray-600">Select a market from the list to view details.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        className="self-start rounded-md border border-slate-300 px-3 py-2 text-sm text-gray-700 transition hover:bg-slate-100"
        onClick={onBack}
      >
        Back to markets
      </button>

      {feedback && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed to load market details.{' '}
          <button className="underline" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      )}

      {isLoading && !market ? (
        <p className="text-sm text-gray-600">Loading market…</p>
      ) : market ? (
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{market.title}</h1>
            <p className="text-sm text-gray-600">Created at {formatDateTime(market.createdAt)}</p>
            <p className="text-sm text-gray-600">Closes {formatRelativeTime(market.closesAt)}</p>
          </header>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Market Overview</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{market.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm text-gray-600 sm:grid-cols-4">
              <div>
                <dt className="font-medium text-gray-700">Status</dt>
                <dd className="capitalize">{market.status}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700">Pot Yes</dt>
                <dd>{formatPoints(market.potYes)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700">Pot No</dt>
                <dd>{formatPoints(market.potNo)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-700">Total Bets</dt>
                <dd>{market.totalBets}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Your Position</h2>
            {market.userBet ? (
              <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-gray-700">
                You have bet <strong>{formatPoints(market.userBet.wager)}</strong> points on{' '}
                <strong className="uppercase">{market.userBet.side}</strong>.{' '}
                {market.userBet.status === 'active'
                  ? 'This bet is still active.'
                  : `Outcome: ${market.userBet.status}.`}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-600">No bets placed yet.</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Place a Bet</h2>
            {bettingDisabledReason ? (
              <p className="mt-2 text-sm text-gray-600">{bettingDisabledReason}</p>
            ) : (
              <form className="mt-3 flex flex-col gap-4" onSubmit={handleSubmit}>
                <div className="flex items-center gap-2">
                  {(['yes', 'no'] as BetSide[]).map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
                        side === selectedSide
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-300 bg-white text-gray-700 hover:bg-slate-50'
                      }`}
                      onClick={() => setSelectedSide(side)}
                    >
                      Bet {side.toUpperCase()}
                    </button>
                  ))}
                </div>
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  Wager (points)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={wager}
                    onChange={(event) => setWager(event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                </label>
                {wallet && (
                  <p className="text-xs text-gray-500">Current balance: {formatPoints(wallet.balance)} points</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Placing bet…' : 'Place Bet'}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-slate-100"
                    onClick={() => void refetch()}
                  >
                    Refresh Market
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
};
