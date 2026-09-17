import assert from "node:assert/strict";
import { test } from "vitest";
import { brainTurnEventsPath, HOSTED_SERVICE_PATH } from "./service-paths.js";

test("a turn's event stream stands under the turns read, with the id inside the path", () => {
  const turnId = "1a000000-0000-4000-8000-000000000003";
  assert.equal(brainTurnEventsPath(turnId), `${HOSTED_SERVICE_PATH.BRAIN_TURNS}/${turnId}/events`);
  assert.equal(brainTurnEventsPath("a/b"), `${HOSTED_SERVICE_PATH.BRAIN_TURNS}/a%2Fb/events`);
});
