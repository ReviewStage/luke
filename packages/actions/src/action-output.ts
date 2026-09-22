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
  SESSION_CONTROL_KIND,
  type Session,
  type SessionControlKind,
  type SessionIdentity,
  sessionWithIdentity,
} from "@sidecar/session";
import {
  ACTION_RESULT_STATUS,
  type ActionResult,
  EXCESS_KEYS,
  SCHEMA_REFUSAL,
  UNKNOWN_ACTION_STATUS,
  type UnknownActionResult,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { declareReader, emitJsonSchema, readEither, wireRefusal } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result, SchemaTransformation } from "effect";
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
 * a project rather than a session. The control fields ride only on the kind
 * that resolved one.
 */
export type ActionTargetSnapshot = {
  readonly providerId: string;
  readonly providerSessionId?: string;
  readonly title?: string;
  readonly agentId?: string;
  readonly controlKind?: SessionControlKind;
  readonly controlLabel?: string;
};

type AcceptedActionOutput = {
  readonly status: typeof ACTION_OUTPUT_STATUS.ACCEPTED;
  readonly target?: ActionTargetSnapshot;
  /** The session a creation's answer named: an identifier, never an address. */
  readonly createdSession?: Readonly<SessionIdentity>;
  /** The carrier's own sentence about how the action landed, where it had one. */
  readonly note?: string;
  /** The action landed, and a non-essential follow-up did not. */
  readonly warning?: string;
};

type UnknownActionOutput = {
  readonly status: typeof ACTION_OUTPUT_STATUS.UNKNOWN;
  readonly reason: string;
  readonly target?: ActionTargetSnapshot;
};

type RefusedActionOutput = {
  readonly status: typeof ACTION_OUTPUT_STATUS.REFUSED;
  readonly reason: string;
  readonly target?: ActionTargetSnapshot;
};

export type ActionOutputEnvelope = AcceptedActionOutput | UnknownActionOutput | RefusedActionOutput;

/** A sentence a person reads; past the bound it is cut with an ellipsis rather than lost whole. */
export const maximumActionOutputSentenceLength = 2_000;

/** A declaration handed the interface it decodes into; Effect's `Schema` is invariant in its decoded type. */
function schemaAs<Value>(schema: EffectSchema.Top): EffectSchema.Codec<Value, UnparsedWireValue> {
  return EffectSchema.make<EffectSchema.Codec<Value, UnparsedWireValue>>(schema.ast);
}

/** A text trimmed and refused when left with nothing, bounded to `max` characters. */
function boundedText(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(max));
}

/** A sentence collapsed to one line and cut with an ellipsis rather than lost whole past `max`. */
function sentenceText(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.pipe(
    EffectSchema.decodeTo(
      EffectSchema.String,
      SchemaTransformation.transform({
        decode: (value) => {
          const collapsed = value.replace(/\s+/gu, " ").trim();
          return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed;
        },
        encode: (value) => value,
      }),
    ),
  ).check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(max));
}

/**
 * The inner schema read forgivingly: what it refuses decodes to nothing, and
 * its node stands. The inner read drops a key the declaration does not name,
 * on the same terms as the read of the envelope around it.
 */
function droppedField<Value, Encoded>(
  schema: EffectSchema.Codec<Value, Encoded>,
): EffectSchema.Codec<Value | undefined, UnparsedWireValue> {
  const read = readEither(schema, { excess: EXCESS_KEYS.DROP });
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: Result.getOrUndefined(read(value)) }),
    emitJsonSchema(schema),
  );
}

/** The open record a cleanup's two ends are stated in, since it keeps no key table of its own. */
const anyRecord = EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown);

/**
 * A key a `droppedField` left holding `undefined` is dropped entirely, exactly
 * as an absent optional key is: a struct's decode still writes the key when it
 * arrived, even holding nothing.
 */
function omittingUndefinedKeys(schema: EffectSchema.Top) {
  return schemaAs<typeof anyRecord.Type>(schema).pipe(
    EffectSchema.decodeTo(
      anyRecord,
      SchemaTransformation.transform({
        decode: (value) =>
          Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)),
        encode: (value) => value,
      }),
    ),
  );
}

const identifier = boundedText(maximumIdentifierLength);
const sentence = sentenceText(maximumActionOutputSentenceLength);

/**
 * An envelope is an answer, so the fields a row would draw are dropped when
 * malformed rather than refusing the envelope: a title the roster reported is
 * worth having when it is well formed and worth nothing when it is not, and
 * refusing the whole answer over one of them would cost the reader what became
 * of the action. The identifiers stay required and exact, because an effect
 * hangs on them.
 *
 * A key a later build added is ignored rather than refused too, but that is
 * the read's grain rather than the declaration's: every reader of
 * {@link ACTION_OUTPUT} passes `{ excess: EXCESS_KEYS.DROP }` to `readEither`.
 */
const optional = <Field extends EffectSchema.Top>(field: Field) => EffectSchema.optionalKey(field);

const TARGET_SNAPSHOT_CORE = EffectSchema.Struct({
  providerId: identifier,
  providerSessionId: optional(identifier),
  title: optional(droppedField(boundedText(maximumSessionTitleLength))),
  agentId: optional(droppedField(identifier)),
  controlKind: optional(droppedField(EffectSchema.Literals(Object.values(SESSION_CONTROL_KIND)))),
  controlLabel: optional(droppedField(boundedText(maximumSessionTitleLength))),
});

const TARGET_SNAPSHOT = schemaAs<ActionTargetSnapshot>(omittingUndefinedKeys(TARGET_SNAPSHOT_CORE));

const CREATED_SESSION = schemaAs<SessionIdentity>(
  EffectSchema.Struct({
    providerId: identifier,
    providerSessionId: identifier,
  }),
);

const ACTION_OUTPUT_CORE = EffectSchema.Union([
  omittingUndefinedKeys(
    EffectSchema.Struct({
      status: EffectSchema.Literal(ACTION_OUTPUT_STATUS.ACCEPTED),
      target: optional(TARGET_SNAPSHOT),
      createdSession: optional(CREATED_SESSION),
      note: optional(droppedField(sentence)),
      warning: optional(droppedField(sentence)),
    }),
  ),
  omittingUndefinedKeys(
    EffectSchema.Struct({
      status: EffectSchema.Literal(ACTION_OUTPUT_STATUS.UNKNOWN),
      reason: sentence,
      target: optional(TARGET_SNAPSHOT),
    }),
  ),
  omittingUndefinedKeys(
    EffectSchema.Struct({
      status: EffectSchema.Literal(ACTION_OUTPUT_STATUS.REFUSED),
      reason: sentence,
      target: optional(TARGET_SNAPSHOT),
    }),
  ),
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

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
 * the provider a creation landed on —
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
    case ACTION_KIND.CREATE_WORKSPACE:
      return { providerId: action.providerId };
    case ACTION_KIND.MESSAGE:
    case ACTION_KIND.ADD_AGENT:
    case ACTION_KIND.RENAME_WORKSPACE:
    case ACTION_KIND.RENAME_SESSION:
      return sessionSnapshot(action.identity, sessions);
  }
}
