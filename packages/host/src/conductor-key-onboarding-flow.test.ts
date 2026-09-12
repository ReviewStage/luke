import assert from "node:assert/strict";
import { test } from "vitest";
import { conductorKeyOnboardingOwed } from "./conductor-key-onboarding-flow.js";

const SIGNED_IN_AT = "2026-08-24T00:00:00.000Z";
const LATER = "2026-08-24T00:05:00.000Z";

test("the key step is owed from the first observed sign-in until the vault holds a key or the skip declines", () => {
  assert.equal(
    conductorKeyOnboardingOwed({ conductorKeyOnboardingRequiredAt: SIGNED_IN_AT }),
    true,
  );
  assert.equal(
    conductorKeyOnboardingOwed({
      conductorKeyOnboardingRequiredAt: SIGNED_IN_AT,
      conductorKeyOnboardingSettledAt: LATER,
    }),
    false,
  );
  assert.equal(
    conductorKeyOnboardingOwed({
      conductorKeyOnboardingRequiredAt: SIGNED_IN_AT,
      conductorKeyOnboardingSkippedAt: LATER,
    }),
    false,
  );
});

test("an install with no recorded edge owes no key step, whatever else it remembers", () => {
  assert.equal(conductorKeyOnboardingOwed(undefined), false);
  assert.equal(conductorKeyOnboardingOwed({}), false);
  assert.equal(
    conductorKeyOnboardingOwed({
      arrivalSignedInAt: SIGNED_IN_AT,
      calendarOnboardingRequiredAt: SIGNED_IN_AT,
    }),
    false,
  );
});
