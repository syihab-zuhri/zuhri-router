/**
 * Keyset cursor for request lists shown newest first, ordered by (created_at desc, id). The cursor carries the time with
 * microsecond precision plus the row id: a millisecond time alone skips rows that share a millisecond or a timestamp.
 * A cursor without an id (links made before this format) pages by time only.
 */
export const CURSOR_TIME_SQL = `to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export function requestCursor(time: string, id: string): string { return `${time}~${id}`; }

/** An unreadable cursor reads as none (the first page), as before. */
export function parseRequestCursor(value: unknown): { time: string; id: string | null } | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)(?:~(req_[0-9a-f-]{36}))?$/.exec(value);
  if (!m || Number.isNaN(Date.parse(m[1]))) return null;
  return { time: m[1], id: m[2] ?? null };
}
