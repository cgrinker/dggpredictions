import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BetSide } from '../../shared/types/entities.js';
import type { BetHistoryInterval } from '../../shared/types/dto.js';
import { placeBet } from '../api/markets.js';
import { isApiError, type ApiError } from '../api/client.js';
import { useMarketDetail } from '../hooks/useMarketDetail.js';
import { useWallet } from '../hooks/useWallet.js';
import { useMarketHistory } from '../hooks/useMarketHistory.js';
import { formatDateTime, formatPoints, formatRelativeTime } from '../utils/format.js';
import { themeTokens } from '../utils/theme.js';
import defaultIcon from '../../../assets/default-icon.png';
import {
  VictoryAxis,
  VictoryChart,
  VictoryLine,
  VictoryTooltip,
  VictoryVoronoiContainer,
  VictoryTheme,
} from 'victory';

interface MarketDetailScreenProps {
  readonly marketId: string | null;
  readonly onBack: () => void;
}

interface FeedbackState {
  readonly type: 'success' | 'error';
  readonly message: string;
}

const HISTORY_INTERVAL_OPTIONS: ReadonlyArray<{ value: BetHistoryInterval; label: string }> = [
  { value: 'hour', label: 'Hourly' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

const YES_LINE_COLOR = '#22c55e';

type ChartPoint = {
  readonly timestamp: number;
  readonly yesPercentage: number;
  readonly rangeLabel: string;
};

const createTickFormatter = (interval: BetHistoryInterval) => {
  const toDate = (input: Date | number): Date => (input instanceof Date ? input : new Date(input));

  switch (interval) {
    case 'hour': {
      const formatter = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      return (value: Date | number) => formatter.format(toDate(value));
    }
    case 'day': {
      const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
      return (value: Date | number) => formatter.format(toDate(value));
    }
    case 'week': {
      const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
      return (value: Date | number) => formatter.format(toDate(value));
    }
    case 'month':
    default: {
      const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
      return (value: Date | number) => formatter.format(toDate(value));
    }
  }
};

const createRangeFormatter = (interval: BetHistoryInterval) => {
  const adjustEnd = (end: Date): Date => new Date(end.getTime() - 1);

  switch (interval) {
    case 'hour': {
      const startFormatter = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const endFormatter = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
      return (start: Date, end: Date) => {
        const inclusiveEnd = adjustEnd(end);
        return `${startFormatter.format(start)} – ${endFormatter.format(inclusiveEnd)}`;
      };
    }
    case 'day': {
      const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
      return (start: Date, _end: Date) => formatter.format(start);
    }
    case 'week': {
      const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
      return (start: Date, end: Date) => {
        const inclusiveEnd = adjustEnd(end);
        return `${formatter.format(start)} – ${formatter.format(inclusiveEnd)}`;
      };
    }
    case 'month':
    default: {
      const formatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
      return (start: Date, _end: Date) => formatter.format(start);
    }
  }
};

const isAuthError = (error: ApiError | Error | null): error is ApiError => {
  if (!error || !isApiError(error)) {
    return false;
  }
  return error.status === 401 || error.status === 403;
};

export const MarketDetailScreen = ({ marketId, onBack }: MarketDetailScreenProps) => {
  const detailState = useMarketDetail(marketId);
  const { data: market, isLoading, error, refetch, setData } = detailState;

  const walletState = useWallet({ enabled: true });
  const { data: wallet, error: walletError, refetch: refreshWallet } = walletState;

  const [selectedSide, setSelectedSide] = useState<BetSide>('yes');
  const [wager, setWager] = useState<string>('100');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedInterval, setSelectedInterval] = useState<BetHistoryInterval>('day');
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const { data: historySeries, isLoading: historyLoading, error: historyError } =
    useMarketHistory(marketId, selectedInterval);

  useEffect(() => {
    setSelectedInterval('day');
  }, [marketId]);

  const rangeFormatter = useMemo(
    () => createRangeFormatter(selectedInterval),
    [selectedInterval],
  );

  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }),
    [],
  );

  const formatPercent = useCallback(
    (value: number) => `${percentFormatter.format(Math.max(0, Math.min(100, value)))}%`,
    [percentFormatter],
  );

  const chartData = useMemo((): ChartPoint[] => {
    if (!historySeries) {
      return [];
    }

    return historySeries.points.map((point) => {
      const startDate = new Date(point.start);
      const endDate = new Date(point.end);
      const timestamp = Date.parse(point.start);
      const totalPot = point.cumulativePotYes + point.cumulativePotNo;
      const yesPercentage = totalPot > 0 ? (point.cumulativePotYes / totalPot) * 100 : 0;
      return {
        timestamp,
        yesPercentage,
        rangeLabel: rangeFormatter(startDate, endDate),
      } satisfies ChartPoint;
    });
  }, [historySeries, rangeFormatter]);

  useLayoutEffect(() => {
    const element = chartContainerRef.current;
    if (!element) {
      return;
    }

    let rafId: number | null = null;

    const calculateSize = () => {
      const rect = element.getBoundingClientRect();
      const width =
        rect.width ||
        element.clientWidth ||
        element.offsetWidth ||
        element.parentElement?.getBoundingClientRect().width ||
        0;

      if (width === 0) {
        rafId = window.requestAnimationFrame(calculateSize);
        return;
      }

      const height = Math.max(240, Math.min(420, width * 0.6));
      setChartSize({ width, height });
    };

    calculateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        calculateSize();
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
        }
      };
    }

    const handleResize = () => calculateSize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [chartData.length]);

  const tickFormatter = useMemo(() => createTickFormatter(selectedInterval), [selectedInterval]);

  const yesLineData = useMemo(
    () =>
      chartData.map((point) => ({
        x: new Date(point.timestamp),
        y: point.yesPercentage,
        rangeLabel: point.rangeLabel,
        series: 'Yes Probability' as const,
      })),
    [chartData],
  );

  const xTickValues = useMemo(() => {
    if (chartData.length === 0) {
      return [] as Date[];
    }

    const width = chartSize.width;
    const maxTicks = width > 600 ? 8 : width > 460 ? 6 : 3;
    const desired = Math.min(maxTicks, chartData.length);
    if (desired <= 1) {
      return [new Date(chartData[0]?.timestamp ?? Date.now())];
    }

    const step = (chartData.length - 1) / (desired - 1);
    const ticks: Date[] = [];
    for (let index = 0; index < desired; index += 1) {
      const dataIndex = Math.round(index * step);
      const point = chartData[Math.min(dataIndex, chartData.length - 1)];
      if (!point) {
        continue;
      }
      ticks.push(new Date(point.timestamp));
    }

    return ticks;
  }, [chartData, chartSize.width]);

  const bettingDisabledReason = useMemo(() => {
    if (!market) {
      return null;
    }
    if (market.status !== 'open') {
      return 'This market is no longer accepting bets.';
    }
    if (walletError && isAuthError(walletError)) {
      return 'Sign in to place a bet.';
    }
    if (wallet && wallet.balance <= 0) {
      return 'Insufficient balance to place a bet.';
    }
    return null;
  }, [market, wallet, walletError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!market) {
      return;
    }

    const wagerValue = Number.parseInt(wager, 10);
    if (!Number.isFinite(wagerValue) || wagerValue <= 0) {
      setFeedback({ type: 'error', message: 'Enter a valid wager above zero.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const response = await placeBet({
        marketId: market.id,
        side: selectedSide,
        wager: wagerValue,
      });

      setData(response.market);
      await refreshWallet();
      setFeedback({ type: 'success', message: 'Bet placed successfully!' });
      setWager(String(wagerValue));
    } catch (err) {
      if (isApiError(err)) {
        setFeedback({ type: 'error', message: `${err.code}: ${err.message}` });
      } else if (err instanceof Error) {
        setFeedback({ type: 'error', message: err.message });
      } else {
        setFeedback({ type: 'error', message: 'Failed to place bet.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!marketId) {
    return (
      <div className="flex flex-col gap-6">
        <button
          className="self-start btn-base btn-secondary px-3 py-2 text-sm"
          onClick={onBack}
        >
          Back to markets
        </button>
        <p className="text-sm theme-subtle">Select a market from the list to view details.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        className="self-start btn-base btn-secondary px-3 py-2 text-sm"
        onClick={onBack}
      >
        Back to markets
      </button>

      {feedback && (
        <div
          className={`rounded-md px-4 py-3 text-sm ${
            feedback.type === 'success' ? 'feedback-success' : 'feedback-error'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {error && (
        <div className="rounded-md px-4 py-3 text-sm feedback-error">
          Failed to load market details.{' '}
          <button className="underline" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      )}

      {isLoading && !market ? (
        <p className="text-sm theme-subtle">Loading market…</p>
      ) : market ? (
        <div className="flex flex-col gap-6">
          <div className="overflow-hidden rounded-2xl bg-[color:var(--surface-muted)] aspect-square w-full max-w-sm sm:max-w-md self-center sm:self-start">
            <img
              src={market.imageUrl ?? defaultIcon}
              alt={market.title}
              className="h-full w-full object-cover"
            />
          </div>
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold theme-heading">{market.title}</h1>
            <p className="text-sm theme-subtle">Created at {formatDateTime(market.createdAt)}</p>
            <p className="text-sm theme-subtle">Closes {formatRelativeTime(market.closesAt)}</p>
          </header>

          <section className="rounded-2xl theme-card p-5">
            <h2 className="text-lg font-semibold theme-heading">Market Overview</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: themeTokens.textSecondary }}>
              {market.description}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm theme-muted sm:grid-cols-4">
              <div>
                <dt className="font-medium theme-heading text-xs">Status</dt>
                <dd className="capitalize">{market.status}</dd>
              </div>
              <div>
                <dt className="font-medium theme-heading text-xs">Pot Yes</dt>
                <dd>{formatPoints(market.potYes)}</dd>
              </div>
              <div>
                <dt className="font-medium theme-heading text-xs">Pot No</dt>
                <dd>{formatPoints(market.potNo)}</dd>
              </div>
              <div>
                <dt className="font-medium theme-heading text-xs">Total Bets</dt>
                <dd>{market.totalBets}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl theme-card p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold theme-heading">Bet Activity</h2>
                <p className="text-sm theme-subtle">
                  Cumulative points placed over the selected interval.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {HISTORY_INTERVAL_OPTIONS.map((option) => {
                  const isActive = selectedInterval === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`btn-base px-3 py-1.5 text-xs sm:text-sm ${isActive ? 'btn-toggle-active' : 'btn-toggle-inactive'}`}
                      onClick={() => setSelectedInterval(option.value)}
                      disabled={isActive}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {historyError ? (
              <div className="rounded px-4 py-3 text-sm feedback-error">
                Failed to load bet history. Try refreshing the interval.
              </div>
            ) : historyLoading && chartData.length === 0 ? (
              <p className="text-sm theme-subtle">Loading bet history…</p>
            ) : chartData.length === 0 ? (
              <p className="text-sm theme-subtle">No bets recorded yet.</p>
            ) : chartData.length === 1 ? (
              <p className="text-sm theme-subtle">
                Not enough datapoints, choose a different interval.
              </p>
            ) : (
              <div ref={chartContainerRef} className="w-full">
                {chartSize.width === 0 ? (
                  <p className="text-sm theme-subtle">Preparing chart…</p>
                ) : (
                  <>
                    <VictoryChart
                      theme={VictoryTheme.material}
                      width={chartSize.width}
                      height={chartSize.height}
                      padding={{ top: 20, right: 32, bottom: 52, left: 72 }}
                      scale={{ x: 'time', y: 'linear' }}
                      domain={{ y: [0, 100] }}
                      domainPadding={{ y: [20, 20] }}
                      containerComponent={
                        <VictoryVoronoiContainer
                          voronoiDimension="x"
                          labels={({
                            datum,
                          }: {
                            datum: { y: number | string; rangeLabel: string; series: string };
                          }) =>
                            `${datum.rangeLabel}\n${datum.series}: ${formatPercent(
                              typeof datum.y === 'number' ? datum.y : Number(datum.y),
                            )}`
                          }
                          labelComponent={
                            <VictoryTooltip
                              flyoutStyle={{
                                fill: 'var(--surface-tooltip, rgba(15,23,42,0.85))',
                                stroke: 'var(--border-muted, #94a3b8)',
                              }}
                              style={{ fill: 'var(--text-primary, #0f172a)', fontSize: 12 }}
                              cornerRadius={6}
                              pointerLength={8}
                            />
                          }
                        />
                      }
                    >
                      <VictoryAxis
                        tickValues={xTickValues}
                        tickFormat={(value: Date | number) => tickFormatter(value)}
                        style={{
                          axis: { stroke: 'var(--border-muted, #cbd5f5)', strokeWidth: 1 },
                          grid: { stroke: 'transparent' },
                          tickLabels: {
                            fill: 'var(--text-muted, #64748b)',
                            fontSize: 12,
                            padding: 8,
                          },
                        }}
                      />
                      <VictoryAxis
                        dependentAxis
                        tickFormat={(value: number | string) => {
                          const numeric =
                            typeof value === 'number' ? value : Number.parseFloat(String(value));
                          return formatPercent(Number.isFinite(numeric) ? numeric : 0);
                        }}
                        style={{
                          axis: { stroke: 'var(--border-muted, #cbd5f5)', strokeWidth: 1 },
                          grid: {
                            stroke: 'var(--border-muted, rgba(203,213,225,0.4))',
                            strokeDasharray: '4,4',
                          },
                          tickLabels: {
                            fill: 'var(--text-muted, #64748b)',
                            fontSize: 12,
                            padding: 4,
                          },
                        }}
                      />
                      <VictoryLine
                        data={yesLineData}
                        interpolation="monotoneX"
                        style={{ data: { stroke: YES_LINE_COLOR, strokeWidth: 2 } }}
                      />
                    </VictoryChart>
                    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs sm:text-sm theme-muted">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: YES_LINE_COLOR }}
                        />
                        <span>Yes Probability</span>
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
            {historyLoading && chartData.length > 0 ? (
              <span className="text-xs theme-muted">Refreshing…</span>
            ) : null}
          </section>

          <section className="rounded-2xl theme-card p-5">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold theme-heading">Place a Bet</h2>
                {market.userBet ? (
                  <div
                    className="rounded-md border theme-border bg-[color:var(--surface-muted)] px-4 py-3 text-sm"
                    style={{ color: themeTokens.textSecondary }}
                  >
                    Current bet: <strong>{formatPoints(market.userBet.wager)}</strong> points on{' '}
                    <strong className="uppercase">{market.userBet.side}</strong>.{' '}
                    {market.userBet.status === 'active'
                      ? 'This bet is still active.'
                      : `Outcome: ${market.userBet.status}.`}
                  </div>
                ) : (
                  <p className="text-sm theme-subtle">You have not placed a bet on this market yet.</p>
                )}
              </div>

              {bettingDisabledReason ? (
                <p className="text-sm theme-subtle">{bettingDisabledReason}</p>
              ) : (
                <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                  <div className="flex items-center gap-2">
                    {(['yes', 'no'] as BetSide[]).map((side) => (
                      <button
                        key={side}
                        type="button"
                        className={`btn-base px-4 py-2 text-sm ${
                          side === selectedSide ? 'btn-toggle-active' : 'btn-toggle-inactive'
                        }`}
                        onClick={() => setSelectedSide(side)}
                      >
                        Bet {side.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <label className="flex flex-col gap-1 text-sm theme-heading">
                    Wager (points)
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={wager}
                      onChange={(event) => setWager(event.target.value)}
                      className="w-full input-control rounded-md px-3 py-2 text-sm"
                    />
                  </label>
                  {wallet && (
                    <p className="text-xs theme-muted">
                      Current balance: {formatPoints(wallet.balance)} points
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center btn-base btn-primary px-4 py-2 text-sm"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Placing bet…' : 'Place Bet'}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center btn-base btn-secondary px-4 py-2 text-sm"
                      onClick={() => void refetch()}
                    >
                      Refresh Market
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};
