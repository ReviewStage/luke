import assert from "node:assert/strict";
import { test } from "vitest";
import { listedPullRequestOf } from "./pull-request-link.js";

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const OTHER = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const URL = "https://github.com/acme/relay/pull/42";

test("a link to a pull request a listed task's agent opened names that task and agent, however its address is spelled", () => {
  const tasks = [
    { id: OTHER },
    { id: TASK, agents: { pullRequests: [{ url: URL, agentId: AGENT }] } },
  ];
  assert.deepEqual(listedPullRequestOf(`${URL}/#issuecomment-1`, tasks), {
    taskId: TASK,
    agentId: AGENT,
  });
  assert.equal(listedPullRequestOf("https://github.com/acme/relay/pull/7", tasks), undefined);
});

test("a pull request named without its agent, as a service before it sends one, is not found", () => {
  const tasks = [{ id: TASK, agents: { pullRequests: [{ url: URL }] } }];
  assert.equal(listedPullRequestOf(URL, tasks), undefined);
});
