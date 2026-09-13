import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { type Context, Effect } from "effect";
import type * as FileSystem from "effect/FileSystem";
import { test } from "vitest";
import { arrivalBeatOwed, countsFirstAnnouncement } from "./arrival-flow.js";
import { calendarOnboardingOwed } from "./calendar-onboarding-flow.js";
import { introductionOwed } from "./introduction-flow.js";
import {
  ONBOARDING_STATE_FILE,
  type OnboardingStateRecord,
  onboardingStateRecord,
} from "./onboarding-state.js";

const SIGNED_IN_AT = "2026-08-24T00:00:00.000Z";
const LATER = "2026-08-24T00:05:00.000Z";

const MOMENTS = {
  introductionRequiredAt: SIGNED_IN_AT,
  introductionCompletedAt: SIGNED_IN_AT,
  conductorKeyOnboardingRequiredAt: SIGNED_IN_AT,
  conductorKeyOnboardingSettledAt: LATER,
  conductorKeyOnboardingSkippedAt: LATER,
  arrivalSignedInAt: SIGNED_IN_AT,
  arrivalSpokenAt: LATER,
  arrivalFirstAnnouncementAt: LATER,
  calendarOnboardingRequiredAt: SIGNED_IN_AT,
  calendarOnboardingSettledAt: LATER,
  calendarOnboardingSkippedAt: LATER,
};

/** The record over a throwaway state root, with the platform's own file system beneath it. */
const withRecord = (
  run: (
    record: OnboardingStateRecord,
    stateRoot: string,
    fileSystem: Context.Context<FileSystem.FileSystem>,
  ) => Effect.Effect<void>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped();
      const fileSystem = yield* Effect.context<FileSystem.FileSystem>();
      yield* run(
        onboardingStateRecord(stateRoot, () => {}, fileSystem),
        stateRoot,
        fileSystem,
      );
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer));

it.effect("the record round-trips every moment, and anything unreadable reads as no record", () =>
  withRecord((record, stateRoot) =>
    Effect.gen(function* () {
      assert.equal(yield* record.read, undefined);
      yield* record.update(() => MOMENTS);
      assert.deepEqual(yield* record.read, MOMENTS);

      const stored = path.join(stateRoot, ONBOARDING_STATE_FILE);
      for (const text of ["{", "[]", "7", '"words"']) {
        fs.writeFileSync(stored, text);
        assert.equal(yield* record.read, undefined, text);
      }
      fs.rmSync(stored);
      assert.equal(yield* record.read, undefined);
      // A directory where the record should be is unreadable, not a record.
      fs.mkdirSync(stored);
      assert.equal(yield* record.read, undefined);
    }),
  ),
);

it.effect("a field that is not text is a record this build cannot read, not a partial one", () =>
  withRecord((record, stateRoot) =>
    Effect.gen(function* () {
      fs.writeFileSync(
        path.join(stateRoot, ONBOARDING_STATE_FILE),
        JSON.stringify({
          arrivalSignedInAt: 7,
          calendarOnboardingSkippedAt: {},
          arrivalSpokenAt: LATER,
        }),
      );
      assert.equal(yield* record.read, undefined);
    }),
  ),
);

it.effect("a record with no moment at all reads as no record", () =>
  withRecord((record, stateRoot) =>
    Effect.gen(function* () {
      fs.writeFileSync(
        path.join(stateRoot, ONBOARDING_STATE_FILE),
        JSON.stringify({ other: "value" }),
      );
      assert.equal(yield* record.read, undefined);
    }),
  ),
);

it.effect("a write that cannot land is reported, and still answers the mutated record", () => {
  const reported: string[] = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped();
      const fileSystem = yield* Effect.context<FileSystem.FileSystem>();
      const record = onboardingStateRecord(
        path.join(stateRoot, "absent", "deeper"),
        (message) => reported.push(message),
        fileSystem,
      );
      assert.deepEqual(yield* record.update(() => ({ arrivalSignedInAt: SIGNED_IN_AT })), {
        arrivalSignedInAt: SIGNED_IN_AT,
      });
      assert.equal(reported.length, 1);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer));
});

it.effect("an update merges over the record on disk, not over an older read", () =>
  withRecord((record, stateRoot, fileSystem) =>
    Effect.gen(function* () {
      const other = onboardingStateRecord(stateRoot, () => {}, fileSystem);
      yield* record.update(() => ({ arrivalSignedInAt: SIGNED_IN_AT }));
      // The desktop process finishes the introduction while the Gateway holds an
      // older read; neither writer may drop the other's moment.
      yield* other.update((current) => ({ ...current, introductionCompletedAt: LATER }));
      assert.deepEqual(
        yield* record.update((current) => ({ ...current, arrivalSpokenAt: LATER })),
        {
          arrivalSignedInAt: SIGNED_IN_AT,
          introductionCompletedAt: LATER,
          arrivalSpokenAt: LATER,
        },
      );
      assert.deepEqual(yield* other.read, {
        introductionCompletedAt: LATER,
        arrivalSignedInAt: SIGNED_IN_AT,
        arrivalSpokenAt: LATER,
      });
    }),
  ),
);

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

test("the introduction's own moments round-trip beside the beats', and decide it alone", () => {
  assert.equal(introductionOwed(MOMENTS), false);
  const { introductionCompletedAt: _completed, ...uncompleted } = MOMENTS;
  assert.equal(introductionOwed(uncompleted), true);
});
