import type { LeaderboardResponse, LeaderboardResponseEnvelope } from '../../shared/types/dto.js';
import { apiFetch } from './client.js';

type LeaderboardWindow = LeaderboardResponse['window'];

type LeaderboardRequestOptions = {
  readonly window?: LeaderboardWindow;
  readonly limit?: number;
};

const buildQueryString = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    search.set(key, String(value));
  });
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
};

export const getLeaderboard = async (
  options: LeaderboardRequestOptions = {},
): Promise<LeaderboardResponse> => {
  const query = buildQueryString({
    window: options.window,
    limit: options.limit,
  });

  const envelope = await apiFetch<LeaderboardResponseEnvelope>(`/api/leaderboard${query}`);
  return envelope.data;
};
