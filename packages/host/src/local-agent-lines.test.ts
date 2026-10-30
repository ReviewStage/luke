/**
 * local-agent-lines.test.ts -- the follower as a device sees its lines: a discard line takes the agent's folder off the disk, unless the platform's check finds work in it, a line of a kind it does not know is settled without holding back the lines after it, and a launch whose folder was cleared since its last turn starts afresh, told so, while one whose folder stands goes on from its session.
 *
 * The follower runs over the real client, its held read and claims answered
 * by a scripted service, so an answer is decoded as the wire decodes it; on
 * a real temporary folder, so what a line leaves on the disk is what the
 * test reads; and over a scripted spawner, on the test's clock. Each test
 * waits for the service to take a line's settle, never on the clock, since
 * nothing on the way there sleeps and the disk answers in its own time.
 * Synthetic ids and tokens throughout.
 */

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { fixedBearer, HOSTED_SERVICE_PATH, HostedDeviceAgentClient } from "@luke/features";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_CAPABILITY,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
  type DeviceAgentLine,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { ConfigProvider, Deferred, Effect, Exit, Layer, Option, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { composeLocalAgents } from "./compose-local-agents.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import { LAUNCH_NOTE } from "./local-agent-first-lines.js";
import { fakeClis } from "./testing/fake-clis.js";
import { type Script, type ScriptedSpawner, scriptedSpawner } from "./testing/scripted-spawner.js";

const SERVICE = "https://luke.test";
const AGENT_ID = "6f1c2a4e-0b7d-4c55-9a3e-2d8f61b0c9a1";
const DEVICE_ID = "2b7e1d4c-8a3f-4e95-b061-5c2d7f8e9a10";

const DISCARD: DeviceAgentLine = {
  id: "0e9b7c1d-5a2f-4e63-8b40-7c1d2e3f4a5b",
  agentId: AGENT_ID,
  seq: 2,
  kind: DEVICE_AGENT_LINE_KIND.DISCARD,
  payload: {},
};

/** A line of a kind a service newer than this follower added. */
const NEWER_KIND: DeviceAgentLine = {
  id: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a",
  agentId: AGENT_ID,
  seq: 1,
  kind: "hibernate",
  payload: {},
};

/** The platform's check of the worktree, named so the scripted spawner answers it. */
const UNSAVED_WORK_SCRIPT = "check-for-unsaved-work";
/** The platform's script that makes the agent's repository, named so the scripted spawner answers it. */
const WORKTREE_SCRIPT = "make-the-agents-repository";
/** The runner's own start on the box, as the platform launches it. */
const RUNNER = "/opt/luke-host/node/bin/node";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A fetch that never answers, as a held read the service holds past the test. */
const held = () => new Promise<Response>(() => {});

/** The platform the follower runs on: This Mac, whose agents run straight on it, checking a folder with the script given before a discard where one is. */
const directMac = (unsavedWork: Script | undefined) => ({
  launch: ({
    node,
    env,
  }: {
    readonly node: string;
    readonly env: Readonly<Record<string, string>>;
  }) => ({
    command: node,
    args: [env.LUKE_RUNNER_TOKEN ?? ""],
    env: {},
  }),
  tools: {
    node: RUNNER,
    claude: "/opt/luke/agent-tools/claude",
    codex: "/opt/luke/agent-tools/codex",
  },
  clis: fakeClis(),
  formerlyDirect: true,
  storesOwned: false,
  runnerBundle: "/opt/luke/agent-runner.mjs",
  runnerEnv: {},
  deviceName: "Studio",
  devicePlatform: DEVICE_PLATFORM.DARWIN,
  deviceArch: DEVICE_ARCH.ARM64,
  deviceIsolation: DEVICE_ISOLATION.DIRECT,
  deviceCapabilities: [DEVICE_CAPABILITY.DISCARD],
  worktreeScript: () => WORKTREE_SCRIPT,
  unsavedWorkScript: unsavedWork === undefined ? undefined : () => UNSAVED_WORK_SCRIPT,
});

/**
 * The follower on a device whose agent's folder holds a file, the agent in
 * the device's record of the agents it made as its launch left it, its held
 * read answered once with the lines given and every line claimable, with
 * the folder, the record's file for the agent, the line ids it settled, and
 * what waits for the service to take the discard's settle.
 */
const following = (lines: readonly DeviceAgentLine[], unsavedWork?: Script) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-agent-lines-");
    const home = path.join(root, "home");
    const fileSystem = yield* FileSystem.FileSystem;
    const folder = deviceAgentLayout(home, AGENT_ID).folder;
    yield* fileSystem.makeDirectory(path.join(folder, "repository"), { recursive: true });
    yield* fileSystem.writeFileString(path.join(folder, "repository", "notes.md"), "unpushed\n");
    const owned = path.join(root, "state", "owned-agents", AGENT_ID);
    yield* fileSystem.makeDirectory(path.dirname(owned), { recursive: true });
    yield* fileSystem.writeFileString(owned, "");
    // Note that the agent is kept as one that ran on the box, so This Mac checks its folder as it checks every other.
    const modes = { [AGENT_ID]: DEVICE_ISOLATION.DIRECT };
    yield* fileSystem.writeFileString(
      path.join(root, "state", "local-agents.json"),
      JSON.stringify({ devices: {}, launches: [], modes }),
    );

    const settled: string[] = [];
    const discardSettled = Deferred.makeUnsafe<void>();
    let linesRead = 0;
    const fetchLike = async (url: string | URL | Request, init?: RequestInit) => {
      const { pathname } = new URL(String(url));
      const body = init?.body === undefined ? {} : JSON.parse(String(init.body));
      switch (pathname) {
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES:
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE:
          return json({ done: true });
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_LINE_CLAIM:
          return json({ line: lines.find((line) => line.id === body.id) });
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_LINES:
          if (init?.method === "POST") {
            settled.push(body.id);
            if (body.id === DISCARD.id) Deferred.doneUnsafe(discardSettled, Exit.void);
            return json({ done: true });
          }
          return linesRead++ === 0 ? json({ lines }) : held();
        default:
          return held();
      }
    };
    const spawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l") {
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      }
      return program === "/bin/bash" && args[1] === UNSAVED_WORK_SCRIPT ? unsavedWork : undefined;
    });
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      NodeFileSystem.layer,
      fakeHttpClientLayer(fetchLike),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME: home, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: () => {} }),
      Layer.succeed(LocalAgentPlatform, directMac(unsavedWork)),
    );
    const composer = yield* composeLocalAgents({
      kernel: {
        stateRoot: path.join(root, "state"),
        createId: () => DEVICE_ID,
        runMode: { sendsNetwork: true },
      },
      account: { capabilitiesActive: () => true },
      accountId: () => "user-fixture",
      switchedOn: Effect.succeed(true),
      client: new HostedDeviceAgentClient({
        credential: fixedBearer("device-token"),
        serviceBaseUrl: SERVICE,
      }),
    }).pipe(Effect.provide(services));
    yield* composer.lifetime;
    return { folder, owned, settled, discardSettled: Deferred.await(discardSettled) };
  });

it.effect("a discard line removes the agent's folder from the device and is settled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { folder, settled, discardSettled } = yield* following([DISCARD]);
      yield* discardSettled;

      const fileSystem = yield* FileSystem.FileSystem;
      assert.equal(yield* fileSystem.exists(folder), false, "the agent's folder is still there");
      assert.deepEqual(settled, [DISCARD.id]);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a line of a kind the follower does not know is settled untouched, and the line after it is still delivered",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { folder, settled, discardSettled } = yield* following([NEWER_KIND, DISCARD]);
        yield* discardSettled;

        const fileSystem = yield* FileSystem.FileSystem;
        assert.deepEqual(settled, [NEWER_KIND.id, DISCARD.id]);
        assert.equal(yield* fileSystem.exists(folder), false);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

for (const [name, check, kept] of [
  ["says it holds work", { stdout: "it has changes not committed\n", exitCode: 0 }, true],
  ["cannot say", { exitCode: 1 }, true],
  ["finds nothing", { exitCode: 0 }, false],
] as const) {
  it.effect(
    `a discard where the platform's check ${name} ${kept ? "keeps" : "removes"} the folder, and the device's record of it, and is settled`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { folder, owned, settled, discardSettled } = yield* following([DISCARD], check);
          yield* discardSettled;

          const fileSystem = yield* FileSystem.FileSystem;
          assert.equal(yield* fileSystem.exists(folder), kept);
          assert.equal(yield* fileSystem.exists(owned), kept);
          assert.deepEqual(settled, [DISCARD.id]);
        }),
      ).pipe(Effect.provide(NodeFileSystem.layer)),
  );
}

const LAUNCH: DeviceAgentLine = {
  id: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d",
  agentId: AGENT_ID,
  seq: 1,
  kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
  payload: {},
};
/** A launch's first lines that continue a Claude Code session: its config, then the developer's message. */
const RESUMING_LINES = [
  { harness: "claude_code", resume: "session-fixture", firstSequence: 0 },
  { type: "message", content: [{ type: "text", text: "Go on with the relay." }] },
]
  .map((line) => `${JSON.stringify(line)}\n`)
  .join("");

/** The lines the runner was handed first on its stdin, as the device wrote them, each read as JSON. */
const firstLinesOf = (spawned: ScriptedSpawner["spawned"]) =>
  Effect.gen(function* () {
    const stdin = spawned.find((each) => each.program === RUNNER)?.stdin;
    assert.ok(typeof stdin === "object" && "stream" in stdin && typeof stdin.stream === "object");
    const first = Option.getOrThrow(yield* Stream.runHead(stdin.stream));
    return new TextDecoder()
      .decode(first)
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  });

/**
 * The follower on a Linux host, whose agents run straight on it, one launch line
 * handed once for an agent in a repository, whose first lines continue a
 * session, and whose runner ends at once; where `workStands` says, the
 * agent's repository already stands in its folder, as its last turn left it.
 * With the processes spawned, what the repository's script was asked for,
 * and what waits for the launch's settle.
 */
const launching = (workStands: boolean) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-agent-launch-");
    const home = path.join(root, "home");
    const layout = deviceAgentLayout(home, AGENT_ID);
    if (workStands) mkdirSync(path.join(layout.checkoutPath, ".git"), { recursive: true });
    const launchSettled = Deferred.makeUnsafe<void>();
    let linesRead = 0;
    const fetchLike = async (url: string | URL | Request, init?: RequestInit) => {
      const { pathname } = new URL(String(url));
      const body = init?.body === undefined ? {} : JSON.parse(String(init.body));
      switch (pathname) {
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES:
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE:
          return json({ done: true });
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_LINE_CLAIM:
          return json({
            line: {
              ...LAUNCH,
              payload: {
                checkoutPath: layout.checkoutPath,
                repository: "acme/app",
                startBranch: "main",
                firstSequence: 0,
              },
            },
            secrets: { env: { LUKE_RUNNER_TOKEN: "runner-secret" }, stdin: RESUMING_LINES },
          });
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_LINES:
          if (init?.method === "POST") {
            if (body.id === LAUNCH.id) Deferred.doneUnsafe(launchSettled, Exit.void);
            return json({ done: true });
          }
          return linesRead++ === 0 ? json({ lines: [LAUNCH] }) : held();
        case HOSTED_SERVICE_PATH.RUNNER_TOKEN:
          return json({ githubToken: "ghs_fixture" });
        default:
          return held();
      }
    };
    const worktrees: { readonly branch: string | null }[] = [];
    const spawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l") {
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      }
      if (program === "/bin/bash" && args[1] === WORKTREE_SCRIPT) {
        return {
          exitCode: 0,
          until: Effect.sync(() => {
            mkdirSync(path.join(layout.checkoutPath, ".git"), { recursive: true });
          }),
        };
      }
      if (program === "/bin/bash") return { exitCode: 0 };
      return program === RUNNER ? { exitCode: 0 } : undefined;
    });
    const platform = directMac(undefined);
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      NodeFileSystem.layer,
      fakeHttpClientLayer(fetchLike),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME: home, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: () => {} }),
      Layer.succeed(LocalAgentPlatform, {
        ...platform,
        formerlyDirect: false,
        devicePlatform: DEVICE_PLATFORM.LINUX,
        deviceArch: DEVICE_ARCH.X64,
        worktreeScript: (input) => {
          worktrees.push(input);
          return WORKTREE_SCRIPT;
        },
      }),
    );
    const composer = yield* composeLocalAgents({
      kernel: {
        stateRoot: path.join(root, "state"),
        createId: () => DEVICE_ID,
        runMode: { sendsNetwork: true },
      },
      account: { capabilitiesActive: () => true },
      accountId: () => "user-fixture",
      switchedOn: Effect.succeed(true),
      client: new HostedDeviceAgentClient({
        credential: fixedBearer("device-token"),
        serviceBaseUrl: SERVICE,
      }),
    }).pipe(Effect.provide(services));
    yield* composer.lifetime;
    return { spawned: spawner.spawned, worktrees, launchSettled: Deferred.await(launchSettled) };
  });

it.effect.each([
  { workStands: true, resumed: true },
  { workStands: false, resumed: false },
])(
  "a launch whose work stands in its folder ($workStands) goes on from its session ($resumed), and one whose folder was cleared starts afresh from its branch, told why",
  ({ workStands, resumed }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, worktrees, launchSettled } = yield* launching(workStands);
        yield* launchSettled;

        const [config, message] = yield* firstLinesOf(spawned);
        assert.equal(config?.resume, resumed ? "session-fixture" : undefined);
        assert.equal(message?.content?.[0]?.text?.includes(LAUNCH_NOTE.CLEARED) ?? false, !resumed);
        assert.deepEqual(
          worktrees.map((each) => each.branch),
          workStands ? [] : ["main"],
        );
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);
