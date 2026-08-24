import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_IDENTITY, agentIdentityFor } from "@sidecar/session";

const IDENTITY_BY_KIND = {
  claude: AGENT_IDENTITY.CLAUDE_CODE,
  opencode: AGENT_IDENTITY.OPENCODE,
} as const;

test("a host's own agent word reads into the shared identity it maps", () => {
  assert.equal(agentIdentityFor(IDENTITY_BY_KIND, "claude"), AGENT_IDENTITY.CLAUDE_CODE);
  assert.equal(agentIdentityFor(IDENTITY_BY_KIND, "opencode"), AGENT_IDENTITY.OPENCODE);
});

test("a word outside the table reports no identity rather than a guess", () => {
  assert.equal(agentIdentityFor(IDENTITY_BY_KIND, "kimi"), undefined);
  assert.equal(agentIdentityFor(IDENTITY_BY_KIND, undefined), undefined);
  assert.equal(agentIdentityFor(IDENTITY_BY_KIND, "toString"), undefined);
});
