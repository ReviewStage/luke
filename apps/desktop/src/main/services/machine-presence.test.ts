import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";
import { createMachinePresence, type PresenceMonitor } from "./machine-presence";

function fakeMonitor(idleSeconds: () => number) {
  const emitter = new EventEmitter();
  const monitor: PresenceMonitor = {
    getSystemIdleTime: idleSeconds,
    on: (event: string, listener: () => void) => {
      emitter.on(event, listener);
    },
    removeListener: (event: string, listener: () => void) => {
      emitter.removeListener(event, listener);
    },
  };
  return { monitor, emitter };
}

test("the read is the monitor's idle time and the lock state kept from its edges, unlocked until told otherwise", async () => {
  let idle = 3;
  const { monitor, emitter } = fakeMonitor(() => idle);
  const presence = createMachinePresence(monitor);
  assert.deepEqual(presence.read(), { idleSeconds: 3, screenLocked: false });

  await presence.start();
  emitter.emit("lock-screen");
  idle = 400;
  assert.deepEqual(presence.read(), { idleSeconds: 400, screenLocked: true });
  emitter.emit("unlock-screen");
  assert.deepEqual(presence.read(), { idleSeconds: 400, screenLocked: false });
});

test("a stop gives back both listeners and forgets a lock it was told of", async () => {
  const { monitor, emitter } = fakeMonitor(() => 0);
  const presence = createMachinePresence(monitor);
  await presence.start();
  emitter.emit("lock-screen");
  await presence.stop();
  assert.equal(emitter.listenerCount("lock-screen"), 0);
  assert.equal(emitter.listenerCount("unlock-screen"), 0);
  assert.equal(presence.read().screenLocked, false);
  emitter.emit("lock-screen");
  assert.equal(presence.read().screenLocked, false);
  await presence.stop();
});
