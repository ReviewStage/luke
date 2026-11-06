import { TUNNEL_CLOSE, TUNNEL_KIND, tunnelFrameSchema } from "@repo/features/sandbox-tunnel-wire";
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
  IDLE: Duration.minutes(20),
  LEASE_WRITE_EVERY: Duration.minutes(1),
  IDLE_CHECK_EVERY: Duration.seconds(30),
  READY_TIMEOUT: Duration.seconds(15),
  PTY: { COLS: 80, ROWS: 24, CWD: "/", ENV: ["TERM=dumb", "LANG=C.UTF-8"] },
} as const;

export interface TunnelAsk {
  readonly userId: string;
  readonly agentId: string;
  readonly bridge: TunnelBridge;
}

export interface TunnelAgent {
  readonly conversationId: string;
  readonly sessionId: string | undefined;
}

export interface TunnelDependencies {
  readonly reach: (
    userId: string,
    agentId: string,
  ) => Effect.Effect<Option.Option<TunnelAgent>, unknown>;
  readonly open: (sessionId: string) => Effect.Effect<SandboxOpen, SandboxUnavailable>;
  readonly resume: (sessionId: string) => Effect.Effect<unknown, SandboxUnavailable>;
  readonly connect: (
    shell: InteractiveShell,
  ) => Effect.Effect<RelaySocket, SandboxUnavailable, Scope.Scope>;
  readonly hold: (conversationId: string, heldUntil: Date) => Effect.Effect<void>;
  readonly keepAlive: (sessionId: string) => Effect.Effect<void>;
}

const NORMAL_CLOSE = 1000;

const PIPE_END = {
  DEVICE_LEFT: "device-left",
  BRIDGE_LEFT: "bridge-left",
  IDLE: "idle",
} as const;

type PipeEnd = (typeof PIPE_END)[keyof typeof PIPE_END];

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

function heldFrom(instant: Date): Date {
  const reach = Duration.sum(TUNNEL_RELAY_BOUNDS.IDLE, TUNNEL_RELAY_BOUNDS.LEASE_WRITE_EVERY);
  return new Date(instant.getTime() + Duration.toMillis(reach));
}

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
      const line = `${frame.text.replace(/[\r\n]/g, "")}\n`;
      return Effect.andThen(noteCrossed, pty.send({ bytes: new TextEncoder().encode(line) }));
    }),
    PIPE_END.DEVICE_LEFT,
  );
}

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
    const wakes = ask.bridge.kind === TUNNEL_KIND.MIRROR && ask.bridge.wake;
    const opened = yield* Effect.result(
      wakes ? Effect.andThen(deps.resume(sessionId), deps.open(sessionId)) : deps.open(sessionId),
    );
    if (Result.isFailure(opened)) return yield* device.close(TUNNEL_CLOSE.UNAVAILABLE);
    const sandbox = opened.success;
    if (sandbox.state !== SANDBOX_STATE.RUNNING)
      return yield* device.close(TUNNEL_CLOSE.NOT_RUNNING);
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
    const ready = yield* Deferred.make<void>();
    const fromBridge = yield* Effect.forkScoped(
      bridgeToDevice(device, pty.success, ready, noteCrossed),
    );
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
