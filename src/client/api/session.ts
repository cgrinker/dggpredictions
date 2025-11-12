import type { SessionInfo, SessionResponseEnvelope } from '../../shared/types/dto.js';
import { apiFetch } from './client.js';

export const getSession = async (): Promise<SessionInfo> => {
  const envelope = await apiFetch<SessionResponseEnvelope>('/api/session');
  return envelope.data;
};
