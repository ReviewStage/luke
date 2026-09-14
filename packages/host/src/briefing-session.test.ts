import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BRIEFING_SESSION,
  BRIEFING_SESSION_DECISION,
  type BriefingSessionFacts,
  briefingSessionDecision,
} from "./briefing-session.js";

const NOW = 1_757_505_600_000;

const OPENABLE: BriefingSessionFacts = {
  openOffers: 1,
  present: true,
  held: false,
  sessionStands: false,
  lastOpenedAt: undefined,
  now: NOW,
};

test("a briefing on offer to a present Mac with speech free and no session standing opens one, once", () => {
  assert.equal(briefingSessionDecision(OPENABLE), BRIEFING_SESSION_DECISION.OPEN);
  assert.equal(
    briefingSessionDecision({ ...OPENABLE, openOffers: 3 }),
    BRIEFING_SESSION_DECISION.OPEN,
  );
  // The opening asked for: a second offer while the session stands opens nothing.
  assert.equal(
    briefingSessionDecision({ ...OPENABLE, openOffers: 2, sessionStands: true, lastOpenedAt: NOW }),
    BRIEFING_SESSION_DECISION.NONE,
  );
});

test("nothing opens with nothing on offer, with the Mac away, or while speech is held", () => {
  assert.equal(
    briefingSessionDecision({ ...OPENABLE, openOffers: 0 }),
    BRIEFING_SESSION_DECISION.NONE,
  );
  assert.equal(
    briefingSessionDecision({ ...OPENABLE, present: false }),
    BRIEFING_SESSION_DECISION.NONE,
  );
  assert.equal(
    briefingSessionDecision({ ...OPENABLE, held: true }),
    BRIEFING_SESSION_DECISION.NONE,
  );
  assert.equal(
    briefingSessionDecision({ ...OPENABLE, present: false, held: true }),
    BRIEFING_SESSION_DECISION.NONE,
  );
});

test("a burst of offers opens one session: a second ask inside the debounce opens nothing, one past it does", () => {
  const opened = NOW;
  assert.equal(
    briefingSessionDecision({ ...OPENABLE, lastOpenedAt: opened, now: opened + 1 }),
    BRIEFING_SESSION_DECISION.NONE,
  );
  assert.equal(
    briefingSessionDecision({
      ...OPENABLE,
      lastOpenedAt: opened,
      now: opened + BRIEFING_SESSION.DEBOUNCE_MS - 1,
    }),
    BRIEFING_SESSION_DECISION.NONE,
  );
  assert.equal(
    briefingSessionDecision({
      ...OPENABLE,
      lastOpenedAt: opened,
      now: opened + BRIEFING_SESSION.DEBOUNCE_MS,
    }),
    BRIEFING_SESSION_DECISION.OPEN,
  );
  assert.equal(BRIEFING_SESSION.DEBOUNCE_MS, 60_000);
});
