// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import type { ArchivedChannel, Channel } from "@luke/features/channel-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import type { ChannelsControl } from "../tasks/use-channels.js";
import { FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { handHostReads } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { BILLING, item } from "../testing/desktop-inbox.js";
import { tasksControl } from "../testing/tasks-control.js";
import { SidebarChannels } from "./sidebar-channels.js";
import { useSidebarReadAll } from "./sidebar-read-all.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * sidebar-channels.test.ts -- the sidebar's channels under the Inbox: a row
 * posted in since the reader looked stands in the unread weight; its ⋯
 * offers Copy link, Mark all as read, which stamps the reader's look at it
 * and marks its own unread threads read, Edit, and Archive last and alone;
 * Add
 * channel's Browse archived channels lists the archived standing channels,
 * each opened again by its Unarchive, or opened by a press; and Edit asks
 * for a channel's name and purpose, #general's name locked, sending what
 * changed.
 *
 * The service is a script at the act boundary; synthetic channels throughout.
 */

const WORKSPACE_ID = "workspace-1";

function channel(id: string, name: string, seen: Partial<Channel> = {}): Channel {
  return {
    id,
    name,
    purpose: `What goes in #${name}`,
    project: false,
    createdAt: 1,
    waiting: 0,
    ...seen,
  };
}

function archived(id: string, name: string, project: boolean): ArchivedChannel {
  return { id, name, purpose: `What went in #${name}`, project, createdAt: 1, archivedAt: 2 };
}

/** The Billing task's threads, two in #app, one of them read, and one unread in #general. */
const APP_UNREAD = {
  ...item("thread-app-1", "Ship the app?", 3),
  channelId: "c-app",
  unread: true,
};
const APP_READ = { ...item("thread-app-2", "Pin the version?", 2), channelId: "c-app" };
const GENERAL_UNREAD = {
  ...item("thread-general", "Rename the repo?", 1),
  channelId: "c-general",
  unread: true,
};

/** Every channel unarchived, in order. */
let unarchived: string[] = [];
/** Every edit asked, in order. */
let edits: { channelId: string; edit: { name?: string; purpose?: string } }[] = [];
/** Every thread marked read, in order. */
let marked: string[] = [];
/** Every channel looked at, in order. */
let looked: string[] = [];
let root: Root | undefined;

beforeEach(() => {
  unarchived = [];
  edits = [];
  marked = [];
  looked = [];
  fakeActs({
    act: (request): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.AGENTS_INBOX_READ_STATE)
        return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
      marked.push(request.payload.itemId);
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: { id: request.payload.itemId, unread: request.payload.unread },
      });
    },
  });
  handHostReads({
    items: {
      rows: {
        [INBOX_SCOPE_KIND.PLAN]: { [BILLING.id]: [APP_UNREAD, APP_READ, GENERAL_UNREAD] },
        [INBOX_SCOPE_KIND.AGENT]: {},
      },
    },
    channels: {
      [WORKSPACE_ID]: {
        rows: {
          open: [],
          archived: [archived("c-old", "old-app", false), archived("c-launch", "launch", true)],
        },
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The sidebar's channels over `channels`, each channel opened recorded in `opened`; the Billing task changed at `changedAt`, past the feed's items where it is later than 3. */
function mount(channels: readonly Channel[], opened: string[], changedAt = 3): HTMLElement {
  const unasked = () => Promise.resolve(undefined);
  const control: ChannelsControl = {
    channels,
    failed: false,
    onRefresh: () => undefined,
    onCreate: () => Promise.resolve({ refused: "Not asked" }),
    onEdit: (channelId, edit) => {
      edits.push({ channelId, edit });
      return Promise.resolve(undefined);
    },
    onArchive: unasked,
    onUnarchive: (channelId) => {
      unarchived.push(channelId);
      return Promise.resolve(undefined);
    },
    onMove: unasked,
    onLook: (channelId) => {
      looked.push(channelId);
    },
  };
  const tasks = tasksControl({
    tasks: [BILLING],
    inboxTasks: [{ taskId: BILLING.id, items: 3, updatedAt: changedAt }],
  });
  function Channels() {
    return createElement(SidebarChannels, {
      workspaceId: WORKSPACE_ID,
      channels: control,
      waiting: new Map(),
      currentId: undefined,
      shown: true,
      readAll: useSidebarReadAll(tasks),
      onOpen: (channelId) => opened.push(channelId),
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(LinkWorkspaceProvider, { value: WORKSPACE_ID }, createElement(Channels)),
      ),
    ),
  );
  return container;
}

/** Lets the act port's answers land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  });
}

/** The button whose words or name are `label`, anywhere in the page. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.getAttribute("aria-label") === label || each.textContent === label,
  );
  assert.ok(found, `${label} stands`);
  return found;
}

test("a channel posted in since the reader looked stands in the unread weight, one looked at since does not", () => {
  const sidebar = mount(
    [
      channel("c-app", "app", { lookedAt: 1, latestPostedAt: 5 }),
      channel("c-general", "general", { lookedAt: 5, latestPostedAt: 1 }),
    ],
    [],
  );
  const unread = [...sidebar.querySelectorAll('[data-unread="true"]')].map(
    (row) => row.textContent,
  );
  assert.deepEqual(unread, ["app"]);
});

/** The open menu's items as words, a rule between groups drawn as "—". */
function menuWords(): string[] {
  const menu = document.querySelector('[role="menu"]') ?? assert.fail("the menu stands");
  return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((each) =>
    each.getAttribute("role") === "separator" ? "—" : (each.textContent ?? ""),
  );
}

test("a channel's ⋯ offers Copy link and Mark all as read, which stamps the reader's look at it and marks its own unread threads read alone, then Edit, then Archive last and alone", async () => {
  mount([channel("c-app", "app", { lookedAt: 1, latestPostedAt: 5 })], []);
  act(() => button("Channel actions").click());
  await settle();
  const words = menuWords().map((each) => each.replace(/[⇧⌥⌘⌃]+.$/u, ""));
  assert.deepEqual(words, ["Copy link", "Mark all as read", "—", "Edit…", "—", "Archive"]);
  act(() =>
    (
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (each) => each.textContent === "Mark all as read",
      ) ?? assert.fail("the menu offers Mark all as read")
    ).click(),
  );
  await settle();
  assert.deepEqual(marked, [APP_UNREAD.id]);
  assert.deepEqual(looked, ["c-app"]);
});

test("a channel's Mark all as read stands disabled while the feed has not answered for its threads, though the channel is unread", async () => {
  mount([channel("c-app", "app", { lookedAt: 1, latestPostedAt: 5 })], [], 99);
  act(() => button("Channel actions").click());
  await settle();
  const markAll =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Mark all as read",
    ) ?? assert.fail("the menu offers Mark all as read");
  assert.equal(markAll.matches(":disabled, [aria-disabled='true'], [data-disabled]"), true);
});

test("Browse archived channels lists the archived standing channels, Unarchive opens one again, and a press opens one", async () => {
  const opened: string[] = [];
  mount([channel("c-general", "general")], opened);
  act(() => button("Add channel").click());
  act(() =>
    (
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === "Browse archived channels",
      ) ?? assert.fail("Add channel offers the archived channels")
    ).click(),
  );
  await settle();
  const dialog = document.querySelector('[role="dialog"]') ?? assert.fail("the dialog stands");
  assert.match(dialog.textContent ?? "", /#old-app/u);
  assert.doesNotMatch(
    dialog.textContent ?? "",
    /#launch/u,
    "a project's channel is listed with the archived project channels",
  );

  act(() => button("Unarchive").click());
  await settle();
  assert.deepEqual(unarchived, ["c-old"]);

  act(() =>
    (
      [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
        each.textContent?.startsWith("#old-app"),
      ) ?? assert.fail("the archived channel's row stands")
    ).click(),
  );
  assert.deepEqual(opened, ["c-old"]);
});

test("Edit on #general fills in its purpose, keeps its name locked, and sends only the purpose changed", async () => {
  const sidebar = mount([channel("c-general", "general")], []);
  const row =
    [...sidebar.querySelectorAll<HTMLElement>("button")].find((each) =>
      each.textContent?.startsWith("general"),
    ) ?? assert.fail("#general is listed");
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 4, clientY: 4 }));
  });
  act(() =>
    (
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === "Edit…",
      ) ?? assert.fail("the menu offers Edit")
    ).click(),
  );
  const dialog = document.querySelector('[role="dialog"]') ?? assert.fail("the dialog stands");
  const [name, purpose] = [...dialog.querySelectorAll<HTMLInputElement>("input")];
  assert.ok(name !== undefined && purpose !== undefined, "the dialog asks for both");
  assert.equal(name.value, "general");
  assert.equal(name.disabled, true, "#general's name is locked");
  assert.equal(purpose.value, "What goes in #general");
  assert.equal(button("Save").disabled, true, "nothing changed yet");

  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      purpose,
      "Anything that cuts across",
    );
    purpose.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => button("Save").click());
  await settle();
  assert.deepEqual(edits, [
    { channelId: "c-general", edit: { purpose: "Anything that cuts across" } },
  ]);
});
