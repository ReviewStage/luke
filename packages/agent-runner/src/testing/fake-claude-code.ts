import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { Deferred, Effect, Exit, Layer, Queue, Stream } from "effect";
import { ClaudeCode, type ClaudeCodeSession } from "../claude-code.js";
import type { Step, StopReport } from "./recorded-stream.js";

type EffortSetting = Parameters<ClaudeCodeSession["applyFlagSettings"]>[0]["effortLevel"];

interface CliRecord {
  options: Options | undefined;
  readonly prompts: SDKUserMessage[];
  interrupts: number;
  readonly models: (string | undefined)[];
  readonly efforts: EffortSetting[];
  readonly fastModes: (boolean | null | undefined)[];
  closed: boolean;
}

function stopHookOf(options: Options) {
  const hook = options.hooks?.Stop?.[0]?.hooks[0];
  if (hook === undefined) throw new Error("the runner registered no Stop hook");
  return hook;
}

export const fakeClaudeCode = Effect.fn("agent-runner/fakeClaudeCode")(function* (
  steps: readonly Step[],
  chain: readonly string[] = [],
  answering = true,
) {
  const prompted = yield* Queue.unbounded<SDKUserMessage>();
  const unread = yield* Queue.unbounded<string>();
  const released = yield* Deferred.make<void>();
  const interrupted = yield* Deferred.make<void>();
  const closing = yield* Deferred.make<void>();
  const record: CliRecord = {
    options: undefined,
    prompts: [],
    interrupts: 0,
    models: [],
    efforts: [],
    fastModes: [],
    closed: false,
  };

  const query = (params: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: Options;
  }): ClaudeCodeSession => {
    record.options = params.options;
    const taken: string[] = [];

    const prompts = Stream.fromAsyncIterable(params.prompt, (cause) => cause).pipe(
      Stream.tap((prompt) =>
        Effect.sync(() => record.prompts.push(prompt)).pipe(
          Effect.andThen(Queue.offer(prompted, prompt)),
          Effect.andThen(Queue.offer(unread, prompt.uuid ?? "")),
        ),
      ),
      Stream.drain,
    );
    const runHook = (report: StopReport) => {
      const hook = stopHookOf(params.options);
      return Effect.promise((signal) =>
        hook(
          {
            hook_event_name: "Stop",
            session_id: "fake",
            transcript_path: "/home/agent/.claude/projects/fake.jsonl",
            cwd: params.options.cwd ?? "",
            stop_hook_active: false,
            ...report,
          },
          undefined,
          { signal },
        ),
      );
    };
    const play = (step: Step): Stream.Stream<SDKMessage> => {
      if ("emit" in step) {
        const message: SDKMessage = JSON.parse(JSON.stringify(step.emit));
        if (message.type === "result" && step.namesNoPrompt !== true) {
          message.user_message_uuids = taken.splice(0);
        }
        return Stream.make(message);
      }
      if ("awaitPrompt" in step) {
        return Stream.drain(
          Stream.fromEffect(Effect.map(Queue.take(unread), (uuid) => taken.push(uuid))),
        );
      }
      if ("untilInterrupted" in step)
        return Stream.drain(Stream.fromEffect(Deferred.await(interrupted)));
      if ("untilReleased" in step) return Stream.drain(Stream.fromEffect(Deferred.await(released)));
      return Stream.drain(Stream.fromEffect(runHook(step.stopHook)));
    };
    const script = Stream.fromIterable<Step>([{ awaitPrompt: true }, ...steps]).pipe(
      Stream.flatMap(play),
    );
    const messages = Stream.toAsyncIterable(
      Stream.merge(script, prompts).pipe(Stream.interruptWhen(Deferred.await(closing))),
    );
    async function* read() {
      for await (const message of messages) yield message;
    }
    const sdkMessages = read();

    const answer = (): Promise<undefined> =>
      answering ? Promise.resolve(undefined) : Promise.race([]);
    return {
      [Symbol.asyncIterator]: () => sdkMessages,
      interrupt: () => {
        record.interrupts += 1;
        if (answering) Deferred.doneUnsafe(interrupted, Exit.void);
        return answer();
      },
      setModel: (model) => {
        record.models.push(model);
        return answer();
      },
      applyFlagSettings: (settings) => {
        if ("effortLevel" in settings) record.efforts.push(settings.effortLevel);
        if ("fastMode" in settings) record.fastModes.push(settings.fastMode);
        return answer();
      },
      close: () => {
        record.closed = true;
        Deferred.doneUnsafe(closing, Exit.void);
      },
    };
  };

  const release = Deferred.succeed(released, undefined);
  const sessionChain = async () => chain;
  return {
    layer: Layer.succeed(ClaudeCode, { query, sessionChain }),
    record,
    prompted,
    release,
  };
});
