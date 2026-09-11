import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import * as Socket from "@effect/platform/Socket";
import * as SocketServer from "@effect/platform/SocketServer";
import { RpcSerialization, RpcServer } from "@effect/rpc";
import type { FromClientEncoded } from "@effect/rpc/RpcMessage";
import { isIdentifier } from "@sidecar/runtime/vocabulary";
import { isRecord, isWireString, type UnparsedWireValue, valueFromJsonText } from "@sidecar/wire";
import {
  Context,
  Effect,
  FiberSet,
  Layer,
  Mailbox,
  MutableRef,
  Option,
  type Scope,
  Stream,
} from "effect";
import { WebSocket, WebSocketServer } from "ws";
import {
  InvocationMemory,
  NODE_INVOCATION_REFUSAL,
  type NodeInvocationHandler,
  PendingInvocations,
  unavailableInvocation,
} from "./invocations.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_HANDSHAKE_REFUSAL,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayClientIdentity,
  type GatewayClientRole,
  type GatewayErrorCode,
  type GatewayEvent,
  type GatewayHandshakeRefusal,
  type GatewayRequest,
  type GatewayResponse,
  gatewayEventFromWire,
  gatewayEventToWire,
  gatewayRefusal,
  gatewayRequestToWire,
  gatewayResponseFromWire,
  gatewayResponseToWire,
  type NodeCapabilityResult,
  type NodeInvocation,
  nodeInvocationAnswerFromWire,
  nodeInvocationAnswerToWire,
  nodeInvocationFromWire,
  nodeInvocationToWire,
} from "./protocol.js";
import { gatewayEnvelopeSerialization, readRpcRequestMessage } from "./rpc.js";
import {
  GatewayAdmissions,
  GatewayClients,
  GatewayEventLog,
  type GatewayServerLayerOptions,
  layerGatewayAdmissions,
  layerGatewayClients,
  layerGatewayEventLog,
  layerGatewayServer,
} from "./server.js";
import type { GatewayEventSink, GatewayHostConnection, GatewayTransport } from "./transport.js";

/**
 * The Gateway on a socket: the protocol's envelopes carried as text over a
 * WebSocket the host binds, each accepted connection an `@effect/platform`
 * `Socket` run in the binding's own `Scope`, and the frames that cross it the
 * `RpcServer.Protocol` `layerGatewayServer` answers over. This is the
 * transport that crosses a machine boundary, so the handshake decides
 * everything before a request is read. Two of those decisions are the
 * protocol's own and stay here: a host no longer admitting refuses outright,
 * and so does a client speaking another protocol version. Who is asking is
 * not the protocol's to know, and is injected: `authenticate` reads the
 * handshake's own headers and answers the identity it recognizes or the
 * refusal it earns, so a loopback binding can compare a shared secret and a
 * server can bind an account's bearer without this file learning either.
 * Every refusal is one typed header on the response, and no credential
 * reaches a log line here or anywhere.
 */
export const GATEWAY_REFUSAL_HEADER = "x-luke-gateway-refusal";

export const GATEWAY_FRAME = {
  REQUEST: "request",
  RESPONSE: "response",
  EVENT: "event",
  /** The host asking the node on this one socket to perform a capability; answered by the same socket alone. */
  INVOCATION: "invocation",
  ANSWER: "answer",
} as const;

type GatewayFrameKind = (typeof GATEWAY_FRAME)[keyof typeof GATEWAY_FRAME];

/**
 * One frame: the kind, and the one envelope under it. The envelope's own
 * bytes are written by the protocol's serialization and its writers, so the
 * wrapper is put around that document rather than composed from a value read
 * back out of it, and a frame stays one line.
 */
function frameOf(kind: GatewayFrameKind, envelope: string): string {
  return `{"kind":"${kind}","envelope":${envelope}}`;
}

const decoder = new TextDecoder();

/** What the serialization wrote, as the text a frame carries it in. */
function textOf(encoded: string | Uint8Array | undefined): string | undefined {
  return encoded instanceof Uint8Array ? decoder.decode(encoded) : encoded;
}

/** Who the credential says is asking, or the one refusal the handshake earns for it. */
type GatewayHandshakeAdmission =
  | { admitted: GatewayClientIdentity }
  | {
      refusal:
        | typeof GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED
        | typeof GATEWAY_HANDSHAKE_REFUSAL.MALFORMED;
    };

export type GatewayAuthenticate = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
) => Promise<GatewayHandshakeAdmission> | GatewayHandshakeAdmission;

export const WEB_SOCKET_GATEWAY_DEFAULTS = {
  MAXIMUM_FRAME_BYTES: 4 * 1024 * 1024,
  /** Where a binding that names no host listens: this machine alone. */
  HOST: "127.0.0.1",
  /** The port the system picks. */
  PORT: 0,
} as const;

const REFUSAL_STATUS = {
  [GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED]: 401,
  [GATEWAY_HANDSHAKE_REFUSAL.UNSUPPORTED_VERSION]: 426,
  [GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN]: 503,
  [GATEWAY_HANDSHAKE_REFUSAL.MALFORMED]: 400,
} as const satisfies Record<GatewayHandshakeRefusal, number>;

/** What a request that is not an upgrade at all is answered: this binding serves the socket and nothing else. */
const NOT_UPGRADED_STATUS = 404;

/** The close a frame this binding does not read earns for itself, as `ws` names it. */
const UNSUPPORTED_DATA_CLOSE = 1003;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
}

function isClientRole(value: string | undefined): value is GatewayClientRole {
  return value === GATEWAY_CLIENT_ROLE.OPERATOR || value === GATEWAY_CLIENT_ROLE.NODE;
}

/** The identity a client declares on the handshake, read against the protocol's own vocabulary. */
function gatewayClientFromHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): GatewayClientIdentity | undefined {
  const clientId = headerValue(headers[GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]);
  const role = headerValue(headers[GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]);
  return isIdentifier(clientId) && isClientRole(role) ? { clientId, role } : undefined;
}

function bearerMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined || !presented.startsWith("Bearer ")) return false;
  const a = Buffer.from(presented.slice("Bearer ".length), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The authentication a shared secret makes: the presented bearer compared in
 * constant time against the expected one, and the identity taken from the
 * handshake's own headers, because a secret both sides hold says nothing
 * about which client is holding it.
 */
export function bearerAuthentication(expected: string): GatewayAuthenticate {
  return (headers) => {
    if (!bearerMatches(headerValue(headers[GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]), expected)) {
      return { refusal: GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED };
    }
    const admitted = gatewayClientFromHeaders(headers);
    return admitted ? { admitted } : { refusal: GATEWAY_HANDSHAKE_REFUSAL.MALFORMED };
  };
}

/** The socket the host is listening on, and the two things a host asks of it beside its frames. */
export class GatewaySocketBinding extends Context.Tag("@sidecar/gateway/GatewaySocketBinding")<
  GatewaySocketBinding,
  {
    /** The port it bound; the one a binding that named none was given by the system. */
    readonly port: number;
    readonly connections: Effect.Effect<number>;
    /**
     * Refuses every new connection from here on and closes the server's own
     * door to mutations, so a client can still see the host leaving.
     */
    readonly closeAdmissions: Effect.Effect<void>;
  }
>() {}

interface GatewaySocketOptions {
  /** Who is asking, decided where the credential is understood; this file learns none. */
  readonly authenticate: GatewayAuthenticate;
  readonly port?: number;
  readonly host?: string;
  /** The largest frame a client may send; `ws` closes the connection on a larger one. */
  readonly maximumFrameBytes?: number;
  readonly report?: (message: string) => void;
}

/** One admitted socket as the host holds it while its connection stands. */
interface SocketClient {
  /** The envelope id each Rpc request id stands for, so an answer is written under the id the client wrote. */
  readonly wireIds: Map<string, string>;
  /** Everything the host sends this socket, in one order: answers, events, and the asks of its node. */
  readonly outbound: Mailbox.Mailbox<string>;
  /** The asks out on this socket; closed with it, so every unanswered ask reads uncertain rather than refused. */
  readonly pending: PendingInvocations;
  readonly closedListeners: Set<() => void>;
  next: number;
}

type HandshakeDecision = { admitted: GatewayClientIdentity } | { refusal: GatewayHandshakeRefusal };

/**
 * The binding: an HTTP server that answers nothing but the upgrade, the
 * handshake that decides each one, and the `RpcServer.Protocol` the admitted
 * sockets' frames cross. The Rpc runtime numbers requests itself, so each
 * envelope's own id is kept here against the number it was handed in under
 * and written back onto the answer, which is the one thing this seam does to
 * a frame. Events are not requests and never were: they are the event log's
 * own stream, forwarded to every socket that stands.
 */
const makeGatewaySocket = (
  options: GatewaySocketOptions,
): Effect.Effect<
  {
    readonly protocol: RpcServer.Protocol["Type"];
    readonly binding: GatewaySocketBinding["Type"];
  },
  SocketServer.SocketServerError,
  | RpcSerialization.RpcSerialization
  | GatewayClients
  | GatewayEventLog
  | GatewayAdmissions
  | Scope.Scope
> =>
  Effect.gen(function* () {
    const maximumFrameBytes =
      options.maximumFrameBytes ?? WEB_SOCKET_GATEWAY_DEFAULTS.MAXIMUM_FRAME_BYTES;
    const parser = (yield* RpcSerialization.RpcSerialization).unsafeMake();
    const clients = yield* GatewayClients;
    const log = yield* GatewayEventLog;
    const admissions = yield* GatewayAdmissions;
    const disconnects = yield* Mailbox.make<number>();
    const admitting = MutableRef.make(true);
    const held = new Map<number, SocketClient>();
    // Subscribed before any socket is accepted, so an event emitted while one
    // is being admitted is carried to it rather than missed.
    const events = yield* log.events;
    let connections = 0;

    const refusalEnvelope = (id: string, code: GatewayErrorCode, message: string): string =>
      JSON.stringify(gatewayResponseToWire(gatewayRefusal(id, code, message, log.revision())));

    const offer = (client: SocketClient, frame: string): Effect.Effect<void> =>
      Effect.sync(() => {
        client.outbound.unsafeOffer(frame);
      });

    let write: (clientId: number, message: FromClientEncoded) => Effect.Effect<void> = () =>
      Effect.void;
    const protocol = yield* RpcServer.Protocol.make((carry) => {
      write = carry;
      return Effect.succeed({
        disconnects,
        send: (clientId, response) =>
          Effect.suspend(() => {
            const client = held.get(clientId);
            if (!client) return Effect.void;
            switch (response._tag) {
              case "Exit": {
                const wireId = client.wireIds.get(response.requestId);
                if (wireId === undefined) return Effect.void;
                client.wireIds.delete(response.requestId);
                const written = parser.encode({ ...response, requestId: wireId });
                return offer(
                  client,
                  frameOf(
                    GATEWAY_FRAME.RESPONSE,
                    textOf(written) ??
                      refusalEnvelope(
                        wireId,
                        GATEWAY_ERROR.INTERNAL,
                        "the answer did not survive the wire",
                      ),
                  ),
                );
              }
              case "Defect": {
                // The runtime gave up on this client as a whole; every ask still open is answered rather than left hanging.
                const abandoned = [...client.wireIds.values()];
                client.wireIds.clear();
                return Effect.forEach(
                  abandoned,
                  (wireId) =>
                    offer(
                      client,
                      frameOf(
                        GATEWAY_FRAME.RESPONSE,
                        refusalEnvelope(
                          wireId,
                          GATEWAY_ERROR.INTERNAL,
                          "the host could not answer",
                        ),
                      ),
                    ),
                  { discard: true },
                );
              }
              default:
                return Effect.void;
            }
          }),
        end: (clientId) =>
          Effect.zipRight(
            Effect.sync(() => {
              held.delete(clientId);
            }),
            clients.disconnect(clientId),
          ),
        clientIds: Effect.sync(() => new Set(held.keys())),
        initialMessage: Effect.succeedNone,
        supportsAck: false,
        supportsTransferables: false,
        supportsSpanPropagation: false,
      });
    });

    yield* Effect.forkScoped(
      Stream.runForEach(events, (event) =>
        Effect.sync(() => {
          const frame = frameOf(GATEWAY_FRAME.EVENT, JSON.stringify(gatewayEventToWire(event)));
          for (const client of held.values()) client.outbound.unsafeOffer(frame);
        }),
      ),
    );

    const authenticate = (headers: IncomingHttpHeaders): Effect.Effect<GatewayHandshakeAdmission> =>
      Effect.catchAll(
        Effect.tryPromise({
          try: async () => options.authenticate(headers),
          catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
        }),
        // An authentication that failed to decide has authorized no one.
        (message) =>
          Effect.as(
            Effect.sync(() =>
              options.report?.(`a Gateway handshake could not be authenticated: ${message}`),
            ),
            { refusal: GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED } as const,
          ),
      );

    const handshake = (headers: IncomingHttpHeaders): Effect.Effect<HandshakeDecision> =>
      Effect.gen(function* () {
        if (!MutableRef.get(admitting)) {
          return { refusal: GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN };
        }
        const authenticated = yield* authenticate(headers);
        if ("refusal" in authenticated) return authenticated;
        // Read again: a host that closed its admissions while this handshake
        // was authenticating is one that has started to leave, and must admit
        // no new socket behind it.
        if (!MutableRef.get(admitting)) {
          return { refusal: GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN };
        }
        const version = Number(headerValue(headers[GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]));
        return version === GATEWAY_PROTOCOL_VERSION
          ? { admitted: authenticated.admitted }
          : { refusal: GATEWAY_HANDSHAKE_REFUSAL.UNSUPPORTED_VERSION };
      });

    /** One socket as the host's methods see it: the connection a node registers against and is asked back through. */
    const connectionFor = (accepted: WebSocket, client: SocketClient): GatewayHostConnection => {
      connections += 1;
      return {
        connectionId: `socket-${connections}`,
        invoke: (invocation: NodeInvocation): Promise<NodeCapabilityResult> => {
          // The socket's own state decides this and not the queue behind it: an
          // ask a closing socket would still take into the queue never leaves
          // the host, and answering it unknown would record an effect that may
          // have happened where nothing was dispatched at all.
          if (accepted.readyState !== WebSocket.OPEN) {
            return Promise.resolve(
              unavailableInvocation(invocation, NODE_INVOCATION_REFUSAL.DISCONNECTED),
            );
          }
          const answered = client.pending.open(invocation);
          const carried = client.outbound.unsafeOffer(
            frameOf(GATEWAY_FRAME.INVOCATION, JSON.stringify(nodeInvocationToWire(invocation))),
          );
          if (!carried) {
            client.pending.answer({
              invocationId: invocation.invocationId,
              result: unavailableInvocation(invocation, NODE_INVOCATION_REFUSAL.DISCONNECTED),
            });
          }
          return answered;
        },
        onClosed: (listener) => {
          client.closedListeners.add(listener);
          return () => {
            client.closedListeners.delete(listener);
          };
        },
      };
    };

    const take = (
      clientId: number,
      client: SocketClient,
      writeRaw: (chunk: string | Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>,
      data: string | Uint8Array,
    ): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (data instanceof Uint8Array) {
          return Effect.ignore(
            writeRaw(new Socket.CloseEvent(UNSUPPORTED_DATA_CLOSE, "text frames only")),
          );
        }
        const value = valueFromJsonText(data);
        if (!isRecord(value) || !isRecord(value.envelope)) return Effect.void;
        const envelope = value.envelope;
        if (value.kind === GATEWAY_FRAME.ANSWER) {
          // An answer settles only an ask this same socket was sent; another
          // socket's answer, or one for an ask already settled or never made,
          // lands nowhere.
          const answer = nodeInvocationAnswerFromWire(envelope);
          return answer
            ? Effect.sync(() => {
                client.pending.answer(answer);
              })
            : Effect.void;
        }
        if (value.kind !== GATEWAY_FRAME.REQUEST) return Effect.void;
        const requests = parser
          .decode(JSON.stringify(envelope))
          .flatMap((message) => Option.toArray(readRpcRequestMessage(message)));
        const request = requests[0];
        if (!request || requests.length !== 1) {
          return offer(
            client,
            frameOf(
              GATEWAY_FRAME.RESPONSE,
              refusalEnvelope(
                isWireString(envelope.id) ? envelope.id : "",
                GATEWAY_ERROR.INVALID_PARAMS,
                "the request is not one this host reads",
              ),
            ),
          );
        }
        client.next += 1;
        const requestId = String(client.next);
        client.wireIds.set(requestId, request.id);
        return write(clientId, {
          ...request,
          id: requestId,
          headers: request.headers.map(([name, value]) => [name, value]),
        });
      });

    const closed = (clientId: number, client: SocketClient): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          held.delete(clientId);
          // The asks still out settle first, so a node handler waiting on one
          // reads its answer lost before it hears the connection is gone and
          // marks the node disconnected.
          client.pending.close();
          for (const listener of [...client.closedListeners]) listener();
          client.closedListeners.clear();
        });
        yield* client.outbound.end;
        yield* disconnects.offer(clientId);
      });

    const serve = (
      accepted: WebSocket,
      raw: Duplex,
      identity: GatewayClientIdentity,
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const socket = yield* Socket.fromWebSocket(
          Effect.acquireRelease(
            // SAFETY: `ws`'s socket is the WebSocket this listens on; the DOM interface is the only name TypeScript has for it.
            // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- `ws` and the DOM declare the same socket and share no declared type.
            Effect.succeed(accepted as unknown as globalThis.WebSocket),
            (open) => Effect.sync(() => open.close()),
          ),
        );
        const client: SocketClient = {
          wireIds: new Map(),
          outbound: yield* Mailbox.make<string>(),
          pending: new PendingInvocations(),
          closedListeners: new Set(),
          next: 0,
        };
        const clientId = yield* clients.connect({
          identity,
          connection: connectionFor(accepted, client),
        });
        held.set(clientId, client);
        yield* Effect.addFinalizer(() => closed(clientId, client));
        const writeRaw = yield* socket.writer;
        yield* Effect.forkScoped(
          Stream.runForEach(Mailbox.toStream(client.outbound), (frame) =>
            Effect.ignore(writeRaw(frame)),
          ),
        );
        yield* Effect.catchAll(
          socket.runRaw((data) => take(clientId, client, writeRaw, data)),
          (error) =>
            Effect.sync(() => options.report?.(`a Gateway client socket failed: ${error.message}`)),
        );
        // The socket is this connection's own and nothing else reads it, so
        // what the closing handshake did not finish ends here rather than
        // holding the host's own close open behind it.
        yield* Effect.sync(() => raw.destroy());
      });

    /**
     * One connection from its upgrade: the handshake first, on the headers
     * alone, and the socket run only for a client it admitted. Until
     * `handleUpgrade` hands the socket to `ws`, nothing else listens on it: a
     * client that drops while its credential is being checked would emit an
     * unhandled error and take the host process with it.
     */
    const admit = (
      request: IncomingMessage,
      raw: Duplex,
      head: Buffer,
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const absorb = (): void => {
          raw.destroy();
        };
        yield* Effect.sync(() => raw.on("error", absorb));
        // A host leaving while this credential is still being checked takes
        // the socket with it rather than holding its own close open behind a
        // credential authority that may never answer.
        const decision = yield* Effect.onInterrupt(handshake(request.headers), () =>
          Effect.sync(absorb),
        );
        if (raw.destroyed) return;
        if ("refusal" in decision) {
          return yield* Effect.sync(() => {
            raw.write(
              `HTTP/1.1 ${REFUSAL_STATUS[decision.refusal]} Refused\r\n${GATEWAY_REFUSAL_HEADER}: ${decision.refusal}\r\nConnection: close\r\n\r\n`,
            );
            raw.destroy();
          });
        }
        const accepted = yield* Effect.async<Option.Option<WebSocket>>((resume) => {
          // A socket that died between the check and the upgrade admits
          // nobody: `ws` destroys it and calls nothing back.
          const gone = (): void => resume(Effect.succeedNone);
          raw.once("close", gone);
          raw.off("error", absorb);
          sockets.handleUpgrade(request, raw, head, (socket) => {
            raw.off("close", gone);
            resume(Effect.succeedSome(socket));
          });
          // An interruption here leaves an upgrade `ws` may still finish, and
          // a socket nothing serves would hold the host's own close open, so
          // the connection ends rather than outliving the fiber that admitted
          // it.
          return Effect.sync(() => raw.destroy());
        });
        if (Option.isNone(accepted)) return;
        yield* serve(accepted.value, raw, decision.admitted);
      });

    const sockets = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocketServer({ noServer: true, maxPayload: maximumFrameBytes })),
      (server) =>
        Effect.async<void>((resume) => {
          server.close(() => resume(Effect.void));
        }),
    );
    // The 101 carries the host's protocol, so a client learns it on the same
    // handshake it was admitted by.
    yield* Effect.sync(() =>
      sockets.on("headers", (headers) => {
        headers.push(`${GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION}: ${GATEWAY_PROTOCOL_VERSION}`);
      }),
    );
    const node = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createServer((_request, response) => {
          response.writeHead(NOT_UPGRADED_STATUS).end();
        }),
      ),
      (server) =>
        Effect.async<void>((resume) => {
          server.closeAllConnections();
          server.close(() => resume(Effect.void));
        }),
    );
    const port = yield* Effect.async<number, SocketServer.SocketServerError>((resume) => {
      const failed = (cause: Error): void => {
        resume(Effect.fail(new SocketServer.SocketServerError({ reason: "Open", cause })));
      };
      node.once("error", failed);
      node.listen(
        options.port ?? WEB_SOCKET_GATEWAY_DEFAULTS.PORT,
        options.host ?? WEB_SOCKET_GATEWAY_DEFAULTS.HOST,
        () => {
          node.off("error", failed);
          // SAFETY: a TCP server that is listening answers an AddressInfo, never a pipe path.
          resume(Effect.succeed((node.address() as AddressInfo).port));
        },
      );
    });
    // Every connection is a fiber of this binding's own set, so the scope
    // that opened the socket is what ends all of them.
    const runFork = yield* FiberSet.makeRuntime<never>();
    yield* Effect.sync(() =>
      node.on("upgrade", (request, raw, head) => {
        runFork(Effect.scoped(admit(request, raw, head)));
      }),
    );

    return {
      protocol,
      binding: GatewaySocketBinding.of({
        port,
        connections: Effect.sync(() => held.size),
        closeAdmissions: Effect.zipRight(
          Effect.sync(() => MutableRef.set(admitting, false)),
          admissions.close,
        ),
      }),
    };
  });

/** The socket as the `Protocol` a server reads its frames from, beside the binding itself. */
function layerGatewaySocketProtocol(
  options: GatewaySocketOptions,
): Layer.Layer<
  RpcServer.Protocol | GatewaySocketBinding,
  SocketServer.SocketServerError,
  RpcSerialization.RpcSerialization | GatewayClients | GatewayEventLog | GatewayAdmissions
> {
  return Layer.scopedContext(
    Effect.map(makeGatewaySocket(options), ({ protocol, binding }) =>
      Context.make(RpcServer.Protocol, protocol).pipe(Context.add(GatewaySocketBinding, binding)),
    ),
  );
}

export interface GatewaySocketLayerOptions
  extends GatewayServerLayerOptions,
    GatewaySocketOptions {}

/**
 * The whole host end over a socket: the event log, the admissions door, and
 * the client registry the binding and the server share, the serialization
 * that stamps an answer with the log's own revision, and `layerGatewayServer`
 * over the socket's `Protocol`, so the server that answers a socket is the
 * same server that answers the in-process transport.
 */
export function layerGatewaySocket(
  options: GatewaySocketLayerOptions,
): Layer.Layer<
  GatewaySocketBinding | GatewayEventLog | GatewayAdmissions | GatewayClients,
  SocketServer.SocketServerError
> {
  const serialization = Layer.effect(
    RpcSerialization.RpcSerialization,
    Effect.map(GatewayEventLog, (log) => gatewayEnvelopeSerialization({ revision: log.revision })),
  );
  return layerGatewayServer(options).pipe(
    Layer.provideMerge(layerGatewaySocketProtocol(options)),
    Layer.provide(serialization),
    Layer.provideMerge(
      Layer.mergeAll(layerGatewayEventLog(options), layerGatewayAdmissions, layerGatewayClients),
    ),
  );
}

/**
 * The client end of the socket. The credential rides on the upgrade
 * request's authorization header and is dropped from memory once the
 * handshake ends; the address the socket opens names only the host. A
 * request that is in flight when the socket closes answers the typed
 * disconnected error rather than hanging.
 */
export interface WebSocketGatewayConnectOptions {
  url: string;
  /** What authenticates this client, in the header its host's own `authenticate` reads. */
  headers?: Readonly<Record<string, string>>;
  client: GatewayClientIdentity;
  /** How long the handshake may take before the attempt is unreachable. */
  timeoutMs?: number;
}

const WEB_SOCKET_GATEWAY_CONNECT_DEFAULTS = {
  TIMEOUT_MS: 5_000,
} as const;

/** A handshake that did not end in a connection: the refusal the host named, or no host at all. */
export const GATEWAY_UNREACHABLE = "unreachable";

export type GatewayConnectResult =
  | { ok: true; connection: WebSocketGatewayConnection }
  | { ok: false; failure: GatewayHandshakeRefusal | typeof GATEWAY_UNREACHABLE };

function isRefusal(value: string | undefined): value is GatewayHandshakeRefusal {
  return Object.values(GATEWAY_HANDSHAKE_REFUSAL).some((held) => held === value);
}

function disconnected(id: string): GatewayResponse {
  return {
    id,
    ok: false,
    error: { code: GATEWAY_ERROR.DISCONNECTED, message: "the Gateway socket is closed" },
    revision: { configuration: 0, sequence: 0 },
  };
}

class WebSocketGatewayConnection implements GatewayTransport {
  readonly #socket: WebSocket;
  readonly #pending = new Map<string, (response: GatewayResponse) => void>();
  readonly #sinks = new Set<GatewayEventSink>();
  readonly #closedListeners = new Set<() => void>();
  #memory: InvocationMemory | undefined;
  #open = true;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      this.#take(data.toString());
    });
    socket.on("close", () => this.#closed());
    socket.on("error", () => this.#closed());
  }

  request(request: GatewayRequest): Promise<GatewayResponse> {
    if (!this.#open || this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve(disconnected(request.id));
    }
    return new Promise((resolve) => {
      this.#pending.set(request.id, resolve);
      this.#socket.send(
        JSON.stringify({
          kind: GATEWAY_FRAME.REQUEST,
          envelope: gatewayRequestToWire(request),
        }),
        (error) => {
          if (!error) return;
          this.#pending.delete(request.id);
          resolve(disconnected(request.id));
        },
      );
    });
  }

  events(sink: GatewayEventSink): () => void {
    this.#sinks.add(sink);
    return () => {
      this.#sinks.delete(sink);
    };
  }

  connected(): boolean {
    return this.#open && this.#socket.readyState === WebSocket.OPEN;
  }

  /**
   * Serves the host's invocations arriving on this socket. Each is deduped
   * by id before the handler runs, and answered on this socket alone; an
   * invocation arriving while no handler is served is answered unavailable,
   * so the host never waits on a node that is not there.
   */
  serveInvocations(handler: NodeInvocationHandler): () => void {
    const memory = new InvocationMemory(handler);
    this.#memory = memory;
    return () => {
      if (this.#memory === memory) this.#memory = undefined;
    };
  }

  onClosed(listener: () => void): () => void {
    this.#closedListeners.add(listener);
    return () => {
      this.#closedListeners.delete(listener);
    };
  }

  close(): void {
    if (!this.#open) return;
    this.#socket.close(1000, "the client is leaving");
    this.#closed();
  }

  #take(text: string): void {
    let value: UnparsedWireValue;
    try {
      // SAFETY: JSON.parse returns a wire value; the reader is the validation.
      value = JSON.parse(text) as UnparsedWireValue;
    } catch {
      return;
    }
    if (!isRecord(value) || !isRecord(value.envelope)) return;
    const { kind, envelope } = value;
    if (kind === GATEWAY_FRAME.RESPONSE) {
      const response = gatewayResponseFromWire(envelope);
      if (!response) return;
      const resolve = this.#pending.get(response.id);
      if (!resolve) return;
      this.#pending.delete(response.id);
      resolve(response);
      return;
    }
    if (kind === GATEWAY_FRAME.EVENT) {
      const event: GatewayEvent | undefined = gatewayEventFromWire(envelope);
      if (!event) return;
      for (const sink of [...this.#sinks]) sink(event);
      return;
    }
    if (kind === GATEWAY_FRAME.INVOCATION) {
      const invocation = nodeInvocationFromWire(envelope);
      if (!invocation) return;
      void this.#answer(invocation);
    }
  }

  async #answer(invocation: NodeInvocation): Promise<void> {
    const memory = this.#memory;
    const answer = memory
      ? await memory.take(invocation)
      : {
          invocationId: invocation.invocationId,
          result: unavailableInvocation(invocation, NODE_INVOCATION_REFUSAL.NOT_SERVING),
        };
    if (!this.connected()) return;
    this.#socket.send(
      JSON.stringify({
        kind: GATEWAY_FRAME.ANSWER,
        envelope: nodeInvocationAnswerToWire(answer),
      }),
    );
  }

  #closed(): void {
    if (!this.#open) return;
    this.#open = false;
    for (const [id, resolve] of this.#pending) resolve(disconnected(id));
    this.#pending.clear();
    for (const listener of [...this.#closedListeners]) listener();
    this.#closedListeners.clear();
    this.#sinks.clear();
  }
}

export function connectWebSocketGateway(
  options: WebSocketGatewayConnectOptions,
): Promise<GatewayConnectResult> {
  const { url, client } = options;
  const timeoutMs = options.timeoutMs ?? WEB_SOCKET_GATEWAY_CONNECT_DEFAULTS.TIMEOUT_MS;
  return new Promise((resolve) => {
    const socket = new WebSocket(url, {
      headers: {
        ...options.headers,
        [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]: client.clientId,
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: client.role,
      },
      handshakeTimeout: timeoutMs,
      perMessageDeflate: false,
    });
    let settled = false;
    const settle = (result: GatewayConnectResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    socket.once("unexpected-response", (_request, response: IncomingMessage) => {
      const refusal = response.headers[GATEWAY_REFUSAL_HEADER];
      const named = Array.isArray(refusal) ? refusal[0] : refusal;
      response.resume();
      socket.terminate();
      settle({ ok: false, failure: isRefusal(named) ? named : GATEWAY_UNREACHABLE });
    });
    socket.once("error", () => {
      settle({ ok: false, failure: GATEWAY_UNREACHABLE });
    });
    socket.once("open", () => {
      settle({ ok: true, connection: new WebSocketGatewayConnection(socket) });
    });
  });
}
