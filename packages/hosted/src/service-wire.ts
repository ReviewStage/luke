import { verbatimJsonSchema } from "@sidecar/wire/effect";
import { Schema as EffectSchema, SchemaTransformation } from "effect";

/**
 * The vocabulary every hosted endpoint shares: how a refusal is worded, what
 * a day's allowance looks like, and the two text shapes the per-domain
 * declarations are written from. Each domain's own answers live in its own
 * wire module beside this one.
 *
 * Every declaration below is composed directly as an Effect `Schema` and
 * exported under its own name, the way `brain-contract.ts` states its
 * declarations: a caller reads one through `readEither` and shows it through
 * `emitJsonSchema`, both from `@sidecar/wire/effect`.
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
 * A text admitted exactly as it arrived — no ends settled, nothing collapsed
 * — and refused only when there is nothing there at all. What an author or a
 * provider wrote, where trimming would be a display decision a wire reader
 * has no business making.
 */
export const writtenText = EffectSchema.String.check(
  EffectSchema.makeFilter((value) => value.length > 0),
);

/**
 * A count an answer reports: any finite number at or above zero, whole or
 * not, because what these carry are the service's own counters and instants
 * and a fractional one is the service miscounting rather than the wire
 * carrying something else.
 */
export const countedNumber = EffectSchema.Finite.check(EffectSchema.isGreaterThanOrEqualTo(0));

/**
 * An answer's records are plain structs: whether a key a newer service added
 * is dropped or refused is no longer the declaration's to state, so a reader
 * of one of these asks for it — `readEither(schema, { excess: EXCESS_KEYS.DROP })`
 * — and the option it passes reaches every struct nested inside.
 */
export const hostedQuotaSchema = EffectSchema.Struct({
  used: countedNumber,
  limit: countedNumber,
  resetsAt: countedNumber,
});

/** A member set read with its ends trimmed, the way an enum reads one. */
function trimmedEnum<const Member extends string>(members: readonly Member[]) {
  return verbatimJsonSchema(
    EffectSchema.Trim.pipe(
      EffectSchema.decodeTo(
        EffectSchema.Literals(members),
        SchemaTransformation.passthroughSupertype(),
      ),
    ),
    { type: "string", enum: members },
  );
}

const hostedErrorRecord = EffectSchema.Struct({ error: trimmedEnum(HOSTED_API_ERROR_NAMES) });

/** The error reason out of a refused hosted answer, or nothing. */
export const hostedErrorSchema = hostedErrorRecord.pipe(
  EffectSchema.decodeTo(
    EffectSchema.Literals(HOSTED_API_ERROR_NAMES),
    SchemaTransformation.transform({
      decode: (answer) => answer.error,
      encode: (error) => ({ error }),
    }),
  ),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The length of a UUID as its text form spells it. */
export const WIRE_UUID_LENGTH = 36;

export function isWireUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const trimmedUuidText = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(WIRE_UUID_LENGTH),
);

/**
 * A row's or a device's id as the hosted wire takes it: the UUID text, case
 * folded so the same id spelled two ways is one. A stored id column is
 * `uuid`, and Postgres refuses any other text bound to it, so an id is held
 * to this shape at the boundary rather than met as a failed query.
 */
export const wireUuidSchema = trimmedUuidText
  .pipe(EffectSchema.decodeTo(EffectSchema.String, SchemaTransformation.toLowerCase()))
  .check(EffectSchema.makeFilter(isWireUuid));
