import { Rpc, RpcGroup, RpcSerialization } from "@effect/rpc";
import type { FromClientEncoded, FromServerEncoded } from "@effect/rpc/RpcMessage";
import { isRecord, valueFromJsonText, type WireRecord } from "@sidecar/wire";
import { Cause, Context, Exit, Layer, Option, Schema } from "effect";
import {
  GATEWAY_ERROR,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_METHOD_ENTRIES,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayError,
  GatewayErrorSchema,
  type GatewayEvent,
  GatewayEventSchema,
  type GatewayMethod,
  GatewayMethodSchema,
  GatewayParamsSchema,
  GatewayRefusalSchema,
  type GatewayRequest,
  GatewayResultSchema,
  type GatewayRevision,
  gatewayEventFromWire,
  gatewayEventToWire,
  gatewayRequestFromWire,
  gatewayRequestToWire,
  gatewayResponseFromWire,
  gatewayResponseToWire,
} from "./protocol.js";

/**
 * The protocol as an `RpcGroup`, derived from the one method table, and the
 * serialization that carries that group's messages as the envelopes
 * `fixtures/protocol` records. Nothing here performs anything either: the
 * group is what a server answers and a client calls, and the serialization
 * is the bytes between them, held to the goldens so a client of an earlier
 * build reads what it always did.
 */

/** Whether an Rpc changes something, carried on the Rpc itself so a server keys its idempotency ledger on the same entry the name came from. */
export class GatewayMutates extends Context.Tag("@sidecar/gateway/GatewayMutates")<
  GatewayMutates,
  boolean
>() {}

/** One method of the group: its wire name, a record of parameters, a wire value or nothing, and a refusal of the family. */
export type GatewayRpc = Rpc.Rpc<
  GatewayMethod,
  typeof GatewayParamsSchema,
  typeof GatewayResultSchema,
  typeof GatewayRefusalSchema
>;

const GATEWAY_RPCS: readonly GatewayRpc[] = GATEWAY_METHOD_ENTRIES.map((entry) =>
  Rpc.make(entry.name, {
    payload: GatewayParamsSchema,
    success: GatewayResultSchema,
    error: GatewayRefusalSchema,
  }).annotate(GatewayMutates, entry.mutates),
);

/** Every method the protocol knows, as one group; a method is in it exactly because it is in the table. */
export const GatewayRpcs = RpcGroup.make(...GATEWAY_RPCS);

/** Reads the flag the method's own entry declared; an Rpc carrying none is not the protocol's, and a server must not guess for it. */
export function gatewayRpcMutates(rpc: Rpc.AnyWithProps): Option.Option<boolean> {
  return Context.getOption(rpc.annotations, GatewayMutates);
}

/**
 * The request fields the envelope carries beside the method and its
 * parameters, as the headers of an Rpc request, since a request's headers
 * are the one place the Rpc model keeps what is neither. The protocol
 * version rides under the same name the handshake uses for it.
 */
export const GATEWAY_REQUEST_HEADER = {
  PROTOCOL_VERSION: GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION,
  IDEMPOTENCY_KEY: "x-luke-gateway-idempotency-key",
  EXPECTED_SESSION_KEY: "x-luke-gateway-expected-session-key",
  EXPECTED_SESSION_REVISION: "x-luke-gateway-expected-session-revision",
  EXPECTED_CONFIGURATION_REVISION: "x-luke-gateway-expected-configuration-revision",
} as const;

/**
 * The request id every event arrives under, as a chunk of one standing
 * stream. The Rpc model has no unsolicited message but a stream's chunk, so
 * the event log is that stream; a client mints its ids from zero upward and
 * never this one.
 */
export const GATEWAY_EVENT_STREAM_REQUEST_ID = "-1";

const HEADER_NUMBER = Schema.NumberFromString;
const readHeaderNumber = Schema.decodeSync(HEADER_NUMBER);
const writeHeaderNumber = Schema.encodeSync(HEADER_NUMBER);

type RequestHeaders = ReadonlyArray<readonly [string, string]>;

function requestHeaders(request: GatewayRequest): RequestHeaders {
  const expected = request.expectedRevision;
  return [
    [GATEWAY_REQUEST_HEADER.PROTOCOL_VERSION, writeHeaderNumber(request.protocolVersion)],
    ...(request.idempotencyKey !== undefined
      ? [[GATEWAY_REQUEST_HEADER.IDEMPOTENCY_KEY, request.idempotencyKey] as const]
      : []),
    ...(expected?.sessionKey !== undefined
      ? [[GATEWAY_REQUEST_HEADER.EXPECTED_SESSION_KEY, expected.sessionKey] as const]
      : []),
    ...(expected?.sessionRevision !== undefined
      ? [[GATEWAY_REQUEST_HEADER.EXPECTED_SESSION_REVISION, expected.sessionRevision] as const]
      : []),
    ...(expected?.configurationRevision !== undefined
      ? ([
          [
            GATEWAY_REQUEST_HEADER.EXPECTED_CONFIGURATION_REVISION,
            writeHeaderNumber(expected.configurationRevision),
          ],
        ] as const)
      : []),
  ];
}

/** The protocol version a decoded request said it speaks; a request that named none speaks this build's. */
export function gatewayRequestVersion(headers: RequestHeaders): number {
  const version = new Map(headers).get(GATEWAY_REQUEST_HEADER.PROTOCOL_VERSION);
  return version === undefined ? GATEWAY_PROTOCOL_VERSION : readHeaderNumber(version);
}

function requestFromMessage(message: RpcRequestMessage): GatewayRequest {
  const headers = new Map(message.headers);
  const idempotencyKey = headers.get(GATEWAY_REQUEST_HEADER.IDEMPOTENCY_KEY);
  const sessionKey = headers.get(GATEWAY_REQUEST_HEADER.EXPECTED_SESSION_KEY);
  const sessionRevision = headers.get(GATEWAY_REQUEST_HEADER.EXPECTED_SESSION_REVISION);
  const configurationRevision = headers.get(GATEWAY_REQUEST_HEADER.EXPECTED_CONFIGURATION_REVISION);
  const expectedRevision = {
    ...(sessionKey !== undefined ? { sessionKey } : undefined),
    ...(sessionRevision !== undefined ? { sessionRevision } : undefined),
    ...(configurationRevision !== undefined
      ? { configurationRevision: readHeaderNumber(configurationRevision) }
      : undefined),
  };
  return {
    protocolVersion: gatewayRequestVersion(message.headers),
    id: message.id,
    method: message.tag,
    params: message.payload,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : undefined),
    ...(Object.keys(expectedRevision).length > 0 ? { expectedRevision } : undefined),
  };
}

/**
 * The Rpc messages the envelope has a shape for, read off the `unknown` the
 * parser is handed. A request's payload is the encoded record its method
 * takes, an exit's success is the encoded result and its failure the encoded
 * refusal, and a chunk's values are encoded events. Anything else the Rpc
 * runtime says — a ping, an ack, an interrupt, a defect with no request to
 * answer — has no envelope and is written as nothing.
 */
/** The three Rpc message kinds the envelope has a shape for, as `@effect/rpc` tags them. */
const RPC_MESSAGE_TAG = {
  REQUEST: "Request",
  EXIT: "Exit",
  CHUNK: "Chunk",
} as const;

const RpcRequestMessageSchema = Schema.Struct({
  _tag: Schema.Literal(RPC_MESSAGE_TAG.REQUEST),
  id: Schema.String,
  tag: GatewayMethodSchema,
  payload: GatewayParamsSchema,
  headers: Schema.Array(Schema.Tuple(Schema.String, Schema.String)),
});

type RpcRequestMessage = typeof RpcRequestMessageSchema.Type;

const GatewayExitSchema = Schema.Exit({
  success: GatewayResultSchema,
  failure: GatewayErrorSchema,
  defect: Schema.Defect,
});

const RpcExitMessageSchema = Schema.Struct({
  _tag: Schema.Literal(RPC_MESSAGE_TAG.EXIT),
  requestId: Schema.String,
  exit: GatewayExitSchema,
});

const RpcChunkMessageSchema = Schema.Struct({
  _tag: Schema.Literal(RPC_MESSAGE_TAG.CHUNK),
  requestId: Schema.String,
  values: Schema.NonEmptyArray(GatewayEventSchema),
});

const readRpcMessage = Schema.decodeUnknownOption(
  Schema.Union(RpcRequestMessageSchema, RpcExitMessageSchema, RpcChunkMessageSchema),
);

/** What an answer that never formed says: the first typed refusal in the cause, or an internal error naming the defect. */
function gatewayErrorFromCause(cause: Cause.Cause<GatewayError>): GatewayError {
  return Option.getOrElse(Cause.failureOption(cause), () => ({
    code: GATEWAY_ERROR.INTERNAL,
    message: Option.match(Cause.dieOption(cause), {
      onSome: (defect) => (defect instanceof Error ? defect.message : String(defect)),
      onNone: () => "the answer was interrupted before it formed",
    }),
  }));
}

/** Every envelope of a frame, one per line; the writers here never put a newline inside one, so a line is a document. */
function envelopesOf(text: string): readonly WireRecord[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map(valueFromJsonText)
    .filter(isRecord);
}

function messagesOf(envelope: WireRecord): readonly (FromClientEncoded | FromServerEncoded)[] {
  const request = gatewayRequestFromWire(envelope);
  if (request) {
    return [
      {
        _tag: RPC_MESSAGE_TAG.REQUEST,
        id: request.id,
        tag: request.method,
        payload: request.params,
        headers: requestHeaders(request).map(([name, value]) => [name, value]),
      },
    ];
  }
  const response = gatewayResponseFromWire(envelope);
  if (response) {
    return [
      {
        _tag: RPC_MESSAGE_TAG.EXIT,
        requestId: response.id,
        exit: response.ok
          ? { _tag: "Success", value: response.result }
          : { _tag: "Failure", cause: { _tag: "Fail", error: response.error } },
      },
    ];
  }
  const event = gatewayEventFromWire(envelope);
  if (event) {
    return [
      { _tag: RPC_MESSAGE_TAG.CHUNK, requestId: GATEWAY_EVENT_STREAM_REQUEST_ID, values: [event] },
    ];
  }
  return [];
}

function frameOf(record: WireRecord): string {
  return JSON.stringify(record);
}

export interface GatewayEnvelopeSerializationOptions {
  /** The revisions that stand as an answer is written; every response envelope carries them, as the server has always stamped them. */
  readonly revision: () => GatewayRevision;
}

/**
 * The Rpc serialization that speaks the existing envelope. A request travels
 * as `{ protocolVersion, id, method, params, idempotencyKey?, expectedRevision? }`,
 * an answer as `{ id, ok, result? | error, revision }`, and an event as its
 * own record, each with its keys in the order the goldens hold; what the Rpc
 * model keeps as a request's headers — the version, the idempotency key, the
 * expected revisions — is folded into the envelope's own fields on the way
 * out and read back into headers on the way in. A message the envelope has
 * no shape for is written as nothing, and a frame it does not read is
 * dropped, as the socket has always dropped one.
 */
export function gatewayEnvelopeSerialization(
  options: GatewayEnvelopeSerializationOptions,
): RpcSerialization.RpcSerialization["Type"] {
  const encodeMessage = (message: RpcRequestMessage | RpcExitMessage | RpcChunkMessage) => {
    switch (message._tag) {
      case RPC_MESSAGE_TAG.REQUEST:
        return frameOf(gatewayRequestToWire(requestFromMessage(message)));
      case RPC_MESSAGE_TAG.EXIT:
        return frameOf(
          gatewayResponseToWire(
            Exit.match(message.exit, {
              onSuccess: (result) => ({
                id: message.requestId,
                ok: true,
                result,
                revision: options.revision(),
              }),
              onFailure: (cause) => ({
                id: message.requestId,
                ok: false,
                error: gatewayErrorFromCause(cause),
                revision: options.revision(),
              }),
            }),
          ),
        );
      case RPC_MESSAGE_TAG.CHUNK:
        return message.values
          .map((event: GatewayEvent) => frameOf(gatewayEventToWire(event)))
          .join("\n");
    }
  };
  return RpcSerialization.RpcSerialization.of({
    contentType: "application/json",
    includesFraming: false,
    unsafeMake: () => {
      const decoder = new TextDecoder();
      return {
        decode: (data) =>
          envelopesOf(data instanceof Uint8Array ? decoder.decode(data) : data).flatMap(messagesOf),
        encode: (message) =>
          Option.getOrUndefined(Option.map(readRpcMessage(message), encodeMessage)),
      };
    },
  });
}

type RpcExitMessage = typeof RpcExitMessageSchema.Type;
type RpcChunkMessage = typeof RpcChunkMessageSchema.Type;

/** The serialization as the layer a server or client protocol reads it from. */
export function layerGatewayEnvelopeSerialization(
  options: GatewayEnvelopeSerializationOptions,
): Layer.Layer<RpcSerialization.RpcSerialization> {
  return Layer.succeed(RpcSerialization.RpcSerialization, gatewayEnvelopeSerialization(options));
}
