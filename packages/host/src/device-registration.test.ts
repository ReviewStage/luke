import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { it } from "@effect/vitest";
import { DEVICE_PLATFORM } from "@sidecar/hosted";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { temporaryDirectory } from "@sidecar/wire/testing";
import { Duration, Effect, type Runtime, TestClock } from "effect";
import { test } from "vitest";
import { DEVICE_POLL_INTERVAL_MS, type DevicePresenceReport } from "./device-presence.js";
import {
  DEVICE_STATE_FILE,
  DeviceRegistration,
  type DeviceRegistrationClient,
  type DeviceState,
  deviceStateFile,
  deviceStateFrom,
} from "./device-registration.js";

const INSTALLATION_ID = "0F8FAD5B-D9CB-469F-A165-70867728950E";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_DEVICE_ID = "9b2e5c1a-3d4f-4a6b-8c7d-0e1f2a3b4c5d";

interface Call {
  kind: "register" | "poll" | "forget";
  body: unknown;
  departing?: string;
}

/** The heads a poll answers, which the registration never reads; the fake answers the same ones every time. */
const HEADS = { messages: "e30", events: "e30" } as const;

const PRESENT: DevicePresenceReport = { activeUntil: 1_757_505_720_000, quietUntil: null };

function fakeClient(answers: {
  register?: () => { deviceId: string } | undefined;
  poll?: () => { seen: boolean } | undefined;
}) {
  const calls: Call[] = [];
  const client: DeviceRegistrationClient = {
    register: async (request) => {
      calls.push({ kind: "register", body: request });
      return answers.register ? answers.register() : { deviceId: DEVICE_ID };
    },
    poll: async (request) => {
      calls.push({ kind: "poll", body: request });
      const seen = answers.poll ? answers.poll() : { seen: true };
      return seen === undefined ? undefined : { ...seen, ...HEADS };
    },
    forget: async (request, departing) => {
      calls.push({
        kind: "forget",
        body: request,
        ...(departing ? { departing: departing.accessToken } : undefined),
      });
      return { deleted: true };
    },
  };
  return { client, calls };
}

function registration(
  directory: string,
  client: DeviceRegistrationClient,
  runtime: Runtime.Runtime<never>,
  mint: () => string = () => INSTALLATION_ID,
  presence: () => DevicePresenceReport = () => PRESENT,
  reported: string[] = [],
) {
  return new DeviceRegistration({
    client,
    state: deviceStateFile(() => directory),
    mintInstallationId: mint,
    presence: async () => presence(),
    report: (message) => {
      reported.push(message);
    },
    runtime,
  });
}

/**
 * The clock moved to the cadence's next beat, and the calls that beat awaits
 * let run: advancing the test clock resumes the fiber, and the beat's own
 * awaits settle on the immediate queue rather than on it.
 */
const nextBeat = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* TestClock.adjust(Duration.millis(DEVICE_POLL_INTERVAL_MS));
    yield* Effect.promise(() => drainMicrotasks(20));
  });

function storedState(directory: string): DeviceState | undefined {
  const parsed: UnparsedWireValue = JSON.parse(
    fs.readFileSync(path.join(directory, DEVICE_STATE_FILE), "utf8"),
  );
  return isRecord(parsed) ? deviceStateFrom(parsed) : undefined;
}

it.effect(
  "a first start mints the installation id once, registers as a Mac, polls at once with the presence read, and keeps the row's id",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
      const runtime = yield* Effect.runtime<never>();
      const { client, calls } = fakeClient({});
      const subject = registration(directory, client, runtime);

      yield* Effect.promise(() => subject.start());

      assert.deepEqual(calls, [
        {
          kind: "register",
          body: { platform: DEVICE_PLATFORM.MACOS, installationId: INSTALLATION_ID.toLowerCase() },
        },
        { kind: "poll", body: { deviceId: DEVICE_ID, ...PRESENT } },
      ]);
      assert.deepEqual(storedState(directory), {
        installationId: INSTALLATION_ID.toLowerCase(),
        deviceId: DEVICE_ID,
      });
      assert.equal(subject.deviceId(), DEVICE_ID);
      assert.equal(subject.standing, true);

      yield* Effect.promise(() => subject.start());
      assert.equal(calls.length, 2);

      yield* nextBeat();
      assert.deepEqual(
        calls.map((call) => call.kind),
        ["register", "poll", "poll"],
      );
      yield* Effect.promise(() => subject.stop({ forget: false }));
    }),
);

it.effect(
  "the installation id outlives a sign-out and a relaunch, so a re-sign-in re-keys the one row",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
      const runtime = yield* Effect.runtime<never>();
      const first = fakeClient({});
      const subject = registration(directory, first.client, runtime);
      yield* Effect.promise(() => subject.start());
      yield* Effect.promise(() => subject.stop({ forget: { accessToken: "leaving" } }));

      assert.deepEqual(first.calls.at(-1), {
        kind: "forget",
        body: { deviceId: DEVICE_ID },
        departing: "leaving",
      });
      assert.deepEqual(storedState(directory), { installationId: INSTALLATION_ID.toLowerCase() });
      assert.equal(subject.standing, false);
      const settled = first.calls.length;
      yield* nextBeat();
      assert.equal(first.calls.length, settled, "a stopped registration keeps no cadence");

      const relaunched = fakeClient({ register: () => ({ deviceId: OTHER_DEVICE_ID }) });
      const next = registration(directory, relaunched.client, runtime, () => {
        throw new Error("a stored installation id is never minted again");
      });
      yield* Effect.promise(() => next.start());
      assert.deepEqual(relaunched.calls[0]?.body, {
        platform: DEVICE_PLATFORM.MACOS,
        installationId: INSTALLATION_ID.toLowerCase(),
      });
      assert.equal(next.deviceId(), OTHER_DEVICE_ID);
      yield* Effect.promise(() => next.stop({ forget: false }));
    }),
);

it.effect("a stop without a departing account ends the cadence and forgets nothing", (t) =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() => temporaryDirectory(t));
    const runtime = yield* Effect.runtime<never>();
    const { client, calls } = fakeClient({});
    const subject = registration(directory, client, runtime);
    yield* Effect.promise(() => subject.start());

    yield* Effect.promise(() => subject.stop({ forget: false }));

    yield* nextBeat();
    assert.deepEqual(
      calls.map((call) => call.kind),
      ["register", "poll"],
    );
    assert.equal(subject.standing, false);
    assert.equal(subject.deviceId(), DEVICE_ID);
  }),
);

it.effect(
  "each poll moves last seen and carries the presence read at that poll, and a row the service no longer holds is registered again",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
      const runtime = yield* Effect.runtime<never>();
      const seen = [true, true, false];
      const ids = [DEVICE_ID, OTHER_DEVICE_ID];
      const reports: DevicePresenceReport[] = [
        PRESENT,
        PRESENT,
        { activeUntil: null, quietUntil: 1_757_509_200_000 },
      ];
      const { client, calls } = fakeClient({
        register: () => ({ deviceId: ids.shift() ?? OTHER_DEVICE_ID }),
        poll: () => ({ seen: seen.shift() ?? true }),
      });
      const subject = registration(
        directory,
        client,
        runtime,
        undefined,
        () => reports.shift() ?? PRESENT,
      );
      yield* Effect.promise(() => subject.start());

      yield* nextBeat();
      assert.deepEqual(calls.at(-1), { kind: "poll", body: { deviceId: DEVICE_ID, ...PRESENT } });

      yield* nextBeat();
      assert.deepEqual(
        calls.map((call) => call.kind),
        ["register", "poll", "poll", "poll", "register", "poll"],
      );
      assert.deepEqual(calls[3]?.body, {
        deviceId: DEVICE_ID,
        activeUntil: null,
        quietUntil: 1_757_509_200_000,
      });
      assert.deepEqual(calls[5]?.body, { deviceId: OTHER_DEVICE_ID, ...PRESENT });
      assert.equal(subject.deviceId(), OTHER_DEVICE_ID);
      yield* Effect.promise(() => subject.stop({ forget: false }));
    }),
);

it.effect(
  "a registration that did not land is tried again by the next beat, and a late answer installs nothing",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
      const runtime = yield* Effect.runtime<never>();
      let answer: { deviceId: string } | undefined;
      const { client, calls } = fakeClient({ register: () => answer });
      const subject = registration(directory, client, runtime);

      yield* Effect.promise(() => subject.start());
      assert.equal(subject.deviceId(), undefined);
      assert.deepEqual(storedState(directory), { installationId: INSTALLATION_ID.toLowerCase() });

      answer = { deviceId: DEVICE_ID };
      yield* nextBeat();
      assert.deepEqual(
        calls.map((call) => call.kind),
        ["register", "register", "poll"],
      );
      assert.equal(subject.deviceId(), DEVICE_ID);
      yield* Effect.promise(() => subject.stop({ forget: false }));

      let release: (() => void) | undefined;
      let polls = 0;
      const slow: DeviceRegistrationClient = {
        ...client,
        poll: () => {
          polls += 1;
          if (polls === 1) return Promise.resolve({ seen: true, ...HEADS });
          return new Promise((resolve) => {
            release = () => resolve({ seen: false, ...HEADS });
          });
        },
      };
      const racing = registration(directory, slow, runtime);
      yield* Effect.promise(() => racing.start());
      yield* nextBeat();
      yield* Effect.promise(() => racing.stop({ forget: false }));
      release?.();
      yield* Effect.promise(() => drainMicrotasks(20));
      assert.equal(
        calls.filter((call) => call.kind === "register").length,
        2,
        "the stopped generation's unseen answer registers nothing",
      );
    }),
);

it.effect("a beat that fails is reported and the cadence keeps its own beat", (t) =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() => temporaryDirectory(t));
    const runtime = yield* Effect.runtime<never>();
    const reported: string[] = [];
    let failing = false;
    const { client, calls } = fakeClient({});
    const subject = registration(
      directory,
      client,
      runtime,
      undefined,
      () => {
        if (failing) throw new Error("the calendar could not be read");
        return PRESENT;
      },
      reported,
    );
    yield* Effect.promise(() => subject.start());
    assert.equal(reported.length, 0);

    failing = true;
    yield* nextBeat();
    assert.equal(reported.length, 1);

    failing = false;
    yield* nextBeat();
    assert.deepEqual(
      calls.map((call) => call.kind),
      ["register", "poll", "poll"],
    );
    yield* Effect.promise(() => subject.stop({ forget: false }));
  }),
);

it.effect(
  "a registration still on the wire at sign-out lands before the next account registers",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
      const runtime = yield* Effect.runtime<never>();
      let release: (() => void) | undefined;
      const ids = [DEVICE_ID, OTHER_DEVICE_ID];
      const { client, calls } = fakeClient({});
      const gated: DeviceRegistrationClient = {
        ...client,
        register: (request) =>
          new Promise((resolve) => {
            calls.push({ kind: "register", body: request });
            const deviceId = ids.shift() ?? OTHER_DEVICE_ID;
            if (release === undefined) {
              release = () => resolve({ deviceId });
              return;
            }
            resolve({ deviceId });
          }),
      };
      const subject = registration(directory, gated, runtime);
      const departing = subject.start();
      yield* Effect.promise(() => subject.stop({ forget: { accessToken: "leaving" } }));

      const arriving = subject.start();
      yield* Effect.promise(() => drainMicrotasks(20));
      assert.equal(calls.length, 1, "the next registration waits for the one on the wire");

      release?.();
      yield* Effect.promise(() => departing);
      yield* Effect.promise(() => arriving);
      assert.deepEqual(
        calls.map((call) => call.kind),
        ["register", "register", "poll"],
      );
      assert.equal(
        subject.deviceId(),
        OTHER_DEVICE_ID,
        "the row the new sign-in registered stands",
      );
      yield* Effect.promise(() => subject.stop({ forget: false }));
    }),
);

test("a stored record is read only with a well-formed installation id", () => {
  assert.deepEqual(deviceStateFrom({ installationId: INSTALLATION_ID, deviceId: DEVICE_ID }), {
    installationId: INSTALLATION_ID.toLowerCase(),
    deviceId: DEVICE_ID,
  });
  assert.deepEqual(deviceStateFrom({ installationId: INSTALLATION_ID, deviceId: "row" }), {
    installationId: INSTALLATION_ID.toLowerCase(),
  });
  assert.equal(deviceStateFrom({ installationId: "mac" }), undefined);
  assert.equal(deviceStateFrom({ deviceId: DEVICE_ID }), undefined);
});
