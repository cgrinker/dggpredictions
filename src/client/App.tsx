import { useCallback, useMemo, useState } from 'react';
import { MarketLifecyclePanel } from './components/MarketLifecyclePanel.js';
import { MarketsScreen, type MarketsFilter } from './routes/MarketsScreen.js';
import { MarketDetailScreen } from './routes/MarketDetailScreen.js';
import { WalletScreen } from './routes/WalletScreen.js';
import { BetsScreen } from './routes/BetsScreen.js';
import { LeaderboardScreen } from './routes/LeaderboardScreen.js';

type AppRoute = 'markets' | 'wallet' | 'bets' | 'leaderboard' | 'moderator';

const NAV_ITEMS: ReadonlyArray<{ readonly key: AppRoute; readonly label: string }> = [
  { key: 'markets', label: 'Markets' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'bets', label: 'My Bets' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'moderator', label: 'Moderator Console' },
];

export const App = () => {
  const [route, setRoute] = useState<AppRoute>('markets');
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<MarketsFilter>('open');

  const handleNavigate = useCallback(
    (nextRoute: AppRoute) => {
      setRoute(nextRoute);
      if (selectedMarketId !== null) {
        setSelectedMarketId(null);
      }
    },
    [selectedMarketId],
  );

  const handleSelectMarket = useCallback((marketId: string) => {
    setSelectedMarketId(marketId);
  }, []);

  const handleBackToMarkets = useCallback(() => {
    setSelectedMarketId(null);
  }, []);

  const content = useMemo(() => {
    if (route === 'markets') {
      return selectedMarketId ? (
        <MarketDetailScreen marketId={selectedMarketId} onBack={handleBackToMarkets} />
      ) : (
        <MarketsScreen
          filter={marketFilter}
          onFilterChange={setMarketFilter}
          onSelectMarket={handleSelectMarket}
        />
      );
    }

    if (route === 'wallet') {
      return <WalletScreen />;
    }

    if (route === 'bets') {
      return <BetsScreen />;
    }

    if (route === 'leaderboard') {
      return <LeaderboardScreen />;
    }

    return <MarketLifecyclePanel />;
  }, [
    route,
    selectedMarketId,
    handleBackToMarkets,
    marketFilter,
    handleSelectMarket,
    setMarketFilter,
  ]);

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">/r/dgg Predictions</h1>
            <p className="text-sm text-slate-600">
              Explore markets, track your bets, check the leaderboard, or manage lifecycles.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  route === item.key
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-white text-gray-700 border border-slate-200 hover:bg-slate-50'
                }`}
                onClick={() => handleNavigate(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>
        <main className="flex-1 py-6">
          <div className="flex flex-col gap-6">{content}</div>
        </main>
      </div>
    </div>
  );
};
