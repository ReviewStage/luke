/**
 * local-agent-lines.test.ts -- the follower as a device sees its lines: a discard line takes the agent's folder off the disk, and a line of a kind it does not know is settled without holding back the lines after it.
 *
 * The follower runs over the real client, its held read and claims answered
 * by a scripted service, so an answer is decoded as the wire decodes it; on
 * a real temporary folder, so what a line leaves on the disk is what the
 * test reads; and over a scripted spawner, on the test's clock. Synthetic
 * ids throughout.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { fixedBearer, HOSTED_SERVICE_PATH, HostedDeviceAgentClient } from "@luke/features";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ARCH,
  DEVICE_ISOLATION,
  DEVICE_PLATFORM,
  type DeviceAgentLine,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { ConfigProvider, Duration, Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import { composeLocalAgents } from "./compose-local-agents.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A fetch that never answers, as a held read the service holds past the test. */
const held = () => new Promise<Response>(() => {});

/**
 * The follower on a device whose agent's folder holds a file, its held read
 * answered once with the lines given and every line claimable, with the
 * folder and the line ids it settled.
 */
const following = (lines: readonly DeviceAgentLine[]) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-agent-lines-");
    const home = path.join(root, "home");
    const tools = { node: path.join(root, "node"), claude: path.join(root, "claude") };
    const fileSystem = yield* FileSystem.FileSystem;
    const folder = deviceAgentLayout(home, AGENT_ID).folder;
    yield* fileSystem.makeDirectory(path.join(folder, "repository"), { recursive: true });
    yield* fileSystem.writeFileString(path.join(folder, "repository", "notes.md"), "unpushed\n");
    yield* fileSystem.writeFileString(tools.node, "");
    yield* fileSystem.writeFileString(tools.claude, "");

    const settled: string[] = [];
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
      return program === tools.claude ? { exitCode: 1 } : undefined;
    });
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      NodeFileSystem.layer,
      fakeHttpClientLayer(fetchLike),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME: home, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: () => {} }),
      Layer.succeed(LocalAgentPlatform, {
        launch: () => ({ command: "/opt/luke/launch", args: [], env: {} }),
        runnerBundle: "/opt/luke/agent-runner.mjs",
        runnerEnv: {},
        bundled: tools,
        deviceName: "rack-1",
        devicePlatform: DEVICE_PLATFORM.LINUX,
        deviceArch: DEVICE_ARCH.X64,
        deviceIsolation: DEVICE_ISOLATION.BARE,
        deviceCapabilities: [],
        worktreeScript: () => "exit 0",
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
    return { folder, settled };
  });

/** The clock nudged until the condition holds, as the follower's fibers run up to their next wait, each round yielding to the disk's real reads too. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 400 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.millis(100));
      yield* Effect.yieldNow;
    }
    assert.ok(holds(), "the follower never got there");
  });

it.effect("a discard line removes the agent's folder from the device and is settled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { folder, settled } = yield* following([DISCARD]);
      yield* until(() => settled.includes(DISCARD.id));

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
        const { folder, settled } = yield* following([NEWER_KIND, DISCARD]);
        yield* until(() => settled.includes(DISCARD.id));

        const fileSystem = yield* FileSystem.FileSystem;
        assert.deepEqual(settled, [NEWER_KIND.id, DISCARD.id]);
        assert.equal(yield* fileSystem.exists(folder), false);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);
