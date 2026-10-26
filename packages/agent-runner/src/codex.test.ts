/**
 * codex.test.ts -- one Codex launch of the runner against a scripted app-server playing P16's recorded notifications and a fake Luke: the config line in, app-server started with the plan's provider, messages as turns and steers, Stop as an interrupt, a refreshed token as a restart between turns or, on the plan, the runner's token command run again mid-turn, every notification out in order, and the launch's end at the turn's.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
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
import { askCodexToken } from "./codex-token.js";
import type { RunnerSelf } from "./launch.js";
import { processTable } from "./processes.js";
import {
  CODEX_EFFORT,
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
import { makeFakeLuke } from "./testing/fake-luke.js";
import { UNREAD_PROC } from "./testing/fake-proc.js";

const BEARER = "runner-bearer-for-tests";
const EVENTS_URL = "https://luke.test/runner/events";
const FIRST_SEQUENCE = 11;
const THREAD = "00000000-0000-4000-8000-000000000002";

it.effect(
  "on an OpenAI API key, app-server reads it through the provider's env_key, no command inherits it, no event carries it, and a fast version runs on the fast tier",
  () =>
    Effect.gen(function* () {
      const apiKey = "openai-api-key-for-tests";
      const luke = fakeLuke("sleep 600");
      // The launch knows no bundle: on its API key it asks no token.
      const { spawned, write, run } = yield* launch(
        [STOPPED],
        luke,
        { ...ENV, [RUNNER_ENV.OPENAI_API_KEY]: apiKey },
        {},
      );
      yield* write({ ...CONFIG, fast: true });
      yield* write(message("Run sleep 600.", LINE.FIRST));
      yield* luke.seen;
      yield* write({ type: INPUT_LINE.STOP });

      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
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
          'shell_environment_policy.exclude=["LUKE_RUNNER_TOKEN", "OPENAI_API_KEY"]',
        ),
      );
      // A fast version runs on Codex's documented fast tier, turned on for the provider.
      assert.ok(overrides.includes("features.fast_mode=true"));
      assert.equal(received(process, "turn/start")[0]?.serviceTier, "fast");
      assert.equal(process?.env[RUNNER_ENV.OPENAI_API_KEY], apiKey);
      assert.ok(!(process?.args ?? []).join(" ").includes(apiKey));
      assert.ok(!JSON.stringify(luke.applied).includes(apiKey));
    }),
);

const TOKEN_URL = "https://luke.test/api/agents/runner-token";
const SELF: RunnerSelf = {
  executable: "/usr/local/bin/node",
  script: "/opt/luke/agent-runner.mjs",
};

const ENV = {
  [RUNNER_ENV.BEARER]: BEARER,
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
  integrations: [{ name: "linear", url: "https://luke.test/runner/mcp/integrations/linear" }],
  tokenUrl: TOKEN_URL,
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
          extra.http ?? luke.layer,
          claude.layer,
          // Codex never waits on a wakeup, so no wait of its is released whatever runs.
          processTable(UNREAD_PROC, 1),
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
  "sets the member's installed skills as an extra skills root before the thread opens, and none where Luke wrote none",
  () =>
    Effect.gen(function* () {
      const folder = mkdtempSync(join(tmpdir(), "luke-installed-skills-"));
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
          const luke = fakeLuke("ci-watch");
          const { spawned, write, run } = yield* launch([script], luke);
          yield* write({ ...CONFIG, installedSkills });
          yield* write(message("The probe's first turn.", LINE.FIRST));
          yield* luke.seen;
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
        fakeLuke(),
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
  "on the Mac's own sign-in, app-server runs OpenAI's own provider once account/read finds a login, and every turn's sandbox is workspace-write, approval never, over the agent's folder and its worktree's shared Git directory",
  () =>
    Effect.gen(function* () {
      const home = mkdtempSync(join(tmpdir(), "luke-mac-home-"));
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(home, { recursive: true })));
      // A worktree of Luke's shared clone, as the Mac makes one: its `.git` a file naming the clone's.
      const clone = join(home, ".luke/clones/acme/app");
      const ownGit = join(clone, ".git/worktrees/repository");
      mkdirSync(ownGit, { recursive: true });
      writeFileSync(join(ownGit, "commondir"), "../..\n");
      const folder = join(home, ".luke/agents/agent-1");
      const checkout = join(folder, "repository");
      mkdirSync(checkout, { recursive: true });
      writeFileSync(join(checkout, ".git"), `gitdir: ${ownGit}\n`);
      const signedIn: Exchange = {
        method: "account/read",
        reply: [
          {
            id: 0,
            result: {
              account: { type: "chatgpt", email: null, planType: "plus" },
              requiresOpenaiAuth: true,
            },
          },
        ],
      };
      const script: Script = {
        exchanges: [
          exchange(FIRST, 0),
          exchange(FIRST, 1),
          signedIn,
          ...STOPPED.exchanges.slice(2),
        ],
      };
      const luke = fakeLuke("sleep 600");
      const { spawned, write, run } = yield* launch([script], luke, {
        [RUNNER_ENV.BEARER]: BEARER,
        PATH: "/usr/bin",
        HOME: home,
      });
      yield* write({ ...CONFIG, cwd: checkout, writableRoots: [folder], ownLogin: true });
      yield* write(message("Run sleep 600.", LINE.FIRST));
      yield* luke.seen;
      yield* write({ type: INPUT_LINE.STOP });

      assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
      const [process] = spawned;
      assert.deepEqual(process?.unexpected, []);
      assert.deepEqual(process?.received.map((each) => each.method).slice(0, 4), [
        "initialize",
        "initialized",
        "account/read",
        "thread/start",
      ]);
      const overrides = (process?.args ?? []).filter((_, index, args) => args[index - 1] === "-c");
      // No provider of Luke's: OpenAI's built-in one, over any of the developer's, on the login Codex keeps and refreshes itself.
      assert.deepEqual(
        overrides.filter((each) => each.startsWith("model_provider")),
        ['model_provider="openai"'],
      );
      assert.ok(!(process?.args ?? []).join(" ").includes(TOKEN_URL));
      const roots = [join(clone, ".git"), folder];
      assert.equal(received(process, "thread/start")[0]?.sandbox, "workspace-write");
      assert.equal(received(process, "thread/start")[0]?.approvalPolicy, "never");
      const turn = received(process, "turn/start")[0];
      assert.equal(turn?.approvalPolicy, "never");
      assert.deepEqual(turn?.sandboxPolicy, {
        type: "workspaceWrite",
        writableRoots: roots,
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      });
      assert.ok(
        overrides.includes(
          `sandbox_workspace_write.writable_roots=[${roots.map((root) => JSON.stringify(root)).join(", ")}]`,
        ),
      );
    }),
);

it.effect("on the Mac's own sign-in, opens no thread where account/read finds no login", () =>
  Effect.gen(function* () {
    const signedOut: Exchange = {
      method: "account/read",
      reply: [{ id: 0, result: { account: null, requiresOpenaiAuth: true } }],
    };
    const luke = fakeLuke();
    const { spawned, write, run } = yield* launch(
      [{ exchanges: [exchange(FIRST, 0), exchange(FIRST, 1), signedOut] }],
      luke,
    );
    yield* write({ ...CONFIG, ownLogin: true });

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(received(spawned[0], "thread/start"), []);
  }),
);

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
        `model_providers.openai_chatgpt_plan.auth.command="${SELF.executable}"`,
        `model_providers.openai_chatgpt_plan.auth.args=["${SELF.script}", "codex-token", "${TOKEN_URL}"]`,
        "model_providers.openai_chatgpt_plan.auth.timeout_ms=30000",
        "model_providers.openai_chatgpt_plan.auth.refresh_interval_ms=300000",
        'model_providers.openai_chatgpt_plan.wire_api="responses"',
        "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
        "model_providers.openai_chatgpt_plan.supports_websockets=false",
        'mcp_servers.luke.url="https://luke.test/runner/mcp"',
        'mcp_servers.luke.bearer_token_env_var="LUKE_RUNNER_TOKEN"',
        'mcp_servers.luke.default_tools_approval_mode="approve"',
        "mcp_servers.luke.tool_timeout_sec=600.0",
        'mcp_servers.linear.url="https://luke.test/runner/mcp/integrations/linear"',
        'mcp_servers.linear.bearer_token_env_var="LUKE_RUNNER_TOKEN"',
        'mcp_servers.linear.default_tools_approval_mode="approve"',
        "mcp_servers.linear.startup_timeout_sec=20.0",
        "mcp_servers.linear.tool_timeout_sec=600.0",
        'approval_policy="never"',
        'sandbox_mode="workspace-write"',
        "sandbox_workspace_write.network_access=true",
        `sandbox_workspace_write.writable_roots=["${CONFIG.cwd}/.git"]`,
        'shell_environment_policy.inherit="core"',
        "shell_environment_policy.ignore_default_excludes=false",
        'shell_environment_policy.exclude=["LUKE_RUNNER_TOKEN"]',
      ]);
      // The bearer reaches app-server in its environment alone, never argv.
      assert.equal(process?.env[RUNNER_ENV.BEARER], BEARER);
      assert.equal(process?.env.CODEX_HOME, ENV.CODEX_HOME);
      assert.ok(!process?.args.some((arg) => arg.includes(BEARER)));

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
      assert.equal(start !== undefined && "serviceTier" in start, false);
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
  "keeps a warm launch up past its completed turn, posting IDLE, and ends it as idled on Luke's retire",
  () =>
    Effect.gen(function* () {
      const luke = fakeLuke();
      const { spawned, write, run } = yield* launch([WORKFLOW], luke);
      yield* write({ ...CONFIG, warm: true });
      yield* write(message("The probe's first turn.", LINE.FIRST));
      yield* write(message("Also, before your final reply, append the line.", LINE.STEERED));
      for (let step = 0; step < 5_000; step += 1) {
        if (kinds(luke.applied).includes(RUNNER_EVENT.IDLE)) break;
        yield* Effect.yieldNow;
      }
      assert.equal(run.pollUnsafe(), undefined, "the launch stays up past its turn");

      yield* write({ type: INPUT_LINE.RETIRE });

      assert.equal(yield* Fiber.join(run), RUNNER_END.IDLED);
      assert.deepEqual(spawned[0]?.unexpected, []);
      assert.deepEqual(kinds(luke.applied).slice(-3), [
        "turn/completed",
        RUNNER_EVENT.IDLE,
        RUNNER_EVENT.END,
      ]);
      assert.deepEqual(luke.applied.at(-1)?.message, {
        type: RUNNER_EVENT.END,
        reason: RUNNER_END.IDLED,
      });
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
    const luke = fakeLuke("What exact line");
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
    const { spawned, write, run } = yield* launch([script], luke);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
    yield* luke.seen;
    yield* write(message("And the second line?", LINE.STEERED));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "turn/start")[1]?.input, [
      { type: "text", text: "And the second line?", text_elements: [] },
    ]);
    assert.deepEqual(acceptedLines(luke.applied), [LINE.FIRST, LINE.STEERED]);
  }),
);

it.effect("ends the launch as failed when app-server refuses a steer for any other reason", () =>
  Effect.gen(function* () {
    const luke = fakeLuke("What exact line");
    const script = refusedSteer({ code: -32603, message: "failed to steer turn: boom" }, false);
    const { spawned, write, run } = yield* launch([script], luke);
    yield* write({ ...CONFIG, threadId: THREAD });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));
    yield* luke.seen;
    yield* write(message("And the second line?", LINE.STEERED));

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(luke.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.FAILED,
      detail: "turn/steer: failed to steer turn: boom",
    });
    assert.deepEqual(received(spawned[0], "turn/start").length, 1);
    assert.deepEqual(acceptedLines(luke.applied), [LINE.FIRST]);
  }),
);

it.effect("ends the launch as stopped when app-server never answers the stop's interrupt", () =>
  Effect.gen(function* () {
    const luke = fakeLuke("sleep 600");
    const hung: Script = {
      exchanges: [...OPEN, exchange(FIRST, 5), { method: "turn/interrupt", reply: [] }],
    };
    const { spawned, write, run } = yield* launch([hung], luke);
    yield* write(CONFIG);
    yield* write(message("Run `sleep 600` and wait for it to finish."));
    yield* luke.seen;
    yield* write({ type: INPUT_LINE.STOP });
    while (received(spawned[0], "turn/interrupt").length === 0) yield* Effect.yieldNow;
    yield* Effect.yieldNow.pipe(Effect.repeat({ times: 50 }));
    yield* TestClock.adjust(Duration.minutes(1));

    assert.equal(yield* Fiber.join(run), RUNNER_END.STOPPED);
    assert.ok(spawned[0]?.ended);
    assert.deepEqual(luke.applied.at(-1)?.message, {
      type: RUNNER_EVENT.END,
      reason: RUNNER_END.STOPPED,
    });
  }),
);

it.effect("ends the launch as failed when app-server exits, its secrets taken out of why", () =>
  Effect.gen(function* () {
    const luke = fakeLuke();
    const { write, run } = yield* launch(
      [{ exchanges: [...OPEN, exchange(FIRST, 3)], exitWith: `panic: bad token ${BEARER}` }],
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
      assert.deepEqual(kinds(luke.applied).slice(-2), ["turn/completed", RUNNER_EVENT.END]);
      assert.deepEqual(luke.applied.at(-1)?.message, {
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
      assert.equal(override(process, "shell_environment_policy.exclude"), '["LUKE_RUNNER_TOKEN"]');
      assert.equal(override(process, "shell_environment_policy.inherit"), '"core"');

      // What the command printed went to app-server alone: never argv, an event, or a log.
      const posted = luke.bodies.join("\n");
      for (const secret of ["plan-token-1", "plan-token-2", BEARER]) {
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
    const { spawned, write, run } = yield* launch([WORKFLOW], luke, ENV, {});
    yield* write(CONFIG);

    assert.equal(yield* Fiber.join(run), RUNNER_END.FAILED);
    assert.deepEqual(spawned, []);
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
    const luke = fakeLuke();
    const page = turnsPage([
      { id: "turn-3", line: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e09" },
      { id: "turn-2", line: LINE.STEERED },
      { id: "turn-1", line: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e08" },
    ]);
    const script: Script = { exchanges: [...RESUME, page, REVERTED, RESUMED_TURN] };
    const { spawned, write, run } = yield* launch([script], luke);
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
    const luke = fakeLuke();
    const page = turnsPage([{ id: "turn-1", line: "6b1f5d0c-3a51-4c56-9d0e-2f1c4b7a8e08" }]);
    const script: Script = { exchanges: [...RESUME, page, RESUMED_TURN] };
    const { spawned, write, run } = yield* launch([script], luke);
    yield* write({ ...CONFIG, threadId: THREAD, rewindBefore: LINE.STEERED });
    yield* write(message("What exact line did you first write to PROBE.md?", LINE.FIRST));

    assert.equal(yield* Fiber.join(run), RUNNER_END.TURN_ENDED);
    const [process] = spawned;
    assert.deepEqual(process?.unexpected, []);
    assert.deepEqual(received(process, "thread/revert"), []);
  }),
);
