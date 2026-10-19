// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ASK_STATUS, CHANNEL_KIND, CHAT_ASK } from "@luke/features/chat-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { type ChatPlace, FOR_YOU } from "@luke/ui/chat-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { sideBundles } from "../bundle-loader.js";
import { ChatComposer } from "../tasks/chat-composer.js";
import {
  type FixtureChat,
  fixtureChat,
  type Staged,
  stagedAnswer,
  stagedPost,
} from "../tasks/chat-fixture.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { onSideBundles } from "../testing/side-bundles.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopChat, TaskChatTab } from "./desktop-chat.js";

/** The moment the fixture's messages are stamped before. */
const AT = Date.parse("2026-10-14T10:00:00Z");

// A message's words are drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));
// The box is the agent box's editor, drawn at once where its bundle has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));
beforeAll(installEditorLayout);

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
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
function mount(
  change: (chat: FixtureChat) => FixtureChat | undefined = (chat) => chat,
  workspace: Workspace | undefined = undefined,
): HTMLElement {
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
        workspace,
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
  return [...nav.querySelectorAll("h2, button")].map((node) => {
    if (node.matches("h2")) return `# ${node.textContent}`;
    const count = /(\d+) unread$/u.exec(node.textContent ?? "")?.[1];
    const shown = node.getAttribute("aria-current") === "page" ? "▸ " : "";
    return `${shown}${railName(node)}${count === undefined ? "" : ` (${count})`}`;
  });
}

/** The pane's messages as a reader hears them: each author and where it was posted, then its replies where the thread is open. */
function stream(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".chat-message, .chat-reply")].map((node) => {
    // The byline reads its author, their handle, where it was posted where it says, then when.
    const [author, , where] = node.querySelector(":scope > .chat-message-body > .chat-byline")
      ?.children ?? [undefined];
    const said = where === undefined || where.querySelector("time") !== null ? undefined : where;
    const indent = node.classList.contains("chat-reply") ? "  ↳ " : "";
    return `${indent}${author?.textContent ?? ""}${said === undefined ? "" : ` ${said.textContent}`}`;
  });
}

/** A row's name: the first of its words a reader hears, before what it says after and its count. */
function railName(row: Element): string {
  const heard = [...row.children].filter((part) => part.getAttribute("aria-hidden") !== "true");
  return heard[0]?.textContent ?? "";
}

function railRow(page: HTMLElement, name: string): HTMLButtonElement {
  const row = [...page.querySelectorAll<HTMLButtonElement>(".chat-rail button")].find(
    (each) => railName(each) === name,
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
  assert.equal(page.querySelector(".chat-head h2")?.textContent, "# teammate-invitations");
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
    '.chat-message[data-seq="43"] button[aria-expanded]',
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

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

/** The chat box whose editor is named `label`: what words are typed into and keys pressed in. */
function boxNamed(page: HTMLElement, label: string): HTMLElement {
  const box = [...page.querySelectorAll<HTMLElement>(".chat-composer")].find(
    (each) => each.querySelector(`.composer-editor[aria-label="${label}"]`) !== null,
  );
  assert.ok(box, `no box ${label}`);
  return box;
}

/** The words a box holds, as its editor shows them. */
function boxWords(box: HTMLElement): string {
  return (composerEditor(box).textContent ?? "").replaceAll("\u00a0", " ");
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
  typeInComposer(box, "@age");
  const options = [...page.querySelectorAll('[role="option"]')].map((row) => row.textContent);
  assert.deepEqual(options, ["@agent-1Add teammate invitations", "@agent-2Invite emails"]);
  pressInComposer(box, "ArrowDown");
  pressInComposer(box, "Enter");
  assert.equal(boxWords(box), "@agent-2 ");
  assert.equal(page.querySelector('[role="listbox"]'), null);
  typeInComposer(box, "hold the template until #214 lands");
  pressInComposer(box, "Enter");
  await settle();
  assert.equal(boxWords(box), "");
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
  assert.ok(
    [...(settled?.querySelectorAll("p") ?? [])].some(
      (line) => line.textContent === 'Dean Stratakos: Chose "14 days".',
    ),
    "the card says who answered and how",
  );
});

test("an approval is answered by its press, and a reply typed under an opened thread lands in that thread", async () => {
  const page = mount();
  const approval = [...page.querySelectorAll<HTMLElement>('.chat-ask[data-status="open"]')].find(
    (card) => card.textContent?.startsWith("Ask · Approval"),
  );
  const approve = [...(approval?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Approve",
  );
  act(() => approve?.click());
  await settle();
  assert.equal(rail(page)[0], "▸ For you (3)");

  act(() => railRow(page, "teammate-invitations").click());
  const toggle = page.querySelector<HTMLButtonElement>(
    '.chat-message[data-seq="48"] button[aria-expanded]',
  );
  act(() => toggle?.click());
  const reply = boxNamed(page, "Reply in thread");
  typeInComposer(reply, "Thanks, both.");
  pressInComposer(reply, "Enter");
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
    (each) =>
      [...each.querySelectorAll("p")].some((line) => line.textContent === "Where do the seats go?"),
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
  const settled = page.querySelector('.chat-message[data-seq="51"] .chat-ask');
  assert.deepEqual(
    [...(settled?.querySelectorAll("li") ?? [])].map((row) => row.textContent),
    ["Region: US", "Seats: 12"],
  );
  act(() =>
    page
      .querySelector<HTMLButtonElement>('.chat-message[data-seq="51"] button[aria-expanded]')
      ?.click(),
  );
  assert.match(words(page).join("\n"), /↳ Filled in the form\.\s*Region: US\s*Seats: 12/u);
});

test("an Enter that confirms what an input method composed leaves the mention list's word as typed", () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "@age");
  pressInComposer(box, "Enter", { isComposing: true, keyCode: 229 });
  // Note that the editor reads its selection back from jsdom's DOM on a composing key, which jsdom does not keep, so only the words are asserted.
  assert.equal(boxWords(box), "@age");
});

test("the arrows and Escape an input method composes with move its candidates, never the mention list", () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "@age");
  const highlighted = () => page.querySelector('[role="option"][aria-selected="true"]')?.id;
  const before = highlighted();
  for (const key of ["ArrowDown", "ArrowUp", "Escape"]) {
    pressInComposer(box, key, { isComposing: true, keyCode: 229 });
  }
  assert.equal(highlighted(), before, "the highlight stays where it was");
  assert.ok(page.querySelector('[role="listbox"]'), "the list stays open");
});

/** The plan's own Chat tab while the chat is still being read. */
function mountTaskTabReading(): HTMLElement {
  const base = tasksControl();
  const tasks = tasksControl({ chatView: { ...base.chatView, open: true, available: true } });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(AtomRegistry.make(), createElement(TaskChatTab, { tasks, taskId: "plan-1" })),
    ),
  );
  return container;
}

test("until the chat is read, its wait stands centred in the window's Chat and in the plan's Chat tab, rather than as a ring in the corner", () => {
  const chat = mount(() => undefined);
  const windowWait = chat.querySelector('.chat-stream [role="status"]');
  assert.ok(windowWait, "the window's Chat says it is waiting");
  assert.ok(windowWait.closest(".luke-spinner-region"), "the wait fills the window's Chat");
  act(() => root?.unmount());

  const tab = mountTaskTabReading();
  const tabWait = tab.querySelector('.task-chat [role="status"]');
  assert.ok(tabWait, "the plan's Chat tab says it is waiting");
  assert.ok(tabWait.closest(".luke-spinner-region"), "the wait fills the plan's Chat tab");
});

test("a post still out names the composer's send Sending and busy, and the box empties once it is taken", async () => {
  const gate = Promise.withResolvers<string | undefined>();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(ChatComposer, {
          label: "Message #general",
          hints: [],
          targets: [],
          keywords: [],
          onSend: () => gate.promise,
        }),
      ),
    ),
  );
  const box = boxNamed(container, "Message #general");
  typeInComposer(box, "Shipping today.");
  pressInComposer(box, "Enter");
  const sending = container.querySelector<HTMLButtonElement>('button[aria-label="Sending"]');
  assert.equal(sending?.getAttribute("aria-busy"), "true");
  act(() => gate.resolve(undefined));
  await settle();
  assert.ok(container.querySelector('button[aria-label="Send"]'), "the send is named Send again");
  assert.equal(boxWords(box), "");
});

test("a direct message between two others reads as theirs, named by both, with no box to post in it and no Reply under its messages", () => {
  const BETWEEN = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
  const page = mount((chat) => {
    const handle = (name: string) => chat.answer.members.find((each) => each.handle === name)?.id;
    const [one, two] = [handle("agent-1"), handle("agent-2")];
    const first = chat.answer.messages[0];
    if (one === undefined || two === undefined || first === undefined) return undefined;
    const { parentId: _root, ask: _ask, ...sample } = first;
    const top = Math.max(...chat.answer.messages.map((each) => each.seq)) + 1;
    return {
      ...chat,
      answer: {
        ...chat.answer,
        channels: [
          ...chat.answer.channels,
          { id: BETWEEN, kind: CHANNEL_KIND.DM, members: [one, two], archived: false },
        ],
        messages: [
          ...chat.answer.messages,
          {
            ...sample,
            id: BETWEEN,
            seq: top,
            touchedSeq: top,
            channelId: BETWEEN,
            authorId: one,
            mentions: [],
          },
          {
            ...sample,
            id: "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f",
            seq: top + 1,
            touchedSeq: top + 1,
            channelId: BETWEEN,
            authorId: two,
            mentions: [],
            ask: {
              key: "between",
              revision: 1,
              status: ASK_STATUS.OPEN,
              response: { type: CHAT_ASK.APPROVAL },
              needsReply: true,
            },
          },
        ],
      },
    };
  });
  // Nothing in it waits on the developer, so For you holds what it held.
  assert.equal(rail(page)[0], "▸ For you (4)");
  act(() => railRow(page, "agent-1 ↔ agent-2").click());
  assert.equal(page.querySelector(".chat-head h2")?.textContent, "@agent-1 ↔ @agent-2");
  assert.equal(page.querySelector(".chat-composer"), null);
  assert.match(page.textContent ?? "", /Only @agent-1 and @agent-2 post in this conversation\./u);
  assert.equal(page.querySelector(".chat-message button[aria-expanded]"), null);
  // Its open ask reads as waiting, with nothing to answer it by.
  const ask = page.querySelector('.chat-ask[data-status="open"]');
  assert.match(ask?.textContent ?? "", /Waiting on an answer/u);
  assert.equal(ask?.querySelector("button"), null);
});

test("a # at the start of a word offers the channels, and the one chosen is written as its name, the box holding a microphone beside its send", () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "see #bill");
  const options = [...page.querySelectorAll('[role="option"]')].map((row) => row.textContent);
  assert.deepEqual(options, ["#billing-export"]);
  pressInComposer(box, "Enter");
  assert.equal(boxWords(box), "see #billing-export ");
  assert.ok(box.querySelector('button[aria-label="Dictate"]'), "the box takes a dictation");
});

test("where the editor's bundle could not be loaded, the box is a plain field that still names a member and posts", async () => {
  const sent: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const bundles = sideBundles({
    planEditor: () => Promise.reject(new Error("The chunk could not be loaded.")),
  });
  await act(async () =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(
          bundles,
          createElement(ChatComposer, {
            label: "Message #general",
            hints: [],
            targets: [{ sigil: "@", name: "agent-1", detail: undefined }],
            keywords: [],
            onSend: (text) => {
              sent.push(text);
              return Promise.resolve(undefined);
            },
          }),
        ),
      ),
    ),
  );
  const field = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message #general"]',
  );
  assert.ok(field, "the plain field stands in");
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, "@agent-1 ship it");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  assert.deepEqual(sent, ["@agent-1 ship it"]);
  assert.equal(container.querySelector('button[aria-label="Dictate"]'), null);
});

test("in a listed workspace, an agent chosen from the @ list is written as its chip, sent as its link, and the message names it", async () => {
  const acme: Workspace = {
    id: "9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  };
  const page = mount((chat) => chat, acme);
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "@agent-2");
  pressInComposer(box, "Enter");
  assert.ok(box.querySelector("[data-mention-ref]"), "the agent stands in the box as its chip");
  typeInComposer(box, "take the template");
  pressInComposer(box, "Enter");
  await settle();
  const last = [...page.querySelectorAll(".chat-message")].at(-1);
  assert.match(last?.querySelector(".chat-words")?.textContent ?? "", /take the template/u);
  assert.ok(
    last?.querySelector(".chat-words [data-mention-ref]"),
    "the sent message draws it as its chip",
  );
});
