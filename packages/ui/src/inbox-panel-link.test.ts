import assert from "node:assert/strict";
import { test } from "vitest";
import { INBOX_PANEL_TARGET, inboxPanelTarget } from "./inbox-panel-link.js";

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const PLACE = {
  taskId: TASK,
  repository: "acme/relay",
  pullRequests: [{ agentId: AGENT, url: "https://github.com/acme/relay/pull/42" }],
};

test("a pull request one of the task's agents opened is its Pull request tab, however its page's address is spelled, and another's is not", () => {
  for (const href of [
    "https://github.com/acme/relay/pull/42",
    "https://github.com/acme/relay/pull/42/",
    "https://github.com/acme/relay/pull/42#issuecomment-1",
    "https://github.com/acme/relay/pull/42?w=1",
  ]) {
    assert.deepEqual(inboxPanelTarget(href, PLACE), {
      kind: INBOX_PANEL_TARGET.PULL_REQUEST,
      agentId: AGENT,
    });
  }
  assert.equal(inboxPanelTarget("https://github.com/acme/relay/pull/43", PLACE), undefined);
});

test("another pull request of the task's repository opens by its number in the first agent's Pull request tab, and one of another repository does not", () => {
  const place = { ...PLACE, agentIds: [AGENT] };
  assert.deepEqual(inboxPanelTarget("https://github.com/Acme/Relay/pull/41/files", place), {
    kind: INBOX_PANEL_TARGET.PULL_REQUEST,
    agentId: AGENT,
    number: 41,
  });
  assert.equal(inboxPanelTarget("https://github.com/acme/other/pull/41", place), undefined);
  assert.equal(
    inboxPanelTarget("https://github.com/acme/relay/pull/41", { ...place, agentIds: [] }),
    undefined,
  );
});

test("a long run of slashes is read at once, as any other address no pull request matches", () => {
  const href = `https://github.com/acme/relay/pull/43${"/".repeat(50_000)}x`;
  assert.equal(inboxPanelTarget(href, PLACE), undefined);
});

test("a file of the task's repository and the task's own page and Pull request tab open in the panel; another task's page, and a file with no task, do not", () => {
  assert.deepEqual(
    inboxPanelTarget("https://github.com/acme/relay/blob/HEAD/src/invites.ts", PLACE),
    { kind: INBOX_PANEL_TARGET.FILE, path: "src/invites.ts", lines: undefined },
  );
  const page = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
  assert.deepEqual(inboxPanelTarget(`https://tryluke.dev/acme/plan/${TASK}/page/${page}`, PLACE), {
    kind: INBOX_PANEL_TARGET.PAGE,
    pageId: page,
  });
  assert.equal(
    inboxPanelTarget(
      `https://tryluke.dev/acme/plan/9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32/page/${page}`,
      PLACE,
    ),
    undefined,
  );
  assert.equal(
    inboxPanelTarget("https://github.com/acme/relay/blob/HEAD/src/invites.ts", {
      ...PLACE,
      taskId: undefined,
    }),
    undefined,
  );
});

test("a Luke link to an agent of the item's own task reads beside the item, and one to another task's agent, or to an agent on no task, is the window's to open", () => {
  assert.deepEqual(
    inboxPanelTarget(`https://tryluke.dev/acme/plan/${TASK}/agent/${AGENT}`, PLACE),
    {
      kind: INBOX_PANEL_TARGET.AGENT,
      agentId: AGENT,
    },
  );
  const other = "5b7d9f1a-3c5e-4a7b-9d1f-2b4c6d8e0f1a";
  assert.equal(
    inboxPanelTarget(`https://tryluke.dev/acme/plan/${other}/agent/${AGENT}`, PLACE),
    undefined,
  );
  assert.equal(inboxPanelTarget(`https://tryluke.dev/acme/agent/${AGENT}`, PLACE), undefined);
});
