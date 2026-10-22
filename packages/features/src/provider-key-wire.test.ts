/**
 * provider-key-wire.test.ts -- where a plan stands at a moment: a reached limit lifts once its named reset passes, one with no reset named stands, and a launch is refused only until a named reset.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import { PROVIDER_KEY_STATUS, planLimitResetsAt, planStanding } from "./provider-key-wire.js";

const RESETS_AT = Date.UTC(2026, 9, 22, 9);
const BEFORE = RESETS_AT - 60_000;
const AFTER = RESETS_AT + 60_000;

test("a reached limit stands until its named reset, as a row's date or a summary's milliseconds, then reads as verified", () => {
  const asRow = { status: PROVIDER_KEY_STATUS.LIMIT_REACHED, limitResetsAt: new Date(RESETS_AT) };
  const asSummary = { status: PROVIDER_KEY_STATUS.LIMIT_REACHED, limitResetsAt: RESETS_AT };
  assert.deepEqual(
    [
      planStanding(asRow, BEFORE),
      planStanding(asSummary, BEFORE),
      planStanding(asRow, AFTER),
      planStanding(asSummary, AFTER),
    ],
    [
      PROVIDER_KEY_STATUS.LIMIT_REACHED,
      PROVIDER_KEY_STATUS.LIMIT_REACHED,
      PROVIDER_KEY_STATUS.VERIFIED,
      PROVIDER_KEY_STATUS.VERIFIED,
    ],
  );
});

test("a limit with no reset named stands, and any other status is as written", () => {
  assert.equal(
    planStanding({ status: PROVIDER_KEY_STATUS.LIMIT_REACHED, limitResetsAt: null }, AFTER),
    PROVIDER_KEY_STATUS.LIMIT_REACHED,
  );
  assert.equal(
    planStanding({ status: PROVIDER_KEY_STATUS.INVALID, limitResetsAt: RESETS_AT }, AFTER),
    PROVIDER_KEY_STATUS.INVALID,
  );
});

test("a launch is refused until a named reset still ahead, and never for a limit with none named", () => {
  const limited = { status: PROVIDER_KEY_STATUS.LIMIT_REACHED, limitResetsAt: new Date(RESETS_AT) };
  assert.deepEqual(
    [
      planLimitResetsAt(limited, BEFORE),
      planLimitResetsAt(limited, AFTER),
      planLimitResetsAt({ status: PROVIDER_KEY_STATUS.LIMIT_REACHED }, BEFORE),
    ],
    [RESETS_AT, undefined, undefined],
  );
});
