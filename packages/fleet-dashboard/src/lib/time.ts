/** Compact durations for a phone-width row: `3h`, `2d`, `5w`. */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;

  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks}w`;

  return `${Math.floor(days / 30)}mo`;
}

/** How long ago `iso` was. */
export function age(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 0) return "now";
  return formatDuration(ms);
}

/** "in 6h" / "in 3d" — for a gardener's next scheduled fire. */
export function until(iso: string, now: Date = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "due";
  return `in ${formatDuration(ms)}`;
}

/** Local-time absolute stamp for tooltips, where precision beats brevity. */
export function absolute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
