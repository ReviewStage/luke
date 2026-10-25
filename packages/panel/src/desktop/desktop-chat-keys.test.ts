// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { type ChatPlace, FOR_YOU } from "@luke/ui/chat-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { SHELL_ROOM } from "../shell-room.js";
import { fixtureChat } from "../tasks/chat-fixture.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { relayout } from "../testing/resize-observer.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopChat } from "./desktop-chat.js";

/**
 * desktop-chat-keys.test.ts -- the window's Chat as the Inbox works: its
 * attention marks, its K, J, and ⇧J through the rail, and one column at a
 * time by its own width, under a way back that Escape takes too. The
 * fixture's chat throughout.
 */

/** The moment the fixture's messages are stamped before. */
const AT = Date.parse("2026-10-14T10:00:00Z");

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));
beforeAll(() => Effect.runPromise(editorBundleLanded));
beforeAll(installEditorLayout);

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** What Chat told its holder of its own columns, the latest last. */
let singles: boolean[] = [];

/** The window's Chat over the fixture's chat, on For you and its rail, its place and its rail's standing its own, as the plans tab holds them. */
function mount(): HTMLElement {
  singles = [];
  const chat = fixtureChat({ fixtureMode: true }, AT);
  function Page() {
    const [place, setPlace] = useState<ChatPlace>(FOR_YOU);
    const [listed, setListed] = useState(true);
    return createElement(DesktopChat, {
      room: SHELL_ROOM.WIDE,
      accountName: "Dean Stratakos",
      tasks: tasksControl({
        chatView: {
          ...tasksControl().chatView,
          open: true,
          available: true,
          chat,
          place,
          listed,
          onChoose: (chosen) => {
            setPlace(chosen);
            setListed(false);
          },
          onList: () => setListed(true),
          onSingle: (single) => singles.push(single),
        },
      }),
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Page))));
  return container;
}

/** A place's row in the rail, by its name. */
function railRow(page: HTMLElement, name: string): HTMLButtonElement {
  const row = [
    ...page.querySelectorAll<HTMLButtonElement>(".chat-rail li .luke-list-row-main"),
  ].find((each) => each.querySelector(".luke-list-row-title")?.textContent === name);
  assert.ok(row, `no row for ${name}`);
  return row;
}

/** The place the rail marks as shown, by its name. */
function shown(page: HTMLElement): string | undefined {
  return (
    page.querySelector('.chat-rail [aria-current="page"] .luke-list-row-title')?.textContent ??
    undefined
  );
}

/** What a row wears: the blue dot where something waits unread, the attention mark where something needs the reader. */
function marks(row: HTMLElement): { unread: boolean; needsYou: boolean } {
  const item = row.closest("li");
  return {
    unread: item?.querySelector(".inbox-row-unread") !== null,
    needsYou: item?.querySelector(".inbox-row-attention .attention-mark") !== null,
  };
}

/** Lays Chat out this wide, as the window would, and tells it so. */
function layOut(page: HTMLElement, width: number): void {
  const view = page.querySelector<HTMLElement>(".chat-view");
  assert.ok(view, "Chat is drawn");
  vi.spyOn(view, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height: 800 }));
  act(() => relayout());
}

test("For you and a channel holding an ask that waits on the developer wear the Inbox's attention mark, and the blue dot is for the unread alone", () => {
  const page = mount();
  assert.deepEqual(marks(railRow(page, "For you")), { unread: false, needsYou: true });
  assert.deepEqual(marks(railRow(page, "teammate-invitations")), {
    unread: true,
    needsYou: true,
  });
  assert.deepEqual(marks(railRow(page, "general")), { unread: false, needsYou: false });
});

test("K and J step through the rail as drawn and stop at its ends, ⇧J goes to the next channel holding anything unread, and the row stepped to takes the keyboard", () => {
  const page = mount();
  assert.equal(runAppCommand(APP_COMMAND.PREVIOUS_CHAT_CHANNEL), false, "For you heads the rail");
  act(() => {
    runAppCommand(APP_COMMAND.NEXT_CHAT_CHANNEL);
  });
  assert.equal(shown(page), "general");
  assert.equal(document.activeElement, railRow(page, "general"));
  act(() => {
    runAppCommand(APP_COMMAND.NEXT_UNREAD_CHAT_CHANNEL);
  });
  assert.equal(shown(page), "teammate-invitations");
  assert.equal(document.activeElement, railRow(page, "teammate-invitations"));
  act(() => {
    runAppCommand(APP_COMMAND.PREVIOUS_CHAT_CHANNEL);
  });
  assert.equal(shown(page), "billing-export");
  assert.equal(
    runAppCommand(APP_COMMAND.NEXT_UNREAD_CHAT_CHANNEL),
    true,
    "the next unread wraps round to the one channel holding any",
  );
});

test("the rail's rows, For you's and every group's, are one Tab stop that ↓ walks from list to list", () => {
  const page = mount();
  const stops = () =>
    [...page.querySelectorAll<HTMLButtonElement>(".chat-rail li .luke-list-row-main")].filter(
      (row) => row.tabIndex === 0,
    );
  assert.deepEqual(stops(), [railRow(page, "For you")], "Tab lands on the rail once");
  act(() => railRow(page, "For you").focus());
  act(() => {
    railRow(page, "For you").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
  });
  assert.equal(document.activeElement, railRow(page, "general"), "↓ crosses into the next group");
  assert.deepEqual(stops(), [railRow(page, "general")]);
});

test("Chat narrower than the Inbox's line by its own width shows its rail, then the place chosen alone under a way back naming Back's chord, which Escape takes too", () => {
  const page = mount();
  const rail = () => page.querySelector<HTMLElement>(".chat-rail");
  const pane = () => page.querySelector<HTMLElement>(".chat-view > section");
  layOut(page, 1000);
  assert.equal(page.querySelector(".chat-view")?.getAttribute("data-single"), "false");
  assert.equal(rail()?.hidden, false);
  assert.equal(pane()?.hidden, false);

  layOut(page, 760);
  assert.equal(page.querySelector(".chat-view")?.getAttribute("data-single"), "true");
  assert.equal(singles.at(-1), true, "the holder hears Chat shows one column, for its history");
  assert.equal(rail()?.hidden, false, "Chat narrowed on its rail shows the rail");
  assert.equal(pane()?.hidden, true);
  assert.equal(runAppCommand(APP_COMMAND.CHAT_LIST), false, "the rail has nothing to go back to");

  act(() => railRow(page, "general").click());
  assert.equal(rail()?.hidden, true);
  assert.equal(pane()?.hidden, false);
  const back = pane()?.querySelector<HTMLElement>('[aria-keyshortcuts="Meta+["]');
  assert.ok(back, "the way back names Back's chord");
  assert.equal(back.textContent, "Chat");

  act(() => {
    runAppCommand(APP_COMMAND.CHAT_LIST);
  });
  assert.equal(rail()?.hidden, false, "Escape steps back to the rail");
  assert.equal(pane()?.hidden, true);
});
