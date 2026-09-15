import { EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import { declareReader, emitJsonSchema, readEither } from "@sidecar/wire/effect";
import { Result, Schema, SchemaGetter } from "effect";
import {
  REALTIME_CALLS_PATH,
  type RealtimeConnection,
  realtimeCredentialIsUsable,
} from "./realtime-contract.js";
import { type HostedQuota, hostedQuotaSchema } from "./service-wire.js";

/**
 * What the two mint endpoints answer: one ephemeral Realtime credential, the
 * allowance it was spent against, and — for the watch's remote mint, until
 * LUKE-224 moves the watch onto the hosted exchange — the roster context it
 * forwards verbatim. A credential is validated field by field
 * rather than repaired, because a mis-answering service must read as a
 * malformed response and never as a call aimed somewhere else. Every record
 * here is a plain struct read through
 * `readEither(schema, { excess: EXCESS_KEYS.DROP })`: a key a newer service
 * added is dropped rather than refused, and that grain is the read's now
 * rather than the declaration's.
 */

/**
 * The one address a hosted credential may point a WebRTC call at. The
 * renderer's content-security policy only permits the canonical OpenAI host,
 * so a credential aimed anywhere else could not work — validating it here
 * means a mis-answering service reads as a malformed response rather than as
 * a call that dies mid-handshake.
 */
export const HOSTED_CALLS_URL = `https://api.openai.com/v1${REALTIME_CALLS_PATH}`;

/**
 * The build-pinned WebSocket base URL for OpenAI Realtime. The full endpoint
 * appends ?model=<model> and is validated field-by-field in the wire reader
 * the same way callsUrl is, so a mis-answering service cannot redirect the
 * watch's connection.
 */
export const HOSTED_WS_BASE_URL = "wss://api.openai.com/v1/realtime";

export interface HostedMintAnswer {
  connection: RealtimeConnection;
  quota?: HostedQuota;
}

/**
 * A declaration handed the interface it decodes into, since Effect's `Schema`
 * is invariant in its decoded type and a struct assembled from field tables
 * only agrees with that interface rather than restating it. The same claim
 * the facade's own `schemaOver` made over its assembled AST.
 */
function schemaAs<Value>(schema: Schema.Top): Schema.Codec<Value, UnparsedWireValue> {
  return Schema.make<Schema.Codec<Value, UnparsedWireValue>>(schema.ast);
}

/**
 * A key a `dropRefused` field left holding `undefined` is dropped entirely,
 * exactly as an absent optional key is: a struct's decode still writes the
 * key when it arrived, even holding nothing, so nothing downstream sees a
 * `quota` it can ask `in` about unless one actually read.
 */
function omittingUndefinedKeys<Fields extends object, Encoded>(
  schema: Schema.Codec<Fields, Encoded>,
) {
  return schema.pipe(
    Schema.decodeTo(Schema.Unknown, {
      decode: SchemaGetter.transform((value) =>
        Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)),
      ),
      // Nothing on this wire encodes a mint answer, and the shape the decode
      // answers with is `unknown`, so the way back is a passthrough that
      // states it cannot narrow.
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  );
}

/** A trimmed text, refused when only whitespace remains. */
const text: Schema.Codec<string, string> = Schema.Trim.check(Schema.isNonEmpty());

/**
 * The `wsUrl` is the one field no per-field declaration can settle: it is
 * legal only for the model the same credential names, so it is read against
 * the record it arrived in.
 */
const connectionSchema = Schema.Struct({
  value: text,
  expiresAt: Schema.Finite,
  model: text,
  callsUrl: Schema.Literal(HOSTED_CALLS_URL),
  wsUrl: text,
}).check(
  Schema.makeFilter(
    (connection) => connection.wsUrl === `${HOSTED_WS_BASE_URL}?model=${connection.model}`,
  ),
);

/** The value a schema admitted, or nothing, for a caller that only cares whether the value is admissible. */
function admitted<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

/** The value a `dropRefused` field admits: whatever the schema read, or nothing. */
function droppedField<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
): Schema.Codec<Value | undefined, UnparsedWireValue> {
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: admitted(schema, value) }),
    emitJsonSchema(schema),
  );
}

const quotaField = Schema.optionalKey(droppedField(hostedQuotaSchema));

/** What both mint answers carry: the credential, and the allowance it was spent against. */
const MINT_FIELDS = {
  connection: connectionSchema,
  quota: quotaField,
} as const;

/**
 * The shape of a hosted mint answer. Whether the credential it carries has
 * already expired is not a fact about its shape, so {@link hostedMintAnswerAt}
 * is where a moment in time meets it.
 */
export const hostedMintAnswerSchema = schemaAs<HostedMintAnswer>(
  omittingUndefinedKeys(Schema.Struct(MINT_FIELDS)),
);

/**
 * A mint answer read at a moment: anything without a usable, canonically
 * addressed credential is discarded rather than repaired, the same posture as
 * the OpenAI mint response reader.
 */
function mintAnswerAt<Answer extends HostedMintAnswer, Encoded>(
  schema: Schema.Codec<Answer, Encoded>,
): (value: UnparsedWireValue, now: number) => Answer | undefined {
  return (value, now) => {
    const answer = admitted(schema, value);
    return answer && realtimeCredentialIsUsable(answer.connection, now) ? answer : undefined;
  };
}

export const hostedMintAnswerAt = mintAnswerAt(hostedMintAnswerSchema);

/**
 * One pre-serialized context item returned by the remote mint endpoint. The
 * watch wraps `text` verbatim in a `conversation.item.create` event keyed by
 * `itemId` — it does not re-serialize, re-label, or re-validate the content.
 * These remote fields go with the watch's move (LUKE-224).
 */
export interface RemoteVoiceContextItem {
  /** The item id the watch names the `conversation.item.create` event with. */
  itemId: string;
  /** The labeled context text, ready to drop into `content[0].text`. */
  text: string;
}

/** The pre-serialized context the remote mint endpoint answers with. */
export interface RemoteVoiceContext {
  sessions: RemoteVoiceContextItem;
}

/** What the remote mint endpoint returns on success. */
export interface RemoteMintAnswer extends HostedMintAnswer {
  context: RemoteVoiceContext;
}

/**
 * The remote mint answer: the credential checks above, and additionally a
 * context with a sessions item. A malformed context is not repaired — the
 * watch has no fallback for context it cannot forward.
 */
export const remoteMintAnswerSchema = schemaAs<RemoteMintAnswer>(
  omittingUndefinedKeys(
    Schema.Struct({
      ...MINT_FIELDS,
      context: Schema.Struct({
        sessions: Schema.Struct({ itemId: text, text }),
      }),
    }),
  ),
);

export const remoteMintAnswerAt = mintAnswerAt(remoteMintAnswerSchema);
