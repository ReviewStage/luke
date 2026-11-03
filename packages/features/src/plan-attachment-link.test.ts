import assert from "node:assert/strict";
import { test } from "vitest";
import {
  planAttachmentAddress,
  planAttachmentIdsIn,
  planAttachmentOf,
  taskPictureMarkdown,
  taskPicturesIn,
} from "./plan-attachment-link.js";

/**
 * A plan's picture as its address: written under the plan's own, read back
 * by either scheme, and found in a plan's text only where it is the plan's
 * own. Synthetic ids.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const OTHER_TASK_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const PICTURE = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";
const SECOND = "3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02";
const EARLIER = "5d7e8f90-1a2b-4c3d-9e4f-5a6b7c8d9e03";
const UNDER_TASK = "7e8f9a0b-2c3d-4e5f-8a6b-7c8d9e0f1a04";

test("a picture's address is the plan's own under /plan/, which every shipped build reads, with its id after it, and reads back by either scheme and under /task/", () => {
  const address = planAttachmentAddress({ taskId: TASK_ID, attachmentId: PICTURE }, "acme");

  assert.equal(address, `https://vespin.dev/acme/plan/${TASK_ID}/files/${PICTURE}`);
  assert.deepEqual(planAttachmentOf(address), { taskId: TASK_ID, attachmentId: PICTURE });
  assert.deepEqual(planAttachmentOf(address.replace("https:", "vespin:")), {
    taskId: TASK_ID,
    attachmentId: PICTURE,
  });
  assert.deepEqual(planAttachmentOf(address.replace("/plan/", "/task/")), {
    taskId: TASK_ID,
    attachmentId: PICTURE,
  });
});

test("a plan's address, a section's, another host's, or a malformed id names no picture", () => {
  for (const address of [
    `https://vespin.dev/acme/plan/${TASK_ID}`,
    `https://vespin.dev/acme/plan/${TASK_ID}#rollout`,
    `https://example.com/acme/plan/${TASK_ID}/files/${PICTURE}`,
    `https://vespin.dev/acme/plan/${TASK_ID}/files/${PICTURE}#x`,
    `https://vespin.dev/acme/plan/${TASK_ID}/files/not-an-id`,
    `https://vespin.dev/acme/plan/${TASK_ID}/files/${PICTURE}/more`,
  ]) {
    assert.equal(planAttachmentOf(address), undefined, address);
  }
});

test("the pictures a text names are its plan's own, each once, in the order first named, one written under the earlier host and one under /task/ among them", () => {
  const text = [
    `![The mock](https://vespin.dev/acme/plan/${TASK_ID}/files/${SECOND} "Mock")`,
    `![Another plan's](https://vespin.dev/acme/plan/${OTHER_TASK_ID}/files/${PICTURE})`,
    `![The flow](vespin://vespin.dev/acme/plan/${TASK_ID}/files/${PICTURE})`,
    `![The mock again](https://vespin.dev/acme/plan/${TASK_ID}/files/${SECOND})`,
    `![Before the rename](tryluke://tryluke.dev/acme/plan/${TASK_ID}/files/${EARLIER})`,
    `![Under the task's link](https://vespin.dev/acme/task/${TASK_ID}/files/${UNDER_TASK})`,
    `![Broken](https://vespin.dev/acme/plan/${TASK_ID}/files/${PICTURE.replace("a01", "a99")}-wrong)`,
  ].join("\n\n");

  assert.deepEqual(planAttachmentIdsIn(text, TASK_ID), [SECOND, PICTURE, EARLIER, UNDER_TASK]);
});

test("a picture's line holds its alt text and caption on one line, escaped so neither closes its part early, and the caption left out where there is none", () => {
  const address = planAttachmentAddress({ taskId: TASK_ID, attachmentId: PICTURE }, "acme");

  assert.equal(
    taskPictureMarkdown(address, "The [new]\n  members page", 'Says "pending" \\ twice'),
    `![The \\[new\\] members page](${address} "Says \\"pending\\" \\\\ twice")`,
  );
  assert.equal(taskPictureMarkdown(address, "Members page"), `![Members page](${address})`);
  // The line written is a picture the plan's text draws, escaped alt text and all, so a correction must keep it.
  assert.deepEqual(taskPicturesIn(taskPictureMarkdown(address, "The [new] page", 'Says "hi"')), [
    address,
  ]);
});
