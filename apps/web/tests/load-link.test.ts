// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { addressBar, installPanelDoors, openAt, unmountPanels } from "./support/web-panel";

/**
 * A tab opened at a link written before the task was a task, under
 * `/plan/`, stands on the link written now, `/task/`, with all it named:
 * the place after the task, the comment thread its query names, and the
 * section its fragment names. Synthetic ids throughout.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

afterEach(() => unmountPanels());

test("a tab opened at an older /plan/ link stands on its /task/ link in the same entry, every part of it kept", () => {
  openAt(`/acme/plan/${TASK_ID}/version/2?comment=t1#rollout`);
  const entries = window.history.length;

  installPanelDoors();

  assert.equal(addressBar(), `/acme/task/${TASK_ID}/version/2?comment=t1#rollout`);
  assert.equal(window.history.length, entries, "the older link is replaced, not stepped past");
});

test("a link written now, and a workspace whose slug is plan, stand as they are", () => {
  for (const address of [`/acme/task/${TASK_ID}#rollout`, `/plan/task/${TASK_ID}`]) {
    openAt(address);
    installPanelDoors();
    assert.equal(addressBar(), address);
  }
});

test("a tab opened at a link place in an older spelling stands on its link written now in the same entry, for its route to open", () => {
  openAt(`/acme/task/VSP-7/page/page-1`);
  const entries = window.history.length;

  installPanelDoors();

  assert.equal(addressBar(), "/acme/task/7/page/page-1");
  assert.equal(window.history.length, entries, "the older link is replaced, not stepped past");
});
