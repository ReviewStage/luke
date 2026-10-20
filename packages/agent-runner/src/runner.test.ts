/**
 * runner.test.ts -- one launch of the runner against a scripted CLI playing P00's recorded stream and a fake Luke: the config line in, messages in, Stop, every event out in order through failed posts, and the launch's end where the agent's turn ends.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { type FakeResponder, fakeHttpClientLayer } from "@luke/wire/testing";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { EventsUndelivered } from "./events.js";
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
import { RunnerFailed, runAgent } from "./runner.js";
import { fakeClaudeCode } from "./testing/fake-claude-code.js";
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

/** How a fake Luke answers one post: take it, fail as a server, or fail before answering. */
const ANSWER = {
  TAKE: "take",
  SERVER_ERROR: "server_error",
  TAKE_THEN_FAIL: "take_then_fail",
  UNREACHABLE: "unreachable",
  REFUSE: "refuse",
} as const;
type Answer = (typeof ANSWER)[keyof typeof ANSWER];

/**
 * A fake Luke events route. It applies each sequence at most once, as the
 * real route does, so a batch posted again changes nothing; answers each post
 * as the next of `answers` says, then takes every later one; and settles
 * `seen` once an applied message holds `watchFor`.
 */
function fakeLuke(answers: readonly Answer[] = [], watchFor?: string) {
  const applied: RunnerEvent[] = [];
  const bearers: (string | null)[] = [];
  let posts = 0;
  const seen = Deferred.makeUnsafe<void>();

  const respond: FakeResponder = async (url, init) => {
    assert.equal(url, EVENTS_URL);
    bearers.push(new Headers(init.headers).get("authorization"));
    const answer = answers[posts] ?? ANSWER.TAKE;
    posts += 1;
    if (answer === ANSWER.UNREACHABLE) throw new Error("connection reset");
    if (answer === ANSWER.REFUSE) return new Response(null, { status: 401 });
    if (answer === ANSWER.SERVER_ERROR) return new Response(null, { status: 503 });
    const batch: { events: RunnerEvent[] } = JSON.parse(String(init.body));
    const last = applied.at(-1)?.sequence ?? FIRST_SEQUENCE - 1;
    for (const event of batch.events) {
      if (event.sequence <= last) continue;
      applied.push(event);
      if (watchFor !== undefined && JSON.stringify(event.message).includes(watchFor)) {
        Deferred.doneUnsafe(seen, Exit.void);
      }
    }
    return new Response(null, { status: answer === ANSWER.TAKE_THEN_FAIL ? 500 : 204 });
  };
  return {
    layer: fakeHttpClientLayer(respond),
    applied,
    bearers,
    posts: () => posts,
    seen: Deferred.await(seen),
  };
}

/** The `type`, and `subtype` where it has one, of each message applied, in order. */
function kinds(events: readonly RunnerEvent[]): string[] {
  return events.map(({ message }) => {
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
      Effect.provide(Layer.mergeAll(cli.layer, luke.layer)),
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
    const waiting = luke.applied[8]?.message;
    assert.ok(waiting?.type === RUNNER_EVENT.WAITING);
    assert.equal(waiting.background_tasks.length, 1);
    assert.equal(waiting.session_crons.length, 1);
    assert.ok(JSON.stringify(luke.applied[11]?.message).includes(TURN_DONE.FIRST));
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
      yield* write({ type: INPUT_LINE.MODEL, model: "claude-opus", effort: EFFORT.LOW });
      yield* write({ type: INPUT_LINE.STOP });

      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
      assert.equal(cli.interrupts, 1);
      assert.deepEqual(
        cli.prompts.map((prompt) => prompt.priority),
        [undefined, "next"],
      );
      assert.deepEqual(cli.models, ["claude-opus"]);
      assert.deepEqual(cli.efforts, [EFFORT.LOW]);
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

    assert.deepEqual(luke.applied[0]?.message, {
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
      [FIRST_SEQUENCE, FIRST_SEQUENCE + 1, FIRST_SEQUENCE + 2, FIRST_SEQUENCE + 3],
    );
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
