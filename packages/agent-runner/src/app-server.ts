/**
 * app-server.ts -- one `codex app-server` process, spawned in the launch's scope and spoken to as newline-delimited JSON-RPC: requests answered by id, notifications handed on in the order Codex wrote them, and the process's end reported.
 *
 * The process is the operating system's, through Effect's `ChildProcessSpawner`
 * (Node's in production, a scripted one in the tests), so the door a test
 * stands at is the same one the sandbox's process crosses. Closing the scope
 * the process was spawned in ends it, its process group with it. A request
 * Codex makes of the client (an approval, never expected under
 * `approval_policy = "never"`) is refused at once, so a turn cannot hang on it.
 */

import { Data, Deferred, Duration, Effect, Fiber, Option, Queue, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { ClientRequest } from "./codex-protocol/index.js";
import type { CodexNotification } from "./protocol.js";

/** JSON-RPC's code for a method the receiver does not serve. */
const METHOD_NOT_FOUND = -32601;

/** How app-server is ended when its scope closes: asked first, then killed after the grace. */
const APP_SERVER_KILL = {
  SIGNAL: "SIGTERM",
  GRACE: Duration.seconds(5),
} as const;

/** How much of app-server's stderr is kept, for a failure's detail. */
const STDERR_TAIL = 2000;

/** How long an ended app-server's stderr is read on for its last words. */
const STDERR_DRAIN = Duration.seconds(1);

/** A request app-server answered with an error, or could not answer because it ended. */
export class AppServerError extends Data.TaggedError("AppServerError")<{
  readonly method: string;
  readonly detail: string;
}> {}

/** What the runner spawns: Codex's binary and argv, its directory, and its whole environment. */
export interface AppServerCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** A request method the pinned protocol defines, and the params it takes. */
export type RequestMethod = ClientRequest["method"];
export type RequestParams<M extends RequestMethod> = Extract<
  ClientRequest,
  { method: M }
>["params"];

/** A running app-server, as the launch speaks to it. */
export interface AppServer {
  /** Sends a request and waits for its answer, as JSON for the caller to decode. */
  readonly request: <M extends RequestMethod>(
    method: M,
    params: RequestParams<M>,
  ) => Effect.Effect<Schema.Json, AppServerError>;
  /** Sends a notification, which app-server answers nothing. */
  readonly notify: (method: string) => Effect.Effect<void>;
}

/** What the launch hears from app-server: each notification, as Codex wrote it, and its end. */
export interface AppServerListener {
  readonly onNotification: (notification: CodexNotification) => Effect.Effect<void>;
  /** The process's stdout ended: it exited, with the tail of what it wrote to stderr. */
  readonly onExit: (stderrTail: string) => Effect.Effect<void>;
}

/** What the runner writes to app-server: a request, a notification, or a refusal of its request. */
type Outgoing =
  | {
      readonly id: number;
      readonly method: RequestMethod;
      readonly params: RequestParams<RequestMethod>;
    }
  | { readonly method: string }
  | {
      readonly id: number | string;
      readonly error: { readonly code: number; readonly message: string };
    };

/** The fields a line from app-server is routed by; the line itself is handed on whole. */
const IncomingSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
  method: Schema.optionalKey(Schema.String),
  result: Schema.optionalKey(Schema.Json),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
});
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));
const decodeIncoming = Schema.decodeUnknownOption(IncomingSchema);

const encoder = new TextEncoder();

/**
 * Spawns app-server in the caller's scope and reads it until it ends. Fails
 * only where the process could not be spawned at all.
 */
export const spawnAppServer = Effect.fn("agent-runner/spawnAppServer")(function* (
  command: AppServerCommand,
  listener: AppServerListener,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdin = yield* Queue.unbounded<Uint8Array>();
  const handle = yield* spawner
    .spawn(
      ChildProcess.make(command.executable, command.args, {
        cwd: command.cwd,
        env: { ...command.env },
        extendEnv: false,
        stdin: { stream: Stream.fromQueue(stdin), endOnDone: true },
        killSignal: APP_SERVER_KILL.SIGNAL,
        forceKillAfter: APP_SERVER_KILL.GRACE,
      }),
    )
    .pipe(
      // Note that the platform's error is not kept, because the command it
      // describes carries the environment, the token in it.
      Effect.mapError(
        () => new AppServerError({ method: "spawn", detail: "app-server could not be started" }),
      ),
    );

  const pending = new Map<number, Deferred.Deferred<Schema.Json, AppServerError>>();
  let nextId = 1;
  let stderrTail = "";
  // Note that a request is refused once stdout has ended, because no reader
  // is left to answer it; the check and the registration are one step.
  let closed = false;
  const write = (message: Outgoing) =>
    Queue.offer(stdin, encoder.encode(`${JSON.stringify(message)}\n`)).pipe(Effect.asVoid);

  const takeLine = (line: string): Effect.Effect<void> => {
    const value = decodeJson(line);
    const incoming = Option.flatMap(value, decodeIncoming);
    if (Option.isNone(value) || Option.isNone(incoming)) {
      return Effect.logWarning(
        "agent-runner: skipped a line app-server wrote that is not JSON-RPC",
      );
    }
    const { id, method, result, error } = incoming.value;
    if (method !== undefined && id !== undefined) {
      return write({
        id,
        error: { code: METHOD_NOT_FOUND, message: "Luke's runner serves no requests" },
      }).pipe(
        Effect.andThen(Effect.logWarning(`agent-runner: refused app-server's ${method} request`)),
      );
    }
    if (method !== undefined) {
      // SAFETY: a JSON-RPC notification app-server wrote is one of the pinned protocol's `ServerNotification`s.
      return listener.onNotification(value.value as CodexNotification);
    }
    const answer = pending.get(Number(id));
    pending.delete(Number(id));
    if (answer === undefined) return Effect.void;
    return error === undefined
      ? Deferred.succeed(answer, result ?? null).pipe(Effect.asVoid)
      : Deferred.fail(answer, new AppServerError({ method: "", detail: error.message })).pipe(
          Effect.asVoid,
        );
  };

  // Note that stderr is read to its end, or for a moment at most, before the
  // exit is reported, because its last words are why the process ended.
  const ended = Effect.suspend(() => {
    closed = true;
    const unanswered = [...pending.values()];
    pending.clear();
    return Effect.forEach(
      unanswered,
      (answer) =>
        Deferred.fail(answer, new AppServerError({ method: "", detail: "app-server exited" })),
      { discard: true },
    ).pipe(
      Effect.andThen(Fiber.join(stderrRead).pipe(Effect.timeoutOption(STDERR_DRAIN))),
      Effect.andThen(Effect.suspend(() => listener.onExit(stderrTail))),
    );
  });
  const stderrRead = yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL);
      }),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );
  yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach(takeLine),
    Effect.ignore,
    Effect.andThen(ended),
    Effect.forkScoped,
  );

  const request = <M extends RequestMethod>(method: M, params: RequestParams<M>) =>
    Effect.gen(function* () {
      const id = nextId;
      nextId += 1;
      const answer = Deferred.makeUnsafe<Schema.Json, AppServerError>();
      if (closed) return yield* new AppServerError({ method, detail: "app-server exited" });
      pending.set(id, answer);
      yield* write({ id, method, params });
      return yield* Deferred.await(answer);
    }).pipe(Effect.mapError((error) => new AppServerError({ method, detail: error.detail })));
  const notify = (method: string) => write({ method });
  return { request, notify } satisfies AppServer;
});
