/**
 * fork-model.ts -- a coding agent forked at one of its messages: the fork a draft holds, what its chip quotes of the message, the choice it starts on, the Start a forked draft sends, and where each message was forked to.
 *
 * A fork is a new agent on the same plan handed the source's transcript up
 * to and including one of the source's own messages
 * (`codingAgentStartRequestFields`' `from`): a settled one whole, and the
 * reply a running turn is still writing as far as it stood when Fork was
 * pressed, by how many of its steps had begun (`forkStepsOf`). The draft that sends it holds
 * the fork beside its choices (`use-coding-agents.ts`), with the opening
 * words of the message it was forked at, which its chip quotes. The
 * developer's words and files go with it as a note, as the Start takes
 * them, files riding a note of no words; an empty box forks alone. The way back is read
 * off the plan's agents as listed, archived ones among them: each agent
 * started `from` a message names that message, so the source's tab says
 * under it which agents were forked there, in the order started, and no
 * read of the service's is owed to it.
 *
 * A continue is held the same way, naming no message: the draft its
 * Continue in new agent opens (`continue-agent.tsx`) starts from the
 * source on its whole transcript, its chip naming the source alone.
 */

import type {
  CodingAgentAttachment,
  CodingAgentMessage,
  CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import type { ACT_KIND, ActPayload } from "@luke/host/acts";
import { isRecord, MESSAGE_ROLE } from "@luke/wire";
import { AGENT_PART, choiceRequest } from "./coding-agent-model";
import { cardTitle } from "./tool-call-model";

/** The words the fork's action, chip, and trail are drawn with. */
export const FORK_WORDS = {
  ACTION: "Fork to new agent",
  OF: "Fork of",
  CONTINUE_OF: "Continue of",
  AT: "at",
  TO: "Forked to",
  DROP: "Drop the fork",
  DROP_CONTINUE: "Drop the continue",
  OPEN_SOURCE: "Open the message",
} as const;

/** How many words of the message the chip quotes, and at most how many characters. */
const OPENING = { WORDS: 8, CHARS: 60 } as const;

/** The ellipsis a quote cut short ends on. */
const ELLIPSIS = "…";

/**
 * One agent forked at one of its messages, with the message's opening
 * words, which the draft's chip quotes, and, for a reply still being
 * written, how many of its steps the fork keeps; or, naming no message,
 * continued on its whole transcript, when there is nothing to quote and
 * `opening` is empty.
 */
export interface AgentFork {
  readonly agentId: string;
  readonly messageId?: string;
  readonly opening: string;
  readonly messageSteps?: number;
}

/** A continue of `agentId` as a draft holds it: its whole transcript, no message named. */
export function continueFork(agentId: string): AgentFork {
  return { agentId, opening: "" };
}

/** What a forked or continued draft's working line says while its Start is out, in the order the service does it. */
const START_STAGE_WORDS = {
  COPYING_BEFORE: "Copying ",
  COPYING_AFTER: "'s work…",
  STARTING: "Starting the new agent…",
} as const;

/**
 * How long the copy of the source's work is said to take before the line
 * moves on to the new agent starting. Note that the service says nothing
 * while a Start is out, so the stage follows the time it typically spends
 * on the copy, which comes first, rather than a word of its own.
 */
const COPY_STAGE_MS = 3_000;

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

/** Where a fork starts from: its source at its message, cut at the steps seen where it was still being written, or on its whole transcript for a continue. */
function forkFrom(fork: AgentFork): NonNullable<ForkStart["from"]> {
  const { agentId, messageId, messageSteps } = fork;
  if (messageId === undefined) return { agentId };
  // Note that a settled message names no steps, so a service before the count still takes its fork.
  return messageSteps === undefined ? { agentId, messageId } : { agentId, messageId, messageSteps };
}

/**
 * The Start a forked draft sends under its own key: from the source at its
 * message, a note where the box holds anything, its words and the files
 * with them, the servers the draft switched off, none among them as well,
 * and the choice only where one was made, since a fork otherwise runs on
 * the source's.
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
    from: forkFrom(input.fork),
    ...(note === "" && attachments.length === 0 ? undefined : { note }),
    ...(attachments.length === 0 ? undefined : { attachments }),
    // Note that the servers go even when none is off, because a Start naming none runs on the source's.
    disabledServers,
    ...(choice === undefined ? undefined : choiceRequest(choice)),
  };
}

/**
 * What a forked or continued draft's working line says `elapsedMs` after
 * its Start went: the copy of `source`'s work, named as its tab is, from
 * the first and while the time is not yet read, then the new agent
 * starting.
 */
export function startingWords(source: string, elapsedMs: number | undefined): string {
  return elapsedMs !== undefined && elapsedMs >= COPY_STAGE_MS
    ? START_STAGE_WORDS.STARTING
    : `${START_STAGE_WORDS.COPYING_BEFORE}${source}${START_STAGE_WORDS.COPYING_AFTER}`;
}

/**
 * The reply a running turn may still be writing, which a fork cuts where it
 * stood as Fork was pressed (`forkStepsOf`) rather than whole: the newest of
 * the agent's own messages while it may still write, and none once it has
 * settled.
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
 * How many steps a fork of `message` keeps: for the reply a running turn is
 * still writing, the steps begun as it is drawn, which pins the cut so the
 * steps the agent begins after the press stay out of it; none for a settled
 * message, which a fork keeps whole. Zero for a reply that has begun no
 * step, which offers no fork, since there is nothing of it yet to keep.
 */
export function forkStepsOf(
  message: Pick<CodingAgentMessage, "id" | "parts">,
  open: string | undefined,
): number | undefined {
  if (message.id !== open) return undefined;
  return message.parts.filter((part) => isRecord(part) && part.type === AGENT_PART.STEP_START)
    .length;
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
