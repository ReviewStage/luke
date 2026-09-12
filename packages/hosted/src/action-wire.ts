import {
  ACTION_RESULT_STATUS,
  type ActionResultStatus,
  effectSchema,
  type Schema,
  s,
  type UnparsedWireValue,
} from "@sidecar/wire";
import {
  declareReader,
  emitJsonSchema,
  readEither,
  verbatimJsonSchema,
} from "@sidecar/wire/effect";
import { Schema as EffectSchema, Either } from "effect";
import { writtenText } from "./service-wire.js";

/**
 * What the action endpoints answer: whether the provider took the action, and the
 * one identifier a creation names. The reason travels as written, because it
 * is a sentence a person reads.
 *
 * Every shape below is composed directly with Effect's `Schema.Struct` rather
 * than through the `s.*` facade; {@link fromEffect} is what still answers the
 * facade's `read`/`parse`/`jsonSchema` for the callers that hold one.
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
 * The Effect schema a declaration was composed from, adapted to the facade
 * still-held callers use: `read` through `readEither`, `jsonSchema` through
 * the emitter walking the same schema.
 */
function fromEffect<Value, Encoded>(core: EffectSchema.Schema<Value, Encoded>): Schema<Value> {
  const read = readEither(core);
  return s.reader({
    read: (value) =>
      Either.match(read(value), {
        onLeft: ({ refusal, path }) => ({ ok: false, refusal, path }),
        onRight: (value) => ({ ok: true, value }),
      }),
    jsonSchema: () => emitJsonSchema(core),
  });
}

/**
 * The result names, admitted with their ends trimmed the way an answer's own
 * enum always is: an answer this build did not write may have padded a word
 * in transit, and the set is closed either way.
 */
const result = verbatimJsonSchema(
  EffectSchema.transform(
    EffectSchema.String,
    EffectSchema.Literal(...Object.values(ACTION_RESULT_STATUS)),
    {
      strict: false,
      decode: (value) => value.trim(),
      encode: (value) => value,
    },
  ),
  { type: "string", enum: Object.values(ACTION_RESULT_STATUS) },
);

/**
 * A field a malformed or empty value is dropped from rather than refused for:
 * the reason and the provider session id are both worth having when well
 * formed and worth nothing, not a refusal, when they are not.
 */
function dropped<Value, Encoded>(
  inner: EffectSchema.Schema<Value, Encoded>,
): EffectSchema.Schema<Value | undefined, UnparsedWireValue> {
  const read = readEither(inner);
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: Either.getOrUndefined(read(value)) }),
    emitJsonSchema(inner),
  );
}

const reason = EffectSchema.optionalWith(dropped(effectSchema(writtenText)), { exact: true });

const providerSessionId = EffectSchema.optionalWith(dropped(effectSchema(writtenText)), {
  exact: true,
});

/**
 * The narrow shape a dropped field decodes to once its key is left out
 * entirely: `dropped` itself still admits an explicit `undefined` so a
 * malformed value does not refuse the record, but nothing here ever produces
 * one, so the `to` side of the transform below states the field without it.
 */
const reasonOut = EffectSchema.optionalWith(EffectSchema.String, { exact: true });

const providerSessionIdOut = EffectSchema.optionalWith(EffectSchema.String, { exact: true });

const actionAnswerFieldsFrom = EffectSchema.Struct({ result, reason }).annotations({
  parseOptions: { onExcessProperty: "ignore" },
});

const actionAnswerFieldsTo = EffectSchema.Struct({ result, reason: reasonOut });

/**
 * The struct's own decode leaves a dropped field's key present with an
 * `undefined` value when it arrived malformed; a record leaves the key out
 * entirely, exactly as it does for an absent optional one.
 */
const hostedActionAnswerCore = EffectSchema.transform(
  actionAnswerFieldsFrom,
  actionAnswerFieldsTo,
  {
    strict: false,
    decode: (value) =>
      value.reason === undefined
        ? { result: value.result }
        : { result: value.result, reason: value.reason },
    encode: (value) => value,
  },
);

export const hostedActionAnswerSchema: Schema<HostedActionAnswer> =
  fromEffect(hostedActionAnswerCore);

const actionWorkspaceAnswerFieldsFrom = EffectSchema.Struct({
  result,
  reason,
  providerSessionId,
}).annotations({ parseOptions: { onExcessProperty: "ignore" } });

const actionWorkspaceAnswerFieldsTo = EffectSchema.Struct({
  result,
  reason: reasonOut,
  providerSessionId: providerSessionIdOut,
});

const hostedActionWorkspaceAnswerCore = EffectSchema.transform(
  actionWorkspaceAnswerFieldsFrom,
  actionWorkspaceAnswerFieldsTo,
  {
    strict: false,
    decode: (value) => ({
      result: value.result,
      ...(value.reason === undefined ? undefined : { reason: value.reason }),
      ...(value.providerSessionId === undefined
        ? undefined
        : { providerSessionId: value.providerSessionId }),
    }),
    encode: (value) => value,
  },
);

export const hostedActionWorkspaceAnswerSchema: Schema<HostedActionWorkspaceAnswer> = fromEffect(
  hostedActionWorkspaceAnswerCore,
);
