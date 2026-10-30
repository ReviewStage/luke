// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_CALL_FAILURE,
  type AgentInboxAnsweredView,
  INBOX_SCOPE_KIND,
} from "@luke/features/agent-view";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxAsk,
  type InboxItem,
  type InboxMessage,
  inboxReadAskSchema,
} from "@luke/features/inbox-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { ACT_KIND } from "@luke/host/acts";
import { Effect, Schema } from "effect";
import { act } from "react";
import { beforeAll, test } from "vitest";
import { appBridge } from "../app-bridge.js";
import { sideBundles } from "../bundle-loader.js";
import { planEditor } from "../plan-editor/index.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeActsAnswer,
} from "../testing/app-bridge.js";
import {
  composerEditor,
  editorBundleLanded,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import {
  ACME,
  ASKING_ID,
  answeredBy,
  answerSend,
  answerWithNote,
  askBoxes,
  askIdOf,
  asking,
  askingMessage,
  askMarker,
  askPress,
  BILLING,
  boxParts,
  checkedOptions,
  confirmClose,
  draftReply,
  EXPIRY,
  EXPIRY_ASK,
  faceKind,
  foldedCounts,
  footWords,
  GROUPING_KEY,
  gatedAnswers,
  heldMessages,
  hoveredCard,
  INVITES,
  item,
  itemPane,
  keyOn,
  listed,
  menuItem,
  menuWords,
  mount,
  mountThread,
  needsYouMark,
  noticeOf,
  ON_EXPIRY,
  ON_THRESHOLD,
  openOptions,
  pressKey,
  pushAgain,
  READER,
  RETRY,
  readTitle,
  repliedOn,
  rowDrafted,
  rowLines,
  rowMenu,
  rowNamed,
  SHOW_KEY,
  SORT_KEY,
  sendHeld,
  sendWords,
  settle,
  standKeymap,
  subjectOf,
  subjectParts,
  TEAMMATE,
  THRESHOLD,
  takenCloses,
  threadItem,
  threadMessage,
  wordsOf,
  world,
  writtenOn,
} from "../testing/desktop-inbox.js";
import { restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { readSegmented, segment, segmentedGroup } from "../testing/segmented.js";

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

// The parser an answer's note is drawn through, landed as the panel lands it.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

/** Whether the row of the item so titled is drawn gray, its item done with. */
function rowMuted(page: HTMLElement, title: string): boolean {
  return rowNamed(page, title).closest("li")?.getAttribute("data-muted") === "true";
}

/** The shown settled item's question filled in as answered, its controls standing read-only. */
function answeredControls(page: HTMLElement): HTMLElement {
  return (
    page.querySelector<HTMLElement>(".inbox-view-items:not([hidden]) [data-inbox-answered]") ??
    assert.fail("the question stands filled in as answered")
  );
}

/** Each option of the shown settled item's question, by its label, and whether the answer picked it. */
function answeredOptions(page: HTMLElement): [string | null | undefined, boolean][] {
  return [
    ...answeredControls(page).querySelectorAll<HTMLButtonElement>(
      '[role="radio"], [role="checkbox"]',
    ),
  ].map((option) => [
    option.querySelector(".luke-choice-label")?.textContent,
    option.getAttribute("aria-checked") === "true",
  ]);
}

/** The picks the shown item's answer carries, as its question draws them checked. */
function answeredPicks(page: HTMLElement): (string | null | undefined)[] {
  return answeredOptions(page)
    .filter(([, picked]) => picked)
    .map(([label]) => label);
}

/** A waiting item's options as a reader meets them: each row's words, its label, its Recommended badge where it wears one, and its detail. */
function optionHeads(page: HTMLElement): (string | null)[] {
  const pane = page.querySelector<HTMLElement>(".inbox-view-items");
  assert.ok(pane, "the pane is drawn");
  return openOptions(pane).map((each) => wordsOf(each));
}

test("an open item's ⋯ menu in the pane's bar, and the × on its question's card, offer Resolve without answering, the menu beside Mark as read or unread and Copy link, which asks first and then settles it at the revision drawn, the thread saying who resolved it; a settled item's menu offers Copy link alone", async () => {
  world.listedWorkspace = ACME;
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const sent = takenCloses();
  const ellipsis = () =>
    itemPane(page).querySelector<HTMLButtonElement>(
      '.luke-toolbar button[aria-label="Inbox item actions"]',
    ) ?? assert.fail("the pane's bar ends in its ⋯ menu");

  act(() => ellipsis().click());
  assert.deepEqual(menuWords(), [
    "Copy link",
    "—",
    "Mark as unreadU",
    "—",
    "Resolve without answering",
  ]);
  act(() => menuItem("Mark as unread").click());
  await settle();
  assert.ok(world.readMarks.includes(`unread:${THRESHOLD.id}`), "the menu marks the item unread");
  const questionClose =
    itemPane(page).querySelector<HTMLButtonElement>(
      '[data-inbox-draft-ask] button[aria-label="Resolve without answering"]',
    ) ?? assert.fail("the open question's card offers its ×");
  act(() => questionClose.click());
  await settle();
  assert.ok(document.querySelector('[role="alertdialog"]'), "the × asks first");
  act(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await settle();
  act(() => ellipsis().click());
  act(() => menuItem("Resolve without answering").click());
  await settle();
  assert.deepEqual(sent, [], "Close asks first");
  await confirmClose();

  assert.deepEqual(sent, [{ itemId: THRESHOLD.id, revision: THRESHOLD.revision }]);
  assert.equal(
    wordsOf(itemPane(page).querySelector('[data-inbox-comment="closed"] .luke-comment-name')),
    "You resolved this without an answer",
    "the thread says the reader resolved it, in a line of its own",
  );
  act(() => ellipsis().click());
  assert.deepEqual(
    menuWords(),
    ["Copy link", "—", "Mark as unreadU"],
    "a settled item offers no Close",
  );
});

test("an open item's row offers Resolve without answering last in its menu, asking first; a settled item's row offers none", async () => {
  const { page } = mount();
  await settle();
  const sent = takenCloses();
  const threshold = "Alert at 80%?";
  const retry = "How is a failed email retried?";
  assert.ok(
    !rowMenu(page, retry).includes("Resolve without answering"),
    "a settled row offers no Close",
  );
  act(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );

  assert.deepEqual(rowMenu(page, threshold).slice(-2), ["—", "Resolve without answering"]);
  act(() => menuItem("Resolve without answering").click());
  await settle();
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("Close asks first");
  const cancel = [...question.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Cancel",
  );
  act(() => cancel?.click());
  await settle();
  assert.deepEqual(sent, [], "Cancel closes nothing");

  rowMenu(page, threshold);
  act(() => menuItem("Resolve without answering").click());
  await settle();
  await confirmClose();
  assert.deepEqual(sent, [{ itemId: THRESHOLD.id, revision: THRESHOLD.revision }]);
  assert.ok(
    !rowMenu(page, threshold).includes("Resolve without answering"),
    "the closed row offers Close no longer",
  );
});

test("a close taken lets go of the item's draft, though another item is chosen", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  typeInComposer(itemPane(page), "Use 90% instead");
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(rowDrafted(page, "Alert at 80%?"), true);
  takenCloses();

  act(() =>
    rowNamed(page, "Alert at 80%?").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    ),
  );
  act(() => menuItem("Resolve without answering").click());
  await settle();
  await confirmClose();

  assert.equal(rowDrafted(page, "Alert at 80%?"), false, "the closed item's draft is let go");
});

test("an item gone from under its open box, as a teammate's delete takes it, lets go of its draft", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  typeInComposer(itemPane(page), "Use 90% instead");
  await settle();

  world.inboxes.set(BILLING.id, [RETRY]);
  act(() => pushAgain());
  await settle();
  // Note that the item standing again shows what was kept of its draft, since its row and its box went with it.
  world.inboxes.set(BILLING.id, [THRESHOLD, RETRY]);
  act(() => pushAgain());
  await settle();

  assert.equal(composerEditor(itemPane(page)).textContent, "", "the gone item's draft is let go");
});

test("an answer box whose editor bundle could not be loaded says so beside Retry, and Retry mounts the editor once the bundle lands", async () => {
  // Note that the chunk fails the first time it is asked for and lands the next, as a connection that dropped for a moment does.
  let failed = false;
  const bundles = sideBundles({
    planEditor: () => {
      if (failed) return Promise.resolve(planEditor);
      failed = true;
      return Promise.reject(new Error("The chunk could not be loaded."));
    },
  });
  const { page } = mount([], { chosen: ON_THRESHOLD, bundles });
  await settle();
  const note = page.querySelector(".luke-composer-foot-note");
  assert.equal(note?.textContent, "The answer box could not be loaded.Retry");

  await act(async () => note?.querySelector("button")?.click());
  await settle();

  assert.equal(page.querySelector(".luke-composer-foot-note"), null, "the note is gone");
});

test("a waiting choice wears a Recommended badge at the head of the option its agent recommends and of no other, and a choice recommending nothing wears none", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  assert.deepEqual(optionHeads(page), [
    "Retry 3 times over an hourRecommended1Backs off 5, 15, then 40 minutes.",
    "Retry once2",
  ]);

  act(() => world.root?.unmount());
  world.root = undefined;
  const ask: InboxAsk = {
    type: INBOX_ASK.DECIDE,
    options: [{ label: "Retry 3 times over an hour" }, { label: "Retry once" }],
  };
  world.inboxes.set(BILLING.id, [asking(THRESHOLD, ask), RETRY]);
  const again = mount([], { chosen: ON_THRESHOLD });
  await settle();
  assert.deepEqual(optionHeads(again.page), ["Retry 3 times over an hour1", "Retry once2"]);
});

test("a waiting choice of one is a radio list, each option led by its radio and numbered at its right: a number key picks its option from the list's row and takes the keyboard there, Space picks the focused one, a number typed in the box picks nothing, and J still steps the list", async () => {
  const keys = standKeymap();
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const pane = itemPane(page);
  assert.deepEqual(
    openOptions(pane).map((option) => [
      option.getAttribute("role"),
      option.querySelector(".luke-choice-control")?.getAttribute("data-shape"),
      option.getAttribute("aria-keyshortcuts"),
    ]),
    [
      ["radio", "radio", "1"],
      ["radio", "radio", "2"],
    ],
  );

  const row = rowNamed(page, "Alert at 80%?");
  act(() => row.focus());
  pressKey("2", row);
  assert.deepEqual(checkedOptions(pane), ["Retry once"]);
  assert.equal(document.activeElement, openOptions(pane)[1], "the keyboard follows the pick");

  const first = openOptions(pane)[0] ?? assert.fail("no first option");
  act(() => first.focus());
  keyOn(first, " ");
  assert.deepEqual(checkedOptions(pane), ["Retry 3 times over an hour"]);

  composerEditor(pane).focus();
  pressKey("2", composerEditor(pane));
  assert.deepEqual(
    checkedOptions(pane),
    ["Retry 3 times over an hour"],
    "typing a number picks none",
  );

  act(() => first.focus());
  pressKey("j", first);
  assert.equal(readTitle(page), "Expire after 7 days?");
  act(() => keys.unmount());
});

test("Enter on a focused option sends the reply carrying the pick and never presses the option; with nothing picked, Send stands held, and Enter sends nothing and says an option is missing", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const sent = heldMessages(repliedOn(THRESHOLD, "c1b2c3d4-0000-4000-8000-000000000090"));
  const pane = itemPane(page);

  assert.equal(footWords(pane), "", "the box says nothing of what is missing before a send");
  assert.equal(sendHeld(pane), true, "Send stands held");
  assert.deepEqual(
    boxParts(pane),
    ["controls", "line: Add a note", "row: Attach files, Dictate, Send"],
    "the note line stands on its own under the options, over the row of presses",
  );
  keyOn(openOptions(pane)[0] ?? assert.fail("no option"), "Enter");
  await settle();
  assert.deepEqual(sent, [], "a reply holding nothing goes nowhere");
  assert.deepEqual(checkedOptions(pane), [], "and Enter picked nothing");
  assert.equal(footWords(pane), "Pick an option.");

  const once = openOptions(pane)[1] ?? assert.fail("no second option");
  act(() => once.click());
  assert.equal(answerSend(pane).disabled, false, "the pick lights Send");
  keyOn(once, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [{ ask: askIdOf(THRESHOLD.id), reply: INBOX_REPLY.CHOSE, choices: ["Retry once"] }],
  );
  // The answer stands at once, as sent: the pick Enter was on, never pressed off.
  assert.deepEqual(answeredPicks(page), ["Retry once"], "Enter left the pick standing");
});

test("a waiting choice of several is a checkbox list whose box counts nothing on its foot: the arrows move along it picking nothing, a number key toggles its option, and Enter on a picked option sends every pick and lets none go", async () => {
  const several = asking(THRESHOLD, {
    type: INBOX_ASK.DECIDE,
    multiple: true,
    options: [{ label: "Email" }, { label: "Slack" }, { label: "Pager" }],
  });
  world.inboxes.set(BILLING.id, [several, RETRY]);
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const sent = heldMessages(repliedOn(several, "c1b2c3d4-0000-4000-8000-000000000091"));
  const pane = itemPane(page);
  const boxes = () => openOptions(pane);
  assert.deepEqual(
    boxes().map((box) => box.querySelector(".luke-choice-control")?.getAttribute("data-shape")),
    ["box", "box", "box"],
  );
  assert.equal(footWords(pane), "", "the foot says nothing of how many may be picked");
  assert.equal(pane.textContent?.includes("Pick any that apply"), false, "no line under the list");

  const email = boxes()[0] ?? assert.fail("no Email");
  act(() => email.focus());
  keyOn(email, "ArrowDown");
  assert.equal(document.activeElement, boxes()[1]);
  keyOn(boxes()[1] ?? assert.fail("no Slack"), "ArrowUp");
  keyOn(email, "ArrowUp");
  assert.equal(document.activeElement, boxes()[2], "the arrows wrap");
  assert.deepEqual(checkedOptions(pane), [], "and pick nothing");

  pressKey("3", document.activeElement ?? document.body);
  pressKey("1", document.activeElement ?? document.body);
  pressKey("2", document.activeElement ?? document.body);
  pressKey("2", document.activeElement ?? document.body);
  assert.deepEqual(checkedOptions(pane), ["Email", "Pager"]);
  assert.equal(footWords(pane), "", "nor how many are");

  keyOn(email, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [{ ask: askIdOf(THRESHOLD.id), reply: INBOX_REPLY.CHOSE, choices: ["Pager", "Email"] }],
  );
  // The answer stands at once, as sent: every pick, Enter's own among them.
  assert.deepEqual(answeredPicks(page), ["Email", "Pager"], "Enter let no pick go");
});

test("Enter anywhere in a form of several fields, in its number field or its text field's composer, sends what is filled, a required field left empty absent from it; with nothing filled it sends nothing, takes the keyboard to the first required field, and names it until something is filled; Shift+Enter in a text field is a new line, an @ there picks a mention written in as its link, and an input method's Enter sends nothing", async () => {
  const form = asking(EXPIRY, {
    type: INBOX_ASK.ANSWER,
    fields: [
      { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
      { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
      { type: INBOX_FIELD.NUMBER, label: "Retries" },
      { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
    ],
  });
  world.inboxes.set(INVITES.id, [form]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  const sent = heldMessages(repliedOn(form, "c1b2c3d4-0000-4000-8000-000000000092"));
  const pane = itemPane(page);
  const field = (label: string) =>
    [...pane.querySelectorAll<HTMLElement>("[data-inbox-field]")].find(
      (each) => each.dataset.inboxFieldLabel === label,
    ) ?? assert.fail(`no ${label} field`);
  const retries = field("Retries").querySelector("input") ?? assert.fail("no Retries input");

  act(() => retries.focus());
  keyOn(retries, "Enter");
  await settle();
  assert.deepEqual(sent, []);
  assert.equal(footWords(pane), "Fill in Severity.");
  assert.equal(
    field("Severity").contains(document.activeElement),
    true,
    "the keyboard is taken to the field missing",
  );

  // Note that the composer types each newline as Shift+Enter, so the line in the value sent is Shift+Enter's.
  typeInComposer(field("Reason"), "Spiked twice\nSee @roll");
  await settle();
  assert.equal(footWords(pane), "", "a field filled lets the line go");
  pressInComposer(field("Reason"), "Enter");
  await settle();
  assert.deepEqual(sent, [], "the first Enter picks the mention");
  pressInComposer(field("Reason"), "Enter", { isComposing: true, keyCode: 229 });
  await settle();
  assert.deepEqual(sent, [], "an input method's Enter finishes its words and sends nothing");
  pressInComposer(field("Reason"), "Enter");
  await settle();
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [
      {
        ask: askIdOf(EXPIRY.id),
        reply: INBOX_REPLY.SUBMITTED,
        values: [
          { label: "Reason", value: `Spiked twice\nSee ${file}` },
          { label: "Page on-call", value: false },
        ],
      },
    ],
  );
});

test("in a form of three fields Enter on a focused option sends the form and picks nothing, an input method's Enter sends nothing, and Send names no chord", async () => {
  const form = asking(EXPIRY, {
    type: INBOX_ASK.ANSWER,
    fields: [
      { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
      { type: INBOX_FIELD.NUMBER, label: "Retries" },
      { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
    ],
  });
  world.inboxes.set(INVITES.id, [form]);
  const { page } = mount();
  await settle();
  const sent = heldMessages(repliedOn(form, "c1b2c3d4-0000-4000-8000-000000000093"));
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  const pane = itemPane(page);
  const option = (label: string) =>
    [...pane.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((each) =>
      each.textContent?.includes(label),
    ) ?? assert.fail(`no ${label} option`);
  assert.equal(answerSend(pane).hasAttribute("aria-keyshortcuts"), false);

  act(() => option("High").click());
  const retries =
    pane.querySelector<HTMLInputElement>('[data-inbox-field-label="Retries"] input') ??
    assert.fail("no Retries input");
  act(() => retries.focus());
  // Note that Safari's last composing key comes as code 229 with isComposing already false.
  keyOn(retries, "Enter", { keyCode: 229 });
  await settle();
  assert.deepEqual(sent, [], "an input method's Enter sends nothing");
  const low = option("Low");
  act(() => low.focus());
  keyOn(low, "Enter");
  await settle();
  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [
      {
        ask: askIdOf(EXPIRY.id),
        reply: INBOX_REPLY.SUBMITTED,
        values: [
          { label: "Severity", value: "High" },
          { label: "Page on-call", value: false },
        ],
      },
    ],
  );
});

test("a settled choice whose pick is not the one recommended marks each apart: the pick checked, and the recommended option by its badge", async () => {
  world.inboxes.set(BILLING.id, [
    THRESHOLD,
    answeredBy(item(RETRY.id, RETRY.title, 5_000), READER, "Retry once", "", 5_000),
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  assert.deepEqual(answeredOptions(page), [
    ["Retry 3 times over an hour", false],
    ["Retry once", true],
  ]);
  assert.deepEqual(
    [...answeredControls(page).querySelectorAll('[role="radio"]')].map((row) => wordsOf(row)),
    ["Retry 3 times over an hourRecommendedBacks off 5, 15, then 40 minutes.", "Retry once"],
  );
});

test("a teammate's answer names them by their disc and name, their pick checked in the card heading their reply, and their name hangs their card", async () => {
  const CHARLES = { userId: "user-charles", name: "Charles Pan" };
  world.inboxes.set(BILLING.id, [
    THRESHOLD,
    answeredBy(
      item(RETRY.id, RETRY.title, 5_000),
      CHARLES,
      "Retry 3 times over an hour",
      "And page on-call if all three fail.",
      5_000,
    ),
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();

  assert.deepEqual(answeredPicks(page), ["Retry 3 times over an hour"]);
  const reply =
    answeredControls(page).closest<HTMLElement>(".inbox-comment") ?? assert.fail("their answer");
  assert.match(wordsOf(reply.querySelector(".luke-comment-head")) ?? "", /^Charles Pan/u);
  assert.equal(faceKind(reply.querySelector(".luke-comment-face")), "person");

  const answerer = reply.querySelector("[data-actor-ref]") ?? assert.fail("the answerer is named");
  restOn(answerer);
  const card = document.querySelector(".luke-tooltip-card [data-actor-card='person']");
  assert.match(card?.textContent ?? "", /Charles Pan/u);
});

test("a form stacks its fields, each its name over its control, \"Optional\" after the name of one that may be left empty and \"Required\" nowhere: a select's options are pills, any one's pick taken back by pressing it again, a required one's too since a field left empty sends without it, a yes-or-no a checkbox beside its name, a number a short field, and a text field the composer's own field", async () => {
  world.inboxes.set(INVITES.id, [
    asking(EXPIRY, {
      type: INBOX_ASK.ANSWER,
      fields: [
        { type: INBOX_FIELD.SELECT, label: "Channel", options: ["Email", "Slack"] },
        { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
        { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
        { type: INBOX_FIELD.NUMBER, label: "Retries" },
        { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
      ],
    }),
  ]);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  const pane = itemPane(page);
  const channel = () => segmentedGroup(pane, "Channel");
  const severity = () => segmentedGroup(pane, "Severity");
  const onCall = () =>
    pane.querySelector<HTMLElement>('[data-inbox-field="boolean"] [role="checkbox"]') ??
    assert.fail("no Page on-call checkbox");
  const unpicked = readSegmented(channel());
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.equal(askMarker(pane), null);

  act(() => segment(channel(), "Slack").click());
  act(() => segment(severity(), "High").click());
  const picked = [readSegmented(channel()).checked, readSegmented(severity()).checked];
  act(() => segment(channel(), "Slack").click());
  act(() => segment(severity(), "High").click());
  act(() => onCall().click());

  assert.deepEqual(
    [...pane.querySelectorAll("[data-inbox-field]")].map((each) => [
      each.getAttribute("data-inbox-field"),
      each
        .querySelector(".luke-field-label, .luke-checkbox-words")
        ?.textContent?.endsWith("Optional") === true,
    ]),
    [
      ["select", true],
      ["select", false],
      ["boolean", true],
      ["number", true],
      ["text", false],
    ],
  );
  assert.equal(pane.textContent?.includes("Required"), false);
  assert.equal(channel().dataset.look, "pill");
  assert.deepEqual(unpicked, { options: ["Email", "Slack"], checked: [], tabStops: ["Email"] });
  assert.deepEqual(picked, [["Slack"], ["High"]]);
  assert.deepEqual(readSegmented(channel()).checked, [], "the optional pick is taken back");
  assert.deepEqual(readSegmented(severity()).checked, [], "the required pick is taken back too");
  assert.equal(onCall().getAttribute("aria-checked"), "true");
  assert.ok(pane.querySelector('[data-inbox-field="number"] .inbox-field-short input'));
  assert.ok(pane.querySelector('[data-inbox-field="text"] .inbox-field-composer .composer-editor'));
  const reason =
    pane.querySelector<HTMLElement>('[data-inbox-field="text"]') ?? assert.fail("no Reason");
  act(() => reason.querySelector<HTMLElement>(".luke-field-label")?.click());
  assert.equal(
    document.activeElement,
    composerEditor(reason),
    "a press on its name takes the caret in",
  );
  assert.equal(
    document.getElementById(composerEditor(reason).getAttribute("aria-labelledby") ?? "")
      ?.textContent,
    "Reason",
  );
});

/**
 * Each field of a form filled in as answered, in order: its kind, its name,
 * and what it holds as a reader meets it, a select's pick, a text field's
 * words, a number's figure, and a yes or no checked or not; each control
 * stands read-only.
 */
function answeredFields(within: Element): (string | null | undefined)[][] {
  return [...within.querySelectorAll<HTMLElement>("[data-inbox-answered-field]")].map((field) => {
    const kind = field.dataset.inboxAnsweredField;
    const name = field.querySelector(".luke-field-label, .luke-checkbox-words")?.firstChild
      ?.textContent;
    const box = field.querySelector<HTMLElement>('[role="checkbox"]');
    const words = field.querySelector('[role="textbox"]');
    const pills = field.querySelector<HTMLElement>(".luke-choice-list");
    if (box !== null) {
      assert.equal(box.getAttribute("aria-readonly"), "true");
      return [kind, name, box.getAttribute("aria-checked") === "true" ? "checked" : "unchecked"];
    }
    if (pills !== null) {
      assert.equal(pills.dataset.readOnly, "true");
      return [kind, name, pills.querySelector('[aria-checked="true"]')?.textContent];
    }
    assert.equal(words?.getAttribute("aria-readonly"), "true");
    return [kind, name, words?.textContent];
  });
}

/** Threshold as the service answers it once the reader's reply carrying its pick was taken. */
const THRESHOLD_ANSWERED: InboxItem = {
  ...answeredBy(THRESHOLD, READER, "Retry 3 times over an hour", "Use 90%", 6_000),
  updatedAt: 6_000,
};

test("an answer leaves Needs you the moment it is sent, its row staying where it stood and its plan's count dropping with it", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const { sent } = gatedAnswers();
  assert.deepEqual(foldedCounts(page), ["Billing usage alerts1 needs you", "Invites1 needs you"]);

  answerWithNote(page, "Use 90%");
  await settle();
  assert.equal(sent.length, 1, "the answer is on its way, the service not answering yet");
  assert.deepEqual(
    listed(page),
    [
      "# Billing usage alerts",
      "How is a failed email retried?",
      "▸ Alert at 80%?",
      "# Invites",
      "*Expire after 7 days?",
    ],
    "the answered row stays where it stood",
  );
  assert.deepEqual(subjectOf(page), ["Alert at 80%?"]);
  assert.deepEqual(foldedCounts(page), ["Billing usage alerts", "Invites1 needs you"]);
});

/** The list as drawn, each row by its title alone and each group by its name, what marks a row and what a group counts left out, so a row that moves or changes group is told from one that only changes its marks. */
function placesOf(page: HTMLElement): string[] {
  return listed(page).map((line) =>
    line.startsWith("# ") ? line.replace(/\d+ needs? you$/u, "") : line.replace(/^(▸ )?\*?/u, ""),
  );
}

test("on To do, answering the chosen item draws its row gray where it stood, and choosing another row clears it", async () => {
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("to-do"));
  window.localStorage.setItem(GROUPING_KEY, JSON.stringify("newest"));
  const { page } = mount([], { chosen: ON_EXPIRY });
  await settle();
  const { answer } = gatedAnswers();
  assert.deepEqual(listed(page), ["▸ Expire after 7 days?", "Alert at 80%?"]);
  assert.equal(rowMuted(page, "Expire after 7 days?"), false);

  answerWithNote(page, "Keep 7 days");
  await settle();
  await act(async () =>
    answer({
      item: {
        ...answeredBy(EXPIRY, READER, "Retry 3 times over an hour", "Keep 7 days", 6_000),
        updatedAt: 6_000,
      },
    }),
  );
  await settle();
  assert.deepEqual(
    listed(page),
    ["▸ Expire after 7 days?", "Alert at 80%?"],
    "the answered row stays where it stood",
  );
  assert.equal(rowMuted(page, "Expire after 7 days?"), true, "drawn gray");
  assert.equal(rowMuted(page, "Alert at 80%?"), false);

  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.deepEqual(listed(page), ["▸ Alert at 80%?"], "the gray row clears once another is chosen");
});

test("on To do, the chosen row is let go once the Inbox is left, so an item answered while it was hidden is gone when it is come back to", async () => {
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("to-do"));
  window.localStorage.setItem(GROUPING_KEY, JSON.stringify("newest"));
  const { page } = mount([], { chosen: ON_EXPIRY });
  await settle();
  assert.deepEqual(listed(page), ["▸ Expire after 7 days?", "Alert at 80%?"]);

  act(() => world.setInboxOpen(false));
  await settle();
  const answered = {
    ...answeredBy(EXPIRY, TEAMMATE, "Retry once", "Keep 7 days", 6_000),
    updatedAt: 6_000,
  };
  // The invites plan's change is pushed, as an answer from another Mac would be.
  world.main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: INVITES.id }, { items: [answered] });
  await settle();
  act(() => world.setInboxOpen(true));
  await settle();
  assert.deepEqual(
    listed(page),
    ["Alert at 80%?"],
    "the item answered while the Inbox was hidden no longer needs you, so it has no row",
  );
});

// One test per grouping and sort, each mounting the Inbox once, so a loaded shard times a
// quarter-second mount rather than the eight of them together.
const ANSWER_VIEWS = ["plan", "person", "status", "newest"].flatMap((grouping) =>
  ["latest", "oldest"].map((sort) => ({ grouping, sort })),
);

test.for(ANSWER_VIEWS)(
  "an answer moves no row while the list is shown, under $grouping grouping and $sort sort, and the list sorts anew once the Inbox is left and come back to",
  async ({ grouping, sort }) => {
    window.localStorage.setItem(SHOW_KEY, JSON.stringify("all"));
    window.localStorage.setItem(GROUPING_KEY, JSON.stringify(grouping));
    window.localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    const { page } = mount();
    await settle();
    const { answer } = gatedAnswers();
    act(() => rowNamed(page, "Alert at 80%?").click());
    await settle();
    const before = placesOf(page);

    answerWithNote(page, "Use 90%");
    await settle();
    assert.deepEqual(placesOf(page), before, `${grouping}, ${sort}: as the answer is sent`);
    await act(async () => answer({ item: THRESHOLD_ANSWERED }));
    await settle();
    assert.deepEqual(placesOf(page), before, `${grouping}, ${sort}: once it is taken`);

    act(() => world.setInboxOpen(false));
    act(() => world.setInboxOpen(true));
    await settle();
    assert.notDeepEqual(placesOf(page), before, `${grouping}, ${sort}: sorted anew`);
  },
);

test("an answer the service refuses brings its item back as it was, needing you, with its box's words and why it did not go", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const { answer } = gatedAnswers();
  answerWithNote(page, "Use 90%");
  await settle();
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "");

  await act(async () => answer({ failure: AGENT_CALL_FAILURE.UNANSWERED }));
  await settle();
  const pane = itemPane(page);
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "*");
  assert.deepEqual(foldedCounts(page), ["Billing usage alerts1 needs you", "Invites1 needs you"]);
  assert.equal(composerEditor(pane).textContent, "Use 90%", "the box keeps its words");
  assert.ok(
    pane.querySelector('.agent-composer [role="alert"]')?.textContent,
    "the box says why the answer did not go",
  );
});

test("an answer no reply came back for, which its thread then holds, is taken as sent: its box empties and says nothing", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const { answer } = gatedAnswers();
  answerWithNote(page, "Use 90%");
  await settle();
  await act(async () => answer({ failure: AGENT_CALL_FAILURE.UNANSWERED }));
  await settle();
  assert.equal(composerEditor(itemPane(page)).textContent, "Use 90%");

  // The service wrote the answer and handed it on all the same, and the plan's push says so.
  world.main.push(
    { kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id },
    { items: [THRESHOLD_ANSWERED, RETRY] },
  );
  await settle();
  const pane = itemPane(page);
  assert.equal(composerEditor(pane).textContent, "", "the words that went back are let go");
  assert.equal(pane.querySelector('.agent-composer [role="alert"]'), null);
});

test("a nod on a notice the agent posted over first is not taken: the notice stands open again, and the box says so", async () => {
  const notice: InboxItem = { ...noticeOf(THRESHOLD), startedBy: TEAMMATE };
  world.inboxes.set(BILLING.id, [notice, RETRY]);
  const { page } = mount();
  await settle();
  const waiting: ((view: AgentInboxAnsweredView) => void)[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.AGENTS_INBOX_ANSWER) return previous(request);
      return new Promise((resolve) =>
        waiting.push((value) => resolve({ status: FAKE_ANSWER.DONE, value })),
      );
    },
  });
  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.equal(sendWords(itemPane(page)), "Got it");
  await act(async () => answerSend(itemPane(page)).click());
  await settle();

  const asked = { ...notice, revision: 2, title: "Alert at 85%?", updatedAt: 6_000 };
  await act(async () => waiting.shift()?.({ item: asked, taken: false }));
  await settle();
  assert.equal(sendWords(itemPane(page)), "Got it", "the notice stands open, to nod to again");
  assert.equal(
    itemPane(page).querySelector('.agent-composer [role="alert"]')?.textContent,
    "The agent changed this item before your answer landed. Answer it as it stands now.",
  );
});

test("an item its agent posts again after it was answered needs you again once a read holds the newer revision, though the list's older read still stands for it elsewhere", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const { answer } = gatedAnswers();
  answerWithNote(page, "Use 90%");
  await settle();
  await act(async () => answer({ item: THRESHOLD_ANSWERED }));
  await settle();
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "");

  // The agent asks again under the same key, and main says the plan moved.
  world.inboxes.set(BILLING.id, [{ ...THRESHOLD, revision: 2, updatedAt: 7_000 }, RETRY]);
  act(() =>
    world.setHolding([
      { taskId: BILLING.id, items: 2, updatedAt: 7_000 },
      { taskId: INVITES.id, items: 1, updatedAt: 4_000 },
    ]),
  );
  await settle();
  assert.equal(needsYouMark(rowNamed(page, "Alert at 80%?")), "*");
});

test("a message the service took stays the last word on its item's row once another plan's item is chosen, though the list's read of its plan is older than the message", async () => {
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  await settle();
  heldMessages(writtenOn(RETRY, "c1b2c3d4-0000-4000-8000-000000000011"));
  const pane = itemPane(page);
  typeInComposer(pane, "Page on-call at night too.");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();
  const said = "You: Page on-call at night too.";
  assert.equal(rowLines(page, "How is a failed email retried?")[1], said);

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.equal(rowLines(page, "How is a failed email retried?")[1], said);
});

/** The answered ask's controls heading a reply, as a reader hears it: their words alone, standing in the reply's body beside its words with no card around them and no head over them; none where the reply carries none. */
function answeredCard(reply: Element): string | null | undefined {
  const card = reply.querySelector("[data-inbox-answered]");
  if (card === null) return undefined;
  assert.equal(card.closest(".inbox-ask"), null, "no card stands around the controls");
  assert.ok(card.parentElement?.matches(".inbox-comment-body"), "they stand in the reply's body");
  assert.equal(card.querySelector(".luke-card-head"), null, "they have no head");
  return wordsOf(card);
}

test("picking an option in the draft reply stands it picked and lights Send, the box saying nothing, and pressing it again takes it off; sent, the reply drops into the thread as the reader's comment leading with the answered card, and the draft stands plain at the end again", async () => {
  const shown = threadItem([askingMessage(EXPIRY_ASK)]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000011"));

  act(() => openOptions(pane)[1]?.click());
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  assert.equal(sendWords(pane), "Send");
  assert.equal(pane.querySelector("[data-inbox-attached]"), null, "no stamp stands over the note");

  act(() => openOptions(pane)[1]?.click());
  assert.deepEqual(checkedOptions(pane), [], "pressed again, the pick is let go");
  assert.equal(sendHeld(pane), true, "and Send stands held again");
  assert.equal(footWords(pane), "", "nothing says the ask stays open");

  // The number keys still pick, from wherever in the Inbox the reader stands.
  keyOn(document.body, "2");
  assert.deepEqual(checkedOptions(pane), ["7 days"]);
  typeInComposer(pane, "Most teams asked for it.");
  await settle();
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();

  assert.deepEqual(
    sent.map(({ text, answers }) => ({ text, answers })),
    [
      {
        text: "Most teams asked for it.",
        answers: { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["7 days"] },
      },
    ],
  );
  const [asked, reply] = pane.querySelectorAll(".inbox-thread > li");
  assert.ok(reply, "the reply lands");
  assert.equal(answeredCard(reply), "1 dayAs today.7 daysRecommendedWhat most teams use.30 days");
  assert.deepEqual(
    [...reply.querySelectorAll('[role="radio"][aria-checked="true"] .luke-choice-label')].map(
      (label) => label.textContent,
    ),
    ["7 days"],
    "its pick says how it was answered",
  );
  assert.equal(reply.querySelector("[data-inbox-stamp]"), null, "the card marks the answer");
  assert.equal(asked?.querySelector(".inbox-ask"), null, "the ask's card left the agent's message");
  assert.equal(askMarker(pane), null, "and its marker");
  assert.deepEqual(askBoxes(pane), []);
  assert.deepEqual(subjectParts(pane), ["How long should invites last?"]);
  assert.deepEqual(draftReply(pane), ["You"], "the draft stands at the end, plain");
  assert.equal(composerEditor(pane).getAttribute("aria-label"), "Reply");
  assert.deepEqual(boxParts(pane), ["line: Reply", "row: Attach files, Dictate, Send"]);
});

test("an approve-or-request-changes ask is two small buttons in the draft reply, the one the agent recommends saying so: the one pressed stands pressed, pressed again it is let go, and the reply sent with words carries it, stamped as requested changes", async () => {
  const shown = threadItem([
    askingMessage({
      type: INBOX_ASK.DECIDE,
      options: [{ label: "Approve" }, { label: "Request changes" }],
      recommended: "Approve",
    }),
  ]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000012"));
  assert.deepEqual(openOptions(pane), [], "no radio list stands for a yes or no");
  assert.deepEqual(
    [askPress(pane, "Approve").textContent, askPress(pane, "Request changes").textContent],
    ["ApproveRecommended", "Request changes"],
    "the recommended press wears its badge",
  );

  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  act(() => askPress(pane, "Approve").click());
  act(() => askPress(pane, "Approve").click());
  assert.equal(askPress(pane, "Approve").getAttribute("aria-pressed"), "false", "let go");
  act(() => askPress(pane, "Request changes").click());
  assert.equal(askPress(pane, "Request changes").getAttribute("aria-pressed"), "true");
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  assert.equal(sendWords(pane), "Send");
  typeInComposer(pane, "The banner overlaps the header.");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ text, answers }) => ({ text, answers })),
    [
      {
        text: "The banner overlaps the header.",
        answers: { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["Request changes"] },
      },
    ],
  );
  const reply =
    pane.querySelector(".inbox-thread > li:nth-last-child(2)") ?? assert.fail("the reply");
  assert.equal(answeredCard(reply), "ApproveRecommendedRequest changes");
  assert.equal(
    reply.querySelector('[aria-pressed="true"] .inbox-ask-pressed[data-tone="neutral"]')
      ?.parentElement?.textContent,
    "Request changes",
    "the press given says how it was answered",
  );
  assert.deepEqual(askBoxes(pane), []);
});

test("an ask of words alone is a plain box with no controls, its line asking for a Reply and its Send held until words are in; the words sent answer it, and the agent's message then says it was answered", async () => {
  const shown = threadItem([askingMessage({ type: INBOX_ASK.ANSWER })]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000015"));
  assert.deepEqual(draftReply(pane), ["You"], "no controls stand in the box");
  assert.equal(pane.querySelector("[data-inbox-draft-ask]"), null, "and no Answer press");
  assert.deepEqual(boxParts(pane), ["line: Reply", "row: Attach files, Dictate, Send"]);
  assert.equal(sendHeld(pane), true, "an empty box sends nothing");
  assert.equal(footWords(pane), "");

  typeInComposer(pane, "Nothing needs you right now.");
  assert.equal(answerSend(pane).disabled, false, "words light Send");
  composerEditor(pane).focus();
  pressInComposer(pane, "Enter");
  await settle();

  assert.deepEqual(
    sent.map(({ text, answers }) => ({ text, answers })),
    [
      {
        text: "Nothing needs you right now.",
        answers: { ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED },
      },
    ],
  );
  assert.equal(askMarker(pane), null, "the ask waits no more");
  assert.equal(
    wordsOf(pane.querySelector(`[data-message-id="${ASKING_ID}"] [data-inbox-settled]`)),
    "Answered",
  );
  assert.deepEqual(draftReply(pane), ["You"]);
});

test("a form's fields attach to the reply as they are filled, with no Submit, and a form filled in part sends what was filled, a required field left empty absent from it", async () => {
  const shown = threadItem([
    askingMessage({
      type: INBOX_ASK.ANSWER,
      fields: [
        { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
        { type: INBOX_FIELD.SELECT, label: "Severity", required: true, options: ["Low", "High"] },
      ],
    }),
  ]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000013"));
  assert.deepEqual(
    [...pane.querySelectorAll("[data-inbox-draft-ask] .inbox-ask-fields button")].map(
      (button) => button.textContent,
    ),
    ["Low", "High"],
    "the draft's box holds the ask's fields and no Submit",
  );
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.deepEqual(
    boxParts(pane),
    ["controls", "line: Add a note", "row: Attach files, Dictate, Send"],
    "the note line stands on its own under the form, over the row of presses",
  );
  assert.equal(sendWords(pane), "Send");

  const reason =
    [...pane.querySelectorAll<HTMLElement>("[data-inbox-field]")].find(
      (each) => each.dataset.inboxFieldLabel === "Reason",
    ) ?? assert.fail("no Reason field");
  typeInComposer(reason, "Spiked twice");
  await settle();
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  assert.equal(sendWords(pane), "Send");
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();

  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [
      {
        ask: ASKING_ID,
        reply: INBOX_REPLY.SUBMITTED,
        values: [{ label: "Reason", value: "Spiked twice" }],
      },
    ],
  );
});

test("a thread's form ask wears the Recommended badge on the option its select recommends and on no other, and picks nothing for the developer", async () => {
  const pane = await mountThread(
    threadItem([
      askingMessage({
        type: INBOX_ASK.ANSWER,
        fields: [
          {
            type: INBOX_FIELD.SELECT,
            label: "Channel",
            options: ["Email", "Slack"],
            recommended: "Slack",
          },
          { type: INBOX_FIELD.SELECT, label: "Severity", options: ["Low", "High"] },
        ],
      }),
    ]),
  );
  assert.deepEqual(readSegmented(segmentedGroup(pane, "Channel")), {
    options: ["Email", "SlackRecommended"],
    checked: [],
    tabStops: ["Email"],
  });
  assert.deepEqual(readSegmented(segmentedGroup(pane, "Severity")).options, ["Low", "High"]);
});

test("a to-do's steps are ticked in the draft reply, Mark done needs none ticked and ticks every one, either press pressed again is let go, and Mark done sent carries every step; one naming no step stands its item's title as its one step", async () => {
  const shown = threadItem([
    askingMessage({
      type: INBOX_ASK.DO,
      steps: ["Open the repository's settings", "Add the secret"],
    }),
  ]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000013"));
  const steps = () => [...pane.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")];
  assert.equal(askPress(pane, "Mark done").disabled, false, "Mark done waits for no tick");
  assert.equal(askMarker(pane), null);
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  assert.equal(sendHeld(pane), true, "nothing ticked, nothing to send");

  act(() => steps()[0]?.click());
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  act(() => askPress(pane, "Mark done").click());
  assert.deepEqual(
    steps().map((step) => step.checked),
    [true, true],
    "Mark done ticks the step left unticked",
  );
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
  act(() => askPress(pane, "Couldn't do it").click());
  assert.deepEqual(
    steps().map((step) => step.checked),
    [true, false],
    "Couldn't do it after Mark done keeps only the step ticked by hand",
  );
  act(() => askPress(pane, "Couldn't do it").click());
  assert.equal(askPress(pane, "Couldn't do it").getAttribute("aria-pressed"), "false");
  assert.equal(
    answerSend(pane).disabled,
    false,
    "pressed again, it is let go, the step ticked still sent",
  );
  act(() => askPress(pane, "Mark done").click());
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
  assert.equal(sendWords(pane), "Send");
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();

  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [{ ask: ASKING_ID, reply: INBOX_REPLY.DONE, steps: [0, 1] }],
  );
  const reply =
    pane.querySelector(".inbox-thread > li:nth-last-child(2)") ?? assert.fail("the reply");
  assert.equal(
    answeredCard(reply),
    "Open the repository's settingsAdd the secretMark doneCouldn't do it",
  );
  assert.deepEqual(
    answeredPresses(
      reply.querySelector<HTMLElement>("[data-inbox-answered]") ?? assert.fail("the card"),
    ),
    [
      ["Mark done", true, "complete"],
      ["Couldn't do it", false, undefined],
    ],
  );

  act(() => world.root?.unmount());
  world.root = undefined;
  const legacy = await mountThread(threadItem([askingMessage({ type: INBOX_ASK.DO, steps: [] })]));
  assert.deepEqual(
    [...legacy.querySelectorAll("[data-inbox-step]")].map((step) => step.textContent),
    ["How long should invites last?"],
  );
});

test("a to-do's step draws its Markdown in its box's words: bold as strong words, not asterisks", async () => {
  const pane = await mountThread(
    threadItem([askingMessage({ type: INBOX_ASK.DO, steps: ["Open the **Domains** page"] })]),
  );
  const step = pane.querySelector("[data-inbox-step]") ?? assert.fail("the step");
  assert.equal(step.textContent, "Open the Domains page");
  assert.equal(step.querySelector("strong")?.textContent, "Domains");
});

test("Enter on a to-do step's link is the link's own, sending no reply", async () => {
  const pane = await mountThread(
    threadItem([
      askingMessage({ type: INBOX_ASK.DO, steps: ["Read [the guide](https://example.com/guide)"] }),
    ]),
  );
  act(() => pane.querySelector<HTMLInputElement>("[data-inbox-step] input")?.click());
  const link = pane.querySelector("[data-inbox-step] a") ?? assert.fail("the step's link");
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  act(() => link.dispatchEvent(enter));
  assert.equal(enter.defaultPrevented, false, "the link opens on its Enter");
});

test("a to-do with every step ticked by hand stands marked done and Send sends it so, letting a step go takes that back off, and steps ticked with neither press go as they stand", async () => {
  const toDo = { type: INBOX_ASK.DO, steps: ["Open the repository's settings", "Add the secret"] };
  const shown = threadItem([askingMessage(toDo)]);
  const pane = await mountThread(shown);
  const sent = heldMessages(repliedOn(shown, "e1b2c3d4-0000-4000-8000-000000000013"));
  const steps = () => [...pane.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")];
  const markDone = () => askPress(pane, "Mark done").getAttribute("aria-pressed");

  act(() => steps()[0]?.click());
  act(() => steps()[1]?.click());
  assert.equal(markDone(), "true", "every step ticked stands as Mark done");
  assert.equal(answerSend(pane).disabled, false, "the reply carries the answer");
  act(() => steps()[1]?.click());
  assert.equal(markDone(), "false", "letting a step go takes Mark done back off");
  assert.equal(answerSend(pane).disabled, false, "the step still ticked goes with the reply");
  act(() => steps()[0]?.click());
  assert.equal(sendHeld(pane), true, "nothing ticked, nothing to send");
  assert.equal(footWords(pane), "");
  act(() => steps()[0]?.click());
  act(() => steps()[1]?.click());
  act(() =>
    pane.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();
  assert.deepEqual(
    sent.map(({ answers }) => answers),
    [{ ask: ASKING_ID, reply: INBOX_REPLY.DONE, steps: [0, 1] }],
    "Reply sends Mark done with every step, no press needed",
  );

  act(() => world.root?.unmount());
  world.root = undefined;
  const partly = threadItem([askingMessage(toDo)]);
  const second = await mountThread(partly);
  const sentPartly = heldMessages(repliedOn(partly, "e1b2c3d4-0000-4000-8000-000000000013"));
  act(() => second.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")[1]?.click());
  assert.equal(askPress(second, "Couldn't do it").getAttribute("aria-pressed"), "false");
  act(() =>
    second.querySelector<HTMLButtonElement>('form.inbox-answer button[type="submit"]')?.click(),
  );
  await settle();
  assert.deepEqual(
    sentPartly.map(({ answers }) => answers),
    [{ ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED, steps: [1] }],
    "the step ticked goes as it stands, never as Couldn't do it",
  );

  act(() => world.root?.unmount());
  world.root = undefined;
  const titled = threadItem([askingMessage({ type: INBOX_ASK.DO, steps: [] })]);
  const third = await mountThread(titled);
  act(() => third.querySelector<HTMLInputElement>("[data-inbox-step] input")?.click());
  assert.equal(
    askPress(third, "Mark done").getAttribute("aria-pressed"),
    "true",
    "ticking a to-do's title, its one step, marks it done",
  );
});

test("a replaced or withdrawn ask draws no card: its controls as it offered them, stepped back, nothing picked and taking nothing, over a quiet marker saying a newer question replaced it, or a newer message where none asks, or that it was withdrawn with why under it, or, where a member closed the item, none, the thread ending in a line saying who resolved it", async () => {
  const withdrawnId = "e1b2c3d4-0000-4000-8000-000000000020";
  const closedId = "e1b2c3d4-0000-4000-8000-000000000021";
  const laterId = "e1b2c3d4-0000-4000-8000-000000000023";
  const shown = threadItem(
    [
      askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.REPLACED }),
      askingMessage(EXPIRY_ASK, {
        id: withdrawnId,
        status: INBOX_ASK_STATUS.WITHDRAWN,
        withdrawnReason: "Product picked 14 days.",
        createdAt: 2_000,
      }),
      askingMessage(EXPIRY_ASK, {
        id: closedId,
        status: INBOX_ASK_STATUS.WITHDRAWN,
        createdAt: 3_000,
      }),
      threadMessage(laterId, { member: READER }, "Picked 7 days after all.", 4_000),
    ],
    { status: INBOX_STATUS.CLOSED, closedBy: TEAMMATE, settledAt: 3_500 },
  );
  const pane = await mountThread(shown);

  assert.deepEqual(askBoxes(pane), [], "no settled ask draws a card");
  assert.equal(pane.querySelector("[data-inbox-waiting]"), null);
  for (const [id, settled, words, why] of [
    [ASKING_ID, "replaced", "Replaced by a newer question", null],
    [withdrawnId, "withdrawn", "Withdrawn", "Product picked 14 days."],
    [closedId, null, null, null],
  ] as const) {
    const message =
      pane.querySelector(`[data-message-id="${id}"]`) ??
      assert.fail(`the ${settled} ask's message`);
    const offered =
      message.querySelector<HTMLElement>(
        "[data-inbox-replaced] .inbox-ask-replaced-controls [data-stepped-back]",
      ) ?? assert.fail(`the ${settled} ask keeps its controls, stepped back`);
    const options = [...offered.querySelectorAll<HTMLElement>("[role='radio']")];
    assert.deepEqual(
      options.map((option) =>
        ["1 day", "7 days", "30 days"].some((label) => wordsOf(option)?.includes(label)),
      ),
      [true, true, true],
      "every option it offered still reads",
    );
    assert.ok(wordsOf(offered)?.includes("What most teams use."), "with its detail");
    assert.deepEqual(
      options.map((option) => option.getAttribute("aria-checked")),
      ["false", "false", "false"],
      "none of them picked",
    );
    act(() => options[1]?.click());
    assert.equal(options[1]?.getAttribute("aria-checked"), "false", "and a press picks nothing");
    assert.equal(
      message
        .querySelector("[data-inbox-replaced] > :last-child")
        ?.getAttribute("data-inbox-settled"),
      settled,
      "the marker stands under them",
    );
    assert.deepEqual(
      [...message.querySelectorAll<HTMLElement>("[data-inbox-settled]")].map((marker) => [
        marker.dataset.inboxSettled,
        wordsOf(marker.querySelector(".luke-badge")),
      ]),
      settled === null ? [] : [[settled, words]],
      "the agent's message ends with the marker saying so, or none where the thread's own line says who closed it",
    );
    assert.equal(
      wordsOf(message.querySelector("[data-inbox-settled] [data-inbox-withdrawn-why]")),
      why,
      "with why it was withdrawn under the pill, where its agent said",
    );
  }
  assert.deepEqual(
    [...pane.querySelectorAll(".inbox-thread > li:not([data-inbox-comment='draft'])")]
      .slice(-2)
      .map((line) => [
        line.getAttribute("data-inbox-comment"),
        wordsOf(line.querySelector(".luke-comment-name")),
      ]),
    [
      ["closed", "Charles Pan resolved this without an answer"],
      ["message", "You"],
    ],
    "a line saying who resolved it stands where they did, before a message written since",
  );

  act(() => world.root?.unmount());
  world.root = undefined;
  const noticed = await mountThread(
    threadItem([
      askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.REPLACED }),
      threadMessage("e1b2c3d4-0000-4000-8000-000000000022", "agent", "Deploy finished.", 2_000),
    ]),
  );
  assert.equal(
    wordsOf(noticed.querySelector(`[data-message-id="${ASKING_ID}"] [data-inbox-settled]`)),
    "Replaced by a newer message",
    "an ask replaced by a message that asks nothing names no newer question",
  );

  act(() => world.root?.unmount());
  world.root = undefined;
  const toDo = await mountThread(
    threadItem([
      askingMessage(
        { type: INBOX_ASK.DO, steps: ["Open the repository's settings", "Add the secret"] },
        { status: INBOX_ASK_STATUS.REPLACED },
      ),
    ]),
  );
  const steps = [
    ...toDo.querySelectorAll<HTMLInputElement>(
      `[data-message-id="${ASKING_ID}"] [data-inbox-replaced] [data-inbox-step] input`,
    ),
  ];
  assert.deepEqual(
    steps.map((step) => step.checked),
    [false, false],
    "a replaced to-do keeps its steps, none ticked",
  );

  act(() => world.root?.unmount());
  world.root = undefined;
  const titled = await mountThread(
    threadItem([
      askingMessage({ type: INBOX_ASK.DO, steps: [] }, { status: INBOX_ASK_STATUS.REPLACED }),
    ]),
  );
  assert.equal(
    titled.querySelector(`[data-message-id="${ASKING_ID}"] [data-inbox-replaced]`),
    null,
    "a replaced to-do naming no steps keeps no controls, since the title it drew as its step may have been renamed since",
  );

  act(() => world.root?.unmount());
  world.root = undefined;
  const words = await mountThread(
    threadItem([askingMessage({ type: INBOX_ASK.ANSWER }, { status: INBOX_ASK_STATUS.REPLACED })]),
  );
  const asked = words.querySelector(`[data-message-id="${ASKING_ID}"]`);
  assert.equal(
    asked?.querySelector("[data-inbox-replaced]"),
    null,
    "an ask of words alone has no controls to keep",
  );
  assert.equal(
    wordsOf(asked?.querySelector("[data-inbox-settled]") ?? null),
    "Replaced by a newer message",
    "and ends with the marker alone",
  );

  act(() => world.root?.unmount());
  world.root = undefined;
  const taken = await mountThread(
    threadItem([
      askingMessage(
        { type: INBOX_ASK.ANSWER },
        { status: INBOX_ASK_STATUS.WITHDRAWN, withdrawnReason: "Found it in the README." },
      ),
    ]),
  );
  const takenBack = taken.querySelector(`[data-message-id="${ASKING_ID}"]`);
  assert.equal(
    takenBack?.querySelector(".inbox-ask"),
    null,
    "a withdrawn ask of words alone draws no card",
  );
  assert.deepEqual(
    [
      wordsOf(takenBack?.querySelector('[data-inbox-settled="withdrawn"] .luke-badge')),
      wordsOf(
        takenBack?.querySelector('[data-inbox-settled="withdrawn"] [data-inbox-withdrawn-why]'),
      ),
    ],
    ["Withdrawn", "Found it in the README."],
    "and ends with the withdrawn marker alone, why under its pill",
  );
});

/** The reader's reply answering the ask the thread opens with, as the service keeps it. */
const ANSWER_ID = "e1b2c3d4-0000-4000-8000-000000000030";

/** An item whose opening ask the reader answered with `answers` and `text`, the item answered and the ask so, then any `after` it. */
function answeredThread(
  ask: InboxAsk,
  answers: Omit<NonNullable<InboxMessage["answers"]>, "ask">,
  text = "",
  after: readonly InboxMessage[] = [],
): InboxItem {
  return threadItem(
    [
      askingMessage(ask, { status: INBOX_ASK_STATUS.ANSWERED }),
      {
        ...threadMessage(ANSWER_ID, { member: READER }, text, 2_000),
        answers: { ask: ASKING_ID, ...answers },
      },
      ...after,
    ],
    { status: INBOX_STATUS.ANSWERED, answeredBy: READER, settledAt: 2_000 },
  );
}

/** The answered ask's card's controls, as the answer left them, heading the reply that answered it. */
function answeredBox(pane: HTMLElement): HTMLElement {
  return (
    pane.querySelector<HTMLElement>(
      `[data-message-id="${ANSWER_ID}"] .inbox-comment-body > [data-inbox-answered]`,
    ) ?? assert.fail("the reply leads with the ask's controls filled in")
  );
}

/** Each press of an answered box, by its words, whether it was the one given, and its glyph's tone where it wears one; every one read-only. */
function answeredPresses(box: HTMLElement): (string | boolean | undefined)[][] {
  return [...box.querySelectorAll<HTMLButtonElement>(".inbox-ask-presses button")].map((press) => {
    assert.equal(press.getAttribute("aria-disabled"), "true", "a press given takes no press");
    assert.equal(press.dataset.readOnly, "true", "and stands at full strength, not faded");
    return [
      press.textContent ?? "",
      press.getAttribute("aria-pressed") === "true",
      press.querySelector<HTMLElement>(".inbox-ask-pressed")?.dataset.tone,
    ];
  });
}

test("an answered decide's card leaves the agent's message for the head of the reply that answered it, under the answerer's name: its options as they were offered, read-only, the pick checked and no head over them, in place of the reply's stamp; a number key still picks the open ask's option below it", async () => {
  const later = "e1b2c3d4-0000-4000-8000-000000000031";
  const shown = answeredThread(EXPIRY_ASK, { reply: INBOX_REPLY.CHOSE, choices: ["7 days"] }, "", [
    askingMessage(EXPIRY_ASK, { id: later, createdAt: 3_000 }),
  ]);
  const pane = await mountThread({ ...shown, status: INBOX_STATUS.OPEN });

  assert.deepEqual(askBoxes(pane), []);
  assert.equal(askMarker(pane), null, "the later ask waits on the reader, which draws no marker");
  const asked =
    pane.querySelector(`[data-message-id="${ASKING_ID}"]`) ?? assert.fail("the agent's message");
  assert.equal(asked.querySelector(".inbox-ask"), null, "the agent's message ends with its words");
  const reply = pane.querySelector(`[data-message-id="${ANSWER_ID}"]`) ?? assert.fail("the reply");
  assert.equal(wordsOf(reply.querySelector(".luke-comment-name")), "You", "the answerer heads it");
  const box = answeredBox(pane);
  const rows = [...box.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  assert.deepEqual(
    rows.map((row) => [
      wordsOf(row),
      row.getAttribute("aria-checked"),
      row.getAttribute("aria-disabled"),
    ]),
    [
      ["1 dayAs today.", "false", "true"],
      ["7 daysRecommendedWhat most teams use.", "true", "true"],
      ["30 days", "false", "true"],
    ],
    "each row as offered, unnumbered, the pick checked and none pressable",
  );
  assert.equal(box.querySelector<HTMLElement>(".luke-choice-list")?.dataset.readOnly, "true");
  assert.equal(
    reply.querySelector("[data-inbox-stamp]"),
    null,
    "the card stands in the stamp's place",
  );

  keyOn(document.body, "3");
  const open = pane.querySelector("[data-inbox-draft-ask]") ?? assert.fail("the open ask");
  const openRows = [...open.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  assert.equal(openRows[2]?.getAttribute("aria-checked"), "true", "3 picks the open ask's third");
  assert.equal(document.activeElement, openRows[2], "and takes the keyboard there");
  assert.deepEqual(
    rows.map((row) => row.getAttribute("aria-checked")),
    ["false", "true", "false"],
    "the answered box stands as it was",
  );
});

test("an answered yes-or-no heads its reply with its two small buttons, the one pressed marked in its tone, the one recommended still saying so, and neither pressable", async () => {
  const pane = await mountThread(
    answeredThread(
      {
        type: INBOX_ASK.DECIDE,
        options: [{ label: "Approve" }, { label: "Request changes" }],
        recommended: "Approve",
      },
      { reply: INBOX_REPLY.CHOSE, choices: ["Request changes"] },
      "The banner overlaps the header.",
    ),
  );

  assert.deepEqual(askBoxes(pane), []);
  assert.deepEqual(answeredPresses(answeredBox(pane)), [
    ["ApproveRecommended", false, undefined],
    ["Request changes", true, "neutral"],
  ]);
  assert.equal(answeredBox(pane).querySelector('[role="radio"]'), null, "no radio list stands");
});

test("an answered do heads its reply with its steps ticked as they were sent, over Mark done and Couldn't do it with the one pressed marked, none of them taking a press; one naming no step ticks its title's where it was marked done", async () => {
  const pane = await mountThread(
    answeredThread(
      {
        type: INBOX_ASK.DO,
        steps: ["Open the repository's settings", "Add the secret", "Re-run the deploy"],
      },
      { reply: INBOX_REPLY.NOT_DONE, steps: [0] },
      "The secret page 404s.",
    ),
  );
  const box = answeredBox(pane);
  const steps = () =>
    [...box.querySelectorAll<HTMLElement>("[data-inbox-step]")].map((step) => {
      const tick =
        step.querySelector<HTMLElement>('[role="checkbox"]') ?? assert.fail("a step's box");
      assert.equal(tick.getAttribute("aria-readonly"), "true");
      return [step.textContent, tick.getAttribute("aria-checked") === "true"];
    });

  assert.deepEqual(askBoxes(pane), []);
  assert.deepEqual(steps(), [
    ["Open the repository's settings", true],
    ["Add the secret", false],
    ["Re-run the deploy", false],
  ]);
  act(() => box.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")[1]?.click());
  assert.deepEqual(steps()[1], ["Add the secret", false], "a press ticks nothing");
  assert.deepEqual(answeredPresses(box), [
    ["Mark done", false, undefined],
    ["Couldn't do it", true, "neutral"],
  ]);

  act(() => world.root?.unmount());
  world.root = undefined;
  const legacy = await mountThread(
    answeredThread({ type: INBOX_ASK.DO, steps: [] }, { reply: INBOX_REPLY.DONE, steps: [] }),
  );
  const legacyBox = answeredBox(legacy);
  assert.deepEqual(
    [...legacyBox.querySelectorAll<HTMLElement>("[data-inbox-step]")].map((step) => [
      step.textContent,
      step.querySelector("input")?.checked,
    ]),
    [["How long should invites last?", true]],
  );
  assert.deepEqual(answeredPresses(legacyBox), [
    ["Mark done", true, "complete"],
    ["Couldn't do it", false, undefined],
  ]);
});

test("an answered form heads its reply with its fields, each holding what it was given and one left empty standing empty, a text field's mention as its chip, with no Submit and no list on the reply repeating the values", async () => {
  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" },
    "rollout-store.ts",
    { workspace: BILLING.workspaceId, repository: "acme/relay" },
  );
  const pane = await mountThread(
    answeredThread(
      {
        type: INBOX_ASK.ANSWER,
        fields: [
          { type: INBOX_FIELD.SELECT, label: "Effort", options: ["high", "xhigh"], required: true },
          { type: INBOX_FIELD.TEXT, label: "Reason", required: true },
          { type: INBOX_FIELD.NUMBER, label: "Retries", required: true },
          { type: INBOX_FIELD.BOOLEAN, label: "Page on-call" },
        ],
      },
      {
        reply: INBOX_REPLY.SUBMITTED,
        values: [
          { label: "Effort", value: "xhigh" },
          { label: "Reason", value: `See ${file}` },
          { label: "Page on-call", value: true },
        ],
      },
    ),
  );
  const box = answeredBox(pane);

  assert.deepEqual(answeredFields(box), [
    ["select", "Effort", "xhigh"],
    ["text", "Reason", "See file rollout-store.ts"],
    ["number", "Retries", ""],
    ["boolean", "Page on-call", "checked"],
  ]);
  assert.equal(
    box.querySelector("[data-mention-ref] .luke-inline-ref-label")?.textContent,
    "rollout-store.ts",
  );
  assert.equal(box.querySelector(".inbox-ask-presses"), null, "no Submit stands");
  assert.equal(pane.querySelector("[data-inbox-values]"), null, "the reply lists no values");
  assert.deepEqual(askBoxes(pane), []);
  assert.equal(pane.querySelector("[data-inbox-stamp]"), null);
});

test("an answered ask of words alone draws no card, its reply just its words and the agent's message ending with a small Answered marker, among other replies; one whose reply the thread read no longer carries stays in the agent's message saying it was answered, and an answer whose ask it no longer carries leads with its stamp and lists its values", async () => {
  const words = await mountThread(
    answeredThread(
      { type: INBOX_ASK.ANSWER },
      { reply: INBOX_REPLY.ANSWERED },
      "Use the staging bucket.",
      [threadMessage("e1b2c3d4-0000-4000-8000-000000000032", { member: READER }, "Thanks!", 3_000)],
    ),
  );
  assert.deepEqual(askBoxes(words), [], "no card stands anywhere");
  const reply =
    words.querySelector(`[data-message-id="${ANSWER_ID}"]`) ?? assert.fail("the answering reply");
  assert.equal(
    wordsOf(reply.querySelector(".inbox-comment-body")),
    "Use the staging bucket.",
    "the reply is just its words",
  );
  assert.equal(
    wordsOf(words.querySelector(`[data-message-id="${ASKING_ID}"] [data-inbox-settled]`)),
    "Answered",
    "the agent's message says its ask was answered",
  );
  assert.equal(words.querySelectorAll("[data-inbox-settled]").length, 1, "and no reply does");

  act(() => world.root?.unmount());
  world.root = undefined;
  const cut = await mountThread(
    threadItem([askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.ANSWERED })], {
      status: INBOX_STATUS.ANSWERED,
      answeredBy: READER,
      settledAt: 2_000,
    }),
  );
  assert.deepEqual(askBoxes(cut), [["answered", "Pick oneAnswered"]]);
  assert.ok(
    cut.querySelector(`[data-message-id="${ASKING_ID}"] .inbox-ask`),
    "in the agent's message",
  );
  assert.equal(cut.querySelector("[data-inbox-answered]"), null, "nothing is drawn filled in");

  act(() => world.root?.unmount());
  world.root = undefined;
  const orphan = await mountThread(
    threadItem([
      threadMessage("e1b2c3d4-0000-4000-8000-000000000040", "agent", "Thanks.", 1_000),
      {
        ...threadMessage(ANSWER_ID, { member: READER }, "", 2_000),
        answers: {
          ask: "e1b2c3d4-0000-4000-8000-000000000099",
          reply: INBOX_REPLY.SUBMITTED,
          values: [{ label: "Effort", value: "high" }],
        },
      },
      askingMessage(EXPIRY_ASK, { createdAt: 3_000 }),
    ]),
  );
  assert.equal(
    wordsOf(orphan.querySelector(`[data-message-id="${ANSWER_ID}"] [data-inbox-values]`)),
    "Efforthigh",
  );
  assert.equal(
    orphan.querySelector(`[data-message-id="${ANSWER_ID}"] [data-inbox-stamp]`)?.textContent,
    "Submitted",
  );
});

test("an ask of a type this build does not know reads as a line naming a newer Luke, saying which teammate it waits on while open and nothing more where it waits on the reader, and the box still replies", async () => {
  const poll = Schema.decodeUnknownSync(inboxReadAskSchema)({ type: "poll", status: "open" });
  const asking = { ...askingMessage(EXPIRY_ASK), ask: poll };
  const pane = await mountThread(threadItem([asking]));
  assert.deepEqual(askBoxes(pane), [["newer", "Answer this in a newer Luke."]]);
  assert.equal(pane.querySelector("[data-inbox-waiting]"), null);
  assert.equal(sendWords(pane), "Send");
});

test("an ask of a type this build does not know, open on a teammate's item, names the teammate it waits on", async () => {
  const poll = Schema.decodeUnknownSync(inboxReadAskSchema)({ type: "poll", status: "open" });
  const pane = await mountThread(
    threadItem([{ ...askingMessage(EXPIRY_ASK), ask: poll }], { startedBy: TEAMMATE }),
  );
  assert.deepEqual(askBoxes(pane), [
    ["newer", "Answer this in a newer Luke.Waiting on Charles Pan"],
  ]);
});

test("the steps ticked and the answer pressed are the item's draft, standing again when the reader comes back to it from another item", async () => {
  const shown = threadItem([
    askingMessage({
      type: INBOX_ASK.DO,
      steps: ["Open the repository's settings", "Add the secret"],
    }),
  ]);
  const pane = await mountThread(shown);
  const page = pane.ownerDocument.body;
  const ticked = () =>
    [...pane.querySelectorAll<HTMLInputElement>("[data-inbox-step] input")].map(
      (box) => box.checked,
    );
  act(() => pane.querySelector<HTMLInputElement>("[data-inbox-step] input")?.click());
  act(() => askPress(pane, "Couldn't do it").click());
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  act(() => rowNamed(page, shown.title).click());
  await settle();

  assert.deepEqual(ticked(), [true, false]);
  assert.equal(askPress(pane, "Couldn't do it").getAttribute("aria-pressed"), "true");
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
});

test("the reader's own open ask draws no waiting marker anywhere in the thread, its draft reply holding the ask's controls", async () => {
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)]));
  assert.equal(
    pane.querySelector(".inbox-thread")?.getAttribute("aria-label"),
    "Messages",
    "an item's messages are a list named Messages",
  );
  assert.equal(askMarker(pane), null);
  assert.equal(pane.querySelector("[data-inbox-waiting]"), null);
  assert.doesNotMatch(
    pane.querySelector(".inbox-thread")?.textContent ?? assert.fail("the thread"),
    /Waiting on/u,
  );
  assert.deepEqual(draftReply(pane), ["You", "controls"]);
});

test("a teammate's open ask says on its marker that it waits on them, rather than on you, and still takes your answer in your draft reply", async () => {
  const pane = await mountThread(threadItem([askingMessage(EXPIRY_ASK)], { startedBy: TEAMMATE }));
  assert.deepEqual(subjectParts(pane), ["How long should invites last?"]);
  assert.equal(askMarker(pane), "Waiting on Charles Pan");
  act(() => openOptions(pane)[0]?.click());
  assert.equal(footWords(pane), "", "the box says nothing of what is sent");
});

test("an item's card shows a to-do naming no steps of its own its title as its one step, as its box does", async () => {
  const ROTATE = threadItem([askingMessage({ type: INBOX_ASK.DO, steps: [] })], {
    title: "Rotate the deployment key",
  });
  world.inboxes = new Map([[BILLING.id, [ROTATE]]]);
  const { page } = mount();
  await settle();
  hoveredCard(rowNamed(page, ROTATE.title), "[data-inbox-item-card]");
  assert.deepEqual(
    [
      ...document.querySelectorAll(
        '.luke-tooltip-card [data-inbox-item-card] ul[aria-label="Steps"] > li',
      ),
    ].map((step) => step.textContent),
    ["Rotate the deployment key"],
  );
});
