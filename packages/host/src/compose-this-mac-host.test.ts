/**
 * compose-this-mac-host.test.ts -- This Mac's host kept as the member and the account's experiments say: nothing enrolled until This Mac is turned on, then enrolled under a new id or a refused record's own, its record written and the install script run; turned off by the install's own uninstall; a record of the account's kept under its id, never enrolled again while it stands; the host stopped with its files kept where Bring your own host is off; a record that is not the account's left alone; and This Mac told the windows as its record moves.
 *
 * The composer runs over a real state folder of its own, a fake service
 * that enrolls the Mac, lists the account's hosts, and serves the install
 * script, and a fake launchd and installer that each say what they were
 * asked, on the test's clock. Synthetic ids and secrets throughout.
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { OWN_ENROLL_OUTCOME, type OwnEnrollOutcome } from "@repo/features";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { HOST_RELEASE } from "@repo/features/host-release";
import { HOST_WIRE } from "@repo/features/host-wire";
import { GATEWAY_CLIENT_ROLE, GATEWAY_EVENT, GATEWAY_METHOD } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { EXPERIMENT, type Experiment } from "@repo/settings";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Duration, Effect, Layer, Option, Result } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import { TestClock } from "effect/testing";
import type { AppThisMacHost, AppThisMacHosts } from "./app-state.js";
import { composeThisMacHost } from "./compose-this-mac-host.js";
import { reporterLayer, ThisMacHost } from "./effect/seams.js";
import { type HostDevice, readHostDevice, writeHostDevice } from "./host-device-record.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

const USER_ID = "user-fixture";
const MINTED_ID = "5f0c7a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const KEPT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MACHINE_ID = "e".repeat(64);
const SERVICE = "https://app.test";
const SECRET = `${HOST_WIRE.DEVICE_SECRET_PREFIX}${"c".repeat(43)}`;
const OLD_SECRET = `${HOST_WIRE.DEVICE_SECRET_PREFIX}${"d".repeat(43)}`;
const SCRIPT = "#!/bin/sh\necho install\n";
/** Where the fake service takes an enroll, so its responder reads the version the enroll carried. */
const ENROLL_URL = `${SERVICE}/enroll`;
const FILES = Layer.merge(NodeFileSystem.layer, NodePath.layer);
/** The desktop's own window, as the Gateway hands a method its caller. */
const CONTEXT = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

const BRING_YOUR_OWN_HOST_ON = {
  [EXPERIMENT.BRING_YOUR_OWN_HOST]: true,
};

interface MacOptions {
  /** The experiments the account has on; Bring your own host by default. */
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
 * acts; and This Mac as the windows were last told it, under the account.
 */
const thisMac = (stateRoot: string, options: MacOptions = {}) =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const enrolled: { deviceId: string; version: string | null }[] = [];
    let failedInstalls = options.failedInstalls ?? 0;
    const experiments: Partial<Record<Experiment, boolean>> =
      options.experiments ?? BRING_YOUR_OWN_HOST_ON;
    const listed = new Set(options.listed ?? []);
    let version: string | null = null;
    let told: AppThisMacHosts | undefined;
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
        emit: (kind, payload) => {
          // SAFETY: what the composer tells on this event is the windows' This Mac, built as `AppThisMacHosts`.
          if (kind === GATEWAY_EVENT.THIS_MAC_HOST_CHANGED) told = payload as AppThisMacHosts;
        },
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
            // As the install's own uninstall leaves it: the record gone with the state folder.
            uninstall: Effect.sync(() => {
              asked.push("uninstall");
              rmSync(join(stateRoot, "device.json"), { force: true });
              return Result.succeed(undefined);
            }),
          }),
        ),
      ),
    );
    yield* composer.lifetime;
    const held = (): AppThisMacHost | undefined => told?.[USER_ID]?.rows;
    const set = composer.methods[GATEWAY_METHOD.HOSTS_THIS_MAC_SET];
    assert.ok(set !== undefined, "This Mac answers being turned on and off");
    /** Run agents on this Mac turned on or off, as its switch turns it; what it answered. */
    const turn = (on: boolean) => Effect.orDie(set({ on }, CONTEXT));
    return { asked, enrolled, held, turn };
  });

/** The state folder with the record given written, as the install's host would have left it. */
const recorded = (record: HostDevice) =>
  Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("this-mac-");
    yield* writeHostDevice(stateRoot, record);
    return stateRoot;
  });

it.effect(
  "a Mac with no record runs nothing until it is turned on, then is enrolled under a new id on the release's version, its record written, and the install script run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped("this-mac-");
        const mac = yield* thisMac(stateRoot);
        yield* until(() => mac.held() !== undefined);
        yield* nudged(Duration.minutes(1));
        assert.equal(mac.asked.length, 0, "nothing is enrolled unasked");
        assert.deepEqual(mac.held(), { machineId: MACHINE_ID, enrolled: false });

        assert.deepEqual(yield* mac.turn(true), { done: true });
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
        assert.deepEqual(mac.held(), {
          deviceId: MINTED_ID,
          machineId: MACHINE_ID,
          enrolled: true,
        });
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "a record the install's own host writes reaches the windows on the loop's next pass, with no window asking",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped("this-mac-");
        const mac = yield* thisMac(stateRoot, { experiments: {} });
        yield* until(() => mac.held() !== undefined);
        assert.deepEqual(mac.held(), { machineId: MACHINE_ID, enrolled: false });

        // As the host daemon writes it once it pairs, apart from this app.
        yield* writeHostDevice(stateRoot, {
          deviceId: KEPT_ID,
          deviceSecret: OLD_SECRET,
          serviceOrigin: SERVICE,
        });
        yield* until(() => mac.held()?.deviceId !== undefined);

        assert.deepEqual(mac.held(), { deviceId: KEPT_ID, machineId: MACHINE_ID, enrolled: true });
        assert.equal(
          mac.asked.length,
          0,
          "nothing of the host is kept with Bring your own host off",
        );
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect(
  "a record the service refused stays off by itself, and turning it on enrolls it again under its own id, not a new one",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* recorded({
          deviceId: KEPT_ID,
          deviceSecret: OLD_SECRET,
          serviceOrigin: SERVICE,
          refused: true,
        });
        const mac = yield* thisMac(stateRoot);
        yield* until(() => mac.held() !== undefined);
        yield* nudged(Duration.minutes(1));
        assert.equal(mac.asked.length, 0, "a Mac removed elsewhere is not enrolled again unasked");
        assert.equal(mac.held()?.enrolled, false);

        yield* mac.turn(true);
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
        const stateRoot = yield* temporaryDirectoryScoped("this-mac-");
        const mac = yield* thisMac(stateRoot, { failedInstalls: 1 });
        yield* mac.turn(true);
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
  "turning This Mac off runs the install's own uninstall, and it then reads off until it is turned on again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const record = { deviceId: KEPT_ID, deviceSecret: OLD_SECRET, serviceOrigin: SERVICE };
        const stateRoot = yield* recorded(record);
        const mac = yield* thisMac(stateRoot, { listed: [KEPT_ID], loaded: true });
        yield* until(() => mac.held()?.enrolled === true);

        assert.deepEqual(yield* mac.turn(false), { done: true });
        yield* nudged(Duration.minutes(1));

        assert.deepEqual(mac.asked, ["uninstall"]);
        assert.deepEqual(mac.held(), { machineId: MACHINE_ID, enrolled: false });
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
          experiments: {},
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
    case: "the record was enrolled with another service",
    record: {
      deviceId: KEPT_ID,
      deviceSecret: OLD_SECRET,
      serviceOrigin: "https://preview.app.test",
    },
    experiments: BRING_YOUR_OWN_HOST_ON,
  },
  {
    case: "the record is another account's",
    record: { deviceId: KEPT_ID, deviceSecret: OLD_SECRET, serviceOrigin: SERVICE },
    experiments: BRING_YOUR_OWN_HOST_ON,
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
