import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarOnboardingOwed,
  calendarOnboardingRecord,
  calendarOnboardingStateFromStored,
  shouldBackfillCalendarOnboardingSettled,
} from "./calendar-onboarding-flow";

const REQUIRED_AT = "2026-08-24T00:00:00.000Z";
const LATER = "2026-08-24T00:05:00.000Z";

test("the gate is owed from an observed sign-in until a calendar settles it", () => {
  assert.equal(calendarOnboardingOwed({ requiredAt: REQUIRED_AT }), true);
  assert.equal(calendarOnboardingOwed({ requiredAt: REQUIRED_AT, settledAt: LATER }), false);
});

test("no record, and a backfilled record, owe no gate", () => {
  assert.equal(calendarOnboardingOwed(undefined), false);
  assert.equal(calendarOnboardingOwed({ settledAt: LATER }), false);
  assert.equal(calendarOnboardingOwed({}), false);
});

test("a signed-in launch with no record backfills a settled one", () => {
  assert.equal(
    shouldBackfillCalendarOnboardingSettled({
      requiresAccount: true,
      signedIn: true,
      hasRecord: false,
    }),
    true,
  );
  assert.equal(
    shouldBackfillCalendarOnboardingSettled({
      requiresAccount: true,
      signedIn: true,
      hasRecord: true,
    }),
    false,
  );
  assert.equal(
    shouldBackfillCalendarOnboardingSettled({
      requiresAccount: true,
      signedIn: false,
      hasRecord: false,
    }),
    false,
  );
  assert.equal(
    shouldBackfillCalendarOnboardingSettled({
      requiresAccount: false,
      signedIn: true,
      hasRecord: false,
    }),
    false,
  );
});

test("the record round-trips, and anything unreadable reads as no record", () => {
  const state = { requiredAt: REQUIRED_AT, settledAt: LATER };
  assert.deepEqual(calendarOnboardingStateFromStored(calendarOnboardingRecord(state)), state);
  assert.deepEqual(calendarOnboardingStateFromStored(calendarOnboardingRecord({})), {});
  assert.equal(calendarOnboardingStateFromStored(undefined), undefined);
  assert.equal(calendarOnboardingStateFromStored("not json"), undefined);
  assert.equal(calendarOnboardingStateFromStored("[]"), undefined);
});

test("a field that is not text is left off rather than kept as prose", () => {
  assert.deepEqual(
    calendarOnboardingStateFromStored(`{"requiredAt": 7, "settledAt": "${LATER}"}`),
    { settledAt: LATER },
  );
});
