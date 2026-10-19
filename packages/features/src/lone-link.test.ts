import assert from "node:assert/strict";
import { test } from "vitest";
import { LONE_LINK, loneLinkOf } from "./lone-link.js";
import { LINK_PLACE, linkOf } from "./luke-link.js";

/**
 * What a link standing alone in a paragraph is drawn as: a pull request's
 * card, a Luke page's, or lines of a file at a commit; anything else none.
 * Synthetic ids and repositories.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const PAGE_ID = "3c4d5e6f-0000-4000-8000-000000000001";
const COMMIT = "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39";

test("a pull request's page, or a page under it, is its pull request's card", () => {
  for (const address of [
    "https://github.com/acme/relay/pull/42",
    "https://github.com/acme/relay/pull/42/files",
  ]) {
    assert.deepEqual(
      loneLinkOf(address),
      { kind: LONE_LINK.PULL_REQUEST, repository: "acme/relay", number: 42 },
      address,
    );
  }
});

test("a page an agent showed on a plan is the page's card", () => {
  const address = linkOf({ kind: LINK_PLACE.PAGE, planId: TASK_ID, pageId: PAGE_ID }, "acme");
  assert.deepEqual(loneLinkOf(address), {
    kind: LONE_LINK.PAGE,
    taskId: TASK_ID,
    pageId: PAGE_ID,
  });
});

test("lines of a file at a commit are the code card of those lines, one line or a range, its path read back whole", () => {
  assert.deepEqual(
    loneLinkOf(`https://github.com/acme/relay/blob/${COMMIT}/apps/web/rollout%20store.ts#L3-L5`),
    {
      kind: LONE_LINK.CODE,
      repo: "acme/relay",
      path: "apps/web/rollout store.ts",
      sha: COMMIT,
      startLine: 3,
      endLine: 5,
    },
  );
  assert.deepEqual(loneLinkOf(`https://github.com/acme/relay/blob/${COMMIT.slice(0, 7)}/a.ts#L9`), {
    kind: LONE_LINK.CODE,
    repo: "acme/relay",
    path: "a.ts",
    sha: COMMIT.slice(0, 7),
    startLine: 9,
    endLine: 9,
  });
});

test("a file on a branch, a file with no lines, lines that run backwards, a path climbing out, an issue, a plan, or another page earns no card", () => {
  for (const address of [
    "https://github.com/acme/relay/blob/main/apps/web/rollout-store.ts#L3-L5",
    `https://github.com/acme/relay/blob/${COMMIT}/apps/web/rollout-store.ts`,
    `https://github.com/acme/relay/blob/${COMMIT}/apps/web/rollout-store.ts#L5-L3`,
    `https://github.com/acme/relay/blob/${COMMIT}/../secrets.ts#L1`,
    `https://github.com/acme/relay/tree/${COMMIT}/apps#L1`,
    "https://github.com/acme/relay/issues/7",
    linkOf({ kind: LINK_PLACE.TASK, planId: TASK_ID }, "acme"),
    "https://example.com/acme/relay/pull/42",
    "not a link",
  ]) {
    assert.equal(loneLinkOf(address), undefined, address);
  }
});
