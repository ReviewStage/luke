#!/usr/bin/env node
/**
 * Sends a command to the dev harness socket of a running Luke instance.
 *
 * Usage:
 *   pnpm dev:emit session waiting    # push a waiting session (holds for developer)
 *   pnpm dev:emit session error      # push an error session
 *   pnpm dev:emit session finished   # push a finished session
 *   pnpm dev:emit capture on         # override: another app is using the mic
 *   pnpm dev:emit capture off        # override: mic is free
 *
 * The app must be running via ./scripts/run.sh. The socket path defaults to
 * .build/dev-harness.sock under the repo root (set by run.sh), or reads
 * LUKE_DEV_HARNESS_SOCK from the environment.
 */
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const socketPath =
  process.env.LUKE_DEV_HARNESS_SOCK ?? path.join(repoRoot, ".build", "dev-harness.sock");

const [cmd, arg] = process.argv.slice(2);

if (!cmd || !arg) {
  process.stderr.write(
    `Usage: pnpm dev:emit <cmd> <arg>

Commands:
  session waiting    Push a waiting session (holds for developer)
  session error      Push an error session
  session finished   Push a finished session
  capture on         Override: another app is using the microphone
  capture off        Override: microphone is free

The app must be running via ./scripts/run.sh.
`,
  );
  process.exit(1);
}

/** @type {object} */
let payload;
if (cmd === "session") {
  const valid = ["waiting", "error", "finished"];
  if (!valid.includes(arg)) {
    process.stderr.write(`session status must be one of: ${valid.join(", ")}\n`);
    process.exit(1);
  }
  payload = { cmd: "session", status: arg };
} else if (cmd === "capture") {
  if (arg !== "on" && arg !== "off") {
    process.stderr.write(`capture arg must be 'on' or 'off'\n`);
    process.exit(1);
  }
  payload = { cmd: "capture", on: arg === "on" };
} else {
  process.stderr.write(`Unknown command: ${cmd}\nRun with no args to see usage.\n`);
  process.exit(1);
}

const socket = net.createConnection(socketPath, () => {
  socket.write(`${JSON.stringify(payload)}\n`);
});
socket.setEncoding("utf8");
let buf = "";
socket.on("data", (chunk) => {
  buf += chunk;
  const nl = buf.indexOf("\n");
  if (nl === -1) return;
  let response;
  try {
    response = JSON.parse(buf.slice(0, nl));
  } catch {
    process.stderr.write(`Bad response from harness\n`);
    process.exit(1);
  }
  if (response.ok) {
    process.stdout.write(`ok\n`);
    process.exit(0);
  } else {
    process.stderr.write(`error: ${response.error}\n`);
    process.exit(1);
  }
});
socket.on("error", () => {
  process.stderr.write(
    `Could not connect to dev harness at ${socketPath}\nIs the app running? Start it with ./scripts/run.sh\n`,
  );
  process.exit(1);
});
