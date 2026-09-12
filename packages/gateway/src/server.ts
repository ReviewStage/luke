import { type Rpc, type RpcGroup, RpcMiddleware, RpcSerialization, RpcServer } from "@effect/rpc";
import { constEof, type FromClientEncoded } from "@effect/rpc/RpcMessage";
import {
  isRecord,
  isWireNumber,
  isWireString,
  valueFromJsonText,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import {
  Cache,
  Chunk,
  Context,
  Deferred,
  Duration,
  Effect,
  type Either,
  Equal,
  Hash,
  HashMap,
  Layer,
  Mailbox,
  MutableRef,
  Option,
  PubSub,
  Ref,
  type Runtime,
  type Scope,
  Stream,
} from "effect";
import type { GatewayMethodHandler, GatewayMethodTable } from "./methods.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_METHOD,
  GATEWAY_METHOD_ENTRIES,
  GATEWAY_PROTOCOL_VERSION,
  GATEWAY_RECONNECT_KIND,
  type GatewayClientIdentity,
  type GatewayEvent,
  type GatewayEventKind,
  type GatewayMethod,
  type GatewayReconnectAnswer,
  type GatewayRefusal,
  GatewayRefusalSchema,
  type GatewayRevision,
  gatewayEventToWire,
  gatewayRefusal,
  gatewayResponseToWire,
  gatewayVersionRefusal,
  IdempotencyConflictRefusal,
  InternalRefusal,
  InvalidParamsRefusal,
  isGatewayMethod,
  MissingIdempotencyKeyRefusal,
  RevisionMismatchRefusal,
  ShuttingDownRefusal,
  UnauthorizedRefusal,
  UnknownMethodRefusal,
} from "./protocol.js";
import {
  GatewayRpcs,
  gatewayEnvelopeSerialization,
  gatewayHeaderFields,
  gatewayRpcMutates,
  readRpcRequestMessage,
} from "./rpc.js";
import type { GatewayHostConnection } from "./transport.js";

/**
 * The host's side of the protocol: an `RpcServer` over the one group, with
 * the three things no method handler should own as parts of the server
 * itself. The idempotency ledger is a middleware, so a retried mutation finds
 * the first answer, a retry still deciding joins that decision, and a retry
 * with other words is refused rather than guessed at; the revision checks are
 * a middleware, so a request built over a lifetime or configuration since
 * replaced is refused before its handler runs; and the event log is a bounded
 * ring beside a stream, numbered from one, with a window a reconnecting
 * client is replayed from or handed a snapshot when it has fallen behind.
 * The handlers themselves are the host's, injected whole; the server reads
 * nothing inside a result. Who is asking is read from the registry the
 * transport filled at the connection's own authenticated handshake, never
 * from a request's headers, which a client writes.
 */

/** A client the transport admitted: its authenticated identity, and the connection it can be asked back through. */
export interface GatewayConnectedClient {
  readonly identity: GatewayClientIdentity;
  readonly connection?: GatewayHostConnection;
}

/**
 * The connected clients by the number the Rpc runtime knows each one as. A
 * transport registers a client here once its handshake has decided who is
 * asking, and the admission middleware and every handler read the identity
 * back from this number and nowhere else.
 */
export class GatewayClients extends Context.Tag("@sidecar/gateway/GatewayClients")<
  GatewayClients,
  {
    readonly connect: (client: GatewayConnectedClient) => Effect.Effect<number>;
    readonly disconnect: (clientId: number) => Effect.Effect<void>;
    readonly client: (clientId: number) => Effect.Effect<Option.Option<GatewayConnectedClient>>;
    readonly clientIds: Effect.Effect<ReadonlySet<number>>;
  }
>() {}

const makeGatewayClients: Effect.Effect<GatewayClients["Type"]> = Effect.gen(function* () {
  const held = yield* Ref.make(HashMap.empty<number, GatewayConnectedClient>());
  const minted = yield* Ref.make(0);
  return GatewayClients.of({
    connect: (client) =>
      Effect.flatMap(
        Ref.updateAndGet(minted, (count) => count + 1),
        (clientId) => Effect.as(Ref.update(held, HashMap.set(clientId, client)), clientId),
      ),
    disconnect: (clientId) => Ref.update(held, HashMap.remove(clientId)),
    client: (clientId) => Effect.map(Ref.get(held), HashMap.get(clientId)),
    clientIds: Effect.map(Ref.get(held), (clients) => new Set(HashMap.keys(clients))),
  });
});

export const layerGatewayClients: Layer.Layer<GatewayClients> = Layer.effect(
  GatewayClients,
  makeGatewayClients,
);

/** Whether the host still admits new work; closed at the quit, so every mutation but the shutdown itself is refused from then on. */
export class GatewayAdmissions extends Context.Tag("@sidecar/gateway/GatewayAdmissions")<
  GatewayAdmissions,
  { readonly admitting: Effect.Effect<boolean>; readonly close: Effect.Effect<void> }
>() {}

const makeGatewayAdmissions: Effect.Effect<GatewayAdmissions["Type"]> = Effect.map(
  Ref.make(true),
  (admitting) =>
    GatewayAdmissions.of({ admitting: Ref.get(admitting), close: Ref.set(admitting, false) }),
);

export const layerGatewayAdmissions: Layer.Layer<GatewayAdmissions> = Layer.effect(
  GatewayAdmissions,
  makeGatewayAdmissions,
);

const GATEWAY_SERVER_DEFAULTS = {
  REPLAY_WINDOW: 500,
  IDEMPOTENCY_CAPACITY: 1_000,
} as const;

export interface GatewayEventLogOptions {
  /** The configuration revision that stands now. */
  configurationRevision: () => number;
  /** The whole state a client should adopt when the replay window has moved past what it saw. */
  snapshot: () => WireValue;
  now: () => number;
  createEventId: () => string;
  /** How many events the replay window keeps; a reconnect from further back is answered with a snapshot. The newest event is always kept, since the ring is where the sequence is read from, so a window below one keeps that one. */
  replayWindow?: number;
}

/** What an in-process transport hands each event to, on the tick the host emitted it. */
export type GatewayEventListener = (event: GatewayEvent) => void;

/**
 * The event log: a ring of the newest events, bounded to the replay window,
 * and the stream every transport delivers from. The sequence is the newest
 * event's own number, so the ring is the one record of where the log stands,
 * and the ring is a `MutableRef` rather than a `Ref`, because two readers of
 * it are plain functions: the envelope serialization stamps an answer's
 * revision inside its encoder, which the Rpc runtime calls as one, and the
 * host reports a change from a collaborator's own synchronous callback.
 */
export class GatewayEventLog extends Context.Tag("@sidecar/gateway/GatewayEventLog")<
  GatewayEventLog,
  {
    /**
     * Appends one event, numbered as the next in sequence, and hands it to
     * every stream and every listener before answering: the append itself,
     * for a caller that is a collaborator's synchronous callback rather than
     * a fiber, so an in-process transport delivers it on the tick the host
     * reported the change.
     */
    readonly publish: (
      kind: GatewayEventKind,
      payload: WireValue,
      identity?: { sessionKey?: string; runId?: string },
    ) => GatewayEvent;
    /** The same append, for a caller that is already an effect. */
    readonly emit: (
      kind: GatewayEventKind,
      payload: WireValue,
      identity?: { sessionKey?: string; runId?: string },
    ) => Effect.Effect<GatewayEvent>;
    /**
     * What a client that last saw `lastSequence` is owed: the events after it
     * while the window still starts at or before the one after it, or a fresh
     * snapshot at the current sequence when the window has moved past.
     */
    readonly replayFrom: (lastSequence: number) => Effect.Effect<GatewayReconnectAnswer>;
    readonly sequence: Effect.Effect<number>;
    /** The events from the moment of subscribing on, so a transport that subscribes before it reads misses none. */
    readonly events: Effect.Effect<Stream.Stream<GatewayEvent>, never, Scope.Scope>;
    readonly revision: () => GatewayRevision;
    /**
     * Hands every event from here on to this listener on the tick it is
     * emitted, beside the stream: an in-process transport delivers to a
     * client's own callback in the turn the host emitted, which a stream
     * read by a fiber of its own could not.
     */
    readonly listen: (listener: GatewayEventListener) => () => void;
  }
>() {}

function newestSequence(events: Chunk.Chunk<GatewayEvent>): number {
  return Option.match(Chunk.last(events), {
    onNone: () => 0,
    onSome: (newest) => newest.sequence,
  });
}

function makeGatewayEventLog(
  options: GatewayEventLogOptions,
): Effect.Effect<GatewayEventLog["Type"]> {
  return Effect.gen(function* () {
    const window = Math.max(1, options.replayWindow ?? GATEWAY_SERVER_DEFAULTS.REPLAY_WINDOW);
    const ring = MutableRef.make(Chunk.empty<GatewayEvent>());
    const bus = yield* PubSub.unbounded<GatewayEvent>();
    const listeners = new Set<GatewayEventListener>();
    const publish = (
      kind: GatewayEventKind,
      payload: WireValue,
      identity: { sessionKey?: string; runId?: string } = {},
    ): GatewayEvent => {
      const events = MutableRef.get(ring);
      const emitted: GatewayEvent = {
        eventId: options.createEventId(),
        sequence: newestSequence(events) + 1,
        kind,
        at: options.now(),
        ...(identity.sessionKey !== undefined ? { sessionKey: identity.sessionKey } : undefined),
        ...(identity.runId !== undefined ? { runId: identity.runId } : undefined),
        payload,
      };
      MutableRef.set(ring, Chunk.takeRight(Chunk.append(events, emitted), window));
      // The unbounded bus takes every event, so the offer is the publish an
      // effect would have awaited, made where the caller is not a fiber.
      bus.unsafeOffer(emitted);
      for (const listener of [...listeners]) listener(emitted);
      return emitted;
    };
    return GatewayEventLog.of({
      publish,
      emit: (kind, payload, identity) => Effect.sync(() => publish(kind, payload, identity)),
      replayFrom: (lastSequence) =>
        Effect.sync(() => {
          const events = MutableRef.get(ring);
          const sequence = newestSequence(events);
          if (lastSequence >= sequence) {
            return { kind: GATEWAY_RECONNECT_KIND.REPLAY, events: [] };
          }
          const oldest = Option.map(Chunk.head(events), (first) => first.sequence);
          if (Option.isNone(oldest) || oldest.value > lastSequence + 1) {
            return {
              kind: GATEWAY_RECONNECT_KIND.SNAPSHOT,
              sequence,
              snapshot: options.snapshot(),
            };
          }
          return {
            kind: GATEWAY_RECONNECT_KIND.REPLAY,
            events: Chunk.toReadonlyArray(
              Chunk.filter(events, (event) => event.sequence > lastSequence),
            ),
          };
        }),
      sequence: Effect.sync(() => newestSequence(MutableRef.get(ring))),
      events: Stream.fromPubSub(bus, { scoped: true }),
      revision: () => ({
        configuration: options.configurationRevision(),
        sequence: newestSequence(MutableRef.get(ring)),
      }),
      listen: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    });
  });
}

export function layerGatewayEventLog(
  options: GatewayEventLogOptions,
): Layer.Layer<GatewayEventLog> {
  return Layer.effect(GatewayEventLog, makeGatewayEventLog(options));
}

/**
 * The three middlewares, in the order a request meets them: admission (the
 * protocol version, who may call what, the closed door, and the key a
 * mutation must carry), the revision checks, and the ledger, which wraps the
 * handler so it can answer from what it remembers instead of running it.
 * Each fails with the refusal family the envelope already carries.
 */
export class GatewayAdmission extends RpcMiddleware.Tag<GatewayAdmission>()(
  "@sidecar/gateway/GatewayAdmission",
  { failure: GatewayRefusalSchema },
) {}

export class GatewayRevisionCheck extends RpcMiddleware.Tag<GatewayRevisionCheck>()(
  "@sidecar/gateway/GatewayRevisionCheck",
  { failure: GatewayRefusalSchema },
) {}

export class GatewayLedger extends RpcMiddleware.Tag<GatewayLedger>()(
  "@sidecar/gateway/GatewayLedger",
  { failure: GatewayRefusalSchema, wrap: true },
) {}

/**
 * The group as the server answers it. Middlewares apply innermost first, so
 * the ledger is added first and admission last: a request is admitted, then
 * checked against the revisions it named, then looked up in the ledger, and
 * only then does its handler run.
 */
export const GatewayServerRpcs = GatewayRpcs.middleware(GatewayLedger)
  .middleware(GatewayRevisionCheck)
  .middleware(GatewayAdmission);

type GatewayServerRpc = RpcGroup.Rpcs<typeof GatewayServerRpcs>;

/** The methods a node may call: to offer itself and to be told what it owes; everything else is the operator's. */
const NODE_METHODS: ReadonlySet<GatewayMethod> = new Set<GatewayMethod>([
  GATEWAY_METHOD.HELLO,
  GATEWAY_METHOD.RECONNECT,
  GATEWAY_METHOD.NODE_REGISTER,
  GATEWAY_METHOD.NODE_UNREGISTER,
]);

export interface GatewayServerLayerOptions extends GatewayEventLogOptions {
  methods: GatewayMethodTable;
  /** The lifetime a conversation stands in now, or nothing for one the host does not hold. */
  sessionRevision: (sessionKey: string) => string | undefined;
  /** Whether a client of this identity may call the method; the operator may call everything by default. */
  authorize?: (client: GatewayClientIdentity, method: GatewayMethod) => boolean;
  /** How many idempotent answers are remembered per method before the least recently asked go. */
  idempotencyCapacity?: number;
}

/** The method an Rpc of the group names; one outside the vocabulary was never in the group and is refused as unknown. */
function methodOf(rpc: Rpc.AnyWithProps): Effect.Effect<GatewayMethod, UnknownMethodRefusal> {
  return isGatewayMethod(rpc._tag)
    ? Effect.succeed(rpc._tag)
    : Effect.fail(new UnknownMethodRefusal({ message: `no handler stands for ${rpc._tag}` }));
}

/** The flag the method's own entry declared; an Rpc carrying none is not the protocol's, and the server does not guess for it. */
function mutates(rpc: Rpc.AnyWithProps): boolean {
  return Option.getOrThrowWith(
    gatewayRpcMutates(rpc),
    () => new Error(`${rpc._tag} carries no mutates annotation`),
  );
}

function layerGatewayAdmission(
  options: GatewayServerLayerOptions,
): Layer.Layer<GatewayAdmission, never, GatewayClients | GatewayAdmissions> {
  return Layer.effect(
    GatewayAdmission,
    Effect.gen(function* () {
      const clients = yield* GatewayClients;
      const admissions = yield* GatewayAdmissions;
      return GatewayAdmission.of(({ clientId, rpc, headers }) =>
        Effect.gen(function* () {
          const fields = gatewayHeaderFields(Object.entries(headers));
          const version = gatewayVersionRefusal(fields.protocolVersion);
          if (Option.isSome(version)) return yield* Effect.fail(version.value);
          const method = yield* methodOf(rpc);
          const client = yield* clients.client(clientId);
          if (Option.isNone(client)) {
            return yield* Effect.fail(
              new UnauthorizedRefusal({
                message: "no admitted connection stands behind the request",
              }),
            );
          }
          const role = client.value.identity.role;
          const allowed = options.authorize
            ? options.authorize(client.value.identity, method)
            : role === GATEWAY_CLIENT_ROLE.OPERATOR || NODE_METHODS.has(method);
          if (!allowed) {
            return yield* Effect.fail(
              new UnauthorizedRefusal({ message: `${role} may not call ${method}` }),
            );
          }
          const changes = mutates(rpc);
          if (changes && method !== GATEWAY_METHOD.SHUTDOWN && !(yield* admissions.admitting)) {
            return yield* Effect.fail(
              new ShuttingDownRefusal({ message: "the host is shutting down" }),
            );
          }
          if (changes && fields.idempotencyKey === undefined) {
            return yield* Effect.fail(
              new MissingIdempotencyKeyRefusal({
                message: `${method} changes something and needs an idempotency key`,
              }),
            );
          }
        }),
      );
    }),
  );
}

function layerGatewayRevisionCheck(
  options: GatewayServerLayerOptions,
): Layer.Layer<GatewayRevisionCheck> {
  return Layer.succeed(
    GatewayRevisionCheck,
    GatewayRevisionCheck.of(({ headers }) =>
      Effect.suspend(() => {
        const expected = gatewayHeaderFields(Object.entries(headers)).expectedRevision;
        if (expected?.configurationRevision !== undefined) {
          const standing = options.configurationRevision();
          if (expected.configurationRevision !== standing) {
            return Effect.fail(
              new RevisionMismatchRefusal({
                message: `configuration revision ${standing} stands, not ${expected.configurationRevision}`,
              }),
            );
          }
        }
        if (expected?.sessionKey !== undefined && expected.sessionRevision !== undefined) {
          const standing = options.sessionRevision(expected.sessionKey);
          if (standing !== expected.sessionRevision) {
            return Effect.fail(
              new RevisionMismatchRefusal({
                message: "the conversation's lifetime is not the one the request was built over",
              }),
            );
          }
        }
        return Effect.void;
      }),
    ),
  );
}

type LedgerRun = Effect.Effect<RpcMiddleware.SuccessValue, GatewayRefusal>;

interface LedgerAnswer {
  readonly paramsText: string;
  readonly answer: Either.Either<RpcMiddleware.SuccessValue, GatewayRefusal>;
}

/**
 * One asked mutation as the ledger's cache keys it. The cache's lookup is
 * fixed when the cache is made, so the key carries the request's own work and
 * the parameters it was asked with, while equality and hashing read the
 * idempotency key alone: a retry is the same key however it was worded, and
 * the wording is compared once the one answer stands.
 */
class LedgerEntry implements Equal.Equal {
  constructor(
    readonly key: string,
    readonly paramsText: string,
    readonly run: LedgerRun,
  ) {}

  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof LedgerEntry && that.key === this.key;
  }

  [Hash.symbol](): number {
    return Hash.string(this.key);
  }
}

type LedgerCache = Cache.Cache<LedgerEntry, LedgerAnswer>;

/**
 * The ledger remembers answers: a success or a typed refusal is held under
 * its key, and so is a handler's defect, since a mutation that fell over may
 * have half happened and a retry must not run it again. An interruption is
 * not an answer, so it propagates and the cache drops the key, and the retry
 * runs the mutation.
 */
export function layerGatewayLedger(options: GatewayServerLayerOptions): Layer.Layer<GatewayLedger> {
  return Layer.effect(
    GatewayLedger,
    Effect.gen(function* () {
      const capacity = options.idempotencyCapacity ?? GATEWAY_SERVER_DEFAULTS.IDEMPOTENCY_CAPACITY;
      const ledgers = new Map<GatewayMethod, LedgerCache>();
      for (const entry of GATEWAY_METHOD_ENTRIES) {
        if (!entry.mutates) continue;
        ledgers.set(
          entry.name,
          yield* Cache.make({
            capacity,
            timeToLive: Duration.infinity,
            lookup: (asked: LedgerEntry) =>
              Effect.map(Effect.either(asked.run), (answer) => ({
                paramsText: asked.paramsText,
                answer,
              })),
          }),
        );
      }
      return GatewayLedger.of(({ rpc, payload, headers, next }) => {
        const key = gatewayHeaderFields(Object.entries(headers)).idempotencyKey;
        const ledger = isGatewayMethod(rpc._tag) ? ledgers.get(rpc._tag) : undefined;
        if (key === undefined || ledger === undefined) return next;
        const paramsText = JSON.stringify(payload);
        return Effect.flatMap(ledger.get(new LedgerEntry(key, paramsText, next)), (held) =>
          held.paramsText === paramsText
            ? held.answer
            : Effect.fail(
                new IdempotencyConflictRefusal({
                  message: "that idempotency key was already used with other parameters",
                }),
              ),
        );
      });
    }),
  );
}

/**
 * A result as the wire carries it: a handler answers the structured value it
 * already holds, in which a field may stand undefined, and JSON drops such a
 * field on the way out, so the same round trip here hands the Rpc runtime
 * exactly what a socket would have carried.
 */
function carriedResult(result: WireValue | undefined): WireValue | undefined {
  return result === undefined ? undefined : valueFromJsonText(JSON.stringify(result));
}

function readLastSequence(params: WireRecord): Effect.Effect<number, InvalidParamsRefusal> {
  const lastSequence = params.lastSequence;
  return isWireNumber(lastSequence) && lastSequence >= 0
    ? Effect.succeed(lastSequence)
    : Effect.fail(new InvalidParamsRefusal({ message: "lastSequence must be a whole number" }));
}

/**
 * The handlers: the host's methods, with the two the protocol itself answers
 * (hello and reconnect are the server's own), and a typed unknown-method
 * refusal for every method of the group the host has no handler for, so no
 * request reaches the Rpc runtime's own defect for a tag without a handler.
 */
function layerGatewayMethods(
  options: GatewayServerLayerOptions,
): Layer.Layer<Rpc.ToHandler<GatewayServerRpc>, never, GatewayEventLog | GatewayClients> {
  return Layer.unwrapEffect(
    Effect.gen(function* () {
      const log = yield* GatewayEventLog;
      const clients = yield* GatewayClients;
      const hello: GatewayMethodHandler = () =>
        Effect.map(log.sequence, (sequence) => ({
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          sequence,
          configurationRevision: options.configurationRevision(),
          snapshot: options.snapshot(),
        }));
      const reconnect: GatewayMethodHandler = (params) =>
        Effect.flatMap(readLastSequence(params), (lastSequence) =>
          Effect.map(log.replayFrom(lastSequence), (answer) =>
            answer.kind === GATEWAY_RECONNECT_KIND.REPLAY
              ? { kind: answer.kind, events: answer.events.map(gatewayEventToWire) }
              : { kind: answer.kind, sequence: answer.sequence, snapshot: answer.snapshot },
          ),
        );
      const methods: GatewayMethodTable = {
        ...options.methods,
        [GATEWAY_METHOD.HELLO]: hello,
        [GATEWAY_METHOD.RECONNECT]: reconnect,
      };
      const handlerFor = (method: GatewayMethod) => {
        const handler = methods[method];
        return (
          payload: WireRecord,
          asked: { readonly clientId: number; readonly headers: Readonly<Record<string, string>> },
        ): Effect.Effect<WireValue | undefined, GatewayRefusal> =>
          Effect.gen(function* () {
            if (!handler) {
              return yield* Effect.fail(
                new UnknownMethodRefusal({ message: `no handler stands for ${method}` }),
              );
            }
            const client = yield* clients.client(asked.clientId);
            if (Option.isNone(client)) {
              return yield* Effect.fail(
                new UnauthorizedRefusal({
                  message: "no admitted connection stands behind the request",
                }),
              );
            }
            const connection = client.value.connection;
            const result = yield* handler(payload, {
              client: client.value.identity,
              request: {
                ...gatewayHeaderFields(Object.entries(asked.headers)),
                method,
                params: payload,
              },
              ...(connection ? { connection } : undefined),
            });
            return carriedResult(result);
          }).pipe(
            // A handler that throws rather than failing is the request's own
            // internal refusal, as it was when the table answered promises:
            // one method's defect refuses that request and no other.
            Effect.catchAllDefect((defect) =>
              Effect.fail(
                new InternalRefusal({
                  message: defect instanceof Error ? defect.message : String(defect),
                }),
              ),
            ),
          );
      };
      return GATEWAY_METHOD_ENTRIES.map((entry) =>
        GatewayServerRpcs.toLayerHandler(entry.name, handlerFor(entry.name)),
      ).reduce((all, layer) => Layer.merge(all, layer));
    }),
  );
}

/**
 * The server as a layer, transport-agnostic: everything `RpcServer.layer`
 * needs but the `Protocol` that carries the frames, which each transport
 * provides — the in-process protocol below today, a socket's later. The
 * event log, the client registry, and the admissions door are the layer's
 * inputs so the transport and whatever composes the host can hold them too.
 */
export function layerGatewayServer(
  options: GatewayServerLayerOptions,
): Layer.Layer<
  never,
  never,
  RpcServer.Protocol | GatewayEventLog | GatewayClients | GatewayAdmissions
> {
  return RpcServer.layer(GatewayServerRpcs, {
    disableTracing: true,
    disableFatalDefects: true,
  }).pipe(
    Layer.provide(layerGatewayMethods(options)),
    Layer.provide(layerGatewayAdmission(options)),
    Layer.provide(layerGatewayRevisionCheck(options)),
    Layer.provide(layerGatewayLedger(options)),
  );
}

/** One admitted in-process client: the door its frames enter through, and the close that ends it. */
export interface GatewayInProcessConnection {
  readonly clientId: number;
  /**
   * Carries one request envelope, as the text a socket would carry, and
   * answers the response envelope's text: the same serialization on both
   * sides, so what comes back is byte for byte what a socket would send.
   */
  readonly carry: (frame: string) => Effect.Effect<string>;
  /** Ends the client: what is under way still answers, and nothing new is taken. */
  readonly close: Effect.Effect<void>;
}

export class GatewayInProcessProtocol extends Context.Tag(
  "@sidecar/gateway/GatewayInProcessProtocol",
)<
  GatewayInProcessProtocol,
  {
    readonly connect: (client: GatewayConnectedClient) => Effect.Effect<GatewayInProcessConnection>;
  }
>() {}

interface InProcessClient {
  /** The envelope id each Rpc request id stands for, so an answer is echoed under the id the client wrote. */
  readonly wireIds: Map<string, string>;
  readonly pending: Map<string, Deferred.Deferred<string>>;
  next: number;
  ended: boolean;
}

function refusalFrame(
  id: string,
  code: (typeof GATEWAY_ERROR)[keyof typeof GATEWAY_ERROR],
  message: string,
): string {
  return JSON.stringify(gatewayResponseToWire(gatewayRefusal(id, code, message)));
}

/**
 * The transport this build ships, as the Rpc runtime's `Protocol`: the client
 * and the host in one process, every frame crossing as the text a socket
 * would carry. The Rpc runtime numbers requests itself, so each envelope's
 * own id is kept here against the number it was handed in under and written
 * back onto the answer, which is the one thing this seam does to a frame.
 */
const makeGatewayInProcessProtocol: Effect.Effect<
  {
    readonly protocol: RpcServer.Protocol["Type"];
    readonly inProcess: GatewayInProcessProtocol["Type"];
  },
  never,
  RpcSerialization.RpcSerialization | GatewayClients
> = Effect.gen(function* () {
  const parser = (yield* RpcSerialization.RpcSerialization).unsafeMake();
  const decoder = new TextDecoder();
  const clients = yield* GatewayClients;
  const disconnects = yield* Mailbox.make<number>();
  const held = new Map<number, InProcessClient>();

  const frameOf = (encoded: string | Uint8Array | undefined): string | undefined =>
    encoded instanceof Uint8Array ? decoder.decode(encoded) : encoded;

  const answer = (client: InProcessClient, requestId: string, frame: string) =>
    Effect.suspend(() => {
      const pending = client.pending.get(requestId);
      client.pending.delete(requestId);
      client.wireIds.delete(requestId);
      return pending ? Deferred.succeed(pending, frame) : Effect.void;
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
              const frame =
                frameOf(parser.encode({ ...response, requestId: wireId })) ??
                refusalFrame(wireId, GATEWAY_ERROR.INTERNAL, "the answer did not survive the wire");
              return answer(client, response.requestId, frame);
            }
            case "Defect": {
              // The runtime gave up on this client as a whole; every ask still open is answered rather than left hanging.
              return Effect.forEach(
                [...client.wireIds.entries()],
                ([requestId, wireId]) =>
                  answer(
                    client,
                    requestId,
                    refusalFrame(wireId, GATEWAY_ERROR.INTERNAL, "the host could not answer"),
                  ),
                { discard: true },
              );
            }
            default:
              return Effect.void;
          }
        }),
      end: (clientId) =>
        Effect.suspend(() => {
          const client = held.get(clientId);
          held.delete(clientId);
          // The runtime ends a client only once its fibers are done and their exits sent; an ask still open here is answered rather than left hanging.
          const abandoned = client
            ? Effect.forEach(
                [...client.wireIds.entries()],
                ([requestId, wireId]) =>
                  answer(
                    client,
                    requestId,
                    refusalFrame(wireId, GATEWAY_ERROR.DISCONNECTED, "the connection has closed"),
                  ),
                { discard: true },
              )
            : Effect.void;
          return Effect.zipRight(abandoned, clients.disconnect(clientId));
        }),
      clientIds: Effect.sync(() => new Set(held.keys())),
      initialMessage: Effect.succeedNone,
      supportsAck: false,
      supportsTransferables: false,
      supportsSpanPropagation: false,
    });
  });

  const connect = (admitted: GatewayConnectedClient) =>
    Effect.map(clients.connect(admitted), (clientId): GatewayInProcessConnection => {
      const client: InProcessClient = {
        wireIds: new Map(),
        pending: new Map(),
        next: 0,
        ended: false,
      };
      held.set(clientId, client);
      return {
        clientId,
        carry: (frame) =>
          Effect.gen(function* () {
            const requests = parser
              .decode(frame)
              .flatMap((message) => Option.toArray(readRpcRequestMessage(message)));
            const request = requests[0];
            if (!request || requests.length !== 1) {
              const value = valueFromJsonText(frame);
              const id = isRecord(value) && isWireString(value.id) ? value.id : "";
              return refusalFrame(
                id,
                GATEWAY_ERROR.INVALID_PARAMS,
                "the request is not one this host reads",
              );
            }
            if (client.ended) {
              return refusalFrame(
                request.id,
                GATEWAY_ERROR.DISCONNECTED,
                "the connection has closed",
              );
            }
            client.next += 1;
            const requestId = String(client.next);
            client.wireIds.set(requestId, request.id);
            const pending = yield* Deferred.make<string>();
            client.pending.set(requestId, pending);
            yield* write(clientId, {
              ...request,
              id: requestId,
              headers: request.headers.map(([name, value]) => [name, value]),
            });
            return yield* Deferred.await(pending);
          }),
        close: Effect.suspend(() => {
          if (client.ended) return Effect.void;
          client.ended = true;
          return write(clientId, constEof);
        }),
      };
    });

  return { protocol, inProcess: GatewayInProcessProtocol.of({ connect }) };
});

export const layerGatewayInProcessProtocol: Layer.Layer<
  RpcServer.Protocol | GatewayInProcessProtocol,
  never,
  RpcSerialization.RpcSerialization | GatewayClients
> = Layer.effectContext(
  Effect.map(makeGatewayInProcessProtocol, ({ protocol, inProcess }) =>
    Context.make(RpcServer.Protocol, protocol).pipe(
      Context.add(GatewayInProcessProtocol, inProcess),
    ),
  ),
);

/**
 * The whole host end in one process: the event log, the admissions door, and
 * the client registry the transports and the server share, the serialization
 * that stamps an answer with the log's own revision, and
 * `layerGatewayServer` over the in-process `Protocol`, so the server that
 * answers a transport in this process is the same server, with the same
 * middleware, that answers a socket. It is module-private because what a
 * process holds of it is the four services below, read out of one build.
 */
function layerGatewayInProcess(
  options: GatewayServerLayerOptions,
): Layer.Layer<GatewayInProcessProtocol | GatewayEventLog | GatewayAdmissions | GatewayClients> {
  const serialization = Layer.effect(
    RpcSerialization.RpcSerialization,
    Effect.map(GatewayEventLog, (log) => gatewayEnvelopeSerialization({ revision: log.revision })),
  );
  return layerGatewayServer(options).pipe(
    Layer.provideMerge(layerGatewayInProcessProtocol),
    Layer.provide(serialization),
    Layer.provideMerge(
      Layer.mergeAll(layerGatewayEventLog(options), layerGatewayAdmissions, layerGatewayClients),
    ),
  );
}

/**
 * What an in-process transport is bound to. The server is its layers, so
 * there is no object of it to hold: a transport holds the door its client
 * enters through, the log it delivers events from, the admissions door the
 * quit closes, and the runtime those layers were built on, and runs each
 * effect there itself, because what it answers its own client with is a
 * promise and a callback.
 */
export interface GatewayInProcessHost {
  readonly protocol: GatewayInProcessProtocol["Type"];
  readonly log: GatewayEventLog["Type"];
  readonly admissions: GatewayAdmissions["Type"];
  readonly runtime: Runtime.Runtime<never>;
}

/**
 * The in-process host built in the caller's own `Scope`, on the runtime the
 * caller runs this effect on: closing that scope is what lets the server's
 * fiber and everything under it go.
 */
export function gatewayInProcessHost(
  options: GatewayServerLayerOptions,
): Effect.Effect<GatewayInProcessHost, never, Scope.Scope> {
  return Effect.gen(function* () {
    const context = yield* Layer.build(layerGatewayInProcess(options));
    return {
      protocol: Context.get(context, GatewayInProcessProtocol),
      log: Context.get(context, GatewayEventLog),
      admissions: Context.get(context, GatewayAdmissions),
      runtime: yield* Effect.runtime<never>(),
    };
  });
}
