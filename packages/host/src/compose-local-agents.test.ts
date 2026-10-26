/**
 * compose-local-agents.test.ts -- the follower as the operating system sees it launch an agent: on a host, the agent's own `gh` signed in with a token from Luke before its worktree is made and again every fifty minutes, git pointed at gh's credential helper, and none of it on This Mac.
 *
 * The follower runs over a scripted spawner, a file system that holds only
 * the bundled tools, and a fake service that hands one launch line and a new
 * GitHub token at each ask, on the test's clock. Synthetic ids and tokens
 * throughout.
 */

import assert from "node:assert/strict";
import { NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { DeviceAgentClaimedLine } from "@luke/features";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { ConfigProvider, Duration, Effect, Layer, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import { composeLocalAgents } from "./compose-local-agents.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import { type ScriptedSpawner, scriptedSpawner } from "./testing/scripted-spawner.js";

const HOME = "/home/luke-host";
const AGENT_ID = "6f1c2a4e-0b7d-4c55-9a3e-2d8f61b0c9a1";
const LINE_ID = "0e9b7c1d-5a2f-4e63-8b40-7c1d2e3f4a5b";
const USER_ID = "user-fixture";
const TOOLS = { node: "/opt/luke/node", claude: "/opt/luke/claude", gh: "/opt/luke/gh/bin/gh" };
const LAUNCHER = "/opt/luke/launch";
const LAYOUT = deviceAgentLayout(HOME, AGENT_ID);
const GH_CONFIG_DIR = `${LAYOUT.folder}/gh`;
const SECRET_ENV = { LUKE_RUNNER_TOKEN: "runner-secret" };
const FIFTY_MINUTES = Duration.minutes(50);

/** A command one of the agent's tools asks the box to run in its worktree. */
const COMMAND = {
  id: "3c2b1a0f-9e8d-4c7b-a6f5-e4d3c2b1a0f9",
  agentId: AGENT_ID,
  kind: DEVICE_AGENT_REQUEST_KIND.RUN_COMMAND,
  args: { command: "git fetch origin" },
};

const LAUNCH: DeviceAgentClaimedLine = {
  line: {
    id: LINE_ID,
    agentId: AGENT_ID,
    seq: 1,
    kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
    payload: {
      checkoutPath: LAYOUT.checkoutPath,
      repository: "acme/relay",
      startBranch: null,
      firstSequence: 0,
    },
  },
  secrets: { env: SECRET_ENV, stdin: "{}\n" },
};

/** The follower on a box that does, or does not, take its agents' GitHub from Luke, with what it spawned, asked, and reported. */
const following = (githubFromLuke: boolean) =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l")
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      if (program === TOOLS.claude) return { exitCode: 1 };
      if (program === TOOLS.gh || program === "/bin/bash") return { exitCode: 0 };
      if (program === LAUNCHER) return {};
      return undefined;
    });
    const asked: string[] = [];
    const reported: string[] = [];
    let linesRead = 0;
    let requestsRead = 0;
    const client = {
      register: () => Effect.succeed(true),
      beat: () => Effect.succeed(true),
      lines: () => (linesRead++ === 0 ? Effect.succeed([LAUNCH.line]) : Effect.never),
      claimLine: () => Effect.succeed(LAUNCH),
      settleLine: () => Effect.succeed(true),
      // Note that the command is asked once the runner runs, so the launch's spawns come first.
      requests: () =>
        requestsRead++ === 0
          ? Effect.sleep(Duration.seconds(1)).pipe(Effect.as([COMMAND]))
          : Effect.never,
      claimRequest: () => Effect.succeed(COMMAND),
      answerRequest: () => Effect.succeed(true),
      githubToken: (agentId: string) =>
        Effect.sync(() => {
          asked.push(agentId);
          return `ghs_fixture_${asked.length}`;
        }),
    };
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      FileSystem.layerNoop({
        exists: (path) => Effect.succeed(path === TOOLS.node || path === TOOLS.claude),
        makeDirectory: () => Effect.void,
        realPath: (path) => Effect.succeed(path),
        writeFileString: () => Effect.void,
        rename: () => Effect.void,
      }),
      fakeHttpClientLayer(() => Promise.reject(new Error("this test fetches no tool"))),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: (line) => reported.push(line) }),
      Layer.succeed(LocalAgentPlatform, {
        launch: ({ env }) => ({ command: LAUNCHER, args: [], env }),
        runnerBundle: "/opt/luke/agent-runner.mjs",
        runnerEnv: {},
        bundled: { node: TOOLS.node, claude: TOOLS.claude, gh: TOOLS.gh },
        githubFromLuke,
        deviceName: "rack-1",
        devicePlatform: DEVICE_PLATFORM.LINUX,
        deviceArch: DEVICE_ARCH.X64,
        worktreeScript: () => "exit 0",
      }),
    );
    const composer = yield* composeLocalAgents({
      kernel: {
        stateRoot: "/var/lib/luke-host",
        createId: () => "device-1",
        runMode: { sendsNetwork: true },
      },
      account: { capabilitiesActive: () => true },
      accountId: () => USER_ID,
      switchedOn: Effect.succeed(true),
      client,
    }).pipe(Effect.provide(services));
    yield* composer.lifetime;
    return { spawned: spawner.spawned, asked, reported };
  });

/** Whether a spawn is the tool's command, run by the box's request worker. */
const isCommand = (each: ScriptedSpawner["spawned"][number]) =>
  each.args[2] === COMMAND.args.command;

/** The variables of an environment that are git's or gh's. */
const githubVariables = (env: Readonly<Record<string, string | undefined>> | undefined) =>
  Object.fromEntries(
    Object.entries(env ?? {}).filter(
      ([name]) => name === "GH_CONFIG_DIR" || name.startsWith("GIT_CONFIG_"),
    ),
  );

/** The clock nudged until the condition holds, as the follower's fibers run up to their next wait. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 200 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.zero);
    }
    assert.ok(holds(), "the follower never got there");
  });

/** What each `gh auth login` was handed on its stdin: the token, and nothing else. */
const tokensSignedIn = (spawned: ScriptedSpawner["spawned"]) =>
  Effect.forEach(
    spawned.filter((each) => each.program === TOOLS.gh),
    (each) =>
      Effect.gen(function* () {
        const stdin = each.stdin;
        const stream =
          typeof stdin === "object" && stdin !== null && "stream" in stdin
            ? stdin.stream
            : undefined;
        assert.ok(Stream.isStream(stream), "gh was handed no stdin");
        const chunks = yield* Stream.runCollect(stream);
        const decoder = new TextDecoder();
        return Array.from(chunks, (chunk) => {
          assert.ok(chunk instanceof Uint8Array);
          return decoder.decode(chunk);
        }).join("");
      }),
  );

it.effect(
  "a host signs its agent's gh in with a token from Luke before its worktree is made and every fifty minutes after, and points git at gh's credential helper",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, asked, reported } = yield* following(true);
        yield* until(() => spawned.some((each) => each.program === LAUNCHER));

        const programs = spawned.map((each) => each.program);
        const signIn = programs.indexOf(TOOLS.gh);
        // Note that the login shell, which reads the PATH, is a `/bin/bash` too, run with `-l`.
        const worktree = spawned.findIndex(
          (each) => each.program === "/bin/bash" && each.args[0] === "-c",
        );
        assert.ok(signIn !== -1 && signIn < worktree && worktree < programs.indexOf(LAUNCHER));
        const gh = spawned[signIn];
        assert.deepEqual(gh?.args, [
          "auth",
          "login",
          "--hostname",
          "github.com",
          "--with-token",
          "--insecure-storage",
        ]);
        assert.equal(gh?.env?.GH_CONFIG_DIR, GH_CONFIG_DIR);
        assert.deepEqual(asked, [AGENT_ID]);
        assert.deepEqual(yield* tokensSignedIn(spawned), ["ghs_fixture_1"]);

        // Git reads the one token through gh's own helper, in the worktree's script and the runner alike.
        const helper = {
          GH_CONFIG_DIR,
          GIT_CONFIG_COUNT: "2",
          GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
          GIT_CONFIG_VALUE_0: "",
          GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
          GIT_CONFIG_VALUE_1: `!'${TOOLS.gh}' auth git-credential`,
        };
        const script = spawned[worktree];
        assert.equal(script?.extendEnv, true);
        assert.deepEqual(script?.env, helper);
        const runner = spawned.find((each) => each.program === LAUNCHER);
        assert.deepEqual(
          Object.fromEntries(
            Object.entries(runner?.env ?? {}).filter(
              ([name]) => name in helper || name in SECRET_ENV,
            ),
          ),
          { ...helper, ...SECRET_ENV },
        );

        // Renewed on the cadence, not before.
        yield* TestClock.adjust(Duration.subtract(FIFTY_MINUTES, Duration.seconds(1)));
        assert.deepEqual(asked, [AGENT_ID]);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => spawned.filter((each) => each.program === TOOLS.gh).length === 2);
        yield* TestClock.adjust(FIFTY_MINUTES);
        yield* until(() => spawned.filter((each) => each.program === TOOLS.gh).length === 3);
        assert.deepEqual(yield* tokensSignedIn(spawned), [
          "ghs_fixture_1",
          "ghs_fixture_2",
          "ghs_fixture_3",
        ]);

        // A command the agent's tools ask reads the same sign-in as the runner.
        yield* until(() => spawned.some(isCommand));
        assert.deepEqual(githubVariables(spawned.find(isCommand)?.env), helper);

        const said = reported.join("\n");
        for (const token of ["ghs_fixture_1", "ghs_fixture_2", "ghs_fixture_3"]) {
          assert.equal(said.includes(token), false, "a token in a report");
        }
        for (const each of spawned) {
          assert.equal(
            each.args.join(" ").includes("ghs_fixture"),
            false,
            "a token in an argument",
          );
        }
      }),
    ),
);

it.effect(
  "This Mac launches its agent on the developer's own git login: no token asked, no gh signed in, and nothing of git's in the worktree's script or the runner's environment",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, asked } = yield* following(false);
        yield* until(() => spawned.some((each) => each.program === LAUNCHER));
        yield* TestClock.adjust(FIFTY_MINUTES);

        assert.deepEqual(asked, []);
        assert.equal(
          spawned.some((each) => each.program === TOOLS.gh),
          false,
        );
        const script = spawned.find(
          (each) => each.program === "/bin/bash" && each.args[0] === "-c",
        );
        assert.equal(script?.env, undefined);
        const runner = spawned.find((each) => each.program === LAUNCHER);
        assert.deepEqual(githubVariables(runner?.env), {});
        yield* until(() => spawned.some(isCommand));
        assert.deepEqual(githubVariables(spawned.find(isCommand)?.env), {});
        assert.equal(runner?.env?.LUKE_RUNNER_TOKEN, SECRET_ENV.LUKE_RUNNER_TOKEN);
      }),
    ),
);
