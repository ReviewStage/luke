import { PLAYWRIGHT_PIN } from "@repo/agent-runner/pins";
import { LINK_SANDBOX_STATE_FOLDER } from "../sandbox-state-folder.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";
import { RECORDING_CURSOR_SOURCE, RECORDING_CURSOR_STOP } from "./recording-cursor.js";
import { SANDBOX_BROWSER } from "./sandbox-browser.js";

export const SANDBOX_RECORDING = {
  DIRECTORY: `${SANDBOX_BROWSER.STATE_DIRECTORY}/recording`,
  VIDEO: `${SANDBOX_BROWSER.STATE_DIRECTORY}/recording/recording.webm`,
  READY_WAIT_TENTHS: 50,
  DONE_WAIT_TENTHS: 800,
} as const;

export const RECORDING_START_EXIT = {
  NO_ENCODER: 4,
  NOT_STARTED: 5,
} as const;

export const RECORDING_SCRIPT_NAME = "agent-recording";

export const RECORDING_START_OUTPUT = { STARTED: "started", RUNNING: "running" } as const;

export const RECORDING_PAINTED_SOURCE =
  'performance.getEntriesByName("first-contentful-paint").length > 0';

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
const contexts = new Map();
const pages = new Map();
const answers = new Map();
let ended = false;
let next = 0;
const CURSOR_SOURCE = ${JSON.stringify(RECORDING_CURSOR_SOURCE)};
const CURSOR_STOP = ${JSON.stringify(RECORDING_CURSOR_STOP)};
const PAINTED_SOURCE = ${JSON.stringify(RECORDING_PAINTED_SOURCE)};
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
  // Every frame the pointer was drawn into is cleaned, not the main frame alone.
  for (const [sessionId, ids] of contexts) {
    for (const contextId of ids) send("Runtime.evaluate", { expression: CURSOR_STOP, contextId }, sessionId);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  try { socket.close(); } catch {}
  if (frames.length === 0) return end({ ok: false, reason: "empty" });
  // A frame a page drew before it had content is left out, unless no frame had any.
  const drawn = frames.filter((frame) => frame.painted);
  if (drawn.length > 0) frames.splice(0, frames.length, ...drawn);
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
  const send = (method, params, sessionId, answered) => {
    next += 1;
    const message = { id: next, method, params };
    if (sessionId !== undefined) message.sessionId = sessionId;
    if (answered) answers.set(next, answered);
    try { socket.send(JSON.stringify(message)); } catch {}
  };
  // Asks the page, every tenth of a second until it says yes, whether it has drawn content since it last navigated.
  // Note that a yes marks the page's latest frame rather than the one asked about, because a page records its first paint only after the frame that shows it.
  const askPainted = (sessionId, page) => {
    if (page.asking || page.painted || pages.get(sessionId) !== page) return;
    page.asking = true;
    const navigation = page.navigation;
    send("Runtime.evaluate", { expression: PAINTED_SOURCE, returnByValue: true }, sessionId, (answer) => {
      page.asking = false;
      if (page.navigation === navigation && answer.result?.result?.value === true) {
        page.painted = true;
        if (page.latest) page.latest.painted = true;
        return;
      }
      setTimeout(() => askPainted(sessionId, page), page.navigation === navigation ? 100 : 0);
    });
  };
  const markPainted = (frame, sessionId) => {
    const page = pages.get(sessionId);
    if (!page) {
      frame.painted = true;
      return;
    }
    page.latest = frame;
    frame.painted = page.painted;
    askPainted(sessionId, page);
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
    if (message.id !== undefined) {
      const answered = answers.get(message.id);
      answers.delete(message.id);
      if (answered) answered(message);
    } else if (message.method === "Target.attachedToTarget" && message.params.targetInfo.type === "page") {
      const sessionId = message.params.sessionId;
      casting.add(sessionId);
      pages.set(sessionId, { painted: false, navigation: 0, asking: false, latest: undefined });
      send("Page.enable", {}, sessionId);
      contexts.set(sessionId, new Set());
      send("Runtime.enable", {}, sessionId);
      send("Page.addScriptToEvaluateOnNewDocument", { source: CURSOR_SOURCE, runImmediately: true }, sessionId);
      send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: width, maxHeight: height }, sessionId);
    } else if (message.method === "Runtime.executionContextCreated") {
      const context = message.params.context;
      if (context.auxData && context.auxData.isDefault) contexts.get(message.sessionId)?.add(context.id);
    } else if (message.method === "Runtime.executionContextDestroyed") {
      contexts.get(message.sessionId)?.delete(message.params.executionContextId);
    } else if (message.method === "Runtime.executionContextsCleared") {
      contexts.get(message.sessionId)?.clear();
    } else if (message.method === "Page.frameNavigated" && !message.params.frame.parentId) {
      const page = pages.get(message.sessionId);
      if (page) {
        page.painted = false;
        page.latest = undefined;
        page.navigation += 1;
      }
    } else if (message.method === "Target.detachedFromTarget") {
      casting.delete(message.params.sessionId);
      contexts.delete(message.params.sessionId);
      pages.delete(message.params.sessionId);
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
      const frame = held ?? { at, tick, file };
      if (held) held.at = at;
      else frames.push(frame);
      markPainted(frame, message.sessionId);
    }
  };
  socket.onclose = () => finish(socket, send);
  socket.onerror = () => undefined;
}, () => end({ ok: false, reason: "unreachable" }));
`;

export const RECORDING_FAILURE = {
  NONE: "none",
  EMPTY: "empty",
  ENCODER: "encoder",
  TOO_LARGE: "too-large",
  UNREACHABLE: "unreachable",
  SLOW: "slow",
} as const;

export type RecordingFailure = (typeof RECORDING_FAILURE)[keyof typeof RECORDING_FAILURE];

const RECORDER_ALIVE =
  'alive() { pid=$(cat "$dir/pid" 2>/dev/null); [ -n "$pid" ] && grep -qaF -- "$dir" "/proc/$pid/cmdline" 2>/dev/null; }';

const START_SCRIPT = [
  "set -u",
  'port="$1" state="$HOME/$2" max="$3" bytes="$4" width="$5" height="$6" source="$7"',
  `(cd "$HOME" && ${LINK_SANDBOX_STATE_FOLDER})`,
  'dir="$state/recording"',
  RECORDER_ALIVE,
  'mkdir -p "$state" && chmod 700 "$state"',
  `if [ ! -e "$dir/done.json" ] && alive; then echo ${RECORDING_START_OUTPUT.RUNNING}; exit 0; fi`,
  `encoder=$(ls ${PLAYWRIGHT_PIN.BROWSERS}/ffmpeg-*/ffmpeg-linux 2>/dev/null | sort -V | tail -n 1)`,
  `[ -n "$encoder" ] || encoder=$(ls "$HOME"/.cache/ms-playwright/ffmpeg-*/ffmpeg-linux 2>/dev/null | sort -V | tail -n 1)`,
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

const STOP_SCRIPT = [
  "set -u",
  'dir="$HOME/$1/recording" tenths="$2"',
  `(cd "$HOME" && ${LINK_SANDBOX_STATE_FOLDER})`,
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
  'cat "$dir/done.json"',
].join("\n");

export function startRecording(maxSeconds: number, maxBytes: number): CommandAsk {
  return {
    command: "bash",
    args: [
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

export function stopRecording(): CommandAsk {
  return {
    command: "bash",
    args: [
      "-c",
      STOP_SCRIPT,
      RECORDING_SCRIPT_NAME,
      SANDBOX_BROWSER.STATE_DIRECTORY,
      String(SANDBOX_RECORDING.DONE_WAIT_TENTHS),
    ],
  };
}

export const RECORDING_READ_EXIT = { NO_VIDEO: 3 } as const;

export function readRecording(maxBytes: number): CommandAsk {
  return {
    command: "bash",
    args: [
      "-c",
      `f="$HOME/$1"; [ -f "$f" ] || exit ${RECORDING_READ_EXIT.NO_VIDEO}; printf '%s\\n' "$f"; head -c "$2" -- "$f" | base64 | tr -d '\\n'`,
      RECORDING_SCRIPT_NAME,
      SANDBOX_RECORDING.VIDEO,
      String(maxBytes + 1),
    ],
  };
}

export interface RecordingFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export function recordingBytesOf(run: CommandRun, maxBytes: number): RecordingFile | undefined {
  if (run.exitCode !== 0) return undefined;
  const lineEnd = run.stdout.indexOf("\n");
  if (lineEnd < 0) return undefined;
  const path = run.stdout.slice(0, lineEnd);
  const bytes = new Uint8Array(Buffer.from(run.stdout.slice(lineEnd + 1).trim(), "base64"));
  if (!path.startsWith("/") || bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    return undefined;
  }
  return { path, bytes };
}

export type RecordingStart =
  | { readonly ok: true; readonly running: boolean }
  | { readonly ok: false; readonly exitCode: number };

export function recordingStartOf(run: CommandRun): RecordingStart {
  if (run.exitCode !== 0) return { ok: false, exitCode: run.exitCode };
  return { ok: true, running: run.stdout.trim() === RECORDING_START_OUTPUT.RUNNING };
}

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
