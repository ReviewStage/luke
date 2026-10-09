import {
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkPart,
  type PlanWorkState,
  type PlanWorkTool,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";

/**
 * work-model.ts -- the open plan's Work tab as rows: each planning turn's words, reasoning, and calls, folded the way an agent's own transcript folds them.
 *
 * The walk is Stagent's (Stage's chat panel) over the parts the service
 * sends: the model's words as they are, reasoning only where it has any,
 * and calls next to one another as one group that is open while it is the
 * turn's latest work and folded once the model moved on. Once a turn is
 * done, everything ahead of its last words folds into one line saying how
 * much it holds, so a finished turn reads as its answer. A worker stands on
 * its own row, never in a group, because it runs on after its call.
 *
 * Every call says what it did in words, with the one input a reader looks
 * for first set apart as code where it is code: the command, the file, the
 * page.
 */

/** What the tab says while no turn has worked on the open plan. */
export const WORK_EMPTY_LINE = "When Luke works on a call, what he reads and runs appears here.";

/** The kinds of block a turn is drawn as. */
export const WORK_BLOCK = {
  TEXT: "text",
  REASONING: "reasoning",
  CALL: "call",
  GROUP: "group",
  WORKER: "worker",
  FOLDED: "folded",
} as const;

/** One call as a row: what it did in words, its subject apart, its state, and what opens under it. */
export interface WorkCallRow {
  id: string;
  verb: string;
  /** The input a reader looks for first; absent for a call that has none. */
  subject?: string;
  /** Whether the subject is code (a command, a path) rather than words. */
  subjectIsCode: boolean;
  state: PlanWorkState;
  /** Whether the row still moves: the call runs on a call that still stands. */
  running: boolean;
  input: string;
  output?: string;
}

export type WorkBlock =
  | { kind: typeof WORK_BLOCK.TEXT; key: string; text: string }
  | { kind: typeof WORK_BLOCK.REASONING; key: string; text: string }
  | { kind: typeof WORK_BLOCK.CALL; key: string; call: WorkCallRow }
  | { kind: typeof WORK_BLOCK.WORKER; key: string; call: WorkCallRow }
  | {
      kind: typeof WORK_BLOCK.GROUP;
      key: string;
      calls: readonly WorkCallRow[];
      /** Open while it is the turn's latest work and the turn still moves. */
      open: boolean;
      running: boolean;
    }
  | {
      kind: typeof WORK_BLOCK.FOLDED;
      key: string;
      summary: string;
      blocks: readonly WorkBlock[];
    };

/** One turn as the tab draws it. */
export interface WorkTurnRow {
  key: string;
  startedAt: number;
  /** Running only while the turn moves; a turn its call left running is drawn as stopped, since nothing more of it will be told. */
  state: PlanWorkState;
  earlierOmitted: boolean;
  blocks: readonly WorkBlock[];
}

/** How a call of each kind says what it did, and whether its subject is code. */
const CALL_WORDS = {
  [PLAN_WORK_TOOL.REPOSITORY]: { verb: "Ran", code: true },
  [PLAN_WORK_TOOL.SEARCH_WEB]: { verb: "Searched the web for", code: false },
  [PLAN_WORK_TOOL.READ_WEB_PAGE]: { verb: "Read", code: true },
  [PLAN_WORK_TOOL.SHOW_CODE]: { verb: "Showed", code: true },
  [PLAN_WORK_TOOL.DRAW_ON_BOARD]: { verb: "Drew on the board", code: false },
  [PLAN_WORK_TOOL.LOOK_AT_BOARD]: { verb: "Looked at the board", code: false },
  [PLAN_WORK_TOOL.QUEUE_QUESTION]: { verb: "Queued a question", code: false },
  [PLAN_WORK_TOOL.WORKER]: { verb: "Asked the worker", code: false },
  [PLAN_WORK_TOOL.WORKER_WAIT]: { verb: "Waited for the worker", code: false },
  [PLAN_WORK_TOOL.WORKER_CANCEL]: { verb: "Stopped the worker", code: false },
  [PLAN_WORK_TOOL.OTHER]: { verb: "Used", code: true },
} as const satisfies Record<PlanWorkTool, { verb: string; code: boolean }>;

/** A page's address as a reader names it: its host and path, without the scheme. */
function pageName(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function callRowOf(
  part: Extract<PlanWorkPart, { type: typeof PLAN_WORK_PART.TOOL }>,
  moving: boolean,
): WorkCallRow {
  const words = CALL_WORDS[part.tool];
  const subject =
    part.tool === PLAN_WORK_TOOL.OTHER
      ? part.name
      : part.tool === PLAN_WORK_TOOL.READ_WEB_PAGE && part.subject !== undefined
        ? pageName(part.subject)
        : part.subject;
  return {
    id: part.id,
    verb: words.verb,
    ...(subject === undefined ? undefined : { subject }),
    subjectIsCode: words.code,
    state: part.state,
    running: moving && part.state === PLAN_WORK_STATE.RUNNING,
    input: part.input,
    ...(part.output === undefined ? undefined : { output: part.output }),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What a finished turn's folded lead says it holds. */
function foldedSummary(calls: number, messages: number): string {
  const said = [
    ...(calls > 0 ? [plural(calls, "tool call", "tool calls")] : []),
    ...(messages > 0 ? [plural(messages, "message", "messages")] : []),
  ];
  return said.join(", ");
}

/**
 * One turn's parts as blocks: the words and reasoning as they are, a worker
 * on its own row, and calls next to one another grouped, the group open
 * while it is the turn's latest work on a turn that moves. A lone call is
 * its own row, unless it is that latest work, which is drawn as a group so
 * the calls after it join it rather than redraw it.
 */
function blocksOf(turn: PlanWorkTurn, moving: boolean): WorkBlock[] {
  const blocks: WorkBlock[] = [];
  let group: WorkCallRow[] = [];
  const flush = (trailing: boolean) => {
    const [first] = group;
    if (first === undefined) return;
    const open = trailing && moving;
    blocks.push(
      group.length > 1 || open
        ? {
            kind: WORK_BLOCK.GROUP,
            key: first.id,
            calls: group,
            open,
            running: group.some((call) => call.running),
          }
        : { kind: WORK_BLOCK.CALL, key: first.id, call: first },
    );
    group = [];
  };
  turn.parts.forEach((part, index) => {
    const key = `${turn.turnId}-${index}`;
    if (part.type === PLAN_WORK_PART.TOOL && part.tool === PLAN_WORK_TOOL.WORKER) {
      flush(false);
      blocks.push({ kind: WORK_BLOCK.WORKER, key: part.id, call: callRowOf(part, moving) });
    } else if (part.type === PLAN_WORK_PART.TOOL) {
      group.push(callRowOf(part, moving));
    } else {
      flush(false);
      blocks.push(
        part.type === PLAN_WORK_PART.TEXT
          ? { kind: WORK_BLOCK.TEXT, key, text: part.text }
          : { kind: WORK_BLOCK.REASONING, key, text: part.text },
      );
    }
  });
  flush(true);
  return blocks;
}

/** A finished turn with everything ahead of its last words folded into one line; any other turn as it is. */
function foldedLead(
  blocks: readonly WorkBlock[],
  key: string,
  done: boolean,
): readonly WorkBlock[] {
  const last = blocks.findLastIndex((block) => block.kind === WORK_BLOCK.TEXT);
  if (!done || last < 1) return blocks;
  const lead = blocks.slice(0, last);
  const calls = lead.reduce(
    (count, block) =>
      count +
      (block.kind === WORK_BLOCK.GROUP
        ? block.calls.length
        : block.kind === WORK_BLOCK.CALL || block.kind === WORK_BLOCK.WORKER
          ? 1
          : 0),
    0,
  );
  const messages = lead.filter((block) => block.kind === WORK_BLOCK.TEXT).length;
  return [
    {
      kind: WORK_BLOCK.FOLDED,
      key: `${key}-folded`,
      summary: foldedSummary(calls, messages),
      blocks: lead,
    },
    ...blocks.slice(last),
  ];
}

/**
 * The open plan's turns as rows, oldest first. A turn moves only while the
 * call it ran on stands: a call that ended leaves its last turn as it was
 * last told, with nothing on it still turning.
 */
export function workRowsOf(
  turns: readonly PlanWorkTurn[] | undefined,
  callLive: boolean,
): readonly WorkTurnRow[] {
  return (turns ?? []).map((turn) => {
    const moving = callLive && turn.state === PLAN_WORK_STATE.RUNNING;
    const left = turn.state === PLAN_WORK_STATE.RUNNING && !moving;
    return {
      key: turn.turnId,
      startedAt: turn.startedAt,
      state: left ? PLAN_WORK_STATE.FAILED : turn.state,
      earlierOmitted: turn.earlierOmitted,
      blocks: foldedLead(blocksOf(turn, moving), turn.turnId, turn.state === PLAN_WORK_STATE.DONE),
    };
  });
}
