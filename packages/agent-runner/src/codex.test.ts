/**
 * codex.test.ts -- one Codex launch of the runner against a scripted app-server playing P16's recorded notifications and a fake service: the config line in, app-server started with the plan's provider, messages as turns and steers, Stop as an interrupt, a refreshed token as a restart between turns or, on a host's plan, the runner's token command run again mid-turn, and in a sandbox app-server signed in on host-supplied tokens and refreshed on asking, every notification out in order, and the launch's end at the turn's.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import {
  type Cause,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  Queue,
  Stream,
} from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { CODEX_BUNDLED_MODELS_JSON } from "./codex-protocol/bundled-models.js";
import { codexToken } from "./codex-token.js";
import type { RunnerSelf } from "./launch.js";
import {
  CODEX_EFFORT,
  CODEX_PLAN_BACKEND,
  CODEX_TOKEN_COMMAND,
  type CodexConfig,
  IMAGE_MEDIA_TYPE,
  INPUT_LINE,
  INSTALLED_SKILLS,
  type InputLine,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HARNESS,
  RUNNER_PLACE,
  type RunnerEvent,
} from "./protocol.js";
import { runAgent } from "./runner.js";
import {
  type Exchange,
  fakeAppServer,
  type RecordedMessage,
  received,
  recordedExchanges,
  type Script,
  type Spawned,
} from "./testing/fake-app-server.js";
import { fakeClaudeCode } from "./testing/fake-claude-code.js";
import { makeFakeService } from "./testing/fake-service.js";

const BEARER = "runner-bearer-for-tests";
const EVENTS_URL = "https://app.test/runner/events";
const FIRST_SEQUENCE = 11;
const THREAD = "00000000-0000-4000-8000-000000000002";

it.effect(
  "on an OpenAI API key, app-server reads it through the provider's env_key, no command inherits it, no event carries it, and a model line moving to an Ultrafast version runs the next turn on the ultrafast tier its own catalog lists",
  () =>
    Effect.gen(function* () {
      // Note that in a sandbox this is the launch's placeholder, the key itself set at its firewall, which the runner reads alike.
      const apiKey = "openai-api-key-for-tests";
      const service = fakeService("sleep 600");
      // The launch knows no bundle: on its API key it asks no token.
      const { spawned, write, run } = yield* launch(
        [STOPPED],
        service,
        { ...ENV, [RUNNER_ENV.OPENAI_API_KEY]: apiKey },
        {},
      );
      yield* write({ ...CONFIG, model: "gpt-6.1-sol", fast: true });
      yield* write({ type: INPUT_LINE.MODEL, fast: true, ultrafast: true });
      yield* write(message("Run sleep 600.", LINE.FIRST));
      yield* service.seen;
      // The catalog app-server reads in place of its bundled one, while it runs: every bundled model, each listing Ultrafast.
      const catalogPath = JSON.parse(override(spawned[0], "model_catalog_json") ?? '""');
      const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
      const bundled = JSON.parse(CODEX_BUNDLED_MODELS_JSON);
      assert.deepEqual(
        catalog.models.map((model: { slug: string }) => model.slug),
        bundled.models.map((model: { slug: string }) => model.slug),
      );
      const sol = catalog.models.find((model: { slug: string }) => model.slug === "gpt-6.1-sol");
      assert.ok(sol.service_tiers.some((tier: { id: string }) => tier.id === "ultrafast"));
      yield* write({ type: INPUT_LINE.STOP });

      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
      assert.ok(!existsSync(catalogPath), "the launch removes its catalog as it ends");
      const [process] = spawned;
      const overrides = (process?.args ?? []).filter((_, index, args) => args[index - 1] === "-c");
      assert.deepEqual(
        overrides.filter((each) => each.startsWith("model_provider")),
        [
          'model_provider="openai_api_key"',
          'model_providers.openai_api_key.name="OpenAI API key"',
          'model_providers.openai_api_key.base_url="https://api.openai.com/v1"',
          'model_providers.openai_api_key.env_key="OPENAI_API_KEY"',
          'model_providers.openai_api_key.wire_api="responses"',
          "model_providers.openai_api_key.requires_openai_auth=false",
          "model_providers.openai_api_key.supports_websockets=false",
        ],
      );
      assert.ok(
        overrides.includes(
          'shell_environment_policy.exclude=["APP_RUNNER_TOKEN", "OPENAI_API_KEY"]',
        ),
      );
      // An Ultrafast version runs on Codex's ultrafast tier, turned on beside the fast one.
      assert.ok(overrides.includes("features.fast_mode=true"));
      assert.ok(overrides.includes("features.ultrafast_mode=true"));
      assert.equal(received(process, "turn/start")[0]?.serviceTier, "ultrafast");
      assert.equal(process?.env[RUNNER_ENV.OPENAI_API_KEY], apiKey);
      assert.ok(!(process?.args ?? []).join(" ").includes(apiKey));
      assert.ok(!JSON.stringify(service.applied).includes(apiKey));
    }),
);

const TOKEN_URL = "https://app.test/api/agents/runner-token";
const SELF: RunnerSelf = {
  executable: "/usr/local/bin/node",
  script: "/opt/agent/agent-runner/agent-runner.mjs",
};

/** A launch on a host, whose plan's token comes from the runner's token command. */
const ENV = {
  [RUNNER_ENV.BEARER]: BEARER,
  [RUNNER_ENV.PLACE]: RUNNER_PLACE.HOST,
  CODEX_HOME: "/home/agent/.codex",
  PATH: "/usr/bin",
};

/** A launch in the cloud's sandbox, whose bearer is the launch's placeholder and whose plan is signed in on host-supplied tokens. */
const SANDBOX_ENV = {
  [RUNNER_ENV.BEARER]: BEARER,
  // Named as a host's launch names them, which a sandbox's runner reads neither of.
  [RUNNER_ENV.CODEX_PLAN_BACKEND]: CODEX_PLAN_BACKEND.CHATGPT,
  [RUNNER_ENV.CHATGPT_ACCOUNT_ID]: "chatgpt-workspace-from-env",
  CODEX_HOME: "/home/agent/.codex",
  PATH: "/usr/bin",
};

const CONFIG: CodexConfig = {
  harness: RUNNER_HARNESS.CODEX,
  cwd: "/srv/agent-probe-repo",
  executable: "/opt/agent-codex/bin/codex",
  model: "gpt-5.5",
  effort: CODEX_EFFORT.HIGH,
  developerInstructions: "You are a Vespin coding agent.",
  firstSequence: FIRST_SEQUENCE,
  eventsUrl: EVENTS_URL,
  mcpUrl: "https://app.test/runner/mcp",
  integrations: [{ name: "linear", url: "https://app.test/runner/mcp/integrations/linear" }],
  tokenUrl: TOKEN_URL,
};

/** A message line of text alone, under the service's id for the line where one is given. */
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

/** The service's ids for the lines a test writes, as it sends them. */
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

/** One Codex launch over stdin lines the test writes, against scripted app-servers and a fake service. */
function launch(
  scripts: readonly Script[],
  service: ReturnType<typeof makeFakeService>,
  env: Record<string, string> = ENV,
  extra: { readonly self?: RunnerSelf; readonly http?: Layer.Layer<HttpClient.HttpClient> } = {
    self: SELF,
  },
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
          extra.http ?? service.layer,
          claude.layer,
          Logger.layer([recorder]),
        ),
      ),
      Effect.forkScoped,
    );
    return { spawned: server.spawned, write, closeStdin: Queue.end(stdin), run, logged };
  });
}

function fakeService(watchFor?: string) {
  return makeFakeService({
    url: EVENTS_URL,
    firstSequence: FIRST_SEQUENCE,
    watchFor,
  });
}

it.effect(
  "sets the member's installed skills as an extra skills root before the thread opens, and none where Vespin wrote none",
  () =>
    Effect.gen(function* () {
      const folder = mkdtempSync(join(tmpdir(), "installed-skills-"));
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(folder, { recursive: true })));
      const skills = join(folder, INSTALLED_SKILLS.SKILLS);
      mkdirSync(join(skills, "pr-style"), { recursive: true });
      const extraRoots: Exchange = {
        method: "skills/extraRoots/set",
        reply: [{ id: 0, result: {} }],
      };
      const withRoot: Script = {
        exchanges: [
          exchange(FIRST, 0),
          exchange(FIRST, 1),
          extraRoots,
          ...WORKFLOW.exchanges.slice(2),
        ],
      };

      const turn = (script: Script, installedSkills: string) =>
        Effect.gen(function* () {
          const service = fakeService("ci-watch");
          const { spawned, write, run } = yield* launch([script], service);
          yield* write({ ...CONFIG, installedSkills });
          yield* write(message("The probe's first turn.", LINE.FIRST));
          yield* service.seen;
          yield* write(message("Also, before your final reply, append the line.", LINE.STEERED));
          assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
          return spawned[0];
        });

      const withSkills = yield* turn(withRoot, folder);
      const withNone = yield* turn(WORKFLOW, join(folder, "never-written"));

      assert.deepEqual(withSkills?.unexpected, []);
      assert.deepEqual(received(withSkills, "skills/extraRoots/set"), [{ extraRoots: [skills] }]);
      // Set before the thread is opened, so the thread's first turn lists them.
      assert.deepEqual(withSkills?.received.map((each) => each.method).slice(0, 4), [
        "initialize",
        "initialized",
        "skills/extraRoots/set",
        "thread/start",
      ]);
      assert.deepEqual(withNone?.unexpected, []);
      assert.deepEqual(received(withNone, "skills/extraRoots/set"), []);

      // The roots are app-server's process-wide, so a relaunch's new app-server is set them again before its thread resumes.
      const relaunched = yield* launch(
        [
          {
            exchanges: [
              exchange(RESUMED, 0),
              exchange(RESUMED, 1),
              extraRoots,
              exchange(RESUMED, 2),
            ],
          },
        ],
        fakeService(),
      );
      yield* relaunched.write({ ...CONFIG, threadId: THREAD, installedSkills: folder });
      yield* relaunched.closeStdin;
      assert.equal(yield* Fiber.join(relaunched.run), RUNNER_END.INPUT_CLOSED);
      const [resumed] = relaunched.spawned;
      assert.deepEqual(resumed?.unexpected, []);
      assert.deepEqual(resumed?.received.map((each) => each.method).slice(0, 4), [
        "initialize",
        "initialized",
        "skills/extraRoots/set",
        "thread/resume",
      ]);
    }),
);

it.effect(
  "starts app-server with the plan's provider, runs a fast version on the fast tier, steers the running turn, and ends at its completion",
  () =>
    Effect.gen(function* () {
      const service = fakeService("ci-watch");
      const { spawned, write, run } = yield* launch([WORKFLOW], service);
      yield* write({ ...CONFIG, fast: true });
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
      yield* service.seen;
      // The catalog app-server reads on the plan, while it runs: every bundled model, none offering Codex's subagents, whose messages OpenAI refuses on a plan.
      const catalogOverride = override(spawned[0], "model_catalog_json");
      const catalog = JSON.parse(readFileSync(JSON.parse(catalogOverride ?? '""'), "utf8"));
      assert.deepEqual(
        catalog.models.map((model: { slug: string }) => model.slug),
        JSON.parse(CODEX_BUNDLED_MODELS_JSON).models.map((model: { slug: string }) => model.slug),
      );
      assert.ok(catalog.models.every((model: object) => !("multi_agent_version" in model)));
      yield* write(message("Also, before your final reply, append the line.", LINE.STEERED));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.deepEqual(
        kinds(service.applied).filter((kind) => kind !== RUNNER_EVENT.ACCEPTED),
        [...notified(WORKFLOW.exchanges), RUNNER_EVENT.END],
      );
      // Each line is said taken once, under the service's own id, which Codex is handed to echo.
      assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST, LINE.STEERED]);
      assert.deepEqual(
        service.applied.map(({ sequence }) => sequence),
        service.applied.map((_, index) => FIRST_SEQUENCE + index),
      );
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.TURN_ENDED,
      });
      assert.deepEqual(
        service.bearers,
        service.bearers.map(() => `Bearer ${BEARER}`),
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
        `model_providers.openai_chatgpt_plan.auth.command="${SELF.executable}"`,
        `model_providers.openai_chatgpt_plan.auth.args=["${SELF.script}", "codex-token", "${TOKEN_URL}"]`,
        "model_providers.openai_chatgpt_plan.auth.timeout_ms=30000",
        "model_providers.openai_chatgpt_plan.auth.refresh_interval_ms=300000",
        'model_providers.openai_chatgpt_plan.wire_api="responses"',
        "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
        "model_providers.openai_chatgpt_plan.supports_websockets=false",
        "features.fast_mode=true",
        `model_catalog_json=${catalogOverride}`,
        'mcp_servers.workspace.url="https://app.test/runner/mcp"',
        'mcp_servers.workspace.bearer_token_env_var="APP_RUNNER_TOKEN"',
        'mcp_servers.workspace.default_tools_approval_mode="approve"',
        "mcp_servers.workspace.tool_timeout_sec=600.0",
        'mcp_servers.linear.url="https://app.test/runner/mcp/integrations/linear"',
        'mcp_servers.linear.bearer_token_env_var="APP_RUNNER_TOKEN"',
        'mcp_servers.linear.default_tools_approval_mode="approve"',
        "mcp_servers.linear.startup_timeout_sec=20.0",
        "mcp_servers.linear.tool_timeout_sec=600.0",
        'approval_policy="never"',
        'sandbox_mode="danger-full-access"',
        'shell_environment_policy.inherit="core"',
        "shell_environment_policy.ignore_default_excludes=false",
        'shell_environment_policy.exclude=["APP_RUNNER_TOKEN"]',
        'shell_environment_policy.set={ PLAYWRIGHT_BROWSERS_PATH = "0" }',
      ]);
      // The bearer reaches app-server in its environment alone, never argv.
      assert.equal(process?.env[RUNNER_ENV.BEARER], BEARER);
      assert.equal(process?.env.CODEX_HOME, ENV.CODEX_HOME);
      assert.ok(!process?.args.some((arg) => arg.includes(BEARER)));

      assert.deepEqual(received(process, "initialize"), [
        { clientInfo: { name: "Vespin", title: "Vespin", version: "dev" }, capabilities: null },
      ]);
      assert.deepEqual(received(process, "thread/start"), [
        {
          cwd: CONFIG.cwd,
          model: CONFIG.model,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          developerInstructions: CONFIG.developerInstructions,
        },
      ]);
      const [start] = received(process, "turn/start");
      assert.equal(start?.threadId, THREAD);
      assert.equal(start?.clientUserMessageId, LINE.FIRST);
      assert.equal(start?.model, CONFIG.model);
      assert.equal(start?.effort, CODEX_EFFORT.HIGH);
      assert.equal(start?.serviceTier, "fast");
      // Every turn names its sandbox, none of Codex's own, so a thread started under another runs under this one.
      assert.equal(start?.approvalPolicy, "never");
      assert.deepEqual(start?.sandboxPolicy, { type: "dangerFullAccess" });
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

it.effect(
  "keeps a warm launch up past its completed turn, posting IDLE, and ends it as idled on Vespin's retire",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const { spawned, write, run } = yield* launch([WORKFLOW], service);
      yield* write({ ...CONFIG, warm: true });
      yield* write(message("The probe's first turn.", LINE.FIRST));
      yield* write(message("Also, before your final reply, append the line.", LINE.STEERED));
      for (let step = 0; step < 5_000; step += 1) {
        if (kinds(service.applied).includes(RUNNER_EVENT.IDLE)) break;
        yield* Effect.yieldNow;
      }
      assert.equal(run.pollUnsafe(), undefined, "the launch stays up past its turn");

      yield* write({ type: INPUT_LINE.RETIRE });

      assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
      assert.deepEqual(spawned[0]?.unexpected, []);
      assert.deepEqual(kinds(service.applied).slice(-3), [
        "turn/completed",
        RUNNER_EVENT.IDLE,
        RUNNER_EVENT.END,
      ]);
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.IDLED,
      });
    }),
);

it.effect("interrupts the running turn on a stop and ends the launch as stopped", () =>
  Effect.gen(function* () {
    const service = fakeService("sleep 600");
    const { spawned, write, run } = yield* launch([STOPPED], service);
    yield* write(CONFIG);
    yield* write({ type: INPUT_LINE.MODEL, model: "gpt-5.5-codex", effort: CODEX_EFFORT.LOW });
    yield* write(message("Run `sleep 600` and wait for it to finish."));
    yield* service.seen;
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
    assert.deepEqual(kinds(service.applied).slice(-2), ["turn/completed", RUNNER_EVENT.END]);
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.STOPPED,
    });
  }),
);

it.effect(
  "a thread resumed in a sandbox that no longer holds its rollout has it written back from the service's store first",
  () =>
    Effect.gen(function* () {
      const home = mkdtempSync(join(tmpdir(), "codex-home-"));
      const subpath = `sessions/2026/11/06/rollout-2026-11-06T18-00-00-${THREAD}.jsonl`;
      const kept = [
        { type: "session_meta", payload: { id: THREAD } },
        { type: "response_item", payload: { type: "message", role: "user" } },
      ];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        const call = JSON.parse(String(init?.body));
        const answer =
          call.call === "listSubkeys"
            ? { subkeys: [subpath] }
            : call.call === "load"
              ? { entries: kept }
              : {};
        return new Response(JSON.stringify(answer));
      });
      const service = fakeService("What exact line");
      const { write, run } = yield* launch([{ exchanges: [...RESUME, RESUMED_TURN] }], service, {
        ...ENV,
        CODEX_HOME: home,
      });
      yield* write({
        ...CONFIG,
        threadId: THREAD,
        transcriptsUrl: "https://app.test/api/agents/runner-transcripts",
      });
      yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.equal(
        readFileSync(join(home, subpath), "utf8"),
        kept.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
      );
      vi.restoreAllMocks();
      rmSync(home, { recursive: true, force: true });
    }),
);

it.effect(
  "resumes the thread it is given and sends a message the ended turn refused as the next turn",
  () =>
    Effect.gen(function* () {
      const service = fakeService("What exact line");
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
      const { spawned, write, run } = yield* launch([script], service);
      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
      yield* service.seen;
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
          sandbox: "danger-full-access",
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
      assert.deepEqual(
        kinds(service.applied).filter((kind) => kind === "turn/completed").length,
        2,
      );
      // The refused steer's line is said taken when the next turn takes it, not before.
      assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST, LINE.STEERED]);
      const steeredAt = service.applied.findIndex(
        ({ message: posted }) =>
          "type" in posted && posted.type === RUNNER_EVENT.ACCEPTED && posted.uuid === LINE.STEERED,
      );
      const firstCompletedAt = kinds(service.applied).indexOf("turn/completed");
      assert.ok(steeredAt > firstCompletedAt);
    }),
);

/** The resumed launch, its second message's steer refused as said, then, where it waits, run as the next turn. */
function refusedSteer(error: NonNullable<RecordedMessage["error"]>, waits: boolean): Script {
  const refusal: RecordedMessage = { id: 4, error };
  return {
    exchanges: [
      ...RESUME,
      { method: "turn/start", reply: RESUMED_TURN.reply.slice(0, -2) },
      { method: "turn/steer", reply: waits ? [refusal, ...RESUMED_TURN_END] : [refusal] },
      ...(waits ? [RESUMED_TURN] : []),
    ],
  };
}

it.effect("sends a steer refused by a turn that cannot be steered as the next turn", () =>
  Effect.gen(function* () {
    const service = fakeService("What exact line");
    const script = refusedSteer(
      {
        code: -32600,
        message: "cannot steer a compact turn",
        data: {
          message: "cannot steer a compact turn",
          codexErrorInfo: { activeTurnNotSteerable: { turnKind: "compact" } },
          additionalDetails: null,
        },
      },
      true,
    );
    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
    yield* service.seen;
    yield* write(message("And the second line?", LINE.STEERED));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "turn/start")[1]?.input, [
      { type: "text", text: "And the second line?", text_elements: [] },
    ]);
    assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST, LINE.STEERED]);
  }),
);

it.effect("ends the launch as failed when app-server refuses a steer for any other reason", () =>
  Effect.gen(function* () {
    const service = fakeService("What exact line");
    const script = refusedSteer({ code: -32603, message: "failed to steer turn: boom" }, false);
    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
    yield* service.seen;
    yield* write(message("And the second line?", LINE.STEERED));

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.FAILED,
      detail: "turn/steer: failed to steer turn: boom",
    });
    assert.deepEqual(received(spawned[0], "turn/start").length, 1);
    assert.deepEqual(acceptedLines(service.applied), [LINE.FIRST]);
  }),
);

it.effect("ends the launch as stopped when app-server never answers the stop's interrupt", () =>
  Effect.gen(function* () {
    const service = fakeService("sleep 600");
    const hung: Script = {
      exchanges: [...OPEN, exchange(FIRST, 5), { method: "turn/interrupt", reply: [] }],
    };
    const { spawned, write, run } = yield* launch([hung], service);
    yield* write(CONFIG);
    yield* write(message("Run `sleep 600` and wait for it to finish."));
    yield* service.seen;
    yield* write({ type: INPUT_LINE.STOP });
    while (received(spawned[0], "turn/interrupt").length === 0) yield* Effect.yieldNow;
    yield* Effect.yieldNow.pipe(Effect.repeat({ times: 50 }));
    yield* TestClock.adjust(Duration.minutes(1));

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.ok(spawned[0]?.ended);
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.STOPPED,
    });
  }),
);

it.effect("ends the launch as failed when app-server exits, its secrets taken out of why", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { write, run } = yield* launch(
      [{ exchanges: [...OPEN, exchange(FIRST, 3)], exitWith: `panic: bad token ${BEARER}` }],
      service,
    );
    yield* write(CONFIG);
    yield* write(message("The probe's first turn."));

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(service.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.FAILED,
      detail: "app-server exited: panic: bad token [redacted]",
    });
  }),
);

it.effect("ends an idle launch at once on a stop, and on stdin closing, with no turn started", () =>
  Effect.gen(function* () {
    const stoppedService = fakeService();
    const stopped = yield* launch([{ exchanges: OPEN }], stoppedService);
    yield* stopped.write(CONFIG);
    yield* stopped.write({ type: INPUT_LINE.STOP });
    assert.equal(yield* Fiber.join(stopped.run), RUNNER_END.STOPPED);
    assert.deepEqual(received(stopped.spawned[0], "turn/start"), []);
    assert.deepEqual(kinds(stoppedService.applied), [...notified(OPEN), RUNNER_EVENT.END]);

    const closed = yield* launch([{ exchanges: OPEN }], fakeService());
    yield* closed.write(CONFIG);
    yield* closed.closeStdin;
    assert.equal(yield* Fiber.join(closed.run), RUNNER_END.INPUT_CLOSED);
    assert.ok(closed.spawned[0]?.ended);
  }),
);

it.effect("starts the next turn for a message Vespin sent just before the turn completed", () =>
  Effect.gen(function* () {
    const service = fakeService("turn/completed");
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
    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?"));
    yield* write(message("And the second line?"));
    yield* service.seen;
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

const PROVIDER = "model_providers.openai_chatgpt_plan";

/** The value of the `-c` override `key` a process was started with, where it has one. */
function override(process: Spawned | undefined, key: string): string | undefined {
  const prefix = `${key}=`;
  return process?.args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/**
 * The service's token route as the runner reaches it: each ask under the
 * runner's bearer answers the next fresh token, `plan-token-1`, `-2`, …, and
 * the workspace given, where one is.
 */
function fakeTokenRoute(chatgptAccountId?: string) {
  const bearers: (string | null)[] = [];
  let issued = 0;
  const respond = async (_url: string, init: RequestInit) => {
    bearers.push(new Headers(init.headers).get("authorization"));
    issued += 1;
    return Response.json({ accessToken: `plan-token-${issued}`, chatgptAccountId });
  };
  return { bearers, respond };
}

/**
 * Codex's provider `auth` as app-server runs it: the command and its args read
 * from the process's argv, run with the process's own environment (here the
 * command's body, the runner's `codexToken`, in place of a child), and
 * its stdout the bearer app-server sends.
 */
function runTokenCommand(process: Spawned, http: Layer.Layer<HttpClient.HttpClient>) {
  const command = JSON.parse(override(process, `${PROVIDER}.auth.command`) ?? "null");
  const args: string[] = JSON.parse(override(process, `${PROVIDER}.auth.args`) ?? "[]");
  assert.equal(command, SELF.executable);
  assert.deepEqual(args.slice(0, 2), [SELF.script, CODEX_TOKEN_COMMAND]);
  return codexToken(args[2] ?? "", process.env).pipe(Effect.provide(http), Effect.orDie);
}

it.effect(
  "on the plan, app-server takes its token from the runner's command, which a 401 mid-turn runs again, and the turn goes on to complete",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const route = fakeTokenRoute();
      const http = fakeHttpClientLayer((url, init) =>
        url === TOKEN_URL ? route.respond(url, init) : service.respond(url, init),
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
        service,
        ENV,
        { self: SELF, http },
      );
      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?"));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      assert.equal(spawned.length, 1);
      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.deepEqual(sentToOpenAi, ["plan-token-1", "plan-token-2"]);
      assert.deepEqual(route.bearers, [`Bearer ${BEARER}`, `Bearer ${BEARER}`]);
      assert.deepEqual(kinds(service.applied).slice(-2), ["turn/completed", RUNNER_EVENT.END]);
      assert.deepEqual(service.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.TURN_ENDED,
      });

      // The provider runs the command.
      assert.equal(override(process, `${PROVIDER}.auth.timeout_ms`), "30000");
      assert.equal(override(process, `${PROVIDER}.auth.refresh_interval_ms`), "300000");
      assert.deepEqual(JSON.parse(override(process, `${PROVIDER}.auth.args`) ?? "[]"), [
        SELF.script,
        CODEX_TOKEN_COMMAND,
        TOKEN_URL,
      ]);
      // The command inherits the bearer; no command the agent runs does.
      assert.equal(process?.env[RUNNER_ENV.BEARER], BEARER);
      assert.equal(override(process, "shell_environment_policy.exclude"), '["APP_RUNNER_TOKEN"]');
      assert.equal(override(process, "shell_environment_policy.inherit"), '"core"');

      // What the command printed went to app-server alone: never argv, an event, or a log.
      const posted = service.bodies.join("\n");
      for (const secret of ["plan-token-1", "plan-token-2", BEARER]) {
        assert.ok(!posted.includes(secret));
        assert.ok(!logged.some((line) => line.includes(secret)));
        assert.ok(!process?.args.some((arg) => arg.includes(secret)));
      }
    }),
);

/** The workspace the fake token route says the plan pays from. */
const WORKSPACE = "chatgpt-workspace-fixture";

/** App-server's ask for fresh tokens after a 401, as its own request of the runner. */
const REFRESH_REQUEST: RecordedMessage = {
  id: "refresh-1",
  method: "account/chatgptAuthTokens/refresh",
  params: { reason: "unauthorized", previousAccountId: WORKSPACE },
};

it.effect(
  "in a sandbox, app-server is signed in on the service's host-supplied tokens before the thread opens, its ask after a 401 is answered with fresh ones, and no token reaches argv, its environment, an event, or a log",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const route = fakeTokenRoute(WORKSPACE);
      const http = fakeHttpClientLayer((url, init) =>
        url === TOKEN_URL ? route.respond(url, init) : service.respond(url, init),
      );
      const login: Exchange = {
        method: "account/login/start",
        reply: [{ id: 0, result: { type: "chatgptAuthTokens" } }],
      };
      // App-server asks for fresh tokens as the thread resumes, and the turn goes out once the runner answered.
      const resumed: Exchange = {
        ...exchange(RESUMED, 2),
        reply: [REFRESH_REQUEST, ...exchange(RESUMED, 2).reply],
      };
      const answered: RecordedMessage[] = [];
      const turn: Exchange = {
        ...RESUMED_TURN,
        beforeReply: (process) =>
          Effect.map(Queue.take(process.answers), (answer) => {
            answered.push(answer);
          }),
      };
      const { spawned, write, run, logged } = yield* launch(
        [{ exchanges: [exchange(RESUMED, 0), exchange(RESUMED, 1), login, resumed, turn] }],
        service,
        SANDBOX_ENV,
        { http },
      );
      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?"));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.equal(received(process, "initialize")[0]?.capabilities?.experimentalApi, true);
      assert.deepEqual(received(process, "account/login/start"), [
        {
          type: "chatgptAuthTokens",
          accessToken: "plan-token-1",
          chatgptAccountId: WORKSPACE,
          chatgptPlanType: null,
        },
      ]);
      assert.deepEqual(answered, [
        {
          id: "refresh-1",
          result: {
            accessToken: "plan-token-2",
            chatgptAccountId: WORKSPACE,
            chatgptPlanType: null,
          },
        },
      ]);
      assert.deepEqual(route.bearers, [`Bearer ${BEARER}`, `Bearer ${BEARER}`]);
      // Codex's own OpenAI provider carries the sign-in: the runner names none of its own.
      assert.equal(override(process, "model_provider"), undefined);

      const posted = service.bodies.join("\n");
      for (const secret of ["plan-token-1", "plan-token-2"]) {
        assert.ok(!posted.includes(secret));
        assert.ok(!logged.some((line) => line.includes(secret)));
        assert.ok(!process?.args.some((arg) => arg.includes(secret)));
        assert.ok(!Object.values(process?.env ?? {}).some((value) => value?.includes(secret)));
      }
    }),
);

it.effect(
  "the token command says only Vespin's status when Vespin refuses it, never the bearer",
  () =>
    Effect.gen(function* () {
      const http = fakeHttpClientLayer(async () => new Response(null, { status: 409 }));
      const refused = yield* codexToken(TOKEN_URL, ENV).pipe(Effect.provide(http), Effect.flip);
      assert.equal(refused.detail, "The service refused the token: 409");

      const unset = yield* codexToken(TOKEN_URL, {}).pipe(Effect.provide(http), Effect.flip);
      assert.equal(unset.detail, "APP_RUNNER_TOKEN is not set");

      const unreachable = fakeHttpClientLayer(async () => {
        throw new Error(`connection reset for ${BEARER}`);
      });
      const failed = yield* codexToken(TOKEN_URL, ENV).pipe(
        Effect.provide(unreachable),
        Effect.flip,
      );
      assert.equal(failed.detail, "The service did not answer");
    }),
);

it.effect("never starts app-server on the plan when it does not know its own bundle", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const { spawned, write, run } = yield* launch([WORKFLOW], service, ENV, {});
    yield* write(CONFIG);

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(spawned, []);
  }),
);

it.effect(
  "on a device-code plan, app-server's provider sends to Codex's ChatGPT backend naming the workspace, its token from the same command; a backend this runner does not know starts nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const device = {
        ...ENV,
        [RUNNER_ENV.CODEX_PLAN_BACKEND]: CODEX_PLAN_BACKEND.CHATGPT,
        [RUNNER_ENV.CHATGPT_ACCOUNT_ID]: "chatgpt-workspace-fixture",
      };
      const { spawned, write, run } = yield* launch(
        [{ exchanges: [...RESUME, RESUMED_TURN] }],
        service,
        device,
      );
      yield* write({ ...CONFIG, threadId: THREAD });
      yield* write(message("What exact line did you first write to PROBE.md?"));

      assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
      const provider = (spawned[0]?.args ?? []).filter(
        (arg, index, args) => args[index - 1] === "-c" && arg.startsWith("model_provider"),
      );
      assert.deepEqual(provider, [
        'model_provider="chatgpt_backend_plan"',
        'model_providers.chatgpt_backend_plan.name="ChatGPT plan"',
        'model_providers.chatgpt_backend_plan.base_url="https://chatgpt.com/backend-api/codex"',
        `model_providers.chatgpt_backend_plan.auth.command="${SELF.executable}"`,
        `model_providers.chatgpt_backend_plan.auth.args=["${SELF.script}", "codex-token", "${TOKEN_URL}"]`,
        "model_providers.chatgpt_backend_plan.auth.timeout_ms=30000",
        "model_providers.chatgpt_backend_plan.auth.refresh_interval_ms=300000",
        'model_providers.chatgpt_backend_plan.http_headers={ "ChatGPT-Account-ID" = "chatgpt-workspace-fixture", "version" = "0.163.0" }',
        'model_providers.chatgpt_backend_plan.wire_api="responses"',
        "model_providers.chatgpt_backend_plan.requires_openai_auth=false",
        "model_providers.chatgpt_backend_plan.supports_websockets=false",
      ]);

      const unknown = yield* launch([WORKFLOW], fakeService(), {
        ...ENV,
        [RUNNER_ENV.CODEX_PLAN_BACKEND]: "elsewhere",
      });
      yield* unknown.write(CONFIG);
      assert.equal(yield* Fiber.join(unknown.run), RUNNER_END.FAILED);
      assert.deepEqual(unknown.spawned, []);
    }),
);

/** A page of the thread's turns, newest first, each naming the client id of the line it took. */
function turnsPage(turns: readonly { readonly id: string; readonly line: string }[]): Exchange {
  return {
    method: "thread/turns/list",
    reply: [
      {
        id: 90,
        result: {
          data: turns.map(({ id, line }) => ({
            id,
            items: [{ type: "userMessage", id: `${id}-item`, clientId: line, content: [] }],
          })),
          nextCursor: null,
          backwardsCursor: null,
        },
      },
    ],
  };
}

const REVERTED: Exchange = {
  method: "thread/revert",
  reply: [{ id: 91, result: { turnsBackwardsCursor: null, itemsBackwardsCursor: null } }],
};

it.effect("reverts a rewound thread to before the turn that took the line the rewind dropped", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const page = turnsPage([
      { id: "turn-3", line: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e09" },
      { id: "turn-2", line: LINE.STEERED },
      { id: "turn-1", line: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e08" },
    ]);
    const script: Script = { exchanges: [...RESUME, page, REVERTED, RESUMED_TURN] };
    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD, rewindBefore: LINE.STEERED });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "thread/revert"), [
      { threadId: THREAD, beforeTurnId: "turn-2" },
    ]);
  }),
);

it.effect("resumes a thread whole where no turn took the line the rewind dropped", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const page = turnsPage([{ id: "turn-1", line: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e08" }]);
    const script: Script = { exchanges: [...RESUME, page, RESUMED_TURN] };
    const { spawned, write, run } = yield* launch([script], service);
    yield* write({ ...CONFIG, threadId: THREAD, rewindBefore: LINE.STEERED });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "thread/revert"), []);
  }),
);
