import type {
  LeaderboardResponse,
  LeaderboardResponseEnvelope,
  SetLeaderboardFlairRequest,
  SetLeaderboardFlairResponse,
  SetLeaderboardFlairResponseEnvelope,
} from '../../shared/types/dto.js';
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

export const setLeaderboardFlair = async (
  payload: SetLeaderboardFlairRequest = {},
): Promise<SetLeaderboardFlairResponse> => {
  const envelope = await apiFetch<SetLeaderboardFlairResponseEnvelope>(
    '/api/leaderboard/flair',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  return envelope.data;
};
