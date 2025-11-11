import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MarketDetail } from '../../shared/types/dto.js';
import { getMarketDetail } from '../api/markets.js';
import { isApiError, type ApiError } from '../api/client.js';

interface MarketDetailState {
  readonly data: MarketDetail | null;
  readonly isLoading: boolean;
  readonly error: ApiError | Error | null;
  readonly refetch: () => Promise<void>;
  readonly setData: (market: MarketDetail) => void;
}

export const useMarketDetail = (marketId: string | null | undefined): MarketDetailState => {
  const [data, setData] = useState<MarketDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const refresh = useCallback(async () => {
    if (!marketId) {
      setData(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const detail = await getMarketDetail(marketId);
      setData(detail);
    } catch (err) {
      if (isApiError(err) || err instanceof Error) {
        setError(err);
      } else {
        setError(new Error('Failed to load market.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      data,
      isLoading,
      error,
      refetch: refresh,
      setData,
    }),
    [data, isLoading, error, refresh],
  );
};
