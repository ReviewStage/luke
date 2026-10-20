/**
 * fake-claude-code.ts -- a scripted CLI for the runner's tests: it plays a recorded turn once Luke's first message arrives, and keeps what the runner handed it.
 *
 * It stands at the process boundary the runner drives the real CLI across,
 * so a test sees what the CLI would have: the options it was started with,
 * every prompt in order, the interrupts, the model and effort changes, and
 * whether it was closed. It runs the runner's own Stop hook where the CLI
 * would, before the `result` it precedes.
 */

import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { Deferred, Effect, Exit, Layer, Queue, Stream } from "effect";
import { ClaudeCode, type ClaudeCodeSession } from "../claude-code.js";
import type { Step } from "./recorded-stream.js";

/** An effort the CLI was set to, as `applyFlagSettings` takes it. */
type EffortSetting = Parameters<ClaudeCodeSession["applyFlagSettings"]>[0]["effortLevel"];

/** What the fake CLI was handed, in the order it was handed it. */
interface CliRecord {
  options: Options | undefined;
  readonly prompts: SDKUserMessage[];
  interrupts: number;
  readonly models: (string | undefined)[];
  readonly efforts: EffortSetting[];
  closed: boolean;
}

/** The runner's Stop hook, as the CLI calls it. */
function stopHookOf(options: Options) {
  const hook = options.hooks?.Stop?.[0]?.hooks[0];
  if (hook === undefined) throw new Error("the runner registered no Stop hook");
  return hook;
}

/**
 * A fake CLI that plays `steps` once, from Luke's first message. `prompted`
 * holds each prompt as the CLI reads it, for a test that must wait on one.
 */
export const fakeClaudeCode = Effect.fn("agent-runner/fakeClaudeCode")(function* (
  steps: readonly Step[],
) {
  const prompted = yield* Queue.unbounded<SDKUserMessage>();
  const record: CliRecord = {
    options: undefined,
    prompts: [],
    interrupts: 0,
    models: [],
    efforts: [],
    closed: false,
  };

  const query = (params: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: Options;
  }): ClaudeCodeSession => {
    record.options = params.options;
    const started = Deferred.makeUnsafe<void>();
    const interrupted = Deferred.makeUnsafe<void>();

    // Note that the prompts are read for as long as Luke sends them, as the
    // CLI reads its stdin, while the script plays beside them.
    const prompts = Stream.fromAsyncIterable(params.prompt, (cause) => cause).pipe(
      Stream.tap((prompt) =>
        Effect.sync(() => record.prompts.push(prompt)).pipe(
          Effect.andThen(Queue.offer(prompted, prompt)),
          Effect.andThen(Deferred.succeed(started, undefined)),
        ),
      ),
      Stream.drain,
    );
    const play = (step: Step): Stream.Stream<SDKMessage> => {
      if ("emit" in step) {
        // Note that the message crosses as a line of JSON, which the SDK takes
        // as an `SDKMessage` unchecked, just as it reads the CLI's stdout.
        const message: SDKMessage = JSON.parse(JSON.stringify(step.emit));
        return Stream.make(message);
      }
      if ("untilInterrupted" in step)
        return Stream.drain(Stream.fromEffect(Deferred.await(interrupted)));
      const hook = stopHookOf(params.options);
      const run = Effect.promise((signal) =>
        hook(
          {
            hook_event_name: "Stop",
            session_id: "fake",
            transcript_path: "/home/agent/.claude/projects/fake.jsonl",
            cwd: params.options.cwd ?? "",
            stop_hook_active: false,
            ...step.stopHook,
          },
          undefined,
          { signal },
        ),
      );
      return Stream.drain(Stream.fromEffect(run));
    };
    const script = Stream.fromEffect(Deferred.await(started)).pipe(
      Stream.flatMap(() => Stream.fromIterable(steps)),
      Stream.flatMap(play),
    );
    const messages = Stream.toAsyncIterable(Stream.merge(script, prompts));

    return {
      [Symbol.asyncIterator]: () => messages[Symbol.asyncIterator](),
      interrupt: async () => {
        record.interrupts += 1;
        Deferred.doneUnsafe(interrupted, Exit.void);
      },
      setModel: async (model) => {
        record.models.push(model);
      },
      applyFlagSettings: async (settings) => {
        record.efforts.push(settings.effortLevel);
      },
      close: () => {
        record.closed = true;
      },
    };
  };

  return { layer: Layer.succeed(ClaudeCode, { query }), record, prompted };
});
