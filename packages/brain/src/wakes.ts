import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import {
  type ProviderTranscriptSinceResult,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionIdentity,
} from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { TranscriptCursors } from "./cursors.js";
import { BRAIN_DEFAULTS } from "./defaults.js";
import type { Generation } from "./generation.js";
import { heartbeatInputText, wakeInputText } from "./input-items.js";
import { NestedMap } from "./nested-map.js";
import {
  type BrainObservationEntry,
  entryFromEvent,
  entryMark,
  inboxEvents,
  sameObservation,
} from "./observation-inbox.js";
import type { BrainRoster } from "./performer.js";
import { sameIdentity } from "./records.js";
import type { AgentSeam } from "./seam.js";
import { SteeredDeliveries } from "./steered-deliveries.js";
import { readTranscriptDelta } from "./transcript-reads.js";
import { BRAIN_TURN_TRIGGER, TURN_OUTCOME, type TurnPlan, type TurnResult } from "./turn.js";
import { BRAIN_WAKE_KIND, type BrainTranscriptDelta, type BrainWakeEvent } from "./wake-events.js";
import { WakeQueue } from "./wake-queue.js";

/**
 * Which sessions a conversation's own roster look reads. It is a fact of the
 * conversation, fixed when its agent is built: an observed conversation names
 * its one session and can read no other's transcript, main's ordinary
 * conversation reads none on a look at all, and the whole local roster is
 * what a conversation with no host to narrow it reads.
 */
export const LOOK_SUBJECT = {
  ROSTER: "roster",
  NONE: "none",
  SESSION: "session",
} as const;

export type LookSubjectKind = (typeof LOOK_SUBJECT)[keyof typeof LOOK_SUBJECT];

export type LookSubject =
  | { readonly kind: typeof LOOK_SUBJECT.ROSTER }
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
  /** The review's retry, armed while the model is quiet and the scheduler's occurrence already taken. */
  #heartbeatRetry: ScheduledTimer | undefined;

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

  /** Drops every pending wake and the review's retry: the memory they described is gone. */
  clear(): void {
    this.#queue.clear();
    this.#cancelHeartbeatRetry();
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
   * The scheduled review: a turn under the full prompt whose instructions are
   * the workspace's HEARTBEAT.md, opened on no signal at all. Pending
   * observations ride along. The ordinary outcome is a turn that briefs
   * nothing. Settles when the turn this occurrence opened has, so the
   * scheduler's tick is over when the work it started is, and a review the
   * quiet postponed settles at once with its retry armed rather than holding
   * the tick open for as long as the quiet lasts.
   */
  heartbeat(): Promise<void> {
    if (this.#seam.stopped()) return Promise.resolve();
    const generation = this.#seam.generation();
    if (!generation) return this.#seam.ready().then(() => this.heartbeat());
    // The scheduler has recorded this occurrence as taken: a model that is
    // quiet now does not lose it, the review opens once the quiet ends.
    const quietUntil = this.#options.quietUntil();
    if (quietUntil !== undefined) {
      this.#retryHeartbeat(quietUntil);
      return Promise.resolve();
    }
    this.#cancelHeartbeatRetry();
    this.#queue.take();
    return this.#seam.queueTurn(BRAIN_TURN_TRIGGER.HEARTBEAT, async () => {
      const result = await this.#options.turn({
        generation,
        trigger: BRAIN_TURN_TRIGGER.HEARTBEAT,
        deliveries: new SteeredDeliveries(),
        events: inboxEvents(generation.inbox),
        open: (attached, now) => [
          ...(attached.length > 0 ? [wakeInputText(attached, now)] : []),
          heartbeatInputText(now),
        ],
      });
      if (result.outcome === TURN_OUTCOME.QUIET && generation === this.#seam.generation()) {
        this.#retryHeartbeat(result.until);
      }
    });
  }

  /**
   * One look at the whole roster, driven by the host's observation pass rather
   * than an internal timer. Carries the roster as `list_sessions` renders it
   * and, for every local session the brain has read before or that is working
   * or waiting now, what its transcript gained since — sessions with nothing
   * new are left out. Skipped while a turn is in flight or the model is
   * quiet, because the next look reads the same deltas; pending hook wakes
   * ride along rather than waiting for their own.
   */
  rosterLook(): Promise<void> {
    if (this.#seam.stopped()) return Promise.resolve();
    const generation = this.#seam.generation();
    if (!generation) return this.#seam.ready().then(() => this.rosterLook());
    const roster = this.#options.roster();
    const looks = this.#ownLooks(roster, generation.captureCursors, this.#seam.now());
    // The look is captured before anything opens, like a hook: what each
    // session gained stands in the inbox with its cursor, and the turn that
    // follows — now, or the next one if the model is quiet or a turn is in
    // flight — consumes it from there.
    return this.#capture(looks).then((captured) => {
      if (this.#seam.stopped() || this.#options.turnInFlight()) return;
      if (generation !== this.#seam.generation()) return;
      if (this.#options.quietUntil() !== undefined) return;
      // A conversation looking at everything still opens its look with no
      // events, as the scheduled roster look it is; one looking at its own
      // session opens nothing when nothing was captured and nothing waits.
      if (
        this.#subject.kind !== LOOK_SUBJECT.ROSTER &&
        captured === 0 &&
        generation.inbox.length === 0
      ) {
        return;
      }
      this.#queue.take();
      void this.#seam.queueTurn(BRAIN_TURN_TRIGGER.ROSTER, () =>
        this.#options.turn({
          generation,
          trigger: BRAIN_TURN_TRIGGER.ROSTER,
          deliveries: new SteeredDeliveries(),
          events: inboxEvents(generation.inbox),
          open: (attached, openedAt) => [wakeInputText(attached, openedAt, roster.text)],
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
   * session standing exactly as it last stood is not captured at all. What
   * remains is written with the advanced capture cursors in one save, and a
   * save the store refuses moves no cursor in memory either. Answers how many
   * entries were captured.
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
      const now = this.#seam.now();
      for (const event of fresh) {
        let read = reads.get(event.identity.providerId, event.identity.providerSessionId);
        if (!read) {
          const delta = await readTranscriptDelta(event.identity, {
            cursors: generation.captureCursors,
            read: (identity, cursor) => this.#options.readTranscriptSince(identity, cursor),
            signal: generation.abort.signal,
            maximumChars: BRAIN_DEFAULTS.DELTA_PER_SESSION_CHARS,
          });
          if (!delta) {
            generation.captureCursors.rollback(mark);
            return 0;
          }
          read = { delta, cursor: generation.captureCursors.cursor(event.identity) };
          reads.set(event.identity.providerId, event.identity.providerSessionId, read);
        } else {
          // A second event for the same session in one batch carries no
          // second delta: the first read covers both.
          read = {
            delta: {
              text: "",
              truncated: false,
              status: read.delta?.status ?? ACT_RESULT_STATUS.ACCEPTED,
            },
            cursor: read.cursor,
          };
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
      if (entries.length === 0) {
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
   * The sessions this conversation's own look reads, by its subject: its one
   * observed session, every local session it has read before or that is live
   * now, or nothing at all. A session another conversation observes is never
   * among them, whatever the roster holds.
   */
  #ownLooks(
    roster: BrainRoster,
    cursors: TranscriptCursors,
    now: number,
  ): readonly BrainWakeEvent[] {
    const subject = this.#subject;
    if (subject.kind === LOOK_SUBJECT.NONE) return [];
    return (roster.sessions ?? []).flatMap((session) => {
      const identity: SessionIdentity = {
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      };
      if (subject.kind === LOOK_SUBJECT.SESSION && !sameIdentity(subject.identity, identity)) {
        return [];
      }
      const readBefore = cursors.cursor(identity) !== undefined;
      const live =
        session.status === SESSION_STATUS.WORKING || session.status === SESSION_STATUS.WAITING;
      if (session.location !== SESSION_LOCATION.LOCAL || !(readBefore || live)) return [];
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

  /** Arms one retry of the review for when the quiet ends; a retry already armed stands. */
  #retryHeartbeat(until: number): void {
    if (this.#seam.stopped() || this.#heartbeatRetry !== undefined) return;
    this.#heartbeatRetry = this.#seam.schedule(() => {
      this.#heartbeatRetry = undefined;
      void this.heartbeat();
    }, this.#queue.quietDelay(until));
  }

  #cancelHeartbeatRetry(): void {
    if (this.#heartbeatRetry === undefined) return;
    this.#seam.cancel(this.#heartbeatRetry);
    this.#heartbeatRetry = undefined;
  }
}

/** A session as the roster showed it at a look, in the fields a change would move; never a transcript. */
function lookFingerprint(event: BrainWakeEvent): string {
  const session = event.session;
  return JSON.stringify(
    session
      ? [
          session.status,
          session.lastActivityAt,
          session.detail.activity ?? null,
          session.detail.error ?? null,
        ]
      : null,
  );
}
