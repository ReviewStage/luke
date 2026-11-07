/**
 * bridge.ts -- the bridges a tunnel reaches in an agent's sandbox, by kind: the script each runs in the sandbox's PTY, and whether its traffic holds the sandbox.
 *
 * A bridge is one Node script run in the running sandbox session's PTY,
 * as the agent's browser bridge is (`agents/browser/sandbox-browser.ts`):
 * it puts the PTY in raw mode, so nothing it is sent is echoed, buffered
 * by line, or read as a signal, says it is ready, and from then on speaks
 * the tunnel's channel frames (`@repo/features/sandbox-tunnel-wire`) one
 * JSON line each way. A PTY is not binary-safe, so a channel's bytes cross
 * base64-encoded, and a line is JSON, which holds no raw line break; the
 * PTY may still turn a written `\n` into `\r\n`, which each reader drops.
 *
 * The port bridge opens a TCP connection to the port on the sandbox's
 * loopback for each channel opened, closes the connection when its channel
 * closes and the channel when its connection does, and closes a channel
 * whose port nothing listens on as refused. The mirror bridge
 * (`mirror-bridge.ts`) runs at the agent's checkout and sends its files to
 * the Mac on the one channel the Mac opens.
 */

import { TUNNEL_KIND, type TunnelKind } from "@repo/features/sandbox-tunnel-wire";
import { CODER } from "../agents/coder-host/bounds.js";
import type { CommandAsk } from "../agents/vercel-sandbox-api.js";
import { MIRROR_BRIDGE_SOURCE } from "./mirror-bridge.js";

/** A bridge a tunnel asks for: its kind, and the argument that kind takes. */
export type TunnelBridge =
  | { readonly kind: typeof TUNNEL_KIND.PORT_FORWARD; readonly port: number }
  | {
      readonly kind: typeof TUNNEL_KIND.MIRROR;
      /** Whether a stopped sandbox is resumed for the mirror, as the Mac asks while it has no worktree yet. */
      readonly wake: boolean;
    };

/** The bridge's own word, a line with a `bridge` key: ready, from then on speaking frames, or failed at the step it names, as it exits. */
export const TUNNEL_BRIDGE_WORD = { KEY: "bridge", READY: "ready", FAILED: "failed" } as const;

/**
 * Whether a kind's traffic holds the agent's sandbox, keeping it alive and
 * moving its lease on: a forwarded port's does, since someone is using the
 * app it serves; the mirror's does not, since it only follows the agent's
 * work, and pauses when the sandbox stops after a turn.
 */
export const TUNNEL_HOLDS_SANDBOX = {
  [TUNNEL_KIND.PORT_FORWARD]: true,
  [TUNNEL_KIND.MIRROR]: false,
} as const satisfies Record<TunnelKind, boolean>;

/** The port bridge, as Node runs it with the port as its one argument. */
export const PORT_BRIDGE_SOURCE = `"use strict";
const net = require("node:net");
const port = Number(process.argv[1]);
const channels = new Map();
const say = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const ended = (channel, reason) => {
  if (!channels.delete(channel)) return;
  say(reason === undefined ? { type: "close", channel } : { type: "close", channel, reason });
};
const open = (channel) => {
  if (channels.has(channel)) return;
  const socket = net.connect(port, "127.0.0.1");
  let refused = false;
  channels.set(channel, socket);
  socket.on("data", (bytes) => say({ type: "data", channel, data: bytes.toString("base64") }));
  socket.on("error", (error) => { refused = error.code === "ECONNREFUSED"; });
  socket.on("close", () => ended(channel, refused ? "refused" : undefined));
};
const send = (channel, data) => channels.get(channel)?.write(Buffer.from(data, "base64"));
const close = (channel) => {
  const socket = channels.get(channel);
  if (socket === undefined) return;
  channels.delete(channel);
  socket.end(() => socket.destroy());
};
const take = (line) => {
  let frame;
  try { frame = JSON.parse(line); } catch { return; }
  if (frame === null || typeof frame !== "object" || !Number.isInteger(frame.channel)) return;
  if (frame.type === "open") open(frame.channel);
  else if (frame.type === "data" && typeof frame.data === "string") send(frame.channel, frame.data);
  else if (frame.type === "close") close(frame.channel);
};
let held = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  held += chunk;
  for (let at = held.indexOf("\\n"); at >= 0; at = held.indexOf("\\n")) {
    const line = held.slice(0, at).replace(/\\r$/, "");
    held = held.slice(at + 1);
    if (line !== "") take(line);
  }
});
process.stdin.on("end", () => {
  for (const socket of channels.values()) socket.destroy();
  process.exit(0);
});
say({ bridge: "ready" });
`;

/** A bridge's source and its one argument: the port it forwards, or the checkout it mirrors. */
function scriptOf(bridge: TunnelBridge): readonly [string, string] {
  switch (bridge.kind) {
    case TUNNEL_KIND.PORT_FORWARD:
      return [PORT_BRIDGE_SOURCE, String(bridge.port)];
    case TUNNEL_KIND.MIRROR:
      return [MIRROR_BRIDGE_SOURCE, CODER.CHECKOUT_PATH];
  }
}

/** The bridge a tunnel asks for, as the PTY's start frame runs it: Node, its source inline. */
export function tunnelBridge(bridge: TunnelBridge): CommandAsk {
  return {
    command: "node",
    args: ["--no-warnings", "-e", ...scriptOf(bridge)],
  };
}
