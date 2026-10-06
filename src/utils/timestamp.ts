/**
 * Normalises a Postgres timestamp string into strict ISO 8601. Columns are
 * `timestamptz`, which the driver returns as `"2026-06-08 09:55:00+07"` — a space
 * instead of `T` and an hour-only offset, neither of which `Date.parse` is
 * guaranteed to accept in every runtime. A value with no zone at all (a legacy
 * `timestamp` row) is read as UTC, which is how this app always wrote them.
 */
export function normalizeDbTimestamp(value: string): string {
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  if (/Z$/.test(iso)) return iso;
  if (/[+-]\d\d:\d\d$/.test(iso)) return iso;
  if (/[+-]\d\d$/.test(iso)) return `${iso}:00`;
  if (/[+-]\d{4}$/.test(iso)) return `${iso.slice(0, -2)}:${iso.slice(-2)}`;
  return `${iso}Z`;
}

/** Epoch ms for a Postgres timestamp string (NaN if unparseable). */
export const parseDbTimestamp = (value: string): number => Date.parse(normalizeDbTimestamp(value));
