import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import {
  isRecord,
  isWireString,
  valueFromJsonText,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import { Context, Deferred, Effect, Fiber, Layer, Option, Result, Stream } from "effect";
import { Headers } from "effect/unstable/http";
import { Rpc, RpcMessage } from "effect/unstable/rpc";
import { test } from "vitest";
import type { GatewayMethodContext, GatewayMethodTable } from "./methods.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  GATEWAY_RECONNECT_KIND,
  type GatewayClientIdentity,
  type GatewayErrorCode,
  type GatewayMethod,
  GatewayRefusalSchema,
  type GatewayRequest,
  gatewayRequestToWire,
  gatewayResponseFromWire,
  isMutatingGatewayMethod,
  NodeUnavailableRefusal,
  NotFoundRefusal,
  RefusedRefusal,
  UnknownCapabilityRefusal,
} from "./protocol.js";
import {
  GATEWAY_REQUEST_HEADER,
  GatewayMutates,
  GatewayRpcs,
  layerGatewayEnvelopeSerialization,
} from "./rpc.js";
import {
  GatewayAdmission,
  GatewayAdmissions,
  GatewayClients,
  GatewayEventLog,
  type GatewayInProcessConnection,
  GatewayInProcessProtocol,
  GatewayLedger,
  GatewayRevisionCheck,
  type GatewayServerLayerOptions,
  GatewayServerRpcs,
  layerGatewayAdmissions,
  layerGatewayClients,
  layerGatewayEventLog,
  layerGatewayInProcessProtocol,
  layerGatewayLedger,
  layerGatewayServer,
} from "./server.js";

/**
 * The Rpc server against a client of an earlier build. Every exchange here
 * starts from a request envelope `fixtures/protocol` recorded before the
 * server was an `RpcServer`, carries it through the in-process protocol as
 * the text a socket would, and asserts the answer's bytes are the recorded
 * ones: the ledger, the revision checks, and the replay window are pinned by
 * the same goldens the old server was recorded against, so a byte the new
 * server moved would be a contract it moved.
 */

const FIXTURE_ROOT = path.join(fileURLToPath(import.meta.url), "../../fixtures/protocol");

const REDACTED_MESSAGE = "<message>";

const OPERATOR: GatewayClientIdentity = {
  clientId: "operator-fixture",
  role: GATEWAY_CLIENT_ROLE.OPERATOR,
};

const NODE: GatewayClientIdentity = { clientId: "node-fixture", role: GATEWAY_CLIENT_ROLE.NODE };

const FIXTURE_INSTANT = 1_700_000_000_000;
const FIXTURE_CONFIGURATION_REVISION = 7;
const FIXTURE_SESSION_KEY = "agent:main:main";
const FIXTURE_SESSION_REVISION = "generation-1";
const FIXTURE_SNAPSHOT: WireValue = { kind: "snapshot", rows: [{ id: "row-1", state: "idle" }] };

const METHODS: readonly GatewayMethod[] = Object.values(GATEWAY_METHOD);
const ERROR_CODES: readonly GatewayErrorCode[] = Object.values(GATEWAY_ERROR);

const GOLDEN = {
  REPLAY_INSIDE_WINDOW: "replay-inside-window",
  REPLAY_PAST_WINDOW: "replay-past-window",
  EXPECTED_REVISION: "envelope-expected-revision",
  EMPTY_RESULT: "envelope-empty-result",
} as const;

function slug(name: string): string {
  return name.replaceAll(".", "-").replaceAll("_", "-");
}

interface Golden {
  request: WireRecord;
  response: WireRecord;
}

function recordOf(value: WireValue | undefined): WireRecord {
  assert.ok(isRecord(value));
  return value;
}

const golden = (name: string): Effect.Effect<Golden> =>
  Effect.promise(async () => {
    const text = await fs.readFile(path.join(FIXTURE_ROOT, `${name}.json`), "utf8");
    const held = recordOf(valueFromJsonText(text));
    return { request: recordOf(held.request), response: recordOf(held.response) };
  });

const methodGolden = (method: GatewayMethod) => golden(`method-${slug(method)}`);
const errorGolden = (code: GatewayErrorCode) => golden(`error-${slug(code)}`);

function frame(value: WireValue): string {
  return JSON.stringify(value);
}

/** The answer with its error message redacted the way the golden itself was recorded; a success answers its own bytes. */
function redacted(answer: string): string {
  const written = recordOf(valueFromJsonText(answer));
  if (!isRecord(written.error)) return answer;
  assert.ok(isWireString(written.error.message) && written.error.message.length > 0);
  return frame({ ...written, error: { ...written.error, message: REDACTED_MESSAGE } });
}

function answeringTable(): GatewayMethodTable {
  const table: GatewayMethodTable = {};
  for (const method of METHODS) table[method] = () => Effect.succeed({ answered: method });
  return table;
}

interface Harness {
  methods?: GatewayMethodTable;
  replayWindow?: number;
  idempotencyCapacity?: number;
}

/** The server as the goldens were recorded: the fixture's revisions, snapshot, clock, and event ids, behind the in-process protocol. */
function serverLayer(harness: Harness = {}) {
  let events = 0;
  const options: GatewayServerLayerOptions = {
    methods: harness.methods ?? answeringTable(),
    configurationRevision: () => FIXTURE_CONFIGURATION_REVISION,
    sessionRevision: (key) => (key === FIXTURE_SESSION_KEY ? FIXTURE_SESSION_REVISION : undefined),
    snapshot: () => FIXTURE_SNAPSHOT,
    now: () => FIXTURE_INSTANT + events * 1_000,
    createEventId: () => {
      events += 1;
      return `event-${events}`;
    },
    ...(harness.replayWindow !== undefined ? { replayWindow: harness.replayWindow } : undefined),
    ...(harness.idempotencyCapacity !== undefined
      ? { idempotencyCapacity: harness.idempotencyCapacity }
      : undefined),
  };
  const services = Layer.mergeAll(
    layerGatewayEventLog(options),
    layerGatewayClients,
    layerGatewayAdmissions,
  );
  const serialization = Layer.unwrap(
    Effect.map(GatewayEventLog, (log) =>
      layerGatewayEnvelopeSerialization({ revision: log.revision }),
    ),
  );
  const transport = layerGatewayInProcessProtocol.pipe(Layer.provide(serialization));
  return layerGatewayServer(options).pipe(
    Layer.provideMerge(transport),
    Layer.provideMerge(services),
  );
}

const connect = (
  identity: GatewayClientIdentity,
): Effect.Effect<GatewayInProcessConnection, never, GatewayInProcessProtocol> =>
  Effect.flatMap(GatewayInProcessProtocol, (protocol) => protocol.connect({ identity }));

function requestFor(method: GatewayMethod, params: WireRecord, key?: string): GatewayRequest {
  return {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    id: `request-${slug(method)}`,
    method,
    params,
    ...(key !== undefined ? { idempotencyKey: key } : undefined),
  };
}

const carry = (door: GatewayInProcessConnection, request: GatewayRequest) =>
  Effect.map(door.carry(frame(gatewayRequestToWire(request))), (answer) => {
    const response = gatewayResponseFromWire(valueFromJsonText(answer));
    assert.ok(response !== undefined);
    return response;
  });

test("the server's group is the protocol's group under the three middlewares, ledger innermost and admission outermost, each Rpc still carrying its mutates flag", () => {
  assert.deepEqual(
    [...GatewayServerRpcs.requests.keys()].toSorted(),
    [...GatewayRpcs.requests.keys()].toSorted(),
  );
  for (const [name, rpc] of GatewayServerRpcs.requests) {
    assert.equal(rpc._tag, name);
    assert.deepEqual([...rpc.middlewares], [GatewayLedger, GatewayRevisionCheck, GatewayAdmission]);
    assert.deepEqual(
      Context.getOption(rpc.annotations, GatewayMutates),
      Option.some(isMutatingGatewayMethod(rpc._tag)),
    );
  }
  // Every middleware wraps the handler's own effect now, so what each one is
  // is read from the refusal family it may answer with rather than a flag.
  for (const middleware of [GatewayLedger, GatewayRevisionCheck, GatewayAdmission]) {
    assert.equal(middleware.error, GatewayRefusalSchema);
  }
});

it.effect(
  "every method's recorded request is answered with the recorded envelope, byte for byte",
  () =>
    Effect.gen(function* () {
      const door = yield* connect(OPERATOR);
      for (const method of METHODS) {
        const held = yield* methodGolden(method);
        assert.equal(yield* door.carry(frame(held.request)), frame(held.response));
      }
    }).pipe(Effect.provide(serverLayer())),
);

it.effect("every error code's recorded request is answered with the recorded envelope", () =>
  Effect.gen(function* () {
    const door = yield* connect(OPERATOR);
    const node = yield* connect(NODE);
    const admissions = yield* GatewayAdmissions;
    // The conflict golden was recorded against a key already spent under other words.
    const spent = yield* methodGolden(GATEWAY_METHOD.SETTINGS_UPDATE);
    assert.equal(yield* door.carry(frame(spent.request)), frame(spent.response));

    const answered: GatewayErrorCode[] = [];
    const settle = (code: GatewayErrorCode, through: GatewayInProcessConnection) =>
      Effect.gen(function* () {
        const held = yield* errorGolden(code);
        assert.equal(redacted(yield* through.carry(frame(held.request))), frame(held.response));
        answered.push(code);
      });
    yield* settle(GATEWAY_ERROR.UNSUPPORTED_VERSION, door);
    yield* settle(GATEWAY_ERROR.UNKNOWN_METHOD, door);
    yield* settle(GATEWAY_ERROR.INVALID_PARAMS, door);
    yield* settle(GATEWAY_ERROR.MISSING_IDEMPOTENCY_KEY, door);
    yield* settle(GATEWAY_ERROR.IDEMPOTENCY_CONFLICT, door);
    yield* settle(GATEWAY_ERROR.REVISION_MISMATCH, door);
    yield* settle(GATEWAY_ERROR.NOT_FOUND, door);
    yield* settle(GATEWAY_ERROR.REFUSED, door);
    yield* settle(GATEWAY_ERROR.UNAUTHORIZED, node);
    yield* settle(GATEWAY_ERROR.NODE_UNAVAILABLE, door);
    yield* settle(GATEWAY_ERROR.UNKNOWN_CAPABILITY, door);
    yield* settle(GATEWAY_ERROR.INTERNAL, door);
    yield* admissions.close;
    yield* settle(GATEWAY_ERROR.SHUTTING_DOWN, door);
    yield* door.close;
    yield* settle(GATEWAY_ERROR.DISCONNECTED, door);
    assert.deepEqual(answered.toSorted(), [...ERROR_CODES].toSorted());
  }).pipe(
    Effect.provide(
      serverLayer({
        methods: {
          ...Object.fromEntries(
            Object.entries(answeringTable()).filter(
              ([method]) => method !== GATEWAY_METHOD.VOICE_DIAGNOSTICS,
            ),
          ),
          [GATEWAY_METHOD.SESSION_EXECUTE_CONTROL]: () =>
            Effect.fail(new NotFoundRefusal({ message: "no run has that id" })),
          [GATEWAY_METHOD.SESSION_SEND_MESSAGE]: () =>
            Effect.fail(new RefusedRefusal({ message: "that session advertises no message" })),
          [GATEWAY_METHOD.NODE_INVOKE]: () =>
            Effect.fail(
              new NodeUnavailableRefusal({ message: "no connected node offers that capability" }),
            ),
          [GATEWAY_METHOD.SESSION_OPEN]: () =>
            Effect.fail(
              new UnknownCapabilityRefusal({ message: "that capability is not registered" }),
            ),
          [GATEWAY_METHOD.GUIDE_REPORT]: () => {
            throw new Error("the handler failed");
          },
        },
      }),
    ),
  ),
);

it.effect(
  "a reconnection inside the window replays the recorded events, one past it the recorded snapshot, and the boundary falls where it did",
  () =>
    Effect.gen(function* () {
      const log = yield* GatewayEventLog;
      const door = yield* connect(OPERATOR);
      yield* log.emit(GATEWAY_EVENT.SETTINGS_CHANGED, { setting: "first" });
      yield* log.emit(GATEWAY_EVENT.ACCOUNT_CHANGED, { account: "second" });
      yield* log.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
      yield* log.emit(
        GATEWAY_EVENT.CONVERSATION_VIEW_CHANGED,
        { lines: 1 },
        { sessionKey: FIXTURE_SESSION_KEY },
      );
      yield* log.emit(
        GATEWAY_EVENT.SESSIONS_CHANGED,
        { sessions: 1 },
        { sessionKey: FIXTURE_SESSION_KEY, runId: "run-1" },
      );
      assert.equal(yield* log.sequence, 5);
      assert.deepEqual(log.revision(), {
        configuration: FIXTURE_CONFIGURATION_REVISION,
        sequence: 5,
      });

      const inside = yield* golden(GOLDEN.REPLAY_INSIDE_WINDOW);
      assert.equal(yield* door.carry(frame(inside.request)), frame(inside.response));
      const past = yield* golden(GOLDEN.REPLAY_PAST_WINDOW);
      assert.equal(yield* door.carry(frame(past.request)), frame(past.response));

      // The window holds 3, 4, and 5: a client at 2 is owed exactly those, one at 1 has fallen past the window.
      const atBoundary = yield* log.replayFrom(2);
      assert.equal(atBoundary.kind, GATEWAY_RECONNECT_KIND.REPLAY);
      if (atBoundary.kind === GATEWAY_RECONNECT_KIND.REPLAY) {
        assert.deepEqual(
          atBoundary.events.map((event) => event.sequence),
          [3, 4, 5],
        );
      }
      const pastBoundary = yield* log.replayFrom(1);
      assert.deepEqual(pastBoundary, {
        kind: GATEWAY_RECONNECT_KIND.SNAPSHOT,
        sequence: 5,
        snapshot: FIXTURE_SNAPSHOT,
      });
      assert.deepEqual(yield* log.replayFrom(5), {
        kind: GATEWAY_RECONNECT_KIND.REPLAY,
        events: [],
      });
      assert.deepEqual(yield* log.replayFrom(6), {
        kind: GATEWAY_RECONNECT_KIND.REPLAY,
        events: [],
      });
    }).pipe(Effect.provide(serverLayer({ replayWindow: 3 }))),
);

it.effect("a named revision and an empty answer cross as the recorded envelopes", () =>
  Effect.gen(function* () {
    const door = yield* connect(OPERATOR);
    for (const name of [GOLDEN.EXPECTED_REVISION, GOLDEN.EMPTY_RESULT]) {
      const held = yield* golden(name);
      assert.equal(yield* door.carry(frame(held.request)), frame(held.response));
    }
  }).pipe(
    Effect.provide(
      serverLayer({
        methods: {
          ...answeringTable(),
          [GATEWAY_METHOD.GUIDE_REPORT]: () => Effect.succeed(undefined),
        },
      }),
    ),
  ),
);

const runs: string[] = [];

it.effect(
  "a replayed key finds the first answer and runs the handler once, and two retries in flight together join one decision",
  () =>
    Effect.gen(function* () {
      const door = yield* connect(OPERATOR);
      const request = requestFor(GATEWAY_METHOD.GUIDE_REPORT, { reportId: "s" }, "k");
      const [first, second] = yield* Effect.all([carry(door, request), carry(door, request)], {
        concurrency: "unbounded",
      });
      assert.deepEqual(first, second);
      assert.deepEqual(runs, ["report"]);
      const later = yield* carry(door, request);
      assert.deepEqual(later, first);
      assert.deepEqual(runs, ["report"]);
    }).pipe(
      Effect.provide(
        serverLayer({
          methods: {
            [GATEWAY_METHOD.GUIDE_REPORT]: () =>
              Effect.gen(function* () {
                runs.push("report");
                yield* Effect.yieldNow;
                return { outcome: "accepted" };
              }),
          },
        }),
      ),
    ),
);

const capped: string[] = [];

it.effect(
  "the ledger remembers as many keys as its capacity, and the least recently asked go first",
  () =>
    Effect.gen(function* () {
      const door = yield* connect(OPERATOR);
      const report = (key: string) =>
        carry(door, requestFor(GATEWAY_METHOD.GUIDE_REPORT, { key }, key));
      yield* report("a");
      yield* report("b");
      assert.equal(capped.length, 2);
      yield* report("b");
      assert.equal(capped.length, 2);
      yield* report("a");
      assert.deepEqual(capped, ["a", "b", "a"]);
    }).pipe(
      Effect.provide(
        serverLayer({
          idempotencyCapacity: 1,
          methods: {
            [GATEWAY_METHOD.GUIDE_REPORT]: (params) => {
              capped.push(String(params.key));
              return Effect.succeed(undefined);
            },
          },
        }),
      ),
    ),
);

const contexts: GatewayMethodContext[] = [];

it.effect(
  "a handler is handed the admitted identity and what the request said beside its id, and the registry, not the request, decides who asks",
  () =>
    Effect.gen(function* () {
      const clients = yield* GatewayClients;
      const door = yield* connect(OPERATOR);
      const request: GatewayRequest = {
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        id: "request-1",
        method: GATEWAY_METHOD.GUIDE_REPORT,
        params: { reportId: "s" },
        idempotencyKey: "k",
        expectedRevision: {
          sessionKey: FIXTURE_SESSION_KEY,
          sessionRevision: FIXTURE_SESSION_REVISION,
          configurationRevision: FIXTURE_CONFIGURATION_REVISION,
        },
      };
      const answer = yield* carry(door, request);
      assert.equal(answer.ok, true);
      assert.deepEqual(contexts, [
        {
          client: OPERATOR,
          request: {
            protocolVersion: GATEWAY_PROTOCOL_VERSION,
            method: GATEWAY_METHOD.GUIDE_REPORT,
            params: { reportId: "s" },
            idempotencyKey: "k",
            expectedRevision: request.expectedRevision,
          },
        },
      ]);
      yield* clients.disconnect(door.clientId);
      const refused = yield* carry(door, { ...request, id: "request-2", idempotencyKey: "other" });
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.error.code, GATEWAY_ERROR.UNAUTHORIZED);
      assert.equal(contexts.length, 1);
    }).pipe(
      Effect.provide(
        serverLayer({
          methods: {
            [GATEWAY_METHOD.GUIDE_REPORT]: (_params, context) => {
              contexts.push(context);
              return Effect.succeed(undefined);
            },
          },
        }),
      ),
    ),
);

it.effect("the log's stream delivers every emitted event in sequence", () =>
  Effect.gen(function* () {
    const log = yield* GatewayEventLog;
    const events = yield* log.events;
    yield* log.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
    yield* log.emit(GATEWAY_EVENT.SETTINGS_CHANGED, { settings: {} });
    yield* log.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] }, { runId: "run-1" });
    const taken = yield* Stream.runCollect(Stream.take(events, 3));
    assert.deepEqual(
      taken.map((event) => [event.sequence, event.kind, event.runId]),
      [
        [1, GATEWAY_EVENT.SESSIONS_CHANGED, undefined],
        [2, GATEWAY_EVENT.SETTINGS_CHANGED, undefined],
        [3, GATEWAY_EVENT.SESSIONS_CHANGED, "run-1"],
      ],
    );
  }).pipe(Effect.scoped, Effect.provide(serverLayer())),
);

it.effect(
  "an interrupted first attempt is no answer: the key is not poisoned, and the retry runs the mutation",
  () =>
    Effect.gen(function* () {
      const ledger = yield* GatewayLedger;
      const rpc = GatewayRpcs.requests.get(GATEWAY_METHOD.GUIDE_REPORT);
      assert.ok(rpc !== undefined);
      const asked = {
        client: new Rpc.ServerClient(1),
        requestId: RpcMessage.RequestId(1),
        rpc,
        payload: { reportId: "s" },
        headers: Headers.fromInput({ [GATEWAY_REQUEST_HEADER.IDEMPOTENCY_KEY]: "k" }),
      };
      const started = yield* Deferred.make<void>();
      const first = yield* Effect.forkChild(
        ledger(Effect.andThen(Deferred.succeed(started, undefined), Effect.never), asked),
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(first);
      const retried = yield* Effect.result(
        ledger(Effect.fail(new NotFoundRefusal({ message: "ran" })), asked),
      );
      assert.ok(Result.isFailure(retried));
      assert.ok(retried.failure instanceof NotFoundRefusal);
      // The refusal is an answer, and the same key finds it again without running anything.
      const again = yield* Effect.result(ledger(Effect.never, asked));
      assert.ok(Result.isFailure(again));
      assert.equal(again.failure, retried.failure);
    }).pipe(
      Effect.provide(
        layerGatewayLedger({
          methods: {},
          configurationRevision: () => FIXTURE_CONFIGURATION_REVISION,
          sessionRevision: () => undefined,
          snapshot: () => FIXTURE_SNAPSHOT,
          now: () => FIXTURE_INSTANT,
          createEventId: () => "event",
        }),
      ),
    ),
);

it.effect("a window of nothing still keeps the newest event, so the sequence never restarts", () =>
  Effect.gen(function* () {
    const log = yield* GatewayEventLog;
    yield* log.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
    const second = yield* log.emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [] });
    assert.equal(second.sequence, 2);
    assert.equal(yield* log.sequence, 2);
    assert.equal(log.revision().sequence, 2);
    assert.deepEqual(yield* log.replayFrom(1), {
      kind: GATEWAY_RECONNECT_KIND.REPLAY,
      events: [second],
    });
    assert.equal((yield* log.replayFrom(0)).kind, GATEWAY_RECONNECT_KIND.SNAPSHOT);
  }).pipe(
    Effect.provide(
      layerGatewayEventLog({
        replayWindow: 0,
        configurationRevision: () => FIXTURE_CONFIGURATION_REVISION,
        snapshot: () => FIXTURE_SNAPSHOT,
        now: () => FIXTURE_INSTANT,
        createEventId: () => "event",
      }),
    ),
  ),
);
