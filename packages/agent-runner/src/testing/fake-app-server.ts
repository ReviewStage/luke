/**
 * fake-app-server.ts -- a scripted `codex app-server` for the runner's tests: each spawn answers the runner's JSON-RPC from P16's recorded notifications, and keeps what the operating system would have seen.
 *
 * It is a `ChildProcessSpawner`, the door the runner spawns the real process
 * through, so a test sees what the sandbox would: the program, argv,
 * directory and environment each process was started with, every message
 * the runner wrote to its stdin in order, and whether it was ended. Each
 * spawned process plays one script: an exchange per message the runner
 * sends, matched by method, whose recorded reply is written to stdout with
 * the recorded request's id replaced by the runner's. As the real app-server
 * does (checked against codex 0.163.0, which echoes it), a `userMessage` item
 * in a turn's reply carries the `clientUserMessageId` the runner sent with
 * that `turn/start` or `turn/steer` as its `clientId`; P16's recording was
 * made without one, so its items say `null`.
 */

import { readFileSync } from "node:fs";
import { type Cause, Effect, Layer, Option, Predicate, Queue, Schema, Sink, Stream } from "effect";
import * as PlatformError from "effect/PlatformError";
import { type ChildProcess, ChildProcessSpawner } from "effect/process";
import type { RequestMethod, RequestParams } from "../app-server.js";

/** One message of app-server's stdio, as P16 recorded it, every field it uses kept. */
const RecordedMessageSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Json),
  result: Schema.optionalKey(Schema.Json),
  error: Schema.optionalKey(Schema.Json),
  emittedAtMs: Schema.optionalKey(Schema.Number),
});
export type RecordedMessage = typeof RecordedMessageSchema.Type;

/** One line of P16's recording: which phase of the probe, which way it went, and what it said. */
const RecordedLineSchema = Schema.Struct({
  phase: Schema.String,
  direction: Schema.Literals(["client", "server"]),
  message: RecordedMessageSchema,
});
const decodeRecordedLine = Schema.decodeUnknownSync(Schema.fromJsonString(RecordedLineSchema));
const decodeReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(RecordedMessageSchema)),
);
const decodeReceived = Schema.decodeUnknownOption(Schema.fromJsonString(RecordedMessageSchema));
const decodeClientId = Schema.decodeUnknownOption(
  Schema.Struct({ clientUserMessageId: Schema.String }),
);

/** What one spawned process replies to one message of the runner's, matched by its method. */
export interface Exchange {
  readonly method: string;
  readonly reply: readonly RecordedMessage[];
  /** Holds the answer back, writing the reply's notifications first, until this settles. */
  readonly holdAnswer?: Effect.Effect<void>;
  /**
   * Runs before anything of the reply is written, with the process as the
   * operating system saw it: what app-server does on its own meanwhile, such
   * as running its provider's token command as a turn's requests go out.
   */
  readonly beforeReply?: (process: Spawned) => Effect.Effect<void>;
}

/** One spawned process's script: its exchanges in order, and, where it crashes, what it last says. */
export interface Script {
  readonly exchanges: readonly Exchange[];
  /** Ends the process's stdout once its exchanges are played (at once, with none), with this on stderr. */
  readonly exitWith?: string;
}

/** One process as the operating system saw it. */
export interface Spawned {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Every message the runner wrote to its stdin, in order. */
  readonly received: RecordedMessage[];
  /** A message the script did not expect, by its method, where one came. */
  readonly unexpected: string[];
  ended: boolean;
}

const RECORDING = new URL("./app-server.jsonl", import.meta.url);

/**
 * P16's hermetic recording of codex 0.163.0's app-server as exchanges, per
 * phase: each message the probe sent, and what app-server wrote after it
 * until the probe's next message.
 */
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

/** An exchange with every occurrence of `text` in its reply replaced, such as to plant a secret in a tool's output. */
export function withReplyText(exchange: Exchange, text: string, replacement: string): Exchange {
  const reply = decodeReply(JSON.stringify(exchange.reply).replaceAll(text, replacement));
  return { method: exchange.method, reply };
}

/** The params of each message of `method` a process received, in order, as the protocol types them. */
export function received<M extends RequestMethod>(
  process: Pick<Spawned, "received"> | undefined,
  method: M,
): RequestParams<M>[] {
  return (process?.received ?? []).flatMap((message) =>
    // SAFETY: the runner sends each request with the params the pinned protocol types for its method.
    message.method === method ? [message.params as RequestParams<M>] : [],
  );
}

/**
 * A reply as the lines app-server writes: the recorded request's id made the
 * runner's, and a turn's user message named by the runner's client id.
 */
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
    // Note that only a `userMessage` item carries a `clientId` in the protocol.
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

/** A spawner that plays `scripts[n]` for the n-th process spawned; one past the scripts fails to start. */
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
