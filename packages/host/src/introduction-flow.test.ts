import assert from "node:assert/strict";
import { test } from "vitest";
import { introductionOwed } from "./introduction-flow.js";

const SIGNED_IN_AT = "2026-08-24T00:00:00.000Z";
const LATER = "2026-08-24T00:05:00.000Z";

test("the introduction is owed from the first observed sign-in until a completion", () => {
  assert.equal(introductionOwed({ introductionRequiredAt: SIGNED_IN_AT }), true);
  assert.equal(
    introductionOwed({ introductionRequiredAt: SIGNED_IN_AT, introductionCompletedAt: LATER }),
    false,
  );
});

test("an install with no recorded edge is never owed one, whatever else it remembers", () => {
  assert.equal(introductionOwed(undefined), false);
  assert.equal(introductionOwed({}), false);
  // Signed in before the edge existed: an upgrade greets nobody as a stranger.
  assert.equal(
    introductionOwed({
      arrivalSignedInAt: SIGNED_IN_AT,
      calendarOnboardingRequiredAt: SIGNED_IN_AT,
    }),
    false,
  );
  // A completion from the accountless introduction of an earlier build stands.
  assert.equal(introductionOwed({ introductionCompletedAt: SIGNED_IN_AT }), false);
});
