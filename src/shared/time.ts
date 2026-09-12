/**
 * "2m ago", for the restore prompt.
 *
 * Hand-rolled rather than Intl.RelativeTimeFormat because this runs in the
 * content script, where every byte is spent on someone else's page, and because
 * Intl's output ("2 minutes ago") is longer than a pill sitting inside a text
 * box has room for.
 *
 * Floors rather than rounds: ninety seconds reads better as "1m ago" than as
 * "2m ago", and a label that overstates how old a draft is makes it look less
 * worth recovering than it is.
 */
export function relativeTime(from: number, now = Date.now()): string {
  // Clamp: a clock adjustment between saving and reading should not produce
  // "in 3 hours".
  const seconds = Math.max(0, Math.floor((now - from) / 1000));

  if (seconds < 45) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return `${Math.floor(days / 7)}w ago`;
}
