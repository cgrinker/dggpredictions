import { useCallback, useMemo, useState } from 'react';
import type { MarketSummary } from '../../shared/types/dto.js';
import { closeMarket, publishMarket } from '../api/markets.js';
import type { ApiError } from '../api/client.js';
import { useMarkets } from '../hooks/useMarkets.js';

interface FeedbackState {
  readonly type: 'success' | 'error';
  readonly message: string;
}

const formatDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
};

const formatPoints = (value: number) => value.toLocaleString();

const isApiError = (error: unknown): error is ApiError => {
  return Boolean(error) && typeof error === 'object' && 'code' in (error as Record<string, unknown>);
};

export const MarketLifecyclePanel = () => {
  const draftState = useMarkets('draft');
  const openState = useMarkets('open');
  const { data: draftMarkets, isLoading: draftsLoading, error: draftsError, refetch: refetchDrafts } =
    draftState;
  const { data: openMarkets, isLoading: openLoading, error: openError, refetch: refetchOpen } =
    openState;
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const refreshAll = useCallback(async () => {
    await Promise.all([refetchDrafts(), refetchOpen()]);
  }, [refetchDrafts, refetchOpen]);

  const handleError = useCallback((error: unknown) => {
    if (isApiError(error)) {
      if (error.status === 401 || error.status === 403) {
        setFeedback({ type: 'error', message: 'Moderator permissions required to perform this action.' });
        return;
      }
      setFeedback({
        type: 'error',
        message: `${error.code}: ${error.message}`,
      });
      return;
    }

    setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Action failed.' });
  }, []);

  const handlePublish = useCallback(
    async (market: MarketSummary, override?: number | null) => {
      const actionKey = `${market.id}-publish`;
      setPendingAction(actionKey);
      setFeedback(null);
      try {
        await publishMarket(market.id, {
          ...(override !== undefined ? { autoCloseOverrideMinutes: override } : {}),
        });
        setFeedback({
          type: 'success',
          message: `Published “${market.title}”.`,
        });
        await refreshAll();
      } catch (error) {
        handleError(error);
      } finally {
        setPendingAction(null);
      }
    },
    [handleError, refreshAll],
  );

  const handleClose = useCallback(
    async (market: MarketSummary) => {
      const actionKey = `${market.id}-close`;
      setPendingAction(actionKey);
      setFeedback(null);
      try {
        await closeMarket(market.id);
        setFeedback({
          type: 'success',
          message: `Closed “${market.title}”.`,
        });
        await refreshAll();
      } catch (error) {
        handleError(error);
      } finally {
        setPendingAction(null);
      }
    },
    [handleError, refreshAll],
  );

  const isPending = useCallback(
    (market: MarketSummary, action: 'publish' | 'close') => pendingAction === `${market.id}-${action}`,
    [pendingAction],
  );

  const hasErrors = useMemo(() => draftsError ?? openError ?? null, [draftsError, openError]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Moderator Lifecycle Console</h1>
          <p className="text-sm text-gray-600">
            Manage draft and open markets, and trigger lifecycle actions backed by the scheduler-enabled API.
          </p>
        </div>
        <button
          className="px-4 py-2 rounded bg-slate-200 text-sm font-medium text-gray-800 hover:bg-slate-300 transition"
          onClick={refreshAll}
          disabled={draftsLoading || openLoading}
        >
          Refresh
        </button>
      </header>

      {feedback && (
        <div
          className={`rounded border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {hasErrors && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed to load markets. Try refreshing or check moderator permissions.
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Draft Markets</h2>
        {draftsLoading && draftMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">Loading drafts…</p>
        ) : draftMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">No draft markets ready to publish.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {draftMarkets.map((market) => (
              <li key={market.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{market.title}</h3>
                      <p className="text-sm text-gray-600">Closes {formatDate(market.closesAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="px-3 py-2 rounded bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={() => handlePublish(market)}
                        disabled={isPending(market, 'publish')}
                      >
                        {isPending(market, 'publish') ? 'Publishing…' : 'Publish'}
                      </button>
                      <button
                        className="px-3 py-2 rounded border border-orange-600 text-orange-700 text-sm font-medium hover:bg-orange-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={() => handlePublish(market, null)}
                        disabled={isPending(market, 'publish')}
                      >
                        {isPending(market, 'publish') ? 'Publishing…' : 'Publish w/out Auto-Close'}
                      </button>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-1 text-xs text-gray-500 sm:grid-cols-4">
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
                    <div>
                      <dt className="font-medium text-gray-700">Implied Yes</dt>
                      <dd>{market.impliedYesPayout}x</dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Open Markets</h2>
        {openLoading && openMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">Loading open markets…</p>
        ) : openMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">No open markets currently accepting bets.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {openMarkets.map((market) => (
              <li key={market.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{market.title}</h3>
                      <p className="text-sm text-gray-600">Closes {formatDate(market.closesAt)}</p>
                    </div>
                    <button
                      className="px-3 py-2 rounded bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 transition disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => handleClose(market)}
                      disabled={isPending(market, 'close')}
                    >
                      {isPending(market, 'close') ? 'Closing…' : 'Close Market'}
                    </button>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-1 text-xs text-gray-500 sm:grid-cols-4">
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
                    <div>
                      <dt className="font-medium text-gray-700">Implied No</dt>
                      <dd>{market.impliedNoPayout}x</dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
