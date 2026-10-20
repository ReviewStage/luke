import assert from "node:assert/strict";
import { test } from "vitest";
import { DEPLOYMENT_PRESENCE } from "./auth.js";
import { BRAIN_HOST_TURN_POLICY, brainHostChannelInput, DEPLOYMENT_TURNS } from "./channel.js";

test("a follow-up steers the turn under way rather than queueing behind it, and the account bearer is checked before the development principal", () => {
  const channel = brainHostChannelInput(
    async () => undefined,
    {
      reachesSession: async () => false,
      reachesConversation: async () => false,
    },
    {
      secret: undefined,
      admits: DEPLOYMENT_TURNS,
      presents: DEPLOYMENT_PRESENCE.DEPLOYMENT,
      streams: true,
    },
  );
  assert.equal(channel.turnPolicy, BRAIN_HOST_TURN_POLICY.STEER);
  assert.equal(Array.isArray(channel.auth), false);
});
