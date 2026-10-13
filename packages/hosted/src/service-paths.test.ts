import assert from "node:assert/strict";
import { test } from "vitest";
import {
  agentPath,
  agentPullRequestPath,
  HOSTED_SERVICE_PATH,
  inboxAttachmentPath,
  inboxItemPath,
  planInboxPath,
  planPath,
  VOICE_SERVICE_PATH,
} from "./service-paths.js";

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

test("an agent's pull request stands under the agent's own address, with its id as one segment", () => {
  assert.equal(agentPath("a/b"), "/api/agents/a%2Fb");
  assert.equal(agentPullRequestPath("a/b"), "/api/agents/a%2Fb/pull-request");
});

test("a plan's inbox stands under the plan with its cursor in the query, and an item at its own address as one segment", () => {
  assert.equal(planInboxPath("a/b"), `${HOSTED_SERVICE_PATH.PLANS}/a%2Fb/inbox`);
  assert.equal(planInboxPath("a/b", "7&x"), `${HOSTED_SERVICE_PATH.PLANS}/a%2Fb/inbox?after=7%26x`);
  assert.equal(inboxItemPath("a/b"), "/api/inbox/a%2Fb");
  assert.equal(inboxAttachmentPath("a/b", "c/d"), "/api/inbox/a%2Fb/attachments/c%2Fd");
});
