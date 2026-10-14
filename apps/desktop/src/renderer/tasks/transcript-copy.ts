import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  applyMessagesPage,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_BRIEF,
  CODING_AGENT_CURSOR_START,
  type CodingAgentBrief,
  type CodingAgentMessage,
} from "@luke/features/coding-agent-wire";
import {
  CALL_KIND,
  CALL_WORDS,
  type CallKind,
  callPlace,
  TURN_ROW,
  type TurnRow,
} from "@luke/features/turn-rows";
import { MESSAGE_ROLE } from "@luke/wire";
import { TOOL_BLOCK, type ToolBlock } from "../ai-elements/tool";
import {
  AGENT_PART,
  type AgentPart,
  agentRows,
  chatNoticeOf,
  isDelegation,
  messageWords,
  placedMessages,
  turnStretches,
  workerLines,
} from "./coding-agent-model";
import { cardTitle, delegationView, plainWords, toolCallView } from "./tool-call-model";
import type { TranscriptReader } from "./use-agent-transcript";

/**
 * transcript-copy.ts -- a coding agent's or a subagent's transcript as the markdown its tab's menu copies: concise, or whole.
 *
 * Both copies are built from the rows the tab draws (`turn-rows.ts`, through
 * `agentRows` and the Call tab's worker session), never from the page, so a
 * tab that is not shown copies as one that is. The concise copy is what a
 * reader skims: the brief the agent was handed, each message the developer
 * sent, and each of the agent's turns as one line per call it made, in its
 * kind's verb (`- Ran \`pnpm test\``) or the words a command was described
 * in (`- Run the unit tests: \`pnpm test\``), and the turn's last words; reasoning
 * and every call's input and answer are left out. The full copy is all the
 * tab opens onto, in order: words, reasoning, and every call with its input
 * and its answer, an answer past `OUTPUT_LIMIT` cut there with a note
 * saying so. Nothing is copied that the tab does not draw. A tab's hover
 * card previews the same reading's latest step (`latestActivity`): the
 * agent's last words as plain text, or its last call as the concise copy's
 * line says it.
 */

/** The two copies a transcript's menu offers. */
export const TRANSCRIPT_COPY = {
  CONCISE: "concise",
  FULL: "full",
} as const;

export type TranscriptCopy = (typeof TRANSCRIPT_COPY)[keyof typeof TRANSCRIPT_COPY];

/** What a transcript's latest step was, as a tab's hover card previews it. */
export const LATEST_ACTIVITY = {
  WORDS: "words",
  CALL: "call",
} as const;

export type LatestActivity =
  | { readonly kind: typeof LATEST_ACTIVITY.WORDS; readonly text: string }
  | {
      readonly kind: typeof LATEST_ACTIVITY.CALL;
      /** The kind's verb, as the concise copy's line says it, before the subject. */
      readonly verb: string;
      readonly subject: string;
      /** Whether the subject is code, a command or a path, rather than words. */
      readonly code: boolean;
    };

/** Who a turn of the copy is, as its heading names them; a chat notice's heading names its sender after the word. */
const SPEAKER = {
  DEVELOPER: "Developer",
  AGENT: "Agent",
  SUBAGENT: "Subagent",
  CHAT: "Chat from",
} as const;

type Speaker = (typeof SPEAKER)[keyof typeof SPEAKER];

/** What the brief's heading calls it: the plan an agent was handed, or a prompt in its place, or the task a worker was handed. */
const BRIEF_LABEL = {
  PLAN: "Plan",
  PROMPT: "Prompt",
  SUBAGENT_TASK: "Subagent task",
} as const;

/** The most characters of one call's answer the full copy carries before it cuts the rest. */
const OUTPUT_LIMIT = 4_000;

/** What ends an answer cut short. */
const TRUNCATED_LINE = "…truncated";

/** The most characters of a call's subject the concise copy's line carries. */
const SUBJECT_LIMIT = 160;

/** What a worker's session read with its earliest steps let go of says where they were. */
const EARLIER_OMITTED_LINE = "_Earlier steps are not shown._";

/** The fence each kind of call block is copied under, by the language it is written in. */
const FENCE_LANGUAGE = {
  [TOOL_BLOCK.COMMAND]: "sh",
  [TOOL_BLOCK.PATCH]: "diff",
  [TOOL_BLOCK.JSON]: "json",
  [TOOL_BLOCK.TEXT]: "",
} as const satisfies Record<ToolBlock["kind"], string>;

/** The kinds of block a copy reads a turn into, whichever wire the turn came from. */
const COPIED_BLOCK = {
  WORDS: "words",
  REASONING: "reasoning",
  CALL: "call",
} as const;

type CopiedBlock =
  | { readonly kind: typeof COPIED_BLOCK.WORDS; readonly text: string }
  | { readonly kind: typeof COPIED_BLOCK.REASONING; readonly text: string }
  | {
      readonly kind: typeof COPIED_BLOCK.CALL;
      readonly call: CallKind;
      readonly subject: string;
      /** For a command, the plain words the model said it is for, which the line leads with in place of the verb. */
      readonly description: string | undefined;
      readonly input: ToolBlock | undefined;
      /** Nothing while the call has not answered. */
      readonly output: ToolBlock | undefined;
      /** The error's own text, on a call that ended in one. */
      readonly error: string | undefined;
    };

type CopiedCall = Extract<CopiedBlock, { kind: typeof COPIED_BLOCK.CALL }>;

interface CopiedTurn {
  readonly speaker: Speaker;
  /** The handle of the member a chat notice tells of a message from, which its heading names; none on any other turn. */
  readonly from?: string;
  readonly blocks: readonly CopiedBlock[];
}

/** Whether a turn is words someone else handed the agent, the developer or a chat notice, rather than the agent's own. */
function handedIn(turn: CopiedTurn): boolean {
  return turn.speaker === SPEAKER.DEVELOPER || turn.speaker === SPEAKER.CHAT;
}

/** A turn's heading: who said it, a chat notice's under its sender. */
function headingOf(turn: CopiedTurn): string {
  return turn.from === undefined ? `## ${turn.speaker}` : `## ${turn.speaker} @${turn.from}`;
}

/** A transcript as both copies read it: its tab's name, the brief it opened on, and its turns in order. */
export interface CopiedTranscript {
  readonly title: string;
  readonly brief: { readonly label: string; readonly text: string } | undefined;
  /** Whether the session's earliest steps were let go before it was read. */
  readonly earlierOmitted: boolean;
  readonly turns: readonly CopiedTurn[];
}

function textBlock(text: string): ToolBlock {
  return { kind: TOOL_BLOCK.TEXT, text };
}

/** The blocks of a turn's rows in order, with every run of calls and every folded lead opened. */
function rowBlocks<B>(rows: readonly TurnRow<B>[]): readonly B[] {
  return rows.flatMap((row) => {
    if (row.kind === TURN_ROW.BLOCK) return [row.block];
    return row.kind === TURN_ROW.GROUP ? row.blocks : rowBlocks(row.rows);
  });
}

/** One part of an agent's turn as a copy reads it: a delegation as the worker's call, the task its input and the worker's answer its output. */
function agentBlock(part: AgentPart): CopiedBlock[] {
  if (part.kind === AGENT_PART.TEXT) return [{ kind: COPIED_BLOCK.WORDS, text: part.text }];
  if (part.kind === AGENT_PART.REASONING) {
    return [{ kind: COPIED_BLOCK.REASONING, text: part.text }];
  }
  if (part.kind !== AGENT_PART.TOOL) return [];
  const error = part.errorText;
  if (isDelegation(part)) {
    const view = delegationView(part, undefined);
    const output = view.result === undefined ? undefined : textBlock(view.result);
    const subject = cardTitle(view.task);
    const input = textBlock(view.task);
    const call = CALL_KIND.WORKER;
    return [
      { kind: COPIED_BLOCK.CALL, call, subject, description: undefined, input, output, error },
    ];
  }
  const view = toolCallView(part);
  const { input, output, subject, description } = view;
  return [{ kind: COPIED_BLOCK.CALL, call: view.kind, subject, description, input, output, error }];
}

/** One of the developer's messages as a copy reads it: their words. */
function developerTurn(message: CodingAgentMessage): CopiedTurn {
  const blocks = [{ kind: COPIED_BLOCK.WORDS, text: messageWords(message) }] as const;
  const notice = chatNoticeOf(message);
  if (notice !== undefined) return { speaker: SPEAKER.CHAT, from: notice.from, blocks };
  return { speaker: SPEAKER.DEVELOPER, blocks };
}

/**
 * A coding agent's transcript, or one of its workers', as a copy reads it:
 * the first of the developer's messages is the brief, the plan or the prompt
 * the agent was handed as its tab draws it, and a worker's is the task its
 * agent's call carried. The rest are turns: the developer's words, a chat
 * notice's under the member it tells of a message from, and the agent's
 * rows as its tab draws them, a line that reached a turn while it ran
 * between the turn's work before and after it, as the tab draws it.
 */
export function agentTranscript(input: {
  title: string;
  messages: readonly CodingAgentMessage[];
  brief: CodingAgentBrief | undefined;
  /** The task a worker was handed, where the transcript is a worker's rather than the agent's own. */
  task?: string | undefined;
}): CopiedTranscript {
  const { title, brief, task } = input;
  const messages = task === undefined ? input.messages : workerLines(task, input.messages);
  const first = messages.find(
    (message) => message.role === MESSAGE_ROLE.USER && chatNoticeOf(message) === undefined,
  );
  const label =
    task !== undefined
      ? BRIEF_LABEL.SUBAGENT_TASK
      : brief === CODING_AGENT_BRIEF.PROMPT
        ? BRIEF_LABEL.PROMPT
        : BRIEF_LABEL.PLAN;
  const speaker = task === undefined ? SPEAKER.AGENT : SPEAKER.SUBAGENT;
  // A line that reached a turn while it ran is copied where the tab draws it, between the turn's work before and after it.
  const turns = placedMessages(messages).flatMap(({ message, arrived }): CopiedTurn[] => {
    if (message === first) return [];
    if (message.role === MESSAGE_ROLE.USER) return [developerTurn(message)];
    return turnStretches(agentRows(message, false, { arrived })).map((stretch) =>
      stretch.line === undefined
        ? { speaker, blocks: rowBlocks(stretch.rows).flatMap(agentBlock) }
        : developerTurn(stretch.line),
    );
  });
  return {
    title,
    brief: first === undefined ? undefined : { label, text: messageWords(first) },
    earlierOmitted: false,
    turns,
  };
}

/** The longest run of backticks in the text, which a fence or a span around it must outrun. */
function longestTicks(text: string): number {
  return Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
}

/** The text as an inline code span, its ticks outrunning any it holds. */
function inlineCode(text: string): string {
  const ticks = "`".repeat(longestTicks(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

/** The text as a fenced block in the language given, its fence outrunning any it holds. */
function fenced(text: string, language: string): string {
  const fence = "`".repeat(Math.max(3, longestTicks(text) + 1));
  return `${fence}${language}\n${text.trimEnd()}\n${fence}`;
}

/** The text cut at the answer's bound, saying so where it was. */
function bounded(text: string): string {
  return text.length <= OUTPUT_LIMIT
    ? text
    : `${text.slice(0, OUTPUT_LIMIT).trimEnd()}\n${TRUNCATED_LINE}`;
}

/** The text as one line, cut at the subject's bound. */
function oneLine(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length <= SUBJECT_LIMIT ? line : `${line.slice(0, SUBJECT_LIMIT).trimEnd()}…`;
}

/**
 * How a call's line is put together: what it leads with, its kind's verb
 * or a command's own description, its subject on one line, what stands
 * between the two, and whether the subject is code.
 */
function callParts(call: CopiedCall) {
  const worker = call.call === CALL_KIND.WORKER;
  const said = call.description ?? CALL_WORDS[call.call].verb;
  const place = callPlace(call.call);
  return {
    verb:
      place === undefined ? said : `${said} (${place.charAt(0).toLowerCase()}${place.slice(1)})`,
    subject: oneLine(call.subject),
    joiner: worker || call.description !== undefined ? ": " : " ",
    code: !worker && CALL_WORDS[call.call].code,
  };
}

/**
 * What a call did, its kind's verb, set as `styled` sets it, then its
 * subject, as code where the subject is; a worker's task follows a colon,
 * since its subject is words, and so does a described command, since its
 * description is.
 */
function callSaid(call: CopiedCall, styled: (verb: string) => string) {
  const { verb, subject, joiner, code } = callParts(call);
  if (subject === "") return styled(verb).replace(/:$/u, "");
  return `${styled(verb)}${joiner}${code ? inlineCode(subject) : subject}`;
}

/** A turn as the concise copy reads it: the developer's words; or the agent's calls one line each, a run of them one list, and its last words where they stand. */
function conciseTurn(turn: CopiedTurn): string[] {
  const last = turn.blocks.findLastIndex((block) => block.kind === COPIED_BLOCK.WORDS);
  const said: string[] = [];
  let calls: string[] = [];
  const flush = () => {
    if (calls.length > 0) said.push(calls.join("\n"));
    calls = [];
  };
  turn.blocks.forEach((block, index) => {
    if (block.kind === COPIED_BLOCK.CALL) {
      const failed = block.error === undefined ? "" : " (failed)";
      calls.push(`- ${callSaid(block, (verb) => verb)}${failed}`);
      return;
    }
    if (block.kind !== COPIED_BLOCK.WORDS) return;
    if (!handedIn(turn) && index !== last) return;
    flush();
    said.push(block.text.trim());
  });
  flush();
  return said.filter((each) => each.length > 0);
}

/** Whether a block is a step a preview can say: a call, or words that say something. */
function previewed(block: CopiedBlock): boolean {
  if (block.kind === COPIED_BLOCK.CALL) return true;
  return block.kind === COPIED_BLOCK.WORDS && plainWords(block.text) !== "";
}

/**
 * The latest step of the agent's, or the subagent's, own turns: its last
 * words as plain text on one line, or its last call in its kind's verb and
 * subject, as the concise copy's line says it. Reasoning is passed over, as
 * the concise copy passes it, and so are the developer's own messages;
 * nothing where the agent has said and run nothing yet.
 */
export function latestActivity(transcript: CopiedTranscript): LatestActivity | undefined {
  const turn = transcript.turns.findLast((each) => !handedIn(each) && each.blocks.some(previewed));
  const block = turn?.blocks.findLast(previewed);
  if (block === undefined || block.kind === COPIED_BLOCK.REASONING) return undefined;
  if (block.kind === COPIED_BLOCK.WORDS) {
    return { kind: LATEST_ACTIVITY.WORDS, text: plainWords(block.text) };
  }
  // A described command says its description, and where it ran where that is the Mac, as its row does.
  if (block.description !== undefined) {
    const { verb } = callParts(block);
    return { kind: LATEST_ACTIVITY.CALL, verb, subject: "", code: false };
  }
  // The verb and its joiner as the concise copy's line puts them, the subject drawn apart.
  const { verb, subject, joiner, code } = callParts(block);
  const lead = subject === "" ? verb.replace(/:$/u, "") : `${verb}${joiner.trimEnd()}`;
  return { kind: LATEST_ACTIVITY.CALL, verb: lead, subject, code };
}

/** A reasoning block as the full copy reads it: under a bold word, quoted. */
function reasoningSaid(text: string): string {
  const quoted = text
    .trim()
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
  return `**Reasoning**\n\n${quoted}`;
}

/** A call as the full copy reads it: what it did in bold, its input, and its answer or its error. */
function callBlockSaid(call: CopiedCall): string {
  const head = callSaid(call, (verb) => `**${verb}**`);
  const { input, output, error } = call;
  return [
    head,
    ...(input === undefined || input.text.trim() === ""
      ? []
      : [fenced(input.text, FENCE_LANGUAGE[input.kind])]),
    ...(output === undefined || output.text.trim() === ""
      ? []
      : [`Output:\n\n${fenced(bounded(output.text), FENCE_LANGUAGE[output.kind])}`]),
    ...(error === undefined ? [] : [`Error:\n\n${fenced(bounded(error), "")}`]),
  ].join("\n\n");
}

/** A block as the full copy reads it, empty where it says nothing. */
function blockSaid(block: CopiedBlock): string {
  switch (block.kind) {
    case COPIED_BLOCK.WORDS:
      return block.text.trim();
    case COPIED_BLOCK.REASONING:
      return block.text.trim() === "" ? "" : reasoningSaid(block.text);
    case COPIED_BLOCK.CALL:
      return callBlockSaid(block);
  }
}

/** A turn as the full copy reads it: every block in order. */
function fullTurn(turn: CopiedTurn): string[] {
  return turn.blocks.map(blockSaid).filter((each) => each.length > 0);
}

/** The transcript as the markdown the copy asked for puts on the clipboard: its name, its brief, then each turn under who said it. */
export function transcriptMarkdown(transcript: CopiedTranscript, copy: TranscriptCopy): string {
  const { brief } = transcript;
  const turns = transcript.turns.flatMap((turn) => {
    const said = copy === TRANSCRIPT_COPY.CONCISE ? conciseTurn(turn) : fullTurn(turn);
    return said.length === 0 ? [] : [headingOf(turn), ...said];
  });
  return `${[
    `# ${transcript.title}`,
    ...(brief === undefined ? [] : [`## ${brief.label}`, brief.text.trim()]),
    ...(transcript.earlierOmitted ? [EARLIER_OMITTED_LINE] : []),
    ...turns,
  ].join("\n\n")}\n`;
}

/** The rest of a transcript from a page on: the messages held with each page joined, until a page shorter than the most one carries, or nothing where a read did not answer. */
async function pagesFrom(
  read: TranscriptReader,
  params: Parameters<TranscriptReader>[0],
  held: readonly CodingAgentMessage[],
): Promise<readonly CodingAgentMessage[] | undefined> {
  const answer = await read(params).catch(() => ({
    failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
  }));
  if ("failure" in answer) return undefined;
  const messages = applyMessagesPage(held, answer.messages);
  if (answer.messages.length < CODING_AGENT_BOUNDS.MESSAGES_PAGE) return messages;
  return pagesFrom(read, { ...params, after: answer.cursor }, messages);
}

/**
 * Every message of an agent's transcript, or of one of its workers' under
 * the call that started it, as it stands now, read from the start, or
 * nothing where a read did not answer. Note that a page shorter than the
 * most one carries ends the read rather than an empty one, because the
 * service holds a read with nothing past its cursor open while the agent
 * runs, and a copy waits on no hold.
 */
export function readWholeTranscript(
  read: TranscriptReader,
  of: { agentId: string; callId?: string | undefined },
): Promise<readonly CodingAgentMessage[] | undefined> {
  const { agentId, callId } = of;
  const params = { agentId, after: CODING_AGENT_CURSOR_START };
  return pagesFrom(read, callId === undefined ? params : { ...params, callId }, []);
}
