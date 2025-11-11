import { useCallback, useMemo, useState } from 'react';
import type { BetSide } from '../../shared/types/entities.js';
import type { MarketSummary, ModeratorActionLogEntry } from '../../shared/types/dto.js';
import { closeMarket, publishMarket, resolveMarket } from '../api/markets.js';
import { isApiError } from '../api/client.js';
import { useMarkets } from '../hooks/useMarkets.js';
import { useAuditLog } from '../hooks/useAuditLog.js';
import { formatDateTime, formatPoints } from '../utils/format.js';
import { ManualAdjustmentPanel } from './ManualAdjustmentPanel.js';
import { CreateMarketPanel } from './CreateMarketPanel.js';

interface FeedbackState {
  readonly type: 'success' | 'error';
  readonly message: string;
}

type PendingAction = 'publish' | 'close' | 'resolve';

interface ResolutionDraft {
  readonly resolution: BetSide;
  readonly notes: string;
}

const DEFAULT_RESOLUTION_DRAFT: ResolutionDraft = { resolution: 'yes', notes: '' };

const ensureDraft = (
  drafts: Record<string, ResolutionDraft>,
  marketId: string,
): ResolutionDraft => drafts[marketId] ?? DEFAULT_RESOLUTION_DRAFT;

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const buildAuditEntries = (
  metadata?: Record<string, unknown>,
): ReadonlyArray<{ readonly label: string; readonly value: string }> => {
  if (!metadata) {
    return [];
  }

  const entries: Array<{ label: string; value: string }> = [];

  if (isString(metadata.publishedBy)) {
    entries.push({ label: 'Published By', value: metadata.publishedBy });
  }
  if (isString(metadata.lastPublishedAt)) {
    entries.push({ label: 'Published At', value: formatDateTime(metadata.lastPublishedAt) });
  }
  if (isString(metadata.closedBy)) {
    entries.push({ label: 'Closed By', value: metadata.closedBy });
  }
  if (isString(metadata.lastClosedAt)) {
    entries.push({ label: 'Closed At', value: formatDateTime(metadata.lastClosedAt) });
  }
  if (isBoolean(metadata.autoClosedByScheduler) && metadata.autoClosedByScheduler) {
    entries.push({ label: 'Closure Mode', value: 'Scheduler auto-close' });
  }
  if (isString(metadata.lastAutoClosedAt)) {
    entries.push({ label: 'Auto Closed At', value: formatDateTime(metadata.lastAutoClosedAt) });
  }
  if (isString(metadata.resolvedBy)) {
    entries.push({ label: 'Resolved By', value: metadata.resolvedBy });
  }
  if (isString(metadata.lastSettledAt)) {
    entries.push({ label: 'Settled At', value: formatDateTime(metadata.lastSettledAt) });
  }
  if (isString(metadata.resolutionNotes)) {
    entries.push({ label: 'Resolution Notes', value: metadata.resolutionNotes });
  }

  return entries;
};

const ACTION_LABELS: Readonly<Record<ModeratorActionLogEntry['action'], string>> = {
  CREATE_MARKET: 'Created Market',
  PUBLISH_MARKET: 'Published Market',
  UPDATE_MARKET: 'Updated Market',
  CLOSE_MARKET: 'Closed Market',
  RESOLVE_MARKET: 'Resolved Market',
  VOID_MARKET: 'Voided Market',
  ADJUST_BALANCE: 'Adjusted Balance',
};

const formatActionLabel = (action: ModeratorActionLogEntry['action']): string =>
  ACTION_LABELS[action] ??
  action
    .toLowerCase()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const buildActionBadges = (
  entry: ModeratorActionLogEntry,
): ReadonlyArray<{ readonly label: string; readonly value: string }> => {
  const badges: Array<{ label: string; value: string }> = [];
  if (entry.marketId) {
    badges.push({ label: 'Market', value: entry.marketId });
  }
  if (entry.targetUserId) {
    badges.push({ label: 'Target User', value: entry.targetUserId });
  }
  if (entry.correlationId) {
    badges.push({ label: 'Correlation', value: entry.correlationId });
  }
  return badges;
};

const formatPayloadPreview = (payload: Record<string, unknown> | undefined): string | null => {
  if (!payload || Object.keys(payload).length === 0) {
    return null;
  }

  try {
    const serialized = JSON.stringify(payload, null, 2);
    return serialized.length > 800 ? `${serialized.slice(0, 780)}…` : serialized;
  } catch {
    return null;
  }
};

export const MarketLifecyclePanel = () => {
  const draftState = useMarkets('draft');
  const openState = useMarkets('open');
  const closedState = useMarkets('closed');
  const { data: draftMarkets, isLoading: draftsLoading, error: draftsError, refetch: refetchDrafts } =
    draftState;
  const { data: openMarkets, isLoading: openLoading, error: openError, refetch: refetchOpen } =
    openState;
  const { data: closedMarkets, isLoading: closedLoading, error: closedError, refetch: refetchClosed } =
    closedState;
  const auditOptions = useMemo(() => ({ limit: 50 }), []);
  const {
    data: auditActions,
    fetchedAt: auditFetchedAt,
    isLoading: auditLoading,
    error: auditError,
    refetch: refetchAudit,
  } = useAuditLog(auditOptions);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, ResolutionDraft>>({});

  const refreshAll = useCallback(async () => {
    await Promise.all([refetchDrafts(), refetchOpen(), refetchClosed(), refetchAudit()]);
  }, [refetchDrafts, refetchOpen, refetchClosed, refetchAudit]);

  const handleError = useCallback((error: unknown) => {
    if (isApiError(error)) {
      if (error.status === 401 || error.status === 403) {
        setFeedback({ type: 'error', message: 'Moderator permissions required to perform this action.' });
        return;
      }
      setFeedback({
        type: 'error',
        message: `${error.code}: ${error.message}`,
      });
      return;
    }

    setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Action failed.' });
  }, []);

  const handlePublish = useCallback(
    async (market: MarketSummary, override?: number | null) => {
      const actionKey = `${market.id}-publish`;
      setPendingAction(actionKey);
      setFeedback(null);
      try {
        await publishMarket(market.id, {
          ...(override !== undefined ? { autoCloseOverrideMinutes: override } : {}),
        });
        setFeedback({
          type: 'success',
          message: `Published “${market.title}”.`,
        });
        await refreshAll();
      } catch (error) {
        handleError(error);
      } finally {
        setPendingAction(null);
      }
    },
    [handleError, refreshAll],
  );

  const handleClose = useCallback(
    async (market: MarketSummary) => {
      const actionKey = `${market.id}-close`;
      setPendingAction(actionKey);
      setFeedback(null);
      try {
        await closeMarket(market.id);
        setFeedback({
          type: 'success',
          message: `Closed “${market.title}”.`,
        });
        await refreshAll();
      } catch (error) {
        handleError(error);
      } finally {
        setPendingAction(null);
      }
    },
    [handleError, refreshAll],
  );

  const isPending = useCallback(
    (market: MarketSummary, action: PendingAction) => pendingAction === `${market.id}-${action}`,
    [pendingAction],
  );

  const handleResolve = useCallback(
    async (market: MarketSummary) => {
      const draft = ensureDraft(resolutionDrafts, market.id);
      const actionKey = `${market.id}-resolve`;
      setPendingAction(actionKey);
      setFeedback(null);
      try {
        const payload = {
          resolution: draft.resolution,
          ...(draft.notes.trim().length > 0 ? { notes: draft.notes.trim() } : {}),
        };
        const result = await resolveMarket(market.id, payload);
        const settlement = result.settlement;
        const summary = settlement
          ? `Settled ${settlement.settledBets} bet(s), winners ${settlement.winners}, payouts ${formatPoints(settlement.totalPayout)} pts.`
          : 'Settlement totals unavailable.';

        setFeedback({
          type: 'success',
          message: `Resolved “${market.title}” as ${draft.resolution.toUpperCase()}. ${summary}`,
        });

        setResolutionDrafts((current) => {
          const next = { ...current };
          delete next[market.id];
          return next;
        });

        await refreshAll();
      } catch (error) {
        handleError(error);
      } finally {
        setPendingAction(null);
      }
    },
    [handleError, refreshAll, resolutionDrafts],
  );

  const hasErrors = useMemo(
    () => draftsError ?? openError ?? closedError ?? auditError ?? null,
    [draftsError, openError, closedError, auditError],
  );

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Moderator Lifecycle Console</h1>
          <p className="text-sm text-gray-600">
            Manage draft and open markets, and trigger lifecycle actions backed by the scheduler-enabled API.
          </p>
        </div>
        <button
          className="px-4 py-2 rounded bg-slate-200 text-sm font-medium text-gray-800 hover:bg-slate-300 transition"
          onClick={refreshAll}
          disabled={draftsLoading || openLoading || closedLoading || auditLoading}
        >
          Refresh
        </button>
      </header>

      {feedback && (
        <div
          className={`rounded border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {hasErrors && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed to load moderator data. Try refreshing or check moderator permissions.
        </div>
      )}

      <CreateMarketPanel onCreated={refreshAll} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Draft Markets</h2>
        {draftsLoading && draftMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">Loading drafts…</p>
        ) : draftMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">No draft markets ready to publish.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {draftMarkets.map((market) => (
              <li key={market.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{market.title}</h3>
                      <p className="text-sm text-gray-600">Closes {formatDateTime(market.closesAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="px-3 py-2 rounded bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={() => handlePublish(market)}
                        disabled={isPending(market, 'publish')}
                      >
                        {isPending(market, 'publish') ? 'Publishing…' : 'Publish'}
                      </button>
                      <button
                        className="px-3 py-2 rounded border border-orange-600 text-orange-700 text-sm font-medium hover:bg-orange-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={() => handlePublish(market, null)}
                        disabled={isPending(market, 'publish')}
                      >
                        {isPending(market, 'publish') ? 'Publishing…' : 'Publish w/out Auto-Close'}
                      </button>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-1 text-xs text-gray-500 sm:grid-cols-4">
                    <div>
                      <dt className="font-medium text-gray-700">Pot Yes</dt>
                      <dd>{formatPoints(market.potYes)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-700">Pot No</dt>
                      <dd>{formatPoints(market.potNo)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-700">Total Bets</dt>
                      <dd>{market.totalBets}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-700">Implied Yes</dt>
                      <dd>{market.impliedYesPayout}x</dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Open Markets</h2>
        {openLoading && openMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">Loading open markets…</p>
        ) : openMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">No open markets currently accepting bets.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {openMarkets.map((market) => (
              <li key={market.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{market.title}</h3>
                      <p className="text-sm text-gray-600">Closes {formatDateTime(market.closesAt)}</p>
                    </div>
                    <button
                      className="px-3 py-2 rounded bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 transition disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => handleClose(market)}
                      disabled={isPending(market, 'close')}
                    >
                      {isPending(market, 'close') ? 'Closing…' : 'Close Market'}
                    </button>
                  </div>
                  <dl className="grid grid-cols-2 gap-y-1 text-xs text-gray-500 sm:grid-cols-4">
                    <div>
                      <dt className="font-medium text-gray-700">Pot Yes</dt>
                      <dd>{formatPoints(market.potYes)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-700">Pot No</dt>
                      <dd>{formatPoints(market.potNo)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-700">Total Bets</dt>
                      <dd>{market.totalBets}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-700">Implied No</dt>
                      <dd>{market.impliedNoPayout}x</dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Closed Markets</h2>
        <p className="text-sm text-gray-600">
          Resolve outcomes to trigger payouts. Capture notes so the audit trail reflects moderator decisions.
        </p>
        {closedLoading && closedMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">Loading closed markets…</p>
        ) : closedMarkets.length === 0 ? (
          <p className="text-sm text-gray-600">No closed markets waiting on resolution.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {closedMarkets.map((market) => {
              const draft = ensureDraft(resolutionDrafts, market.id);
              const auditEntries = buildAuditEntries(market.metadata);
              const rawLastClosedAt = market.metadata?.['lastClosedAt'];
              const closedTimestamp = isString(rawLastClosedAt) ? rawLastClosedAt : market.closesAt;
              return (
                <li key={market.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-lg font-semibold text-gray-900">{market.title}</h3>
                      <p className="text-sm text-gray-600">
                        Closed {formatDateTime(closedTimestamp)} • Total bets {market.totalBets}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {(['yes', 'no'] as const).map((side) => (
                        <button
                          key={side}
                          type="button"
                          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                            draft.resolution === side
                              ? 'bg-slate-900 text-white shadow-sm'
                              : 'bg-white text-gray-700 border border-slate-200 hover:bg-slate-50'
                          }`}
                          onClick={() =>
                            setResolutionDrafts((current) => ({
                              ...current,
                              [market.id]: {
                                resolution: side,
                                notes: ensureDraft(current, market.id).notes,
                              },
                            }))
                          }
                        >
                          Resolve {side.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    <label className="flex flex-col gap-1 text-sm text-gray-700">
                      Resolution Notes (optional)
                      <textarea
                        value={draft.notes}
                        rows={3}
                        onChange={(event) =>
                          setResolutionDrafts((current) => ({
                            ...current,
                            [market.id]: {
                              resolution: ensureDraft(current, market.id).resolution,
                              notes: event.target.value,
                            },
                          }))
                        }
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        placeholder="Summarize supporting evidence or moderator context"
                      />
                    </label>

                    <div className="flex items-center gap-3">
                      <button
                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={() => handleResolve(market)}
                        disabled={isPending(market, 'resolve')}
                      >
                        {isPending(market, 'resolve')
                          ? 'Resolving…'
                          : `Resolve as ${draft.resolution.toUpperCase()}`}
                      </button>
                      <button
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-slate-100"
                        onClick={() => setResolutionDrafts((current) => {
                          const next = { ...current };
                          delete next[market.id];
                          return next;
                        })}
                        disabled={isPending(market, 'resolve')}
                      >
                        Clear Draft
                      </button>
                    </div>

                    <dl className="grid grid-cols-2 gap-y-2 text-xs text-gray-500 sm:grid-cols-4">
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
                        <dd>{market.impliedYesPayout}x</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-gray-700">Implied No</dt>
                        <dd>{market.impliedNoPayout}x</dd>
                      </div>
                    </dl>

                    {auditEntries.length > 0 && (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-gray-600">
                        <p className="mb-1 font-semibold text-gray-700">Audit Trail</p>
                        <ul className="list-disc pl-4">
                          {auditEntries.map((entry) => (
                            <li key={`${market.id}-${entry.label}`}>
                              <span className="font-medium text-gray-700">{entry.label}:</span> {entry.value}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ManualAdjustmentPanel auditActions={auditActions} onAdjustmentRecorded={refreshAll} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-gray-900">Recent Moderator Actions</h2>
          <p className="text-sm text-gray-600">
            The latest audit log entries recorded by the backend service.
            {auditFetchedAt ? ` Updated ${formatDateTime(auditFetchedAt)}.` : ''}
          </p>
        </div>
        {auditError && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Failed to load audit log. Try refreshing or verify moderator permissions.
          </div>
        )}
        {auditLoading && auditActions.length === 0 ? (
          <p className="text-sm text-gray-600">Loading audit log…</p>
        ) : auditActions.length === 0 ? (
          <p className="text-sm text-gray-600">No moderator actions recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {auditActions.map((entry) => {
              const badges = buildActionBadges(entry);
              const payloadPreview = formatPayloadPreview(entry.payload);
              return (
                <li key={entry.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{formatActionLabel(entry.action)}</p>
                        <p className="text-xs text-gray-500">{formatDateTime(entry.createdAt)}</p>
                      </div>
                      <div className="text-xs text-gray-600">
                        <span className="font-medium text-gray-700">Moderator:</span>{' '}
                        {entry.performedByUsername || entry.performedBy}
                      </div>
                    </div>
                    {badges.length > 0 && (
                      <ul className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                        {badges.map((badge) => (
                          <li
                            key={`${entry.id}-${badge.label}`}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1"
                          >
                            <span className="font-medium text-gray-700">{badge.label}:</span> {badge.value}
                          </li>
                        ))}
                      </ul>
                    )}
                    {payloadPreview && (
                      <pre className="overflow-x-auto rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-100">
                        {payloadPreview}
                      </pre>
                    )}
                    {entry.snapshot && (
                      <p className="text-xs text-gray-500">
                        Snapshot captured with before/after state for this action.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
