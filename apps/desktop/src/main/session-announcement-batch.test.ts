import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ANNOUNCEMENT_CHANGE } from "@sidecar/realtime";
import {
  MAXIMUM_HELD_NOTICES,
  normalizeSession,
  SESSION_NOTICE_STATUS,
  SESSION_STATUS,
} from "@sidecar/session";
import {
  currentSessionAnnouncements,
  heldSessionAnnouncements,
  type PendingSessionAnnouncement,
  SESSION_ANNOUNCEMENT_BATCH_WINDOW_MS,
  SessionAnnouncementBatch,
} from "./session-announcement-batch";

function announcement(id: string, work = id): PendingSessionAnnouncement {
  return {
    announcement: {
      providerId: "conductor",
      providerSessionId: id,
      work,
      change: SESSION_ANNOUNCEMENT_CHANGE.NEEDS_INPUT,
      detail: "Approve the command?",
      decidedAt: 1_000,
    },
    source: "notice",
    notice: {
      providerId: "conductor",
      providerSessionId: id,
      providerName: "Conductor",
      title: work,
      status: SESSION_NOTICE_STATUS.WAITING,
      previousStatus: SESSION_STATUS.WORKING,
      holdingForDeveloper: true,
      canReceiveMessage: true,
      observedAt: 1_000,
    },
  };
}

function reviewed(id: string, observedAt = 1_000): PendingSessionAnnouncement {
  return {
    announcement: {
      providerId: "conductor",
      providerSessionId: id,
      work: id,
      change: SESSION_ANNOUNCEMENT_CHANGE.FINISHED,
      decidedAt: observedAt,
    },
    source: "review",
    observedStatus: SESSION_STATUS.COMPLETE,
    observedAt,
  };
}

test("collects one fixed window, coalesces by session, and clears pending work", () => {
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  const delays: number[] = [];
  const delivered: (readonly PendingSessionAnnouncement[])[] = [];
  const batch = new SessionAnnouncementBatch(
    (announcements) => delivered.push(announcements),
    (callback, delayMs) => {
      const timer = setTimeout(() => {}, delayMs);
      clearTimeout(timer);
      timers.set(timer, callback);
      delays.push(delayMs);
      return timer;
    },
    (timer) => {
      timers.delete(timer);
    },
  );

  batch.enqueue([announcement("a", "first")]);
  batch.enqueue([announcement("b"), announcement("a", "newest")]);
  // The evaluator cannot replace the deterministic alert for the same edge.
  batch.enqueue([reviewed("a")]);
  assert.deepEqual(delays, [SESSION_ANNOUNCEMENT_BATCH_WINDOW_MS]);

  for (const [timer, callback] of timers) {
    timers.delete(timer);
    callback();
  }
  assert.deepEqual(
    delivered[0]?.map(({ source, announcement }) => [
      announcement.providerSessionId,
      source,
      announcement.work,
    ]),
    [
      ["b", "notice", "b"],
      ["a", "notice", "newest"],
    ],
  );

  batch.enqueue(
    Array.from({ length: MAXIMUM_HELD_NOTICES + 2 }, (_, index) =>
      announcement(`session-${index}`),
    ),
  );
  for (const [timer, callback] of timers) {
    timers.delete(timer);
    callback();
  }
  assert.deepEqual(
    delivered[1]?.map(({ announcement }) => announcement.providerSessionId),
    Array.from({ length: MAXIMUM_HELD_NOTICES }, (_, index) => `session-${index + 2}`),
  );

  batch.enqueue([announcement("cleared")]);
  batch.clear();
  assert.equal(timers.size, 0);
  assert.equal(delivered.length, 2);
});

test("revalidates queued state and restores mixed sources to their meeting holds", () => {
  const notice = announcement("waiting");
  const review = reviewed("finished");
  const changedReview = reviewed("changed", 900);
  const sessions = [
    normalizeSession(
      { id: "conductor", displayName: "Conductor" },
      {
        providerSessionId: "waiting",
        title: "waiting",
        status: SESSION_STATUS.WAITING,
        observedAt: 1_000,
      },
    ),
    normalizeSession(
      { id: "conductor", displayName: "Conductor" },
      {
        providerSessionId: "finished",
        title: "finished",
        status: SESSION_STATUS.COMPLETE,
        observedAt: 1_000,
      },
    ),
    normalizeSession(
      { id: "conductor", displayName: "Conductor" },
      {
        providerSessionId: "changed",
        title: "changed",
        status: SESSION_STATUS.WORKING,
        observedAt: 1_000,
      },
    ),
  ];

  const current = currentSessionAnnouncements([notice, review, changedReview], (identity) =>
    sessions.find(
      (session) =>
        session.providerId === identity.providerId &&
        session.providerSessionId === identity.providerSessionId,
    ),
  );
  assert.deepEqual(
    current.map(({ announcement }) => announcement.providerSessionId),
    ["waiting", "finished"],
  );

  const held = heldSessionAnnouncements(current);
  assert.equal(notice.source, "notice");
  if (notice.source !== "notice") assert.fail("fixture must be a notice");
  assert.deepEqual(held.notices, [notice.notice]);
  assert.deepEqual(held.reviews, [review.announcement]);
});
