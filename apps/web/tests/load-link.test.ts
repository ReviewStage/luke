// @vitest-environment jsdom
import assert from "node:assert/strict";
import type { ShownLink } from "@repo/features/link-grammar";
import { RUN_PROFILE } from "@repo/host/app-state";
import { FIXTURE_IDS } from "@repo/host/fixture-stage";
import { createBrowserHistory } from "@tanstack/react-router";
import { afterEach, test } from "vitest";
import { withLoadLink } from "../src/app/load-link";
import {
  addressBar,
  drawPanel,
  fixtureBridge,
  installPanelDoors,
  openAt,
  unmountPanels,
} from "./support/web-panel";

/**
 * A tab opened at a link written before the task was a task, under
 * `/plan/`, stands on the link written now, `/task/`, with all it named:
 * the place after the task, the comment thread its query names, and the
 * section its fragment names. Synthetic ids throughout.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** What the tab's address, opened at `address`, says as a link as the page loads; nothing where its route opens it. */
function saidAt(address: string): ShownLink | undefined {
  openAt(address);
  const history = createBrowserHistory();
  const heard: ShownLink[] = [];
  const stop = withLoadLink(fixtureBridge(RUN_PROFILE.IDLE), history).onShowLink((link) =>
    heard.push(link),
  );
  stop();
  history.destroy();
  return heard[0];
}

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

test("a tab opened at a link place keeps every other key its query carries as it stands on its link written now", () => {
  openAt(`/acme/plan/${TASK_ID}?ref=mail#Rollout`);

  installPanelDoors();

  assert.equal(addressBar(), `/acme/task/${TASK_ID}?ref=mail#rollout`);
});

test("a tab opened at an agent's place under its task keeps every value of a key its query repeats, and its fragment, as it stands on its link written now", () => {
  const address = `/acme/task/${TASK_ID}/agent/${AGENT_ID}/changes?ref=a&ref=b#x`;
  openAt(address);

  installPanelDoors();

  assert.equal(addressBar(), address);
});

test("a tab opened at an agent's own address says it as a link, which finds where the agent stands, while a place under the agent is left to its route", () => {
  assert.deepEqual(saidAt(`/acme/agent/${AGENT_ID}`), {
    workspace: "acme",
    place: { kind: "agent", agentId: AGENT_ID },
  });
  assert.equal(saidAt(`/acme/agent/${AGENT_ID}/changes`), undefined);
});

test("a tab opened at the address of an agent on a task keeps that entry behind the task's step its link writes", async () => {
  openAt(`/personal/agent/${FIXTURE_IDS.AGENT}`);
  const entries = window.history.length;

  installPanelDoors(RUN_PROFILE.AGENT_PAGE);
  await drawPanel();

  assert.equal(addressBar(), "/personal/task/42");
  assert.equal(window.history.length, entries + 1, "the loaded entry stands behind the task's");
});
