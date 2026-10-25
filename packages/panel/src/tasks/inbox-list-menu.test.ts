// @vitest-environment jsdom

import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { INBOX_COLUMNS, useInboxRowPresses } from "./inbox-columns.js";
import { InboxList } from "./inbox-list.js";
import { INBOX_GROUPING, INBOX_HOLDER, type InboxListView } from "./inbox-model.js";

/**
 * inbox-list-menu.test.ts -- an Inbox item's row offers its menu the one way
 * every row does (`ListRow`'s `menu`): a right-click on the row, its ⋯ named
 * "Inbox item actions", which the keyboard reaches and a reader hears
 * described by the item's title, and the menu key all open the same menu,
 * its items worded as ⌘K words them, and none opens the item. The list alone
 * over two unread items of one task, the first of which the list marks.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

/** An open item of one agent's, the `number`th. */
function item(number: number): InboxItem {
  return {
    id: `a1b2c3d4-0000-4000-8000-00000000000${number}`,
    agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    key: `K${number}`,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: `Question ${number}`,
    thread: [
      {
        id: `e1b2c3d4-0000-4000-8000-00000000000${number}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Approve or decline.",
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Approve" }, { label: "Decline" }],
          status: INBOX_ASK_STATUS.OPEN,
        },
        createdAt: 1_000,
      },
    ],
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000 - number,
  };
}

const VIEW: InboxListView = {
  readerId: undefined,
  grouping: INBOX_GROUPING.NONE,
  items: [1, 2].map((number) => ({
    holder: { kind: INBOX_HOLDER.TASK, task: TASK },
    item: item(number),
  })),
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The list drawn over `VIEW`, with what it was asked to open, `chosen` the item it has chosen. */
function mount(chosen?: string): { opened: string[]; marked: string[] } {
  fakeAppPlatform(QUIET_PANEL);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  const opened: string[] = [];
  const marked: string[] = [];
  function Inbox() {
    return createElement(InboxList, {
      view: VIEW,
      chosen,
      models: undefined,
      readerId: undefined,
      head: {
        shown: true,
        show: { show: "all", onShow: () => undefined } as never,
        view: undefined,
      },
      note: null,
      columns: INBOX_COLUMNS.BOTH,
      rows: useInboxRowPresses(),
      onChoose: (listed) => opened.push(listed.item.id),
      onMark: async (listed) => {
        marked.push(listed.item.id);
        return true;
      },
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Inbox))));
  return { opened, marked };
}

/** The first row of the list, its item. */
function firstRow(): HTMLElement {
  const row = document.querySelector<HTMLElement>(".luke-list-row");
  if (row === null) throw new Error("No row drawn");
  return row;
}

/** The row's ⋯, named for what the row is. */
function moreOf(row: HTMLElement): HTMLButtonElement {
  const more = row.querySelector<HTMLButtonElement>("button[aria-label='Inbox item actions']");
  if (more === null) throw new Error("The row offers no ⋯");
  return more;
}

/** The words of the items of the menu standing open, none while there is none. */
function menuItems(): string[] {
  return [...document.querySelectorAll('[role="menu"]:not([data-leaving]) [role="menuitem"]')].map(
    (entry) => entry.textContent ?? "",
  );
}

/** Closes the menu standing open, as Escape does. */
function closeMenu(): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

test("a right-click on a row opens its menu, offering to mark the item read or unread, and opens no item", () => {
  const { opened } = mount();
  act(() => {
    firstRow()
      .querySelector("button")
      ?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 8 }),
      );
  });

  expect(menuItems().some((words) => words.startsWith("Mark as"))).toBe(true);
  expect(opened).toEqual([]);
});

test("a row's ⋯ takes the keyboard's focus, is described by the item's title, and opens the same menu as the menu key on the row", () => {
  const { opened, marked } = mount();
  const row = firstRow();
  const more = moreOf(row);
  expect(more.tabIndex).not.toBe(-1);
  act(() => more.focus());
  expect(document.activeElement).toBe(more);
  const describer = more.getAttribute("aria-describedby");
  expect(describer === null ? null : document.getElementById(describer)?.textContent).toBe(
    "Question 1",
  );

  act(() => more.click());
  const fromMore = menuItems();
  expect(fromMore.length).toBeGreaterThan(0);
  closeMenu();
  expect(menuItems()).toEqual([]);

  const press = row.querySelector<HTMLElement>("button.luke-list-row-main");
  act(() => {
    press?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }),
    );
  });
  expect(menuItems()).toEqual(fromMore);

  const read = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) =>
    entry.textContent?.startsWith("Mark as"),
  );
  act(() => read?.click());
  expect(marked).toEqual([VIEW.items[0]?.item.id]);
  expect(opened).toEqual([]);
});

test("a row's mail button names U only on the chosen item, the one U acts on", () => {
  mount(VIEW.items[1]?.item.id);
  const rows = [...document.querySelectorAll<HTMLElement>(".luke-list-row")];
  const mail = (row: HTMLElement | undefined) =>
    row?.querySelector("button[aria-label^='Mark as']")?.getAttribute("aria-keyshortcuts");

  expect(rows.length).toBe(2);
  expect(mail(rows[0])).toBeNull();
  expect(mail(rows[1])).toBeTruthy();
});
