import type {
  Bet,
  Market,
  MarketId,
  MarketStatus,
  SubredditId,
  UserId,
} from '../../shared/types/entities.js';
import type { MarketDetail, MarketSummary, PaginatedResponse } from '../../shared/types/dto.js';
import { MarketRepository } from '../repositories/market.repository.js';
import { BetRepository } from '../repositories/bet.repository.js';
import { ConfigService } from './config.service.js';
import { createMarketId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';
import type { CreateMarketRequest } from '../../shared/types/dto.js';
import { NotFoundError, ValidationError } from '../errors.js';

interface ListMarketsOptions {
  readonly status?: MarketStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

export class MarketsService {
  private readonly markets: MarketRepository;
  private readonly bets: BetRepository;
  private readonly config: ConfigService;

  constructor(
    markets = new MarketRepository(),
    bets = new BetRepository(),
    config = new ConfigService(),
  ) {
    this.markets = markets;
    this.bets = bets;
    this.config = config;
  }

  async list(
    subredditId: SubredditId,
    options?: ListMarketsOptions,
    userId?: UserId | null,
  ): Promise<PaginatedResponse<MarketSummary>> {
    const { markets, total } = await this.markets.list(subredditId, options);

    void userId; // reserved for future personalization

    const data = markets.map((market) => this.toMarketSummary(market));

    return {
      data,
      pagination: {
        page: options?.page ?? 1,
        pageSize: options?.pageSize ?? markets.length,
        total,
      },
    } satisfies PaginatedResponse<MarketSummary>;
  }

  async getDetail(
    subredditId: SubredditId,
    marketId: MarketId,
    userId?: UserId | null,
  ): Promise<MarketDetail> {
    const market = await this.markets.getById(subredditId, marketId);
    if (!market) {
      throw new NotFoundError(`Market ${marketId} not found.`);
    }

    const userBet = userId ? await this.findUserBet(subredditId, marketId, userId) : null;
    return { ...market, userBet } satisfies MarketDetail;
  }

  async createDraft(
    subredditId: SubredditId,
    creatorId: UserId,
    payload: CreateMarketRequest,
  ): Promise<Market> {
    this.ensureCloseTimeIsValid(payload.closesAt);
    const config = await this.config.getConfig(subredditId);

    if (config.maxOpenMarkets !== null) {
      const existingOpen = await this.markets.list(subredditId, { status: 'open' });
      if (existingOpen.total >= config.maxOpenMarkets) {
        throw new ValidationError('Maximum number of open markets reached.');
      }
    }

    const metadata = payload.tags && payload.tags.length > 0 ? { tags: payload.tags } : undefined;
    const base: Omit<Market, 'metadata'> & { metadata?: Record<string, unknown> } = {
      schemaVersion: 1,
      id: createMarketId(),
      subredditId,
      title: payload.title,
      description: payload.description,
      createdBy: creatorId,
      createdAt: nowIso(),
      closesAt: payload.closesAt,
      resolvedAt: null,
      status: 'draft',
      resolution: null,
      potYes: 0,
      potNo: 0,
      totalBets: 0,
    };

    if (metadata) {
      base.metadata = metadata;
    }

    const market: Market = base;

    await this.markets.create(subredditId, market);
    return market;
  }

  private ensureCloseTimeIsValid(raw: string) {
    const closesAt = Date.parse(raw);
    if (Number.isNaN(closesAt)) {
      throw new ValidationError('closesAt must be an ISO-8601 timestamp.');
    }

    if (closesAt <= Date.now()) {
      throw new ValidationError('closesAt must be in the future.');
    }
  }

  private async findUserBet(
    subredditId: SubredditId,
    marketId: MarketId,
    userId: UserId,
  ): Promise<Bet | null> {
    const pointer = await this.markets.getUserBetPointer(subredditId, marketId, userId);
    if (!pointer) {
      return null;
    }

    return this.bets.getById(subredditId, pointer);
  }

  private toMarketSummary(market: Market): MarketSummary {
    const impliedYesPayout = this.calculateImpliedPayout(market.potYes, market.potNo);
    const impliedNoPayout = this.calculateImpliedPayout(market.potNo, market.potYes);

    return {
      id: market.id,
      title: market.title,
      status: market.status,
      closesAt: market.closesAt,
      potYes: market.potYes,
      potNo: market.potNo,
      totalBets: market.totalBets,
      impliedYesPayout,
      impliedNoPayout,
    } satisfies MarketSummary;
  }

  private calculateImpliedPayout(potFor: number, potAgainst: number): number {
    const sanitizedFor = potFor > 0 ? potFor : 1;
    const totalPool = potFor + potAgainst;
    if (totalPool === 0) {
      return 1;
    }

    const odds = potAgainst / sanitizedFor;
    return Number.parseFloat((1 + odds).toFixed(2));
  }
}
