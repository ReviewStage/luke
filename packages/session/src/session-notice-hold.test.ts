import assert from "node:assert/strict";
import test from "node:test";
import {
  MAXIMUM_HELD_NOTICES,
  SESSION_NOTICE_STATUS,
  SESSION_STATUS,
  type SessionNotice,
  SessionNoticeHold,
} from "@sidecar/session";

function notice(
  providerSessionId: string,
  status: SessionNotice["status"],
  providerId = "conductor",
): SessionNotice {
  return {
    providerId,
    providerSessionId,
    providerName: "Conductor",
    title: `Session ${providerSessionId}`,
    status,
    previousStatus: SESSION_STATUS.WORKING,
    canReceiveMessage: false,
    observedAt: 100,
  };
}

test("holds nothing until asked, and releases everything once", () => {
  const hold = new SessionNoticeHold();
  assert.equal(hold.count, 0);
  assert.deepEqual(hold.release(), []);

  hold.hold([notice("a", SESSION_NOTICE_STATUS.WAITING)]);
  hold.hold([notice("b", SESSION_NOTICE_STATUS.COMPLETE)]);
  assert.equal(hold.count, 2);

  const released = hold.release();
  assert.deepEqual(
    released.map((item) => item.providerSessionId),
    ["a", "b"],
  );
  // Releasing empties the hold; nothing is read out twice.
  assert.equal(hold.count, 0);
  assert.deepEqual(hold.release(), []);
});

test("a session that moved again keeps only its latest notice", () => {
  const hold = new SessionNoticeHold();
  hold.hold([notice("a", SESSION_NOTICE_STATUS.WAITING)]);
  hold.hold([notice("b", SESSION_NOTICE_STATUS.WAITING)]);
  // The waiting session finished while the meeting ran on.
  hold.hold([notice("a", SESSION_NOTICE_STATUS.COMPLETE)]);

  const released = hold.release();
  assert.deepEqual(
    released.map((item) => [item.providerSessionId, item.status]),
    [
      ["b", SESSION_NOTICE_STATUS.WAITING],
      ["a", SESSION_NOTICE_STATUS.COMPLETE],
    ],
  );
});

test("the same session id under another provider is another session", () => {
  const hold = new SessionNoticeHold();
  hold.hold([notice("a", SESSION_NOTICE_STATUS.WAITING, "conductor")]);
  hold.hold([notice("a", SESSION_NOTICE_STATUS.ERROR, "devin")]);

  assert.equal(hold.count, 2);
});

test("already-worded speech holds on the same terms as a notice", () => {
  // The announcer-bound speech an answered ask produces waits out a meeting
  // exactly as a status edge does; the hold only needs to know the session.
  const hold = new SessionNoticeHold<{
    providerId: string;
    providerSessionId: string;
    summary: string;
  }>();
  hold.hold([{ providerId: "conductor", providerSessionId: "a", summary: "first answer" }]);
  hold.hold([{ providerId: "conductor", providerSessionId: "a", summary: "fresher answer" }]);
  hold.hold([{ providerId: "devin", providerSessionId: "a", summary: "another session's" }]);

  assert.deepEqual(
    hold.release().map((item) => item.summary),
    ["fresher answer", "another session's"],
  );
});

test("the backlog is bounded, shedding the oldest first", () => {
  const hold = new SessionNoticeHold();
  for (let index = 0; index < MAXIMUM_HELD_NOTICES + 3; index += 1) {
    hold.hold([notice(`session-${index}`, SESSION_NOTICE_STATUS.COMPLETE)]);
  }

  assert.equal(hold.count, MAXIMUM_HELD_NOTICES);
  const released = hold.release();
  assert.equal(released[0]?.providerSessionId, "session-3");
  assert.equal(released.at(-1)?.providerSessionId, `session-${MAXIMUM_HELD_NOTICES + 2}`);
});
