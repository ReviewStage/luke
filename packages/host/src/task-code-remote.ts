/**
 * task-code-remote.ts -- a fenced block coloured in a process of its own, asked one at a time, so colouring never holds this process's event loop.
 *
 * Shiki's tokenizer runs synchronously, up to `COLOURED_CODE_MAX_CHARS` of
 * code in two themes at a time, and building its highlighter loads every
 * grammar at once; in the process that answers every window's acts, each
 * of those holds every act and push behind it. So the desktop colours in a
 * child process it spawns the first time code is asked for
 * (`task-code-worker.ts` is what that process runs), and this module is the
 * asking side: one queue, one block in flight at a time and answered in the
 * order it was asked, a block whose caller went away before its turn never
 * sent, and a process that died or stalled replaced by the next block's
 * own, its block drawn plain, which a window already draws for a block it
 * could not colour. Nothing here names Electron or Node: the process is a
 * seam (`SpawnTaskCodeProcess`), so the desktop forks it with Electron's
 * `utilityProcess` and a test with Node's own child process.
 */
import { type CodeLines, type CodeToken, codeLinesSchema } from "@luke/features/tasks-view";
import { catchAllButInterrupt } from "@luke/runtime/effect";
import { type Cause, Deferred, Duration, Effect, Exit, Option, Queue, Schema, Scope } from "effect";

/**
 * How many blocks wait for the process before a further ask waits for room.
 * Note that a window opening a long transcript asks for each of its blocks
 * at once, so the queue holds a transcript's worth, and an ask past it waits
 * in its own fiber rather than being refused or drawn plain.
 */
const QUEUED_MAX = 256;

/**
 * How long one block may take in the process before it is drawn plain and the
 * process replaced. The first block of a process waits on the highlighter's
 * build too, which is well under this.
 */
const COLOUR_DEADLINE = Duration.seconds(10);

/** A block sent to the process: its fence's language and its code, under an id its answer carries back. */
export const taskCodeRequestSchema = Schema.Struct({
  id: Schema.Number,
  language: Schema.String,
  code: Schema.String,
});

export type TaskCodeRequest = typeof taskCodeRequestSchema.Type;

/** What the process answers for a block: the id it was sent under and its lines. */
export const taskCodeAnswerSchema = Schema.Struct({
  id: Schema.Number,
  lines: codeLinesSchema,
});

/** A process that colours, as the asking side holds it: a message sent to it, and its end. */
export interface TaskCodeProcess {
  readonly send: (message: unknown) => void;
  readonly kill: () => void;
}

/** What the process's spawner hands what it hears: each message, and the process's exit. */
export interface TaskCodeProcessListeners {
  readonly onMessage: (message: unknown) => void;
  readonly onExit: () => void;
}

/** Starts a process that colours, wired to `listeners`; a throw is a process that could not be started. */
export type SpawnTaskCodeProcess = (listeners: TaskCodeProcessListeners) => TaskCodeProcess;

/** A block's colouring as the window's act asks for it. */
export type ColourCode = (language: string, code: string) => Effect.Effect<CodeLines>;

/** One process standing: what it was spawned as, what it answered, and the scope that ends it. */
interface Spawned {
  readonly child: TaskCodeProcess;
  readonly answers: Queue.Queue<unknown, Cause.Done>;
  readonly scope: Scope.Closeable;
  /** Whether the process has exited, so no further block is sent to it. */
  readonly exited: () => boolean;
}

/** A block asked for and the answer its caller waits on, interrupted where the caller went away. */
interface Asked {
  readonly language: string;
  readonly code: string;
  readonly answer: Deferred.Deferred<CodeLines>;
}

/** A block's lines drawn plain, one run a line, as a window draws a block it could not colour. */
export function plainCodeLines(code: string): CodeToken[][] {
  return code.split("\n").map((text) => (text === "" ? [] : [{ text }]));
}

/** The lines the process answered for `id`, or none where it ended first or answered what it should not. */
function answerFor(
  answers: Queue.Queue<unknown, Cause.Done>,
  id: number,
): Effect.Effect<CodeLines | undefined> {
  return Effect.matchEffect(Queue.take(answers), {
    onFailure: () => Effect.succeed(undefined),
    onSuccess: (message) => {
      const answer = Schema.decodeUnknownOption(taskCodeAnswerSchema)(message);
      if (Option.isNone(answer)) return Effect.succeed(undefined);
      // Note that an answer for an earlier id is one a stalled block gave too late, and is passed over.
      return answer.value.id === id ? Effect.succeed(answer.value.lines) : answerFor(answers, id);
    },
  });
}

/** Spawns a process into a scope of its own under `parent`, so its scope's close, or the parent's, kills it. */
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

/**
 * Colouring through a process `spawn` starts the first time a block is asked
 * for and that stands for the life of the scope this runs in, whose close
 * kills it. Note that blocks are sent one at a time rather than all at once,
 * so a caller that goes away while its block waits is never sent, and a
 * process that dies costs the one block it held: that block is drawn plain,
 * and the next block spawns a new process.
 */
export function taskCodeProcessColouring(
  spawn: SpawnTaskCodeProcess,
): Effect.Effect<ColourCode, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const asked = yield* Queue.bounded<Asked>(QUEUED_MAX);
    let standing: Spawned | undefined;
    let lastId = 0;

    // The process standing ends, so the next block spawns its own.
    const retire = (spawned: Spawned) =>
      Effect.suspend(() => {
        if (standing === spawned) standing = undefined;
        return Scope.close(spawned.scope, Exit.void);
      });

    const colourInProcess = ({ language, code }: Asked) =>
      Effect.gen(function* () {
        // Note that a process that exited while idle is retired before the block, so the block is coloured by its replacement rather than drawn plain.
        if (standing?.exited() === true) yield* retire(standing);
        const spawned = standing ?? (yield* spawnInto(scope, spawn));
        standing = spawned;
        lastId += 1;
        const id = lastId;
        // Note that a send the process refuses, as one already gone may, is answered as its death is.
        const sent = yield* Effect.exit(
          Effect.try(() =>
            spawned.child.send(Schema.encodeSync(taskCodeRequestSchema)({ id, language, code })),
          ),
        );
        const lines = Exit.isSuccess(sent)
          ? yield* Effect.timeoutOption(answerFor(spawned.answers, id), COLOUR_DEADLINE)
          : Option.none();
        if (Option.isSome(lines) && lines.value !== undefined) return lines.value;
        yield* Effect.logWarning("Code is drawn plain: the colouring process ended or stalled");
        yield* retire(spawned);
        return plainCodeLines(code);
      });

    // Note that a block whose caller went away is passed over, and a process that could not be spawned draws its block plain.
    const answerNext = Effect.gen(function* () {
      const next = yield* Queue.take(asked);
      if (yield* Deferred.isDone(next.answer)) return;
      const lines = yield* catchAllButInterrupt(colourInProcess(next), (cause) =>
        Effect.as(
          Effect.logWarning("Code is drawn plain: the colouring process could not be asked", cause),
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
