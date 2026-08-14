import assert from "node:assert/strict";
import test from "node:test";
import { CallPresence } from "../src/call-presence";
import { CALL_STATUS, type CallApp } from "../src/shared/contracts";

const HANGOVER_MS = 20;
const ZOOM: CallApp = { id: "us.zoom.xos", name: "zoom.us" };
const DICTATION: CallApp = { id: "com.example.dictation", name: "Dictation" };

function presence(): { presence: CallPresence; changes: string[]; arrived: CallApp[] } {
  const changes: string[] = [];
  const arrived: CallApp[] = [];
  return {
    presence: new CallPresence({
      onChanged: (status) => changes.push(status),
      onAppArrived: (app) => arrived.push(app),
      hangoverMs: HANGOVER_MS,
    }),
    changes,
    arrived,
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, HANGOVER_MS * 3));

test("an app on the microphone is a call, and is announced once", () => {
  const context = presence();
  context.presence.setReading({ running: false, apps: [] });
  assert.equal(context.presence.status, CALL_STATUS.OFF);

  context.presence.setReading({ running: true, apps: [ZOOM] });
  assert.equal(context.presence.status, CALL_STATUS.ON);
  assert.deepEqual(context.arrived, [ZOOM]);

  // Still there is not news. A countdown that restarted every second would
  // never run out.
  context.presence.setReading({ running: true, apps: [ZOOM] });
  assert.deepEqual(context.arrived, [ZOOM]);
});

test("an ignored app is neither a call nor worth asking about again", () => {
  const context = presence();
  context.presence.setIgnored([DICTATION]);
  context.presence.setReading({ running: true, apps: [DICTATION] });

  assert.equal(context.presence.status, CALL_STATUS.OFF);
  // Prompting again would be asking the developer to make the same decision
  // every time they dictated.
  assert.deepEqual(context.arrived, []);
});

test("ignoring an app mid-call ends the call", () => {
  const context = presence();
  context.presence.setReading({ running: true, apps: [DICTATION] });
  assert.equal(context.presence.status, CALL_STATUS.ON);

  context.presence.setIgnored([DICTATION]);
  assert.equal(context.presence.status, CALL_STATUS.OFF);
  assert.deepEqual(context.changes, [CALL_STATUS.ON, CALL_STATUS.OFF]);
});

test("one ignored app does not exempt the others on the device", () => {
  const context = presence();
  context.presence.setIgnored([DICTATION]);
  context.presence.setReading({ running: true, apps: [DICTATION, ZOOM] });

  assert.equal(context.presence.status, CALL_STATUS.ON);
  assert.deepEqual(context.arrived, [ZOOM]);
});

test("a device running with nobody nameable on it is unreadable, not a call", () => {
  const context = presence();
  context.presence.setReading({ running: true, apps: [] });

  // An unnamed process cannot be checked against the ignore list or against
  // Luke's own, so holding notices on it would be holding on a reading nothing
  // could refute.
  assert.equal(context.presence.status, CALL_STATUS.UNAVAILABLE);
  assert.deepEqual(context.arrived, []);
});

test("a microphone that never reports is not a Mac with nobody on a call", () => {
  const context = presence();
  context.presence.setReading(undefined);

  assert.equal(context.presence.status, CALL_STATUS.UNAVAILABLE);
  assert.deepEqual(context.changes, []);
});

test("Luke's own turn is not the developer joining a call", () => {
  const context = presence();
  context.presence.setReading({ running: false, apps: [] });
  context.presence.setExchangeActive(true);
  // The helper drops his processes by identifier; this is the second line, for
  // the case where the prefixes were wrong and he was named after all.
  context.presence.setReading({
    running: true,
    apps: [{ id: "com.github.Electron", name: "Luke" }],
  });

  assert.equal(context.presence.status, CALL_STATUS.OFF);
});

test("the device winding down after an exchange is not a call either", async () => {
  const context = presence();
  context.presence.setReading({ running: false, apps: [] });
  context.presence.setExchangeActive(true);
  context.presence.setReading({ running: true, apps: [ZOOM] });
  context.presence.setExchangeActive(false);

  assert.equal(context.presence.status, CALL_STATUS.OFF);

  await settled();
  // Once it has settled, a device still held really is somebody else.
  assert.equal(context.presence.status, CALL_STATUS.ON);
  assert.deepEqual(context.arrived, [ZOOM]);
});

test("a call that outlives an exchange is announced once, not once per turn", async () => {
  const context = presence();
  context.presence.setReading({ running: true, apps: [ZOOM] });
  assert.deepEqual(context.arrived, [ZOOM]);

  context.presence.setExchangeActive(true);
  context.presence.setExchangeActive(false);
  await settled();

  // Speaking to Luke mid-call must not make the call look new when he stops:
  // his turn changes whose device it is, not who else is on it.
  assert.equal(context.presence.status, CALL_STATUS.ON);
  assert.deepEqual(context.arrived, [ZOOM]);
});

test("a call ending and starting again is a fresh arrival", () => {
  const context = presence();
  context.presence.setReading({ running: true, apps: [ZOOM] });
  context.presence.setReading({ running: false, apps: [] });
  context.presence.setReading({ running: true, apps: [ZOOM] });

  assert.deepEqual(context.arrived, [ZOOM, ZOOM]);
  assert.deepEqual(context.changes, [CALL_STATUS.ON, CALL_STATUS.OFF, CALL_STATUS.ON]);
});
