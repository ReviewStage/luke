import { isDeepStrictEqual } from "node:util";
import type {
  BrainTurnRecord,
  ConversationReadConversation,
  ConversationReadEvent,
  ConversationReadTurnGroup,
} from "@sidecar/hosted";
import {
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewMessage,
  type ConversationViewSnapshot,
  type ConversationViewSource,
  type ConversationViewToolPart,
  type ConversationViewTurn,
  type UnreadableRow,
} from "@sidecar/session";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isSpeechEventKind,
} from "@sidecar/wire";

/**
 * One device's own picture of the Conversation, kept the way D2's contract
 * asks a client to keep it. The service answers each resource behind a cursor
 * this device holds and hands back unchanged; what arrives is folded in here
 * and nothing is appended blindly: a group is merged by its turn, a message is
 * replaced at its sequence (a row still being written is answered on every
 * read until it finishes, so the copy held is always the latest), a turn is
 * replaced by its id whenever a stamp on it moves, the rows of a
 * conversation an answer no longer lists are dropped, and an observed
 * conversation's rows from before the current main opened are dropped with
 * them, which is how a Clear made on any Mac reaches this one's screen
 * within a poll. Every device that
 * reads to the end holds the same rows in the same order, because the order
 * is the view's own — earliest message, then the turn's queue instant, then
 * the id — and never the order of arrival.
 */

/** How much of the Conversation one device keeps in memory and hands its windows: the newest turns, whole. */
export const CONVERSATION_VIEW_BOUNDS = {
  MAX_GROUPS: 200,
} as const;

/** Where this device's read of each resource stands; absent before the first page of that resource. */
export interface ConversationReadCursors {
  readonly messages?: string | undefined;
  readonly events?: string | undefined;
  readonly turns?: string | undefined;
}

/** A messages page with its rows already held to the vocabulary, so nothing here reads inside a message. */
export interface ReadMessagesPage {
  readonly conversations: readonly ConversationReadConversation[];
  readonly groups: readonly ReadTurnGroup[];
  readonly next: string;
}

export interface ReadTurnGroup extends Omit<ConversationReadTurnGroup, "messages"> {
  readonly messages: readonly ConversationViewMessage[];
}

interface HeldGroup {
  readonly conversationId: string;
  readonly source: ConversationViewSource;
  turn: ConversationViewTurn | undefined;
  readonly messages: Map<number, ConversationViewMessage>;
}

interface HeldSpeechEvent {
  readonly conversationId: string;
  readonly kind: ConversationEventKind;
  readonly seq: number;
}

interface HeldTurn {
  readonly conversationId: string;
  readonly turn: ConversationViewTurn;
}

/** Where the current main opened, as the answer's main entry carries it; nothing where no main is listed. */
function mainOpenedAt(conversations: readonly ConversationReadConversation[]): number | undefined {
  for (const conversation of conversations) {
    if (conversation.kind === CONVERSATION_VIEW_SOURCE.MAIN) return conversation.openedAt;
  }
  return undefined;
}

function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function viewTurn(record: BrainTurnRecord): ConversationViewTurn {
  return {
    id: record.id,
    origin: record.origin,
    status: record.status,
    queuedAt: record.queuedAt,
    ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : undefined),
    ...(record.settledAt !== undefined ? { settledAt: record.settledAt } : undefined),
  };
}

function sameTurn(a: ConversationViewTurn | undefined, b: ConversationViewTurn): boolean {
  return (
    a !== undefined &&
    a.id === b.id &&
    a.origin === b.origin &&
    a.status === b.status &&
    a.queuedAt === b.queuedAt &&
    a.startedAt === b.startedAt &&
    a.settledAt === b.settledAt
  );
}

export class ConversationViewSync {
  readonly #groups = new Map<string, HeldGroup>();
  readonly #turns = new Map<string, HeldTurn>();
  /** The latest speech event on each message, by the message's id; a rating is not one. */
  readonly #speech = new Map<string, HeldSpeechEvent>();
  #cursors: ConversationReadCursors = {};
  #settled = false;
  #unreadable: UnreadableRow | undefined;
  #revision = 0;

  /** Moves whenever what a snapshot would show has changed; a cursor alone moving does not move it. */
  get revision(): number {
    return this.#revision;
  }

  cursors(): ConversationReadCursors {
    return this.#cursors;
  }

  /**
   * Folds one messages page in. The answer's list of standing conversations
   * is the whole truth about which rows still stand, so everything held for a
   * conversation it does not name goes first; then each group is merged by
   * turn and each message replaced at its sequence.
   */
  applyMessages(page: ReadMessagesPage): void {
    const standing = new Set(page.conversations.map((conversation) => conversation.id));
    let moved = this.#dropOutside(standing);
    const openedAt = mainOpenedAt(page.conversations);
    if (openedAt !== undefined && this.#dropObservedBefore(openedAt)) moved = true;
    for (const group of page.groups) {
      const held = this.#groups.get(group.turnId) ?? {
        conversationId: group.conversationId,
        source: group.source,
        turn: undefined,
        messages: new Map<number, ConversationViewMessage>(),
      };
      if (group.turn !== undefined && !sameTurn(held.turn, group.turn)) {
        held.turn = group.turn;
        moved = true;
      }
      // A row still being written is answered on every read; one answered
      // unchanged moves nothing, so a long tool call does not redraw the thread every poll.
      for (const message of group.messages) {
        if (isDeepStrictEqual(held.messages.get(message.seq), message)) continue;
        held.messages.set(message.seq, message);
        moved = true;
      }
      this.#groups.set(group.turnId, held);
    }
    this.#cursors = { ...this.#cursors, messages: page.next };
    if (this.#unreadable !== undefined) {
      this.#unreadable = undefined;
      moved = true;
    }
    if (!this.#settled) {
      this.#settled = true;
      moved = true;
    }
    if (moved) this.#revision += 1;
  }

  /** Folds one events page in: the latest speech event on each message, by the conversation's own event sequence. */
  applyEvents(events: readonly ConversationReadEvent[], next: string): void {
    let moved = false;
    for (const event of events) {
      if (!isSpeechEventKind(event.kind)) continue;
      const held = this.#speech.get(event.messageId);
      if (held !== undefined && held.seq >= event.seq) continue;
      this.#speech.set(event.messageId, {
        conversationId: event.conversationId,
        kind: event.kind,
        seq: event.seq,
      });
      moved = true;
    }
    this.#cursors = { ...this.#cursors, events: next };
    if (moved) this.#revision += 1;
  }

  /** Folds one turns page in: a turn answered again replaces the one held, the group it wrote reads the new row, and the cursor follows the answer's, absent included. */
  applyTurns(turns: readonly BrainTurnRecord[], next: string | undefined): void {
    let moved = false;
    for (const record of turns) {
      const turn = viewTurn(record);
      const held = this.#turns.get(record.id);
      if (held !== undefined && sameTurn(held.turn, turn)) continue;
      this.#turns.set(record.id, { conversationId: record.conversationId, turn });
      const group = this.#groups.get(record.id);
      if (group !== undefined) group.turn = turn;
      moved = true;
    }
    // An answer with no cursor says the account has no turn at all — nothing
    // taken and nothing to take, as after a Clear that emptied them — and the
    // change signal's head is absent then too; the cursor held is let go so
    // the two read equal and the next poll does not read turns again.
    this.#cursors = { ...this.#cursors, turns: next };
    if (moved) this.#revision += 1;
  }

  /**
   * Takes a Clear the service confirmed to this picture from the answer
   * alone: every group of the main — the one standing was the one stamped,
   * whatever its id — and every observed group from before the new main
   * opened, exactly what the next read would no longer list. The read still
   * follows to move the cursors; the screen does not wait on it landing.
   */
  applyClear(openedAt: number): void {
    let moved = false;
    for (const [turnId, group] of this.#groups) {
      if (group.source.kind !== CONVERSATION_VIEW_SOURCE.MAIN) continue;
      this.#groups.delete(turnId);
      moved = true;
    }
    if (this.#dropObservedBefore(openedAt)) moved = true;
    if (moved) this.#revision += 1;
  }

  /** The service named a row it could not read back; the thread stands as last read and says so. */
  markUnreadable(row: UnreadableRow): void {
    if (
      this.#unreadable?.conversationId === row.conversationId &&
      this.#unreadable.seq === row.seq &&
      this.#settled
    ) {
      return;
    }
    this.#unreadable = row;
    this.#settled = true;
    this.#revision += 1;
  }

  /** Drops everything held and every cursor: the account is leaving, and the next one's reads start from the beginning. */
  reset(): void {
    this.#groups.clear();
    this.#turns.clear();
    this.#speech.clear();
    this.#cursors = {};
    this.#settled = false;
    this.#unreadable = undefined;
    this.#revision += 1;
  }

  /**
   * The Conversation as this device holds it: the groups in the view's order,
   * each turn as the latest row said, each announcement marked unspoken
   * where the latest speech event on its message is the expiry, and only
   * the newest turns kept, the rest let go of so a long Conversation does
   * not grow this picture without bound.
   */
  snapshot(): ConversationViewSnapshot {
    const placed = [...this.#groups].map(([turnId, held]) => {
      const messages = [...held.messages.values()].sort((a, b) => a.seq - b.seq);
      const turn = this.#turns.get(turnId)?.turn ?? held.turn;
      return {
        turnId,
        held,
        group: {
          turnId,
          turn,
          source: held.source,
          messages: messages.map((message) => this.#withSpeech(message)),
        },
        instant: Math.min(...messages.map((message) => message.createdAt)),
        queuedAt: turn?.queuedAt ?? Number.MAX_SAFE_INTEGER,
      };
    });
    placed.sort(
      (a, b) =>
        a.instant - b.instant || a.queuedAt - b.queuedAt || compareCodePoints(a.turnId, b.turnId),
    );
    const excess = placed.length - CONVERSATION_VIEW_BOUNDS.MAX_GROUPS;
    if (excess > 0) {
      for (const { turnId } of placed.splice(0, excess)) this.#groups.delete(turnId);
    }
    return {
      groups: placed.map(({ group }) => group),
      settled: this.#settled,
      ...(this.#unreadable !== undefined ? { unreadable: this.#unreadable } : undefined),
    };
  }

  #withSpeech(message: ConversationViewMessage): ConversationViewMessage {
    const speech = this.#speech.get(message.message.id);
    if (speech === undefined) return message;
    const unspoken = speech.kind === CONVERSATION_EVENT_KIND.SPEECH_EXPIRED;
    let changed = false;
    const tools: ConversationViewToolPart[] = message.tools.map((tool) => {
      if (tool.kind !== CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE || tool.unspoken === unspoken) {
        return tool;
      }
      changed = true;
      return { ...tool, unspoken };
    });
    return changed ? { ...message, tools } : message;
  }

  /**
   * The view's window starts where the current main opened. An observed
   * conversation's crossing rows from before that instant belonged to the
   * main a Clear stamped, and the service no longer sends them; a device that
   * drew them before the Clear lets them go here, even though the
   * conversation they came from still stands and keeps its own context.
   */
  #dropObservedBefore(openedAt: number): boolean {
    let dropped = false;
    for (const [turnId, group] of this.#groups) {
      if (group.source.kind !== CONVERSATION_VIEW_SOURCE.OBSERVED) continue;
      const latest = Math.max(...[...group.messages.values()].map((message) => message.createdAt));
      if (latest >= openedAt) continue;
      this.#groups.delete(turnId);
      dropped = true;
    }
    return dropped;
  }

  #dropOutside(standing: ReadonlySet<string>): boolean {
    let dropped = false;
    for (const [turnId, group] of this.#groups) {
      if (standing.has(group.conversationId)) continue;
      this.#groups.delete(turnId);
      dropped = true;
    }
    for (const [id, turn] of this.#turns) {
      if (!standing.has(turn.conversationId)) this.#turns.delete(id);
    }
    for (const [messageId, event] of this.#speech) {
      if (!standing.has(event.conversationId)) this.#speech.delete(messageId);
    }
    return dropped;
  }
}
