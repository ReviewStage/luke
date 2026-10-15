/**
 * relay.ts -- one attached shell: the desktop's socket piped to the shell's PTY in the agent's sandbox, held while someone types and closed when nobody has for five minutes.
 *
 * A connection reaches its agent through the one rule every agent route
 * keeps, then attaches only to a sandbox that is running: a stopped one is
 * never woken here, which is the developer's resume and nothing else, and
 * one the agent has not opened yet is said to be starting. The shell is a
 * tmux session that outlives this connection, so a socket that drops — a
 * sleep, a network change, the function's own bound — reattaches to the same
 * process on the next. What was typed goes to the PTY as it came and what
 * the shell printed comes back as it came; neither is read, kept, logged, or
 * counted, here or anywhere the relay writes.
 *
 * The connection holds the agent's sandbox through the lease every terminal
 * of it shares (`sandbox-terminal-lease.ts`): an attach holds it, and typing
 * moves it on, written at most once a minute and so held a minute past the
 * idle bound, which no keystroke between two writes outlasts. Each
 * connection closes as idle once nobody has typed in it for the bound,
 * whatever its sandbox's other terminals do, and the sweep stops the
 * sandbox once the lease every terminal moved on has lapsed past its grace.
 * While a terminal is connected, the GitHub token at the sandbox's firewall
 * is kept fresh on the rule the agent's own steps keep it by, claimed
 * through the lease so two windows mint one token between them; a renewal
 * that fails gives its claim back, is logged, and is tried again at the
 * next check. The shell is said to be attached once the first renewal has
 * ended, so a command typed at once finds the token set, and what was typed
 * before waits for it, up to a bound past which the shell attaches at once.
 *
 * How the connection ended is the close code the desktop reads as the tab's
 * state (`@luke/features/terminal-wire`'s `TERMINAL_RELAY_CLOSE`).
 */

import {
  SANDBOX_STATE,
  TERMINAL_RELAY_CLOSE,
  TERMINAL_RELAY_FRAME,
  terminalRelayResizeSchema,
} from "@luke/features/terminal-wire";
import { readEither } from "@luke/wire/effect";
import {
  type Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Option,
  Queue,
  type Redacted,
  Ref,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { CODER } from "../agents/coder-host/bounds.js";
import type { AgentSandboxService } from "../agents/terminal/agent-sandbox.js";
import { attachTerminal, TMUX } from "../agents/terminal/tmux.js";
import type { InteractiveShell, SandboxUnavailable } from "../agents/vercel-sandbox-api.js";
import { unparsedWire } from "../core.js";
import { frameBytes } from "../voice/socket.js";

const TERMINAL_RELAY_BOUNDS = {
  /** How long a terminal stays connected past its last keystroke. */
  IDLE: Duration.minutes(5),
  /** How often typing moves the lease on, so a keystroke is not a write. */
  LEASE_WRITE_EVERY: Duration.minutes(1),
  /** How often a connection asks whether it has gone the idle bound untyped in. */
  IDLE_CHECK_EVERY: Duration.seconds(30),
  /** How often a connection asks whether the GitHub token is due. */
  CREDENTIAL_CHECK_EVERY: Duration.minutes(5),
  /** The most the desktop may send while its shell waits on its first token, a paste's largest piece; past it the shell attaches without waiting longer, so what was sent reaches it rather than piling up. */
  HELD_MAX_BYTES: 1024 * 1024,
  /** The environment the shell's PTY starts in: a terminal that speaks colour, and text that is UTF-8. */
  ENV: ["TERM=xterm-256color", "COLORTERM=truecolor", "LANG=C.UTF-8"],
} as const;

/** One frame of a socket: text as text, binary as binary. */
export type RelayFrame = { readonly text: string } | { readonly bytes: Uint8Array };

/** One side of the relay: what it sends, in order and ending when it goes, and how to send to it and end it. */
export interface RelaySocket {
  readonly frames: Stream.Stream<RelayFrame>;
  readonly send: (frame: RelayFrame) => Effect.Effect<void>;
  readonly close: (code: number, reason?: string) => Effect.Effect<void>;
}

/** What a connection asks for: whose it is, the agent and shell it names, and the terminal's size. */
export interface RelayAsk {
  readonly userId: string;
  readonly agentId: string;
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

/** The agent a connection reached: its conversation, whose lease it holds, and the eve session its sandbox is tagged with, none before it ran. */
export interface RelayAgent {
  readonly conversationId: string;
  readonly sessionId: string | undefined;
  /** A fresh GitHub token for the agent's repository, minted under the deployment's GitHub App. */
  readonly repositoryToken: Effect.Effect<Redacted.Redacted, unknown>;
}

/** What the relay stands on: the deployment's in production, a script's in a test. */
export interface RelayDependencies {
  /** The agent the account reaches by the one rule, standing; none for another workspace's, an archived agent, or no agent at all, and a failure where the store could not say. */
  readonly reach: (
    userId: string,
    agentId: string,
  ) => Effect.Effect<Option.Option<RelayAgent>, unknown>;
  readonly sandbox: AgentSandboxService;
  /** Opens the PTY's socket for the connection's scope. */
  readonly connect: (
    shell: InteractiveShell,
  ) => Effect.Effect<RelaySocket, SandboxUnavailable, Scope.Scope>;
  readonly hold: (conversationId: string, heldUntil: Date) => Effect.Effect<void>;
  /** Claims the token's renewal on the running sandbox session, once per lease per session within the refresh rule. */
  readonly claimRenewal: (
    conversationId: string,
    sandboxSessionId: string,
    now: Date,
    renewedBefore: Date,
  ) => Effect.Effect<boolean>;
  /** Gives back a renewal claimed at the instant given that did not finish. */
  readonly releaseRenewal: (
    conversationId: string,
    sandboxSessionId: string,
    claimedAt: Date,
  ) => Effect.Effect<void>;
}

/** How the relay ends its own socket to the PTY, whatever ended the pipe: the shell goes on in tmux. */
const NORMAL_CLOSE = 1000;

/** Why the pipe ended, which picks the close the desktop reads. */
const PIPE_END = {
  DEVICE_LEFT: "device-left",
  UPSTREAM_LEFT: "upstream-left",
  EXITED: "exited",
  IDLE: "idle",
} as const;

type PipeEnd = (typeof PIPE_END)[keyof typeof PIPE_END];

/** The PTY server's exit frame, the one text frame it sends of its own. */
const PtyExitSchema = Schema.Struct({ type: Schema.Literal("exit"), code: Schema.Int });

const readResize = readEither(terminalRelayResizeSchema);
const readPtyExit = readEither(PtyExitSchema);

/** A text frame's JSON, or nothing a reader takes where it is none. */
function jsonOf(text: string) {
  const parsed = Result.try(() => JSON.parse(text));
  return unparsedWire(Result.isSuccess(parsed) ? parsed.success : undefined);
}

const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis));

/** The instant the lease reaches to from a write at the instant given: the idle bound, and the minute a keystroke after this write may wait for the next. */
function heldFrom(instant: Date): Date {
  const reach = Duration.sum(TERMINAL_RELAY_BOUNDS.IDLE, TERMINAL_RELAY_BOUNDS.LEASE_WRITE_EVERY);
  return new Date(instant.getTime() + Duration.toMillis(reach));
}

/** The GitHub token renewed at the firewall where this connection claims it, on the agent's own rule; a renewal that failed or was cut off gives the claim back, and the next check tries again. */
function renewCredential(
  deps: RelayDependencies,
  agent: RelayAgent,
  sandboxSessionId: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const at = yield* now;
    const renewedBefore = new Date(at.getTime() - Duration.toMillis(CODER.GITHUB_TOKEN_REFRESH));
    const claimed = yield* deps.claimRenewal(
      agent.conversationId,
      sandboxSessionId,
      at,
      renewedBefore,
    );
    if (!claimed) return;
    yield* Effect.flatMap(agent.repositoryToken, (token) =>
      deps.sandbox.setGitHubToken(sandboxSessionId, token),
    ).pipe(
      // Note that a connection closing mid-renewal interrupts it, and the claim goes back then too.
      Effect.onError(() => deps.releaseRenewal(agent.conversationId, sandboxSessionId, at)),
      Effect.catch(() => Effect.logWarning("a terminal's GitHub credential was not renewed")),
    );
  });
}

/**
 * The desktop's frames read into the relay's own queue, which ends when the
 * desktop goes. Until the shell attaches, `held` counts the bytes the queue
 * holds for it, and `overheld` is done once they pass the bound, so a mint
 * GitHub is slow to answer never has the relay hold whatever the desktop goes
 * on sending and never drops a byte of it either; once the shell attaches
 * `held` is none and the PTY takes what comes.
 */
function readDevice(
  device: RelaySocket,
  fromDevice: Queue.Queue<RelayFrame, Cause.Done>,
  held: Ref.Ref<number | undefined>,
  overheld: Deferred.Deferred<void>,
): Effect.Effect<void> {
  const read = Stream.runForEach(device.frames, (frame) =>
    Effect.gen(function* () {
      const bytes = yield* Ref.updateAndGet(held, (sum) =>
        sum === undefined ? undefined : sum + frameBytes(frame),
      );
      if (bytes !== undefined && bytes > TERMINAL_RELAY_BOUNDS.HELD_MAX_BYTES) {
        yield* Deferred.succeed(overheld, undefined);
      }
      yield* Queue.offer(fromDevice, frame);
    }),
  );
  return Effect.ensuring(read, Queue.end(fromDevice));
}

/** The desktop's frames to the PTY: typing as it came, noted as this connection's last and moving the lease on at most once a minute, and a resize as the PTY's own frame. */
function deviceToPty(
  deps: RelayDependencies,
  agent: RelayAgent,
  lastTyped: Ref.Ref<number>,
  fromDevice: Stream.Stream<RelayFrame>,
  pty: RelaySocket,
): Effect.Effect<PipeEnd> {
  return Effect.gen(function* () {
    const lastHeld = yield* Ref.make((yield* now).getTime());
    yield* Stream.runForEach(fromDevice, (frame) => {
      if ("bytes" in frame) {
        return Effect.andThen(
          Effect.gen(function* () {
            const at = yield* now;
            yield* Ref.set(lastTyped, at.getTime());
            const since = at.getTime() - (yield* Ref.get(lastHeld));
            if (since < Duration.toMillis(TERMINAL_RELAY_BOUNDS.LEASE_WRITE_EVERY)) return;
            yield* Ref.set(lastHeld, at.getTime());
            yield* deps.hold(agent.conversationId, heldFrom(at));
          }),
          pty.send(frame),
        );
      }
      const resize = readResize(jsonOf(frame.text));
      if (Result.isFailure(resize)) return Effect.void;
      const { cols, rows } = resize.success;
      return pty.send({ text: JSON.stringify({ type: TERMINAL_RELAY_FRAME.RESIZE, cols, rows }) });
    });
    return PIPE_END.DEVICE_LEFT;
  });
}

/** The PTY's frames to the desktop: output as it came, and its exit as the relay's own frame, which ends the pipe. */
function ptyToDevice(device: RelaySocket, pty: RelaySocket): Effect.Effect<PipeEnd> {
  return Effect.gen(function* () {
    const exited = yield* Ref.make(false);
    yield* Stream.runForEachWhile(pty.frames, (frame) => {
      if ("bytes" in frame) return Effect.as(device.send(frame), true);
      const exit = readPtyExit(jsonOf(frame.text));
      // A text frame that is not the exit is output the PTY server sent as text.
      if (Result.isFailure(exit)) {
        return Effect.as(device.send({ bytes: new TextEncoder().encode(frame.text) }), true);
      }
      const { code } = exit.success;
      return Effect.as(
        Effect.andThen(
          Ref.set(exited, true),
          device.send({ text: JSON.stringify({ type: TERMINAL_RELAY_FRAME.EXITED, code }) }),
        ),
        false,
      );
    });
    return (yield* Ref.get(exited)) ? PIPE_END.EXITED : PIPE_END.UPSTREAM_LEFT;
  });
}

/** Ends once nobody has typed in this connection for the idle bound, whatever the sandbox's other terminals do. */
function idleWatch(lastTyped: Ref.Ref<number>): Effect.Effect<PipeEnd> {
  const typedLately = Effect.gen(function* () {
    const since = (yield* now).getTime() - (yield* Ref.get(lastTyped));
    return since < Duration.toMillis(TERMINAL_RELAY_BOUNDS.IDLE);
  });
  return Effect.as(
    Effect.repeat(typedLately, {
      schedule: Schedule.spaced(TERMINAL_RELAY_BOUNDS.IDLE_CHECK_EVERY),
      while: (typed) => typed,
    }),
    PIPE_END.IDLE,
  );
}

/** The close each end of the pipe is answered with; a desktop that left takes nothing. */
const CLOSE_OF_END = {
  [PIPE_END.UPSTREAM_LEFT]: TERMINAL_RELAY_CLOSE.UNAVAILABLE,
  [PIPE_END.EXITED]: TERMINAL_RELAY_CLOSE.EXITED,
  [PIPE_END.IDLE]: TERMINAL_RELAY_CLOSE.IDLE,
} as const satisfies Record<Exclude<PipeEnd, typeof PIPE_END.DEVICE_LEFT>, number>;

/** One connection, from its reach to its close, everything it opens belonging to the scope it runs in. */
export function relayTerminal(
  device: RelaySocket,
  ask: RelayAsk,
  deps: RelayDependencies,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const reached = yield* Effect.result(deps.reach(ask.userId, ask.agentId));
    if (Result.isFailure(reached)) return yield* device.close(TERMINAL_RELAY_CLOSE.UNAVAILABLE);
    if (Option.isNone(reached.success)) return yield* device.close(TERMINAL_RELAY_CLOSE.GONE);
    const agent = reached.success.value;
    if (agent.sessionId === undefined) return yield* device.close(TERMINAL_RELAY_CLOSE.STARTING);
    const attached = yield* Effect.result(deps.sandbox.attach(agent.sessionId, ask.terminalId));
    if (Result.isFailure(attached)) return yield* device.close(TERMINAL_RELAY_CLOSE.UNAVAILABLE);
    const sandbox = attached.success;
    if ("gone" in sandbox) return yield* device.close(TERMINAL_RELAY_CLOSE.GONE);
    if (sandbox.state !== SANDBOX_STATE.RUNNING) {
      return yield* device.close(
        sandbox.state === SANDBOX_STATE.STOPPED
          ? TERMINAL_RELAY_CLOSE.STOPPED
          : TERMINAL_RELAY_CLOSE.STARTING,
      );
    }
    // An attach is the developer using the terminal: it holds the sandbox, and starts its idle bound.
    const attachedAt = yield* now;
    const lastTyped = yield* Ref.make(attachedAt.getTime());
    yield* deps.hold(agent.conversationId, heldFrom(attachedAt));
    // Note that the desktop's frames are read from here on into a queue of the relay's own, because the first renewal waits on the desktop leaving while what it typed waits for the shell.
    const fromDevice = yield* Queue.make<RelayFrame, Cause.Done>();
    const held = yield* Ref.make<number | undefined>(0);
    const overheld = yield* Deferred.make<void>();
    const deviceLeft = yield* Effect.forkScoped(readDevice(device, fromDevice, held, overheld));
    const firstRenewed = yield* Deferred.make<void>();
    yield* Effect.forkScoped(
      Effect.repeat(
        Effect.andThen(
          renewCredential(deps, agent, sandbox.sandboxSessionId),
          Deferred.succeed(firstRenewed, undefined),
        ),
        { schedule: Schedule.spaced(TERMINAL_RELAY_BOUNDS.CREDENTIAL_CHECK_EVERY) },
      ),
    );
    const pty = yield* Effect.result(deps.connect(sandbox.shell));
    if (Result.isFailure(pty)) return yield* device.close(TERMINAL_RELAY_CLOSE.UNAVAILABLE);
    const start = attachTerminal(ask.terminalId);
    yield* pty.success.send({
      text: JSON.stringify({
        type: "start",
        command: start.command,
        args: start.args,
        env: TERMINAL_RELAY_BOUNDS.ENV,
        cwd: TMUX.START_DIRECTORY,
        cols: ask.cols,
        rows: ask.rows,
      }),
    });
    // A shell is attached once its sandbox's firewall holds a token, so a command typed at once reaches GitHub; a desktop that leaves first ends the renewal with the scope.
    // Note that a desktop sending past the bound is attached at once instead, its renewal going on beside the pipe, because what it sent is owed to the shell.
    const leftFirst = yield* Effect.raceAll([
      Effect.as(Deferred.await(firstRenewed), false),
      Effect.as(Deferred.await(overheld), false),
      Effect.as(Fiber.join(deviceLeft), true),
    ]);
    yield* Ref.set(held, undefined);
    if (leftFirst) return yield* pty.success.close(NORMAL_CLOSE);
    yield* device.send({ text: JSON.stringify({ type: TERMINAL_RELAY_FRAME.ATTACHED }) });
    const end = yield* Effect.raceAll([
      deviceToPty(deps, agent, lastTyped, Stream.fromQueue(fromDevice), pty.success),
      ptyToDevice(device, pty.success),
      idleWatch(lastTyped),
    ]);
    yield* pty.success.close(NORMAL_CLOSE);
    if (end !== PIPE_END.DEVICE_LEFT) yield* device.close(CLOSE_OF_END[end]);
  });
}
