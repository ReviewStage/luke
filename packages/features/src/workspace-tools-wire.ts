import { Schema as EffectSchema } from "effect";

export const RUN_ON_MAC_OFF = {
  MAC_AWAY: "mac-away",
} as const;

export type RunOnMacOff = (typeof RUN_ON_MAC_OFF)[keyof typeof RUN_ON_MAC_OFF];

const runOnMacOnSchema = EffectSchema.Struct({ on: EffectSchema.Literal(true) });

const runOnMacOffSchema = EffectSchema.Struct({
  on: EffectSchema.Literal(false),
  reason: EffectSchema.Literals(Object.values(RUN_ON_MAC_OFF)),
});

export const runOnMacStandingSchema = EffectSchema.Union([runOnMacOnSchema, runOnMacOffSchema]);

export type RunOnMacStanding = typeof runOnMacStandingSchema.Type;

export const workspaceToolsAnswerSchema = EffectSchema.Struct({
  tools: EffectSchema.Array(EffectSchema.String),
  runOnMac: runOnMacStandingSchema,
});

export type WorkspaceToolsAnswer = typeof workspaceToolsAnswerSchema.Type;
