/**
 * workspace-tools-wire.ts -- whose Mac an agent's `run_on_mac` runs on, and whether it would run there now, as the agent's composer reads it.
 *
 * The Mac is its task's assignee's, or else its starter's. `run_on_mac` is
 * answered off where the service would refuse a call now: no Mac of that
 * member's listening. An agent its catalog offers no `run_on_mac`, one that
 * runs on a device, is answered nothing. A new read, which a released
 * desktop never calls, so each field may change with the panel that reads
 * it.
 */

import { Schema as EffectSchema } from "effect";

/** Why the service would refuse the agent's `run_on_mac` now. */
export const RUN_ON_MAC_OFF = {
  /** No Mac of the member the agent's commands run on listened for commands lately. */
  MAC_AWAY: "mac-away",
} as const;

export type RunOnMacOff = (typeof RUN_ON_MAC_OFF)[keyof typeof RUN_ON_MAC_OFF];

/** The member whose Mac the agent's commands run on. */
const runOnMacOwnerSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  name: EffectSchema.String,
});

const runOnMacOnSchema = EffectSchema.Struct({
  on: EffectSchema.Literal(true),
  owner: runOnMacOwnerSchema,
});

const runOnMacOffSchema = EffectSchema.Struct({
  on: EffectSchema.Literal(false),
  reason: EffectSchema.Literals(Object.values(RUN_ON_MAC_OFF)),
  owner: runOnMacOwnerSchema,
});

/** Whose Mac `run_on_mac` runs on, whether it would run there now, and why not where it would not. */
export const runOnMacStandingSchema = EffectSchema.Union([runOnMacOnSchema, runOnMacOffSchema]);

export type RunOnMacStanding = typeof runOnMacStandingSchema.Type;

/** Where the agent's `run_on_mac` stands; nothing for an agent offered none. */
export const workspaceToolsAnswerSchema = EffectSchema.Struct({
  runOnMac: EffectSchema.optionalKey(runOnMacStandingSchema),
});

export type WorkspaceToolsAnswer = typeof workspaceToolsAnswerSchema.Type;
