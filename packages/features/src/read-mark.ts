import { Schema as EffectSchema } from "effect";

export const READ_MARK = {
  READ: "read",
  SEEN: "seen",
  UNREAD: "unread",
} as const;

export type ReadMark = (typeof READ_MARK)[keyof typeof READ_MARK];

export const readMarkSchema = EffectSchema.Literals(Object.values(READ_MARK));

export interface ReadMarked {
  readonly readThrough?: number;
  readonly markedUnread?: boolean;
}

export function readMarkOf(row: ReadMarked): ReadMarked {
  return {
    ...(row.readThrough === undefined ? undefined : { readThrough: row.readThrough }),
    ...(row.markedUnread === undefined ? undefined : { markedUnread: row.markedUnread }),
  };
}

export function readsUnread(row: ReadMarked, newest: number): boolean {
  return row.markedUnread === true || (row.readThrough !== undefined && newest > row.readThrough);
}

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
