import {
  SANDBOX_STATE,
  TERMINAL_RELAY_CLOSE,
  TERMINAL_RELAY_FRAME,
  terminalRelayResizeSchema,
} from "@repo/features/terminal-wire";
import { readEither } from "@repo/wire/effect";
import {
  type Cause,
  Clock,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Option,
  Queue,
  Ref,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { CODER } from "../agents/coder-host/bounds.js";
import type { FirewallSession, RepositoryCredential } from "../agents/sandbox-firewall.js";
import type { AgentSandboxService } from "../agents/terminal/agent-sandbox.js";
import { attachTerminal, TMUX } from "../agents/terminal/tmux.js";
import type { InteractiveShell, SandboxUnavailable } from "../agents/vercel-sandbox-api.js";
import { jsonOf } from "../http/http-effect.js";
import { frameBytes } from "../http/socket.js";

const TERMINAL_RELAY_BOUNDS = {
  IDLE: Duration.minutes(5),
  LEASE_WRITE_EVERY: Duration.minutes(1),
  IDLE_CHECK_EVERY: Duration.seconds(30),
  CREDENTIAL_CHECK_EVERY: Duration.minutes(5),
  HELD_MAX_BYTES: 1024 * 1024,
  ENV: ["TERM=xterm-256color", "COLORTERM=truecolor", "LANG=C.UTF-8"],
} as const;

export type RelayFrame = { readonly text: string } | { readonly bytes: Uint8Array };

export interface RelaySocket {
  readonly frames: Stream.Stream<RelayFrame>;
  readonly send: (frame: RelayFrame) => Effect.Effect<void>;
  readonly close: (code: number, reason?: string) => Effect.Effect<void>;
}

export interface RelayAsk {
  readonly userId: string;
  readonly agentId: string;
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

export interface RelayAgent {
  readonly userId: string;
  readonly conversationId: string;
  readonly sessionId: string | undefined;
  readonly repositoryCredential: Effect.Effect<RepositoryCredential, unknown>;
  readonly memberToken: boolean;
  readonly turnUnderWay: Effect.Effect<boolean, unknown>;
}

export interface RelayDependencies {
  readonly reach: (
    userId: string,
    agentId: string,
  ) => Effect.Effect<Option.Option<RelayAgent>, unknown>;
  readonly sandbox: AgentSandboxService;
  readonly connect: (
    shell: InteractiveShell,
  ) => Effect.Effect<RelaySocket, SandboxUnavailable, Scope.Scope>;
  readonly hold: (conversationId: string, heldUntil: Date) => Effect.Effect<void>;
  readonly keepAlive: (sessionId: string) => Effect.Effect<void>;
  readonly claimRenewal: (
    conversationId: string,
    sandboxSessionId: string,
    now: Date,
    renewedBefore: Date,
  ) => Effect.Effect<boolean>;
  readonly releaseRenewal: (
    conversationId: string,
    sandboxSessionId: string,
    claimedAt: Date,
  ) => Effect.Effect<void>;
}

const NORMAL_CLOSE = 1000;

const PIPE_END = {
  DEVICE_LEFT: "device-left",
  UPSTREAM_LEFT: "upstream-left",
  EXITED: "exited",
  IDLE: "idle",
} as const;

type PipeEnd = (typeof PIPE_END)[keyof typeof PIPE_END];

const PtyExitSchema = Schema.Struct({ type: Schema.Literal("exit"), code: Schema.Int });

const readResize = readEither(terminalRelayResizeSchema);
const readPtyExit = readEither(PtyExitSchema);

function heldFrom(instant: Date): Date {
  const reach = Duration.sum(TERMINAL_RELAY_BOUNDS.IDLE, TERMINAL_RELAY_BOUNDS.LEASE_WRITE_EVERY);
  return new Date(instant.getTime() + Duration.toMillis(reach));
}

function setCredential(
  deps: RelayDependencies,
  agent: RelayAgent,
  session: FirewallSession,
): Effect.Effect<void, unknown> {
  return Effect.flatMap(agent.repositoryCredential, (credential) =>
    deps.sandbox.setCredential(session, credential),
  );
}

function withdrawCredential(
  deps: RelayDependencies,
  agent: RelayAgent,
  session: FirewallSession,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (yield* agent.turnUnderWay) return;
    yield* deps.sandbox.withdrawCredential(session);
  }).pipe(
    Effect.catch(() => Effect.logWarning("a terminal's GitHub credential was not taken off")),
  );
}

function renewCredential(
  deps: RelayDependencies,
  agent: RelayAgent,
  session: FirewallSession,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { sandboxSessionId } = session;
    if (agent.memberToken) {
      return yield* setCredential(deps, agent, session).pipe(
        Effect.catch(() => Effect.logWarning("a terminal's GitHub credential was not set")),
      );
    }
    const at = yield* DateTime.nowAsDate;
    const renewedBefore = new Date(at.getTime() - Duration.toMillis(CODER.GITHUB_TOKEN_REFRESH));
    const claimed = yield* deps.claimRenewal(
      agent.conversationId,
      sandboxSessionId,
      at,
      renewedBefore,
    );
    if (!claimed) return;
    yield* setCredential(deps, agent, session).pipe(
      Effect.onError(() => deps.releaseRenewal(agent.conversationId, sandboxSessionId, at)),
      Effect.catch(() => Effect.logWarning("a terminal's GitHub credential was not renewed")),
    );
  });
}

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

function deviceToPty(
  deps: RelayDependencies,
  agent: RelayAgent,
  lastTyped: Ref.Ref<number>,
  fromDevice: Stream.Stream<RelayFrame>,
  pty: RelaySocket,
): Effect.Effect<PipeEnd> {
  return Effect.gen(function* () {
    const lastHeld = yield* Ref.make(yield* Clock.currentTimeMillis);
    yield* Stream.runForEach(fromDevice, (frame) => {
      if ("bytes" in frame) {
        return Effect.andThen(
          Effect.gen(function* () {
            const at = yield* DateTime.nowAsDate;
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

function ptyToDevice(device: RelaySocket, pty: RelaySocket): Effect.Effect<PipeEnd> {
  return Effect.gen(function* () {
    const exited = yield* Ref.make(false);
    yield* Stream.runForEachWhile(pty.frames, (frame) => {
      if ("bytes" in frame) return Effect.as(device.send(frame), true);
      const exit = readPtyExit(jsonOf(frame.text));
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

function idleWatch(lastTyped: Ref.Ref<number>): Effect.Effect<PipeEnd> {
  const typedLately = Effect.gen(function* () {
    const since = (yield* Clock.currentTimeMillis) - (yield* Ref.get(lastTyped));
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

const CLOSE_OF_END = {
  [PIPE_END.UPSTREAM_LEFT]: TERMINAL_RELAY_CLOSE.UNAVAILABLE,
  [PIPE_END.EXITED]: TERMINAL_RELAY_CLOSE.EXITED,
  [PIPE_END.IDLE]: TERMINAL_RELAY_CLOSE.IDLE,
} as const satisfies Record<Exclude<PipeEnd, typeof PIPE_END.DEVICE_LEFT>, number>;

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
    const attachedAt = yield* DateTime.nowAsDate;
    const lastTyped = yield* Ref.make(attachedAt.getTime());
    yield* deps.hold(agent.conversationId, heldFrom(attachedAt));
    const { sessionId } = agent;
    yield* Effect.forkScoped(
      Effect.repeat(deps.keepAlive(sessionId), {
        schedule: Schedule.spaced(CODER.SANDBOX_KEEP_ALIVE_EVERY),
      }),
    );
    const fromDevice = yield* Queue.make<RelayFrame, Cause.Done>();
    const held = yield* Ref.make<number | undefined>(0);
    const overheld = yield* Deferred.make<void>();
    const deviceLeft = yield* Effect.forkScoped(readDevice(device, fromDevice, held, overheld));
    const session: FirewallSession = {
      userId: agent.userId,
      name: sandbox.sandboxName,
      sandboxSessionId: sandbox.sandboxSessionId,
    };
    if (agent.memberToken) {
      yield* Effect.addFinalizer(() => withdrawCredential(deps, agent, session));
    }
    const firstRenewed = yield* Deferred.make<void>();
    yield* Effect.forkScoped(
      Effect.repeat(
        Effect.andThen(
          renewCredential(deps, agent, session),
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
