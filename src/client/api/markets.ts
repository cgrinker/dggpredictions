import type {
  ApiSuccessEnvelope,
  MarketSummary,
  PaginatedResponse,
  MarketListResponse,
  MarketDetailResponse,
  MarketDetail,
  PlaceBetRequest,
  PlaceBetResponseEnvelope,
  PlaceBetResponse,
  ResolveMarketRequest,
  MarketSettlementMeta,
  ResolveMarketResponseEnvelope,
  CreateMarketRequest,
} from '../../shared/types/dto.js';
import type { Market } from '../../shared/types/entities.js';
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

export const createMarket = async (payload: CreateMarketRequest): Promise<Market> => {
  const envelope = await apiFetch<ApiSuccessEnvelope<Market>>('/api/internal/markets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return envelope.data;
};

export const publishMarket = async (
  marketId: string,
  options: { readonly autoCloseOverrideMinutes?: number | null } = {},
): Promise<ApiSuccessEnvelope<unknown>['data']> => {
  const envelope = await apiFetch<ApiSuccessEnvelope<unknown>>(
    `/api/internal/markets/${marketId}/publish`,
    {
      method: 'POST',
      ...(Object.prototype.hasOwnProperty.call(options, 'autoCloseOverrideMinutes')
        ? {
            body: JSON.stringify({
              autoCloseOverrideMinutes: options.autoCloseOverrideMinutes ?? null,
            }),
          }
        : {}),
    },
  );

  return envelope.data;
};

export const closeMarket = async (marketId: string): Promise<ApiSuccessEnvelope<unknown>['data']> => {
  const envelope = await apiFetch<ApiSuccessEnvelope<unknown>>(
    `/api/internal/markets/${marketId}/close`,
    {
      method: 'POST',
      body: JSON.stringify({ marketId }),
    },
  );

  return envelope.data;
};

export type MarketsApiError = ApiError;

export const getMarketDetail = async (marketId: string): Promise<MarketDetail> => {
  const envelope = await apiFetch<MarketDetailResponse>(`/api/markets/${marketId}`);
  return envelope.data;
};

export const placeBet = async (request: PlaceBetRequest): Promise<PlaceBetResponse> => {
  const { marketId, ...payload } = request;
  const envelope = await apiFetch<PlaceBetResponseEnvelope>(
    `/api/markets/${marketId}/bets`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  return envelope.data;
};

export interface ResolveMarketResult {
  readonly market: Market;
  readonly settlement: MarketSettlementMeta | null;
}

export const resolveMarket = async (
  marketId: string,
  payload: Pick<ResolveMarketRequest, 'resolution' | 'notes'>,
): Promise<ResolveMarketResult> => {
  const envelope = await apiFetch<ResolveMarketResponseEnvelope>(
    `/api/internal/markets/${marketId}/resolve`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  return {
    market: envelope.data,
    settlement: envelope.meta?.settlement ?? null,
  } satisfies ResolveMarketResult;
};

export const voidMarket = async (
  marketId: string,
  reason: string,
): Promise<ApiSuccessEnvelope<unknown>['data']> => {
  const envelope = await apiFetch<ApiSuccessEnvelope<unknown>>(
    `/api/internal/markets/${marketId}/void`,
    {
      method: 'POST',
      body: JSON.stringify({ marketId, reason }),
    },
  );

  return envelope.data;
};
