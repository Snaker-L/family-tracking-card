/** Locale-aware formatting helpers. Pure functions, no DOM access. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Renders a span such as `1 h 44 min`, `12 min` or `2 d 3 h`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < MINUTE) return `${Math.round(ms / 1000)} s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.round((ms % HOUR) / MINUTE);
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.round((ms % DAY) / HOUR);
  return hours === 0 ? `${days} d` : `${days} d ${hours} h`;
}

export function formatTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleDateString(locale, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

/** `14:03 – 15:47`, with the date prefixed when the stay crosses midnight. */
export function formatSpan(start: number, end: number, locale: string): string {
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  const from = formatTime(start, locale);
  const to = formatTime(end, locale);
  return sameDay ? `${from} – ${to}` : `${from} – ${formatDate(end, locale)} ${to}`;
}

export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "";
  return metres < 1000
    ? `${Math.round(metres / 10) * 10} m`
    : `${(metres / 1000).toFixed(1)} km`;
}

/** `6 h`, `24 h`, `3 d`, `7 d` for the range buttons. */
export function formatRange(hours: number): string {
  return hours % 24 === 0 && hours >= 24 ? `${hours / 24} d` : `${hours} h`;
}

export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
