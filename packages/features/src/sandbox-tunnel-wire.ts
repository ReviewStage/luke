import { Schema as EffectSchema } from "effect";

export const SANDBOX_TUNNEL = {
  PATH: "/api/terminal/tunnels",
  QUERY: { AGENT: "agent", KIND: "kind", PORT: "port", WAKE: "wake" },
  WAKE_ASKED: "1",
} as const;

export const TUNNEL_KIND = {
  PORT_FORWARD: "port-forward",
  MIRROR: "mirror",
} as const;

export type TunnelKind = (typeof TUNNEL_KIND)[keyof typeof TUNNEL_KIND];

export const FORWARD_PORT = { MIN: 1024, MAX: 65_535 } as const;

export const TUNNEL_CLOSE = {
  IDLE: 4000,
  NOT_RUNNING: 4001,
  GONE: 4003,
  UNAVAILABLE: 4005,
} as const;

export const TUNNEL_FRAME = {
  OPEN: "open",
  DATA: "data",
  CLOSE: "close",
} as const;

export const TUNNEL_CLOSE_REASON = {
  REFUSED: "refused",
} as const;

const channel = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 0, maximum: 2 ** 31 - 1 }),
);

export const tunnelFrameSchema = EffectSchema.Union([
  EffectSchema.Struct({ type: EffectSchema.Literal(TUNNEL_FRAME.OPEN), channel }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(TUNNEL_FRAME.DATA),
    channel,
    data: EffectSchema.Uint8ArrayFromBase64,
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(TUNNEL_FRAME.CLOSE),
    channel,
    reason: EffectSchema.optional(EffectSchema.Literals(Object.values(TUNNEL_CLOSE_REASON))),
  }),
]);

export type TunnelFrame = typeof tunnelFrameSchema.Type;
