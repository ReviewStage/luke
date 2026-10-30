/**
 * agent-enter.ts -- what Enter does in an agent's message box while its turn runs: steer the turn, or queue the message behind it.
 *
 * ⌘↩ (Ctrl+↩ elsewhere) does the other, holding ⌘ turns Send into the
 * other's button, and a touch held on Send sends the other way. With no turn
 * running, either key just sends, opening a turn.
 */

import type { UnparsedWireValue } from "@luke/wire";
import { Schema } from "effect";

export const AGENT_ENTER = {
  /** The message goes into the turn under way, which the agent reads at its next step. */
  STEER: "steer",
  /** The message waits behind the turn and opens the next one. */
  QUEUE: "queue",
} as const;

export type AgentEnter = (typeof AGENT_ENTER)[keyof typeof AGENT_ENTER];

export const AGENT_ENTER_LIST: readonly AgentEnter[] = Object.values(AGENT_ENTER);

/** How each choice reads on its control. */
export const AGENT_ENTER_LABEL = {
  [AGENT_ENTER.STEER]: "Steer",
  [AGENT_ENTER.QUEUE]: "Queue",
} as const satisfies Record<AgentEnter, string>;

/** What the row says under its name for each choice: what ⌘↩ does instead. */
export const AGENT_ENTER_DETAIL = {
  [AGENT_ENTER.STEER]: "Use ⌘ Enter to queue. On a touch screen, press and hold Send.",
  [AGENT_ENTER.QUEUE]: "Use ⌘ Enter to steer. On a touch screen, press and hold Send.",
} as const satisfies Record<AgentEnter, string>;

const readsAgentEnter = Schema.is(Schema.Literals(AGENT_ENTER_LIST));

/** Guards a choice arriving from storage or IPC. */
export function isAgentEnter(value: UnparsedWireValue): value is AgentEnter {
  return readsAgentEnter(value);
}
