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
 * into one line saying how much it holds, its subagents and the coding
 * agents it started named apart from its other calls, so it reads as its
 * answer. That
 * fold is the one grouping its calls get: a run of calls is folded once,
 * never a group inside the fold that already holds it. A lead with no call
 * is not folded: its reasoning and words stand as they did while it moved.
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
  LOAD_SKILL: "load-skill",
  SHOW_CODE: "show-code",
  DRAW_ON_BOARD: "draw-on-board",
  LOOK_AT_BOARD: "look-at-board",
  QUEUE_QUESTION: "queue-question",
  WITHDRAW_QUESTION: "withdraw-question",
  EDIT_PLAN: "edit-plan",
  TODOS: "todos",
  INBOX_POST: "inbox-post",
  INBOX_CLOSE: "inbox-close",
  INBOX_READ: "inbox-read",
  WORKER: "worker",
  WORKER_WAIT: "worker-wait",
  WORKER_CANCEL: "worker-cancel",
  LIST_AGENTS: "list-agents",
  READ_AGENT: "read-agent",
  MESSAGE_AGENT: "message-agent",
  START_AGENT: "start-agent",
  END_CALL: "end-call",
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
  [CALL_KIND.LOAD_SKILL]: { verb: "Loaded skill", code: true },
  [CALL_KIND.SHOW_CODE]: { verb: "Showed", code: true },
  [CALL_KIND.DRAW_ON_BOARD]: { verb: "Drew on the board", code: false },
  [CALL_KIND.LOOK_AT_BOARD]: { verb: "Looked at the board", code: false },
  [CALL_KIND.QUEUE_QUESTION]: { verb: "Queued a question", code: false },
  [CALL_KIND.WITHDRAW_QUESTION]: { verb: "Withdrew a question", code: false },
  [CALL_KIND.EDIT_PLAN]: { verb: "Updated the plan:", code: false },
  [CALL_KIND.TODOS]: { verb: "Updated the to-dos:", code: false },
  [CALL_KIND.INBOX_POST]: { verb: "Posted to your inbox:", code: false },
  [CALL_KIND.INBOX_CLOSE]: { verb: "Closed in your inbox:", code: false },
  [CALL_KIND.INBOX_READ]: { verb: "Read your inbox", code: false },
  [CALL_KIND.WORKER]: { verb: "Asked the worker", code: false },
  [CALL_KIND.WORKER_WAIT]: { verb: "Waited for the worker", code: false },
  [CALL_KIND.WORKER_CANCEL]: { verb: "Stopped subagent", code: false },
  [CALL_KIND.LIST_AGENTS]: { verb: "Listed the coding agents", code: false },
  [CALL_KIND.READ_AGENT]: { verb: "Read the coding agent", code: false },
  [CALL_KIND.MESSAGE_AGENT]: { verb: "Messaged the coding agent", code: false },
  [CALL_KIND.START_AGENT]: { verb: "Started a coding agent", code: false },
  [CALL_KIND.END_CALL]: { verb: "Ended the call", code: false },
  [CALL_KIND.OTHER]: { verb: "Used", code: true },
} as const satisfies Record<CallKind, { verb: string; code: boolean }>;

/** What a call's line says: the verb, or a described command's purpose, then the subject, and whether the subject is code. */
export interface CallLine {
  readonly verb: string;
  readonly subject: string | undefined;
  readonly code: boolean;
}

/**
 * How a call's line reads: its kind's verb before its subject; or, for a
 * command the model said the purpose of, those plain words in the verb's
 * place, as Claude Code and Cursor name a command, and the command's first
 * line after them as its preview, the whole of it in the row's body.
 */
export function callLine(
  kind: CallKind,
  subject: string | undefined,
  description: string | undefined,
): CallLine {
  const words = CALL_WORDS[kind];
  if (description === undefined) return { verb: words.verb, subject, code: words.code };
  return {
    verb: description,
    subject: subject === undefined ? undefined : firstLine(subject),
    code: true,
  };
}

/** A command's first line of words, as a line too short for the rest previews it. */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}

/**
 * The plain words a command's input says it is for, on one line, or nothing
 * where it says none, as an older call or another harness's does not. Note
 * that a break inside them is a space, because they are a row's one line and
 * a copied call's one bullet.
 */
export function commandDescription(description: string | undefined): string | undefined {
  const words = description?.replace(/\s+/gu, " ").trim();
  return words === undefined || words === "" ? undefined : words;
}

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
  /** A call that stands on a row of its own, as an agent's to-do list does. */
  LONE_CALL: "lone-call",
  /** A subagent, which stands on a row of its own because it runs on after its call, and which a fold counts apart from the calls. */
  SUBAGENT: "subagent",
  /** A call that started a coding agent, which runs together with the calls beside it as a call does, and which a fold counts apart from them. */
  CODING_AGENT: "coding-agent",
  /** Anything else, which ends a run and is not counted: reasoning. */
  NOTE: "note",
} as const;

type RowPart = (typeof ROW_PART)[keyof typeof ROW_PART];

/** How a fold reads a tab's own blocks. */
export interface RowReading<B> {
  readonly key: (block: B, index: number) => string;
  readonly part: (block: B) => RowPart;
  /** Whether the block still moves, which a group of calls shimmers for. */
  readonly running: (block: B) => boolean;
  /** Whether the block stays out of a finished turn's fold, drawn after it, because it is still worth reading unasked; none stays out where unsaid. */
  readonly kept?: (block: B) => boolean;
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

/** What a lead's blocks hold, as its fold's line counts them. */
interface Held {
  readonly calls: number;
  readonly subagents: number;
  readonly codingAgents: number;
  readonly messages: number;
}

/** What a finished turn's folded lead says it holds. */
function foldedSummary({ calls, subagents, codingAgents, messages }: Held): string {
  const said = [
    ...(calls > 0 ? [plural(calls, "tool call", "tool calls")] : []),
    ...(subagents > 0 ? [plural(subagents, "subagent", "subagents")] : []),
    ...(codingAgents > 0 ? [plural(codingAgents, "coding agent", "coding agents")] : []),
    ...(messages > 0 ? [plural(messages, "message", "messages")] : []),
  ];
  return said.join(", ");
}

/** Whether a block runs together with the calls beside it. */
function runsWithCalls(part: RowPart): boolean {
  return part === ROW_PART.CALL || part === ROW_PART.CODING_AGENT;
}

/** A block with the key its row is drawn under. */
interface Keyed<B> {
  readonly key: string;
  readonly block: B;
}

/**
 * A turn's blocks as rows: the words, reasoning, and lone calls as they
 * are, and calls next to one another grouped, the group open while it is
 * the turn's latest work on a turn that moves. A lone call is its own row,
 * unless it is that latest work, which is drawn as a group so the calls
 * after it join it rather than redraw it. Not grouped, every call stands
 * on a row of its own, for a session read for its detail and for a lead
 * the fold already holds.
 */
function groupedRows<B>(
  blocks: readonly Keyed<B>[],
  read: RowReading<B>,
  moving: boolean,
  grouped: boolean,
): TurnRow<B>[] {
  const rows: TurnRow<B>[] = [];
  let group: Keyed<B>[] = [];
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
  for (const each of blocks) {
    if (runsWithCalls(read.part(each.block))) {
      group.push(each);
      continue;
    }
    flush(false);
    rows.push({ kind: TURN_ROW.BLOCK, key: each.key, block: each.block });
  }
  flush(true);
  return rows;
}

/** How many calls, subagents, coding agents started, and of the model's messages a lead's blocks hold. */
function counted<B>(blocks: readonly Keyed<B>[], read: RowReading<B>): Held {
  let calls = 0;
  let subagents = 0;
  let codingAgents = 0;
  let messages = 0;
  for (const { block } of blocks) {
    const part = read.part(block);
    if (part === ROW_PART.CALL || part === ROW_PART.LONE_CALL) calls += 1;
    if (part === ROW_PART.SUBAGENT) subagents += 1;
    if (part === ROW_PART.CODING_AGENT) codingAgents += 1;
    if (part === ROW_PART.WORDS) messages += 1;
  }
  return { calls, subagents, codingAgents, messages };
}

/**
 * A turn's blocks as the rows a tab draws, folded the Work tab's way:
 * calls grouped, and, once the turn is done, everything ahead of its last
 * words folded into one line saying what it holds, each call inside it on
 * a row of its own. A lead without a call has no work to fold away, so it
 * keeps its rows, its reasoning drawn at the top level as on a moving turn.
 * A block the reading keeps out of the fold, as an agent's newest to-do
 * list is, is drawn right after the fold, ahead of the last words, so it
 * keeps its order against them.
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
  const keyed = blocks.map((block, index) => ({ key: read.key(block, index), block }));
  const last = blocks.findLastIndex((block) => read.part(block) === ROW_PART.WORDS);
  if (!turn.done || last < 1) return groupedRows(keyed, read, turn.moving, turn.grouped);
  // Note that the lead's calls are not grouped, because the fold already holds them and a group inside it would fold the same run twice.
  const kept = keyed.slice(0, last).filter((each) => read.kept?.(each.block) === true);
  const lead = keyed.slice(0, last).filter((each) => !kept.includes(each));
  const held = counted(lead, read);
  if (held.calls + held.subagents + held.codingAgents === 0)
    return groupedRows(keyed, read, turn.moving, turn.grouped);
  return [
    {
      kind: TURN_ROW.FOLDED,
      key: `${turn.key}-folded`,
      summary: foldedSummary(held),
      rows: groupedRows(lead, read, false, false),
    },
    ...groupedRows([...kept, ...keyed.slice(last)], read, turn.moving, turn.grouped),
  ];
}
