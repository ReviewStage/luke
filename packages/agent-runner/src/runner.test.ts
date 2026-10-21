/**
 * runner.test.ts -- one launch of the runner against a scripted CLI playing P00's recorded stream and a fake Luke: the config line in, messages in, Stop, every event out in order through failed posts, and the launch's end where the agent's turn ends.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { EventsUndelivered } from "./events.js";
import { RunnerFailed } from "./launch.js";
import {
  EFFORT,
  IMAGE_MEDIA_TYPE,
  INPUT_LINE,
  type InputLine,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  type RunnerConfig,
  type RunnerEvent,
} from "./protocol.js";
import { runAgent } from "./runner.js";
import { fakeAppServer } from "./testing/fake-app-server.js";
import { fakeClaudeCode } from "./testing/fake-claude-code.js";
import { ANSWER, type Answer, makeFakeLuke } from "./testing/fake-luke.js";
import {
  FOLLOW_UP_TURNS,
  SHORT_TURN,
  STOPPED_COMMAND,
  STOPPED_TURN,
  type Step,
  TURN_DONE,
  WAKEUP_STOPPED_TURN,
  WORKFLOW_TURN,
} from "./testing/recorded-stream.js";

const BEARER = "runner-bearer-for-tests";
/** Note the quote, the backslash, and the newline, which a token's JSON spells escaped. */
const CLAUDE_TOKEN = 'plan-token-"for\\tests\n';
const EVENTS_URL = "https://luke.test/runner/events";
const FIRST_SEQUENCE = 7;

const ENV = {
  [RUNNER_ENV.BEARER]: BEARER,
  [RUNNER_ENV.CLAUDE_TOKEN]: CLAUDE_TOKEN,
  PATH: "/usr/bin",
};

const CONFIG: RunnerConfig = {
  cwd: "/workspace/repository",
  executable: "/opt/claude/bin/claude",
  model: "claude-sonnet",
  effort: EFFORT.HIGH,
  append: "You are a Luke coding agent.",
  resume: "00000000-0000-4000-8000-000000000001",
  firstSequence: FIRST_SEQUENCE,
  eventsUrl: EVENTS_URL,
  mcpUrl: "https://luke.test/runner/mcp",
  allowedDomains: ["github.com", "registry.npmjs.org"],
};

const FIRST_MESSAGE: InputLine = {
  type: INPUT_LINE.MESSAGE,
  content: [
    { type: "text", text: "Run Luke's probe." },
    {
      type: "image",
      source: { type: "base64", media_type: IMAGE_MEDIA_TYPE.PNG, data: "iVBORw0K" },
    },
  ],
};

/** The fake Luke events route these launches post to. */
function fakeLuke(answers: readonly Answer[] = [], watchFor?: string) {
  return makeFakeLuke({
    url: EVENTS_URL,
    firstSequence: FIRST_SEQUENCE,
    answers,
    watchFor,
  });
}

/** The events applied, less each ACCEPTED, which its own test follows, so a turn's shape reads alone. */
function withoutAccepted(events: readonly RunnerEvent[]): RunnerEvent[] {
  return events.filter(
    ({ message }) => !("type" in message && message.type === RUNNER_EVENT.ACCEPTED),
  );
}

/** The `type`, and `subtype` where it has one, of each message applied but an ACCEPTED, in order. */
function kinds(events: readonly RunnerEvent[]): string[] {
  return withoutAccepted(events).map(({ message }) => {
    if (!("type" in message)) return message.method;
    const subtype = "subtype" in message ? message.subtype : undefined;
    return subtype === undefined ? message.type : `${message.type}/${subtype}`;
  });
}

/** One launch over stdin lines the test writes, against a fake CLI and a fake Luke. */
function launch(
  steps: readonly Step[],
  luke: ReturnType<typeof fakeLuke>,
  env: Record<string, string> = ENV,
) {
  return Effect.gen(function* () {
    const cli = yield* fakeClaudeCode(steps);
    const stdin = yield* Queue.unbounded<string, Cause.Done>();
    const writeText = (text: string) => Queue.offer(stdin, text);
    const write = (line: RunnerConfig | InputLine) => writeText(JSON.stringify(line));
    const run = yield* runAgent({ lines: Stream.fromQueue(stdin), env }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(cli.layer, luke.layer, fakeAppServer([]).layer)),
      Effect.forkScoped,
    );
    return { cli: cli.record, prompted: cli.prompted, release: cli.release, write, writeText, run };
  });
}

/** A launch's outcome, with the test clock moved on until it has one, for the retries' waits. */
function settled<A, E>(fiber: Fiber.Fiber<A, E>) {
  return Effect.gen(function* () {
    for (;;) {
      const exit = fiber.pollUnsafe();
      if (exit !== undefined) return exit;
      yield* TestClock.adjust("1 second");
    }
  });
}

it.effect("posts a waiting turn in order and ends the launch only once nothing is pending", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { cli, write, run } = yield* launch(WORKFLOW_TURN, luke);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.deepEqual(kinds(luke.applied), [
      "system/init",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
      "assistant",
      "result/success",
      RUNNER_EVENT.WAITING,
      "stream_event",
      "stream_event",
      "assistant",
      "result/success",
      RUNNER_EVENT.END,
    ]);
    assert.deepEqual(
      luke.applied.map(({ sequence }) => sequence),
      luke.applied.map((_, index) => FIRST_SEQUENCE + index),
    );
    const posted = withoutAccepted(luke.applied);
    const waiting = posted[8]?.message;
    assert.ok(waiting !== undefined && "type" in waiting && waiting.type === RUNNER_EVENT.WAITING);
    assert.equal(waiting.background_tasks.length, 1);
    assert.equal(waiting.session_crons.length, 1);
    assert.ok(JSON.stringify(posted[11]?.message).includes(TURN_DONE.FIRST));
    assert.deepEqual(luke.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.TURN_ENDED,
    });

    assert.deepEqual(cli.prompts[0]?.message, {
      role: "user",
      content: FIRST_MESSAGE.type === INPUT_LINE.MESSAGE ? FIRST_MESSAGE.content : [],
    });
    assert.equal(cli.prompts[0]?.priority, undefined);
    assert.equal(cli.closed, true);
    assert.ok(luke.bearers.every((header) => header === `Bearer ${BEARER}`));
  }),
);

it.effect(
  "hands a stop to the CLI during a long foreground command, and a message and a model change while the turn runs",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke([], STOPPED_COMMAND);
      const { cli, prompted, write, run } = yield* launch(STOPPED_TURN, luke);
      yield* write(CONFIG);
      yield* write({
        type: INPUT_LINE.MESSAGE,
        content: [{ type: "text", text: "Run sleep 600." }],
      });
      yield* luke.seen;

      yield* write({
        type: INPUT_LINE.MESSAGE,
        content: [{ type: "text", text: "And then stop." }],
      });
      yield* Queue.take(prompted);
      yield* Queue.take(prompted);
      yield* write({
        type: INPUT_LINE.MODEL,
        model: "claude-opus",
        effort: EFFORT.LOW,
        fast: true,
      });
      yield* write({ type: INPUT_LINE.MODEL, fast: false });
      yield* write({ type: INPUT_LINE.STOP });

      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
      assert.equal(cli.interrupts, 1);
      assert.deepEqual(
        cli.prompts.map((prompt) => prompt.priority),
        [undefined, "next"],
      );
      assert.deepEqual(cli.models, ["claude-opus"]);
      assert.deepEqual(cli.efforts, [EFFORT.LOW]);
      assert.deepEqual(cli.fastModes, [true, false]);
      assert.deepEqual(kinds(luke.applied).slice(-2), [
        "result/error_during_execution",
        RUNNER_EVENT.END,
      ]);
      assert.deepEqual(luke.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.STOPPED,
      });
    }),
);

it.effect("skips a stop meant for another launch's turn, and takes the one naming its own", () =>
  Effect.gen(function* () {
    const luke = fakeLuke([], STOPPED_COMMAND);
    const { cli, write, run } = yield* launch(STOPPED_TURN, luke);
    yield* write(CONFIG);
    yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Run sleep 600." }] });
    yield* luke.seen;

    // A Stop of the launch before this one, delayed past it: its turn is not this launch's.
    yield* write({ type: INPUT_LINE.STOP, launch: FIRST_SEQUENCE - 7 });
    yield* write({ type: INPUT_LINE.STOP, launch: FIRST_SEQUENCE });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.equal(cli.interrupts, 1);
  }),
);

it.effect("keeps the CLI up for a message sent during a turn until a turn answers it", () =>
  Effect.gen(function* () {
    const luke = fakeLuke([], "Working on the first message.");
    const { cli, prompted, release, write, run } = yield* launch(FOLLOW_UP_TURNS, luke);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* luke.seen;
    yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Also this." }] });
    yield* Queue.take(prompted);
    yield* Queue.take(prompted);
    yield* release;

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.deepEqual(
      cli.prompts.map((prompt) => prompt.priority),
      [undefined, "next"],
    );
    assert.deepEqual(kinds(luke.applied), [
      "system/init",
      "assistant",
      "result/success",
      "assistant",
      "result/success",
      RUNNER_EVENT.END,
    ]);
  }),
);

it.effect("interrupts a turn a wakeup started when Luke stops it", () =>
  Effect.gen(function* () {
    const luke = fakeLuke([], STOPPED_COMMAND);
    const { cli, write, run } = yield* launch(WAKEUP_STOPPED_TURN, luke);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* luke.seen;
    yield* write({ type: INPUT_LINE.STOP });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.equal(cli.interrupts, 1);
    assert.deepEqual(kinds(luke.applied).slice(-4), [
      RUNNER_EVENT.WAITING,
      "assistant",
      "result/error_during_execution",
      RUNNER_EVENT.END,
    ]);
  }),
);

it.effect("takes the launch's secrets out of every event it posts", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const leak: Step = {
      emit: {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: `${CLAUDE_TOKEN} ${BEARER}` },
            { type: "text", text: "a literal \\n stays" },
          ],
        },
        parent_tool_use_id: null,
      },
    };
    const { write, run } = yield* launch([leak, ...SHORT_TURN], luke);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.deepEqual(withoutAccepted(luke.applied)[0]?.message, {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "[redacted] [redacted]" },
          { type: "text", text: "a literal \\n stays" },
        ],
      },
      parent_tool_use_id: null,
    });
    const posted = JSON.stringify(luke.applied);
    for (const secret of [CLAUDE_TOKEN, BEARER]) {
      assert.ok(!posted.includes(JSON.stringify(secret).slice(1, -1)));
    }
  }),
);

it.effect("takes a test-mode launch's API key out of every event, as it does a plan's token", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const apiKey = "sk-ant-api03-test-mode-key-for-tests";
    const leak: Step = {
      emit: {
        type: "assistant",
        message: { content: [{ type: "text", text: `the key is ${apiKey}` }] },
        parent_tool_use_id: null,
      },
    };
    const { write, run } = yield* launch([leak, ...SHORT_TURN], luke, {
      [RUNNER_ENV.BEARER]: BEARER,
      [RUNNER_ENV.API_KEY]: apiKey,
    });
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.ok(JSON.stringify(luke.applied).includes("the key is [redacted]"));
    assert.ok(!JSON.stringify(luke.applied).includes(apiKey));
  }),
);

it.effect("leaves an escape that only looks like a secret's spelling as it was", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const said: Step = {
      emit: {
        type: "assistant",
        message: { content: [{ type: "text", text: "a literal \\n stays" }] },
        parent_tool_use_id: null,
      },
    };
    const { write, run } = yield* launch([said, ...SHORT_TURN], luke, {
      ...ENV,
      [RUNNER_ENV.CLAUDE_TOKEN]: "\n",
    });
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.deepEqual(withoutAccepted(luke.applied)[0]?.message, said.emit);
  }),
);

it.effect("ends a waiting launch at once on a stop, with no turn to interrupt", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { cli, write, run } = yield* launch(SHORT_TURN, luke);
    yield* write(CONFIG);
    yield* write({ type: INPUT_LINE.STOP });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.equal(cli.interrupts, 0);
    assert.equal(cli.closed, true);
    assert.deepEqual(kinds(luke.applied), [RUNNER_EVENT.END]);
  }),
);

it.effect("posts each event once and in order through posts Luke failed or never answered", () =>
  Effect.gen(function* () {
    const luke = fakeLuke([ANSWER.SERVER_ERROR, ANSWER.UNREACHABLE, ANSWER.TAKE_THEN_FAIL]);
    const { write, run } = yield* launch(SHORT_TURN, luke);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);

    const exit = yield* settled(run);
    assert.ok(Exit.isSuccess(exit));
    assert.equal(exit.value, RUNNER_END.TURN_ENDED);
    assert.ok(luke.posts() > 3);
    assert.deepEqual(kinds(luke.applied), [
      "system/init",
      "assistant",
      "result/success",
      RUNNER_EVENT.END,
    ]);
    assert.deepEqual(
      luke.applied.map(({ sequence }) => sequence),
      luke.applied.map((_, index) => FIRST_SEQUENCE + index),
    );
    assert.equal(luke.applied.length, 5);
  }),
);

it.effect(
  "posts each message's uuid as accepted ahead of handing it to the CLI, which takes it as the prompt's own",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke([], "Working on the first message.");
      const { cli, prompted, release, write, run } = yield* launch(FOLLOW_UP_TURNS, luke);
      const first = "6f1c2a4e-3b7d-4c8e-9a0b-1d2e3f405162";
      yield* write(CONFIG);
      yield* write({ ...FIRST_MESSAGE, uuid: first });
      yield* luke.seen;
      // A line that names no uuid is still accepted, under one the runner minted.
      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Also this." }] });
      yield* Queue.take(prompted);
      yield* Queue.take(prompted);
      yield* release;

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const accepted = luke.applied.filter(
        ({ message }) => "type" in message && message.type === RUNNER_EVENT.ACCEPTED,
      );
      assert.deepEqual(
        accepted.map(({ message }) => message),
        cli.prompts.map((prompt) => ({ type: RUNNER_EVENT.ACCEPTED, uuid: prompt.uuid })),
      );
      assert.equal(cli.prompts[0]?.uuid, first);
      assert.notEqual(cli.prompts[1]?.uuid, undefined);
      assert.deepEqual(luke.applied[0]?.message, accepted[0]?.message);
    }),
);

it.effect("skips a message line whose uuid is not a UUID, handing the CLI nothing", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { cli, writeText, write, run } = yield* launch(SHORT_TURN, luke);
    yield* write(CONFIG);
    yield* writeText(JSON.stringify({ type: INPUT_LINE.MESSAGE, uuid: "not-a-uuid", content: [] }));
    yield* write({ type: INPUT_LINE.STOP });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.deepEqual(cli.prompts, []);
    assert.deepEqual(kinds(luke.applied), [RUNNER_EVENT.END]);
    assert.equal(luke.applied.length, 1);
  }),
);

it.effect("ends the launch, closing the CLI, when Luke refuses its bearer", () =>
  Effect.gen(function* () {
    const luke = fakeLuke([ANSWER.REFUSE]);
    const { cli, write, run } = yield* launch(STOPPED_TURN, luke);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);

    const exit = yield* Fiber.await(run);
    assert.ok(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    assert.ok(error instanceof EventsUndelivered);
    assert.equal(error.transient, false);
    assert.equal(luke.posts(), 1);
    assert.equal(cli.closed, true);
  }),
);

it.effect(
  "starts the CLI with the plan's options, its bearer only in the MCP header, and both secrets denied to commands",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke();
      const { cli, write, run } = yield* launch(SHORT_TURN, luke);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* Fiber.join(run);

      const options = cli.options;
      assert.ok(options);
      assert.equal(options.cwd, CONFIG.cwd);
      assert.equal(options.pathToClaudeCodeExecutable, CONFIG.executable);
      assert.equal(options.model, CONFIG.model);
      assert.equal(options.effort, CONFIG.effort);
      assert.equal(options.resume, CONFIG.resume);
      assert.deepEqual(options.systemPrompt, {
        type: "preset",
        preset: "claude_code",
        append: CONFIG.append,
      });
      assert.deepEqual(options.settingSources, ["project"]);
      assert.equal(options.permissionMode, "bypassPermissions");
      assert.equal(options.includePartialMessages, true);
      assert.deepEqual(options.mcpServers, {
        luke: { type: "http", url: CONFIG.mcpUrl, headers: { Authorization: `Bearer ${BEARER}` } },
      });
      assert.equal(options.sandbox?.enabled, true);
      assert.equal(options.sandbox?.failIfUnavailable, true);
      assert.equal(options.sandbox?.enableWeakerNestedSandbox, true);
      assert.deepEqual(options.sandbox?.network?.allowedDomains, CONFIG.allowedDomains);
      const denied = (options.sandbox?.credentials?.envVars ?? []).map(
        (rule: { name: string; mode: string }) => `${rule.name}:${rule.mode}`,
      );
      assert.ok(denied.includes(`${RUNNER_ENV.CLAUDE_TOKEN}:deny`));
      assert.ok(denied.includes(`${RUNNER_ENV.BEARER}:deny`));
      assert.equal(options.env?.[RUNNER_ENV.BEARER], undefined);
      assert.equal(options.env?.[RUNNER_ENV.CLAUDE_TOKEN], CLAUDE_TOKEN);
    }),
);

it.effect(
  "starts the CLI with its own fast mode opted in where the config asks for it, and off otherwise",
  () =>
    Effect.gen(function* () {
      const fast = yield* launch(SHORT_TURN, fakeLuke());
      yield* fast.write({ ...CONFIG, fast: true });
      yield* fast.write(FIRST_MESSAGE);
      yield* Fiber.join(fast.run);
      assert.deepEqual(fast.cli.options?.settings, { fastMode: true });

      const standard = yield* launch(SHORT_TURN, fakeLuke());
      yield* standard.write(CONFIG);
      yield* standard.write(FIRST_MESSAGE);
      yield* Fiber.join(standard.run);
      assert.equal(standard.cli.options?.settings, undefined);
    }),
);

it.effect(
  "never starts the CLI without its bearer or a config line it can read, sequence numbers safe",
  () =>
    Effect.gen(function* () {
      const unsigned = yield* launch(SHORT_TURN, fakeLuke(), { PATH: "/usr/bin" });
      yield* unsigned.write(CONFIG);
      const withoutBearer = yield* Fiber.await(unsigned.run);

      const unreadable = yield* launch(SHORT_TURN, fakeLuke());
      yield* unreadable.writeText(JSON.stringify({ ...CONFIG, eventsUrl: undefined }));
      const withoutConfig = yield* Fiber.await(unreadable.run);

      const unsafe = yield* launch(SHORT_TURN, fakeLuke());
      yield* unsafe.write({ ...CONFIG, firstSequence: 2 ** 53 });
      const unsafeSequence = yield* Fiber.await(unsafe.run);

      for (const [exit, cli] of [
        [withoutBearer, unsigned.cli],
        [withoutConfig, unreadable.cli],
        [unsafeSequence, unsafe.cli],
      ] as const) {
        assert.ok(Exit.isFailure(exit));
        assert.ok(Cause.squash(exit.cause) instanceof RunnerFailed);
        assert.equal(cli.options, undefined);
      }
    }),
);
