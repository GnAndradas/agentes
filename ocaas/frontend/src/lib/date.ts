/**
 * Date utilities for handling timestamps from backend
 *
 * The backend stores timestamps in SECONDS (Unix timestamp)
 * JavaScript Date expects timestamps in MILLISECONDS
 */

/**
 * Convert a backend timestamp (seconds) to a Date object
 */
export function fromTimestamp(ts: number | undefined | null): Date | null {
  if (ts === undefined || ts === null) return null;
  // Backend timestamps are in seconds, JS expects milliseconds
  return new Date(ts * 1000);
}

/**
 * Format a backend timestamp as a locale string
 */
export function formatDateTime(ts: number | undefined | null): string {
  const date = fromTimestamp(ts);
  if (!date) return '-';
  return date.toLocaleString();
}

/**
 * Format a backend timestamp as a date only
 */
export function formatDate(ts: number | undefined | null): string {
  const date = fromTimestamp(ts);
  if (!date) return '-';
  return date.toLocaleDateString();
}

/**
 * Format a backend timestamp as relative time (e.g., "5m ago")
 */
export function formatRelativeTime(ts: number | undefined | null): string {
  const date = fromTimestamp(ts);
  if (!date) return '-';

  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 0) return 'just now';
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  return date.toLocaleDateString();
}
