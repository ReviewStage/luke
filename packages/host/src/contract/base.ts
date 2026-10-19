import "@orpc/experimental-effect/extensions/input-output";
import { oc } from "@orpc/contract";
import { Schema } from "effect";

/**
 * base.ts -- the builder every act procedure's contract starts from, and the refusal each declares.
 *
 * The import above is oRPC's Effect input-output extension, loaded here
 * because every act contract builds from this one, so `.input` and `.output`
 * take an Effect Schema before any procedure is declared. A refusal is one
 * declared error, `REFUSED`, whose message is the sentence the window that
 * asked draws; each procedure declares its own default sentence, which is
 * what it answers when nothing more particular is worth saying.
 */

/** The one error an act answers: refused, with a sentence. */
export const ACT_ERROR = { REFUSED: "REFUSED" } as const;

/** An act whose refusal, unless its row words one of its own, reads `sentence`. */
export function actProcedure(sentence: string) {
  return oc.errors({ [ACT_ERROR.REFUSED]: { message: sentence } });
}

/**
 * An act's input, read exactly: a key its schema does not name is refused
 * rather than dropped, as `app:act` refused it.
 */
export function exactInput<T, E>(schema: Schema.Codec<T, E>) {
  return Schema.toStandardSchemaV1(schema.annotate({}), {
    parseOptions: { onExcessProperty: "error" },
  });
}
