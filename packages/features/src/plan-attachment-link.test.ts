import assert from "node:assert/strict";
import { test } from "vitest";
import {
  planAttachmentAddress,
  planAttachmentIdsIn,
  planAttachmentOf,
  planPictureMarkdown,
  planPicturesIn,
} from "./plan-attachment-link.js";

/**
 * A plan's picture as its address: written under the plan's own, read back
 * by either scheme, and found in a plan's text only where it is the plan's
 * own. Synthetic ids.
 */

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const OTHER_PLAN_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const PICTURE = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";
const SECOND = "3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02";

test("a picture's address is the plan's own with its id after it, and reads back by either scheme", () => {
  const address = planAttachmentAddress({ planId: PLAN_ID, attachmentId: PICTURE }, "acme");

  assert.equal(address, `https://tryluke.dev/acme/plan/${PLAN_ID}/files/${PICTURE}`);
  assert.deepEqual(planAttachmentOf(address), { planId: PLAN_ID, attachmentId: PICTURE });
  assert.deepEqual(planAttachmentOf(address.replace("https:", "tryluke:")), {
    planId: PLAN_ID,
    attachmentId: PICTURE,
  });
});

test("a plan's address, a section's, another host's, or a malformed id names no picture", () => {
  for (const address of [
    `https://tryluke.dev/acme/plan/${PLAN_ID}`,
    `https://tryluke.dev/acme/plan/${PLAN_ID}#rollout`,
    `https://example.com/acme/plan/${PLAN_ID}/files/${PICTURE}`,
    `https://tryluke.dev/acme/plan/${PLAN_ID}/files/${PICTURE}#x`,
    `https://tryluke.dev/acme/plan/${PLAN_ID}/files/not-an-id`,
    `https://tryluke.dev/acme/plan/${PLAN_ID}/files/${PICTURE}/more`,
  ]) {
    assert.equal(planAttachmentOf(address), undefined, address);
  }
});

test("the pictures a text names are its plan's own, each once, in the order first named", () => {
  const text = [
    `![The mock](https://tryluke.dev/acme/plan/${PLAN_ID}/files/${SECOND} "Mock")`,
    `![Another plan's](https://tryluke.dev/acme/plan/${OTHER_PLAN_ID}/files/${PICTURE})`,
    `![The flow](tryluke://tryluke.dev/acme/plan/${PLAN_ID}/files/${PICTURE})`,
    `![The mock again](https://tryluke.dev/acme/plan/${PLAN_ID}/files/${SECOND})`,
    `![Broken](https://tryluke.dev/acme/plan/${PLAN_ID}/files/${PICTURE.replace("a01", "a99")}-wrong)`,
  ].join("\n\n");

  assert.deepEqual(planAttachmentIdsIn(text, PLAN_ID), [SECOND, PICTURE]);
});

test("a picture's line holds its alt text and caption on one line, escaped so neither closes its part early, and the caption left out where there is none", () => {
  const address = planAttachmentAddress({ planId: PLAN_ID, attachmentId: PICTURE }, "acme");

  assert.equal(
    planPictureMarkdown(address, "The [new]\n  members page", 'Says "pending" \\ twice'),
    `![The \\[new\\] members page](${address} "Says \\"pending\\" \\\\ twice")`,
  );
  assert.equal(planPictureMarkdown(address, "Members page"), `![Members page](${address})`);
  // The line written is a picture the plan's text draws, escaped alt text and all, so a correction must keep it.
  assert.deepEqual(planPicturesIn(planPictureMarkdown(address, "The [new] page", 'Says "hi"')), [
    address,
  ]);
});
