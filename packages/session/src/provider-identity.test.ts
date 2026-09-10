import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_AGENT_PROVIDER_ID,
  isCloudAgentProviderId,
  isProviderId,
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  PROVIDER_IDENTITY_BY_ID,
} from "@sidecar/session";

test("provider identities exhaust the ordered provider ids", () => {
  assert.deepEqual(Object.keys(PROVIDER_IDENTITY_BY_ID), PROVIDER_ID_LIST);
  assert.deepEqual(PROVIDER_ID_LIST, Object.values(PROVIDER_ID));
  for (const providerId of PROVIDER_ID_LIST) {
    assert.equal(PROVIDER_IDENTITY_BY_ID[providerId].id, providerId);
  }
});

test("a cloud-agent provider id is one of the set and nothing shaped like one", () => {
  for (const providerId of Object.values(CLOUD_AGENT_PROVIDER_ID)) {
    assert.equal(isCloudAgentProviderId(providerId), true);
    assert.equal(isProviderId(providerId), true);
  }
  assert.equal(isCloudAgentProviderId(PROVIDER_ID.CLAUDE_CODE), false);
  assert.equal(isCloudAgentProviderId("openai"), false);
  assert.equal(isCloudAgentProviderId("linear"), false);
  assert.equal(isCloudAgentProviderId(""), false);
  assert.equal(isCloudAgentProviderId(undefined), false);
  assert.equal(isCloudAgentProviderId({ providerId: "cursor" }), false);
});
