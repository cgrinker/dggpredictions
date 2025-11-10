import type { TxClientLike } from '@devvit/redis';
import type {
  LedgerEntry,
  LedgerEntryType,
  MarketId,
  Points,
  SubredditId,
  UserId,
  BetId,
} from '../../shared/types/entities.js';
import { LedgerRepository } from '../repositories/ledger.repository.js';
import { createLedgerEntryId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';

interface LedgerEntryOptions {
  readonly subredditId: SubredditId;
  readonly userId: UserId;
  readonly marketId?: MarketId | null;
  readonly betId?: BetId | null;
  readonly type: LedgerEntryType;
  readonly delta: Points;
  readonly balanceAfter: Points;
  readonly metadata?: Record<string, unknown>;
}

export class LedgerService {
  private readonly repository: LedgerRepository;

  constructor(repository = new LedgerRepository()) {
    this.repository = repository;
  }

  async record(tx: TxClientLike, options: LedgerEntryOptions): Promise<LedgerEntry> {
    const base: Omit<LedgerEntry, 'metadata'> & { metadata?: Record<string, unknown> } = {
      schemaVersion: 1,
      id: createLedgerEntryId(),
      subredditId: options.subredditId,
      userId: options.userId,
      marketId: options.marketId ?? null,
      betId: options.betId ?? null,
      type: options.type,
      delta: options.delta,
      balanceAfter: options.balanceAfter,
      createdAt: nowIso(),
    };

    if (options.metadata) {
      base.metadata = options.metadata;
    }

    const entry: LedgerEntry = base;

    await this.repository.create(tx, entry);
    return entry;
  }
}
