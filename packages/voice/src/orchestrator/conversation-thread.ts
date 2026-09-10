import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import {
  adoptConversationThread,
  appendConversationThreadEntry,
  type ConversationEntry,
  insertSpokenAskThreadEntry,
  retainedConversationEntries,
  storedConversationMaximumAgeMs,
  withConversationEntryRequest,
} from "@sidecar/session";
import { ConversationReporter, withPendingLines } from "./conversation-reporter.js";

/** An asynchronous entry belongs only to the history generation in which its work began. */
export function conversationEntryBelongsToConversation(
  entryGeneration: number | undefined,
  conversationGeneration: number,
): boolean {
  return entryGeneration !== undefined && entryGeneration === conversationGeneration;
}

/** Moves turns opened before restore behind the restored thread. */
export function rebaseSpokenTurnMarks(
  marks: readonly { after: ConversationEntry | undefined }[],
  restoredTail: ConversationEntry,
): void {
  for (const mark of marks) mark.after ??= restoredTail;
}

/**
 * Where one spoken turn belongs in the thread, and what it has since become:
 * the entry its transcript settled into, and the brain run it opened, each
 * written onto the mark when it is known so the other can find it.
 */
export interface SpokenTurnMark {
  after: ConversationEntry | undefined;
  generation: number;
  recordedAt: number;
  entry?: ConversationEntry;
  runId?: string;
}

/** One empty map, so clearing previews repeatedly reports nothing. */
const NO_SPOKEN_ASK_PREVIEWS: ReadonlyMap<string, string> = new Map();

export interface ConversationThreadOptions {
  /**
   * Persists what this window appended, answering whether the store took the
   * lines. A refusal is not followed up here: the next publish retries.
   */
  append(entries: readonly ConversationEntry[]): Promise<boolean>;
  /** The thread moved — its lines, its previews, or both — and whoever draws from it should read again. */
  onChanged(): void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
  newEventId?: () => string;
}

/**
 * The spoken conversation this launch leaves behind, held apart from the call
 * that transported any of it: a call is a transport that comes and goes —
 * Luke's own is torn down by the talk key on its way to the developer's, and
 * an idle one retires — while the thread stands for as long as the window
 * does. It owns the lines, the generation a Clear advances, the marks that
 * say where a spoken turn belongs when its transcript comes back on the
 * service's own clock, and the previews drawn while it is still arriving.
 */
export class ConversationThread {
  readonly #options: ConversationThreadOptions;
  readonly #reporter = new ConversationReporter();
  #entries: readonly ConversationEntry[] = [];
  #generation = 0;
  /**
   * Whether the stored thread has been placed. Once, from the first snapshot
   * that carries it: a second seeding would re-add lines the developer had
   * already cleared, and a Clear that lands before it must stay cleared.
   */
  #seeded = false;
  #contextReady = false;
  readonly #contextWaiters = new Set<() => void>();
  #retentionTimer: ScheduledTimer | undefined;
  /** Where each server-identified spoken turn belongs when its transcript returns. */
  readonly #marks = new Map<string, SpokenTurnMark>();
  /** Local turn-close marks waiting for the server item ids that name them. */
  #pendingMarks: SpokenTurnMark[] = [];
  /** The turn opened by the current talk-key press, before it closes. */
  #activeMark: SpokenTurnMark | undefined;
  /**
   * The spoken turn whose reply is under way — the one an `ask_brain` call
   * inside that reply belongs to — so the run it opens can be tied to the
   * transcript, whichever of the two lands first.
   */
  #latestMark: SpokenTurnMark | undefined;
  /**
   * The developer's spoken turns still being transcribed, keyed by the server
   * item that names each turn: the preview Conversation draws while the completed
   * transcript is still on the service's own clock. Kept apart from the
   * thread — a preview settles by leaving when the completed words are
   * recorded, or by leaving alone when nothing ever will.
   */
  #previews: ReadonlyMap<string, string> = NO_SPOKEN_ASK_PREVIEWS;
  /**
   * The previewed items no commit has named yet. The live transcription model
   * streams the developer's words while they are still speaking — before the
   * commit names the item the turn travels as, so before any mark can key
   * them — and those words draw live like any others: refusing them would
   * stream every spoken bubble from its tail. What an unnamed item cannot do
   * is settle — no completed transcript ever comes for a discarded turn — so
   * each is tracked here until its commit arrives, and a discard takes the
   * held turn's entries out of the previews instead of leaving them streaming
   * forever. `closed` says the turn's commit has been sent, which is what
   * spares an item mid-flight to its `committed` from a discard that can only
   * mean the turn still being held.
   */
  readonly #uncommitted = new Map<string, { closed: boolean }>();
  /** The generation of the developer-opened turn whose reply is still in flight. */
  #replyGeneration: number | undefined;
  /** The Conversation generation in which the current announcement began speaking. */
  #announcementGeneration: number | undefined;

  constructor(options: ConversationThreadOptions) {
    this.#options = options;
  }

  get entries(): readonly ConversationEntry[] {
    return this.#entries;
  }

  get generation(): number {
    return this.#generation;
  }

  get previews(): ReadonlyMap<string, string> {
    return this.#previews;
  }

  /** The turn whose reply is under way, for a run accepted inside it to be tied to. */
  get latestTurn(): SpokenTurnMark | undefined {
    return this.#latestMark;
  }

  /** Holds the first call until the document has supplied its durable reply context. */
  waitForContext(): Promise<void> {
    if (this.#contextReady) return Promise.resolve();
    return new Promise((resolve) => {
      this.#contextWaiters.add(resolve);
    });
  }

  /**
   * The stored thread, placed once from the snapshot that carries it. Turns
   * opened before it landed are moved behind it, so a transcript arriving
   * late is inserted after the restored lines rather than ahead of them.
   */
  seed(entries: readonly ConversationEntry[]): void {
    if (!this.#seeded && this.#generation === 0) {
      this.#seeded = true;
      const restoredTail = entries.at(-1);
      if (restoredTail) {
        rebaseSpokenTurnMarks(
          [
            ...this.#marks.values(),
            ...this.#pendingMarks,
            ...(this.#activeMark ? [this.#activeMark] : []),
          ],
          restoredTail,
        );
      }
      this.#reporter.adopt(entries);
      this.#entries = adoptConversationThread(this.#entries, [...entries, ...this.#entries]);
      this.#publish();
    }
    this.#contextReady = true;
    for (const resolve of this.#contextWaiters) resolve();
    this.#contextWaiters.clear();
  }

  /**
   * The main process's own lines — the ask a carried action was — reaching this
   * window as they reach every panel, so this window's next whole report
   * carries them rather than standing them back down.
   */
  merge(entries: readonly ConversationEntry[]): void {
    this.#reporter.adopt(entries);
    // What arrives is the store's thread as another writer left it; a line of
    // this window's still awaiting the store's acknowledgement is kept.
    this.#entries = withPendingLines(
      adoptConversationThread(this.#entries, entries),
      this.#entries,
      (entry) => this.#reporter.pending(entry),
    );
    this.#changed();
  }

  /**
   * The Clear a panel pressed, already carried out by the main process,
   * arriving here to retire this window's in-flight turns the way the press
   * would have.
   */
  clear(): void {
    this.#generation += 1;
    // Seeded even if no snapshot has landed, so one still in flight cannot
    // deliver the very thread this press just cleared.
    this.#seeded = true;
    this.#entries = [];
    this.#reporter.reset();
    this.#marks.clear();
    this.#pendingMarks = [];
    this.#latestMark = undefined;
    this.#activeMark = undefined;
    // The previews go with the marks: a transcription still arriving belongs
    // to a turn the press just retired.
    this.#previews = NO_SPOKEN_ASK_PREVIEWS;
    this.#uncommitted.clear();
    this.#replyGeneration = undefined;
    this.#announcementGeneration = undefined;
    this.#changed();
  }

  /**
   * Appends one line to this launch's history. A session leaving the roster
   * costs a line its identity at model render, never its visible words.
   */
  remember(entry: ConversationEntry | undefined, generation = this.#generation): void {
    if (!entry || !conversationEntryBelongsToConversation(generation, this.#generation)) return;
    this.#entries = appendConversationThreadEntry(this.#entries, {
      ...entry,
      eventId: entry.eventId ?? this.#newEventId(),
    });
    this.#publish();
  }

  /** The press opened a turn: where it belongs is where the thread stands now. */
  openTurn(): void {
    this.#activeMark = {
      after: this.#entries.at(-1),
      generation: this.#generation,
      recordedAt: this.#now(),
    };
    this.#replyGeneration = this.#activeMark.generation;
  }

  /** The turn closed locally, before the server has named the item that carries it. */
  closeTurn(): void {
    const mark = this.#activeMark;
    this.#activeMark = undefined;
    if (mark) this.#pendingMarks.push(mark);
    // Every item streaming now was spoken into a turn whose commit is out:
    // a later discard is about a newer turn, not these.
    for (const entry of this.#uncommitted.values()) entry.closed = true;
  }

  /** The server named the item one closed turn travels as. */
  commitTurn(itemId: string): void {
    this.#uncommitted.delete(itemId);
    const mark = this.#pendingMarks.shift();
    if (mark) this.#marks.set(itemId, mark);
    this.#latestMark = mark;
    // A commit with no turn left to claim it — one from before a Clear — has
    // no mark to settle its preview through, so the preview leaves now rather
    // than streaming for a transcript the recording path would refuse.
    if (!mark) this.dropPreview(itemId);
    // With no turn held and no commit in flight, an item still unnamed can
    // never be named: a discarded turn's stragglers, misread as a turn that
    // has now settled. Their previews leave rather than streaming forever.
    if (!this.#activeMark && this.#pendingMarks.length === 0) {
      for (const orphan of [...this.#uncommitted.keys()]) this.dropPreview(orphan);
    }
  }

  /**
   * The held turn was discarded — its audio abandoned before any commit — so
   * the words already transcribed from it belong to no item a commit will
   * ever name, and the previews they drew leave now. An item whose turn's
   * commit is out keeps streaming: its `committed` is on its way.
   */
  discardTurn(): void {
    this.#activeMark = undefined;
    const held = [...this.#uncommitted].filter(([, entry]) => !entry.closed).map(([id]) => id);
    if (held.length === 0) return;
    const next = new Map(this.#previews);
    for (const itemId of held) {
      this.#uncommitted.delete(itemId);
      next.delete(itemId);
    }
    this.#previews = next;
    this.#options.onChanged();
  }

  /**
   * Records a spoken ask where its turn happened rather than where its
   * transcription landed: the words come back on the service's own clock,
   * sometimes after the reply they asked for has ended, and an exchange
   * stored in reverse would be re-fed in reverse to every later call. The
   * server item binds it to the mark made for that exact turn, so a
   * transcript delayed past Clear cannot borrow a newer turn's place.
   */
  rememberSpokenAsk(transcript: string, itemId: string): void {
    // The completed words supersede the turn's preview whether or not they
    // may be recorded: either way, nothing about this turn is still arriving.
    this.dropPreview(itemId);
    const mark = this.#marks.get(itemId);
    this.#marks.delete(itemId);
    if (!mark || !conversationEntryBelongsToConversation(mark.generation, this.#generation)) return;
    const placed = insertSpokenAskThreadEntry(
      this.#entries,
      transcript,
      mark.after,
      mark.recordedAt,
      mark.runId,
      this.#newEventId(),
    );
    // A transcription that came back empty ended its turn — the preview and
    // the mark are already spent — but placed no line, and a thread that did
    // not change owes the other displays no report.
    if (placed === this.#entries) return;
    // The mark keeps its line, so a run accepted after the transcript can
    // still be tied to these very words.
    mark.entry = placed[mark.after ? placed.indexOf(mark.after) + 1 : 0];
    this.#entries = placed;
    this.#publish();
  }

  /**
   * The same words while they are still arriving, drawn live: the model
   * transcribes the developer's speech as it is spoken, so the preview starts
   * with the sentence's front while the talk key is still held. Words no turn
   * could own — a straggler after Clear, with the marks and the held turn
   * retired — preview nothing they could never record; words that merely
   * outran their turn's commit draw now and are tracked until the commit
   * names their item.
   */
  previewSpokenAsk(itemId: string, delta: string): void {
    const mark = this.#marks.get(itemId);
    if (mark) {
      if (!conversationEntryBelongsToConversation(mark.generation, this.#generation)) return;
    } else if (!this.#uncommitted.has(itemId)) {
      // Whose turn a first unnamed delta belongs to is read off the lifecycle
      // at its arrival: words while a turn is held are that turn's, and words
      // with only a commit in flight can only be that commit's — born closed,
      // so a discard of the next held turn cannot take them down.
      if (this.#activeMark) this.#uncommitted.set(itemId, { closed: false });
      else if (this.#pendingMarks.length > 0) this.#uncommitted.set(itemId, { closed: true });
      else return;
    }
    const next = new Map(this.#previews);
    next.set(itemId, (next.get(itemId) ?? "") + delta);
    this.#previews = next;
    this.#options.onChanged();
  }

  dropPreview(itemId: string): void {
    this.#uncommitted.delete(itemId);
    if (!this.#previews.has(itemId)) return;
    const next = new Map(this.#previews);
    next.delete(itemId);
    this.#previews = next;
    this.#options.onChanged();
  }

  /**
   * The call gone takes its half-transcribed turns with it: no completed
   * transcript can arrive to settle a preview, so none may keep streaming —
   * and no commit can arrive either, so nothing is left waiting for one.
   */
  clearPreviews(): void {
    this.#uncommitted.clear();
    if (this.#previews === NO_SPOKEN_ASK_PREVIEWS) return;
    this.#previews = NO_SPOKEN_ASK_PREVIEWS;
    this.#options.onChanged();
  }

  /**
   * Ties the brain run a spoken ask opened to the developer's own words for
   * it — the voice service's transcript, never the mouth's paraphrase of the
   * question. The transcript may already stand in the thread, in which case
   * the run is written onto that line; otherwise the mark carries the run to
   * the transcript when it lands. Either way Conversation can draw the ask as
   * pending, with its cancel, beside the words actually said.
   */
  tieTurnToRun(mark: SpokenTurnMark | undefined, runId: string): void {
    // A turn from before a Clear has no line left to tie, and must not hand
    // its run to whatever the thread now holds in its place.
    if (!mark || !conversationEntryBelongsToConversation(mark.generation, this.#generation)) return;
    mark.runId = runId;
    if (!mark.entry) return;
    const tied = withConversationEntryRequest(this.#entries, mark.entry, runId);
    if (tied === this.#entries) return;
    mark.entry = tied[this.#entries.indexOf(mark.entry)];
    this.#entries = tied;
    this.#publish();
  }

  /** The generation the reply under way answers, taken once as that reply ends. */
  takeReplyGeneration(): number | undefined {
    const generation = this.#replyGeneration;
    this.#replyGeneration = undefined;
    return generation;
  }

  /**
   * The generation an announcement began speaking in, so a Clear while it is
   * being read out keeps its words out of the thread that replaced it.
   */
  markAnnouncement(): void {
    this.#announcementGeneration = this.#generation;
  }

  takeAnnouncementGeneration(): number | undefined {
    const generation = this.#announcementGeneration;
    this.#announcementGeneration = undefined;
    return generation;
  }

  /** Lets go of the retention clock; the thread itself dies with the window. */
  stop(): void {
    this.#clearRetention();
  }

  #newEventId(): string {
    return (this.#options.newEventId ?? crypto.randomUUID.bind(crypto))();
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  /**
   * Persists what this window appended. The main process's store takes each
   * line by its id, relays the thread to every panel's Conversation, and reads the
   * recent slice for the brain, so nothing is re-fed to a call here. A line
   * is marked reported only once the store said it took it; one it refused is
   * sent again on the next publish. Before the restore this thread is only
   * part of itself, and a report then would name lines the store already
   * holds as though they were new.
   */
  #publish(): void {
    this.#entries = retainedConversationEntries(this.#entries, this.#now());
    this.#changed();
    if (!this.#seeded) return;
    const taken = this.#reporter.take(this.#entries);
    if (taken.entries.length === 0) return;
    this.#options.append(taken.entries).then(
      (acknowledged) => {
        this.#reporter.settle(taken, acknowledged);
        // A line that learned its run while its append was out is owed once
        // more; an acknowledgement is what makes it sendable, so it is sent
        // now rather than waiting for the next line.
        if (acknowledged) this.#publish();
      },
      () => this.#reporter.settle(taken, false),
    );
  }

  /** The thread moved: the retention clock is re-read and the reader told. */
  #changed(): void {
    this.#armRetention();
    this.#options.onChanged();
  }

  #armRetention(): void {
    this.#clearRetention();
    const expiresAt = this.#entries.reduce(
      (soonest, entry) =>
        entry.recordedAt === undefined
          ? soonest
          : Math.min(soonest, entry.recordedAt + storedConversationMaximumAgeMs),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(expiresAt)) return;
    this.#retentionTimer = (this.#options.schedule ?? setTimeout)(
      () => {
        this.#retentionTimer = undefined;
        this.#publish();
      },
      Math.max(0, expiresAt - this.#now() + 1),
    );
  }

  #clearRetention(): void {
    if (this.#retentionTimer === undefined) return;
    // SAFETY: the handle is whatever `schedule ?? setTimeout` returned, and
    // the fallbacks are paired — a handle from `setTimeout` can only reach
    // `clearTimeout`.
    (this.#options.cancel ?? clearTimeout)(this.#retentionTimer as never);
    this.#retentionTimer = undefined;
  }
}
