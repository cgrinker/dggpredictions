import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BetHistoryInterval, MarketBetHistorySeries } from '../../shared/types/dto.js';
import { getMarketHistory } from '../api/markets.js';
import { isApiError, type ApiError } from '../api/client.js';

interface MarketHistoryState {
  readonly data: MarketBetHistorySeries | null;
  readonly isLoading: boolean;
  readonly error: ApiError | Error | null;
  readonly refetch: () => Promise<void>;
}

export const useMarketHistory = (
  marketId: string | null | undefined,
  interval: BetHistoryInterval,
): MarketHistoryState => {
  const [data, setData] = useState<MarketBetHistorySeries | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const refresh = useCallback(async () => {
    if (!marketId) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await getMarketHistory(marketId, interval);
      const series = response.intervals.find((entry) => entry.interval === interval) ?? null;
      setData(series);
    } catch (err) {
      if (isApiError(err) || err instanceof Error) {
        setError(err);
      } else {
        setError(new Error('Failed to load bet history.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [marketId, interval]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      data,
      isLoading,
      error,
      refetch: refresh,
    }),
    [data, isLoading, error, refresh],
  );
};
