/**
 * sandbox-browser.ts -- the commands that keep a Chromium running in an agent's sandbox, and the bridge that carries its DevTools protocol over a PTY's stdio.
 *
 * The browser is the full Chromium Playwright installs in the image
 * (`agent-runtime/sandbox.ts`), run headful on an Xvfb display of its own,
 * so a site sees an ordinary browser rather than a headless one. Its
 * DevTools port is bound to the sandbox's loopback alone and is never
 * exposed: Vercel Sandbox's exposed ports are public, so the service reaches
 * it through the sandbox's own PTY instead, where `BRIDGE_SOURCE` runs and
 * pipes one CDP message a line between its stdio and the browser's
 * WebSocket. The profile lives on the sandbox's disk, so its cookies and
 * logins outlive a stop, which snapshots that disk, and a resume.
 *
 * The start is one script run in the sandbox, idempotent and serialized by
 * a lock: a browser whose DevTools answers is attached to as it stands;
 * otherwise Xvfb is started where it is not running, the profile's
 * singleton locks a stopped sandbox left behind are cleared, and Chromium is
 * started detached in a session of its own, so it outlives the command, and
 * waited for until its DevTools answers. Everything it starts runs with
 * every capability dropped (`sandbox-capabilities.ts`), since the pages the
 * browser loads are no one's Luke vouches for. Every value the script reads
 * is a constant of this module, handed to it as a positional argument.
 */

import { WITHOUT_CAPABILITIES } from "../sandbox-capabilities.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";

export const SANDBOX_BROWSER = {
  /** The browser's DevTools port on the sandbox's loopback: apart from the 9222 an agent's own Chromium would take, and Node's inspector's 9229. */
  DEVTOOLS_PORT: 9333,
  /** The X display the browser draws on: apart from the `:99` an agent's own `xvfb-run -a` takes first. */
  DISPLAY: 77,
  /** The display's and the browser window's size. */
  WIDTH: 1280,
  HEIGHT: 800,
  /** Where the browser keeps its state under the sandbox user's home: its profile, its logs, and the start's lock. */
  STATE_DIRECTORY: ".luke/browser",
  /** How long the start waits on Xvfb's socket and on the browser's DevTools, in tenths of a second. */
  DISPLAY_WAIT_TENTHS: 50,
  DEVTOOLS_WAIT_TENTHS: 300,
} as const;

/** How the start ends: attached to a browser already running, or one it started; its exits apart from the shell's own. */
export const BROWSER_START_EXIT = {
  NO_CHROMIUM: 4,
  NO_DISPLAY: 5,
  NOT_STARTED: 6,
} as const;

/** What a start that succeeded prints: whether the browser was already running. */
export const BROWSER_START_OUTPUT = { ATTACHED: "attached", STARTED: "started" } as const;

/** Chromium's flags beyond its port, profile, and size: an ordinary window with no first-run pages, and a page in the background that keeps drawing, since someone may be watching it. */
const CHROMIUM_FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  // Note that Chromium's own sandbox needs user namespaces or a setuid helper, neither of which a capability-less user has; the Vercel Sandbox is the boundary, as it is for Playwright's own launches.
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--password-store=basic",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
] as const;

/**
 * The start, as positional parameters take it: the port, the display, the
 * width and height, the state directory under the home, then Chromium's
 * flags. It prints `BROWSER_START_OUTPUT` on success and a reason on
 * stderr with a `BROWSER_START_EXIT` otherwise.
 */
const START_SCRIPT = [
  "set -u",
  'port="$1" display="$2" width="$3" height="$4" state="$HOME/$5"',
  "shift 5",
  'profile="$state/profile"',
  'mkdir -p "$profile" && chmod 700 "$state"',
  // Note that what the start leaves running closes the lock's descriptor, which would otherwise hold the lock for as long as the browser runs.
  'exec 9>"$state/start.lock"',
  "flock -w 60 9",
  `answers() { curl -fsS --max-time 1 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1; }`,
  `if answers; then echo ${BROWSER_START_OUTPUT.ATTACHED}; exit 0; fi`,
  'chrome=$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -n 1)',
  `[ -x "$chrome" ] || { echo 'no Chromium in the image' >&2; exit ${BROWSER_START_EXIT.NO_CHROMIUM}; }`,
  // Xvfb by the pid it was started under, checked by name, since a resumed sandbox may have handed that pid to another process.
  'xvfb_pid=$(cat "$state/xvfb.pid" 2>/dev/null || true)',
  'if [ -z "$xvfb_pid" ] || [ "$(cat "/proc/$xvfb_pid/comm" 2>/dev/null)" != Xvfb ]; then',
  '  rm -f "/tmp/.X$display-lock" "/tmp/.X11-unix/X$display"',
  '  setsid Xvfb ":$display" -screen 0 "$width"x"$height"x24 -nolisten tcp >"$state/xvfb.log" 2>&1 </dev/null 9>&- &',
  '  echo $! >"$state/xvfb.pid"',
  "fi",
  "tries=0",
  `until [ -S "/tmp/.X11-unix/X$display" ]; do`,
  `  tries=$((tries + 1)); [ "$tries" -le ${SANDBOX_BROWSER.DISPLAY_WAIT_TENTHS} ] || { echo 'Xvfb did not start' >&2; exit ${BROWSER_START_EXIT.NO_DISPLAY}; }`,
  "  sleep 0.1",
  "done",
  // A stop snapshots the profile with the running browser's locks in it, which would refuse the next start.
  'rm -f "$profile/SingletonLock" "$profile/SingletonSocket" "$profile/SingletonCookie"',
  'DISPLAY=":$display" setsid "$chrome" --remote-debugging-port="$port" --remote-debugging-address=127.0.0.1 --user-data-dir="$profile" --window-size="$width,$height" "$@" about:blank >"$state/chromium.log" 2>&1 </dev/null 9>&- &',
  "tries=0",
  "until answers; do",
  `  tries=$((tries + 1)); [ "$tries" -le ${SANDBOX_BROWSER.DEVTOOLS_WAIT_TENTHS} ] || { echo 'Chromium did not start' >&2; tail -n 20 "$state/chromium.log" >&2; exit ${BROWSER_START_EXIT.NOT_STARTED}; }`,
  "  sleep 0.1",
  "done",
  `echo ${BROWSER_START_OUTPUT.STARTED}`,
].join("\n");

/**
 * The bridge, run by Node in the sandbox's PTY with the DevTools port as
 * its one argument. It puts the PTY in raw mode, so nothing it is sent is
 * echoed, buffered by line, or read as a signal, connects to the browser's
 * own WebSocket, and says it is ready; from then on each line it reads is
 * one CDP message sent on, and each message the browser sends is written as
 * one line. A message is JSON, which holds no raw line break, so stripping
 * one keeps it whole; the PTY may still turn a written `\n` into `\r\n`,
 * which the reader drops. Its own word is a line with a `bridge` key.
 */
export const BRIDGE_SOURCE = `"use strict";
const port = process.argv[1];
const say = (word) => process.stdout.write(JSON.stringify(word) + "\\n");
const fail = (reason) => { say({ bridge: "error", reason }); process.exit(1); };
if (process.stdin.isTTY) process.stdin.setRawMode(true);
fetch("http://127.0.0.1:" + port + "/json/version").then((answer) => answer.json()).then((version) => {
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  socket.onopen = () => {
    say({ bridge: "ready" });
    let held = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      held += chunk;
      for (let at = held.indexOf("\\n"); at >= 0; at = held.indexOf("\\n")) {
        const line = held.slice(0, at).replace(/\\r$/, "");
        held = held.slice(at + 1);
        if (line !== "") socket.send(line);
      }
    });
    process.stdin.on("end", () => process.exit(0));
  };
  socket.onmessage = (event) => process.stdout.write(String(event.data).replace(/[\\r\\n]/g, "") + "\\n");
  socket.onclose = () => process.exit(0);
  socket.onerror = () => fail("socket");
}, () => fail("unreachable"));
`;

/** The bridge's own word: ready, or why it could not be. */
export const BRIDGE_WORD = { KEY: "bridge", READY: "ready", ERROR: "error" } as const;

/** Makes sure the browser runs, starting it where it does not; read its run with `browserStartOf`. */
export function startBrowser(): CommandAsk {
  return {
    command: WITHOUT_CAPABILITIES.COMMAND,
    args: [
      ...WITHOUT_CAPABILITIES.ARGS,
      "bash",
      "-c",
      START_SCRIPT,
      "luke-browser",
      String(SANDBOX_BROWSER.DEVTOOLS_PORT),
      String(SANDBOX_BROWSER.DISPLAY),
      String(SANDBOX_BROWSER.WIDTH),
      String(SANDBOX_BROWSER.HEIGHT),
      SANDBOX_BROWSER.STATE_DIRECTORY,
      ...CHROMIUM_FLAGS,
    ],
  };
}

/** The bridge, as the PTY's start frame runs it: Node with no capabilities, its source inline. */
export function browserBridge(): CommandAsk {
  return {
    command: WITHOUT_CAPABILITIES.COMMAND,
    args: [
      ...WITHOUT_CAPABILITIES.ARGS,
      "node",
      "--no-warnings",
      "-e",
      BRIDGE_SOURCE,
      String(SANDBOX_BROWSER.DEVTOOLS_PORT),
    ],
  };
}

/** What a start's run says: whether it started the browser, or which of its exits it ended on. */
export type BrowserStart =
  | { readonly ok: true; readonly started: boolean }
  | { readonly ok: false; readonly exitCode: number };

export function browserStartOf(run: CommandRun): BrowserStart {
  if (run.exitCode !== 0) return { ok: false, exitCode: run.exitCode };
  return { ok: true, started: run.stdout.trim() === BROWSER_START_OUTPUT.STARTED };
}
