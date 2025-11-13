import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { BetSide } from '../../shared/types/entities.js';
import type { AppConfig } from '../../shared/types/config.js';
import type {
  ArchiveMarketsResponse,
  MarketSummary,
  ModeratorActionLogEntry,
  SessionInfo,
} from '../../shared/types/dto.js';
import { closeMarket, publishMarket, resolveMarket, archiveMarkets } from '../api/markets.js';
import { isApiError } from '../api/client.js';
import { useMarkets } from '../hooks/useMarkets.js';
import { useAuditLog } from '../hooks/useAuditLog.js';
import { formatDateTime, formatPoints, formatProbability } from '../utils/format.js';
import { ManualAdjustmentPanel } from './ManualAdjustmentPanel.js';
import { CreateMarketPanel } from './CreateMarketPanel.js';
import type {
  IncidentFeed,
  IncidentSummary,
  MetricsSummary,
  SystemResetResponse,
} from '../../shared/types/dto.js';
import { getIncidentFeed, getMetricsSummary, resetSystem } from '../api/operations.js';
import { getConfigState, resetConfigState, updateConfigState } from '../api/config.js';

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
  CONFIG_UPDATE: 'Updated Configuration',
  ARCHIVE_MARKETS: 'Archived Markets',
  PRUNE_MARKETS: 'Pruned Markets',
  RESET_SYSTEM: 'Reset System',
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

const serializePayload = (payload: Record<string, unknown> | undefined): string | null => {
  if (!payload || Object.keys(payload).length === 0) {
    return null;
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return null;
  }
};

const extractMarketTags = (market: MarketSummary): string[] => {
  const raw = market.metadata?.tags;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter((tag): tag is string => tag.length > 0);
};

const getTotalBetVolume = (market: MarketSummary): number => market.potYes + market.potNo;

interface MarketLifecyclePanelProps {
  readonly session: SessionInfo;
  readonly onSessionRefresh: () => Promise<void>;
}

type ModeratorTab = 'lifecycle' | 'maintenance' | 'configuration';

const TABS: ReadonlyArray<{ readonly key: ModeratorTab; readonly label: string }> = [
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'configuration', label: 'Configuration' },
];

const ARCHIVE_STATUS_OPTIONS: ReadonlyArray<{
  readonly value: 'closed' | 'resolved' | 'void';
  readonly label: string;
}> = [
  { value: 'closed', label: 'Closed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'void', label: 'Void' },
];

const FEATURE_FLAG_OPTIONS: ReadonlyArray<{
  readonly key: keyof AppConfig['featureFlags'];
  readonly label: string;
  readonly description: string;
}> = [
  {
    key: 'maintenanceMode',
    label: 'Maintenance mode',
    description: 'Hide betting interfaces for viewers while preserving moderator controls.',
  },
  {
    key: 'enableRealtimeUpdates',
    label: 'Realtime updates',
    description: 'Emit realtime market updates to connected clients.',
  },
  {
    key: 'enableLeaderboard',
    label: 'Leaderboard',
    description: 'Expose the public leaderboard module to participants.',
  },
  {
    key: 'enableConfigEditor',
    label: 'Enable config editor',
    description: 'Allow moderators to edit configuration overrides from this console.',
  },
];

type AuditFilterKey = 'all' | 'retention' | 'config' | 'resolutions';

const AUDIT_FILTER_OPTIONS: ReadonlyArray<{
  readonly key: AuditFilterKey;
  readonly label: string;
  readonly description: string;
  readonly actions: ReadonlyArray<ModeratorActionLogEntry['action']>;
}> = [
  {
    key: 'all',
    label: 'All Actions',
    description: 'Show the full moderator audit stream.',
    actions: [],
  },
  {
    key: 'retention',
    label: 'Retention',
    description: 'Focus on archive and prune activity.',
    actions: ['ARCHIVE_MARKETS', 'PRUNE_MARKETS', 'RESET_SYSTEM'],
  },
  {
    key: 'config',
    label: 'Config Updates',
    description: 'Surface runtime configuration overrides.',
    actions: ['CONFIG_UPDATE'],
  },
  {
    key: 'resolutions',
    label: 'Resolutions',
    description: 'Highlight market resolution and incident work.',
    actions: ['RESOLVE_MARKET'],
  },
];

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const precision = index === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[index]}`;
};

type MetricCardConfig = {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly format?: (value: number) => string;
  readonly accent?: 'primary' | 'warning';
};

const METRIC_CARD_CONFIG: ReadonlyArray<MetricCardConfig> = [
  { key: 'totalMarkets', label: 'Total Markets', accent: 'primary' },
  { key: 'openMarkets', label: 'Open Markets' },
  { key: 'closedMarkets', label: 'Closed Markets' },
  { key: 'resolvedMarkets', label: 'Resolved Markets' },
  { key: 'archivableMarkets', label: 'Archivable Markets', description: 'Closed, resolved, and void totals awaiting purge.' },
  { key: 'draftMarkets', label: 'Draft Markets' },
  { key: 'voidMarkets', label: 'Voided Markets' },
  { key: 'redisTotalKeys', label: 'Redis Keys', description: 'Namespace footprint across metrics and markets.' },
  { key: 'redisUsedMemoryBytes', label: 'Redis Memory', format: (value) => formatBytes(value), description: 'Current in-memory usage for the namespace.' },
  { key: 'redisPeakMemoryBytes', label: 'Redis Peak Memory', format: (value) => formatBytes(value), description: 'Historical peak in-memory usage.' },
];

const METRIC_CARD_KEYS = new Set(METRIC_CARD_CONFIG.map((card) => card.key));

const MAINTENANCE_REFRESH_MS = 60_000;

const formatMetricValue = (value: number, format?: (input: number) => string): string => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return format ? format(value) : value.toLocaleString();
};

interface ArchiveFormState {
  readonly olderThanDays: string;
  readonly statuses: Set<'closed' | 'resolved' | 'void'>;
  readonly maxMarkets: string;
  readonly page: string;
  readonly pageSize: string;
}

interface ConfigFormState {
  readonly startingBalance: string;
  readonly minBet: string;
  readonly maxBet: string;
  readonly maxOpenMarkets: string;
  readonly autoCloseGraceMinutes: string;
  readonly leaderboardWindow: AppConfig['leaderboardWindow'];
  readonly featureFlags: AppConfig['featureFlags'];
}

const createDefaultArchiveForm = (): ArchiveFormState => ({
  olderThanDays: '30',
  statuses: new Set<'closed' | 'resolved' | 'void'>(['closed', 'resolved']),
  maxMarkets: '500',
  page: '1',
  pageSize: '25',
});

const toConfigFormState = (config: AppConfig): ConfigFormState => ({
  startingBalance: String(config.startingBalance),
  minBet: String(config.minBet),
  maxBet: config.maxBet === null ? '' : String(config.maxBet),
  maxOpenMarkets: config.maxOpenMarkets === null ? '' : String(config.maxOpenMarkets),
  autoCloseGraceMinutes: String(config.autoCloseGraceMinutes),
  leaderboardWindow: config.leaderboardWindow,
  featureFlags: { ...config.featureFlags },
});

export const MarketLifecyclePanel = ({ session, onSessionRefresh }: MarketLifecyclePanelProps) => {
  const [activeTab, setActiveTab] = useState<ModeratorTab>('lifecycle');

  const {
    data: draftMarkets,
    isLoading: draftsLoading,
    error: draftsError,
    refetch: refetchDrafts,
  } = useMarkets('draft');
  const {
    data: openMarkets,
    isLoading: openLoading,
    error: openError,
    refetch: refetchOpen,
  } = useMarkets('open');
  const {
    data: closedMarkets,
    isLoading: closedLoading,
    error: closedError,
    refetch: refetchClosed,
  } = useMarkets('closed');

  const {
    data: auditActions,
    fetchedAt: auditFetchedAt,
    isLoading: auditLoading,
    error: auditError,
    refetch: refetchAudit,
  } = useAuditLog(useMemo(() => ({ limit: 50 }), []));

  const [auditFilter, setAuditFilter] = useState<AuditFilterKey>('all');

  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, ResolutionDraft>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<'date' | 'totalBets'>('date');
  const [expandedAuditEntries, setExpandedAuditEntries] = useState<ReadonlySet<string>>(() => new Set());

  const [maintenanceFeedback, setMaintenanceFeedback] = useState<FeedbackState | null>(null);
  const [archiveForm, setArchiveForm] = useState<ArchiveFormState>(() => createDefaultArchiveForm());
  const [archiveResult, setArchiveResult] = useState<ArchiveMarketsResponse | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [maintenanceInitialized, setMaintenanceInitialized] = useState(false);

  const [metricsState, setMetricsState] = useState<{
    readonly data: MetricsSummary | null;
    readonly error: string | null;
    readonly loading: boolean;
  }>({ data: null, error: null, loading: false });

  const [incidentsState, setIncidentsState] = useState<{
    readonly data: IncidentFeed | null;
    readonly error: string | null;
    readonly loading: boolean;
  }>({ data: null, error: null, loading: false });

  const [configState, setConfigState] = useState<ConfigFormState | null>(null);
  const [configOverridesApplied, setConfigOverridesApplied] = useState<boolean | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSuccess, setConfigSuccess] = useState<string | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [systemResetSummary, setSystemResetSummary] = useState<SystemResetResponse | null>(null);
  const [systemResetError, setSystemResetError] = useState<string | null>(null);
  const [systemResetPending, setSystemResetPending] = useState(false);
  const [systemResetConfirmVisible, setSystemResetConfirmVisible] = useState(false);

  const filterAndSortMarkets = useCallback(
    (markets: readonly MarketSummary[]): MarketSummary[] => {
      if (markets.length === 0) {
        return [];
      }

      const query = searchQuery.trim().toLowerCase();
      const filtered = query.length === 0
        ? markets
        : markets.filter((market) => {
            const titleMatch = market.title.toLowerCase().includes(query);
            const tagMatch = extractMarketTags(market).some((tag) => tag.toLowerCase().includes(query));
            const idMatch = market.id.toLowerCase().includes(query);
            return titleMatch || tagMatch || idMatch;
          });

      const sorted = [...filtered].sort((a, b) => {
        if (sortKey === 'totalBets') {
          const volumeDelta = getTotalBetVolume(b) - getTotalBetVolume(a);
          if (volumeDelta !== 0) {
            return volumeDelta;
          }
        } else {
          const dateA = Date.parse(a.closesAt);
          const dateB = Date.parse(b.closesAt);
          if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) {
            return dateA - dateB;
          }
        }

        const secondaryDelta = getTotalBetVolume(b) - getTotalBetVolume(a);
        if (secondaryDelta !== 0) {
          return secondaryDelta;
        }
        return a.title.localeCompare(b.title);
      });

      return sorted;
    },
    [searchQuery, sortKey],
  );

  const visibleDraftMarkets = useMemo(
    () => filterAndSortMarkets(draftMarkets ?? []),
    [draftMarkets, filterAndSortMarkets],
  );
  const visibleOpenMarkets = useMemo(
    () => filterAndSortMarkets(openMarkets ?? []),
    [openMarkets, filterAndSortMarkets],
  );
  const visibleClosedMarkets = useMemo(
    () => filterAndSortMarkets(closedMarkets ?? []),
    [closedMarkets, filterAndSortMarkets],
  );
  const hasActiveMarketFilter = searchQuery.trim().length > 0;

  const toggleAuditEntry = useCallback((entryId: string) => {
    setExpandedAuditEntries((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refetchDrafts(), refetchOpen(), refetchClosed(), refetchAudit()]);
  }, [refetchDrafts, refetchOpen, refetchClosed, refetchAudit]);

  const handleError = useCallback((error: unknown) => {
    if (isApiError(error)) {
      if (error.status === 401 || error.status === 403) {
        setFeedback({ type: 'error', message: 'Moderator permissions required to perform this action.' });
        return;
      }
      setFeedback({ type: 'error', message: `${error.code}: ${error.message}` });
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
        setFeedback({ type: 'success', message: `Published “${market.title}”.` });
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
        setFeedback({ type: 'success', message: `Closed “${market.title}”.` });
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

  const lifecycleError = useMemo(
    () => draftsError ?? openError ?? closedError ?? auditError ?? null,
    [draftsError, openError, closedError, auditError],
  );

  const activeAuditFilter = useMemo(() => {
    const fallback = AUDIT_FILTER_OPTIONS[0]!;
    return AUDIT_FILTER_OPTIONS.find((option) => option.key === auditFilter) ?? fallback;
  }, [auditFilter]);

  const filteredAuditActions = useMemo(() => {
    if (activeAuditFilter.actions.length === 0) {
      return auditActions;
    }

    const allowed = new Set(activeAuditFilter.actions);
    return auditActions.filter((entry) => allowed.has(entry.action));
  }, [activeAuditFilter, auditActions]);

  const loadMaintenanceData = useCallback(async () => {
    setMaintenanceFeedback(null);
    setMetricsState((state) => ({ ...state, loading: true, error: null }));
    setIncidentsState((state) => ({ ...state, loading: true, error: null }));

    try {
      const [metrics, incidents] = await Promise.all([
        getMetricsSummary().catch((error: unknown) => {
          if (isApiError(error)) {
            throw new Error(`${error.code}: ${error.message}`);
          }
          throw error;
        }),
        getIncidentFeed().catch((error: unknown) => {
          if (isApiError(error)) {
            throw new Error(`${error.code}: ${error.message}`);
          }
          throw error;
        }),
      ]);

      setMetricsState({ data: metrics, error: null, loading: false });
      setIncidentsState({ data: incidents, error: null, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load maintenance data.';
      setMetricsState((state) => ({ ...state, loading: false, error: message }));
      setIncidentsState((state) => ({ ...state, loading: false, error: message }));
    } finally {
      setMaintenanceInitialized(true);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'maintenance' && !maintenanceInitialized) {
      void loadMaintenanceData();
    }
  }, [activeTab, maintenanceInitialized, loadMaintenanceData]);

  useEffect(() => {
    if (activeTab !== 'maintenance') {
      return undefined;
    }

    const refreshTimer = window.setInterval(() => {
      void loadMaintenanceData();
    }, MAINTENANCE_REFRESH_MS);

    return () => window.clearInterval(refreshTimer);
  }, [activeTab, loadMaintenanceData]);

  const submitArchive = useCallback(
    async (dryRun: boolean) => {
      setArchiveLoading(true);
      setArchiveError(null);
      setMaintenanceFeedback(null);
      setArchiveResult(null);

      const statuses = Array.from(archiveForm.statuses.values());
      if (statuses.length === 0) {
        setArchiveLoading(false);
        setArchiveError('Select at least one market status to include.');
        return;
      }

      const pageValue = Number.parseInt(archiveForm.page, 10);
      if (Number.isNaN(pageValue) || pageValue < 1) {
        setArchiveLoading(false);
        setArchiveError('Page must be at least 1.');
        return;
      }

      const pageSizeValue = Number.parseInt(archiveForm.pageSize, 10);
      if (Number.isNaN(pageSizeValue) || pageSizeValue < 1 || pageSizeValue > 500) {
        setArchiveLoading(false);
        setArchiveError('Page size must be between 1 and 500.');
        return;
      }

      const requestBody = {
        olderThanDays: Number.parseInt(archiveForm.olderThanDays, 10),
        statuses,
        ...(archiveForm.maxMarkets.trim().length > 0
          ? { maxMarkets: Number.parseInt(archiveForm.maxMarkets, 10) }
          : {}),
        dryRun,
        page: pageValue,
        pageSize: pageSizeValue,
      };

      try {
        const response = await archiveMarkets(requestBody);
        setArchiveResult(response);
        setMaintenanceFeedback({
          type: 'success',
          message: dryRun
            ? `Dry-run completed. ${response.archivedMarkets} market(s) eligible for archive.`
            : `Archived ${response.archivedMarkets} market(s). ${response.skippedMarkets} skipped.`,
        });
        if (!dryRun) {
          await Promise.all([refetchClosed(), refetchDrafts(), refetchOpen(), refetchAudit()]);
        }
      } catch (error) {
        const message = isApiError(error)
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : 'Failed to archive markets.';
        setArchiveError(message);
      } finally {
        setArchiveLoading(false);
      }
    },
    [archiveForm, refetchAudit, refetchClosed, refetchDrafts, refetchOpen],
  );

  const handleArchiveDryRun = useCallback(() => {
    void submitArchive(true);
  }, [submitArchive]);

  const handleArchiveRequest = useCallback(() => {
    if (!archiveResult || !archiveResult.dryRun) {
      setArchiveError('Run a dry-run first to review eligible markets.');
      return;
    }

    if (archiveResult.archivedMarkets === 0) {
      setArchiveError('Dry-run reported no eligible markets to archive.');
      return;
    }

    setArchiveError(null);
    setArchiveConfirmOpen(true);
  }, [archiveResult]);

  const handleArchiveConfirm = useCallback(() => {
    setArchiveConfirmOpen(false);
    void submitArchive(false);
  }, [submitArchive]);

  const handleArchiveCancel = useCallback(() => {
    setArchiveConfirmOpen(false);
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    setConfigSuccess(null);

    try {
      const { config, overridesApplied } = await getConfigState();
      setConfigOverridesApplied(overridesApplied);
      setConfigState(toConfigFormState(config));
    } catch (error) {
      const message = isApiError(error)
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Failed to load configuration.';
      setConfigError(message);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'configuration' && configState === null && !configLoading) {
      void loadConfig();
    }
  }, [activeTab, configState, configLoading, loadConfig]);

  const configEditorEnabled = configState?.featureFlags.enableConfigEditor ?? false;

  const handleTabSelect = useCallback((tab: ModeratorTab) => {
    setActiveTab(tab);
  }, []);

  const handleArchiveNumberChange = useCallback(
    (field: 'olderThanDays' | 'maxMarkets' | 'page' | 'pageSize') =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        setArchiveForm((current) => ({ ...current, [field]: value }));
      },
    [],
  );

  const handleArchiveStatusToggle = useCallback((status: 'closed' | 'resolved' | 'void') => {
    setArchiveForm((current) => {
      const nextStatuses = new Set(current.statuses);
      if (nextStatuses.has(status)) {
        nextStatuses.delete(status);
      } else {
        nextStatuses.add(status);
      }
      return { ...current, statuses: nextStatuses };
    });
  }, []);

  const handleArchiveReset = useCallback(() => {
    setArchiveForm(createDefaultArchiveForm());
    setMaintenanceFeedback(null);
    setArchiveError(null);
    setArchiveResult(null);
    setArchiveConfirmOpen(false);
  }, []);

  const handleSystemResetPrime = useCallback(() => {
    setSystemResetError(null);
    setSystemResetSummary(null);
    setSystemResetConfirmVisible(true);
  }, []);

  const handleSystemResetCancel = useCallback(() => {
    setSystemResetConfirmVisible(false);
    setSystemResetError(null);
  }, []);

  const handleSystemResetExecute = useCallback(async () => {
    setSystemResetPending(true);
    setSystemResetError(null);
    try {
      const summary = await resetSystem();
      setSystemResetSummary(summary);
      setSystemResetConfirmVisible(false);
      setMaintenanceFeedback({
        type: 'success',
        message: `Deleted ${summary.deletedKeys.toLocaleString()} of ${summary.attemptedKeys.toLocaleString()} Redis keys.`,
      });
      await refreshAll();
      await loadMaintenanceData();
    } catch (error) {
      const message = isApiError(error)
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Failed to reset system data.';
      setSystemResetError(message);
      setMaintenanceFeedback({ type: 'error', message });
    } finally {
      setSystemResetPending(false);
    }
  }, [loadMaintenanceData, refreshAll, resetSystem]);

  const handleMaintenanceRefresh = useCallback(() => {
    void loadMaintenanceData();
  }, [loadMaintenanceData]);

  const handleConfigReload = useCallback(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleConfigNumericChange = useCallback(
    (field: 'startingBalance' | 'minBet' | 'maxBet' | 'maxOpenMarkets' | 'autoCloseGraceMinutes') =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        setConfigState((current) => (current ? { ...current, [field]: value } : current));
      },
    [],
  );

  const handleLeaderboardWindowChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as AppConfig['leaderboardWindow'];
      setConfigState((current) => (current ? { ...current, leaderboardWindow: value } : current));
    },
    [],
  );

  const handleFeatureFlagToggle = useCallback(
    (flag: keyof AppConfig['featureFlags']) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const { checked } = event.target;
        setConfigState((current) =>
          current
            ? {
                ...current,
                featureFlags: {
                  ...current.featureFlags,
                  [flag]: checked,
                } as AppConfig['featureFlags'],
              }
            : current,
        );
      },
    [],
  );

  const handleConfigSave = useCallback(async () => {
    if (!configState) {
      return;
    }

    setConfigSaving(true);
    setConfigError(null);
    setConfigSuccess(null);

    let validationFailed = false;

    const parseRequiredInt = (label: string, raw: string, min: number): number | null => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        setConfigError(`${label} is required.`);
        validationFailed = true;
        return null;
      }
      const value = Number.parseInt(trimmed, 10);
      if (Number.isNaN(value) || value < min) {
        setConfigError(`${label} must be at least ${min}.`);
        validationFailed = true;
        return null;
      }
      return value;
    };

    const parseOptionalInt = (label: string, raw: string, min: number): number | null => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const value = Number.parseInt(trimmed, 10);
      if (Number.isNaN(value) || value < min) {
        setConfigError(`${label} must be at least ${min}.`);
        validationFailed = true;
        return null;
      }
      return value;
    };

    const startingBalance = parseRequiredInt('Starting balance', configState.startingBalance, 1);
    const minBetValue = parseRequiredInt('Minimum bet', configState.minBet, 1);
    const autoCloseGraceMinutes = parseRequiredInt(
      'Auto-close grace minutes',
      configState.autoCloseGraceMinutes,
      0,
    );
    const maxBetValue = parseOptionalInt(
      'Maximum bet',
      configState.maxBet,
      minBetValue ?? 1,
    );
    const maxOpenMarketsValue = parseOptionalInt(
      'Maximum open markets',
      configState.maxOpenMarkets,
      0,
    );

    if (
      validationFailed ||
      startingBalance === null ||
      minBetValue === null ||
      autoCloseGraceMinutes === null
    ) {
      setConfigSaving(false);
      return;
    }

    const payload: AppConfig = {
      startingBalance,
      minBet: minBetValue,
      maxBet: maxBetValue,
      maxOpenMarkets: maxOpenMarketsValue,
      leaderboardWindow: configState.leaderboardWindow,
      autoCloseGraceMinutes,
      featureFlags: { ...configState.featureFlags },
    };

    try {
      const { config, overridesApplied } = await updateConfigState(payload);
      setConfigOverridesApplied(overridesApplied);
      setConfigState(toConfigFormState(config));
      setConfigSuccess('Configuration saved successfully.');
      await onSessionRefresh();
    } catch (error) {
      const message = isApiError(error)
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Failed to update configuration.';
      setConfigError(message);
    } finally {
      setConfigSaving(false);
    }
  }, [configState, onSessionRefresh]);

  const handleConfigReset = useCallback(async () => {
    setConfigSaving(true);
    setConfigError(null);
    setConfigSuccess(null);

    try {
      const { config, overridesApplied } = await resetConfigState();
      setConfigOverridesApplied(overridesApplied);
      setConfigState(toConfigFormState(config));
      setConfigSuccess('Configuration reset to defaults.');
      await onSessionRefresh();
    } catch (error) {
      const message = isApiError(error)
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Failed to reset configuration.';
      setConfigError(message);
    } finally {
      setConfigSaving(false);
    }
  }, [onSessionRefresh]);

  const renderLifecycleTab = () => {
    const rawDrafts = draftMarkets ?? [];
    const rawOpen = openMarkets ?? [];
    const rawClosed = closedMarkets ?? [];
    const drafts = visibleDraftMarkets;
    const open = visibleOpenMarkets;
    const closed = visibleClosedMarkets;
    const hasDraftsLoading = draftsLoading && rawDrafts.length === 0;
    const hasOpenLoading = openLoading && rawOpen.length === 0;
    const hasClosedLoading = closedLoading && rawClosed.length === 0;
    const refreshing = draftsLoading || openLoading || closedLoading || auditLoading;
    const totalVisibleCount = drafts.length + open.length + closed.length;
    const totalMarketCount = rawDrafts.length + rawOpen.length + rawClosed.length;

    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold theme-heading">Lifecycle Operations</h2>
          <button
            type="button"
            className="btn-base btn-secondary px-4 py-2 text-sm"
            onClick={() => void refreshAll()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh Data'}
          </button>
        </div>

        {feedback && (
          <div
            className={`rounded px-4 py-3 text-sm ${
              feedback.type === 'success' ? 'feedback-success' : 'feedback-error'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {lifecycleError && (
          <div className="rounded px-4 py-3 text-sm feedback-error">
            Failed to load moderator data.{' '}
            {lifecycleError instanceof Error ? lifecycleError.message : 'Check moderator permissions.'}
          </div>
        )}

        <section className="rounded-2xl theme-card p-6">
          <CreateMarketPanel onCreated={refreshAll} />
        </section>

        <section className="rounded-2xl theme-card p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="flex w-full flex-col gap-1 text-sm theme-heading sm:max-w-xs">
              Search markets
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="input-control rounded-md px-3 py-2 text-sm"
                placeholder="Filter by title, tag, or market id"
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-sm theme-heading sm:max-w-xs">
              Sort by
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as 'date' | 'totalBets')}
                className="input-control rounded-md px-3 py-2 text-sm"
              >
                <option value="date">Closing soonest</option>
                <option value="totalBets">Total bet volume</option>
              </select>
            </label>
          </div>
          {hasActiveMarketFilter && (
            <p className="text-xs theme-muted">
              Showing {totalVisibleCount.toLocaleString()} of {totalMarketCount.toLocaleString()} markets across all tabs.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold theme-heading">Draft Markets</h3>
          {hasDraftsLoading ? (
            <p className="text-sm theme-subtle">Loading drafts…</p>
          ) : drafts.length === 0 ? (
            <p className="text-sm theme-subtle">
              {hasActiveMarketFilter
                ? 'No draft markets matched the current filters.'
                : 'No draft markets ready to publish.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {drafts.map((market) => {
                const tags = extractMarketTags(market);
                return (
                  <li key={market.id} className="rounded-2xl theme-card p-6">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <h4 className="text-lg font-semibold theme-heading">{market.title}</h4>
                          <p className="text-sm theme-subtle">Closes {formatDateTime(market.closesAt)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="btn-base btn-primary px-4 py-2 text-sm"
                            onClick={() => void handlePublish(market)}
                            disabled={isPending(market, 'publish')}
                          >
                            {isPending(market, 'publish') ? 'Publishing…' : 'Publish'}
                          </button>
                          <button
                            type="button"
                            className="btn-base btn-ghost px-4 py-2 text-sm"
                            onClick={() => void handlePublish(market, null)}
                            disabled={isPending(market, 'publish')}
                          >
                            {isPending(market, 'publish') ? 'Publishing…' : 'Publish w/out Auto-Close'}
                          </button>
                        </div>
                      </div>
                      {tags.length > 0 && (
                        <ul className="flex flex-wrap items-center gap-2 text-[11px] theme-muted">
                          {tags.map((tag) => (
                            <li
                              key={`${market.id}-tag-${tag}`}
                              className="badge-soft px-2 py-1 uppercase tracking-wide"
                            >
                              {tag}
                            </li>
                          ))}
                        </ul>
                      )}
                      <dl className="grid grid-cols-2 gap-y-1 text-xs theme-muted sm:grid-cols-4">
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
                        <div>
                          <dt className="font-medium theme-heading text-xs">Implied Yes</dt>
                          <dd>{formatProbability(market.impliedYesProbability)}</dd>
                        </div>
                      </dl>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold theme-heading">Open Markets</h3>
          {hasOpenLoading ? (
            <p className="text-sm theme-subtle">Loading open markets…</p>
          ) : open.length === 0 ? (
            <p className="text-sm theme-subtle">
              {hasActiveMarketFilter
                ? 'No open markets matched the current filters.'
                : 'No open markets currently accepting bets.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {open.map((market) => {
                const tags = extractMarketTags(market);
                return (
                  <li key={market.id} className="rounded-2xl theme-card p-6">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <h4 className="text-lg font-semibold theme-heading">{market.title}</h4>
                          <p className="text-sm theme-subtle">Closes {formatDateTime(market.closesAt)}</p>
                        </div>
                        <button
                          type="button"
                          className="btn-base btn-primary px-4 py-2 text-sm"
                          onClick={() => void handleClose(market)}
                          disabled={isPending(market, 'close')}
                        >
                          {isPending(market, 'close') ? 'Closing…' : 'Close Market'}
                        </button>
                      </div>
                      {tags.length > 0 && (
                        <ul className="flex flex-wrap items-center gap-2 text-[11px] theme-muted">
                          {tags.map((tag) => (
                            <li
                              key={`${market.id}-tag-${tag}`}
                              className="badge-soft px-2 py-1 uppercase tracking-wide"
                            >
                              {tag}
                            </li>
                          ))}
                        </ul>
                      )}
                      <dl className="grid grid-cols-2 gap-y-1 text-xs theme-muted sm:grid-cols-4">
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
                        <div>
                          <dt className="font-medium theme-heading text-xs">Implied No</dt>
                          <dd>{formatProbability(market.impliedNoProbability)}</dd>
                        </div>
                      </dl>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-lg font-semibold theme-heading">Closed Markets</h3>
            <p className="text-sm theme-subtle">
              Resolve outcomes to trigger payouts. Capture notes to enrich the audit trail.
            </p>
          </div>
          {hasClosedLoading ? (
            <p className="text-sm theme-subtle">Loading closed markets…</p>
          ) : closed.length === 0 ? (
            <p className="text-sm theme-subtle">
              {hasActiveMarketFilter
                ? 'No closed markets matched the current filters.'
                : 'No closed markets waiting on resolution.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {closed.map((market) => {
                const draft = ensureDraft(resolutionDrafts, market.id);
                const auditEntries = buildAuditEntries(market.metadata);
                const rawLastClosedAt = market.metadata?.['lastClosedAt'];
                const closedTimestamp = isString(rawLastClosedAt) ? rawLastClosedAt : market.closesAt;
                const tags = extractMarketTags(market);

                return (
                  <li key={market.id} className="rounded-2xl theme-card p-6">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <h4 className="text-lg font-semibold theme-heading">{market.title}</h4>
                        <p className="text-sm theme-subtle">
                          Closed {formatDateTime(closedTimestamp)} • Total bets {market.totalBets}
                        </p>
                      </div>

                      {tags.length > 0 && (
                        <ul className="flex flex-wrap items-center gap-2 text-[11px] theme-muted">
                          {tags.map((tag) => (
                            <li
                              key={`${market.id}-tag-${tag}`}
                              className="badge-soft px-2 py-1 uppercase tracking-wide"
                            >
                              {tag}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        {(['yes', 'no'] as const).map((side) => (
                          <button
                            key={side}
                            type="button"
                            className={`btn-base px-4 py-2 text-sm ${
                              draft.resolution === side ? 'btn-toggle-active' : 'btn-toggle-inactive'
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

                      <label className="flex flex-col gap-1 text-sm theme-heading">
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
                          className="w-full input-control rounded-md px-3 py-2 text-sm"
                          placeholder="Summarize supporting evidence or moderator context"
                        />
                      </label>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className="btn-base btn-primary px-4 py-2 text-sm"
                          onClick={() => void handleResolve(market)}
                          disabled={isPending(market, 'resolve')}
                        >
                          {isPending(market, 'resolve')
                            ? 'Resolving…'
                            : `Resolve as ${draft.resolution.toUpperCase()}`}
                        </button>
                        <button
                          type="button"
                          className="btn-base btn-secondary px-3 py-2 text-sm"
                          onClick={() =>
                            setResolutionDrafts((current) => {
                              const next = { ...current };
                              delete next[market.id];
                              return next;
                            })
                          }
                          disabled={isPending(market, 'resolve')}
                        >
                          Clear Draft
                        </button>
                      </div>

                      <dl className="grid grid-cols-2 gap-y-2 text-xs theme-muted sm:grid-cols-4">
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

                      {auditEntries.length > 0 && (
                        <div className="rounded-md border theme-border bg-[color:var(--surface-muted)] px-3 py-2 text-xs theme-muted">
                          <p className="mb-1 font-semibold theme-heading text-sm">Audit Trail</p>
                          <ul className="list-disc pl-4">
                            {auditEntries.map((entry) => (
                              <li key={`${market.id}-${entry.label}`}>
                                <span className="font-medium theme-heading text-xs">{entry.label}:</span>{' '}
                                {entry.value}
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

        <section className="rounded-2xl theme-card p-6">
          <ManualAdjustmentPanel auditActions={auditActions} onAdjustmentRecorded={refreshAll} />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold theme-heading">Recent Moderator Actions</h3>
            <p className="text-sm theme-subtle">
              Latest audit log entries from the backend.{auditFetchedAt ? ` Updated ${formatDateTime(auditFetchedAt)}.` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {AUDIT_FILTER_OPTIONS.map((option) => {
              const active = option.key === auditFilter;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`btn-base px-3 py-1.5 ${active ? 'btn-toggle-active' : 'btn-toggle-inactive'}`}
                  onClick={() => setAuditFilter(option.key)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <p className="text-xs theme-muted">{activeAuditFilter.description}</p>

          {auditLoading && auditActions.length === 0 ? (
            <p className="text-sm theme-subtle">Loading audit log…</p>
          ) : filteredAuditActions.length === 0 ? (
            <p className="text-sm theme-subtle">
              No actions matched the selected filter. Try expanding to “All Actions”.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {filteredAuditActions.map((entry) => {
                const badges = buildActionBadges(entry);
                const payloadJson = serializePayload(entry.payload);
                const isExpanded = expandedAuditEntries.has(entry.id);
                const hasDetails = badges.length > 0 || payloadJson !== null || Boolean(entry.snapshot);

                return (
                  <li key={entry.id} className="rounded-2xl theme-card p-6">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold theme-heading">{formatActionLabel(entry.action)}</p>
                          <p className="text-xs theme-muted">{formatDateTime(entry.createdAt)}</p>
                        </div>
                        <div className="text-xs theme-muted">
                          <span className="font-medium theme-heading text-xs">Moderator:</span>{' '}
                          {entry.performedByUsername || entry.performedBy}
                        </div>
                      </div>

                      {hasDetails && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] theme-muted">
                          <button
                            type="button"
                            className="btn-base btn-ghost px-2.5 py-1"
                            onClick={() => toggleAuditEntry(entry.id)}
                          >
                            {isExpanded ? 'Hide details' : 'Show details'}
                          </button>
                          {entry.snapshot && !isExpanded && (
                            <span className="badge-soft px-2 py-1 uppercase tracking-wide">Snapshot saved</span>
                          )}
                        </div>
                      )}

                      {isExpanded && (
                        <div className="flex flex-col gap-2">
                          {badges.length > 0 && (
                            <ul className="flex flex-wrap items-center gap-2 text-[11px] theme-muted">
                              {badges.map((badge) => (
                                <li key={`${entry.id}-${badge.label}`} className="badge-soft px-2.5 py-1">
                                  <span className="font-medium theme-heading text-[11px]">{badge.label}:</span>{' '}
                                  {badge.value}
                                </li>
                              ))}
                            </ul>
                          )}
                          {payloadJson && (
                            <pre className="overflow-x-auto code-block text-xs">{payloadJson}</pre>
                          )}
                          {entry.snapshot && (
                            <p className="text-xs theme-muted">
                              Snapshot captured with before/after state for this action.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {archiveConfirmOpen && archiveResult && archiveResult.dryRun && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
            <div className="w-full max-w-xl rounded-2xl theme-card p-6 shadow-2xl">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h4 className="text-lg font-semibold theme-heading">Confirm archive purge</h4>
                  <p className="text-sm theme-subtle">
                    Archiving will permanently remove {archiveResult.archivedMarkets} market(s) and their associated bets. Review the summary below before continuing.
                  </p>
                </div>

                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm theme-muted">
                  <div>
                    <dt className="text-xs uppercase tracking-wide theme-subtle">Eligible markets</dt>
                    <dd className="text-base font-semibold theme-heading">{archiveResult.archivedMarkets}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide theme-subtle">Skipped</dt>
                    <dd className="text-base font-semibold theme-heading">{archiveResult.skippedMarkets}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide theme-subtle">Processed sample</dt>
                    <dd className="text-base font-semibold theme-heading">{archiveResult.processedMarkets}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide theme-subtle">Cutoff timestamp</dt>
                    <dd className="text-base font-semibold theme-heading">{formatDateTime(archiveResult.cutoffIso)}</dd>
                  </div>
                </dl>

                <p className="text-xs theme-muted">
                  This run will apply the same filters used in the latest dry-run. Archiving cannot be undone.
                </p>

                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    className="btn-base btn-ghost px-4 py-2 text-sm"
                    onClick={handleArchiveCancel}
                    disabled={archiveLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-base btn-primary px-4 py-2 text-sm"
                    onClick={handleArchiveConfirm}
                    disabled={archiveLoading}
                  >
                    {archiveLoading ? 'Archiving…' : 'Confirm purge'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMaintenanceTab = () => {
    const metrics = metricsState.data;
    const counters = metrics?.counters ?? {};
    const knownMetricCards = METRIC_CARD_CONFIG.filter((card) => counters[card.key] !== undefined);
    const extraMetricEntries: Array<[string, number]> = Object.entries(counters).filter(
      ([key]) => !METRIC_CARD_KEYS.has(key),
    );
  const incidents: ReadonlyArray<IncidentSummary> = incidentsState.data?.incidents ?? [];
  const incidentsLoading = incidentsState.loading && incidents.length === 0;
  const noMetricsAvailable = knownMetricCards.length === 0 && extraMetricEntries.length === 0;
  const metricsLoading = metricsState.loading && noMetricsAvailable;
    const maintenanceLoading = metricsState.loading || incidentsState.loading;

    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold theme-heading">Maintenance &amp; Operations</h2>
            <p className="text-sm theme-subtle">
              Monitor backend health, review incidents, and manage archival tooling verified against the live endpoints. Metrics auto-refresh every minute while this tab remains open.
            </p>
          </div>
          <button
            type="button"
            className="btn-base btn-secondary px-4 py-2 text-sm"
            onClick={handleMaintenanceRefresh}
            disabled={maintenanceLoading}
          >
            {maintenanceLoading ? 'Refreshing…' : 'Refresh Data'}
          </button>
        </div>

        {maintenanceFeedback && (
          <div
            className={`rounded px-4 py-3 text-sm ${
              maintenanceFeedback.type === 'success' ? 'feedback-success' : 'feedback-error'
            }`}
          >
            {maintenanceFeedback.message}
          </div>
        )}

        <section className="rounded-2xl theme-card p-6 flex flex-col gap-5">
          <div>
            <h3 className="text-lg font-semibold theme-heading">Full System Reset</h3>
            <p className="text-sm theme-subtle">
              Permanently delete all markets, bets, balances, leaderboards, config overrides, and audit logs for this subreddit. This action cannot be undone.
            </p>
          </div>

          {systemResetError && (
            <div className="rounded px-3 py-2 text-sm feedback-error">{systemResetError}</div>
          )}

          {systemResetSummary && (
            <div className="rounded px-3 py-2 text-sm feedback-success">
              Deleted {systemResetSummary.deletedKeys.toLocaleString()} of {systemResetSummary.attemptedKeys.toLocaleString()} keys
              {systemResetSummary.errors > 0
                ? ` · ${systemResetSummary.errors} deletion error${systemResetSummary.errors === 1 ? '' : 's'} recorded`
                : ' without errors'}
              .
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {systemResetConfirmVisible ? (
              <>
                <button
                  type="button"
                  className="btn-base btn-danger px-4 py-2 text-sm"
                  onClick={() => void handleSystemResetExecute()}
                  disabled={systemResetPending}
                >
                  {systemResetPending ? 'Resetting…' : 'Are you sure?'}
                </button>
                <button
                  type="button"
                  className="btn-base btn-ghost px-4 py-2 text-sm"
                  onClick={handleSystemResetCancel}
                  disabled={systemResetPending}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-base btn-danger px-4 py-2 text-sm"
                onClick={handleSystemResetPrime}
                disabled={systemResetPending}
              >
                Reset all data
              </button>
            )}
            <p className="text-xs theme-muted">
              Audit logs capture the moderator username, timestamp, and result summary.
            </p>
          </div>
        </section>

        {archiveError && <div className="rounded px-4 py-3 text-sm feedback-error">{archiveError}</div>}

        <section className="rounded-2xl theme-card p-6 flex flex-col gap-5">
          <div>
            <h3 className="text-lg font-semibold theme-heading">System Metrics</h3>
            <p className="text-sm theme-subtle">
              {metrics?.updatedAt
                ? `Snapshot refreshed ${formatDateTime(metrics.updatedAt)}.`
                : 'No metrics reported by the backend yet.'}
            </p>
          </div>
          {metricsLoading ? (
            <p className="text-sm theme-subtle">Loading metrics…</p>
          ) : metricsState.error ? (
            <p className="rounded px-3 py-2 text-sm feedback-error">{metricsState.error}</p>
          ) : knownMetricCards.length === 0 && extraMetricEntries.length === 0 ? (
            <p className="text-sm theme-subtle">No counters currently exposed by the backend.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {knownMetricCards.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {knownMetricCards.map((card) => {
                    const raw = counters[card.key] ?? 0;
                    const valueText = formatMetricValue(raw, card.format);
                    const valueClass = card.accent === 'primary' ? 'text-2xl' : 'text-xl';
                    return (
                      <div
                        key={card.key}
                        className="rounded border theme-border px-4 py-3"
                        style={card.accent === 'primary' ? { backgroundColor: 'var(--surface-muted)' } : undefined}
                      >
                        <dt className="text-xs font-medium uppercase tracking-wide theme-subtle">
                          {card.label}
                        </dt>
                        <dd className={`${valueClass} font-semibold theme-heading`}>{valueText}</dd>
                        {card.description && (
                          <p className="text-xs theme-muted">{card.description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {extraMetricEntries.length > 0 && (
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {extraMetricEntries.map(([name, value]) => (
                    <div key={name} className="rounded border theme-border px-4 py-3">
                      <dt className="text-xs font-medium uppercase tracking-wide theme-subtle">{name}</dt>
                      <dd className="text-lg font-semibold theme-heading">{value.toLocaleString()}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl theme-card p-6 flex flex-col gap-5">
          <div>
            <h3 className="text-lg font-semibold theme-heading">Incident Feed</h3>
            <p className="text-sm theme-subtle">
              Recent operational alerts surfaced from background workers.
            </p>
          </div>
          {incidentsLoading ? (
            <p className="text-sm theme-subtle">Loading incidents…</p>
          ) : incidentsState.error ? (
            <p className="text-sm feedback-error px-3 py-2 rounded">{incidentsState.error}</p>
          ) : incidents.length === 0 ? (
            <p className="text-sm theme-subtle">No incidents recorded in the recent window.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {incidents.map((incident) => (
                <li key={incident.id} className="rounded border theme-border px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                      <span className="text-sm font-semibold theme-heading">{incident.message}</span>
                      <span className="text-xs theme-muted">{formatDateTime(incident.createdAt)}</span>
                    </div>
                    <span className="text-xs uppercase tracking-wide theme-subtle">
                      Severity: {incident.severity}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl theme-card p-6 flex flex-col gap-5">
          <div>
            <h3 className="text-lg font-semibold theme-heading">Archive Markets</h3>
            <p className="text-sm theme-subtle">
              Dry-run to preview impact, then archive to remove aged markets immediately once you are confident in the filters below.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm theme-heading">
              Markets older than (days)
              <input
                type="number"
                min={1}
                value={archiveForm.olderThanDays}
                onChange={handleArchiveNumberChange('olderThanDays')}
                className="input-control rounded-md px-3 py-2 text-sm"
                disabled={archiveLoading}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm theme-heading">
              Max markets to process (optional)
              <input
                type="number"
                min={1}
                value={archiveForm.maxMarkets}
                onChange={handleArchiveNumberChange('maxMarkets')}
                className="input-control rounded-md px-3 py-2 text-sm"
                disabled={archiveLoading}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm theme-heading">
              Page
              <input
                type="number"
                min={1}
                value={archiveForm.page}
                onChange={handleArchiveNumberChange('page')}
                className="input-control rounded-md px-3 py-2 text-sm"
                disabled={archiveLoading}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm theme-heading">
              Results per page
              <input
                type="number"
                min={1}
                max={500}
                value={archiveForm.pageSize}
                onChange={handleArchiveNumberChange('pageSize')}
                className="input-control rounded-md px-3 py-2 text-sm"
                disabled={archiveLoading}
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-semibold theme-heading">Include statuses</legend>
            <div className="flex flex-wrap gap-3">
              {ARCHIVE_STATUS_OPTIONS.map((option) => (
                <label key={option.value} className="inline-flex items-center gap-2 text-sm theme-heading">
                  <input
                    type="checkbox"
                    className="accent-current"
                    checked={archiveForm.statuses.has(option.value)}
                    onChange={() => handleArchiveStatusToggle(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-base btn-secondary px-4 py-2 text-sm"
              onClick={handleArchiveDryRun}
              disabled={archiveLoading}
            >
              {archiveLoading ? 'Running…' : 'Dry Run'}
            </button>
            <button
              type="button"
              className="btn-base btn-primary px-4 py-2 text-sm"
              onClick={handleArchiveRequest}
              disabled={archiveLoading}
            >
              {archiveLoading ? 'Archiving…' : 'Archive Markets'}
            </button>
            <button
              type="button"
              className="btn-base btn-ghost px-4 py-2 text-sm"
              onClick={handleArchiveReset}
              disabled={archiveLoading}
            >
              Reset Form
            </button>
          </div>

          {archiveResult && (() => {
            const { pagination } = archiveResult;
            const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
            const pageRangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
            const pageRangeEnd = pagination.total === 0
              ? 0
              : Math.min(pagination.total, pagination.page * pagination.pageSize);

            return (
              <div className="rounded border theme-border px-4 py-4 text-sm flex flex-col gap-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-semibold theme-heading">
                    {archiveResult.dryRun ? 'Dry-run results' : 'Archive completed'}
                  </p>
                  <span className="text-xs theme-muted">
                    Page {pagination.page} of {totalPages} · Showing {pageRangeStart}-{pageRangeEnd} of {pagination.total}
                  </span>
                </div>

                <dl className="grid grid-cols-1 gap-y-1 text-sm theme-muted sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide theme-subtle">Processed</dt>
                    <dd>{archiveResult.processedMarkets} market(s)</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide theme-subtle">Eligible</dt>
                    <dd>{archiveResult.archivedMarkets}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide theme-subtle">Skipped</dt>
                    <dd>{archiveResult.skippedMarkets}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide theme-subtle">Cutoff</dt>
                    <dd>{formatDateTime(archiveResult.cutoffIso)}</dd>
                  </div>
                </dl>

                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold theme-heading">Candidate markets</h4>
                  {archiveResult.candidates.length === 0 ? (
                    <p className="text-sm theme-subtle">No candidates on this page. Adjust pagination to inspect other segments.</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {archiveResult.candidates.map((candidate) => (
                        <li key={candidate.id} className="rounded border theme-border px-4 py-3 flex flex-col gap-2">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-sm font-semibold theme-heading">{candidate.title}</span>
                            <span className="text-xs uppercase tracking-wide theme-subtle">
                              Status: {candidate.status.toUpperCase()} · Closed {formatDateTime(candidate.closesAt)}
                            </span>
                          </div>
                          <dl className="grid grid-cols-2 gap-y-1 text-xs theme-muted sm:grid-cols-4">
                            <div>
                              <dt className="text-xs uppercase tracking-wide theme-subtle">Pot Yes</dt>
                              <dd>{formatPoints(candidate.potYes)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase tracking-wide theme-subtle">Pot No</dt>
                              <dd>{formatPoints(candidate.potNo)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase tracking-wide theme-subtle">Total Bets</dt>
                              <dd>{candidate.totalBets}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase tracking-wide theme-subtle">Implied Yes</dt>
                              <dd>{formatProbability(candidate.impliedYesProbability)}</dd>
                            </div>
                          </dl>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })()}
        </section>
      </div>
    );
  };

  const renderConfigurationTab = () => {
    const configLoaded = configState !== null;

    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold theme-heading">Configuration Overrides</h2>
            <p className="text-sm theme-subtle">
              Review the live Devvit settings snapshot and push overrides to Redis when runtime tweaks are needed.
            </p>
          </div>
          <button
            type="button"
            className="btn-base btn-secondary px-4 py-2 text-sm"
            onClick={handleConfigReload}
            disabled={configLoading || configSaving}
          >
            {configLoading ? 'Loading…' : 'Reload'}
          </button>
        </div>

        {configOverridesApplied !== null && (
          <div
            className={`rounded px-4 py-3 text-sm ${
              configOverridesApplied ? 'feedback-warning' : 'feedback-success'
            }`}
          >
            {configOverridesApplied
              ? 'Override values are active. Saving or resetting updates the Redis snapshot immediately.'
              : 'No Redis overrides detected. Live config matches the Devvit defaults.'}
          </div>
        )}

        {configError && <div className="rounded px-4 py-3 text-sm feedback-error">{configError}</div>}

        {configSuccess && (
          <div className="rounded px-4 py-3 text-sm feedback-success">{configSuccess}</div>
        )}

        {configLoaded ? (
          <form
            className="rounded-2xl theme-card p-6 flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleConfigSave();
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm theme-heading">
                Starting balance
                <input
                  type="number"
                  min={1}
                  value={configState.startingBalance}
                  onChange={handleConfigNumericChange('startingBalance')}
                  className="input-control rounded-md px-3 py-2 text-sm"
                  disabled={configSaving}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm theme-heading">
                Minimum bet
                <input
                  type="number"
                  min={1}
                  value={configState.minBet}
                  onChange={handleConfigNumericChange('minBet')}
                  className="input-control rounded-md px-3 py-2 text-sm"
                  disabled={configSaving}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm theme-heading">
                Maximum bet (optional)
                <input
                  type="number"
                  min={configState.minBet ? Number.parseInt(configState.minBet, 10) || 1 : 1}
                  value={configState.maxBet}
                  onChange={handleConfigNumericChange('maxBet')}
                  className="input-control rounded-md px-3 py-2 text-sm"
                  disabled={configSaving || !configEditorEnabled}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm theme-heading">
                Max open markets (optional)
                <input
                  type="number"
                  min={0}
                  value={configState.maxOpenMarkets}
                  onChange={handleConfigNumericChange('maxOpenMarkets')}
                  className="input-control rounded-md px-3 py-2 text-sm"
                  disabled={configSaving || !configEditorEnabled}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm theme-heading">
                Auto-close grace (minutes)
                <input
                  type="number"
                  min={0}
                  value={configState.autoCloseGraceMinutes}
                  onChange={handleConfigNumericChange('autoCloseGraceMinutes')}
                  className="input-control rounded-md px-3 py-2 text-sm"
                  disabled={configSaving}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm theme-heading">
                Leaderboard window
                <select
                  value={configState.leaderboardWindow}
                  onChange={handleLeaderboardWindowChange}
                  className="input-control rounded-md px-3 py-2 text-sm"
                  disabled={configSaving || !configEditorEnabled}
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="alltime">All time</option>
                </select>
              </label>
            </div>

            {!configEditorEnabled && (
              <div className="rounded px-3 py-2 text-xs feedback-warning">
                Enable the config editor flag below and save to unlock editable numeric inputs.
              </div>
            )}

            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-semibold theme-heading">Feature flags</legend>
              <div className="flex flex-col gap-2">
                {FEATURE_FLAG_OPTIONS.map((flag) => (
                  <label key={flag.key} className="flex items-start gap-3 text-sm theme-heading">
                    <input
                      type="checkbox"
                      className="mt-1 accent-current"
                      checked={configState.featureFlags[flag.key]}
                      onChange={handleFeatureFlagToggle(flag.key)}
                      disabled={configSaving}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold theme-heading text-sm">{flag.label}</span>
                      <span className="text-xs theme-subtle">{flag.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="btn-base btn-primary px-4 py-2 text-sm"
                disabled={configSaving}
              >
                {configSaving ? 'Saving…' : 'Save overrides'}
              </button>
              <button
                type="button"
                className="btn-base btn-secondary px-4 py-2 text-sm"
                onClick={() => void handleConfigReset()}
                disabled={configSaving}
              >
                {configSaving ? 'Resetting…' : 'Reset to defaults'}
              </button>
            </div>
          </form>
        ) : (
          <section className="rounded-2xl theme-card p-6 flex flex-col gap-4">
            <p className="text-sm theme-subtle">
              Configuration has not been loaded yet. Use the button above to fetch the live snapshot.
            </p>
            <button
              type="button"
              className="btn-base btn-primary px-4 py-2 text-sm self-start"
              onClick={handleConfigReload}
              disabled={configLoading}
            >
              {configLoading ? 'Loading…' : 'Load configuration'}
            </button>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto py-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold theme-heading">Moderator Operations Console</h1>
          <p className="text-sm theme-subtle">
            Manage market lifecycles, maintenance workflows, and runtime configuration for the predictions bot.
          </p>
        </div>
        <div className="text-sm theme-subtle sm:text-right">
          {session.username ? `Signed in as ${session.username}` : 'Anonymous session'}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b theme-border pb-2">
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              className={`btn-base px-4 py-2 text-sm ${
                active ? 'btn-toggle-active' : 'btn-toggle-inactive'
              }`}
              onClick={() => handleTabSelect(tab.key)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'lifecycle' && renderLifecycleTab()}
      {activeTab === 'maintenance' && renderMaintenanceTab()}
      {activeTab === 'configuration' && renderConfigurationTab()}
    </div>
  );
};
