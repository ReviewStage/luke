/**
 * turn-rows.ts -- what every transcript's turn shares: how its calls are named on their rows, and how its rows fold.
 *
 * Two tabs draw a model's turns, the Call tab the planning model's and an
 * agent's tab a coding agent's, each from the message its journal stored,
 * and each reads it into blocks of its own. What they share is decided
 * here, so the two never drift: a call is one of a few kinds, each with
 * the verb its row says and whether its subject is code; and a turn's
 * blocks fold the way the Call tab folds them (Stagent's walk, Stage's chat
 * panel): calls and subagents next to one another, and the reasoning
 * between and beside them, are one group that is open while it is the
 * turn's latest work on a turn that moves and folded once the model moved
 * on, its line counting the calls and subagents and never the thoughts;
 * and a finished turn folds everything ahead of its last words into one
 * line saying how much it holds, its subagents and the coding agents it
 * started named apart from its other calls, so it reads as its answer. A
 * turn whose words were said aloud, as a spoken turn's on the Call tab
 * are, never draws them as its answer: Luke's line after it is the answer,
 * so its words run with its calls, inside the group while it moves and
 * inside the fold once it has finished, which holds all of it and counts
 * no message, and a run with no call drops its words. A group or a fold
 * holding a call that failed says so on its line, so a failure is not
 * folded out of sight. That
 * fold is the one grouping its calls get: a run of calls is folded once,
 * never a group inside the fold that already holds it. A lead with no call
 * is not folded: its reasoning and words stand as they did while it moved.
 * A message that reached a turn while it ran, a steer from whoever sent
 * it, stands where it arrived: it ends the group before it, and it splits
 * a finished turn's fold, the work before it folded above it and the work
 * after it below, as Claude Code and Cursor draw a message sent mid-turn.
 */

/** The kinds of call a row can be, across both tabs. */
export const CALL_KIND = {
  COMMAND: "command",
  /** A command an agent ran on the developer's own Mac (`run_on_mac`), drawn as a command with where it ran beside it. */
  MAC_COMMAND: "mac-command",
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
  LOOK_AT_PICTURE: "look-at-picture",
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
  ARCHIVE_AGENT: "archive-agent",
  UNARCHIVE_AGENT: "unarchive-agent",
  /** A list of the models a coding agent may be started on (`list_models`). */
  LIST_MODELS: "list-models",
  END_CALL: "end-call",
  SHOW_PAGE: "show-page",
  READ_PAGE: "read-page",
  /** Pictures a coding agent showed from its sandbox (`show_image`), drawn as a row only where the call was refused; a shown set draws as its pictures. */
  SHOW_IMAGE: "show-image",
  /** A pause a coding agent took (`sleep`) before it checked again on what takes time, its row naming how long. */
  SLEEP: "sleep",
  OTHER: "other",
} as const;

export type CallKind = (typeof CALL_KIND)[keyof typeof CALL_KIND];

/** How a call of each kind says what it did, and whether its subject is code (a command, a path) rather than words. */
export const CALL_WORDS = {
  [CALL_KIND.COMMAND]: { verb: "Ran", code: true },
  [CALL_KIND.MAC_COMMAND]: { verb: "Ran", code: true },
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
  [CALL_KIND.LOOK_AT_PICTURE]: { verb: "Looked at a picture in the plan", code: false },
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
  [CALL_KIND.ARCHIVE_AGENT]: { verb: "Archived the coding agent", code: false },
  [CALL_KIND.UNARCHIVE_AGENT]: { verb: "Unarchived the coding agent", code: false },
  [CALL_KIND.LIST_MODELS]: { verb: "Listed the models", code: false },
  [CALL_KIND.END_CALL]: { verb: "Ended the call", code: false },
  [CALL_KIND.SHOW_PAGE]: { verb: "Showed a page:", code: false },
  [CALL_KIND.READ_PAGE]: { verb: "Read the page", code: false },
  [CALL_KIND.SHOW_IMAGE]: { verb: "Showed", code: true },
  [CALL_KIND.SLEEP]: { verb: "Waited", code: false },
  [CALL_KIND.OTHER]: { verb: "Used", code: true },
} as const satisfies Record<CallKind, { verb: string; code: boolean }>;

/** What a row of a call that ran on the developer's own Mac says of where it ran, beside its line. */
const ON_YOUR_MAC = "On your Mac";

/**
 * How a call about one coding agent says what it did where its row names
 * the agent by its chip: the verb alone, the chip standing in the place of
 * "the coding agent", and whether the row still says its subject after the
 * chip. Note that a read, an archive, and an unarchive say none, because
 * their subject is the agent itself, which the chip already names, while a
 * message and a start keep the words they sent as the line's preview.
 */
const AGENT_CALL_WORDS = {
  [CALL_KIND.READ_AGENT]: { verb: "Read", subject: false },
  [CALL_KIND.MESSAGE_AGENT]: { verb: "Messaged", subject: true },
  [CALL_KIND.START_AGENT]: { verb: "Started", subject: true },
  [CALL_KIND.ARCHIVE_AGENT]: { verb: "Archived", subject: false },
  [CALL_KIND.UNARCHIVE_AGENT]: { verb: "Unarchived", subject: false },
} as const satisfies Partial<Record<CallKind, { verb: string; subject: boolean }>>;

type AgentCallKind = keyof typeof AGENT_CALL_WORDS;

/** Whether a call is about one coding agent, which its row may name by the agent's chip. */
export function isAgentCallKind(kind: CallKind): kind is AgentCallKind {
  return Object.hasOwn(AGENT_CALL_WORDS, kind);
}

/** How the line of a call about one coding agent reads where the agent's chip follows its verb: the verb alone, then the words it sent where it sent any. */
export function agentCallLine(kind: AgentCallKind, subject: string | undefined): CallLine {
  const words = AGENT_CALL_WORDS[kind];
  return { verb: words.verb, subject: words.subject ? subject : undefined, code: false };
}

/** Whether a call is a shell command, wherever it ran: its line may say its description, and its body draws it behind a prompt. */
export function isCommandKind(kind: CallKind): boolean {
  return kind === CALL_KIND.COMMAND || kind === CALL_KIND.MAC_COMMAND;
}

/**
 * Where a call ran, as its row says beside its line, or nothing for a call
 * that ran where its tab says. A command on a Mac ran on the Mac of the
 * agent's starter, whom a row that knows them draws in these words' place.
 */
export function callPlace(kind: CallKind): string | undefined {
  return kind === CALL_KIND.MAC_COMMAND ? ON_YOUR_MAC : undefined;
}

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
  /** A call, which runs together with the calls beside it, and which a group and a fold count. */
  CALL: "call",
  /** A call that stands on a row of its own, as an agent's to-do list does. */
  LONE_CALL: "lone-call",
  /** A subagent, which runs together with the calls beside it, and which a group and a fold count apart from the calls. */
  SUBAGENT: "subagent",
  /** A call that started a coding agent, which runs together with the calls beside it as a call does, and which a fold counts apart from them. */
  CODING_AGENT: "coding-agent",
  /** Reasoning, which runs with the calls beside it but is never counted, and stands on its own row where no call is beside it. */
  NOTE: "note",
  /** A message that reached the turn while it ran, from whoever sent it: it ends a run of calls, and a finished turn's fold splits around it, so it stands where it arrived. */
  ARRIVED: "arrived",
} as const;

type RowPart = (typeof ROW_PART)[keyof typeof ROW_PART];

/** How a fold reads a tab's own blocks. */
export interface RowReading<B> {
  readonly key: (block: B, index: number) => string;
  readonly part: (block: B) => RowPart;
  /** Whether the block still moves, which a group of calls shimmers for. */
  readonly running: (block: B) => boolean;
  /** Whether the block is a call that failed, which the line of a group or a fold holding it marks; none fails where unsaid. */
  readonly failed?: (block: B) => boolean;
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
      /** What its line says it holds. */
      readonly summary: string;
      /** Open while it is the turn's latest work and the turn still moves. */
      readonly open: boolean;
      readonly running: boolean;
      /** Whether a call it holds failed. */
      readonly failed: boolean;
    }
  | {
      readonly kind: typeof TURN_ROW.FOLDED;
      readonly key: string;
      readonly summary: string;
      readonly rows: readonly TurnRow<B>[];
      /** Whether a call it holds failed. */
      readonly failed: boolean;
    };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What a lead's blocks hold, as its fold's line counts them. */
interface Held {
  readonly calls: number;
  readonly subagents: number;
  readonly codingAgents: number;
  readonly messages: number;
}

/** What a finished turn's folded lead says it holds; the messages a spoken turn's fold holds go unsaid, since Luke said them. */
function foldedSummary({ calls, subagents, codingAgents, messages }: Held, said: boolean): string {
  const line = [
    ...(calls > 0 ? [plural(calls, "tool call", "tool calls")] : []),
    ...(subagents > 0 ? [plural(subagents, "subagent", "subagents")] : []),
    ...(codingAgents > 0 ? [plural(codingAgents, "coding agent", "coding agents")] : []),
    ...(messages > 0 && !said ? [plural(messages, "message", "messages")] : []),
  ];
  return line.join(", ");
}

/** What a group's line says it holds: its calls, a coding agent's start among them, then its subagents. */
function groupSummary({ calls, subagents, codingAgents }: Held): string {
  const tools = calls + codingAgents;
  const said = [
    ...(tools > 0 ? [plural(tools, "tool called", "tools called")] : []),
    ...(subagents > 0 ? [plural(subagents, "subagent", "subagents")] : []),
  ];
  return said.join(", ");
}

/** Whether a block is work a group gathers: a call, a subagent, or a start of a coding agent. */
function isWork(part: RowPart): boolean {
  return part === ROW_PART.CALL || part === ROW_PART.SUBAGENT || part === ROW_PART.CODING_AGENT;
}

/** Whether a block runs together with the work beside it: that work, a thought, or words said aloud. */
function runsWithCalls(part: RowPart, said: boolean): boolean {
  return isWork(part) || part === ROW_PART.NOTE || (said && part === ROW_PART.WORDS);
}

/** Whether a call among the blocks failed. */
function anyFailed<B>(blocks: readonly Keyed<B>[], read: RowReading<B>): boolean {
  return blocks.some((each) => read.failed?.(each.block) === true);
}

/** A block with the key its row is drawn under. */
interface Keyed<B> {
  readonly key: string;
  readonly block: B;
}

/**
 * A turn's blocks as rows: the words and lone calls as they are, and calls
 * and subagents next to one another grouped with the thoughts between and
 * beside them, the group open while it is the turn's latest work on a turn
 * that moves. A run of thoughts with no work in it stands as its rows. A
 * run of one call or subagent is its own row, unless it is that latest
 * work, which is drawn as a group so the work after it joins it rather
 * than redraw it. Not grouped, as a lead the fold already holds is not,
 * every block stands on a row of its own. On a turn whose words were said
 * aloud, the words run with the work, and a run with no work drops them,
 * since Luke's line after the turn holds them.
 */
function groupedRows<B>(
  blocks: readonly Keyed<B>[],
  read: RowReading<B>,
  moving: boolean,
  grouped: boolean,
  said: boolean,
): TurnRow<B>[] {
  const rows: TurnRow<B>[] = [];
  let group: Keyed<B>[] = [];
  const flush = (trailing: boolean) => {
    const held = counted(group, read);
    const work = held.calls + held.subagents + held.codingAgents;
    if (said && work === 0)
      group = group.filter((each) => read.part(each.block) !== ROW_PART.WORDS);
    const [first] = group;
    if (first === undefined) return;
    const open = trailing && moving;
    if (grouped && work > 0 && (group.length > 1 || open)) {
      rows.push({
        kind: TURN_ROW.GROUP,
        key: first.key,
        blocks: group.map((each) => each.block),
        summary: groupSummary(held),
        open,
        running: group.some((each) => read.running(each.block)),
        failed: anyFailed(group, read),
      });
    } else {
      rows.push(
        ...group.map((each) => ({ kind: TURN_ROW.BLOCK, key: each.key, block: each.block })),
      );
    }
    group = [];
  };
  for (const each of blocks) {
    if (runsWithCalls(read.part(each.block), said)) {
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
 * A turn's blocks as the rows a tab draws, folded the Call tab's way:
 * calls grouped, and, once the turn is done, everything ahead of its last
 * words, or all of it where they were said aloud, folded into one line
 * saying what it holds, each call inside it on a row of its own. A lead
 * without a call has no work to fold away, so it
 * keeps its rows, its reasoning drawn at the top level as on a moving turn,
 * and its words left out where they were said aloud.
 * A block the reading keeps out of the fold, as an agent's newest to-do
 * list is, is drawn right after the fold, ahead of the last words, so it
 * keeps its order against them; a finished turn with no last words folds
 * its work all the same where it keeps one, which then ends the turn.
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
    /** Whether its words were said aloud and stand after it, which folds all of a finished turn's blocks. */
    readonly said?: boolean;
  },
): readonly TurnRow<B>[] {
  const said = turn.said === true;
  const keyed = blocks.map((block, index) => ({ key: read.key(block, index), block }));
  const words = said
    ? blocks.length
    : blocks.findLastIndex((block) => read.part(block) === ROW_PART.WORDS);
  // Note that a finished turn with no last words still folds its work where it
  // keeps a block out, because the block it keeps would otherwise stand inside
  // a closed group of the calls beside it.
  const keepsOne = keyed.some((each) => read.kept?.(each.block) === true);
  const last = words < 0 && turn.done && keepsOne ? blocks.length : words;
  if (!turn.done || last < 1) return groupedRows(keyed, read, turn.moving, true, said);
  // Note that the lead's calls are not grouped, because the fold already holds them and a group inside it would fold the same run twice.
  const kept = keyed.slice(0, last).filter((each) => read.kept?.(each.block) === true);
  const lead = keyed.slice(0, last).filter((each) => !kept.includes(each));
  const held = counted(lead, read);
  const rest = groupedRows([...kept, ...keyed.slice(last)], read, turn.moving, true, said);
  if (held.calls + held.subagents + held.codingAgents === 0) {
    // Note that a lead with no call is not folded, but a block kept out still
    // stands apart from it, because grouped with the lead's reasoning it would
    // close with it.
    if (kept.length === 0) return groupedRows(keyed, read, turn.moving, true, said);
    return [...groupedRows(lead, read, turn.moving, true, said), ...rest];
  }
  return [...foldedLead(lead, read, turn.key, said), ...rest];
}

/**
 * A finished turn's lead folded: each stretch of work between the messages
 * that reached the turn while it ran is one fold, and each message stands
 * on its own row between them; a stretch with no call keeps its rows, as a
 * lead with none does. Note that the first fold keeps the turn's own key,
 * so a turn no message reached folds under the key it always had.
 */
function foldedLead<B>(
  lead: readonly Keyed<B>[],
  read: RowReading<B>,
  turnKey: string,
  said: boolean,
): TurnRow<B>[] {
  const rows: TurnRow<B>[] = [];
  let folds = 0;
  for (const run of splitAtArrivals(lead, read)) {
    if (run.arrived !== undefined) {
      rows.push(run.arrived);
      continue;
    }
    const [first] = run.blocks;
    if (first === undefined) continue;
    const held = counted(run.blocks, read);
    if (held.calls + held.subagents + held.codingAgents === 0) {
      rows.push(...groupedRows(run.blocks, read, false, true, said));
      continue;
    }
    rows.push({
      kind: TURN_ROW.FOLDED,
      key: folds === 0 ? `${turnKey}-folded` : first.key,
      summary: foldedSummary(held, said),
      rows: groupedRows(run.blocks, read, false, false, said),
      failed: anyFailed(run.blocks, read),
    });
    folds += 1;
  }
  return rows;
}

/** A stretch of a finished turn's lead: a message that reached the turn, on its own row, or the work between two such messages. */
type LeadRun<B> =
  | { readonly arrived: TurnRow<B>; readonly blocks?: undefined }
  | { readonly arrived?: undefined; readonly blocks: readonly Keyed<B>[] };

/**
 * A finished turn's lead cut at every message that reached the turn while
 * it ran, so the work before a message folds above it and the work after
 * it below, as Claude Code and Cursor draw a message sent mid-turn; a lead
 * no message reached is one stretch.
 */
function splitAtArrivals<B>(lead: readonly Keyed<B>[], read: RowReading<B>): readonly LeadRun<B>[] {
  const runs: LeadRun<B>[] = [];
  let blocks: Keyed<B>[] = [];
  for (const each of lead) {
    if (read.part(each.block) !== ROW_PART.ARRIVED) {
      blocks.push(each);
      continue;
    }
    if (blocks.length > 0) runs.push({ blocks });
    blocks = [];
    runs.push({ arrived: { kind: TURN_ROW.BLOCK, key: each.key, block: each.block } });
  }
  if (blocks.length > 0) runs.push({ blocks });
  return runs;
}
