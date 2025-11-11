import type {
  WalletSnapshot,
  WalletResponse,
  UserBetsResponse,
  BetSummary,
  PaginatedResponse,
} from '../../shared/types/dto.js';
import { apiFetch, type ApiError } from './client.js';

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

export const getWallet = async (): Promise<WalletSnapshot> => {
  const envelope = await apiFetch<WalletResponse>('/api/users/me/balance');
  return envelope.data;
};

export const getUserBets = async (options: {
  readonly status?: 'active' | 'won' | 'lost' | 'refunded';
  readonly page?: number;
  readonly pageSize?: number;
} = {}): Promise<PaginatedResponse<BetSummary>> => {
  const query = buildQueryString({
    status: options.status,
    page: options.page,
    pageSize: options.pageSize,
  });

  const envelope = await apiFetch<UserBetsResponse>(`/api/users/me/bets${query}`);
  return envelope.data;
};

export type UsersApiError = ApiError;
