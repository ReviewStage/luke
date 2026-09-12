import type { ProviderTranscriptSinceResult, Session, SessionIdentity } from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Option } from "effect";
import { BRAIN_DEFAULTS } from "./defaults.js";
import { settledUnlessAborted } from "./effect/settled.js";
import type { Generation } from "./generation.js";
import { wakeInputText } from "./input-items.js";
import { NestedMap } from "./nested-map.js";
import {
  type BrainObservationEntry,
  entryFromEvent,
  entryMark,
  inboxEvents,
  sameObservation,
} from "./observation-inbox.js";
import type { BrainRoster } from "./performer.js";
import type { AgentSeam } from "./seam.js";
import { SteeredDeliveries } from "./steered-deliveries.js";
import { sameIdentity } from "./tools/records.js";
import { readTranscriptDelta } from "./transcript-reads.js";
import { BRAIN_TURN_TRIGGER, TURN_OUTCOME, type TurnPlan, type TurnResult } from "./turn.js";
import { BRAIN_WAKE_KIND, type BrainTranscriptDelta, type BrainWakeEvent } from "./wake-events.js";
import { WakeQueue } from "./wake-queue.js";

/**
 * Which session a conversation's own roster look reads. It is a fact of the
 * conversation, fixed when its agent is built: an observed conversation names
 * its one session and can read no other's transcript, and main's ordinary
 * conversation reads none on a look at all. Which sessions are looked at is
 * the host's decision, made before it calls `rosterLook()` on a conversation.
 */
export const LOOK_SUBJECT = {
  NONE: "none",
  SESSION: "session",
} as const;

export type LookSubject =
  | { readonly kind: typeof LOOK_SUBJECT.NONE }
  | { readonly kind: typeof LOOK_SUBJECT.SESSION; readonly identity: SessionIdentity };

export interface WakeCaptureOptions {
  seam: AgentSeam;
  subject: LookSubject;
  roster: () => BrainRoster;
  readTranscriptSince: (
    identity: SessionIdentity,
    cursor: string | undefined,
  ) => Promise<ProviderTranscriptSinceResult>;
  createRunId: () => string;
  /** The moment the model may be asked again, or nothing when it may be asked now. */
  quietUntil: () => number | undefined;
  /** Whether a turn or the maintenance holds the context; a look waits for it. */
  turnInFlight: () => boolean;
  /** Runs one turn the capture opened, settled whole; the runner's own. */
  turn: (plan: TurnPlan) => Promise<TurnResult>;
}

/**
 * The observation window: what wakes this conversation, what it writes down
 * before anything is scheduled, and when a turn opens over it. Nothing is
 * sent as a wake arrives — each session's transcript is read from its capture
 * cursor, the entry and the moved cursor land in one save, and only then does
 * the coalescing window arm, so every turn opens over input that already
 * stands on disk.
 */
export class WakeCapture {
  readonly #options: WakeCaptureOptions;
  readonly #seam: AgentSeam;
  readonly #queue: WakeQueue;
  readonly #subject: LookSubject;
  /**
   * Each session as it last looked when an observation was captured, for the
   * unchanged-look suppression. Held in memory alone: the first look after a
   * launch is captured even with no transcript gained, because a status that
   * changed while Luke was closed is still a change worth one look.
   */
  readonly #lastLook = new NestedMap<string>();
  /** Captures run one after another, so two reads of one session never race each other's cursor. */
  #capturing: Promise<unknown> = Promise.resolve();
  #capturesInFlight = 0;

  constructor(options: WakeCaptureOptions) {
    this.#options = options;
    this.#seam = options.seam;
    this.#subject = options.subject;
    this.#queue = new WakeQueue({
      coalesceMs: BRAIN_DEFAULTS.WAKE_COALESCE_MS,
      capacity: BRAIN_DEFAULTS.PENDING_WAKE_CAPACITY,
      now: this.#seam.now,
      schedule: this.#seam.schedule,
      cancel: this.#seam.cancel,
      quietUntil: options.quietUntil,
      flush: (events) => this.#flush(events),
    });
  }

  /** How many wakes are waiting for a turn to open, before any inbox stands. */
  size(): number {
    return this.#queue.size();
  }

  capturesInFlight(): number {
    return this.#capturesInFlight;
  }

  /** Disarms the window for a turn the host is opening anyway. */
  take(): void {
    this.#queue.take();
  }

  /** Drops every pending wake: the memory they described is gone. */
  clear(): void {
    this.#queue.clear();
  }

  /**
   * Captures wake events into the durable inbox and arms the coalescing
   * window. Nothing is sent yet, and nothing opens until the capture has
   * landed: each session's transcript is read from its capture cursor, the
   * entry and the moved cursor are written in one save, and only then does
   * the window arm — so a turn is scheduled over input that already stands
   * on disk. Wakes inside the window open one turn together, and wakes
   * during a model's quiet wait for it to end rather than being dropped.
   * Settles once the capture has landed or been refused.
   */
  wake(events: readonly BrainWakeEvent[]): Promise<void> {
    if (this.#seam.stopped() || events.length === 0) return Promise.resolve();
    return this.#capture(events).then((captured) => {
      if (this.#seam.stopped()) return;
      const generation = this.#seam.generation();
      if (!generation) return;
      if (captured > 0 || generation.inbox.length > 0) {
        this.#queue.push(inboxEvents(generation.inbox));
      }
    });
  }

  /**
   * One look at this conversation's session, driven by the host's observation
   * pass rather than an internal timer. The host decides which sessions are
   * looked at — local or cloud, working, waiting, or already followed — and
   * the brain reads its one: what the session's transcript gained since the
   * last look where the provider answers an incremental read, and its roster
   * fields alone where it does not. Skipped while a turn is in flight or the
   * model is quiet, because the next look reads the same deltas; pending hook
   * wakes ride along rather than waiting for their own.
   */
  rosterLook(): Promise<void> {
    if (this.#seam.stopped()) return Promise.resolve();
    const generation = this.#seam.generation();
    if (!generation) return this.#seam.ready().then(() => this.rosterLook());
    const looks = this.#ownLooks(this.#options.roster(), this.#seam.now());
    // The look is captured before anything opens, like a hook: what each
    // session gained stands in the inbox with its cursor, and the turn that
    // follows — now, or the next one if the model is quiet or a turn is in
    // flight — consumes it from there.
    return this.#capture(looks).then((captured) => {
      if (this.#seam.stopped() || this.#options.turnInFlight()) return;
      if (generation !== this.#seam.generation()) return;
      if (this.#options.quietUntil() !== undefined) return;
      if (captured === 0 && generation.inbox.length === 0) return;
      this.#queue.take();
      void this.#seam.queueTurn(BRAIN_TURN_TRIGGER.ROSTER, () =>
        this.#options.turn({
          generation,
          trigger: BRAIN_TURN_TRIGGER.ROSTER,
          deliveries: new SteeredDeliveries(),
          events: inboxEvents(generation.inbox),
          open: (attached, openedAt) => [wakeInputText(attached, openedAt)],
        }),
      );
    });
  }

  /**
   * Observations captured before the last launch ended, or left standing by a
   * turn that failed, open a turn once the state is read: they were written
   * down to be read, and a relaunch reads them without touching a transcript.
   */
  armInbox(generation: Generation): void {
    if (this.#seam.stopped() || generation.inbox.length === 0) return;
    this.#queue.push(inboxEvents(generation.inbox));
  }

  /**
   * The capture itself, one batch at a time. Each distinct session in the
   * batch is read once from its capture cursor; an event that names a hook
   * the inbox already holds — the same hook, session, and instant delivered
   * twice — is not captured again; a roster edge that gained nothing over a
   * session standing exactly as it last stood is not captured at all; and an
   * event on a session the developer is speaking with moves its cursor past
   * what was read and leaves no entry. What remains is written with the
   * advanced capture cursors in one save, and a save the store refuses moves
   * no cursor in memory either. Answers how many entries were captured.
   */
  #capture(events: readonly BrainWakeEvent[]): Promise<number> {
    const work = async (): Promise<number> => {
      await this.#seam.ready();
      const generation = this.#seam.generation();
      if (!generation || this.#seam.stopped() || generation.abort.signal.aborted) return 0;
      const fresh = events.filter(
        (event, index) =>
          !generation.inbox.some((entry) => sameObservation(entryMark(entry), event)) &&
          !events.slice(0, index).some((earlier) => sameObservation(earlier, event)),
      );
      if (fresh.length === 0) return 0;
      const mark = generation.captureCursors.persisted();
      const reads = new NestedMap<{
        delta: BrainTranscriptDelta | undefined;
        cursor: string | undefined;
      }>();
      const entries: BrainObservationEntry[] = [];
      let heardFirstHand = false;
      const now = this.#seam.now();
      for (const event of fresh) {
        let read = reads.get(event.identity.providerId, event.identity.providerSessionId);
        if (!read) {
          // The capture is not a turn and holds no fiber of its own, so the
          // generation's signal is raced here rather than left to interrupt one.
          const delta = await this.#seam.carry(
            settledUnlessAborted(
              readTranscriptDelta(event.identity, {
                cursors: generation.captureCursors,
                read: (identity, cursor) => this.#options.readTranscriptSince(identity, cursor),
                maximumChars: BRAIN_DEFAULTS.DELTA_PER_SESSION_CHARS,
              }),
              generation.abort.signal,
            ),
          );
          if (Option.isNone(delta)) {
            generation.captureCursors.rollback(mark);
            return 0;
          }
          read = {
            delta: delta.value,
            cursor: generation.captureCursors.cursor(event.identity),
          };
          reads.set(event.identity.providerId, event.identity.providerSessionId, read);
        } else {
          // A second event for the same session in one batch carries no
          // second delta: the first read covers both.
          read = {
            delta: {
              text: "",
              truncated: false,
              status: read.delta?.status ?? ACTION_RESULT_STATUS.ACCEPTED,
            },
            cursor: read.cursor,
          };
        }
        if (event.session && developerSpeakingWith(event.session)) {
          heardFirstHand = true;
          continue;
        }
        if (
          event.kind === BRAIN_WAKE_KIND.ROSTER &&
          !read.delta?.text &&
          this.#lastLook.get(event.identity.providerId, event.identity.providerSessionId) ===
            lookFingerprint(event)
        ) {
          continue;
        }
        entries.push(
          entryFromEvent(event, this.#options.createRunId(), now, read.delta, read.cursor),
        );
      }
      if (entries.length === 0 && !heardFirstHand) {
        generation.captureCursors.rollback(mark);
        return 0;
      }
      const written = await this.#seam.ledger.captured(generation, entries);
      if (!written) {
        generation.captureCursors.rollback(mark);
        this.#seam.report("Brain observation could not be captured");
        return 0;
      }
      for (const event of fresh) {
        if (event.kind === BRAIN_WAKE_KIND.ROSTER) {
          this.#lastLook.set(
            event.identity.providerId,
            event.identity.providerSessionId,
            lookFingerprint(event),
          );
        }
      }
      return entries.length;
    };
    this.#capturesInFlight += 1;
    const settled = () => {
      this.#capturesInFlight -= 1;
    };
    const run = this.#capturing.then(work, work);
    this.#capturing = run.then(settled, settled);
    return run;
  }

  /**
   * The one event this conversation's look reads: its observed session as the
   * roster holds it now, or nothing when the conversation observes none or
   * the roster no longer holds its session. Whether the session is worth a
   * look at all — live, or one already followed — was the host's test before
   * it asked; repeating a narrower one here would only lose edges, such as a
   * cloud chat's move from waiting to error. A session another conversation
   * observes is never read, whatever the roster holds.
   */
  #ownLooks(roster: BrainRoster, now: number): readonly BrainWakeEvent[] {
    const subject = this.#subject;
    if (subject.kind === LOOK_SUBJECT.NONE) return [];
    return (roster.sessions ?? []).flatMap((session) => {
      const identity: SessionIdentity = {
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      };
      if (!sameIdentity(subject.identity, identity)) return [];
      return [{ kind: BRAIN_WAKE_KIND.ROSTER, identity, session, atMs: now }];
    });
  }

  /**
   * Opens the turn a flush of the wake queue asks for. A generation not yet
   * loaded sends the wakes back to wait for it; a turn that sent nothing
   * because the model was quiet sends them back too, to open together once
   * the quiet ends.
   */
  #flush(events: readonly BrainWakeEvent[]): void {
    if (this.#seam.stopped()) return;
    const generation = this.#seam.generation();
    if (!generation) {
      void this.#seam.ready().then(() => this.#queue.requeue(events, 0));
      return;
    }
    void this.#seam.queueTurn(BRAIN_TURN_TRIGGER.WAKE, async () => {
      // The turn opens with the inbox as it stands, not the wakes that armed
      // the window: a capture that landed since rides along, and one a
      // failed turn left standing is tried again.
      const inbox = inboxEvents(generation.inbox);
      if (inbox.length === 0) return;
      const result = await this.#options.turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.WAKE,
        deliveries: new SteeredDeliveries(),
        events: inbox,
        open: (attached, now) => [wakeInputText(attached, now)],
      });
      if (
        result.outcome === TURN_OUTCOME.QUIET &&
        !this.#seam.stopped() &&
        generation === this.#seam.generation()
      ) {
        this.#queue.requeue(inbox, this.#queue.quietDelay(result.until));
      }
    });
  }
}

/**
 * A session the developer is speaking with first-hand wakes nothing: its turn
 * boundaries are the rhythm of a conversation being heard as it happens, and a
 * briefing read over them would talk over the very exchange it reports. Its
 * hooks and looks still read what the transcript gained, so the capture cursor
 * moves past the exchange, but they write no entry and open no turn — the text
 * is read past rather than read out, and the exchange ending never replays
 * what happened inside it. The session stays on the roster and in the standing
 * context throughout, because the developer may still ask about it.
 */
function developerSpeakingWith(session: Session): boolean {
  return session.realtimeVoiceLive === true;
}

/** A session as the roster showed it at a look, in the fields a change would move; never a transcript. */
function lookFingerprint(event: BrainWakeEvent): string {
  const session = event.session;
  return JSON.stringify(
    session
      ? [
          session.status,
          session.holdingForDeveloper === true,
          session.completionCause ?? null,
          session.lastActivityAt,
          session.detail.activity ?? null,
          session.detail.error ?? null,
        ]
      : null,
  );
}
