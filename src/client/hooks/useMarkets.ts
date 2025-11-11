import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MarketSummary } from '../../shared/types/dto.js';
import { getMarkets, type MarketStatusFilter, type MarketsApiError } from '../api/markets.js';

interface MarketsState {
  readonly data: readonly MarketSummary[];
  readonly isLoading: boolean;
  readonly error: MarketsApiError | Error | null;
  readonly refetch: () => Promise<void>;
}

export const useMarkets = (status?: MarketStatusFilter): MarketsState => {
  const [markets, setMarkets] = useState<readonly MarketSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<MarketsApiError | Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getMarkets({
        ...(status ? { status } : {}),
        pageSize: 50,
      });
      setMarkets(response.data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load markets.'));
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const state = useMemo<MarketsState>(
    () => ({
      data: markets,
      isLoading,
      error,
      refetch: refresh,
    }),
    [markets, isLoading, error, refresh],
  );

  return state;
};
