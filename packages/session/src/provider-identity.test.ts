import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLOUD_AGENT_PROVIDER_ID,
  isCloudAgentProviderId,
  isProviderId,
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  PROVIDER_IDENTITY_BY_ID,
  PROVIDER_LOCATION_KIND,
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

test("the README provider table matches provider identities", () => {
  const rows = PROVIDER_ID_LIST.map((providerId) => {
    const identity = PROVIDER_IDENTITY_BY_ID[providerId];
    const local = identity.location !== PROVIDER_LOCATION_KIND.CLOUD ? "✅" : "";
    const cloud = identity.location !== PROVIDER_LOCATION_KIND.LOCAL ? "✅" : "";
    return `| ${identity.displayName} | ${local} | ${cloud} |`;
  });
  const table = ["| Agent | Local | Cloud |", "| --- | :---: | :---: |", ...rows].join("\n");
  const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
  assert.ok(
    readme.includes(`<!-- provider-agents:start -->\n${table}\n<!-- provider-agents:end -->`),
  );
});
