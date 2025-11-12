import { useCallback, useEffect, useState } from 'react';
import { getSession } from '../api/session.js';
import type { SessionInfo } from '../../shared/types/dto.js';
import type { ApiError } from '../api/client.js';

interface SessionState {
  readonly data: SessionInfo | null;
  readonly isLoading: boolean;
  readonly error: ApiError | Error | null;
  readonly refetch: () => Promise<void>;
}

export const useSession = (): SessionState => {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isLoading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getSession();
      setSession(result);
    } catch (err) {
      setSession(null);
      setError(err instanceof Error ? err : new Error('Failed to load session.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data: session,
    isLoading,
    error,
    refetch: refresh,
  } satisfies SessionState;
};
