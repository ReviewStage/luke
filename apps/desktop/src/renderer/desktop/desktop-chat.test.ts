// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ASK_STATUS, CHAT_ASK } from "@luke/features/chat-wire";
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
import {
  type FixtureChat,
  fixtureChat,
  type Staged,
  stagedAnswer,
  stagedPost,
} from "../tasks/chat-fixture";
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
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The window's Chat over the fixture's chat, changed as the test asks, its place and its posts its own, as the plans tab holds them. */
function mount(change: (chat: FixtureChat) => FixtureChat = (chat) => chat): HTMLElement {
  function Page() {
    const [place, setPlace] = useState<ChatPlace>(FOR_YOU);
    const [chat, setChat] = useState<FixtureChat | undefined>(() => {
      const staged = fixtureChat({ fixtureMode: true }, AT);
      return staged === undefined ? undefined : change(staged);
    });
    const stage = (staged: (held: FixtureChat) => Staged) => {
      const landed = chat === undefined ? { refused: "No chat." } : staged(chat);
      if ("chat" in landed) setChat(landed.chat);
      return Promise.resolve("refused" in landed ? landed.refused : undefined);
    };
    return createElement(DesktopChat, {
      accountName: "Dean Stratakos",
      tasks: tasksControl({
        chatView: {
          open: true,
          available: true,
          chat,
          failed: false,
          onRetry: () => undefined,
          place,
          onOpen: () => undefined,
          onClose: () => undefined,
          onChoose: setPlace,
          onShow: setPlace,
          onPost: (post) => stage((held) => stagedPost(held, post, AT)),
          onAnswer: (answer) => stage((held) => stagedAnswer(held, answer, AT)),
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
  const toggle = page.querySelector<HTMLButtonElement>(
    '.chat-message[data-seq="43"] .chat-thread-toggle',
  );
  assert.equal(toggle?.textContent, "View thread · 2 replies");
  act(() => toggle?.click());
  assert.deepEqual(stream(page).slice(0, 4), [
    "Add teammate invitations",
    "Invite emails",
    "  ↳ Add teammate invitations",
    "  ↳ Invite emails",
  ]);
});

test("an ask posted in a direct message is listed among For you's asks as a direct message, never as a channel", () => {
  const page = mount((chat) => ({
    ...chat,
    answer: {
      ...chat.answer,
      messages: chat.answer.messages.map((message) =>
        message.seq === 47
          ? {
              ...message,
              ask: {
                key: "take-invite-file",
                revision: 1,
                status: ASK_STATUS.OPEN,
                needsReply: true,
                response: { type: CHAT_ASK.APPROVAL },
              },
            }
          : message,
      ),
    },
  }));
  assert.deepEqual(stream(page).slice(0, 3), [
    "Add teammate invitations in #teammate-invitations",
    "Invite emails direct message",
    "Invite emails in #teammate-invitations",
  ]);
});

/** Types the words into a box, as a person typing them would leave it, the caret at their end. */
function typeInto(field: HTMLTextAreaElement, text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(field: HTMLElement, key: string): void {
  act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

function boxNamed(page: HTMLElement, label: string): HTMLTextAreaElement {
  const box = page.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  assert.ok(box, `no box ${label}`);
  return box;
}

/** The text of every message's words in the pane, in order, a reply's indented. */
function words(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".chat-message, .chat-reply")].map((node) => {
    const indent = node.classList.contains("chat-reply") ? "  ↳ " : "";
    const body = node.querySelector(":scope > .chat-message-body > .chat-words");
    return `${indent}${body?.textContent?.trim() ?? ""}`;
  });
}

test("a channel's composer offers its members as an @ is typed, writes the one chosen, and posts to the channel on Enter, leaving the box empty", async () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInto(box, "@age");
  const options = [...page.querySelectorAll('[role="option"]')].map((row) => row.textContent);
  assert.deepEqual(options, ["@agent-1Add teammate invitations", "@agent-2Invite emails"]);
  press(box, "ArrowDown");
  press(box, "Enter");
  assert.equal(box.value, "@agent-2 ");
  assert.equal(page.querySelector('[role="listbox"]'), null);
  typeInto(box, "@agent-2 hold the template until #214 lands");
  press(box, "Enter");
  await settle();
  assert.equal(box.value, "");
  assert.equal(words(page).at(-1), "@agent-2 hold the template until #214 lands");
  assert.equal(stream(page).at(-1), "Dean Stratakos");
});

test("an open choice in For you is answered by a pick and its send, which marks the pick, says who answered, and leaves For you's count one less", async () => {
  const page = mount();
  const card = page.querySelector<HTMLElement>('.chat-ask[data-status="open"]');
  assert.ok(card, "the choice's card stands open");
  const fourteen = [...card.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((option) =>
    option.textContent?.startsWith("14 days"),
  );
  act(() => fourteen?.click());
  const send = card.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
  assert.equal(send?.disabled, false);
  act(() => send?.click());
  await settle();
  assert.equal(rail(page)[0], "▸ For you (3)");
  // The answered ask leaves For you, so the channel shows it settled.
  act(() => railRow(page, "teammate-invitations").click());
  const settled = page.querySelector('.chat-ask[data-status="answered"]');
  assert.equal(
    [...(settled?.querySelectorAll("li") ?? [])]
      .find((option) => option.textContent?.includes("Picked"))
      ?.textContent?.startsWith("14 days"),
    true,
  );
  assert.equal(
    settled?.querySelector(".chat-ask-settled")?.textContent,
    'Dean Stratakos: Chose "14 days".',
  );
});

test("an approval is answered by its press, and a reply typed under an opened thread lands in that thread", async () => {
  const page = mount();
  const approval = [...page.querySelectorAll<HTMLElement>('.chat-ask[data-status="open"]')].find(
    (card) => card.querySelector(".chat-ask-kind")?.textContent === "Ask · Approval",
  );
  const approve = [...(approval?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Approve",
  );
  act(() => approve?.click());
  await settle();
  assert.equal(rail(page)[0], "▸ For you (3)");

  act(() => railRow(page, "teammate-invitations").click());
  const toggle = page.querySelector<HTMLButtonElement>(
    '.chat-message[data-seq="48"] .chat-thread-toggle',
  );
  act(() => toggle?.click());
  const reply = boxNamed(page, "Reply in thread");
  typeInto(reply, "Thanks, both.");
  press(reply, "Enter");
  await settle();
  assert.deepEqual(
    words(page).filter((line) => line.startsWith("  ↳ ")),
    [
      "  ↳ Fine by me. I'll keep off memberships until it lands.",
      "  ↳ Holding the template until #214 merges; doing the resend endpoint meanwhile.",
      "  ↳ Thanks, both.",
    ],
  );
});

test("a form's answer stands under its card field by field, and the reply in its thread says the same", async () => {
  const page = mount((chat) => ({
    ...chat,
    answer: {
      ...chat.answer,
      messages: chat.answer.messages.map((message) =>
        message.seq === 51 && message.ask !== undefined
          ? {
              ...message,
              ask: {
                ...message.ask,
                title: "Where do the seats go?",
                response: {
                  type: CHAT_ASK.FORM,
                  fields: [
                    { type: "text", label: "Region", required: true },
                    { type: "number", label: "Seats" },
                  ],
                },
              },
            }
          : message,
      ),
    },
  }));
  const card = [...page.querySelectorAll<HTMLElement>('.chat-ask[data-status="open"]')].find(
    (each) => each.querySelector(".chat-ask-title")?.textContent === "Where do the seats go?",
  );
  assert.ok(card, "the form's card stands open");
  const [region, seats] = [...card.querySelectorAll<HTMLInputElement>("input")];
  assert.ok(region && seats);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(region, "US");
    region.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    setValue?.call(seats, "12");
    seats.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => card.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
  await settle();
  act(() => railRow(page, "teammate-invitations").click());
  const settled = page.querySelector('.chat-message[data-seq="51"] .chat-ask-settled');
  assert.deepEqual(
    [...(settled?.querySelectorAll(".chat-ask-values li") ?? [])].map((row) => row.textContent),
    ["Region: US", "Seats: 12"],
  );
  act(() =>
    page
      .querySelector<HTMLButtonElement>('.chat-message[data-seq="51"] .chat-thread-toggle')
      ?.click(),
  );
  assert.match(words(page).join("\n"), /↳ Filled in the form\.\s*Region: US\s*Seats: 12/u);
});

test("an Enter that confirms what an input method composed leaves the mention list's word as typed", () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInto(box, "@age");
  act(() =>
    box.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    ),
  );
  assert.equal(box.value, "@age");
  assert.ok(page.querySelector('[role="listbox"]'), "the list stays open");
});

test("the arrows and Escape an input method composes with move its candidates, never the mention list", () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInto(box, "@age");
  const highlighted = () => page.querySelector('[role="option"][aria-selected="true"]')?.id;
  const before = highlighted();
  for (const key of ["ArrowDown", "ArrowUp", "Escape"]) {
    act(() =>
      box.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true })),
    );
  }
  assert.equal(highlighted(), before, "the highlight stays where it was");
  assert.ok(page.querySelector('[role="listbox"]'), "the list stays open");
});
