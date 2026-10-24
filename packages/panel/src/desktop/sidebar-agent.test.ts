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
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { type AgentActions, rowDoors, useAgentActions } from "./agent-actions.js";
import { SidebarAgent } from "./sidebar-agent.js";
import { contentActionGroups } from "./strip-tabs.js";

/**
 * sidebar-agent.test.ts -- an agent with no task, as a row among the sidebar's tasks, offers every action its tab and its page offer but those `NOT_ON_A_ROW` names, and is acted on as a task's row is: archived from its right-click at once while it rests, read again by its own id first, asked first while it works, and brought back by Unarchive once archived; renamed in place; deleted for good once asked, last and alone in its menu; and hanging its card while rested on.
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
/** Every agent marked read by hand in main, in order. */
let seen: string[] = [];
/** Every rename asked, in order. */
let renames: { agentId: string; title: string }[] = [];
/** Every delete asked, in order. */
let deletes: string[] = [];
/** How many times a delete that landed left the agent's page. */
let left = 0;
let root: Root | undefined;

beforeEach(() => {
  standing = RUN;
  archives = [];
  renames = [];
  deletes = [];
  left = 0;
  seen = [];
  window.localStorage.clear();
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
        const { automationId, activityAt: _at, ...agent } = standing;
        const value = { agent: { ...agent, automationId } };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_SEEN) {
        seen.push(request.payload.agentId);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
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
function mount(
  agent: TasklessAgent,
  pullRequests: CodingAgentsControl["pullRequests"] = new Map(),
  unread = false,
): HTMLElement {
  const agents = codingAgentsControl({
    pullRequests,
    onArchive: (agentId, archived) => {
      archives.push({ agentId, archived });
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
    onRename: (agentId, title) => {
      renames.push({ agentId, title });
      return Promise.resolve(true);
    },
    onDelete: (agentId) => {
      deletes.push(agentId);
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
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
          unread,
          now: 3,
          at: agent.activityAt,
          shown: true,
          onOpen: () => undefined,
          onPin: agent.archivedAt === undefined ? () => undefined : undefined,
          onDeleted: () => {
            left += 1;
          },
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
  return (
    items.find((each) => each.textContent === label) ??
    assert.fail(`offers ${label}: ${JSON.stringify(items.map((each) => each.textContent))}`)
  );
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

test("stopping a working agent to archive it draws its act in the accent, since Unarchive brings it back", async () => {
  standing = { ...RUN, status: CODING_AGENT_STATUS.RUNNING };
  const row = mount(RUN);
  const archive = item(rightClick(row), "Archive agent");
  await act(async () => archive.click());
  await settle();

  assert.equal(dialogAnswer("Stop and archive").getAttribute("data-variant"), "primary");
});

test("Permanently delete draws its act in the danger colour, since an agent is not brought back", async () => {
  const row = mount(RUN);
  const remove = item(rightClick(row), "Permanently delete");
  act(() => remove.click());
  await settle();

  assert.equal(dialogAnswer("Permanently delete").getAttribute("data-variant"), "danger");
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
  restOn(press);

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
              onDeleted: () => undefined,
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
  restOn(press);

  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  const corner = card?.querySelector(".luke-hover-card-corner")?.textContent ?? "";
  assert.equal(
    corner,
    "#42 · 2m",
    "its pull request, and its run's end rather than its start three days ago",
  );
});

test("the row's card shows a pull request read since the list was, before the list's own", () => {
  const read = {
    number: 43,
    title: "Remove the stale copy",
    url: "https://github.com/acme/relay/pull/43",
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PENDING,
    additions: 3,
    deletions: 9,
    changedFiles: 2,
  };
  const row = mount(RUN, new Map([[AGENT_ID, read]]));
  const press = row.querySelector<HTMLElement>("button") ?? assert.fail("the row is drawn");
  restOn(press);

  const corner = document.querySelector(".luke-tooltip-card .luke-hover-card-corner");
  assert.match(corner?.textContent ?? "", /^#43/u);
});

/** Presses `label` in the row's right-click menu. */
async function choose(row: HTMLElement, label: string): Promise<void> {
  const pick = item(rightClick(row), label);
  await act(async () => pick.click());
}

/** What a reader of the screen hears the row say, which names it unread. */
function heard(row: HTMLElement): string {
  return row.textContent ?? "";
}

test("an agent's row offers Mark as unread after Copy link and before Rename, and the mark by hand reads it unread, as a task's row does", async () => {
  const row = mount(RUN);
  const labels = rightClick(row).map((each) => each.textContent);
  assert.ok(labels.indexOf("Mark as unread") > labels.indexOf("Copy link"));
  assert.ok(labels.indexOf("Mark as unread") < labels.indexOf("Rename"));
  assert.ok(!heard(row).includes("(unread)"));

  await choose(row, "Mark as unread");

  assert.ok(heard(row).includes("(unread)"), "the row reads unread");
  assert.deepEqual(seen, [], "nothing is cleared in main for a mark unread");
  assert.deepEqual(JSON.parse(window.localStorage.getItem("luke.taskLooks") ?? "null"), {
    [AGENT_ID]: { unread: true },
  });
  assert.ok(rightClick(row).some((each) => each.textContent === "Mark as read"));
});

test("Mark as read on an agent marked unread by hand reads it again, in the store a task's marks are kept in", async () => {
  const row = mount(RUN);
  await choose(row, "Mark as unread");
  assert.ok(heard(row).includes("(unread)"));

  await choose(row, "Mark as read");

  assert.ok(!heard(row).includes("(unread)"), "the row reads again");
  assert.deepEqual(JSON.parse(window.localStorage.getItem("luke.taskLooks") ?? "null"), {
    [AGENT_ID]: RUN.activityAt,
  });
  assert.ok(rightClick(row).some((each) => each.textContent === "Mark as unread"));
});

test("an agent whose turn ended unseen offers Mark as read, which clears main's unseen dot and moves the mark to its row's time", async () => {
  const row = mount(RUN, new Map(), true);
  assert.ok(heard(row).includes("(unread)"));

  await choose(row, "Mark as read");
  await settle();

  assert.deepEqual(seen, [AGENT_ID]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("luke.taskLooks") ?? "null"), {
    [AGENT_ID]: RUN.activityAt,
  });
});

test("an archived agent's row offers the read mark too, as a task's does", () => {
  const row = mount({ ...RUN, archivedAt: 3 });
  assert.ok(rightClick(row).some((each) => each.textContent === "Mark as unread"));
});

/** The open dialog's button with these words, or a failure saying it offers none. */
function dialogAnswer(words: string): HTMLButtonElement {
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("a dialog asks");
  return (
    [...question.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === words,
    ) ?? assert.fail(`the dialog offers ${words}`)
  );
}

test("Permanently delete stands last and alone in the row's right-click, asks first naming the agent, and once answered deletes it and leaves its page", async () => {
  const row = mount(RUN);
  const items = rightClick(row);
  assert.equal(items.at(-1)?.textContent, "Permanently delete");
  act(() => item(items, "Permanently delete").click());
  await settle();

  assert.deepEqual(deletes, [], "nothing goes before it is answered");
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("it asks first");
  assert.equal(
    document.getElementById(question.getAttribute("aria-describedby") ?? "")?.textContent,
    "“Remove the stale copy” and its transcript will be deleted. This can’t be undone. To keep it out of the way instead, archive it.",
  );
  await act(async () => dialogAnswer("Permanently delete").click());
  await settle();

  assert.deepEqual(deletes, [AGENT_ID]);
  assert.equal(left, 1);
});

test("an archived agent's row offers Permanently delete too, and Cancel deletes nothing", async () => {
  const row = mount({ ...RUN, archivedAt: 3 });
  const remove = item(rightClick(row), "Permanently delete");
  act(() => remove.click());
  await settle();
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("it asks first");
  assert.equal(
    document.getElementById(question.getAttribute("aria-describedby") ?? "")?.textContent,
    "“Remove the stale copy” and its transcript will be deleted. This can’t be undone.",
    "an archived agent is out of the way already",
  );
  await act(async () => dialogAnswer("Cancel").click());
  await settle();

  assert.deepEqual(deletes, []);
  assert.equal(left, 0);
});

/** Hands `onActions` the agent's actions as its tab and its page offer them, every door they open on offered. */
function OfferedActions({
  agent,
  onActions,
}: {
  agent: TasklessAgent;
  onActions: (actions: AgentActions) => void;
}): null {
  const actions = useAgentActions(agent, codingAgentsControl({}), {
    label: agent.title ?? "",
    shown: true,
    terminals: { onOpenTerminal: () => undefined },
  });
  onActions(actions);
  return null;
}

/** The labels of the agent's actions, as its tab and its page offer them, that a row does not leave out by name. */
function sharedOnRow(agent: TasklessAgent): string[] {
  let offered: AgentActions | undefined;
  const container = document.createElement("div");
  const held = createRoot(container);
  act(() =>
    held.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(OfferedActions, {
          agent,
          onActions: (actions) => {
            offered = actions;
          },
        }),
      ),
    ),
  );
  act(() => held.unmount());
  const doors = (offered ?? assert.fail("the actions were offered")).doors;
  const tab = { chosen: false, onClose: undefined, onCloseOthers: undefined, pin: undefined };
  return contentActionGroups({ ...tab, ...rowDoors(doors) })
    .flat()
    .map((each) => each.label);
}

test("every action an agent's tab and page offer stands in its row's right-click unless NOT_ON_A_ROW names it, at rest and archived", () => {
  for (const agent of [RUN, { ...RUN, archivedAt: 3 }]) {
    const shared = sharedOnRow(agent);
    const row = mount(agent);
    const labels = rightClick(row).map((each) => each.textContent);
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";

    assert.ok(shared.length > 0, "the agent offers actions");
    const missing = shared.filter((label) => !labels.includes(label));
    assert.deepEqual(
      missing,
      [],
      "place each on the row (sidebar-agent.tsx) or name it in NOT_ON_A_ROW",
    );
  }
});

test("an agent row's ⋯ opens the menu its right-click does, the ⋯ a Tab stop after its press", () => {
  const row = mount(RUN);
  const more = row.querySelector<HTMLButtonElement>('button[aria-label="Agent actions"]');
  assert.ok(more, "the row draws a ⋯");
  assert.equal(more.tabIndex, 0);
  const labels = () =>
    [...document.querySelectorAll('[role="menuitem"]')].map((each) => each.textContent);
  act(() => more.click());
  const fromMore = labels();
  assert.ok(fromMore.includes("Archive agent"));
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.deepEqual(
    rightClick(row).map((each) => each.textContent),
    fromMore,
  );
});
