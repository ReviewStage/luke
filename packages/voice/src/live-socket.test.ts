import assert from "node:assert/strict";
import { closeEvent, LIVE_SERVER_EVENT, type LiveServerEvent, thinkingAppend } from "@sidecar/live";
import { test } from "vitest";
import { holdSocket } from "./held-socket.js";
import { SOCKET_OPEN_FAULT, sidebandOverSocket, socketOpened } from "./live-socket.js";
import { FakeLiveSocket } from "./testing.js";

test("a sideband parses the socket's frames and drops reflected audio by type", () => {
  const socket = new FakeLiveSocket();
  const sideband = sidebandOverSocket(socket);
  const seen: LiveServerEvent[] = [];
  sideband.onEvent((event) => seen.push(event));

  socket.receive({
    type: LIVE_SERVER_EVENT.SESSION_STARTED,
    event_id: "ev_1",
    session: { id: "ls_1" },
  });
  socket.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audio: "AAAA" });
  socket.receive({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta: "AAAA" });
  socket.receiveText("not json");
  socket.receive({ type: "session.unknown" });
  socket.receive({
    type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
    event_id: "ev_2",
    delta: " hi",
    start_ms: 0,
    end_ms: 400,
  });

  assert.deepEqual(
    seen.map((event) => event.type),
    [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA],
  );
});

test("a sideband sends client events as JSON frames and closes the socket it stands on", () => {
  const socket = new FakeLiveSocket();
  const sideband = sidebandOverSocket(socket);
  const append = thinkingAppend({ eventId: "ev_a", delegationId: null, content: "roster" });

  sideband.send(append);
  sideband.send(closeEvent("ev_b"));
  sideband.close();

  assert.deepEqual(
    socket.sent.map((frame) => JSON.parse(frame)),
    [append, closeEvent("ev_b")],
  );
  assert.equal(socket.closedByClient, true);
});

test("a sideband's close listener follows the socket's and unsubscribes", () => {
  const socket = new FakeLiveSocket();
  const sideband = sidebandOverSocket(socket);
  const closes: Array<{ code?: number }> = [];
  const stop = sideband.onClose((close) => closes.push(close));

  socket.closeFromServer({ code: 1006 });
  stop();
  socket.closeFromServer({ code: 1000 });

  assert.deepEqual(closes, [{ code: 1006 }]);
});

test("an opening is a socket or one of the two faults", () => {
  assert.equal(socketOpened({ socket: holdSocket(new FakeLiveSocket()) }), true);
  assert.equal(socketOpened({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 }), false);
  assert.equal(socketOpened({ fault: SOCKET_OPEN_FAULT.NETWORK }), false);
});

test("a sideband holds what arrived before anyone listened and replays it to the first listener", () => {
  const socket = new FakeLiveSocket();
  const sideband = sidebandOverSocket(socket);
  socket.receive({
    type: LIVE_SERVER_EVENT.SESSION_STARTED,
    event_id: "ev_1",
    session: { id: "ls_1" },
  });
  socket.receive({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta: "AAAA" });
  socket.closeFromServer({ code: 1006 });

  const seen: LiveServerEvent[] = [];
  const closes: Array<{ code?: number }> = [];
  sideband.onEvent((event) => seen.push(event));
  sideband.onClose((close) => closes.push(close));
  const late: LiveServerEvent[] = [];
  sideband.onEvent((event) => late.push(event));

  assert.deepEqual(
    seen.map((event) => event.type),
    [LIVE_SERVER_EVENT.SESSION_STARTED],
  );
  assert.deepEqual(late, []);
  assert.deepEqual(closes, [{ code: 1006 }]);
});
