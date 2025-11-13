import { useMemo } from 'react';
import { useMarkets } from '../hooks/useMarkets.js';
import { formatDateTime, formatPoints, formatProbability, formatRelativeTime } from '../utils/format.js';
import defaultIcon from '../../../assets/default-icon.png';
import type { MarketSummary } from '../../shared/types/dto.js';

export type MarketsFilter = 'open' | 'closed' | 'resolved';

interface MarketsScreenProps {
  readonly filter: MarketsFilter;
  readonly onFilterChange: (filter: MarketsFilter) => void;
  readonly onSelectMarket: (marketId: string) => void;
}

const FILTER_OPTIONS: ReadonlyArray<{ readonly value: MarketsFilter; readonly label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'resolved', label: 'Resolved' },
];

const EmptyStateMessages: Record<MarketsFilter, string> = {
  open: 'No open markets right now. Check back soon!',
  closed: 'No recently closed markets awaiting resolution.',
  resolved: 'No resolved markets available yet.',
};


const renderMetadata = (market: MarketSummary, filter: MarketsFilter) => {
  if (filter === 'open') {
    return (
      <p className="text-sm theme-subtle">
        Closes {formatRelativeTime(market.closesAt)} • Total bets: {market.totalBets}
      </p>
    );
  }

  if (filter === 'closed') {
    return (
      <p className="text-sm theme-subtle">Closed at {formatDateTime(market.closesAt)}</p>
    );
  }

  return (
    <p className="text-sm theme-subtle">Resolved • Total bets: {market.totalBets}</p>
  );
};

const MarketCard = ({
  market,
  filter,
  onSelect,
}: {
  readonly market: MarketSummary;
  readonly filter: MarketsFilter;
  readonly onSelect: (marketId: string) => void;
}) => {
  const imageSrc = market.imageUrl ?? defaultIcon;
  return (
    <li className="rounded-2xl theme-card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <div
          className="flex-shrink-0 overflow-hidden rounded-xl bg-[color:var(--surface-muted)] self-center sm:self-auto w-[160px] h-[160px] sm:w-[120px] sm:h-[120px]"
        >
          <img
            src={imageSrc}
            alt={market.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold theme-heading">{market.title}</h3>
              {renderMetadata(market, filter)}
            </div>
            <span className="inline-flex items-center gap-2 self-start badge-soft px-3 py-1 text-xs font-semibold">
              {filter.toUpperCase()}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-y-2 text-sm theme-muted sm:grid-cols-4">
            <div>
              <dt className="font-medium theme-heading text-xs">Pot Yes</dt>
              <dd>{formatPoints(market.potYes)}</dd>
            </div>
            <div>
              <dt className="font-medium theme-heading text-xs">Pot No</dt>
              <dd>{formatPoints(market.potNo)}</dd>
            </div>
            <div>
              <dt className="font-medium theme-heading text-xs">Implied Yes</dt>
              <dd>{formatProbability(market.impliedYesProbability)}</dd>
            </div>
            <div>
              <dt className="font-medium theme-heading text-xs">Implied No</dt>
              <dd>{formatProbability(market.impliedNoProbability)}</dd>
            </div>
          </dl>
          <div className="flex">
            <button
              className="inline-flex items-center justify-center btn-base btn-primary px-4 py-2 text-sm"
              onClick={() => onSelect(market.id)}
            >
              View Market
            </button>
          </div>
        </div>
      </div>
    </li>
  );
};

export const MarketsScreen = ({ filter, onFilterChange, onSelectMarket }: MarketsScreenProps) => {
  const marketsState = useMarkets(filter);
  const { data, isLoading, error, refetch } = marketsState;

  const hasResults = useMemo(() => data.length > 0, [data]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold theme-heading">Prediction Markets</h1>
          <p className="text-sm theme-subtle">
            Browse markets, monitor their status, and jump in to place your predictions.
          </p>
        </div>
        <button
          className="self-start btn-base btn-secondary px-3 py-2 text-sm"
          onClick={() => {
            void refetch();
          }}
          disabled={isLoading}
        >
          Refresh
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`btn-base px-4 py-2 text-sm ${
              filter === option.value ? 'btn-toggle-active' : 'btn-toggle-inactive'
            }`}
            onClick={() => onFilterChange(option.value)}
            disabled={filter === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md px-4 py-3 text-sm feedback-error">
          Failed to load markets. Try refreshing.
        </div>
      )}

      {isLoading && !hasResults ? (
        <p className="text-sm theme-subtle">Loading markets…</p>
      ) : !hasResults ? (
        <p className="text-sm theme-subtle">{EmptyStateMessages[filter]}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.map((market) => (
            <MarketCard key={market.id} market={market} filter={filter} onSelect={onSelectMarket} />
          ))}
        </ul>
      )}
    </div>
  );
};
