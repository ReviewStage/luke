/**
 * task-code-worker.ts -- the colouring process's side of `task-code-remote.ts`: each block it is sent coloured in turn and answered under its id.
 *
 * The desktop's colouring process (`apps/desktop/src/utility/task-code.ts`)
 * runs this over its parent port, and so does a test over a Node child's
 * IPC channel; neither is named here. The highlighter is built in this
 * process the first time a block arrives, and a block that cannot be
 * coloured is answered plain, so the asking side always hears back.
 */
import { catchAllButInterrupt } from "@luke/runtime/effect";
import { Effect, Option, Queue, Schema } from "effect";
import { highlightSnippet } from "./task-code.js";
import {
  plainCodeLines,
  type TaskCodeRequest,
  taskCodeAnswerSchema,
  taskCodeRequestSchema,
} from "./task-code-remote.js";

/** The port the colouring process is asked over: what it is sent, and where it answers. */
export interface TaskCodeParentPort {
  readonly onMessage: (listener: (message: unknown) => void) => void;
  readonly postMessage: (message: unknown) => void;
}

/** One block coloured and answered, plain where colouring it failed. */
function answerRequest(port: TaskCodeParentPort, request: TaskCodeRequest): Effect.Effect<void> {
  return Effect.map(
    catchAllButInterrupt(highlightSnippet(request.language, request.code), (cause) =>
      Effect.as(
        Effect.logWarning("Code is drawn plain: it could not be coloured", cause),
        plainCodeLines(request.code),
      ),
    ),
    (lines) => port.postMessage(Schema.encodeSync(taskCodeAnswerSchema)({ id: request.id, lines })),
  );
}

/**
 * Answers every block `port` is sent, one at a time in the order sent, for
 * as long as the process runs. Note that a message that is not a block is
 * passed over with a warning: it carries no id to answer under.
 */
export function serveTaskCode(port: TaskCodeParentPort): Effect.Effect<never> {
  return Effect.gen(function* () {
    const sent = yield* Queue.unbounded<unknown>();
    port.onMessage((message) => {
      Queue.offerUnsafe(sent, message);
    });
    return yield* Effect.forever(
      Effect.flatMap(Queue.take(sent), (message) =>
        Option.match(Schema.decodeUnknownOption(taskCodeRequestSchema)(message), {
          onNone: () => Effect.logWarning("The colouring process was sent what is not a block"),
          onSome: (request) => answerRequest(port, request),
        }),
      ),
    );
  });
}
