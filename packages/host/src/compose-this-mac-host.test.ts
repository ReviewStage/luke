/**
 * compose-this-mac-host.test.ts -- This Mac's `luke-host` as the desktop turns it on: the Mac enrolled under the device id the app already had before the login item is registered, never turned on beside the install command's `luke-host`, and a Mac Luke removed never enrolled again but by the member's own act.
 *
 * The composer runs over a real state folder of its own, holding the device
 * id the account already had, and a fake service and login item that each
 * say what they were asked, on the test's clock. Synthetic ids and secrets
 * throughout.
 */

import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { OWN_ENROLL_OUTCOME, type OwnEnrollOutcome } from "@luke/features";
import { DEVICE_ARCH, DEVICE_PLATFORM, DEVICE_SETUP } from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD } from "@luke/gateway";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Duration, Effect, Layer, Option, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { composeThisMacHost, type ThisMacSetup } from "./compose-this-mac-host.js";
import { THIS_MAC_HOST_STANDING, thisMacHostStandingSchema } from "./contract/this-mac-host.js";
import {
  HOST_LOGIN_ITEM_ACT,
  HOST_LOGIN_ITEM_STATUS,
  type HostLoginItemAct,
  reporterLayer,
  ThisMacHost,
} from "./effect/seams.js";
import { readHostDevice, writeHostDevice } from "./host-device-record.js";
import { writeLocalAgentState } from "./local-agent-state.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

const USER_ID = "user-fixture";
const DEVICE_ID = "5f0c7a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const SERVICE = "https://luke.test";
const SECRET = `${HOST_WIRE.DEVICE_SECRET_PREFIX}${"c".repeat(43)}`;
/** The panel's own operator, which asks the host's methods. */
const CONTEXT = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };
const decodeStanding = Schema.decodeUnknownSync(thisMacHostStandingSchema);
const OLD_SECRET = `${HOST_WIRE.DEVICE_SECRET_PREFIX}${"d".repeat(43)}`;

/** The clock nudged, and the state folder's reads and writes, which wait on no clock, let land, until the condition holds. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 20_000 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.millis(100));
      yield* Effect.yieldNow;
    }
    assert.ok(holds(), "the composer never got there");
  });

/**
 * This Mac's `luke-host` composed over a state folder of its own, with the
 * Local agents experiment on until the test turns it off, or off from the
 * start where `off` says so, the account's device id already kept there, a
 * service that enrolls the Mac and lists the setup `setup` says until the
 * test lists another (none where it cannot answer), a login
 * item that refuses as many unregisters as `refusedUnregisters` says; what
 * each fake was asked, in the order it was asked.
 */
const thisMac = (
  stateRoot: string,
  options: {
    refusedUnregisters?: number;
    off?: boolean;
    setup?: Option.Option<ThisMacSetup>;
  } = {},
) =>
  Effect.gen(function* () {
    let on = options.off !== true;
    let setup = options.setup ?? Option.none<ThisMacSetup>();
    let refusals = options.refusedUnregisters ?? 0;
    const asked: string[] = [];
    const enrolled: string[] = [];
    const client = {
      enrollOwn: (deviceId: string) =>
        Effect.sync((): OwnEnrollOutcome => {
          enrolled.push(deviceId);
          asked.push("enroll");
          return { outcome: OWN_ENROLL_OUTCOME.ENROLLED, deviceSecret: SECRET };
        }),
    };
    yield* Effect.orDie(
      writeLocalAgentState(stateRoot, { devices: { [USER_ID]: DEVICE_ID }, launches: [] }),
    );
    const loginItem = (act: HostLoginItemAct) =>
      Effect.sync(() => {
        asked.push(`login item ${act}`);
        if (act === HOST_LOGIN_ITEM_ACT.UNREGISTER && refusals > 0) {
          refusals -= 1;
          return Result.fail("Operation not permitted");
        }
        return Result.succeed(
          act === HOST_LOGIN_ITEM_ACT.UNREGISTER
            ? HOST_LOGIN_ITEM_STATUS.NOT_REGISTERED
            : HOST_LOGIN_ITEM_STATUS.ENABLED,
        );
      });
    const composer = yield* composeThisMacHost({
      kernel: {
        stateRoot,
        hostedServiceBaseUrl: SERVICE,
        createId: () => "never-minted",
        runMode: { sendsNetwork: true },
      },
      account: { capabilitiesActive: () => true },
      accountId: () => USER_ID,
      switchedOn: Effect.sync(() => on),
      deviceSetup: () => Effect.sync(() => setup),
      client,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeFileSystem.layer,
          NodePath.layer,
          scriptedSpawner(() => undefined).layer,
          fakeHttpClientLayer(() => Promise.reject(new Error("this test reaches no service"))),
          reporterLayer(() => undefined),
          Layer.succeed(ThisMacHost, {
            loginItem,
            version: Effect.succeed(Result.succeed("0.1.0")),
            machine: Effect.succeed({
              name: "Studio",
              platform: DEVICE_PLATFORM.DARWIN,
              arch: DEVICE_ARCH.ARM64,
            }),
          }),
        ),
      ),
    );
    yield* composer.lifetime;
    const call = (
      method:
        | typeof GATEWAY_METHOD.THIS_MAC_HOST_READ
        | typeof GATEWAY_METHOD.THIS_MAC_HOST_TURN_ON,
    ) => {
      const handler = composer.methods[method];
      assert.ok(handler !== undefined);
      return Effect.map(Effect.orDie(handler({}, CONTEXT)), decodeStanding);
    };
    const switchOff = () => {
      on = false;
    };
    const listSetup = (next: Option.Option<ThisMacSetup>) => {
      setup = next;
    };
    return { asked, enrolled, call, switchOff, listSetup };
  });

it.effect(
  "turning on enrolls before it registers luke-host, under the device id the app already had",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped("luke-this-mac-");
        const { asked, enrolled } = yield* thisMac(stateRoot);
        yield* until(() => asked.includes(`login item ${HOST_LOGIN_ITEM_ACT.REGISTER}`));

        assert.deepEqual(asked.slice(0, 2), [
          "enroll",
          `login item ${HOST_LOGIN_ITEM_ACT.REGISTER}`,
        ]);
        assert.deepEqual(enrolled, [DEVICE_ID]);
        const record = yield* readHostDevice(stateRoot);
        assert.deepEqual(Option.getOrUndefined(record), {
          deviceId: DEVICE_ID,
          deviceSecret: SECRET,
          serviceOrigin: SERVICE,
        });
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
    ),
);

it.effect(
  "a Mac whose secret Luke refused is shown removed and never enrolled again on its own, only by Turn on again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped("luke-this-mac-");
        yield* writeHostDevice(stateRoot, {
          deviceId: DEVICE_ID,
          deviceSecret: OLD_SECRET,
          serviceOrigin: SERVICE,
          refused: true,
        });
        const { asked, enrolled, call } = yield* thisMac(stateRoot);
        let standing = yield* call(GATEWAY_METHOD.THIS_MAC_HOST_READ);
        for (
          let round = 0;
          round < 20_000 && standing.standing === THIS_MAC_HOST_STANDING.OFF;
          round += 1
        ) {
          yield* TestClock.adjust(Duration.millis(100));
          yield* Effect.yieldNow;
          standing = yield* call(GATEWAY_METHOD.THIS_MAC_HOST_READ);
        }
        // Note that the composer reads again every five seconds, so a dozen more reads pass here.
        for (let round = 0; round < 600; round += 1) {
          yield* TestClock.adjust(Duration.millis(100));
          yield* Effect.yieldNow;
        }

        assert.deepEqual(standing, { standing: THIS_MAC_HOST_STANDING.REMOVED });
        assert.deepEqual(yield* call(GATEWAY_METHOD.THIS_MAC_HOST_READ), standing);
        assert.deepEqual(enrolled, []);
        assert.deepEqual(asked, []);

        yield* Effect.forkScoped(call(GATEWAY_METHOD.THIS_MAC_HOST_TURN_ON));
        yield* until(() => enrolled.length > 0);
        assert.deepEqual(enrolled, [DEVICE_ID]);
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
    ),
);

it.effect(
  "a switch-off macOS refuses says agents may still run and unregisters again until the login item is off",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped("luke-this-mac-");
        const { asked, call, switchOff } = yield* thisMac(stateRoot, { refusedUnregisters: 1 });
        yield* until(() => asked.includes(`login item ${HOST_LOGIN_ITEM_ACT.REGISTER}`));
        switchOff();
        const unregisters = () =>
          asked.filter((each) => each === `login item ${HOST_LOGIN_ITEM_ACT.UNREGISTER}`).length;
        yield* until(() => unregisters() === 1);
        let standing = yield* call(GATEWAY_METHOD.THIS_MAC_HOST_READ);
        for (let round = 0; round < 20_000 && unregisters() === 1; round += 1) {
          if (standing.standing === THIS_MAC_HOST_STANDING.FAILED) break;
          yield* Effect.yieldNow;
          standing = yield* call(GATEWAY_METHOD.THIS_MAC_HOST_READ);
        }

        assert.equal(standing.standing, THIS_MAC_HOST_STANDING.FAILED);
        yield* until(() => unregisters() === 2);
        let after = yield* call(GATEWAY_METHOD.THIS_MAC_HOST_READ);
        for (
          let round = 0;
          round < 20_000 && after.standing !== THIS_MAC_HOST_STANDING.OFF;
          round += 1
        ) {
          yield* Effect.yieldNow;
          after = yield* call(GATEWAY_METHOD.THIS_MAC_HOST_READ);
        }
        assert.deepEqual(after, { standing: THIS_MAC_HOST_STANDING.OFF });
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
    ),
);

it.effect(
  "with the Local agents experiment off from the start, nothing is enrolled and no login item registered",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped("luke-this-mac-");
        const { asked, call } = yield* thisMac(stateRoot, { off: true });
        // Note that the composer reads again every five seconds, so a dozen reads pass here.
        for (let round = 0; round < 600; round += 1) {
          yield* TestClock.adjust(Duration.millis(100));
          yield* Effect.yieldNow;
        }

        assert.deepEqual(asked, []);
        assert.deepEqual(yield* call(GATEWAY_METHOD.THIS_MAC_HOST_READ), {
          standing: THIS_MAC_HOST_STANDING.OFF,
        });
        assert.equal(Option.isNone(yield* readHostDevice(stateRoot)), true);
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
    ),
);

/** This Mac enrolled before the app starts, its record kept unrefused, and where it first reads as more than off. */
const enrolledMac = (setup: Option.Option<ThisMacSetup>) =>
  Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("luke-this-mac-");
    yield* writeHostDevice(stateRoot, {
      deviceId: DEVICE_ID,
      deviceSecret: OLD_SECRET,
      serviceOrigin: SERVICE,
    });
    const mac = yield* thisMac(stateRoot, { setup });
    let first = yield* mac.call(GATEWAY_METHOD.THIS_MAC_HOST_READ);
    for (
      let round = 0;
      round < 20_000 && first.standing === THIS_MAC_HOST_STANDING.OFF;
      round += 1
    ) {
      yield* TestClock.adjust(Duration.millis(100));
      yield* Effect.yieldNow;
      first = yield* mac.call(GATEWAY_METHOD.THIS_MAC_HOST_READ);
    }
    return { ...mac, first };
  });

it.effect(
  "a setup the service lists as failed reads with why, and Retry starts luke-host again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const why = "the sandbox image could not be pulled";
        const { asked, call, first } = yield* enrolledMac(
          Option.some({ setup: DEVICE_SETUP.FAILED, setupFailure: why }),
        );
        const before = asked.length;
        yield* call(GATEWAY_METHOD.THIS_MAC_HOST_TURN_ON);

        assert.deepEqual(first, {
          standing: THIS_MAC_HOST_STANDING.SETUP_FAILED,
          reason: why,
          deviceId: DEVICE_ID,
        });
        assert.deepEqual(asked.slice(before), [
          `login item ${HOST_LOGIN_ITEM_ACT.UNREGISTER}`,
          `login item ${HOST_LOGIN_ITEM_ACT.REGISTER}`,
        ]);
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
    ),
);

it.effect.each([
  { case: "ready", setup: Option.some<ThisMacSetup>({}) },
  { case: "unreadable", setup: Option.none<ThisMacSetup>() },
])(
  "Retry on a Mac whose setup is $case never stops luke-host, which may be mid-turn",
  ({ setup }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { asked, call } = yield* enrolledMac(setup);
        yield* call(GATEWAY_METHOD.THIS_MAC_HOST_TURN_ON);

        assert.equal(asked.includes(`login item ${HOST_LOGIN_ITEM_ACT.UNREGISTER}`), false);
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
    ),
);

it.effect(
  "a setup failure the service listed stays with its Retry while the service cannot answer",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const why = "the sandbox image could not be pulled";
        const { call, listSetup } = yield* enrolledMac(
          Option.some({ setup: DEVICE_SETUP.FAILED, setupFailure: why }),
        );
        listSetup(Option.none());
        yield* TestClock.adjust(Duration.minutes(1));

        assert.deepEqual(yield* call(GATEWAY_METHOD.THIS_MAC_HOST_READ), {
          standing: THIS_MAC_HOST_STANDING.SETUP_FAILED,
          reason: why,
          deviceId: DEVICE_ID,
        });
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
    ),
);
