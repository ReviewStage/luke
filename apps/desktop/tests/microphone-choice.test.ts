import assert from "node:assert/strict";
import test from "node:test";
import {
  type EnumeratedMicrophone,
  listeningThroughDetail,
  MICROPHONE_PROCESSING,
  microphoneConstraints,
  openPreferredMicrophone,
  preferredBuiltInLabel,
} from "../src/renderer/microphone-choice";
import { LID_STATE, MICROPHONE_TRANSPORT, type MicrophoneRoute } from "../src/shared/contracts";

const BLUETOOTH_DEFAULT: MicrophoneRoute = {
  defaultTransport: MICROPHONE_TRANSPORT.BLUETOOTH,
  lid: LID_STATE.OPEN,
  builtInName: "MacBook Pro Microphone",
};

const DEVICES: readonly EnumeratedMicrophone[] = [
  { kind: "audioinput", label: "", deviceId: "default" },
  { kind: "audiooutput", label: "MacBook Pro Speakers", deviceId: "speakers" },
  { kind: "audioinput", label: "AirPods Pro", deviceId: "airpods" },
  { kind: "audioinput", label: "MacBook Pro Microphone (Built-in)", deviceId: "built-in-id" },
];

test("the capture never asks for echo cancellation", () => {
  // Half-duplex by construction means there is no echo to cancel, and the
  // constraint is what pulls macOS's own voice processing — the thing that
  // degrades every other app's audio — onto the capture.
  assert.equal(MICROPHONE_PROCESSING.echoCancellation, false);
  assert.equal(microphoneConstraints(undefined, DEVICES).echoCancellation, false);
});

test("a Bluetooth default with the lid open prefers the Mac's own microphone", () => {
  assert.equal(preferredBuiltInLabel(BLUETOOTH_DEFAULT), "MacBook Pro Microphone");
  assert.deepEqual(microphoneConstraints(BLUETOOTH_DEFAULT, DEVICES).deviceId, {
    exact: "built-in-id",
  });
});

test("a shut lid keeps the headset microphone, muffled beats degraded", () => {
  const shut = { ...BLUETOOTH_DEFAULT, lid: LID_STATE.SHUT };
  assert.equal(preferredBuiltInLabel(shut), undefined);
  assert.equal(microphoneConstraints(shut, DEVICES).deviceId, undefined);
});

test("a desktop with no lid to read counts as open", () => {
  const unknown = { ...BLUETOOTH_DEFAULT, lid: LID_STATE.UNKNOWN };
  assert.equal(preferredBuiltInLabel(unknown), "MacBook Pro Microphone");
});

test("a non-Bluetooth default is left exactly where the user put it", () => {
  for (const defaultTransport of [
    MICROPHONE_TRANSPORT.BUILT_IN,
    MICROPHONE_TRANSPORT.OTHER,
    MICROPHONE_TRANSPORT.NONE,
  ] as const) {
    assert.equal(preferredBuiltInLabel({ ...BLUETOOTH_DEFAULT, defaultTransport }), undefined);
  }
});

test("no route, no built-in, or no matching device all mean the default", () => {
  assert.equal(preferredBuiltInLabel(undefined), undefined);
  assert.equal(
    preferredBuiltInLabel({
      defaultTransport: MICROPHONE_TRANSPORT.BLUETOOTH,
      lid: LID_STATE.OPEN,
    }),
    undefined,
  );
  // The browser's list does not offer the named device: nothing to pin.
  assert.equal(microphoneConstraints(BLUETOOTH_DEFAULT, []).deviceId, undefined);
  // Labels hidden (no permission yet) cannot be matched either.
  assert.equal(
    microphoneConstraints(BLUETOOTH_DEFAULT, [
      { kind: "audioinput", label: "", deviceId: "mystery" },
    ]).deviceId,
    undefined,
  );
});

test("the opener pins the preferred device and reports what it asked for", async () => {
  const asked: MediaTrackConstraints[] = [];
  const stream = {} as MediaStream;

  const result = await openPreferredMicrophone({
    route: async () => BLUETOOTH_DEFAULT,
    enumerate: async () => DEVICES,
    open: async (audio) => {
      asked.push(audio);
      return stream;
    },
  });

  assert.equal(result, stream);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0]?.deviceId, { exact: "built-in-id" });
});

test("a pinned device that vanished falls back to the default, not a refusal", async () => {
  const asked: MediaTrackConstraints[] = [];
  const stream = {} as MediaStream;

  const result = await openPreferredMicrophone({
    route: async () => BLUETOOTH_DEFAULT,
    enumerate: async () => DEVICES,
    open: async (audio) => {
      asked.push(audio);
      if (audio.deviceId !== undefined) throw new Error("device vanished");
      return stream;
    },
  });

  assert.equal(result, stream);
  assert.equal(asked.length, 2);
  assert.equal(asked[1]?.deviceId, undefined);
});

test("an unreadable route is the browser's default, never a gate", async () => {
  const asked: MediaTrackConstraints[] = [];
  const stream = {} as MediaStream;

  const result = await openPreferredMicrophone({
    route: async () => {
      throw new Error("no bridge in this harness");
    },
    enumerate: async () => DEVICES,
    open: async (audio) => {
      asked.push(audio);
      return stream;
    },
  });

  assert.equal(result, stream);
  assert.deepEqual(asked, [{ ...MICROPHONE_PROCESSING }]);
});

test("the listens-through clause speaks only while the routing is in play", () => {
  assert.equal(
    listeningThroughDetail(BLUETOOTH_DEFAULT, true),
    "With a Bluetooth headset connected, Luke listens through the Mac's own microphone.",
  );
  assert.equal(
    listeningThroughDetail({ ...BLUETOOTH_DEFAULT, lid: LID_STATE.SHUT }, true),
    "With the lid shut, Luke listens through the Bluetooth headset.",
  );
  // Everywhere else the row reads exactly as it always did: the switch off,
  // no headset in play, no Mac microphone to stand in, or no route at all.
  assert.equal(listeningThroughDetail(BLUETOOTH_DEFAULT, false), undefined);
  assert.equal(
    listeningThroughDetail(
      { ...BLUETOOTH_DEFAULT, defaultTransport: MICROPHONE_TRANSPORT.BUILT_IN },
      true,
    ),
    undefined,
  );
  assert.equal(
    listeningThroughDetail(
      { defaultTransport: MICROPHONE_TRANSPORT.BLUETOOTH, lid: LID_STATE.OPEN },
      true,
    ),
    undefined,
  );
  assert.equal(listeningThroughDetail(undefined, true), undefined);
});

test("a default already on the Mac's microphone never enumerates at all", async () => {
  let enumerated = 0;
  await openPreferredMicrophone({
    route: async () => ({
      defaultTransport: MICROPHONE_TRANSPORT.BUILT_IN,
      lid: LID_STATE.OPEN,
      builtInName: "MacBook Pro Microphone",
    }),
    enumerate: async () => {
      enumerated += 1;
      return DEVICES;
    },
    open: async () => ({}) as MediaStream,
  });

  assert.equal(enumerated, 0);
});
