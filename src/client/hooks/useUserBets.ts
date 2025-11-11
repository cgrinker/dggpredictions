import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BetSummary } from '../../shared/types/dto.js';
import { getUserBets } from '../api/users.js';
import { isApiError, type ApiError } from '../api/client.js';

type BetsView = 'active' | 'settled';

interface UserBetsState {
  readonly data: readonly BetSummary[];
  readonly isLoading: boolean;
  readonly error: ApiError | Error | null;
  readonly refetch: () => Promise<void>;
}

const filterSettled = (bets: readonly BetSummary[]) =>
  bets.filter((bet) => bet.status !== 'active');

export const useUserBets = (view: BetsView): UserBetsState => {
  const [data, setData] = useState<readonly BetSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getUserBets({
        ...(view === 'active' ? { status: 'active' } : {}),
        pageSize: 100,
      });

      const bets = view === 'settled' ? filterSettled(response.data) : response.data;
      setData(bets);
    } catch (err) {
      if (isApiError(err) || err instanceof Error) {
        setError(err);
      } else {
        setError(new Error('Failed to load bets.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [view]);

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
