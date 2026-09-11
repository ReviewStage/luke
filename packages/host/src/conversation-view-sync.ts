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
  MESSAGE_ROLE,
  type UnreadableRow,
} from "@sidecar/session";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isSpeechEventKind,
  RATING_EVENT_PAYLOAD,
  type RatingEventPayload,
  unparsedWire,
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
 * within a poll. The marks the service folded onto each message — an
 * announcement's unspoken mark, the developer's latest rating — are amended
 * by the newer events read since, a second rating being a second event and
 * never an edit. Every device that reads to the end holds the same rows in
 * the same order, because the order is the view's own — earliest message,
 * then the turn's queue instant, then the id — and never the order of arrival.
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

/**
 * One of Luke's messages as a rating names it: whether it is a briefing or a
 * reply, which is what the count buckets it as. Only an assistant message is
 * one — the set the service accepts a rating for, since a compaction summary
 * never enters the view.
 */
export interface RateableMessage {
  readonly announcement: boolean;
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

/**
 * The latest rating event on a message. Its verdict is absent where the
 * payload did not read under the vocabulary: the event is still the
 * developer's last word by sequence, and an older verdict is not it. A mark
 * known newer than the fold — this device's own write, or an event that
 * superseded one — amends at once; one read back from the events otherwise
 * waits until the events read stands at or past the fold.
 */
interface HeldRatingEvent {
  readonly conversationId: string;
  readonly seq: number;
  readonly rating: RatingEventPayload | undefined;
  readonly newerThanFold: boolean;
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

function sameRating(a: RatingEventPayload | undefined, b: RatingEventPayload | undefined): boolean {
  return a?.rating === b?.rating && a?.note === b?.note;
}

export class ConversationViewSync {
  readonly #groups = new Map<string, HeldGroup>();
  readonly #turns = new Map<string, HeldTurn>();
  /** The latest speech event on each message, by the message's id; a rating is not one. */
  readonly #speech = new Map<string, HeldSpeechEvent>();
  /** The latest rating event on each message, by the message's id. */
  readonly #ratings = new Map<string, HeldRatingEvent>();
  /**
   * Whether the events read stands at or past the fold. The messages answer
   * folds every speech mark and rating up to the moment it was read, so while
   * the events are still being replayed from before that moment the rating
   * marks held here may be older than the fold and stand behind it; once a
   * page has answered that nothing more stands, they carry everything the
   * fold did and whatever came after, and only then do they amend it.
   */
  #eventsCaughtUp = false;
  #cursors: ConversationReadCursors = {};
  /**
   * Where the view's window starts on this device: the latest instant a main
   * opened, as the pages or a confirmed Clear said. It only ever moves
   * forward, so a page read before a Clear and landing after it cannot fold
   * the stamped main back in.
   */
  #windowStart = 0;
  /** Moves with every confirmed Clear, so a refusal from a pass that read before one is not written after it. */
  #clearEpoch = 0;
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

  /** How many Clears this picture has taken; a caller compares it across a read to tell a stale refusal from a current one. */
  get clearEpoch(): number {
    return this.#clearEpoch;
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
        // The page was read after every events page held so far, so the
        // rating it folds onto the row is newer than any mark read back from
        // the events; a walk cut short cannot leave an older one standing over it.
        if (this.#forgetReadBackRating(message.message.id)) moved = true;
        if (isDeepStrictEqual(held.messages.get(message.seq), message)) continue;
        held.messages.set(message.seq, message);
        moved = true;
      }
      this.#groups.set(group.turnId, held);
    }
    // After the merge, so a page's own rows from before the window are held to it too.
    if (this.#openWindow(mainOpenedAt(page.conversations))) moved = true;
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

  /**
   * Folds one events page in: the latest speech event and the latest rating
   * event on each message, by the conversation's own event sequence. A page
   * answering that nothing more stands is the events read catching up with
   * the fold, from which point the rating marks held here amend it.
   */
  applyEvents(events: readonly ConversationReadEvent[], next: string, hasMore: boolean): void {
    let moved = false;
    for (const event of events) {
      if (isSpeechEventKind(event.kind)) {
        const held = this.#speech.get(event.messageId);
        if (held !== undefined && held.seq >= event.seq) continue;
        this.#speech.set(event.messageId, {
          conversationId: event.conversationId,
          kind: event.kind,
          seq: event.seq,
        });
        moved = true;
        continue;
      }
      if (event.kind !== CONVERSATION_EVENT_KIND.RATING) continue;
      if (
        this.#holdRating(event.messageId, {
          conversationId: event.conversationId,
          seq: event.seq,
          rating:
            event.payload === undefined
              ? undefined
              : RATING_EVENT_PAYLOAD.parse(unparsedWire(event.payload)),
          newerThanFold: false,
        })
      ) {
        moved = true;
      }
    }
    if (!hasMore && !this.#eventsCaughtUp) {
      this.#eventsCaughtUp = true;
      // The marks read back were standing behind the fold until now; one known newer already showed.
      if ([...this.#ratings.values()].some((held) => !held.newerThanFold)) moved = true;
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
   * Takes a rating this device just wrote, from the answer that recorded it,
   * so the control shows the verdict before the next read carries it back.
   * Being this device's own write it is newer than anything held or folded,
   * so it amends at once rather than waiting on the events read; the event
   * the read later answers carries the same sequence and moves nothing.
   */
  recordRating(messageId: string, seq: number, rating: RatingEventPayload): void {
    const held = this.#findMessage(messageId);
    if (held === undefined) return;
    if (
      this.#holdRating(messageId, {
        conversationId: held.group.conversationId,
        seq,
        rating,
        newerThanFold: true,
      })
    ) {
      this.#revision += 1;
    }
  }

  /**
   * The message a rating would land on, where this device holds one of Luke's
   * by that id: whether it is a briefing. Nothing for a message not held, and
   * nothing for one that is not Luke's — the developer's own ask, the brain's
   * note to itself — since the service would refuse those and no control is
   * drawn on them.
   */
  rateable(messageId: string): RateableMessage | undefined {
    const held = this.#findMessage(messageId);
    if (held === undefined || held.message.message.role !== MESSAGE_ROLE.ASSISTANT) {
      return undefined;
    }
    return {
      announcement: held.message.tools.some(
        (tool) => tool.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE,
      ),
    };
  }

  /**
   * Takes a Clear the service confirmed to this picture from the answer
   * alone: the window now starts where the new main opened, so the stamped
   * main's groups and every observed group from before that instant go,
   * exactly what the next read would no longer list, and a page a pass read
   * before the Clear cannot bring them back. The read still follows to move
   * the cursors; the screen does not wait on it landing.
   */
  applyClear(openedAt: number): void {
    this.#clearEpoch += 1;
    let moved = this.#openWindow(openedAt);
    // A row the last read could not read back stood in the main the Clear
    // stamped; the notice about it goes with the thread it was about.
    if (this.#unreadable !== undefined) {
      this.#unreadable = undefined;
      moved = true;
    }
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
    this.#ratings.clear();
    this.#eventsCaughtUp = false;
    this.#cursors = {};
    this.#windowStart = 0;
    this.#settled = false;
    this.#unreadable = undefined;
    this.#revision += 1;
  }

  /**
   * The Conversation as this device holds it: the groups in the view's order,
   * each turn as the latest row said, each announcement marked unspoken
   * where the latest speech event on its message is the expiry, each
   * message's rating as the newest word about it, and only the newest turns
   * kept, the rest let go of so a long Conversation does not grow this
   * picture without bound.
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
          messages: messages.map((message) => this.#withRating(this.#withSpeech(message))),
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
      for (const { turnId, held } of placed.splice(0, excess)) {
        this.#groups.delete(turnId);
        this.#forgetMarks([...held.messages.values()].map((message) => message.message.id));
      }
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
   * The message's rating as the newest word about it: the one the service
   * folded onto the row, amended by a rating this device wrote since, and by
   * the rating events read since once the events read stands at or past the
   * fold. A newest event whose verdict did not read leaves the message
   * unrated, because an older verdict is not the developer's last word.
   */
  #withRating(message: ConversationViewMessage): ConversationViewMessage {
    const held = this.#ratings.get(message.message.id);
    if (held === undefined || !(held.newerThanFold || this.#eventsCaughtUp)) return message;
    if (sameRating(held.rating, message.rating)) return message;
    const { rating: _folded, ...unrated } = message;
    return held.rating === undefined ? unrated : { ...unrated, rating: held.rating };
  }

  /**
   * Holds a rating event as the newest on its message where it is; answers
   * whether anything moved. An event that supersedes a mark known newer than
   * the fold is newer than the fold itself, whatever the events read has
   * reached, so it inherits that standing rather than falling behind the fold.
   */
  #holdRating(messageId: string, event: HeldRatingEvent): boolean {
    const held = this.#ratings.get(messageId);
    if (held !== undefined && held.seq >= event.seq) return false;
    this.#ratings.set(messageId, {
      ...event,
      newerThanFold: event.newerThanFold || held?.newerThanFold === true,
    });
    return true;
  }

  /** Lets go of a mark read back from the events, keeping one known newer than the fold; answers whether a shown verdict went with it. */
  #forgetReadBackRating(messageId: string): boolean {
    const held = this.#ratings.get(messageId);
    if (held === undefined || held.newerThanFold) return false;
    this.#ratings.delete(messageId);
    return this.#eventsCaughtUp;
  }

  /** The marks about messages this picture no longer holds go with them. */
  #forgetMarks(messageIds: Iterable<string>): void {
    for (const messageId of messageIds) {
      this.#speech.delete(messageId);
      this.#ratings.delete(messageId);
    }
  }

  #findMessage(
    messageId: string,
  ): { readonly group: HeldGroup; readonly message: ConversationViewMessage } | undefined {
    for (const group of this.#groups.values()) {
      for (const message of group.messages.values()) {
        if (message.message.id === messageId) return { group, message };
      }
    }
    return undefined;
  }

  /**
   * Moves the window's start forward to where a main opened, never back, and
   * lets go of every message that predates it, a group going with its last
   * one: the stamped main's own rows, and an observed conversation's crossing
   * rows from before the current main, which belonged to the main a Clear
   * stamped and which the service no longer sends, even inside a turn still
   * running across the Clear. A device that drew them before the Clear
   * drops them here, whether the instant arrived on a page or on the Clear's
   * own answer, and a page from before the Clear that lands after it is held
   * to the same start; the observed conversation itself still stands and
   * keeps its own context.
   */
  #openWindow(openedAt: number | undefined): boolean {
    if (openedAt !== undefined && openedAt > this.#windowStart) this.#windowStart = openedAt;
    let dropped = false;
    for (const [turnId, group] of this.#groups) {
      // Row by row, as the service selects them: a turn still running across
      // a Clear keeps only what it wrote after the new main opened.
      for (const [seq, message] of group.messages) {
        if (message.createdAt >= this.#windowStart) continue;
        group.messages.delete(seq);
        this.#forgetMarks([message.message.id]);
        dropped = true;
      }
      if (group.messages.size === 0) this.#groups.delete(turnId);
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
    for (const [messageId, event] of this.#ratings) {
      if (!standing.has(event.conversationId)) this.#ratings.delete(messageId);
    }
    return dropped;
  }
}
