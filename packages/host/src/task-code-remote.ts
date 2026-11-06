import { type CodeLines, type CodeToken, codeLinesSchema } from "@repo/features/tasks-view";
import { catchAllButInterrupt } from "@repo/runtime/effect";
import { type Cause, Deferred, Duration, Effect, Exit, Option, Queue, Schema, Scope } from "effect";

const QUEUED_MAX = 256;

const COLOR_DEADLINE = Duration.seconds(10);

export const taskCodeRequestSchema = Schema.Struct({
  id: Schema.Number,
  language: Schema.String,
  code: Schema.String,
});

export type TaskCodeRequest = typeof taskCodeRequestSchema.Type;

export const taskCodeAnswerSchema = Schema.Struct({
  id: Schema.Number,
  lines: codeLinesSchema,
});

export interface TaskCodeProcess {
  readonly send: (message: unknown) => void;
  readonly kill: () => void;
}

export interface TaskCodeProcessListeners {
  readonly onMessage: (message: unknown) => void;
  readonly onExit: () => void;
}

export type SpawnTaskCodeProcess = (listeners: TaskCodeProcessListeners) => TaskCodeProcess;

export type ColorCode = (language: string, code: string) => Effect.Effect<CodeLines>;

interface Spawned {
  readonly child: TaskCodeProcess;
  readonly answers: Queue.Queue<unknown, Cause.Done>;
  readonly scope: Scope.Closeable;
  readonly exited: () => boolean;
}

interface Asked {
  readonly language: string;
  readonly code: string;
  readonly answer: Deferred.Deferred<CodeLines>;
}

export function plainCodeLines(code: string): CodeToken[][] {
  return code.split("\n").map((text) => (text === "" ? [] : [{ text }]));
}

function answerFor(
  answers: Queue.Queue<unknown, Cause.Done>,
  id: number,
): Effect.Effect<CodeLines | undefined> {
  return Effect.matchEffect(Queue.take(answers), {
    onFailure: () => Effect.succeed(undefined),
    onSuccess: (message) => {
      const answer = Schema.decodeUnknownOption(taskCodeAnswerSchema)(message);
      if (Option.isNone(answer)) return Effect.succeed(undefined);
      return answer.value.id === id ? Effect.succeed(answer.value.lines) : answerFor(answers, id);
    },
  });
}

function spawnInto(parent: Scope.Scope, spawn: SpawnTaskCodeProcess): Effect.Effect<Spawned> {
  return Effect.gen(function* () {
    const scope = yield* Scope.fork(parent);
    const answers = yield* Queue.unbounded<unknown, Cause.Done>();
    let exited = false;
    const child = yield* Effect.acquireRelease(
      Effect.sync(() =>
        spawn({
          onMessage: (message) => {
            Queue.offerUnsafe(answers, message);
          },
          onExit: () => {
            exited = true;
            Queue.endUnsafe(answers);
          },
        }),
      ),
      (spawned) => Effect.sync(() => spawned.kill()),
    ).pipe(Scope.provide(scope));
    return { child, answers, scope, exited: () => exited };
  });
}

export function taskCodeProcessColoring(
  spawn: SpawnTaskCodeProcess,
): Effect.Effect<ColorCode, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const asked = yield* Queue.bounded<Asked>(QUEUED_MAX);
    let standing: Spawned | undefined;
    let lastId = 0;

    const retire = (spawned: Spawned) =>
      Effect.suspend(() => {
        if (standing === spawned) standing = undefined;
        return Scope.close(spawned.scope, Exit.void);
      });

    const colorInProcess = ({ language, code }: Asked) =>
      Effect.gen(function* () {
        if (standing?.exited() === true) yield* retire(standing);
        const spawned = standing ?? (yield* spawnInto(scope, spawn));
        standing = spawned;
        lastId += 1;
        const id = lastId;
        const sent = yield* Effect.exit(
          Effect.try(() =>
            spawned.child.send(Schema.encodeSync(taskCodeRequestSchema)({ id, language, code })),
          ),
        );
        const lines = Exit.isSuccess(sent)
          ? yield* Effect.timeoutOption(answerFor(spawned.answers, id), COLOR_DEADLINE)
          : Option.none();
        if (Option.isSome(lines) && lines.value !== undefined) return lines.value;
        yield* Effect.logWarning("Code is drawn plain: the coloring process ended or stalled");
        yield* retire(spawned);
        return plainCodeLines(code);
      });

    const answerNext = Effect.gen(function* () {
      const next = yield* Queue.take(asked);
      if (yield* Deferred.isDone(next.answer)) return;
      const lines = yield* catchAllButInterrupt(colorInProcess(next), (cause) =>
        Effect.as(
          Effect.logWarning("Code is drawn plain: the coloring process could not be asked", cause),
          plainCodeLines(next.code),
        ),
      );
      yield* Deferred.succeed(next.answer, lines);
    });
    yield* Effect.forkScoped(Effect.forever(answerNext));

    return (language, code) =>
      Effect.suspend(() => {
        const answer = Deferred.makeUnsafe<CodeLines>();
        return Queue.offer(asked, { language, code, answer }).pipe(
          Effect.andThen(Deferred.await(answer)),
          Effect.onInterrupt(() => Deferred.interrupt(answer)),
        );
      });
  });
}
