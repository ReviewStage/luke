/**
 * luke-tools-wire.ts -- which of Luke's own tools an agent is offered, and whether `run_on_mac` would run for it, as its MCP popover reads them.
 *
 * The service answers by the same rules the agent's runtime narrows its
 * tools by (`packages/service/src/agents/luke-tools.ts`), so the list is the
 * one the agent is handed, in its order: eve's tools for an agent on eve,
 * and the tools of Luke's MCP server for one on Claude Code or Codex, whose
 * harness keeps its own shell and files. `run_on_mac` is answered off where
 * the service would refuse a call now: no Mac of the starter's listening,
 * or words someone other than the starter put into the agent's
 * conversation, with what kind of sender put the first of them there and
 * when, where the line says. A new read, which a released desktop never
 * calls, so each field may change with the panel that reads it.
 */

import { Schema as EffectSchema } from "effect";
import { MESSAGE_SENDER } from "./agent-wire.js";
import { countedNumber } from "./service-wire.js";

/** Why the service would refuse the agent's `run_on_mac` now. */
export const RUN_ON_MAC_OFF = {
  /** No Mac of the agent's starter listened for commands lately. */
  MAC_AWAY: "mac-away",
  /** Someone other than the starter put words into the agent's conversation. */
  OUTSIDE_WORDS: "outside-words",
} as const;

export type RunOnMacOff = (typeof RUN_ON_MAC_OFF)[keyof typeof RUN_ON_MAC_OFF];

const runOnMacOnSchema = EffectSchema.Struct({ on: EffectSchema.Literal(true) });

const runOnMacOffSchema = EffectSchema.Struct({
  on: EffectSchema.Literal(false),
  reason: EffectSchema.Literals(Object.values(RUN_ON_MAC_OFF)),
  /** What kind of sender put the first outside words in; absent for a line kept before senders were, and for every other reason. */
  from: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(MESSAGE_SENDER))),
  /** Epoch milliseconds the first outside words were put in; absent for every other reason. */
  at: EffectSchema.optionalKey(countedNumber),
});

/** Whether `run_on_mac` would run for the agent now, and why not where it would not. */
export const runOnMacStandingSchema = EffectSchema.Union([runOnMacOnSchema, runOnMacOffSchema]);

export type RunOnMacStanding = typeof runOnMacStandingSchema.Type;

/** The agent's Luke tools, by name in the order it is offered them, and where its `run_on_mac` stands. */
export const lukeToolsAnswerSchema = EffectSchema.Struct({
  tools: EffectSchema.Array(EffectSchema.String),
  runOnMac: runOnMacStandingSchema,
});

export type LukeToolsAnswer = typeof lukeToolsAnswerSchema.Type;
