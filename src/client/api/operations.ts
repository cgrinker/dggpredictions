import type {
  ApiSuccessEnvelope,
  IncidentFeed,
  MetricsSummary,
  SystemResetResponse,
} from '../../shared/types/dto.js';
import { apiFetch } from './client.js';

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

export const resetSystem = async (): Promise<SystemResetResponse> => {
  const envelope = await apiFetch<ApiSuccessEnvelope<SystemResetResponse>>(
    '/api/internal/system/reset',
    {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    },
  );
  return envelope.data;
};
