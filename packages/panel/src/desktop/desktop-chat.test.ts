// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_IMAGE_TYPE,
  type ChatAnswer,
  type ChatMessage,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import { TASK_SECTION_ICON_KIND } from "@luke/features/task-section-wire";
import type { CodeRef, TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { type ChatPlace, FOR_YOU } from "@luke/ui/chat-model";
import type { PictureAnswer } from "@luke/ui/picture-cache";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { sideBundles } from "../bundle-loader.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ChatComposer } from "../tasks/chat-composer.js";
import {
  type FixtureChat,
  fixtureChat,
  type Staged,
  stagedAnswer,
  stagedChannel,
  stagedPost,
  stagedRead,
} from "../tasks/chat-fixture.js";
import { FIXTURE_TASK_ID } from "../tasks/tasks-fixture.js";
import { OpenLinkProvider } from "../tasks/use-open-link.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { FAKE_ANSWER, fakeActPort } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
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
      act: () => Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not here." }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  // A box's words left unsent wait as its draft, which the next test's box must not find.
  window.localStorage.clear();
});

/** The window's Chat over the fixture's chat, changed as the test asks, its place and its posts its own, as the plans tab holds them, its pictures read as the test answers them. */
function mount(
  change: (chat: FixtureChat) => FixtureChat | undefined = (chat) => chat,
  workspace: Workspace | undefined = undefined,
  readPicture: (messageId: string, attachmentId: string) => Promise<PictureAnswer> = () =>
    Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }),
  opened: ReadLink[] | undefined = undefined,
  control: Partial<TasksControl> = {},
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
      room: SHELL_ROOM.WIDE,
      accountName: "Dean Stratakos",
      tasks: tasksControl({
        workspace,
        ...control,
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
          onShowMessage: () => undefined,
          listed: false,
          onList: () => undefined,
          onPost: (post) => stage((held) => stagedPost(held, post, AT)),
          onAnswer: (answer) => stage((held) => stagedAnswer(held, answer, AT)),
          onChannel: (change) => stage((held) => stagedChannel(held, change)),
          onRead: (channelIds) => void stage((held) => stagedRead(held, channelIds)),
          readPicture,
        },
      }),
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const page =
    opened === undefined
      ? createElement(Page)
      : createElement(
          OpenLinkProvider,
          { value: (link: ReadLink) => opened.push(link) },
          createElement(Page),
        );
  act(() => root?.render(onRegistry(AtomRegistry.make(), page)));
  return container;
}

/** The rail as a reader hears it: each group's name, then each place's name, `▸ ` where shown and ` •` where something waits unread in it. */
function rail(page: HTMLElement): string[] {
  const nav = page.querySelector(".chat-rail");
  assert.ok(nav, "the rail is drawn");
  return [
    ...nav.querySelectorAll(
      ".sidebar-repository-header button:not(.sidebar-repository-actions *), li .luke-list-row-main",
    ),
  ].map((node) => {
    if (node.closest(".sidebar-repository-header") !== null) return `# ${headName(node)}`;
    const shown = node.getAttribute("aria-current") === "page" ? "▸ " : "";
    // For you says under its name how many wait on the reader, which it is read by.
    const waiting = /^(\d+) waits? on you$/u.exec(
      node.querySelector(".luke-list-row-description")?.textContent ?? "",
    )?.[1];
    if (waiting !== undefined) return `${shown}${railName(node)} (${waiting})`;
    const unread = node.closest("li")?.querySelector(".inbox-row-unread") ? " •" : "";
    return `${shown}${railName(node)}${unread}`;
  });
}

/** The pane's messages as a reader hears them: each author and where it was posted, then its replies where the thread is open. */
function stream(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".chat-message, .chat-reply")].map((node) => {
    const byline = node.querySelector(":scope > .chat-message-body > .chat-byline");
    const author = byline?.querySelector(".chat-byline-name")?.textContent ?? "";
    const where = byline?.querySelector(".chat-byline-where")?.textContent;
    const indent = node.classList.contains("chat-reply") ? "  ↳ " : "";
    return `${indent}${author}${where === undefined ? "" : ` ${where}`}`;
  });
}

/** A place's name, as its row's title says it. */
function railName(row: Element): string {
  return row.querySelector(".luke-list-row-title")?.textContent ?? "";
}

/** A group's name: the first of its header's words a reader hears, before its count. */
function headName(head: Element): string {
  const heard = [...head.children].filter((part) => part.getAttribute("aria-hidden") !== "true");
  return heard[0]?.textContent ?? "";
}

function railRow(page: HTMLElement, name: string): HTMLButtonElement {
  const row = [
    ...page.querySelectorAll<HTMLButtonElement>(".chat-rail li .luke-list-row-main"),
  ].find((each) => railName(each) === name);
  assert.ok(row, `no row for ${name}`);
  return row;
}

test("Chat opens on For you, whose open asks come first, the oldest first, then the mentions waiting on the developer, beside a rail counting what each place holds unread", () => {
  const page = mount();
  assert.deepEqual(rail(page), [
    "▸ For you (4)",
    "# Channels",
    "general",
    "members-schema",
    "# Tasks",
    "billing-export",
    "teammate-invitations •",
    "# Direct messages",
    "Add teammate invitations",
    "Invite emails",
    "Maria Chen",
  ]);
  assert.deepEqual(stream(page), [
    "Add teammate invitations in #teammate-invitations",
    "Invite emails in #teammate-invitations",
    "Invite emails in #teammate-invitations",
    "Add teammate invitations in #teammate-invitations",
  ]);
});

test("a press on a channel shows its messages in the order posted, a thread folded under its root until a press opens it", () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  assert.equal(page.querySelector(".chat-head h2")?.textContent, "# teammate-invitations");
  assert.equal(railRow(page, "teammate-invitations").getAttribute("aria-current"), "page");
  assert.deepEqual(stream(page), [
    "Invite emails",
    "Add teammate invitations",
    "Invite emails",
    "Add teammate invitations",
    "Invite emails",
    "Add teammate invitations",
    "Invite emails",
    "Dean Stratakos",
  ]);
  const toggle = page.querySelector<HTMLButtonElement>(
    '.chat-message[data-seq="43"] button[aria-expanded]',
  );
  // The folded thread is summed up by its repliers' faces and how many replied, as a comment thread at rest is.
  assert.equal(toggle?.textContent, "2 replies");
  assert.equal(toggle?.querySelectorAll(".actor-stack .actor-mark").length, 2);
  act(() => toggle?.click());
  assert.deepEqual(stream(page).slice(0, 5), [
    "Invite emails",
    "Add teammate invitations",
    "Invite emails",
    "  ↳ Add teammate invitations",
    "  ↳ Invite emails",
  ]);
});

/**
 * Lays out every log the window draws as a box 100 tall over 1000 of
 * lines, since jsdom lays nothing out, its scroll position kept as written,
 * and the "New" line standing `lineTop` from the box's top.
 */
function layOutLogs(lineTop = 0): void {
  const tops = new WeakMap<Element, number>();
  const log = (element: Element) => element.getAttribute("role") === "log";
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return log(this) ? 1000 : 0;
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return log(this) ? 100 : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return tops.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
    this: Element,
    top: number,
  ) {
    tops.set(this, top);
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = this.classList.contains("chat-unread-line") ? lineTop : 0;
    return DOMRect.fromRect({ x: 0, y: top, width: 0, height: 0 });
  });
}

/** The shown place's log: the box its messages scroll in. */
function shownLog(page: HTMLElement): HTMLElement {
  const log = page.querySelector<HTMLElement>('.chat-stream [role="log"]');
  assert.ok(log, "the place's messages stand in a log");
  return log;
}

/** The way back to the newest message, where it floats over the log. */
function toNewest(page: HTMLElement): HTMLButtonElement | null {
  return page.querySelector('button[aria-label="Scroll to the newest line"]');
}

/** The shown channel's roots in order, by seq, and its "New" line where it stands. */
function roots(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".chat-messages > li")].map((node) =>
    node.classList.contains("chat-unread-line")
      ? (node.textContent ?? "")
      : (node.getAttribute("data-seq") ?? ""),
  );
}

test("a channel opens as a log at its newest message, a New line before the first message someone posted since the developer read it, and the way back floats once they scroll up", () => {
  layOutLogs();
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const log = shownLog(page);
  assert.equal(log.scrollTop, 1000);
  // The developer read up to 46, so the line stands between it and 47, and once alone.
  const shown = roots(page);
  assert.deepEqual(shown.slice(shown.indexOf("New") - 1, shown.indexOf("New") + 2), [
    "46",
    "New",
    "47",
  ]);
  assert.equal(shown.filter((each) => each === "New").length, 1);
  // The first unread message heads a run of its own, named and faced, though its author spoke last.
  assert.equal(
    page.querySelector('.chat-message[data-seq="47"]')?.getAttribute("data-continued"),
    "false",
  );
  assert.equal(toNewest(page), null);
  log.scrollTop = 400;
  act(() => {
    log.dispatchEvent(new Event("scroll"));
  });
  assert.ok(toNewest(page), "scrolled up, the way back to the newest message floats");
  act(() => toNewest(page)?.click());
  assert.equal(log.scrollTop, 1000);
  assert.equal(toNewest(page), null);
  act(() => railRow(page, "general").click());
  assert.equal(page.querySelector(".chat-unread-line"), null);
});

test("a channel whose unread run is taller than the box opens with its New line at the top, let go of the newest message", () => {
  layOutLogs(-600);
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  assert.equal(shownLog(page).scrollTop, 400);
  assert.ok(toNewest(page), "opened above the newest message, the way back floats");
});

test("For you is a log too, opened at its newest entry", () => {
  layOutLogs();
  const page = mount();
  assert.equal(shownLog(page).scrollTop, 1000);
});

test("a message says how long ago it was posted, as every row and thread in the window does, a continued one too", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AT);
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const time = (seq: number) =>
    page.querySelector(`.chat-message[data-seq="${seq}"] time.chat-time`)?.textContent;
  assert.equal(time(47), "16m");
  assert.equal(time(51), "3m");
});

test("a message's Copy takes its words as Markdown, beside the Reply its byline offers", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const actions = page.querySelector('.chat-message[data-seq="51"] .chat-byline-action');
  assert.deepEqual(
    [...(actions?.querySelectorAll("button") ?? [])].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    ),
    ["Copy", "Reply"],
  );
  act(() => actions?.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')?.click());
  await settle();
  assert.deepEqual(copied, [
    "Two invites to one address in one workspace would otherwise both go pending. It's one " +
      "migration, online, and nothing writes the pair twice today.",
  ]);
});

/** The id of the developer's DM with Invite emails, the fixture's second agent. */
function dmWithInviteEmails(answer: ChatAnswer): string {
  const agent = answer.members.find((member) => member.name === "Invite emails");
  const dm = answer.channels.find(
    (channel) => channel.kind === CHANNEL_KIND.DM && channel.members?.includes(agent?.id ?? ""),
  );
  return dm?.id ?? "";
}

test("an ask posted in a direct message is listed among For you's asks as a direct message, never as a channel", () => {
  const page = mount((chat) => ({
    ...chat,
    answer: {
      ...chat.answer,
      // The developer opened a DM with the agent, which an agent answers in, so its ask stands there.
      messages: chat.answer.messages.map((message) =>
        message.seq === 47
          ? {
              ...message,
              channelId: dmWithInviteEmails(chat.answer),
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

/** A workspace the window lists, which a chip's link is written in. */
const ACME: Workspace = {
  id: "9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

test("a channel's composer offers its members by name as an @ is typed, writes the one chosen as their chip, and posts to the channel on Enter, leaving the box empty", async () => {
  const page = mount((chat) => chat, ACME);
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "@in");
  const options = [...page.querySelectorAll('[role="option"]')].map((row) => row.textContent);
  assert.deepEqual(options, ["@Invite emails", "@Add teammate invitations"]);
  pressInComposer(box, "Enter");
  assert.ok(box.querySelector("[data-mention-ref]"), "the agent stands in the box as its chip");
  assert.equal(page.querySelector('[role="listbox"]'), null);
  typeInComposer(box, "hold the template until #214 lands");
  pressInComposer(box, "Enter");
  await settle();
  assert.equal(boxWords(box), "");
  assert.equal(words(page).at(-1), "Invite emails hold the template until #214 lands");
  // The post continues the reader's own run, so it draws under the name the run began with.
  assert.equal(stream(page).at(-1), "");
  assert.equal(stream(page).filter(Boolean).at(-1), "Dean Stratakos");
  // A screen reader landing on the continued message alone still hears who wrote it.
  assert.equal(
    [...page.querySelectorAll(".chat-message")]
      .at(-1)
      ?.querySelector(".chat-byline .visually-hidden")?.textContent,
    "Dean Stratakos",
  );
  const last = [...page.querySelectorAll(".chat-message")].at(-1);
  assert.ok(
    last?.querySelector(".chat-words [data-mention-ref]"),
    "the sent message draws the agent as its chip",
  );
});

test("before the workspace is known, an @ offers no member, since a member is written as their link alone", () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "@in");
  assert.equal(page.querySelector('[role="option"]'), null);
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
  const page = mount((chat) => chat, ACME);
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "@in");
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

test("a direct message between two others reads as theirs, named by both, with no box to post in it and no Reply under its messages", () => {
  const BETWEEN = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
  const page = mount((chat) => {
    const agents = chat.answer.members.filter((each) => each.kind === MEMBER_KIND.AGENT);
    const [one, two] = agents.map((each) => each.id);
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
  act(() => railRow(page, "Add teammate invitations ↔ Invite emails").click());
  assert.equal(
    page.querySelector(".chat-head h2")?.textContent,
    "Add teammate invitations ↔ Invite emails",
  );
  assert.equal(page.querySelector(".chat-composer"), null);
  assert.match(
    page.textContent ?? "",
    /Only Add teammate invitations and Invite emails post in this conversation\./u,
  );
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

/** An agent as a plain box writes it: its mention link. */
const INVITE_EMAILS_CHIP = "[@Invite emails](https://tryluke.dev/acme/plan/plan-1/agent/agent-2)";

/** Chat's box where the editor's bundle could not be loaded, every post it makes written down. */
async function plainChat() {
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
            channelId: "general",
            label: "Message #general",
            targets: [
              {
                sigil: "@",
                name: "Invite emails",
                detail: undefined,
                markdown: INVITE_EMAILS_CHIP,
              },
            ],
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
  return { container, field, sent };
}

/** Words written into the plain field, as typing them would leave it. */
function writeInto(field: HTMLTextAreaElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A key pressed in the plain field, answering whether its own action was let through. */
function pressInField(field: HTMLTextAreaElement, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => field.dispatchEvent(event));
  return !event.defaultPrevented;
}

test("where the editor's bundle could not be loaded, the box is a plain field that still names a member by their link and posts", async () => {
  const { container, field, sent } = await plainChat();
  writeInto(field, "@Inv");
  pressInField(field, { key: "Enter" });
  writeInto(field, `${field.value}ship it`);
  pressInField(field, { key: "Enter" });
  await settle();
  assert.deepEqual(sent, [`${INVITE_EMAILS_CHIP} ship it`]);
  assert.equal(field.getAttribute("enterkeyhint"), "send");
  assert.equal(container.querySelector('button[aria-label="Dictate"]'), null);
});

test("on a coarse pointer the plain field's Enter is a new line, its return key says so, and ⌘+Enter posts", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" }));
  const { field, sent } = await plainChat();
  assert.equal(field.getAttribute("enterkeyhint"), "enter");
  writeInto(field, "ship it");
  assert.equal(pressInField(field, { key: "Enter" }), true, "the field types its new line");
  await settle();
  assert.deepEqual(sent, []);

  pressInField(field, { key: "Enter", metaKey: true });
  await settle();
  assert.deepEqual(sent, ["ship it"]);
});

/** Types into a field the way a person's typing leaves it. */
function fill(field: HTMLInputElement | HTMLTextAreaElement, words: string): void {
  const prototype =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The card a question stands in, whichever role it asks with. */
function openDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
}

/** The button in the open dialog whose words are `label`. */
function dialogButton(label: string): HTMLButtonElement {
  const button = [...(openDialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (each) => each.textContent === label,
  );
  assert.ok(button, `no ${label} in the dialog`);
  return button;
}

test("New channel opens a topic under the name typed, written as a channel's, with its purpose under its name; its menu archives it out of the rail", async () => {
  const page = mount();
  const create = page.querySelector<HTMLButtonElement>('button[aria-label="New channel"]');
  assert.ok(create, "the rail offers a new channel");
  act(() => create.click());
  const [name, purpose] = [...(openDialog()?.querySelectorAll<HTMLInputElement>("input") ?? [])];
  assert.ok(name && purpose);
  fill(name, "general");
  act(() => dialogButton("Create channel").click());
  await settle();
  assert.match(openDialog()?.textContent ?? "", /#general is already a channel\./u);
  fill(name, "Release Train");
  fill(purpose, "What ships Friday");
  act(() => dialogButton("Create channel").click());
  await settle();
  assert.equal(openDialog(), null);
  act(() => railRow(page, "release-train").click());
  assert.equal(page.querySelector(".chat-head h2")?.textContent, "# release-train");
  assert.match(page.querySelector(".chat-head")?.textContent ?? "", /What ships Friday/u);

  const actions = page.querySelector<HTMLButtonElement>(
    '.chat-head button[aria-label="#release-train actions"]',
  );
  assert.ok(actions, "a topic's head offers its actions");
  act(() => actions.click());
  const archive = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Archive channel",
  );
  act(() => archive?.click());
  act(() => dialogButton("Archive channel").click());
  await settle();
  // The topic archived while it is read keeps its row in sight, under the folded archive, still the one shown.
  const archivedRows = () =>
    [...page.querySelectorAll(".chat-rail .sidebar-repository")]
      .filter((group) => group.textContent?.startsWith("Archived"))
      .flatMap((group) => [...group.querySelectorAll("li .luke-list-row-main")].map(railName));
  assert.deepEqual(archivedRows(), ["release-train"]);
  assert.ok(rail(page).includes("▸ release-train"));
  act(() => railRow(page, "general").click());
  assert.deepEqual(archivedRows(), [], "the fold holds it once another place is shown");

  // Archived channels fold apart, and a topic among them is brought back from its own menu.
  const archived = [...page.querySelectorAll<HTMLButtonElement>(".chat-rail button")].find((each) =>
    each.textContent?.startsWith("Archived"),
  );
  assert.ok(archived, "the archive stands folded in the rail");
  act(() => archived.click());
  act(() => railRow(page, "release-train").click());
  const back = page.querySelector<HTMLButtonElement>(
    '.chat-head button[aria-label="#release-train actions"]',
  );
  act(() => back?.click());
  const bring = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Bring back channel",
  );
  act(() => bring?.click());
  act(() => dialogButton("Bring back").click());
  await settle();
  assert.ok(
    rail(page).includes("▸ release-train"),
    "the topic stands among the channels again, shown",
  );
  assert.equal(
    [...page.querySelectorAll(".chat-rail button")].some((each) =>
      each.textContent?.startsWith("Archived"),
    ),
    false,
    "nothing is left archived",
  );
});

test("a fixture chat opens no topic past the bound, and an archive frees a place for one", () => {
  const staged = fixtureChat({ fixtureMode: true }, AT);
  assert.ok(staged);
  let held: FixtureChat = staged;
  const open = (name: string) => {
    const landed = stagedChannel(held, { open: { name } });
    if ("chat" in landed) held = landed.chat;
    return landed;
  };
  const topics = () =>
    held.answer.channels.filter(
      (channel) => channel.kind === CHANNEL_KIND.TOPIC && !channel.archived,
    );
  while (topics().length < CHAT_BOUNDS.MAX_TOPIC_CHANNELS) open(`topic-${topics().length}`);
  assert.ok("refused" in open("one-too-many"));
  const [first] = topics();
  assert.ok(first);
  const archived = stagedChannel(held, { edit: { channelId: first.id, archived: true } });
  assert.ok("chat" in archived);
  held = archived.chat;
  assert.ok("chat" in open("one-more"));
});

/** Monday, October 19, 2026, at noon in UTC: the same day in any zone within eleven hours of it. */
const MONDAY_NOON = Date.parse("2026-10-19T12:00:00Z");

/** The rows the open list offers, each its name and what it says beside it. */
function offered(page: HTMLElement): (string | null)[] {
  return [...page.querySelectorAll('[role="option"]')].map((row) => row.textContent);
}

test("words after an @ that read as a date offer it first, said as its chip says it with the date in full beside it, and the date sent is drawn as its chip", async () => {
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  try {
    const page = mount();
    act(() => railRow(page, "teammate-invitations").click());
    const box = boxNamed(page, "Message #teammate-invitations");
    typeInComposer(box, "out @oct 20 to 24");
    const listed = offered(page);
    pressInComposer(box, "Enter");
    const chips = [...box.querySelectorAll("[data-mention-ref]")].map((chip) => chip.textContent);
    typeInComposer(box, "for the offsite");
    pressInComposer(box, "Enter");
    await settle();

    assert.deepEqual(listed, ["Tomorrow → SaturdayOct 20, 2026 → Oct 24, 2026"]);
    assert.deepEqual(chips, ["Tomorrow → Saturday"]);
    const last = [...page.querySelectorAll(".chat-message")].at(-1);
    const sent = last?.querySelector<HTMLElement>(".chat-words [data-mention-ref]");
    assert.equal(sent?.dataset.kind, "date");
    assert.equal(sent?.textContent, "Tomorrow → Saturday");
    assert.match(last?.querySelector(".chat-words")?.textContent ?? "", /for the offsite/u);
  } finally {
    vi.useRealTimers();
  }
});

test("a date chip in the chat box opens its picker, and a day picked there names it anew in place", async () => {
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  try {
    const page = mount();
    act(() => railRow(page, "teammate-invitations").click());
    const box = boxNamed(page, "Message #teammate-invitations");
    typeInComposer(box, "ship @tomorrow");
    pressInComposer(box, "Enter");
    act(() => box.querySelector<HTMLElement>('[data-kind="date"]')?.click());
    await act(async () => undefined);
    const dialog = box.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog, "the picker is open");
    const start = dialog.querySelector<HTMLInputElement>('input[aria-label="Start"]')?.value;
    act(() =>
      dialog.querySelector<HTMLElement>('button[aria-label="Friday, October 23, 2026"]')?.click(),
    );
    act(() =>
      (dialog.contains(document.activeElement) ? document.activeElement : dialog)?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    await act(async () => undefined);

    assert.equal(start, "Oct 20, 2026");
    assert.equal(box.querySelector('[role="dialog"]'), null);
    assert.deepEqual(
      [...box.querySelectorAll("[data-mention-ref]")].map((chip) => chip.textContent),
      ["Friday"],
    );
  } finally {
    vi.useRealTimers();
  }
});

test("an @ word that reads as a date lists it before the members it matches, and words after a name that name no date open no list", () => {
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  try {
    const page = mount();
    act(() => railRow(page, "teammate-invitations").click());
    const box = boxNamed(page, "Message #teammate-invitations");
    typeInComposer(box, "@tomorrow");
    const dated = offered(page);
    pressInComposer(box, "Escape");
    typeInComposer(box, " and @agent-1 please look");

    assert.deepEqual(dated, ["TomorrowOct 20, 2026"]);
    assert.equal(page.querySelector('[role="listbox"]'), null);
  } finally {
    vi.useRealTimers();
  }
});

test("where the editor's bundle could not be loaded, a date one word names after an @ still offers it, and its pick is written and sent as its link", async () => {
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  try {
    const { container, field, sent } = await plainChat();
    writeInto(field, "ship it @tomorrow");
    const listed = [...container.querySelectorAll('[role="option"]')].map((row) => row.textContent);
    pressInField(field, { key: "Enter" });
    pressInField(field, { key: "Enter" });
    await settle();

    assert.deepEqual(listed, ["TomorrowOct 20, 2026"]);
    assert.deepEqual(sent, ["ship it [@Oct 20, 2026](luke://date/2026-10-20)"]);
  } finally {
    vi.useRealTimers();
  }
});

/** A PNG's signature, which is all of a picture the test hands in, and the same bytes in base64 as its read answers them. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BASE64 = "iVBORw0KGgo=";

/** Hands `files` to a box: picked in its hidden picker, or dropped on its card. */
async function handFiles(box: HTMLElement, files: readonly File[], how: "pick" | "drop") {
  if (how === "pick") {
    const picker =
      box.querySelector<HTMLInputElement>('input[type="file"]') ?? assert.fail("no file picker");
    Object.defineProperty(picker, "files", { configurable: true, value: files });
    act(() => picker.dispatchEvent(new Event("change", { bubbles: true })));
  } else {
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files } });
    act(() => box.dispatchEvent(drop));
  }
  // Note that a file is read off the disk before it lands in the box.
  for (let round = 0; round < 4; round += 1) await settle();
}

/** The names of the files a box holds, as its chips say them. */
function chipNames(box: HTMLElement): (string | null)[] {
  return [...box.querySelectorAll('[aria-label="Attached files"] > li')].map((chip) =>
    chip.getAttribute("title"),
  );
}

test("a channel's box takes pictures picked or dropped as chips, says why a file that is no picture did not come, and posts them with words or alone, each drawn in the channel over the words and opened larger on a press", async () => {
  const asked: string[] = [];
  const page = mount(
    (chat) => chat,
    undefined,
    (messageId) => {
      asked.push(messageId);
      return Promise.resolve({ contentType: CHAT_IMAGE_TYPE.PNG, base64: PNG_BASE64 });
    },
  );
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  assert.ok(box.querySelector('button[aria-label="Attach images"]'), "the box offers its +");

  const shot = new File([PNG_BYTES], "invite-email.png", { type: CHAT_IMAGE_TYPE.PNG });
  const rows = new File(["email,role"], "rows.csv", { type: "text/csv" });
  await handFiles(box, [shot, rows], "pick");
  assert.deepEqual(chipNames(box), ["invite-email.png"]);
  assert.equal(
    box.querySelector('[role="alert"]')?.textContent,
    "rows.csv can't be attached. Attach images.",
  );
  typeInComposer(box, "the new invite email");
  pressInComposer(box, "Enter");
  await settle();
  assert.equal(boxWords(box), "");
  assert.deepEqual(chipNames(box), [], "the box lets go of the pictures it sent");
  const under = [...page.querySelectorAll(".chat-message")].at(-1);
  assert.equal(under?.querySelector(".chat-words")?.textContent?.trim(), "the new invite email");
  const drawn = under?.querySelector<HTMLImageElement>(".picture-block img");
  assert.equal(drawn?.getAttribute("src"), `data:${CHAT_IMAGE_TYPE.PNG};base64,${PNG_BASE64}`);
  assert.equal(drawn?.getAttribute("alt"), "invite-email.png");
  const words = under?.querySelector(".chat-words");
  assert.ok(drawn && words);
  assert.ok(
    drawn.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING,
    "a person's pictures stand over their words",
  );

  await handFiles(
    box,
    [new File([PNG_BYTES], "second.png", { type: CHAT_IMAGE_TYPE.PNG })],
    "drop",
  );
  assert.deepEqual(chipNames(box), ["second.png"]);
  pressInComposer(box, "Enter");
  await settle();
  const alone = [...page.querySelectorAll(".chat-message")].at(-1);
  assert.notEqual(alone, under, "pictures alone are a post of their own");
  assert.equal(alone?.querySelector(".chat-words"), null, "a post of pictures alone has no words");
  assert.equal(alone?.querySelector(".picture-block img")?.getAttribute("alt"), "second.png");
  assert.equal(new Set(asked).size, 2, "each picture is read under its own message");

  act(() => alone?.querySelector<HTMLButtonElement>("button.picture-frame")?.click());
  assert.ok(
    document.querySelector('[role="dialog"] img[src^="data:image/png"]'),
    "a press opens the picture over the window",
  );
});

test("in a listed workspace, a person is drawn with their photo from the members read, as everywhere else in the window", async () => {
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () =>
      Promise.resolve([
        {
          userId: "maria",
          name: "Maria Chen",
          email: "maria@example.com",
          role: WORKSPACE_ROLE.MEMBER,
          pictureUrl: "https://example.com/maria.png",
        },
      ]),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
  });
  const acme: Workspace = {
    id: "9e8d7c6b-5a49-4382-9716-05f4e3d2c1b1",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  };
  const page = mount((chat) => chat, acme);
  await settle();
  // Her direct message is named as the members read names her, and wears her photo.
  const maria = railRow(page, "Maria Chen");
  assert.ok(
    maria.querySelector("img[src^='https://example.com/maria.png']"),
    "her row wears her photo",
  );
  act(() => railRow(page, "general").click());
  const named = [...page.querySelectorAll(".chat-byline-name")].map((each) => each.textContent);
  assert.ok(named.includes("Maria Chen"), "her messages name her as the members read does");
  assert.ok(
    page.querySelector(".chat-face img[src^='https://example.com/maria.png']"),
    "and lead with her photo",
  );
});

test("an agent's line names it by its title alone, as every place of the window names it, and a press on its name opens its tab", () => {
  const opened: ReadLink[] = [];
  const page = mount((chat) => chat, undefined, undefined, opened);
  act(() => railRow(page, "teammate-invitations").click());
  const byline = [...page.querySelectorAll(".chat-message .chat-byline")].find(
    (each) => each.querySelector(".chat-byline-name")?.textContent === "Add teammate invitations",
  );
  assert.ok(byline);
  assert.doesNotMatch(byline.textContent ?? "", /@/u, "no handle beside it");
  const name = byline.querySelector<HTMLButtonElement>(".chat-byline-name button");
  assert.ok(name, "the agent's name is a press");
  act(() => name.click());
  assert.equal(opened.length, 1);
  const [link] = opened;
  assert.ok(link !== undefined && "place" in link);
  assert.equal(link.place.kind, LINK_PLACE.AGENT);
});

test("an agent the plans' summaries do not name opens its tab under the plan the chat read names for it", () => {
  const opened: ReadLink[] = [];
  const ELSEWHERE = "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2910";
  const page = mount(
    (chat) => ({
      ...chat,
      answer: {
        ...chat.answer,
        members: chat.answer.members.map((member) =>
          member.name === "Add teammate invitations"
            ? { ...member, agentId: ELSEWHERE, planId: ELSEWHERE }
            : member,
        ),
      },
    }),
    undefined,
    undefined,
    opened,
  );
  act(() => railRow(page, "teammate-invitations").click());
  // An agent no summary names is named as the chat read names it.
  const agentLine = [...page.querySelectorAll(".chat-message .chat-byline")].find(
    (byline) =>
      byline.querySelector(".chat-byline-name")?.textContent === "Add teammate invitations",
  );
  assert.ok(agentLine, "the agent is named by the name the read carries");
  act(() => agentLine?.querySelector<HTMLButtonElement>(".chat-byline-name button")?.click());
  const [link] = opened;
  assert.ok(link !== undefined && "place" in link);
  assert.deepEqual(link.place, { kind: LINK_PLACE.AGENT, planId: ELSEWHERE, agentId: ELSEWHERE });
});

test("each place's row says who spoke last and what, as an Inbox row previews its thread, and a group folds on its header, keeping the place shown in sight", () => {
  const page = mount();
  const general = railRow(page, "general");
  assert.match(
    general.querySelector(".luke-list-row-description")?.textContent ?? "",
    /^\S.*: .+/u,
    "the row previews its last message as who said it and what",
  );
  assert.equal(
    page.querySelector(".chat-rail li li"),
    null,
    "each place is one item of its group's list, never an item inside another",
  );
  act(() => general.click());
  const head = [
    ...page.querySelectorAll<HTMLButtonElement>(".sidebar-repository-header button"),
  ].find((each) => headName(each) === "Channels");
  assert.ok(head, "Channels heads its group");
  act(() => head.click());
  const channels = rail(page);
  const after = channels.indexOf("# Channels");
  assert.deepEqual(channels.slice(after, after + 3), ["# Channels", "▸ general", "# Tasks"]);
  // Folded, a group whose places wait unread says how many at rest, as the Inbox's folder counts do, so the dot it hid is not lost.
  const tasks = [
    ...page.querySelectorAll<HTMLButtonElement>(".sidebar-repository-header button"),
  ].find((each) => headName(each) === "Tasks");
  assert.ok(tasks, "Tasks heads its group");
  act(() => tasks.click());
  const count = tasks.querySelector<HTMLElement>(".luke-nav-item-count");
  assert.equal(count?.dataset.shown, "always", "the folded group's count stands at rest");
  assert.match(count?.textContent ?? "", /^1 unread/u);
});

test("the rail's rows draw in the sidebar's ink, and a message's face is the app's own mark, never tiled", () => {
  const page = mount((chat) => chat);
  const rows = [...page.querySelectorAll(".chat-rail .luke-list-row")];
  assert.ok(rows.length > 0, "the rail holds rows");
  assert.deepEqual(
    [...new Set(rows.map((each) => each.getAttribute("data-ink")))],
    ["sidebar"],
    "every rail row wears the sidebar's ink",
  );
  act(() => railRow(page, "teammate-invitations").click());
  const faces = [...page.querySelectorAll(".chat-face .actor-mark")];
  assert.ok(faces.length > 0, "messages lead with faces");
  assert.deepEqual(
    faces.filter((each) => each.getAttribute("data-tiled") === "true"),
    [],
    "no face stands on a tile outside a pile",
  );
});

/** The fixture's task channel by its name, with the plan it is of. */
function planOf(name: string): string {
  const staged = fixtureChat({ fixtureMode: true }, AT);
  const planId = staged?.answer.channels.find((channel) => channel.name === name)?.planId;
  assert.ok(planId, `the fixture holds #${name}`);
  return planId;
}

/** The fixture's two tasks as the sidebar lists them: invitations pinned with an agent at work, billing in a section of its own wearing an emoji. */
function railTasks(): Partial<TasksControl> {
  const invitations: TaskSummary = {
    id: planOf("teammate-invitations"),
    workspaceId: ACME.id,
    name: "Teammate invitations",
    repository: "acme/relay",
    createdAt: 1,
    updatedAt: 2,
    pinnedAt: 3,
    agents: {
      total: 1,
      working: 1,
      agents: [
        {
          id: "5b0e7a52-0c3a-4c1e-9d5e-0a0b0c0d0e01",
          title: "Wire the invites",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          status: CODING_AGENT_STATUS.RUNNING,
        },
      ],
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
  const billing: TaskSummary = {
    id: planOf("billing-export"),
    workspaceId: ACME.id,
    name: "Billing export",
    repository: "acme/relay",
    createdAt: 1,
    updatedAt: 2,
  };
  const section = "6c1f8b63-1d4b-4d2f-8e6f-1b2c3d4e5f02";
  return {
    tasks: [invitations, billing],
    taskSections: {
      sections: [
        {
          id: section,
          workspaceId: ACME.id,
          title: "Launch",
          icon: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🚀" },
          createdAt: 1,
        },
      ],
      entries: [{ taskId: billing.id, sectionId: section, addedAt: 1 }],
    },
  };
}

/** The rail mounted in Acme over the fixture's tasks, its members read as no one. */
function mountRail(): HTMLElement {
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
  });
  return mount(undefined, ACME, undefined, undefined, railTasks());
}

/** A group's header in the rail, by its name. */
function railHead(page: HTMLElement, name: string): HTMLElement {
  const head = [
    ...page.querySelectorAll<HTMLElement>(".chat-rail .sidebar-repository-header"),
  ].find((each) => {
    const fold = each.querySelector("button:not(.sidebar-repository-actions *)");
    return fold !== null && headName(fold) === name;
  });
  assert.ok(head, `the rail heads ${name}`);
  return head;
}

/** The items of the menu opened last, a menu closed before it perhaps still on its way out. */
function menuItems(): HTMLButtonElement[] {
  const menu = [...document.querySelectorAll('[role="menu"]')].at(-1);
  return [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
}

/** What a right-click on an element offers. */
function rightClick(target: Element): HTMLButtonElement[] {
  act(() => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 4, clientY: 4 }));
  });
  return menuItems();
}

function menuItem(items: readonly HTMLButtonElement[], label: string): HTMLButtonElement {
  return items.find((each) => each.textContent === label) ?? assert.fail(`offers ${label}`);
}

/** The card hung once the pointer rests on a row. */
function restOn(row: HTMLElement): Element | null {
  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return document.querySelector(".luke-tooltip-card");
}

test("the rail heads the tasks' channels as the sidebar heads their tasks, Pinned and Tasks with no glyph and a section with its own icon, and a task's row ends in its task's mark", () => {
  const page = mountRail();
  assert.deepEqual(
    rail(page).filter((line) => line.startsWith("# ")),
    ["# Channels", "# Pinned", "# Launch", "# Direct messages"],
  );
  assert.equal(railHead(page, "Pinned").querySelector(".luke-nav-item-icon"), null);
  assert.equal(
    railHead(page, "Launch").querySelector(".luke-nav-item-icon")?.textContent,
    "🚀",
    "a section wears its own emoji",
  );
  const invitations = railRow(page, "teammate-invitations").closest("li");
  assert.ok(
    invitations?.querySelector(".home-row-meta .state-glyph"),
    "an agent at work on the task turns at the row's end",
  );
  assert.equal(
    railRow(page, "billing-export").closest("li")?.querySelector(".home-row-meta .state-glyph"),
    null,
    "a task with nothing at work wears no mark",
  );
});

test("rested on, a task's row hangs its task's card, an agent's direct message its tab's card, a person's their card, and a channel's its name alone", () => {
  const page = mountRail();
  assert.ok(restOn(railRow(page, "teammate-invitations"))?.querySelector("[data-task-card]"));
  assert.ok(restOn(railRow(page, "Invite emails"))?.querySelector("[data-tab-card]"));
  assert.ok(restOn(railRow(page, "Maria Chen"))?.querySelector('[data-actor-card="person"]'));
  const general = restOn(railRow(page, "general"));
  assert.equal(general, null, "a channel hangs no card");
});

test("a row's right-click offers Mark as read while something waits unread in it, and Copy link; a topic's edits and archives it too; Mark as read takes its dot away", () => {
  const page = mountRail();
  const topic = rightClick(railRow(page, "members-schema")).map((each) => each.textContent);
  assert.deepEqual(topic, ["Copy link", "Edit channel", "Archive channel"]);
  const offered = rightClick(railRow(page, "teammate-invitations"));
  assert.deepEqual(
    offered.map((each) => each.textContent),
    ["Mark as read", "Copy link"],
  );
  act(() => menuItem(offered, "Mark as read").click());
  assert.ok(rail(page).includes("teammate-invitations"), "the row is read, its dot gone");
});

test("an unread row's hover Mark as read marks it read, and a row with nothing unread offers none", () => {
  const page = mountRail();
  assert.equal(
    railRow(page, "general").closest("li")?.querySelector('button[aria-label="Mark as read"]'),
    null,
  );
  const invitations = railRow(page, "teammate-invitations").closest("li");
  const mark = invitations?.querySelector<HTMLButtonElement>('button[aria-label="Mark as read"]');
  assert.ok(mark, "an unread row offers Mark as read on hover");
  act(() => mark.click());
  assert.ok(rail(page).includes("teammate-invitations"), "the row is read, its dot gone");
});

test("a group's ⋯ and a right-click on its header offer Mark all as read, which reads every place in it, and which stands dimmed where nothing waits", () => {
  const page = mountRail();
  const launch = rightClick(railHead(page, "Launch"));
  assert.equal(menuItem(launch, "Mark all as read").disabled, true);
  const ellipsis = railHead(page, "Pinned").querySelector<HTMLButtonElement>(
    'button[aria-label="Actions for Pinned"]',
  );
  assert.ok(ellipsis, "the group's header offers its actions");
  act(() => ellipsis.click());
  act(() => menuItem(menuItems(), "Mark all as read").click());
  assert.deepEqual(
    rail(page).filter((line) => line.endsWith(" •")),
    [],
    "nothing in the group waits unread",
  );
});

/** The fixture's chat with messages posted in a channel, named by its name, each by the member named and holding the blocks given, after every other. */
function withPosts(
  chat: FixtureChat,
  channelName: string,
  posts: readonly { readonly by: string; readonly blocks: ChatMessage["blocks"] }[],
): FixtureChat {
  const { answer } = chat;
  const channel = answer.channels.find((each) => each.name === channelName);
  assert.ok(channel, `no channel ${channelName}`);
  const last = Math.max(...answer.messages.map((message) => message.touchedSeq));
  const posted = posts.map(({ by, blocks }, index): ChatMessage => {
    const author = answer.members.find((member) => member.name === by);
    assert.ok(author, `no member ${by}`);
    const seq = last + index + 1;
    return {
      id: `7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c${String(seq).padStart(2, "0")}`,
      seq,
      touchedSeq: seq,
      channelId: channel.id,
      authorId: author.id,
      blocks,
      mentions: [],
      postedAt: AT,
    };
  });
  return { ...chat, answer: { ...answer, messages: [...answer.messages, ...posted] } };
}

/** The words a message drew, by its place in the chat's sequence. */
function messageWords(page: HTMLElement, seq: number): HTMLElement {
  const words = page.querySelector<HTMLElement>(`.chat-message[data-seq="${seq}"] .chat-words`);
  assert.ok(words, `no words for m ${seq}`);
  return words;
}

test("a person's words keep each line break they typed, as the Inbox draws a member's, while an agent's lines join as Markdown joins them", () => {
  let seqs: number[] = [];
  const page = mount((chat) => {
    const posted = withPosts(chat, "teammate-invitations", [
      {
        by: "Dean Stratakos",
        blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "first line\nsecond line" }],
      },
      {
        by: "Invite emails",
        blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "first line\nsecond line" }],
      },
    ]);
    seqs = posted.answer.messages.slice(-2).map((message) => message.seq);
    return posted;
  });
  act(() => railRow(page, "teammate-invitations").click());
  const [person, agent] = seqs.map((seq) => messageWords(page, seq ?? 0));
  assert.equal(person?.querySelectorAll("br").length, 1, "the person's Shift-Enter stands");
  assert.equal(agent?.querySelectorAll("br").length, 0, "the agent's lines are one paragraph");
});

/** The task the fixture's chat names for its plan's channel, as the window lists it, over a repository. */
const INVITES_TASK: TaskSummary = {
  id: FIXTURE_TASK_ID,
  workspaceId: "9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

/** A commit the code a message points at is read at. */
const SHA = "0123456789abcdef0123456789abcdef01234567";

test("in a task's channel, a code block and a link to lines alone on its line are the Inbox's cards, read through the task, and a file's chip opens the file in its task", async () => {
  const read: { taskId: string; path: string; ref: string | undefined }[] = [];
  const shown: [string, CodeRef, string | undefined][] = [];
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
    // A file's lines are held unread, so a card stands as it reads them.
    [ACT_KIND.TASKS_FILE]: ({ taskId, path, ref }) => {
      read.push({ taskId, path, ref });
      return new Promise<never>(() => undefined);
    },
  });
  let seqs: number[] = [];
  const page = mount(
    (chat) => {
      const posted = withPosts(chat, "teammate-invitations", [
        {
          by: "Invite emails",
          blocks: [
            {
              type: CHAT_BLOCK.CODE,
              repo: "acme/relay",
              path: "src/invites.ts",
              sha: SHA,
              startLine: 3,
              endLine: 5,
            },
            {
              type: CHAT_BLOCK.MARKDOWN,
              text: `https://github.com/acme/relay/blob/${SHA}/src/seats.ts#L7-L9`,
            },
          ],
        },
        {
          by: "Dean Stratakos",
          blocks: [
            {
              type: CHAT_BLOCK.MARKDOWN,
              text: "see [@roles.ts](https://github.com/acme/relay/blob/HEAD/src/roles.ts) too",
            },
          ],
        },
      ]);
      seqs = posted.answer.messages.slice(-2).map((message) => message.seq);
      return posted;
    },
    ACME,
    undefined,
    undefined,
    { tasks: [INVITES_TASK], onShowFile: (...asked) => shown.push(asked) },
  );
  await settle();
  act(() => railRow(page, "teammate-invitations").click());
  const [agentSeq, personSeq] = seqs;
  const agent = page.querySelector(`.chat-message[data-seq="${agentSeq}"]`);
  assert.ok(agent);
  assert.deepEqual(
    [...agent.querySelectorAll("[data-inbox-code]")].map((card) => card.getAttribute("aria-label")),
    ["src/invites.ts, Lines 3–5", "src/seats.ts, Lines 7–9"],
  );
  // The fixture's own code in the channel is read too, so the reads of these lines are picked out by their commit.
  assert.deepEqual(
    read.filter((each) => each.ref === SHA),
    [
      { taskId: FIXTURE_TASK_ID, path: "src/invites.ts", ref: SHA },
      { taskId: FIXTURE_TASK_ID, path: "src/seats.ts", ref: SHA },
    ],
  );
  const open = agent.querySelector<HTMLButtonElement>('button[aria-label="Open file"]');
  assert.ok(open, "the code card opens its file");
  act(() => open.click());
  assert.deepEqual(shown.at(-1), [
    FIXTURE_TASK_ID,
    { path: "src/invites.ts", startLine: 3, endLine: 5 },
    SHA,
  ]);

  const chip = page.querySelector<HTMLButtonElement>(
    `.chat-message[data-seq="${personSeq}"] button[data-mention-ref]`,
  );
  assert.ok(chip, "the file's chip is a press, read against the task's repository");
  act(() => chip.click());
  assert.deepEqual(shown.at(-1), [FIXTURE_TASK_ID, { path: "src/roles.ts" }, undefined]);
});

test("outside a task's channel, a code block still names its file and lines, with nothing to read them through", () => {
  const page = mount((chat) =>
    withPosts(chat, "general", [
      {
        by: "Dean Stratakos",
        blocks: [
          {
            type: CHAT_BLOCK.CODE,
            repo: "acme/relay",
            path: "src/invites.ts",
            sha: SHA,
            startLine: 3,
            endLine: 5,
          },
        ],
      },
    ]),
  );
  act(() => railRow(page, "general").click());
  assert.equal(page.querySelector("[data-inbox-code]"), null);
  assert.match(page.querySelector(".chat-stream")?.textContent ?? "", /invites\.ts/u);
});
