/**
 * relay.ts -- one tunnel: the desktop's socket piped to a bridge in the PTY of the agent's running sandbox, holding the sandbox while bytes cross it and closing when none have for twenty minutes.
 *
 * A connection reaches its agent through the one rule every agent route
 * keeps, as a Terminal's does, then opens a PTY only on a sandbox that is
 * running: a stopped one is never woken here, since whatever the tunnel
 * would reach stopped with it, and one never opened is not running either.
 * The bridge the socket asked for starts in that PTY (`bridge.ts`), and
 * once it says it is ready each channel frame the desktop sends goes to it
 * as one line and each line it writes comes back as one frame. A frame is
 * read only for its shape; its bytes are never read, kept, logged, or
 * counted, here or anywhere the relay writes.
 *
 * Where the bridge's kind holds the sandbox (`TUNNEL_HOLDS_SANDBOX`), the
 * connection keeps the sandbox alive past its timeout every keep-alive
 * interval (`CODER.SANDBOX_KEEP_ALIVE_EVERY`) for as long as it stands, and
 * writes the lease every terminal shares (`sandbox-terminal-lease.ts`) as
 * the sign the turn-end stop reads that someone is using the sandbox: at
 * the open, and as bytes cross, at most once a minute. A connection closes
 * as idle once no byte has crossed it either way for the idle bound, which
 * ends its keep-alive, so the sandbox's own timeout stops it from there.
 *
 * How the connection ended is the close code the desktop reads as the
 * tunnel's state (`@repo/features/sandbox-tunnel-wire`'s `TUNNEL_CLOSE`).
 */

import { TUNNEL_CLOSE, tunnelFrameSchema } from "@repo/features/sandbox-tunnel-wire";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import { readEither } from "@repo/wire/effect";
import {
  Clock,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Option,
  Ref,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { CODER } from "../agents/coder-host/bounds.js";
import { ptyLinesOf } from "../agents/sandbox-pty.js";
import type { SandboxOpen } from "../agents/terminal/agent-sandbox.js";
import type { InteractiveShell, SandboxUnavailable } from "../agents/vercel-sandbox-api.js";
import { EXCESS_KEYS } from "../core.js";
import { jsonOf } from "../http/http-effect.js";
import type { RelaySocket } from "../terminal/relay.js";
import {
  TUNNEL_BRIDGE_WORD,
  TUNNEL_HOLDS_SANDBOX,
  type TunnelBridge,
  tunnelBridge,
} from "./bridge.js";

export const TUNNEL_RELAY_BOUNDS = {
  /** How long a tunnel stays connected past the last byte that crossed it either way. */
  IDLE: Duration.minutes(20),
  /** How often traffic moves the lease on, so a byte is not a write. */
  LEASE_WRITE_EVERY: Duration.minutes(1),
  /** How often a connection asks whether it has gone the idle bound without traffic. */
  IDLE_CHECK_EVERY: Duration.seconds(30),
  /** How long the bridge may take to say it is ready once its PTY is open. */
  READY_TIMEOUT: Duration.seconds(15),
  /** The PTY the bridge runs in: its size is nothing to it, and its text is UTF-8. */
  PTY: { COLS: 80, ROWS: 24, CWD: "/", ENV: ["TERM=dumb", "LANG=C.UTF-8"] },
} as const;

/** What a connection asks for: whose it is, the agent it names, and the bridge it reaches. */
export interface TunnelAsk {
  readonly userId: string;
  readonly agentId: string;
  readonly bridge: TunnelBridge;
}

/** The agent a connection reached: its conversation, whose lease it holds, and the eve session its sandbox is tagged with, none before it ran. */
export interface TunnelAgent {
  readonly conversationId: string;
  readonly sessionId: string | undefined;
}

/** What the relay stands on: the deployment's in production, a script's in a test. */
export interface TunnelDependencies {
  /** The agent the account reaches by the one rule, standing; none for another workspace's, an archived agent, or no agent at all, and a failure where the store could not say. */
  readonly reach: (
    userId: string,
    agentId: string,
  ) => Effect.Effect<Option.Option<TunnelAgent>, unknown>;
  /** A PTY minted on the running sandbox the eve session is tagged with, or where it stands; never a resume. */
  readonly open: (sessionId: string) => Effect.Effect<SandboxOpen, SandboxUnavailable>;
  /** Opens the PTY's socket for the connection's scope. */
  readonly connect: (
    shell: InteractiveShell,
  ) => Effect.Effect<RelaySocket, SandboxUnavailable, Scope.Scope>;
  readonly hold: (conversationId: string, heldUntil: Date) => Effect.Effect<void>;
  /** Keeps the running sandbox the eve session is tagged with alive the timeout from now; a keep-alive that fails is logged, for the next to try again. */
  readonly keepAlive: (sessionId: string) => Effect.Effect<void>;
}

/** How the relay ends its own socket to the PTY, whatever ended the pipe: the bridge ends with its input. */
const NORMAL_CLOSE = 1000;

/** Why the pipe ended, which picks the close the desktop reads. */
const PIPE_END = {
  DEVICE_LEFT: "device-left",
  BRIDGE_LEFT: "bridge-left",
  IDLE: "idle",
} as const;

type PipeEnd = (typeof PIPE_END)[keyof typeof PIPE_END];

/** The close each end of the pipe is answered with; a desktop that left takes nothing. */
const CLOSE_OF_END = {
  [PIPE_END.BRIDGE_LEFT]: TUNNEL_CLOSE.UNAVAILABLE,
  [PIPE_END.IDLE]: TUNNEL_CLOSE.IDLE,
} as const satisfies Record<Exclude<PipeEnd, typeof PIPE_END.DEVICE_LEFT>, number>;

const BridgeWordSchema = Schema.Struct({
  bridge: Schema.Literal(TUNNEL_BRIDGE_WORD.READY),
});

const readDeviceFrame = readEither(tunnelFrameSchema);
const readBridgeFrame = readEither(tunnelFrameSchema, { excess: EXCESS_KEYS.DROP });
const readBridgeWord = readEither(BridgeWordSchema, { excess: EXCESS_KEYS.DROP });

/** The instant the lease reaches to from a write at the instant given: the idle bound, and the minute traffic after this write may wait for the next. */
function heldFrom(instant: Date): Date {
  const reach = Duration.sum(TUNNEL_RELAY_BOUNDS.IDLE, TUNNEL_RELAY_BOUNDS.LEASE_WRITE_EVERY);
  return new Date(instant.getTime() + Duration.toMillis(reach));
}

/** Notes a byte crossing at the instant now, moving the lease on at most once a minute where the bridge's kind holds the sandbox. */
function crossed(
  deps: TunnelDependencies,
  agent: TunnelAgent,
  holds: boolean,
  lastCrossed: Ref.Ref<number>,
  lastHeld: Ref.Ref<number>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const at = yield* DateTime.nowAsDate;
    yield* Ref.set(lastCrossed, at.getTime());
    if (!holds) return;
    const since = at.getTime() - (yield* Ref.get(lastHeld));
    if (since < Duration.toMillis(TUNNEL_RELAY_BOUNDS.LEASE_WRITE_EVERY)) return;
    yield* Ref.set(lastHeld, at.getTime());
    yield* deps.hold(agent.conversationId, heldFrom(at));
  });
}

/** The desktop's frames to the bridge, one line each, a frame of no tunnel shape dropped. */
function deviceToBridge(
  device: RelaySocket,
  pty: RelaySocket,
  noteCrossed: Effect.Effect<void>,
): Effect.Effect<PipeEnd> {
  return Effect.as(
    Stream.runForEach(device.frames, (frame) => {
      if (!("text" in frame) || Result.isFailure(readDeviceFrame(jsonOf(frame.text)))) {
        return Effect.void;
      }
      // Note that a line break in valid JSON stands only between its tokens, so dropping it keeps the frame one line and whole.
      const line = `${frame.text.replace(/[\r\n]/g, "")}\n`;
      return Effect.andThen(noteCrossed, pty.send({ bytes: new TextEncoder().encode(line) }));
    }),
    PIPE_END.DEVICE_LEFT,
  );
}

/** The bridge's lines to the desktop, one frame each, from its ready word on; a line that is neither is the PTY's own output. */
function bridgeToDevice(
  device: RelaySocket,
  pty: RelaySocket,
  ready: Deferred.Deferred<void>,
  noteCrossed: Effect.Effect<void>,
): Effect.Effect<PipeEnd> {
  return Effect.as(
    Stream.runForEach(ptyLinesOf(pty.frames), (line) => {
      const value = jsonOf(line.replace(/\r$/, ""));
      if (Result.isSuccess(readBridgeWord(value))) return Deferred.succeed(ready, undefined);
      if (Result.isFailure(readBridgeFrame(value))) return Effect.void;
      return Effect.andThen(noteCrossed, device.send({ text: line.replace(/\r$/, "") }));
    }),
    PIPE_END.BRIDGE_LEFT,
  );
}

/** Ends once no byte has crossed the tunnel either way for the idle bound. */
function idleWatch(lastCrossed: Ref.Ref<number>): Effect.Effect<PipeEnd> {
  const crossedLately = Effect.gen(function* () {
    const since = (yield* Clock.currentTimeMillis) - (yield* Ref.get(lastCrossed));
    return since < Duration.toMillis(TUNNEL_RELAY_BOUNDS.IDLE);
  });
  return Effect.as(
    Effect.repeat(crossedLately, {
      schedule: Schedule.spaced(TUNNEL_RELAY_BOUNDS.IDLE_CHECK_EVERY),
      while: (lately) => lately,
    }),
    PIPE_END.IDLE,
  );
}

/** One tunnel, from its reach to its close, everything it opens belonging to the scope it runs in. */
export function relayTunnel(
  device: RelaySocket,
  ask: TunnelAsk,
  deps: TunnelDependencies,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const reached = yield* Effect.result(deps.reach(ask.userId, ask.agentId));
    if (Result.isFailure(reached)) return yield* device.close(TUNNEL_CLOSE.UNAVAILABLE);
    if (Option.isNone(reached.success)) return yield* device.close(TUNNEL_CLOSE.GONE);
    const agent = reached.success.value;
    const { sessionId } = agent;
    if (sessionId === undefined) return yield* device.close(TUNNEL_CLOSE.NOT_RUNNING);
    const opened = yield* Effect.result(deps.open(sessionId));
    if (Result.isFailure(opened)) return yield* device.close(TUNNEL_CLOSE.UNAVAILABLE);
    const sandbox = opened.success;
    if (sandbox.state !== SANDBOX_STATE.RUNNING)
      return yield* device.close(TUNNEL_CLOSE.NOT_RUNNING);
    // An open is the developer using the sandbox: where the kind holds it, it is held and kept alive from here.
    const holds = TUNNEL_HOLDS_SANDBOX[ask.bridge.kind];
    const openedAt = yield* DateTime.nowAsDate;
    const lastCrossed = yield* Ref.make(openedAt.getTime());
    const lastHeld = yield* Ref.make(openedAt.getTime());
    if (holds) {
      yield* deps.hold(agent.conversationId, heldFrom(openedAt));
      yield* Effect.forkScoped(
        Effect.repeat(deps.keepAlive(sessionId), {
          schedule: Schedule.spaced(CODER.SANDBOX_KEEP_ALIVE_EVERY),
        }),
      );
    }
    const pty = yield* Effect.result(deps.connect(sandbox.shell));
    if (Result.isFailure(pty)) return yield* device.close(TUNNEL_CLOSE.UNAVAILABLE);
    const bridge = tunnelBridge(ask.bridge);
    yield* pty.success.send({
      text: JSON.stringify({
        type: "start",
        command: bridge.command,
        args: bridge.args,
        env: TUNNEL_RELAY_BOUNDS.PTY.ENV,
        cwd: TUNNEL_RELAY_BOUNDS.PTY.CWD,
        cols: TUNNEL_RELAY_BOUNDS.PTY.COLS,
        rows: TUNNEL_RELAY_BOUNDS.PTY.ROWS,
      }),
    });
    const noteCrossed = crossed(deps, agent, holds, lastCrossed, lastHeld);
    // Note that the bridge's lines are read from its start, so its ready word is caught by the reader that then carries its frames.
    const ready = yield* Deferred.make<void>();
    const fromBridge = yield* Effect.forkScoped(
      bridgeToDevice(device, pty.success, ready, noteCrossed),
    );
    // Note that what the desktop sent before the bridge was ready waits in its socket's queue, since the PTY would echo it until raw mode.
    const isReady = yield* Effect.raceAll([
      Effect.as(Deferred.await(ready), true),
      Effect.as(Fiber.await(fromBridge), false),
      Effect.as(Effect.sleep(TUNNEL_RELAY_BOUNDS.READY_TIMEOUT), false),
    ]);
    if (!isReady) {
      yield* pty.success.close(NORMAL_CLOSE);
      return yield* device.close(TUNNEL_CLOSE.UNAVAILABLE);
    }
    const end = yield* Effect.raceAll([
      deviceToBridge(device, pty.success, noteCrossed),
      Fiber.join(fromBridge),
      idleWatch(lastCrossed),
    ]);
    yield* pty.success.close(NORMAL_CLOSE);
    if (end !== PIPE_END.DEVICE_LEFT) yield* device.close(CLOSE_OF_END[end]);
  });
}
