import assert from "node:assert/strict";
import { test } from "vitest";
import {
  RECORDER_SOURCE,
  RECORDING_FAILURE,
  RECORDING_START_EXIT,
  RECORDING_START_OUTPUT,
  recordingStartOf,
  recordingStopOf,
  startRecording,
  stopRecording,
} from "./sandbox-recorder.js";

/**
 * sandbox-recorder.test.ts -- the recording's commands as the sandbox runs
 * them and their runs as the service reads them: a start that started, one
 * left running, and one that failed; a stop's video, its known failures, and
 * anything else read as an encoder that failed. The scripts themselves run
 * only in a sandbox, beside the browser and the encoder.
 */

const run = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: "" });

test("a start runs without capabilities with the recorder's source, and its run says whether it started one", () => {
  const ask = startRecording(120, 4_000_000);

  assert.equal(ask.command, "setpriv");
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
  assert.equal(stopRecording().command, "setpriv");
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
