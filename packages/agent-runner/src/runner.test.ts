/**
 * runner.test.ts -- one launch of the runner against a scripted CLI playing P00's recorded stream and a fake Luke: the config line in, messages in, Stop, every event out in order through failed posts, a heartbeat while the CLI says nothing, and the launch's end where the agent's turn ends.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { claudeCodeLive } from "./claude-code.js";
import { EventsUndelivered } from "./events.js";
import { RunnerFailed } from "./launch.js";
import { processTable } from "./processes.js";
import {
  EFFORT,
  IMAGE_MEDIA_TYPE,
  INPUT_LINE,
  INSTALLED_SKILLS,
  type InputLine,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HEARTBEAT,
  RUNNER_RELEASE,
  RUNNER_WARM,
  type RunnerConfig,
  type RunnerEvent,
} from "./protocol.js";
import { runAgent } from "./runner.js";
import { fakeAppServer } from "./testing/fake-app-server.js";
import { fakeClaudeCode } from "./testing/fake-claude-code.js";
import { ANSWER, type Answer, makeFakeLuke } from "./testing/fake-luke.js";
import { type FakeProcess, fakeProc, UNREAD_PROC } from "./testing/fake-proc.js";
import {
  BACKGROUND_WAIT,
  FOLLOW_UP_TURNS,
  RECURRING_WAIT,
  SHORT_TURN,
  STOPPED_COMMAND,
  STOPPED_TURN,
  type Step,
  TURN_DONE,
  WAKEUP,
  WAKEUP_STOPPED_TURN,
  WAKEUP_WAIT,
  WAKEUP_WAIT_THEN_MESSAGE,
  WARM_TURNS,
  WORKFLOW_TURN,
} from "./testing/recorded-stream.js";

const BEARER = "runner-bearer-for-tests";
/** Note the quote, the backslash, and the newline, which a token's JSON spells escaped. */
const CLAUDE_TOKEN = 'plan-token-"for\\tests\n';
const EVENTS_URL = "https://luke.test/runner/events";
const FIRST_SEQUENCE = 7;
/** The runner's own pid in the test's `/proc`. */
const RUNNER_PID = 100;

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
  integrations: [{ name: "linear", url: "https://luke.test/runner/mcp/integrations/linear" }],
  allowedDomains: ["github.com", "registry.npmjs.org"],
};

/** The integration server the config hands the agent. */
const LINEAR_SERVER = { name: "linear", url: "https://luke.test/runner/mcp/integrations/linear" };

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
  proc: string = UNREAD_PROC,
  chain: readonly string[] = [],
) {
  return Effect.gen(function* () {
    const cli = yield* fakeClaudeCode(steps, chain);
    const stdin = yield* Queue.unbounded<string, Cause.Done>();
    const writeText = (text: string) => Queue.offer(stdin, text);
    const write = (line: RunnerConfig | InputLine) => writeText(JSON.stringify(line));
    const run = yield* runAgent({ lines: Stream.fromQueue(stdin), env }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          cli.layer,
          luke.layer,
          fakeAppServer([]).layer,
          processTable(proc, RUNNER_PID),
        ),
      ),
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

/** How many IDLE events Luke has taken. */
function idles(luke: ReturnType<typeof fakeLuke>): number {
  return luke.applied.filter(
    ({ message }) => "type" in message && message.type === RUNNER_EVENT.IDLE,
  ).length;
}

/** Waits, without moving the clock, until Luke has taken the IDLE events given. */
function untilIdles(luke: ReturnType<typeof fakeLuke>, count: number) {
  return Effect.gen(function* () {
    for (let step = 0; step < 5_000 && idles(luke) < count; step += 1) yield* Effect.yieldNow;
    assert.equal(idles(luke), count);
  });
}

const WARM_CONFIG: RunnerConfig = { ...CONFIG, warm: true };

it.effect(
  "keeps a warm launch up past its turn, posting IDLE, takes the next message as a fresh turn of the same CLI, and ends as idled when Luke retires it",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke();
      const { cli, write, run } = yield* launch(WARM_TURNS, luke);
      yield* write(WARM_CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* untilIdles(luke, 1);
      assert.equal(run.pollUnsafe(), undefined, "the launch stays up past its turn");

      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "And this." }] });
      yield* untilIdles(luke, 2);
      yield* write({ type: INPUT_LINE.RETIRE });

      assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
      assert.deepEqual(kinds(luke.applied), [
        "system/init",
        "assistant",
        "result/success",
        RUNNER_EVENT.IDLE,
        "assistant",
        "result/success",
        RUNNER_EVENT.IDLE,
        RUNNER_EVENT.END,
      ]);
      assert.deepEqual(luke.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.IDLED,
      });
      // The second message found no turn running, so it is no follow-up queued behind one.
      assert.deepEqual(
        cli.prompts.map((prompt) => prompt.priority),
        [undefined, undefined],
      );
      assert.equal(cli.closed, true);
    }),
);

it.effect("a retire written behind a message is skipped, and the message's turn runs", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { write, run } = yield* launch(WARM_TURNS, luke);
    yield* write(WARM_CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* untilIdles(luke, 1);

    yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "And this." }] });
    yield* write({ type: INPUT_LINE.RETIRE });
    yield* untilIdles(luke, 2);
    assert.equal(run.pollUnsafe(), undefined, "the retire behind the message ended nothing");
    yield* write({ type: INPUT_LINE.RETIRE });

    assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
  }),
);

it.effect("a warm launch nobody retires ends as idled at its cap", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { write, run } = yield* launch(SHORT_TURN, luke);
    yield* write(WARM_CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* untilIdles(luke, 1);
    yield* TestClock.adjust(Duration.millis(RUNNER_WARM.IDLE_CAP_MS - 1));
    assert.equal(run.pollUnsafe(), undefined);

    yield* TestClock.adjust(Duration.millis(1));

    assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
  }),
);

it.effect(
  "a launch the config does not ask to stay warm ends at its turn's end and skips a retire",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke();
      const { write, run } = yield* launch(SHORT_TURN, luke);
      yield* write(CONFIG);
      yield* write({ type: INPUT_LINE.RETIRE });
      yield* write(FIRST_MESSAGE);

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.equal(idles(luke), 0);
    }),
);

it.effect(
  "posts a heartbeat with no events every interval while the harness says nothing, and none once the launch ended",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke([], "Working on the first message.");
      const { prompted, release, write, run } = yield* launch(FOLLOW_UP_TURNS, luke);
      const heartbeats = () =>
        luke.bodies.filter((body) => JSON.parse(body).events.length === 0).length;
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* luke.seen;
      const beforeAny = heartbeats();
      // Each interval is let run out, and its heartbeat land, before the next begins.
      for (const beat of [1, 2]) {
        yield* TestClock.adjust(Duration.millis(RUNNER_HEARTBEAT.EVERY_MS));
        for (let step = 0; step < 500 && heartbeats() < beat; step += 1) yield* Effect.yieldNow;
      }
      const whileSilent = heartbeats();
      yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Also this." }] });
      yield* Queue.take(prompted);
      yield* Queue.take(prompted);
      yield* release;
      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      yield* TestClock.adjust(Duration.millis(2 * RUNNER_HEARTBEAT.EVERY_MS));

      assert.equal(beforeAny, 0);
      assert.equal(whileSilent, 2);
      assert.equal(heartbeats(), 2, "a launch that ended posts no heartbeat");
      assert.ok(luke.bearers.every((header) => header === `Bearer ${BEARER}`));
    }),
);

it.effect("lets a heartbeat Luke never answers go, and posts the next one an interval on", () =>
  Effect.gen(function* () {
    const luke = fakeLuke([], "Working on the first message.");
    let hung = 0;
    // Luke holds the first heartbeat open, answering nothing until the runner lets it go.
    const stalling: typeof luke = {
      ...luke,
      layer: fakeHttpClientLayer((url, init) => {
        if (hung === 0 && JSON.parse(String(init.body)).events.length === 0) {
          hung += 1;
          return new Promise<Response>((_, reject) =>
            init.signal?.addEventListener("abort", () => reject(new Error("let go"))),
          );
        }
        return luke.respond(url, init);
      }),
    };
    const { prompted, release, write, run } = yield* launch(FOLLOW_UP_TURNS, stalling);
    const heartbeats = () =>
      luke.bodies.filter((body) => JSON.parse(body).events.length === 0).length;
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* luke.seen;
    yield* TestClock.adjust(Duration.millis(RUNNER_HEARTBEAT.EVERY_MS));
    for (let step = 0; step < 500 && hung === 0; step += 1) yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.millis(RUNNER_HEARTBEAT.TIMEOUT_MS));
    yield* TestClock.adjust(Duration.millis(RUNNER_HEARTBEAT.EVERY_MS));
    for (let step = 0; step < 500 && heartbeats() === 0; step += 1) yield* Effect.yieldNow;
    const afterStall = heartbeats();
    yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Also this." }] });
    yield* Queue.take(prompted);
    yield* Queue.take(prompted);
    yield* release;

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    assert.equal(hung, 1);
    assert.equal(afterStall, 1, "the heartbeat after the one Luke held went out");
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

it.effect(
  "a launch on an Anthropic API key hands the key to the CLI alone: denied to commands and taken out of every event",
  () =>
    Effect.gen(function* () {
      const apiKey = "account-api-key-for-tests";
      const luke = fakeLuke();
      const leak: Step = {
        emit: {
          type: "assistant",
          message: { content: [{ type: "text", text: `key ${apiKey}` }] },
          parent_tool_use_id: null,
        },
      };
      const { cli, write, run } = yield* launch([leak, ...SHORT_TURN], luke, {
        [RUNNER_ENV.BEARER]: BEARER,
        [RUNNER_ENV.API_KEY]: apiKey,
        PATH: "/usr/bin",
      });
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* Fiber.join(run);

      assert.equal(cli.options?.env?.[RUNNER_ENV.API_KEY], apiKey);
      const denied = (cli.options?.sandbox?.credentials?.envVars ?? []).map(
        (rule: { name: string; mode: string }) => `${rule.name}:${rule.mode}`,
      );
      assert.ok(denied.includes(`${RUNNER_ENV.API_KEY}:deny`));
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
  "starts the CLI with the plan's options, Luke's MCP server in process with no secret, and both secrets denied to commands",
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
      const mcp = options.mcpServers?.luke;
      assert.equal(mcp?.type, "sdk");
      assert.ok(!JSON.stringify(options).includes(BEARER));
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
  "loads the member's installed skills as a local plugin where Luke wrote them, and none where it wrote none",
  () =>
    Effect.gen(function* () {
      const folder = mkdtempSync(join(tmpdir(), "luke-installed-skills-"));
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(folder, { recursive: true })));
      const missing = join(folder, "never-written");
      const installed = join(folder, "installed");
      mkdirSync(join(installed, ".claude-plugin"), { recursive: true });
      writeFileSync(join(installed, INSTALLED_SKILLS.MANIFEST), '{"name":"luke"}\n');

      const optionsWith = (installedSkills: string) =>
        Effect.gen(function* () {
          const { cli, write, run } = yield* launch(SHORT_TURN, fakeLuke());
          yield* write({ ...CONFIG, installedSkills });
          yield* write(FIRST_MESSAGE);
          yield* Fiber.join(run);
          return cli.options;
        });

      const withSkills = yield* optionsWith(installed);
      const withNone = yield* optionsWith(missing);

      assert.deepEqual(withSkills?.plugins, [
        { type: "local", path: installed, skipMcpDiscovery: true },
      ]);
      // The checkout's own settings stay the only ones read.
      assert.deepEqual(withSkills?.settingSources, ["project"]);
      assert.equal(withNone?.plugins, undefined);
    }),
);

/** The MCP route of a fake Luke: answers each request as its server does, notifications with 202, and keeps what each post carried. */
function fakeMcpRoute(answer: "take" | "refuse" = "take") {
  const calls: { authorization: string | null; body: unknown }[] = [];
  const respond = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ authorization: new Headers(init.headers).get("authorization"), body });
    if (answer === "refuse") return new Response(null, { status: 401 });
    if (!("id" in body)) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
  };
  return { calls, respond };
}

/** The CLI's end of the control channel an SDK MCP server is connected to: what the server sent it, in order. */
function fakeCliTransport() {
  const sent: unknown[] = [];
  const answered = Deferred.makeUnsafe<void>();
  const transport = {
    onmessage: undefined as
      | ((message: { jsonrpc: "2.0"; method: string; id?: number }) => void)
      | undefined,
    start: async () => {},
    close: async () => {},
    send: async (message: unknown) => {
      sent.push(message);
      Deferred.doneUnsafe(answered, Exit.void);
    },
  };
  return { transport, sent, answered };
}

/** A launch whose Luke answers the MCP server's route as `mcp` does, and that SDK server the CLI was handed, connected to a fake channel; Luke's own unless an integration's is named. */
function launchWithMcp(
  mcp: ReturnType<typeof fakeMcpRoute>,
  named: { readonly name: string; readonly url: string } = { name: "luke", url: CONFIG.mcpUrl },
) {
  return Effect.gen(function* () {
    const luke = fakeLuke();
    const routed: typeof luke = {
      ...luke,
      layer: fakeHttpClientLayer((url, init) =>
        url === named.url ? mcp.respond(url, init) : luke.respond(url, init),
      ),
    };
    const launched = yield* launch(SHORT_TURN, routed);
    yield* launched.write(CONFIG);
    for (let step = 0; step < 500 && launched.cli.options === undefined; step += 1) {
      yield* Effect.yieldNow;
    }
    const server = launched.cli.options?.mcpServers?.[named.name];
    assert.ok(server?.type === "sdk" && "instance" in server);
    const cli = fakeCliTransport();
    // @ts-expect-error -- the fake stands in for the SDK's own control-channel transport.
    yield* Effect.promise(() => server.instance.connect(cli.transport));
    return { ...launched, channel: cli };
  });
}

it.effect("relays the CLI's MCP messages to Luke under the runner's bearer, over no socket", () =>
  Effect.gen(function* () {
    const mcp = fakeMcpRoute();
    const { channel, write, run } = yield* launchWithMcp(mcp);

    channel.transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
    channel.transport.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    yield* Deferred.await(channel.answered);
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.deepEqual(channel.sent, [{ jsonrpc: "2.0", id: 1, result: { tools: [] } }]);
    assert.deepEqual(
      mcp.calls.map(({ authorization }) => authorization),
      [`Bearer ${BEARER}`, `Bearer ${BEARER}`],
    );
    assert.deepEqual(
      mcp.calls.map(({ body }) => body),
      [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
      ],
    );
  }),
);

it.effect(
  "hands the CLI each integration as a server of its own, relayed to its endpoint under the runner's bearer",
  () =>
    Effect.gen(function* () {
      const mcp = fakeMcpRoute();
      const { channel, write, run, cli } = yield* launchWithMcp(mcp, LINEAR_SERVER);

      channel.transport.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      yield* Deferred.await(channel.answered);
      yield* write(FIRST_MESSAGE);
      yield* Fiber.join(run);

      assert.deepEqual(Object.keys(cli.options?.mcpServers ?? {}), ["luke", "linear"]);
      assert.deepEqual(channel.sent, [{ jsonrpc: "2.0", id: 1, result: { tools: [] } }]);
      assert.deepEqual(
        mcp.calls.map(({ authorization, body }) => ({ authorization, body })),
        [
          {
            authorization: `Bearer ${BEARER}`,
            body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
          },
        ],
      );
    }),
);

it.effect("answers the CLI's MCP request with a JSON-RPC error where Luke refuses it", () =>
  Effect.gen(function* () {
    const { channel, write, run } = yield* launchWithMcp(fakeMcpRoute("refuse"));

    channel.transport.onmessage?.({ jsonrpc: "2.0", id: 7, method: "tools/call" });
    yield* Deferred.await(channel.answered);
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.deepEqual(channel.sent, [
      { jsonrpc: "2.0", id: 7, error: { code: -32603, message: "Luke answered 401" } },
    ]);
  }),
);

it.effect(
  "starts the claude process with no bearer or MCP address in its argv, and listens on no port",
  () =>
    Effect.gen(function* () {
      const directory = mkdtempSync(join(tmpdir(), "agent-runner-argv-"));
      const argvFile = join(directory, "argv");
      const executable = join(directory, "claude");
      // A CLI that writes down the argv it was started with and exits.
      writeFileSync(executable, `#!/bin/sh\nprintf '%s\\0' "$@" > '${argvFile}'\n`);
      chmodSync(executable, 0o755);
      const listen = vi.spyOn(Server.prototype, "listen");
      const luke = fakeLuke();
      const stdin = yield* Queue.unbounded<string, Cause.Done>();
      const run = yield* runAgent({ lines: Stream.fromQueue(stdin), env: ENV }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            claudeCodeLive,
            luke.layer,
            fakeAppServer([]).layer,
            processTable(UNREAD_PROC, RUNNER_PID),
          ),
        ),
        Effect.forkScoped,
      );
      yield* Queue.offer(stdin, JSON.stringify({ ...CONFIG, executable, cwd: directory }));
      yield* Fiber.await(run);
      const listened = listen.mock.calls.length;
      vi.restoreAllMocks();

      const argv = readFileSync(argvFile, "utf8").split("\0");
      rmSync(directory, { recursive: true });
      assert.ok(argv.includes("--input-format"), "the stub CLI was started");
      assert.ok(argv.every((argument) => !argument.includes(BEARER)));
      assert.ok(argv.every((argument) => !argument.includes(CONFIG.mcpUrl)));
      assert.ok(argv.every((argument) => !argument.includes(LINEAR_SERVER.url)));
      assert.ok(!argv.includes("--mcp-config"));
      assert.equal(listened, 0, "the launch opened no listening socket");
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

/** The sandbox's processes while the agent waits: the sandbox's init, the runner, the CLI it spawned, and the CLI's own command-sandbox bridge (a `socat`), nothing of the agent's beside them. */
const WAITING_PROCESSES: readonly FakeProcess[] = [
  { pid: 1, parent: 0, emptied: false },
  { pid: RUNNER_PID, parent: 1, emptied: true },
  { pid: RUNNER_PID + 1, parent: RUNNER_PID, emptied: true },
  {
    pid: RUNNER_PID + 2,
    parent: RUNNER_PID + 1,
    emptied: true,
    argv: [
      "socat",
      "UNIX-LISTEN:/tmp/claude-http-46b2d3fe1057cdcd.sock,fork,reuseaddr",
      "TCP:localhost:38551,keepalive,keepidle=10,keepintvl=5,keepcnt=3",
    ],
  },
];
/** A dev server the agent started, detached from its shell onto the sandbox's init. */
const DEV_SERVER: FakeProcess = { pid: 4242, parent: 1, emptied: true };
/** A `socat` of the agent's own beside the CLI's bridge, forwarding a port of its choosing. */
const AGENT_SOCAT: FakeProcess = {
  pid: 4343,
  parent: RUNNER_PID + 1,
  emptied: true,
  argv: ["socat", "TCP-LISTEN:5432,fork", "UNIX-CONNECT:/tmp/db.sock"],
};

/** When the recorded wakeup's one-shot schedule, `17 12 21 10 *`, next comes due from the test clock's start, in local time. */
const WAKEUP_DUE = new Date(1970, 9, 21, 12, 17).toISOString();

it.effect(
  "releases a wait on a one-shot wakeup alone once it has lasted two minutes, naming the wakeup in its END",
  () =>
    Effect.gen(function* () {
      const proc = yield* fakeProc(WAITING_PROCESSES);
      const luke = fakeLuke([], WAKEUP.prompt);
      const { cli, write, run } = yield* launch(WAKEUP_WAIT, luke, ENV, proc);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* luke.seen;

      yield* TestClock.adjust(RUNNER_RELEASE.SETTLE_MS - 1);
      assert.equal(run.pollUnsafe(), undefined);
      yield* TestClock.adjust(1);
      assert.equal(yield* Fiber.join(run), RUNNER_END.RELEASED);
      assert.deepEqual(luke.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.RELEASED,
        wakeups: [{ at: WAKEUP_DUE, prompt: WAKEUP.prompt }],
      });
      assert.equal(cli.closed, true);
    }),
);

it.effect.each([
  ["a dev server", DEV_SERVER],
  ["a socat of its own", AGENT_SOCAT],
] as const)(
  "holds a wait while %s the agent started runs, and releases it once that process ends",
  ([, process]) =>
    Effect.gen(function* () {
      const proc = yield* fakeProc([...WAITING_PROCESSES, process]);
      const luke = fakeLuke([], WAKEUP.prompt);
      const { write, run } = yield* launch(WAKEUP_WAIT, luke, ENV, proc);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* luke.seen;

      yield* TestClock.adjust(RUNNER_RELEASE.SETTLE_MS + 10 * RUNNER_RELEASE.RECHECK_MS);
      assert.equal(run.pollUnsafe(), undefined);
      rmSync(join(proc, String(process.pid)), { recursive: true });
      yield* TestClock.adjust(RUNNER_RELEASE.RECHECK_MS);
      assert.equal(yield* Fiber.join(run), RUNNER_END.RELEASED);
    }),
);

it.effect("never releases a wait on a background task, the agent's own process", () =>
  Effect.gen(function* () {
    const proc = yield* fakeProc(WAITING_PROCESSES);
    const luke = fakeLuke([], RUNNER_EVENT.WAITING);
    const { write, run } = yield* launch(BACKGROUND_WAIT, luke, ENV, proc);
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* luke.seen;

    yield* TestClock.adjust(2 * RUNNER_RELEASE.IDLE_CAP_MS);
    assert.equal(run.pollUnsafe(), undefined);
    yield* write({ type: INPUT_LINE.STOP });
    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
  }),
);

it.effect(
  "holds a recurring task's wait for the idle cap, then releases it with no wakeup to deliver",
  () =>
    Effect.gen(function* () {
      const proc = yield* fakeProc(WAITING_PROCESSES);
      const luke = fakeLuke([], RUNNER_EVENT.WAITING);
      const { write, run } = yield* launch(RECURRING_WAIT, luke, ENV, proc);
      yield* write(CONFIG);
      yield* write(FIRST_MESSAGE);
      yield* luke.seen;

      yield* TestClock.adjust(RUNNER_RELEASE.IDLE_CAP_MS - RUNNER_RELEASE.RECHECK_MS);
      assert.equal(run.pollUnsafe(), undefined);
      yield* TestClock.adjust(RUNNER_RELEASE.RECHECK_MS);
      assert.equal(yield* Fiber.join(run), RUNNER_END.RELEASED);
      assert.deepEqual(luke.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.RELEASED,
        wakeups: [],
      });
    }),
);

it.effect("keeps a waiting launch whose wait a message from Luke turned into a turn", () =>
  Effect.gen(function* () {
    const proc = yield* fakeProc(WAITING_PROCESSES);
    const luke = fakeLuke([], WAKEUP.prompt);
    const { prompted, release, write, run } = yield* launch(
      WAKEUP_WAIT_THEN_MESSAGE,
      luke,
      ENV,
      proc,
    );
    yield* write(CONFIG);
    yield* write(FIRST_MESSAGE);
    yield* luke.seen;
    yield* write({ type: INPUT_LINE.MESSAGE, content: [{ type: "text", text: "Also this." }] });
    yield* Queue.take(prompted);
    yield* Queue.take(prompted);

    yield* TestClock.adjust(RUNNER_RELEASE.SETTLE_MS + RUNNER_RELEASE.RECHECK_MS);
    assert.equal(run.pollUnsafe(), undefined);
    yield* release;
    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
  }),
);

/** The stored session a rewind cuts: two answered prompts, each followed by the answer's entries. */
const REWOUND_CHAIN = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
];

it.effect.each([
  {
    case: "cut just before the prompt the rewind dropped",
    rewindBefore: "10000000-0000-4000-8000-000000000003",
    resume: CONFIG.resume,
    at: "10000000-0000-4000-8000-000000000002",
  },
  {
    case: "started afresh where the dropped prompt was the session's first",
    rewindBefore: "10000000-0000-4000-8000-000000000001",
    resume: undefined,
    at: undefined,
  },
  {
    case: "resumed whole where the session never held the prompt",
    rewindBefore: "10000000-0000-4000-8000-000000000009",
    resume: CONFIG.resume,
    at: undefined,
  },
])("resumes a rewound session $case", ({ rewindBefore, resume, at }) =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { cli, write, run } = yield* launch(SHORT_TURN, luke, ENV, UNREAD_PROC, REWOUND_CHAIN);
    yield* write({ ...CONFIG, rewindBefore });
    yield* write(FIRST_MESSAGE);
    yield* Fiber.join(run);

    assert.equal(cli.options?.resume, resume);
    assert.equal(cli.options?.resumeSessionAt, at);
  }),
);
