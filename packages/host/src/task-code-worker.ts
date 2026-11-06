import { catchAllButInterrupt } from "@repo/runtime/effect";
import { Effect, Option, Queue, Schema } from "effect";
import { highlightSnippet } from "./task-code.js";
import {
  plainCodeLines,
  type TaskCodeRequest,
  taskCodeAnswerSchema,
  taskCodeRequestSchema,
} from "./task-code-remote.js";

export interface TaskCodeParentPort {
  readonly onMessage: (listener: (message: unknown) => void) => void;
  readonly postMessage: (message: unknown) => void;
}

function answerRequest(port: TaskCodeParentPort, request: TaskCodeRequest): Effect.Effect<void> {
  return Effect.map(
    catchAllButInterrupt(highlightSnippet(request.language, request.code), (cause) =>
      Effect.as(
        Effect.logWarning("Code is drawn plain: it could not be colored", cause),
        plainCodeLines(request.code),
      ),
    ),
    (lines) => port.postMessage(Schema.encodeSync(taskCodeAnswerSchema)({ id: request.id, lines })),
  );
}

export function serveTaskCode(port: TaskCodeParentPort): Effect.Effect<never> {
  return Effect.gen(function* () {
    const sent = yield* Queue.unbounded<unknown>();
    port.onMessage((message) => {
      Queue.offerUnsafe(sent, message);
    });
    return yield* Effect.forever(
      Effect.flatMap(Queue.take(sent), (message) =>
        Option.match(Schema.decodeUnknownOption(taskCodeRequestSchema)(message), {
          onNone: () => Effect.logWarning("The coloring process was sent what is not a block"),
          onSome: (request) => answerRequest(port, request),
        }),
      ),
    );
  });
}
