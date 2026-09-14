import {
  ACTION_RESULT_STATUS,
  type ActionResultStatus,
  EXCESS_KEYS,
  type UnparsedWireValue,
} from "@sidecar/wire";
import {
  declareReader,
  emitJsonSchema,
  readEither,
  verbatimJsonSchema,
} from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result, SchemaTransformation } from "effect";
import { writtenText } from "./service-wire.js";

/**
 * What the action endpoints answer: whether the provider took the action, and the
 * one identifier a creation names. The reason travels as written, because it
 * is a sentence a person reads.
 *
 * Every shape below is composed directly with Effect's `Schema.Struct` and
 * exported under its own name. An answer is read through
 * `readEither(schema, { excess: EXCESS_KEYS.DROP })`: a key a newer service
 * added is dropped rather than refused, and that grain is the read's now
 * rather than the declaration's.
 */

/**
 * What the message and workspace-creation action endpoints return. The outcome
 * is `ACTION_RESULT_STATUS`, the vocabulary every adapter already answers an action
 * in, under the field name the phone reads. It is the status alone and never
 * the adapter's whole `ActionResult`: the reason is optional here, and the
 * workspace form carries a field of its own.
 */
export interface HostedActionAnswer {
  result: ActionResultStatus;
  /** Human-readable reason; present on rejected and unsupported results. */
  reason?: string;
}

/** What the workspace-creation action endpoint returns. */
export interface HostedActionWorkspaceAnswer extends HostedActionAnswer {
  /** The created session's provider id, when the provider reports one. */
  providerSessionId?: string;
}

/**
 * The result names, admitted with their ends trimmed the way an answer's own
 * enum always is: an answer this build did not write may have padded a word
 * in transit, and the set is closed either way.
 */
const result = verbatimJsonSchema(
  EffectSchema.Trim.pipe(
    EffectSchema.decodeTo(
      EffectSchema.Literals(Object.values(ACTION_RESULT_STATUS)),
      SchemaTransformation.passthroughSupertype(),
    ),
  ),
  { type: "string", enum: Object.values(ACTION_RESULT_STATUS) },
);

/**
 * A field a malformed or empty value is dropped from rather than refused for:
 * the reason and the provider session id are both worth having when well
 * formed and worth nothing, not a refusal, when they are not.
 */
function dropped<Value, Encoded>(
  inner: EffectSchema.Codec<Value, Encoded>,
): EffectSchema.Codec<Value | undefined, UnparsedWireValue> {
  const read = readEither(inner, { excess: EXCESS_KEYS.DROP });
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: Result.getOrUndefined(read(value)) }),
    emitJsonSchema(inner),
  );
}

const reason = EffectSchema.optionalKey(dropped(writtenText));

const providerSessionId = EffectSchema.optionalKey(dropped(writtenText));

/**
 * The narrow shape a dropped field decodes to once its key is left out
 * entirely: `dropped` itself still admits an explicit `undefined` so a
 * malformed value does not refuse the record, but nothing here ever produces
 * one, so the `to` side of the transform below states the field without it.
 * Each `to` side is a `toType`, since what a transform hands its target is
 * that target's encoded value and the target here decodes nothing further:
 * the answer's own shape is both.
 */
const reasonOut = EffectSchema.optionalKey(EffectSchema.String);

const providerSessionIdOut = EffectSchema.optionalKey(EffectSchema.String);

const actionAnswerFieldsFrom = EffectSchema.Struct({ result, reason });

const actionAnswerFieldsTo = EffectSchema.toType(
  EffectSchema.Struct({ result, reason: reasonOut }),
);

/**
 * The struct's own decode leaves a dropped field's key present with an
 * `undefined` value when it arrived malformed; a record leaves the key out
 * entirely, exactly as it does for an absent optional one.
 */
const hostedActionAnswerCore = actionAnswerFieldsFrom.pipe(
  EffectSchema.decodeTo(
    actionAnswerFieldsTo,
    SchemaTransformation.transform<
      (typeof actionAnswerFieldsTo)["Encoded"],
      (typeof actionAnswerFieldsFrom)["Type"]
    >({
      decode: (value) =>
        value.reason === undefined
          ? { result: value.result }
          : { result: value.result, reason: value.reason },
      encode: (value) => value,
    }),
  ),
);

export const hostedActionAnswerSchema = hostedActionAnswerCore;

const actionWorkspaceAnswerFieldsFrom = EffectSchema.Struct({
  result,
  reason,
  providerSessionId,
});

const actionWorkspaceAnswerFieldsTo = EffectSchema.toType(
  EffectSchema.Struct({
    result,
    reason: reasonOut,
    providerSessionId: providerSessionIdOut,
  }),
);

const hostedActionWorkspaceAnswerCore = actionWorkspaceAnswerFieldsFrom.pipe(
  EffectSchema.decodeTo(
    actionWorkspaceAnswerFieldsTo,
    SchemaTransformation.transform<
      (typeof actionWorkspaceAnswerFieldsTo)["Encoded"],
      (typeof actionWorkspaceAnswerFieldsFrom)["Type"]
    >({
      decode: (value) => ({
        result: value.result,
        ...(value.reason === undefined ? undefined : { reason: value.reason }),
        ...(value.providerSessionId === undefined
          ? undefined
          : { providerSessionId: value.providerSessionId }),
      }),
      encode: (value) => value,
    }),
  ),
);

export const hostedActionWorkspaceAnswerSchema = hostedActionWorkspaceAnswerCore;
