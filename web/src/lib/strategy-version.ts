export function stripStrategyVersionSuffix(name: string | null | undefined): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    return '';
  }

  let cursor = trimmed.length;
  while (cursor > 0 && /\d/.test(trimmed[cursor - 1] ?? '')) {
    cursor -= 1;
  }

  if (cursor > 0 && cursor < trimmed.length && trimmed[cursor - 1]?.toLowerCase() === 'v') {
    return trimmed.slice(0, cursor - 1).trimEnd();
  }

  return trimmed;
}

export function getStrategyDisplayName(name: string | null | undefined, fallback = '策略'): string {
  return stripStrategyVersionSuffix(name) || String(name ?? '').trim() || fallback;
}

export function formatStrategyVersionTag(value: string | null | undefined): string | null {
  const match = String(value ?? '').trim().match(/(?:^|-)v(\d+)$/i);
  return match ? `v${match[1]}` : null;
}
