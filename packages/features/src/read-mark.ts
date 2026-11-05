/**
 * read-mark.ts -- how far a member has read a task or an agent with no task, kept on the account so it follows them to every Mac and browser.
 *
 * A mark is the instant the member read the row through, which the service
 * stamps with its own clock as the write lands (`task_read`, `agent_read`),
 * and whether they marked it unread by hand. A row is unread while something
 * changed in it after that instant, or while it stands marked unread; the
 * row being looked at is never drawn unread by its changes, since they land
 * before the reader's eyes.
 */

import { Schema as EffectSchema } from "effect";

/**
 * What a write makes of the reader's mark: `READ` reads the row through now
 * and takes a mark by hand back, as opening it or Mark as read does; `SEEN`
 * reads it through now and leaves a mark by hand standing, as leaving a row
 * the reader marked unread while on it does; `UNREAD` marks it unread by hand
 * and leaves the instant it was read through as it stood.
 */
export const READ_MARK = {
  READ: "read",
  SEEN: "seen",
  UNREAD: "unread",
} as const;

export type ReadMark = (typeof READ_MARK)[keyof typeof READ_MARK];

export const readMarkSchema = EffectSchema.Literals(Object.values(READ_MARK));

/** A row's mark as the reader's list carries it: the instant it was read through, and whether it stands marked unread. */
export interface ReadMarked {
  readonly readThrough?: number;
  readonly markedUnread?: boolean;
}

/** The reader's read mark as a row carries it, each part only where the service sent it. */
export function readMarkOf(row: ReadMarked): ReadMarked {
  return {
    ...(row.readThrough === undefined ? undefined : { readThrough: row.readThrough }),
    ...(row.markedUnread === undefined ? undefined : { markedUnread: row.markedUnread }),
  };
}

/**
 * Whether a row whose newest change is `newest` reads unread for the reader:
 * marked so by hand, or changed after its mark. Note that a row carrying no
 * mark, from a service before marks were kept, reads read, because drawing
 * every row unread at once tells the reader nothing.
 */
export function readsUnread(row: ReadMarked, newest: number): boolean {
  return row.markedUnread === true || (row.readThrough !== undefined && newest > row.readThrough);
}

/**
 * The mark a write leaves on a row, drawn before the service answers: read
 * through `now` where it reads the row, never moved back, and marked unread
 * by hand as it asks. The service's own instant takes its place as the
 * answer lands.
 */
export function markedAs(mark: ReadMark, standing: ReadMarked, now: number): ReadMarked {
  const readThrough = Math.max(standing.readThrough ?? now, now);
  switch (mark) {
    case READ_MARK.READ:
      return { readThrough, markedUnread: false };
    case READ_MARK.SEEN:
      return { readThrough };
    case READ_MARK.UNREAD:
      return { markedUnread: true };
  }
}
