import assert from "node:assert/strict";
import { test } from "vitest";
import { HOSTED_SERVICE_PATH, planPath, VOICE_SERVICE_PATH } from "./service-paths.js";

test("account preferences have a stable endpoint path", () => {
  assert.equal(HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES, "/api/account/preferences");
});

test("the voice service's path is a function route of its own, apart from every hosted path", () => {
  const taken = new Set<string>(Object.values(HOSTED_SERVICE_PATH));
  for (const path of Object.values(VOICE_SERVICE_PATH)) assert.equal(taken.has(path), false);
});

test("a plan stands under the plans read, with its id inside the path as one segment", () => {
  assert.equal(planPath("a/b"), `${HOSTED_SERVICE_PATH.PLANS}/a%2Fb`);
});
