import type { Replay } from "@repo/features/agent-replay";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  AGENT_BOUNDS,
  AGENT_BRIEF,
  AGENT_CURSOR_START,
  type AgentBrief,
  type AgentTranscriptMessage,
  agentMessageWords,
  applyMessagesPage,
} from "@repo/features/agent-wire";
import { threadLineTitle, threadLineWords } from "@repo/features/inbox-wire";
import {
  CALL_KIND,
  CALL_WORDS,
  type CallKind,
  callLine,
  callPlace,
  isCommandKind,
  TURN_ROW,
  type TurnRow,
} from "@repo/features/turn-rows";
import { MESSAGE_ROLE } from "@repo/wire";
import { unreachedAs } from "../act.js";
import { blockSays, bodyWords, TOOL_BLOCK, type ToolBlock } from "../ai-elements/tool.js";
import {
  AGENT_PART,
  type AgentPart,
  agentMessageOf,
  agentRows,
  commentLineOf,
  commentLineWords,
  githubLineOf,
  githubLineWords,
  isDelegation,
  messageWords,
  placedMessages,
  slackLineOf,
  threadLineOf,
  turnStretches,
  workerLines,
} from "./agent-model.js";
import {
  COMMENT_LINE_LEAD,
  commentLineSubject,
  SLACK_LINE_LEAD,
  SLACK_LINE_SUBJECT,
  THREAD_LINE_DID,
} from "./line-cards.js";
import {
  leftOutLine,
  replayCount,
  replayOpening,
  replayVerb,
  stepLine,
  summaryLine,
} from "./replay-card-model.js";
import { cardTitle, delegationView, plainWords, toolCallView } from "./tool-call-model.js";
import type { TranscriptReader } from "./use-agent-transcript.js";

export const TRANSCRIPT_COPY = {
  CONCISE: "concise",
  FULL: "full",
} as const;

export type TranscriptCopy = (typeof TRANSCRIPT_COPY)[keyof typeof TRANSCRIPT_COPY];

export const LATEST_ACTIVITY = {
  WORDS: "words",
  CALL: "call",
} as const;

export type LatestActivity =
  | { readonly kind: typeof LATEST_ACTIVITY.WORDS; readonly text: string }
  | {
      readonly kind: typeof LATEST_ACTIVITY.CALL;
      readonly verb: string;
      readonly subject: string;
      readonly code: boolean;
    };

const SPEAKER = {
  DEVELOPER: "Developer",
  AGENT: "Agent",
  SUBAGENT: "Subagent",
  MESSAGE: "Message from",
} as const;

type Speaker = (typeof SPEAKER)[keyof typeof SPEAKER];

const BRIEF_LABEL = {
  DESCRIPTION: "Description",
  PROMPT: "Prompt",
  SUBAGENT_TASK: "Subagent task",
} as const;

const OUTPUT_LIMIT = 4_000;

const TRUNCATED_LINE = "…truncated";

const SUBJECT_LIMIT = 160;

const EARLIER_OMITTED_LINE = "_Earlier steps are not shown._";

const FENCE_LANGUAGE = {
  [TOOL_BLOCK.COMMAND]: "sh",
  [TOOL_BLOCK.PATCH]: "diff",
  [TOOL_BLOCK.JSON]: "json",
  [TOOL_BLOCK.TEXT]: "",
} as const satisfies Record<ToolBlock["kind"], string>;

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
      readonly description: string | undefined;
      readonly server?: string | undefined;
      readonly input: ToolBlock | undefined;
      readonly output: ToolBlock | undefined;
      readonly error: string | undefined;
    };

type CopiedCall = Extract<CopiedBlock, { kind: typeof COPIED_BLOCK.CALL }>;

interface CopiedTurn {
  readonly speaker: Speaker;
  readonly from?: string | undefined;
  readonly blocks: readonly CopiedBlock[];
}

function handedIn(turn: CopiedTurn): boolean {
  return turn.speaker === SPEAKER.DEVELOPER || turn.speaker === SPEAKER.MESSAGE;
}

function headingOf(turn: CopiedTurn): string {
  return turn.from === undefined ? `## ${turn.speaker}` : `## ${turn.speaker} ${turn.from}`;
}

const REPLAY_SOURCE_WORDS = "an earlier agent";

export interface CopiedTranscript {
  readonly title: string;
  readonly brief: { readonly label: string; readonly text: string } | undefined;
  readonly replay?: Replay | undefined;
  readonly earlierOmitted: boolean;
  readonly turns: readonly CopiedTurn[];
}

function textBlock(text: string): ToolBlock {
  return { kind: TOOL_BLOCK.TEXT, text };
}

function rowBlocks<B>(rows: readonly TurnRow<B>[]): readonly B[] {
  return rows.flatMap((row) => {
    if (row.kind === TURN_ROW.BLOCK) return [row.block];
    return row.kind === TURN_ROW.GROUP ? row.blocks : rowBlocks(row.rows);
  });
}

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
  const { input, output, subject, description, server } = view;
  return [
    {
      kind: COPIED_BLOCK.CALL,
      call: view.kind,
      subject,
      description,
      server,
      input,
      output,
      error,
    },
  ];
}

function drawnWords(block: CopiedBlock): readonly string[] {
  if (block.kind !== COPIED_BLOCK.CALL) return [block.text];
  const { call, subject, description, server, input, output, error } = block;
  const line = callLine(call, subject, description);
  const said =
    input !== undefined &&
    ((isCommandKind(call) && input.kind === TOOL_BLOCK.COMMAND) || blockSays(input, subject));
  const lead = [line.verb, said ? undefined : line.subject, callPlace(call, server)];
  return [
    lead.filter((words) => words !== undefined).join(" "),
    ...bodyWords(input, output, error),
  ];
}

export function drawnMessageWords(message: AgentTranscriptMessage): string {
  const sent = sentLineWords(message);
  return sent ?? drawnRowsWords(agentRows(message, false));
}

export function drawnRowsWords(rows: readonly TurnRow<AgentPart>[]): string {
  return rowBlocks(rows).flatMap(agentBlock).flatMap(drawnWords).join("\n");
}

function developerTurn(message: AgentTranscriptMessage): CopiedTurn {
  const words = messageWords(message);
  if (agentMessageOf(message) !== undefined) {
    const blocks = [{ kind: COPIED_BLOCK.WORDS, text: agentMessageWords(words) ?? words }] as const;
    return { speaker: SPEAKER.MESSAGE, from: message.sentBy?.name, blocks };
  }
  const blocks = [{ kind: COPIED_BLOCK.WORDS, text: sentLineWords(message) ?? words }] as const;
  return { speaker: SPEAKER.DEVELOPER, blocks };
}

const THREAD_WORDS = "the thread";

function sentLineWords(message: AgentTranscriptMessage): string | undefined {
  const github = githubLineOf(message);
  if (github !== undefined) return githubLineWords(github, messageWords(message));
  const comment = commentLineOf(message);
  if (comment !== undefined) {
    return `${COMMENT_LINE_LEAD.OWN} ${commentLineSubject(comment)}\n\n${commentLineWords(comment)}`;
  }
  const slack = slackLineOf(message);
  if (slack !== undefined) return `${SLACK_LINE_LEAD.OWN} ${SLACK_LINE_SUBJECT}\n\n${slack.words}`;
  const thread = threadLineOf(message);
  if (thread === undefined) return undefined;
  const words = messageWords(message);
  const title = threadLineTitle(words, thread.event) ?? THREAD_WORDS;
  return [`${THREAD_LINE_DID[thread.event].OWN} ${title}`, threadLineWords(words, thread.event)]
    .filter((part) => part !== "")
    .join("\n\n");
}

export function agentTranscript(input: {
  title: string;
  messages: readonly AgentTranscriptMessage[];
  brief: AgentBrief | undefined;
  task?: string | undefined;
}): CopiedTranscript {
  const { title, brief, task } = input;
  const messages = task === undefined ? input.messages : workerLines(task, input.messages);
  const first =
    brief === AGENT_BRIEF.BLANK && task === undefined
      ? undefined
      : messages.find(
          (message) => message.role === MESSAGE_ROLE.USER && agentMessageOf(message) === undefined,
        );
  const label =
    task !== undefined
      ? BRIEF_LABEL.SUBAGENT_TASK
      : brief === AGENT_BRIEF.PROMPT
        ? BRIEF_LABEL.PROMPT
        : BRIEF_LABEL.DESCRIPTION;
  const speaker = task === undefined ? SPEAKER.AGENT : SPEAKER.SUBAGENT;
  const opening = first === undefined || task !== undefined ? undefined : replayOpening(first);
  const note = opening?.note === undefined ? [] : [developerTurn(opening.note)];
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
    brief: first === undefined ? undefined : { label, text: messageWords(opening?.brief ?? first) },
    ...(opening === undefined ? undefined : { replay: opening.replay }),
    earlierOmitted: false,
    turns: [...note, ...turns],
  };
}

function longestTicks(text: string): number {
  return Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
}

function inlineCode(text: string): string {
  const ticks = "`".repeat(longestTicks(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

function fenced(text: string, language: string): string {
  const fence = "`".repeat(Math.max(3, longestTicks(text) + 1));
  return `${fence}${language}\n${text.trimEnd()}\n${fence}`;
}

function bounded(text: string): string {
  return text.length <= OUTPUT_LIMIT
    ? text
    : `${text.slice(0, OUTPUT_LIMIT).trimEnd()}\n${TRUNCATED_LINE}`;
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length <= SUBJECT_LIMIT ? line : `${line.slice(0, SUBJECT_LIMIT).trimEnd()}…`;
}

function callParts(call: CopiedCall) {
  const worker = call.call === CALL_KIND.WORKER;
  const said = call.description ?? CALL_WORDS[call.call].verb;
  const place = callPlace(call.call, call.server);
  const named = call.server === undefined ? place?.replace(/^./u, (c) => c.toLowerCase()) : place;
  return {
    verb: named === undefined ? said : `${said} (${named})`,
    subject: oneLine(call.subject),
    joiner: worker || call.description !== undefined ? ": " : " ",
    code: !worker && CALL_WORDS[call.call].code,
  };
}

function callSaid(call: CopiedCall, styled: (verb: string) => string) {
  const { verb, subject, joiner, code } = callParts(call);
  if (subject === "") return styled(verb).replace(/:$/u, "");
  return `${styled(verb)}${joiner}${code ? inlineCode(subject) : subject}`;
}

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

function previewed(block: CopiedBlock): boolean {
  if (block.kind === COPIED_BLOCK.CALL) return true;
  return block.kind === COPIED_BLOCK.WORDS && plainWords(block.text) !== "";
}

export function latestActivity(transcript: CopiedTranscript): LatestActivity | undefined {
  const turn = transcript.turns.findLast((each) => !handedIn(each) && each.blocks.some(previewed));
  const block = turn?.blocks.findLast(previewed);
  if (block === undefined || block.kind === COPIED_BLOCK.REASONING) return undefined;
  if (block.kind === COPIED_BLOCK.WORDS) {
    return { kind: LATEST_ACTIVITY.WORDS, text: plainWords(block.text) };
  }
  if (block.description !== undefined) {
    const { verb } = callParts(block);
    return { kind: LATEST_ACTIVITY.CALL, verb, subject: "", code: false };
  }
  const { verb, subject, joiner, code } = callParts(block);
  const lead = subject === "" ? verb.replace(/:$/u, "") : `${verb}${joiner.trimEnd()}`;
  return { kind: LATEST_ACTIVITY.CALL, verb: lead, subject, code };
}

function quoted(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

function reasoningSaid(text: string): string {
  return `**Reasoning**\n\n${quoted(text)}`;
}

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

function fullTurn(turn: CopiedTurn): string[] {
  return turn.blocks.map(blockSaid).filter((each) => each.length > 0);
}

function replaySaid(replay: Replay, copy: TranscriptCopy): string[] {
  const heading = `## ${replayVerb(replay)} ${REPLAY_SOURCE_WORDS} · ${replayCount(replay)}`;
  const left = leftOutLine(replay);
  const steps = replay.steps.map((step) => {
    const { who, line } = stepLine(step);
    if (copy === TRANSCRIPT_COPY.CONCISE) return `- **${who}:** ${oneLine(line)}`;
    return `**${who}:** ${line}\n\n${fenced(step.words, "")}`;
  });
  const listed = copy === TRANSCRIPT_COPY.CONCISE && steps.length > 0 ? [steps.join("\n")] : steps;
  const summary = summaryLine(replay);
  const summarized =
    summary === undefined || replay.summary === undefined
      ? []
      : [`**${summary}**`, quoted(replay.summary.text)];
  return [heading, ...summarized, ...(left === undefined ? [] : [`_${left}_`]), ...listed];
}

export function transcriptMarkdown(transcript: CopiedTranscript, copy: TranscriptCopy): string {
  const { brief } = transcript;
  const turns = transcript.turns.flatMap((turn) => {
    const said = copy === TRANSCRIPT_COPY.CONCISE ? conciseTurn(turn) : fullTurn(turn);
    return said.length === 0 ? [] : [headingOf(turn), ...said];
  });
  return `${[
    `# ${transcript.title}`,
    ...(brief === undefined ? [] : [`## ${brief.label}`, brief.text.trim()]),
    ...(transcript.replay === undefined ? [] : replaySaid(transcript.replay, copy)),
    ...(transcript.earlierOmitted ? [EARLIER_OMITTED_LINE] : []),
    ...turns,
  ].join("\n\n")}\n`;
}

export interface TranscriptUnread {
  readonly unread: unknown;
}

async function pagesFrom(
  read: TranscriptReader,
  params: Parameters<TranscriptReader>[0],
  held: readonly AgentTranscriptMessage[],
): Promise<readonly AgentTranscriptMessage[] | TranscriptUnread> {
  const answer = await read(params).catch(unreachedAs(AGENT_CALL_FAILURE.UNANSWERED));
  if ("failure" in answer) return { unread: answer };
  const messages = applyMessagesPage(held, answer.messages);
  if (answer.messages.length < AGENT_BOUNDS.MESSAGES_PAGE) return messages;
  return pagesFrom(read, { ...params, after: answer.cursor }, messages);
}

export function readWholeTranscript(
  read: TranscriptReader,
  of: { agentId: string; callId?: string | undefined },
): Promise<readonly AgentTranscriptMessage[] | TranscriptUnread> {
  const { agentId, callId } = of;
  const params = { agentId, after: AGENT_CURSOR_START };
  return pagesFrom(read, callId === undefined ? params : { ...params, callId }, []);
}
