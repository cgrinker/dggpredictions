import type { AppConfig } from '../../shared/types/config.js';
import type { ConfigResponseEnvelope } from '../../shared/types/dto.js';
import { apiFetch } from './client.js';

export interface ConfigState {
  readonly config: AppConfig;
  readonly overridesApplied: boolean;
}

export const getConfigState = async (): Promise<ConfigState> => {
  const envelope = await apiFetch<ConfigResponseEnvelope>('/api/internal/config');
  return envelope.data;
};

export const updateConfigState = async (config: AppConfig): Promise<ConfigState> => {
  const envelope = await apiFetch<ConfigResponseEnvelope>('/api/internal/config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  return envelope.data;
};

export const resetConfigState = async (): Promise<ConfigState> => {
  const envelope = await apiFetch<ConfigResponseEnvelope>('/api/internal/config', {
    method: 'DELETE',
  });
  return envelope.data;
};
