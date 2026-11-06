import { readFileSync } from "node:fs";
import { type Cause, Effect, Layer, Option, Predicate, Queue, Schema, Sink, Stream } from "effect";
import * as PlatformError from "effect/PlatformError";
import { type ChildProcess, ChildProcessSpawner } from "effect/process";
import type { RequestMethod, RequestParams } from "../app-server.js";

const RecordedMessageSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Json),
  result: Schema.optionalKey(Schema.Json),
  error: Schema.optionalKey(Schema.Json),
  emittedAtMs: Schema.optionalKey(Schema.Number),
});
export type RecordedMessage = typeof RecordedMessageSchema.Type;

const RecordedLineSchema = Schema.Struct({
  phase: Schema.String,
  direction: Schema.Literals(["client", "server"]),
  message: RecordedMessageSchema,
});
const decodeRecordedLine = Schema.decodeUnknownSync(Schema.fromJsonString(RecordedLineSchema));
const decodeReceived = Schema.decodeUnknownOption(Schema.fromJsonString(RecordedMessageSchema));
const decodeClientId = Schema.decodeUnknownOption(
  Schema.Struct({ clientUserMessageId: Schema.String }),
);

export interface Exchange {
  readonly method: string;
  readonly reply: readonly RecordedMessage[];
  readonly holdAnswer?: Effect.Effect<void>;
  readonly beforeReply?: (process: Spawned) => Effect.Effect<void>;
}

export interface Script {
  readonly exchanges: readonly Exchange[];
  readonly exitWith?: string;
}

export interface Spawned {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly received: RecordedMessage[];
  readonly unexpected: string[];
  ended: boolean;
}

const RECORDING = new URL("./app-server.jsonl", import.meta.url);

export function recordedExchanges(phase: string): readonly Exchange[] {
  const exchanges: { method: string; reply: RecordedMessage[] }[] = [];
  const lines = readFileSync(RECORDING, "utf8").split("\n");
  for (const line of lines.filter((text) => text !== "").map((text) => decodeRecordedLine(text))) {
    if (line.phase !== phase) continue;
    if (line.direction === "client") {
      exchanges.push({ method: line.message.method ?? "", reply: [] });
    } else {
      exchanges.at(-1)?.reply.push(line.message);
    }
  }
  return exchanges;
}

export function received<M extends RequestMethod>(
  process: Pick<Spawned, "received"> | undefined,
  method: M,
): RequestParams<M>[] {
  return (process?.received ?? []).flatMap((message) =>
    message.method === method ? [message.params as RequestParams<M>] : [],
  );
}

function replyLines(
  reply: readonly RecordedMessage[],
  answering: RecordedMessage,
): { readonly line: string; readonly isAnswer: boolean }[] {
  const recordedId = reply.find((message) => message.method === undefined)?.id;
  const clientId = Option.flatMap(Option.fromNullishOr(answering.params), decodeClientId);
  return reply.map((message) => {
    const answered =
      message.method === undefined && message.id === recordedId && answering.id !== undefined
        ? { ...message, id: answering.id }
        : message;
    const line = JSON.stringify(answered);
    if (message.method === undefined) return { line, isAnswer: true };
    return {
      line: Option.isSome(clientId)
        ? line.replace(
            '"clientId":null',
            `"clientId":${JSON.stringify(clientId.value.clientUserMessageId)}`,
          )
        : line,
      isAnswer: false,
    };
  });
}

const encoder = new TextEncoder();

export function fakeAppServer(scripts: readonly Script[]) {
  const spawned: Spawned[] = [];
  const spawn = (command: ChildProcess.Command) =>
    Effect.gen(function* () {
      if (command._tag !== "StandardCommand") return yield* Effect.die("a pipeline was spawned");
      const script = scripts[spawned.length];
      if (script === undefined) {
        return yield* Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
            description: `no script for ${command.command}`,
          }),
        );
      }
      const record: Spawned = {
        program: command.command,
        args: command.args,
        cwd: command.options.cwd,
        env: command.options.env ?? {},
        received: [],
        unexpected: [],
        ended: false,
      };
      spawned.push(record);
      const stdout = yield* Queue.unbounded<Uint8Array, PlatformError.PlatformError | Cause.Done>();
      const stderr = yield* Queue.unbounded<Uint8Array, PlatformError.PlatformError | Cause.Done>();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          record.ended = true;
        }).pipe(Effect.andThen(Queue.end(stdout)), Effect.andThen(Queue.end(stderr))),
      );
      let next = 0;
      const take = (message: RecordedMessage) =>
        Effect.gen(function* () {
          record.received.push(message);
          const exchange = script.exchanges[next];
          if (exchange === undefined || exchange.method !== message.method) {
            record.unexpected.push(message.method ?? "");
            return;
          }
          next += 1;
          if (exchange.beforeReply !== undefined) yield* exchange.beforeReply(record);
          const lines = replyLines(exchange.reply, message);
          const held = exchange.holdAnswer;
          const first = held === undefined ? lines : lines.filter(({ isAnswer }) => !isAnswer);
          for (const { line } of first) yield* Queue.offer(stdout, encoder.encode(`${line}\n`));
          if (held !== undefined) {
            yield* held;
            for (const { line } of lines.filter(({ isAnswer }) => isAnswer)) {
              yield* Queue.offer(stdout, encoder.encode(`${line}\n`));
            }
          }
          if (next === script.exchanges.length && script.exitWith !== undefined) {
            yield* Queue.offer(stderr, encoder.encode(script.exitWith));
            yield* Queue.end(stderr);
            yield* Queue.end(stdout);
          }
        });
      if (script.exchanges.length === 0 && script.exitWith !== undefined) {
        yield* Queue.offer(stderr, encoder.encode(script.exitWith));
        yield* Queue.end(stderr);
        yield* Queue.end(stdout);
      }
      const input = command.options.stdin;
      if (Predicate.hasProperty(input, "stream") && Stream.isStream(input.stream)) {
        yield* input.stream.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) =>
            Option.match(decodeReceived(line), { onNone: () => Effect.void, onSome: take }),
          ),
          Effect.ignore,
          Effect.forkScoped,
        );
      }
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(spawned.length),
        exitCode: Effect.never,
        isRunning: Effect.sync(() => !record.ended),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.fromQueue(stdout),
        stderr: Stream.fromQueue(stderr),
        all: Stream.fromQueue(stdout),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    });
  return {
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(spawn)),
    spawned,
  };
}
