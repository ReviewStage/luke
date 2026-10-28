import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { SMOLVM_MAC_PIN } from "@luke/agent-runner/pins";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { DEVICE_AGENT_LINE_KIND, DEVICE_ARCH } from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { jsonResponse, type RecordedRequest, recordingHttpClient } from "@luke/wire/testing";
import { ConfigProvider, Duration, Effect, Fiber, Layer, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import { Environment, reporterLayer } from "../effect/seams.js";
import { readHostDevice } from "../host-device-record.js";
import { scriptedSpawner } from "../testing/scripted-spawner.js";
import { hostDaemon } from "./host-daemon.js";
import { enrollHostDevice } from "./host-device.js";
import { DARWIN_HOST, type HostOs, hostRuntime, LINUX_HOST } from "./host-os.js";
import { hostPlatform } from "./host-platform.js";

const SERVICE = "https://luke.test";
const VERSION = "0.1.0";
const DEVICE_ID = "6bbcb1b9-6706-4c97-9197-374756ceee07";
const AGENT_ID = "0b6f9a4e-1c1d-4d2e-9f3a-5b7c8d9e0f12";
const LINE_ID = "d1c2b3a4-0000-4000-8000-000000000001";
const INSTALL_TOKEN = `lkh_${"b".repeat(40)}`;
const DEVICE_SECRET = `lkd_${"a".repeat(43)}`;
const RUNNER_TOKEN = "sk-ant-oat01-fixture-not-a-real-token";
const SMOLVM = "/usr/local/bin/smolvm";
const RUNNER_BUNDLE = "/opt/luke-host/lib/agent-runner.mjs";
const HTTP = {
  OK: 200,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  UPGRADE_REQUIRED: 426,
  SERVER_ERROR: 500,
} as const;

/** A Linux box named fra-01, with no `/dev/kvm`. */
const FRA_01: HostOs = { ...LINUX_HOST, deviceName: () => "fra-01", nested: () => false };

/** A box's platform on the OS given, as its daemon builds it. */
const platformOn = (os: HostOs, stateRoot: string) =>
  hostPlatform({
    os,
    installFolder: "/opt/luke-host",
    arch: DEVICE_ARCH.X64,
    stateRoot,
    smolvm: SMOLVM,
    user: { uid: 990, gid: 990 },
  });

/** Every request the fake saw at the path given. */
const at = (requests: readonly RecordedRequest[], method: string, path: string) =>
  requests.filter((request) => request.method === method && request.pathname === path);

/** Yields until `done` holds, so the daemon's fibers and its file writes, which wait on no clock, run. */
const settled = (done: () => boolean) =>
  Effect.yieldNow.pipe(
    Effect.repeat({ until: done, times: 20_000 }),
    Effect.andThen(Effect.sync(() => expect(done()).toBe(true))),
  );

/** A box's state root and its home, under a folder of its own. */
const box = Effect.gen(function* () {
  const root = yield* temporaryDirectoryScoped("luke-host-daemon-");
  return { home: `${root}/home`, stateRoot: `${root}/state` };
});

/** Whether a spawn is the runner, started in its agent's VM. */
const isRunner = (each: { readonly program: string; readonly args: readonly string[] }) =>
  each.program === SMOLVM && each.args.includes(RUNNER_BUNDLE);

/** What smolvm prints for a machine it has not made. */
const NOT_FOUND = JSON.stringify({ error: { code: "NOT_FOUND", message: "machine not found" } });

/** The daemon's world: its home and shell, a spawner whose login shell answers a PATH, whose smolvm makes each machine the first time it is started and whose runners run, and the reports it makes. */
const world = (home: string, reports: string[]) => {
  const made = new Set<string>();
  const spawner = scriptedSpawner((program, args) => {
    if (program === "/bin/bash" && args[0] === "-l")
      return { stdout: "/usr/bin:/bin", exitCode: 0 };
    if (program !== SMOLVM) return undefined;
    if (isRunner({ program, args })) return {};
    const [, verb, , machine = ""] = args;
    if (verb === "create") made.add(machine);
    if (verb === "start" && !made.has(machine)) return { stderr: NOT_FOUND, exitCode: 1 };
    return { exitCode: 0 };
  });
  const layer = Layer.mergeAll(
    NodeFileSystem.layer,
    NodePath.layer,
    spawner.layer,
    reporterLayer((line) => reports.push(line)),
    Layer.succeed(Environment, ConfigProvider.fromUnknown({ HOME: home, SHELL: "/bin/bash" })),
  );
  return { spawner, layer };
};

describe("a host's daemon", () => {
  it.effect(
    "enrolls on its install token as its OS, under an id it keeps, readable by its user alone, and keeps that enrollment where the box is still enrolled",
    () =>
      Effect.gen(function* () {
        const { stateRoot } = yield* box;
        const fileSystem = yield* FileSystem.FileSystem;
        let enrolled = false;
        const http = recordingHttpClient(() => {
          if (enrolled) return jsonResponse({ error: "host-still-enrolled" }, HTTP.CONFLICT);
          enrolled = true;
          return jsonResponse({ deviceId: DEVICE_ID, deviceSecret: DEVICE_SECRET });
        });
        const enroll = enrollHostDevice({
          stateRoot,
          serviceOrigin: SERVICE,
          installToken: INSTALL_TOKEN,
          name: "fra-01",
          platform: DARWIN_HOST.platform,
          arch: DEVICE_ARCH.ARM64,
          version: VERSION,
        }).pipe(Effect.provide(http.layer));

        expect((yield* enroll).outcome).toBe("enrolled");
        expect((yield* enroll).outcome).toBe("still-enrolled");

        const [first, second] = http.requests;
        expect(first?.pathname).toBe(HOSTED_SERVICE_PATH.DEVICE_AGENT_ENROLL);
        expect(first?.authorization).toBe(`Bearer ${INSTALL_TOKEN}`);
        expect(first?.headers.get(HOST_WIRE.VERSION_HEADER)).toBe(VERSION);
        const firstBody = JSON.parse(first?.body ?? "{}");
        expect(firstBody).toMatchObject({ name: "fra-01", platform: "darwin", arch: "arm64" });
        expect(JSON.parse(second?.body ?? "{}").deviceId).toBe(firstBody.deviceId);
        expect(Option.getOrUndefined(yield* readHostDevice(stateRoot))).toEqual({
          deviceId: firstBody.deviceId,
          deviceSecret: DEVICE_SECRET,
          serviceOrigin: SERVICE,
        });
        expect(
          ((yield* fileSystem.stat(`${stateRoot}/device.json`)).mode & 0o777).toString(8),
        ).toBe("600");
        expect(((yield* fileSystem.stat(stateRoot)).mode & 0o777).toString(8)).toBe("700");
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect.each([
    {
      os: { ...LINUX_HOST, deviceName: () => "fra-01", nested: () => true },
      name: "fra-01",
      platform: "linux",
      nested: true,
    },
    {
      os: { ...DARWIN_HOST, deviceName: () => "Studio" },
      name: "Studio",
      platform: "darwin",
      nested: false,
    },
  ])(
    "registers as its OS ($platform) on its device secret with its version on every call, hands a launch to its VM, nested where its OS allows, with the claim's secrets, and stops its runner and ends once Luke refuses its secret",
    ({ os, name, platform: devicePlatform, nested }) =>
      Effect.gen(function* () {
        const { home, stateRoot } = yield* box;
        const reports: string[] = [];
        const { spawner, layer } = world(home, reports);
        let linesRead = 0;
        let removed = false;
        const http = recordingHttpClient((request) => {
          if (removed) return jsonResponse({ error: "invalid-token" }, HTTP.UNAUTHORIZED);
          switch (`${request.method} ${request.pathname}`) {
            case `GET ${HOSTED_SERVICE_PATH.DEVICE_AGENT_LINES}`:
              linesRead += 1;
              return linesRead > 1
                ? jsonResponse({}, HTTP.SERVER_ERROR)
                : jsonResponse({
                    lines: [
                      {
                        id: LINE_ID,
                        agentId: AGENT_ID,
                        seq: 1,
                        kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
                        payload: {},
                      },
                    ],
                  });
            case `POST ${HOSTED_SERVICE_PATH.DEVICE_AGENT_LINE_CLAIM}`:
              return jsonResponse({
                line: {
                  id: LINE_ID,
                  agentId: AGENT_ID,
                  seq: 1,
                  kind: DEVICE_AGENT_LINE_KIND.LAUNCH,
                  payload: {
                    checkoutPath: `${home}/.luke/agents/${AGENT_ID}/repository`,
                    repository: null,
                    startBranch: null,
                    firstSequence: 1,
                  },
                },
                secrets: { env: { CLAUDE_CODE_OAUTH_TOKEN: RUNNER_TOKEN }, stdin: "{}\n" },
              });
            case `GET ${HOSTED_SERVICE_PATH.DEVICE_AGENT_REQUESTS}`:
              return jsonResponse({}, HTTP.SERVER_ERROR);
            default:
              return jsonResponse({ done: true });
          }
        });
        const platform = platformOn(os, stateRoot);

        const daemon = yield* hostDaemon({
          stateRoot,
          device: { deviceId: DEVICE_ID, deviceSecret: DEVICE_SECRET, serviceOrigin: SERVICE },
          version: VERSION,
          platform,
        }).pipe(Effect.provide(Layer.merge(layer, http.layer)), Effect.forkScoped);
        yield* settled(() => spawner.spawned.some(isRunner));

        const [register] = at(http.requests, "POST", HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES);
        expect(JSON.parse(register?.body ?? "{}")).toMatchObject({
          deviceId: DEVICE_ID,
          name,
          platform: devicePlatform,
          arch: "x64",
          home: home,
          signedIn: { claudeCode: false, codex: false },
        });
        expect(new Set(http.requests.map((request) => request.authorization))).toEqual(
          new Set([`Bearer ${DEVICE_SECRET}`]),
        );
        expect(
          new Set(http.requests.map((request) => request.headers.get(HOST_WIRE.VERSION_HEADER))),
        ).toEqual(new Set([VERSION]));
        const created = spawner.spawned.find(
          (each) => each.program === SMOLVM && each.args[1] === "create",
        );
        expect(created?.args.includes("--nested")).toBe(nested);
        const launched = spawner.spawned.filter(isRunner);
        expect(launched).toHaveLength(1);
        const [runner] = launched;
        const folder = `${home}/.luke/agents/${AGENT_ID}`;
        expect(runner?.args.slice(0, 4)).toEqual(["machine", "exec", "--name", `luke-${AGENT_ID}`]);
        expect(runner?.args).toContain(`${folder}/repository`);
        expect(runner?.args).toContain(`HOME=${folder}/home`);
        expect(runner?.env).toMatchObject({
          CLAUDE_CODE_OAUTH_TOKEN: RUNNER_TOKEN,
          LUKE_RUNNER_PLACE: "host",
        });
        expect(reports).toContain("Luke host: Connected to Luke.");

        removed = true;
        yield* TestClock.adjust(Duration.seconds(20));
        // Note that the runner, which never exits here, is signalled in its VM and given its grace before it is ended.
        yield* settled(() => spawner.spawned.some((each) => each.args.includes("-e")));
        yield* TestClock.adjust(Duration.seconds(5));
        yield* Fiber.join(daemon);
        expect(runner?.ended).not.toBe("running");
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect(
    "refused as needing an upgrade, says so once with the command to run and asks Luke nothing until its quiet spell has passed",
    () =>
      Effect.gen(function* () {
        const { home, stateRoot } = yield* box;
        const reports: string[] = [];
        const { layer } = world(home, reports);
        const http = recordingHttpClient(() =>
          jsonResponse(
            { error: "host-upgrade-needed", minimumVersion: "0.2.0" },
            HTTP.UPGRADE_REQUIRED,
          ),
        );
        const platform = platformOn(FRA_01, stateRoot);
        const registers = () =>
          at(http.requests, "POST", HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES).length;

        yield* hostDaemon({
          stateRoot,
          device: { deviceId: DEVICE_ID, deviceSecret: DEVICE_SECRET, serviceOrigin: SERVICE },
          version: VERSION,
          platform,
        }).pipe(Effect.provide(Layer.merge(layer, http.layer)), Effect.forkScoped);
        yield* settled(() => registers() === 1);
        yield* TestClock.adjust(Duration.minutes(4));
        yield* settled(() => true);
        expect(registers()).toBe(1);
        yield* TestClock.adjust(Duration.minutes(2));
        yield* settled(() => registers() === 2);

        const upgrade = reports.filter((line) => line.includes("upgrade needed"));
        expect(upgrade).toEqual([
          `Luke host: upgrade needed: Luke no longer accepts this version. Rerun the install command to upgrade in place: curl -fsSL ${SERVICE}/install.sh | sudo sh`,
        ]);
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );
});

describe("hostRuntime", () => {
  it.each([
    {
      platform: "darwin",
      home: "/Users/ada",
      os: DARWIN_HOST,
      stateRoot: "/Users/ada/Library/Application Support/Luke",
      smolvm: { kind: "pin", pin: SMOLVM_MAC_PIN },
    },
    {
      platform: "linux",
      home: "/var/lib/luke-host",
      os: LINUX_HOST,
      stateRoot: "/var/lib/luke-host/state",
      smolvm: { kind: "path", variable: "LUKE_HOST_SMOLVM" },
    },
  ])(
    "runs $platform as its own OS, with its state where its app or service keeps it and its smolvm from where that OS takes it",
    ({ platform, home, os, stateRoot, smolvm }) => {
      const runtime = hostRuntime({ platform, home, app: { developerIdSigned: true } });
      expect(runtime?.os).toBe(os);
      expect(runtime?.stateRoot).toBe(stateRoot);
      expect(runtime?.os.smolvm).toEqual(smolvm);
    },
  );
});
