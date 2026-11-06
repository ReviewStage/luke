import { TUNNEL_KIND, type TunnelKind } from "@repo/features/sandbox-tunnel-wire";
import { CODER } from "../agents/coder-host/bounds.js";
import type { CommandAsk } from "../agents/vercel-sandbox-api.js";
import { MIRROR_BRIDGE_SOURCE } from "./mirror-bridge.js";

export type TunnelBridge =
  | { readonly kind: typeof TUNNEL_KIND.PORT_FORWARD; readonly port: number }
  | {
      readonly kind: typeof TUNNEL_KIND.MIRROR;
      readonly wake: boolean;
    };

export const TUNNEL_BRIDGE_WORD = { KEY: "bridge", READY: "ready" } as const;

export const TUNNEL_HOLDS_SANDBOX = {
  [TUNNEL_KIND.PORT_FORWARD]: true,
  [TUNNEL_KIND.MIRROR]: false,
} as const satisfies Record<TunnelKind, boolean>;

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

function scriptOf(bridge: TunnelBridge): readonly [string, string] {
  switch (bridge.kind) {
    case TUNNEL_KIND.PORT_FORWARD:
      return [PORT_BRIDGE_SOURCE, String(bridge.port)];
    case TUNNEL_KIND.MIRROR:
      return [MIRROR_BRIDGE_SOURCE, CODER.CHECKOUT_PATH];
  }
}

export function tunnelBridge(bridge: TunnelBridge): CommandAsk {
  return {
    command: "node",
    args: ["--no-warnings", "-e", ...scriptOf(bridge)],
  };
}
