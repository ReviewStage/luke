import {
  firstMessageParts,
  type NoteFiles,
  REPLAY_SENDER,
  REPLAY_STEP_KIND,
  REPLAY_TOOL_STATE,
  REPLAY_VALUE_FORM,
  type Replay,
  type ReplayStep,
  type ReplayToolState,
  type ReplayValueForm,
} from "@repo/features/agent-replay";
import {
  AGENT_SENDER,
  type AgentSender,
  type AgentSummary,
  type AgentTodos,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { CALL_KIND, CALL_WORDS, type CallKind } from "@repo/features/turn-rows";
import { isRecord, valueFromJsonText, type WireValue } from "@repo/wire";
import { TOOL_BLOCK, TOOL_STATE, type ToolState } from "../ai-elements/tool.js";
import { AGENT_PART, agentParts, isTaskCall, messageWords } from "./agent-model.js";
import { foldTaskCall, NO_TASKS, type TaskFold, todosOf } from "./agent-todos.js";
import { type DrawnCall, drawnCall } from "./native-tool-calls.js";
import {
  type CalledAgent,
  calledAgent,
  isServerCallTool,
  type ToolCallView,
  todosListView,
  toolCallView,
} from "./tool-call-model.js";

export const REPLAY_VERB = {
  CONTINUED: "Continued from",
  FORKED: "Forked from",
} as const;

type ReplayVerb = (typeof REPLAY_VERB)[keyof typeof REPLAY_VERB];

const AGENT_WORD = "Agent";

const SENDER_WORD = "Developer";

const SPEAKER_SEPARATOR = ": ";

const SAID_WORD = "Said";

const CALL_PARTS = {
  INPUT: "Input: ",
  RESULT: "\nResult: ",
  FAILED: "Failed: ",
} as const;

const RUNNING_MARK = " (running)";

const NO_RESULT = "(no result: the call was still under way)";

const VERB_KIND: ReadonlyMap<string, CallKind> = new Map(
  Object.values(CALL_KIND)
    .toReversed()
    .map((kind) => [CALL_WORDS[kind].verb, kind] as const),
);

export const STEP_VIEW = {
  LINE: "line",
  SAID: "said",
  CALL: "call",
} as const;

export type StepView =
  | {
      readonly kind: typeof STEP_VIEW.LINE;
      readonly sender: string;
      readonly sentBy: AgentSender | undefined;
      readonly own: boolean;
      readonly at: number | undefined;
      readonly words: string;
    }
  | { readonly kind: typeof STEP_VIEW.SAID; readonly words: string }
  | {
      readonly kind: typeof STEP_VIEW.CALL;
      readonly state: ToolState;
      readonly view: ToolCallView;
      readonly errorText: string | undefined;
      readonly agent: CalledAgent | undefined;
    };

const MAX_CHAIN = 32;

export const REPLAY_PAGE = 20;

export interface ReplayPage {
  readonly from: number;
  readonly next: number;
}

export interface ReplayOpening {
  readonly brief: AgentTranscriptMessage;
  readonly replay: Replay;
  readonly note: AgentTranscriptMessage | undefined;
}

const NOTE_LINE_ID = "replay-note";

export interface StepLine {
  readonly who: string;
  readonly line: string;
}

function withWords(
  message: AgentTranscriptMessage,
  words: string,
  files: AgentTranscriptMessage["parts"],
): AgentTranscriptMessage {
  return { ...message, parts: [...files, { type: "text", text: words }] };
}

const TEXT_FILE_TYPE = "text/plain";

const OPENINGS = new WeakMap<AgentTranscriptMessage, ReplayOpening | undefined>();

function filesOf(message: AgentTranscriptMessage, noteFiles: NoteFiles) {
  const kinds = agentParts(message);
  const files = message.parts.filter((_, index) => kinds[index]?.kind !== AGENT_PART.TEXT);
  const isText = (part: (typeof files)[number]) =>
    isRecord(part) && part.mediaType === TEXT_FILE_TYPE;
  const texts = files.filter(isText);
  const others = files.filter((part) => !isText(part));
  const note = new Set([
    ...texts.slice(texts.length - Math.min(noteFiles.text, texts.length)),
    ...others.slice(others.length - Math.min(noteFiles.other, others.length)),
  ]);
  return {
    brief: files.filter((part) => !note.has(part)),
    note: files.filter((part) => note.has(part)),
  };
}

function readOpening(first: AgentTranscriptMessage): ReplayOpening | undefined {
  const parts = firstMessageParts(messageWords(first));
  if (parts.replay === undefined) return undefined;
  const files = filesOf(first, parts.note?.files ?? { text: 0, other: 0 });
  return {
    brief: withWords(first, parts.brief, files.brief),
    replay: parts.replay,
    note:
      parts.note === undefined
        ? undefined
        : { ...withWords(first, parts.note.text, files.note), id: NOTE_LINE_ID },
  };
}

export function replayOpening(first: AgentTranscriptMessage): ReplayOpening | undefined {
  if (OPENINGS.has(first)) return OPENINGS.get(first);
  const opening = readOpening(first);
  OPENINGS.set(first, opening);
  return opening;
}

export function replayVerb(replay: Replay): ReplayVerb {
  return replay.messageId === undefined ? REPLAY_VERB.CONTINUED : REPLAY_VERB.FORKED;
}

export function replayCount(replay: Replay): string {
  const kept = replay.steps.length;
  if (kept < replay.totalSteps) return `${kept} of ${replay.totalSteps} steps`;
  return kept === 1 ? "1 step" : `${kept} steps`;
}

export function leftOutLine(replay: Replay): string | undefined {
  const left = replay.totalSteps - replay.steps.length - (replay.summary?.steps ?? 0);
  if (left <= 0) return undefined;
  const steps = left === 1 ? "1 earlier step was" : `${left} earlier steps were`;
  return `${steps} left out to keep the replay within its size limit.`;
}

export function summaryLine(replay: Replay): string | undefined {
  const steps = replay.summary?.steps;
  if (steps === undefined) return undefined;
  return `Summary of ${steps === 1 ? "1 earlier step" : `${steps} earlier steps`} (written by ${PRODUCT_NAME})`;
}

export function replayPage(kept: number, shown: number): ReplayPage {
  const from = Math.max(0, kept - Math.max(shown, REPLAY_PAGE));
  return { from, next: Math.min(REPLAY_PAGE, from) };
}

export function earlierStepsLine(page: ReplayPage): string {
  if (page.next < page.from) return `Show ${page.next} of ${page.from} earlier steps`;
  return page.next === 1 ? "Show 1 earlier step" : `Show ${page.next} earlier steps`;
}

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

function briefSource(agent: AgentSummary, agents: readonly AgentSummary[]): AgentSummary {
  let at = agent;
  for (let link = 0; link < MAX_CHAIN && at.from !== undefined; link += 1) {
    const sourceId: string = at.from.agentId;
    const source = agents.find((each) => each.id === sourceId);
    if (source === undefined) return at;
    at = source;
  }
  return at;
}

export function briefAgent(agent: AgentSummary, agents: readonly AgentSummary[]): AgentSummary {
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

function wireOf(words: string, form: ReplayValueForm | undefined): WireValue {
  if (form === REPLAY_VALUE_FORM.TEXT) return words;
  const value = valueFromJsonText(words);
  if (form === REPLAY_VALUE_FORM.JSON) return value;
  return isRecord(value) || Array.isArray(value) ? value : words;
}

interface CallRead {
  readonly state: ToolState;
  readonly input: string;
  readonly output: string | undefined;
  readonly errorText: string | undefined;
}

const ROW_STATE = {
  [REPLAY_TOOL_STATE.DONE]: TOOL_STATE.OUTPUT_AVAILABLE,
  [REPLAY_TOOL_STATE.FAILED]: TOOL_STATE.OUTPUT_ERROR,
  [REPLAY_TOOL_STATE.RUNNING]: TOOL_STATE.INPUT_AVAILABLE,
} as const satisfies Record<ReplayToolState, ToolState>;

function markedCall(
  step: ReplayStep & { readonly state: ReplayToolState; readonly input: string },
): CallRead {
  const { state, input, output } = step;
  return {
    state: ROW_STATE[state],
    input,
    output: state === REPLAY_TOOL_STATE.DONE ? output : undefined,
    errorText: state === REPLAY_TOOL_STATE.FAILED ? output : undefined,
  };
}

function spelledCall(step: ReplayStep): CallRead {
  const words = step.words.startsWith(CALL_PARTS.INPUT)
    ? step.words.slice(CALL_PARTS.INPUT.length)
    : step.words;
  const at = words.indexOf(CALL_PARTS.RESULT);
  const input = at < 0 ? words : words.slice(0, at);
  const result = at < 0 ? undefined : words.slice(at + CALL_PARTS.RESULT.length);
  const running =
    step.summary.endsWith(RUNNING_MARK) && (result === undefined || result === NO_RESULT);
  const failed = !running && result?.startsWith(CALL_PARTS.FAILED) === true;
  return {
    state: running
      ? TOOL_STATE.INPUT_AVAILABLE
      : failed
        ? TOOL_STATE.OUTPUT_ERROR
        : TOOL_STATE.OUTPUT_AVAILABLE,
    input,
    output: running || failed ? undefined : result,
    errorText: failed ? result?.slice(CALL_PARTS.FAILED.length) : undefined,
  };
}

function stepCall(
  step: ReplayStep & { readonly state: ReplayToolState; readonly input: string },
  tool: string,
): DrawnCall {
  const read = markedCall(step);
  return drawnCall({
    tool,
    input: wireOf(read.input, step.inputForm),
    output: read.output === undefined ? undefined : wireOf(read.output, step.outputForm),
  });
}

function toolView(
  step: ReplayStep & { readonly state: ReplayToolState; readonly input: string },
  tool: string,
  todos: Todos | undefined,
): StepView {
  const read = markedCall(step);
  const call = stepCall(step, tool);
  return {
    kind: STEP_VIEW.CALL,
    state: read.state,
    view: todos === undefined ? toolCallView(call) : todosListView(todos),
    errorText: read.errorText,
    agent: calledAgent(call),
  };
}

type Todos = AgentTodos["todos"];

type MarkedToolStep = ReplayStep & {
  readonly state: ReplayToolState;
  readonly input: string;
  readonly tool: string;
};

function markedToolStep(step: ReplayStep): MarkedToolStep | undefined {
  const { state, input, tool } = step;
  return state !== undefined && input !== undefined && tool !== undefined
    ? { ...step, state, input, tool }
    : undefined;
}

export function replayTaskTodos(steps: readonly ReplayStep[]): ReadonlyMap<number, Todos> {
  const lists = new Map<number, Todos>();
  let fold: TaskFold = NO_TASKS;
  steps.forEach((step, index) => {
    const marked = step.kind === REPLAY_STEP_KIND.TOOL ? markedToolStep(step) : undefined;
    if (marked === undefined || !isTaskCall(marked.tool)) return;
    const read = markedCall(marked);
    fold = foldTaskCall(fold, {
      ...stepCall(marked, marked.tool),
      failed: read.state === TOOL_STATE.OUTPUT_ERROR,
    });
    lists.set(index, todosOf(fold));
  });
  return lists;
}

function callView(step: ReplayStep, todos: Todos | undefined): StepView {
  const { state, input, tool } = step;
  const marked = state !== undefined && input !== undefined ? { ...step, state, input } : undefined;
  if (marked !== undefined && tool !== undefined) return toolView(marked, tool, todos);
  const read = marked === undefined ? spelledCall(step) : markedCall(marked);
  const split = step.summary.indexOf(SPEAKER_SEPARATOR);
  const verb = split < 0 ? step.summary : step.summary.slice(0, split);
  const running = read.state === TOOL_STATE.INPUT_AVAILABLE && step.summary.endsWith(RUNNING_MARK);
  const subject =
    split < 0
      ? ""
      : step.summary.slice(
          split + SPEAKER_SEPARATOR.length,
          running ? -RUNNING_MARK.length : undefined,
        );
  return {
    kind: STEP_VIEW.CALL,
    state: read.state,
    view: {
      kind: VERB_KIND.get(verb) ?? CALL_KIND.OTHER,
      subject: subject === "" ? step.summary : subject,
      input: { kind: TOOL_BLOCK.TEXT, text: read.input },
      output: read.output === undefined ? undefined : { kind: TOOL_BLOCK.TEXT, text: read.output },
    },
    errorText: read.errorText,
    agent: undefined,
  };
}

function sentByOf(step: ReplayStep, name: string): AgentSender | undefined {
  const sent = step.sender;
  switch (sent?.kind) {
    case undefined:
    case REPLAY_SENDER.DEVELOPER:
      return undefined;
    case REPLAY_SENDER.MEMBER:
      return sent.memberId === undefined
        ? { kind: AGENT_SENDER.MEMBER, name }
        : { kind: AGENT_SENDER.MEMBER, userId: sent.memberId, name };
    case REPLAY_SENDER.APP:
      return { kind: AGENT_SENDER.APP, name };
    case REPLAY_SENDER.AUTOMATION:
      return { kind: AGENT_SENDER.AUTOMATION, name };
    case REPLAY_SENDER.GITHUB:
      return { kind: AGENT_SENDER.GITHUB, name };
    case REPLAY_SENDER.AGENT:
      return { name, agent: true };
  }
}

export function stepView(step: ReplayStep, todos?: Todos): StepView {
  switch (step.kind) {
    case REPLAY_STEP_KIND.LINE: {
      const sender = stepLine(step).who;
      return {
        kind: STEP_VIEW.LINE,
        sender,
        sentBy: sentByOf(step, sender),
        own: step.sender?.kind === REPLAY_SENDER.DEVELOPER,
        at: step.at,
        words: step.words,
      };
    }
    case REPLAY_STEP_KIND.SAID:
      return { kind: STEP_VIEW.SAID, words: step.words };
    case REPLAY_STEP_KIND.TOOL:
      return callView(step, todos);
  }
}

function stepWords(step: ReplayStep): string {
  switch (step.kind) {
    case REPLAY_STEP_KIND.LINE:
      return `${stepLine(step).who}${SPEAKER_SEPARATOR}${step.words}`;
    case REPLAY_STEP_KIND.SAID:
      return step.words;
    case REPLAY_STEP_KIND.TOOL:
      return `${step.summary}\n${step.words}`;
  }
}

export function replayWords(replay: Replay): string {
  const summary = replay.summary === undefined ? [] : [replay.summary.text];
  return [...summary, ...replay.steps.map(stepWords)].join("\n\n");
}

function callsServer(step: ReplayStep): boolean {
  const { state, input, tool } = step;
  if (step.kind !== REPLAY_STEP_KIND.TOOL || state === undefined || input === undefined)
    return false;
  return tool !== undefined && isServerCallTool(stepCall({ ...step, state, input }, tool).tool);
}

export function replayCallsServer(steps: readonly ReplayStep[]): boolean {
  return steps.some(callsServer);
}
