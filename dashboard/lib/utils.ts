export function generateTaskId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `task-${ts}-${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
