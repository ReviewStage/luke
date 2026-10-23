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
 * page on screen draws, so the frames follow the tab the browser shows; and
 * it draws the agent's pointer into each page it records
 * (`RECORDING_CURSOR_SOURCE`), which the frames would otherwise lack. It
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
 * The agent's pointer, drawn into each page while it is recorded, since the
 * pointer the panel draws over the live view is no part of the page's
 * frames (`cloud-browser-cursor.tsx`): an arrow like the panel's, in a closed
 * shadow root on the document's root, hidden from the accessibility tree and
 * taking no pointer events, that follows the input the agent's actions
 * dispatch, which a page hears as a person's (`browser-agent-cdp.ts`), and
 * rings where it presses. The recorder adds it to every page it attaches to,
 * the document standing and each one after, and takes it out as it stops.
 */
export const RECORDING_CURSOR_SOURCE = `(function draw() {
  const root = document.documentElement;
  // A new document runs this before it has a root, so the pointer is drawn once it does.
  if (!root) return document.addEventListener("DOMContentLoaded", draw, { once: true });
  if (root.querySelector(":scope > [data-luke-recording-cursor]")) return;
  const svg = "http://www.w3.org/2000/svg";
  const host = document.createElement("div");
  host.setAttribute("data-luke-recording-cursor", "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;";
  const shadow = host.attachShadow({ mode: "closed" });
  const css = ".c{position:absolute;left:0;top:0;width:20px;height:20px;opacity:0;transition:transform .25s cubic-bezier(.2,.8,.2,1),opacity .15s;filter:drop-shadow(0 0 1.5px rgba(255,255,255,.9)) drop-shadow(0 1px 2px rgba(0,0,0,.35))}.c.on{opacity:1}.c svg{display:block;width:20px;height:20px;transform-origin:1px 1px;transition:transform .12s}.c.down svg{transform:scale(.82)}.r{position:absolute;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid rgba(25,113,194,.85);box-sizing:border-box;animation:r .5s ease-out forwards}@keyframes r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}";
  // A constructed sheet, since a page's own style-src may refuse a style element.
  if ("adoptedStyleSheets" in shadow && typeof CSSStyleSheet.prototype.replaceSync === "function") {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    shadow.append(style);
  }
  const arrow = document.createElement("div");
  arrow.className = "c";
  const icon = document.createElementNS(svg, "svg");
  icon.setAttribute("viewBox", "0 0 14 14");
  icon.setAttribute("width", "20");
  icon.setAttribute("height", "20");
  const path = document.createElementNS(svg, "path");
  path.setAttribute("d", "M1 1 11.94 6.29Q13.87 7.22 12.56 7.58L8.64 8.64 7.58 12.56Q7.22 13.87 6.29 11.94Z");
  path.setAttribute("fill", "#1f2328");
  path.setAttribute("stroke", "#fff");
  path.setAttribute("stroke-width", "1");
  icon.append(path);
  arrow.append(icon);
  shadow.append(arrow);
  root.append(host);
  const stop = new AbortController();
  const on = { capture: true, passive: true, signal: stop.signal };
  const place = (event) => {
    if (!host.isConnected) document.documentElement.append(host);
    arrow.style.transform = "translate(" + (event.clientX - 1) + "px," + (event.clientY - 1) + "px)";
    arrow.classList.add("on");
  };
  window.addEventListener("mousemove", place, on);
  window.addEventListener("wheel", place, on);
  window.addEventListener("mousedown", (event) => {
    place(event);
    arrow.classList.add("down");
    const ring = document.createElement("div");
    ring.className = "r";
    ring.style.left = event.clientX + "px";
    ring.style.top = event.clientY + "px";
    shadow.append(ring);
    setTimeout(() => ring.remove(), 600);
  }, on);
  window.addEventListener("mouseup", () => arrow.classList.remove("down"), on);
  host.addEventListener("luke-recording-stop", () => {
    stop.abort();
    host.remove();
  }, { once: true });
})();`;

/** Takes the pointer out of a page, its listeners with it. */
export const RECORDING_CURSOR_STOP =
  '(() => { const host = document.documentElement && document.documentElement.querySelector(":scope > [data-luke-recording-cursor]"); if (host) host.dispatchEvent(new Event("luke-recording-stop")); })();';

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
const CURSOR_SOURCE = ${JSON.stringify(RECORDING_CURSOR_SOURCE)};
const CURSOR_STOP = ${JSON.stringify(RECORDING_CURSOR_STOP)};
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
  for (const sessionId of casting) send("Runtime.evaluate", { expression: CURSOR_STOP }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 200));
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
      send("Page.enable", {}, sessionId);
      send("Page.addScriptToEvaluateOnNewDocument", { source: CURSOR_SOURCE, runImmediately: true }, sessionId);
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
