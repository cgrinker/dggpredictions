import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WalletSnapshot } from '../../shared/types/dto.js';
import { getWallet } from '../api/users.js';
import { isApiError, type ApiError } from '../api/client.js';

interface WalletState {
  readonly data: WalletSnapshot | null;
  readonly isLoading: boolean;
  readonly error: ApiError | Error | null;
  readonly refetch: () => Promise<void>;
}

interface UseWalletOptions {
  readonly enabled?: boolean;
}

export const useWallet = (options: UseWalletOptions = {}): WalletState => {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<WalletSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const hasFetchedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const snapshot = await getWallet();
      setData(snapshot);
    } catch (err) {
      if (isApiError(err) || err instanceof Error) {
        setError(err);
      } else {
        setError(new Error('Failed to load wallet.'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || hasFetchedRef.current) {
      return;
    }
    hasFetchedRef.current = true;
    void refresh();
  }, [enabled, refresh]);

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
