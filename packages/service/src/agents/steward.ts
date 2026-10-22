/**
 * steward.ts -- what an operator may do to another agent without asking: act only on its member's own agents.
 *
 * Dean's Steward policy for the member's operator (`coder-host/operator.ts`):
 * unasked, it steers, stops, archives, and continues its member's own agents,
 * the ones its member started, by hand or through any of their agents, the
 * operator among them, which is whose the row is (`coding_agent.user_id`). A
 * teammate's agent it may read and message, and nothing more: its stop, its
 * change, its archive, and a Continue or Fork of it are refused here, in
 * code, whatever the operator's prompt says. Every other agent is held to
 * the rules every caller is held to, which this adds nothing to; and the
 * tools an operator is never offered, such as a delete, are withheld where
 * the tools are offered (`coder-host/tool-set.ts`'s `kindToolsOf`).
 */

import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";

/** What an operator was refused doing to a teammate's agent, as the refusal opens. */
export const STEWARD_ACT = {
  STOP: "Not stopped",
  CHANGE: "Not changed",
  START_FROM: "Not started",
} as const;

export type StewardAct = (typeof STEWARD_ACT)[keyof typeof STEWARD_ACT];

/** Why an operator's delete was refused: it deletes nothing, whoever's the thing is. */
export const STEWARD_DELETE_REFUSAL =
  "Not deleted: as the developer's operator you delete nothing. Ask the developer, who deletes it themselves.";

/** Whether the calling agent is a member's operator. */
export function isOperator(agent: Pick<CodingAgent, "kind">): boolean {
  return agent.kind === CODING_AGENT_KIND.OPERATOR;
}

/**
 * Why the calling agent may not act on the agent named, or nothing where it
 * may: an operator acts only on an agent its own member started, since any
 * agent its member or it started is its member's row. A caller that is no
 * operator, or Luke on a call (`undefined`), is refused nothing here.
 */
export function stewardRefusal(
  caller: Pick<CodingAgent, "kind" | "userId"> | undefined,
  target: Pick<CodingAgent, "userId">,
  act: StewardAct,
): string | undefined {
  if (caller === undefined || !isOperator(caller) || target.userId === caller.userId) {
    return undefined;
  }
  return (
    `${act}: that agent is a teammate's, not one your member or you started. ` +
    "As their operator you may read it and message it, and nothing more; ask its starter if it needs more."
  );
}
