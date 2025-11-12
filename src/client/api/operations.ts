import type { ApiSuccessEnvelope } from '../../shared/types/dto.js';
import { apiFetch } from './client.js';

export interface MetricsSummary {
  readonly counters: Record<string, number>;
  readonly updatedAt: string;
}

export interface IncidentSummary {
  readonly id: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly createdAt: string;
}

export interface IncidentFeed {
  readonly incidents: readonly IncidentSummary[];
  readonly fetchedAt: string;
}

export const getMetricsSummary = async (): Promise<MetricsSummary> => {
  const envelope = await apiFetch<ApiSuccessEnvelope<MetricsSummary>>(
    '/api/internal/metrics/summary',
  );
  return envelope.data;
};

export const getIncidentFeed = async (): Promise<IncidentFeed> => {
  const envelope = await apiFetch<ApiSuccessEnvelope<IncidentFeed>>(
    '/api/internal/incidents/recent',
  );
  return envelope.data;
};
