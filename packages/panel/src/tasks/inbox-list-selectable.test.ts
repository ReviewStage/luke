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
import { selectableListBehaviour } from "@luke/ui/testing/selectable-list";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { INBOX_COLUMNS, useInboxRowPresses } from "./inbox-columns.js";
import { InboxList } from "./inbox-list.js";
import { INBOX_GROUPING, INBOX_HOLDER, type InboxListView } from "./inbox-model.js";

/**
 * inbox-list-selectable.test.ts -- the Inbox's list chooses its items as
 * every selectable list does (`@luke/ui/testing/selectable-list`). The list
 * alone over five open items of one task; the key of each is its item's id.
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
  items: [1, 2, 3, 4, 5].map((number) => ({
    holder: { kind: INBOX_HOLDER.TASK, task: TASK },
    item: item(number),
  })),
};

/** The list drawn over `VIEW`, and the ids of the items it was asked to open. */
function mount() {
  fakeAppPlatform(QUIET_PANEL);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  const opened: string[] = [];
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
      onChoose: (listed) => opened.push(listed.item.id),
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(container);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Inbox))));
  return {
    root: container,
    opened: () => opened,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
}

selectableListBehaviour("INBOX", { mount });
