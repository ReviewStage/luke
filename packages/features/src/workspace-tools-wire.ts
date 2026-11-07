/**
 * workspace-tools-wire.ts -- whether an agent's `run_on_mac` would run, as its MCP popover reads it.
 *
 * `run_on_mac` is answered off where the service would refuse a call now:
 * no Mac of its task's assignee's listening. A new read, which a released
 * desktop never calls, so each field may change with the panel that reads
 * it.
 */

import { Schema as EffectSchema } from "effect";

/** Why the service would refuse the agent's `run_on_mac` now. */
export const RUN_ON_MAC_OFF = {
  /** No Mac of the member the agent's commands run on, its task's assignee, listened for commands lately. */
  MAC_AWAY: "mac-away",
} as const;

export type RunOnMacOff = (typeof RUN_ON_MAC_OFF)[keyof typeof RUN_ON_MAC_OFF];

const runOnMacOnSchema = EffectSchema.Struct({ on: EffectSchema.Literal(true) });

const runOnMacOffSchema = EffectSchema.Struct({
  on: EffectSchema.Literal(false),
  reason: EffectSchema.Literals(Object.values(RUN_ON_MAC_OFF)),
});

/** Whether `run_on_mac` would run for the agent now, and why not where it would not. */
export const runOnMacStandingSchema = EffectSchema.Union([runOnMacOnSchema, runOnMacOffSchema]);

export type RunOnMacStanding = typeof runOnMacStandingSchema.Type;

/** Where the agent's `run_on_mac` stands. */
export const workspaceToolsAnswerSchema = EffectSchema.Struct({
  runOnMac: runOnMacStandingSchema,
});

export type WorkspaceToolsAnswer = typeof workspaceToolsAnswerSchema.Type;
