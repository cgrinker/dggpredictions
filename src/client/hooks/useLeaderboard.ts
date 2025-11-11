import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeaderboardResponse } from '../../shared/types/dto.js';
import { getLeaderboard } from '../api/leaderboard.js';
import { isApiError, type ApiError } from '../api/client.js';

type LeaderboardWindow = LeaderboardResponse['window'];

interface LeaderboardState {
  readonly data: LeaderboardResponse | null;
  readonly isLoading: boolean;
  readonly error: ApiError | Error | null;
  readonly refetch: () => Promise<void>;
}

export const useLeaderboard = (window: LeaderboardWindow): LeaderboardState => {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getLeaderboard({ window });
      setData(response);
    } catch (err) {
      if (isApiError(err) || err instanceof Error) {
        setError(err);
      } else {
        setError(new Error('Failed to load leaderboard.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [window]);

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
