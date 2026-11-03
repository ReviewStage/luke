// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@repo/features/inbox-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handInboxItems, handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl, waitingOf } from "../testing/tasks-control.js";
import { DesktopHome } from "./desktop-home.js";

/**
 * Home greets the reader, opens on New task's composer, lists what waits on
 * them in the listed workspace and its tasks worked on latest, and welcomes
 * an account with nothing yet instead. Synthetic accounts.
 */

const NOW = Date.now();
const MINUTE = 60_000;
const ACME = { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.OWNER, github: null };
const DEAN = { userId: "user-dean", name: "Dean Stratakos" };

function task(n: number, name: string, ago: number): TaskSummary {
  return {
    id: `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: ACME.id,
    name,
    createdAt: NOW - ago - MINUTE,
    updatedAt: NOW - ago,
    repository: "acme/relay",
    ownerId: DEAN.userId,
    createdBy: DEAN,
  };
}

const RETRIES = task(1, "Relay retries on 502", 12 * MINUTE);
const CACHE = task(2, "Edge cache keys", 3 * MINUTE);
const DASHBOARD = task(3, "Retry budget dashboard", 2 * 24 * 60 * MINUTE);
const TASKS = [RETRIES, CACHE, DASHBOARD];

/** An open item of an agent's on `RETRIES`, asking a choice. */
function item(n: number, title: string, ago: number): InboxItem {
  return {
    id: `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, "0")}`,
    agentId: "00000000-0000-4000-8000-000000000001",
    key: String(n),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    thread: [
      {
        id: `e1b2c3d4-0000-4000-8000-${String(n).padStart(12, "0")}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: title,
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Yes" }, { label: "No" }],
          status: INBOX_ASK_STATUS.OPEN,
        },
        createdAt: NOW - ago,
      },
    ],
    postedAt: NOW - ago,
    updatedAt: NOW - ago,
  };
}

const RETRY_429 = item(1, "Retry 429s too?", 8 * MINUTE);

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () =>
      Promise.resolve([{ ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER }]),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  handState({});
  window.localStorage.clear();
  document.body.innerHTML = "";
});

/** Home over Acme with `items` waiting on `RETRIES`, read by Dean, with `overrides`; each task and item it opens recorded. */
function mount(overrides: Partial<TasksControl> = {}, items: readonly InboxItem[] = [RETRY_429]) {
  const opened: { tasks: string[]; items: InboxChoice[] } = { tasks: [], items: [] };
  handInboxItems({
    rows: {
      [INBOX_SCOPE_KIND.PLAN]: items.length === 0 ? {} : { [RETRIES.id]: items },
      [INBOX_SCOPE_KIND.AGENT]: {},
    },
  });
  const holding: Pick<TasksControl, "inbox" | "inboxTasks"> =
    items.length === 0
      ? { inbox: [], inboxTasks: [] }
      : {
          inbox: [{ taskId: RETRIES.id, items: items.map(waitingOf) }],
          inboxTasks: [{ taskId: RETRIES.id, items: items.length, updatedAt: NOW }],
        };
  const tasks = tasksControl({
    me: DEAN.userId,
    listRead: true,
    workspace: ACME,
    tasks: TASKS,
    listed: { tasks: TASKS, ...holding },
    ...holding,
    onSelect: (taskId) => opened.tasks.push(taskId),
    inboxView: {
      ...tasksControl().inboxView,
      onOpenItem: (chosen) => opened.items.push(chosen),
    },
    ...overrides,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopHome, { tasks, accountName: DEAN.name, staged: true }),
      ),
    ),
  );
  return { page: container, opened };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Each section Home draws, by its name, with its rows' names. */
function sections(page: HTMLElement): Record<string, string[]> {
  return Object.fromEntries(
    [...page.querySelectorAll("section.home-section")].map((section) => [
      section.getAttribute("aria-label"),
      [...section.querySelectorAll(".ui-list-row-title")].map((name) => name.textContent),
    ]),
  );
}

/** The row named `name`'s press. */
function row(page: HTMLElement, name: string): HTMLElement {
  return (
    [...page.querySelectorAll<HTMLElement>("li [data-roving-item]")].find((each) =>
      each.textContent?.includes(name),
    ) ?? assert.fail(`the row ${name} stands`)
  );
}

test("Home greets the reader by first name over New task's composer, the items waiting on them, and the tasks worked on latest, newest first", async () => {
  const { page, opened } = mount();
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.ok(page.querySelector(".home-composer .new-task-composer"), "New task's composer stands");
  assert.deepEqual(sections(page), {
    Inbox: [RETRY_429.title],
    Recent: [CACHE.name, RETRIES.name, DASHBOARD.name],
  });

  act(() => row(page, CACHE.name).click());
  act(() => row(page, RETRY_429.title).click());
  assert.deepEqual(opened.tasks, [CACHE.id]);
  assert.deepEqual(
    opened.items.map((chosen) => chosen.itemId),
    [RETRY_429.id],
  );
});

test("↓ and ↑ walk from the Inbox's rows into Recent's as one list", async () => {
  const { page } = mount();
  await settle();
  const first = row(page, RETRY_429.title);
  act(() => first.focus());

  act(() => {
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  assert.ok(document.activeElement === row(page, CACHE.name), "↓ lands on Recent's first task");
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
  });
  assert.ok(document.activeElement === first, "↑ goes back to the Inbox's item");
});

test("nothing waiting says so in the Inbox's words, and a list that could not be read says so under Recent", async () => {
  const quiet = mount({}, []);
  await settle();
  assert.match(quiet.page.textContent ?? "", /Nothing needs you/u);
  act(() => root?.unmount());

  const refused = mount({ listRead: false, listFailed: true }, []);
  await settle();
  assert.match(refused.page.textContent ?? "", /Your tasks could not be read\./u);
});

test("an account with nothing yet is welcomed in Home's place", async () => {
  const { page } = mount({ tasks: [], listed: { tasks: [], inbox: [], inboxTasks: [] } }, []);
  await settle();
  assert.equal(page.querySelector("h1")?.textContent, "Start your first task");
  assert.equal(page.querySelector("section.home-section"), null);
});
