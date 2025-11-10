import type { LedgerEntry, LedgerEntryId, SubredditId } from '../../shared/types/entities.js';
import type { TxClientLike } from '@devvit/redis';
import { redisClient } from '../redis-client.js';
import { balanceKeys, ledgerKeys } from '../utils/redis-keys.js';
import { deserializeLedgerEntry, serializeLedgerEntry } from '../utils/serializers.js';
import { toEpochMillis } from '../utils/time.js';

export class LedgerRepository {
  async getById(subredditId: SubredditId, entryId: LedgerEntryId): Promise<LedgerEntry | null> {
    const key = ledgerKeys.entry(subredditId, entryId);
    const hash = await redisClient.hGetAll(key);
    return deserializeLedgerEntry(hash);
  }

  async create(tx: TxClientLike, entry: LedgerEntry): Promise<void> {
    const key = ledgerKeys.entry(entry.subredditId, entry.id);
    const indexKey = balanceKeys.ledgerIndex(entry.subredditId, entry.userId);
    await tx.zAdd(indexKey, { score: toEpochMillis(entry.createdAt), member: entry.id });
    await tx.hSet(key, serializeLedgerEntry(entry));
  }
}
