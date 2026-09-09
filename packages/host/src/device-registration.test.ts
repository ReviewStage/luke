import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEVICE_PLATFORM } from "@sidecar/hosted";
import { drainMicrotasks, FakeClock, temporaryDirectory } from "@sidecar/runtime/testing";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import {
  DEVICE_HEARTBEAT_INTERVAL_MS,
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
  kind: "register" | "heartbeat" | "forget";
  body: unknown;
  departing?: string;
}

function fakeClient(answers: {
  register?: () => { deviceId: string } | undefined;
  heartbeat?: () => { seen: boolean } | undefined;
}) {
  const calls: Call[] = [];
  const client: DeviceRegistrationClient = {
    register: async (request) => {
      calls.push({ kind: "register", body: request });
      return answers.register ? answers.register() : { deviceId: DEVICE_ID };
    },
    heartbeat: async (request) => {
      calls.push({ kind: "heartbeat", body: request });
      return answers.heartbeat ? answers.heartbeat() : { seen: true };
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
) {
  return new DeviceRegistration({
    client,
    state: deviceStateFile(() => directory),
    mintInstallationId: mint,
    schedule: clock.scheduleTimer,
    cancel: clock.cancelTimer,
  });
}

function storedState(directory: string): DeviceState | undefined {
  const parsed: UnparsedWireValue = JSON.parse(
    fs.readFileSync(path.join(directory, DEVICE_STATE_FILE), "utf8"),
  );
  return isRecord(parsed) ? deviceStateFrom(parsed) : undefined;
}

test("a first start mints the installation id once, registers as a Mac, and keeps the row's id", async (t) => {
  const directory = temporaryDirectory(t);
  const clock = new FakeClock();
  const { client, calls } = fakeClient({});
  const subject = registration(directory, client, clock);

  await subject.start();

  assert.deepEqual(calls, [
    {
      kind: "register",
      body: { platform: DEVICE_PLATFORM.MACOS, installationId: INSTALLATION_ID.toLowerCase() },
    },
  ]);
  assert.deepEqual(storedState(directory), {
    installationId: INSTALLATION_ID.toLowerCase(),
    deviceId: DEVICE_ID,
  });
  assert.equal(subject.deviceId(), DEVICE_ID);
  assert.equal(subject.standing, true);
  assert.deepEqual(clock.delays, [DEVICE_HEARTBEAT_INTERVAL_MS]);

  await subject.start();
  assert.equal(calls.length, 1);
});

test("the installation id outlives a sign-out and a relaunch, so a re-sign-in re-keys the one row", async (t) => {
  const directory = temporaryDirectory(t);
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
  const directory = temporaryDirectory(t);
  const clock = new FakeClock();
  const { client, calls } = fakeClient({});
  const subject = registration(directory, client, clock);
  await subject.start();

  await subject.stop({ forget: false });

  assert.equal(clock.armed(), 0);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["register"],
  );
  assert.equal(subject.deviceId(), DEVICE_ID);
});

test("each beat moves last seen, and a row the service no longer holds is registered again", async (t) => {
  const directory = temporaryDirectory(t);
  const clock = new FakeClock();
  const seen = [true, false];
  const ids = [DEVICE_ID, OTHER_DEVICE_ID];
  const { client, calls } = fakeClient({
    register: () => ({ deviceId: ids.shift() ?? OTHER_DEVICE_ID }),
    heartbeat: () => ({ seen: seen.shift() ?? true }),
  });
  const subject = registration(directory, client, clock);
  await subject.start();

  await clock.advance(clock.instant + DEVICE_HEARTBEAT_INTERVAL_MS);
  assert.deepEqual(calls.at(-1), { kind: "heartbeat", body: { deviceId: DEVICE_ID } });
  assert.equal(clock.armed(), 1);

  await clock.advance(clock.instant + DEVICE_HEARTBEAT_INTERVAL_MS);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["register", "heartbeat", "heartbeat", "register"],
  );
  assert.equal(subject.deviceId(), OTHER_DEVICE_ID);
  assert.equal(clock.armed(), 1);
});

test("a registration that did not land is tried again by the next beat, and a late answer installs nothing", async (t) => {
  const directory = temporaryDirectory(t);
  const clock = new FakeClock();
  let answer: { deviceId: string } | undefined;
  const { client, calls } = fakeClient({ register: () => answer });
  const subject = registration(directory, client, clock);

  await subject.start();
  assert.equal(subject.deviceId(), undefined);
  assert.deepEqual(storedState(directory), { installationId: INSTALLATION_ID.toLowerCase() });

  answer = { deviceId: DEVICE_ID };
  await clock.advance(clock.instant + DEVICE_HEARTBEAT_INTERVAL_MS);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["register", "register"],
  );
  assert.equal(subject.deviceId(), DEVICE_ID);
  await subject.stop({ forget: false });

  let release: (() => void) | undefined;
  const slow: DeviceRegistrationClient = {
    ...client,
    heartbeat: () =>
      new Promise((resolve) => {
        release = () => resolve({ seen: false });
      }),
  };
  const racing = registration(directory, slow, clock);
  await racing.start();
  const beat = clock.advance(clock.instant + DEVICE_HEARTBEAT_INTERVAL_MS);
  await racing.stop({ forget: false });
  release?.();
  await beat;
  assert.equal(
    calls.filter((call) => call.kind === "register").length,
    3,
    "the stopped generation's unseen answer registers nothing",
  );
  assert.equal(clock.armed(), 0);
});

test("a registration still on the wire at sign-out lands before the next account registers", async (t) => {
  const directory = temporaryDirectory(t);
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
    ["register", "register"],
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
