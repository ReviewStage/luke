/**
 * What the one long Conversation shows, selected from the stored rows: main's
 * own messages, and from each observed session's conversation only what
 * crossed into the developer's world — the briefings Luke announced and the
 * actions he carried — with the turns that produced them. An observed
 * conversation's ordinary work (its observation notes, its transcript reads,
 * its thinking, a turn that decided nothing) is never mirrored into the view:
 * an assistant row crosses only when it carries an announcement or an action,
 * and crosses cut to those parts, so nothing else it said travels with them.
 *
 * The selection is a pure function over rows already read back under the
 * vocabulary, so it can run on the service and in a test alike, and it takes
 * everything it decides from as input: it queries nothing. Which tools are
 * announcements and which are actions is the brain catalog's knowledge, above
 * this package in the graph, so the caller hands the classification in; a tool
 * the classification does not name is neither, and draws as a collapsed
 * detail of its turn rather than a row.
 */

import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isSpeechEventKind,
  MESSAGE_ROLE,
  type TurnOrigin,
  type TurnStatus,
} from "@sidecar/wire";
import type { SessionIdentity } from "./session-identity.js";
import {
  isStoredToolPart,
  type StoredToolPart,
  storedToolName,
  TOOL_PART_STATE,
  type ToolPartState,
} from "./ui-messages/tool-parts.js";
import type { StoredUIMessage } from "./ui-messages/validate.js";

/**
 * What a tool call is to the view. An announcement and an action are the two
 * kinds that draw a row of their own and the two that carry an observed
 * conversation's message into the view; a detail is any other call — a read,
 * a workspace write, a delegation — drawn only inside the expanded turn.
 */
export const CONVERSATION_VIEW_TOOL_KIND = {
  ANNOUNCE: "announce",
  ACTION: "action",
  DETAIL: "detail",
} as const;

export type ConversationViewToolKind =
  (typeof CONVERSATION_VIEW_TOOL_KIND)[keyof typeof CONVERSATION_VIEW_TOOL_KIND];

/** The two kinds a caller names a tool as; every tool it does not name is a detail. */
export type NamedConversationViewToolKind = Exclude<
  ConversationViewToolKind,
  typeof CONVERSATION_VIEW_TOOL_KIND.DETAIL
>;

/** The tool names the view is told about, by the kind each is. */
export type ConversationViewToolKinds = ReadonlyMap<string, NamedConversationViewToolKind>;

export const CONVERSATION_VIEW_SOURCE = {
  MAIN: "main",
  OBSERVED: "observed",
} as const;

export type ConversationViewSource =
  | { readonly kind: typeof CONVERSATION_VIEW_SOURCE.MAIN }
  | { readonly kind: typeof CONVERSATION_VIEW_SOURCE.OBSERVED; readonly session: SessionIdentity };

/** A stored message as the view reads it: the row's message beside the columns that place it. */
export interface ConversationViewStoredMessage {
  readonly message: StoredUIMessage;
  /** The row's place in its own conversation's sequence; the order within a turn. */
  readonly seq: number;
  readonly turnId: string;
  /** Epoch milliseconds; the order across conversations. */
  readonly createdAt: number;
}

/** The columns of a turn row the view reads. */
export interface ConversationViewTurn {
  readonly id: string;
  readonly origin: TurnOrigin;
  readonly status: TurnStatus;
  readonly queuedAt: number;
  readonly startedAt?: number;
  readonly settledAt?: number;
}

/** An event row about a message, in its conversation's own event sequence. */
export interface ConversationViewEvent {
  readonly messageId: string;
  readonly kind: ConversationEventKind;
  readonly seq: number;
}

export interface ConversationViewObservedConversation {
  readonly session: SessionIdentity;
  readonly messages: readonly ConversationViewStoredMessage[];
}

export interface ConversationViewInput {
  readonly main: readonly ConversationViewStoredMessage[];
  readonly observed: readonly ConversationViewObservedConversation[];
  readonly turns: readonly ConversationViewTurn[];
  readonly events: readonly ConversationViewEvent[];
  readonly toolKinds: ConversationViewToolKinds;
}

type ToolPartIdentity = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly state: ToolPartState;
};

/**
 * One tool call of a shown message, as the view decided it: which kind it is,
 * and the one fact of each row kind the renderer cannot read from the part
 * alone. An announcement is unspoken when the latest speech event on its
 * message is the expiry: its offer lapsed with no device claiming it, so
 * nobody heard it. Any other latest event, or none yet, leaves it standing as
 * a briefing that was or may still be delivered. The events hang on the
 * message, and a turn announces at most once, so every announce part of one
 * message reads the same mark. An action is refused when its part ended in
 * error, the one case an action draws collapsed like a detail.
 */
export type ConversationViewToolPart =
  | (ToolPartIdentity & {
      readonly kind: typeof CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE;
      readonly unspoken: boolean;
    })
  | (ToolPartIdentity & {
      readonly kind: typeof CONVERSATION_VIEW_TOOL_KIND.ACTION;
      readonly refused: boolean;
    })
  | (ToolPartIdentity & { readonly kind: typeof CONVERSATION_VIEW_TOOL_KIND.DETAIL });

export interface ConversationViewMessage {
  /** The stored message; from an observed conversation, cut to its announcement and action parts. */
  readonly message: StoredUIMessage;
  readonly seq: number;
  readonly createdAt: number;
  /** The message's tool calls in part order, each as the view decided it. */
  readonly tools: readonly ConversationViewToolPart[];
}

/** The messages one turn produced, in sequence, under the turn row where the store holds one. */
export interface ConversationViewTurnGroup {
  readonly turnId: string;
  readonly turn: ConversationViewTurn | undefined;
  readonly source: ConversationViewSource;
  readonly messages: readonly ConversationViewMessage[];
}

function toolKindOf(
  part: StoredToolPart,
  toolKinds: ConversationViewToolKinds,
): ConversationViewToolKind {
  return toolKinds.get(storedToolName(part)) ?? CONVERSATION_VIEW_TOOL_KIND.DETAIL;
}

/** The latest speech event on each message, by the event sequence of the message's own conversation. */
function latestSpeechEvents(
  events: readonly ConversationViewEvent[],
): ReadonlyMap<string, ConversationViewEvent> {
  const latest = new Map<string, ConversationViewEvent>();
  for (const event of events) {
    if (!isSpeechEventKind(event.kind)) continue;
    const standing = latest.get(event.messageId);
    if (standing === undefined || standing.seq < event.seq) latest.set(event.messageId, event);
  }
  return latest;
}

function describeToolPart(
  part: StoredToolPart,
  kind: ConversationViewToolKind,
  speech: ReadonlyMap<string, ConversationViewEvent>,
  messageId: string,
): ConversationViewToolPart {
  const identity: ToolPartIdentity = {
    toolCallId: part.toolCallId,
    toolName: storedToolName(part),
    state: part.state,
  };
  switch (kind) {
    case CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE:
      return {
        ...identity,
        kind,
        unspoken: speech.get(messageId)?.kind === CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
      };
    case CONVERSATION_VIEW_TOOL_KIND.ACTION:
      return { ...identity, kind, refused: part.state === TOOL_PART_STATE.OUTPUT_ERROR };
    case CONVERSATION_VIEW_TOOL_KIND.DETAIL:
      return { ...identity, kind };
  }
}

function isCompaction(message: StoredUIMessage): boolean {
  return message.role === MESSAGE_ROLE.ASSISTANT && message.metadata.compaction !== undefined;
}

/**
 * An observed conversation's row cut to what crosses: an assistant message's
 * announcement and action parts, or nothing when it carries neither. A
 * refused action still crosses, since the turn that tried it is shown with
 * the refusal inside it.
 */
function crossingMessage(
  message: StoredUIMessage,
  toolKinds: ConversationViewToolKinds,
): StoredUIMessage | undefined {
  if (message.role !== MESSAGE_ROLE.ASSISTANT) return undefined;
  const parts = message.parts.filter(
    (part) =>
      isStoredToolPart(part) && toolKindOf(part, toolKinds) !== CONVERSATION_VIEW_TOOL_KIND.DETAIL,
  );
  return parts.length === 0 ? undefined : { ...message, parts };
}

/** A selected row with the conversation it came from, so one pass groups every conversation's rows. */
type SourcedRow = ConversationViewStoredMessage & { readonly source: ConversationViewSource };

function viewMessage(
  row: ConversationViewStoredMessage,
  toolKinds: ConversationViewToolKinds,
  speech: ReadonlyMap<string, ConversationViewEvent>,
): ConversationViewMessage {
  const { message } = row;
  const tools: ConversationViewToolPart[] = [];
  for (const part of message.parts) {
    if (!isStoredToolPart(part)) continue;
    tools.push(describeToolPart(part, toolKindOf(part, toolKinds), speech, message.id));
  }
  return { message, seq: row.seq, createdAt: row.createdAt, tools };
}

type GroupedRows = { readonly source: ConversationViewSource; readonly rows: SourcedRow[] };

/** A group's place in time: its earliest message, then its turn's queue instant, then its id, so every device orders alike. */
type PlacedGroup = { readonly group: ConversationViewTurnGroup; readonly instant: number };

function queuedInstant(group: ConversationViewTurnGroup): number {
  return group.turn?.queuedAt ?? Number.MAX_SAFE_INTEGER;
}

function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function comparePlaced(a: PlacedGroup, b: PlacedGroup): number {
  return (
    a.instant - b.instant ||
    queuedInstant(a.group) - queuedInstant(b.group) ||
    compareCodePoints(a.group.turnId, b.group.turnId)
  );
}

/**
 * Selects the Conversation: main's messages whole (a compaction row excepted,
 * since it stands in for messages the view still shows), and from each
 * observed conversation the assistant messages carrying an announcement or an
 * action, cut to those parts. Messages are grouped by the turn that wrote
 * them, in their conversation's sequence within a group, and the groups are
 * ordered by the time of their earliest message. A turn with nothing selected
 * is not shown.
 */
export function selectConversationView(
  input: ConversationViewInput,
): readonly ConversationViewTurnGroup[] {
  const turns = new Map(input.turns.map((turn) => [turn.id, turn]));
  const speech = latestSpeechEvents(input.events);

  const selected: SourcedRow[] = [];
  const main: ConversationViewSource = { kind: CONVERSATION_VIEW_SOURCE.MAIN };
  for (const row of input.main) {
    if (!isCompaction(row.message)) selected.push({ ...row, source: main });
  }
  for (const conversation of input.observed) {
    const source: ConversationViewSource = {
      kind: CONVERSATION_VIEW_SOURCE.OBSERVED,
      session: conversation.session,
    };
    for (const row of conversation.messages) {
      const message = crossingMessage(row.message, input.toolKinds);
      if (message !== undefined) selected.push({ ...row, message, source });
    }
  }

  const grouped = new Map<string, GroupedRows>();
  for (const row of selected) {
    const group = grouped.get(row.turnId);
    if (group === undefined) grouped.set(row.turnId, { source: row.source, rows: [row] });
    else group.rows.push(row);
  }

  const placed: PlacedGroup[] = [...grouped].map(([turnId, { source, rows }]) => ({
    group: {
      turnId,
      turn: turns.get(turnId),
      source,
      messages: rows
        .sort((a, b) => a.seq - b.seq)
        .map((row) => viewMessage(row, input.toolKinds, speech)),
    },
    instant: Math.min(...rows.map((row) => row.createdAt)),
  }));
  return placed.sort(comparePlaced).map(({ group }) => group);
}
