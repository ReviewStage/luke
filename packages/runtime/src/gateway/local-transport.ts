import type { IncomingMessage } from "node:http";
import {
  GATEWAY_ERROR,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_HANDSHAKE_REFUSAL,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayBuildIdentity,
  type GatewayClientIdentity,
  type GatewayEvent,
  type GatewayHandshakeRefusal,
  type GatewayRequest,
  type GatewayResponse,
  gatewayEventFromWire,
  gatewayResponseFromWire,
} from "@sidecar/runtime-contracts";
import { isRecord, type UnparsedWireValue, type WireValue } from "@sidecar/wire";
import { WebSocket } from "ws";
import type { GatewayDiscoveryRecord } from "./discovery.js";
import { GATEWAY_REFUSAL_HEADER, LOCAL_GATEWAY_FRAME } from "./local-host.js";
import {
  GATEWAY_CONNECT_FAILURE,
  type GatewayConnection,
  type GatewayConnectResult,
} from "./supervisor.js";
import type { GatewayEventSink } from "./transport.js";

/**
 * The client end of the loopback socket. The token rides on the upgrade
 * request's authorization header and is dropped from memory once the
 * handshake ends; the address the socket opens names only the host and port.
 * A request that is in flight when the socket closes answers the typed
 * disconnected error rather than hanging, and the host's build, read from the
 * handshake's own answer, is what the supervisor compares before operating.
 */
export interface LocalGatewayConnectOptions {
  record: Pick<GatewayDiscoveryRecord, "host" | "port" | "token">;
  client: GatewayClientIdentity;
  build: GatewayBuildIdentity;
  /** How long the handshake may take before the attempt is unreachable. */
  timeoutMs?: number;
}

export const LOCAL_GATEWAY_CONNECT_DEFAULTS = {
  TIMEOUT_MS: 5_000,
} as const;

function isRefusal(value: string | undefined): value is GatewayHandshakeRefusal {
  return Object.values(GATEWAY_HANDSHAKE_REFUSAL).some((held) => held === value);
}

function requestToWire(request: GatewayRequest): WireValue {
  return {
    protocolVersion: request.protocolVersion,
    id: request.id,
    method: request.method,
    params: request.params,
    ...(request.idempotencyKey !== undefined
      ? { idempotencyKey: request.idempotencyKey }
      : undefined),
    ...(request.expectedRevision !== undefined
      ? { expectedRevision: { ...request.expectedRevision } }
      : undefined),
  };
}

function disconnected(id: string): GatewayResponse {
  return {
    id,
    ok: false,
    error: { code: GATEWAY_ERROR.DISCONNECTED, message: "the Gateway socket is closed" },
    revision: { configuration: 0, sequence: 0 },
  };
}

export class LocalGatewayConnection implements GatewayConnection {
  readonly hostBuild: GatewayBuildIdentity;
  readonly #socket: WebSocket;
  readonly #pending = new Map<string, (response: GatewayResponse) => void>();
  readonly #sinks = new Set<GatewayEventSink>();
  readonly #closedListeners = new Set<() => void>();
  #open = true;

  constructor(socket: WebSocket, hostBuild: GatewayBuildIdentity) {
    this.#socket = socket;
    this.hostBuild = hostBuild;
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
          kind: LOCAL_GATEWAY_FRAME.REQUEST,
          envelope: requestToWire(request),
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
    if (kind === LOCAL_GATEWAY_FRAME.RESPONSE) {
      const response = gatewayResponseFromWire(envelope);
      if (!response) return;
      const resolve = this.#pending.get(response.id);
      if (!resolve) return;
      this.#pending.delete(response.id);
      resolve(response);
      return;
    }
    if (kind === LOCAL_GATEWAY_FRAME.EVENT) {
      const event: GatewayEvent | undefined = gatewayEventFromWire(envelope);
      if (!event) return;
      for (const sink of [...this.#sinks]) sink(event);
    }
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

export function connectLocalGateway(
  options: LocalGatewayConnectOptions,
): Promise<GatewayConnectResult> {
  const { record, client, build } = options;
  const timeoutMs = options.timeoutMs ?? LOCAL_GATEWAY_CONNECT_DEFAULTS.TIMEOUT_MS;
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://${record.host}:${record.port}/`, {
      headers: {
        [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${record.token}`,
        [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
        [GATEWAY_HANDSHAKE_HEADER.BUILD_VERSION]: build.buildVersion,
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]: client.clientId,
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: client.role,
      },
      handshakeTimeout: timeoutMs,
      perMessageDeflate: false,
    });
    let hostBuild: GatewayBuildIdentity | undefined;
    let settled = false;
    const settle = (result: GatewayConnectResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    socket.once("upgrade", (response: IncomingMessage) => {
      const protocol = Number(response.headers[GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]);
      const buildVersion = response.headers[GATEWAY_HANDSHAKE_HEADER.BUILD_VERSION];
      hostBuild = {
        protocolVersion: Number.isInteger(protocol) ? protocol : 0,
        buildVersion: (Array.isArray(buildVersion) ? buildVersion[0] : buildVersion) ?? "",
      };
    });
    socket.once("unexpected-response", (_request, response: IncomingMessage) => {
      const refusal = response.headers[GATEWAY_REFUSAL_HEADER];
      const named = Array.isArray(refusal) ? refusal[0] : refusal;
      response.resume();
      socket.terminate();
      settle({
        ok: false,
        failure: isRefusal(named) ? named : GATEWAY_CONNECT_FAILURE.UNREACHABLE,
      });
    });
    socket.once("error", () => {
      settle({ ok: false, failure: GATEWAY_CONNECT_FAILURE.UNREACHABLE });
    });
    socket.once("open", () => {
      settle({
        ok: true,
        connection: new LocalGatewayConnection(
          socket,
          hostBuild ?? { protocolVersion: 0, buildVersion: "" },
        ),
      });
    });
  });
}
