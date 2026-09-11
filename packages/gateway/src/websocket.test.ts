import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Context, Effect, ExecutionStrategy, Exit, Layer, Scope } from "effect";
import { WebSocket } from "ws";
import { GatewayClient } from "./client.js";
import { type GatewayMethodTable, gatewayError, gatewayOk } from "./methods.js";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_HANDSHAKE_REFUSAL,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayClientIdentity,
  type GatewayEvent,
} from "./protocol.js";
import { GatewayEventLog, gatewayMethodEffects } from "./server.js";
import {
  bearerAuthentication,
  connectWebSocketGateway,
  GATEWAY_REFUSAL_HEADER,
  GATEWAY_UNREACHABLE,
  type GatewayAuthenticate,
  GatewaySocketBinding,
  layerGatewaySocket,
  WEB_SOCKET_GATEWAY_DEFAULTS,
} from "./websocket.js";

const TOKEN = "a-shared-secret";
const OPERATOR: GatewayClientIdentity = {
  clientId: "desktop",
  role: GATEWAY_CLIENT_ROLE.OPERATOR,
};

interface Hosted {
  readonly binding: GatewaySocketBinding["Type"];
  readonly log: GatewayEventLog["Type"];
  readonly effects: string[];
  readonly shutdowns: () => number;
  /** Takes the host away while the test still stands, as a quit would. */
  readonly close: Effect.Effect<void>;
}

/**
 * One host on an ephemeral socket, in a scope of its own inside the test's,
 * so a test can take it away and what a test leaves standing still goes with
 * the test.
 */
const hosted = (
  authenticate: GatewayAuthenticate = bearerAuthentication(TOKEN),
  bounds: { readonly maximumFrameBytes?: number } = {},
): Effect.Effect<Hosted, never, Scope.Scope> =>
  Effect.gen(function* () {
    const effects: string[] = [];
    const state = { shutdowns: 0 };
    let ids = 0;
    const methods: GatewayMethodTable = {
      [GATEWAY_METHOD.RUN_LIST]: (_params, context) =>
        gatewayOk({ runs: [], client: context.client.clientId }),
      [GATEWAY_METHOD.RUN_SUBMIT]: (params) => {
        effects.push(String(params.question));
        return gatewayOk({ runId: `run-${effects.length}` });
      },
      [GATEWAY_METHOD.SHUTDOWN]: () => {
        state.shutdowns += 1;
        return gatewayOk({ accepted: true });
      },
      [GATEWAY_METHOD.MEMORY_STATUS]: () => gatewayError(GATEWAY_ERROR.REFUSED, "no"),
      // A read that never answers, so a socket can die with a request still out.
      [GATEWAY_METHOD.RUN_WAIT]: () => new Promise(() => undefined),
    };
    const scope = yield* Scope.fork(yield* Effect.scope, ExecutionStrategy.sequential);
    const context = yield* Scope.extend(
      Layer.build(
        layerGatewaySocket({
          methods: gatewayMethodEffects(methods),
          configurationRevision: () => 1,
          sessionRevision: () => "gen-1",
          snapshot: () => ({ runs: [] }),
          now: () => 0,
          createEventId: () => {
            ids += 1;
            return `event-${ids}`;
          },
          authenticate,
          ...bounds,
          report: () => undefined,
        }),
      ),
      scope,
    ).pipe(Effect.orDie);
    return {
      binding: Context.get(context, GatewaySocketBinding),
      log: Context.get(context, GatewayEventLog),
      effects,
      shutdowns: () => state.shutdowns,
      close: Scope.close(scope, Exit.void),
    };
  });

function socketUrl(port: number): string {
  return `ws://${WEB_SOCKET_GATEWAY_DEFAULTS.HOST}:${port}/`;
}

function connect(h: Hosted, overrides: { token?: string } = {}) {
  return Effect.promise(() =>
    connectWebSocketGateway({
      url: socketUrl(h.binding.port),
      headers: {
        [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${overrides.token ?? TOKEN}`,
      },
      client: OPERATOR,
      timeoutMs: 2_000,
    }),
  );
}

const settle = Effect.sleep("50 millis");

/** What the socket closes with for a frame it will not read, as `ws` and this binding name them. */
const SOCKET_CLOSE = {
  UNSUPPORTED_DATA: 1003,
  TOO_LARGE: 1009,
} as const;

it.live("the host binds an ephemeral port and carries requests, answers, and events", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* hosted();
      const result = yield* connect(h);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const client = new GatewayClient({
        transport: result.connection,
        createId: () => crypto.randomUUID(),
      });
      const seen: GatewayEvent[] = [];
      client.on(GATEWAY_EVENT.RUNS_CHANGED, (event) => seen.push(event));
      const listed = yield* Effect.promise(() => client.call(GATEWAY_METHOD.RUN_LIST));
      assert.deepEqual(listed, { ok: true, result: { runs: [], client: "desktop" } });
      const submitted = yield* Effect.promise(() =>
        client.call(GATEWAY_METHOD.RUN_SUBMIT, { question: "hello" }),
      );
      assert.equal(submitted.ok, true);
      assert.deepEqual(h.effects, ["hello"]);
      yield* h.log.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
      yield* settle;
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.sequence, 1);
      const refused = yield* Effect.promise(() => client.call(GATEWAY_METHOD.MEMORY_STATUS));
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.error.code, GATEWAY_ERROR.REFUSED);
      result.connection.close();
    }),
  ),
);

it.live(
  "a wrong token, a wrong protocol, and a malformed handshake are refused before any request is read",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* hosted();
        const wrongToken = yield* connect(h, { token: "another-secret" });
        assert.deepEqual(wrongToken, {
          ok: false,
          failure: GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED,
        });
        const raw = (headers: Record<string, string>) =>
          Effect.promise(
            () =>
              new Promise<string | undefined>((resolve) => {
                const socket = new WebSocket(socketUrl(h.binding.port), { headers });
                socket.once("unexpected-response", (_request, response) => {
                  response.resume();
                  socket.terminate();
                  resolve(String(response.headers[GATEWAY_REFUSAL_HEADER]));
                });
                socket.once("open", () => {
                  socket.close();
                  resolve(undefined);
                });
                socket.once("error", () => resolve("error"));
              }),
          );
        const good = {
          [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}`,
          [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
          [GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]: "desktop",
          [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: GATEWAY_CLIENT_ROLE.OPERATOR,
        };
        assert.equal(
          yield* raw({ ...good, [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: "99" }),
          GATEWAY_HANDSHAKE_REFUSAL.UNSUPPORTED_VERSION,
        );
        assert.equal(
          yield* raw({ ...good, [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: "root" }),
          GATEWAY_HANDSHAKE_REFUSAL.MALFORMED,
        );
        const { [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: _dropped, ...withoutToken } = good;
        assert.equal(yield* raw(withoutToken), GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED);
        assert.equal(
          yield* raw({ ...good, [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}x` }),
          GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED,
        );
        assert.equal(yield* raw(good), undefined);
        yield* settle;
        assert.equal(yield* h.binding.connections, 0);
      }),
    ),
);

it.live(
  "closing admissions refuses new connections and new mutations while reads and the shutdown still answer",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* hosted();
        const attached = yield* connect(h);
        assert.equal(attached.ok, true);
        if (!attached.ok) return;
        yield* h.binding.closeAdmissions;
        const late = yield* connect(h);
        assert.deepEqual(late, { ok: false, failure: GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN });
        const client = new GatewayClient({
          transport: attached.connection,
          createId: () => crypto.randomUUID(),
        });
        const submit = yield* Effect.promise(() =>
          client.call(GATEWAY_METHOD.RUN_SUBMIT, { question: "late" }),
        );
        assert.equal(submit.ok, false);
        if (!submit.ok) assert.equal(submit.error.code, GATEWAY_ERROR.SHUTTING_DOWN);
        assert.deepEqual(h.effects, []);
        assert.equal((yield* Effect.promise(() => client.call(GATEWAY_METHOD.RUN_LIST))).ok, true);
        assert.equal((yield* Effect.promise(() => client.call(GATEWAY_METHOD.SHUTDOWN))).ok, true);
        assert.equal(h.shutdowns(), 1);
        attached.connection.close();
      }),
    ),
);

it.live(
  "a host that goes away settles every in-flight request as disconnected and tells the connection's listeners",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* hosted();
        const result = yield* connect(h);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        let closed = 0;
        result.connection.onClosed(() => {
          closed += 1;
        });
        yield* h.close;
        yield* settle;
        assert.equal(closed, 1);
        assert.equal(result.connection.connected(), false);
        const answer = yield* Effect.promise(() =>
          result.connection.request({
            protocolVersion: GATEWAY_PROTOCOL_VERSION,
            id: "r",
            method: GATEWAY_METHOD.RUN_LIST,
            params: {},
          }),
        );
        assert.equal(answer.ok, false);
        if (!answer.ok) assert.equal(answer.error.code, GATEWAY_ERROR.DISCONNECTED);
        const unreachable = yield* connect(h);
        assert.deepEqual(unreachable, { ok: false, failure: GATEWAY_UNREACHABLE });
      }),
    ),
);

it.live(
  "the identity the injected authentication answers is the one the host admits under, and one that cannot decide authorizes no one",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const minted = yield* hosted(() => ({
          admitted: { clientId: "the-account", role: GATEWAY_CLIENT_ROLE.OPERATOR },
        }));
        const result = yield* connect(minted);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        const client = new GatewayClient({
          transport: result.connection,
          createId: () => crypto.randomUUID(),
        });
        // What the client declared about itself is not what the host admitted it as.
        assert.deepEqual(yield* Effect.promise(() => client.call(GATEWAY_METHOD.RUN_LIST)), {
          ok: true,
          result: { runs: [], client: "the-account" },
        });
        result.connection.close();
        yield* minted.close;

        const throwing = yield* hosted(() => {
          throw new Error("the credential authority is unreachable");
        });
        assert.deepEqual(yield* connect(throwing), {
          ok: false,
          failure: GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED,
        });
      }),
    ),
);

it.live(
  "a handshake still authenticating when admissions close is refused, and a client that drops mid-authentication leaves the host standing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let release: (() => void) | undefined;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const authenticate = bearerAuthentication(TOKEN);
        const h = yield* hosted(async (headers) => {
          await held;
          return authenticate(headers);
        });
        const refused = yield* Effect.fork(connect(h));
        // The host starts to leave while the credential is still being checked.
        yield* Effect.sleep("20 millis");
        yield* h.binding.closeAdmissions;
        release?.();
        assert.deepEqual(yield* refused, {
          ok: false,
          failure: GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN,
        });
        assert.equal(yield* h.binding.connections, 0);
        yield* h.close;

        let dropRelease: (() => void) | undefined;
        const dropHeld = new Promise<void>((resolve) => {
          dropRelease = resolve;
        });
        const dropping = yield* hosted(async (headers) => {
          await dropHeld;
          return authenticate(headers);
        });
        const socket = new WebSocket(socketUrl(dropping.binding.port), {
          headers: {
            [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}`,
            [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
            [GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]: "desktop",
            [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: GATEWAY_CLIENT_ROLE.OPERATOR,
          },
        });
        socket.once("error", () => undefined);
        yield* Effect.sleep("20 millis");
        socket.terminate();
        dropRelease?.();
        yield* settle;
        assert.equal(yield* dropping.binding.connections, 0);
        // The host is still answering: the dropped socket took nothing with it.
        const after = yield* connect(dropping);
        assert.equal(after.ok, true);
        if (after.ok) after.connection.close();
      }),
    ),
);

it.live(
  "a close while a handshake is still authenticating does not wait on the credential authority",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const never = new Promise<void>(() => undefined);
        const h = yield* hosted(async (headers) => {
          await never;
          return bearerAuthentication(TOKEN)(headers);
        });
        const attempt = yield* Effect.fork(connect(h));
        yield* Effect.sleep("20 millis");
        const outcome = yield* Effect.race(
          Effect.as(h.close, "closed"),
          Effect.as(Effect.sleep("2 seconds"), "hung"),
        );
        assert.equal(outcome, "closed");
        // The attempt is refused rather than left waiting on a host that has gone.
        assert.equal((yield* attempt).ok, false);
      }),
    ),
);

it.live("a client that dies with a request still out leaves the host answering the next one", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* hosted();
      const first = yield* connect(h);
      assert.equal(first.ok, true);
      if (!first.ok) return;
      const client = new GatewayClient({
        transport: first.connection,
        createId: () => crypto.randomUUID(),
      });
      const waiting = client.call(GATEWAY_METHOD.RUN_WAIT, { runId: "run-1" });
      yield* settle;
      assert.equal(yield* h.binding.connections, 1);
      // The socket dies with the read still out: its answer lands nowhere and
      // the connection is gone.
      first.connection.close();
      yield* settle;
      assert.equal(yield* h.binding.connections, 0);
      assert.equal((yield* Effect.promise(() => waiting)).ok, false);
      const second = yield* connect(h);
      assert.equal(second.ok, true);
      if (!second.ok) return;
      const after = new GatewayClient({
        transport: second.connection,
        createId: () => crypto.randomUUID(),
      });
      assert.equal((yield* Effect.promise(() => after.call(GATEWAY_METHOD.RUN_LIST))).ok, true);
      second.connection.close();
    }),
  ),
);

it.live("a frame the binding does not read closes the socket rather than being answered", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* hosted(bearerAuthentication(TOKEN), { maximumFrameBytes: 64 });
      const closes = (send: (socket: WebSocket) => void) =>
        Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const socket = new WebSocket(socketUrl(h.binding.port), {
                headers: {
                  [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}`,
                  [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
                  [GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]: "desktop",
                  [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: GATEWAY_CLIENT_ROLE.OPERATOR,
                },
              });
              socket.once("close", (code) => resolve(code));
              socket.once("error", () => undefined);
              socket.once("open", () => send(socket));
            }),
        );
      assert.equal(
        yield* closes((socket) => socket.send(Uint8Array.of(1, 2, 3))),
        SOCKET_CLOSE.UNSUPPORTED_DATA,
      );
      assert.equal(yield* closes((socket) => socket.send("x".repeat(128))), SOCKET_CLOSE.TOO_LARGE);
    }),
  ),
);
