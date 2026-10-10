/**
 * turn-rows.ts -- what every transcript's turn shares: how its calls are named on their rows, and how its rows fold.
 *
 * Two tabs draw a model's turns, the Work tab from the planning model's
 * parts and an agent's tab from a coding agent's stored message, and each
 * reads its own wire into blocks of its own. What they share is decided
 * here, so the two never drift: a call is one of a few kinds, each with
 * the verb its row says and whether its subject is code; and a turn's
 * blocks fold the way the Work tab folds them (Stagent's walk, Stage's chat
 * panel): calls next to one another are one group that is open while it is
 * the turn's latest work on a turn that moves and folded once the model
 * moved on, and a finished turn folds everything ahead of its last words
 * into one line saying how much it holds, so it reads as its answer.
 */

/** The kinds of call a row can be, across both wires. */
export const CALL_KIND = {
  COMMAND: "command",
  READ_FILE: "read-file",
  WRITE_FILE: "write-file",
  EDIT: "edit",
  SEARCH: "search",
  WEB_SEARCH: "web-search",
  WEB_PAGE: "web-page",
  SHOW_CODE: "show-code",
  DRAW_ON_BOARD: "draw-on-board",
  LOOK_AT_BOARD: "look-at-board",
  QUEUE_QUESTION: "queue-question",
  WORKER: "worker",
  WORKER_WAIT: "worker-wait",
  WORKER_CANCEL: "worker-cancel",
  OTHER: "other",
} as const;

export type CallKind = (typeof CALL_KIND)[keyof typeof CALL_KIND];

/** How a call of each kind says what it did, and whether its subject is code (a command, a path) rather than words. */
export const CALL_WORDS = {
  [CALL_KIND.COMMAND]: { verb: "Ran", code: true },
  [CALL_KIND.READ_FILE]: { verb: "Read", code: true },
  [CALL_KIND.WRITE_FILE]: { verb: "Wrote", code: true },
  [CALL_KIND.EDIT]: { verb: "Edited", code: true },
  [CALL_KIND.SEARCH]: { verb: "Searched", code: true },
  [CALL_KIND.WEB_SEARCH]: { verb: "Searched the web for", code: false },
  [CALL_KIND.WEB_PAGE]: { verb: "Fetched", code: true },
  [CALL_KIND.SHOW_CODE]: { verb: "Showed", code: true },
  [CALL_KIND.DRAW_ON_BOARD]: { verb: "Drew on the board", code: false },
  [CALL_KIND.LOOK_AT_BOARD]: { verb: "Looked at the board", code: false },
  [CALL_KIND.QUEUE_QUESTION]: { verb: "Queued a question", code: false },
  [CALL_KIND.WORKER]: { verb: "Asked the worker", code: false },
  [CALL_KIND.WORKER_WAIT]: { verb: "Waited for the worker", code: false },
  [CALL_KIND.WORKER_CANCEL]: { verb: "Stopped the worker", code: false },
  [CALL_KIND.OTHER]: { verb: "Used", code: true },
} as const satisfies Record<CallKind, { verb: string; code: boolean }>;

/** A page's address as a reader names it: its host and path, without the scheme. */
export function pageName(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** What a block is to the fold. */
export const ROW_PART = {
  /** The model's words: they end a run of calls, and a finished turn folds down to its last. */
  WORDS: "words",
  /** A call, which runs together with the calls beside it. */
  CALL: "call",
  /** A call that stands on a row of its own, as a worker does because it runs on after its call. */
  LONE_CALL: "lone-call",
  /** Anything else, which ends a run and is not counted: reasoning. */
  NOTE: "note",
} as const;

export type RowPart = (typeof ROW_PART)[keyof typeof ROW_PART];

/** How a fold reads a tab's own blocks. */
export interface RowReading<B> {
  readonly key: (block: B, index: number) => string;
  readonly part: (block: B) => RowPart;
  /** Whether the block still moves, which a group of calls shimmers for. */
  readonly running: (block: B) => boolean;
}

/** The kinds of row a turn is drawn as. */
export const TURN_ROW = {
  BLOCK: "block",
  GROUP: "group",
  FOLDED: "folded",
} as const;

export type TurnRow<B> =
  | { readonly kind: typeof TURN_ROW.BLOCK; readonly key: string; readonly block: B }
  | {
      readonly kind: typeof TURN_ROW.GROUP;
      readonly key: string;
      readonly blocks: readonly B[];
      /** Open while it is the turn's latest work and the turn still moves. */
      readonly open: boolean;
      readonly running: boolean;
    }
  | {
      readonly kind: typeof TURN_ROW.FOLDED;
      readonly key: string;
      readonly summary: string;
      readonly rows: readonly TurnRow<B>[];
    };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What a group's line says it holds. */
export function groupSummary(calls: number): string {
  return `${calls} ${calls === 1 ? "tool called" : "tools called"}`;
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
 * A turn's blocks as rows: the words, reasoning, and lone calls as they
 * are, and calls next to one another grouped, the group open while it is
 * the turn's latest work on a turn that moves. A lone call is its own row,
 * unless it is that latest work, which is drawn as a group so the calls
 * after it join it rather than redraw it. Not grouped, every call stands
 * on a row of its own, for a session read for its detail.
 */
function groupedRows<B>(
  blocks: readonly B[],
  read: RowReading<B>,
  moving: boolean,
  grouped: boolean,
): TurnRow<B>[] {
  const rows: TurnRow<B>[] = [];
  let group: { key: string; block: B }[] = [];
  const flush = (trailing: boolean) => {
    const [first] = group;
    if (first === undefined) return;
    const open = trailing && moving;
    if (grouped && (group.length > 1 || open)) {
      rows.push({
        kind: TURN_ROW.GROUP,
        key: first.key,
        blocks: group.map((each) => each.block),
        open,
        running: group.some((each) => read.running(each.block)),
      });
    } else {
      rows.push(
        ...group.map((each) => ({ kind: TURN_ROW.BLOCK, key: each.key, block: each.block })),
      );
    }
    group = [];
  };
  blocks.forEach((block, index) => {
    const key = read.key(block, index);
    if (read.part(block) === ROW_PART.CALL) {
      group.push({ key, block });
      return;
    }
    flush(false);
    rows.push({ kind: TURN_ROW.BLOCK, key, block });
  });
  flush(true);
  return rows;
}

/** How many calls and how many of the model's messages the rows hold. */
function counted<B>(rows: readonly TurnRow<B>[], read: RowReading<B>): [number, number] {
  let calls = 0;
  let messages = 0;
  for (const row of rows) {
    if (row.kind === TURN_ROW.GROUP) calls += row.blocks.length;
    if (row.kind !== TURN_ROW.BLOCK) continue;
    const part = read.part(row.block);
    if (part === ROW_PART.CALL || part === ROW_PART.LONE_CALL) calls += 1;
    if (part === ROW_PART.WORDS) messages += 1;
  }
  return [calls, messages];
}

/**
 * A turn's blocks as the rows a tab draws, folded the Work tab's way:
 * calls grouped, and, once the turn is done, everything ahead of its last
 * words folded into one line saying what it holds.
 */
export function turnRows<B>(
  blocks: readonly B[],
  read: RowReading<B>,
  turn: {
    readonly key: string;
    /** Whether the turn still moves, which keeps its latest group open. */
    readonly moving: boolean;
    /** Whether the turn ended as it meant to, which folds its lead; a turn cut off keeps its rows as they were. */
    readonly done: boolean;
    readonly grouped: boolean;
  },
): readonly TurnRow<B>[] {
  const rows = groupedRows(blocks, read, turn.moving, turn.grouped);
  const last = rows.findLastIndex(
    (row) => row.kind === TURN_ROW.BLOCK && read.part(row.block) === ROW_PART.WORDS,
  );
  if (!turn.done || last < 1) return rows;
  const lead = rows.slice(0, last);
  const [calls, messages] = counted(lead, read);
  return [
    {
      kind: TURN_ROW.FOLDED,
      key: `${turn.key}-folded`,
      summary: foldedSummary(calls, messages),
      rows: lead,
    },
    ...rows.slice(last),
  ];
}
