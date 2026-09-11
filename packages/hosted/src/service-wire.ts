import { type Schema, s } from "@sidecar/wire";
import { emitJsonSchema, readEither, toSchemaRead, verbatimJsonSchema } from "@sidecar/wire/effect";
import { Schema as EffectSchema } from "effect";

/**
 * The vocabulary every hosted endpoint shares: how a refusal is worded, what
 * a day's allowance looks like, and the two text shapes the per-domain
 * declarations are written from. Each domain's own answers live in its own
 * wire module beside this one.
 *
 * Every declaration below is composed directly as an Effect `Schema` under
 * its own `<name>Effect` export, the way `brain-contract.ts` (P3-05) states
 * its declarations. The plain `<name>` export beside it is the same
 * declaration read through `fromEffect`, the pattern P1-04 established in
 * `packages/wire/src/ui-message-metadata.ts`: it is what still answers the
 * facade's `read`/`parse`/`jsonSchema` for the callers that hold one — the
 * still-unconverted sibling wire modules that pass these into
 * `s.record`/`s.array`/`s.dropRefused`/`.optional()`, and the direct
 * `.parse()` callers in `@sidecar/voice`, `@sidecar/brain`, and `apps/web`.
 * The facade twin is the strangler shim P12-08 deletes, once every caller of
 * this module declares against the `Effect` export directly.
 */

/** Every refusal a hosted endpoint answers with, by its reason. */
export const HOSTED_API_ERROR = {
  /** The bearer token is missing, expired, or revoked. */
  INVALID_TOKEN: "invalid-token",
  /** The request body is not what this endpoint takes. */
  INVALID_REQUEST: "invalid-request",
  /**
   * Today's free allowance for this meter is spent, or — on the recording
   * endpoint, which meters nothing — this account has sent more counts this
   * minute than the brake allows.
   */
  QUOTA_EXHAUSTED: "quota-exhausted",
  /**
   * The deployment holds no key for what was asked — OpenAI's for the hosted
   * tier, the analytics processor's for recording — so that endpoint is off.
   */
  UNAVAILABLE: "unavailable",
  /** The upstream refused or failed; the status travels, the bodies never do. */
  UPSTREAM_ERROR: "upstream-error",
  /**
   * The upstream itself is rate limiting; nothing was answered. Distinct from
   * a spent allowance: the caller cools down for the bounded wait the
   * `Retry-After` header names rather than for the day.
   */
  UPSTREAM_THROTTLED: "upstream-throttled",
  /** The request body weighs more than the endpoint's fixed byte bound; nothing of it was read. */
  REQUEST_TOO_LARGE: "request-too-large",
  /** The prepared prompt is longer than the contract's own prompt envelope; nothing was sent upstream. */
  PROMPT_TOO_LARGE: "prompt-too-large",
  /** A tool name the service's catalog does not register; no schema was selected. */
  UNKNOWN_TOOL: "unknown-tool",
  /**
   * A stored row this build cannot read back — a tool part naming a tool the
   * catalog does not register, or parts that are not a message's — so the page
   * it stands on was refused whole rather than answered without it; the
   * answer names the row's conversation and sequence.
   */
  UNREADABLE_ROW: "unreadable-row",
  METHOD_NOT_ALLOWED: "method-not-allowed",
  /** The row the path names is not one this account holds; another account's and none at all read alike. */
  NOT_FOUND: "not-found",
  /** The message stands and is the caller's, but it is not one of Luke's, and only Luke's words take a rating. */
  NOT_RATEABLE: "not-rateable",
  /** The turn the path names has no session running it, so there is nothing to stop; its record stands as it was. */
  NOT_RUNNING: "not-running",
} as const;

export type HostedApiError = (typeof HOSTED_API_ERROR)[keyof typeof HOSTED_API_ERROR];

/** What one day's allowance looked like when the service last answered. */
export interface HostedQuota {
  used: number;
  limit: number;
  /** When the day's counter resets, as epoch milliseconds. */
  resetsAt: number;
}

const HOSTED_API_ERROR_NAMES = Object.values(HOSTED_API_ERROR);

/**
 * The Effect schema a declaration was composed from, adapted to the facade
 * still-held callers use: `read` through `readEither`, `jsonSchema` through
 * the emitter walking the same schema.
 */
function fromEffect<Value, Encoded>(core: EffectSchema.Schema<Value, Encoded>): Schema<Value> {
  const read = readEither(core);
  return s.reader({
    read: (value) => toSchemaRead(read(value)),
    jsonSchema: () => emitJsonSchema(core),
  });
}

/**
 * A text admitted exactly as it arrived — no ends settled, nothing collapsed
 * — and refused only when there is nothing there at all. What an author or a
 * provider wrote, where trimming would be a display decision a wire reader
 * has no business making.
 */
export const writtenTextEffect = EffectSchema.String.pipe(
  EffectSchema.filter((value) => value.length > 0),
);

export const writtenText: Schema<string> = fromEffect(writtenTextEffect);

/**
 * A count an answer reports: any finite number at or above zero, whole or
 * not, because what these carry are the service's own counters and instants
 * and a fractional one is the service miscounting rather than the wire
 * carrying something else.
 */
export const countedNumberEffect = EffectSchema.Number.pipe(
  EffectSchema.finite(),
  EffectSchema.greaterThanOrEqualTo(0),
);

export const countedNumber: Schema<number> = fromEffect(countedNumberEffect);

/**
 * A record that ignores a key a newer service added, which is what an answer
 * does. Each record states its own rule, because Effect hands a struct's
 * parse options down to the structs inside it.
 */
const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

export const hostedQuotaSchemaEffect = tolerantRecord({
  used: countedNumberEffect,
  limit: countedNumberEffect,
  resetsAt: countedNumberEffect,
});

export const hostedQuotaSchema: Schema<HostedQuota> = fromEffect(hostedQuotaSchemaEffect);

/** A member set read with its ends trimmed, the way `s.enumOf({ ends: TEXT_ENDS.TRIM })` reads one. */
function trimmedEnum<const Member extends string>(members: readonly Member[]) {
  return verbatimJsonSchema(
    EffectSchema.transform(EffectSchema.String, EffectSchema.Literal(...members), {
      strict: false,
      decode: (value) => value.trim(),
      encode: (value) => value,
    }),
    { type: "string", enum: members },
  );
}

const hostedErrorRecord = tolerantRecord({ error: trimmedEnum(HOSTED_API_ERROR_NAMES) });

/** The error reason out of a refused hosted answer, or nothing. */
export const hostedErrorSchemaEffect = EffectSchema.transform(
  hostedErrorRecord,
  EffectSchema.Literal(...HOSTED_API_ERROR_NAMES),
  { strict: false, decode: (answer) => answer.error, encode: (error) => ({ error }) },
);

export const hostedErrorSchema: Schema<HostedApiError> = fromEffect(hostedErrorSchemaEffect);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The length of a UUID as its text form spells it. */
export const WIRE_UUID_LENGTH = 36;

export function isWireUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const trimmedUuidText = EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
  strict: true,
  decode: (value) => value.trim(),
  encode: (value) => value,
}).pipe(
  EffectSchema.filter((value) => value.trim().length > 0, {
    schemaId: EffectSchema.MinLengthSchemaId,
    jsonSchema: { minLength: 1 },
  }),
  EffectSchema.maxLength(WIRE_UUID_LENGTH),
);

/**
 * A row's or a device's id as the hosted wire takes it: the UUID text, case
 * folded so the same id spelled two ways is one. A stored id column is
 * `uuid`, and Postgres refuses any other text bound to it, so an id is held
 * to this shape at the boundary rather than met as a failed query.
 */
export const wireUuidSchemaEffect = EffectSchema.transform(trimmedUuidText, EffectSchema.String, {
  strict: false,
  decode: (value) => value.toLowerCase(),
  encode: (value) => value,
}).pipe(EffectSchema.filter(isWireUuid));

export const wireUuidSchema: Schema<string> = fromEffect(wireUuidSchemaEffect);
