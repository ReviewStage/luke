import type {
  AgentAttachment,
  AgentRunsOnRequest,
  AgentSummary,
  AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import type { ModelChoice } from "@repo/features/models-wire";
import type { ACT_KIND } from "@repo/host/acts";
import type { PortActPayload } from "@repo/host/contract";
import { isRecord, isWireString, MESSAGE_ROLE } from "@repo/wire";
import { AGENT_PART, choiceRequest } from "./agent-model.js";
import { cardTitle } from "./tool-call-model.js";

const TOOL_PART_TYPE_PREFIX = "tool-";

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

const OPENING = { WORDS: 8, CHARS: 60 } as const;

const ELLIPSIS = "…";

export interface AgentFork {
  readonly agentId: string;
  readonly messageId?: string;
  readonly opening: string;
  readonly messageSteps?: number;
  readonly messageStepParts?: number;
}

export interface ForkCut {
  readonly messageSteps: number;
  readonly messageStepParts: number;
}

export function continueFork(agentId: string): AgentFork {
  return { agentId, opening: "" };
}

const START_STAGE_WORDS = {
  COPYING_BEFORE: "Copying ",
  COPYING_AFTER: "'s work…",
  STARTING: "Starting the new agent…",
} as const;

const COPY_STAGE_MS = 3_000;

export type ForkStart = Omit<PortActPayload<typeof ACT_KIND.AGENTS_START>, "taskId">;

export function messageOpening(words: string): string {
  const whole = cardTitle(words)
    .split(/\s+/)
    .filter((word) => word !== "")
    .join(" ");
  let quote = whole.split(" ").slice(0, OPENING.WORDS).join(" ");
  if (quote.length > OPENING.CHARS) quote = quote.slice(0, OPENING.CHARS).trimEnd();
  return quote.length < whole.length ? `${quote}${ELLIPSIS}` : quote;
}

export function forkChoice(source: AgentSummary): ModelChoice {
  return choiceRequest({
    model: source.model,
    effort: source.effort,
    ...(source.contextWindow === undefined ? undefined : { contextWindow: source.contextWindow }),
  });
}

function forkFrom(fork: AgentFork): NonNullable<ForkStart["from"]> {
  const { agentId, messageId, messageSteps, messageStepParts } = fork;
  if (messageId === undefined) return { agentId };
  if (messageSteps === undefined) return { agentId, messageId };
  return messageStepParts === undefined
    ? { agentId, messageId, messageSteps }
    : { agentId, messageId, messageSteps, messageStepParts };
}

export function forkStart(input: {
  readonly draftId: string;
  readonly fork: AgentFork;
  readonly words: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  readonly runsOn?: AgentRunsOnRequest | undefined;
}): ForkStart {
  const note = input.words.trim();
  const { attachments, choice, disabledServers, runsOn } = input;
  return {
    idempotencyKey: input.draftId,
    from: forkFrom(input.fork),
    ...(note === "" && attachments.length === 0 ? undefined : { note }),
    ...(attachments.length === 0 ? undefined : { attachments }),
    disabledServers,
    ...(choice === undefined ? undefined : choiceRequest(choice)),
    ...(runsOn === undefined ? undefined : { runsOn }),
  };
}

export function startingWords(source: string, elapsedMs: number | undefined): string {
  return elapsedMs !== undefined && elapsedMs >= COPY_STAGE_MS
    ? START_STAGE_WORDS.STARTING
    : `${START_STAGE_WORDS.COPYING_BEFORE}${source}${START_STAGE_WORDS.COPYING_AFTER}`;
}

export function openReply(
  messages: readonly { readonly id: string; readonly role: string }[],
  writing: boolean,
): string | undefined {
  return writing
    ? messages.findLast((message) => message.role === MESSAGE_ROLE.ASSISTANT)?.id
    : undefined;
}

function isCutPart(part: AgentTranscriptMessage["parts"][number]): boolean {
  if (!isRecord(part) || !isWireString(part.type)) return false;
  return part.type === AGENT_PART.TEXT || part.type.startsWith(TOOL_PART_TYPE_PREFIX);
}

export function forkCutOf(
  message: Pick<AgentTranscriptMessage, "id" | "parts">,
  open: string | undefined,
): ForkCut | undefined {
  if (message.id !== open) return undefined;
  const { parts } = message;
  const last = parts.findLastIndex((part) => isRecord(part) && part.type === AGENT_PART.STEP_START);
  return {
    messageSteps: parts.filter((part) => isRecord(part) && part.type === AGENT_PART.STEP_START)
      .length,
    messageStepParts: parts.slice(last + 1).filter(isCutPart).length,
  };
}

export function forksOf(
  agents: readonly AgentSummary[],
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
