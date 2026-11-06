import { Data, Deferred, Duration, Effect, Fiber, Option, Queue, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { ClientRequest } from "./codex-protocol/index.js";
import type { CodexNotification } from "./protocol.js";

const METHOD_NOT_FOUND = -32601;

const APP_SERVER_KILL = {
  SIGNAL: "SIGTERM",
  GRACE: Duration.seconds(5),
} as const;

const REQUEST_TIMEOUT = {
  OPEN: Duration.minutes(2),
  DEFAULT: Duration.seconds(30),
} as const;

const OPENING_METHODS: ReadonlySet<string> = new Set(["thread/start", "thread/resume"]);

const STDERR_TAIL = 2000;

const STDERR_DRAIN = Duration.seconds(1);

export class AppServerError extends Data.TaggedError("AppServerError")<{
  readonly method: string;
  readonly detail: string;
  readonly code?: number | undefined;
  readonly data?: Schema.Json | undefined;
}> {}

export interface AppServerCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly inRunnerGroup?: boolean;
}

export type RequestMethod = ClientRequest["method"];
export type RequestParams<M extends RequestMethod> = Extract<
  ClientRequest,
  { method: M }
>["params"];

export interface AppServer {
  readonly request: <M extends RequestMethod>(
    method: M,
    params: RequestParams<M>,
  ) => Effect.Effect<Schema.Json, AppServerError>;
  readonly notify: (method: string) => Effect.Effect<void>;
}

export interface AppServerListener {
  readonly onNotification: (notification: CodexNotification) => Effect.Effect<void>;
  readonly onExit: (stderrTail: string) => Effect.Effect<void>;
}

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

const IncomingSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
  method: Schema.optionalKey(Schema.String),
  result: Schema.optionalKey(Schema.Json),
  error: Schema.optionalKey(
    Schema.Struct({
      code: Schema.optionalKey(Schema.Number),
      message: Schema.String,
      data: Schema.optionalKey(Schema.Json),
    }),
  ),
});
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));
const decodeIncoming = Schema.decodeUnknownOption(IncomingSchema);

const encoder = new TextEncoder();

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
        ...(command.inRunnerGroup === true ? { detached: false } : {}),
      }),
    )
    .pipe(
      Effect.mapError(
        () => new AppServerError({ method: "spawn", detail: "app-server could not be started" }),
      ),
    );

  const pending = new Map<number, Deferred.Deferred<Schema.Json, AppServerError>>();
  let nextId = 1;
  let stderrTail = "";
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
        error: { code: METHOD_NOT_FOUND, message: "The runner serves no requests" },
      }).pipe(
        Effect.andThen(Effect.logWarning(`agent-runner: refused app-server's ${method} request`)),
      );
    }
    if (method !== undefined) {
      return listener.onNotification(value.value as CodexNotification);
    }
    const answer = pending.get(Number(id));
    pending.delete(Number(id));
    if (answer === undefined) return Effect.void;
    return error === undefined
      ? Deferred.succeed(answer, result ?? null).pipe(Effect.asVoid)
      : Deferred.fail(
          answer,
          new AppServerError({
            method: "",
            detail: error.message,
            code: error.code,
            data: error.data,
          }),
        ).pipe(Effect.asVoid);
  };

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
      const bound = OPENING_METHODS.has(method) ? REQUEST_TIMEOUT.OPEN : REQUEST_TIMEOUT.DEFAULT;
      return yield* Deferred.await(answer).pipe(
        Effect.timeoutOrElse({
          duration: bound,
          orElse: () =>
            Effect.suspend(() => {
              pending.delete(id);
              return Effect.fail(
                new AppServerError({ method, detail: "app-server did not answer in time" }),
              );
            }),
        }),
      );
    }).pipe(
      Effect.mapError(
        (error) =>
          new AppServerError({ method, detail: error.detail, code: error.code, data: error.data }),
      ),
    );
  const notify = (method: string) => write({ method });
  return { request, notify } satisfies AppServer;
});
