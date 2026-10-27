// @vitest-environment jsdom

import assert from "node:assert/strict";
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
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { playMotions } from "../testing/pane-motion.js";
import { INBOX_COLUMNS, useInboxRowPresses } from "./inbox-columns.js";
import { InboxList } from "./inbox-list.js";
import { INBOX_GROUPING, INBOX_HOLDER, type InboxListView } from "./inbox-model.js";

/**
 * inbox-list-motion.test.ts -- a row leaving the Inbox's list fades where it
 * stood, though a row arriving above it in the same change moved it, and a
 * group leaving takes the room above the group after it with it, so what
 * glides up lands where the list stands once the group is gone. Synthetic
 * items; jsdom lays nothing out, so each row's place is given.
 */

/** How tall a row is drawn, in the layout given. */
const ROW = 50;

/** The motion tokens the list reads, as the window's sheets set them. */
const TOKENS = {
  "--luke-duration-exit": "90ms",
  "--luke-motion-exit": "ease",
  "--luke-duration-shape": "460ms",
  "--luke-spring": "ease-out",
} as const;

let root: Root | undefined;
let laid: HTMLStyleElement | undefined;

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  laid?.remove();
  laid = undefined;
  document.body.innerHTML = "";
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  vi.restoreAllMocks();
});

/** An open item of one agent's, titled by its letter. */
function item(letter: string): InboxItem {
  return {
    id: `a1b2c3d4-0000-4000-8000-00000000000${letter.charCodeAt(0) - 64}`,
    agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    key: letter,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: letter,
    thread: [
      {
        id: `e1b2c3d4-0000-4000-8000-00000000000${letter.charCodeAt(0) - 64}`,
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
    updatedAt: 1_000,
  };
}

/** The task every item stands under. */
const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

/** The items as one run lists them. */
function run(letters: string): InboxListView {
  return {
    readerId: undefined,
    grouping: INBOX_GROUPING.NONE,
    items: [...letters].map((letter) => ({
      holder: { kind: INBOX_HOLDER.TASK, task: TASK },
      item: item(letter),
    })),
  };
}

/** Moves the list to another view, as the Inbox's reads do. */
let showView: (view: InboxListView) => void = () => undefined;

/** The list alone over `first`, its motion's tokens set and its motions recorded. */
function mount(first: InboxListView) {
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  const motions = playMotions();
  function List() {
    const [view, setView] = useState(first);
    showView = setView;
    const rows = useInboxRowPresses();
    return createElement(InboxList, {
      view,
      chosen: undefined,
      models: undefined,
      readerId: undefined,
      head: {
        shown: true,
        show: { show: "all", onShow: () => undefined } as never,
        view: undefined,
      },
      note: null,
      columns: INBOX_COLUMNS.BOTH,
      rows,
      onChoose: () => undefined,
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(List))));
  return motions;
}

/** A row by its title. */
function rowOf(title: string): HTMLElement {
  const titled = [...document.querySelectorAll(".luke-list-row-title")].find(
    (each) => each.textContent === title,
  );
  return titled?.closest("li") ?? assert.fail(`no row for ${title}`);
}

test("a row leaving as another arrives above it fades where it stood before the change, and the row the arrival pushed down glides from where it was", () => {
  const motions = mount(run("ABC"));
  // Note that each row in the layout stands under the ones before it, and one laid over its place stands where its top says.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    let top = 0;
    if (this.matches(".sidebar-tasks > li")) {
      const laidOut = [...(this.parentElement?.children ?? [])].filter(
        (each) => !(each instanceof HTMLElement) || each.style.position !== "absolute",
      );
      top =
        this.style.position === "absolute"
          ? Number.parseFloat(this.style.top)
          : laidOut.indexOf(this) * ROW;
    }
    return { top, bottom: top + ROW, left: 0, right: 0, width: 0, height: ROW } as DOMRect;
  });

  act(() => showView(run("XAC")));
  const leaving = rowOf("B");
  assert.equal(leaving.hasAttribute("data-leaving"), true);
  assert.equal(leaving.style.top, `${ROW}px`, "where B stood, not under X");
  const glide = motions.played.find((each) => each.element === rowOf("A"));
  assert.deepEqual(glide?.keyframes[0], { transform: `translate(0px, ${-ROW}px)` });
});

test("a group leaving takes the room above the group after it at once, so that group stands where it will once the leaving one is gone", () => {
  laid = layContainersAt({});
  const body = document.body.appendChild(document.createElement("div"));
  body.className = "inbox-tasks-body";
  const group = () => {
    const drawn = body.appendChild(document.createElement("div"));
    drawn.className = "sidebar-repository";
    return drawn;
  };
  const [first, second, third] = [group(), group(), group()];
  const roomAbove = (group: HTMLElement) => getComputedStyle(group).marginTop;
  const spaced = roomAbove(third);
  assert.notEqual(spaced, "0px", "groups stand apart");

  first.dataset.leaving = "";
  assert.equal(roomAbove(second), "0px", "the first group in the layout has no room above it");
  assert.equal(roomAbove(third), spaced);

  delete first.dataset.leaving;
  second.dataset.leaving = "";
  assert.equal(roomAbove(third), spaced, "a group after one still in the layout keeps its room");
});
