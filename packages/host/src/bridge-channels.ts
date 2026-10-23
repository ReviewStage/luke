/**
 * bridge-channels.ts -- the IPC channel and transport of every call a window's preload bridge carries, and the act port's handshake: all the preload builds `window.luke` from.
 *
 * The preload runs before every window's page, so what it reads is held to
 * plain values: no guard, no Schema, and so no `effect`. What each call
 * carries and answers is `bridge.ts`'s, built over these channels, whose
 * guards main parses a window's arguments with and the page holds an answer
 * to (`guardedPreloadBridge`).
 */

/** How a call crosses: an invoke main answers, or a send nothing answers. */
export const BRIDGE_KIND = {
  INVOKE: "invoke",
  SEND: "send",
} as const;

export type BridgeKind = (typeof BRIDGE_KIND)[keyof typeof BRIDGE_KIND];

/** Each call of the bridge, by its method: how it crosses, and on which channel. */
export const BRIDGE_CHANNEL = {
  requestAppState: { kind: BRIDGE_KIND.INVOKE, channel: "app:state-request" },
  reportVoiceView: { kind: BRIDGE_KIND.SEND, channel: "app:report-voice-view" },
  recordAgentTrace: { kind: BRIDGE_KIND.SEND, channel: "app:record-agent-trace" },
  feedAvatar: { kind: BRIDGE_KIND.SEND, channel: "app:feed-avatar" },
  signalAvatarView: { kind: BRIDGE_KIND.SEND, channel: "app:signal-avatar-view" },
  notifyReady: { kind: BRIDGE_KIND.SEND, channel: "app:renderer-ready" },
  recordSurfaceEvent: { kind: BRIDGE_KIND.SEND, channel: "app:record-surface-event" },
} as const;

export type BridgeChannelMethod = keyof typeof BRIDGE_CHANNEL;

/** The act port's handshake, which the page and the preload each take their half of. */
export { ACT_PORT, actPortForwarder } from "./contract/kinds.js";

export function bridgeChannelEntries(): ReadonlyArray<
  [BridgeChannelMethod, (typeof BRIDGE_CHANNEL)[BridgeChannelMethod]]
> {
  // SAFETY: Object.entries only erases the literal keys already declared by BRIDGE_CHANNEL.
  return Object.entries(BRIDGE_CHANNEL) as Array<
    [BridgeChannelMethod, (typeof BRIDGE_CHANNEL)[BridgeChannelMethod]]
  >;
}
