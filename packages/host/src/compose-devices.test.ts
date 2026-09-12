import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { it } from "@effect/vitest";
import { DEVICE_PLATFORM } from "@sidecar/hosted";

import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { temporaryDirectory } from "@sidecar/wire/testing";
import { Duration, Effect, TestClock } from "effect";
import { test } from "vitest";
import {
  DEVICE_STATE_FILE,
  type DeviceCadenceClient,
  type DeviceState,
  deviceCadence,
  deviceStateFile,
  deviceStateFrom,
} from "./compose-devices.js";
import { DEVICE_POLL_INTERVAL_MS, type DevicePresenceReport } from "./device-presence.js";

const INSTALLATION_ID = "0F8FAD5B-D9CB-469F-A165-70867728950E";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_DEVICE_ID = "9b2e5c1a-3d4f-4a6b-8c7d-0e1f2a3b4c5d";

interface Call {
  kind: "register" | "poll" | "forget";
  body: unknown;
  departing?: string;
}

/** The heads a poll answers, which the cadence never reads; the fake answers the same ones every time. */
const HEADS = { messages: "e30", events: "e30" } as const;

const PRESENT: DevicePresenceReport = { activeUntil: 1_757_505_720_000, quietUntil: null };

function fakeClient(answers: {
  register?: () => { deviceId: string } | undefined;
  poll?: () => { seen: boolean } | undefined;
}) {
  const calls: Call[] = [];
  const client: DeviceCadenceClient = {
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

function cadence(
  directory: string,
  client: DeviceCadenceClient,
  mint: () => string = () => INSTALLATION_ID,
  presence: () => DevicePresenceReport = () => PRESENT,
  reported: string[] = [],
) {
  return deviceCadence({
    client,
    state: deviceStateFile(() => directory),
    mintInstallationId: mint,
    presence: async () => presence(),
    report: (message) => {
      reported.push(message);
    },
  });
}

/** Gives the fiber scheduler turns until `condition` holds, or fails the test if it never does. */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

/** Gives the fiber scheduler turns without asserting anything, for a beat expected to change nothing. */
function settle(rounds = 20): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    }
  });
}

/** The arming's own beat let run: it is a fiber the gate forked, not the arming's own await. */
const firstBeat = waitFor;

/**
 * The clock moved to the cadence's next beat, and the calls that beat awaits
 * let run: advancing the test clock resumes the fiber, and the beat's own
 * awaits settle as the fiber scheduler is given turns to run them.
 */
function nextBeat(condition: () => boolean): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* TestClock.adjust(Duration.millis(DEVICE_POLL_INTERVAL_MS));
    yield* waitFor(condition);
  });
}

function storedState(directory: string): DeviceState | undefined {
  const parsed: UnparsedWireValue = JSON.parse(
    fs.readFileSync(path.join(directory, DEVICE_STATE_FILE), "utf8"),
  );
  return isRecord(parsed) ? deviceStateFrom(parsed) : undefined;
}

it.scoped(
  "a first start mints the installation id once, registers as a Mac, polls at once with the presence read, and keeps the row's id",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
      const { client, calls } = fakeClient({});
      const subject = yield* cadence(directory, client);

      yield* subject.start;
      yield* firstBeat(() => calls.length === 2);

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

      yield* subject.start;
      yield* firstBeat(() => calls.length === 2);
      assert.equal(calls.length, 2);

      yield* nextBeat(() => calls.length === 3);
      assert.deepEqual(
        calls.map((call) => call.kind),
        ["register", "poll", "poll"],
      );
      yield* subject.stop({ forget: false });
    }),
);

it.scoped(
  "the installation id outlives a sign-out and a relaunch, so a re-sign-in re-keys the one row",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
      const first = fakeClient({});
      const subject = yield* cadence(directory, first.client);
      yield* subject.start;
      yield* firstBeat(() => first.calls.length === 2);
      yield* subject.stop({ forget: { accessToken: "leaving" } });

      assert.deepEqual(first.calls.at(-1), {
        kind: "forget",
        body: { deviceId: DEVICE_ID },
        departing: "leaving",
      });
      assert.deepEqual(storedState(directory), { installationId: INSTALLATION_ID.toLowerCase() });
      assert.equal(subject.standing, false);
      const settled = first.calls.length;
      yield* TestClock.adjust(Duration.millis(DEVICE_POLL_INTERVAL_MS));
      yield* settle();
      assert.equal(first.calls.length, settled, "a stopped cadence keeps no beat");

      const relaunched = fakeClient({ register: () => ({ deviceId: OTHER_DEVICE_ID }) });
      const next = yield* cadence(directory, relaunched.client, () => {
        throw new Error("a stored installation id is never minted again");
      });
      yield* next.start;
      yield* firstBeat(() => relaunched.calls.length === 2);
      assert.deepEqual(relaunched.calls[0]?.body, {
        platform: DEVICE_PLATFORM.MACOS,
        installationId: INSTALLATION_ID.toLowerCase(),
      });
      assert.equal(next.deviceId(), OTHER_DEVICE_ID);
      yield* next.stop({ forget: false });
    }),
);

it.scoped("a stop without a departing account ends the cadence and forgets nothing", (t) =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() => temporaryDirectory(t));
    const { client, calls } = fakeClient({});
    const subject = yield* cadence(directory, client);
    yield* subject.start;
    yield* firstBeat(() => calls.length === 2);

    yield* subject.stop({ forget: false });

    yield* TestClock.adjust(Duration.millis(DEVICE_POLL_INTERVAL_MS));
    yield* settle();
    assert.deepEqual(
      calls.map((call) => call.kind),
      ["register", "poll"],
    );
    assert.equal(subject.standing, false);
    assert.equal(subject.deviceId(), DEVICE_ID);
  }),
);

it.scoped(
  "each poll moves last seen and carries the presence read at that poll, and a row the service no longer holds is registered again",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
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
      const subject = yield* cadence(
        directory,
        client,
        undefined,
        () => reports.shift() ?? PRESENT,
      );
      yield* subject.start;
      yield* firstBeat(() => calls.length === 2);

      yield* nextBeat(() => calls.length === 3);
      assert.deepEqual(calls.at(-1), { kind: "poll", body: { deviceId: DEVICE_ID, ...PRESENT } });

      yield* nextBeat(() => calls.length === 6);
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
      yield* subject.stop({ forget: false });
    }),
);

it.scoped(
  "a registration that did not land is tried again by the next beat, and a late answer installs nothing",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
      let answer: { deviceId: string } | undefined;
      const { client, calls } = fakeClient({ register: () => answer });
      const subject = yield* cadence(directory, client);

      yield* subject.start;
      yield* firstBeat(() => calls.length === 1);
      assert.equal(subject.deviceId(), undefined);
      assert.deepEqual(storedState(directory), { installationId: INSTALLATION_ID.toLowerCase() });

      answer = { deviceId: DEVICE_ID };
      yield* nextBeat(() => calls.length === 3);
      assert.deepEqual(
        calls.map((call) => call.kind),
        ["register", "register", "poll"],
      );
      assert.equal(subject.deviceId(), DEVICE_ID);
      yield* subject.stop({ forget: false });

      let release: (() => void) | undefined;
      let polls = 0;
      const slow: DeviceCadenceClient = {
        ...client,
        poll: () => {
          polls += 1;
          if (polls === 1) return Promise.resolve({ seen: true, ...HEADS });
          return new Promise((resolve) => {
            release = () => resolve({ seen: false, ...HEADS });
          });
        },
      };
      const racing = yield* cadence(directory, slow);
      yield* racing.start;
      yield* firstBeat(() => polls === 1);
      yield* TestClock.adjust(Duration.millis(DEVICE_POLL_INTERVAL_MS));
      yield* waitFor(() => polls === 2);
      yield* racing.stop({ forget: false });
      release?.();
      yield* settle();
      assert.equal(
        calls.filter((call) => call.kind === "register").length,
        2,
        "the stopped generation's unseen answer registers nothing",
      );
    }),
);

it.scoped("a beat that fails is reported and the cadence keeps its own beat", (t) =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() => temporaryDirectory(t));
    const reported: string[] = [];
    let failing = false;
    const { client, calls } = fakeClient({});
    const subject = yield* cadence(
      directory,
      client,
      undefined,
      () => {
        if (failing) throw new Error("the calendar could not be read");
        return PRESENT;
      },
      reported,
    );
    yield* subject.start;
    yield* firstBeat(() => calls.length === 2);
    assert.equal(reported.length, 0);

    failing = true;
    yield* TestClock.adjust(Duration.millis(DEVICE_POLL_INTERVAL_MS));
    yield* waitFor(() => reported.length === 1);
    assert.equal(reported.length, 1);

    failing = false;
    yield* nextBeat(() => calls.length === 3);
    assert.deepEqual(
      calls.map((call) => call.kind),
      ["register", "poll", "poll"],
    );
    yield* subject.stop({ forget: false });
  }),
);

it.scoped(
  "a registration still on the wire at sign-out lands before the next account registers",
  (t) =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => temporaryDirectory(t));
      let release: (() => void) | undefined;
      const ids = [DEVICE_ID, OTHER_DEVICE_ID];
      const { client, calls } = fakeClient({});
      const gated: DeviceCadenceClient = {
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
      const subject = yield* cadence(directory, gated);
      yield* subject.start;
      yield* firstBeat(() => calls.length === 1);
      yield* subject.stop({ forget: { accessToken: "leaving" } });

      yield* subject.start;
      yield* settle();
      assert.equal(calls.length, 1, "the next registration waits for the one on the wire");

      release?.();
      yield* firstBeat(() => calls.length === 3);
      assert.deepEqual(
        calls.map((call) => call.kind),
        ["register", "register", "poll"],
      );
      assert.equal(
        subject.deviceId(),
        OTHER_DEVICE_ID,
        "the row the new sign-in registered stands",
      );
      yield* subject.stop({ forget: false });
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
