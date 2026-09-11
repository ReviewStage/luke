import assert from "node:assert/strict";
import { SETTINGS_RESET_SCOPE } from "@sidecar/settings";
import { test } from "vitest";
import { ACT_KIND } from "#shared/messages/acts";
import { actRequest } from "./act";

test("actRequest pairs a kind with the payload its own schema takes", () => {
  assert.deepEqual(actRequest(ACT_KIND.SETTINGS_RESET, { scope: SETTINGS_RESET_SCOPE.VOICE }), {
    kind: ACT_KIND.SETTINGS_RESET,
    payload: { scope: SETTINGS_RESET_SCOPE.VOICE },
  });
});

test("actRequest carries no payload key for a kind that takes none", () => {
  const request = actRequest(ACT_KIND.MICROPHONE_REQUEST, undefined);
  assert.deepEqual(request, { kind: ACT_KIND.MICROPHONE_REQUEST });
  assert.equal("payload" in request, false);
});
