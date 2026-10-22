import assert from "node:assert/strict";
import { test } from "vitest";
import {
  inboxAttachmentAddress,
  inboxAttachmentIdsIn,
  inboxAttachmentOf,
} from "./inbox-attachment-link.js";
import { LINK_PLACE, readLink } from "./luke-link.js";

/**
 * A picture in an Inbox item's words as its address: written under the
 * item's own link, read back by either scheme, opened as its item, and
 * found in a text only where it is the item's own. Synthetic ids.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const ITEM_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const OTHER_ITEM_ID = "a1b2c3d4-0000-4000-8000-000000000002";
const PICTURE = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";
const SECOND = "3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02";

const ON_TASK = { kind: LINK_PLACE.INBOX_ITEM, planId: TASK_ID, itemId: ITEM_ID } as const;
const ON_AGENT = { kind: LINK_PLACE.INBOX_ITEM, agentId: AGENT_ID, itemId: ITEM_ID } as const;

test("a picture's address is its item's link with its id after it, under the task or the agent with no task, and reads back by either scheme", () => {
  const onTask = inboxAttachmentAddress(ON_TASK, PICTURE, "acme");
  const onAgent = inboxAttachmentAddress(ON_AGENT, PICTURE, "acme");

  assert.equal(
    onTask,
    `https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/${PICTURE}`,
  );
  assert.equal(
    onAgent,
    `https://tryluke.dev/acme/agent/${AGENT_ID}/inbox/${ITEM_ID}/files/${PICTURE}`,
  );
  for (const address of [onTask, onAgent, onTask.replace("https:", "tryluke:")]) {
    assert.deepEqual(inboxAttachmentOf(address), { itemId: ITEM_ID, attachmentId: PICTURE });
  }
});

test("a picture's address opens its item, as the item's own link does", () => {
  assert.deepEqual(readLink(inboxAttachmentAddress(ON_TASK, PICTURE, "acme")), {
    workspace: "acme",
    place: ON_TASK,
  });
  assert.deepEqual(readLink(inboxAttachmentAddress(ON_AGENT, PICTURE, "acme")), {
    workspace: "acme",
    place: ON_AGENT,
  });
  assert.equal(
    readLink(`https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/not-an-id`),
    undefined,
  );
});

test("an item's link, a plan's picture, another host's, or a malformed id names no item's picture", () => {
  for (const address of [
    `https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}`,
    `https://tryluke.dev/acme/plan/${TASK_ID}/files/${PICTURE}`,
    `https://example.com/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/${PICTURE}`,
    `https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/${PICTURE}#x`,
    `https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/${PICTURE}?size=2`,
    `https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/not-an-id`,
    `https://tryluke.dev/acme/plan/${TASK_ID}/inbox/not-an-id/files/${PICTURE}`,
    `https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/${PICTURE}/more`,
    `https://tryluke.dev/acme/issue/${TASK_ID}/inbox/${ITEM_ID}/files/${PICTURE}`,
  ]) {
    assert.equal(inboxAttachmentOf(address), undefined, address);
  }
});

test("the pictures a text names are its item's own, each once, in the order first named", () => {
  const text = [
    `![Before](https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/${SECOND} "Before")`,
    `![Another item's](https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${OTHER_ITEM_ID}/files/${PICTURE})`,
    `![After](tryluke://tryluke.dev/acme/agent/${AGENT_ID}/inbox/${ITEM_ID}/files/${PICTURE})`,
    `![Before again](https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/${SECOND})`,
    `![Broken](https://tryluke.dev/acme/plan/${TASK_ID}/inbox/${ITEM_ID}/files/${PICTURE}-wrong)`,
  ].join("\n\n");

  assert.deepEqual(inboxAttachmentIdsIn(text, ITEM_ID), [SECOND, PICTURE]);
});
