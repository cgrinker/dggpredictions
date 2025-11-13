export const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
};

export const formatRelativeTime = (iso: string): string => {
  const date = new Date(iso);
  const now = Date.now();
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const diff = date.getTime() - now;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(diff / 60_000);
  const hours = Math.round(diff / 3_600_000);

  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, 'minute');
  }

  return formatter.format(hours, 'hour');
};

export const formatPoints = (points: number): string => {
  const formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  });
  return formatter.format(points);
};

export const formatLeaderboardScore = (points: number): string => {
  const formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  });
  return formatter.format(points);
};

export const formatProbability = (value: number): string => `${(value * 100).toFixed(1)}%`;
