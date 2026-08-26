import assert from "node:assert/strict";
import test from "node:test";
import {
  arrivalBeatOwed,
  arrivalRecord,
  arrivalStateFromStored,
  countsFirstAnnouncement,
  shouldBackfillArrivalSettled,
} from "./arrival-flow";

const SIGNED_IN_AT = "2026-08-24T00:00:00.000Z";
const LATER = "2026-08-24T00:05:00.000Z";

test("the beat is owed from an observed sign-in until it is handed to the voice", () => {
  assert.equal(arrivalBeatOwed({ signedInAt: SIGNED_IN_AT }), true);
  assert.equal(arrivalBeatOwed({ signedInAt: SIGNED_IN_AT, settledAt: LATER }), false);
  // The first announcement is its own count; only the hand-off settles the beat.
  assert.equal(arrivalBeatOwed({ signedInAt: SIGNED_IN_AT, firstAnnouncementAt: LATER }), true);
});

test("no record, and a backfilled record, owe no beat", () => {
  assert.equal(arrivalBeatOwed(undefined), false);
  assert.equal(arrivalBeatOwed({ settledAt: LATER }), false);
});

test("the first announcement counts once, and only against an observed sign-in", () => {
  assert.equal(countsFirstAnnouncement({ signedInAt: SIGNED_IN_AT }), true);
  // The beat being spoken is not the loop proving itself: the count still runs.
  assert.equal(countsFirstAnnouncement({ signedInAt: SIGNED_IN_AT, settledAt: LATER }), true);
  assert.equal(
    countsFirstAnnouncement({ signedInAt: SIGNED_IN_AT, firstAnnouncementAt: LATER }),
    false,
  );
  assert.equal(countsFirstAnnouncement(undefined), false);
  assert.equal(countsFirstAnnouncement({ settledAt: LATER }), false);
});

test("a signed-in launch with no record backfills a settled one", () => {
  assert.equal(
    shouldBackfillArrivalSettled({ requiresAccount: true, signedIn: true, hasRecord: false }),
    true,
  );
  assert.equal(
    shouldBackfillArrivalSettled({ requiresAccount: true, signedIn: true, hasRecord: true }),
    false,
  );
  assert.equal(
    shouldBackfillArrivalSettled({ requiresAccount: true, signedIn: false, hasRecord: false }),
    false,
  );
  assert.equal(
    shouldBackfillArrivalSettled({ requiresAccount: false, signedIn: true, hasRecord: false }),
    false,
  );
});

test("the record round-trips, and anything unreadable reads as no record", () => {
  const state = { signedInAt: SIGNED_IN_AT, settledAt: LATER };
  assert.deepEqual(arrivalStateFromStored(arrivalRecord(state)), state);
  assert.deepEqual(arrivalStateFromStored(arrivalRecord({})), {});
  assert.equal(arrivalStateFromStored(undefined), undefined);
  assert.equal(arrivalStateFromStored("not json"), undefined);
  assert.equal(arrivalStateFromStored("[]"), undefined);
});

test("a field that is not text is left off rather than kept as prose", () => {
  assert.deepEqual(arrivalStateFromStored(`{"signedInAt": 7, "settledAt": "${LATER}"}`), {
    settledAt: LATER,
  });
});
