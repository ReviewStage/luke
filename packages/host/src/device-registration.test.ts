import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEVICE_PLATFORM } from "@sidecar/hosted";
import { drainMicrotasks, FakeClock } from "@sidecar/runtime/testing";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
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
import { temporaryDirectory } from "./testing/temporary-directory.js";

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
  clock: FakeClock,
  mint: () => string = () => INSTALLATION_ID,
  presence: () => DevicePresenceReport = () => PRESENT,
  reported: string[] = [],
) {
  return new DeviceRegistration({
    client,
    state: deviceStateFile(() => directory),
    mintInstallationId: mint,
    presence: async () => presence(),
    schedule: clock.schedule,
    cancel: clock.cancel,
    report: (message) => {
      reported.push(message);
    },
  });
}

function storedState(directory: string): DeviceState | undefined {
  const parsed: UnparsedWireValue = JSON.parse(
    fs.readFileSync(path.join(directory, DEVICE_STATE_FILE), "utf8"),
  );
  return isRecord(parsed) ? deviceStateFrom(parsed) : undefined;
}

test("a first start mints the installation id once, registers as a Mac, polls at once with the presence read, and keeps the row's id", async (t) => {
  const directory = await temporaryDirectory(t);
  const clock = new FakeClock();
  const { client, calls } = fakeClient({});
  const subject = registration(directory, client, clock);

  await subject.start();

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
  assert.deepEqual(clock.delays, [DEVICE_POLL_INTERVAL_MS]);

  await subject.start();
  assert.equal(calls.length, 2);
});

test("the installation id outlives a sign-out and a relaunch, so a re-sign-in re-keys the one row", async (t) => {
  const directory = await temporaryDirectory(t);
  const clock = new FakeClock();
  const first = fakeClient({});
  const subject = registration(directory, first.client, clock);
  await subject.start();
  await subject.stop({ forget: { accessToken: "leaving" } });

  assert.deepEqual(first.calls.at(-1), {
    kind: "forget",
    body: { deviceId: DEVICE_ID },
    departing: "leaving",
  });
  assert.deepEqual(storedState(directory), { installationId: INSTALLATION_ID.toLowerCase() });
  assert.equal(subject.standing, false);
  assert.equal(clock.armed(), 0);

  const relaunched = fakeClient({ register: () => ({ deviceId: OTHER_DEVICE_ID }) });
  const next = registration(directory, relaunched.client, clock, () => {
    throw new Error("a stored installation id is never minted again");
  });
  await next.start();
  assert.deepEqual(relaunched.calls[0]?.body, {
    platform: DEVICE_PLATFORM.MACOS,
    installationId: INSTALLATION_ID.toLowerCase(),
  });
  assert.equal(next.deviceId(), OTHER_DEVICE_ID);
});

test("a stop without a departing account disarms the beat and forgets nothing", async (t) => {
  const directory = await temporaryDirectory(t);
  const clock = new FakeClock();
  const { client, calls } = fakeClient({});
  const subject = registration(directory, client, clock);
  await subject.start();

  await subject.stop({ forget: false });

  assert.equal(clock.armed(), 0);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["register", "poll"],
  );
  assert.equal(subject.deviceId(), DEVICE_ID);
});

test("each poll moves last seen and carries the presence read at that poll, and a row the service no longer holds is registered again", async (t) => {
  const directory = await temporaryDirectory(t);
  const clock = new FakeClock();
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
    clock,
    undefined,
    () => reports.shift() ?? PRESENT,
  );
  await subject.start();

  await clock.advance(clock.now + DEVICE_POLL_INTERVAL_MS);
  assert.deepEqual(calls.at(-1), { kind: "poll", body: { deviceId: DEVICE_ID, ...PRESENT } });
  assert.equal(clock.armed(), 1);

  await clock.advance(clock.now + DEVICE_POLL_INTERVAL_MS);
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
  assert.equal(clock.armed(), 1);
});

test("a registration that did not land is tried again by the next beat, and a late answer installs nothing", async (t) => {
  const directory = await temporaryDirectory(t);
  const clock = new FakeClock();
  let answer: { deviceId: string } | undefined;
  const { client, calls } = fakeClient({ register: () => answer });
  const subject = registration(directory, client, clock);

  await subject.start();
  assert.equal(subject.deviceId(), undefined);
  assert.deepEqual(storedState(directory), { installationId: INSTALLATION_ID.toLowerCase() });

  answer = { deviceId: DEVICE_ID };
  await clock.advance(clock.now + DEVICE_POLL_INTERVAL_MS);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["register", "register", "poll"],
  );
  assert.equal(subject.deviceId(), DEVICE_ID);
  await subject.stop({ forget: false });

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
  const racing = registration(directory, slow, clock);
  await racing.start();
  const beat = clock.advance(clock.now + DEVICE_POLL_INTERVAL_MS);
  await racing.stop({ forget: false });
  release?.();
  await beat;
  assert.equal(
    calls.filter((call) => call.kind === "register").length,
    2,
    "the stopped generation's unseen answer registers nothing",
  );
  assert.equal(clock.armed(), 0);
});

test("a beat that fails is reported and the next one is armed, so the loop never ends on an error", async (t) => {
  const directory = await temporaryDirectory(t);
  const clock = new FakeClock();
  const reported: string[] = [];
  let failing = false;
  const { client, calls } = fakeClient({});
  const subject = registration(
    directory,
    client,
    clock,
    undefined,
    () => {
      if (failing) throw new Error("the calendar could not be read");
      return PRESENT;
    },
    reported,
  );
  await subject.start();
  assert.equal(reported.length, 0);

  failing = true;
  await clock.advance(clock.now + DEVICE_POLL_INTERVAL_MS);
  assert.equal(reported.length, 1);
  assert.equal(clock.armed(), 1);

  failing = false;
  await clock.advance(clock.now + DEVICE_POLL_INTERVAL_MS);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["register", "poll", "poll"],
  );
  assert.equal(clock.armed(), 1);
  await subject.stop({ forget: false });
});

test("a registration still on the wire at sign-out lands before the next account registers", async (t) => {
  const directory = await temporaryDirectory(t);
  const clock = new FakeClock();
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
  const subject = registration(directory, gated, clock);
  const departing = subject.start();
  await subject.stop({ forget: { accessToken: "leaving" } });

  const arriving = subject.start();
  await drainMicrotasks(20);
  assert.equal(calls.length, 1, "the next registration waits for the one on the wire");

  release?.();
  await departing;
  await arriving;
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["register", "register", "poll"],
  );
  assert.equal(subject.deviceId(), OTHER_DEVICE_ID, "the row the new sign-in registered stands");
  assert.equal(clock.armed(), 1);
});

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
