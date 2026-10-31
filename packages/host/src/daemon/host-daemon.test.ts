import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { DEVICE_AGENT_LINE_KIND, DEVICE_ARCH } from "@luke/features/device-agent-wire";
import { HOST_TARGET } from "@luke/features/host-release";
import {
  HOST_PAIRING_POLL_STATUS,
  HOST_WIRE,
  type HostPairingStartAnswer,
} from "@luke/features/host-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import {
  jsonResponse,
  type RecordedRequest,
  type RecordingHttpClient,
  recordingHttpClient,
} from "@luke/wire/testing";
import { ConfigProvider, Duration, Effect, Fiber, Layer, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import { Environment, reporterLayer } from "../effect/seams.js";
import { readHostDevice } from "../host-device-record.js";
import { fakeClis } from "../testing/fake-clis.js";
import { scriptedSpawner } from "../testing/scripted-spawner.js";
import { hostDaemon } from "./host-daemon.js";
import { DARWIN_HOST, type HostOs, hostRuntime, LINUX_HOST } from "./host-os.js";
import { connectHostDevice, HOST_CONNECT_OUTCOME, type HostPairingCode } from "./host-pairing.js";
import { hostPlatform } from "./host-platform.js";

const SERVICE = "https://luke.test";
const VERSION = "0.1.0";
const DEVICE_ID = "6bbcb1b9-6706-4c97-9197-374756ceee07";
const AGENT_ID = "0b6f9a4e-1c1d-4d2e-9f3a-5b7c8d9e0f12";
const LINE_ID = "d1c2b3a4-0000-4000-8000-000000000001";
const DEVICE_SECRET = `lkd_${"a".repeat(43)}`;
const POLL_SECRET = `lkp_${"c".repeat(43)}`;
/** What a pairing's start answers beside its poll secret: the service's own numbers, ten minutes and five seconds. */
const PAIRING_CODE: Omit<HostPairingStartAnswer, "pollSecret"> = {
  userCode: "BCDF-GHJK",
  url: `${SERVICE}/connect/BCDF-GHJK`,
  expiresInMs: 600_000,
  intervalMs: 5_000,
};
/** Where a pairing stands as a poll answers it. */
type HostPairingPollStatus =
  (typeof HOST_PAIRING_POLL_STATUS)[keyof typeof HOST_PAIRING_POLL_STATUS];
const RUNNER_TOKEN = "sk-ant-oat01-fixture-not-a-real-token";
/** A release newer than the daemon's, as a beat's answer names one. */
const NEWER_RELEASE = {
  version: "0.2.0",
  sha256: {
    [HOST_TARGET.LINUX_X64]: "a".repeat(64),
    [HOST_TARGET.LINUX_ARM64]: "b".repeat(64),
    [HOST_TARGET.DARWIN_ARM64]: "c".repeat(64),
  },
};
/** The Node the daemon runs on, which its runners run on too. */
const NODE = "/opt/luke-host/node/bin/node";
/** The runner's bundle each OS runs: a Linux release's own, and on a Mac the app's. */
const RUNNER_BUNDLE = {
  LINUX: "/opt/luke-host/lib/agent-runner.mjs",
  DARWIN: "/opt/agent-runner/agent-runner.mjs",
} as const;
const RUNNER_BUNDLES: ReadonlySet<string> = new Set(Object.values(RUNNER_BUNDLE));
const HTTP = {
  OK: 200,
  UNAUTHORIZED: 401,
  UPGRADE_REQUIRED: 426,
  SERVER_ERROR: 500,
} as const;

/** A Linux box named fra-01. */
const FRA_01: HostOs = { ...LINUX_HOST, deviceName: () => "fra-01" };

/** A box's platform on the OS given, as its daemon builds it, running as the user given. */
const platformOn = (os: HostOs, stateRoot: string, uid = 990) =>
  hostPlatform({
    os,
    installFolder: "/opt/luke-host",
    arch: DEVICE_ARCH.X64,
    stateRoot,
    node: NODE,
    user: { uid, gid: uid },
    clis: fakeClis(),
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

/** Whether a spawn is the runner, started straight on the box on the daemon's own Node. */
const isRunner = (each: { readonly program: string; readonly args: readonly string[] }) =>
  each.program === NODE && each.args.some((arg) => RUNNER_BUNDLES.has(arg));

/** The daemon's world: its home and shell, a spawner whose login shell answers a PATH and whose runners run, and the reports it makes. */
const world = (home: string, reports: string[]) => {
  const spawner = scriptedSpawner((program, args) => {
    if (program === "/bin/bash" && args[0] === "-l")
      return { stdout: "/usr/bin:/bin", exitCode: 0 };
    if (isRunner({ program, args })) return {};
    return undefined;
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
  it.effect.each([
    {
      os: { ...LINUX_HOST, deviceName: () => "fra-01" },
      name: "fra-01",
      platform: "linux",
      uid: 0,
      sandboxed: "1",
      runnerBundle: RUNNER_BUNDLE.LINUX,
    },
    {
      os: { ...DARWIN_HOST, deviceName: () => "Studio" },
      name: "Studio",
      platform: "darwin",
      uid: 501,
      sandboxed: undefined,
      runnerBundle: RUNNER_BUNDLE.DARWIN,
    },
  ])(
    "registers as its OS ($platform) on its device secret with its version on every call, runs a launch straight on the box in its agent's folder on its own Node, telling Claude Code it may skip its permissions as root (uid $uid), with the claim's secrets, takes no notice of a newer release with no releases of an account install to update, and stops its runner's group and ends once Luke refuses its secret",
    ({ os, name, platform: devicePlatform, uid, sandboxed, runnerBundle }) =>
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
            case `POST ${HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE}`:
              return jsonResponse({ done: true, release: NEWER_RELEASE });
            default:
              return jsonResponse({ done: true });
          }
        });
        const platform = platformOn(os, stateRoot, uid);

        const daemon = yield* hostDaemon({
          stateRoot,
          device: { deviceId: DEVICE_ID, deviceSecret: DEVICE_SECRET, serviceOrigin: SERVICE },
          version: VERSION,
          platform,
        }).pipe(Effect.provide(Layer.merge(layer, http.layer)), Effect.forkScoped);
        yield* settled(() => spawner.spawned.some(isRunner));
        yield* settled(
          () => at(http.requests, "POST", HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE).length > 0,
        );

        const [register] = at(http.requests, "POST", HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES);
        expect(JSON.parse(register?.body ?? "{}")).toMatchObject({
          deviceId: DEVICE_ID,
          name,
          platform: devicePlatform,
          arch: "x64",
          home: home,
          isolation: "direct",
          claudeExecutable: fakeClis().paths.claude,
          codexExecutable: fakeClis().paths.codex,
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
        const folder = `${home}/.luke/agents/${AGENT_ID}`;
        expect(runner?.args).toEqual([runnerBundle]);
        expect(runner?.cwd).toBe(`${folder}/repository`);
        expect(runner?.extendEnv).toBe(false);
        expect(runner?.env).toMatchObject({
          CLAUDE_CODE_OAUTH_TOKEN: RUNNER_TOKEN,
          LUKE_RUNNER_PLACE: "host",
          HOME: `${folder}/home`,
          XDG_CACHE_HOME: `${folder}/cache`,
          PNPM_HOME: `${folder}/home/.local/share/pnpm`,
          NPM_CONFIG_PREFIX: `${folder}/home/.npm-global`,
          PATH: `${folder}/home/.local/share/pnpm:${folder}/home/.npm-global/bin:/opt/luke/agent-tools:/usr/bin:/bin`,
        });
        expect(runner?.env?.IS_SANDBOX).toBe(sandboxed);
        expect(reports).toContain("Luke host: Connected to Luke.");

        removed = true;
        yield* TestClock.adjust(Duration.seconds(20));
        yield* Fiber.join(daemon);
        // Note that a daemon handed no releases, as This Mac's copy inside the app, neither fetches the release named nor says it updates.
        expect(http.requests.filter((request) => !request.url.startsWith(SERVICE))).toEqual([]);
        expect(
          at(http.requests, "POST", HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE).some(
            (request) => "update" in JSON.parse(request.body ?? "{}"),
          ),
        ).toBe(false);
        // Note that the runner, which never exits here, has its group ended under the grace it was started with.
        expect(runner?.ended).toEqual({ killSignal: "SIGTERM", forceKillAfterMillis: 3_000 });
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
          `Luke host: upgrade needed: Luke no longer accepts this version. Rerun the install command to upgrade in place: curl -fsSL ${SERVICE}/install.sh | sh`,
        ]);
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );
});

describe("a host's connect with a code", () => {
  /** A service that starts a pairing and answers each poll with the next status given, the device's id and secret with an approve. */
  const pairingService = (statuses: HostPairingPollStatus[]) =>
    recordingHttpClient((request) => {
      if (request.pathname === HOSTED_SERVICE_PATH.HOST_PAIRING_START) {
        return jsonResponse({ pollSecret: POLL_SECRET, ...PAIRING_CODE });
      }
      const status = statuses.shift() ?? HOST_PAIRING_POLL_STATUS.PENDING;
      return jsonResponse(
        status === HOST_PAIRING_POLL_STATUS.APPROVED
          ? { status, deviceId: DEVICE_ID, deviceSecret: DEVICE_SECRET }
          : { status },
      );
    });

  /** Yields a few hundred times, so a connect the fake answered reads the answer and goes on to its next wait on the clock. */
  const drained = Effect.yieldNow.pipe(Effect.repeat({ times: 300 }));

  /** A Linux box's connect to the service given, each code it shows kept. */
  const connectOn = (stateRoot: string, http: RecordingHttpClient, shown: HostPairingCode[]) =>
    connectHostDevice({
      stateRoot,
      serviceOrigin: SERVICE,
      name: "fra-01",
      platform: LINUX_HOST.platform,
      arch: DEVICE_ARCH.X64,
      version: VERSION,
      shown: (code) => Effect.sync(() => shown.push(code)),
    }).pipe(Effect.provide(http.layer));

  it.effect(
    "shows the code before it polls, polls at the interval it was given and slower once told to, writes its record readable by its user alone once approved, and pairs nothing once connected",
    () =>
      Effect.gen(function* () {
        const { stateRoot } = yield* box;
        const fileSystem = yield* FileSystem.FileSystem;
        const http = pairingService([
          HOST_PAIRING_POLL_STATUS.SLOW_DOWN,
          HOST_PAIRING_POLL_STATUS.PENDING,
          HOST_PAIRING_POLL_STATUS.APPROVED,
        ]);
        const shown: HostPairingCode[] = [];
        const polls = () => at(http.requests, "POST", HOSTED_SERVICE_PATH.HOST_PAIRING_POLL);

        const connecting = yield* Effect.forkScoped(connectOn(stateRoot, http, shown));
        yield* settled(() => shown.length === 1);
        expect(shown).toEqual([PAIRING_CODE]);
        expect(polls()).toHaveLength(0);
        yield* TestClock.adjust(Duration.seconds(5));
        yield* settled(() => polls().length === 1);
        yield* drained;
        // Note that a slow down adds five seconds to the wait before every poll after it.
        yield* TestClock.adjust(Duration.seconds(5));
        yield* drained;
        expect(polls()).toHaveLength(1);
        yield* TestClock.adjust(Duration.seconds(5));
        yield* settled(() => polls().length === 2);
        yield* drained;
        yield* TestClock.adjust(Duration.seconds(5));
        yield* drained;
        expect(polls()).toHaveLength(2);
        yield* TestClock.adjust(Duration.seconds(5));

        expect(yield* Fiber.join(connecting)).toEqual({
          outcome: HOST_CONNECT_OUTCOME.CONNECTED,
          deviceId: DEVICE_ID,
        });
        const [start] = at(http.requests, "POST", HOSTED_SERVICE_PATH.HOST_PAIRING_START);
        expect(start?.authorization).toBeUndefined();
        expect(JSON.parse(start?.body ?? "{}")).toEqual({
          name: "fra-01",
          platform: "linux",
          arch: "x64",
        });
        expect(new Set(polls().map((poll) => poll.authorization))).toEqual(
          new Set([`Bearer ${POLL_SECRET}`]),
        );
        expect(
          new Set(http.requests.map((request) => request.headers.get(HOST_WIRE.VERSION_HEADER))),
        ).toEqual(new Set([VERSION]));
        expect(Option.getOrUndefined(yield* readHostDevice(stateRoot))).toEqual({
          deviceId: DEVICE_ID,
          deviceSecret: DEVICE_SECRET,
          serviceOrigin: SERVICE,
        });
        expect(
          ((yield* fileSystem.stat(`${stateRoot}/device.json`)).mode & 0o777).toString(8),
        ).toBe("600");
        expect(((yield* fileSystem.stat(stateRoot)).mode & 0o777).toString(8)).toBe("700");

        const again = yield* connectOn(stateRoot, http, shown);
        expect(again).toEqual({
          outcome: HOST_CONNECT_OUTCOME.ALREADY_CONNECTED,
          serviceOrigin: SERVICE,
        });
        expect(http.requests).toHaveLength(4);
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect.each([
    { status: HOST_PAIRING_POLL_STATUS.DENIED, outcome: HOST_CONNECT_OUTCOME.DENIED },
    { status: HOST_PAIRING_POLL_STATUS.EXPIRED, outcome: HOST_CONNECT_OUTCOME.EXPIRED },
  ])("ends $outcome, with no record written, where a poll answers $status", ({ status, outcome }) =>
    Effect.gen(function* () {
      const { stateRoot } = yield* box;
      const http = pairingService([status]);
      const shown: HostPairingCode[] = [];

      const connecting = yield* Effect.forkScoped(connectOn(stateRoot, http, shown));
      yield* settled(() => shown.length === 1);
      yield* TestClock.adjust(Duration.seconds(5));

      expect(yield* Fiber.join(connecting)).toEqual({ outcome });
      expect(Option.isNone(yield* readHostDevice(stateRoot))).toBe(true);
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
    },
    {
      platform: "linux",
      home: "/var/lib/luke-host",
      os: LINUX_HOST,
      stateRoot: "/var/lib/luke-host/state",
    },
  ])(
    "runs $platform as its own OS, with its state where its app or service keeps it",
    ({ platform, home, os, stateRoot }) => {
      const runtime = hostRuntime({ platform, home, app: { developerIdSigned: true } });
      expect(runtime?.os).toBe(os);
      expect(runtime?.stateRoot).toBe(stateRoot);
    },
  );
});
