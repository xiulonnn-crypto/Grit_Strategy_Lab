export function formatPercent(value: number | null | undefined): string {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const percent = normalized * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

export function formatRatio(value: number | null | undefined): string {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return normalized.toFixed(2);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('zh-HK', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}
