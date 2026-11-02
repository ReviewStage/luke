/**
 * compose-this-mac-host.test.ts -- This Mac's host kept as the account's experiments say: a Mac with no record enrolled under a new id, its record written and the install script run; a record of the account's kept under its id, never enrolled again while it stands; the host stopped with its files kept where Bring your own host is off; and a record that is not the account's, or a gate that is off, left alone.
 *
 * The composer runs over a real state folder of its own, a fake service
 * that enrolls the Mac, lists the account's hosts, and serves the install
 * script, and a fake launchd and installer that each say what they were
 * asked, on the test's clock. Synthetic ids and secrets throughout.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { OWN_ENROLL_OUTCOME, type OwnEnrollOutcome } from "@luke/features";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import { HOST_RELEASE } from "@luke/features/host-release";
import { HOST_WIRE } from "@luke/features/host-wire";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD } from "@luke/gateway";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { EXPERIMENT, type Experiment } from "@luke/settings";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Duration, Effect, Layer, Option, Result } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import { TestClock } from "effect/testing";
import { composeThisMacHost } from "./compose-this-mac-host.js";
import { reporterLayer, ThisMacHost } from "./effect/seams.js";
import { type HostDevice, readHostDevice, writeHostDevice } from "./host-device-record.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

const USER_ID = "user-fixture";
const MINTED_ID = "5f0c7a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const KEPT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MACHINE_ID = "e".repeat(64);
const SERVICE = "https://luke.test";
const SECRET = `${HOST_WIRE.DEVICE_SECRET_PREFIX}${"c".repeat(43)}`;
const OLD_SECRET = `${HOST_WIRE.DEVICE_SECRET_PREFIX}${"d".repeat(43)}`;
const SCRIPT = "#!/bin/sh\necho install\n";
/** Where the fake service takes an enroll, so its responder reads the version the enroll carried. */
const ENROLL_URL = `${SERVICE}/enroll`;
/** The panel's own operator, which asks the host's methods. */
const CONTEXT = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };
const FILES = Layer.merge(NodeFileSystem.layer, NodePath.layer);

const BOTH_ON = {
  [EXPERIMENT.THIS_MAC_ACCOUNT_HOST]: true,
  [EXPERIMENT.BRING_YOUR_OWN_HOST]: true,
};

interface MacOptions {
  /** The experiments the account has on; both by default. */
  readonly experiments?: Partial<Record<Experiment, boolean>>;
  /** The devices the service lists among the account's hosts, beside each it enrolls. */
  readonly listed?: readonly string[];
  /** Whether launchd holds the host's LaunchAgent. */
  readonly loaded?: boolean;
  /** How many runs of the install script fail before one lands. */
  readonly failedInstalls?: number;
}

/** The clock nudged, and the state folder's reads and writes, which wait on no clock, let land, until the condition holds. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 20_000 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.millis(100));
      yield* Effect.yieldNow;
    }
    assert.ok(holds(), "the composer never got there");
  });

/** The clock nudged, and the state folder's reads and writes let land, for the time given. */
const nudged = (time: Duration.Input) =>
  Effect.gen(function* () {
    const rounds = Duration.toMillis(time) / 100;
    for (let round = 0; round < rounds; round += 1) {
      yield* TestClock.adjust(Duration.millis(100));
      yield* Effect.yieldNow;
    }
  });

/**
 * This Mac's host composed over a state folder of its own, with what each
 * fake was asked, in the order it was asked: the service's enrolls, by the
 * device id and the version they carried, and the installer's and launchd's
 * acts.
 */
const thisMac = (stateRoot: string, options: MacOptions = {}) =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const enrolled: { deviceId: string; version: string | null }[] = [];
    let failedInstalls = options.failedInstalls ?? 0;
    const experiments: Partial<Record<Experiment, boolean>> = options.experiments ?? BOTH_ON;
    const listed = new Set(options.listed ?? []);
    let version: string | null = null;
    const client = {
      enrollOwn: (deviceId: string) =>
        HttpClient.get(ENROLL_URL).pipe(
          Effect.orDie,
          Effect.map((): OwnEnrollOutcome => {
            enrolled.push({ deviceId, version });
            asked.push("enroll");
            listed.add(deviceId);
            return { outcome: OWN_ENROLL_OUTCOME.ENROLLED, deviceSecret: SECRET };
          }),
        ),
    };
    const composer = yield* composeThisMacHost({
      kernel: {
        hostedServiceBaseUrl: SERVICE,
        createId: () => MINTED_ID,
        runMode: { sendsNetwork: true },
      },
      account: { capabilitiesActive: () => true },
      accountId: () => USER_ID,
      experimentOn: (experiment) => Effect.succeed(experiments[experiment] === true),
      hostListed: (deviceId) => Effect.succeed(Option.some(listed.has(deviceId))),
      client,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeFileSystem.layer,
          NodePath.layer,
          scriptedSpawner(() => undefined).layer,
          fakeHttpClientLayer((url, init) => {
            if (url === ENROLL_URL) {
              version = new Headers(init.headers).get(HOST_WIRE.VERSION_HEADER);
              return new Response("{}");
            }
            assert.equal(url, `${SERVICE}${HOST_WIRE.INSTALL_SCRIPT_PATH}`);
            return new Response(SCRIPT);
          }),
          reporterLayer(() => undefined),
          Layer.succeed(ThisMacHost, {
            stateRoot,
            runsHost: true,
            machine: Effect.succeed({
              name: "Studio",
              platform: DEVICE_PLATFORM.DARWIN,
              arch: DEVICE_ARCH.ARM64,
              machineId: MACHINE_ID,
            }),
            loaded: Effect.succeed(options.loaded ?? false),
            install: (script) =>
              Effect.sync(() => {
                asked.push(script === SCRIPT ? "install" : "install another script");
                if (failedInstalls === 0) return Result.succeed(undefined);
                failedInstalls -= 1;
                return Result.fail("could not download the release");
              }),
            stop: Effect.sync(() => {
              asked.push("stop");
              return Result.succeed(undefined);
            }),
          }),
        ),
      ),
    );
    yield* composer.lifetime;
    const read = Effect.gen(function* () {
      const handler = composer.methods[GATEWAY_METHOD.THIS_MAC_HOST_READ];
      assert.ok(handler !== undefined);
      return yield* Effect.orDie(handler({}, CONTEXT));
    });
    return { asked, enrolled, read };
  });

/** The state folder with the record given written, as the install's host would have left it. */
const recorded = (record: HostDevice) =>
  Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("luke-this-mac-");
    yield* writeHostDevice(stateRoot, record);
    return stateRoot;
  });

it.effect(
  "a Mac with no record is enrolled under a new id on the release's version, its record written, and then the install script run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped("luke-this-mac-");
        const mac = yield* thisMac(stateRoot);
        yield* until(() => mac.asked.length >= 2);

        assert.deepEqual(mac.asked, ["enroll", "install"]);
        assert.deepEqual(mac.enrolled, [{ deviceId: MINTED_ID, version: HOST_RELEASE?.VERSION }]);
        assert.deepEqual(Option.getOrUndefined(yield* readHostDevice(stateRoot)), {
          deviceId: MINTED_ID,
          deviceSecret: SECRET,
          serviceOrigin: SERVICE,
        });
        const fileSystem = yield* FileSystem.FileSystem;
        const mode = (yield* fileSystem.stat(join(stateRoot, "device.json"))).mode & 0o777;
        assert.equal(mode, 0o600, "the record is readable by its owner alone");
        assert.deepEqual(yield* mac.read, { deviceId: MINTED_ID, machineId: MACHINE_ID });
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect("a record the service refused is enrolled again under its own id, not a new one", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stateRoot = yield* recorded({
        deviceId: KEPT_ID,
        deviceSecret: OLD_SECRET,
        serviceOrigin: SERVICE,
        refused: true,
      });
      const mac = yield* thisMac(stateRoot);
      yield* until(() => mac.asked.includes("install"));

      assert.deepEqual(
        mac.enrolled.map((each) => each.deviceId),
        [KEPT_ID],
      );
      assert.equal(Option.getOrUndefined(yield* readHostDevice(stateRoot))?.deviceSecret, SECRET);
    }).pipe(Effect.provide(FILES)),
  ),
);

it.effect(
  "the account's standing record is never enrolled again, so its secret holds, and the script runs only where launchd holds no host",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const record = { deviceId: KEPT_ID, deviceSecret: OLD_SECRET, serviceOrigin: SERVICE };
        const stopped = yield* thisMac(yield* recorded(record), { listed: [KEPT_ID] });
        const running = yield* thisMac(yield* recorded(record), {
          listed: [KEPT_ID],
          loaded: true,
        });
        yield* until(() => stopped.asked.length > 0);
        yield* nudged(Duration.minutes(1));

        assert.deepEqual(stopped.asked, ["install"]);
        assert.equal(running.asked.length, 0, "a running host is left as it is");
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "an install that failed after the enroll is tried again after a backoff by the script alone, never by enrolling again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped("luke-this-mac-");
        const mac = yield* thisMac(stateRoot, { failedInstalls: 1 });
        yield* until(() => mac.asked.length >= 2);
        yield* nudged(Duration.seconds(5));
        assert.deepEqual(
          mac.asked,
          ["enroll", "install"],
          "nothing is tried again before the backoff",
        );

        yield* until(() => mac.asked.length >= 3);
        assert.deepEqual(mac.asked, ["enroll", "install", "install"]);
        assert.equal(Option.getOrUndefined(yield* readHostDevice(stateRoot))?.deviceId, MINTED_ID);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "with Bring your own host off, the account's host is stopped and its record and files kept",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const record = { deviceId: KEPT_ID, deviceSecret: OLD_SECRET, serviceOrigin: SERVICE };
        const stateRoot = yield* recorded(record);
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.makeDirectory(join(stateRoot, "owned-agents"), { recursive: true });
        yield* fileSystem.writeFileString(join(stateRoot, "owned-agents", "agent-1"), "");
        const mac = yield* thisMac(stateRoot, {
          experiments: { [EXPERIMENT.THIS_MAC_ACCOUNT_HOST]: true },
          listed: [KEPT_ID],
          loaded: true,
        });
        yield* until(() => mac.asked.length > 0);
        yield* nudged(Duration.minutes(1));

        assert.deepEqual(mac.asked, ["stop"]);
        assert.deepEqual(Option.getOrUndefined(yield* readHostDevice(stateRoot)), record);
        assert.equal(yield* fileSystem.exists(join(stateRoot, "owned-agents", "agent-1")), true);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect.each([
  {
    case: "the One host program experiment is off",
    record: { deviceId: KEPT_ID, deviceSecret: OLD_SECRET, serviceOrigin: SERVICE, refused: true },
    experiments: { [EXPERIMENT.BRING_YOUR_OWN_HOST]: true },
  },
  {
    case: "the record was enrolled with another service",
    record: {
      deviceId: KEPT_ID,
      deviceSecret: OLD_SECRET,
      serviceOrigin: "https://preview.luke.test",
    },
    experiments: BOTH_ON,
  },
  {
    case: "the record is another account's",
    record: { deviceId: KEPT_ID, deviceSecret: OLD_SECRET, serviceOrigin: SERVICE },
    experiments: BOTH_ON,
  },
] as const)("nothing is enrolled, installed, or stopped where $case", ({ record, experiments }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const stateRoot = yield* recorded(record);
      const on = yield* thisMac(stateRoot, { experiments });
      const off = yield* thisMac(stateRoot, {
        experiments: { ...experiments, [EXPERIMENT.BRING_YOUR_OWN_HOST]: false },
        loaded: true,
      });
      yield* nudged(Duration.minutes(1));

      // Note that the length is asserted rather than the list, which an assertion would narrow to an empty one.
      assert.equal(on.asked.length + off.asked.length, 0);
      assert.deepEqual(Option.getOrUndefined(yield* readHostDevice(stateRoot)), record);
    }).pipe(Effect.provide(FILES)),
  ),
);
