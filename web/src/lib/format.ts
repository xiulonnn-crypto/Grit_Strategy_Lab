function toValidDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

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
  const date = toValidDate(value);
  if (!date) {
    return '—';
  }
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatShortDate(value: string): string {
  const date = toValidDate(value);
  if (!date) {
    return '—';
  }
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatCompactDate(value: string | null | undefined): string {
  const date = toValidDate(value);
  if (!date) {
    return '—';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function formatCompactDateTime(value: string | null | undefined): string {
  const date = toValidDate(value);
  if (!date) {
    return '—';
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${formatCompactDate(value)} ${hours}:${minutes}`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('zh-HK', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}
