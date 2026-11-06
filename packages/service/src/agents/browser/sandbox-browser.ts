import { PLAYWRIGHT_PIN, SANDBOX_BROWSER_PIN } from "@repo/agent-runner/pins";
import { LINK_SANDBOX_STATE_FOLDER, SANDBOX_STATE_FOLDER } from "../sandbox-state-folder.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";

export const SANDBOX_BROWSER = {
  DEVTOOLS_PORT: SANDBOX_BROWSER_PIN.DEVTOOLS_PORT,
  DISPLAY: SANDBOX_BROWSER_PIN.DISPLAY,
  WIDTH: 1280,
  HEIGHT: 800,
  STATE_DIRECTORY: `${SANDBOX_STATE_FOLDER}/browser`,
  DISPLAY_WAIT_TENTHS: 50,
  DEVTOOLS_WAIT_TENTHS: 300,
} as const;

export const BROWSER_START_EXIT = {
  NO_CHROMIUM: 4,
  NO_DISPLAY: 5,
  NOT_STARTED: 6,
} as const;

export const BROWSER_START_OUTPUT = { ATTACHED: "attached", STARTED: "started" } as const;

const CHROMIUM_FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
] as const;

const PROFILE_PREFERENCES = {
  credentials_enable_service: false,
  profile: { password_manager_enabled: false },
} as const;

const START_SCRIPT = [
  "set -u",
  'port="$1" display="$2" width="$3" height="$4" state="$HOME/$5"',
  "shift 5",
  `(cd "$HOME" && ${LINK_SANDBOX_STATE_FOLDER})`,
  'profile="$state/profile"',
  'mkdir -p "$profile" && chmod 700 "$state"',
  'exec 9>"$state/start.lock"',
  "flock -w 60 9",
  `answers() { curl -fsS --max-time 1 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1; }`,
  `if answers; then echo ${BROWSER_START_OUTPUT.ATTACHED}; exit 0; fi`,
  `chrome=$(ls -d ${PLAYWRIGHT_PIN.BROWSERS}/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -n 1)`,
  `[ -n "$chrome" ] || chrome=$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -n 1)`,
  `[ -x "$chrome" ] || { echo 'no Chromium in the image' >&2; exit ${BROWSER_START_EXIT.NO_CHROMIUM}; }`,
  'xvfb_pid=$(cat "/tmp/.X$display-lock" 2>/dev/null | tr -d " ")',
  `if [ -z "$xvfb_pid" ] || [ "$(cat "/proc/$xvfb_pid/comm" 2>/dev/null)" != ${SANDBOX_BROWSER_PIN.XVFB} ]; then`,
  '  rm -f "/tmp/.X$display-lock" "/tmp/.X11-unix/X$display"',
  `  setsid ${SANDBOX_BROWSER_PIN.XVFB} ":$display" -screen 0 "$width"x"$height"x24 -nolisten tcp >"$state/xvfb.log" 2>&1 </dev/null 9>&- &`,
  "fi",
  "tries=0",
  `until [ -S "/tmp/.X11-unix/X$display" ]; do`,
  `  tries=$((tries + 1)); [ "$tries" -le ${SANDBOX_BROWSER.DISPLAY_WAIT_TENTHS} ] || { echo 'Xvfb did not start' >&2; exit ${BROWSER_START_EXIT.NO_DISPLAY}; }`,
  "  sleep 0.1",
  "done",
  'if [ ! -e "$profile/Default/Preferences" ]; then',
  '  mkdir -p "$profile/Default"',
  `  printf '%s' '${JSON.stringify(PROFILE_PREFERENCES)}' >"$profile/Default/Preferences"`,
  "fi",
  'rm -f "$profile/SingletonLock" "$profile/SingletonSocket" "$profile/SingletonCookie"',
  'DISPLAY=":$display" setsid "$chrome" --remote-debugging-port="$port" --remote-debugging-address=127.0.0.1 --user-data-dir="$profile" --window-size="$width,$height" "$@" about:blank >"$state/chromium.log" 2>&1 </dev/null 9>&- &',
  "tries=0",
  "until answers; do",
  `  tries=$((tries + 1)); [ "$tries" -le ${SANDBOX_BROWSER.DEVTOOLS_WAIT_TENTHS} ] || { echo 'Chromium did not start' >&2; tail -n 20 "$state/chromium.log" >&2; exit ${BROWSER_START_EXIT.NOT_STARTED}; }`,
  "  sleep 0.1",
  "done",
  `echo ${BROWSER_START_OUTPUT.STARTED}`,
].join("\n");

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

export const BRIDGE_WORD = { KEY: "bridge", READY: "ready", ERROR: "error" } as const;

export function startBrowser(): CommandAsk {
  return {
    command: "bash",
    args: [
      "-c",
      START_SCRIPT,
      "agent-browser",
      String(SANDBOX_BROWSER.DEVTOOLS_PORT),
      String(SANDBOX_BROWSER.DISPLAY),
      String(SANDBOX_BROWSER.WIDTH),
      String(SANDBOX_BROWSER.HEIGHT),
      SANDBOX_BROWSER.STATE_DIRECTORY,
      ...CHROMIUM_FLAGS,
    ],
  };
}

export function browserBridge(): CommandAsk {
  return {
    command: "node",
    args: ["--no-warnings", "-e", BRIDGE_SOURCE, String(SANDBOX_BROWSER.DEVTOOLS_PORT)],
  };
}

export type BrowserStart =
  | { readonly ok: true; readonly started: boolean }
  | { readonly ok: false; readonly exitCode: number };

export function browserStartOf(run: CommandRun): BrowserStart {
  if (run.exitCode !== 0) return { ok: false, exitCode: run.exitCode };
  return { ok: true, started: run.stdout.trim() === BROWSER_START_OUTPUT.STARTED };
}
