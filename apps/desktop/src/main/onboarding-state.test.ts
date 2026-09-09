import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { arrivalBeatOwed, countsFirstAnnouncement } from "./arrival-flow";
import { calendarOnboardingOwed } from "./calendar-onboarding-flow";
import { shouldRunIntroduction } from "./introduction-flow";
import { ONBOARDING_STATE_FILE, onboardingStateFile } from "./onboarding-state";

const SIGNED_IN_AT = "2026-08-24T00:00:00.000Z";
const LATER = "2026-08-24T00:05:00.000Z";

function fileIn(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-onboarding-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, file: onboardingStateFile(() => root) };
}

const MOMENTS = {
  introductionCompletedAt: SIGNED_IN_AT,
  arrivalSignedInAt: SIGNED_IN_AT,
  arrivalSpokenAt: LATER,
  arrivalFirstAnnouncementAt: LATER,
  calendarOnboardingRequiredAt: SIGNED_IN_AT,
  calendarOnboardingSettledAt: LATER,
  calendarOnboardingSkippedAt: LATER,
};

test("the record round-trips every moment, and anything unreadable reads as no record", (t) => {
  const { root, file } = fileIn(t);
  assert.equal(file.read(), undefined);
  file.update(() => MOMENTS);
  assert.deepEqual(file.read(), MOMENTS);

  const stored = path.join(root, ONBOARDING_STATE_FILE);
  for (const text of ["{", "[]", "7", '"words"']) {
    fs.writeFileSync(stored, text);
    assert.equal(file.read(), undefined, text);
  }
  fs.rmSync(stored);
  assert.equal(file.read(), undefined);
  // A directory where the record should be is unreadable, not a record.
  fs.mkdirSync(stored);
  assert.equal(file.read(), undefined);
});

test("a field that is not text is left off rather than kept as prose", (t) => {
  const { root, file } = fileIn(t);
  fs.writeFileSync(
    path.join(root, ONBOARDING_STATE_FILE),
    JSON.stringify({
      arrivalSignedInAt: 7,
      calendarOnboardingSkippedAt: {},
      arrivalSpokenAt: LATER,
    }),
  );
  assert.deepEqual(file.read(), { arrivalSpokenAt: LATER });
});

test("a record with no moment at all reads as no record", (t) => {
  const { root, file } = fileIn(t);
  fs.writeFileSync(path.join(root, ONBOARDING_STATE_FILE), JSON.stringify({ other: "value" }));
  assert.equal(file.read(), undefined);
});

test("a write that cannot land is reported, not thrown", () => {
  const reported: string[] = [];
  const file = onboardingStateFile(
    () => path.join(os.tmpdir(), "luke-onboarding-absent", "deeper"),
    (message) => reported.push(message),
  );
  assert.deepEqual(
    file.update(() => ({ arrivalSignedInAt: SIGNED_IN_AT })),
    {
      arrivalSignedInAt: SIGNED_IN_AT,
    },
  );
  assert.equal(reported.length, 1);
  assert.match(reported[0] ?? "", /onboarding\.json/);
});

test("an update merges over the record on disk, not over an older read", (t) => {
  const { root, file } = fileIn(t);
  const other = onboardingStateFile(() => root);
  file.update(() => ({ arrivalSignedInAt: SIGNED_IN_AT }));
  // The desktop process finishes the introduction while the Gateway holds an
  // older read; neither writer may drop the other's moment.
  other.update((current) => ({ ...current, introductionCompletedAt: LATER }));
  assert.deepEqual(
    file.update((current) => ({ ...current, arrivalSpokenAt: LATER })),
    {
      arrivalSignedInAt: SIGNED_IN_AT,
      introductionCompletedAt: LATER,
      arrivalSpokenAt: LATER,
    },
  );
  assert.deepEqual(other.read(), {
    introductionCompletedAt: LATER,
    arrivalSignedInAt: SIGNED_IN_AT,
    arrivalSpokenAt: LATER,
  });
});

test("the arrival beat is owed from an observed sign-in until its reply begins", () => {
  assert.equal(arrivalBeatOwed({ arrivalSignedInAt: SIGNED_IN_AT }), true);
  assert.equal(arrivalBeatOwed({ arrivalSignedInAt: SIGNED_IN_AT, arrivalSpokenAt: LATER }), false);
  // The first announcement is its own count; only the spoken beat settles it.
  assert.equal(
    arrivalBeatOwed({ arrivalSignedInAt: SIGNED_IN_AT, arrivalFirstAnnouncementAt: LATER }),
    true,
  );
  assert.equal(arrivalBeatOwed(undefined), false);
  assert.equal(arrivalBeatOwed({ arrivalSpokenAt: LATER }), false);
});

test("the first announcement counts once, and only against an observed sign-in", () => {
  assert.equal(countsFirstAnnouncement({ arrivalSignedInAt: SIGNED_IN_AT }), true);
  // The beat being spoken is not the loop proving itself: the count still runs.
  assert.equal(
    countsFirstAnnouncement({ arrivalSignedInAt: SIGNED_IN_AT, arrivalSpokenAt: LATER }),
    true,
  );
  assert.equal(
    countsFirstAnnouncement({
      arrivalSignedInAt: SIGNED_IN_AT,
      arrivalFirstAnnouncementAt: LATER,
    }),
    false,
  );
  assert.equal(countsFirstAnnouncement(undefined), false);
  assert.equal(countsFirstAnnouncement({ arrivalFirstAnnouncementAt: LATER }), false);
});

test("the calendar gate is owed until a Done or a decline answers it", () => {
  assert.equal(calendarOnboardingOwed({ calendarOnboardingRequiredAt: SIGNED_IN_AT }), true);
  assert.equal(
    calendarOnboardingOwed({
      calendarOnboardingRequiredAt: SIGNED_IN_AT,
      calendarOnboardingSettledAt: LATER,
    }),
    false,
  );
  // A decline stands the gate down for good, exactly as a settle does.
  assert.equal(
    calendarOnboardingOwed({
      calendarOnboardingRequiredAt: SIGNED_IN_AT,
      calendarOnboardingSkippedAt: LATER,
    }),
    false,
  );
  assert.equal(calendarOnboardingOwed(undefined), false);
  assert.equal(calendarOnboardingOwed({ calendarOnboardingSettledAt: LATER }), false);
});

test("the introduction plays only on an interactive launch with no account and no completion", () => {
  for (const [requiresAccount, signedIn, completed, expected] of [
    [true, false, false, true],
    [true, true, false, false],
    [false, false, false, false],
    [true, false, true, false],
  ] as const) {
    assert.equal(
      shouldRunIntroduction({ requiresAccount, signedIn, completed }),
      expected,
      `${requiresAccount} ${signedIn} ${completed}`,
    );
  }
});
