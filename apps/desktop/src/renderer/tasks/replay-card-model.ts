import {
  firstMessageParts,
  REPLAY_STEP_KIND,
  type Replay,
  type ReplayStep,
} from "@luke/features/agent-replay";
import type { CodingAgentMessage, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { CALL_KIND, CALL_WORDS, type CallKind } from "@luke/features/turn-rows";
import { TOOL_STATE, type ToolState } from "../ai-elements/tool";
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

/** What a step's row names the agent by, for its words and its calls. */
const AGENT_WORD = "Agent";

/** What a line's row names its sender by where its summary names none. */
const SENDER_WORD = "Developer";

/** What stands between who a summary is of and what they did, as the service writes a line's and the agent's words' summaries ("Luke: Check the tests", "Said: Done."). */
const SPEAKER_SEPARATOR = ": ";

/** The word the service leads the agent's words' summary with, which the row's "Agent" already says. */
const SAID_WORD = "Said";

/** How the service lays a call's step out: its input after this lead, then its result after the next. */
const CALL_PARTS = {
  INPUT: "Input: ",
  RESULT: "\nResult: ",
  FAILED: "Failed: ",
} as const;

/** What the service adds to a call's summary while the call was still under way. */
const RUNNING_MARK = " (running)";

/**
 * The kind of call each verb the service says a call in names, the first
 * kind of the transcript's own words to say it, so a replayed call wears
 * the icon its row wears in a transcript; a verb the transcript does not
 * say, as "Used", is another call's.
 */
const VERB_KIND: ReadonlyMap<string, CallKind> = new Map(
  Object.values(CALL_KIND)
    .toReversed()
    .map((kind) => [CALL_WORDS[kind].verb, kind] as const),
);

/** What one step is drawn as: a line sent to the source, the source agent's words, or one of its calls as a transcript's row. */
export const STEP_VIEW = {
  LINE: "line",
  SAID: "said",
  CALL: "call",
} as const;

export type StepView =
  | { readonly kind: typeof STEP_VIEW.LINE; readonly sender: string; readonly words: string }
  | { readonly kind: typeof STEP_VIEW.SAID; readonly words: string }
  | {
      readonly kind: typeof STEP_VIEW.CALL;
      readonly call: CallKind;
      readonly state: ToolState;
      readonly subject: string;
      readonly input: string;
      readonly output: string | undefined;
      readonly errorText: string | undefined;
    };

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

/**
 * The id the note's line is drawn under. Note that it is none of the
 * transcript's, because the note is a part of the first message, and a
 * Copy link under the first message's id would bring the brief into view
 * rather than the note; a line whose id the transcript does not hold offers
 * no link (`message-links.tsx`).
 */
const NOTE_LINE_ID = "replay-note";

/** One step's row: who it names and the one line after. */
export interface StepLine {
  readonly who: string;
  readonly line: string;
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
    note:
      parts.note === undefined
        ? undefined
        : { ...withWords(first, parts.note.text, false), id: NOTE_LINE_ID },
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
  return `What this agent was handed of ${source}'s work, as it was sent.`;
}

/**
 * Where a line's summary parts its sender from its words: the first
 * separator after which the summary reads as the start of the line's own
 * words on one line, so a sender whose name holds the separator (an
 * automation's "Nightly: deploy") keeps it; the first separator where none
 * does, and none where the summary holds no separator.
 */
function lineSplit(step: ReplayStep): number {
  const words = step.words.replace(/\s+/gu, " ").trim();
  let first = -1;
  for (let at = step.summary.indexOf(SPEAKER_SEPARATOR); at >= 0; ) {
    if (first < 0) first = at;
    const tail = step.summary.slice(at + SPEAKER_SEPARATOR.length).replace(/…$/u, "");
    if (words.startsWith(tail)) return at;
    at = step.summary.indexOf(SPEAKER_SEPARATOR, at + 1);
  }
  return first;
}

/**
 * A step's row: a line under whoever sent it, as its summary names them
 * (a member, Luke, an automation, GitHub, another agent), and the agent's
 * words and calls under the agent, the words without the summary's own
 * "Said" since the row names the agent.
 */
export function stepLine(step: ReplayStep): StepLine {
  switch (step.kind) {
    case REPLAY_STEP_KIND.LINE: {
      const split = lineSplit(step);
      if (split < 0) return { who: SENDER_WORD, line: step.summary };
      const line = step.summary.slice(split + SPEAKER_SEPARATOR.length);
      return { who: step.summary.slice(0, split), line };
    }
    case REPLAY_STEP_KIND.SAID: {
      const lead = `${SAID_WORD}${SPEAKER_SEPARATOR}`;
      const said = step.summary.startsWith(lead);
      return { who: AGENT_WORD, line: said ? step.summary.slice(lead.length) : step.summary };
    }
    case REPLAY_STEP_KIND.TOOL:
      return { who: AGENT_WORD, line: step.summary };
  }
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

/** A call's step read back as its row: its kind and subject from its summary, its input and result from its words, failed where its result says so. */
function callView(step: ReplayStep): StepView {
  const split = step.summary.indexOf(SPEAKER_SEPARATOR);
  const verb = split < 0 ? step.summary : step.summary.slice(0, split);
  const running = step.summary.endsWith(RUNNING_MARK);
  const subject =
    split < 0
      ? ""
      : step.summary.slice(
          split + SPEAKER_SEPARATOR.length,
          running ? -RUNNING_MARK.length : undefined,
        );
  const words = step.words.startsWith(CALL_PARTS.INPUT)
    ? step.words.slice(CALL_PARTS.INPUT.length)
    : step.words;
  const at = words.indexOf(CALL_PARTS.RESULT);
  const input = at < 0 ? words : words.slice(0, at);
  const result = at < 0 ? undefined : words.slice(at + CALL_PARTS.RESULT.length);
  const failed = result?.startsWith(CALL_PARTS.FAILED) === true;
  return {
    kind: STEP_VIEW.CALL,
    call: VERB_KIND.get(verb) ?? CALL_KIND.OTHER,
    state: running
      ? TOOL_STATE.INPUT_AVAILABLE
      : failed
        ? TOOL_STATE.OUTPUT_ERROR
        : TOOL_STATE.OUTPUT_AVAILABLE,
    subject: subject === "" ? step.summary : subject,
    input,
    output: running || failed ? undefined : result,
    errorText: failed ? result?.slice(CALL_PARTS.FAILED.length) : undefined,
  };
}

/**
 * What a step is drawn as in the card, as a transcript draws the same:
 * a line as a sent message under whoever sent it, the agent's words as its
 * words, and a call as a call's row opening onto its input and its result.
 */
export function stepView(step: ReplayStep): StepView {
  switch (step.kind) {
    case REPLAY_STEP_KIND.LINE:
      return { kind: STEP_VIEW.LINE, sender: stepLine(step).who, words: step.words };
    case REPLAY_STEP_KIND.SAID:
      return { kind: STEP_VIEW.SAID, words: step.words };
    case REPLAY_STEP_KIND.TOOL:
      return callView(step);
  }
}
