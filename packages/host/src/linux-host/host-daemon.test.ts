import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { DEVICE_AGENT_LINE_KIND, DEVICE_ARCH } from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { jsonResponse, type RecordedRequest, recordingHttpClient } from "@luke/wire/testing";
import { ConfigProvider, Duration, Effect, Fiber, Layer, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import { Environment, reporterLayer } from "../effect/seams.js";
import { scriptedSpawner } from "../testing/scripted-spawner.js";
import { hostDaemon } from "./host-daemon.js";
import { enrollHostDevice, readHostDevice } from "./host-device.js";
import { linuxPlatform } from "./linux-platform.js";

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

/** Every request the fake saw at the path given. */
const at = (requests: readonly RecordedRequest[], method: string, path: string) =>
  requests.filter((request) => request.method === method && request.pathname === path);

/** Yields until `done` holds, so the daemon's fibers and its file writes, which wait on no clock, run. */
const settled = (done: () => boolean) =>
  Effect.yieldNow.pipe(
    Effect.repeat({ until: done, times: 20_000 }),
    Effect.andThen(Effect.sync(() => expect(done()).toBe(true))),
  );

/** A box's state root, its home with an agent folder in it, and the tools the follower would fetch, each a file standing. */
const box = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* temporaryDirectoryScoped("luke-host-daemon-");
  const tool = (name: string) =>
    Effect.as(fileSystem.writeFileString(`${root}/${name}`, ""), `${root}/${name}`);
  return {
    home: `${root}/home`,
    stateRoot: `${root}/state`,
    node: yield* tool("node"),
    claude: yield* tool("claude"),
    codex: yield* tool("codex"),
  };
});

/** Whether a spawn is the runner, started in its agent's VM. */
const isRunner = (each: { readonly program: string; readonly args: readonly string[] }) =>
  each.program === SMOLVM && each.args.includes(RUNNER_BUNDLE);

/** The daemon's world: its home and shell, a spawner whose login shell answers a PATH, whose smolvm does as asked and whose runners run, and the reports it makes. */
const world = (home: string, reports: string[]) => {
  const spawner = scriptedSpawner((program, args) => {
    if (program === "/bin/bash" && args[0] === "-l")
      return { stdout: "/usr/bin:/bin", exitCode: 0 };
    if (program !== SMOLVM) return undefined;
    return isRunner({ program, args }) ? {} : { exitCode: 0 };
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
    "enrolls on its install token under an id it keeps, readable by its user alone, and keeps that enrollment where the box is still enrolled",
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
          arch: DEVICE_ARCH.X64,
          version: VERSION,
        }).pipe(Effect.provide(http.layer));

        expect((yield* enroll).outcome).toBe("enrolled");
        expect((yield* enroll).outcome).toBe("still-enrolled");

        const [first, second] = http.requests;
        expect(first?.pathname).toBe(HOSTED_SERVICE_PATH.DEVICE_AGENT_ENROLL);
        expect(first?.authorization).toBe(`Bearer ${INSTALL_TOKEN}`);
        expect(first?.headers.get(HOST_WIRE.VERSION_HEADER)).toBe(VERSION);
        const firstBody = JSON.parse(first?.body ?? "{}");
        expect(firstBody).toMatchObject({ name: "fra-01", platform: "linux", arch: "x64" });
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

  it.effect(
    "registers on its device secret with its version on every call, hands a launch to its launcher with the claim's secrets, and stops its runner and ends once Luke refuses its secret",
    () =>
      Effect.gen(function* () {
        const tools = yield* box;
        const reports: string[] = [];
        const { spawner, layer } = world(tools.home, reports);
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
                    checkoutPath: `${tools.home}/.luke/agents/${AGENT_ID}/repository`,
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
        const platform = linuxPlatform({
          installFolder: "/opt/luke-host",
          node: tools.node,
          gh: undefined,
          arch: DEVICE_ARCH.X64,
          hostname: "fra-01",
          stateRoot: tools.stateRoot,
          smolvm: SMOLVM,
          user: { uid: 990, gid: 990 },
          kvm: false,
        });

        const daemon = yield* hostDaemon({
          stateRoot: tools.stateRoot,
          device: { deviceId: DEVICE_ID, deviceSecret: DEVICE_SECRET, serviceOrigin: SERVICE },
          version: VERSION,
          platform: {
            ...platform,
            bundled: { node: tools.node, claude: tools.claude, codex: tools.codex },
          },
        }).pipe(Effect.provide(Layer.merge(layer, http.layer)), Effect.forkScoped);
        yield* settled(() => spawner.spawned.some(isRunner));

        const [register] = at(http.requests, "POST", HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES);
        expect(JSON.parse(register?.body ?? "{}")).toMatchObject({
          deviceId: DEVICE_ID,
          name: "fra-01",
          platform: "linux",
          arch: "x64",
          home: tools.home,
          signedIn: { claudeCode: false, codex: false },
        });
        expect(new Set(http.requests.map((request) => request.authorization))).toEqual(
          new Set([`Bearer ${DEVICE_SECRET}`]),
        );
        expect(
          new Set(http.requests.map((request) => request.headers.get(HOST_WIRE.VERSION_HEADER))),
        ).toEqual(new Set([VERSION]));
        const launched = spawner.spawned.filter(isRunner);
        expect(launched).toHaveLength(1);
        const [runner] = launched;
        const folder = `${tools.home}/.luke/agents/${AGENT_ID}`;
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
        const tools = yield* box;
        const reports: string[] = [];
        const { layer } = world(tools.home, reports);
        const http = recordingHttpClient(() =>
          jsonResponse(
            { error: "host-upgrade-needed", minimumVersion: "0.2.0" },
            HTTP.UPGRADE_REQUIRED,
          ),
        );
        const platform = linuxPlatform({
          installFolder: "/opt/luke-host",
          node: tools.node,
          gh: undefined,
          arch: DEVICE_ARCH.X64,
          hostname: "fra-01",
          stateRoot: tools.stateRoot,
          smolvm: SMOLVM,
          user: { uid: 990, gid: 990 },
          kvm: false,
        });
        const registers = () =>
          at(http.requests, "POST", HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES).length;

        yield* hostDaemon({
          stateRoot: tools.stateRoot,
          device: { deviceId: DEVICE_ID, deviceSecret: DEVICE_SECRET, serviceOrigin: SERVICE },
          version: VERSION,
          platform: {
            ...platform,
            bundled: { node: tools.node, claude: tools.claude, codex: tools.codex },
          },
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
