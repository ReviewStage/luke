import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_HANDSHAKE_REFUSAL,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayClientIdentity,
  type GatewayClientRole,
  type GatewayHandshakeRefusal,
  type GatewayResponse,
  gatewayRequestFromWire,
  isIdentifier,
  type NodeCapabilityResult,
  type NodeInvocation,
  nodeInvocationAnswerFromWire,
  nodeInvocationToWire,
} from "@sidecar/runtime-contracts";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { type WebSocket, WebSocketServer } from "ws";
import {
  NODE_INVOCATION_REFUSAL,
  PendingInvocations,
  unavailableInvocation,
  unknownInvocation,
} from "./invocations.js";
import { eventToWire, type GatewayServer } from "./server.js";
import type { GatewayHostConnection } from "./transport.js";

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
  closedListeners: Set<() => void>;
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
  readonly #closedListeners = new Set<(client: GatewayClientIdentity) => void>();
  #unsubscribe: (() => void) | undefined;
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
        this.#unsubscribe = this.#options.server.subscribe((event) => {
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

  /** Hears every admitted socket close, with the identity it was admitted under. */
  onClientClosed(listener: (client: GatewayClientIdentity) => void): () => void {
    this.#closedListeners.add(listener);
    return () => {
      this.#closedListeners.delete(listener);
    };
  }

  /** Refuses every new connection from here on and closes the server's own door to mutations. */
  closeAdmissions(): void {
    this.#admitting = false;
    this.#options.server.closeAdmissions();
  }

  async close(): Promise<void> {
    this.#admitting = false;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
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
      onClosed: (listener) => {
        client.closedListeners.add(listener);
        return () => {
          client.closedListeners.delete(listener);
        };
      },
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
        closedListeners: new Set(),
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
      for (const listener of [...client.closedListeners]) listener();
      client.closedListeners.clear();
      for (const listener of [...this.#closedListeners]) listener(client.identity);
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
      JSON.stringify({ kind: GATEWAY_FRAME.RESPONSE, envelope: responseToWire(response) }),
    );
  }
}

function responseToWire(response: GatewayResponse): WireRecord {
  const revision = {
    configuration: response.revision.configuration,
    sequence: response.revision.sequence,
  };
  return response.ok
    ? {
        id: response.id,
        ok: true,
        ...(response.result !== undefined ? { result: response.result } : undefined),
        revision,
      }
    : { id: response.id, ok: false, error: { ...response.error }, revision };
}
