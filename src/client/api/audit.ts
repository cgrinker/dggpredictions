import type { AuditLogResponse, AuditLogResponseEnvelope } from '../../shared/types/dto.js';
import { apiFetch, type ApiError } from './client.js';

export interface GetAuditLogOptions {
  readonly limit?: number;
}

export type AuditApiError = ApiError;

const buildQuery = (options?: GetAuditLogOptions): string => {
  if (!options || options.limit === undefined) {
    return '';
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit));
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
};

export const getAuditLog = async (options?: GetAuditLogOptions): Promise<AuditLogResponse> => {
  const query = buildQuery(options);
  const envelope = await apiFetch<AuditLogResponseEnvelope>(`/internal/audit/logs${query}`);
  return envelope.data;
};
