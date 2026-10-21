/**
 * codex.test.ts -- one Codex launch of the runner against a scripted app-server playing P16's recorded notifications and a fake Luke: the config line in, app-server started with the plan's provider, messages as turns and steers, Stop as an interrupt, a refreshed token as a restart between turns or, on the plan, the runner's token command run again mid-turn, every notification out in order, and the launch's end at the turn's.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { type Cause, Deferred, Effect, Fiber, Layer, Logger, Queue, Stream } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { askCodexToken } from "./codex-token.js";
import type { RunnerSelf } from "./launch.js";
import {
  CODEX_EFFORT,
  CODEX_TOKEN_COMMAND,
  type CodexConfig,
  IMAGE_MEDIA_TYPE,
  INPUT_LINE,
  type InputLine,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HARNESS,
  type RunnerEvent,
} from "./protocol.js";
import { runAgent } from "./runner.js";
import {
  type Exchange,
  fakeAppServer,
  received,
  recordedExchanges,
  type Script,
  type Spawned,
  withReplyText,
} from "./testing/fake-app-server.js";
import { fakeClaudeCode } from "./testing/fake-claude-code.js";
import { makeFakeLuke } from "./testing/fake-luke.js";

const BEARER = "runner-bearer-for-tests";
const ACCESS_TOKEN = "chatgpt-access-token-for-tests";
const REFRESHED_TOKEN = "chatgpt-refreshed-token-for-tests";
const EVENTS_URL = "https://luke.test/runner/events";
const FIRST_SEQUENCE = 11;
const THREAD = "00000000-0000-4000-8000-000000000002";

const ENV = {
  [RUNNER_ENV.BEARER]: BEARER,
  [RUNNER_ENV.CODEX_TOKEN]: ACCESS_TOKEN,
  CODEX_HOME: "/home/agent/.codex",
  PATH: "/usr/bin",
};

const CONFIG: CodexConfig = {
  harness: RUNNER_HARNESS.CODEX,
  cwd: "/srv/luke-probe-repo",
  executable: "/opt/luke-codex/bin/codex",
  model: "gpt-5.5",
  effort: CODEX_EFFORT.HIGH,
  developerInstructions: "You are a Luke coding agent.",
  firstSequence: FIRST_SEQUENCE,
  eventsUrl: EVENTS_URL,
  mcpUrl: "https://luke.test/runner/mcp",
};

/** A message line of text alone, under Luke's id for the line where one is given. */
function message(text: string, uuid?: string): InputLine {
  const line = { type: INPUT_LINE.MESSAGE, content: [{ type: "text" as const, text }] };
  return uuid === undefined ? line : { ...line, uuid };
}

/** P16's first phase: initialize, initialized, thread/start, turn/start, turn/steer, turn/start, turn/interrupt. */
const FIRST = recordedExchanges("first");
/** P16's resumed phase, after a restart: initialize, initialized, thread/resume, turn/start. */
const RESUMED = recordedExchanges("resumed");

function exchange(exchanges: readonly Exchange[], index: number): Exchange {
  const found = exchanges[index];
  if (found === undefined) throw new Error(`the recording has no exchange ${index}`);
  return found;
}

const OPEN = [exchange(FIRST, 0), exchange(FIRST, 1), exchange(FIRST, 2)];
const RESUME = [exchange(RESUMED, 0), exchange(RESUMED, 1), exchange(RESUMED, 2)];
/** The probe's first turn: an edit, a scan, an MCP call, then the CI watch a steer lands in, then completed. */
const WORKFLOW: Script = { exchanges: [...OPEN, exchange(FIRST, 3), exchange(FIRST, 4)] };
/** The probe's `sleep 600` turn, interrupted. */
const STOPPED: Script = { exchanges: [...OPEN, exchange(FIRST, 5), exchange(FIRST, 6)] };

/** The resumed turn, cut where its last two notifications (idle, turn/completed) begin. */
const RESUMED_TURN = exchange(RESUMED, 3);
const RESUMED_TURN_END = RESUMED_TURN.reply.slice(-2);

/** The method of each notification a script's replies hold, in order. */
function notified(exchanges: readonly Exchange[]): string[] {
  return exchanges.flatMap(({ reply }) =>
    reply.flatMap((line) => (line.method === undefined ? [] : [line.method])),
  );
}

/** Luke's ids for the lines a test writes, as the service sends them. */
const LINE = {
  FIRST: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e01",
  STEERED: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e02",
} as const;

/** The lines a launch said app-server took, in order. */
function acceptedLines(events: readonly RunnerEvent[]): string[] {
  return events.flatMap(({ message: posted }) =>
    "type" in posted && posted.type === RUNNER_EVENT.ACCEPTED ? [posted.uuid] : [],
  );
}

/** What each applied event was: a notification's method, or one of the runner's own. */
function kinds(events: readonly RunnerEvent[]): string[] {
  return events.map(({ message: posted }) => ("method" in posted ? posted.method : posted.type));
}

/** One Codex launch over stdin lines the test writes, against scripted app-servers and a fake Luke. */
function launch(
  scripts: readonly Script[],
  luke: ReturnType<typeof makeFakeLuke>,
  env: Record<string, string> = ENV,
  extra: { readonly self?: RunnerSelf; readonly http?: Layer.Layer<HttpClient.HttpClient> } = {},
) {
  return Effect.gen(function* () {
    const server = fakeAppServer(scripts);
    const claude = yield* fakeClaudeCode([]);
    const logged: string[] = [];
    const recorder = Logger.make(({ message: logMessage }) => {
      logged.push(JSON.stringify(logMessage));
    });
    const stdin = yield* Queue.unbounded<string, Cause.Done>();
    const write = (line: CodexConfig | InputLine) => Queue.offer(stdin, JSON.stringify(line));
    const run = yield* runAgent({ lines: Stream.fromQueue(stdin), env, self: extra.self }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          server.layer,
          extra.http ?? luke.layer,
          claude.layer,
          Logger.layer([recorder]),
        ),
      ),
      Effect.forkScoped,
    );
    return { spawned: server.spawned, write, closeStdin: Queue.end(stdin), run, logged };
  });
}

function fakeLuke(watchFor?: string) {
  return makeFakeLuke({
    url: EVENTS_URL,
    firstSequence: FIRST_SEQUENCE,
    watchFor,
  });
}

it.effect(
  "starts app-server with the plan's provider, steers the running turn, and ends at its completion",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke("ci-watch");
      const { spawned, write, run } = yield* launch([WORKFLOW], luke);
      yield* write(CONFIG);
      yield* write({
        type: INPUT_LINE.MESSAGE,
        uuid: LINE.FIRST,
        content: [
          { type: "text", text: "The probe's first turn." },
          {
            type: "image",
            source: { type: "base64", media_type: IMAGE_MEDIA_TYPE.PNG, data: "iVBORw0K" },
          },
        ],
      });
      yield* luke.seen;
      yield* write(message("Also, before your final reply, append the line.", LINE.STEERED));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(
        kinds(luke.applied).filter((kind) => kind !== RUNNER_EVENT.ACCEPTED),
        [...notified(WORKFLOW.exchanges), RUNNER_EVENT.END],
      );
      // Each line is said taken once, under Luke's own id, which Codex is handed to echo.
      assert.deepEqual(acceptedLines(luke.applied), [LINE.FIRST, LINE.STEERED]);
      assert.deepEqual(
        luke.applied.map(({ sequence }) => sequence),
        luke.applied.map((_, index) => FIRST_SEQUENCE + index),
      );
      assert.deepEqual(luke.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.TURN_ENDED,
      });
      assert.deepEqual(
        luke.bearers,
        luke.bearers.map(() => `Bearer ${BEARER}`),
      );

      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.equal(process?.program, CONFIG.executable);
      assert.equal(process?.cwd, CONFIG.cwd);
      const overrides = (process?.args ?? []).filter((_, index, args) => args[index - 1] === "-c");
      assert.deepEqual(process?.args.slice(0, 3), ["app-server", "--listen", "stdio://"]);
      assert.deepEqual(overrides, [
        'model_provider="openai_chatgpt_plan"',
        'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
        'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
        'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
        'model_providers.openai_chatgpt_plan.wire_api="responses"',
        "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
        "model_providers.openai_chatgpt_plan.supports_websockets=false",
        'mcp_servers.luke.url="https://luke.test/runner/mcp"',
        'mcp_servers.luke.bearer_token_env_var="LUKE_RUNNER_TOKEN"',
        'mcp_servers.luke.default_tools_approval_mode="approve"',
        'approval_policy="never"',
        'sandbox_mode="workspace-write"',
        "sandbox_workspace_write.network_access=true",
        `sandbox_workspace_write.writable_roots=["${CONFIG.cwd}/.git"]`,
        'shell_environment_policy.inherit="core"',
        "shell_environment_policy.ignore_default_excludes=false",
        'shell_environment_policy.exclude=["ACCESS_TOKEN", "LUKE_RUNNER_TOKEN"]',
      ]);
      // The token and the bearer reach app-server in its environment alone, never argv.
      assert.equal(process?.env[RUNNER_ENV.CODEX_TOKEN], ACCESS_TOKEN);
      assert.equal(process?.env[RUNNER_ENV.BEARER], BEARER);
      assert.equal(process?.env.CODEX_HOME, ENV.CODEX_HOME);
      assert.ok(!process?.args.some((arg) => arg.includes(ACCESS_TOKEN) || arg.includes(BEARER)));

      assert.deepEqual(received(process, "initialize"), [
        { clientInfo: { name: "Luke", title: "Luke", version: "dev" }, capabilities: null },
      ]);
      assert.deepEqual(received(process, "thread/start"), [
        {
          cwd: CONFIG.cwd,
          model: CONFIG.model,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          developerInstructions: CONFIG.developerInstructions,
        },
      ]);
      const [start] = received(process, "turn/start");
      assert.equal(start?.threadId, THREAD);
      assert.equal(start?.clientUserMessageId, LINE.FIRST);
      assert.equal(start?.model, CONFIG.model);
      assert.equal(start?.effort, CODEX_EFFORT.HIGH);
      assert.deepEqual(start?.input, [
        { type: "text", text: "The probe's first turn.", text_elements: [] },
        { type: "image", url: "data:image/png;base64,iVBORw0K" },
      ]);
      const [steer] = received(process, "turn/steer");
      assert.equal(steer?.clientUserMessageId, LINE.STEERED);
      assert.equal(steer?.expectedTurnId, "00000000-0000-4000-8000-000000000003");
      assert.deepEqual(steer?.input, [
        {
          type: "text",
          text: "Also, before your final reply, append the line.",
          text_elements: [],
        },
      ]);
      assert.ok(process?.ended);
    }),
);

it.effect("interrupts the running turn on a stop and ends the launch as stopped", () =>
  Effect.gen(function* () {
    const luke = fakeLuke("sleep 600");
    const { spawned, write, run } = yield* launch([STOPPED], luke);
    yield* write(CONFIG);
    yield* write({ type: INPUT_LINE.MODEL, model: "gpt-5.5-codex", effort: CODEX_EFFORT.LOW });
    yield* write(message("Run `sleep 600` and wait for it to finish."));
    yield* luke.seen;
    yield* write({ type: INPUT_LINE.STOP });

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    const [start] = received(process, "turn/start");
    assert.equal(start?.model, "gpt-5.5-codex");
    assert.equal(start?.effort, CODEX_EFFORT.LOW);
    assert.deepEqual(received(process, "turn/interrupt"), [
      { threadId: THREAD, turnId: "00000000-0000-4000-8000-000000000006" },
    ]);
    assert.deepEqual(kinds(luke.applied).slice(-2), ["turn/completed", RUNNER_EVENT.END]);
    assert.deepEqual(luke.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.STOPPED,
    });
  }),
);

it.effect(
  "resumes the thread it is given and sends a message the ended turn refused as the next turn",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke("What exact line");
      const script: Script = {
        exchanges: [
          ...RESUME,
          { method: "turn/start", reply: RESUMED_TURN.reply.slice(0, -2) },
          {
            method: "turn/steer",
            reply: [
              { id: 4, error: { code: -32600, message: "no active turn to steer" } },
              ...RESUMED_TURN_END,
            ],
          },
          RESUMED_TURN,
        ],
      };
      const { spawned, write, run } = yield* launch([script], luke);
      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
      yield* luke.seen;
      yield* write(message("And the second line?", LINE.STEERED));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.deepEqual(received(process, "thread/start"), []);
      assert.deepEqual(received(process, "thread/resume"), [
        {
          cwd: CONFIG.cwd,
          model: CONFIG.model,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          developerInstructions: CONFIG.developerInstructions,
          threadId: THREAD,
          excludeTurns: true,
        },
      ]);
      const starts = received(process, "turn/start");
      assert.equal(starts.length, 2);
      assert.deepEqual(starts[1]?.input, [
        { type: "text", text: "And the second line?", text_elements: [] },
      ]);
      assert.equal(
        starts[1]?.clientUserMessageId,
        received(process, "turn/steer")[0]?.clientUserMessageId,
      );
      assert.deepEqual(kinds(luke.applied).filter((kind) => kind === "turn/completed").length, 2);
      // The refused steer's line is said taken when the next turn takes it, not before.
      assert.deepEqual(acceptedLines(luke.applied), [LINE.FIRST, LINE.STEERED]);
      const steeredAt = luke.applied.findIndex(
        ({ message: posted }) =>
          "type" in posted && posted.type === RUNNER_EVENT.ACCEPTED && posted.uuid === LINE.STEERED,
      );
      const firstCompletedAt = kinds(luke.applied).indexOf("turn/completed");
      assert.ok(steeredAt > firstCompletedAt);
    }),
);

it.effect(
  "restarts app-server with a refreshed token between turns and never lets a token out",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke();
      // The reply carries both tokens, as a tool's output might, to show they are taken out.
      const leaky = withReplyText(
        RESUMED_TURN,
        "luke-probe-hermetic",
        `${ACCESS_TOKEN} ${REFRESHED_TOKEN}`,
      );
      const { spawned, write, run, logged } = yield* launch(
        [{ exchanges: OPEN }, { exchanges: [...RESUME, leaky] }],
        luke,
      );
      yield* write(CONFIG);
      yield* write({ type: INPUT_LINE.TOKEN, accessToken: REFRESHED_TOKEN });
      yield* write(message("What exact line did you first write to PROBE.md?"));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [first, second] = spawned;
      assert.ok(first?.ended);
      assert.deepEqual(received(first, "turn/start"), []);
      assert.equal(first?.env[RUNNER_ENV.CODEX_TOKEN], ACCESS_TOKEN);
      assert.equal(second?.env[RUNNER_ENV.CODEX_TOKEN], REFRESHED_TOKEN);
      assert.ok(!second?.args.some((arg) => arg.includes(REFRESHED_TOKEN)));
      assert.deepEqual(second?.unexpected, []);
      assert.equal(received(second, "thread/resume")[0]?.threadId, THREAD);
      assert.equal(received(second, "turn/start").length, 1);

      const posted = luke.bodies.join("\n");
      assert.ok(posted.includes("[redacted] [redacted]"));
      for (const secret of [ACCESS_TOKEN, REFRESHED_TOKEN, BEARER]) {
        assert.ok(!posted.includes(secret));
        assert.ok(!logged.some((line) => line.includes(secret)));
      }
    }),
);

it.effect("ends the launch as failed when app-server exits, its secrets taken out of why", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { write, run } = yield* launch(
      [{ exchanges: [...OPEN, exchange(FIRST, 3)], exitWith: `panic: bad token ${ACCESS_TOKEN}` }],
      luke,
    );
    yield* write(CONFIG);
    yield* write(message("The probe's first turn."));

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(luke.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.FAILED,
      detail: "app-server exited: panic: bad token [redacted]",
    });
  }),
);

it.effect("ends an idle launch at once on a stop, and on stdin closing, with no turn started", () =>
  Effect.gen(function* () {
    const stoppedLuke = fakeLuke();
    const stopped = yield* launch([{ exchanges: OPEN }], stoppedLuke);
    yield* stopped.write(CONFIG);
    yield* stopped.write({ type: INPUT_LINE.STOP });
    assert.equal(yield* Fiber.join(stopped.run), RUNNER_END.STOPPED);
    assert.deepEqual(received(stopped.spawned[0], "turn/start"), []);
    assert.deepEqual(kinds(stoppedLuke.applied), [...notified(OPEN), RUNNER_EVENT.END]);

    const closed = yield* launch([{ exchanges: OPEN }], fakeLuke());
    yield* closed.write(CONFIG);
    yield* closed.closeStdin;
    assert.equal(yield* Fiber.join(closed.run), RUNNER_END.INPUT_CLOSED);
    assert.ok(closed.spawned[0]?.ended);
  }),
);

it.effect("starts the next turn for a message Luke sent just before the turn completed", () =>
  Effect.gen(function* () {
    const luke = fakeLuke("turn/completed");
    const release = yield* Deferred.make<void>();
    const userMessage = RESUMED_TURN.reply.find((line) => line.method === "item/started");
    if (userMessage === undefined) throw new Error("the resumed turn has no user message");
    const script: Script = {
      exchanges: [
        ...RESUME,
        { method: "turn/start", reply: RESUMED_TURN.reply.slice(0, -2) },
        // The steer is taken and the turn completes before app-server answers it.
        {
          method: "turn/steer",
          reply: [
            { id: 4, result: { turnId: "00000000-0000-4000-8000-000000000008" } },
            userMessage,
            ...RESUMED_TURN_END,
          ],
          holdAnswer: Deferred.await(release),
        },
        RESUMED_TURN,
      ],
    };
    const { spawned, write, run } = yield* launch([script], luke);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?"));
    yield* write(message("And the second line?"));
    yield* luke.seen;
    // The follow-up is queued behind the completion before the steer is answered.
    yield* write(message("Also check the tests."));
    yield* Effect.yieldNow.pipe(Effect.repeat({ times: 50 }));
    yield* Deferred.succeed(release, undefined);

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    const starts = received(process, "turn/start");
    assert.equal(starts.length, 2);
    assert.deepEqual(starts[1]?.input, [
      { type: "text", text: "Also check the tests.", text_elements: [] },
    ]);
  }),
);

it.effect("never starts app-server without the plan's token", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { [RUNNER_ENV.CODEX_TOKEN]: _token, ...withoutToken } = ENV;
    const { spawned, write, run } = yield* launch([WORKFLOW], luke, withoutToken);
    yield* write(CONFIG);

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(spawned, []);
    assert.deepEqual(luke.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.FAILED,
      detail: "ACCESS_TOKEN is not set",
    });
  }),
);

const TOKEN_URL = "https://luke.test/api/agents/runner-token";
const SELF: RunnerSelf = {
  executable: "/usr/local/bin/node",
  script: "/opt/luke/agent-runner.mjs",
};
const PROVIDER = "model_providers.openai_chatgpt_plan";

/** The value of the `-c` override `key` a process was started with, where it has one. */
function override(process: Spawned | undefined, key: string): string | undefined {
  const prefix = `${key}=`;
  return process?.args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/**
 * Luke's token route as the runner's token command reaches it: each ask under
 * the runner's bearer answers the next fresh token, `plan-token-1`, `-2`, ….
 */
function fakeTokenRoute() {
  const bearers: (string | null)[] = [];
  let issued = 0;
  const respond = async (_url: string, init: RequestInit) => {
    bearers.push(new Headers(init.headers).get("authorization"));
    issued += 1;
    return Response.json({ accessToken: `plan-token-${issued}` });
  };
  return { bearers, respond };
}

/**
 * Codex's provider `auth` as app-server runs it: the command and its args read
 * from the process's argv, run with the process's own environment (here the
 * command's body, the runner's `askCodexToken`, in place of a child), and
 * its stdout the bearer app-server sends.
 */
function runTokenCommand(process: Spawned, http: Layer.Layer<HttpClient.HttpClient>) {
  const command = JSON.parse(override(process, `${PROVIDER}.auth.command`) ?? "null");
  const args: string[] = JSON.parse(override(process, `${PROVIDER}.auth.args`) ?? "[]");
  assert.equal(command, SELF.executable);
  assert.deepEqual(args.slice(0, 2), [SELF.script, CODEX_TOKEN_COMMAND]);
  return askCodexToken(args[2] ?? "", process.env).pipe(Effect.provide(http), Effect.orDie);
}

it.effect(
  "on the plan, app-server takes its token from the runner's command, which a 401 mid-turn runs again, and the turn goes on to complete",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke();
      const route = fakeTokenRoute();
      const http = fakeHttpClientLayer((url, init) =>
        url === TOKEN_URL ? route.respond(url, init) : luke.respond(url, init),
      );
      // What app-server sent OpenAI as its bearer, request by request.
      const sentToOpenAi: string[] = [];
      const turn: Exchange = {
        ...RESUMED_TURN,
        beforeReply: (process) =>
          Effect.gen(function* () {
            // The turn's first request goes out on the command's token.
            sentToOpenAi.push(yield* runTokenCommand(process, http));
            // An hour on, OpenAI answers 401: app-server runs the command again and retries.
            sentToOpenAi.push(yield* runTokenCommand(process, http));
          }),
      };
      const { spawned, write, run, logged } = yield* launch(
        [{ exchanges: [...RESUME, turn] }],
        luke,
        { ...ENV, [RUNNER_ENV.CODEX_TOKEN]: "a-launch-token-the-plan-never-uses" },
        { self: SELF, http },
      );
      yield* write({ ...CONFIG, threadId: THREAD, tokenUrl: TOKEN_URL });
      // A token line on the plan is withheld and restarts nothing.
      yield* write({ type: INPUT_LINE.TOKEN, accessToken: REFRESHED_TOKEN });
      yield* write(message("What exact line did you first write to PROBE.md?"));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.equal(spawned.length, 1);
      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.deepEqual(sentToOpenAi, ["plan-token-1", "plan-token-2"]);
      assert.deepEqual(route.bearers, [`Bearer ${BEARER}`, `Bearer ${BEARER}`]);
      assert.deepEqual(kinds(luke.applied).slice(-2), ["turn/completed", RUNNER_EVENT.END]);
      assert.deepEqual(luke.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.TURN_ENDED,
      });

      // The provider runs the command in place of reading ACCESS_TOKEN, which app-server is not handed.
      assert.equal(override(process, `${PROVIDER}.env_key`), undefined);
      assert.equal(override(process, `${PROVIDER}.auth.timeout_ms`), "30000");
      assert.equal(override(process, `${PROVIDER}.auth.refresh_interval_ms`), "300000");
      assert.deepEqual(JSON.parse(override(process, `${PROVIDER}.auth.args`) ?? "[]"), [
        SELF.script,
        CODEX_TOKEN_COMMAND,
        TOKEN_URL,
      ]);
      assert.equal(process?.env[RUNNER_ENV.CODEX_TOKEN], undefined);
      // The command inherits the bearer; no command the agent runs does.
      assert.equal(process?.env[RUNNER_ENV.BEARER], BEARER);
      assert.equal(
        override(process, "shell_environment_policy.exclude"),
        '["ACCESS_TOKEN", "LUKE_RUNNER_TOKEN"]',
      );
      assert.equal(override(process, "shell_environment_policy.inherit"), '"core"');

      // What the command printed went to app-server alone: never argv, an event, or a log.
      const posted = luke.bodies.join("\n");
      for (const secret of ["plan-token-1", "plan-token-2", REFRESHED_TOKEN, BEARER]) {
        assert.ok(!posted.includes(secret));
        assert.ok(!logged.some((line) => line.includes(secret)));
        assert.ok(!process?.args.some((arg) => arg.includes(secret)));
      }
    }),
);

it.effect("the token command says only Luke's status when Luke refuses it, never the bearer", () =>
  Effect.gen(function* () {
    const http = fakeHttpClientLayer(async () => new Response(null, { status: 409 }));
    const refused = yield* askCodexToken(TOKEN_URL, ENV).pipe(Effect.provide(http), Effect.flip);
    assert.equal(refused.detail, "Luke refused the token: 409");

    const unset = yield* askCodexToken(TOKEN_URL, {}).pipe(Effect.provide(http), Effect.flip);
    assert.equal(unset.detail, "LUKE_RUNNER_TOKEN is not set");

    const unreachable = fakeHttpClientLayer(async () => {
      throw new Error(`connection reset for ${BEARER}`);
    });
    const failed = yield* askCodexToken(TOKEN_URL, ENV).pipe(
      Effect.provide(unreachable),
      Effect.flip,
    );
    assert.equal(failed.detail, "Luke did not answer");
  }),
);

it.effect("never starts app-server on the plan when it does not know its own bundle", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { spawned, write, run } = yield* launch([WORKFLOW], luke);
    yield* write({ ...CONFIG, tokenUrl: TOKEN_URL });

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(spawned, []);
  }),
);
