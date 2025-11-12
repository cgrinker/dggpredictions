import { FormEvent, useMemo, useState } from 'react';
import type { BetSide } from '../../shared/types/entities.js';
import { placeBet } from '../api/markets.js';
import { isApiError, type ApiError } from '../api/client.js';
import { useMarketDetail } from '../hooks/useMarketDetail.js';
import { useWallet } from '../hooks/useWallet.js';
import { formatDateTime, formatPoints, formatRelativeTime } from '../utils/format.js';
import { themeTokens } from '../utils/theme.js';

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
      <div className="flex flex-col gap-6">
        <button
          className="self-start btn-base btn-secondary px-3 py-2 text-sm"
          onClick={onBack}
        >
          Back to markets
        </button>
        <p className="text-sm theme-subtle">Select a market from the list to view details.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        className="self-start btn-base btn-secondary px-3 py-2 text-sm"
        onClick={onBack}
      >
        Back to markets
      </button>

      {feedback && (
        <div
          className={`rounded-md px-4 py-3 text-sm ${
            feedback.type === 'success' ? 'feedback-success' : 'feedback-error'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {error && (
        <div className="rounded-md px-4 py-3 text-sm feedback-error">
          Failed to load market details.{' '}
          <button className="underline" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      )}

      {isLoading && !market ? (
        <p className="text-sm theme-subtle">Loading market…</p>
      ) : market ? (
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold theme-heading">{market.title}</h1>
            <p className="text-sm theme-subtle">Created at {formatDateTime(market.createdAt)}</p>
            <p className="text-sm theme-subtle">Closes {formatRelativeTime(market.closesAt)}</p>
          </header>

          <section className="rounded-2xl theme-card p-5">
            <h2 className="text-lg font-semibold theme-heading">Market Overview</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: themeTokens.textSecondary }}>
              {market.description}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm theme-muted sm:grid-cols-4">
              <div>
                <dt className="font-medium theme-heading text-xs">Status</dt>
                <dd className="capitalize">{market.status}</dd>
              </div>
              <div>
                <dt className="font-medium theme-heading text-xs">Pot Yes</dt>
                <dd>{formatPoints(market.potYes)}</dd>
              </div>
              <div>
                <dt className="font-medium theme-heading text-xs">Pot No</dt>
                <dd>{formatPoints(market.potNo)}</dd>
              </div>
              <div>
                <dt className="font-medium theme-heading text-xs">Total Bets</dt>
                <dd>{market.totalBets}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl theme-card p-5">
            <h2 className="text-lg font-semibold theme-heading">Your Position</h2>
            {market.userBet ? (
              <div className="mt-2 rounded-md border theme-border bg-[color:var(--surface-muted)] px-4 py-3 text-sm" style={{ color: themeTokens.textSecondary }}>
                You have bet <strong>{formatPoints(market.userBet.wager)}</strong> points on{' '}
                <strong className="uppercase">{market.userBet.side}</strong>.{' '}
                {market.userBet.status === 'active'
                  ? 'This bet is still active.'
                  : `Outcome: ${market.userBet.status}.`}
              </div>
            ) : (
              <p className="mt-2 text-sm theme-subtle">No bets placed yet.</p>
            )}
          </section>

          <section className="rounded-2xl theme-card p-5">
            <h2 className="text-lg font-semibold theme-heading">Place a Bet</h2>
            {bettingDisabledReason ? (
              <p className="mt-2 text-sm theme-subtle">{bettingDisabledReason}</p>
            ) : (
              <form className="mt-3 flex flex-col gap-4" onSubmit={handleSubmit}>
                <div className="flex items-center gap-2">
                  {(['yes', 'no'] as BetSide[]).map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={`btn-base px-4 py-2 text-sm ${
                        side === selectedSide ? 'btn-toggle-active' : 'btn-toggle-inactive'
                      }`}
                      onClick={() => setSelectedSide(side)}
                    >
                      Bet {side.toUpperCase()}
                    </button>
                  ))}
                </div>
                <label className="flex flex-col gap-1 text-sm theme-heading">
                  Wager (points)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={wager}
                    onChange={(event) => setWager(event.target.value)}
                    className="w-full input-control rounded-md px-3 py-2 text-sm"
                  />
                </label>
                {wallet && (
                  <p className="text-xs theme-muted">
                    Current balance: {formatPoints(wallet.balance)} points
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center btn-base btn-primary px-4 py-2 text-sm"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Placing bet…' : 'Place Bet'}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center btn-base btn-secondary px-4 py-2 text-sm"
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
