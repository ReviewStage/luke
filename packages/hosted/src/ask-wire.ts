import { TURN_ORIGIN, TURN_STATUS, type TurnOrigin, type TurnStatus } from "@sidecar/wire";
import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/** A text trimmed and refused when left with nothing. */
const text = (maximumChars?: number) => {
  const core = EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
    strict: true,
    decode: (value) => value.trim(),
    encode: (value) => value,
  }).pipe(
    EffectSchema.filter((value) => value.trim().length > 0, {
      schemaId: EffectSchema.MinLengthSchemaId,
      jsonSchema: { minLength: 1 },
    }),
  );
  return maximumChars === undefined ? core : core.pipe(EffectSchema.maxLength(maximumChars));
};

/** A record that ignores a key a newer service added, which is what an answer always does. */
const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/**
 * The ask routes' contract: a developer's question handed to Luke's judgment
 * on the hosted tier, where its turn stands until it settles, and the Stop
 * that ends it. The contract describes the caller's obligations and never
 * the service's storage: the id an ask answers with is the id the caller
 * reads and stops the ask by, and what stands behind it on the service is
 * the service's own to decide. An ask names its origin from the turn vocabulary — the
 * phone types and the voice speaks, and nothing else opens a turn this way —
 * and carries the client's own id, which is the idempotency key: the same id
 * on the same conversation is the same ask, answered again and dispatched
 * once. The conversation is optional; an ask naming none is for the account's
 * standing main. The request refuses a key it did not name, as every request
 * frame on this wire does; the answers ignore one a newer service adds.
 */

export const ASK_BOUNDS = {
  /** The longest question one ask carries, in characters; the prompt's own envelope is far wider. */
  MAX_QUESTION_CHARS: 20_000,
  /** The longest a turn read holds the request open for a settlement, in milliseconds. */
  MAX_WAIT_MS: 25_000,
} as const;

/** The two origins an ask may open a turn under; every other origin is Luke's own. */
export const ASK_ORIGIN = {
  TYPED: TURN_ORIGIN.TYPED,
  SPOKEN: TURN_ORIGIN.SPOKEN,
} as const satisfies Partial<typeof TURN_ORIGIN>;

export type AskOrigin = (typeof ASK_ORIGIN)[keyof typeof ASK_ORIGIN];

const ASK_ORIGIN_NAMES = Object.values(ASK_ORIGIN);
const TURN_ORIGIN_NAMES = Object.values(TURN_ORIGIN);
const TURN_STATUS_NAMES = Object.values(TURN_STATUS);

export interface HostedBrainAskRequest {
  readonly question: string;
  readonly origin: AskOrigin;
  readonly clientId: string;
  readonly conversationId?: string;
}

export const hostedBrainAskRequestSchema = EffectSchema.Struct({
  question: text(ASK_BOUNDS.MAX_QUESTION_CHARS),
  origin: EffectSchema.Literal(...ASK_ORIGIN_NAMES),
  clientId: wireUuidSchema,
  conversationId: EffectSchema.optionalWith(wireUuidSchema, { exact: true }),
});

/** What an accepted ask answers: the id the caller polls and stops this ask by, the conversation it runs in, and when it was taken. */
export interface HostedBrainAskAnswer {
  readonly id: string;
  readonly conversationId: string;
  readonly queuedAt: number;
}

export const hostedBrainAskAnswerSchema = tolerantRecord({
  id: wireUuidSchema,
  conversationId: wireUuidSchema,
  queuedAt: countedNumber,
});

/** The query a turn read names its bounded hold with, in milliseconds. */
export const TURN_WAIT_QUERY = "wait";

/**
 * Where an ask's turn stands, as one shape whether or not eve has started
 * the turn: the id the caller asked by, the turn's own id once eve has named
 * one, and the turn row's stamps, or the queued state an ask stands in
 * while it waits behind a running turn. A Stop answers the same shape, as
 * the turn stands after the cancel was asked of eve or stamped for its start.
 */
export interface HostedBrainTurnAnswer {
  readonly id: string;
  readonly turnId?: string;
  readonly conversationId: string;
  readonly origin: TurnOrigin;
  readonly status: TurnStatus;
  readonly queuedAt: number;
  readonly startedAt?: number;
  readonly settledAt?: number;
  readonly failure?: string;
  readonly cancelRequestedAt?: number;
}

export const hostedBrainTurnAnswerSchema = tolerantRecord({
  id: wireUuidSchema,
  turnId: EffectSchema.optionalWith(wireUuidSchema, { exact: true }),
  conversationId: wireUuidSchema,
  origin: EffectSchema.Literal(...TURN_ORIGIN_NAMES),
  status: EffectSchema.Literal(...TURN_STATUS_NAMES),
  queuedAt: countedNumber,
  startedAt: EffectSchema.optionalWith(countedNumber, { exact: true }),
  settledAt: EffectSchema.optionalWith(countedNumber, { exact: true }),
  failure: EffectSchema.optionalWith(text(), { exact: true }),
  cancelRequestedAt: EffectSchema.optionalWith(countedNumber, { exact: true }),
});
