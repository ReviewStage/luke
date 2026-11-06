import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

export const AGENT_ENTER = {
  STEER: "steer",
  QUEUE: "queue",
} as const;

export type AgentEnter = (typeof AGENT_ENTER)[keyof typeof AGENT_ENTER];

export const AGENT_ENTER_LIST: readonly AgentEnter[] = Object.values(AGENT_ENTER);

export const AGENT_ENTER_LABEL = {
  [AGENT_ENTER.STEER]: "Steer",
  [AGENT_ENTER.QUEUE]: "Queue",
} as const satisfies Record<AgentEnter, string>;

export const AGENT_ENTER_DETAIL = {
  [AGENT_ENTER.STEER]: "Use ⌘ Enter to queue. On a touch screen, press and hold Send.",
  [AGENT_ENTER.QUEUE]: "Use ⌘ Enter to steer. On a touch screen, press and hold Send.",
} as const satisfies Record<AgentEnter, string>;

const readsAgentEnter = Schema.is(Schema.Literals(AGENT_ENTER_LIST));

export function isAgentEnter(value: UnparsedWireValue): value is AgentEnter {
  return readsAgentEnter(value);
}
