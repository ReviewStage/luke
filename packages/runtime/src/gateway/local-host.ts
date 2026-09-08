import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_HANDSHAKE_REFUSAL,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayBuildIdentity,
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
import { GATEWAY_LOOPBACK_HOST } from "./discovery.js";
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
 * WebSocket bound to the loopback address on a port the system picks. The
 * handshake decides everything before a request is read: the token, compared
 * in constant time and never accepted from an address; the protocol version,
 * refused outright when it differs; and the build, which when it differs
 * leaves the connection standing in a drain-only posture where only a hello,
 * a reconnection, and the shutdown answer, so a newer build can ask an older
 * Gateway to leave without operating it. Every refusal is one typed header on
 * the response, and the token never reaches a log line here or anywhere.
 */
export const GATEWAY_REFUSAL_HEADER = "x-luke-gateway-refusal";

export const LOCAL_GATEWAY_FRAME = {
  REQUEST: "request",
  RESPONSE: "response",
  EVENT: "event",
  /** The host asking the node on this one socket to perform a capability; answered by the same socket alone. */
  INVOCATION: "invocation",
  ANSWER: "answer",
} as const;

export interface LocalGatewayHostOptions {
  server: GatewayServer;
  token: string;
  build: GatewayBuildIdentity;
  /** The largest frame a client may send; `ws` closes the connection on a larger one. */
  maximumFrameBytes?: number;
  report?: (message: string) => void;
}

export const LOCAL_GATEWAY_DEFAULTS = {
  MAXIMUM_FRAME_BYTES: 4 * 1024 * 1024,
} as const;

/** What a build-mismatched client may still do: see the host, and ask it to leave. */
const DRAIN_ONLY_METHODS: ReadonlySet<string> = new Set([
  GATEWAY_METHOD.HELLO,
  GATEWAY_METHOD.RECONNECT,
  GATEWAY_METHOD.SHUTDOWN,
]);

const REFUSAL_STATUS = {
  [GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED]: 401,
  [GATEWAY_HANDSHAKE_REFUSAL.UNSUPPORTED_VERSION]: 426,
  [GATEWAY_HANDSHAKE_REFUSAL.INCOMPATIBLE_BUILD]: 409,
  [GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN]: 503,
  [GATEWAY_HANDSHAKE_REFUSAL.MALFORMED]: 400,
} as const satisfies Record<GatewayHandshakeRefusal, number>;

interface AdmittedClient {
  identity: GatewayClientIdentity;
  drainOnly: boolean;
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

function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const bearer = presented.startsWith("Bearer ") ? presented.slice("Bearer ".length) : undefined;
  if (bearer === undefined) return false;
  const a = Buffer.from(bearer, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function isClientRole(value: string | undefined): value is GatewayClientRole {
  return value === GATEWAY_CLIENT_ROLE.OPERATOR || value === GATEWAY_CLIENT_ROLE.NODE;
}

export class LocalGatewayHost {
  readonly #options: LocalGatewayHostOptions;
  readonly #http = http.createServer((_request, response) => {
    response.writeHead(404).end();
  });
  readonly #sockets: WebSocketServer;
  readonly #clients = new Map<WebSocket, AdmittedClient>();
  readonly #closedListeners = new Set<(client: GatewayClientIdentity) => void>();
  #unsubscribe: (() => void) | undefined;
  #admitting = true;
  #connections = 0;

  constructor(options: LocalGatewayHostOptions) {
    this.#options = options;
    this.#sockets = new WebSocketServer({
      noServer: true,
      maxPayload: options.maximumFrameBytes ?? LOCAL_GATEWAY_DEFAULTS.MAXIMUM_FRAME_BYTES,
    });
    this.#http.on("upgrade", (request, socket, head) => this.#upgrade(request, socket, head));
    this.#sockets.on("headers", (headers) => {
      for (const [name, value] of Object.entries(this.handshakeHeaders())) {
        headers.push(`${name}: ${value}`);
      }
    });
  }

  /** Binds the loopback address on an ephemeral port and answers it; nothing is published here. */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.#http.once("error", reject);
      this.#http.listen(0, GATEWAY_LOOPBACK_HOST, () => {
        this.#http.off("error", reject);
        // SAFETY: a TCP server that is listening answers an AddressInfo, never a pipe path.
        const address = this.#http.address() as AddressInfo;
        this.#unsubscribe = this.#options.server.subscribe((event) => {
          const frame = JSON.stringify({
            kind: LOCAL_GATEWAY_FRAME.EVENT,
            envelope: eventToWire(event),
          });
          for (const [socket, client] of this.#clients) {
            if (client.drainOnly) continue;
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
    await new Promise<void>((resolve) => {
      this.#sockets.close(() => {
        this.#http.close(() => resolve());
      });
    });
  }

  #upgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const decision = this.#admission(request.headers);
    if ("refusal" in decision) {
      const { refusal } = decision;
      socket.write(
        `HTTP/1.1 ${REFUSAL_STATUS[refusal]} Refused\r\n${GATEWAY_REFUSAL_HEADER}: ${refusal}\r\nConnection: close\r\n\r\n`,
      );
      socket.destroy();
      return;
    }
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
            kind: LOCAL_GATEWAY_FRAME.INVOCATION,
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
  #admission(headers: http.IncomingHttpHeaders): HandshakeDecision {
    if (!this.#admitting) return { refusal: GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN };
    if (
      !tokenMatches(
        headerValue(headers[GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]),
        this.#options.token,
      )
    ) {
      return { refusal: GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED };
    }
    const protocolVersion = Number(headerValue(headers[GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]));
    if (protocolVersion !== GATEWAY_PROTOCOL_VERSION) {
      return { refusal: GATEWAY_HANDSHAKE_REFUSAL.UNSUPPORTED_VERSION };
    }
    const buildVersion = headerValue(headers[GATEWAY_HANDSHAKE_HEADER.BUILD_VERSION]);
    const clientId = headerValue(headers[GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]);
    const role = headerValue(headers[GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]);
    if (buildVersion === undefined || !isIdentifier(clientId) || !isClientRole(role)) {
      return { refusal: GATEWAY_HANDSHAKE_REFUSAL.MALFORMED };
    }
    const admitted: Omit<AdmittedClient, "connection"> = {
      identity: { clientId, role },
      drainOnly: buildVersion !== this.#options.build.buildVersion,
      pending: new PendingInvocations(),
      closedListeners: new Set(),
    };
    return { admitted };
  }

  /** The headers a 101 answer carries, so the client learns the host's build on the same handshake. */
  handshakeHeaders() {
    return {
      [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(this.#options.build.protocolVersion),
      [GATEWAY_HANDSHAKE_HEADER.BUILD_VERSION]: this.#options.build.buildVersion,
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
    if (value.kind === LOCAL_GATEWAY_FRAME.ANSWER) {
      // An answer settles only an ask this same socket was sent; another
      // socket's answer, or one for an ask already settled or never made,
      // lands nowhere.
      const answer = nodeInvocationAnswerFromWire(envelope);
      if (answer) client.pending.answer(answer);
      return;
    }
    if (value.kind !== LOCAL_GATEWAY_FRAME.REQUEST) return;
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
    } else if (client.drainOnly && !DRAIN_ONLY_METHODS.has(request.method)) {
      response = {
        id: request.id,
        ok: false,
        error: {
          code: GATEWAY_ERROR.INCOMPATIBLE_BUILD,
          message: `this Gateway is build ${this.#options.build.buildVersion}; a client of another build may only ask it to leave`,
        },
        revision: this.#options.server.revision(),
      };
    } else {
      response = await this.#options.server.handle(request, client.identity, client.connection);
    }
    if (socket.readyState !== socket.OPEN) return;
    socket.send(
      JSON.stringify({ kind: LOCAL_GATEWAY_FRAME.RESPONSE, envelope: responseToWire(response) }),
    );
  }
}

export function responseToWire(response: GatewayResponse): WireRecord {
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
