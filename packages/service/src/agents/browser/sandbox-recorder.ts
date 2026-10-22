/**
 * sandbox-recorder.ts -- the commands that record an agent's browser as a video in its sandbox: a recorder started beside the browser, stopped and encoded on the agent's word, and the video's file the service reads back.
 *
 * A browser call's DevTools session lasts that call alone (`browser-tool.ts`),
 * so a recording, which spans the calls between `record` and
 * `stop_recording`, runs in the sandbox instead: `RECORDER_SOURCE`, run by
 * Node detached from the command that starts it, attaches to every page the
 * browser holds and every page it opens, has each cast its frames
 * (`Page.startScreencast`), as the live view does (`browser-live/relay.ts`),
 * and writes to disk the latest frame of each tenth of a second, with the
 * time the browser drew it, so a page that redraws fast costs no more than
 * the video's own rate; the frames go once encoded. Only a
 * page on screen draws, so the frames follow the tab the browser shows. It
 * stops when the stop file appears or its time runs out, whichever comes
 * first, then re-times the frames to a steady rate, holding each until the
 * next, and encodes them as a VP9 WebM with the ffmpeg Playwright installs
 * beside its Chromium, at ever smaller sizes until one fits the byte bound,
 * and writes what came of it to `done.json`.
 *
 * Both scripts run with every capability dropped, as the browser does
 * (`sandbox-capabilities.ts`), and keep the recording under the browser's
 * own state directory, which a new recording clears. The recorder dies
 * with the sandbox, so a recording not stopped before the agent's turn
 * ends is lost. Every value a script reads is a constant of this module or
 * a bound it is handed, as a positional argument.
 */

import { WITHOUT_CAPABILITIES } from "../sandbox-capabilities.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";
import { SANDBOX_BROWSER } from "./sandbox-browser.js";

/** Where a recording is kept under the sandbox user's home, and the files it is made of. */
export const SANDBOX_RECORDING = {
  DIRECTORY: `${SANDBOX_BROWSER.STATE_DIRECTORY}/recording`,
  /** The video, once encoded, as the service reads it back. */
  VIDEO: `${SANDBOX_BROWSER.STATE_DIRECTORY}/recording/recording.webm`,
  /** How long the start waits on the recorder to reach the browser, in tenths of a second. */
  READY_WAIT_TENTHS: 50,
  /** How long the stop waits on the encoding, in tenths of a second: inside the action's own bound. */
  DONE_WAIT_TENTHS: 800,
} as const;

/** How a start ends, apart from the shell's own exits. */
export const RECORDING_START_EXIT = {
  NO_ENCODER: 4,
  NOT_STARTED: 5,
} as const;

/** The name both scripts run under, as `$0`. */
export const RECORDING_SCRIPT_NAME = "luke-recording";

/** What a start that succeeded prints: a recording it started, or one that already runs. */
export const RECORDING_START_OUTPUT = { STARTED: "started", RUNNING: "running" } as const;

/**
 * The recorder, run by Node with the DevTools port, its directory, its most
 * seconds and bytes, the encoder, and the frame's most width and height as
 * its arguments. It writes `ready` once it reaches the browser, and
 * `done.json` once it has stopped: the video's seconds and bytes, or why
 * there is none (`RECORDING_FAILURE`).
 */
export const RECORDER_SOURCE = `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const [port, dir, maxSecondsArg, maxBytesArg, ffmpeg, widthArg, heightArg] = process.argv.slice(1);
const maxSeconds = Number(maxSecondsArg);
const maxBytes = Number(maxBytesArg);
const width = Number(widthArg);
const height = Number(heightArg);
const FPS = 10;
const TAIL_SECONDS = 0.5;
const frames = [];
const casting = new Set();
let ended = false;
let next = 0;
const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
const end = (word) => {
  fs.rmSync(path.join(dir, "frames"), { recursive: true, force: true });
  write("done.json", word);
  process.exit(0);
};
const encode = (out, crf, scale) =>
  new Promise((resolve) => {
    const args = ["-loglevel", "error", "-f", "image2pipe", "-avioflags", "direct", "-fpsprobesize", "0", "-probesize", "32", "-analyzeduration", "0", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0", "-an"];
    args.push("-vf", scale ? "scale=-2:" + scale : "scale=trunc(iw/2)*2:trunc(ih/2)*2");
    args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-deadline", "realtime", "-speed", "8", "-row-mt", "1", "-y", out);
    const child = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "inherit"] });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    const first = frames[0].at;
    const last = frames[frames.length - 1].at + TAIL_SECONDS;
    let index = 0;
    const feed = async () => {
      for (let tick = 0; first + tick / FPS <= last; tick += 1) {
        const at = first + tick / FPS;
        while (index + 1 < frames.length && frames[index + 1].at <= at) index += 1;
        if (!child.stdin.write(fs.readFileSync(frames[index].file))) await new Promise((r) => child.stdin.once("drain", r));
      }
      child.stdin.end();
    };
    child.stdin.on("error", () => undefined);
    feed().catch(() => child.stdin.destroy());
  });
const finish = async (socket, send) => {
  if (ended) return;
  ended = true;
  for (const sessionId of casting) send("Page.stopScreencast", {}, sessionId);
  try { socket.close(); } catch {}
  if (frames.length === 0) return end({ ok: false, reason: "empty" });
  const seconds = Math.round((frames[frames.length - 1].at - frames[0].at + TAIL_SECONDS) * 10) / 10;
  const out = path.join(dir, "recording.webm");
  for (const [crf, scale] of [[36, 0], [44, 600], [52, 400]]) {
    if (!(await encode(out, crf, scale))) return end({ ok: false, reason: "encoder" });
    const bytes = fs.statSync(out).size;
    if (bytes <= maxBytes) return end({ ok: true, seconds, bytes });
  }
  return end({ ok: false, reason: "too-large", seconds, bytes: fs.statSync(out).size });
};
fetch("http://127.0.0.1:" + port + "/json/version").then((answer) => answer.json()).then((version) => {
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  const send = (method, params, sessionId) => {
    next += 1;
    const message = { id: next, method, params };
    if (sessionId !== undefined) message.sessionId = sessionId;
    try { socket.send(JSON.stringify(message)); } catch {}
  };
  const started = Date.now();
  socket.onopen = () => {
    send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
    write("ready", { at: started });
    setInterval(() => {
      if (fs.existsSync(path.join(dir, "stop")) || Date.now() - started > maxSeconds * 1000) finish(socket, send);
    }, 200);
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Target.attachedToTarget" && message.params.targetInfo.type === "page") {
      const sessionId = message.params.sessionId;
      casting.add(sessionId);
      send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: width, maxHeight: height }, sessionId);
    } else if (message.method === "Target.detachedFromTarget") {
      casting.delete(message.params.sessionId);
    } else if (message.method === "Page.screencastFrame") {
      send("Page.screencastFrameAck", { sessionId: message.params.sessionId }, message.sessionId);
      if (ended) return;
      const at = message.params.metadata.timestamp;
      const tick = Math.floor(at * FPS);
      const last = frames[frames.length - 1];
      // Only the latest frame of each tick of the output's rate is kept, so a page that redraws fast costs no more disk than the video's own rate.
      const held = last !== undefined && last.tick === tick ? last : undefined;
      const file = held ? held.file : path.join(dir, "frames", String(frames.length).padStart(6, "0") + ".jpg");
      fs.writeFileSync(file, Buffer.from(message.params.data, "base64"));
      if (held) held.at = at;
      else frames.push({ at, tick, file });
    }
  };
  socket.onclose = () => finish(socket, send);
  socket.onerror = () => undefined;
}, () => end({ ok: false, reason: "unreachable" }));
`;

/** Why a recording came to no video, as `done.json` and the stop say. */
export const RECORDING_FAILURE = {
  /** No recording runs or waits to be read. */
  NONE: "none",
  /** The browser drew nothing while it ran. */
  EMPTY: "empty",
  /** The encoder failed. */
  ENCODER: "encoder",
  /** No size the recorder tried fit the byte bound. */
  TOO_LARGE: "too-large",
  /** The recorder never reached the browser. */
  UNREACHABLE: "unreachable",
  /** The encoding did not finish within the stop's wait. */
  SLOW: "slow",
} as const;

export type RecordingFailure = (typeof RECORDING_FAILURE)[keyof typeof RECORDING_FAILURE];

/**
 * Whether the recorder the pid file names still runs: checked by the
 * directory its command line names, since a resumed sandbox may have handed
 * the pid to another process, and Node names its own main thread.
 */
const RECORDER_ALIVE =
  'alive() { pid=$(cat "$dir/pid" 2>/dev/null); [ -n "$pid" ] && grep -qaF -- "$dir" "/proc/$pid/cmdline" 2>/dev/null; }';

/**
 * The start, as positional parameters take it: the port, the browser's
 * state directory under the home, the most seconds and bytes, the frame's
 * width and height, and the recorder's source. A recording that already
 * runs is left to run.
 */
const START_SCRIPT = [
  "set -u",
  'port="$1" state="$HOME/$2" max="$3" bytes="$4" width="$5" height="$6" source="$7"',
  'dir="$state/recording"',
  RECORDER_ALIVE,
  'mkdir -p "$state" && chmod 700 "$state"',
  `if [ ! -e "$dir/done.json" ] && alive; then echo ${RECORDING_START_OUTPUT.RUNNING}; exit 0; fi`,
  'encoder=$(ls "$HOME"/.cache/ms-playwright/ffmpeg-*/ffmpeg-linux 2>/dev/null | sort -V | tail -n 1)',
  `[ -x "$encoder" ] || { echo 'no encoder in the image' >&2; exit ${RECORDING_START_EXIT.NO_ENCODER}; }`,
  'rm -rf "$dir" && mkdir -p "$dir" && chmod 700 "$dir"',
  'setsid node --no-warnings -e "$source" "$port" "$dir" "$max" "$bytes" "$encoder" "$width" "$height" >"$dir/recorder.log" 2>&1 </dev/null &',
  'echo "$!" >"$dir/pid"',
  "tries=0",
  'until [ -e "$dir/ready" ] || [ -e "$dir/done.json" ]; do',
  `  tries=$((tries + 1)); [ "$tries" -le ${SANDBOX_RECORDING.READY_WAIT_TENTHS} ] || { echo 'the recorder did not start' >&2; exit ${RECORDING_START_EXIT.NOT_STARTED}; }`,
  "  sleep 0.1",
  "done",
  `[ -e "$dir/ready" ] && [ ! -e "$dir/done.json" ] || { echo 'the recorder could not reach the browser' >&2; exit ${RECORDING_START_EXIT.NOT_STARTED}; }`,
  `echo ${RECORDING_START_OUTPUT.STARTED}`,
].join("\n");

/**
 * The stop, as positional parameters take it: the browser's state directory
 * under the home, and how long to wait on the encoding. It prints what came
 * of the recording as JSON, as often as it is asked until the next
 * recording starts, so a video the service could not read or keep is read
 * again on the next stop, and kept once, since the transcript keeps a video
 * once by its bytes.
 */
const STOP_SCRIPT = [
  "set -u",
  'dir="$HOME/$1/recording" tenths="$2"',
  RECORDER_ALIVE,
  'if [ ! -e "$dir/done.json" ]; then',
  `  alive || { echo '{"ok":false,"reason":"${RECORDING_FAILURE.NONE}"}'; exit 0; }`,
  '  touch "$dir/stop"',
  "  tries=0",
  '  until [ -e "$dir/done.json" ]; do',
  `    tries=$((tries + 1)); [ "$tries" -le "$tenths" ] || { echo '{"ok":false,"reason":"${RECORDING_FAILURE.SLOW}"}'; exit 0; }`,
  "    sleep 0.1",
  "  done",
  "fi",
  // Note that what came of it is left in place, so a stop whose video could not be read or kept just then reads it again; the next recording clears it.
  'cat "$dir/done.json"',
].join("\n");

/** Starts a recording of the browser, where none runs; read its run with `recordingStartOf`. */
export function startRecording(maxSeconds: number, maxBytes: number): CommandAsk {
  return {
    command: WITHOUT_CAPABILITIES.COMMAND,
    args: [
      ...WITHOUT_CAPABILITIES.ARGS,
      "bash",
      "-c",
      START_SCRIPT,
      RECORDING_SCRIPT_NAME,
      String(SANDBOX_BROWSER.DEVTOOLS_PORT),
      SANDBOX_BROWSER.STATE_DIRECTORY,
      String(maxSeconds),
      String(maxBytes),
      String(SANDBOX_BROWSER.WIDTH),
      String(SANDBOX_BROWSER.HEIGHT),
      RECORDER_SOURCE,
    ],
  };
}

/** Stops the recording and waits on its video; read its run with `recordingStopOf`. */
export function stopRecording(): CommandAsk {
  return {
    command: WITHOUT_CAPABILITIES.COMMAND,
    args: [
      ...WITHOUT_CAPABILITIES.ARGS,
      "bash",
      "-c",
      STOP_SCRIPT,
      RECORDING_SCRIPT_NAME,
      SANDBOX_BROWSER.STATE_DIRECTORY,
      String(SANDBOX_RECORDING.DONE_WAIT_TENTHS),
    ],
  };
}

/** How a read ends where there is no video to read. */
export const RECORDING_READ_EXIT = { NO_VIDEO: 3 } as const;

/**
 * Reads the video back, up to the bytes given and one past them, as base64
 * on one line, with every capability dropped as the sandbox's other file
 * reads are (`luke-mcp/sandbox-door.ts`); read its run with
 * `recordingBytesOf`.
 */
export function readRecording(maxBytes: number): CommandAsk {
  return {
    command: WITHOUT_CAPABILITIES.COMMAND,
    args: [
      ...WITHOUT_CAPABILITIES.ARGS,
      "bash",
      "-c",
      `f="$HOME/$1"; [ -f "$f" ] || exit ${RECORDING_READ_EXIT.NO_VIDEO}; head -c "$2" -- "$f" | base64 | tr -d '\\n'`,
      RECORDING_SCRIPT_NAME,
      SANDBOX_RECORDING.VIDEO,
      String(maxBytes + 1),
    ],
  };
}

/** The video's bytes as a read printed them; nothing where there was none, or where it ran past the bytes given. */
export function recordingBytesOf(run: CommandRun, maxBytes: number): Uint8Array | undefined {
  if (run.exitCode !== 0) return undefined;
  const bytes = new Uint8Array(Buffer.from(run.stdout.trim(), "base64"));
  return bytes.byteLength === 0 || bytes.byteLength > maxBytes ? undefined : bytes;
}

/** What a start's run says: a recording started, one already running, or which of its exits it ended on. */
export type RecordingStart =
  | { readonly ok: true; readonly running: boolean }
  | { readonly ok: false; readonly exitCode: number };

export function recordingStartOf(run: CommandRun): RecordingStart {
  if (run.exitCode !== 0) return { ok: false, exitCode: run.exitCode };
  return { ok: true, running: run.stdout.trim() === RECORDING_START_OUTPUT.RUNNING };
}

/** What a stop's run says: the video's length and size, or why there is none. */
export type RecordingStop =
  | { readonly ok: true; readonly seconds: number; readonly bytes: number }
  | { readonly ok: false; readonly reason: RecordingFailure; readonly bytes?: number };

const FAILURES: ReadonlySet<string> = new Set(Object.values(RECORDING_FAILURE));

export function recordingStopOf(run: CommandRun): RecordingStop {
  const failedRun: RecordingStop = { ok: false, reason: RECORDING_FAILURE.ENCODER };
  if (run.exitCode !== 0) return failedRun;
  let said: unknown;
  try {
    said = JSON.parse(run.stdout.trim());
  } catch {
    return failedRun;
  }
  if (typeof said !== "object" || said === null) return failedRun;
  const word = said as { ok?: unknown; seconds?: unknown; bytes?: unknown; reason?: unknown };
  if (word.ok === true && typeof word.seconds === "number" && typeof word.bytes === "number") {
    return { ok: true, seconds: word.seconds, bytes: word.bytes };
  }
  const reason =
    typeof word.reason === "string" && FAILURES.has(word.reason)
      ? (word.reason as RecordingFailure)
      : RECORDING_FAILURE.ENCODER;
  return typeof word.bytes === "number"
    ? { ok: false, reason, bytes: word.bytes }
    : { ok: false, reason };
}
