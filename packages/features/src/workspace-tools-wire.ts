/**
 * workspace-tools-wire.ts -- which of our own tools an agent is offered, and whether `run_on_mac` would run for it, as its MCP popover reads them.
 *
 * The service answers by the same rules the agent's runtime narrows its
 * tools by (`packages/service/src/agents/workspace-tools.ts`), so the list is the
 * one the agent is handed, in its order: eve's tools for an agent on eve,
 * and the tools of our MCP server for one on Claude Code or Codex, whose
 * harness keeps its own shell and files. `run_on_mac` is answered off where
 * the service would refuse a call now: no Mac of its task's assignee's
 * listening. A new read, which a released desktop never
 * calls, so each field may change with the panel that reads it.
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
  /** The account whose Mac the agent's commands run on, its task's assignee or else its starter, so only that reader is told of their own Settings. */
  owner: EffectSchema.String,
});

/** Whether `run_on_mac` would run for the agent now, and why not where it would not. */
export const runOnMacStandingSchema = EffectSchema.Union([runOnMacOnSchema, runOnMacOffSchema]);

export type RunOnMacStanding = typeof runOnMacStandingSchema.Type;

/** Our tools the agent is offered, by name in the order it is offered them, and where its `run_on_mac` stands. */
export const workspaceToolsAnswerSchema = EffectSchema.Struct({
  tools: EffectSchema.Array(EffectSchema.String),
  runOnMac: runOnMacStandingSchema,
});

export type WorkspaceToolsAnswer = typeof workspaceToolsAnswerSchema.Type;
