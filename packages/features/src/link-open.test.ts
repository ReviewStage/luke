import assert from "node:assert/strict";
import { test } from "vitest";
import { LINK_OPEN, LINK_PLATFORM, linkOpenTarget } from "./link-open.js";

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const TASK_ADDRESS = `https://vespin.dev/acme/plan/${TASK_ID}#rollout`;

test("an account that chose the app, on a Mac, hands the link over in the desktop's scheme", () => {
  assert.equal(
    linkOpenTarget(LINK_OPEN.MAC_APP, LINK_PLATFORM.MAC, TASK_ADDRESS),
    `vespin://vespin.dev/acme/task/${TASK_ID}#rollout`,
  );
});

test("a preview's address hands over the link it stands for on Vespin's home", () => {
  assert.equal(
    linkOpenTarget(
      LINK_OPEN.MAC_APP,
      LINK_PLATFORM.MAC,
      `https://git-branch.vercel.app/acme/agent/${TASK_ID}?utm=slack`,
    ),
    `vespin://vespin.dev/acme/agent/${TASK_ID}`,
  );
});

test("an account that chose the browser stays on the web, on a Mac or not", () => {
  assert.equal(linkOpenTarget(LINK_OPEN.BROWSER, LINK_PLATFORM.MAC, TASK_ADDRESS), undefined);
  assert.equal(linkOpenTarget(LINK_OPEN.BROWSER, LINK_PLATFORM.OTHER, TASK_ADDRESS), undefined);
});

test("a browser on no Mac stays on the web, since there is no app to hand to", () => {
  assert.equal(linkOpenTarget(LINK_OPEN.MAC_APP, LINK_PLATFORM.OTHER, TASK_ADDRESS), undefined);
});

test("an address with no workspace, a page of ours, or naming no place, stays on the web", () => {
  for (const address of [
    "https://vespin.dev/",
    "https://vespin.dev",
    "https://vespin.dev/about",
    "https://vespin.dev/acme/nowhere/1",
    "not an address",
  ]) {
    assert.equal(linkOpenTarget(LINK_OPEN.MAC_APP, LINK_PLATFORM.MAC, address), undefined, address);
  }
});
