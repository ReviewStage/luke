/**
 * agent-replay.ts -- a coding agent's transcript replayed in the first message of an agent started from it: as the service writes it, and as the desktop reads it back.
 *
 * eve opens a session with a user message and nothing before it, so an
 * agent started from another, to continue it or to fork it at one of its
 * messages, is handed that agent's transcript inside its first message:
 * the brief, then the replay under `REPLAY_HEADING`, then the developer's
 * note, if any, under its own heading (`START_NOTE_HEADING`). The replay is
 * a block between two marker comments. The opening one names the source
 * agent, the message it was forked at where it was, and how many of the
 * source's steps the block keeps of how many there were. A preamble follows
 * for the model, then each step behind a marker of its own naming its kind,
 * then the closing marker.
 *
 * Every marker that a run of text follows says that text's length in
 * `chars=N`, counted as JavaScript counts a string's length, in UTF-16
 * code units, on both sides. A reader then takes exactly that much text
 * and never looks inside it for a boundary, so a step whose words hold
 * Markdown, a fence, or a marker of its own can never be taken for the
 * next step. A step's text is its one-line summary, a newline, and its
 * words in full. A message whose markers do not add up reads as having no
 * replay at all, so a brief that only looks like one is drawn as it
 * stands.
 */

/** The heading a start's note stands under, after the brief and any replay: the developer's, or that of the coding agent that started the agent. */
export const START_NOTE_HEADING = {
  DEVELOPER: "## Note from the developer",
  AGENT: "## Note from the coding agent that started you",
} as const;

export type StartNoteHeading = (typeof START_NOTE_HEADING)[keyof typeof START_NOTE_HEADING];

/** The heading the replay stands under, after the brief. It reads the same for a continue and a fork. */
const REPLAY_HEADING = "## The work you continue from";

/** What one step of a replay is: a line sent to the agent, the agent's own words, or a tool call it made. */
export const REPLAY_STEP_KIND = {
  LINE: "line",
  SAID: "said",
  TOOL: "tool",
} as const;

type ReplayStepKind = (typeof REPLAY_STEP_KIND)[keyof typeof REPLAY_STEP_KIND];

/** One step: its kind, its summary on one line, and its words as sent, a tool call's input summarized and its result trimmed. */
export interface ReplayStep {
  readonly kind: ReplayStepKind;
  readonly summary: string;
  readonly words: string;
}

/** A replay: the agent it replays, the message it was forked at where it was, the preamble the model reads, the steps kept, and how many steps there were. */
export interface Replay {
  readonly agentId: string;
  readonly messageId?: string;
  readonly preamble: string;
  readonly steps: readonly ReplayStep[];
  readonly totalSteps: number;
}

/** A first message read back: the brief, the replay where one follows it, and the note where one ends the message, with whose note it is. */
export interface FirstMessage {
  readonly brief: string;
  readonly replay?: Replay;
  readonly note?: { readonly heading: StartNoteHeading; readonly text: string };
}

const REPLAY_CLOSE = "<!-- /luke:replay -->";
const REPLAY_OPEN_START = "<!-- luke:replay ";
const REPLAY_LEAD = `\n\n${REPLAY_HEADING}\n\n${REPLAY_OPEN_START}`;
const MARKER_END = " -->\n";
const SECTION_GAP = "\n\n";

const REPLAY_OPEN =
  /^<!-- luke:replay agent=([0-9a-f-]+)(?: message=([0-9a-f-]+))? steps=(\d+) total-steps=(\d+) chars=(\d+) -->\n/u;
const STEP_OPEN = /^<!-- luke:step kind=([a-z]+) chars=(\d+) -->\n/u;

const STEP_KINDS: ReadonlySet<string> = new Set(Object.values(REPLAY_STEP_KIND));
const NOTE_HEADINGS: readonly StartNoteHeading[] = Object.values(START_NOTE_HEADING);

/** A summary held to one line, since a step's first line is its summary. */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** One step as the block spells it. */
function stepText(step: ReplayStep): string {
  const body = `${oneLine(step.summary)}\n${step.words}`;
  return `<!-- luke:step kind=${step.kind} chars=${body.length}${MARKER_END}${body}\n`;
}

/** The replay as it follows the brief: the heading, the opening marker with the preamble, every step, and the closing marker. */
function replayText(replay: Replay): string {
  const message = replay.messageId === undefined ? "" : ` message=${replay.messageId}`;
  const open =
    `${REPLAY_OPEN_START}agent=${replay.agentId}${message} steps=${replay.steps.length} ` +
    `total-steps=${replay.totalSteps} chars=${replay.preamble.length}${MARKER_END}`;
  return `${REPLAY_HEADING}\n\n${open}${replay.preamble}\n${replay.steps.map(stepText).join("")}${REPLAY_CLOSE}`;
}

/** The first message an agent is handed: the brief, the replay where there is one, and the note under its heading where there is one. */
export function firstMessageText(
  brief: string,
  replay: Replay | undefined,
  note: string | undefined,
  heading: StartNoteHeading = START_NOTE_HEADING.DEVELOPER,
): string {
  const replayed = replay === undefined ? brief : `${brief}${SECTION_GAP}${replayText(replay)}`;
  return note === undefined ? replayed : `${replayed}${SECTION_GAP}${heading}${SECTION_GAP}${note}`;
}

/**
 * The newest steps whose block stays within the bound, in order: the
 * oldest are dropped first, so a long transcript keeps where it ended.
 */
export function newestStepsWithin(
  steps: readonly ReplayStep[],
  maximumChars: number,
): readonly ReplayStep[] {
  let used = 0;
  let first = steps.length;
  while (first > 0) {
    const step = steps[first - 1];
    if (step === undefined) break;
    const size = stepText(step).length;
    if (used + size > maximumChars) break;
    used += size;
    first -= 1;
  }
  return steps.slice(first);
}

/** A run of text of the marked length at `at`, followed by a newline, and where reading goes on; nothing where the text runs short or the newline is missing. */
function markedRun(
  text: string,
  at: number,
  chars: number,
): { readonly run: string; readonly next: number } | undefined {
  const end = at + chars;
  if (end >= text.length || text[end] !== "\n") return undefined;
  return { run: text.slice(at, end), next: end + 1 };
}

/** The steps from `at` to the closing marker, and where the text goes on past it; nothing where a marker does not add up. */
function stepsFrom(
  text: string,
  start: number,
): { readonly steps: ReplayStep[]; readonly next: number } | undefined {
  const steps: ReplayStep[] = [];
  let at = start;
  while (!text.startsWith(REPLAY_CLOSE, at)) {
    const open = STEP_OPEN.exec(text.slice(at, at + 64));
    const [marker, kind = "", chars = ""] = open ?? [];
    if (marker === undefined || !STEP_KINDS.has(kind)) return undefined;
    const body = markedRun(text, at + marker.length, Number(chars));
    if (body === undefined) return undefined;
    const split = body.run.indexOf("\n");
    if (split < 0) return undefined;
    steps.push({
      // SAFETY: the kind was checked against the vocabulary just above.
      kind: kind as ReplayStepKind,
      summary: body.run.slice(0, split),
      words: body.run.slice(split + 1),
    });
    at = body.next;
  }
  return { steps, next: at + REPLAY_CLOSE.length };
}

/** The note that ends the message from `at`, or none where nothing follows; nothing where something follows that is no note. */
function noteFrom(text: string, at: number): FirstMessage["note"] | null | undefined {
  if (at === text.length) return null;
  for (const heading of NOTE_HEADINGS) {
    const lead = `${SECTION_GAP}${heading}${SECTION_GAP}`;
    if (text.startsWith(lead, at)) return { heading, text: text.slice(at + lead.length) };
  }
  return undefined;
}

/** The replay whose heading starts at `at`, and the note after it; nothing where the block does not add up. */
function replayAt(text: string, at: number): Omit<FirstMessage, "brief"> | undefined {
  const start = at + REPLAY_LEAD.length - REPLAY_OPEN_START.length;
  const open = REPLAY_OPEN.exec(text.slice(start, start + 256));
  if (open === null) return undefined;
  const [marker, agentId = "", messageId, kept = "", total = "", chars = ""] = open;
  const preamble = markedRun(text, start + marker.length, Number(chars));
  if (preamble === undefined) return undefined;
  const read = stepsFrom(text, preamble.next);
  if (read === undefined || read.steps.length !== Number(kept)) return undefined;
  const note = noteFrom(text, read.next);
  if (note === undefined) return undefined;
  const replay: Replay = {
    agentId,
    ...(messageId === undefined ? undefined : { messageId }),
    preamble: preamble.run,
    steps: read.steps,
    totalSteps: Number(total),
  };
  return { replay, ...(note === null ? undefined : { note }) };
}

/**
 * A first message read back into its brief, its replay, and its note. A
 * message with no replay is its brief whole, since a note alone is not
 * told apart from a brief that holds its heading. The first heading whose
 * block adds up is the replay, so a brief that quotes one is still read as
 * the brief.
 */
export function firstMessageParts(text: string): FirstMessage {
  let at = text.indexOf(REPLAY_LEAD);
  while (at >= 0) {
    const read = replayAt(text, at);
    if (read !== undefined) return { brief: text.slice(0, at), ...read };
    at = text.indexOf(REPLAY_LEAD, at + 1);
  }
  return { brief: text };
}
