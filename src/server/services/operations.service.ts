import type { SubredditId } from '../../shared/types/entities.js';
import type { IncidentFeed, IncidentSummary, MetricsSummary } from '../../shared/types/dto.js';
import { MarketRepository } from '../repositories/market.repository.js';
import { nowIso } from '../utils/time.js';

interface IncidentProvider {
  getRecent(subredditId: SubredditId, limit?: number): Promise<readonly IncidentSummary[]>;
}

const INCIDENT_LIMIT = 20;

export class OperationsService {
  private readonly markets: MarketRepository;
  private readonly incidents: IncidentProvider | null;

  constructor(markets = new MarketRepository(), incidents: IncidentProvider | null = null) {
    this.markets = markets;
    this.incidents = incidents;
  }

  async getMetricsSummary(subredditId: SubredditId): Promise<MetricsSummary> {
    const counts = await this.markets.countByStatus(subredditId);

    return {
      counters: {
        totalMarkets: counts.total,
        draftMarkets: counts.byStatus.draft,
        openMarkets: counts.byStatus.open,
        closedMarkets: counts.byStatus.closed,
        resolvedMarkets: counts.byStatus.resolved,
        voidMarkets: counts.byStatus.void,
      },
      updatedAt: nowIso(),
    } satisfies MetricsSummary;
  }

  async getIncidentFeed(subredditId: SubredditId): Promise<IncidentFeed> {
    const incidents = this.incidents
      ? await this.incidents.getRecent(subredditId, INCIDENT_LIMIT)
      : [];

    return {
      incidents,
      fetchedAt: nowIso(),
    } satisfies IncidentFeed;
  }
}
