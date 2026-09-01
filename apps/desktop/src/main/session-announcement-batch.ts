import type { SessionAnnouncement } from "@sidecar/realtime";
import {
  MAXIMUM_HELD_NOTICES,
  type Session,
  type SessionIdentity,
  type SessionNotice,
  type SessionStatus,
} from "@sidecar/session";

export const SESSION_ANNOUNCEMENT_BATCH_WINDOW_MS = 5_000;

export type PendingSessionAnnouncement =
  | {
      source: "notice";
      announcement: SessionAnnouncement;
      notice: SessionNotice;
    }
  | {
      source: "review";
      announcement: SessionAnnouncement;
      observedStatus: SessionStatus;
      observedAt: number;
    };

type Timer = ReturnType<typeof setTimeout>;
type Schedule = (callback: () => void, delayMs: number) => Timer;
type Cancel = (timer: Timer) => void;

/** Collects one fixed window of session news without extending it for stragglers. */
export class SessionAnnouncementBatch {
  #pending: PendingSessionAnnouncement[] = [];
  readonly #deliver: (announcements: readonly PendingSessionAnnouncement[]) => void;
  readonly #schedule: Schedule;
  readonly #cancel: Cancel;
  #timer: Timer | undefined;

  constructor(
    deliver: (announcements: readonly PendingSessionAnnouncement[]) => void,
    schedule: Schedule = (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: Cancel = (timer) => clearTimeout(timer),
  ) {
    this.#deliver = deliver;
    this.#schedule = schedule;
    this.#cancel = cancel;
  }

  enqueue(announcements: readonly PendingSessionAnnouncement[]): void {
    if (announcements.length === 0) return;
    for (const announcement of announcements) {
      const at = this.#pending.findIndex(
        (pending) =>
          pending.announcement.providerId === announcement.announcement.providerId &&
          pending.announcement.providerSessionId === announcement.announcement.providerSessionId,
      );
      const pending = this.#pending[at];
      // A model-reviewed update may refine a deterministic notice, but it may
      // never replace one. The fixed status edge is the guaranteed alert.
      if (pending?.source === "notice" && announcement.source === "review") continue;
      if (at !== -1) this.#pending.splice(at, 1);
      this.#pending.push(announcement);
    }
    this.#pending = this.#pending.slice(-MAXIMUM_HELD_NOTICES);
    if (this.#timer !== undefined) return;
    this.#timer = this.#schedule(() => {
      this.#timer = undefined;
      this.#deliver(this.#release());
    }, SESSION_ANNOUNCEMENT_BATCH_WINDOW_MS);
    this.#timer.unref?.();
  }

  clear(): void {
    if (this.#timer !== undefined) this.#cancel(this.#timer);
    this.#timer = undefined;
    this.#release();
  }

  #release(): readonly PendingSessionAnnouncement[] {
    const pending = this.#pending;
    this.#pending = [];
    return pending;
  }
}

/** Drops news the observed session has already moved past during the window. */
export function currentSessionAnnouncements(
  pending: readonly PendingSessionAnnouncement[],
  currentSession: (identity: SessionIdentity) => Session | undefined,
): readonly PendingSessionAnnouncement[] {
  return pending.filter((item) => {
    const current = currentSession(item.announcement);
    if (item.source === "notice") {
      return current === undefined || current.status === item.notice.status;
    }
    return (
      current !== undefined &&
      current.status === item.observedStatus &&
      current.observedAt === item.observedAt
    );
  });
}

/** Restores each source to the hold whose release semantics it already owns. */
export function heldSessionAnnouncements(pending: readonly PendingSessionAnnouncement[]) {
  return {
    notices: pending.flatMap((item) => (item.source === "notice" ? [item.notice] : [])),
    reviews: pending.flatMap((item) => (item.source === "review" ? [item.announcement] : [])),
  };
}
