import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditLogResponse, ModeratorActionLogEntry } from '../../shared/types/dto.js';
import { getAuditLog, type AuditApiError, type GetAuditLogOptions } from '../api/audit.js';

interface AuditLogState {
  readonly data: readonly ModeratorActionLogEntry[];
  readonly fetchedAt: string | null;
  readonly isLoading: boolean;
  readonly error: AuditApiError | Error | null;
  readonly refetch: () => Promise<void>;
}

export const useAuditLog = (options: GetAuditLogOptions = {}): AuditLogState => {
  const [actions, setActions] = useState<readonly ModeratorActionLogEntry[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<AuditApiError | Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response: AuditLogResponse = await getAuditLog(options);
      setActions(response.actions);
      setFetchedAt(response.fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load audit log.'));
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo<AuditLogState>(
    () => ({
      data: actions,
      fetchedAt,
      isLoading,
      error,
      refetch: refresh,
    }),
    [actions, fetchedAt, isLoading, error, refresh],
  );
};
