import {
  CDP_FAILURE,
  type CdpCommand,
  type CdpEvent,
  CdpFailure,
  type CdpFailureKind,
  type CdpSession,
  type PageTarget,
} from "@repo/features/browser-cdp";
import { readEither } from "@repo/wire/effect";
import {
  Context,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  PubSub,
  Ref,
  Result,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect";
import type { HttpClient } from "effect/http";
import { EXCESS_KEYS, type UnparsedWireValue, WireValueSchema } from "../../core.js";
import { jsonOf } from "../../http/http-effect.js";
import type { RelaySocket } from "../../terminal/relay.js";
import { ptyLinesOf, SandboxPty, type SandboxPtyService, sandboxPtyLayer } from "../sandbox-pty.js";
import {
  deploymentOidcToken,
  SANDBOX_STATUS,
  type SandboxSessionApi,
  type SandboxUnavailable,
  type SessionRef,
  snapshotGone,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import {
  BRIDGE_WORD,
  BROWSER_START_EXIT,
  browserBridge,
  browserStartOf,
  startBrowser,
} from "./sandbox-browser.js";
import {
  RECORDING_FAILURE,
  type RecordingFailure,
  type RecordingStart,
  readRecording,
  recordingBytesOf,
  recordingStartOf,
  recordingStopOf,
  startRecording,
  stopRecording,
} from "./sandbox-recorder.js";

const AGENT_BROWSER = {
  RESUME_SPACING: Duration.seconds(2),
  RESUME_TRIES: 30,
  READY_TIMEOUT: Duration.seconds(15),
  BRIDGE_RETRIES: 2,
  BRIDGE_RETRY_SPACING: Duration.seconds(1),
  BRIDGE_RETRY_WINDOW: Duration.seconds(10),
  BRIDGE_BOUND: Duration.seconds(20),
  COMMAND_TIMEOUT: Duration.seconds(30),
  EVENT_BACKLOG: 4096,
  PTY: { COLS: 80, ROWS: 24, CWD: "/", ENV: ["TERM=dumb", "LANG=C.UTF-8"] },
} as const;

export const BROWSER_UNREACHABLE = {
  NOT_OPENED: "not-opened",
  SANDBOX_UNAVAILABLE: "sandbox-unavailable",
  NOT_RESUMED: "not-resumed",
  SNAPSHOT_GONE: "snapshot-gone",
  NO_CHROMIUM: "no-chromium",
  NOT_STARTED: "not-started",
  BRIDGE_FAILED: "bridge-failed",
} as const;

export type BrowserUnreachableReason =
  (typeof BROWSER_UNREACHABLE)[keyof typeof BROWSER_UNREACHABLE];

const UNREACHABLE_MESSAGE = {
  [BROWSER_UNREACHABLE.NOT_OPENED]: "the agent has not opened its sandbox yet",
  [BROWSER_UNREACHABLE.SANDBOX_UNAVAILABLE]: "Vercel Sandbox was unavailable",
  [BROWSER_UNREACHABLE.NOT_RESUMED]: "the agent's sandbox did not resume in time",
  [BROWSER_UNREACHABLE.SNAPSHOT_GONE]:
    "the agent's sandbox shut down after being idle, and its next turn starts a fresh one",
  [BROWSER_UNREACHABLE.NO_CHROMIUM]: "the agent's sandbox carries no browser",
  [BROWSER_UNREACHABLE.NOT_STARTED]: "the browser did not start in the agent's sandbox",
  [BROWSER_UNREACHABLE.BRIDGE_FAILED]: "the browser in the agent's sandbox could not be reached",
} as const satisfies Record<BrowserUnreachableReason, string>;

export class BrowserUnreachable extends Data.TaggedError("BrowserUnreachable")<{
  readonly reason: BrowserUnreachableReason;
  readonly status?: number;
}> {
  override get message(): string {
    const message = UNREACHABLE_MESSAGE[this.reason];
    return this.status === undefined ? message : `${message} (Vercel answered ${this.status})`;
  }
}

/** @public */
export interface BrowserStanding {
  readonly sandboxSessionId: string;
  readonly started: boolean;
}

type BrowserRecordingRead =
  | {
      readonly ok: true;
      readonly seconds: number;
      readonly bytes: Uint8Array;
      readonly path: string;
    }
  | { readonly ok: false; readonly reason: RecordingFailure; readonly bytes?: number };

export interface AgentBrowserService {
  readonly ensure: (sessionId: string) => Effect.Effect<BrowserStanding, BrowserUnreachable>;
  readonly startRecording: (
    sessionId: string,
    maxSeconds: number,
    maxBytes: number,
  ) => Effect.Effect<RecordingStart, BrowserUnreachable>;
  readonly stopRecording: (
    sessionId: string,
    maxBytes: number,
  ) => Effect.Effect<BrowserRecordingRead, BrowserUnreachable>;
  readonly connect: (
    sessionId: string,
  ) => Effect.Effect<CdpSession, BrowserUnreachable, Scope.Scope>;
}

export class AgentBrowser extends Context.Service<AgentBrowser, AgentBrowserService>()(
  "AgentBrowser",
) {}

const BridgeLineSchema = Schema.Union([
  Schema.Struct({
    bridge: Schema.Literals([BRIDGE_WORD.READY, BRIDGE_WORD.ERROR]),
    reason: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    id: Schema.Number,
    result: Schema.optional(WireValueSchema),
    error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String })),
  }),
  Schema.Struct({
    method: Schema.String,
    params: Schema.optional(WireValueSchema),
    sessionId: Schema.optional(Schema.String),
  }),
]);

const PagesSchema = Schema.Struct({
  targetInfos: Schema.Array(
    Schema.Struct({
      targetId: Schema.String,
      type: Schema.String,
      url: Schema.String,
      title: Schema.String,
    }),
  ),
});

const CreatedSchema = Schema.Struct({ targetId: Schema.String });

const BRIDGE_FAILURE = {
  NO_PTY: "the PTY did not open",
  REFUSED: "the bridge could not reach the browser",
  NOT_READY: "the bridge did not say it was ready in time",
  CLOSED: "the bridge ended before it was ready",
  OUT_OF_TIME: "no attempt came up within the bound",
} as const;

const readLine = readEither(BridgeLineSchema, { excess: EXCESS_KEYS.DROP });
const readPages = readEither(PagesSchema, { excess: EXCESS_KEYS.DROP });
const readCreated = readEither(CreatedSchema, { excess: EXCESS_KEYS.DROP });

const unreachable = (reason: BrowserUnreachableReason, status?: number) =>
  new BrowserUnreachable(status === undefined ? { reason } : { reason, status });

const sandboxUnavailable = (error: SandboxUnavailable) =>
  unreachable(BROWSER_UNREACHABLE.SANDBOX_UNAVAILABLE, error.status);

function bridgeFailed(how: string, word?: string) {
  const said = word === undefined ? "" : ` (${word})`;
  return Effect.andThen(
    Effect.logWarning(`The browser bridge did not come up: ${how}${said}`),
    Effect.fail(unreachable(BROWSER_UNREACHABLE.BRIDGE_FAILED)),
  );
}

function pagesOf(result: UnparsedWireValue): readonly PageTarget[] | undefined {
  const read = readPages(result);
  if (Result.isFailure(read)) return undefined;
  return read.success.targetInfos
    .filter((target) => target.type === "page")
    .map(({ targetId, url, title }) => ({ targetId, url, title }));
}

function cdpSessionOver(
  socket: RelaySocket,
): Effect.Effect<CdpSession, BrowserUnreachable, Scope.Scope> {
  return Effect.gen(function* () {
    const waiting = new Map<
      number,
      { readonly answer: Deferred.Deferred<UnparsedWireValue, CdpFailure>; readonly method: string }
    >();
    const nextId = yield* Ref.make(0);
    const closed = yield* Ref.make(false);
    const ready = yield* Deferred.make<
      void,
      { readonly how: string; readonly word?: string | undefined }
    >();
    const events = yield* PubSub.sliding<CdpEvent | null>(AGENT_BROWSER.EVENT_BACKLOG);

    const settle = (id: number, exit: Exit.Exit<UnparsedWireValue, CdpFailure>) =>
      Effect.suspend(() => {
        const command = waiting.get(id);
        waiting.delete(id);
        return command === undefined ? Effect.void : Deferred.done(command.answer, exit);
      });

    const dispatch = (line: string) =>
      Effect.suspend(() => {
        const read = readLine(jsonOf(line));
        if (Result.isFailure(read)) return Effect.void;
        const value = read.success;
        if ("bridge" in value) {
          return value.bridge === BRIDGE_WORD.READY
            ? Deferred.succeed(ready, undefined)
            : Deferred.fail(ready, { how: BRIDGE_FAILURE.REFUSED, word: value.reason });
        }
        if ("id" in value) {
          const method = waiting.get(value.id)?.method ?? "";
          return settle(
            value.id,
            value.error === undefined
              ? Exit.succeed(value.result)
              : Exit.fail(
                  new CdpFailure({
                    kind: CDP_FAILURE.REFUSED,
                    method,
                    code: value.error.code,
                    detail: value.error.message,
                  }),
                ),
          );
        }
        const event: CdpEvent =
          value.sessionId === undefined
            ? { method: value.method, params: value.params }
            : { method: value.method, params: value.params, sessionId: value.sessionId };
        return PubSub.publish(events, event);
      });

    const end = Effect.gen(function* () {
      yield* Ref.set(closed, true);
      yield* Deferred.fail(ready, { how: BRIDGE_FAILURE.CLOSED });
      for (const [id, { method }] of [...waiting]) {
        yield* settle(id, Exit.fail(new CdpFailure({ kind: CDP_FAILURE.CLOSED, method })));
      }
      yield* PubSub.publish(events, null);
    });

    yield* Effect.forkScoped(
      Effect.ensuring(Stream.runForEach(ptyLinesOf(socket.frames), dispatch), end),
    );
    yield* Deferred.await(ready).pipe(
      Effect.timeoutOrElse({
        duration: AGENT_BROWSER.READY_TIMEOUT,
        orElse: () => Effect.fail({ how: BRIDGE_FAILURE.NOT_READY }),
      }),
      Effect.catch((failure: { readonly how: string; readonly word?: string | undefined }) =>
        bridgeFailed(failure.how, failure.word),
      ),
    );

    const send = (command: CdpCommand): Effect.Effect<UnparsedWireValue, CdpFailure> =>
      Effect.gen(function* () {
        const failure = (kind: CdpFailureKind) => new CdpFailure({ kind, method: command.method });
        const id = yield* Ref.updateAndGet(nextId, (last) => last + 1);
        const answer = yield* Deferred.make<UnparsedWireValue, CdpFailure>();
        const forget = Effect.sync(() => waiting.delete(id));
        waiting.set(id, { answer, method: command.method });
        if (yield* Ref.get(closed))
          return yield* Effect.andThen(forget, failure(CDP_FAILURE.CLOSED));
        const line = JSON.stringify({ id, ...command });
        yield* socket.send({ bytes: new TextEncoder().encode(`${line}\n`) });
        return yield* Deferred.await(answer).pipe(
          Effect.timeoutOrElse({
            duration: AGENT_BROWSER.COMMAND_TIMEOUT,
            orElse: () => Effect.fail(failure(CDP_FAILURE.TIMED_OUT)),
          }),
          Effect.ensuring(forget),
        );
      });

    const malformed = (method: string) => new CdpFailure({ kind: CDP_FAILURE.MALFORMED, method });

    return {
      send,
      events: Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(events);
          if (yield* Ref.get(closed)) return Stream.empty;
          return Stream.fromSubscription(subscription).pipe(
            Stream.takeWhile((event): event is CdpEvent => event !== null),
          );
        }),
      ),
      pages: Effect.flatMap(send({ method: "Target.getTargets" }), (result) => {
        const pages = pagesOf(result);
        return pages === undefined
          ? Effect.fail(malformed("Target.getTargets"))
          : Effect.succeed(pages);
      }),
      openPage: (url) =>
        Effect.flatMap(send({ method: "Target.createTarget", params: { url } }), (result) => {
          const created = readCreated(result);
          return Result.isFailure(created)
            ? Effect.fail(malformed("Target.createTarget"))
            : Effect.succeed(created.success.targetId);
        }),
      closePage: (targetId) =>
        Effect.asVoid(send({ method: "Target.closeTarget", params: { targetId } })),
    };
  });
}

function ownScope<A, E>(
  effect: Effect.Effect<A, E, Scope.Scope>,
): Effect.Effect<A, E, Scope.Scope> {
  return Effect.gen(function* () {
    const child = yield* Scope.fork(yield* Effect.scope);
    return yield* effect.pipe(
      Scope.provide(child),
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
    );
  });
}

export function browserSessionOf(session: {
  readonly id: string;
  readonly parent?: { readonly rootSessionId: string } | undefined;
}): string {
  return session.parent?.rootSessionId ?? session.id;
}

export interface BrowserSandboxApi extends Pick<VercelSandboxApi, "listTagged" | "resume"> {
  readonly session: (
    ref: SessionRef,
  ) => Effect.Effect<Pick<SandboxSessionApi, "run" | "openInteractive">, SandboxUnavailable>;
}

export function agentBrowserOver(
  api: BrowserSandboxApi,
  pty: SandboxPtyService,
): AgentBrowserService {
  const runningSession = (sessionId: string) =>
    Effect.gen(function* () {
      const [sandbox] = yield* api.listTagged(sessionId).pipe(Effect.mapError(sandboxUnavailable));
      if (sandbox === undefined) return yield* unreachable(BROWSER_UNREACHABLE.NOT_OPENED);
      if (sandbox.status === SANDBOX_STATUS.RUNNING && sandbox.currentSessionId !== undefined) {
        return { name: sandbox.name, sessionId: sandbox.currentSessionId };
      }
      const resumed = api.resume(sandbox.name).pipe(
        Effect.mapError((error) =>
          snapshotGone(error)
            ? unreachable(BROWSER_UNREACHABLE.SNAPSHOT_GONE, error.status)
            : sandboxUnavailable(error),
        ),
        Effect.flatMap((found) =>
          found.status === SANDBOX_STATUS.RUNNING
            ? Effect.succeed({ name: found.name, sessionId: found.currentSessionId })
            : Effect.fail(unreachable(BROWSER_UNREACHABLE.NOT_RESUMED)),
        ),
      );
      return yield* resumed.pipe(
        Effect.retry({
          schedule: Schedule.spaced(AGENT_BROWSER.RESUME_SPACING),
          times: AGENT_BROWSER.RESUME_TRIES,
          while: (failure) => failure.reason !== BROWSER_UNREACHABLE.SNAPSHOT_GONE,
        }),
      );
    });

  const ensured = (sessionId: string) =>
    Effect.gen(function* () {
      const running = yield* runningSession(sessionId);
      const session = yield* api.session(running).pipe(Effect.mapError(sandboxUnavailable));
      const run = yield* session.run(startBrowser()).pipe(Effect.mapError(sandboxUnavailable));
      const start = browserStartOf(run);
      if (start.ok) {
        return {
          standing: { sandboxSessionId: running.sessionId, started: start.started },
          session,
        };
      }
      return yield* unreachable(
        start.exitCode === BROWSER_START_EXIT.NO_CHROMIUM
          ? BROWSER_UNREACHABLE.NO_CHROMIUM
          : BROWSER_UNREACHABLE.NOT_STARTED,
      );
    });

  const ensure = (sessionId: string) =>
    Effect.map(ensured(sessionId), ({ standing }): BrowserStanding => standing);

  const startRecordingIn = (sessionId: string, maxSeconds: number, maxBytes: number) =>
    Effect.gen(function* () {
      const { session } = yield* ensured(sessionId);
      const run = yield* session
        .run(startRecording(maxSeconds, maxBytes))
        .pipe(Effect.mapError(sandboxUnavailable));
      return recordingStartOf(run);
    });

  const stopRecordingIn = (sessionId: string, maxBytes: number) =>
    Effect.gen(function* () {
      const { session } = yield* ensured(sessionId);
      const run = yield* session.run(stopRecording()).pipe(Effect.mapError(sandboxUnavailable));
      const stopped = recordingStopOf(run);
      if (!stopped.ok) return stopped;
      const read = yield* session
        .run(readRecording(maxBytes))
        .pipe(Effect.mapError(sandboxUnavailable));
      const file = recordingBytesOf(read, maxBytes);
      if (file === undefined) {
        return { ok: false, reason: RECORDING_FAILURE.ENCODER } satisfies BrowserRecordingRead;
      }
      return { ok: true, seconds: stopped.seconds, ...file } satisfies BrowserRecordingRead;
    });

  return {
    ensure,
    startRecording: startRecordingIn,
    stopRecording: stopRecordingIn,
    connect: (sessionId) =>
      Effect.andThen(
        ensure(sessionId),
        ownScope(
          Effect.gen(function* () {
            const { session } = yield* ensured(sessionId);
            const shell = yield* session
              .openInteractive()
              .pipe(Effect.mapError(sandboxUnavailable));
            const socket = yield* pty
              .connect(shell)
              .pipe(Effect.catch(() => bridgeFailed(BRIDGE_FAILURE.NO_PTY)));
            const bridge = browserBridge();
            yield* socket.send({
              text: JSON.stringify({
                type: "start",
                command: bridge.command,
                args: bridge.args,
                env: AGENT_BROWSER.PTY.ENV,
                cwd: AGENT_BROWSER.PTY.CWD,
                cols: AGENT_BROWSER.PTY.COLS,
                rows: AGENT_BROWSER.PTY.ROWS,
              }),
            });
            return yield* cdpSessionOver(socket);
          }),
        ).pipe(
          Effect.retry({
            schedule: Schedule.max([
              Schedule.spaced(AGENT_BROWSER.BRIDGE_RETRY_SPACING),
              Schedule.recurs(AGENT_BROWSER.BRIDGE_RETRIES),
              Schedule.during(AGENT_BROWSER.BRIDGE_RETRY_WINDOW),
            ]),
            while: (failure) => failure.reason === BROWSER_UNREACHABLE.BRIDGE_FAILED,
          }),
          Effect.timeoutOrElse({
            duration: AGENT_BROWSER.BRIDGE_BOUND,
            orElse: () => bridgeFailed(BRIDGE_FAILURE.OUT_OF_TIME),
          }),
        ),
      ),
  };
}

/** @public */
export const agentBrowserLayer: Layer.Layer<
  AgentBrowser,
  never,
  HttpClient.HttpClient | SandboxPty
> = Layer.effect(
  AgentBrowser,
  Effect.gen(function* () {
    const api = yield* vercelSandboxApi(deploymentOidcToken);
    return agentBrowserOver(api, yield* SandboxPty);
  }),
);

export const agentBrowserServices: Layer.Layer<AgentBrowser, never, HttpClient.HttpClient> =
  agentBrowserLayer.pipe(Layer.provide(sandboxPtyLayer));
