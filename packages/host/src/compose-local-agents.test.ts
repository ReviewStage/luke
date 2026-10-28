/**
 * compose-local-agents.test.ts -- the follower as the operating system sees it run agents in VMs: a device registered as sandboxed, signed in to nothing, getting ready while it fetches its sandbox and ready to take an agent only once it has it, or why it could not have it, an agent launched in its VM with a GitHub token from Luke, and, on This Mac alone, an agent that ran directly on it before refused with why.
 *
 * The follower runs over a scripted spawner, a fake sandbox, a file system
 * that holds nothing but what a test names, and a fake service that hands
 * one launch line and a new GitHub token at each ask, on the test's clock.
 * Synthetic ids and tokens throughout.
 */

import assert from "node:assert/strict";
import { NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { DeviceAgentClaimedLine, DeviceAgentDevice } from "@luke/features";
import { CHECKOUT_IDENTITY_SCRIPT } from "@luke/features/checkout-identity";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_ISOLATION,
  DEVICE_LAUNCH_REFUSAL,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DeviceLaunchRefusal,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { ConfigProvider, Duration, Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";
import { TestClock } from "effect/testing";
import { composeLocalAgents } from "./compose-local-agents.js";
import {
  Environment,
  LocalAgentPlatform,
  type LocalAgentSandbox,
  LocalAgentSandboxUnavailable,
  Reporter,
} from "./effect/seams.js";
import { fakeSandbox, VM_EXEC, VM_TOOLS } from "./testing/fake-sandbox.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

const HOME = "/Users/dev";
const AGENT_ID = "6f1c2a4e-0b7d-4c55-9a3e-2d8f61b0c9a1";
const LINE_ID = "0e9b7c1d-5a2f-4e63-8b40-7c1d2e3f4a5b";
const USER_ID = "user-fixture";
const LAYOUT = deviceAgentLayout(HOME, AGENT_ID);
const SECRET_ENV = { LUKE_RUNNER_TOKEN: "runner-secret" };
/** The runner's own start in its VM, apart from a command the follower runs there (`VM_EXEC`). */
const VM_RUNNER = "/opt/luke/vm-runner";
const IDENTITY = { name: "Ada Lovelace", email: "7001+ada@users.noreply.github.com" };

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
      identity: IDENTITY,
    },
  },
  secrets: { env: SECRET_ENV, stdin: "{}\n" },
};

/** Every follower a test started, by the files it was handed, so each mints a lease holder of its own. */
const holders: Map<string, string>[] = [];

/** The clock nudged until the condition holds, as the follower's fibers run up to their next wait. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 200 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.zero);
    }
    assert.ok(holds(), "the follower never got there");
  });

/**
 * The follower on a device whose agents run in VMs, This Mac unless
 * `formerlyDirect` says it is a host, with its sandbox ready once `ready`
 * succeeds; one launch line is handed. `madeBare` says the agent's checkout
 * already stands, as a launch from before the record left it. With what it
 * registered, spawned, asked, handed the sandbox, settled, and reported.
 */
const followingDevice = (
  ready: LocalAgentSandbox["ready"],
  options: {
    readonly madeBare?: boolean;
    readonly formerlyDirect?: boolean;
    /** The service refuses a register naming a setup, as one from before the field does. */
    readonly refusesSetup?: boolean;
    /** The files of the machine's state, shared with another follower on the same machine where given. */
    readonly files?: Map<string, string>;
  } = {},
) =>
  Effect.gen(function* () {
    const files = options.files ?? new Map<string, string>();
    holders.push(files);
    let minted = 0;
    const spawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l")
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      if (program === "/bin/bash") return { exitCode: 0 };
      // Note that the runner in the VM ends by itself a second in, so the test's end has no runner to wait out.
      if (program === VM_RUNNER) return { exitCode: 0, after: Duration.seconds(1) };
      if (program === VM_EXEC) return { exitCode: 0 };
      return undefined;
    });
    const registered: DeviceAgentDevice[] = [];
    const asked: string[] = [];
    const beats: number[] = [];
    const reported: string[] = [];
    const settled: { id: string; exitCode?: number; refusal?: DeviceLaunchRefusal }[] = [];
    let launched = false;
    const client = {
      register: (_deviceId: string, device: DeviceAgentDevice) =>
        Effect.sync(() => registered.push(device)).pipe(
          Effect.as(options.refusesSetup !== true || device.setup === undefined),
        ),
      beat: () => Effect.sync(() => beats.push(registered.length)).pipe(Effect.as(true)),
      lines: () =>
        launched
          ? Effect.never
          : Effect.sync(() => {
              launched = true;
              return [LAUNCH.line];
            }),
      claimLine: () => Effect.succeed(LAUNCH),
      settleLine: (
        _deviceId: string,
        id: string,
        exitCode?: number,
        refusal?: DeviceLaunchRefusal,
      ) =>
        Effect.sync(() =>
          settled.push({
            id,
            ...(exitCode === undefined ? undefined : { exitCode }),
            ...(refusal === undefined ? undefined : { refusal }),
          }),
        ).pipe(Effect.as(true)),
      requests: () => Effect.never,
      claimRequest: () => Effect.succeed({ claimed: false as const }),
      answerRequest: () => Effect.succeed(true),
      githubToken: (agentId: string) =>
        Effect.sync(() => {
          asked.push(agentId);
          return `ghs_fixture_${asked.length}`;
        }),
    };
    const vm = fakeSandbox(ready);
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      FileSystem.layerNoop({
        exists: (path) => Effect.succeed(options.madeBare === true && path === LAYOUT.checkoutPath),
        makeDirectory: () => Effect.void,
        readFileString: (path) => {
          const held = files.get(path);
          return held === undefined
            ? Effect.fail(
                systemError({
                  _tag: "NotFound",
                  module: "FileSystem",
                  method: "readFileString",
                  pathOrDescriptor: path,
                }),
              )
            : Effect.succeed(held);
        },
        writeFileString: (path, data) => Effect.sync(() => void files.set(path, data)),
        rename: (from, to) =>
          Effect.sync(() => {
            const held = files.get(from);
            files.delete(from);
            if (held !== undefined) files.set(to, held);
          }),
        remove: (path) => Effect.sync(() => void files.delete(path)),
        link: (from, to) => {
          const held = files.get(from);
          return held === undefined || files.has(to)
            ? Effect.fail(
                systemError({
                  _tag: "AlreadyExists",
                  module: "FileSystem",
                  method: "link",
                  pathOrDescriptor: to,
                }),
              )
            : Effect.sync(() => void files.set(to, held));
        },
      }),
      fakeHttpClientLayer(() => Promise.reject(new Error("this test fetches no tool"))),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: (line) => reported.push(line) }),
      Layer.succeed(LocalAgentPlatform, {
        launch: ({ env }) => ({ command: VM_RUNNER, args: [], env }),
        sandbox: vm.sandbox,
        formerlyDirect: options.formerlyDirect ?? true,
        runnerBundle: "/opt/luke/agent-runner.mjs",
        runnerEnv: {},
        deviceName: "Studio",
        devicePlatform: DEVICE_PLATFORM.DARWIN,
        deviceArch: DEVICE_ARCH.ARM64,
        deviceIsolation: DEVICE_ISOLATION.SANDBOX,
        deviceCapabilities: [],
        worktreeScript: () => "exit 0",
      }),
    );
    const composer = yield* composeLocalAgents({
      kernel: {
        stateRoot: "/Users/dev/Library/Application Support/Luke",
        // Note that each follower mints its own lease holder first, then the account's device id.
        createId: () => (minted++ === 0 ? `holder-${holders.length}` : "device-1"),
        runMode: { sendsNetwork: true },
      },
      account: { capabilitiesActive: () => true },
      accountId: () => USER_ID,
      switchedOn: Effect.succeed(true),
      client,
    }).pipe(Effect.provide(services));
    yield* composer.lifetime;
    return {
      registered,
      beats,
      spawned: spawner.spawned,
      asked,
      tokens: vm.tokens,
      settled,
      reported,
    };
  });

it.effect(
  "a device registers as sandboxed, signed in to nothing, and launches its agent in a VM with a GitHub token from Luke, its commit identity set in its repository first",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { registered, spawned, asked, tokens } = yield* followingDevice(() => Effect.void);
        yield* until(() => spawned.some((each) => each.program === VM_RUNNER));

        // Note that no login of the device's reaches a VM, so the service pays with the sign-in saved in Luke, or refuses.
        assert.deepEqual(
          registered.map((each) => ({
            isolation: each.isolation,
            claudeExecutable: each.claudeExecutable,
            codexExecutable: each.codexExecutable,
            signedIn: each.signedIn,
          })),
          [
            {
              isolation: DEVICE_ISOLATION.SANDBOX,
              claudeExecutable: VM_TOOLS.claude,
              codexExecutable: VM_TOOLS.codex,
              signedIn: { claudeCode: false, codex: false },
            },
          ],
        );
        assert.deepEqual(asked, [AGENT_ID]);
        assert.deepEqual(tokens, ["ghs_fixture_1"]);
        const runner = spawned.find((each) => each.program === VM_RUNNER);
        assert.equal(runner?.env?.LUKE_RUNNER_TOKEN, SECRET_ENV.LUKE_RUNNER_TOKEN);
        assert.equal(
          Object.keys(runner?.env ?? {}).some(
            (name) => name === "GH_CONFIG_DIR" || name.startsWith("GIT_CONFIG_"),
          ),
          false,
          "the runner reaches GitHub through its VM's bindings alone",
        );
        // Note that the identity the launch carries is set in the agent's repository, in its VM, as a cloud checkout sets it, before its runner starts.
        const identity = spawned.findIndex((each) => each.args.includes(CHECKOUT_IDENTITY_SCRIPT));
        assert.equal(spawned[identity]?.program, VM_EXEC, "the identity is set inside the VM");
        assert.equal(spawned[identity]?.env?.LUKE_GIT_NAME, IDENTITY.name);
        assert.equal(spawned[identity]?.env?.LUKE_GIT_EMAIL, IDENTITY.email);
        assert.ok(identity < spawned.findIndex((each) => each.program === VM_RUNNER));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => runner?.ended === "exited");
      }),
    ),
);

it.effect(
  "a device fetching its sandbox registers as getting ready and beats while it fetches, then registers ready and follows",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { registered, beats, spawned } = yield* followingDevice((preparing) =>
          Effect.andThen(preparing, Effect.sleep(Duration.minutes(3))),
        );
        yield* TestClock.adjust(Duration.seconds(5));
        yield* until(() => registered.length > 0);

        assert.deepEqual(
          registered.map((each) => each.setup),
          [DEVICE_SETUP.PREPARING],
        );
        assert.equal(
          spawned.some((each) => each.program === VM_RUNNER),
          false,
        );
        yield* TestClock.adjust(Duration.minutes(3));
        yield* until(() => spawned.some((each) => each.program === VM_RUNNER));

        assert.deepEqual(
          registered.map((each) => each.setup),
          [DEVICE_SETUP.PREPARING, undefined],
        );
        // Note that it beat while preparing, so the menus kept it listed through the fetch.
        assert.ok(beats.filter((after) => after === 1).length >= 10, `beats ${beats.join(",")}`);
        yield* TestClock.adjust(Duration.seconds(1));
      }),
    ),
);

it.effect(
  "a device whose getting-ready register a service refuses beats nothing while it fetches, so its earlier ready row ages away, then registers ready",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { registered, beats, spawned } = yield* followingDevice(
          (preparing) => Effect.andThen(preparing, Effect.sleep(Duration.minutes(3))),
          { refusesSetup: true },
        );
        yield* TestClock.adjust(Duration.seconds(5));
        yield* until(() => registered.length > 0);
        yield* TestClock.adjust(Duration.minutes(3));
        yield* until(() => spawned.some((each) => each.program === VM_RUNNER));

        assert.deepEqual(
          registered.map((each) => each.setup),
          [DEVICE_SETUP.PREPARING, undefined],
        );
        assert.deepEqual(
          beats.filter((after) => after === 1),
          [],
        );
        yield* TestClock.adjust(Duration.seconds(1));
      }),
    ),
);

it.effect(
  "a device whose sandbox could not be had registers why and goes on beating, taking no agent, and says what it could not have",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { registered, beats, spawned, reported } = yield* followingDevice(() =>
          Effect.fail(
            new LocalAgentSandboxUnavailable({ detail: "smolvm couldn't be downloaded" }),
          ),
        );
        yield* until(() => reported.length > 0);
        yield* TestClock.adjust(Duration.minutes(1));

        assert.deepEqual(
          registered.map((each) => [each.setup, each.setupFailure]),
          [[DEVICE_SETUP.FAILED, "smolvm couldn't be downloaded"]],
        );
        assert.ok(beats.length >= 4, `beats ${beats.join(",")}`);
        assert.equal(
          spawned.some((each) => each.program === VM_RUNNER),
          false,
        );
        assert.deepEqual(reported, ["the local agents' smolvm or sandbox image could not be had"]);
      }),
    ),
);

it.effect(
  "an agent that ran directly on This Mac before is settled unstarted, naming why, and never started",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, settled, reported } = yield* followingDevice(() => Effect.void, {
          madeBare: true,
        });
        yield* until(() => settled.some((each) => each.id === LINE_ID));

        assert.deepEqual(settled, [
          { id: LINE_ID, exitCode: 1, refusal: DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY },
        ]);
        assert.equal(
          spawned.some((each) => each.program === VM_RUNNER),
          false,
        );
        assert.deepEqual(reported, [
          "a local agent that ran directly on this Mac was not started, since every agent here runs in a VM now",
        ]);
      }),
    ),
);

it.effect(
  "a host, whose agents never ran directly on it, starts an agent whose checkout already stands in its VM",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { spawned, settled } = yield* followingDevice(() => Effect.void, {
          madeBare: true,
          formerlyDirect: false,
        });
        yield* until(() => spawned.some((each) => each.program === VM_RUNNER));

        assert.equal(settled.length, 0);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* until(() => settled.some((each) => each.id === LINE_ID));
      }),
    ),
);

it.effect(
  "a second follower on the same machine follows nothing while the first holds its lease, and says why",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const files = new Map<string, string>();
        const first = yield* followingDevice(() => Effect.void, { files });
        yield* until(() => first.spawned.some((each) => each.program === VM_RUNNER));
        const second = yield* followingDevice(() => Effect.void, { files });
        yield* until(() => second.reported.length > 0);
        yield* TestClock.adjust(Duration.seconds(30));

        assert.deepEqual(second.registered, []);
        assert.deepEqual(second.spawned, []);
        assert.deepEqual(second.reported, [
          "another follower runs this machine's local agents, so this one follows none",
        ]);
      }),
    ),
);
