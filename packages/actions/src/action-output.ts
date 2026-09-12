/**
 * The one shape every action tool answers in, whoever refused or carried the
 * action: what became of it, the target as the roster held it when the
 * action ran, and the one identifier a creation named. A Conversation row is
 * composed from the tool call's own arguments and this envelope and nothing
 * else, so anything a row needs that the arguments do not carry — the
 * provider a defaulted creation resolved to, a control's label and kind, the
 * title a session wore before it was renamed or archived — is written here at
 * execution rather than looked up later from a roster that has moved on.
 *
 * The status words are the ones the journal and the loop already count:
 * accepted and unknown are `@sidecar/wire`'s own, and refused folds an
 * adapter's rejected and unsupported into one word, because to the reader of
 * a row they are one thing — an action that did not happen, with the reason
 * it was answered. Unknown stays its own word: the action was dispatched and
 * its answer lost, so it may have happened and is never retried.
 */

import {
  maximumSessionTitleLength,
  SESSION_APPLICATION_ID,
  SESSION_CONTROL_KIND,
  type Session,
  type SessionControlKind,
  type SessionIdentity,
  sessionWithIdentity,
} from "@sidecar/session";
import {
  ACTION_RESULT_STATUS,
  type ActionResult,
  SCHEMA_REFUSAL,
  UNKNOWN_ACTION_STATUS,
  type UnknownActionResult,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { declareReader, emitJsonSchema, readEither, wireRefusal } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Either } from "effect";
import { ACTION_KIND, type CarriedAction, type SessionActionKind } from "./action-kinds.js";
import { maximumIdentifierLength } from "./action-schemas.js";

export const ACTION_OUTPUT_STATUS = {
  ACCEPTED: ACTION_RESULT_STATUS.ACCEPTED,
  UNKNOWN: UNKNOWN_ACTION_STATUS,
  REFUSED: "refused",
} as const;

export type ActionOutputStatus = (typeof ACTION_OUTPUT_STATUS)[keyof typeof ACTION_OUTPUT_STATUS];

/**
 * The target as it stood when the action ran. A session action names its
 * session and, where the roster still held it, the title and agent it wore
 * then; a creation names only the provider it resolved to, since it aims at
 * a project rather than a session. The control and application fields ride
 * only on the kinds that resolved one.
 */
export type ActionTargetSnapshot = {
  readonly providerId: string;
  readonly providerSessionId?: string;
  readonly title?: string;
  readonly agentId?: string;
  readonly controlKind?: SessionControlKind;
  readonly controlLabel?: string;
  readonly applicationId?: string;
};

export type AcceptedActionOutput = {
  readonly status: typeof ACTION_OUTPUT_STATUS.ACCEPTED;
  readonly target?: ActionTargetSnapshot;
  /** The session a creation's answer named: an identifier, never an address. */
  readonly createdSession?: Readonly<SessionIdentity>;
  /** The carrier's own sentence about how the action landed, where it had one. */
  readonly note?: string;
  /** The action landed, and a non-essential follow-up did not. */
  readonly warning?: string;
};

export type UnknownActionOutput = {
  readonly status: typeof ACTION_OUTPUT_STATUS.UNKNOWN;
  readonly reason: string;
  readonly target?: ActionTargetSnapshot;
};

export type RefusedActionOutput = {
  readonly status: typeof ACTION_OUTPUT_STATUS.REFUSED;
  readonly reason: string;
  readonly target?: ActionTargetSnapshot;
};

export type ActionOutputEnvelope = AcceptedActionOutput | UnknownActionOutput | RefusedActionOutput;

/** A sentence a person reads; past the bound it is cut with an ellipsis rather than lost whole. */
export const maximumActionOutputSentenceLength = 2_000;

/** A declaration handed the interface it decodes into; Effect's `Schema` is invariant in its decoded type. */
function schemaAs<Value>(
  schema: EffectSchema.Schema.Any,
): EffectSchema.Schema<Value, UnparsedWireValue> {
  return EffectSchema.make<Value, UnparsedWireValue>(schema.ast);
}

/** A text trimmed and refused when left with nothing, bounded to `max` characters. */
function boundedText(max: number): EffectSchema.Schema<string, string> {
  return EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
    strict: true,
    decode: (value) => value.trim(),
    encode: (value) => value,
  }).pipe(
    EffectSchema.filter((value) => value.length > 0, {
      schemaId: EffectSchema.MinLengthSchemaId,
      jsonSchema: { minLength: 1 },
    }),
    EffectSchema.maxLength(max),
  );
}

/** A sentence collapsed to one line and cut with an ellipsis rather than lost whole past `max`. */
function sentenceText(max: number): EffectSchema.Schema<string, string> {
  return EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
    strict: true,
    decode: (value) => {
      const collapsed = value.replace(/\s+/gu, " ").trim();
      return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed;
    },
    encode: (value) => value,
  }).pipe(
    EffectSchema.filter((value) => value.length > 0, {
      schemaId: EffectSchema.MinLengthSchemaId,
      jsonSchema: { minLength: 1 },
    }),
    EffectSchema.maxLength(max),
  );
}

/** The inner schema read forgivingly: what it refuses decodes to nothing, and its node stands. */
function droppedField<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
): EffectSchema.Schema<Value | undefined, UnparsedWireValue> {
  const read = readEither(schema);
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: Either.getOrUndefined(read(value)) }),
    emitJsonSchema(schema),
  );
}

/**
 * A key a `droppedField` left holding `undefined` is dropped entirely, exactly
 * as an absent optional key is: a struct's decode still writes the key when it
 * arrived, even holding nothing.
 */
function omittingUndefinedKeys<Fields extends object, Encoded>(
  schema: EffectSchema.Schema<Fields, Encoded>,
) {
  return EffectSchema.transform(schema, EffectSchema.Unknown, {
    strict: false,
    decode: (value) =>
      Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)),
    encode: (value) => value,
  });
}

const identifier = boundedText(maximumIdentifierLength);
const sentence = sentenceText(maximumActionOutputSentenceLength);

/**
 * An envelope is an answer, so a key a later build added is ignored rather
 * than refused, and the fields a row would draw are dropped when malformed
 * rather than refusing the envelope: a title the roster reported is worth
 * having when it is well formed and worth nothing when it is not, and
 * refusing the whole answer over one of them would cost the reader what
 * became of the action. The identifiers stay required and exact, because an
 * effect hangs on them.
 */
const answer = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

const optional = <A, I>(field: EffectSchema.Schema<A, I>) =>
  EffectSchema.optionalWith(field, { exact: true });

const TARGET_SNAPSHOT_CORE = answer({
  providerId: identifier,
  providerSessionId: optional(identifier),
  title: optional(droppedField(boundedText(maximumSessionTitleLength))),
  agentId: optional(droppedField(identifier)),
  controlKind: optional(droppedField(EffectSchema.Literal(...Object.values(SESSION_CONTROL_KIND)))),
  controlLabel: optional(droppedField(boundedText(maximumSessionTitleLength))),
  applicationId: optional(
    droppedField(EffectSchema.Literal(...Object.values(SESSION_APPLICATION_ID))),
  ),
});

const TARGET_SNAPSHOT = schemaAs<ActionTargetSnapshot>(omittingUndefinedKeys(TARGET_SNAPSHOT_CORE));

const CREATED_SESSION = schemaAs<SessionIdentity>(
  answer({
    providerId: identifier,
    providerSessionId: identifier,
  }),
);

const ACTION_OUTPUT_CORE = EffectSchema.Union(
  omittingUndefinedKeys(
    answer({
      status: EffectSchema.Literal(ACTION_OUTPUT_STATUS.ACCEPTED),
      target: optional(TARGET_SNAPSHOT),
      createdSession: optional(CREATED_SESSION),
      note: optional(droppedField(sentence)),
      warning: optional(droppedField(sentence)),
    }),
  ),
  omittingUndefinedKeys(
    answer({
      status: EffectSchema.Literal(ACTION_OUTPUT_STATUS.UNKNOWN),
      reason: sentence,
      target: optional(TARGET_SNAPSHOT),
    }),
  ),
  omittingUndefinedKeys(
    answer({
      status: EffectSchema.Literal(ACTION_OUTPUT_STATUS.REFUSED),
      reason: sentence,
      target: optional(TARGET_SNAPSHOT),
    }),
  ),
).annotations(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

/**
 * The envelope as it is validated on write and read back: every action tool's
 * output has to read under this schema, and a record that does not is not an
 * action's output at all.
 */
export const ACTION_OUTPUT = schemaAs<ActionOutputEnvelope>(ACTION_OUTPUT_CORE);

export function refusedActionOutput(
  reason: string,
  target?: ActionTargetSnapshot,
): RefusedActionOutput {
  return {
    status: ACTION_OUTPUT_STATUS.REFUSED,
    reason,
    ...(target !== undefined ? { target } : undefined),
  };
}

export function unknownActionOutput(
  reason: string,
  target?: ActionTargetSnapshot,
): UnknownActionOutput {
  return {
    status: ACTION_OUTPUT_STATUS.UNKNOWN,
    reason,
    ...(target !== undefined ? { target } : undefined),
  };
}

export function acceptedActionOutput(
  details: Omit<AcceptedActionOutput, "status"> = {},
): AcceptedActionOutput {
  return { status: ACTION_OUTPUT_STATUS.ACCEPTED, ...details };
}

/**
 * What carrying an action answered, before it is folded into the envelope:
 * the three words every adapter answers in, the lost answer, and
 * on an acceptance the two things a creation's answer may add. The created
 * session is already an identity here, composed by the performer that knows
 * which provider it asked.
 */
export type CarriedActionResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly createdSession?: Readonly<SessionIdentity>;
      readonly note?: string;
      readonly warning?: string;
    }
  | Exclude<ActionResult, { status: typeof ACTION_RESULT_STATUS.ACCEPTED }>
  | UnknownActionResult;

/** Folds a carried result into the envelope under the target the performer resolved. */
export function actionOutputFromResult(
  result: CarriedActionResult,
  target?: ActionTargetSnapshot,
): ActionOutputEnvelope {
  switch (result.status) {
    case ACTION_RESULT_STATUS.ACCEPTED:
      return acceptedActionOutput({
        ...(target !== undefined ? { target } : undefined),
        ...(result.createdSession !== undefined
          ? { createdSession: result.createdSession }
          : undefined),
        ...(result.note !== undefined ? { note: result.note } : undefined),
        ...(result.warning !== undefined ? { warning: result.warning } : undefined),
      });
    case UNKNOWN_ACTION_STATUS:
      return unknownActionOutput(result.reason, target);
    case ACTION_RESULT_STATUS.REJECTED:
    case ACTION_RESULT_STATUS.UNSUPPORTED:
      return refusedActionOutput(result.reason, target);
  }
}

function sessionSnapshot(
  identity: SessionIdentity,
  sessions: readonly Session[],
): ActionTargetSnapshot {
  const session = sessionWithIdentity(identity, sessions);
  const agentId = session?.agent?.id;
  return {
    providerId: identity.providerId,
    providerSessionId: identity.providerSessionId,
    ...(session !== undefined ? { title: session.title } : undefined),
    ...(agentId !== undefined ? { agentId } : undefined),
  };
}

/**
 * The target of one admitted session action, as the roster held it when the
 * action ran. Every field is read back out of the admitted action or the
 * roster the performer holds — the control the advertisement itself supplied,
 * the application admission resolved, the provider a creation landed on —
 * never out of a caller's copy. A session the roster no longer holds still
 * names its identity, with no title to give.
 */
export function actionTargetSnapshot(
  action: CarriedAction<SessionActionKind>,
  sessions: readonly Session[],
): ActionTargetSnapshot {
  switch (action.kind) {
    case ACTION_KIND.CONTROL: {
      const { controlKind, label } = action.control;
      return {
        ...sessionSnapshot(action.identity, sessions),
        ...(controlKind !== undefined ? { controlKind } : undefined),
        controlLabel: label,
      };
    }
    case ACTION_KIND.OPEN:
      return {
        ...sessionSnapshot(action.identity, sessions),
        ...(action.applicationId !== undefined
          ? { applicationId: action.applicationId }
          : undefined),
      };
    case ACTION_KIND.CREATE_WORKSPACE:
      return { providerId: action.providerId };
    case ACTION_KIND.MESSAGE:
    case ACTION_KIND.ADD_AGENT:
    case ACTION_KIND.RENAME_WORKSPACE:
    case ACTION_KIND.RENAME_SESSION:
      return sessionSnapshot(action.identity, sessions);
  }
}
