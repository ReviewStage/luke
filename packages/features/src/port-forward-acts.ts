import { Schema as EffectSchema } from "effect";

export const PORT_FORWARD_STATE = {
  LISTENING: "listening",
  CONNECTED: "connected",
  UNAVAILABLE: "unavailable",
} as const;

export const portForwardSetParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  on: EffectSchema.Boolean,
});

const forwardedPortSchema = EffectSchema.Struct({
  port: EffectSchema.Int,
  localPort: EffectSchema.optional(EffectSchema.Int),
  state: EffectSchema.Literals(Object.values(PORT_FORWARD_STATE)),
});

export const portForwardingAnswerSchema = EffectSchema.Struct({
  on: EffectSchema.Boolean,
  running: EffectSchema.Boolean,
  ports: EffectSchema.Array(forwardedPortSchema),
});

export type PortForwardingAnswer = typeof portForwardingAnswerSchema.Type;

export const portForwardingSchema = EffectSchema.NullOr(
  EffectSchema.Struct({
    agentId: EffectSchema.NonEmptyString,
    ...portForwardingAnswerSchema.fields,
  }),
);

export type PortForwarding = typeof portForwardingSchema.Type;
