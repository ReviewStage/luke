import { isRecord, isWireNumber, type WireRecord, type WireValue } from "@sidecar/wire";
import { Deferred, Effect, Fiber, type Scope } from "effect";
import {
  GATEWAY_ERROR,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  GATEWAY_RECONNECT_KIND,
  type GatewayError,
  type GatewayEvent,
  type GatewayEventKind,
  type GatewayExpectedRevision,
  type GatewayMethod,
  type GatewayReconnectAnswer,
  type GatewayRequest,
  type GatewayResponse,
  gatewayReconnectAnswerFromWire,
  isMutatingGatewayMethod,
} from "./protocol.js";
import type { GatewayTransport } from "./transport.js";

export interface GatewayClientOptions {
  transport: GatewayTransport;
  createId: () => string;
  /** Adopts a whole snapshot the host handed back because the replay window had moved past what this client saw. */
  onSnapshot?: (snapshot: WireValue, sequence: number) => void;
  report?: (message: string) => void;
}

export interface GatewayCallOptions {
  /** The caller's own retry identifier for a mutation; minted here when the caller supplies none. */
  idempotencyKey?: string;
  expectedRevision?: GatewayExpectedRevision;
}

/** A call's answer as the client hands it on: the result, or the typed error. */
export type GatewayCallResult =
  | { ok: true; result: WireValue | undefined }
  | { ok: false; error: GatewayError };

export type GatewayClientEventListener = (event: GatewayEvent) => void;

/**
 * The client side of the protocol. It mints request ids, stamps the version,
 * supplies an idempotency key to every mutation the caller did not key
 * itself, and follows the event sequence: an event that does not follow the
 * last one by exactly one is a gap, and a gap is answered by asking the host
 * for a reconnection from the last sequence seen, which replays what was
 * missed or hands back a snapshot to adopt whole. Nothing is skipped
 * silently. The same reconnection runs when the transport comes back.
 *
 * Every verb is an effect its caller runs; what the client itself runs is
 * only the reconnection a gap opens, which is forked from the transport's
 * own synchronous event callback.
 */
export interface GatewayClient {
  lastSequence(): number;
  call(
    method: GatewayMethod,
    params?: WireRecord,
    options?: GatewayCallOptions,
  ): Effect.Effect<GatewayCallResult>;
  /** Hears every event of one kind, in sequence, after any gap has been filled. */
  on(kind: GatewayEventKind, listener: GatewayClientEventListener): () => void;
  onEvery(listener: GatewayClientEventListener): () => void;
  /**
   * Adopts the host now on the other side of the transport as a new stream:
   * a hello reads its sequence and its whole snapshot, the snapshot is handed
   * to the hook, and the cursor moves to that sequence whatever it was
   * before. A replaced host numbers its events from one again, so a cursor
   * carried over from the old host would drop every event of the new one
   * until it caught up; adopting fences that. Events arriving while the hello
   * is out are taken after it, and any at or below the adopted sequence are
   * already in the snapshot. Concurrent callers share one adoption.
   */
  adoptHost(): Effect.Effect<void>;
  /**
   * Asks the host for everything since the last sequence seen. Replayed
   * events are delivered in order as though they had never been missed; a
   * snapshot is adopted through the snapshot hook and the sequence moves to
   * where the host stands. Concurrent callers share one reconnection.
   */
  reconnect(): Effect.Effect<void>;
}

/**
 * Builds one client in the caller's own `Scope`: the subscription to the
 * transport's events is this scope's, and so is every reconnection the client
 * forks for itself, so closing the scope ends both and a client not listening
 * reconnects nothing.
 */
export function gatewayClient(
  options: GatewayClientOptions,
): Effect.Effect<GatewayClient, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    // The gap a synchronous event callback finds has to open its reconnection
    // on the stack that found it — the host is asked before the callback
    // returns — so the client runs it on the services its own scope was built
    // with rather than handing the work to the scheduler.
    const services = yield* Effect.context<never>();
    const listeners = new Map<GatewayEventKind, Set<GatewayClientEventListener>>();
    const everyListener = new Set<GatewayClientEventListener>();
    let lastSequence = 0;
    /**
     * Whether this client has a baseline in the host's numbering: adopted
     * from a hello, or established by hearing the host's very first event.
     * Without one, a gap is not something to replay — the window before it is
     * the host's past, offers and all, and a client that was not there for it
     * must take the host as it stands now rather than hear it again.
     */
    let baselined = false;
    /** The adoption or reconnection in flight, which concurrent callers wait on and whose settling drains what arrived meanwhile. */
    let standing: Deferred.Deferred<void> | undefined;
    /**
     * Which adoption or reconnection stands. Each begins a new generation and
     * every answer is checked against it when it lands, so a reply from a host
     * since replaced, or a reconnection the adoption superseded, installs
     * nothing.
     */
    let generation = 0;
    /** Events that arrived while a reconnection was in flight, taken again once it has settled. */
    const arrivedDuringReconnect: GatewayEvent[] = [];

    const deliver = (event: GatewayEvent): void => {
      lastSequence = event.sequence;
      for (const listener of [...(listeners.get(event.kind) ?? [])]) listener(event);
      for (const listener of [...everyListener]) listener(event);
    };

    const take = (event: GatewayEvent): void => {
      if (standing) {
        // Held until the adoption or reconnection settles, whatever its
        // number: during an adoption the cursor is the old host's, and an
        // event of the new host numbered below it is not stale, it is the
        // first of the new stream. Whether it is already in the answer is
        // decided after, against the adopted cursor.
        arrivedDuringReconnect.push(event);
        return;
      }
      if (event.sequence <= lastSequence) return;
      if (event.sequence !== lastSequence + 1) {
        // With a baseline, the gap is filled from the host's own log and the
        // event that showed it arrives inside the replay, in its place.
        // Without one, the host is adopted as it stands: nothing before this
        // client's arrival is replayed to it.
        // The fiber the run answers is registered against this client's own
        // scope, so closing the scope ends a reconnection still in flight;
        // the fiber itself is nobody's to await.
        Fiber.runIn(Effect.runForkWith(services)(baselined ? reconnect() : adoptHost()), scope);
        return;
      }
      baselined = true;
      deliver(event);
    };

    /** The adoption or reconnection that stood is over: what arrived meanwhile is taken now, in order. */
    const settle = (which: Deferred.Deferred<void>): Effect.Effect<void> =>
      Effect.sync(() => {
        if (standing === which) {
          standing = undefined;
          const arrived = arrivedDuringReconnect.splice(0).sort((a, b) => a.sequence - b.sequence);
          for (const event of arrived) take(event);
        }
        Deferred.doneUnsafe(which, Effect.void);
      });

    const adopt = (answer: GatewayReconnectAnswer): void => {
      if (answer.kind === GATEWAY_RECONNECT_KIND.SNAPSHOT) {
        lastSequence = answer.sequence;
        options.onSnapshot?.(answer.snapshot, answer.sequence);
        return;
      }
      for (const event of answer.events) {
        if (event.sequence <= lastSequence) continue;
        deliver(event);
      }
    };

    const adoptHostOnce = (asked: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const response = yield* options.transport.request({
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          id: options.createId(),
          method: GATEWAY_METHOD.HELLO,
          params: {},
        });
        if (asked !== generation) return;
        if (!response.ok) {
          if (response.error.code !== GATEWAY_ERROR.DISCONNECTED) {
            options.report?.(`Gateway hello refused: ${response.error.message}`);
          }
          return;
        }
        const sequence = helloSequence(response.result);
        if (sequence === undefined || !isRecord(response.result)) {
          options.report?.("Gateway hello answered in a shape this client cannot read");
          return;
        }
        lastSequence = sequence;
        baselined = true;
        options.onSnapshot?.(response.result.snapshot ?? {}, sequence);
      });

    const reconnectOnce = (asked: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const response = yield* options.transport.request({
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          id: options.createId(),
          method: GATEWAY_METHOD.RECONNECT,
          params: { lastSequence },
        });
        if (asked !== generation) return;
        if (!response.ok) {
          if (response.error.code !== GATEWAY_ERROR.DISCONNECTED) {
            options.report?.(`Gateway reconnection refused: ${response.error.message}`);
          }
          return;
        }
        const answer = gatewayReconnectAnswerFromWire(response.result);
        if (!answer) {
          options.report?.("Gateway reconnection answered in a shape this client cannot read");
          return;
        }
        adopt(answer);
      });

    const begin = (once: (asked: number) => Effect.Effect<void>): Effect.Effect<void> => {
      generation += 1;
      const asked = generation;
      const deferred = Deferred.makeUnsafe<void>();
      standing = deferred;
      return Effect.ensuring(once(asked), settle(deferred));
    };

    const adoptHost = (): Effect.Effect<void> =>
      // An adoption supersedes a reconnection still out: that one was asked of
      // the host this client is leaving, and its answer, whenever it lands,
      // installs nothing.
      Effect.suspend(() => begin(adoptHostOnce));

    const reconnect = (): Effect.Effect<void> =>
      Effect.suspend(() => (standing ? Deferred.await(standing) : begin(reconnectOnce)));

    const unsubscribe = options.transport.events(take);
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

    return {
      lastSequence: () => lastSequence,
      call: (method, params = {}, callOptions = {}) =>
        Effect.map(
          Effect.suspend(() => {
            const request: GatewayRequest = {
              protocolVersion: GATEWAY_PROTOCOL_VERSION,
              id: options.createId(),
              method,
              params,
              ...(isMutatingGatewayMethod(method)
                ? { idempotencyKey: callOptions.idempotencyKey ?? options.createId() }
                : callOptions.idempotencyKey !== undefined
                  ? { idempotencyKey: callOptions.idempotencyKey }
                  : undefined),
              ...(callOptions.expectedRevision
                ? { expectedRevision: callOptions.expectedRevision }
                : undefined),
            };
            return options.transport.request(request);
          }),
          unwrapResponse,
        ),
      on: (kind, listener) => {
        const held = listeners.get(kind) ?? new Set<GatewayClientEventListener>();
        held.add(listener);
        listeners.set(kind, held);
        return () => {
          held.delete(listener);
        };
      },
      onEvery: (listener) => {
        everyListener.add(listener);
        return () => {
          everyListener.delete(listener);
        };
      },
      adoptHost,
      reconnect,
    };
  });
}

/** The answer of a `gateway.hello`, read for the sequence the client should start following from. */
export function helloSequence(result: WireValue | undefined): number | undefined {
  return isRecord(result) && isWireNumber(result.sequence) ? result.sequence : undefined;
}

export function unwrapResponse(response: GatewayResponse): GatewayCallResult {
  return response.ok ? { ok: true, result: response.result } : { ok: false, error: response.error };
}
