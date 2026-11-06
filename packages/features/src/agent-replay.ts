export const START_NOTE_HEADING = {
  DEVELOPER: "## Note from the developer",
  AGENT: "## Note from the agent that started you",
} as const;

const RETIRED_AGENT_NOTE_HEADING = "## Note from the coding agent that started you";

export type StartNoteHeading = (typeof START_NOTE_HEADING)[keyof typeof START_NOTE_HEADING];

const REPLAY_HEADING = "## The work you continue from";

export const REPLAY_STEP_KIND = {
  LINE: "line",
  SAID: "said",
  TOOL: "tool",
} as const;

type ReplayStepKind = (typeof REPLAY_STEP_KIND)[keyof typeof REPLAY_STEP_KIND];

export const REPLAY_TOOL_STATE = {
  DONE: "done",
  FAILED: "failed",
  RUNNING: "running",
} as const;

export type ReplayToolState = (typeof REPLAY_TOOL_STATE)[keyof typeof REPLAY_TOOL_STATE];

export const REPLAY_VALUE_FORM = {
  TEXT: "text",
  JSON: "json",
} as const;

export type ReplayValueForm = (typeof REPLAY_VALUE_FORM)[keyof typeof REPLAY_VALUE_FORM];

export const REPLAY_SENDER = {
  DEVELOPER: "developer",
  MEMBER: "member",
  APP: "app",
  AUTOMATION: "automation",
  GITHUB: "github",
  AGENT: "agent",
} as const;

type ReplaySenderKind = (typeof REPLAY_SENDER)[keyof typeof REPLAY_SENDER];

interface ReplaySender {
  readonly kind: ReplaySenderKind;
  readonly memberId?: string;
}

export interface ReplayStep {
  readonly kind: ReplayStepKind;
  readonly summary: string;
  readonly words: string;
  readonly state?: ReplayToolState;
  readonly input?: string;
  readonly output?: string;
  readonly tool?: string;
  readonly inputForm?: ReplayValueForm;
  readonly outputForm?: ReplayValueForm;
  readonly sender?: ReplaySender;
  readonly at?: number;
}

const TOOL_WORDS = {
  INPUT: "Input: ",
  RESULT: "\nResult: ",
  FAILED: "Failed: ",
  NO_RESULT: "(no result: the call was still under way)",
} as const;

export function toolStep(call: {
  readonly summary: string;
  readonly state: ReplayToolState;
  readonly input: string;
  readonly output?: string;
  readonly tool?: string;
  readonly inputForm?: ReplayValueForm;
  readonly outputForm?: ReplayValueForm;
}): ReplayStep {
  const result =
    call.state === REPLAY_TOOL_STATE.RUNNING
      ? TOOL_WORDS.NO_RESULT
      : `${call.state === REPLAY_TOOL_STATE.FAILED ? TOOL_WORDS.FAILED : ""}${call.output ?? ""}`;
  return {
    kind: REPLAY_STEP_KIND.TOOL,
    summary: call.summary,
    words: `${TOOL_WORDS.INPUT}${call.input}${TOOL_WORDS.RESULT}${result}`,
    state: call.state,
    input: call.input,
    ...(call.state === REPLAY_TOOL_STATE.RUNNING ? undefined : { output: call.output ?? "" }),
    ...(call.tool === undefined ? undefined : { tool: call.tool }),
    ...(call.inputForm === undefined ? undefined : { inputForm: call.inputForm }),
    ...(call.state === REPLAY_TOOL_STATE.RUNNING || call.outputForm === undefined
      ? undefined
      : { outputForm: call.outputForm }),
  };
}

export interface ReplaySummary {
  readonly text: string;
  readonly steps: number;
}

export interface Replay {
  readonly agentId: string;
  readonly messageId?: string;
  readonly preamble: string;
  readonly summary?: ReplaySummary;
  readonly steps: readonly ReplayStep[];
  readonly totalSteps: number;
}

export interface NoteFiles {
  readonly text: number;
  readonly other: number;
}

const NO_NOTE_FILES: NoteFiles = { text: 0, other: 0 };

interface FirstMessageNote {
  readonly heading: StartNoteHeading;
  readonly text: string;
  readonly files: NoteFiles;
}

export interface FirstMessage {
  readonly brief: string;
  readonly replay?: Replay;
  readonly note?: FirstMessageNote;
}

const MARKER_SPACE = "agent";
const LEGACY_MARKER_SPACE = "luke";
const MARKER_SPACES = [MARKER_SPACE, LEGACY_MARKER_SPACE] as const;
const SPACE = `(?:${MARKER_SPACE}|${LEGACY_MARKER_SPACE})`;

const REPLAY_CLOSES = MARKER_SPACES.map((space) => `<!-- /${space}:replay -->`);
const REPLAY_CLOSE = `<!-- /${MARKER_SPACE}:replay -->`;
const REPLAY_OPEN_START = `<!-- ${MARKER_SPACE}:replay `;
const REPLAY_HEADING_LEAD = `\n\n${REPLAY_HEADING}\n\n`;
const REPLAY_LEADS = MARKER_SPACES.map((space) => `${REPLAY_HEADING_LEAD}<!-- ${space}:replay `);
const MARKER_END = " -->\n";
const SECTION_GAP = "\n\n";

const NOTE_OPEN = new RegExp(
  `^<!-- ${SPACE}:note text-files=(\\d+) other-files=(\\d+) chars=(\\d+) -->\\n`,
  "u",
);
const NOTE_OPEN_START = `<!-- ${MARKER_SPACE}:note `;
const NOTE_OPEN_STARTS = MARKER_SPACES.map((space) => `<!-- ${space}:note `);

const REPLAY_OPEN = new RegExp(
  `^<!-- ${SPACE}:replay agent=([0-9a-f-]+)(?: message=([0-9a-f-]+))? steps=(\\d+) total-steps=(\\d+) chars=(\\d+) -->\\n`,
  "u",
);
const STEP_OPEN = new RegExp(
  `^<!-- ${SPACE}:step kind=([a-z]+)((?: [a-z-]+=[A-Za-z0-9_.:@-]+)*) chars=(\\d+) -->\\n`,
  "u",
);
const STEP_ATTRIBUTE = / ([a-z-]+)=([A-Za-z0-9_.:@-]+)/gu;
const ATTRIBUTE_VALUE = /^[A-Za-z0-9_.:@-]+$/u;
const INSTANT_VALUE = /^\d+$/u;
const TOOL_STATES: ReadonlySet<string> = new Set(Object.values(REPLAY_TOOL_STATE));
const SENDER_KINDS: ReadonlySet<string> = new Set(Object.values(REPLAY_SENDER));
const LEGACY_APP_SENDER = "luke";
const VALUE_FORMS: ReadonlySet<string> = new Set(Object.values(REPLAY_VALUE_FORM));
const SUMMARY_BY = "app";
const SUMMARY_OPEN = new RegExp(
  `^<!-- ${SPACE}:summary by=(?:${SUMMARY_BY}|luke) steps=(\\d+) chars=(\\d+) -->\\n`,
  "u",
);

const STEP_KINDS: ReadonlySet<string> = new Set(Object.values(REPLAY_STEP_KIND));
const NOTE_HEADINGS: readonly (readonly [string, StartNoteHeading])[] = [
  ...Object.values(START_NOTE_HEADING).map((heading) => [heading, heading] as const),
  [RETIRED_AGENT_NOTE_HEADING, START_NOTE_HEADING.AGENT],
];

function firstIndexOf(text: string, needles: readonly string[], from: number): number {
  const found = needles.map((needle) => text.indexOf(needle, from)).filter((at) => at >= 0);
  return found.length === 0 ? -1 : Math.min(...found);
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function spelled(key: string, value: string | undefined): string {
  return value !== undefined && ATTRIBUTE_VALUE.test(value) ? ` ${key}=${value}` : "";
}

function instant(at: number | undefined): string {
  return at !== undefined && Number.isSafeInteger(at) && at >= 0 ? ` at=${at}` : "";
}

function stepAttributes(step: ReplayStep): string {
  if (step.kind === REPLAY_STEP_KIND.TOOL && step.state !== undefined && step.input !== undefined) {
    const forms = `${spelled("input-form", step.inputForm)}${spelled("output-form", step.outputForm)}`;
    return ` state=${step.state} input-chars=${step.input.length}${spelled("tool", step.tool)}${forms}`;
  }
  if (step.kind !== REPLAY_STEP_KIND.LINE) return "";
  const sender =
    step.sender === undefined
      ? ""
      : ` sender=${step.sender.kind}${spelled("member", step.sender.memberId)}`;
  return `${sender}${instant(step.at)}`;
}

function stepText(step: ReplayStep): string {
  const body = `${oneLine(step.summary)}\n${step.words}`;
  return `<!-- ${MARKER_SPACE}:step kind=${step.kind}${stepAttributes(step)} chars=${body.length}${MARKER_END}${body}\n`;
}

function formOf(value: string | undefined): ReplayValueForm | undefined {
  return value !== undefined && VALUE_FORMS.has(value) ? (value as ReplayValueForm) : undefined;
}

function toolFields(
  attributes: ReadonlyMap<string, string>,
  words: string,
): Pick<ReplayStep, "state" | "input" | "output" | "tool" | "inputForm" | "outputForm"> {
  const called = calledFields(attributes, words);
  if (called.state === undefined) return called;
  const tool = attributes.get("tool");
  const inputForm = formOf(attributes.get("input-form"));
  const outputForm =
    called.output === undefined ? undefined : formOf(attributes.get("output-form"));
  return {
    ...called,
    ...(tool === undefined ? undefined : { tool }),
    ...(inputForm === undefined ? undefined : { inputForm }),
    ...(outputForm === undefined ? undefined : { outputForm }),
  };
}

function calledFields(
  attributes: ReadonlyMap<string, string>,
  words: string,
): Pick<ReplayStep, "state" | "input" | "output"> {
  const state = attributes.get("state") ?? "";
  const inputChars = Number(attributes.get("input-chars") ?? Number.NaN);
  if (!TOOL_STATES.has(state) || !Number.isInteger(inputChars)) return {};
  if (!words.startsWith(TOOL_WORDS.INPUT)) return {};
  const inputEnd = TOOL_WORDS.INPUT.length + inputChars;
  if (!words.startsWith(TOOL_WORDS.RESULT, inputEnd)) return {};
  const input = words.slice(TOOL_WORDS.INPUT.length, inputEnd);
  const result = words.slice(inputEnd + TOOL_WORDS.RESULT.length);
  const known = state as ReplayToolState;
  if (known === REPLAY_TOOL_STATE.RUNNING) return { state: known, input };
  if (known === REPLAY_TOOL_STATE.DONE) return { state: known, input, output: result };
  if (!result.startsWith(TOOL_WORDS.FAILED)) return {};
  return { state: known, input, output: result.slice(TOOL_WORDS.FAILED.length) };
}

function lineFields(attributes: ReadonlyMap<string, string>): Pick<ReplayStep, "sender" | "at"> {
  const at = attributes.get("at") ?? "";
  const when = INSTANT_VALUE.test(at) && Number.isSafeInteger(Number(at)) ? { at: Number(at) } : {};
  return { ...senderFields(attributes), ...when };
}

function senderFields(attributes: ReadonlyMap<string, string>): Pick<ReplayStep, "sender"> {
  const spelled = attributes.get("sender") ?? "";
  const kind = spelled === LEGACY_APP_SENDER ? REPLAY_SENDER.APP : spelled;
  if (!SENDER_KINDS.has(kind)) return {};
  const member = attributes.get("member");
  const sender = {
    kind: kind as ReplaySenderKind,
    ...(member === undefined ? undefined : { memberId: member }),
  };
  return { sender };
}

function summaryText(summary: ReplaySummary | undefined): string {
  if (summary === undefined) return "";
  return `<!-- ${MARKER_SPACE}:summary by=${SUMMARY_BY} steps=${summary.steps} chars=${summary.text.length}${MARKER_END}${summary.text}\n`;
}

function replayText(replay: Replay): string {
  const message = replay.messageId === undefined ? "" : ` message=${replay.messageId}`;
  const open =
    `${REPLAY_OPEN_START}agent=${replay.agentId}${message} steps=${replay.steps.length} ` +
    `total-steps=${replay.totalSteps} chars=${replay.preamble.length}${MARKER_END}`;
  const steps = replay.steps.map(stepText).join("");
  return `${REPLAY_HEADING}\n\n${open}${replay.preamble}\n${summaryText(replay.summary)}${steps}${REPLAY_CLOSE}`;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function stepsBytes(steps: readonly ReplayStep[]): number {
  return steps.reduce((sum, step) => sum + utf8Bytes(stepText(step)), 0);
}

export function summaryBytes(summary: ReplaySummary | undefined): number {
  return utf8Bytes(summaryText(summary));
}

function noteText(note: string, heading: StartNoteHeading, files: NoteFiles): string {
  const marker = `${NOTE_OPEN_START}text-files=${files.text} other-files=${files.other} chars=${note.length}${MARKER_END}`;
  return `${SECTION_GAP}${heading}${SECTION_GAP}${marker}${note}`;
}

export function firstMessageText(
  brief: string,
  replay: Replay | undefined,
  note: string | undefined,
  heading: StartNoteHeading = START_NOTE_HEADING.DEVELOPER,
  noteFiles: NoteFiles = NO_NOTE_FILES,
): string {
  const replayed = replay === undefined ? brief : `${brief}${SECTION_GAP}${replayText(replay)}`;
  return note === undefined ? replayed : `${replayed}${noteText(note, heading, noteFiles)}`;
}

export function newestStepsWithin(
  steps: readonly ReplayStep[],
  maximumBytes: number,
): readonly ReplayStep[] {
  let used = 0;
  let first = steps.length;
  while (first > 0) {
    const step = steps[first - 1];
    if (step === undefined) break;
    const size = utf8Bytes(stepText(step));
    if (used + size > maximumBytes) break;
    used += size;
    first -= 1;
  }
  return steps.slice(first);
}

function markedRun(
  text: string,
  at: number,
  chars: number,
): { readonly run: string; readonly next: number } | undefined {
  const end = at + chars;
  if (end >= text.length || text[end] !== "\n") return undefined;
  return { run: text.slice(at, end), next: end + 1 };
}

function summaryFrom(
  text: string,
  at: number,
): { readonly summary: ReplaySummary | undefined; readonly next: number } | undefined {
  const open = SUMMARY_OPEN.exec(text.slice(at, at + 96));
  if (open === null) return { summary: undefined, next: at };
  const [marker, steps = "", chars = ""] = open;
  const body = markedRun(text, at + marker.length, Number(chars));
  if (body === undefined) return undefined;
  return { summary: { text: body.run, steps: Number(steps) }, next: body.next };
}

function stepsFrom(
  text: string,
  start: number,
): { readonly steps: ReplayStep[]; readonly next: number } | undefined {
  const steps: ReplayStep[] = [];
  let at = start;
  let close = REPLAY_CLOSES.find((each) => text.startsWith(each, at));
  while (close === undefined) {
    const open = STEP_OPEN.exec(text.slice(at, at + 512));
    const [marker, kind = "", named = "", chars = ""] = open ?? [];
    if (marker === undefined || !STEP_KINDS.has(kind)) return undefined;
    const body = markedRun(text, at + marker.length, Number(chars));
    if (body === undefined) return undefined;
    const split = body.run.indexOf("\n");
    if (split < 0) return undefined;
    const attributes = new Map(
      [...named.matchAll(STEP_ATTRIBUTE)].map(([, key = "", value = ""]) => [key, value]),
    );
    const words = body.run.slice(split + 1);
    steps.push({
      kind: kind as ReplayStepKind,
      summary: body.run.slice(0, split),
      words,
      ...(kind === REPLAY_STEP_KIND.TOOL ? toolFields(attributes, words) : undefined),
      ...(kind === REPLAY_STEP_KIND.LINE ? lineFields(attributes) : undefined),
    });
    at = body.next;
    close = REPLAY_CLOSES.find((each) => text.startsWith(each, at));
  }
  return { steps, next: at + close.length };
}

function markedNoteAt(text: string, at: number): FirstMessageNote | undefined {
  for (const [spelled, heading] of NOTE_HEADINGS) {
    const lead = `${SECTION_GAP}${spelled}${SECTION_GAP}`;
    if (!text.startsWith(lead, at)) continue;
    const start = at + lead.length;
    const open = NOTE_OPEN.exec(text.slice(start, start + 96));
    if (open === null) return undefined;
    const [marker, textFiles = "", otherFiles = "", chars = ""] = open;
    if (start + marker.length + Number(chars) !== text.length) return undefined;
    const files = { text: Number(textFiles), other: Number(otherFiles) };
    return { heading, text: text.slice(start + marker.length), files };
  }
  return undefined;
}

function noteFrom(text: string, at: number): FirstMessageNote | null | undefined {
  if (at === text.length) return null;
  const marked = markedNoteAt(text, at);
  if (marked !== undefined) return marked;
  for (const [spelled, heading] of NOTE_HEADINGS) {
    const lead = `${SECTION_GAP}${spelled}${SECTION_GAP}`;
    if (!text.startsWith(lead, at)) continue;
    const start = at + lead.length;
    if (NOTE_OPEN.test(text.slice(start, start + 96))) return undefined;
    return { heading, text: text.slice(at + lead.length), files: NO_NOTE_FILES };
  }
  return undefined;
}

function markedNoteIn(text: string): FirstMessage | undefined {
  let at = firstIndexOf(text, NOTE_OPEN_STARTS, 0);
  while (at >= 0) {
    for (const [spelled] of NOTE_HEADINGS) {
      const lead = `${SECTION_GAP}${spelled}${SECTION_GAP}`;
      const from = at - lead.length;
      if (from < 0 || !text.startsWith(lead, from)) continue;
      const note = markedNoteAt(text, from);
      if (note !== undefined) return { brief: text.slice(0, from), note };
    }
    at = firstIndexOf(text, NOTE_OPEN_STARTS, at + 1);
  }
  return undefined;
}

function replayAt(text: string, at: number): Omit<FirstMessage, "brief"> | undefined {
  const start = at + REPLAY_HEADING_LEAD.length;
  const open = REPLAY_OPEN.exec(text.slice(start, start + 256));
  if (open === null) return undefined;
  const [marker, agentId = "", messageId, kept = "", total = "", chars = ""] = open;
  const preamble = markedRun(text, start + marker.length, Number(chars));
  if (preamble === undefined) return undefined;
  const summarized = summaryFrom(text, preamble.next);
  if (summarized === undefined) return undefined;
  const read = stepsFrom(text, summarized.next);
  if (read === undefined || read.steps.length !== Number(kept)) return undefined;
  const note = noteFrom(text, read.next);
  if (note === undefined) return undefined;
  const replay: Replay = {
    agentId,
    ...(messageId === undefined ? undefined : { messageId }),
    preamble: preamble.run,
    ...(summarized.summary === undefined ? undefined : { summary: summarized.summary }),
    steps: read.steps,
    totalSteps: Number(total),
  };
  return { replay, ...(note === null ? undefined : { note }) };
}

export function firstMessageParts(text: string): FirstMessage {
  let at = firstIndexOf(text, REPLAY_LEADS, 0);
  while (at >= 0) {
    const read = replayAt(text, at);
    if (read !== undefined) return { brief: text.slice(0, at), ...read };
    at = firstIndexOf(text, REPLAY_LEADS, at + 1);
  }
  return markedNoteIn(text) ?? { brief: text };
}
