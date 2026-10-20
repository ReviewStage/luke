// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DRAFT_PLACE, EMPTY_DRAFT, useDraftWriter } from "../composer-drafts.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { SidebarAgent } from "./sidebar-agent.js";

/**
 * sidebar-agent.test.ts -- an agent with no task, as a row among the sidebar's tasks, is acted on as a task's row is: archived from its right-click at once while it rests, read again by its own id first, asked first while it works, and brought back by Unarchive once archived; renamed in place; and hanging its card while rested on.
 *
 * The service is a script at the act boundary; synthetic agents throughout.
 */

const AGENT_ID = "4b2e7c1d-9a3f-4e6b-8c5d-1f0a2b3c4d5e";

/** An automation's run's agent at rest, as the sidebar lists it. */
const RUN: TasklessAgent = {
  id: AGENT_ID,
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Remove the stale copy",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  automationName: "Copy sweep",
  automationId: "7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a",
  workspaceId: "workspace-1",
  repository: "acme/relay",
  activityAt: 2,
};

/** Where the agent stands as its own page reads it, which may have moved since the list was read. */
let standing: TasklessAgent = RUN;
/** Every archive or Unarchive asked, in order. */
let archives: { agentId: string; archived: boolean }[] = [];
/** Every rename asked, in order. */
let renames: { agentId: string; title: string }[] = [];
let root: Root | undefined;

beforeEach(() => {
  standing = RUN;
  archives = [];
  renames = [];
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
        const { automationId, activityAt: _at, ...agent } = standing;
        const value = { agent: { ...agent, automationId } };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The row of `agent`, drawn among the sidebar's tasks, whose archive is heard into `archives`. */
function mount(agent: TasklessAgent): HTMLElement {
  const agents = codingAgentsControl({
    onArchive: (agentId, archived) => {
      archives.push({ agentId, archived });
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
    onRename: (agentId, title) => {
      renames.push({ agentId, title });
      return Promise.resolve(true);
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(SidebarAgent, {
          agent,
          agents,
          current: false,
          unread: false,
          now: 3,
          at: agent.activityAt,
          shown: true,
          onOpen: () => undefined,
          onPin: agent.archivedAt === undefined ? () => undefined : undefined,
        }),
      ),
    ),
  );
  return container;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** What the row's right-click offers, by label. */
function rightClick(row: HTMLElement): HTMLButtonElement[] {
  const press = row.querySelector<HTMLElement>("button") ?? assert.fail("the row is drawn");
  act(() => {
    press.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 4, clientY: 4 }));
  });
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

/** The item under `label` among those offered, or a failure saying it is not offered. */
function item(items: readonly HTMLButtonElement[], label: string): HTMLButtonElement {
  return items.find((each) => each.textContent === label) ?? assert.fail(`offers ${label}`);
}

test("an agent at rest is archived from its row's right-click at once, once its own page reads it at rest too", async () => {
  const row = mount(RUN);
  const archive = item(rightClick(row), "Archive agent");
  await act(async () => archive.click());
  await settle();

  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: true }]);
  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing was asked");
});

test("an agent the list read at rest but whose page reads it working is asked about first, and archived only once asked", async () => {
  standing = { ...RUN, status: CODING_AGENT_STATUS.RUNNING };
  const row = mount(RUN);
  const archive = item(rightClick(row), "Archive agent");
  await act(async () => archive.click());
  await settle();

  assert.deepEqual(archives, []);
  const stop = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === "Stop and archive",
  );
  assert.ok(stop, "the archive asks first");
  await act(async () => stop.click());
  await settle();

  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: true }]);
});

test("an archived agent's row offers Unarchive in Archive's place and no pin, and Unarchive brings it back", async () => {
  const row = mount({ ...RUN, archivedAt: 3 });
  const items = rightClick(row);
  const labels = items.map((each) => each.textContent);
  assert.ok(!labels.includes("Archive agent"));
  assert.ok(!labels.includes("Pin"));
  await act(async () => item(items, "Unarchive").click());
  await settle();

  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: false }]);
});

test("Rename on the row's right-click turns the row into its name's field, and the name typed renames the agent, as a task's row does", async () => {
  const row = mount(RUN);
  const offered = rightClick(row);
  act(() => item(offered, "Rename").click());
  const field =
    row.querySelector<HTMLInputElement>('input[aria-label="Agent name"]') ??
    assert.fail("the row is its name's field");
  act(() => {
    field.value = "Remove the stale banners";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();

  assert.deepEqual(renames, [{ agentId: AGENT_ID, title: "Remove the stale banners" }]);
});

test("rested on, the row hangs the agent's card beside it, naming it as its tab's card does", () => {
  const row = mount(RUN);
  const press = row.querySelector<HTMLElement>("button") ?? assert.fail("the row is drawn");
  act(() => {
    press.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });

  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Remove the stale copy");
});

/** Writes words into the agent's box's draft, as typing on its page would. */
function DraftInBox({ words }: { words: string }): null {
  const writer = useDraftWriter();
  useEffect(() => {
    writer.update({ kind: DRAFT_PLACE.AGENT, planId: null, agentId: AGENT_ID }, () => ({
      ...EMPTY_DRAFT,
      text: words,
    }));
  }, [writer, words]);
  return null;
}

test("a draft waiting in the agent's box marks its row with the Draft pencil while its page is not the one open, as a task's row", () => {
  const drawn = (current: boolean): boolean => {
    const container = document.createElement("div");
    document.body.append(container);
    const held = createRoot(container);
    const agents = codingAgentsControl({});
    act(() =>
      held.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(
            Fragment,
            null,
            createElement(DraftInBox, { words: "Also sweep the footer" }),
            createElement(SidebarAgent, {
              agent: RUN,
              agents,
              current,
              unread: false,
              now: 3,
              at: RUN.activityAt,
              shown: true,
              onOpen: () => undefined,
            }),
          ),
        ),
      ),
    );
    const marked = container.querySelector('.draft-mark[aria-label="Draft"]') !== null;
    act(() => held.unmount());
    container.remove();
    return marked;
  };

  assert.equal(drawn(false), true);
  assert.equal(drawn(true), false);
});

test("the row's card says the agent last moved when its row does, the end of its run included, and shows the pull request it opened, as a task's row's card shows its own", () => {
  const minute = 60_000;
  const now = Date.now();
  const ran = {
    ...RUN,
    runStartedAt: now - 3 * 24 * 60 * minute,
    activityAt: now - 2 * minute,
    pullRequest: {
      number: 42,
      title: "Remove the stale copy",
      url: "https://github.com/acme/relay/pull/42",
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
    },
  };
  const row = mount(ran);
  const press = row.querySelector<HTMLElement>("button") ?? assert.fail("the row is drawn");
  act(() => {
    press.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });

  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  const corner = card?.querySelector(".luke-hover-card-corner")?.textContent ?? "";
  assert.equal(
    corner,
    "#42 · 2m",
    "its pull request, and its run's end rather than its start three days ago",
  );
});
