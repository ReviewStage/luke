import {
  firstMessageParts,
  REPLAY_STEP_KIND,
  type Replay,
  type ReplayStep,
} from "@luke/features/agent-replay";
import type { CodingAgentMessage, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { AGENT_PART, agentParts, messageWords } from "./coding-agent-model";

/**
 * replay-card-model.ts -- the opening of an agent started from another, read out of its first message: the brief as its source's was, the replay's card, and the developer's note.
 *
 * An agent continued from another, or forked from one at a message, is
 * handed one first message holding three things (`@luke/features/agent-replay`):
 * the brief its source was handed, the source's transcript replayed, and
 * the note the developer wrote with the start. The tab draws them apart:
 * the brief as the source's transcript drew it, the replay as one folded
 * card naming the source, and the note as the developer's own line. This
 * module reads the message into those three and says the card's words; a
 * message whose markers do not add up has no replay, and is drawn whole as
 * any first message is.
 */

/** What the card's summary row says before the source's chip: a continue's, or a fork's at one of the source's messages. */
export const REPLAY_VERB = {
  CONTINUED: "Continued from",
  FORKED: "Forked from",
} as const;

type ReplayVerb = (typeof REPLAY_VERB)[keyof typeof REPLAY_VERB];

/** Who a replayed step is: a line a member sent the source, or the source agent's own words or call. */
export const STEP_WHO = {
  MEMBER: "member",
  AGENT: "agent",
} as const;

type StepWho = (typeof STEP_WHO)[keyof typeof STEP_WHO];

/** What a step's row names the agent by. */
export const AGENT_WORD = "Agent";

/** The most links of a `from` chain a brief's source is looked for along, so a chain that loops ends. */
const MAX_CHAIN = 32;

/** An agent's opening, read out of its first message: the brief as a message of its own, the replay, and the note as a line of its own where one was written. */
export interface ReplayOpening {
  /** The first message with only the brief for its words, and its files kept. */
  readonly brief: CodingAgentMessage;
  readonly replay: Replay;
  /** The note as the developer's line: the first message with the note for its words and no files; none where no note was written. */
  readonly note: CodingAgentMessage | undefined;
}

/** The message with the words given in place of its own words, its files kept or dropped. */
function withWords(
  message: CodingAgentMessage,
  words: string,
  keepFiles: boolean,
): CodingAgentMessage {
  const kinds = agentParts(message);
  const files = keepFiles
    ? message.parts.filter((_, index) => kinds[index]?.kind !== AGENT_PART.TEXT)
    : [];
  return { ...message, parts: [...files, { type: "text", text: words }] };
}

/**
 * The opening of an agent started from another, read from its first
 * message; nothing where the message holds no replay that adds up, which
 * is then drawn as any first message is.
 */
export function replayOpening(first: CodingAgentMessage): ReplayOpening | undefined {
  const parts = firstMessageParts(messageWords(first));
  if (parts.replay === undefined) return undefined;
  return {
    brief: withWords(first, parts.brief, true),
    replay: parts.replay,
    note: parts.note === undefined ? undefined : withWords(first, parts.note.text, false),
  };
}

/** The words the card's summary leads with: a fork's where the replay was cut at a message, a continue's otherwise. */
export function replayVerb(replay: Replay): ReplayVerb {
  return replay.messageId === undefined ? REPLAY_VERB.CONTINUED : REPLAY_VERB.FORKED;
}

/** How many steps the replay kept, and of how many where it left the earliest out: "38 steps", "38 of 212 steps". */
export function replayCount(replay: Replay): string {
  const kept = replay.steps.length;
  if (kept < replay.totalSteps) return `${kept} of ${replay.totalSteps} steps`;
  return kept === 1 ? "1 step" : `${kept} steps`;
}

/** The line saying how many of the source's earliest steps the replay left out; none where it kept them all. */
export function leftOutLine(replay: Replay): string | undefined {
  const left = replay.totalSteps - replay.steps.length;
  if (left <= 0) return undefined;
  const steps = left === 1 ? "1 earlier step was" : `${left} earlier steps were`;
  return `${steps} left out to keep the replay within its size limit.`;
}

/** The lede the card's body opens on, naming the source by its tab's name. */
export function replayLede(source: string): string {
  return (
    `What this agent was handed of ${source}'s work, one step per line: its words in full, ` +
    "each tool call with its result trimmed. Open a step to read it as it was sent."
  );
}

/** Who a step is: the member for a line sent to the source, the agent for its words and its calls. */
export function stepWho(step: ReplayStep): StepWho {
  return step.kind === REPLAY_STEP_KIND.LINE ? STEP_WHO.MEMBER : STEP_WHO.AGENT;
}

/**
 * The agent among `agents` whose brief an agent started from another
 * carries: the first along its `from` chain that was handed its brief
 * afresh; the agent itself where it was started afresh, or where a link of
 * its chain is not listed.
 */
function briefSource(
  agent: CodingAgentSummary,
  agents: readonly CodingAgentSummary[],
): CodingAgentSummary {
  let at = agent;
  for (let link = 0; link < MAX_CHAIN && at.from !== undefined; link += 1) {
    const sourceId: string = at.from.agentId;
    const source = agents.find((each) => each.id === sourceId);
    if (source === undefined) return at;
    at = source;
  }
  return at;
}

/**
 * The agent as its opening is drawn: where its brief is an automation's
 * run's prompt, carried over from the run along its `from` chain, it wears
 * the run's automation, so its opening draws the automation's Prompt card
 * under the automation as the run's did. Note that the agent is still no
 * run of the automation: only what its opening is drawn from changes.
 */
export function briefAgent(
  agent: CodingAgentSummary,
  agents: readonly CodingAgentSummary[],
): CodingAgentSummary {
  const source = briefSource(agent, agents);
  if (source === agent) return agent;
  const { automationId, automationName } = source;
  if (automationId === undefined && automationName === undefined) return agent;
  return {
    ...agent,
    ...(automationId === undefined ? undefined : { automationId }),
    ...(automationName === undefined ? undefined : { automationName }),
  };
}
