import assert from "node:assert/strict";
import { LIVE_CLIENT_EVENT, LIVE_CLOSE_REASON, type LiveServerEvent } from "@sidecar/live";
import { test } from "vitest";
import { sidebandOverSocket } from "../live-socket.js";
import { drainMicrotasks, FakeClock, FakeLiveSocket } from "../testing.js";
import {
  closeGracefully,
  SIDEBAND_CLOSE_OUTCOME,
  SIDEBAND_CLOSE_TIMEOUT_MS,
} from "./graceful-close.js";

function closedEvent(reason: string, seconds: number) {
  return {
    type: "session.closed",
    event_id: "closed",
    reason,
    usage: { seconds },
  };
}

test("a graceful close registers the closed listener, sends session.close, and holds the socket until the final event", async () => {
  const socket = new FakeLiveSocket();
  const sideband = sidebandOverSocket(socket);
  const clock = new FakeClock();
  const heard: LiveServerEvent[] = [];
  sideband.onEvent((event) => heard.push(event));
  const closing = closeGracefully(sideband, {
    eventId: "close-1",
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  await drainMicrotasks();
  assert.deepEqual(
    socket.sent.map((frame) => JSON.parse(frame)),
    [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "close-1" }],
  );
  assert.equal(socket.closedByClient, false);
  assert.deepEqual(clock.delays, [SIDEBAND_CLOSE_TIMEOUT_MS]);
  socket.receive(closedEvent(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 61));
  const result = await closing;
  assert.equal(result.outcome, SIDEBAND_CLOSE_OUTCOME.CLOSED);
  if (result.outcome !== SIDEBAND_CLOSE_OUTCOME.CLOSED) return;
  assert.deepEqual(
    [result.closed.reason, result.closed.usage.seconds],
    [LIVE_CLOSE_REASON.CLOSE_REQUESTED, 61],
  );
  assert.equal(socket.closedByClient, true);
  assert.equal(clock.armed(), 0);
});

test("a socket that ends first leaves the close unconfirmed, and silence gives up at the timeout", async () => {
  const lost = new FakeLiveSocket();
  const clock = new FakeClock();
  const losing = closeGracefully(sidebandOverSocket(lost), {
    eventId: "c",
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  lost.closeFromServer({ code: 1006 });
  assert.deepEqual(await losing, {
    outcome: SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST,
    close: { code: 1006 },
  });

  const silent = new FakeLiveSocket();
  const timing = closeGracefully(sidebandOverSocket(silent), {
    eventId: "c",
    schedule: clock.schedule,
    cancel: clock.cancel,
    timeoutMs: 50,
  });
  await clock.advance(clock.now + 50);
  assert.deepEqual(await timing, { outcome: SIDEBAND_CLOSE_OUTCOME.TIMED_OUT });
  assert.equal(silent.closedByClient, true);
});
