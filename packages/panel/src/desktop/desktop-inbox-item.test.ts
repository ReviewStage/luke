// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnswerParams,
  type CodingAgentInboxMessagedView,
  type CodingAgentInboxMessageParams,
  INBOX_SCOPE_KIND,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { inboxAttachmentAddress } from "@luke/features/inbox-attachment-link";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_FILE_TYPE,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
} from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { formatCount } from "@luke/features/number-format";
import { TASK_STATUS } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { pasteCutWords } from "@luke/features/words";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { MICROPHONE_STATUS } from "@luke/settings/microphone";
import { DocumentIcon } from "@luke/ui";
import { Effect } from "effect";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, onTestFinished, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import type { SidePanelControl } from "../tasks/use-side-panel.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeActsAnswer,
} from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import {
  composerEditor,
  editorBundleLanded,
  pasteInComposer,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import {
  AGENT,
  ASKING_ID,
  answeredBy,
  answerSend,
  askBoxes,
  asking,
  askingMessage,
  askMarker,
  attachedNames,
  BILLING,
  BUMP,
  backToList,
  boxParts,
  checkedOptions,
  columnsShown,
  draftReply,
  EXPIRY,
  EXPIRY_ASK,
  faceKind,
  footWords,
  handFiles,
  headerNamed,
  heldMessages,
  hoveredCard,
  INVITES,
  inOrder,
  item,
  itemPane,
  layOut,
  listed,
  mount,
  mountThread,
  noticeOf,
  openings,
  openOptions,
  pagerOf,
  pressKey,
  pushedOf,
  READER,
  RETRY,
  type ReadOutcome,
  ROW_TITLE,
  readTitle,
  repliedOn,
  rowDrafted,
  rowNamed,
  STRAY_AGENT,
  saying,
  sendHeld,
  sendWords,
  settle,
  skillReads,
  standKeymap,
  subjectOf,
  subjectParts,
  TEAMMATE,
  THRESHOLD,
  threadItem,
  threadMessage,
  wearsAgentTile,
  wordsOf,
  world,
  writtenOn,
} from "../testing/desktop-inbox.js";
import { focusRestOn, restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { relayout } from "../testing/resize-observer.js";
import { tasksControl } from "../testing/tasks-control.js";
import { viewerPlace } from "../testing/viewer-place.js";

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

// The parser an answer's note is drawn through, landed as the panel lands it.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

test("a thread leads with its item's title alone as its subject, whether the item waits, is answered, or was taken back by its agent", async () => {
  const [asking] = EXPIRY.thread ?? [];
  assert.ok(asking?.ask !== undefined, "the item opens with its ask");
  const WITHDRAWN: InboxItem = {
    ...EXPIRY,
    status: INBOX_STATUS.CLOSED,
    closedReason: "The plan now says 7 days.",
    thread: [
      {
        ...asking,
        ask: {
          ...asking.ask,
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: "The plan now says 7 days.",
        },
      },
    ],
  };
  world.inboxes.set(INVITES.id, [WITHDRAWN]);
  const { page } = mount();
  await settle();
  assert.deepEqual(subjectOf(page), ["Alert at 80%?"]);
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?"]);
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["Expire after 7 days?"]);
});

test("a paste past an item's reply cap is cut to the room left and its note line says so, until the words change, with the counter standing from four fifths of the cap", async () => {
  const { page } = mount();
  await settle();
  const pane = itemPane(page);
  const cap = INBOX_BOUNDS.MAX_MESSAGE_CHARS;
  const note = () => pane.querySelector(".luke-composer-foot-note")?.textContent;
  assert.equal(pane.querySelector(".luke-length-counter"), null);

  pasteInComposer(pane, "x".repeat(cap + 100));
  await settle();
  assert.equal(composerEditor(pane).textContent?.length, cap);
  assert.equal(note(), pasteCutWords(cap));
  assert.equal(
    pane.querySelector(".luke-length-counter")?.textContent,
    `${formatCount(cap)}/${formatCount(cap)}`,
  );

  const editor = composerEditor(pane).editor ?? assert.fail("the editor is running");
  act(() => {
    editor.view.dispatch(editor.state.tr.delete(1, 2));
  });
  await settle();
  assert.equal(note(), undefined, "the note goes once the words change again");
});

test("a teammate's open item leads with its title alone, and its box still takes your answer", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  world.inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: CHARLES }, RETRY]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.deepEqual(subjectOf(page), ["Alert at 80%?"]);
  assert.ok(
    page.querySelector(".inbox-view-items:not([hidden]) .composer-editor"),
    "any member may answer",
  );
});

test("the pane's crumbs lead with their tabs' glyphs, the plan's document and the agent's mark, and open the item's plan, leaving the Inbox, and its agent's transcript beside the item, with no other way out in its bar", async () => {
  const { page, asked } = mount();
  await settle();
  const crumbs = [
    ...page.querySelectorAll<HTMLButtonElement>('.inbox-view-items nav[aria-label="Path"] button'),
  ];
  assert.deepEqual(
    crumbs.map((crumb) => crumb.textContent),
    ["Billing usage alerts", "Alerts"],
  );
  const [task, agent] = crumbs;
  assert.equal(
    task?.querySelector('[aria-hidden="true"]')?.innerHTML,
    renderToStaticMarkup(createElement(DocumentIcon)),
    "the plan's crumb wears its tab's document glyph",
  );
  assert.ok(
    agent?.querySelector('[aria-hidden="true"] .state-glyph'),
    "the agent's crumb wears its mark",
  );
  assert.deepEqual(
    [...page.querySelectorAll(".inbox-view-items .luke-toolbar button")]
      .map((button) => button.getAttribute("aria-label") ?? button.textContent)
      .slice(2),
    ["Inbox item actions"],
    "beside the crumbs the bar holds the item's ⋯ menu alone",
  );
  act(() => crumbs[0]?.click());
  act(() => crumbs[1]?.click());
  assert.deepEqual(asked.shownTasks, [BILLING.id]);
  assert.deepEqual(asked.previewedAgents, [AGENT.id], "the agent reads beside the item");
  assert.deepEqual(asked.shownAgents, []);
});

/** What an intersection observer reports of the heading it watches: in the thread's view, or scrolled up past its top. */
type HeadingSeen = (entries: readonly Partial<IntersectionObserverEntry>[]) => void;

/** The headings the pane's intersection observers watch, each with its observer's callback. */
const headingsWatched = new Map<Element, HeadingSeen>();

/** An intersection observer that reports nothing until a test scrolls the heading it watches. */
class HeadingObserver {
  readonly #callback: HeadingSeen;
  constructor(callback: HeadingSeen) {
    this.#callback = callback;
  }
  observe(target: Element): void {
    headingsWatched.set(target, this.#callback);
  }
  disconnect(): void {
    for (const [target, callback] of headingsWatched)
      if (callback === this.#callback) headingsWatched.delete(target);
  }
}

/** Scrolls the shown item's heading up out of the thread's view, or back into it, as its scroller would report it. */
function scrollHeading(page: HTMLElement, away: boolean): void {
  const heading =
    page.querySelector(".inbox-view-items:not([hidden]) [data-inbox-title]") ??
    assert.fail("the item's heading is drawn");
  const seen = headingsWatched.get(heading) ?? assert.fail("the heading is watched");
  const rootBounds = DOMRect.fromRect({ y: 100, width: 600, height: 500 });
  const boundingClientRect = DOMRect.fromRect({ y: away ? 40 : 120, width: 600, height: 30 });
  act(() => seen([{ isIntersecting: !away, rootBounds, boundingClientRect }]));
}

/** The words of the item's bar's path, crumb by crumb, as a reader meets them. */
function pathWords(page: HTMLElement): (string | null)[] {
  return [
    ...page.querySelectorAll('.inbox-view-items:not([hidden]) nav[aria-label="Path"] li'),
  ].map((crumb) => crumb.textContent);
}

test("once the item's heading scrolls out of the thread's view, its title joins the bar's path as its last words, the page the reader stands on, and leaves it again once the heading is back, so it never stands twice", async () => {
  vi.stubGlobal("IntersectionObserver", HeadingObserver);
  const { page } = mount();
  await settle();
  assert.deepEqual(pathWords(page), ["Billing usage alerts", "Alerts"], "the heading names it");

  scrollHeading(page, true);
  assert.deepEqual(pathWords(page), ["Billing usage alerts", "Alerts", "Alert at 80%?"]);
  const title = page.querySelector(
    '.inbox-view-items nav[aria-label="Path"] [aria-current="page"]',
  );
  assert.equal(title?.textContent, "Alert at 80%?", "the title is where the reader stands");
  assert.equal(title?.closest("button"), null, "the title is words, not a press");

  scrollHeading(page, false);
  assert.deepEqual(pathWords(page), ["Billing usage alerts", "Alerts"]);

  scrollHeading(page, true);
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  assert.deepEqual(
    pathWords(page),
    ["Billing usage alerts", "Alerts"],
    "another item opens with its own heading in view",
  );
});

test("an image that lands before its item's own read does is drawn all the same", async () => {
  const shot = inboxAttachmentAddress(
    { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c71",
    "acme",
  );
  world.inboxes.set(BILLING.id, [saying(THRESHOLD, `![The sandbox's window](${shot})`), RETRY]);
  // The list's read of the plan answers, while the pane's own read of it is held.
  let billingReads = 0;
  world.startRead = (taskId) =>
    taskId === BILLING.id && billingReads++ > 0 ? new Promise(() => undefined) : undefined;
  const { page } = mount();
  await settle();
  assert.ok(
    page.querySelector("[data-inbox-message-text]"),
    "the item is drawn from the list's read",
  );
  for (const land of world.imageReads.splice(0)) land();
  await settle();
  assert.equal(
    page.querySelector<HTMLImageElement>("[data-inbox-message-text] img")?.alt,
    "The sandbox's window",
  );
});

test("an item's Markdown draws its own pictures, read once its item's own read lands, a pair side by side, and a pull request's link alone on its line as its card", async () => {
  const before = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c72";
  const after = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c73";
  const picture = (attachmentId: string) =>
    inboxAttachmentAddress(
      { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
      attachmentId,
      "acme",
    );
  const words = [
    `![The form before](${picture(before)} "Before") ![The form after](${picture(after)} "After")`,
    "https://github.com/acme/relay/pull/42",
  ].join("\n\n");
  world.inboxes.set(BILLING.id, [saying(THRESHOLD, words), RETRY]);
  const { page } = mount();
  await settle();
  // The pictures land once their item's own read does, which keeps them as the item's.
  for (const land of world.imageReads.splice(0)) land();
  await settle();
  const pair = page.querySelectorAll("[data-inbox-message-text] .transcript-pictures");
  assert.equal(pair.length, 1, "the two pictures stand side by side in one row");
  assert.deepEqual(
    [...(pair[0]?.querySelectorAll("img") ?? [])].map((image) => image.alt),
    ["The form before", "The form after"],
  );
  assert.equal(
    page.querySelector(
      '[data-inbox-message-text] [data-lone-link="pull-request"] .luke-list-row-title',
    )?.textContent,
    "#42",
  );
  // What the item's words draw stands inside the pane's masked region.
  assert.ok(page.querySelector(".ph-no-capture [data-lone-link]"));
});

test("a picture of an item opens a viewer the arrow keys walk across every picture of the item, its Markdown's pair and a picture it carried alike, in the order they are drawn", async () => {
  const before = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c74";
  const after = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c75";
  const picture = (attachmentId: string) =>
    inboxAttachmentAddress(
      { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
      attachmentId,
      "acme",
    );
  const words = `![The form before](${picture(before)} "Before") ![The form after](${picture(after)} "After")`;
  const shot = {
    attachmentId: "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c76",
    name: "The pull request tab.png",
    mediaType: INBOX_IMAGE_TYPE.PNG,
  };
  world.inboxes.set(BILLING.id, [saying(THRESHOLD, words, [shot]), RETRY]);
  const { page } = mount();
  await settle();
  for (const land of world.imageReads.splice(0)) land();
  await settle();
  const press = page.querySelector<HTMLButtonElement>(
    'button[aria-label="Enlarge The form after"]',
  );
  assert.ok(press, "the picture is pressed to enlarge it");
  act(() => press.click());
  const viewer = () => {
    const card = document.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(card, "the viewer is open");
    return [card.querySelector<HTMLImageElement>(".luke-zoom-image")?.alt, viewerPlace(card)];
  };
  const key = (name: string) =>
    act(() =>
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
        ),
    );
  // The picture the message carried is drawn over its words, so the viewer walks it first.
  assert.deepEqual(viewer(), ["The form after.png", "3 of 3"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["The pull request tab.png", "1 of 3"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["The form before.png", "2 of 3"]);
  key("ArrowLeft");
  assert.deepEqual(viewer(), ["The pull request tab.png", "1 of 3"]);
});

test("a recording an agent's words draw plays where it stands, left out of the replay, and its Expand opens the viewer a picture does, which plays it and walks on to the picture drawn with it", async () => {
  const [still, video] = [
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c90",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c91",
  ];
  const address = (attachmentId: string) =>
    inboxAttachmentAddress(
      { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
      attachmentId,
      "acme",
    );
  const created: string[] = [];
  const own = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  // Note that jsdom makes no object URLs, so the window's own are stood in for, and put back after.
  URL.createObjectURL = (blob: Blob) => {
    created.push(blob.type);
    return `blob:video-${String(created.length)}`;
  };
  URL.revokeObjectURL = () => undefined;
  const previous = fakeActsAnswer();
  fakeActs({
    ...appBridge(),
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT) return previous(request);
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value:
          request.payload.attachmentId === video
            ? { contentType: INBOX_FILE_TYPE.WEBM, base64: "GkXfow==" }
            : { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
      });
    },
  });
  try {
    const message: InboxMessage = {
      ...threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000060",
        "agent",
        `The invite, and how it is sent.\n\n![The email](${address(still)}) ![Inviting a member](${address(video)} "The invite flow")`,
        1_000,
      ),
      files: [
        { attachmentId: still, name: "email.png", mediaType: INBOX_IMAGE_TYPE.PNG },
        { attachmentId: video, name: "flow.webm", mediaType: INBOX_FILE_TYPE.WEBM },
      ],
    };
    const pane = await mountThread(threadItem([message]));
    await settle();

    const inline = pane.querySelector("video");
    assert.ok(inline, "the recording plays where its words draw it");
    assert.equal(inline.getAttribute("src"), "blob:video-1");
    assert.deepEqual(
      [...(inline.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Expand", "Full screen"],
      "under Luke's own bar, with an Expand into the viewer",
    );
    assert.equal(inline.hasAttribute("controls"), false, "and not the browser's");
    assert.equal(inline.getAttribute("aria-label"), "Video: Inviting a member");
    assert.ok(inline.closest(".ph-no-capture"), "the player is left out of the replay");
    assert.equal(pane.querySelectorAll("video").length, 1, "the recording stands once");
    assert.deepEqual(
      [...pane.querySelectorAll('[aria-label="Attached files"] > *')].map(
        (each) => each.textContent,
      ),
      [],
      "the recording the words draw is not named again as a file over them",
    );
    assert.equal(
      pane.querySelector('button[aria-label="Enlarge Inviting a member"]'),
      null,
      "a press on the recording plays it rather than enlarging it",
    );
    const expand = inline
      .closest(".picture-block")
      ?.querySelector<HTMLButtonElement>('button[aria-label="Expand"]');
    assert.ok(expand, "the recording's Expand opens the viewer");
    act(() => expand.click());
    await settle();

    const card = document.querySelector('[role="dialog"]');
    const player = card?.querySelector("video");
    assert.ok(player, "the viewer plays the recording");
    assert.deepEqual(
      [...(player.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Full screen"],
      "under Luke's own bar",
    );
    assert.equal(player.hasAttribute("controls"), false, "and not the browser's");
    assert.equal(player.getAttribute("aria-label"), "Video: Inviting a member.webm");
    assert.equal(player.getAttribute("src"), "blob:video-2");
    assert.ok(player.closest(".ph-no-capture"), "the player is left out of the replay");
    assert.deepEqual(created, [INBOX_FILE_TYPE.WEBM, INBOX_FILE_TYPE.WEBM]);
    assert.equal(viewerPlace(card ?? document), "2 of 2");
    act(() =>
      card?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(
      document.querySelector('[role="dialog"] .luke-zoom-image')?.getAttribute("alt"),
      "The email.png",
      "the walk goes on to the picture drawn with it",
    );
  } finally {
    URL.createObjectURL = own.create;
    URL.revokeObjectURL = own.revoke;
  }
});

test("a thread draws a comment's files over its words: an agent's pictures stand once, where its words draw them, one they do not draw over them, and a member's picture and file over their words, the viewer walking each picture once", async () => {
  const [before, after, unnamed, mine, spec] = [
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c80",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c81",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c82",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c83",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c84",
  ];
  const picture = (attachmentId: string) =>
    inboxAttachmentAddress(
      { kind: LINK_PLACE.INBOX_ITEM, planId: BILLING.id, itemId: THRESHOLD.id },
      attachmentId,
      "acme",
    );
  const png = (attachmentId: string, name: string) => ({
    attachmentId,
    name,
    mediaType: INBOX_IMAGE_TYPE.PNG,
  });
  const agents: InboxMessage = {
    ...threadMessage(
      "c1b2c3d4-0000-4000-8000-000000000050",
      "agent",
      `The form, before and after.\n\n![Before](${picture(before)} "Before") ![After](${picture(after)} "After")`,
      1_000,
    ),
    // The service keeps each picture the words draw as a file of the message; an older one may keep one they do not draw.
    files: [png(before, "before.png"), png(after, "after.png"), png(unnamed, "older.png")],
  };
  const members: InboxMessage = {
    ...threadMessage(
      "c1b2c3d4-0000-4000-8000-000000000051",
      { member: TEAMMATE },
      "Here is mine.",
      2_000,
    ),
    files: [
      png(mine, "mine.png"),
      { attachmentId: spec, name: "spec.pdf", mediaType: "application/pdf" },
    ],
  };
  const pane = await mountThread(threadItem([agents, members]));
  for (const land of world.imageReads.splice(0)) land();
  await settle();

  const [agent, member] = [...pane.querySelectorAll('[data-inbox-comment="message"]')];
  assert.ok(agent && member, "both messages are drawn");
  assert.equal(
    pane.querySelectorAll('[aria-label="Attached files"] img').length,
    0,
    "no thumbnails",
  );
  const alts = (within: Element) =>
    [...within.querySelectorAll<HTMLImageElement>(".picture-block img")].map((image) => image.alt);
  assert.deepEqual(alts(agent), ["older.png", "Before", "After"], "each picture stands once");
  assert.deepEqual(alts(member), ["mine.png"]);
  assert.deepEqual(attachedNames(agent), []);
  assert.deepEqual(attachedNames(member), ["spec.pdf"]);
  // What the message carried stands over its words, as every message's files do.
  for (const [comment, carried] of [
    [agent, agent.querySelector("[data-inbox-file-pictures]")],
    [member, member.querySelector("[data-inbox-file-pictures]")],
    [member, member.querySelector('[aria-label="Attached files"]')],
  ] as const) {
    const words = comment.querySelector("[data-inbox-message-text]");
    assert.ok(words && carried, "the words and the files are drawn");
    assert.ok(words.compareDocumentPosition(carried) & Node.DOCUMENT_POSITION_PRECEDING);
  }

  const press = pane.querySelector<HTMLButtonElement>('button[aria-label="Enlarge After"]');
  assert.ok(press, "the picture is pressed to enlarge it");
  act(() => press.click());
  const viewer = () => {
    const card = document.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(card, "the viewer is open");
    return [card.querySelector<HTMLImageElement>(".luke-zoom-image")?.alt, viewerPlace(card)];
  };
  const key = (name: string) =>
    act(() =>
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
        ),
    );
  assert.deepEqual(viewer(), ["After.png", "3 of 4"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["mine.png", "4 of 4"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["older.png", "1 of 4"]);
  key("ArrowRight");
  assert.deepEqual(viewer(), ["Before.png", "2 of 4"]);
});

function standingCard(): readonly [string | null | undefined, string | null | undefined] {
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.ok(card, "an agent's card is hung");
  return [
    card.querySelector(".luke-hover-card-name")?.textContent,
    card.querySelector(".luke-hover-card-corner")?.textContent,
  ];
}

/** Rests on a control as the keyboard reaches it, which hangs its card as a resting pointer does. */
function reach(control: HTMLElement): void {
  document.documentElement.dataset.keyboard = "true";
  focusRestOn(control);
}

/** The agent's references in the pane's thread, each its tile and its name as one button. */
function threadRefs(page: HTMLElement): HTMLButtonElement[] {
  return [
    ...page.querySelectorAll<HTMLButtonElement>(
      '.inbox-board button[data-actor-ref][data-kind="agent"]',
    ),
  ];
}

test("the thread names its agent as one button wherever it does, its message's comment: it hangs the agent's tab's card, which offers no Open agent, and opens its transcript beside the item", async () => {
  const { page, asked } = mount();
  await settle();
  const [comment, ...more] = threadRefs(page);
  assert.ok(comment, "the agent's comment names the agent");
  assert.equal(comment.textContent, "Alerts");
  assert.deepEqual(more, [], "nothing over the thread names the agent again");
  const asking =
    page.querySelector('[data-inbox-comment="message"]') ??
    assert.fail("the agent's message is a comment");
  assert.equal(
    faceKind(asking.querySelector(".luke-comment-face")),
    "agent",
    "the agent's tile leads its comment",
  );
  reach(comment);
  assert.deepEqual(standingCard(), ["Alerts", undefined]);
  assert.deepEqual(openings("[data-tab-card]"), [], "the name is the way to the tab");
  act(() => comment.click());
  assert.deepEqual(asked.previewedAgents, [AGENT.id], "the agent reads beside the item");
  assert.deepEqual(asked.shownAgents, []);
});

test("an archived agent is still named by its name, its card saying it was archived, and an agent the plan does not list goes by Coding agent, its card saying it is not found; each opens its tab on its task, which shows the plan where its tab is gone, an agent the task does not list being drawn there alone", async () => {
  world.listedAgents = [{ ...AGENT, status: CODING_AGENT_STATUS.CANCELLED, archivedAt: 4_000 }];
  let { page, asked } = mount();
  await settle();
  let [named] = threadRefs(page);
  assert.ok(named, "the thread names the archived agent");
  assert.equal(named.textContent, "Alerts");
  reach(named);
  const [name, corner] = standingCard();
  assert.equal(name, "Alerts");
  assert.match(corner ?? "", /^Archived · /u);
  const crumb = page.querySelectorAll<HTMLButtonElement>('nav[aria-label="Path"] button')[1];
  assert.ok(crumb, "the agent's crumb is drawn");
  reach(crumb);
  assert.equal(standingCard()[0], "Alerts", "the crumb hangs the archived agent's card too");

  act(() => world.root?.unmount());
  world.listedAgents = [];
  ({ page, asked } = mount());
  await settle();
  [named] = threadRefs(page);
  assert.ok(named, "the thread names an agent the plan does not list");
  assert.equal(named.textContent, "Coding agent");
  reach(named);
  assert.deepEqual(standingCard(), ["Coding agent", "Not found"]);
  act(() => named.click());
  // An agent the task does not list, as an archived one, is drawn on its task alone, so its name goes there.
  assert.deepEqual(asked.shownAgents, [[BILLING.id, AGENT.id]]);
  assert.deepEqual(asked.previewedAgents, []);
});

test("an item's row hangs the thread's card beside it, as a sidebar task's row hangs its task's, the row wearing no tile of the agent's: its task, its title, where it stands, how it ended, and the agent that asked at its foot with the spinner while it works; a press on the card chooses nothing, and a press on the row chooses the item", async () => {
  const { page, asked } = mount();
  await settle();
  const row = rowNamed(page, "How is a failed email retried?");
  assert.equal(row.querySelector("[data-agent-ref]"), null, "the tile hangs no card of its own");
  assert.equal(
    wearsAgentTile(row),
    false,
    "the row wears no agent's tile, its card naming the agent",
  );
  const words = hoveredCard(row, "[data-inbox-row-card]") ?? "";
  assert.match(words, /^Billing usage alerts/u, "the card leads with its task");
  assert.match(words, /How is a failed email retried\?/u);
  assert.match(words, /Answered/u);
  assert.match(words, /Alerts$/u, "the agent that asked stands at its foot");
  const card =
    document.querySelector<HTMLElement>(".luke-tooltip-card [data-inbox-row-card]") ??
    assert.fail("the thread's card is hung");
  assert.ok(
    card.querySelector('.luke-hover-card-row-end .state-glyph[data-state="working"]'),
    "the spinner stands beside the agent at the card's foot, no words",
  );
  // A press on the card, as one selecting its words makes, leaves the row unchosen and the card standing.
  act(() => {
    card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    card.click();
  });
  assert.equal(row.getAttribute("aria-current"), null);
  assert.ok(document.querySelector(".luke-tooltip-card [data-inbox-row-card]"));
  act(() => row.click());
  assert.equal(row.getAttribute("aria-current"), "page");
  assert.deepEqual(asked.shownAgents, [], "the press stays in the Inbox");
});

test("an item's card says whom an open item waits on, the reader as Needs you and a teammate by name", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  world.inboxes.set(INVITES.id, [{ ...EXPIRY, startedBy: CHARLES }]);
  const { page } = mount();
  await settle();
  assert.match(
    hoveredCard(rowNamed(page, "Alert at 80%?"), "[data-inbox-row-card]") ?? "",
    /Needs you/u,
  );
  assert.match(
    hoveredCard(rowNamed(page, "Expire after 7 days?"), "[data-inbox-row-card]") ?? "",
    /Waiting on Charles Pan/u,
  );
});

test("an item's card names its task as the window names a task everywhere: the key as plain words, as every place draws a key, then the task's mention pill wearing its status's mark, its whole name in the task's card it hangs, and no status in words, which the pill's mark already says", async () => {
  const LONG = "Billing usage alerts, with a name long enough to be cut short in the card";
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [
          { id: BILLING.workspaceId, name: "Stage", role: WORKSPACE_ROLE.OWNER, github: null },
        ],
      },
    },
  );
  const { page } = mount([], {
    standing: [{ ...BILLING, name: LONG, number: 182, status: TASK_STATUS.IN_PROGRESS }, INVITES],
  });
  await settle();
  hoveredCard(rowNamed(page, THRESHOLD.title), "[data-inbox-row-card]");
  const card =
    document.querySelector<HTMLElement>(".luke-tooltip-card [data-inbox-row-card]") ??
    assert.fail("the row's card is hung");
  const head = card.querySelector('.task-card-standing[data-line="one"]');
  assert.deepEqual(
    [...(head?.children ?? [])].map((each) => [each.classList[0], each.textContent]),
    [
      ["task-key", "STAG-182"],
      ["luke-inline-ref", LONG],
    ],
    "the key, then the task's chip, on one line, with no status in words",
  );
  assert.ok(head?.querySelector("[data-task-key] .luke-text"), "the key is the shared key's words");
  assert.equal(head?.querySelector(".task-card-chip"), null, "the key is no chip");
  const chip =
    head?.querySelector<HTMLElement>('.luke-inline-ref[data-look="pill"][data-holder-ref]') ??
    assert.fail("the task is named by the mention pill");
  assert.ok(
    chip.querySelector('.luke-inline-ref-glyph .luke-task-status-mark[data-status="in-progress"]'),
    "the pill wears the task's status's mark",
  );
  restOn(chip);
  const cards = [...document.querySelectorAll(".luke-tooltip-card")];
  assert.ok(
    cards.some(
      (each) => each !== card.closest(".luke-tooltip-card") && each.textContent?.includes(LONG),
    ),
    "the pill hangs a card naming the task whole",
  );
});

test("split, K and J move the chosen row and the item beside it, which draws no pager, and a J typed into the item's box is the box's", async () => {
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  assert.equal(pagerOf(page), null, "the list beside the item says where it stands");

  pressKey("j");
  assert.deepEqual(
    listed(page).filter((row) => row.startsWith("▸")),
    ["▸ *Expire after 7 days?"],
  );
  assert.equal(readTitle(page), "Expire after 7 days?");
  pressKey("k");
  assert.equal(readTitle(page), "Alert at 80%?");

  const box = composerEditor(page.querySelector(".inbox-view-items") ?? page);
  // Note that jsdom computes no `isContentEditable`, which a browser answers for the editor.
  Object.defineProperty(box, "isContentEditable", { value: true });
  box.focus();
  pressKey("j", box);
  assert.equal(readTitle(page), "Alert at 80%?", "the letter is the box's");
  act(() => keys.unmount());
});

test("split, K and J hand the keyboard to the row they choose, so the arrows go on from there", async () => {
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  act(() => rowNamed(page, "Alert at 80%?").focus());

  pressKey("j", document.activeElement ?? document.body);
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.equal(
    document.activeElement,
    rowNamed(page, "Expire after 7 days?"),
    "J's row holds the keyboard",
  );
  pressKey("k", document.activeElement ?? document.body);
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.equal(
    document.activeElement,
    rowNamed(page, "Alert at 80%?"),
    "K's row holds the keyboard",
  );
  pressKey("ArrowUp", document.activeElement ?? document.body);
  assert.equal(
    document.activeElement,
    rowNamed(page, "How is a failed email retried?"),
    "↑ goes on from the row K reached",
  );
  act(() => keys.unmount());
});

/** The titles of the list's rows Tab stops on, in the order drawn. */
function rowTabStops(page: HTMLElement): (string | null | undefined)[] {
  return [...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks li button.luke-list-row-main")]
    .filter((row) => row.tabIndex === 0)
    .map((row) => row.querySelector(ROW_TITLE)?.textContent);
}

test("the list's rows are one Tab stop, across its plans, that ↓ walks and End ends, the walk wrapping and the stop following the row last focused", async () => {
  const { page } = mount();
  await settle();
  assert.deepEqual(rowTabStops(page), ["Alert at 80%?"], "Tab lands on the open row, one stop");

  act(() => rowNamed(page, "How is a failed email retried?").focus());
  pressKey("ArrowDown", document.activeElement ?? document.body);
  pressKey("ArrowDown", document.activeElement ?? document.body);
  assert.equal(
    document.activeElement,
    rowNamed(page, "Expire after 7 days?"),
    "↓↓ goes two rows on, into the next plan",
  );
  assert.deepEqual(rowTabStops(page), ["Expire after 7 days?"], "Tab comes back to the row left");
  pressKey("ArrowDown", document.activeElement ?? document.body);
  assert.equal(
    document.activeElement,
    rowNamed(page, "How is a failed email retried?"),
    "it wraps",
  );
  pressKey("End", document.activeElement ?? document.body);
  assert.equal(document.activeElement, rowNamed(page, "Expire after 7 days?"));
});

test("↓ passes over a folded plan's rows", async () => {
  const { page } = mount();
  await settle();
  act(() => headerNamed(page, "Invites").click());
  act(() => rowNamed(page, "Alert at 80%?").focus());
  pressKey("ArrowDown", document.activeElement ?? document.body);
  assert.equal(
    document.activeElement,
    rowNamed(page, "How is a failed email retried?"),
    "Invites' row is passed over, the walk wrapping to the first",
  );
});

test("a folded plan's items have no row, so K and J pass over them and the pager counts the rows a reader finds", async () => {
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  act(() => headerNamed(page, "Invites").click());
  pressKey("j");
  assert.equal(readTitle(page), "Alert at 80%?", "nothing below the last row");
  layOut(page, 800);
  assert.equal(pagerOf(page), "2 of 2");
  act(() => keys.unmount());
});

test("the chosen item keeps its place when its own plan folds, so J still reaches the rows below, and once left the folded rows are passed over", async () => {
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  act(() => headerNamed(page, "Billing usage alerts").click());
  pressKey("j");
  assert.equal(readTitle(page), "Expire after 7 days?");
  pressKey("k");
  assert.equal(readTitle(page), "Expire after 7 days?", "the folded plan holds no row above");
  act(() => keys.unmount());
});

test("a settled item offers, over its box, the next item that needs you as the Inbox draws it: its agent's tile, its title, the attention mark at its end and J where J reaches it, and its card hung beside it, a press opening it; an item that waits offers none", async () => {
  const { page } = mount();
  await settle();
  const offered = () =>
    page.querySelector<HTMLButtonElement>('.inbox-view-items [aria-label="Next item"] button');
  assert.equal(offered(), null, "the item chosen waits on its box");

  act(() => rowNamed(page, "How is a failed email retried?").click());
  const next = offered();
  assert.ok(next, "the settled item offers the next");
  assert.equal(next.querySelector(".inbox-next-title")?.textContent, "Alert at 80%?");
  assert.ok(next.querySelector(".inbox-row-attention"), "it needs you, as its row says");
  assert.ok(wordsOf(next)?.endsWith("J"), "the key stands last");
  assert.ok(wearsAgentTile(next), "the next item's agent stands by its tile");
  assert.equal(next.querySelector("[data-agent-ref]"), null, "the tile hangs no card of its own");
  assert.match(
    hoveredCard(next, "[data-inbox-row-card]") ?? "",
    /^Billing usage alerts.*Alert at 80%\?.*Needs you/u,
    "the card is the item's own",
  );
  act(() => next.click());
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.equal(offered(), null);
});

test("Next follows the way the keys last went: after K it offers the nearest item above that needs you, by an arrow up and K, a press opening it; after J the one below, by J", async () => {
  world.inboxes.set(BILLING.id, [
    { ...THRESHOLD, updatedAt: 4_500 },
    { ...RETRY, updatedAt: 2_000, settledAt: 2_000 },
  ]);
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  const offered = () =>
    page.querySelector<HTMLButtonElement>('.inbox-view-items [aria-label="Next item"] button');
  assert.deepEqual(listed(page), [
    "# Billing usage alerts",
    "▸ *Alert at 80%?",
    "How is a failed email retried?",
    "# Invites",
    "*Expire after 7 days?",
  ]);

  pressKey("j");
  assert.equal(readTitle(page), "How is a failed email retried?");
  assert.equal(offered()?.querySelector(".inbox-next-title")?.textContent, "Expire after 7 days?");
  assert.ok(wordsOf(offered())?.endsWith("J"));
  assert.equal(offered()?.getAttribute("aria-keyshortcuts"), "J Alt+ArrowDown");

  pressKey("j");
  pressKey("k");
  assert.equal(readTitle(page), "How is a failed email retried?");
  const next = offered();
  assert.ok(next, "the settled item offers the next");
  assert.equal(next.querySelector(".inbox-next-lead")?.textContent, "Next ↑");
  assert.equal(next.querySelector(".inbox-next-title")?.textContent, "Alert at 80%?");
  assert.ok(wordsOf(next)?.endsWith("K"));
  assert.equal(next.getAttribute("aria-keyshortcuts"), "K Alt+ArrowDown");
  act(() => next.click());
  assert.equal(readTitle(page), "Alert at 80%?");
  act(() => keys.unmount());
});

test("Next hands the keyboard to the item it opens, its way back one column wide and its row split, and the item opens at its thread's newest message, wherever the last was scrolled", async () => {
  layOutBoards({ height: 1200 });
  const { page } = mount();
  await settle();
  const next = () =>
    page.querySelector<HTMLButtonElement>('.inbox-view-items [aria-label="Next item"] button');
  act(() => rowNamed(page, "How is a failed email retried?").click());
  const board = boardOf(itemPane(page));
  scrollBoard(board, 200);
  next()?.focus();
  act(() => next()?.click());
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.ok(
    document.activeElement === rowNamed(page, "Alert at 80%?"),
    "split, the keyboard is on its row",
  );
  assert.equal(board.scrollTop, 800, "the next item opens at its newest message");
  assert.equal(scrollButton(itemPane(page)), null, "at its end, no way back is offered");

  layOut(page, 800);
  act(() => backToList(page).click());
  act(() => rowNamed(page, "How is a failed email retried?").click());
  next()?.focus();
  act(() => next()?.click());
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.ok(
    document.activeElement === backToList(page),
    "one column wide, the keyboard is on its way back",
  );
});

test("a press on the row already chosen hands the keyboard nowhere, so a later narrowing leaves it where the developer put it", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Alert at 80%?").click());
  const elsewhere = document.body.appendChild(document.createElement("button"));
  elsewhere.focus();
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["item"]);
  assert.ok(document.activeElement === elsewhere, "the keyboard stays outside the Inbox");
  elsewhere.remove();
});

/** Every answer the pane sends, written down and left unanswered, so the box stays as it was. */
function heldAnswers(): CodingAgentInboxAnswerParams[] {
  const sent: CodingAgentInboxAnswerParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ANSWER) return previous(request);
      sent.push(request.payload);
      return new Promise(() => undefined);
    },
  });
  return sent;
}

test("an item's box is the agent's message box: it takes no caret as the item opens, so K and J stay the list's; Enter sends its note, Shift+Enter is a new line, and Escape leaves the box but not the item", async () => {
  const { page } = mount();
  await settle();
  const sent = heldMessages(writtenOn(THRESHOLD, "c1b2c3d4-0000-4000-8000-000000000093"));
  const pane = itemPane(page);
  assert.equal(readTitle(page), "Alert at 80%?");
  assert.notEqual(document.activeElement, composerEditor(pane), "opening an item takes no caret");

  typeInComposer(pane, "Use 90%\ninstead");
  pressInComposer(pane, "Escape");
  assert.notEqual(document.activeElement, composerEditor(pane), "Escape leaves the box");
  assert.equal(readTitle(page), "Alert at 80%?", "and the item stands");

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ itemId, text, answers }) => ({ itemId, text, answers })),
    [{ itemId: THRESHOLD.id, text: "Use 90%\ninstead", answers: undefined }],
  );
});

test("an item whose box holds unsent words wears the Draft pencil on its row while another item is chosen, as a sidebar task's row does, and none while its box stands beside the list; with the list standing alone, the chosen item's row wears it too", async () => {
  const { page } = mount();
  await settle();
  typeInComposer(itemPane(page), "Use 90% instead");
  await settle();
  assert.equal(rowDrafted(page, "Alert at 80%?"), false, "the chosen item's box shows its words");

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.equal(rowDrafted(page, "Alert at 80%?"), true, "the draft is marked while away");
  assert.equal(rowDrafted(page, "Expire after 7 days?"), false, "only the item holding it is");
  assert.equal(rowDrafted(page, "How is a failed email retried?"), false);

  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.equal(composerEditor(itemPane(page)).textContent, "Use 90% instead");
  assert.equal(rowDrafted(page, "Alert at 80%?"), false);
  layOut(page, 800);
  act(() => backToList(page).click());
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(rowDrafted(page, "Alert at 80%?"), true, "the list standing alone hides its box");
});

test("files picked or dropped in an item's box are drawn as chips and go with its reply, standing for the developer's own words where they wrote none", async () => {
  const { page } = mount();
  await settle();
  const sent = heldMessages(writtenOn(THRESHOLD, "c1b2c3d4-0000-4000-8000-000000000094"));
  const pane = itemPane(page);
  assert.equal(readTitle(page), "Alert at 80%?");

  await handFiles(page, [new File(["threshold: 0.9\n"], "alerts.yml", { type: "" })], "pick");
  await handFiles(page, [new File(["%PDF-1.7"], "spec.pdf", { type: "application/pdf" })], "drop");
  assert.deepEqual(attachedNames(pane), ["alerts.yml", "spec.pdf"]);

  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ text, answers, attachments }) => ({ text, answers, attachments })),
    [
      {
        text: "",
        answers: undefined,
        attachments: [
          { name: "alerts.yml", mediaType: "text/plain", data: btoa("threshold: 0.9\n") },
          { name: "spec.pdf", mediaType: "application/pdf", data: btoa("%PDF-1.7") },
        ],
      },
    ],
  );
});

/** A text file whose bytes are read only once the test opens its gate, as a slow disk would hand them over. */
function gatedFile(name: string, words: string) {
  const file = new File([words], name, { type: "text/plain" });
  let open: () => void = () => undefined;
  const gate = new Promise<ArrayBuffer>((resolve) => {
    open = () => resolve(new TextEncoder().encode(words).buffer);
  });
  Object.defineProperty(file, "arrayBuffer", { value: () => gate });
  return { file, open };
}

test("files whose reads land together both stand in the box", async () => {
  const { page } = mount();
  await settle();
  const first = gatedFile("a.txt", "a\n");
  const second = gatedFile("b.txt", "b\n");
  await handFiles(page, [first.file], "pick");
  await handFiles(page, [second.file], "drop");
  await act(async () => {
    first.open();
    second.open();
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settle();
  assert.deepEqual(attachedNames(itemPane(page)), ["a.txt", "b.txt"]);
});

test("files still being read as the agent posts on the item again land in its box", async () => {
  // Main pushes the chosen task's inbox again as the test says it changed.
  const deliver = (outcome: ReadOutcome) =>
    world.main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id }, pushedOf(outcome.value));
  const { page } = mount();
  await settle();
  const slow = gatedFile("trace.txt", "boom\n");
  await handFiles(page, [slow.file], "pick");
  const revised = { ...THRESHOLD, revision: 2, title: "Alert at 85%?" };
  act(() =>
    deliver({
      status: FAKE_ANSWER.DONE,
      value: { items: [revised, RETRY], cursor: "2" },
    }),
  );
  await settle();
  assert.equal(readTitle(page), "Alert at 85%?");
  await act(async () => {
    slow.open();
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settle();
  assert.deepEqual(attachedNames(itemPane(page)), ["trace.txt"]);
});
test("a message's file whose read failed says so under the files, and Retry reads it again", async () => {
  const written = threadItem([
    askingMessage(EXPIRY_ASK),
    {
      ...threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000095",
        { member: READER },
        "See the spec.",
        2_000,
      ),
      files: [
        {
          attachmentId: "a1b2c3d4-0000-4000-8000-0000000000f2",
          name: "spec.pdf",
          mediaType: "application/pdf",
        },
      ],
    },
  ]);
  world.inboxes = new Map([[BILLING.id, [written]]]);
  let failing = true;
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT) return previous(request);
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: failing
          ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
          : { contentType: "application/pdf", base64: "JVBERg==" },
      });
    },
  });
  const { page } = mount();
  await settle();
  const comment = () =>
    itemPane(page).querySelector('[data-message-id="c1b2c3d4-0000-4000-8000-000000000095"]') ??
    assert.fail("the message is drawn");
  const failed = comment().querySelector("[data-inbox-files-failed]");
  assert.ok(failed, "the failed read is said");
  failing = false;
  const retry = [...failed.querySelectorAll("button")].find((each) =>
    /retry/iu.test(each.textContent ?? ""),
  );
  act(() => retry?.click());
  await settle();
  assert.equal(comment().querySelector("[data-inbox-files-failed]"), null);
  assert.ok(comment().querySelector('button[aria-label="Open spec.pdf"]'), "the file opens now");
});

test("an item that needs no reply says nothing in its box of whether its answer will message the agent, bare, with a note, or with a file", async () => {
  world.inboxes = new Map([
    [BILLING.id, [{ ...asking(THRESHOLD, { type: INBOX_ASK.DO, steps: [] }), needsReply: false }]],
  ]);
  const { page } = mount();
  await settle();
  const pane = itemPane(page);
  assert.equal(footWords(pane), "");
  typeInComposer(pane, "Done on preview too.");
  assert.equal(footWords(pane), "");
  await handFiles(page, [new File(["ok\n"], "flag.txt", { type: "text/plain" })], "pick");
  assert.equal(footWords(pane), "");
  assert.equal(pane.textContent?.includes("message the agent"), false);
  assert.equal(pane.textContent?.includes("sent to the agent"), false);
});

test("in the window's Inbox an @ in an item's box offers its plan's repository's files, and the file picked reaches the agent in the reply as its link", async () => {
  const { page } = mount();
  await settle();
  const sent = heldMessages(writtenOn(THRESHOLD, "c1b2c3d4-0000-4000-8000-000000000096"));
  const pane = itemPane(page);

  typeInComposer(pane, "See @roll");
  await settle();
  const offered = [...pane.querySelectorAll(".mention-menu .luke-combobox-option-label")].map(
    (name) => name.textContent,
  );
  pressInComposer(pane, "Enter");
  await settle();
  const chips = [...composerEditor(pane).querySelectorAll("[data-mention-ref]")].map(
    (chip) => chip.querySelector(".luke-inline-ref-label")?.textContent,
  );
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(offered, ["rollout-store.ts"]);
  assert.deepEqual(chips, ["rollout-store.ts"]);
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  assert.deepEqual(
    sent.map(({ text }) => text),
    [`See ${file}`],
  );
});

test("what an item's box said of a dictation that failed stays with that item, and the next item's box opens without it", async () => {
  // The strip draws still under reduced motion, which jsdom has no answer to.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> =>
      request.kind === ACT_KIND.MICROPHONE_REQUEST
        ? Promise.resolve({ status: FAKE_ANSWER.DONE, value: MICROPHONE_STATUS.DENIED })
        : previous(request),
  });
  const { page } = mount();
  await settle();
  const alerts = () =>
    [...itemPane(page).querySelectorAll('.agent-composer [role="alert"]')].map(
      (alert) => alert.textContent,
    );

  const dictate =
    itemPane(page).querySelector<HTMLButtonElement>('button[aria-label="Dictate"]') ??
    assert.fail("the microphone is offered");
  await act(async () => dictate.click());
  await settle();
  const refused = alerts();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();

  assert.equal(refused.length, 1, "the dictation says why it left nothing");
  assert.deepEqual(alerts(), [], "the next item's box says nothing of it");
});

/** The chip of the skill the thread's last reply names, pressed. */
async function pressNoteSkill(page: HTMLElement, name: string): Promise<void> {
  await settle();
  const note = [
    ...itemPane(page).querySelectorAll('[data-inbox-comment="message"] [data-inbox-message-text]'),
  ].at(-1);
  const chip = [...(note?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.querySelector(".luke-inline-ref-label")?.textContent === name,
  );
  assert.ok(chip, "the skill is its chip");
  act(() => chip.click());
}

/** Where the release skill's file stands on GitHub. */
const RELEASE_ON_GITHUB = "https://github.com/acme/relay/blob/HEAD/.agents/skills/release/SKILL.md";

test("in the window's Inbox a skill an answer's words name is the chip a sent message draws, which opens its SKILL.md in the panel beside it as its preview, as a file the item names does", async () => {
  const answered = answeredBy(
    item(RETRY.id, RETRY.title, 5_000),
    READER,
    "Retry 3 times over an hour",
    "Run /release first.",
    5_000,
  );
  world.inboxes = new Map([
    [BILLING.id, [THRESHOLD, answered]],
    [INVITES.id, [EXPIRY]],
  ]);
  const opened = skillReads();
  const files: string[] = [];
  const panel: SidePanelControl = {
    ...tasksControl().sidePanel,
    onPreviewFile: (ref) => files.push(ref.path),
  };
  const { page } = mount([], { panel });
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await pressNoteSkill(page, "/release");

  assert.deepEqual(files, [".agents/skills/release/SKILL.md"]);
  assert.deepEqual(opened, [], "nothing leaves for GitHub");
});

test("a skill named by a settled item of an agent with no plan that a link reached opens in the agent's own repository, which its group names none of", async () => {
  const settled = answeredBy(BUMP, READER, "Retry once", "Run /release first.", 2_000);
  world.agentInboxes = new Map([[STRAY_AGENT, [settled]]]);
  world.pageAgents = new Map([
    [STRAY_AGENT, { ...AGENT, id: STRAY_AGENT, planId: null, title: "Bump" }],
  ]);
  const opened = skillReads();
  const { page } = mount();
  await settle();
  act(() => world.chooseFromOutside({ agentId: STRAY_AGENT, itemId: BUMP.id, opened: true }));
  await settle();
  await pressNoteSkill(page, "/release");

  assert.deepEqual(opened, [RELEASE_ON_GITHUB]);
});

test("Got it on a notice whose agent waits to hear back reaches the agent, so the window reads its agents again, as it does for no nod on a notice that needs none", async () => {
  const notice = (id: string, title: string, needsReply: boolean): InboxItem => ({
    ...noticeOf(item(id, title, 6_000)),
    startedBy: TEAMMATE,
    needsReply,
  });
  const heard = notice("a1b2c3d4-0000-4000-8000-000000000012", "Turn on the flag", true);
  const quiet = notice("a1b2c3d4-0000-4000-8000-000000000013", "Add the secret", false);
  world.inboxes = new Map([
    [BILLING.id, [heard, quiet]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  const listReads: AnyAct[] = [];
  const nods: CodingAgentInboxAnswerParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      // Note that only the answered items' task's agents are counted, because the item chosen next reads its own task's for its card.
      if (request.kind === ACT_KIND.CODING_AGENTS_LIST && request.payload.taskId === BILLING.id) {
        listReads.push(request);
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_ANSWER) {
        nods.push(request.payload);
        const asked = request.payload.itemId === heard.id ? heard : quiet;
        const answered = { ...asked, status: INBOX_STATUS.ANSWERED, answeredBy: READER };
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { item: answered, taken: true },
        });
      }
      return previous(request);
    },
  });
  const gotIt = async () => {
    assert.equal(sendWords(itemPane(page)), "Got it");
    await act(async () => answerSend(itemPane(page)).click());
  };

  act(() => rowNamed(page, "Add the secret").click());
  await settle();
  const beforeQuiet = listReads.length;
  await gotIt();
  await settle();
  assert.equal(listReads.length, beforeQuiet, "a nod nobody hears moves nothing about the agent");

  act(() => rowNamed(page, "Turn on the flag").click());
  await settle();
  const beforeHeard = listReads.length;
  await gotIt();
  await settle();
  assert.ok(listReads.length > beforeHeard, "the agent heard the nod, so its list is read again");
  assert.deepEqual(
    nods.map(({ clientKey: _key, ...nod }) => nod),
    [
      { itemId: quiet.id, revision: quiet.revision, reply: INBOX_REPLY.ACKNOWLEDGED },
      { itemId: heard.id, revision: heard.revision, reply: INBOX_REPLY.ACKNOWLEDGED },
    ],
  );
});

/** The shown item's thread as a reader meets it: each comment's kind, its writer's face, its writer by name, and a message's words. */
function threadOf(page: HTMLElement): (string | null | undefined)[][] {
  return [
    ...itemPane(page).querySelectorAll<HTMLElement>(
      '.inbox-thread > li:not([data-inbox-comment="draft"])',
    ),
  ].map((entry) => [
    entry.dataset.inboxComment ?? (entry.dataset.inboxEarlier === undefined ? "?" : "earlier"),
    faceKind(entry.querySelector(".luke-comment-face")),
    wordsOf(entry.querySelector(".luke-comment-name")),
    wordsOf(entry.querySelector("[data-inbox-message-text]")),
  ]);
}

test("a thread draws its messages after the question in the order they were written, the answer among them: a teammate's by their face and name, the reader's own as You, and the agent's by its tile and name, their mentions as chips", async () => {
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  const threaded: InboxItem = {
    ...RETRY,
    updatedAt: 5_300,
    thread: inOrder(RETRY, [
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000001",
        { member: TEAMMATE },
        "Should it page at night too?",
        4_500,
      ),
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000002",
        "agent",
        "Only in business hours.",
        5_100,
      ),
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000003",
        { member: READER },
        `See ${file}`,
        5_200,
      ),
    ]),
  };
  world.inboxes = new Map([
    [BILLING.id, [THRESHOLD, threaded]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  assert.deepEqual(threadOf(page), [
    ["message", "agent", "Alerts", "A failed email is retried as the agent sets it up."],
    ["message", "person", "Charles Pan", "Should it page at night too?"],
    ["message", "person", "You", "And page on-call if all three fail."],
    ["message", "agent", "Alerts", "Only in business hours."],
    ["message", "person", "You", "See file rollout-store.ts"],
  ]);
  const mine = itemPane(page).querySelectorAll('[data-inbox-comment="message"]')[4];
  assert.equal(
    mine?.querySelector("[data-mention-ref] .luke-inline-ref-label")?.textContent,
    "rollout-store.ts",
  );
});

/** Selects the words drawn in the item's pane as `words`, from `from` through `to`, as a drag lets them go. */
function selectInPane(page: HTMLElement, words: string, from: string, to: string): void {
  const walker = document.createTreeWalker(itemPane(page), NodeFilter.SHOW_TEXT);
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

/** Reply, where it stands over the window. */
function replyPress(): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>(".reply-to-selection button")].find(
    (each) => each.textContent === "Reply",
  );
}

test("words selected in a thread stand Reply over them, which quotes them into the box: a settled item's message sends the quote set apart over the words typed under it, and a teammate's words stand Reply as the agent's do", async () => {
  const threaded: InboxItem = {
    ...RETRY,
    updatedAt: 5_300,
    thread: inOrder(RETRY, [
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000041",
        { member: TEAMMATE },
        "Should it page at night too?",
        4_500,
      ),
      threadMessage(
        "c1b2c3d4-0000-4000-8000-000000000042",
        "agent",
        "Only in business hours. Nights wait for the morning.",
        5_100,
      ),
    ]),
  };
  world.inboxes = new Map([
    [BILLING.id, [THRESHOLD, threaded]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  const sent = heldMessages(writtenOn(threaded, "c1b2c3d4-0000-4000-8000-000000000043"));
  const pane = itemPane(page);

  selectInPane(page, "Should it page", "Should", "too?");
  assert.notEqual(replyPress(), undefined, "a teammate's words may be quoted too");

  selectInPane(page, "Only in business hours.", "Only", "hours.");
  const reply = replyPress() ?? assert.fail("Reply stands over the agent's words");
  act(() => reply.click());
  await settle();
  assert.equal(replyPress(), undefined, "Reply goes once pressed");
  assert.equal(document.activeElement, composerEditor(pane), "the box takes the caret");
  typeInComposer(pane, "Page at night for a full outage.");
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ text }) => text),
    ["> Only in business hours.\n\nPage at night for a full outage."],
  );
});

test("words selected in an open item's question quote into its box, its reply carries the quote, and Reply stands down while the reply is out", async () => {
  const asked = saying(THRESHOLD, "Usage alerts fire at 80% of the plan's quota.");
  world.inboxes = new Map([
    [BILLING.id, [asked]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  const sent: CodingAgentInboxMessageParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      sent.push(request.payload);
      return new Promise(() => undefined);
    },
  });
  const pane = itemPane(page);

  selectInPane(page, "Usage alerts fire", "Usage", "quota.");
  const reply = replyPress() ?? assert.fail("Reply stands over the agent's question");
  act(() => reply.click());
  await settle();
  typeInComposer(pane, "Make it 90%.");
  pressInComposer(pane, "Enter");
  await settle();

  selectInPane(page, "Usage alerts fire", "Usage", "quota.");
  assert.equal(replyPress(), undefined, "no quote is offered while the reply is out");
  assert.deepEqual(
    sent.map(({ itemId, text }) => ({ itemId, text })),
    [
      {
        itemId: THRESHOLD.id,
        text: "> Usage alerts fire at 80% of the plan's quota.\n\nMake it 90%.",
      },
    ],
  );
});

test("a message written on a settled item's thread from its box goes as a message, never an answer, and lands on the thread in place, scrolled into view with the draft reply under it, the item still answered and the box emptied", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  const answers = heldAnswers();
  const sent = heldMessages(writtenOn(RETRY, "c1b2c3d4-0000-4000-8000-000000000010"));
  const pane = itemPane(page);
  const board =
    pane.querySelector<HTMLElement>(".inbox-board")?.parentElement ?? assert.fail("the thread");
  // The thread is taller than its board, so the new comment lands under its foot, the draft reply under it.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this === board) return DOMRect.fromRect({ y: 0, height: 400 });
    if (this.matches("[data-message-id]")) return DOMRect.fromRect({ y: 900, height: 60 });
    if (this.matches('[data-inbox-comment="draft"]')) {
      return DOMRect.fromRect({ y: 960, height: 200 });
    }
    return DOMRect.fromRect();
  });

  typeInComposer(pane, "Page on-call at night too.");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ itemId, text, attachments }) => ({ itemId, text, attachments })),
    [{ itemId: RETRY.id, text: "Page on-call at night too.", attachments: undefined }],
  );
  assert.deepEqual(answers, [], "the item is not answered again");
  assert.deepEqual(threadOf(page).at(-1), [
    "message",
    "person",
    "You",
    "Page on-call at night too.",
  ]);
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?"]);
  assert.equal(composerEditor(pane).textContent, "", "the box lets its words go");
  assert.equal(
    board.scrollTop,
    760,
    "the board scrolls its own new comment, and the draft reply's foot under it, into view",
  );
});

test("a message refused says why under the box, which keeps its words, and leaves nothing on the thread", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  heldMessages(() => ({ failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED }));
  const pane = itemPane(page);

  typeInComposer(pane, "Page on-call at night too.");
  act(() => pane.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
  await settle();

  assert.equal(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "Only the member who started this agent can do this.",
  );
  assert.equal(
    threadOf(page).some(([, , , words]) => words === "Page on-call at night too."),
    false,
    "nothing lands on the thread",
  );
  assert.equal(composerEditor(pane).textContent, "Page on-call at night too.");
  assert.deepEqual(subjectOf(page), ["How is a failed email retried?"]);
});

test("a message refused as naming no agent says the agent is archived where it is, with Unarchive after it, which brings the agent back and lets the note go, the box keeping its words; one whose agent is gone says it no longer exists", async () => {
  world.listedAgents = [{ ...AGENT, status: CODING_AGENT_STATUS.COMPLETED, archivedAt: 4_000 }];
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  heldMessages(() => ({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }));
  const unarchived: { agentId: string; archived: boolean }[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_ARCHIVE) return previous(request);
      unarchived.push(request.payload);
      // Brought back, the agent is listed so from then on.
      const back = { ...AGENT, status: CODING_AGENT_STATUS.COMPLETED };
      world.listedAgents = [back];
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { agent: back } });
    },
  });
  const pane = itemPane(page);
  const note = () => pane.querySelector('.agent-composer [role="alert"]');
  const unarchive = () =>
    [...pane.querySelectorAll<HTMLButtonElement>(".luke-composer-foot-note button")].find(
      (button) => button.textContent === "Unarchive",
    );

  typeInComposer(pane, "Page on-call at night too.");
  act(() => pane.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
  await settle();

  assert.match(note()?.textContent ?? "", /^This agent is archived\./u);
  act(() => (unarchive() ?? assert.fail("Unarchive follows the note")).click());
  await settle();
  assert.deepEqual(unarchived, [{ agentId: AGENT.id, archived: false }]);
  assert.equal(note(), null, "the note is let go once the agent is back");
  assert.equal(composerEditor(pane).textContent, "Page on-call at night too.");

  act(() => world.root?.unmount());
  world.listedAgents = [];
  const gone = mount().page;
  await settle();
  act(() => rowNamed(gone, "How is a failed email retried?").click());
  await settle();
  const goneItem = itemPane(gone);
  typeInComposer(goneItem, "Page on-call at night too.");
  act(() => goneItem.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());
  await settle();

  assert.equal(
    goneItem.querySelector('.agent-composer [role="alert"]')?.textContent,
    "This agent no longer exists.",
  );
  assert.equal(
    goneItem.querySelector(".luke-composer-foot-note button"),
    null,
    "nothing to unarchive",
  );
});

test("an Unarchive that lands after another send was refused lets only the archived note go, so the newer refusal still says why", async () => {
  world.listedAgents = [{ ...AGENT, status: CODING_AGENT_STATUS.COMPLETED, archivedAt: 4_000 }];
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  let refusal:
    | typeof CODING_AGENT_CALL_FAILURE.NOT_FOUND
    | typeof CODING_AGENT_CALL_FAILURE.UNANSWERED = CODING_AGENT_CALL_FAILURE.NOT_FOUND;
  heldMessages(() => ({ failure: refusal }));
  let land: () => void = () => undefined;
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_ARCHIVE) return previous(request);
      const back = { ...AGENT, status: CODING_AGENT_STATUS.COMPLETED };
      // Held until the test lands it, after the second send was refused.
      return new Promise((resolve) => {
        land = () => {
          world.listedAgents = [back];
          resolve({ status: FAKE_ANSWER.DONE, value: { agent: back } });
        };
      });
    },
  });
  const pane = itemPane(page);
  const note = () => pane.querySelector('.agent-composer [role="alert"]')?.textContent;
  const send = () =>
    act(() => pane.querySelector<HTMLButtonElement>('button[aria-label="Send"]')?.click());

  typeInComposer(pane, "Page on-call at night too.");
  send();
  await settle();
  const unarchive = [
    ...pane.querySelectorAll<HTMLButtonElement>(".luke-composer-foot-note button"),
  ].find((button) => button.textContent === "Unarchive");
  act(() => (unarchive ?? assert.fail("Unarchive follows the note")).click());
  refusal = CODING_AGENT_CALL_FAILURE.UNANSWERED;
  send();
  await settle();
  const newer = note();
  assert.notEqual(newer, undefined, "the second send says why it did not go");

  act(() => land());
  await settle();

  assert.equal(note(), newer, "the newer refusal stands once the agent is back");
});

test("files alone make a message: sent from a settled item's box with no words, and drawn on the thread as the files alone", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  const sent = heldMessages(writtenOn(RETRY, "c1b2c3d4-0000-4000-8000-000000000020"));
  const pane = itemPane(page);
  const send = () =>
    pane.querySelector<HTMLButtonElement>('button[aria-label="Send"]') ?? assert.fail("no Send");
  assert.equal(send().disabled, true, "an empty box sends nothing");

  await handFiles(page, [new File(["boom\n"], "trace.txt", { type: "text/plain" })], "pick");
  act(() => send().click());
  await settle();

  assert.deepEqual(
    sent.map(({ text, attachments }) => ({ text, attachments })),
    [
      {
        text: "",
        attachments: [{ name: "trace.txt", mediaType: "text/plain", data: btoa("boom\n") }],
      },
    ],
  );
  const message =
    pane.querySelector('[data-message-id="c1b2c3d4-0000-4000-8000-000000000020"]') ??
    assert.fail("the message is drawn");
  assert.deepEqual(attachedNames(message), ["trace.txt"]);
  assert.equal(message.querySelector("[data-inbox-message-text]"), null, "no empty words");
});

test("a thread read cut to its latest messages says the earlier ones are in the agent's tab, the agent's name opening its transcript beside the item", async () => {
  const long: InboxItem = {
    ...RETRY,
    thread: inOrder(
      RETRY,
      Array.from({ length: INBOX_BOUNDS.MAX_MESSAGES_READ }, (_, at) =>
        threadMessage(
          `b1b2c3d4-0000-4000-8000-${String(at).padStart(12, "0")}`,
          { member: TEAMMATE },
          `Note ${String(at)}`,
          5_001 + at,
        ),
      ),
    ),
  };
  world.inboxes = new Map([
    [BILLING.id, [THRESHOLD, long]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page, asked } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  const earlier =
    itemPane(page).querySelector<HTMLElement>("[data-inbox-earlier]") ??
    assert.fail("the cut is said");
  assert.equal(wordsOf(earlier), "Earlier messages are in Alerts’s tab");
  assert.equal(threadOf(page)[1]?.[0], "earlier", "the line stands before the messages");
  act(() => earlier.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(asked.previewedAgents, [AGENT.id], "the agent reads beside the item");
  assert.deepEqual(asked.shownAgents, []);
});

test("what an item's box holds unsent, its words and its files, outlasts every message landing on the item: a teammate's answer settling it, then the agent asking on it again", async () => {
  const deliver = (items: readonly InboxItem[], cursor: string) =>
    world.main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id }, pushedOf({ items, cursor }));
  const { page } = mount();
  await settle();
  assert.equal(readTitle(page), "Alert at 80%?");
  typeInComposer(itemPane(page), "Use 90%");
  await handFiles(page, [new File(["threshold: 0.9\n"], "alerts.yml", { type: "" })], "pick");
  const box = () => [composerEditor(itemPane(page)).textContent, attachedNames(itemPane(page))];

  const answered: InboxItem = {
    ...answeredBy(THRESHOLD, TEAMMATE, "Retry once", "", 3_500),
    updatedAt: 3_500,
  };
  act(() => deliver([answered, RETRY], "2"));
  await settle();
  assert.equal(composerEditor(itemPane(page)).getAttribute("aria-label"), "Reply");
  assert.deepEqual(box(), ["Use 90%", ["alerts.yml"]], "a teammate's answer takes nothing");

  const asked: InboxItem = {
    ...answered,
    revision: 2,
    status: INBOX_STATUS.OPEN,
    thread: [...(answered.thread ?? []), askingMessage(EXPIRY_ASK, { createdAt: 4_000 })],
    updatedAt: 4_000,
  };
  act(() => deliver([asked, RETRY], "3"));
  await settle();
  assert.deepEqual(box(), ["Use 90%", ["alerts.yml"]], "nor does the agent asking again");
});

/** How tall the room is that a thread's board shows, as the tests below lay it out. */
const BOARD_ROOM = 400;

/** The scroll measures jsdom gives no element, which `layOutBoards` stands in for. */
const SCROLL_MEASURES = ["scrollHeight", "clientHeight", "scrollTop"] as const;

/**
 * Lays out every thread's board (the pane's log) as the window would:
 * `layout.height` tall, read anew each time, in a room `BOARD_ROOM` tall,
 * its scroll held between its top and its end as a browser holds it. Any
 * other element keeps jsdom's own measures. Taken down as the test ends.
 */
function layOutBoards(layout: { height: number }): void {
  const tops = new WeakMap<Element, number>();
  const board = (element: Element) =>
    element.getAttribute("role") === "log" && element.closest(".inbox-view-items") !== null;
  const jsdoms = SCROLL_MEASURES.map(
    (name) => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)] as const,
  );
  const jsdom = (name: (typeof SCROLL_MEASURES)[number]) =>
    jsdoms.find(([held]) => held === name)?.[1] ?? assert.fail(`jsdom's ${name}`);
  Object.defineProperties(Element.prototype, {
    scrollHeight: {
      configurable: true,
      get(this: Element) {
        return board(this) ? layout.height : jsdom("scrollHeight").get?.call(this);
      },
    },
    clientHeight: {
      configurable: true,
      get(this: Element) {
        return board(this) ? BOARD_ROOM : jsdom("clientHeight").get?.call(this);
      },
    },
    scrollTop: {
      configurable: true,
      get(this: Element) {
        return board(this) ? (tops.get(this) ?? 0) : jsdom("scrollTop").get?.call(this);
      },
      set(this: Element, to: number) {
        if (!board(this)) return jsdom("scrollTop").set?.call(this, to);
        tops.set(this, Math.max(0, Math.min(to, layout.height - BOARD_ROOM)));
      },
    },
  });
  onTestFinished(() => {
    for (const [name, descriptor] of jsdoms) {
      if (descriptor !== undefined) Object.defineProperty(Element.prototype, name, descriptor);
    }
  });
}

/** The pane's thread, its board, which scrolls. */
function boardOf(pane: HTMLElement): HTMLElement {
  return pane.querySelector<HTMLElement>('[role="log"]') ?? assert.fail("the thread's board");
}

/** Scrolls `board` to `top` as the reader would, so the pane hears it. */
function scrollBoard(board: HTMLElement, top: number): void {
  act(() => {
    board.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: top - board.scrollTop }));
  });
  board.scrollTop = top;
  act(() => {
    board.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

/** The transcript's way back to the newest line, where the pane shows it. */
function scrollButton(pane: HTMLElement): HTMLButtonElement | null {
  return pane.querySelector<HTMLButtonElement>('button[aria-label="Scroll to the newest line"]');
}

test("a long thread opens at its newest message, its draft reply just over the board's foot, whether its question waits on an answer or nothing is asked", async () => {
  layOutBoards({ height: 1200 });
  for (const shown of [
    threadItem([askingMessage(EXPIRY_ASK)]),
    { ...THRESHOLD, title: "Alert at 90%?" },
    threadItem([
      threadMessage("e1b2c3d4-0000-4000-8000-000000000040", "agent", "Shipped the fix.", 1_000),
    ]),
  ]) {
    const pane = await mountThread(shown);
    assert.equal(boardOf(pane).scrollTop, 800, shown.title);
    assert.equal(scrollButton(pane), null, "at its end, no way back is offered");
    act(() => world.root?.unmount());
    document.body.innerHTML = "";
  }
});

test("a thread scrolled up offers the transcript's way back to its newest message, which takes it to its end and goes", async () => {
  layOutBoards({ height: 1200 });
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)]));
  const board = boardOf(pane);
  scrollBoard(board, 300);
  const back = scrollButton(pane) ?? assert.fail("scrolled up, the way back is offered");

  act(() => back.click());
  assert.equal(board.scrollTop, 800, "the thread is at its newest message again");
  assert.equal(scrollButton(pane), null, "at its end, the way back goes");
});

test("a thread that grows while the reader is at its end, a message or a picture landing late, keeps to its end; scrolled up, the reader is left where they are", async () => {
  const layout = { height: 1200 };
  layOutBoards(layout);
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)]));
  const board = boardOf(pane);
  layout.height = 1400;
  act(() => relayout());
  assert.equal(board.scrollTop, 1000, "at its end, it keeps to its end");

  scrollBoard(board, 300);
  layout.height = 1600;
  act(() => relayout());
  assert.equal(board.scrollTop, 300, "scrolled up, the reader's place stands");
});

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

/** The quotes the item's box holds, in order. */
function boxQuotes(pane: HTMLElement): (string | null)[] {
  const box = pane.querySelector(".inbox-answer") ?? assert.fail("the box is drawn");
  return [...box.querySelectorAll(".composer-editor .composer-quote-words")].map(
    (quote) => quote.textContent,
  );
}

test("words selected in what an open ask offers, an option's words, quote into its box as the agent's message's do", async () => {
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)]));

  selectWithin(pane, "What most teams use.", "What", "use.");
  const reply = replyPress() ?? assert.fail("Reply stands over an option's words");
  act(() => reply.click());
  await settle();

  assert.deepEqual(boxQuotes(pane), ["What most teams use."]);
  assert.equal(replyPress() === undefined, true, "Reply goes once pressed");
});

test("a field's name in an open ask quotes into its box, and words typed into a field offer no Reply, being the reader's own", async () => {
  const pane = await mountThread(
    threadItem([
      askingMessage({
        type: INBOX_ASK.ANSWER,
        fields: [{ type: INBOX_FIELD.TEXT, label: "Reason for the change", required: true }],
      }),
    ]),
  );
  const field = pane.querySelector(".inbox-field-composer") ?? assert.fail("the field is drawn");
  typeInComposer(field, "Teams abroad miss the window");

  selectWithin(field, "Teams abroad", "Teams", "abroad");
  assert.equal(
    replyPress() === undefined,
    true,
    "the reader's own typing is not the agent's words",
  );

  selectWithin(pane, "Reason for the change", "Reason", "change");
  const reply = replyPress() ?? assert.fail("Reply stands over a field's name");
  act(() => reply.click());
  await settle();
  assert.deepEqual(boxQuotes(pane), ["Reason for the change"]);
});

test.each([
  {
    words: "the reader's own answer",
    shown: threadItem(
      [
        askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.ANSWERED }),
        {
          ...threadMessage(
            "e1b2c3d4-0000-4000-8000-000000000002",
            { member: READER },
            "Seven days, to match the trial.",
            2_000,
          ),
          answers: { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["7 days"] },
        },
      ],
      { status: INBOX_STATUS.ANSWERED, answeredBy: READER, settledAt: 2_000 },
    ),
    within: '[data-message-id="e1b2c3d4-0000-4000-8000-000000000002"] [data-inbox-message-text]',
    quoted: "Seven days, to match the trial.",
  },
  {
    words: "the line saying an ask was withdrawn",
    shown: threadItem(
      [
        askingMessage(EXPIRY_ASK, {
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: "The plan settled it.",
        }),
      ],
      { status: INBOX_STATUS.CLOSED, settledAt: 2_000 },
    ),
    within: '[data-inbox-settled="withdrawn"]',
    quoted: "Withdrawn",
  },
  {
    words: "the item's title",
    shown: threadItem([askingMessage(EXPIRY_ASK)]),
    within: ".inbox-subject",
    quoted: "How long should invites last?",
  },
  {
    words: "the figure an answer gave a number field",
    shown: threadItem(
      [
        askingMessage(
          { type: INBOX_ASK.ANSWER, fields: [{ type: INBOX_FIELD.NUMBER, label: "Retries" }] },
          { status: INBOX_ASK_STATUS.ANSWERED },
        ),
        {
          ...threadMessage("e1b2c3d4-0000-4000-8000-000000000002", { member: READER }, "", 2_000),
          answers: {
            ask: ASKING_ID,
            reply: INBOX_REPLY.SUBMITTED,
            values: [{ label: "Retries", value: 14 }],
          },
        },
      ],
      { status: INBOX_STATUS.ANSWERED, answeredBy: READER, settledAt: 2_000 },
    ),
    within: '[data-inbox-answered-field="number"]',
    quoted: "14",
  },
])("$words quotes into the box as the agent's words do", async ({ shown, within, quoted }) => {
  const pane = await mountThread(shown);
  const words = pane.querySelector(within) ?? assert.fail(`${within} is drawn`);

  selectWithin(words, quoted, quoted, quoted);
  const reply = replyPress() ?? assert.fail("Reply stands over the words");
  act(() => reply.click());
  await settle();

  assert.deepEqual(boxQuotes(pane), [quoted]);
});

/** Each comment of the shown thread as its head draws its writer: its kind, then the kind of each face it draws, and the marks drawn anywhere but in its head or its body. */
function commentHeads(pane: HTMLElement): (string | undefined | (string | undefined)[])[][] {
  return [...pane.querySelectorAll<HTMLElement>(".inbox-thread > .inbox-comment")].map(
    (comment) => [
      comment.dataset.inboxComment,
      [...comment.querySelectorAll<HTMLElement>(".luke-comment-face")].map(faceKind),
      [...comment.querySelectorAll<HTMLElement>(".actor-mark")]
        .filter((mark) => mark.closest(".luke-comment-head, .inbox-comment-body") === null)
        .map((mark) => mark.dataset.kind),
    ],
  );
}

test("each comment of a thread is headed by its writer's face and name, its face the thread's gutter with no face drawn apart from it; the draft reply's head is the reader's, \"You\", with nothing after it", async () => {
  const shown = threadItem([
    askingMessage(EXPIRY_ASK),
    threadMessage(
      "e1b2c3d4-0000-4000-8000-000000000002",
      { member: TEAMMATE },
      "7 days, surely?",
      2_000,
    ),
  ]);
  const pane = await mountThread(shown);

  assert.deepEqual(commentHeads(pane), [
    ["message", ["agent"], []],
    ["message", ["person"], []],
    ["draft", ["person"], []],
  ]);
  const draft =
    pane.querySelector<HTMLElement>('[data-inbox-comment="draft"] .luke-comment-head') ??
    assert.fail("the draft reply has a head");
  assert.equal(wordsOf(draft), "You", "the reader's name alone, no draft and no time after it");
  assert.ok(
    draft.querySelector('.luke-comment-name > [data-actor-ref][data-kind="person"]'),
    "the reader is named by their ref",
  );
});

test("a thread draws every message, the agent's by its tile and name alone, no tag after its chip, and a member's by their face and name, under its title alone; its open ask is a marker ending the agent's message, its options standing in the reader's draft reply at the thread's end, over the note", async () => {
  const shown = threadItem([
    askingMessage(EXPIRY_ASK),
    threadMessage(
      "e1b2c3d4-0000-4000-8000-000000000002",
      { member: TEAMMATE },
      "7 days, surely?",
      2_000,
    ),
    threadMessage(
      "e1b2c3d4-0000-4000-8000-000000000003",
      "agent",
      "That is the default elsewhere.",
      2_500,
    ),
  ]);
  const pane = await mountThread(shown);

  assert.equal(
    pane.querySelector("[data-inbox-title]")?.textContent,
    "How long should invites last?",
  );
  assert.deepEqual(
    subjectParts(pane),
    ["How long should invites last?"],
    "no line stands under the title",
  );
  assert.deepEqual(threadOf(pane.ownerDocument.body), [
    [
      "message",
      "agent",
      "Alerts",
      "Invites expire after 24 hours today, which trips up teams across time zones.",
    ],
    ["message", "person", "Charles Pan", "7 days, surely?"],
    ["message", "agent", "Alerts", "That is the default elsewhere."],
  ]);
  assert.deepEqual(
    [...pane.querySelectorAll(".inbox-thread .luke-comment-head")].map((head) =>
      [...head.children].map((part) =>
        [...part.classList].find((name) => name.startsWith("luke-comment-")),
      ),
    ),
    [
      ["luke-comment-name", "luke-comment-time"],
      ["luke-comment-name", "luke-comment-time"],
      ["luke-comment-name", "luke-comment-time"],
      ["luke-comment-name"],
    ],
    "an agent's message, as a member's, is headed by its chip and when alone, with no tag after its chip, and the draft by the reader's chip alone",
  );
  assert.deepEqual(askBoxes(pane), [], "the open ask is no card in the agent's message");
  const [asked] = pane.querySelectorAll(".inbox-thread > li");
  assert.equal(
    asked?.querySelector("[data-inbox-marker]"),
    null,
    "the agent's message ends with its words, no marker saying the ask waits on the reader",
  );
  assert.equal(asked?.querySelector('[role="radio"]'), null, "and holds none of its options");
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.deepEqual(checkedOptions(pane), [], "nothing is picked for the reader");
  assert.deepEqual(
    openOptions(pane).map((option) => wordsOf(option)),
    ["1 day1As today.", "7 daysRecommended2What most teams use.", "30 days3"],
  );
  assert.ok(
    pane.querySelector(
      '.inbox-thread > li:last-child form.inbox-answer > [data-inbox-draft-ask] [role="radio"]',
    ),
    "the options stand in the draft's box, as its body",
  );
  assert.deepEqual(
    boxParts(pane),
    ["controls", "line: Add a note", "row: Attach files, Dictate, Send"],
    "under them the note line on its own, and under it the row: +, the microphone, and Send",
  );
  assert.equal(footWords(pane), "", "and no line of help");
  // What the thread draws stands inside the pane's masked region.
  assert.ok(pane.querySelector(".ph-no-capture [data-inbox-draft-ask]"));
  assert.ok(pane.querySelector(".ph-no-capture [data-inbox-message-text]"));
});

test("a plain reply sends no answer and leaves the ask open, the box's Send held until it holds words and nothing saying the ask stays open", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const answers = heldAnswers();
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000010"));
  assert.equal(composerEditor(pane).getAttribute("aria-label"), "Add a note");
  assert.equal(sendWords(pane), "Send");
  assert.equal(sendHeld(pane), true, "an empty box sends nothing");
  assert.equal(footWords(pane), "", "nothing says replying keeps the ask open");

  typeInComposer(pane, "Does it matter for SSO teams?");
  assert.equal(answerSend(pane).disabled, false, "words light Send");
  assert.equal(footWords(pane), "");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ itemId, text, answers }) => ({ itemId, text, answers })),
    [{ itemId: shown.id, text: "Does it matter for SSO teams?", answers: undefined }],
  );
  assert.deepEqual(answers, [], "the old answer path is never taken");
  assert.equal(askMarker(pane), null);
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.deepEqual(threadOf(pane.ownerDocument.body).at(-1), [
    "message",
    "person",
    "You",
    "Does it matter for SSO teams?",
  ]);
});

/** A notice posted on a thread, asking nothing and needing no reply, as the service writes one, at revision 4. */
function noticeItem(extra: Partial<InboxItem> = {}): InboxItem {
  const said: InboxMessage = {
    id: "e1b2c3d4-0000-4000-8000-000000000020",
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "The preview is up.",
    createdAt: 1_000,
  };
  return threadItem([said], {
    title: "The preview is up",
    needsReply: false,
    revision: 4,
    ...extra,
  });
}

/**
 * Every answer and message the Inbox sends from now on, written down: each
 * answer refused as unanswered while `refusing` says so, the box standing
 * open again, and held unanswered otherwise; each message held unanswered.
 */
function noticeWrites(refusing: () => boolean = () => false): {
  answered: CodingAgentInboxAnswerParams[];
  messaged: CodingAgentInboxMessageParams[];
} {
  const answered: CodingAgentInboxAnswerParams[] = [];
  const messaged: CodingAgentInboxMessageParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.CODING_AGENTS_INBOX_ANSWER) {
        answered.push(request.payload);
        if (!refusing()) return new Promise(() => undefined);
        const value = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      messaged.push(request.payload);
      return new Promise(() => undefined);
    },
  });
  return { answered, messaged };
}

/** What each answer sent says: its item, the revision it names, and the reply. */
function answersOf(answered: readonly CodingAgentInboxAnswerParams[]) {
  return answered.map(({ itemId, revision, reply }) => ({ itemId, revision, reply }));
}

test("opening the reader's own notice acknowledges it at its revision, once while it is shown, writing no message; its box offers no Got it, and opening it again after the acknowledgement was refused tries again", async () => {
  const notice = noticeItem();
  const { answered, messaged } = noticeWrites(() => true);
  const pane = await mountThread(notice);
  const acknowledged = { itemId: notice.id, revision: 4, reply: INBOX_REPLY.ACKNOWLEDGED };
  assert.deepEqual(answersOf(answered), [acknowledged]);
  assert.deepEqual(messaged, [], "the agent is not messaged");

  // Refused, the notice stands open again, its box held until it holds words.
  const send =
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]') ??
    assert.fail("the box has its button");
  assert.equal(sendWords(pane), "Send", "no Got it stands");
  assert.equal(send.disabled, true);
  assert.deepEqual(answersOf(answered), [acknowledged], "it is not tried again while it is shown");

  const page = pane.ownerDocument.body;
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  act(() => rowNamed(page, notice.title).click());
  await settle();
  assert.deepEqual(answersOf(answered), [acknowledged, acknowledged]);
});

test("a notice shown while its plan's follow has failed reads Got it, since opening it acknowledges nothing then, and Got it answers it", async () => {
  const notice = noticeItem();
  const { answered: sent } = noticeWrites();
  world.inboxes = new Map([
    [BILLING.id, [notice, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  // The list's follow of the plan reads its items, and the item's own follow of it could not be read.
  const unanswered = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;
  let follows = 0;
  world.startRead = (taskId) => {
    if (taskId !== BILLING.id) return undefined;
    follows += 1;
    return follows === 1
      ? undefined
      : Promise.resolve({ status: FAKE_ANSWER.DONE, value: unanswered });
  };
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, notice.title).click());
  await settle();
  const pane = itemPane(page);
  assert.deepEqual(sent, [], "opening it answers nothing");
  assert.equal(sendWords(pane), "Got it");
  act(() => answerSend(pane).click());
  await settle();
  assert.deepEqual(answersOf(sent), [
    { itemId: notice.id, revision: 4, reply: INBOX_REPLY.ACKNOWLEDGED },
  ]);
});

test("a notice whose box holds a draft is left open as it is opened, and its words go as a reply naming the notice's revision, no answer beside it", async () => {
  const notice = noticeItem();
  // The first acknowledgement is refused, so the box stands open to take the draft.
  let refusals = 1;
  const { answered, messaged } = noticeWrites(() => {
    refusals -= 1;
    return refusals >= 0;
  });
  const pane = await mountThread(notice);
  assert.equal(answered.length, 1);
  typeInComposer(pane, "Looks right.");
  const page = pane.ownerDocument.body;
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  act(() => rowNamed(page, notice.title).click());
  await settle();
  assert.equal(answered.length, 1, "opened with a draft, it is not acknowledged");
  assert.equal(composerEditor(itemPane(page)).textContent, "Looks right.");
  assert.equal(sendWords(itemPane(page)), "Send");

  act(() =>
    itemPane(page)
      .querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')
      ?.click(),
  );
  await settle();
  assert.deepEqual(
    messaged.map(({ text, revision }) => ({ text, revision })),
    [{ text: "Looks right.", revision: 4 }],
  );
  assert.equal(answered.length, 1, "the reply is no second answer");
});

test("a teammate's notice is left open as it is opened, since acknowledging it settles it for them too, and its box's Send reads Got it, which answers it at its revision, with no line beside it", async () => {
  const notice = noticeItem({ startedBy: TEAMMATE });
  const { answered, messaged } = noticeWrites();
  const pane = await mountThread(notice);
  assert.deepEqual(answered, [], "opening it answers nothing");
  assert.equal(sendWords(pane), "Got it");
  assert.equal(
    footWords(pane),
    "Got it",
    "Got it is Send's own words, the foot saying nothing else",
  );
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();
  assert.deepEqual(answersOf(answered), [
    { itemId: notice.id, revision: 4, reply: INBOX_REPLY.ACKNOWLEDGED },
  ]);
  assert.deepEqual(messaged, []);
});

test("a reply leaves its box the moment it is sent, the box and the ask standing empty and open while it is out, so a second Enter sends nothing; refused, its words and files come back into the box, which says why", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const sent: CodingAgentInboxMessageParams[] = [];
  const answers: ((answer: CodingAgentInboxMessagedView) => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      sent.push(request.payload);
      // The service answers once the test says so.
      return new Promise((resolve) =>
        answers.push((value) => resolve({ status: FAKE_ANSWER.DONE, value })),
      );
    },
  });

  await handFiles(pane.ownerDocument.body, [new File(["# Notes"], "notes.md")], "pick");
  typeInComposer(pane, "Does it matter for SSO teams?");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.equal(composerEditor(pane).textContent, "", "the box lets its words go at once");
  assert.deepEqual(attachedNames(draftReplyIn(pane)), [], "and its files");
  assert.deepEqual(
    [...pane.querySelectorAll('.inbox-thread > li:not([data-inbox-comment="draft"])')].flatMap(
      attachedNames,
    ),
    ["notes.md"],
    "which go up with the reply on the thread",
  );
  assert.equal(composerEditor(pane).getAttribute("aria-disabled"), null, "and stands open");
  assert.ok(
    openOptions(pane).every((option) => !option.disabled),
    "the ask still takes a pick",
  );
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ text }) => text),
    ["Does it matter for SSO teams?"],
    "a second Enter sends nothing again",
  );

  await act(async () => answers[0]?.({ failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED }));
  await settle();

  assert.equal(composerEditor(pane).textContent, "Does it matter for SSO teams?");
  assert.deepEqual(attachedNames(pane), ["notes.md"]);
  assert.equal(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "Only the member who started this agent can do this.",
  );
});

/** The reader's draft reply at the thread's end, which holds the box. */
function draftReplyIn(pane: HTMLElement): Element {
  return pane.querySelector('[data-inbox-comment="draft"]') ?? assert.fail("the draft reply");
}

/** The words at the head's end of each comment of the thread that says its reply is on its way. */
function sendingMarks(page: HTMLElement): (string | undefined)[] {
  return [...itemPane(page).querySelectorAll(".inbox-thread .luke-comment-trailing")]
    .map((trailing) => wordsOf(trailing))
    .filter((words) => words === "Sending");
}

test("a plain reply stands at the thread's end marked Sending the moment it is sent, and once a read or its answer holds it, the message stands in its place once; refused, it leaves the thread as its words go back into the box, which says why", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const page = pane.ownerDocument.body;
  // Each send waits on the test's word: the reply landing on the thread, or refused.
  const lands: ((refused: boolean) => void)[] = [];
  const landed: InboxItem[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      const answer = repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000021")(request.payload);
      if (!("failure" in answer)) landed.push(answer.item);
      return new Promise((resolve) =>
        lands.push((refused) =>
          resolve({
            status: FAKE_ANSWER.DONE,
            value: refused ? { failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED } : answer,
          }),
        ),
      );
    },
  });

  typeInComposer(pane, "Does it matter for SSO teams?");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(threadOf(page).at(-1), [
    "message",
    "person",
    "You",
    "Does it matter for SSO teams?",
  ]);
  assert.deepEqual(sendingMarks(page), ["Sending"], "the reply says it is on its way");

  // The push holding the reply lands before the reply's own answer does.
  const held = landed[0] ?? assert.fail("the reply is answered");
  await act(async () =>
    world.main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id }, { items: [held, RETRY] }),
  );
  await settle();
  await act(async () => lands[0]?.(false));
  await settle();
  assert.deepEqual(
    threadOf(page).filter(([, , , words]) => words === "Does it matter for SSO teams?"),
    [["message", "person", "You", "Does it matter for SSO teams?"]],
    "the message stands once, in the reply's place",
  );
  assert.deepEqual(sendingMarks(page), [], "and says nothing of sending");

  typeInComposer(pane, "Never mind.");
  pressInComposer(pane, "Enter");
  await settle();
  assert.deepEqual(threadOf(page).at(-1), ["message", "person", "You", "Never mind."]);
  assert.deepEqual(sendingMarks(page), ["Sending"]);
  await act(async () => lands[1]?.(true));
  await settle();
  assert.equal(
    threadOf(page).some(([, , , words]) => words === "Never mind."),
    false,
    "a refused reply leaves the thread",
  );
  assert.deepEqual(sendingMarks(page), []);
  assert.equal(composerEditor(pane).textContent, "Never mind.", "its words are back in the box");
  assert.equal(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "Only the member who started this agent can do this.",
  );
});

test("words written in a reply's box while the reply is out stay there, whether it lands or is refused", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  // Each send waits on the test's word: the reply landing on the thread, or refused.
  const lands: ((refused: boolean) => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      const { payload } = request;
      const landed = repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000020")(payload);
      return new Promise((resolve) =>
        lands.push((refused) =>
          resolve({
            status: FAKE_ANSWER.DONE,
            value: refused ? { failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED } : landed,
          }),
        ),
      );
    },
  });

  typeInComposer(pane, "Does it matter for SSO teams?");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  typeInComposer(pane, "And for guests?");
  await act(async () => lands[0]?.(false));
  await settle();
  assert.deepEqual(threadOf(pane.ownerDocument.body).at(-1), [
    "message",
    "person",
    "You",
    "Does it matter for SSO teams?",
  ]);
  assert.equal(composerEditor(pane).textContent, "And for guests?", "a reply landing keeps them");

  pressInComposer(pane, "Enter");
  await settle();
  typeInComposer(pane, "Never mind.");
  await act(async () => lands[1]?.(true));
  await settle();
  assert.equal(
    composerEditor(pane).textContent,
    "Never mind.",
    "a refusal puts nothing back over them",
  );
});

test("words written on a reply's settled box while the reply carrying the ask's answer is out stay in the box, beside the answer, once the reply is refused and the ask stands open again", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const refuse: (() => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_MESSAGE) return previous(request);
      return new Promise((resolve) =>
        refuse.push(() =>
          resolve({
            status: FAKE_ANSWER.DONE,
            value: { failure: CODING_AGENT_CALL_FAILURE.NOT_PERMITTED },
          }),
        ),
      );
    },
  });

  act(() => openOptions(pane)[1]?.click());
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();
  typeInComposer(pane, "One more detail");
  await settle();
  await act(async () => refuse[0]?.());
  await settle();

  assert.equal(askMarker(pane), null);
  assert.equal(composerEditor(pane).textContent, "One more detail");
  assert.deepEqual(checkedOptions(pane), ["7 days"]);
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
});
