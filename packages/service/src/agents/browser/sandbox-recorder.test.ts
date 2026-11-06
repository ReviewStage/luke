import assert from "node:assert/strict";
import { test } from "vitest";
import {
  RECORDER_SOURCE,
  RECORDING_FAILURE,
  RECORDING_READ_EXIT,
  RECORDING_START_EXIT,
  RECORDING_START_OUTPUT,
  readRecording,
  recordingBytesOf,
  recordingStartOf,
  recordingStopOf,
  SANDBOX_RECORDING,
  startRecording,
} from "./sandbox-recorder.js";

const run = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: "" });

test("a start runs with the recorder's source, and its run says whether it started one", () => {
  const ask = startRecording(120, 4_000_000);

  assert.ok(ask.args.includes(RECORDER_SOURCE));
  assert.ok(ask.args.includes("120") && ask.args.includes("4000000"));
  assert.deepEqual(recordingStartOf(run(`${RECORDING_START_OUTPUT.STARTED}\n`)), {
    ok: true,
    running: false,
  });
  assert.deepEqual(recordingStartOf(run(`${RECORDING_START_OUTPUT.RUNNING}\n`)), {
    ok: true,
    running: true,
  });
  assert.deepEqual(recordingStartOf(run("", RECORDING_START_EXIT.NO_ENCODER)), {
    ok: false,
    exitCode: RECORDING_START_EXIT.NO_ENCODER,
  });
});

test("a stop's run is the video's length and size, a known failure, or an encoder that failed", () => {
  assert.deepEqual(recordingStopOf(run('{"ok":true,"seconds":8.3,"bytes":22237}\n')), {
    ok: true,
    seconds: 8.3,
    bytes: 22237,
  });
  assert.deepEqual(recordingStopOf(run('{"ok":false,"reason":"too-large","bytes":5000000}')), {
    ok: false,
    reason: RECORDING_FAILURE.TOO_LARGE,
    bytes: 5_000_000,
  });
  assert.deepEqual(recordingStopOf(run('{"ok":false,"reason":"none"}')), {
    ok: false,
    reason: RECORDING_FAILURE.NONE,
  });
  for (const odd of [run("not json"), run('{"ok":false,"reason":"gremlins"}'), run("", 1)]) {
    assert.deepEqual(recordingStopOf(odd), { ok: false, reason: RECORDING_FAILURE.ENCODER });
  }
});

test("a read prints the video's absolute path, then the video as base64, and its run is the path and the bytes or nothing", () => {
  const ask = readRecording(4_000_000);
  const video = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
  const path = `/home/vercel-sandbox/${SANDBOX_RECORDING.VIDEO}`;
  const printed = `${path}\n${Buffer.from(video).toString("base64")}`;

  assert.ok(
    ask.args.includes("4000001"),
    "it reads one byte past the bound, so a larger file shows",
  );
  assert.deepEqual(recordingBytesOf(run(printed), 4_000_000), { path, bytes: video });
  assert.equal(recordingBytesOf(run("", RECORDING_READ_EXIT.NO_VIDEO), 4_000_000), undefined);
  assert.equal(recordingBytesOf(run(printed), 6), undefined);
  assert.equal(
    recordingBytesOf(run(Buffer.from(video).toString("base64")), 4_000_000),
    undefined,
    "a read naming no path is no video an agent can post",
  );
});
