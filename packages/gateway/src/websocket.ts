import { timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { isIdentifier } from "@sidecar/runtime/vocabulary";
import {
  Emitter,
  type Event,
  type IDisposable,
  isRecord,
  isWireString,
  toDisposable,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { WebSocket, WebSocketServer } from "ws";
import {
  InvocationMemory,
  NODE_INVOCATION_REFUSAL,
  type NodeInvocationHandler,
  PendingInvocations,
  unavailableInvocation,
  unknownInvocation,
} from "./invocations.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_HANDSHAKE_REFUSAL,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayClientIdentity,
  type GatewayClientRole,
  type GatewayEvent,
  type GatewayHandshakeRefusal,
  type GatewayRequest,
  type GatewayResponse,
  gatewayEventFromWire,
  gatewayRequestFromWire,
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
import { eventToWire, type GatewayServer } from "./server.js";
import type { GatewayEventSink, GatewayHostConnection, GatewayTransport } from "./transport.js";

/**
 * The Gateway on a socket: the protocol's envelopes carried as text over a
 * WebSocket the host binds. This is the transport that crosses a machine
 * boundary, so the handshake decides everything before a request is read.
 * Two of those decisions are the protocol's own and stay here: a host no
 * longer admitting refuses outright, and so does a client speaking another
 * protocol version. Who is asking is not the protocol's to know, and is
 * injected: `authenticate` reads the handshake's own headers and answers the
 * identity it recognizes or the refusal it earns, so a loopback binding can
 * compare a shared secret and a server can bind an account's bearer without
 * this file learning either. Every refusal is one typed header on the
 * response, and no credential reaches a log line here or anywhere.
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

/** Who the credential says is asking, or the one refusal the handshake earns for it. */
export type GatewayAdmission =
  | { admitted: GatewayClientIdentity }
  | {
      refusal:
        | typeof GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED
        | typeof GATEWAY_HANDSHAKE_REFUSAL.MALFORMED;
    };

export type GatewayAuthenticate = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
) => Promise<GatewayAdmission> | GatewayAdmission;

export interface WebSocketTransportOptions {
  server: GatewayServer;
  authenticate: GatewayAuthenticate;
  /** The largest frame a client may send; `ws` closes the connection on a larger one. */
  maximumFrameBytes?: number;
  report?: (message: string) => void;
}

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

interface AdmittedClient {
  identity: GatewayClientIdentity;
  /** The asks out on this socket; closed with it, so every unanswered ask reads unavailable and uncertain. */
  pending: PendingInvocations;
  connection: GatewayHostConnection;
  /** Fired once when this client's socket closes, so every node registered on it is marked disconnected. */
  closed: Emitter<void>;
}

type HandshakeDecision =
  | { admitted: Omit<AdmittedClient, "connection"> }
  | { refusal: GatewayHandshakeRefusal };

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

export class WebSocketTransport {
  readonly #options: WebSocketTransportOptions;
  readonly #http = http.createServer((_request, response) => {
    response.writeHead(404).end();
  });
  readonly #sockets: WebSocketServer;
  readonly #clients = new Map<WebSocket, AdmittedClient>();
  /** The raw sockets whose credential is still being checked; `ws` owns none of them yet. */
  readonly #handshaking = new Set<Duplex>();
  readonly #clientClosed = new Emitter<GatewayClientIdentity>();
  /** Hears every admitted socket close, with the identity it was admitted under. */
  readonly onClientClosed: Event<GatewayClientIdentity> = this.#clientClosed.event;
  #serverEvents: IDisposable | undefined;
  #admitting = true;
  #connections = 0;

  constructor(options: WebSocketTransportOptions) {
    this.#options = options;
    this.#sockets = new WebSocketServer({
      noServer: true,
      maxPayload: options.maximumFrameBytes ?? WEB_SOCKET_GATEWAY_DEFAULTS.MAXIMUM_FRAME_BYTES,
    });
    this.#http.on("upgrade", (request, socket, head) => {
      void this.#upgrade(request, socket, head);
    });
    this.#sockets.on("headers", (headers) => {
      for (const [name, value] of Object.entries(this.handshakeHeaders())) {
        headers.push(`${name}: ${value}`);
      }
    });
  }

  /** Binds the address and answers the port it listens on; nothing is published here. */
  bind(
    port: number = WEB_SOCKET_GATEWAY_DEFAULTS.PORT,
    host: string = WEB_SOCKET_GATEWAY_DEFAULTS.HOST,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      this.#http.once("error", reject);
      this.#http.listen(port, host, () => {
        this.#http.off("error", reject);
        // SAFETY: a TCP server that is listening answers an AddressInfo, never a pipe path.
        const address = this.#http.address() as AddressInfo;
        this.#serverEvents = this.#options.server.subscribe((event) => {
          const frame = JSON.stringify({
            kind: GATEWAY_FRAME.EVENT,
            envelope: eventToWire(event),
          });
          for (const socket of this.#clients.keys()) {
            if (socket.readyState === socket.OPEN) socket.send(frame);
          }
        });
        resolve(address.port);
      });
    });
  }

  connections(): number {
    return this.#clients.size;
  }

  /** Refuses every new connection from here on and closes the server's own door to mutations. */
  closeAdmissions(): void {
    this.#admitting = false;
    this.#options.server.closeAdmissions();
  }

  async close(): Promise<void> {
    this.#admitting = false;
    this.#serverEvents?.dispose();
    this.#serverEvents = undefined;
    for (const socket of [...this.#clients.keys()]) socket.close(1001, "the host is leaving");
    this.#clients.clear();
    // A socket whose credential is still being checked belongs to nobody
    // else, and the HTTP server counts it: leaving it open would hold this
    // close open behind a credential authority that may never answer.
    for (const socket of [...this.#handshaking]) socket.destroy();
    this.#handshaking.clear();
    await new Promise<void>((resolve) => {
      this.#sockets.close(() => {
        this.#http.close(() => resolve());
      });
    });
  }

  async #upgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    // Until `handleUpgrade` hands the socket to `ws`, nothing else listens on
    // it: a client that drops while its credential is being checked would
    // emit an unhandled error and take the host process with it.
    const absorb = (): void => {
      socket.destroy();
    };
    socket.on("error", absorb);
    this.#handshaking.add(socket);
    let decision: HandshakeDecision;
    try {
      decision = await this.#admission(request.headers);
    } finally {
      this.#handshaking.delete(socket);
    }
    if (socket.destroyed) return;
    if ("refusal" in decision) {
      const { refusal } = decision;
      socket.write(
        `HTTP/1.1 ${REFUSAL_STATUS[refusal]} Refused\r\n${GATEWAY_REFUSAL_HEADER}: ${refusal}\r\nConnection: close\r\n\r\n`,
      );
      socket.destroy();
      return;
    }
    socket.off("error", absorb);
    this.#sockets.handleUpgrade(request, socket, head, (webSocket) => {
      this.#admit(webSocket, decision.admitted);
    });
  }

  /** One socket as the host's methods see it: the connection a node registers against and is asked back through. */
  #connectionFor(
    socket: WebSocket,
    client: Omit<AdmittedClient, "connection">,
  ): GatewayHostConnection {
    this.#connections += 1;
    return {
      connectionId: `socket-${this.#connections}`,
      invoke: (invocation: NodeInvocation): Promise<NodeCapabilityResult> => {
        if (socket.readyState !== socket.OPEN) {
          return Promise.resolve(
            unavailableInvocation(invocation, NODE_INVOCATION_REFUSAL.DISCONNECTED),
          );
        }
        const answered = client.pending.open(invocation);
        socket.send(
          JSON.stringify({
            kind: GATEWAY_FRAME.INVOCATION,
            envelope: nodeInvocationToWire(invocation),
          }),
          (error) => {
            // A write that failed may or may not have left the process, so
            // the ask is settled unknown rather than unavailable.
            if (!error) return;
            client.pending.answer({
              invocationId: invocation.invocationId,
              result: unknownInvocation(invocation),
            });
          },
        );
        return answered;
      },
      onClosed: client.closed.event,
    };
  }

  /** Decides the handshake from its headers alone: the client admitted, or the one refusal it earns. */
  async #admission(headers: http.IncomingHttpHeaders): Promise<HandshakeDecision> {
    if (!this.#admitting) return { refusal: GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN };
    // An authentication that failed to decide has authorized no one, so a
    // thrown credential check is the refusal rather than a dangling socket.
    const authenticated = await this.#authenticate(headers);
    if ("refusal" in authenticated) return authenticated;
    // Read again: a host that closed its admissions while this handshake was
    // authenticating is one that has started to leave, and must admit no new
    // socket behind it.
    if (!this.#admitting) return { refusal: GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN };
    const protocolVersion = Number(headerValue(headers[GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]));
    if (protocolVersion !== GATEWAY_PROTOCOL_VERSION) {
      return { refusal: GATEWAY_HANDSHAKE_REFUSAL.UNSUPPORTED_VERSION };
    }
    return {
      admitted: {
        identity: authenticated.admitted,
        pending: new PendingInvocations(),
        closed: new Emitter(),
      },
    };
  }

  async #authenticate(headers: http.IncomingHttpHeaders): Promise<GatewayAdmission> {
    try {
      return await this.#options.authenticate(headers);
    } catch (error) {
      this.#options.report?.(
        `a Gateway handshake could not be authenticated: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { refusal: GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED };
    }
  }

  /** The headers a 101 answer carries, so the client learns the host's protocol on the same handshake. */
  handshakeHeaders() {
    return {
      [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
    };
  }

  #admit(socket: WebSocket, admitted: Omit<AdmittedClient, "connection">): void {
    const client: AdmittedClient = {
      ...admitted,
      connection: this.#connectionFor(socket, admitted),
    };
    this.#clients.set(socket, client);
    socket.on("message", (data, isBinary) => {
      if (isBinary) return socket.close(1003, "text frames only");
      void this.#take(socket, client, data.toString());
    });
    socket.on("close", () => {
      this.#clients.delete(socket);
      // The asks still out settle first, so a node handler waiting on one
      // reads unavailable before it hears the connection is gone and marks
      // the node disconnected.
      client.pending.close();
      client.closed.fire();
      client.closed.dispose();
      this.#clientClosed.fire(client.identity);
    });
    socket.on("error", (error) => {
      this.#options.report?.(`a Gateway client socket failed: ${error.message}`);
    });
  }

  async #take(socket: WebSocket, client: AdmittedClient, text: string): Promise<void> {
    let value: UnparsedWireValue;
    try {
      // SAFETY: JSON.parse returns a wire value; the reader is the validation.
      value = JSON.parse(text) as UnparsedWireValue;
    } catch {
      return;
    }
    if (!isRecord(value) || !isRecord(value.envelope)) return;
    const envelope = value.envelope;
    if (value.kind === GATEWAY_FRAME.ANSWER) {
      // An answer settles only an ask this same socket was sent; another
      // socket's answer, or one for an ask already settled or never made,
      // lands nowhere.
      const answer = nodeInvocationAnswerFromWire(envelope);
      if (answer) client.pending.answer(answer);
      return;
    }
    if (value.kind !== GATEWAY_FRAME.REQUEST) return;
    const request = gatewayRequestFromWire(envelope);
    let response: GatewayResponse;
    if (!request) {
      const id = isWireString(envelope.id) ? envelope.id : "";
      response = {
        id,
        ok: false,
        error: {
          code: GATEWAY_ERROR.INVALID_PARAMS,
          message: "the request is not one this host reads",
        },
        revision: this.#options.server.revision(),
      };
    } else {
      response = await this.#options.server.handle(request, client.identity, client.connection);
    }
    if (socket.readyState !== socket.OPEN) return;
    socket.send(
      JSON.stringify({ kind: GATEWAY_FRAME.RESPONSE, envelope: gatewayResponseToWire(response) }),
    );
  }
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

export const WEB_SOCKET_GATEWAY_CONNECT_DEFAULTS = {
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

export class WebSocketGatewayConnection implements GatewayTransport {
  readonly #socket: WebSocket;
  readonly #pending = new Map<string, (response: GatewayResponse) => void>();
  readonly #sinks = new Emitter<GatewayEvent>();
  readonly #closed = new Emitter<void>();
  /** Hears this connection's socket close, however it closed. */
  readonly onClosed: Event<void> = this.#closed.event;
  #memory: InvocationMemory | undefined;
  #open = true;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      this.#take(data.toString());
    });
    socket.on("close", () => this.#settleClosed());
    socket.on("error", () => this.#settleClosed());
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

  events(sink: GatewayEventSink): IDisposable {
    return this.#sinks.event(sink);
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
  serveInvocations(handler: NodeInvocationHandler): IDisposable {
    const memory = new InvocationMemory(handler);
    this.#memory = memory;
    return toDisposable(() => {
      if (this.#memory === memory) this.#memory = undefined;
    });
  }

  close(): void {
    if (!this.#open) return;
    this.#socket.close(1000, "the client is leaving");
    this.#settleClosed();
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
      this.#sinks.fire(event);
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

  /** Settles every ask still out, tells whoever is holding this connection, and delivers nothing further. */
  #settleClosed(): void {
    if (!this.#open) return;
    this.#open = false;
    for (const [id, resolve] of this.#pending) resolve(disconnected(id));
    this.#pending.clear();
    this.#closed.fire();
    this.#closed.dispose();
    this.#sinks.dispose();
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
