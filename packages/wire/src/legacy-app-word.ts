/**
 * legacy-app-word.ts -- the word the app's own actor was stored and sent under before it was named `app`, read and never written.
 *
 * Rows, lines, and links written before the rename name the app as `luke`:
 * who sent a line, who paid for an agent or archived one, who showed a page
 * version or was asked in a comment, the channel of a wakeup line, the key a
 * kept picture is named under, and the step of a comment's mention link.
 * Those rows stay as they were stored, so every reader of one reads the old
 * word as `app`, and every writer writes `app` alone.
 */

import { Schema, SchemaTransformation } from "effect";

/** The app's own word in what an earlier build stored or sent. Note that it is only ever read, never written. */
export const LEGACY_APP_WORD = "luke";

/**
 * A stored literal set that reads `legacy`, an earlier build's word for
 * `current`, as `current`, and writes only `values`. Note that its stored
 * side is typed as `values` alone, because a write never names `legacy`,
 * so a store's statement keeps its column's own type; its guard lets
 * `legacy` in only for the decode to read it as `current`.
 */
export function literalsReadingLegacy<const Values extends ReadonlyArray<string>>(
  values: Values,
  legacy: string,
  current: Values[number],
) {
  const stored = Schema.declare(
    (input: unknown): input is Values[number] =>
      input === legacy || values.some((value) => value === input),
  );
  return stored.pipe(
    Schema.decodeTo(
      Schema.Literals(values),
      SchemaTransformation.transform({
        decode: (read) => (read === legacy ? current : read),
        encode: (value) => value,
      }),
    ),
  );
}
