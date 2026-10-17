/**
 * fork-model.ts -- a coding agent forked at one of its messages: the fork a draft holds, what its chip quotes of the message, the choice it starts on, the Start a forked draft sends, and where each message was forked to.
 *
 * A fork is a new agent on the same plan handed the source's transcript up
 * to and including one of the source's own settled messages
 * (`codingAgentStartRequestFields`' `from`). The draft that sends it holds
 * the fork beside its choices (`use-coding-agents.ts`), with the opening
 * words of the message it was forked at, which its chip quotes. The
 * developer's words and files go with it as a note, as the Start takes
 * them, files riding a note of no words; an empty box forks alone. The way back is read
 * off the plan's agents as listed, archived ones among them: each agent
 * started `from` a message names that message, so the source's tab says
 * under it which agents were forked there, in the order started, and no
 * read of the service's is owed to it.
 */

import type { CodingAgentAttachment, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import type { ACT_KIND, ActPayload } from "@luke/host/acts";
import { MESSAGE_ROLE } from "@luke/wire";
import { choiceRequest } from "./coding-agent-model";
import { cardTitle } from "./tool-call-model";

/** The words the fork's action, chip, and trail are drawn with. */
export const FORK_WORDS = {
  ACTION: "Fork to new agent",
  OF: "Fork of",
  AT: "at",
  TO: "Forked to",
  DROP: "Drop the fork",
  OPEN_SOURCE: "Open the message",
} as const;

/** How many words of the message the chip quotes, and at most how many characters. */
const OPENING = { WORDS: 8, CHARS: 60 } as const;

/** The ellipsis a quote cut short ends on. */
const ELLIPSIS = "…";

/** One agent forked at one of its messages, with the message's opening words, which the draft's chip quotes. */
export interface AgentFork {
  readonly agentId: string;
  readonly messageId: string;
  readonly opening: string;
}

/** A Start as the draft's send asks it, the plan left for the caller to name. */
export type ForkStart = Omit<ActPayload<typeof ACT_KIND.CODING_AGENTS_START>, "taskId">;

/**
 * A message's opening words as the fork's chip quotes them: its first line
 * read as plain words, at most a few of them, ending on an ellipsis where
 * the line was cut.
 */
export function messageOpening(words: string): string {
  const whole = cardTitle(words)
    .split(/\s+/)
    .filter((word) => word !== "")
    .join(" ");
  let quote = whole.split(" ").slice(0, OPENING.WORDS).join(" ");
  if (quote.length > OPENING.CHARS) quote = quote.slice(0, OPENING.CHARS).trimEnd();
  return quote.length < whole.length ? `${quote}${ELLIPSIS}` : quote;
}

/** The choice a fork of `source` starts on until the developer picks another: the source's own model and effort, and its window. */
export function forkChoice(source: CodingAgentSummary): ModelChoice {
  return choiceRequest({
    model: source.model,
    effort: source.effort,
    ...(source.contextWindow === undefined ? undefined : { contextWindow: source.contextWindow }),
  });
}

/**
 * The Start a forked draft sends under its own key: from the source at its
 * message, a note where the box holds anything, its words and the files
 * with them, the servers the draft switched off, and the choice only where
 * one was made, since a fork otherwise runs on the source's.
 */
export function forkStart(input: {
  readonly draftId: string;
  readonly fork: AgentFork;
  readonly words: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
}): ForkStart {
  const note = input.words.trim();
  const { attachments, choice, disabledServers } = input;
  return {
    idempotencyKey: input.draftId,
    from: { agentId: input.fork.agentId, messageId: input.fork.messageId },
    ...(note === "" && attachments.length === 0 ? undefined : { note }),
    ...(attachments.length === 0 ? undefined : { attachments }),
    ...(disabledServers.length === 0 ? undefined : { disabledServers }),
    ...(choice === undefined ? undefined : choiceRequest(choice)),
  };
}

/**
 * The reply a running turn may still be writing, which no fork may cut,
 * since a fork keeps whole rows and would keep it half-written: the newest
 * of the agent's own messages while it may still write, and none once it
 * has settled.
 */
export function openReply(
  messages: readonly { readonly id: string; readonly role: string }[],
  writing: boolean,
): string | undefined {
  return writing
    ? messages.findLast((message) => message.role === MESSAGE_ROLE.ASSISTANT)?.id
    : undefined;
}

/**
 * Where each of `sourceId`'s messages was forked to: the ids of the agents
 * started from it at that message, by the message's id, in the order
 * started, archived ones among them. A continue names no message, so it is
 * no fork of any.
 */
export function forksOf(
  agents: readonly CodingAgentSummary[],
  sourceId: string,
): ReadonlyMap<string, readonly string[]> {
  const forks = new Map<string, string[]>();
  const started = [...agents].sort((a, b) => a.createdAt - b.createdAt);
  for (const agent of started) {
    const messageId = agent.from?.agentId === sourceId ? agent.from.messageId : undefined;
    if (messageId === undefined) continue;
    const held = forks.get(messageId);
    if (held === undefined) forks.set(messageId, [agent.id]);
    else held.push(agent.id);
  }
  return forks;
}
