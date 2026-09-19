/**
 * The absolute time range the user picks with a calendar and two clocks.
 *
 * Kept apart from the card and free of any DOM or Home Assistant reference,
 * because the fiddly parts are here: the fields arrive as the strings the
 * browser's date and time inputs produce, half of them may be empty, and the
 * result decides which slice of the recorder gets queried. That is worth
 * testing without a browser.
 *
 * Everything is interpreted in the *local* time zone, which is the one the user
 * reads off their own screen. Building the dates from the components rather
 * than parsing `"2026-09-15T08:00"` is deliberate -- the string form has been
 * read as UTC by some engines, which would shift every range by the offset.
 */

import { TODAY, type TimeRange } from "./const";

/** The four inputs, exactly as the form fields hold them. */
export interface RangeFields {
  /** `YYYY-MM-DD`, as produced by `<input type="date">`. */
  fromDate: string;
  /** Empty means "the same day", which is how a single day is expressed. */
  toDate: string;
  /** `HH:MM`, as produced by `<input type="time">`. Empty means midnight. */
  fromTime: string;
  /** Empty means the end of the day. */
  toTime: string;
}

export interface AbsoluteRange {
  /** Epoch milliseconds. */
  start: number;
  end: number;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

function parseDate(value: string): [number, number, number] | undefined {
  const match = DATE.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return [Number(year), Number(month) - 1, Number(day)];
}

function parseTime(value: string, fallback: [number, number]): [number, number] | undefined {
  if (value === "") return fallback;
  const match = TIME.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return [hours, minutes];
}

/**
 * Turns the four fields into a range, or `undefined` when there is not enough
 * to work with.
 *
 * A missing end date means the range stays on the start date, so picking one day
 * and two times is all it takes. A missing end time runs to the last second of
 * that day rather than to midnight sharp, so "to 23:00" and "the whole day" are
 * different things and neither silently drops the final minute.
 *
 * Reversed ends are swapped instead of rejected. Someone who enters 18:00 to
 * 08:00 wants those eight hours; an error message would only ask them to type
 * the same two values again in the other order.
 */
export function resolveRange(fields: RangeFields): AbsoluteRange | undefined {
  const from = parseDate(fields.fromDate);
  if (!from) return undefined;

  const to = fields.toDate === "" ? from : parseDate(fields.toDate);
  if (!to) return undefined;

  const fromTime = parseTime(fields.fromTime, [0, 0]);
  const toTime = parseTime(fields.toTime, [23, 59]);
  if (!fromTime || !toTime) return undefined;

  // Seconds and milliseconds: an end left at the default covers the whole
  // minute, an explicit one starts it.
  const endSeconds = fields.toTime === "" ? 59 : 0;

  const start = new Date(from[0], from[1], from[2], fromTime[0], fromTime[1], 0, 0).getTime();
  const end = new Date(to[0], to[1], to[2], toTime[0], toTime[1], endSeconds, 999).getTime();

  return start <= end ? { start, end } : { start: end, end: start };
}

/** `15.09. 08:00 – 17:30`, or with both dates when the range spans days. */
export function formatAbsoluteRange(range: AbsoluteRange, locale: string): string {
  const date = (at: number) =>
    new Date(at).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
  const time = (at: number) =>
    new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  const sameDay = new Date(range.start).toDateString() === new Date(range.end).toDateString();
  if (sameDay) return `${date(range.start)} ${time(range.start)} – ${time(range.end)}`;
  return `${date(range.start)} ${time(range.start)} – ${date(range.end)} ${time(range.end)}`;
}

/** `YYYY-MM-DD` for a date input, in local time rather than UTC. */
export function toDateField(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:MM` for a time input. */
export function toTimeField(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Where the rolling window starts, given where it ends.
 *
 * `TODAY` means local midnight, and it is found with `setHours` rather than by
 * subtracting 24 hours: on the two days a year the clocks change, a day is 23
 * or 25 hours long, and only the calendar knows which. Subtracting would land
 * an hour into yesterday every spring.
 */
export function windowStart(end: number, range: TimeRange): number {
  if (range === TODAY) {
    const midnight = new Date(end);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  return end - range * 3_600_000;
}
