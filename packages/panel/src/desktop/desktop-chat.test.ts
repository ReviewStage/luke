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
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { CONVERSATION_MEDIA_TYPE } from "@luke/features/conversation-picture-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/link-grammar";
import { TASK_SECTION_ICON_KIND } from "@luke/features/task-section-wire";
import {
  type CodeRef,
  TASK_SKILL_SOURCE,
  TASK_TREE_ENTRY,
  type TaskAgentLine,
  type TaskSummary,
} from "@luke/features/task-wire";
import { pasteCutWords } from "@luke/features/words";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { type ChatPlace, type ChatPost, FOR_YOU } from "@luke/ui/chat-model";
import type { PictureAnswer } from "@luke/ui/picture-cache";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type RefObject, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { sideBundles } from "../bundle-loader.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { ChatComposer, type ChatComposerMentions } from "../tasks/chat-composer.js";
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
import { attachmentChipName } from "../testing/attachment-chip.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pasteInComposer,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
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

/** The tasks opened from Chat, in the order asked. */
let selected: string[] = [];

beforeEach(() => {
  selected = [];
  fakeAppPlatform(QUIET_PANEL);
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: () => Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not here." }),
    },
  });
});

afterEach(() => {
  readingAs = undefined;
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
  /** How a post lands: at once, staged, unless the test holds it and stages it itself. */
  posting: (
    land: () => Promise<string | undefined>,
    post: ChatPost,
    clientKey: string,
    reader: string | undefined,
  ) => Promise<string | undefined> = (land) => land(),
  room: ShellRoom = SHELL_ROOM.WIDE,
): HTMLElement {
  function Page() {
    const [place, setPlace] = useState<ChatPlace>(FOR_YOU);
    const [chat, setChat] = useState<FixtureChat | undefined>(() => {
      const staged = fixtureChat({ fixtureMode: true }, AT);
      if (staged === undefined) return undefined;
      // Another reader signed in to the same window reads the chat as their own member.
      const reader = readingAs;
      return change(
        reader === undefined ? staged : { ...staged, answer: { ...staged.answer, self: reader } },
      );
    });
    // Note that a write is staged on the chat as it stands when it lands, as the window's own chat takes it, not as it stood when the post was sent.
    const now = useRef(chat);
    now.current = chat;
    const stage = (staged: (held: FixtureChat) => Staged) => {
      const held = now.current;
      const landed = held === undefined ? { refused: "No chat." } : staged(held);
      if ("chat" in landed) {
        now.current = landed.chat;
        setChat(landed.chat);
      }
      return Promise.resolve("refused" in landed ? landed.refused : undefined);
    };
    // The reader this draw's posts go as, as the window's chat hook binds its post to its account and workspace.
    const sentAs = readingAs;
    return createElement(DesktopChat, {
      room,
      accountName: "Dean Stratakos",
      tasks: tasksControl({
        workspace,
        onSelect: (taskId) => selected.push(taskId),
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
          onPost: (post, clientKey) =>
            posting(
              () => stage((held) => stagedPost(held, post, AT, clientKey)),
              post,
              clientKey,
              sentAs,
            ),
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
  const registry = AtomRegistry.make();
  act(() => root?.render(onRegistry(registry, page)));
  // Chat closed and opened again in the same window: the page drawn anew over the window's registry.
  reopen = () => {
    act(() => root?.render(onRegistry(registry, createElement("div"))));
    act(() => root?.render(onRegistry(registry, page)));
  };
  return container;
}

/** Closes the mounted Chat and opens it again in the same window. */
let reopen: () => void = () => undefined;

/** The member the next draw of Chat reads as, where another reader stands in the window; the fixture's own where none. */
let readingAs: string | undefined;

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
    // For you says under its name how many need the reader, in the Inbox's words, which it is read by.
    const waiting = /^(\d+) needs? you$/u.exec(
      node.querySelector(".luke-list-row-description")?.textContent ?? "",
    )?.[1];
    if (waiting !== undefined) return `${shown}${railName(node)} (${waiting})`;
    const unread = node.closest("li")?.querySelector(".inbox-row-unread") ? " •" : "";
    return `${shown}${railName(node)}${unread}`;
  });
}

/** Words as a reader sees them, a task's glyph drawn as `▣ ` before its name. */
function seen(node: Element | null | undefined): string | undefined {
  if (node === null || node === undefined) return undefined;
  const copy = node.cloneNode(true) as Element;
  for (const glyph of copy.querySelectorAll(".chat-channel-glyph")) glyph.replaceWith("▣ ");
  return copy.textContent ?? "";
}

/** The pane's messages as a reader hears them: each author and where it was posted, then its replies where the thread is open. */
function stream(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".chat-message, .chat-reply")].map((node) => {
    const byline = node.querySelector(":scope > .luke-comment > .luke-comment-head");
    const author = byline?.querySelector(".luke-comment-name")?.textContent ?? "";
    const where = seen(byline?.querySelector(".chat-byline-where"));
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
    "Add teammate invitations in ▣ teammate-invitations",
    "Invite emails in ▣ teammate-invitations",
    "Invite emails in ▣ teammate-invitations",
    "Add teammate invitations in ▣ teammate-invitations",
  ]);
});

test("a press on a channel shows its messages in the order posted, a thread folded under its root until a press opens it", () => {
  const page = mount();
  act(() => railRow(page, "teammate-invitations").click());
  assert.equal(
    seen(page.querySelector(".chat-stream .luke-pane-bar-lead")),
    "▣ teammate-invitations",
  );
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
  // Each replier's face is named to a screen reader and hangs their card, as a pull request's reviewers' are.
  const repliers = page.querySelectorAll(
    '.chat-message[data-seq="43"] .chat-thread-toggle ul[aria-label="Replies from"] > li',
  );
  assert.deepEqual(
    [...repliers].map((face) => face.getAttribute("aria-label")),
    ["Add teammate invitations", "Invite emails"],
  );
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
    (
      page.querySelector(`.chat-message[data-seq="${seq}"] .luke-comment-time time`) ??
      page.querySelector(`.chat-message[data-seq="${seq}"] time.chat-time`)
    )?.textContent;
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
    ["Copy message", "Reply"],
  );
  act(() =>
    actions?.querySelector<HTMLButtonElement>('button[aria-label="Copy message"]')?.click(),
  );
  await settle();
  assert.deepEqual(copied, [
    "Two invites to one address in one workspace would otherwise both go pending. It's one " +
      "migration, online, and nothing writes the pair twice today.",
  ]);
  assert.equal(
    actions?.querySelector('button[aria-label="Copy message"] [role="status"]')?.textContent,
    "Copied",
    "the press shows it was copied",
  );
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
    "Add teammate invitations in ▣ teammate-invitations",
    "Invite emails direct message",
    "Invite emails in ▣ teammate-invitations",
  ]);
});

/** What a box standing alone offers: no member, no task, and no channel, only the dates. */
const NO_MENTIONS: ChatComposerMentions = {
  source: { taskId: "", taskName: "", workspace: "", repository: null, text: () => "" },
  members: { people: [], agents: [] },
  channels: [],
  crowded: () => false,
};

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
    const body =
      node.querySelector(
        ":scope > .luke-comment > .luke-comment-body > .chat-message-body > .chat-words",
      ) ?? node.querySelector(":scope > .chat-message-body > .chat-words");
    return `${indent}${body?.textContent?.trim() ?? ""}`;
  });
}

/** Selects the words drawn under `within` as `words`, from `from` through `to`, as a drag lets them go. */
function selectWithin(within: Element, words: string, from: string, to: string): void {
  const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
  let text: Node | null = walker.nextNode();
  while (text !== null && !(text.textContent ?? "").includes(words)) text = walker.nextNode();
  assert.ok(text instanceof Text, `${words} is drawn`);
  const range = document.createRange();
  range.setStart(text, text.data.indexOf(from));
  range.setEnd(text, text.data.indexOf(to) + to.length);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  act(() => {
    text.parentElement?.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
}

/** Presses Reply where it stands over the selection. */
async function pressReply(): Promise<void> {
  const reply = [
    ...document.body.querySelectorAll<HTMLButtonElement>(".reply-to-selection button"),
  ].find((each) => each.textContent === "Reply");
  assert.ok(reply !== undefined, "Reply stands over the selection");
  act(() => reply.click());
  await settle();
}

/** The quotes a box holds, in order. */
function quotesIn(box: Element): (string | null)[] {
  return [...box.querySelectorAll(".composer-editor .composer-quote-words")].map(
    (quote) => quote.textContent,
  );
}

test("words selected in a channel's message quote into the channel's box, which posts them as a quote over the words typed under it, and a reply's words in an open thread quote into the thread's box", async () => {
  const posts: ChatPost[] = [];
  const page = mount(undefined, undefined, undefined, undefined, {}, (land, post) => {
    posts.push(post);
    return land();
  });
  act(() => railRow(page, "teammate-invitations").click());
  const foot = boxNamed(page, "Message #teammate-invitations");

  const split = page.querySelector('.chat-message[data-seq="52"]') ?? assert.fail("message 52");
  selectWithin(split, "before you touch the template.", "before", "template.");
  await pressReply();
  assert.deepEqual(quotesIn(foot), ["before you touch the template."]);
  typeInComposer(foot, "Waiting on it.");
  pressInComposer(foot, "Enter");
  await settle();
  assert.deepEqual(
    posts.map((post) => post.text),
    ["> before you touch the template.\n\nWaiting on it."],
  );

  act(() =>
    page
      .querySelector<HTMLButtonElement>('.chat-message[data-seq="48"] button[aria-expanded]')
      ?.click(),
  );
  const holding = page.querySelector('.chat-reply[data-seq="50"]') ?? assert.fail("reply 50");
  selectWithin(holding, "doing the resend endpoint", "doing", "meanwhile.");
  await pressReply();
  assert.deepEqual(quotesIn(boxNamed(page, "Reply in thread")), [
    "doing the resend endpoint meanwhile.",
  ]);
  assert.deepEqual(quotesIn(foot), [], "the channel's box takes none of a thread's words");
});

test("in For you, words selected in an open ask quote into its answer's note line, and a message's words open its thread and quote into its box", async () => {
  const page = mount();
  const card = openAsk(page, EXPIRY);

  selectWithin(card, "Matches password reset links", "Matches", "links");
  await pressReply();
  assert.deepEqual(quotesIn(card), ["Matches password reset links"]);

  const asking = page.querySelector('.chat-message[data-seq="47"]') ?? assert.fail("message 47");
  selectWithin(asking, "Happy to wait", "Happy", "wait");
  await pressReply();
  assert.deepEqual(quotesIn(boxNamed(asking as HTMLElement, "Reply in thread")), ["Happy to wait"]);
  assert.deepEqual(quotesIn(card), ["Matches password reset links"]);
});

/** A workspace the window lists, which a chip's link is written in. */
const ACME: Workspace = {
  id: "9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

/** The fixture task as the window lists it: its channel's task, about a repository. */
const INVITATIONS: TaskSummary = {
  id: FIXTURE_TASK_ID,
  workspaceId: "9e8d7c6b-5a49-4382-9716-05f4e3d2c1b0",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "ada/relay",
};

/** The open list as a reader sees it: each group's heading, then each row's name and what it says beside it. */
function menuRows(page: HTMLElement): string[] {
  const list = page.querySelector('.mention-menu [role="listbox"]');
  if (list === null) return [];
  return [...list.querySelectorAll('.luke-combobox-heading, [role="option"]')].map((node) => {
    if (node.classList.contains("luke-combobox-heading")) return `# ${node.textContent}`;
    const name = node.querySelector(".luke-combobox-option-label")?.textContent ?? "";
    const detail = node.querySelector(".luke-combobox-option-detail")?.textContent;
    return detail === undefined ? name : `${name} · ${detail}`;
  });
}

/** The keys the open list says it hears at its foot. */
function menuKeys(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".mention-menu .luke-menu-keys > *")].map(
    (key) => key.textContent ?? "",
  );
}

test("a channel's composer offers the members a mention there tells under the app's own @ list, each with their face, then the channel's task, writes the one chosen as their chip, and posts to the channel on Enter, leaving the box empty", async () => {
  const page = mount((chat) => chat, ACME, undefined, undefined, { tasks: [INVITATIONS] });
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "@in");
  assert.deepEqual(menuRows(page), [
    "# Agents",
    "Invite emails · This task",
    "Add teammate invitations · This task",
    "# People",
    "Maria Chen",
    "# Plan",
    "Teammate invitations · The whole plan",
  ]);
  assert.deepEqual(menuKeys(page), ["↑↓ Move", "↵ Mention", "esc Close"]);
  const faces = [...page.querySelectorAll('.mention-menu [role="option"]')].map(
    (row) => row.querySelector(".luke-combobox-option-glyph")?.childElementCount ?? 0,
  );
  assert.ok(
    faces.every((count) => count > 0),
    "every row wears its face or its glyph",
  );
  // The box names the list it opened and the row highlighted, as any combobox's field does.
  const field = composerEditor(box);
  const list = page.querySelector('.mention-menu [role="listbox"]');
  const highlighted = () => list?.querySelector('[role="option"][aria-selected="true"]')?.id;
  assert.equal(field.getAttribute("aria-controls"), list?.id);
  assert.equal(field.getAttribute("aria-activedescendant"), highlighted());
  pressInComposer(box, "End");
  assert.equal(field.getAttribute("aria-activedescendant"), highlighted());
  pressInComposer(box, "Home");
  pressInComposer(box, "Enter");
  assert.ok(box.querySelector("[data-mention-ref]"), "the agent stands in the box as its chip");
  assert.equal(page.querySelector('[role="listbox"]'), null);
  assert.equal(field.getAttribute("aria-controls"), null);
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
      ?.querySelector(".chat-byline .luke-visually-hidden")?.textContent,
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

/** The open ask whose title is `title`, as For you or a channel draws it. */
function openAsk(page: HTMLElement, title: string): HTMLElement {
  const card = [...page.querySelectorAll<HTMLElement>('.chat-ask[data-status="open"]')].find(
    (each) => [...each.querySelectorAll("p")].some((line) => line.textContent === title),
  );
  assert.ok(card, `no open ask ${title}`);
  return card;
}

/** The settled ask of the message at `seq` in the channel shown. */
function settledAsk(page: HTMLElement, seq: number): HTMLElement {
  const card = page.querySelector<HTMLElement>(`.chat-message[data-seq="${seq}"] .chat-ask`);
  assert.ok(card, `no ask on message ${seq}`);
  return card;
}

/** The press in the card whose words are `label`. */
function pressNamed(card: HTMLElement, label: string): HTMLButtonElement {
  const press = [...card.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  );
  assert.ok(press, `no ${label} press`);
  return press;
}

/** A key pressed on the element that has the keyboard. */
function pressKey(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** The card's Send. */
function sendOf(card: HTMLElement): HTMLButtonElement {
  const send = card.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
  assert.ok(send, "the card has its Send");
  return send;
}

const EXPIRY = "Invite links expire after 7 days or 14?";
const UNIQUE_INDEX = "Add a unique index on (organization_id, email) to memberships?";

test("an open choice is headed as the Inbox heads one, picked by its option's number key and sent by the box's Send, and once answered its pick stands checked under the answerer's comment", async () => {
  const page = mount();
  const card = openAsk(page, EXPIRY);
  assert.equal(card.querySelector(".inbox-ask-kind")?.textContent, "Pick one");
  const options = [...card.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  assert.deepEqual(
    options.map((option) => option.getAttribute("aria-checked")),
    ["false", "false"],
  );
  // Send stands held until the card holds something to send.
  assert.equal(sendOf(card).disabled, true);
  const [first] = options;
  assert.ok(first);
  act(() => first.focus());
  pressKey(first, "2");
  const fourteen = options.find((option) => option.textContent?.startsWith("14 days"));
  assert.equal(fourteen?.getAttribute("aria-checked"), "true");
  assert.equal(
    document.activeElement,
    fourteen,
    "the key takes the keyboard to the option it picks",
  );
  assert.equal(rail(page)[0], "▸ For you (4)", "a pick sends nothing on its own");
  act(() => sendOf(card).click());
  await settle();
  assert.equal(rail(page)[0], "▸ For you (3)");
  // The answered ask leaves For you, so the channel shows it settled.
  act(() => railRow(page, "teammate-invitations").click());
  const settled = settledAsk(page, 46);
  assert.equal(settled.querySelector(".inbox-ask-standing")?.textContent, "Answered");
  const answer = settled.querySelector('.inbox-comment[data-inbox-comment="answered"]');
  assert.ok(answer, "the answer stands as its answerer's comment");
  assert.match(answer.querySelector(".luke-comment-trailing")?.textContent ?? "", /Sent to/u);
  const picked = [...answer.querySelectorAll('[role="radio"][aria-checked="true"]')];
  assert.deepEqual(
    picked.map((option) => option.textContent?.startsWith("14 days")),
    [true],
  );
  assert.equal(settled.querySelector('button[aria-label="Send"]'), null);
});

test("an approval's Approve is held until Send sends it, a note with no decision sends nothing and takes the keyboard to Approve, and once answered Approve stands pressed in green; a reply typed under an opened thread lands in that thread", async () => {
  const page = mount();
  const card = openAsk(page, UNIQUE_INDEX);
  typeInComposer(card, "go ahead");
  act(() => sendOf(card).click());
  await settle();
  assert.equal(rail(page)[0], "▸ For you (4)", "an approval takes a decision");
  assert.equal(document.activeElement, pressNamed(card, "Approve"));
  // A number key picks one of the two presses and takes the keyboard to it, wherever in the card it stood.
  act(() => sendOf(card).focus());
  pressKey(sendOf(card), "2");
  assert.equal(pressNamed(card, "Decline").getAttribute("aria-pressed"), "true");
  assert.equal(document.activeElement, pressNamed(card, "Decline"));
  act(() => pressNamed(card, "Approve").click());
  assert.equal(pressNamed(card, "Decline").getAttribute("aria-pressed"), "false");
  assert.equal(pressNamed(card, "Approve").getAttribute("aria-pressed"), "true");
  assert.equal(rail(page)[0], "▸ For you (4)", "Approve sends nothing on its own");
  act(() => sendOf(card).click());
  await settle();
  assert.equal(rail(page)[0], "▸ For you (3)");

  act(() => railRow(page, "teammate-invitations").click());
  const settled = settledAsk(page, 51);
  const approve = pressNamed(settled, "Approve");
  assert.equal(approve.getAttribute("aria-pressed"), "true");
  assert.ok(approve.querySelector('.inbox-ask-pressed[data-tone="ahead"]'), "Approve wears green");
  assert.equal(pressNamed(settled, "Decline").getAttribute("aria-pressed"), "false");
  assert.equal(settled.querySelector("[data-inbox-note]")?.textContent?.trim(), "go ahead");

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

test("an ask's note and decision are there again when Chat closes and opens again", async () => {
  const page = mount();
  const card = openAsk(page, UNIQUE_INDEX);
  typeInComposer(card, "go ahead");
  act(() => pressNamed(card, "Approve").click());
  reopen();

  const again = openAsk(page, UNIQUE_INDEX);
  assert.equal(boxWords(again), "go ahead");
  assert.equal(pressNamed(again, "Approve").getAttribute("aria-pressed"), "true");
  act(() => sendOf(again).click());
  await settle();
  assert.equal(rail(page)[0], "▸ For you (3)");
  act(() => railRow(page, "teammate-invitations").click());
  assert.equal(
    settledAsk(page, 51).querySelector("[data-inbox-note]")?.textContent?.trim(),
    "go ahead",
  );
});

test("a paste past an ask note's cap is cut to the room left and the card's note line says so, until the words change", () => {
  const page = mount();
  const card = openAsk(page, UNIQUE_INDEX);
  const cap = CHAT_BOUNDS.MAX_NOTE_CHARS;
  const note = () => card.querySelector(".luke-composer-foot-note")?.textContent;

  pasteInComposer(card, "x".repeat(cap + 100));
  assert.equal(boxWords(card).length, cap);
  assert.equal(note(), pasteCutWords(cap));

  const editor = composerEditor(card).editor;
  assert.ok(editor, "the editor is running");
  act(() => {
    editor.view.dispatch(editor.state.tr.delete(1, 2));
  });
  assert.equal(note(), undefined, "the note goes once the words change again");
});

test("a form's text field is the composer's own field, its answer stands in its fields read-only, and the reply in its thread says the same", async () => {
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
  const card = openAsk(page, "Where do the seats go?");
  assert.equal(card.querySelector(".inbox-ask-kind")?.textContent, "Fill in");
  const region = card.querySelector<HTMLElement>('[data-inbox-field="text"]');
  const seats = card.querySelector<HTMLInputElement>('[data-inbox-field="number"] input');
  assert.ok(region && seats);
  typeInComposer(region, "US");
  fill(seats, "12");
  act(() => sendOf(card).click());
  await settle();
  act(() => railRow(page, "teammate-invitations").click());
  const settled = settledAsk(page, 51);
  assert.equal(
    settled.querySelector('[data-inbox-answered-field="text"] .inbox-field-words')?.textContent,
    "US",
  );
  assert.equal(
    settled.querySelector<HTMLInputElement>('[data-inbox-answered-field="number"] input')?.value,
    "12",
  );
  act(() =>
    page
      .querySelector<HTMLButtonElement>('.chat-message[data-seq="51"] button[aria-expanded]')
      ?.click(),
  );
  assert.match(words(page).join("\n"), /↳ Filled in the form\.\s*Region: US\s*Seats: 12/u);
});

test("a form none of whose fields must be filled may be sent empty", async () => {
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
                title: "Anything to add?",
                response: { type: CHAT_ASK.FORM, fields: [{ type: "number", label: "Seats" }] },
              },
            }
          : message,
      ),
    },
  }));
  const card = openAsk(page, "Anything to add?");
  assert.equal(sendOf(card).disabled, false);
  act(() => sendOf(card).click());
  await settle();
  assert.equal(rail(page)[0], "▸ For you (3)");
});

test("an ask its poster resolved says it was withdrawn in its head and why in its body, and one asking nothing is nodded to by Got it, which settles it as acknowledged", async () => {
  const page = mount((chat) => ({
    ...chat,
    answer: {
      ...chat.answer,
      messages: chat.answer.messages.map((message) => {
        if (message.ask === undefined) return message;
        if (message.seq === 46) {
          return {
            ...message,
            ask: {
              ...message.ask,
              status: ASK_STATUS.CLOSED,
              closedReason: "Settled in the plan.",
            },
          };
        }
        return { ...message, ask: { ...message.ask, response: { type: CHAT_ASK.NONE } } };
      }),
    },
  }));
  const notice = openAsk(page, UNIQUE_INDEX);
  assert.equal(
    notice.querySelector(".luke-card-head"),
    null,
    "a notice asks nothing, so wears no head",
  );
  act(() => pressNamed(notice, "Got it").click());
  await settle();
  act(() => railRow(page, "teammate-invitations").click());
  assert.equal(
    settledAsk(page, 46).querySelector(".luke-card-head")?.textContent,
    "Pick oneWithdrawn",
  );
  assert.equal(
    settledAsk(page, 46).querySelector("[data-inbox-withdrawn-why]")?.textContent,
    "Settled in the plan.",
    "why it was withdrawn stands under the head, as a sentence of its own",
  );
  assert.equal(settledAsk(page, 46).querySelector('[role="radio"]'), null);
  assert.equal(
    settledAsk(page, 51).querySelector("[data-inbox-pick]")?.textContent,
    "Acknowledged it",
  );
});

test("an ask of the developer's own waits on the members it names, with nothing to answer it by", () => {
  const page = mount((chat) => ({
    ...chat,
    answer: {
      ...chat.answer,
      messages: chat.answer.messages.map((message) =>
        message.seq === 52
          ? {
              ...message,
              ask: {
                key: "split",
                revision: 1,
                status: ASK_STATUS.OPEN,
                title: "Split it this way?",
                needsReply: true,
                response: { type: CHAT_ASK.APPROVAL },
              },
            }
          : message,
      ),
    },
  }));
  act(() => railRow(page, "teammate-invitations").click());
  const card = openAsk(page, "Split it this way?");
  assert.equal(
    card.querySelector("[data-inbox-marker]")?.textContent,
    "Waiting on Add teammate invitations and Invite emails",
  );
  // Note that the words' mention chips are presses of their own, so the card is read for its box alone.
  assert.equal(card.querySelector(".inbox-answer"), null);
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

test("until the chat is read, the window's Chat keeps its titled bar with New channel over placeholder rows saying it is read, and the plan's Chat tab's wait stands centred, rather than as a ring in the corner", () => {
  const chat = mount(() => undefined);
  const bar = chat.querySelector(".chat-rail .desktop-toolbar");
  assert.equal(bar?.querySelector("h1.desktop-toolbar-title")?.textContent, "Chat");
  const create = bar?.querySelector<HTMLButtonElement>('button[aria-label="New channel"]');
  assert.ok(create, "New channel stands while it is read");
  assert.equal(create.disabled, true, "but opens no channel against no chat");
  const windowWait = chat.querySelector('.chat-rail [role="status"]');
  assert.ok(windowWait, "the window's Chat says it is waiting");
  assert.equal(windowWait.querySelector(".luke-visually-hidden")?.textContent, "Reading chat…");
  assert.ok(windowWait.querySelector(".luke-list-row"), "the wait stands as the rail's rows");
  assert.equal(chat.querySelector(".luke-spinner-region"), null);
  act(() => root?.unmount());

  const tab = mountTaskTabReading();
  const tabWait = tab.querySelector('.task-chat [role="status"]');
  assert.ok(tabWait, "the plan's Chat tab says it is waiting");
  assert.ok(tabWait.closest(".luke-spinner-region"), "the wait fills the plan's Chat tab");
});

test("a direct message between two others reads as theirs, named by both, with no box to post in it and no Reply under its messages or over their words", () => {
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
  // Its row's mark draws both of its two, as its name names both.
  const pair = railRow(page, "Add teammate invitations ↔ Invite emails").closest("li");
  assert.equal(pair?.querySelectorAll(".inbox-row-mark .actor-stack .actor-mark").length, 2);
  act(() => railRow(page, "Add teammate invitations ↔ Invite emails").click());
  assert.equal(
    page.querySelector(".chat-stream .luke-pane-bar-title")?.textContent,
    "Add teammate invitations ↔ Invite emails",
  );
  assert.equal(page.querySelector(".chat-composer"), null);
  assert.match(
    page.textContent ?? "",
    /Only Add teammate invitations and Invite emails post in this conversation\./u,
  );
  assert.equal(page.querySelector(".chat-message button[aria-expanded]"), null);
  // Words selected in it have no box to be quoted into, so no Reply stands over them.
  const said = page.querySelector(".chat-message .chat-words") ?? assert.fail("its words");
  const first = said.textContent?.trim().split(" ")[0] ?? "";
  selectWithin(said, first, first, first);
  assert.equal(
    [...document.body.querySelectorAll(".reply-to-selection button")].length,
    0,
    "no Reply stands where nothing takes a quote",
  );
  // Its open ask reads as waiting on the other of the two, with nothing to answer it by.
  const ask = page.querySelector('.chat-ask[data-status="open"]');
  assert.equal(
    ask?.querySelector("[data-inbox-marker]")?.textContent,
    "Waiting on Add teammate invitations",
  );
  assert.equal(ask?.querySelector("button"), null);
});

test("a # at the start of a word offers the channels in the same list as an @, and the one chosen is written as its name, the box holding a microphone beside its send", () => {
  const page = mount((chat) => chat, undefined, undefined, undefined, { tasks: [INVITATIONS] });
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "see #");
  const all = menuRows(page);
  typeInComposer(box, "bill");
  assert.deepEqual(all, [
    "# Channels",
    "general",
    "teammate-invitations · Teammate invitations",
    "billing-export",
    "members-schema",
  ]);
  assert.deepEqual(menuRows(page), ["# Channels", "billing-export"]);
  assert.deepEqual(menuKeys(page), ["↑↓ Move", "↵ Mention", "esc Close"]);
  pressInComposer(box, "Enter");
  assert.equal(boxWords(box), "see #billing-export ");
  assert.ok(box.querySelector('button[aria-label="Dictate"]'), "the box takes a dictation");
});

test("a task's channel offers its repository's files and its agents' pull requests as the agent box does, a queued one marked queued, and dates down to the picker", async () => {
  const told: unknown[] = [];
  fakeActPort({
    [ACT_KIND.TASKS_TREE]: (payload) => {
      told.push(payload);
      return Promise.resolve({
        folder: {
          path: "",
          repository: "ada/relay",
          branch: "main",
          entries: [{ name: "apps/web/invite-email.ts", kind: TASK_TREE_ENTRY.FILE }],
          truncated: false,
        },
      });
    },
  });
  const opened: TaskSummary = {
    ...INVITATIONS,
    agents: {
      total: 1,
      working: 0,
      agents: [],
      pullRequestTotal: 1,
      pullRequests: [
        {
          number: 214,
          title: "Send invite emails",
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PASSING,
          additions: 1,
          deletions: 0,
          url: "https://github.com/ada/relay/pull/214",
          queued: true,
        },
      ],
    },
  };
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  let kinds: string[];
  let offered: string[];
  let mark: string | null | undefined;
  let dates: string[];
  try {
    const page = mount((chat) => chat, ACME, undefined, undefined, { tasks: [opened] });
    act(() => railRow(page, "teammate-invitations").click());
    const box = boxNamed(page, "Message #teammate-invitations");
    typeInComposer(box, "@");
    await settle();
    kinds = menuRows(page).slice(menuRows(page).indexOf("# Mention from"));
    typeInComposer(box, "invite");
    offered = menuRows(page);
    mark = page
      .querySelector('.mention-menu [aria-label="Pull requests"] [data-pull-request-mark]')
      ?.getAttribute("data-pull-request-state");
    pressInComposer(box, "Escape");
    typeInComposer(box, " @dates:");
    dates = menuRows(page);
  } finally {
    vi.useRealTimers();
  }

  assert.deepEqual(told, [{ planId: FIXTURE_TASK_ID, path: "", recursive: true }]);
  // The members a mention tells lead, and the plan, whose words the window's Chat does not hold, says no count of its sections.
  assert.deepEqual(kinds, [
    "# Mention from",
    "Agents · 2 agents",
    "People · 1 member",
    "Files and folders · ada/relay",
    "Plan",
    "Pull requests · 1 pull request",
    "Dates · A day, a time, or a range",
  ]);
  assert.deepEqual(offered, [
    "# Agents",
    "Invite emails · This task",
    "# Files and folders",
    "invite-email.ts · apps/web",
    "# Pull requests",
    "#214 Send invite emails · Pull request",
  ]);
  assert.equal(mark, "queued", "a pull request in the merge queue is offered queued");
  assert.deepEqual(dates, [
    "Today · Oct 19, 2026",
    "Tomorrow · Oct 20, 2026",
    "Oct 26 · Oct 26, 2026",
    "Pick a date…",
  ]);
});

test("an @ or a # word that names nothing says so, and Enter there still posts the words", async () => {
  const page = mount((chat) => chat, ACME);
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "ask @zzz");
  const nobody = page.querySelector(".mention-menu .luke-combobox-empty")?.textContent;
  pressInComposer(box, "Enter");
  await settle();
  typeInComposer(box, "see #zzz");
  const nowhere = page.querySelector(".mention-menu .luke-combobox-empty")?.textContent;
  pressInComposer(box, "Enter");
  await settle();

  assert.equal(nobody, "No results match");
  assert.equal(nowhere, "No results match");
  assert.deepEqual(words(page).slice(-2), ["ask @zzz", "see #zzz"]);
  assert.equal(boxWords(box), "");
});

test("a post addressing more members than it tells says under its box that only the first few are told, a reply's thread counted after its mentions", () => {
  const page = mount(
    (chat) => ({
      ...chat,
      answer: {
        ...chat.answer,
        members: [
          ...chat.answer.members,
          {
            id: "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8f",
            kind: MEMBER_KIND.HUMAN,
            name: "Zoe Park",
            userId: "zoe",
            left: false,
          },
        ],
      },
    }),
    ACME,
  );
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  const crowded = () => box.querySelector(".chat-composer-crowded")?.textContent ?? "";
  for (const name of ["@maria", "@invite", "@add"]) {
    typeInComposer(box, name);
    pressInComposer(box, "Enter");
  }
  const three = crowded();
  typeInComposer(box, "@zoe");
  pressInComposer(box, "Enter");

  const four = crowded();

  // A reply tells its thread's author and repliers after those it mentions.
  act(() =>
    page
      .querySelector<HTMLButtonElement>('.chat-message[data-seq="48"] button[aria-expanded]')
      ?.click(),
  );
  const reply = boxNamed(page, "Reply in thread");
  const replyCrowded = () => reply.querySelector(".chat-composer-crowded")?.textContent ?? "";
  typeInComposer(reply, "@maria");
  pressInComposer(reply, "Enter");
  const withThread = replyCrowded();
  typeInComposer(reply, "@zoe");
  pressInComposer(reply, "Enter");

  assert.equal(three, "", "three members are each told");
  assert.equal(four, "Only 3 members are notified of a post.");
  assert.equal(box.querySelectorAll("[data-mention-ref]").length, 4);
  assert.equal(withThread, "", "one mention and the thread's two agents are each told");
  assert.equal(replyCrowded(), "Only 3 members are notified of a post.");
});

/** Chat's box where the editor's bundle could not be loaded, every post it makes written down. */
async function plainChat(
  replyDoor: RefObject<((words: string) => boolean) | undefined> | undefined = undefined,
) {
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
            mentions: NO_MENTIONS,
            keywords: [],
            replyDoor,
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

test("where the editor's bundle could not be loaded, the box is a plain field that opens no list, as a plan comment's does, and posts its words", async () => {
  const { container, field, sent } = await plainChat();
  writeInto(field, "@tomorrow");
  assert.equal(container.querySelector('[role="listbox"]'), null);
  writeInto(field, "@tomorrow ship it");
  pressInField(field, { key: "Enter" });
  await settle();
  assert.deepEqual(sent, ["@tomorrow ship it"]);
  assert.equal(field.getAttribute("enterkeyhint"), "send");
  assert.equal(container.querySelector('button[aria-label="Dictate"]'), null);
});

test("where the editor's bundle could not be loaded, a reply's quote is written at the plain field's end as a blockquote, cut to the room the post has left", async () => {
  const door: { current: ((words: string) => boolean) | undefined } = { current: undefined };
  const { field } = await plainChat(door);
  const long = "a".repeat(2_000);

  act(() => {
    door.current?.("Happy to wait");
  });
  assert.equal(field.value, "> Happy to wait\n\n");
  act(() => {
    door.current?.(long);
  });
  act(() => {
    door.current?.(long);
  });
  assert.ok(field.value.length <= CHAT_BOUNDS.MAX_TEXT_CHARS, "the post stays sendable");
  assert.ok(field.value.trimEnd().endsWith("…"), "the quote that would not fit is cut short");
});

test("on a coarse pointer the plain field's Enter is a new line, its return key says so, and ⌘+Enter posts", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
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
  assert.equal(
    page.querySelector(".chat-stream .luke-pane-bar-title")?.textContent,
    "#release-train",
  );
  assert.match(
    page.querySelector(".chat-stream .luke-pane-bar")?.textContent ?? "",
    /What ships Friday/u,
  );

  const actions = page.querySelector<HTMLButtonElement>(
    '.chat-stream .luke-pane-bar button[aria-label="#release-train actions"]',
  );
  assert.ok(actions, "a topic's head offers its actions");
  act(() => actions.click());
  const archive = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Archive channel",
  );
  act(() => archive?.click());
  // Archiving reaches everyone in the channel but can be undone, so it asks in the accent, not red.
  assert.equal(dialogButton("Archive channel").getAttribute("data-variant"), "primary");
  act(() => dialogButton("Archive channel").click());
  await settle();
  // The topic archived while it is read keeps its row in sight, under Archived, still the one shown.
  const archivedRows = () =>
    [...page.querySelectorAll(".chat-rail .sidebar-repository")]
      .filter((group) => group.textContent?.startsWith("Archived"))
      .flatMap((group) => [...group.querySelectorAll("li .luke-list-row-main")].map(railName));
  assert.deepEqual(archivedRows(), ["release-train"]);
  assert.ok(rail(page).includes("▸ release-train"));
  // Its foot offers to bring it back where its box stood.
  const foot = page.querySelector<HTMLElement>(".chat-stream .agent-composer");
  assert.match(foot?.textContent ?? "", /This channel is archived/u);
  act(() => railRow(page, "general").click());
  assert.deepEqual(archivedRows(), [], "the archived leave the rail once another place is shown");

  // View options shows the archived channels, and a topic among them is brought back from its foot.
  pickViewOption(page, "Show archived channels");
  assert.deepEqual(archivedRows(), ["release-train"]);
  act(() => railRow(page, "release-train").click());
  const bring = [
    ...page.querySelectorAll<HTMLButtonElement>(".chat-stream .agent-composer button"),
  ].find((each) => each.textContent === "Bring back channel");
  assert.ok(bring, "the archived topic's foot offers to bring it back");
  act(() => bring.click());
  assert.equal(dialogButton("Bring back").getAttribute("data-variant"), "primary");
  act(() => dialogButton("Bring back").click());
  await settle();
  assert.ok(
    rail(page).includes("▸ release-train"),
    "the topic stands among the channels again, shown",
  );
  assert.deepEqual(archivedRows(), [], "nothing is left archived");
  assert.ok(boxNamed(page, "Message #release-train"), "its box stands again");
});

/** Picks an item of the rail's View options by its words. */
function pickViewOption(page: HTMLElement, label: string): void {
  act(() =>
    page
      .querySelector<HTMLButtonElement>(
        '.chat-rail > .luke-toolbar button[aria-label="View options"]',
      )
      ?.click(),
  );
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'),
  ].find((each) => each.textContent?.includes(label));
  assert.ok(item, `no ${label} in View options`);
  act(() => item.click());
}

/** The items of the menu a channel's head ends on, as its words, the disabled marked `(off)`. */
function channelMenu(page: HTMLElement): string[] {
  const actions = page.querySelector<HTMLButtonElement>(
    '.chat-stream .luke-pane-bar button[aria-label$=" actions"]',
  );
  assert.ok(actions, "the channel's head ends on its menu");
  act(() => actions.click());
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => {
    const off = item.getAttribute("aria-disabled") === "true" || item.hasAttribute("disabled");
    return `${item.textContent ?? ""}${off ? " (off)" : ""}`;
  });
}

/** Presses an item of the open menu by its words. */
function pressMenuItem(label: string): void {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.textContent === label,
  );
  assert.ok(item, `no ${label} in the menu`);
  act(() => item.click());
}

test("every channel's head ends on its menu: Mark as read and Copy link for each, Open task for a task's, Edit and Archive for a topic's", () => {
  const page = mount(undefined, ACME);
  act(() => railRow(page, "teammate-invitations").click());
  assert.deepEqual(channelMenu(page), ["Mark as read", "Copy link", "Open task"]);
  // Mark as read takes the unread dot off its row, and is offered no more.
  pressMenuItem("Mark as read");
  assert.ok(rail(page).includes("▸ teammate-invitations"));
  assert.deepEqual(channelMenu(page), ["Mark as read (off)", "Copy link", "Open task"]);
  pressMenuItem("Open task");
  assert.deepEqual(selected, [FIXTURE_TASK_ID], "Open task opens the channel's task");

  act(() => railRow(page, "Maria Chen").click());
  assert.deepEqual(channelMenu(page), ["Mark as read (off)", "Copy link"]);
  act(() => railRow(page, "members-schema").click());
  assert.deepEqual(channelMenu(page), [
    "Mark as read (off)",
    "Copy link",
    "Edit channel",
    "Archive channel",
  ]);
});

test("the rail's bar is a page's toolbar: Chat's title and its Experimental tag, View options, New channel, and Send feedback; Mark all as read takes every unread dot off", () => {
  const page = mount();
  const bar = page.querySelector(".chat-rail > .luke-toolbar");
  assert.equal(bar?.querySelector("h1.desktop-toolbar-title")?.textContent, "Chat");
  assert.equal(
    bar?.querySelector(".luke-toolbar-heading > .luke-toolbar-tag .experiment-tag")?.textContent,
    "Experimental",
  );
  assert.deepEqual(
    [...(bar?.querySelectorAll(".luke-toolbar-actions button") ?? [])].map(
      (each) => each.getAttribute("aria-label") ?? each.textContent,
    ),
    ["View options", "New channel", "Send feedback"],
  );
  assert.ok(
    rail(page).some((row) => row.endsWith(" •")),
    "something waits unread",
  );
  pickViewOption(page, "Mark all as read");
  assert.deepEqual(
    rail(page).filter((row) => row.endsWith(" •")),
    [],
    "nothing waits unread",
  );
});

test("on a phone the rail's Experimental tag is the experiment's glyph alone, still called Experimental, so Chat's title keeps its room", () => {
  const page = mount(undefined, undefined, undefined, undefined, {}, undefined, SHELL_ROOM.NARROW);
  const tag = page.querySelector(".chat-rail-head .experiment-tag");
  assert.equal(tag?.getAttribute("role"), "img");
  assert.equal(tag?.getAttribute("aria-label"), "Experimental");
  assert.equal(tag?.textContent, "", "no words beside the title");
  assert.equal(page.querySelector(".chat-rail-head h1")?.textContent, "Chat");
  // The head holds one control a corner, New channel and the ⋯, which offers the rest.
  assert.deepEqual(
    [...page.querySelectorAll(".chat-rail-head button")].map((each) =>
      each.getAttribute("aria-label"),
    ),
    ["New channel", "Chat actions"],
  );
  act(() =>
    page.querySelector<HTMLButtonElement>('.chat-rail-head [aria-label="Chat actions"]')?.click(),
  );
  assert.deepEqual(
    [...document.querySelectorAll('[role="menu"] .luke-menu-item-label')].map(
      (each) => each.textContent,
    ),
    ["View options", "Send feedback"],
  );
  const options = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')][0];
  act(() => options?.click());
  assert.ok(
    document.querySelector('[role="menu"][aria-label="View options"]:not([data-leaving])'),
    "View options' own menu stands",
  );
});

test("a For you row names a task's channel by its glyph and name, and a press on it opens the channel", () => {
  const page = mount();
  const where = page.querySelector<HTMLElement>(".chat-message .chat-byline-where");
  assert.ok(where?.querySelector(".chat-channel-glyph svg"), "the task's glyph");
  const link = where?.querySelector<HTMLButtonElement>("button");
  assert.equal(seen(link), "▣ teammate-invitations");
  act(() => link?.click());
  assert.equal(
    seen(page.querySelector(".chat-stream .luke-pane-bar-lead")),
    "▣ teammate-invitations",
  );
  assert.equal(railRow(page, "teammate-invitations").getAttribute("aria-current"), "page");
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
  return [...box.querySelectorAll('[aria-label="Attached files"] > li')].map(attachmentChipName);
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

  act(() => alone?.querySelector<HTMLButtonElement>(".picture-block button")?.click());
  assert.ok(
    document.querySelector('[role="dialog"] img[src^="data:image/png"]'),
    "a press opens the picture over the window",
  );
});

test("a recording a message carries plays where it stands, left out of the replay, and its Expand opens the viewer a picture does, which plays it", async () => {
  const created: string[] = [];
  const own = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  // Note that jsdom makes no object URLs, so the window's own are stood in for, and put back after.
  URL.createObjectURL = (blob: Blob) => {
    created.push(blob.type);
    return `blob:video-${String(created.length)}`;
  };
  URL.revokeObjectURL = () => undefined;
  try {
    const page = mount(
      (chat) => chat,
      undefined,
      () => Promise.resolve({ contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: "GkXfow==" }),
    );
    act(() => railRow(page, "teammate-invitations").click());
    const box = boxNamed(page, "Message #teammate-invitations");
    await handFiles(
      box,
      [new File([PNG_BYTES], "invite-flow.webm", { type: CHAT_IMAGE_TYPE.PNG })],
      "pick",
    );
    pressInComposer(box, "Enter");
    await settle();

    const posted = [...page.querySelectorAll(".chat-message")].at(-1);
    const inline = posted?.querySelector("video");
    assert.ok(inline, "the recording plays where the message draws it");
    assert.equal(inline.getAttribute("src"), "blob:video-1");
    assert.deepEqual(
      [...(inline.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Expand", "Full screen"],
      "under Luke's own bar, with an Expand into the viewer",
    );
    assert.equal(inline.hasAttribute("controls"), false, "and not the browser's");
    assert.ok(inline.closest(".ph-no-capture"), "the player is left out of the replay");
    assert.equal(posted?.querySelector('button[aria-label^="Enlarge"]'), null);
    const expand = posted?.querySelector<HTMLButtonElement>('button[aria-label="Expand"]');
    assert.ok(expand, "the recording's Expand opens the viewer");
    act(() => expand.click());
    await settle();

    const player = document.querySelector('[role="dialog"] video');
    assert.ok(player, "the viewer plays the recording");
    assert.deepEqual(
      [...(player.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Full screen"],
      "under Luke's own bar",
    );
    assert.equal(player.hasAttribute("controls"), false, "and not the browser's");
    assert.equal(player.getAttribute("src"), "blob:video-2");
    assert.equal(player.getAttribute("aria-label"), "Video: invite-flow.webm");
    assert.ok(player.closest(".ph-no-capture"), "the player is left out of the replay");
    assert.deepEqual(created, [CONVERSATION_MEDIA_TYPE.WEBM, CONVERSATION_MEDIA_TYPE.WEBM]);
  } finally {
    URL.createObjectURL = own.create;
    URL.revokeObjectURL = own.revoke;
  }
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
  const named = [...page.querySelectorAll(".luke-comment-name")].map((each) => each.textContent);
  assert.ok(named.includes("Maria Chen"), "her messages name her as the members read does");
  assert.ok(
    page.querySelector(".luke-comment-face img[src^='https://example.com/maria.png']"),
    "and lead with her photo",
  );
});

test("an agent's line names it by its title alone, as every place of the window names it, and a press on its name opens its tab", () => {
  const opened: ReadLink[] = [];
  const page = mount((chat) => chat, undefined, undefined, opened);
  act(() => railRow(page, "teammate-invitations").click());
  const byline = [...page.querySelectorAll(".chat-message .luke-comment-head")].find(
    (each) => each.querySelector(".luke-comment-name")?.textContent === "Add teammate invitations",
  );
  assert.ok(byline);
  assert.doesNotMatch(byline.textContent ?? "", /@/u, "no handle beside it");
  const name = byline.querySelector<HTMLButtonElement>(".luke-comment-name button");
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
  const agentLine = [...page.querySelectorAll(".chat-message .luke-comment-head")].find(
    (byline) =>
      byline.querySelector(".luke-comment-name")?.textContent === "Add teammate invitations",
  );
  assert.ok(agentLine, "the agent is named by the name the read carries");
  act(() => agentLine?.querySelector<HTMLButtonElement>(".luke-comment-name button")?.click());
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

test("the rail's rows draw in the sidebar's ink, and every message leads with its author's face", () => {
  const page = mount((chat) => chat);
  const rows = [...page.querySelectorAll(".chat-rail .luke-list-row")];
  assert.ok(rows.length > 0, "the rail holds rows");
  assert.deepEqual(
    [...new Set(rows.map((each) => each.getAttribute("data-ink")))],
    ["sidebar"],
    "every rail row wears the sidebar's ink",
  );
  act(() => railRow(page, "teammate-invitations").click());
  const faces = [...page.querySelectorAll(".luke-comment-face .luke-avatar")];
  assert.ok(faces.length > 0, "messages lead with faces");
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
      agentEntries: [],
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
function cardOn(row: HTMLElement): Element | null {
  restOn(row);
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
  assert.ok(cardOn(railRow(page, "teammate-invitations"))?.querySelector("[data-task-card]"));
  assert.ok(cardOn(railRow(page, "Invite emails"))?.querySelector("[data-tab-card]"));
  assert.ok(cardOn(railRow(page, "Maria Chen"))?.querySelector('[data-actor-card="person"]'));
  const general = cardOn(railRow(page, "general"));
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
    'button[aria-label="Pinned actions"]',
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

test("in the window's Chat, a person's /skill in a task's channel is drawn as its chip, read from the task's skills, and opens its file in the task", async () => {
  const shown: [string, CodeRef, string | undefined][] = [];
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.TASKS_FILE]: () => new Promise<never>(() => undefined),
    [ACT_KIND.TASKS_SKILLS]: () =>
      Promise.resolve({
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: [
            {
              name: "release",
              description: "Cut a release.",
              source: TASK_SKILL_SOURCE.REPOSITORY,
              path: ".agents/skills/release/SKILL.md",
            },
          ],
        },
      }),
  });
  let seq = 0;
  const page = mount(
    (chat) => {
      const posted = withPosts(chat, "teammate-invitations", [
        {
          by: "Dean Stratakos",
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "run /release next" }],
        },
      ]);
      seq = posted.answer.messages.at(-1)?.seq ?? 0;
      return posted;
    },
    ACME,
    undefined,
    undefined,
    { tasks: [INVITES_TASK], onShowFile: (...asked) => shown.push(asked) },
  );
  await settle();
  act(() => railRow(page, "teammate-invitations").click());
  await settle();
  const chip = messageWords(page, seq).querySelector<HTMLElement>("[data-skill-ref]");
  assert.ok(chip, "the skill is its chip");
  const press = chip.matches("button") ? chip : chip.querySelector<HTMLElement>("button");
  act(() => press?.click());
  assert.deepEqual(shown.at(-1), [
    FIXTURE_TASK_ID,
    { path: ".agents/skills/release/SKILL.md" },
    undefined,
  ]);
});

test("a task's skills are read once while the listed tasks change around it, rather than again on every draw", async () => {
  let reads = 0;
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.TASKS_FILE]: () => new Promise<never>(() => undefined),
    [ACT_KIND.TASKS_SKILLS]: () => {
      reads += 1;
      return Promise.resolve({
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: [
            {
              name: "release",
              description: "Cut a release.",
              source: TASK_SKILL_SOURCE.REPOSITORY,
              path: "SKILL.md",
            },
          ],
        },
      });
    },
  });
  let seq = 0;
  // Each draw lists the task anew, as a change to any listed task hands the window a new list.
  const listing: Partial<TasksControl> = {
    get tasks() {
      return [{ ...INVITES_TASK }];
    },
  };
  const page = mount(
    (chat) => {
      const posted = withPosts(chat, "teammate-invitations", [
        {
          by: "Dean Stratakos",
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "run /release next" }],
        },
      ]);
      seq = posted.answer.messages.at(-1)?.seq ?? 0;
      return posted;
    },
    ACME,
    undefined,
    undefined,
    listing,
  );
  await settle();
  act(() => railRow(page, "teammate-invitations").click());
  await settle();
  assert.ok(messageWords(page, seq).querySelector("[data-skill-ref]"), "the skill is its chip");
  // A post draws the window again over a new list of its tasks.
  const box = boxNamed(page, "Message #teammate-invitations");
  typeInComposer(box, "shipping it");
  pressInComposer(box, "Enter");
  await settle();
  assert.ok(messageWords(page, seq).querySelector("[data-skill-ref]"), "the chip stands");
  assert.equal(reads, 1, "the skills are not read again");
});

test("a task whose repository is let go reads its installed skills alone, and chosen again reads its skills afresh", async () => {
  let reads = 0;
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.TASKS_FILE]: () => new Promise<never>(() => undefined),
    [ACT_KIND.TASKS_SKILLS]: () => {
      reads += 1;
      return Promise.resolve({
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: [
            {
              name: "release",
              description: "Cut a release.",
              source: TASK_SKILL_SOURCE.REPOSITORY,
              path: "SKILL.md",
            },
          ],
        },
      });
    },
  });
  let repository: string | null = INVITES_TASK.repository;
  const listing: Partial<TasksControl> = {
    get tasks() {
      return [{ ...INVITES_TASK, repository }];
    },
  };
  const page = mount(
    (chat) =>
      withPosts(chat, "teammate-invitations", [
        {
          by: "Dean Stratakos",
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "run /release next" }],
        },
      ]),
    ACME,
    undefined,
    undefined,
    listing,
  );
  await settle();
  act(() => railRow(page, "teammate-invitations").click());
  await settle();
  const post = async (words: string) => {
    const box = boxNamed(page, "Message #teammate-invitations");
    typeInComposer(box, words);
    pressInComposer(box, "Enter");
    await settle();
  };
  repository = null;
  await post("dropping the repository");
  repository = INVITES_TASK.repository;
  await post("and choosing it again");
  // One read for the repository, one for the installed skills while it has none, and one once it is chosen again.
  assert.equal(reads, 3);
});

/** Where an agent's face in the channel shown stands, by the name its first message is bylined with: working, failed, or at rest. */
function faceState(page: HTMLElement, name: string): string | null | undefined {
  const message = [...page.querySelectorAll(".chat-message")].find(
    (each) => each.querySelector(".luke-comment-name")?.textContent === name,
  );
  return message?.querySelector(".luke-comment-face .state-glyph")?.getAttribute("data-state");
}

test("an agent wears where it stands, as its tile does everywhere else: its face working or failed, and a failed one's row the failed mark at its end", () => {
  const page = mount((chat) => ({
    ...chat,
    agents: chat.agents.map((line) =>
      line.title === "Invite emails" ? { ...line, status: CODING_AGENT_STATUS.FAILED } : line,
    ),
  }));
  const failed = railRow(page, "Invite emails").closest("li")?.querySelector(".failed-mark");
  assert.equal(failed?.getAttribute("aria-label"), "Failed");
  assert.equal(
    railRow(page, "Add teammate invitations").closest("li")?.querySelector(".failed-mark"),
    null,
    "a working agent's row wears none",
  );
  act(() => railRow(page, "teammate-invitations").click());
  assert.equal(faceState(page, "Invite emails"), "failed");
  assert.equal(faceState(page, "Add teammate invitations"), "working");
});

test("an agent with no name or title is named by its model, as its tab is, never by the model's bare id", () => {
  const page = mount((chat) => ({
    answer: {
      ...chat.answer,
      members: chat.answer.members.map((member) =>
        member.name === "Add teammate invitations"
          ? { ...member, name: "anthropic/claude-opus-5.5" }
          : member,
      ),
    },
    agents: chat.agents.map((line) =>
      line.title === "Add teammate invitations" ? { ...line, title: null } : line,
    ),
  }));
  assert.ok(railRow(page, "Opus 5.5"), "its direct message is named by its model");
  assert.ok(!rail(page).includes("anthropic/claude-opus-5.5"));
});

test("an agent the plans' summaries do not name is read as its chip's mark reads it, and drawn by its name, its harness, and where it stands", async () => {
  const lines: readonly TaskAgentLine[] = fixtureChat({ fixtureMode: true }, AT)?.agents ?? [];
  const invites = lines.find((line) => line.title === "Invite emails");
  assert.ok(invites);
  // Its task's agents, archived ones among them, answer the line the summaries leave out.
  fakeActPort({
    [ACT_KIND.CODING_AGENTS_LIST]: (request) =>
      Promise.resolve({
        agents: lines.map((line) =>
          line.id === invites.id
            ? {
                id: line.id,
                planId: request.taskId,
                model: line.model,
                effort: line.effort,
                title: "Nova",
                createdAt: AT,
                status: CODING_AGENT_STATUS.FAILED,
                turnId: null,
              }
            : {
                id: line.id,
                planId: request.taskId,
                model: line.model,
                effort: line.effort,
                title: null,
                automationName: "Nightly audit",
                createdAt: AT,
                status: CODING_AGENT_STATUS.RUNNING,
                turnId: null,
              },
        ),
      }),
  });
  const page = mount((chat) => ({ ...chat, agents: [] }));
  // Until its task's agents are read it stands by the name the chat read carries, on the mark of no known harness.
  const before = railRow(page, "Invite emails").closest("li");
  assert.equal(
    before?.querySelector(".actor-mark .luke-harness-mark[data-provider='openai']"),
    null,
  );
  await settle();
  const after = railRow(page, "Nova").closest("li");
  assert.ok(
    after?.querySelector(".actor-mark .luke-harness-mark[data-provider='openai']"),
    "its row wears Codex's mark",
  );
  assert.equal(after?.querySelector(".failed-mark")?.getAttribute("aria-label"), "Failed");
  // One with no title is named by the automation that started it, as its tab is, and drawn at
  // rest, since a read is not followed and a face never stays working after its agent stopped.
  const nightly = railRow(page, "Nightly audit").closest("li");
  assert.equal(nightly?.querySelector(".state-glyph")?.getAttribute("data-state"), "rest");
});

test("a member whose account is gone is named and drawn as one former member, in the rail and in the channel alike", () => {
  const page = mount((chat) => ({
    ...chat,
    answer: {
      ...chat.answer,
      members: chat.answer.members.map((member) =>
        member.name === "Maria Chen"
          ? { id: member.id, kind: MEMBER_KIND.HUMAN, left: true }
          : member,
      ),
    },
  }));
  const row = railRow(page, "Former member").closest("li");
  assert.equal(
    row?.querySelector(".inbox-row-mark .actor-mark")?.getAttribute("data-kind"),
    "someone",
  );
  act(() => railRow(page, "general").click());
  const gone = [...page.querySelectorAll(".chat-message")].find(
    (each) => each.querySelector(".luke-comment-name")?.textContent === "Former member",
  );
  assert.ok(
    gone?.querySelector(".luke-comment-face .luke-avatar[data-glyph]"),
    "on the glyph for someone",
  );
});

/** Chat over the fixture's chat on its plan's channel, each post held until the test lands it or refuses it, in the order posted. */
function heldPosts() {
  const held: {
    readonly post: ChatPost;
    readonly clientKey: string;
    readonly reader: string | undefined;
    readonly land: () => Promise<string | undefined>;
    readonly answer: (refused: string | undefined) => void;
  }[] = [];
  const page = mount(
    (chat) => chat,
    ACME,
    undefined,
    undefined,
    { tasks: [INVITATIONS] },
    (land, post, clientKey, reader) =>
      new Promise((answer) => {
        held.push({ post, clientKey, reader, land, answer });
      }),
  );
  act(() => railRow(page, "teammate-invitations").click());
  const box = boxNamed(page, "Message #teammate-invitations");
  return {
    page,
    box,
    /** Chat closed and opened again on the channel, the box drawn anew. */
    reopen: (as?: string) => {
      readingAs = as;
      reopen();
      act(() => railRow(page, "teammate-invitations").click());
      return boxNamed(page, "Message #teammate-invitations");
    },
    /** The words of each post handed to the service, in the order handed. */
    posted: () => held.map((each) => each.post.text),
    /** The key each post handed to the service went under, in the order handed. */
    keys: () => held.map((each) => each.clientKey),
    /** The reader each post handed to the service went as, in the order handed. */
    readers: () => held.map((each) => each.reader),
    /** The chat holds post `index`, as a push brings it, before its answer lands. */
    push: async (index: number) => {
      const each = held[index] ?? assert.fail(`no post ${index}`);
      await act(async () => {
        await each.land();
      });
      await settle();
    },
    answer: async (index: number) => {
      act(() => held[index]?.answer(undefined));
      await settle();
    },
    /** The service takes the post `index`: the chat holds it as the answer lands, in the same draw. */
    land: async (index: number) => {
      const each = held[index] ?? assert.fail(`no post ${index}`);
      await act(async () => each.answer(await each.land()));
      await settle();
    },
    refuse: async (index: number, why: string) => {
      act(() => held[index]?.answer(why));
      await settle();
    },
    send: async (text: string) => {
      typeInComposer(box, text);
      pressInComposer(box, "Enter");
      await settle();
    },
    pending: () => [...page.querySelectorAll(".chat-message[data-pending]")],
  };
}

test("a post stands in the channel at once as the developer's, the box empty and keeping the caret, and the posted message takes its place, drawn once", async () => {
  const chat = heldPosts();
  const before = words(chat.page).length;
  await chat.send("Shipping the invite emails today.");

  assert.equal(boxWords(chat.box), "");
  assert.equal(composerEditor(chat.box).getAttribute("aria-disabled"), null);
  assert.equal(document.activeElement, composerEditor(chat.box));
  assert.equal(chat.pending().length, 1, "drawn as on its way");
  assert.equal(words(chat.page).at(-1), "Shipping the invite emails today.");

  await chat.land(0);
  assert.equal(chat.pending().length, 0);
  assert.equal(
    words(chat.page).length,
    before + 1,
    "the message stands in its place, never beside it",
  );
  assert.equal(words(chat.page).at(-1), "Shipping the invite emails today.");
});

test("two posts sent at once reach the service one at a time, in the order sent", async () => {
  const chat = heldPosts();
  await chat.send("First.");
  await chat.send("Second.");
  assert.deepEqual(chat.posted(), ["First."], "the second waits for the first's answer");
  assert.deepEqual(words(chat.page).slice(-2), ["First.", "Second."]);

  await chat.land(0);
  assert.deepEqual(chat.posted(), ["First.", "Second."]);
  await chat.land(1);
  assert.deepEqual(words(chat.page).slice(-2), ["First.", "Second."]);
  assert.equal(chat.pending().length, 0);
});

test("a post refused while the box holds nothing newer comes back into it with why; one refused after the developer wrote on stays where it went with Retry", async () => {
  const chat = heldPosts();
  await chat.send("Back to the box.");
  await chat.refuse(0, "Chat could not be reached.");
  assert.equal(boxWords(chat.box), "Back to the box.");
  assert.match(
    chat.box.querySelector('[role="alert"]')?.textContent ?? "",
    /could not be reached/u,
  );
  assert.equal(chat.pending().length, 0, "the post leaves the stream");

  typeInComposer(chat.box, " Again.");
  pressInComposer(chat.box, "Enter");
  await settle();
  typeInComposer(chat.box, "Still writing");
  await chat.refuse(1, "Chat could not be reached.");
  assert.equal(boxWords(chat.box), "Still writing", "the newer words stay");
  const unsent =
    chat.page.querySelector<HTMLElement>(".chat-message[data-unsent]") ??
    assert.fail("the refused post stays where it went");
  assert.match(unsent.textContent ?? "", /Back to the box\. Again\./u);
  assert.match(
    unsent.querySelector('[role="alert"]')?.textContent ?? "",
    /^Chat could not be reached\.RetryDiscard$/u,
    "the refusal is an alert with Retry and Discard",
  );
  const retry =
    [...unsent.querySelectorAll("button")].find((each) => each.textContent === "Retry") ??
    assert.fail("with Retry");
  act(() => retry.click());
  await settle();
  assert.deepEqual(chat.posted(), [
    "Back to the box.",
    "Back to the box. Again.",
    "Back to the box. Again.",
  ]);
  await chat.land(2);
  assert.equal(chat.page.querySelector(".chat-message[data-unsent]"), null);
  assert.equal(words(chat.page).at(-1), "Back to the box. Again.");
});

test("a post the chat holds before its answer lands is drawn once, as the chat's message, and the answer draws nothing more", async () => {
  const chat = heldPosts();
  const before = words(chat.page).length;
  await chat.send("Pushed before the answer.");
  assert.equal(chat.pending().length, 1);

  await chat.push(0);
  assert.equal(chat.pending().length, 0, "the post gives way to the message under its key");
  assert.equal(words(chat.page).length, before + 1, "exactly one row");
  assert.equal(words(chat.page).at(-1), "Pushed before the answer.");

  await chat.answer(0);
  assert.equal(words(chat.page).length, before + 1);
});

test("two posts of the same words go under keys of their own, and one taken back into the box goes again under its key", async () => {
  const chat = heldPosts();
  await chat.send("ok");
  await chat.send("ok");
  await chat.land(0);
  await chat.land(1);
  const [first, second] = chat.keys();
  assert.notEqual(first, second);

  await chat.send("Lost answer.");
  await chat.refuse(2, "Chat could not be reached.");
  assert.equal(boxWords(chat.box), "Lost answer.");
  pressInComposer(chat.box, "Enter");
  await settle();
  assert.equal(chat.keys()[3], chat.keys()[2]);
});

test("a refused post left in the stream waits there while Chat is closed and opened again, and Discard asks before it lets it go", async () => {
  const chat = heldPosts();
  await chat.send("Keep me.");
  typeInComposer(chat.box, "Newer");
  await chat.refuse(0, "Chat could not be reached.");
  assert.ok(chat.page.querySelector(".chat-message[data-unsent]"));

  const box = chat.reopen();
  assert.equal(boxWords(box), "Newer");
  const unsent =
    chat.page.querySelector<HTMLElement>(".chat-message[data-unsent]") ??
    assert.fail("the refused post still stands");
  assert.match(unsent.textContent ?? "", /Keep me\./u);

  const discard =
    [...unsent.querySelectorAll("button")].find((each) => each.textContent === "Discard") ??
    assert.fail("with Discard");
  act(() => discard.click());
  assert.ok(
    chat.page.querySelector(".chat-message[data-unsent]"),
    "nothing goes before the answer",
  );
  const confirm =
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button, [role="dialog"] button',
      ),
    ].find((each) => each.textContent === "Discard") ?? assert.fail("Discard asks first");
  await act(async () => confirm.click());
  await settle();
  assert.equal(chat.page.querySelector(".chat-message[data-unsent]"), null);
});

test("a reader signed in to the window after another reads none of their posts, and a post queued before the switch goes as the reader who wrote it", async () => {
  const chat = heldPosts();
  await chat.send("Written by the first reader.");
  await chat.send("Queued behind it.");
  typeInComposer(chat.box, "Newer");
  // Another account's member, signed in to the same window.
  const other = "0f1e2d3c-4b5a-4697-8877-665544332211";

  chat.reopen(other);
  assert.equal(chat.pending().length, 0, "the new reader draws none of the first's posts");
  assert.equal(chat.page.querySelector(".chat-message[data-unsent]"), null);

  await chat.refuse(0, "Chat could not be reached.");
  assert.deepEqual(
    chat.readers(),
    [undefined, undefined],
    "both went as the reader who wrote them",
  );
  assert.equal(chat.page.querySelector(".chat-message[data-unsent]"), null);
});

test("hovering a task's channel in the rail hangs its task's card beside it, and a topic's row hangs none", () => {
  const page = mount((chat) => chat, undefined, undefined, undefined, { tasks: [INVITATIONS] });

  restOn(railRow(page, "teammate-invitations"));

  const card = document.querySelector('[role="tooltip"]');
  assert.match(card?.textContent ?? "", /Teammate invitations/u);
  assert.match(card?.textContent ?? "", /ada\/relay/u);

  restOn(railRow(page, "general"));

  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, "general");
});

test("the rail's places stand in named lists, For you alone in its own and every group's places in its own", () => {
  const page = mount();
  const lists = [...page.querySelectorAll<HTMLElement>(".chat-rail ul[aria-label]")].map((list) => [
    list.getAttribute("aria-label"),
    [...list.querySelectorAll(".luke-list-row-main")].map(railName),
  ]);

  assert.deepEqual(lists[0], ["For you", ["For you"]]);
  assert.ok(
    lists.some(([name, places]) => name === "Channels" && (places as string[]).includes("general")),
    "the channels stand in a list of their own",
  );
});
