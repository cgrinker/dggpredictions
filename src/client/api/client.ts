export interface ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown> | undefined;
}

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
} satisfies Record<string, string>;

const isApiErrorEnvelope = (value: unknown): value is {
  readonly error: { readonly code: string; readonly message: string; readonly details?: Record<string, unknown> };
} => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const envelope = value as { error?: unknown };
  if (!envelope.error || typeof envelope.error !== 'object') {
    return false;
  }
  const error = envelope.error as { code?: unknown; message?: unknown };
  return typeof error.code === 'string' && typeof error.message === 'string';
};

export const apiFetch = async <T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers ?? {});
  Object.entries(DEFAULT_HEADERS).forEach(([key, value]) => {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  });

  const response = await fetch(input, { ...init, headers });
  const asJson = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isApiErrorEnvelope(asJson)) {
      const apiError: ApiError = Object.assign(new Error(asJson.error.message), {
        status: response.status,
        code: asJson.error.code,
        details: asJson.error.details,
      });
      throw apiError;
    }

    const apiError: ApiError = Object.assign(new Error('Request failed.'), {
      status: response.status,
      code: 'HTTP_ERROR',
    });
    throw apiError;
  }

  return asJson as T;
};
