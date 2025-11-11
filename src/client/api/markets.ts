import type {
  ApiSuccessEnvelope,
  MarketSummary,
  PaginatedResponse,
  PublishMarketRequest,
  MarketListResponse,
} from '../../shared/types/dto.js';
import { apiFetch, type ApiError } from './client.js';

export type MarketStatusFilter = 'draft' | 'open' | 'closed' | 'resolved' | 'void';

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

export const getMarkets = async (options: {
  readonly status?: MarketStatusFilter;
  readonly page?: number;
  readonly pageSize?: number;
} = {}): Promise<PaginatedResponse<MarketSummary>> => {
  const query = buildQueryString({
    status: options.status,
    page: options.page,
    pageSize: options.pageSize,
  });

  const envelope = await apiFetch<MarketListResponse>(`/api/markets${query}`);
  return envelope.data;
};

export const publishMarket = async (
  marketId: string,
  options: { readonly autoCloseOverrideMinutes?: number | null } = {},
): Promise<ApiSuccessEnvelope<unknown>['data']> => {
  const body: PublishMarketRequest = {
    marketId: marketId as PublishMarketRequest['marketId'],
    ...(Object.prototype.hasOwnProperty.call(options, 'autoCloseOverrideMinutes')
      ? { autoCloseOverrideMinutes: options.autoCloseOverrideMinutes ?? null }
      : {}),
  };

  const envelope = await apiFetch<ApiSuccessEnvelope<unknown>>(
    `/internal/markets/${marketId}/publish`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  return envelope.data;
};

export const closeMarket = async (marketId: string): Promise<ApiSuccessEnvelope<unknown>['data']> => {
  const envelope = await apiFetch<ApiSuccessEnvelope<unknown>>(
    `/internal/markets/${marketId}/close`,
    {
      method: 'POST',
      body: JSON.stringify({ marketId }),
    },
  );

  return envelope.data;
};

export type MarketsApiError = ApiError;
