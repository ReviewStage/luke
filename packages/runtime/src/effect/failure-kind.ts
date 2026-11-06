import { Cause, Option, Schema } from "effect";

const KIND_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const SQL_ERROR_TAG = "SqlError";

const CODE_PATTERN = /^[A-Z0-9_]{2,32}$/;

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
const readCode = Schema.decodeUnknownOption(Schema.String.check(Schema.isPattern(CODE_PATTERN)));
const readSqlCause = Schema.decodeUnknownOption(
  Schema.Struct({
    _tag: Schema.Literal(SQL_ERROR_TAG),
    reason: Schema.Struct({ cause: Schema.Unknown }),
  }),
);
const readWrapper = Schema.decodeUnknownOption(Schema.Struct({ cause: Schema.Unknown }));

function tagOf(cause: unknown): Option.Option<string> {
  const tagged = Option.map(readTagged(cause), (read) => read._tag);
  return Option.isSome(tagged) || !(cause instanceof Error) ? tagged : readKind(cause.name);
}

function beneathOf(cause: unknown): Option.Option<string> {
  return Option.orElse(
    Option.map(readReason(cause), (read) => read.reason._tag),
    () => Option.map(readIssue(cause), (read) => read.issue._tag),
  );
}

function wrappedOf(cause: unknown): Option.Option<unknown> {
  return Option.flatMap(readWrapper(cause), ({ cause: inner }) =>
    Cause.isCause(inner) && !Cause.hasInterruptsOnly(inner)
      ? Option.some(Cause.squash(inner))
      : Option.none(),
  );
}

export function failureKind(cause: unknown): string {
  const wrapped = wrappedOf(cause);
  if (Option.isSome(wrapped)) return failureKind(wrapped.value);
  const kind = tagOf(cause);
  if (Option.isNone(kind)) return FAILURE_KIND.UNNAMED;
  const beneath = beneathOf(cause);
  return Option.isNone(beneath) ? kind.value : `${kind.value}: ${beneath.value}`;
}

export function failureDetail(cause: unknown): Option.Option<string> {
  const wrapped = wrappedOf(cause);
  if (Option.isSome(wrapped)) return failureDetail(wrapped.value);
  const sql = readSqlCause(cause);
  if (Option.isNone(sql)) return Option.none();
  const driver = sql.value.reason.cause;
  const code = readCode(
    typeof driver === "object" && driver !== null && "code" in driver ? driver.code : undefined,
  );
  if (Option.isSome(code)) return Option.some(`code ${code.value}`);
  const name = driver instanceof Error ? readKind(driver.name) : Option.none();
  return Option.some(`cause ${Option.getOrElse(name, () => FAILURE_KIND.UNNAMED)}`);
}

export function causeKind(cause: Cause.Cause<unknown>): string {
  return Cause.hasInterruptsOnly(cause) ? FAILURE_KIND.INTERRUPT : failureKind(Cause.squash(cause));
}
