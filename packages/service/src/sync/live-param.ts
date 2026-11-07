/**
 * live-param.ts -- a live read's param read back as the value its statement binds.
 */

/** An instant a read's param binds as epoch milliseconds, as its procedure wrote it; the epoch where it names none. */
export function instantParam(param: string): Date {
  const millis = Number(param);
  return new Date(Number.isSafeInteger(millis) && millis > 0 ? millis : 0);
}
