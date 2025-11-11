import { useMemo } from 'react';
import { useMarkets } from '../hooks/useMarkets.js';
import { formatDateTime, formatPoints, formatRelativeTime } from '../utils/format.js';
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

const statusBadgeColors: Record<MarketsFilter, string> = {
  open: 'bg-green-100 text-green-800 border-green-200',
  closed: 'bg-amber-100 text-amber-800 border-amber-200',
  resolved: 'bg-blue-100 text-blue-800 border-blue-200',
};

const renderMetadata = (market: MarketSummary, filter: MarketsFilter) => {
  if (filter === 'open') {
    return (
      <p className="text-sm text-gray-600">
        Closes {formatRelativeTime(market.closesAt)} • Total bets: {market.totalBets}
      </p>
    );
  }

  if (filter === 'closed') {
    return (
      <p className="text-sm text-gray-600">Closed at {formatDateTime(market.closesAt)}</p>
    );
  }

  return (
    <p className="text-sm text-gray-600">Resolved • Total bets: {market.totalBets}</p>
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
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{market.title}</h3>
            {renderMetadata(market, filter)}
          </div>
          <span
            className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeColors[filter]}`}
          >
            {filter.toUpperCase()}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-y-2 text-sm text-gray-600 sm:grid-cols-4">
          <div>
            <dt className="font-medium text-gray-700">Pot Yes</dt>
            <dd>{formatPoints(market.potYes)}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Pot No</dt>
            <dd>{formatPoints(market.potNo)}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Implied Yes</dt>
            <dd>{market.impliedYesPayout.toFixed(2)}x</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Implied No</dt>
            <dd>{market.impliedNoPayout.toFixed(2)}x</dd>
          </div>
        </dl>
        <div className="flex">
          <button
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            onClick={() => onSelect(market.id)}
          >
            View Market
          </button>
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
          <h1 className="text-2xl font-bold text-gray-900">Prediction Markets</h1>
          <p className="text-sm text-gray-600">
            Browse markets, monitor their status, and jump in to place your predictions.
          </p>
        </div>
        <button
          className="self-start rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-slate-100"
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
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              filter === option.value
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-gray-700 border border-slate-200 hover:bg-slate-50'
            }`}
            onClick={() => onFilterChange(option.value)}
            disabled={filter === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed to load markets. Try refreshing.
        </div>
      )}

      {isLoading && !hasResults ? (
        <p className="text-sm text-gray-600">Loading markets…</p>
      ) : !hasResults ? (
        <p className="text-sm text-gray-600">{EmptyStateMessages[filter]}</p>
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
