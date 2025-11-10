import express from 'express';
import { createServer, getServerPort } from '@devvit/web/server';
import { tracingMiddleware } from './middleware/tracing.js';
import { createContextMiddleware } from './middleware/context.js';
import { errorHandler } from './middleware/error-handler.js';
import { createAppRouter } from './router.js';
import { ConfigService } from './services/config.service.js';
import { MarketsService } from './services/markets.service.js';
import { BetsService } from './services/bets.service.js';
import { MarketRepository } from './repositories/market.repository.js';
import { BetRepository } from './repositories/bet.repository.js';
import { BalanceRepository } from './repositories/balance.repository.js';
import { LedgerService } from './services/ledger.service.js';
import { LeaderboardRepository } from './repositories/leaderboard.repository.js';
import { LeaderboardService } from './services/leaderboard.service.js';
import { logger } from './logging.js';

const configService = new ConfigService();
const marketRepository = new MarketRepository();
const betRepository = new BetRepository();
const balanceRepository = new BalanceRepository();
const ledgerService = new LedgerService();
const leaderboardRepository = new LeaderboardRepository();

const marketsService = new MarketsService(marketRepository, betRepository, configService);
const betsService = new BetsService(
  marketRepository,
  betRepository,
  balanceRepository,
  ledgerService,
  configService,
);
const leaderboardService = new LeaderboardService(leaderboardRepository, configService);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

app.use(tracingMiddleware);
app.use(createContextMiddleware(configService));

const router = createAppRouter({ marketsService, betsService, leaderboardService });
app.use(router);

app.use(errorHandler);

const port = getServerPort();

const server = createServer(app);
server.on('error', (err) =>
  logger.error('server error', {
    message: err instanceof Error ? err.message : 'unknown error',
  }),
);
server.listen(port);
