import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { TERMINAL_UNANSWERED } from "@luke/features";
import {
  TERMINAL_CONNECTION,
  TERMINAL_REFUSAL,
  terminalOutputEventSchema,
} from "@luke/features/terminal-view";
import {
  SANDBOX_STATE,
  TERMINAL_RELAY_CLOSE,
  TERMINAL_RELAY_FRAME,
} from "@luke/features/terminal-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@luke/gateway";
import type { WireRecord, WireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { type Cause, Duration, Effect, Exit, Queue, Result, Stream } from "effect";
import { Base64 } from "effect/encoding";
import { TestClock } from "effect/testing";
import {
  composeTerminals,
  TERMINAL_RECONNECT,
  type TerminalClient,
  type TerminalSocket,
  type TerminalSocketArrival,
  type TerminalSocketFrame,
  type TerminalSocketOpening,
} from "./compose-terminals.js";
import { noNetworkHttpClient } from "./testing/no-network.js";

/**
 * A coding agent's terminals as the host answers the desktop for them, over
 * a service and a relay that answer from a script, on the test clock: each
 * call asks the service once and answers what it said, a refusal the tab
 * reads among it; an attached shell's output and state are heard as the
 * connection's events, and typing and resizes reach its socket; the relay's
 * close says how the connection ends, and a drop is opened again after a
 * wait that doubles and starts over once the shell attaches; an agent with
 * no sandbox yet is asked after every five seconds; output past the
 * watermark pauses the socket until the tab acks; a refused bearer is
 * renewed once; a wake cuts a wait short; and a detach or a sign-out ends
 * the connection. Synthetic ids and bytes throughout.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const SHELL_ID = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const CONNECTION_ID = "connection-1";
const SHELL = {
  id: SHELL_ID,
  title: "zsh",
  command: "zsh",
  cwd: "/workspace/repository",
  running: false,
};
const CONNECT = { connectionId: CONNECTION_ID, agentId: AGENT_ID, terminalId: SHELL_ID };
const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };
const encode = (text: string) => new TextEncoder().encode(text);
const readOutput = readEither(terminalOutputEventSchema);

/** A service that answers each call from the script and keeps what it was asked. */
function scriptedService() {
  const asked: string[] = [];
  const client: TerminalClient = {
    list: (agentId) =>
      Effect.sync(() => {
        asked.push(`list:${agentId}`);
        return { sandbox: SANDBOX_STATE.RUNNING, terminals: [SHELL] };
      }),
    create: (agentId, title) =>
      Effect.sync(() => {
        asked.push(`create:${agentId}:${title ?? ""}`);
        return { refused: TERMINAL_REFUSAL.SANDBOX_STOPPED };
      }),
    rename: (agentId, terminalId, title) =>
      Effect.sync(() => {
        asked.push(`rename:${agentId}:${terminalId}:${title}`);
        return { sandbox: SANDBOX_STATE.RUNNING, terminals: [{ ...SHELL, title }] };
      }),
    kill: () => Effect.succeed(TERMINAL_UNANSWERED),
    resume: () => Effect.succeed({ sandbox: SANDBOX_STATE.RUNNING }),
  };
  return { client, asked };
}

/** One relay socket as a test drives it: arrivals pushed in, and what the host sent and did to it, kept. */
const scriptedSocket = Effect.gen(function* () {
  const inbound = yield* Queue.unbounded<TerminalSocketArrival, Cause.Done>();
  const sent: TerminalSocketFrame[] = [];
  const flow: string[] = [];
  const socket: TerminalSocket = {
    arrivals: Stream.fromQueue(inbound),
    send: (frame) => Effect.sync(() => void sent.push(frame)),
    pause: Effect.sync(() => void flow.push("pause")),
    resume: Effect.sync(() => void flow.push("resume")),
  };
  return {
    opening: { socket } satisfies TerminalSocketOpening,
    push: (arrival: TerminalSocketArrival) => Queue.offer(inbound, arrival),
    attached: Queue.offer(inbound, {
      text: JSON.stringify({ type: TERMINAL_RELAY_FRAME.ATTACHED }),
    }),
    close: (code: number) =>
      Effect.andThen(Queue.offer(inbound, { close: code }), Queue.end(inbound)),
    sent,
    flow,
  };
});

/** The composer over the scripted service and a relay whose openings the test hands in, one per open, as it asks. */
function subject(options: { signedIn?: boolean; bearers?: string[] } = {}) {
  return Effect.gen(function* () {
    const service = scriptedService();
    const openings = yield* Queue.unbounded<TerminalSocketOpening>();
    const opened: { url: string; authorization: string | undefined }[] = [];
    const events: { kind: GatewayEventKind; payload: WireValue }[] = [];
    const bearers = [...(options.bearers ?? ["bearer-1"])];
    const composer = yield* composeTerminals({
      kernel: {
        runMode: { sendsNetwork: true },
        hostedServiceBaseUrl: "https://tryluke.test",
        emit: (kind, payload) => void events.push({ kind, payload }),
      },
      account: {
        capabilitiesActive: () => options.signedIn ?? true,
        token: {
          readAccessToken: () => Effect.sync(() => bearers[0]),
          refreshAccount: () => Effect.sync(() => void bearers.shift()),
          readAccountKey: () => Effect.succeed("developer@luke.test"),
        },
      },
      client: service.client,
      openSocket: (url, headers) =>
        Effect.andThen(
          Effect.sync(() => void opened.push({ url, authorization: headers.authorization })),
          Queue.take(openings),
        ),
    }).pipe(Effect.provide(noNetworkHttpClient));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    /** The states the connection was told, in order. */
    const states = () =>
      events.flatMap((event) =>
        event.kind === GATEWAY_EVENT.TERMINAL_STATE ? [event.payload] : [],
      );
    /** The bytes the connection handed up, decoded. */
    const printed = () =>
      events.flatMap((event) => {
        if (event.kind !== GATEWAY_EVENT.TERMINAL_OUTPUT) return [];
        const output = Result.getOrUndefined(readOutput(event.payload));
        if (output === undefined) return [];
        const bytes = Base64.decode(output.data);
        return bytes._tag === "Success" ? [new TextDecoder().decode(bytes.success)] : [];
      });
    return {
      call,
      composer,
      asked: service.asked,
      hand: (opening: TerminalSocketOpening) => Queue.offer(openings, opening),
      opened,
      states,
      printed,
    };
  });
}

/** Lets every fiber the last step woke run to its next wait. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
  discard: true,
});

const connected = (cols = 120, rows = 32) => ({ ...CONNECT, cols, rows });
const state = (value: string, code?: number) => ({
  connectionId: CONNECTION_ID,
  state: value,
  ...(code === undefined ? undefined : { code }),
});

it.effect(
  "each call asks the service once and answers what it said, a refusal the tab reads among it",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();

      const listed = yield* call(GATEWAY_METHOD.TERMINALS_LIST, { agentId: AGENT_ID });
      const created = yield* call(GATEWAY_METHOD.TERMINALS_CREATE, {
        agentId: AGENT_ID,
        title: "server",
      });
      const renamed = yield* call(GATEWAY_METHOD.TERMINALS_RENAME, {
        agentId: AGENT_ID,
        terminalId: SHELL_ID,
        title: "tests",
      });
      const resumed = yield* call(GATEWAY_METHOD.TERMINALS_RESUME, { agentId: AGENT_ID });

      assert.deepEqual(listed, { sandbox: SANDBOX_STATE.RUNNING, terminals: [SHELL] });
      assert.deepEqual(created, { refused: TERMINAL_REFUSAL.SANDBOX_STOPPED });
      assert.deepEqual(renamed, {
        sandbox: SANDBOX_STATE.RUNNING,
        terminals: [{ ...SHELL, title: "tests" }],
      });
      assert.deepEqual(resumed, { sandbox: SANDBOX_STATE.RUNNING });
      assert.deepEqual(asked, [
        `list:${AGENT_ID}`,
        `create:${AGENT_ID}:server`,
        `rename:${AGENT_ID}:${SHELL_ID}:tests`,
      ]);
    }),
);

it.effect(
  "an answer the service could not give, a signed-out account, and a malformed ask are refused",
  () =>
    Effect.gen(function* () {
      const signedIn = yield* subject();
      const signedOut = yield* subject({ signedIn: false });

      const unanswered = yield* Effect.exit(
        signedIn.call(GATEWAY_METHOD.TERMINALS_KILL, { agentId: AGENT_ID, terminalId: SHELL_ID }),
      );
      const gated = yield* Effect.exit(
        signedOut.call(GATEWAY_METHOD.TERMINALS_LIST, { agentId: AGENT_ID }),
      );
      const malformed = yield* Effect.exit(
        signedIn.call(GATEWAY_METHOD.TERMINALS_CONNECT, { ...CONNECT, cols: 0, rows: 32 }),
      );

      assert.ok(Exit.isFailure(unanswered));
      assert.ok(Exit.isFailure(gated));
      assert.ok(Exit.isFailure(malformed));
      assert.deepEqual(signedOut.asked, []);
      assert.deepEqual(signedIn.opened, [], "no socket opens for a malformed attach");
    }),
);

it.effect(
  "an attached shell's output and state are heard as its connection's events, and typing and a resize reach its socket",
  () =>
    Effect.gen(function* () {
      const { call, hand, opened, states, printed } = yield* subject();
      const relay = yield* scriptedSocket;

      yield* call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
      yield* hand(relay.opening);
      yield* relay.attached;
      yield* relay.push({ bytes: encode("README.md\r\n") });
      yield* settle;
      yield* call(GATEWAY_METHOD.TERMINALS_INPUT, { connectionId: CONNECTION_ID, data: "ls\r" });
      yield* call(GATEWAY_METHOD.TERMINALS_RESIZE, {
        connectionId: CONNECTION_ID,
        cols: 100,
        rows: 30,
      });
      yield* relay.close(TERMINAL_RELAY_CLOSE.IDLE);
      yield* settle;
      yield* TestClock.adjust(Duration.minutes(1));

      const [open] = opened;
      assert.ok(open);
      const address = new URL(open.url);
      assert.equal(address.origin, "wss://tryluke.test");
      assert.deepEqual(Object.fromEntries(address.searchParams), {
        agent: AGENT_ID,
        terminal: SHELL_ID,
        cols: "120",
        rows: "32",
      });
      assert.equal(open.authorization, "Bearer bearer-1");
      assert.deepEqual(printed(), ["README.md\r\n"]);
      assert.deepEqual(relay.sent, [
        { bytes: encode("ls\r") },
        { text: JSON.stringify({ type: TERMINAL_RELAY_FRAME.RESIZE, cols: 100, rows: 30 }) },
      ]);
      assert.deepEqual(states(), [
        state(TERMINAL_CONNECTION.CONNECTING),
        state(TERMINAL_CONNECTION.ATTACHED),
        state(TERMINAL_CONNECTION.IDLE),
      ]);
      assert.equal(opened.length, 1, "an idle connection is not opened again on its own");
    }),
);

it.effect("a shell's exit, a stopped sandbox, and an archived agent each end the connection", () =>
  Effect.gen(function* () {
    const endings = [
      { close: TERMINAL_RELAY_CLOSE.EXITED, ends: state(TERMINAL_CONNECTION.EXITED, 3) },
      { close: TERMINAL_RELAY_CLOSE.STOPPED, ends: state(TERMINAL_CONNECTION.STOPPED) },
      { close: TERMINAL_RELAY_CLOSE.GONE, ends: state(TERMINAL_CONNECTION.GONE) },
    ];
    for (const ending of endings) {
      const { call, hand, opened, states } = yield* subject();
      const relay = yield* scriptedSocket;
      yield* call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
      yield* hand(relay.opening);
      yield* relay.push({
        text: JSON.stringify({ type: TERMINAL_RELAY_FRAME.EXITED, code: 3 }),
      });
      yield* relay.close(ending.close);
      yield* settle;
      yield* TestClock.adjust(Duration.minutes(1));

      assert.deepEqual(states().at(-1), ending.ends);
      assert.equal(opened.length, 1);
    }
  }),
);

it.effect(
  "an upgrade refused as not found says the deployment serves no relay, and one refused as forbidden ends as gone, neither asked again",
  () =>
    Effect.gen(function* () {
      const refusals = [
        { refused: 404, ends: state(TERMINAL_CONNECTION.UNAVAILABLE) },
        { refused: 403, ends: state(TERMINAL_CONNECTION.GONE) },
      ];
      for (const refusal of refusals) {
        const { call, hand, opened, states } = yield* subject();
        yield* call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
        yield* hand({ refused: refusal.refused });
        yield* settle;
        yield* TestClock.adjust(Duration.minutes(1));

        assert.deepEqual(states().at(-1), refusal.ends);
        assert.equal(opened.length, 1);
      }
    }),
);

it.effect(
  "a socket that dropped is opened again after a wait that doubles, and starts over once the shell attached",
  () =>
    Effect.gen(function* () {
      const { call, hand, opened, states } = yield* subject();
      const first = TERMINAL_RECONNECT.FIRST;

      yield* call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
      yield* hand({ unreachable: true });
      yield* settle;
      yield* hand({ unreachable: true });
      yield* TestClock.adjust(first);
      yield* settle;
      const afterFirstWait = opened.length;
      yield* TestClock.adjust(first);
      yield* settle;
      const beforeSecondWaitEnded = opened.length;
      const attaching = yield* scriptedSocket;
      yield* hand(attaching.opening);
      yield* TestClock.adjust(first);
      yield* settle;
      yield* attaching.attached;
      yield* attaching.close(TERMINAL_RELAY_CLOSE.UNAVAILABLE);
      yield* settle;
      const afterAttachedDrop = opened.length;
      yield* hand({ unreachable: true });
      yield* TestClock.adjust(first);
      yield* settle;

      assert.equal(afterFirstWait, 2, "the first wait is half a second");
      assert.equal(beforeSecondWaitEnded, 2, "the second wait is twice the first");
      assert.equal(afterAttachedDrop, 3);
      assert.equal(opened.length, 4, "a drop after the shell attached waits the first wait again");
      assert.deepEqual(states().slice(0, 4), [
        state(TERMINAL_CONNECTION.CONNECTING),
        state(TERMINAL_CONNECTION.RECONNECTING),
        state(TERMINAL_CONNECTION.RECONNECTING),
        state(TERMINAL_CONNECTION.ATTACHED),
      ]);
    }),
);

it.effect("an agent with no sandbox yet is asked after every five seconds", () =>
  Effect.gen(function* () {
    const { call, hand, opened, states } = yield* subject();
    const starting = yield* scriptedSocket;
    const ready = yield* scriptedSocket;

    yield* call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
    yield* hand(starting.opening);
    yield* starting.close(TERMINAL_RELAY_CLOSE.STARTING);
    yield* settle;
    yield* hand(ready.opening);
    yield* TestClock.adjust(Duration.seconds(4));
    yield* settle;
    const beforeFive = opened.length;
    yield* TestClock.adjust(TERMINAL_RECONNECT.STARTING_EVERY);
    yield* settle;
    yield* ready.attached;
    yield* settle;

    assert.equal(beforeFive, 1);
    assert.equal(opened.length, 2);
    assert.deepEqual(states(), [
      state(TERMINAL_CONNECTION.CONNECTING),
      state(TERMINAL_CONNECTION.STARTING),
      state(TERMINAL_CONNECTION.ATTACHED),
    ]);
  }),
);

it.effect("output past the watermark pauses the socket until the tab acks it down", () =>
  Effect.gen(function* () {
    const { call, hand } = yield* subject();
    const relay = yield* scriptedSocket;

    yield* call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
    yield* hand(relay.opening);
    yield* relay.attached;
    yield* relay.push({ bytes: new Uint8Array(60_000) });
    yield* relay.push({ bytes: new Uint8Array(60_000) });
    yield* settle;
    const pausedAt = [...relay.flow];
    yield* call(GATEWAY_METHOD.TERMINALS_ACK, { connectionId: CONNECTION_ID, bytes: 100_000 });
    const afterPartialAck = [...relay.flow];
    yield* call(GATEWAY_METHOD.TERMINALS_ACK, { connectionId: CONNECTION_ID, bytes: 20_000 });

    assert.deepEqual(pausedAt, ["pause"], "120,000 unacked bytes pause the socket once");
    assert.deepEqual(afterPartialAck, ["pause"], "20,000 still unacked keep it paused");
    assert.deepEqual(relay.flow, ["pause", "resume"]);
  }),
);

it.effect(
  "a refused bearer is renewed once, and a refusal of the renewed one ends the connection as gone",
  () =>
    Effect.gen(function* () {
      const renewed = yield* subject({ bearers: ["stale", "fresh"] });
      const relay = yield* scriptedSocket;
      const refused = yield* subject({ bearers: ["stale"] });

      yield* renewed.call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
      yield* renewed.hand({ refused: 401 });
      yield* renewed.hand(relay.opening);
      yield* relay.attached;
      yield* settle;
      yield* refused.call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
      yield* refused.hand({ refused: 401 });
      yield* settle;

      assert.deepEqual(
        renewed.opened.map((open) => open.authorization),
        ["Bearer stale", "Bearer fresh"],
      );
      assert.deepEqual(renewed.states().at(-1), state(TERMINAL_CONNECTION.ATTACHED));
      assert.equal(refused.opened.length, 1, "a bearer that did not change is not sent again");
      assert.deepEqual(refused.states().at(-1), state(TERMINAL_CONNECTION.GONE));
    }),
);

it.effect("a wake opens a waiting connection again at once", () =>
  Effect.gen(function* () {
    const { call, hand, opened } = yield* subject();

    yield* call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
    yield* hand({ unreachable: true });
    yield* hand({ unreachable: true });
    yield* hand({ unreachable: true });
    yield* settle;
    yield* TestClock.adjust(TERMINAL_RECONNECT.FIRST);
    yield* settle;
    const beforeWake = opened.length;
    yield* call(GATEWAY_METHOD.TERMINALS_WAKE);
    yield* settle;

    assert.equal(beforeWake, 2);
    assert.equal(opened.length, 3, "the wake does not wait out the second wait");
  }),
);

it.effect("a detach ends the connection, and a sign-out's reset tells each tab it is idle", () =>
  Effect.gen(function* () {
    const detached = yield* subject();
    const reset = yield* subject();
    const relay = yield* scriptedSocket;

    yield* detached.call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
    yield* detached.hand({ unreachable: true });
    yield* settle;
    yield* detached.call(GATEWAY_METHOD.TERMINALS_DISCONNECT, { connectionId: CONNECTION_ID });
    yield* TestClock.adjust(Duration.minutes(1));
    yield* reset.call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
    yield* reset.hand(relay.opening);
    yield* relay.attached;
    yield* settle;
    yield* reset.composer.reset;
    yield* relay.push({ bytes: encode("late") });
    yield* settle;

    assert.equal(detached.opened.length, 1, "a detached connection is not opened again");
    assert.deepEqual(reset.states().at(-1), state(TERMINAL_CONNECTION.IDLE));
    assert.deepEqual(reset.printed(), [], "nothing is handed up after the reset");
  }),
);

it.effect("a resize while the socket opens reaches the shell once it has", () =>
  Effect.gen(function* () {
    const { call, hand, opened } = yield* subject();
    const relay = yield* scriptedSocket;

    yield* call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
    yield* settle;
    yield* call(GATEWAY_METHOD.TERMINALS_RESIZE, {
      connectionId: CONNECTION_ID,
      cols: 100,
      rows: 30,
    });
    yield* hand(relay.opening);
    yield* settle;

    assert.equal(new URL(opened[0]?.url ?? "").searchParams.get("cols"), "120");
    assert.deepEqual(relay.sent, [
      { text: JSON.stringify({ type: TERMINAL_RELAY_FRAME.RESIZE, cols: 100, rows: 30 }) },
    ]);
  }),
);

it.effect(
  "what is typed while a connection reopens reaches the shell once it attaches, and typing on an ended one is let go",
  () =>
    Effect.gen(function* () {
      const { call, hand } = yield* subject();
      const relay = yield* scriptedSocket;
      const type = (data: string) =>
        call(GATEWAY_METHOD.TERMINALS_INPUT, { connectionId: CONNECTION_ID, data });

      yield* call(GATEWAY_METHOD.TERMINALS_CONNECT, connected());
      yield* hand({ unreachable: true });
      yield* settle;
      yield* type("git ");
      yield* type("status\r");
      yield* hand(relay.opening);
      yield* TestClock.adjust(TERMINAL_RECONNECT.FIRST);
      yield* settle;
      const beforeAttach = [...relay.sent];
      yield* relay.attached;
      yield* settle;
      yield* relay.close(TERMINAL_RELAY_CLOSE.IDLE);
      yield* settle;
      yield* type("lost");

      assert.deepEqual(beforeAttach, [], "nothing is sent before the shell is attached");
      assert.deepEqual(relay.sent, [{ bytes: encode("git ") }, { bytes: encode("status\r") }]);
    }),
);
