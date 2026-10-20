/**
 * agent-browser.ts -- an agent's browser as the service reaches it: a Chromium kept running in the agent's own sandbox, and a DevTools protocol session with it over the sandbox's PTY.
 *
 * A sandbox is found as the Terminal tab finds it, by the eve session it is
 * tagged with (`vercel-sandbox-api.ts`): a root session's own id, which a
 * worker's session names as its root, since a worker works in its parent's
 * sandbox (`agent-runtime/role.ts`'s `SANDBOX_POLICY.PARENT`). The brain's
 * sandbox and a coding agent's are reached alike. Making sure of the
 * browser resumes a stopped sandbox, as an agent's own step would, waits for
 * it to run, and runs the start (`sandbox-browser.ts`), which attaches to a
 * browser already running or starts one.
 *
 * A session opens the running sandbox session's PTY, as the Terminal tab
 * does, starts the bridge in it, and once the bridge says it is ready
 * speaks CDP a message a line: one browser-level connection, a page reached
 * through its flattened target session. A command answers its result or
 * the browser's refusal, or fails as timed out or as closed when the
 * connection goes first; events reach whoever is subscribed from the moment
 * they subscribe, and their streams end with the connection. Nothing a page
 * holds is read, kept, or logged here; it reaches only the caller.
 *
 * When the browser cannot be reached, the failure says why: no sandbox yet,
 * Vercel unavailable, a sandbox that would not resume, an image without the
 * browser, a browser that would not start, or a bridge that never came up.
 */

import { readEither } from "@luke/wire/effect";
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
  type Scope,
  Stream,
  type Take,
} from "effect";
import type { HttpClient } from "effect/http";
import {
  EXCESS_KEYS,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
  WireValueSchema,
} from "../../core.js";
import type { RelayFrame, RelaySocket } from "../../terminal/relay.js";
import { SandboxPty, type SandboxPtyService } from "../sandbox-pty.js";
import {
  deploymentOidcToken,
  type SandboxUnavailable,
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

const AGENT_BROWSER = {
  /** How often a resuming sandbox is asked whether it runs yet, and how many times before it is given up on: a minute in all. */
  RESUME_SPACING: Duration.seconds(2),
  RESUME_TRIES: 30,
  /** How long the bridge may take to say it is ready once its PTY is open. */
  READY_TIMEOUT: Duration.seconds(15),
  /** How long a command waits on its answer. */
  COMMAND_TIMEOUT: Duration.seconds(30),
  /** The most events a subscriber that falls behind is owed; past it the oldest give way. */
  EVENT_BACKLOG: 4096,
  /** The PTY the bridge runs in: its size is nothing to it, and its text is UTF-8. */
  PTY: { COLS: 80, ROWS: 24, CWD: "/", ENV: ["TERM=dumb", "LANG=C.UTF-8"] },
} as const;

/** Vercel's state of a sandbox that runs. */
const RUNNING_STATUS = "running";

/** Why an agent's browser could not be reached. */
export const BROWSER_UNREACHABLE = {
  /** The agent has opened no sandbox yet: it has not run a sandbox tool. */
  NOT_OPENED: "not-opened",
  /** Vercel Sandbox could not be asked, or did not answer what was asked. */
  SANDBOX_UNAVAILABLE: "sandbox-unavailable",
  /** The stopped sandbox did not come up within the bound. */
  NOT_RESUMED: "not-resumed",
  /** The sandbox's image carries no full Chromium: a snapshot made before it did. */
  NO_CHROMIUM: "no-chromium",
  /** Xvfb or Chromium did not start in the sandbox. */
  NOT_STARTED: "not-started",
  /** The PTY could not be opened, or the bridge in it could not reach the browser. */
  BRIDGE_FAILED: "bridge-failed",
} as const;

export type BrowserUnreachableReason =
  (typeof BROWSER_UNREACHABLE)[keyof typeof BROWSER_UNREACHABLE];

const UNREACHABLE_MESSAGE = {
  [BROWSER_UNREACHABLE.NOT_OPENED]: "the agent has not opened its sandbox yet",
  [BROWSER_UNREACHABLE.SANDBOX_UNAVAILABLE]: "Vercel Sandbox was unavailable",
  [BROWSER_UNREACHABLE.NOT_RESUMED]: "the agent's sandbox did not resume in time",
  [BROWSER_UNREACHABLE.NO_CHROMIUM]: "the agent's sandbox carries no browser",
  [BROWSER_UNREACHABLE.NOT_STARTED]: "the browser did not start in the agent's sandbox",
  [BROWSER_UNREACHABLE.BRIDGE_FAILED]: "the browser in the agent's sandbox could not be reached",
} as const satisfies Record<BrowserUnreachableReason, string>;

/** The agent's browser could not be reached, and why; the status where Vercel answered one. */
export class BrowserUnreachable extends Data.TaggedError("BrowserUnreachable")<{
  readonly reason: BrowserUnreachableReason;
  readonly status?: number;
}> {
  override get message(): string {
    const message = UNREACHABLE_MESSAGE[this.reason];
    return this.status === undefined ? message : `${message} (Vercel answered ${this.status})`;
  }
}

/** How a command failed: the browser refused it, its answer did not come in time or was not what it should be, or the connection ended first. */
export const CDP_FAILURE = {
  REFUSED: "refused",
  TIMED_OUT: "timed-out",
  MALFORMED: "malformed",
  CLOSED: "closed",
} as const;

export type CdpFailureKind = (typeof CDP_FAILURE)[keyof typeof CDP_FAILURE];

/** A command that failed: its method, how, and the browser's own code and words where it refused it. */
export class CdpFailure extends Data.TaggedError("CdpFailure")<{
  readonly kind: CdpFailureKind;
  readonly method: string;
  readonly code?: number;
  readonly detail?: string;
}> {
  override get message(): string {
    return this.detail === undefined
      ? `${this.method} ${this.kind}`
      : `${this.method} ${this.kind}: ${this.detail}`;
  }
}

/** A command's parameters, as JSON carries them. @public */
export type CdpParams = { readonly [key: string]: WireBoundaryInput };

/** One command: its method, its parameters, and the target session it goes to; none for the browser itself. @public */
export interface CdpCommand {
  readonly method: string;
  readonly params?: CdpParams;
  readonly sessionId?: string;
}

/** One event the browser sent: its method, its parameters, and the target session it came from. */
export interface CdpEvent {
  readonly method: string;
  readonly params: UnparsedWireValue;
  readonly sessionId?: string;
}

/** A page target, a tab: its id, address, and title. */
export interface PageTarget {
  readonly targetId: string;
  readonly url: string;
  readonly title: string;
}

/** A DevTools protocol connection to the agent's browser, open for the scope it was made in. @public */
export interface CdpSession {
  /** Sends a command and answers its result. */
  readonly send: (command: CdpCommand) => Effect.Effect<UnparsedWireValue, CdpFailure>;
  /** The events the browser sends from the moment this is run, ending with the connection. */
  readonly events: Stream.Stream<CdpEvent>;
  /** The browser's page targets. */
  readonly pages: Effect.Effect<readonly PageTarget[], CdpFailure>;
  /** Opens a page at the address given, answering its target's id. */
  readonly openPage: (url: string) => Effect.Effect<string, CdpFailure>;
  /** Closes the page target named. */
  readonly closePage: (targetId: string) => Effect.Effect<void, CdpFailure>;
}

/** The browser made sure of: the running sandbox session it is in, and whether this call started it. @public */
export interface BrowserStanding {
  readonly sandboxSessionId: string;
  readonly started: boolean;
}

export interface AgentBrowserService {
  /** Makes sure the browser runs in the sandbox tagged with the session, resuming the sandbox where it stopped. */
  readonly ensure: (sessionId: string) => Effect.Effect<BrowserStanding, BrowserUnreachable>;
  /** Makes sure of the browser, then opens a CDP session with it for the caller's scope. */
  readonly connect: (
    sessionId: string,
  ) => Effect.Effect<CdpSession, BrowserUnreachable, Scope.Scope>;
}

export class AgentBrowser extends Context.Service<AgentBrowser, AgentBrowserService>()(
  "AgentBrowser",
) {}

/** A line the bridge wrote: its own word, a command's answer, or an event. */
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

/** The PTY server's exit frame: the bridge ended. */
const PtyExitSchema = Schema.Struct({ type: Schema.Literal("exit"), code: Schema.Int });

const readLine = readEither(BridgeLineSchema, { excess: EXCESS_KEYS.DROP });
const readPages = readEither(PagesSchema, { excess: EXCESS_KEYS.DROP });
const readCreated = readEither(CreatedSchema, { excess: EXCESS_KEYS.DROP });
const readPtyExit = readEither(PtyExitSchema, { excess: EXCESS_KEYS.DROP });

/** A line's JSON, or nothing a reader takes where it is none, as a PTY's stray output is. */
function jsonOf(text: string): UnparsedWireValue {
  const parsed = Result.try(() => JSON.parse(text));
  return unparsedWire(Result.isSuccess(parsed) ? parsed.success : undefined);
}

const unreachable = (reason: BrowserUnreachableReason, status?: number) =>
  new BrowserUnreachable(status === undefined ? { reason } : { reason, status });

const sandboxUnavailable = (error: SandboxUnavailable) =>
  unreachable(BROWSER_UNREACHABLE.SANDBOX_UNAVAILABLE, error.status);

/** The PTY's output as the lines the bridge wrote, ending where the bridge exits; a text frame that is not its exit is output sent as text. */
function linesOf(frames: Stream.Stream<RelayFrame>): Stream.Stream<string> {
  const decoder = new TextDecoder();
  return frames.pipe(
    Stream.takeWhile(
      (frame) => "bytes" in frame || Result.isFailure(readPtyExit(jsonOf(frame.text))),
    ),
    Stream.map((frame) =>
      "bytes" in frame ? decoder.decode(frame.bytes, { stream: true }) : frame.text,
    ),
    Stream.splitLines,
  );
}

/** The browser's page targets, as `Target.getTargets` answers them. */
function pagesOf(result: UnparsedWireValue): readonly PageTarget[] | undefined {
  const read = readPages(result);
  if (Result.isFailure(read)) return undefined;
  return read.success.targetInfos
    .filter((target) => target.type === "page")
    .map(({ targetId, url, title }) => ({ targetId, url, title }));
}

/**
 * A CDP session over the bridge's socket, once the bridge says it is ready.
 * The reader runs for the caller's scope; as it ends, every command still
 * waiting fails as closed and every event stream ends.
 */
function cdpSessionOver(
  socket: RelaySocket,
): Effect.Effect<CdpSession, BrowserUnreachable, Scope.Scope> {
  return Effect.gen(function* () {
    // Each command still waiting on its answer, by its id, with its method for the failure that names it.
    const waiting = new Map<
      number,
      { readonly answer: Deferred.Deferred<UnparsedWireValue, CdpFailure>; readonly method: string }
    >();
    const nextId = yield* Ref.make(0);
    const closed = yield* Ref.make(false);
    const ready = yield* Deferred.make<void, BrowserUnreachable>();
    const events = yield* PubSub.sliding<Take.Take<CdpEvent>>(AGENT_BROWSER.EVENT_BACKLOG);

    const settle = (id: number, exit: Exit.Exit<UnparsedWireValue, CdpFailure>) =>
      Effect.suspend(() => {
        const command = waiting.get(id);
        waiting.delete(id);
        return command === undefined ? Effect.void : Deferred.done(command.answer, exit);
      });

    const dispatch = (line: string) =>
      Effect.suspend(() => {
        const read = readLine(jsonOf(line));
        // A line that is no message is the PTY's own output, never the browser's.
        if (Result.isFailure(read)) return Effect.void;
        const value = read.success;
        if ("bridge" in value) {
          return value.bridge === BRIDGE_WORD.READY
            ? Deferred.succeed(ready, undefined)
            : Deferred.fail(ready, unreachable(BROWSER_UNREACHABLE.BRIDGE_FAILED));
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
        return PubSub.publish(events, [event]);
      });

    // The connection's end: what waits fails as closed, and every event stream ends.
    const end = Effect.gen(function* () {
      yield* Ref.set(closed, true);
      yield* Deferred.fail(ready, unreachable(BROWSER_UNREACHABLE.BRIDGE_FAILED));
      for (const [id, { method }] of [...waiting]) {
        yield* settle(id, Exit.fail(new CdpFailure({ kind: CDP_FAILURE.CLOSED, method })));
      }
      yield* PubSub.publish(events, Exit.void);
    });

    yield* Effect.forkScoped(
      Effect.ensuring(Stream.runForEach(linesOf(socket.frames), dispatch), end),
    );
    yield* Deferred.await(ready).pipe(
      Effect.timeoutOrElse({
        duration: AGENT_BROWSER.READY_TIMEOUT,
        orElse: () => Effect.fail(unreachable(BROWSER_UNREACHABLE.BRIDGE_FAILED)),
      }),
    );

    const send = (command: CdpCommand): Effect.Effect<UnparsedWireValue, CdpFailure> =>
      Effect.gen(function* () {
        const failure = (kind: CdpFailureKind) => new CdpFailure({ kind, method: command.method });
        const id = yield* Ref.updateAndGet(nextId, (last) => last + 1);
        const answer = yield* Deferred.make<UnparsedWireValue, CdpFailure>();
        const forget = Effect.sync(() => waiting.delete(id));
        waiting.set(id, { answer, method: command.method });
        // Note that the end is read only once the command waits, so an end before it is never missed.
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
      // Note that a stream run after the end would wait on an end already published, so it is empty instead.
      events: Stream.unwrap(
        Effect.map(Ref.get(closed), (gone) =>
          gone ? Stream.empty : Stream.fromPubSubTake(events),
        ),
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

/**
 * The session whose sandbox an agent's browser runs in, as eve hands a tool
 * its session: a root session's own id, and a worker's root's, since a
 * worker works in its parent's sandbox and opens none of its own.
 */
export function browserSessionOf(session: {
  readonly id: string;
  readonly parent?: { readonly rootSessionId: string } | undefined;
}): string {
  return session.parent?.rootSessionId ?? session.id;
}

/** The service over the REST calls the API makes and the PTY the sandbox serves. */
export function agentBrowserOver(
  api: VercelSandboxApi,
  pty: SandboxPtyService,
): AgentBrowserService {
  /** The running session of the sandbox tagged with the session, resumed and waited for where it is not running. */
  const runningSession = (sessionId: string) =>
    Effect.gen(function* () {
      const [sandbox] = yield* api.listTagged(sessionId).pipe(Effect.mapError(sandboxUnavailable));
      if (sandbox === undefined) return yield* unreachable(BROWSER_UNREACHABLE.NOT_OPENED);
      if (sandbox.status === RUNNING_STATUS && sandbox.currentSessionId !== undefined) {
        return sandbox.currentSessionId;
      }
      // Note that each try asks the resume again, which answers a sandbox already coming up as it stands.
      const resumed = api.resume(sandbox.name).pipe(
        Effect.mapError(sandboxUnavailable),
        Effect.flatMap((found) =>
          found.status === RUNNING_STATUS && found.currentSessionId !== undefined
            ? Effect.succeed(found.currentSessionId)
            : Effect.fail(unreachable(BROWSER_UNREACHABLE.NOT_RESUMED)),
        ),
      );
      return yield* resumed.pipe(
        Effect.retry({
          schedule: Schedule.spaced(AGENT_BROWSER.RESUME_SPACING),
          times: AGENT_BROWSER.RESUME_TRIES,
        }),
        Effect.mapError((error) =>
          error.reason === BROWSER_UNREACHABLE.SANDBOX_UNAVAILABLE
            ? unreachable(BROWSER_UNREACHABLE.NOT_RESUMED, error.status)
            : error,
        ),
      );
    });

  const ensure = (sessionId: string) =>
    Effect.gen(function* () {
      const sandboxSessionId = yield* runningSession(sessionId);
      const run = yield* api
        .run(sandboxSessionId, startBrowser())
        .pipe(Effect.mapError(sandboxUnavailable));
      const start = browserStartOf(run);
      if (start.ok) return { sandboxSessionId, started: start.started };
      return yield* unreachable(
        start.exitCode === BROWSER_START_EXIT.NO_CHROMIUM
          ? BROWSER_UNREACHABLE.NO_CHROMIUM
          : BROWSER_UNREACHABLE.NOT_STARTED,
      );
    });

  return {
    ensure,
    connect: (sessionId) =>
      Effect.gen(function* () {
        const { sandboxSessionId } = yield* ensure(sessionId);
        // The running session's own PTY, never the sandbox's: a mint on the sandbox would resume it.
        const shell = yield* api
          .openInteractive(sandboxSessionId)
          .pipe(Effect.mapError(sandboxUnavailable));
        const socket = yield* pty
          .connect(shell)
          .pipe(Effect.mapError(() => unreachable(BROWSER_UNREACHABLE.BRIDGE_FAILED)));
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
  };
}

/**
 * The service as the deployment runs it, on the function's own OIDC token
 * and the PTY it reaches (`sandboxPtyLayer`), which the agent's `browser`
 * tool composes.
 * @public
 */
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
