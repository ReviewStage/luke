import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { TUNNEL_CLOSE, TUNNEL_KIND } from "@repo/features/sandbox-tunnel-wire";
import { SANDBOX_STATE, type SandboxState } from "@repo/features/terminal-wire";
import {
  type Cause,
  Clock,
  Duration,
  Effect,
  Fiber,
  Option,
  Queue,
  Redacted,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import type { RelayFrame, RelaySocket } from "../terminal/relay.js";
import { relayTunnel, type TunnelDependencies } from "./relay.js";

/**
 * One tunnel as the relay pipes it, over sockets and a sandbox that answer
 * from a script, on the test clock: a stopped sandbox is never woken and
 * the tunnel closes as not running; a running one starts the port bridge,
 * and once it is ready frames cross both ways, holding the sandbox as they
 * do, until twenty minutes without a byte close the tunnel as idle and end
 * its keep-alive.
 */

const CONVERSATION = "conversation-1";
const ASK = {
  userId: "user-1",
  agentId: "agent-1",
  bridge: { kind: TUNNEL_KIND.PORT_FORWARD, port: 5173 },
} as const;
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const OPEN = JSON.stringify({ type: "open", channel: 1 });
const DATA = JSON.stringify({ type: "data", channel: 1, data: "aGk=" });

/** One side of the relay as a test drives it: frames pushed in, what the relay sent, and how it closed, kept. */
const scriptedSocket = Effect.gen(function* () {
  const inbound = yield* Queue.make<RelayFrame, Cause.Done>();
  const sent: RelayFrame[] = [];
  const closed: number[] = [];
  const socket: RelaySocket = {
    frames: Stream.fromQueue(inbound),
    send: (frame) => Effect.sync(() => void sent.push(frame)),
    close: (code) =>
      Effect.andThen(
        Effect.sync(() => void closed.push(code)),
        Queue.end(inbound),
      ),
  };
  return { socket, push: (frame: RelayFrame) => Queue.offer(inbound, frame), sent, closed };
});

type Scripted = Effect.Success<typeof scriptedSocket>;

/** The relay's world: the agent reached, its sandbox standing as given, the lease, and every keep-alive asked. */
function world(pty: Scripted, sandbox: SandboxState = SANDBOX_STATE.RUNNING) {
  let heldUntil = 0;
  const asked = { opened: 0, connected: 0, keptAlive: [] as number[] };
  const deps: TunnelDependencies = {
    reach: () => Effect.succeed(Option.some({ conversationId: CONVERSATION, sessionId: "wrun_1" })),
    open: () =>
      Effect.sync(() => {
        asked.opened += 1;
        return sandbox === SANDBOX_STATE.RUNNING
          ? { state: sandbox, shell: { url: "wss://pty.test", token: Redacted.make("pty-token") } }
          : { state: sandbox };
      }),
    connect: () =>
      Effect.sync(() => {
        asked.connected += 1;
        return pty.socket;
      }),
    hold: (_conversation, until) =>
      Effect.sync(() => {
        heldUntil = Math.max(heldUntil, until.getTime());
      }),
    keepAlive: () =>
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        Effect.sync(() => void asked.keptAlive.push(at)),
      ),
  };
  return { deps, asked, heldUntil: () => heldUntil };
}

/** Lets every fiber the last step woke run to its next wait. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
  discard: true,
});

const lines = (sent: readonly RelayFrame[]) =>
  sent.flatMap((frame) => ("bytes" in frame ? [decode(frame.bytes)] : []));

const ready = { bytes: encode(`${JSON.stringify({ bridge: "ready" })}\r\n`) };

it.effect("a stopped sandbox is never woken: the tunnel closes as not running", () =>
  Effect.gen(function* () {
    const device = yield* scriptedSocket;
    const pty = yield* scriptedSocket;
    const { deps, asked, heldUntil } = world(pty, SANDBOX_STATE.STOPPED);

    yield* Effect.scoped(relayTunnel(device.socket, ASK, deps));

    assert.deepEqual(device.closed, [TUNNEL_CLOSE.NOT_RUNNING]);
    assert.equal(asked.connected, 0);
    assert.equal(heldUntil(), 0);
  }),
);

it.effect(
  "frames cross once the bridge is ready, holding the sandbox, until twenty idle minutes close it",
  () =>
    Effect.gen(function* () {
      const device = yield* scriptedSocket;
      const pty = yield* scriptedSocket;
      const { deps, asked, heldUntil } = world(pty);
      const start = yield* Clock.currentTimeMillis;

      const relay = yield* Effect.forkChild(Effect.scoped(relayTunnel(device.socket, ASK, deps)));
      yield* settle;
      // Sent before the bridge is ready, so it waits rather than reaching a PTY that would echo it.
      yield* device.push({ text: OPEN });
      yield* settle;
      const startFrame = JSON.parse("text" in pty.sent[0]! ? pty.sent[0].text : "{}");
      assert.equal(startFrame.args.at(-1), "5173");
      assert.deepEqual(lines(pty.sent), []);
      assert.equal(heldUntil(), start + Duration.toMillis(Duration.minutes(21)));

      yield* pty.push(ready);
      yield* pty.push({ bytes: encode(`${DATA}\r\n`) });
      yield* settle;
      assert.deepEqual(lines(pty.sent), [`${OPEN}\n`]);
      assert.deepEqual(device.sent, [{ text: DATA }]);

      // Traffic ten minutes on moves the lease on and the idle bound with it.
      yield* TestClock.adjust(Duration.minutes(10));
      yield* device.push({ text: DATA });
      yield* settle;
      assert.equal(heldUntil(), start + Duration.toMillis(Duration.minutes(31)));
      yield* TestClock.adjust(Duration.minutes(19));
      assert.deepEqual(device.closed, []);

      yield* TestClock.adjust(Duration.minutes(2));
      yield* Fiber.join(relay);
      const keptAlive = asked.keptAlive.length;
      yield* TestClock.adjust(Duration.minutes(30));

      assert.deepEqual(device.closed, [TUNNEL_CLOSE.IDLE]);
      assert.equal(asked.keptAlive.length, keptAlive);
      assert.ok(keptAlive >= 3);
    }),
);
