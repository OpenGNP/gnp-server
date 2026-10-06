/**
 * Calendar maths in a caller-supplied IANA time zone (e.g. "Asia/Bangkok"), so the
 * dashboard's day / week / month / year buckets and range labels line up with the
 * viewer's own midnight instead of UTC's. Everything works on epoch-ms instants;
 * the zone only decides where a "day" starts and how a date is written.
 */
export type CalendarUnit = "day" | "week" | "month" | "year";

const FALLBACK_ZONE = "UTC";

/** A valid IANA zone name, or "UTC" when missing/unknown. */
export function resolveTimeZone(value?: string): string {
  if (!value) return FALLBACK_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return FALLBACK_ZONE;
  }
}

export function createCalendar(timeZone: string) {
  const partsFormat = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  });
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /** The wall-clock reading of instant `ms` in the zone. */
  const localParts = (ms: number) => {
    const out: Record<string, string> = {};
    for (const part of partsFormat.formatToParts(new Date(ms))) out[part.type] = part.value;
    return {
      y: Number(out.year),
      m: Number(out.month) - 1,
      d: Number(out.day),
      dow: WEEKDAYS.indexOf(out.weekday ?? "Sun"),
      /** The local wall clock read as if it were UTC — handy for offset maths. */
      wall: Date.UTC(
        Number(out.year),
        Number(out.month) - 1,
        Number(out.day),
        Number(out.hour),
        Number(out.minute),
        Number(out.second),
      ),
    };
  };

  /** zone offset (local − UTC) in ms at instant `ms`. */
  const offsetAt = (ms: number) => localParts(ms).wall - Math.floor(ms / 1000) * 1000;

  /** The instant at which the local calendar date y-m-d begins (handles DST shifts). */
  const midnightOf = (y: number, m: number, d: number) => {
    const asUtc = Date.UTC(y, m, d);
    const first = asUtc - offsetAt(asUtc);
    return asUtc - offsetAt(first);
  };

  /** Local calendar (y, m, d) of `ms`, shifted by whole days/months/years. */
  const shifted = (ms: number, unit: CalendarUnit, steps: number) => {
    const { y, m, d } = localParts(ms);
    if (unit === "day") return midnightOf(y, m, d + steps);
    if (unit === "week") return midnightOf(y, m, d + 7 * steps);
    if (unit === "month") return midnightOf(y, m + steps, 1);
    return midnightOf(y + steps, 0, 1);
  };

  return {
    timeZone,

    /** Start of the local day / ISO week (Mon) / month / year containing `ms`. */
    start(ms: number, unit: CalendarUnit): number {
      const { y, m, d, dow } = localParts(ms);
      if (unit === "day") return midnightOf(y, m, d);
      if (unit === "week") return midnightOf(y, m, d + (dow === 0 ? -6 : 1 - dow));
      if (unit === "month") return midnightOf(y, m, 1);
      return midnightOf(y, 0, 1);
    },

    /** Start of the period after the one starting at `ms`. */
    next: (ms: number, unit: CalendarUnit) => shifted(ms, unit, 1),

    /** Start of the period before the one starting at `ms`. */
    prev: (ms: number, unit: CalendarUnit) => shifted(ms, unit, -1),

    /** Axis label for a bucket starting at `ms`. */
    label(ms: number, unit: CalendarUnit): string {
      const d = new Date(ms);
      if (unit === "year") return d.toLocaleDateString("en-US", { year: "numeric", timeZone });
      if (unit === "month")
        return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone });
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone });
    },

    /** Short date for range labels, e.g. "8 Jun 2026". */
    date: (ms: number) =>
      new Date(ms).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone,
      }),
  };
}

export type Calendar = ReturnType<typeof createCalendar>;
