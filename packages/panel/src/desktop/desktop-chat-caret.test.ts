// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { CHAT_PLACE, type ChatPlace, FOR_YOU } from "@luke/ui/chat-model";
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
 * desktop-chat-caret.test.ts -- where the caret goes as the window's Chat
 * opens a channel: into its box where a press or a link opened it, and left
 * on the rail where K and J stepped to it, so the keys go on stepping. The
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
  window.localStorage.clear();
});

/** The window's Chat over the fixture's chat, opened on `opened`, its place and its rail's standing its own, as the plans tab holds them. */
function mount(opened: ChatPlace = FOR_YOU): HTMLElement {
  const chat = fixtureChat({ fixtureMode: true }, AT);
  function Page() {
    const [place, setPlace] = useState<ChatPlace>(opened);
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

/** The editor of the box at the shown channel's foot. */
function footBox(page: HTMLElement): HTMLElement {
  const box = page.querySelector<HTMLElement>(".chat-view > section > .chat-composer");
  const editor = box?.querySelector<HTMLElement>(".composer-editor");
  assert.ok(editor, "the channel has its box");
  return editor;
}

/** Lays Chat out this wide, as the window would, and tells it so. */
function layOut(page: HTMLElement, width: number): void {
  const view = page.querySelector<HTMLElement>(".chat-view");
  assert.ok(view, "Chat is drawn");
  vi.spyOn(view, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height: 800 }));
  act(() => relayout());
}

/** Whether the caret stands in `editor`. */
function holdsCaret(editor: HTMLElement): boolean {
  return editor.contains(document.activeElement);
}

test("a channel opened by a press on its row hands the caret to its box", () => {
  const page = mount();
  act(() => railRow(page, "general").focus());
  act(() => railRow(page, "general").click());
  assert.ok(holdsCaret(footBox(page)), "the box takes the caret");
});

test("a channel opened by a link, Chat drawn on it, hands the caret to its box", () => {
  const general = fixtureChat({ fixtureMode: true }, AT)?.answer.channels.find(
    (each) => each.name === "general",
  );
  assert.ok(general, "the fixture holds general");
  const page = mount({ kind: CHAT_PLACE.CHANNEL, channelId: general.id });
  assert.ok(holdsCaret(footBox(page)), "the box takes the caret");
});

test("K and J leave the caret on the rail's row as they step, so the next K or J steps on, and a press after them hands it to the box", () => {
  const page = mount();
  act(() => {
    runAppCommand(APP_COMMAND.NEXT_CHAT_CHANNEL);
  });
  assert.equal(document.activeElement, railRow(page, "general"));
  assert.equal(holdsCaret(footBox(page)), false);
  act(() => {
    runAppCommand(APP_COMMAND.NEXT_CHAT_CHANNEL);
  });
  assert.equal(holdsCaret(footBox(page)), false, "the box stepped to leaves the caret out");
  const stepped = document.activeElement;
  assert.ok(stepped instanceof HTMLElement && stepped.closest(".chat-rail") !== null);

  act(() => railRow(page, "general").click());
  assert.ok(holdsCaret(footBox(page)), "a press opens the channel into its box");
});

test("where a channel stands alone in a narrow Chat, K and J step on to the next with the caret still out of its box", () => {
  const page = mount();
  layOut(page, 760);
  act(() => railRow(page, "general").click());
  assert.ok(holdsCaret(footBox(page)), "the press opens the channel into its box");
  act(() => footBox(page).blur());
  act(() => {
    runAppCommand(APP_COMMAND.NEXT_CHAT_CHANNEL);
  });
  assert.equal(holdsCaret(footBox(page)), false, "the box stepped to leaves the caret out");
  assert.equal(
    runAppCommand(APP_COMMAND.NEXT_CHAT_CHANNEL),
    true,
    "J goes on stepping, the caret in no box",
  );
});

test("a channel K or J stepped to, opened again later by a press, hands the caret to its box", () => {
  const page = mount();
  act(() => {
    runAppCommand(APP_COMMAND.NEXT_CHAT_CHANNEL);
  });
  assert.equal(holdsCaret(footBox(page)), false);
  act(() => railRow(page, "For you").click());
  act(() => railRow(page, "general").click());
  assert.ok(holdsCaret(footBox(page)), "the press opens the channel into its box");
});
