import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/session";
import { isWireBoolean, isWireString } from "@sidecar/wire";
import { DevHarness } from "./dev-harness";

interface HarnessReply {
  ok: boolean;
  error?: string;
}

type SessionCommand = { cmd: "session"; status: string };
type CaptureCommand = { cmd: "capture"; on: boolean };
type BadCommand = { cmd: string };
type HarnessCommand = SessionCommand | CaptureCommand | BadCommand;

function tmpSocket(): string {
  return path.join(os.tmpdir(), `dev-harness-test-${process.pid}-${Date.now()}.sock`);
}

function send(socketPath: string, payload: HarnessCommand): Promise<HarnessReply> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.setEncoding("utf8");
    let buf = "";
    socket.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      try {
        // SAFETY: JSON.parse returns the runtime shape the harness sent; HarnessReply mirrors it.
        resolve(JSON.parse(buf.slice(0, nl)) as HarnessReply);
      } catch (err) {
        reject(err);
      }
    });
    socket.on("error", reject);
  });
}

test("session waiting sets observation and calls onSessionChanged", async () => {
  const socketPath = tmpSocket();
  let changed = 0;
  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {
      changed += 1;
    },
    onCaptureCommand: () => {},
  });
  harness.start();

  const reply = await send(socketPath, { cmd: "session", status: "waiting" });
  assert.deepEqual(reply, { ok: true });
  assert.equal(changed, 1);

  const observations = await harness.adapter.observe();
  const obs = observations.at(0);
  assert.ok(obs);
  assert.equal(obs.status, SESSION_STATUS.WAITING);
  assert.equal(obs.holdingForDeveloper, true);

  harness.stop();
});

test("session error sets error status", async () => {
  const socketPath = tmpSocket();
  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {},
    onCaptureCommand: () => {},
  });
  harness.start();

  await send(socketPath, { cmd: "session", status: "error" });
  const observations = await harness.adapter.observe();
  const obs = observations.at(0);
  assert.ok(obs);
  assert.equal(obs.status, SESSION_STATUS.ERROR);

  harness.stop();
});

test("session finished sets complete status with work-finished cause", async () => {
  const socketPath = tmpSocket();
  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {},
    onCaptureCommand: () => {},
  });
  harness.start();

  await send(socketPath, { cmd: "session", status: "finished" });
  const observations = await harness.adapter.observe();
  const obs = observations.at(0);
  assert.ok(obs);
  assert.equal(obs.status, SESSION_STATUS.COMPLETE);
  assert.equal(obs.completionCause, "work-finished");

  harness.stop();
});

test("capture command calls onCaptureCommand with boolean", async () => {
  const socketPath = tmpSocket();
  const captured: boolean[] = [];
  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {},
    onCaptureCommand: (on) => {
      captured.push(on);
    },
  });
  harness.start();

  const r1 = await send(socketPath, { cmd: "capture", on: true });
  assert.deepEqual(r1, { ok: true });
  const r2 = await send(socketPath, { cmd: "capture", on: false });
  assert.deepEqual(r2, { ok: true });
  assert.deepEqual(captured, [true, false]);

  harness.stop();
});

test("unknown cmd returns error", async () => {
  const socketPath = tmpSocket();
  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {},
    onCaptureCommand: () => {},
  });
  harness.start();

  const reply = await send(socketPath, { cmd: "explode" });
  assert.equal(reply.ok, false);
  assert.equal(isWireString(reply.error), true);

  harness.stop();
});

test("unknown session status returns error", async () => {
  const socketPath = tmpSocket();
  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {},
    onCaptureCommand: () => {},
  });
  harness.start();

  const reply = await send(socketPath, { cmd: "session", status: "bogus" });
  assert.equal(reply.ok, false);

  harness.stop();
});

test("capture with non-boolean on returns error", async () => {
  const socketPath = tmpSocket();
  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {},
    onCaptureCommand: () => {},
  });
  harness.start();

  // SAFETY: deliberately sending a malformed capture command to exercise error handling.
  const malformed = { cmd: "capture", on: "yes" } as unknown as CaptureCommand;
  const reply = await send(socketPath, malformed);
  assert.equal(reply.ok, false);
  assert.equal(isWireBoolean(reply.error), false);

  harness.stop();
});

test("stop removes the socket file", async () => {
  const socketPath = tmpSocket();
  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {},
    onCaptureCommand: () => {},
  });
  harness.start();
  // Wait for it to bind.
  await send(socketPath, { cmd: "session", status: "waiting" });

  harness.stop();
  assert.equal(fs.existsSync(socketPath), false);
});

test("start removes stale socket from previous run", async () => {
  const socketPath = tmpSocket();
  fs.writeFileSync(socketPath, "stale");

  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {},
    onCaptureCommand: () => {},
  });
  harness.start();
  // If the stale file blocked bind, this would throw.
  await send(socketPath, { cmd: "session", status: "waiting" });

  harness.stop();
});

test("adapter starts empty before any command", async () => {
  const socketPath = tmpSocket();
  const harness = new DevHarness({
    socketPath,
    onSessionChanged: () => {},
    onCaptureCommand: () => {},
  });
  harness.start();

  const observations = await harness.adapter.observe();
  assert.equal(observations.length, 0);

  harness.stop();
});
