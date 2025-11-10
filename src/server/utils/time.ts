export const toEpochMillis = (iso: string): number => new Date(iso).getTime();

export const nowIso = (): string => new Date().toISOString();
