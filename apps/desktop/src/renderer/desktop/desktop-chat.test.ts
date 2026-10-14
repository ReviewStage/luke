// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { type ChatPlace, FOR_YOU } from "@luke/ui/chat-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { tasksControl } from "#testing/tasks-control";
import { fixtureChat } from "../tasks/chat-fixture";
import { DesktopChat } from "./desktop-chat";

/** The moment the fixture's messages are stamped before. */
const AT = Date.parse("2026-10-14T10:00:00Z");

// A message's words are drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

let root: Root | undefined;

beforeEach(() => {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The window's Chat over the fixture's chat, its place its own, as the plans tab holds it. */
function mount(): HTMLElement {
  const chat = fixtureChat({ fixtureMode: true }, AT);
  function Page() {
    const [place, setPlace] = useState<ChatPlace>(FOR_YOU);
    return createElement(DesktopChat, {
      accountName: "Dean Stratakos",
      tasks: tasksControl({
        chatView: {
          open: true,
          chat,
          place,
          onOpen: () => undefined,
          onClose: () => undefined,
          onChoose: setPlace,
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

/** The rail as a reader hears it: each heading, then each row's name and count, `▸ ` where shown. */
function rail(page: HTMLElement): string[] {
  const nav = page.querySelector(".chat-rail");
  assert.ok(nav, "the rail is drawn");
  return [...nav.querySelectorAll(".chat-rail-heading, .sidebar-task")].map((node) => {
    if (node.classList.contains("chat-rail-heading")) return `# ${node.textContent}`;
    const name = node.querySelector(".sidebar-task-name")?.textContent ?? "";
    const count = node.querySelector(".chat-rail-count")?.firstChild?.textContent;
    const shown = node.getAttribute("aria-current") === "page" ? "▸ " : "";
    return `${shown}${name}${count === undefined ? "" : ` (${count})`}`;
  });
}

/** The pane's messages as a reader hears them: each author and where it was posted, then its replies where the thread is open. */
function stream(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".chat-message, .chat-reply")].map((node) => {
    const author = node.querySelector(".chat-author")?.textContent ?? "";
    const where = node.querySelector(":scope > .chat-message-body > .chat-byline .chat-where");
    const indent = node.classList.contains("chat-reply") ? "  ↳ " : "";
    return `${indent}${author}${where === null ? "" : ` ${where.textContent}`}`;
  });
}

function railRow(page: HTMLElement, name: string): HTMLButtonElement {
  const row = [...page.querySelectorAll<HTMLButtonElement>(".chat-rail .sidebar-task")].find(
    (each) => each.querySelector(".sidebar-task-name")?.textContent === name,
  );
  assert.ok(row, `no row for ${name}`);
  return row;
}

test("Chat opens on For you, whose open asks come first, the oldest first, then the direct message and the mention waiting on the developer, beside a rail counting what each place holds unread", () => {
  const page = mount();
  assert.deepEqual(rail(page), [
    "▸ For you (4)",
    "# Channels",
    "general",
    "billing-export",
    "teammate-invitations (4)",
    "members-schema",
    "# Direct messages",
    "agent-2 (1)",
    "luke",
    "agent-1",
    "maria",
  ]);
  assert.deepEqual(stream(page), [
    "Add teammate invitations in #teammate-invitations",
    "Invite emails in #teammate-invitations",
    "Invite emails direct message",
    "Luke in #teammate-invitations",
  ]);
});

test("a press on a channel shows its messages in the order posted, a thread folded under its root until a press opens it", () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  assert.equal(page.querySelector(".chat-head-title")?.textContent, "# teammate-invitations");
  assert.equal(railRow(page, "teammate-invitations").getAttribute("aria-current"), "page");
  assert.deepEqual(stream(page), [
    "Add teammate invitations",
    "Invite emails",
    "Add teammate invitations",
    "Luke",
    "Invite emails",
    "Dean Stratakos",
  ]);
  const toggle = page.querySelector<HTMLButtonElement>(".chat-thread-toggle");
  assert.equal(toggle?.textContent, "View thread · 2 replies");
  act(() => toggle?.click());
  assert.deepEqual(stream(page).slice(0, 4), [
    "Add teammate invitations",
    "Invite emails",
    "  ↳ Add teammate invitations",
    "  ↳ Invite emails",
  ]);
});
