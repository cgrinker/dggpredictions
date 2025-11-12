import { useCallback, useEffect, useMemo, useState } from 'react';
import { MarketLifecyclePanel } from './components/MarketLifecyclePanel.js';
import { MarketsScreen, type MarketsFilter } from './routes/MarketsScreen.js';
import { MarketDetailScreen } from './routes/MarketDetailScreen.js';
import { WalletScreen } from './routes/WalletScreen.js';
import { BetsScreen } from './routes/BetsScreen.js';
import { LeaderboardScreen } from './routes/LeaderboardScreen.js';
import { useSession } from './hooks/useSession.js';
import { themeTokens } from './utils/theme.js';

type AppRoute = 'markets' | 'wallet' | 'bets' | 'leaderboard' | 'moderator';

const NAV_ITEMS: ReadonlyArray<{ readonly key: AppRoute; readonly label: string }> = [
  { key: 'markets', label: 'Markets' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'bets', label: 'My Bets' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'moderator', label: 'Moderator Console' },
];

export const App = () => {
  const { data: session, isLoading: sessionLoading, refetch: refreshSession } = useSession();
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

  const navItems = useMemo(() => {
    if (session?.isModerator) {
      return NAV_ITEMS;
    }
    return NAV_ITEMS.filter((item) => item.key !== 'moderator');
  }, [session]);

  useEffect(() => {
    if (route === 'moderator' && session && !session.isModerator) {
      setRoute('markets');
    }
  }, [route, session]);

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

    if (session && session.isModerator) {
      return <MarketLifecyclePanel session={session} onSessionRefresh={refreshSession} />;
    }

    return (
      <div className="flex flex-col gap-4 rounded-2xl theme-card p-6 text-sm">
        <h2 className="text-xl font-semibold theme-heading">Moderators only</h2>
        <p className="theme-subtle">
          You need moderator access on <span className="font-semibold">r/Destiny</span> to open the
          lifecycle console.
        </p>
      </div>
    );
  }, [
    route,
    selectedMarketId,
    handleBackToMarkets,
    marketFilter,
    handleSelectMarket,
    setMarketFilter,
    session,
    refreshSession,
  ]);

  return (
    <div className="theme-shell min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b theme-border pb-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em]" style={{ color: themeTokens.textMuted }}>
              r/Destiny community
            </span>
            <h1 className="text-3xl font-bold" style={{ color: themeTokens.textPrimary }}>
              r/Destiny Predictions
            </h1>
            <p className="text-sm" style={{ color: themeTokens.textSecondary }}>
              Explore markets, track your bets, and follow the leaderboard. Moderators can manage
              lifecycles with elevated tooling.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {navItems.map((item) => (
              <button
                key={item.key}
                className={`btn-base px-4 py-2 text-sm ${
                  route === item.key ? 'btn-toggle-active' : 'btn-toggle-inactive'
                }`}
                onClick={() => handleNavigate(item.key)}
                disabled={sessionLoading && item.key === 'moderator'}
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
