// @vitest-environment jsdom

import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { GLYPH, type Glyph } from "@luke/ui/icons";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { INBOX_COLUMNS, useInboxRowPresses } from "./inbox-columns.js";
import { InboxList } from "./inbox-list.js";
import { INBOX_GROUPING, INBOX_HOLDER, type InboxListView } from "./inbox-model.js";

/**
 * inbox-list-glyphs.test.ts -- the Inbox draws each of its concepts with the
 * registry's one glyph for it: an open "decide" ask leads its row's line with
 * `GLYPH.DECIDE`, never the GitHub issue's `CircleDot`; the agents no
 * automation names head their group with `GLYPH.AUTOMATION`, as every other
 * place draws an automation; and the row's menu offers to close the item with
 * `GLYPH.CLOSE`, the act, not the closed state's slashed circle. Synthetic item.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ITEM: InboxItem = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  key: "threshold",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Alert at 80%?",
  thread: [
    {
      id: "e1b2c3d4-0000-4000-8000-000000000001",
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

const VIEW: InboxListView = {
  readerId: undefined,
  grouping: INBOX_GROUPING.TASK,
  groups: [
    {
      holder: {
        kind: INBOX_HOLDER.AUTOMATION,
        automationId: null,
        name: "Other agents",
        repository: "acme/relay",
        agents: new Map(),
      },
      items: [ITEM],
    },
  ],
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The list drawn over `VIEW`, grouped by what holds each item, offering to close an open item. */
function mount(): void {
  fakeAppPlatform(QUIET_PANEL);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  function Inbox() {
    return createElement(InboxList, {
      view: VIEW,
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
      rows: useInboxRowPresses(),
      onChoose: () => undefined,
      onClose: async () => true,
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Inbox))));
}

/** The markup `glyph` draws, as any place seating it draws it. */
function drawn(glyph: Glyph): string {
  return renderToStaticMarkup(createElement(glyph));
}

/** Every glyph drawn inside `within`, by its markup. */
function glyphsIn(within: ParentNode): string[] {
  return [...within.querySelectorAll("svg")].map((svg) => svg.outerHTML);
}

test("an open decide ask leads its row's line with the decide glyph, never the issue's", () => {
  mount();
  const line = document.querySelector<HTMLElement>(".inbox-row-line");
  if (line === null) throw new Error("The row draws no line");
  expect(glyphsIn(line)).toEqual([drawn(GLYPH.DECIDE)]);
  expect(glyphsIn(document)).not.toContain(drawn(GLYPH.ISSUE));
});

test("the agents no automation names head their group with the automation glyph", () => {
  mount();
  expect(glyphsIn(document)).toContain(drawn(GLYPH.AUTOMATION));
});

test("the row's menu offers to close the item with the Close glyph, not the closed state's", () => {
  mount();
  act(() => {
    document
      .querySelector(".luke-list-row button")
      ?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 8 }),
      );
  });
  const close = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((entry) =>
    entry.textContent?.startsWith("Resolve without answering"),
  );
  if (close === undefined) throw new Error("The menu offers no close");
  expect(glyphsIn(close)).toEqual([drawn(GLYPH.CLOSE)]);
  expect(glyphsIn(close)).not.toContain(drawn(GLYPH.DISMISSED));
});
