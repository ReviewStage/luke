/**
 * local-agent-lines.test.ts -- the follower as a device sees its lines: a discard line takes the agent's folder off the disk, unless the platform's check finds work in it, a line of a kind it does not know is settled without holding back the lines after it, and a launch's runner ending saves the agent's state, packed in its VM before the VM goes and committed once uploaded, its bundle kept and tried again where the upload fails, and a pack over its cap refused in plain words.
 *
 * The follower runs over the real client, its held read and claims answered
 * by a scripted service, so an answer is decoded as the wire decodes it; on
 * a real temporary folder, so what a line leaves on the disk is what the
 * test reads; and over a scripted spawner, on the test's clock. Each test
 * waits for the service to take a line's settle, never on the clock, since
 * nothing on the way there sleeps and the disk answers in its own time,
 * but for the save tried again on a later beat, which moves the clock. A
 * save's pack is written by the scripted VM, sealed by the device's own
 * seal, and opened by the test with `node:crypto` alone. Synthetic ids,
 * keys and bytes throughout.
 */

import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
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
import { ConfigProvider, Deferred, Duration, Effect, Exit, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import { composeLocalAgents } from "./compose-local-agents.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import { type AgentSave, readLocalAgentState } from "./local-agent-state.js";
import { sealAgentState } from "./node/agent-state-seal.js";
import { fakeSandbox, VM_EXEC } from "./testing/fake-sandbox.js";
import { type Script, scriptedSpawner } from "./testing/scripted-spawner.js";

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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A fetch that never answers, as a held read the service holds past the test. */
const held = () => new Promise<Response>(() => {});

/**
 * The follower on a device whose agent's folder holds a file, the agent in
 * the device's record of the agents it made as its launch left it, its held
 * read answered once with the lines given and every line claimable, with the
 * folder, the record's file for the agent, the line ids it settled, and what
 * waits for the service to take the discard's settle. Where `vmLeft` says,
 * the device is a host, whose agent runs in a VM smolvm will not delete.
 */
const following = (lines: readonly DeviceAgentLine[], unsavedWork?: Script, vmLeft = false) =>
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
      // Note that the agent's folder stands from before the record of how agents ran, so on This Mac it ran directly and is checked on the Mac.
      Layer.succeed(LocalAgentPlatform, {
        launch: () => ({ command: "/opt/luke/launch", args: [], env: {} }),
        sandbox: vmLeft
          ? { ...fakeSandbox().sandbox, deleted: () => Effect.succeed(false) }
          : fakeSandbox().sandbox,
        formerlyDirect: !vmLeft,
        runnerBundle: "/opt/luke/agent-runner.mjs",
        runnerEnv: {},
        deviceName: "Studio",
        devicePlatform: DEVICE_PLATFORM.DARWIN,
        deviceArch: DEVICE_ARCH.ARM64,
        deviceIsolation: DEVICE_ISOLATION.SANDBOX,
        deviceCapabilities: [],
        worktreeScript: () => "exit 0",
        unsavedWorkScript: unsavedWork === undefined ? undefined : () => UNSAVED_WORK_SCRIPT,
        stateSealed: () => Effect.die("this device saves no state"),
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

it.effect(
  "a discard whose VM smolvm would not delete removes the folder but keeps the agent in the device's record, so an uninstall deletes the VM yet",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { folder, owned, settled, discardSettled } = yield* following(
          [DISCARD],
          undefined,
          true,
        );
        yield* discardSettled;

        const fileSystem = yield* FileSystem.FileSystem;
        assert.equal(yield* fileSystem.exists(folder), false);
        assert.equal(yield* fileSystem.exists(owned), true);
        assert.deepEqual(settled, [DISCARD.id]);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

const LAUNCH: DeviceAgentLine = {
  id: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d",
  agentId: AGENT_ID,
  seq: 1,
  kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
  payload: {},
};
/** The agent's state key as the service answers it: 32 bytes, in standard base64. */
const STATE_KEY = Buffer.alloc(32, 7).toString("base64");
/** What the scripted VM's pack writes, standing in for a pack's bytes. */
const PACK_BYTES = "a pack of the agent's state\n";
/** The base the scripted VM's pack names. */
const BASE = "1".repeat(40);
const OVER_CAP =
  "the agent's state holds 612.0 MB, over the 500.0 MB a pack may hold. Its largest parts: home/.claude/projects (600.0 MB).";

/** The bundle's bytes opened as a restore opens them: a version byte, a 12-byte nonce, the pack, and a 16-byte tag. */
function opened(bundle: Uint8Array): string {
  const bytes = Buffer.from(bundle);
  assert.equal(bytes[0], 1);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(STATE_KEY, "base64"),
    bytes.subarray(1, 13),
  );
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return Buffer.concat([
    decipher.update(bytes.subarray(13, bytes.length - 16)),
    decipher.final(),
  ]).toString();
}

/**
 * The follower on a host that saves its agents' state, one launch line
 * handed once unless `launches` says none, whose runner ends at once: its
 * VM's pack writes the pack and names its base, or answers as the script
 * given, and its verify passes; the store refuses as many uploads as
 * `uploadsRefused` says before it takes one. The device's state holds the
 * agent's record given from before, and a bundle of the agent's with no
 * record naming it where `strayBundle` says, as a run that could not write
 * its record leaves one. With what happened in order (the VM's state
 * commands, its delete, the uploads and the commits), the bodies the
 * service took, the bytes the store took, the folder, the device's record
 * of the agent's saves, what waits for the launch's settle and for the
 * device's first beat, and whether the device has said a save landed,
 * which it says once it has recorded it.
 */
const saving = (
  options: {
    readonly pack?: Script;
    readonly uploadsRefused?: number;
    readonly launches?: false;
    readonly record?: AgentSave;
    readonly strayBundle?: true;
  } = {},
) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped("luke-agent-saves-");
    const home = path.join(root, "home");
    const stateRoot = path.join(root, "state");
    const bundle = path.join(stateRoot, "agent-state", AGENT_ID);
    const layout = deviceAgentLayout(home, AGENT_ID);
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(path.dirname(bundle), { recursive: true });
    if (options.record !== undefined) {
      const saves = { [AGENT_ID]: options.record };
      const state = JSON.stringify({ devices: {}, launches: [], saves });
      yield* fileSystem.writeFileString(path.join(stateRoot, "local-agents.json"), state);
    }
    if (options.strayBundle === true) yield* fileSystem.writeFileString(bundle, "sealed");
    const happened: string[] = [];
    const saves: unknown[] = [];
    const commits: unknown[] = [];
    const uploads: Uint8Array[] = [];
    const reported: string[] = [];
    const launchSettled = Deferred.makeUnsafe<void>();
    const beaten = Deferred.makeUnsafe<void>();
    let refusing = options.uploadsRefused ?? 0;
    let linesRead = 0;
    const fetchLike = async (url: string | URL | Request, init?: RequestInit) => {
      const { host, pathname } = new URL(String(url));
      if (host === "store.test") {
        uploads.push(new Uint8Array(await new Response(init?.body).arrayBuffer()));
        happened.push("upload");
        return new Response(null, { status: refusing-- > 0 ? 500 : 200 });
      }
      const body = init?.body === undefined ? {} : JSON.parse(String(init.body));
      switch (pathname) {
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES:
          return json({ done: true });
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE:
          Deferred.doneUnsafe(beaten, Exit.void);
          return json({ done: true });
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_LINE_CLAIM:
          return json({
            line: {
              ...LAUNCH,
              payload: {
                checkoutPath: layout.checkoutPath,
                repository: null,
                startBranch: null,
                firstSequence: 0,
              },
            },
            secrets: { env: { LUKE_RUNNER_TOKEN: "runner-secret" }, stdin: "{}\n" },
          });
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_LINES:
          if (init?.method === "POST") {
            if (body.id === LAUNCH.id) Deferred.doneUnsafe(launchSettled, Exit.void);
            return json({ done: true });
          }
          return linesRead++ === 0
            ? json({ lines: options.launches === false ? [] : [LAUNCH] })
            : held();
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_STATE_SAVE:
          saves.push(body);
          return json({
            path: `agent-state/${AGENT_ID}/grant-${saves.length}`,
            upload: {
              url: `https://store.test/upload/${saves.length}`,
              headers: { "x-api-version": "13" },
              expiresAt: Date.UTC(2026, 9, 29, 21),
              maxBytes: 500 * 1024 * 1024,
            },
            key: STATE_KEY,
          });
        case HOSTED_SERVICE_PATH.DEVICE_AGENT_STATE_COMMIT:
          happened.push("commit");
          commits.push(body);
          return json({ generation: commits.length });
        default:
          return held();
      }
    };
    const pack = path.join(layout.temp, "state.pack");
    const spawner = scriptedSpawner((program, args) => {
      if (program === "/bin/bash" && args[0] === "-l") {
        return { stdout: "/usr/bin:/bin", exitCode: 0 };
      }
      if (program === "/opt/luke/launch") return { exitCode: 0 };
      if (program !== VM_EXEC) return undefined;
      const action = args[3];
      if (action !== undefined) happened.push(action);
      if (action !== "pack") return { exitCode: 0 };
      return (
        options.pack ?? {
          stdout: `agent-runner state pack: wrote 28 bytes\nagent-runner state pack: base ${BASE}\n`,
          exitCode: 0,
          until: Effect.sync(() => writeFileSync(pack, PACK_BYTES)),
        }
      );
    });
    const vm = fakeSandbox();
    const services = Layer.mergeAll(
      spawner.layer,
      NodePath.layer,
      NodeFileSystem.layer,
      fakeHttpClientLayer(fetchLike),
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord({ HOME: home, SHELL: "/bin/bash" })),
      Layer.succeed(Reporter, { report: (line) => reported.push(line) }),
      Layer.succeed(LocalAgentPlatform, {
        launch: () => ({ command: "/opt/luke/launch", args: [], env: {} }),
        sandbox: {
          ...vm.sandbox,
          deleted: (agentId) =>
            Effect.andThen(
              Effect.sync(() => happened.push("deleted")),
              vm.sandbox.deleted(agentId),
            ),
        },
        formerlyDirect: false,
        runnerBundle: "/opt/luke/agent-runner.mjs",
        runnerEnv: {},
        deviceName: "rack-1",
        devicePlatform: DEVICE_PLATFORM.LINUX,
        deviceArch: DEVICE_ARCH.X64,
        deviceIsolation: DEVICE_ISOLATION.SANDBOX,
        deviceCapabilities: [DEVICE_CAPABILITY.DISCARD, DEVICE_CAPABILITY.AGENT_STATE],
        worktreeScript: () => "exit 0",
        stateSealed: sealAgentState,
      }),
    );
    const composer = yield* composeLocalAgents({
      kernel: { stateRoot, createId: () => DEVICE_ID, runMode: { sendsNetwork: true } },
      account: { capabilitiesActive: () => true },
      accountId: () => DEVICE_ID,
      deviceId: DEVICE_ID,
      switchedOn: Effect.succeed(true),
      client: new HostedDeviceAgentClient({
        credential: fixedBearer("device-token"),
        serviceBaseUrl: SERVICE,
      }),
    }).pipe(Effect.provide(services));
    yield* composer.lifetime;
    const saveRecord = Effect.map(
      readLocalAgentState(stateRoot).pipe(Effect.provide(services)),
      (state) => state.saves?.[AGENT_ID],
    );
    return {
      happened,
      saves,
      commits,
      uploads,
      layout,
      bundle,
      saveRecord,
      launchSettled: Deferred.await(launchSettled),
      beaten: Deferred.await(beaten),
      saved: () => reported.some((line) => line.includes("saved as generation")),
    };
  });

it.effect(
  "a runner's end packs and verifies the agent's state in its VM before the VM is deleted, then uploads it sealed under the agent's key and commits it, recording the generation",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { happened, saves, commits, uploads, bundle, saveRecord, launchSettled } =
          yield* saving();
        yield* launchSettled;

        assert.deepEqual(happened, ["pack", "verify", "deleted", "upload", "commit"]);
        assert.deepEqual(saves, [{ deviceId: DEVICE_ID, agentId: AGENT_ID, fromGeneration: null }]);
        const [uploaded] = uploads;
        assert.ok(uploaded !== undefined);
        assert.equal(opened(uploaded), PACK_BYTES);
        assert.deepEqual(commits, [
          {
            deviceId: DEVICE_ID,
            agentId: AGENT_ID,
            fromGeneration: null,
            path: `agent-state/${AGENT_ID}/grant-1`,
            bytes: uploaded.length,
            sha256: createHash("sha256").update(uploaded).digest("hex"),
            baseCommit: BASE,
          },
        ]);
        assert.deepEqual(yield* saveRecord, { userId: DEVICE_ID, generation: 1 });
        const fileSystem = yield* FileSystem.FileSystem;
        assert.equal(yield* fileSystem.exists(bundle), false, "the committed bundle is still kept");
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a save whose upload fails keeps the folder and its sealed bundle outside it, and a later beat uploads it again and commits it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { happened, uploads, layout, bundle, saveRecord, launchSettled, saved } =
          yield* saving({ uploadsRefused: 1 });
        yield* launchSettled;

        const fileSystem = yield* FileSystem.FileSystem;
        assert.deepEqual(happened, ["pack", "verify", "deleted", "upload"]);
        assert.equal(yield* fileSystem.exists(layout.folder), true);
        assert.equal(yield* fileSystem.exists(bundle), true, "the sealed bundle is not kept");
        assert.ok(!bundle.startsWith(`${layout.folder}/`));
        const waiting = yield* saveRecord;
        assert.equal(waiting?.generation, undefined);
        assert.equal(waiting?.pending?.bytes, uploads[0]?.length);

        // Note that the bundle is tried again a minute after the failed upload, on the beat after.
        for (let round = 0; round < 40 && !saved(); round += 1) {
          yield* TestClock.adjust(Duration.seconds(5));
          yield* Effect.yieldNow.pipe(Effect.repeat({ times: 500, until: saved }));
        }
        assert.ok(saved(), "the bundle was never committed");

        assert.deepEqual(happened, ["pack", "verify", "deleted", "upload", "upload", "commit"]);
        assert.deepEqual(uploads[1], uploads[0]);
        assert.deepEqual(yield* saveRecord, { userId: DEVICE_ID, generation: 1 });
        assert.equal(yield* fileSystem.exists(bundle), false);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a pack over its cap is refused in the pack's own words, kept in the agent's record, the folder kept and nothing uploaded",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { happened, saves, layout, saveRecord, launchSettled } = yield* saving({
          pack: { stderr: `agent-runner state: ${OVER_CAP}\n`, exitCode: 3 },
        });
        yield* launchSettled;

        const fileSystem = yield* FileSystem.FileSystem;
        assert.deepEqual(happened, ["pack", "deleted"]);
        assert.deepEqual(saves, []);
        assert.equal(yield* fileSystem.exists(layout.folder), true);
        assert.deepEqual(yield* saveRecord, { userId: DEVICE_ID, unsaved: { why: OVER_CAP } });
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a launch naming no saved state, Luke's having expired, starts the agent's next save afresh rather than from the generation it last recorded",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { saves, saveRecord, launchSettled } = yield* saving({
          record: { userId: DEVICE_ID, generation: 4 },
        });
        yield* launchSettled;

        assert.deepEqual(saves, [{ deviceId: DEVICE_ID, agentId: AGENT_ID, fromGeneration: null }]);
        assert.deepEqual(yield* saveRecord, { userId: DEVICE_ID, generation: 1 });
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a bundle no record names, as a run that could not write its record leaves, is let go of as the gate opens and its agent recorded as unsaved",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bundle, saveRecord, beaten } = yield* saving({
          launches: false,
          record: { userId: DEVICE_ID, generation: 2 },
          strayBundle: true,
        });
        yield* beaten;

        const fileSystem = yield* FileSystem.FileSystem;
        assert.equal(yield* fileSystem.exists(bundle), false);
        assert.deepEqual(yield* saveRecord, { userId: DEVICE_ID, generation: 2, unsaved: {} });
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);
