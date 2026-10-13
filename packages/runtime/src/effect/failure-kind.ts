/**
 * failure-kind.ts -- a failure named for a log line by its kind alone, never by what it said.
 *
 * A log line is read wherever the deployment's logs are read, so what it may
 * say about a failure is which kind it is. An error's message, a Schema
 * issue's rendering, a statement's text, a response body, and a cause's
 * pretty print can each quote a value: a row, a prompt, a transcript's words,
 * a credential. The kind is read from the tags the failure is made of: its
 * `_tag`, or an `Error`'s `name`, and one level beneath it the tag of its
 * `reason` or `issue`, which is where a `SqlError`, an `HttpClientError`, and
 * a `SchemaError` say what went wrong. A tag is kept only when it is shaped
 * like an identifier, so a name that was given a sentence is not written
 * either.
 */
import { Cause, Option, Schema } from "effect";

/** A tag as a line may carry it: one identifier, nothing shaped like a sentence or a value. */
const KIND_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** What a kind reads where the failure has no tag of that shape: a thrown string, a plain object, a renamed error. */
const FAILURE_KIND = {
  INTERRUPT: "Interrupt",
  UNNAMED: "unnamed",
} as const;

const Kind = Schema.String.check(Schema.isPattern(KIND_PATTERN));
const Tagged = Schema.Struct({ _tag: Kind });
const readKind = Schema.decodeUnknownOption(Kind);
const readTagged = Schema.decodeUnknownOption(Tagged);
const readReason = Schema.decodeUnknownOption(Schema.Struct({ reason: Tagged }));
const readIssue = Schema.decodeUnknownOption(Schema.Struct({ issue: Tagged }));

/** The failure's own tag, or its error name, where either is shaped like an identifier. */
function tagOf(cause: unknown): Option.Option<string> {
  const tagged = Option.map(readTagged(cause), (read) => read._tag);
  return Option.isSome(tagged) || !(cause instanceof Error) ? tagged : readKind(cause.name);
}

/** The tag one level beneath: a `SqlError`'s or an `HttpClientError`'s reason, a `SchemaError`'s issue. */
function beneathOf(cause: unknown): Option.Option<string> {
  return Option.orElse(
    Option.map(readReason(cause), (read) => read.reason._tag),
    () => Option.map(readIssue(cause), (read) => read.issue._tag),
  );
}

/**
 * The failure as a few fixed words: `SqlError: ConnectionError`,
 * `TypeError`, or `unnamed` for a thrown value with no name of its own.
 */
export function failureKind(cause: unknown): string {
  const kind = tagOf(cause);
  if (Option.isNone(kind)) return FAILURE_KIND.UNNAMED;
  const beneath = beneathOf(cause);
  return Option.isNone(beneath) ? kind.value : `${kind.value}: ${beneath.value}`;
}

/** The cause as `failureKind` names what it squashes to, or `Interrupt` where nothing failed. */
export function causeKind(cause: Cause.Cause<unknown>): string {
  return Cause.hasInterruptsOnly(cause) ? FAILURE_KIND.INTERRUPT : failureKind(Cause.squash(cause));
}
