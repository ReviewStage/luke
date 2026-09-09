import type { MaybePromise } from "@sidecar/runtime/vocabulary";
import {
  type IDisposable,
  isWireNumber,
  toDisposable,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  GATEWAY_RECONNECT_KIND,
  type GatewayClientIdentity,
  type GatewayError,
  type GatewayErrorCode,
  type GatewayEvent,
  type GatewayEventKind,
  type GatewayMethod,
  type GatewayReconnectAnswer,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayRevision,
  isMutatingGatewayMethod,
} from "./protocol.js";
import type { GatewayHostConnection } from "./transport.js";

/** What one method answers: a result, or a typed error the envelope carries back. */
export type GatewayMethodOutcome =
  | { ok: true; result?: WireValue }
  | { ok: false; error: GatewayError };

export function gatewayOk(result?: WireValue): GatewayMethodOutcome {
  return { ok: true, ...(result !== undefined ? { result } : undefined) };
}

export function gatewayError(code: GatewayErrorCode, message: string): GatewayMethodOutcome {
  return { ok: false, error: { code, message } };
}

export interface GatewayMethodContext {
  client: GatewayClientIdentity;
  request: GatewayRequest;
  /** The connection the request arrived on, when the transport can be asked back through it; a node registers against this. */
  connection?: GatewayHostConnection;
}

export type GatewayMethodHandler = (
  params: WireRecord,
  context: GatewayMethodContext,
) => MaybePromise<GatewayMethodOutcome>;

export type GatewayMethodTable = Partial<Record<GatewayMethod, GatewayMethodHandler>>;

export interface GatewayServerOptions {
  methods: GatewayMethodTable;
  /** The configuration revision that stands now. */
  configurationRevision: () => number;
  /** The lifetime a conversation stands in now, or nothing for one the host does not hold. */
  sessionRevision: (sessionKey: string) => string | undefined;
  /** The whole state a client should adopt when the replay window has moved past what it saw. */
  snapshot: () => WireValue;
  /** Whether a client of this identity may call the method; the operator may call everything by default. */
  authorize?: (client: GatewayClientIdentity, method: GatewayMethod) => boolean;
  now: () => number;
  createEventId: () => string;
  /** How many events the replay window keeps; a reconnect from further back is answered with a snapshot. */
  replayWindow?: number;
  /** How many idempotent answers are remembered per method before the oldest go. */
  idempotencyCapacity?: number;
}

export const GATEWAY_SERVER_DEFAULTS = {
  REPLAY_WINDOW: 500,
  IDEMPOTENCY_CAPACITY: 1_000,
} as const;

interface IdempotentAnswer {
  paramsText: string;
  answer: Promise<GatewayMethodOutcome>;
}

export type GatewayEventListener = (event: GatewayEvent) => void;

/** The methods a node may call: to offer itself and to be told what it owes; everything else is the operator's. */
const NODE_METHODS: ReadonlySet<GatewayMethod> = new Set<GatewayMethod>([
  GATEWAY_METHOD.HELLO,
  GATEWAY_METHOD.RECONNECT,
  GATEWAY_METHOD.NODE_REGISTER,
  GATEWAY_METHOD.NODE_UNREGISTER,
]);

/**
 * The host's side of the protocol, over whatever transport carries it. It
 * owns three things no method handler should: the idempotency ledger, so a
 * retried mutation finds the first answer and a retry with other words is
 * refused rather than guessed at; the revision checks, so a request built
 * over a lifetime or configuration since replaced is refused before its
 * handler runs; and the event log, numbered from one, with a bounded window a
 * reconnecting client is replayed from, or handed a snapshot when it has
 * fallen behind the window. The handlers themselves are the host's, injected
 * whole; the server reads nothing inside a result.
 */
export class GatewayServer {
  readonly #options: GatewayServerOptions;
  /** The host's handlers, with the two the protocol itself answers: hello and reconnect are the server's own. */
  readonly #methods: GatewayMethodTable;
  readonly #idempotent = new Map<GatewayMethod, Map<string, IdempotentAnswer>>();
  readonly #events: GatewayEvent[] = [];
  readonly #listeners = new Set<GatewayEventListener>();
  #sequence = 0;
  #admitting = true;

  constructor(options: GatewayServerOptions) {
    this.#options = options;
    this.#methods = {
      ...options.methods,
      [GATEWAY_METHOD.HELLO]: () => gatewayOk(this.#hello()),
      [GATEWAY_METHOD.RECONNECT]: (params) => this.#reconnectOutcome(params),
    };
  }

  sequence(): number {
    return this.#sequence;
  }

  /**
   * Closes the door to new work: every mutating method but the dispose
   * itself answers shutting-down from here on, while reads, hellos, and
   * reconnections still answer, so a client can see the host leaving rather
   * than lose it. Nothing under way is touched; that is the coordinator's.
   */
  closeAdmissions(): void {
    this.#admitting = false;
  }

  revision(): GatewayRevision {
    return { configuration: this.#options.configurationRevision(), sequence: this.#sequence };
  }

  async handle(
    request: GatewayRequest,
    client: GatewayClientIdentity,
    connection?: GatewayHostConnection,
  ): Promise<GatewayResponse> {
    const refused = this.#admit(request, client);
    if (refused) return this.#respond(request.id, refused);
    const handler = this.#methods[request.method];
    if (!handler) {
      return this.#respond(
        request.id,
        gatewayError(GATEWAY_ERROR.UNKNOWN_METHOD, `no handler stands for ${request.method}`),
      );
    }
    const outcome = await this.#answer(request, client, handler, connection);
    return this.#respond(request.id, outcome);
  }

  /** Appends one event to the log and hands it to every listener, numbered as the next in sequence. */
  emit(
    kind: GatewayEventKind,
    payload: WireValue,
    identity: { sessionKey?: string; runId?: string } = {},
  ): GatewayEvent {
    this.#sequence += 1;
    const event: GatewayEvent = {
      eventId: this.#options.createEventId(),
      sequence: this.#sequence,
      kind,
      at: this.#options.now(),
      ...(identity.sessionKey !== undefined ? { sessionKey: identity.sessionKey } : undefined),
      ...(identity.runId !== undefined ? { runId: identity.runId } : undefined),
      payload,
    };
    this.#events.push(event);
    const window = this.#options.replayWindow ?? GATEWAY_SERVER_DEFAULTS.REPLAY_WINDOW;
    if (this.#events.length > window) this.#events.splice(0, this.#events.length - window);
    for (const listener of [...this.#listeners]) listener(event);
    return event;
  }

  subscribe(listener: GatewayEventListener): IDisposable {
    this.#listeners.add(listener);
    return toDisposable(() => {
      this.#listeners.delete(listener);
    });
  }

  /**
   * What a client that last saw `lastSequence` is owed: the events after it
   * while the window still starts at or before the one after it, or a fresh
   * snapshot at the current sequence when the window has moved past.
   */
  reconnect(lastSequence: number): GatewayReconnectAnswer {
    if (lastSequence >= this.#sequence) {
      return { kind: GATEWAY_RECONNECT_KIND.REPLAY, events: [] };
    }
    const oldest = this.#events[0]?.sequence;
    if (oldest === undefined || oldest > lastSequence + 1) {
      return {
        kind: GATEWAY_RECONNECT_KIND.SNAPSHOT,
        sequence: this.#sequence,
        snapshot: this.#options.snapshot(),
      };
    }
    return {
      kind: GATEWAY_RECONNECT_KIND.REPLAY,
      events: this.#events.filter((event) => event.sequence > lastSequence),
    };
  }

  #hello(): WireValue {
    return {
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      sequence: this.#sequence,
      configurationRevision: this.#options.configurationRevision(),
      snapshot: this.#options.snapshot(),
    };
  }

  #reconnectOutcome(params: WireRecord): GatewayMethodOutcome {
    if (!isWireNumber(params.lastSequence) || params.lastSequence < 0) {
      return gatewayError(GATEWAY_ERROR.INVALID_PARAMS, "lastSequence must be a whole number");
    }
    const answer = this.reconnect(params.lastSequence);
    return gatewayOk(
      answer.kind === GATEWAY_RECONNECT_KIND.REPLAY
        ? { kind: answer.kind, events: answer.events.map(eventToWire) }
        : { kind: answer.kind, sequence: answer.sequence, snapshot: answer.snapshot },
    );
  }

  #admit(request: GatewayRequest, client: GatewayClientIdentity): GatewayMethodOutcome | undefined {
    if (request.protocolVersion !== GATEWAY_PROTOCOL_VERSION) {
      return gatewayError(
        GATEWAY_ERROR.UNSUPPORTED_VERSION,
        `this host speaks protocol ${GATEWAY_PROTOCOL_VERSION}`,
      );
    }
    const allowed = this.#options.authorize
      ? this.#options.authorize(client, request.method)
      : client.role === GATEWAY_CLIENT_ROLE.OPERATOR || NODE_METHODS.has(request.method);
    if (!allowed) {
      return gatewayError(
        GATEWAY_ERROR.UNAUTHORIZED,
        `${client.role} may not call ${request.method}`,
      );
    }
    if (
      !this.#admitting &&
      isMutatingGatewayMethod(request.method) &&
      request.method !== GATEWAY_METHOD.SHUTDOWN
    ) {
      return gatewayError(GATEWAY_ERROR.SHUTTING_DOWN, "the host is shutting down");
    }
    if (isMutatingGatewayMethod(request.method) && request.idempotencyKey === undefined) {
      return gatewayError(
        GATEWAY_ERROR.MISSING_IDEMPOTENCY_KEY,
        `${request.method} changes something and needs an idempotency key`,
      );
    }
    const expected = request.expectedRevision;
    if (expected?.configurationRevision !== undefined) {
      const standing = this.#options.configurationRevision();
      if (expected.configurationRevision !== standing) {
        return gatewayError(
          GATEWAY_ERROR.REVISION_MISMATCH,
          `configuration revision ${standing} stands, not ${expected.configurationRevision}`,
        );
      }
    }
    if (expected?.sessionKey !== undefined && expected.sessionRevision !== undefined) {
      const standing = this.#options.sessionRevision(expected.sessionKey);
      if (standing !== expected.sessionRevision) {
        return gatewayError(
          GATEWAY_ERROR.REVISION_MISMATCH,
          `the conversation's lifetime is not the one the request was built over`,
        );
      }
    }
    return undefined;
  }

  /**
   * Runs the handler once per idempotency key: a retry that lands while the
   * first is still deciding awaits the same decision, one that lands after
   * finds the answer kept, and one carrying other parameters under the same
   * key is a conflict, never a second effect.
   */
  #answer(
    request: GatewayRequest,
    client: GatewayClientIdentity,
    handler: GatewayMethodHandler,
    connection: GatewayHostConnection | undefined,
  ): Promise<GatewayMethodOutcome> {
    const run = () =>
      Promise.resolve()
        .then(() =>
          handler(request.params, {
            client,
            request,
            ...(connection ? { connection } : undefined),
          }),
        )
        .catch((error: Error) => gatewayError(GATEWAY_ERROR.INTERNAL, error.message));
    const key = request.idempotencyKey;
    if (key === undefined || !isMutatingGatewayMethod(request.method)) return run();
    const ledger = this.#idempotent.get(request.method) ?? new Map<string, IdempotentAnswer>();
    this.#idempotent.set(request.method, ledger);
    const paramsText = JSON.stringify(request.params);
    const held = ledger.get(key);
    if (held) {
      if (held.paramsText !== paramsText) {
        return Promise.resolve(
          gatewayError(
            GATEWAY_ERROR.IDEMPOTENCY_CONFLICT,
            "that idempotency key was already used with other parameters",
          ),
        );
      }
      return held.answer;
    }
    const answer = run();
    ledger.set(key, { paramsText, answer });
    const capacity =
      this.#options.idempotencyCapacity ?? GATEWAY_SERVER_DEFAULTS.IDEMPOTENCY_CAPACITY;
    if (ledger.size > capacity) {
      const oldest = ledger.keys().next().value;
      if (oldest !== undefined) ledger.delete(oldest);
    }
    return answer;
  }

  #respond(id: string, outcome: GatewayMethodOutcome): GatewayResponse {
    const revision = this.revision();
    return outcome.ok
      ? { id, ok: true, result: outcome.result, revision }
      : { id, ok: false, error: outcome.error, revision };
  }
}

export function eventToWire(event: GatewayEvent): WireRecord {
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    kind: event.kind,
    at: event.at,
    ...(event.sessionKey !== undefined ? { sessionKey: event.sessionKey } : undefined),
    ...(event.runId !== undefined ? { runId: event.runId } : undefined),
    payload: event.payload,
  };
}
