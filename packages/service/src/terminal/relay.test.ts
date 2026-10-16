import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  SANDBOX_STATE,
  type SandboxState,
  TERMINAL_RELAY_CLOSE,
  TERMINAL_RELAY_FRAME,
} from "@luke/features/terminal-wire";
import {
  type Cause,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Option,
  Queue,
  Redacted,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import type { AgentSandboxService } from "../agents/terminal/agent-sandbox.js";
import {
  type RelayAgent,
  type RelayDependencies,
  type RelayFrame,
  type RelaySocket,
  relayTerminal,
} from "./relay.js";

/**
 * One attached shell as the relay pipes it, over sockets and a sandbox that
 * answer from a script, on the test clock: an agent the account does not
 * reach is gone, one with no sandbox yet is starting, a stopped sandbox is
 * never woken, and a running one is attached through tmux, typing and
 * resizes reaching the PTY and its output reaching the desktop; the shell's
 * exit ends the connection as exited; nobody typing for the idle bound ends
 * it as idle, and typing keeps it; and the GitHub token at the firewall is
 * set when due, once between two connections.
 */

const AGENT = "agent-1";
const SHELL = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const CONVERSATION = "conversation-1";
const SANDBOX_SESSION = "sbs_running";
const ASK = { userId: "user-1", agentId: AGENT, terminalId: SHELL, cols: 120, rows: 32 };
const encode = (text: string) => new TextEncoder().encode(text);

/** One side of the relay as a test drives it: frames pushed in, and what the relay sent and how it closed, kept. */
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
  return {
    socket,
    push: (frame: RelayFrame) => Queue.offer(inbound, frame),
    leave: Queue.end(inbound),
    sent,
    closed,
  };
});

type Scripted = Effect.Success<typeof scriptedSocket>;

/** The relay's world as the scenario has it: the agent reached or not, its sandbox standing as given, and one lease every connection shares. */
function world(options: {
  readonly agent?: Option.Option<RelayAgent>;
  readonly sandbox?: SandboxState;
  readonly pty: Scripted;
  /** Whether tmux holds no such shell. */
  readonly shellGone?: boolean;
  /** How many of the first mints GitHub refuses. */
  readonly tokensRefused?: number;
  /** What GitHub answers a mint only after; never, where it is never done. */
  readonly tokensWait?: Deferred.Deferred<void>;
}) {
  let heldUntil = 0;
  let credentialAt: number | undefined;
  const policies: string[] = [];
  const asked = { attached: 0, resumed: 0, tokens: 0, released: 0, policies };
  const sandbox: AgentSandboxService = {
    terminals: () => Effect.die("the relay lists nothing"),
    start: () => Effect.die("the relay starts nothing"),
    rename: () => Effect.die("the relay renames nothing"),
    kill: () => Effect.die("the relay kills nothing"),
    snapshot: () => Effect.die("the relay takes no snapshot"),
    resume: () =>
      Effect.sync(() => {
        asked.resumed += 1;
        return SANDBOX_STATE.RUNNING;
      }),
    attach: () =>
      Effect.sync(() => {
        asked.attached += 1;
        const state = options.sandbox ?? SANDBOX_STATE.RUNNING;
        if (state === SANDBOX_STATE.RUNNING && options.shellGone === true) {
          return { state, gone: true } as const;
        }
        return state === SANDBOX_STATE.RUNNING
          ? {
              state,
              sandboxSessionId: SANDBOX_SESSION,
              shell: { url: "wss://pty.test", token: Redacted.make("pty-token") },
            }
          : { state };
      }),
    setGitHubToken: (sandboxSessionId) =>
      Effect.sync(() => void asked.policies.push(sandboxSessionId)),
  };
  const agent: RelayAgent = {
    conversationId: CONVERSATION,
    sessionId: "wrun_1",
    repositoryToken: Effect.suspend(() => {
      asked.tokens += 1;
      const answer =
        asked.tokens <= (options.tokensRefused ?? 0)
          ? Effect.fail("GitHub refused the mint")
          : Effect.succeed(Redacted.make("ghs_fixture"));
      return options.tokensWait === undefined
        ? answer
        : Effect.andThen(Deferred.await(options.tokensWait), answer);
    }),
  };
  const deps: RelayDependencies = {
    reach: () => Effect.succeed(options.agent ?? Option.some(agent)),
    sandbox,
    connect: () => Effect.succeed(options.pty.socket),
    hold: (_conversation, until) =>
      Effect.sync(() => {
        heldUntil = Math.max(heldUntil, until.getTime());
      }),
    claimRenewal: (_conversation, _session, now, renewedBefore) =>
      Effect.sync(() => {
        if (credentialAt !== undefined && credentialAt >= renewedBefore.getTime()) return false;
        credentialAt = now.getTime();
        return true;
      }),
    releaseRenewal: (_conversation, _session, claimedAt) =>
      Effect.sync(() => {
        asked.released += 1;
        if (credentialAt === claimedAt.getTime()) credentialAt = undefined;
      }),
  };
  return { deps, asked, heldUntil: () => heldUntil };
}

/** Lets every fiber the last step woke, the relay's own renewals among them, run to its next wait. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
  discard: true,
});

const texts = (sent: readonly RelayFrame[]) =>
  sent.flatMap((frame) => ("text" in frame ? [JSON.parse(frame.text)] : []));

it.effect(
  "an agent the account does not reach is gone, and one with no sandbox yet is starting",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const gone = yield* scriptedSocket;
      const starting = yield* scriptedSocket;
      const unreached = world({ agent: Option.none(), pty });
      const unopened = world({
        agent: Option.some({
          conversationId: CONVERSATION,
          sessionId: undefined,
          repositoryToken: Effect.die("no token"),
        }),
        pty,
      });

      yield* Effect.scoped(relayTerminal(gone.socket, ASK, unreached.deps));
      yield* Effect.scoped(relayTerminal(starting.socket, ASK, unopened.deps));

      assert.deepEqual(gone.closed, [TERMINAL_RELAY_CLOSE.GONE]);
      assert.deepEqual(starting.closed, [TERMINAL_RELAY_CLOSE.STARTING]);
      assert.equal(unreached.asked.attached + unopened.asked.attached, 0);
    }),
);

it.effect(
  "a store that could not say whether the account reaches the agent closes as unavailable, never as gone",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const device = yield* scriptedSocket;
      const outage = world({ pty });

      yield* Effect.scoped(
        relayTerminal(device.socket, ASK, {
          ...outage.deps,
          reach: () => Effect.fail("store down"),
        }),
      );

      assert.deepEqual(device.closed, [TERMINAL_RELAY_CLOSE.UNAVAILABLE]);
    }),
);

it.effect("a shell tmux does not hold closes as gone, and is never started by an attach", () =>
  Effect.gen(function* () {
    const pty = yield* scriptedSocket;
    const device = yield* scriptedSocket;
    const missing = world({ pty, shellGone: true });

    yield* Effect.scoped(relayTerminal(device.socket, ASK, missing.deps));

    assert.deepEqual(device.closed, [TERMINAL_RELAY_CLOSE.GONE]);
    assert.deepEqual(pty.sent, [], "no start frame reaches a PTY");
  }),
);

it.effect("a stopped sandbox closes as stopped, is never woken, and is not held", () =>
  Effect.gen(function* () {
    const pty = yield* scriptedSocket;
    const device = yield* scriptedSocket;
    const stopped = world({ sandbox: SANDBOX_STATE.STOPPED, pty });

    yield* Effect.scoped(relayTerminal(device.socket, ASK, stopped.deps));

    assert.deepEqual(device.closed, [TERMINAL_RELAY_CLOSE.STOPPED]);
    assert.equal(stopped.asked.resumed, 0);
    assert.equal(stopped.heldUntil(), 0);
    assert.deepEqual(pty.sent, []);
  }),
);

it.effect(
  "a running sandbox's shell is attached through tmux, typing and resizes reach the PTY, and its output reaches the desktop",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const device = yield* scriptedSocket;
      const running = world({ pty });

      const relay = yield* Effect.forkChild(
        Effect.scoped(relayTerminal(device.socket, ASK, running.deps)),
      );
      yield* Effect.yieldNow;
      yield* device.push({ bytes: encode("ls\r") });
      yield* device.push({
        text: JSON.stringify({ type: TERMINAL_RELAY_FRAME.RESIZE, cols: 100, rows: 30 }),
      });
      yield* pty.push({ bytes: encode("README.md\r\n") });
      yield* Effect.yieldNow;
      yield* device.leave;
      yield* Fiber.join(relay);

      const [start, resize] = texts(pty.sent);
      assert.equal(start.type, "start");
      assert.equal(start.command, "sh", "tmux is installed where the sandbox lacks it, then run");
      assert.ok(
        start.args.includes(`=luke-${SHELL}`),
        "the start names the shell's session exactly",
      );
      assert.ok(
        start.args.includes("attach-session"),
        "a standing shell is attached, never started here",
      );
      assert.deepEqual([start.cols, start.rows], [ASK.cols, ASK.rows]);
      assert.deepEqual(resize, { type: TERMINAL_RELAY_FRAME.RESIZE, cols: 100, rows: 30 });
      assert.ok(
        pty.sent.some(
          (frame) => "bytes" in frame && new TextDecoder().decode(frame.bytes) === "ls\r",
        ),
      );
      assert.deepEqual(texts(device.sent), [{ type: TERMINAL_RELAY_FRAME.ATTACHED }]);
      assert.ok(
        device.sent.some(
          (frame) => "bytes" in frame && new TextDecoder().decode(frame.bytes) === "README.md\r\n",
        ),
      );
      assert.ok(running.heldUntil() > 0, "an attach holds the sandbox");
      assert.deepEqual(device.closed, [], "a desktop that left is sent no close");
    }),
);

it.effect("the shell's exit reaches the desktop as exited, and ends the connection as exited", () =>
  Effect.gen(function* () {
    const pty = yield* scriptedSocket;
    const device = yield* scriptedSocket;

    const relay = yield* Effect.forkChild(
      Effect.scoped(relayTerminal(device.socket, ASK, world({ pty }).deps)),
    );
    yield* Effect.yieldNow;
    yield* pty.push({ text: JSON.stringify({ type: "exit", code: 3 }) });
    yield* Fiber.join(relay);

    assert.deepEqual(texts(device.sent).at(-1), { type: TERMINAL_RELAY_FRAME.EXITED, code: 3 });
    assert.deepEqual(device.closed, [TERMINAL_RELAY_CLOSE.EXITED]);
  }),
);

it.effect(
  "a terminal nobody types in closes as idle once the lease lapses, and typing keeps it",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const device = yield* scriptedSocket;

      const relay = yield* Effect.forkChild(
        Effect.scoped(relayTerminal(device.socket, ASK, world({ pty }).deps)),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.minutes(4));
      yield* device.push({ bytes: encode("x") });
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.minutes(4));
      const keptByTyping = device.closed.length === 0;
      yield* TestClock.adjust(Duration.minutes(2));
      yield* Fiber.join(relay);

      assert.equal(keptByTyping, true, "typing four minutes in moves the lease on");
      assert.deepEqual(device.closed, [TERMINAL_RELAY_CLOSE.IDLE]);
    }),
);

it.effect(
  "the GitHub token is set at the firewall as a terminal attaches, once between two connections",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const first = yield* scriptedSocket;
      const second = yield* scriptedSocket;
      const shared = world({ pty });

      const one = yield* Effect.forkChild(
        Effect.scoped(relayTerminal(first.socket, ASK, shared.deps)),
      );
      const two = yield* Effect.forkChild(
        Effect.scoped(relayTerminal(second.socket, ASK, shared.deps)),
      );
      yield* settle;
      yield* first.leave;
      yield* second.leave;
      yield* Fiber.join(one);
      yield* Fiber.join(two);

      assert.equal(shared.asked.tokens, 1);
      assert.deepEqual(shared.asked.policies, [SANDBOX_SESSION]);
    }),
);

it.effect(
  "a terminal nobody types in closes as idle while a sibling of the same sandbox is typed in",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const otherPty = yield* scriptedSocket;
      const typed = yield* scriptedSocket;
      const untyped = yield* scriptedSocket;
      const shared = world({ pty });

      const one = yield* Effect.forkChild(
        Effect.scoped(relayTerminal(typed.socket, ASK, shared.deps)),
      );
      const two = yield* Effect.forkChild(
        Effect.scoped(
          relayTerminal(untyped.socket, ASK, {
            ...shared.deps,
            connect: () => Effect.succeed(otherPty.socket),
          }),
        ),
      );
      yield* Effect.yieldNow;
      for (const _minute of [1, 2, 3, 4, 5, 6]) {
        yield* TestClock.adjust(Duration.minutes(1));
        yield* typed.push({ bytes: encode("x") });
        yield* Effect.yieldNow;
      }
      yield* Fiber.join(two);
      const typedStillOpen = typed.closed.length === 0;
      yield* typed.leave;
      yield* Fiber.join(one);

      assert.deepEqual(untyped.closed, [TERMINAL_RELAY_CLOSE.IDLE]);
      assert.equal(typedStillOpen, true);
    }),
);

it.effect(
  "a keystroke between two lease writes keeps its terminal for the whole idle bound, and the lease reaches past it",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const device = yield* scriptedSocket;
      const shared = world({ pty });

      const relay = yield* Effect.forkChild(
        Effect.scoped(relayTerminal(device.socket, ASK, shared.deps)),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.seconds(59));
      yield* device.push({ bytes: encode("x") });
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.seconds(271));
      const openPastAttachBound = device.closed.length === 0;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* Fiber.join(relay);

      assert.equal(openPastAttachBound, true, "five minutes from the keystroke, not the attach");
      assert.deepEqual(device.closed, [TERMINAL_RELAY_CLOSE.IDLE]);
      assert.ok(
        shared.heldUntil() >= Duration.toMillis(Duration.minutes(5)) + 59_000,
        "the lease written at the attach reaches past the keystroke's idle bound",
      );
    }),
);

it.effect("a renewal GitHub refused gives its claim back, and the next check renews", () =>
  Effect.gen(function* () {
    const pty = yield* scriptedSocket;
    const device = yield* scriptedSocket;
    const refusing = world({ pty, tokensRefused: 1 });

    const relay = yield* Effect.forkChild(
      Effect.scoped(relayTerminal(device.socket, ASK, refusing.deps)),
    );
    yield* Effect.yieldNow;
    const afterRefusal = [...refusing.asked.policies];
    yield* device.push({ bytes: encode("x") });
    yield* TestClock.adjust(Duration.minutes(5));
    yield* Effect.yieldNow;
    yield* device.leave;
    yield* Fiber.join(relay);

    assert.deepEqual(afterRefusal, []);
    assert.equal(refusing.asked.released, 1);
    assert.deepEqual(refusing.asked.policies, [SANDBOX_SESSION]);
  }),
);

it.effect("a renewal cut off by its connection closing gives its claim back", () =>
  Effect.gen(function* () {
    const pty = yield* scriptedSocket;
    const device = yield* scriptedSocket;
    const hanging = world({ pty, tokensWait: yield* Deferred.make<void>() });

    const relay = yield* Effect.forkChild(
      Effect.scoped(relayTerminal(device.socket, ASK, hanging.deps)),
    );
    yield* settle;
    const releasedWhileMinting = hanging.asked.released;
    yield* Fiber.interrupt(relay);

    assert.equal(releasedWhileMinting, 0);
    assert.equal(hanging.asked.released, 1);
  }),
);

it.effect(
  "a first renewal GitHub never answers ends, and gives its claim back, when the desktop leaves",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const device = yield* scriptedSocket;
      const hanging = world({ pty, tokensWait: yield* Deferred.make<void>() });

      const relay = yield* Effect.forkChild(
        Effect.scoped(relayTerminal(device.socket, ASK, hanging.deps)),
      );
      yield* settle;
      yield* device.leave;
      yield* Fiber.join(relay);

      assert.deepEqual(texts(device.sent), [], "a shell with no token yet is never said attached");
      assert.deepEqual(device.closed, [], "a desktop that left is sent no close");
      assert.equal(hanging.asked.released, 1);
    }),
);

it.effect(
  "a shell is said attached, and what was typed reaches it, only once its first GitHub token is set",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const device = yield* scriptedSocket;
      const answered = yield* Deferred.make<void>();
      const slow = world({ pty, tokensWait: answered });
      const typed = () =>
        pty.sent.flatMap((frame) =>
          "bytes" in frame ? [new TextDecoder().decode(frame.bytes)] : [],
        );

      const relay = yield* Effect.forkChild(
        Effect.scoped(relayTerminal(device.socket, ASK, slow.deps)),
      );
      yield* settle;
      yield* device.push({ bytes: encode("git fetch\r") });
      yield* settle;
      const whileMinting = { attached: texts(device.sent), typed: typed() };
      yield* Deferred.succeed(answered, undefined);
      yield* settle;
      yield* device.leave;
      yield* Fiber.join(relay);

      assert.deepEqual(whileMinting, { attached: [], typed: [] });
      assert.deepEqual(texts(device.sent), [{ type: TERMINAL_RELAY_FRAME.ATTACHED }]);
      assert.deepEqual(typed(), ["git fetch\r"]);
      assert.deepEqual(slow.asked.policies, [SANDBOX_SESSION]);
    }),
);

it.effect(
  "a desktop that sends past the bound while its first token is minted is attached at once, every byte it sent reaching the shell",
  () =>
    Effect.gen(function* () {
      const pty = yield* scriptedSocket;
      const device = yield* scriptedSocket;
      const hanging = world({ pty, tokensWait: yield* Deferred.make<void>() });
      const paste = [encode("cat <<EOF\r"), new Uint8Array(1024 * 1024), encode("EOF\r")];

      const relay = yield* Effect.forkChild(
        Effect.scoped(relayTerminal(device.socket, ASK, hanging.deps)),
      );
      yield* settle;
      for (const bytes of paste) yield* device.push({ bytes });
      yield* settle;
      yield* device.leave;
      yield* Fiber.join(relay);

      assert.deepEqual(texts(device.sent), [{ type: TERMINAL_RELAY_FRAME.ATTACHED }]);
      assert.deepEqual(device.closed, []);
      assert.deepEqual(
        pty.sent.flatMap((frame) => ("bytes" in frame ? [frame.bytes] : [])),
        paste,
      );
      assert.equal(hanging.asked.released, 1, "the mint still pending ended with the desktop");
    }),
);
