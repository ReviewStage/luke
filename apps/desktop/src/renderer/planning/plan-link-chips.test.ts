// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import { ACT_OUTCOME_STATUS, type ActOutcome } from "@luke/host/acts";
import { CONFIRM_STAGE } from "@luke/ui/confirm-state";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorBundle, installEditorLayout } from "#testing/composer";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { MARKDOWN_MARK, type MarkdownMark, MarkdownMessage } from "../markdown-message";
import { notesBefore } from "./file-note";
import { PlanBody } from "./plan-body";
import { PlanMentions, type PlanMentionsValue, useMentionLink } from "./plan-mentions";
import { HISTORY_READ } from "./use-plan-history";
import { VersionView } from "./version-view";

/**
 * plan-link-chips.test.ts -- a link in the plan's words, or in Luke's
 * notes, is drawn as the chip of what it names whoever wrote it, as a
 * transcript draws one: the plan read on its page, a version's diff, and a
 * File tab's note. A link that names nothing stays a link, code stays code,
 * and opening a section to edit it keeps its links in a chip's light look.
 * Synthetic plan and repository.
 */

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const REPOSITORY = "acme/relay";

const LINKS = [
  `Read [the rollout](https://tryluke.dev/acme/plan/${PLAN_ID}#rollout),`,
  `[the store](https://github.com/${REPOSITORY}/blob/0a1b2c3d/apps/web/store.ts#L3-L5),`,
  "https://linear.app/acme/issue/LUKE-142/fix-the-thing, and [the docs](https://example.com/docs).",
  "Not `https://linear.app/acme/issue/LUKE-9`.",
].join(" ");

const PLAN: Task = {
  ...DOCUMENT_PLAN,
  id: PLAN_ID,
  repository: REPOSITORY,
  document: { body: `## Rollout\n\n${LINKS}`, assumptions: [] },
};

const roots: Root[] = [];

beforeEach(() => {
  installEditorBundle();
  installEditorLayout();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (): Promise<ActOutcome> => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** What a plan's page hands its places. */
const PAGE: PlanMentionsValue = {
  planId: PLAN_ID,
  planName: "Invitations",
  workspace: "acme",
  repository: REPOSITORY,
  text: () => PLAN.document.body,
  doors: {
    planId: PLAN_ID,
    place: { workspace: "acme", repository: REPOSITORY },
    anchors: new Set(["rollout"]),
    onOpenPlan: () => undefined,
    onOpenFile: () => undefined,
  },
};

function drawn(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}

/** Each chip drawn: its kind and the name it says. */
function chips(container: HTMLElement): [string | undefined, string | null][] {
  return [...container.querySelectorAll<HTMLElement>(".mention-chip")].map((chip) => [
    chip.dataset.kind,
    chip.querySelector(".mention-chip-label")?.textContent ?? null,
  ]);
}

const THREE_CHIPS = [
  ["section", "the rollout"],
  ["file", "the store"],
  ["link", "LUKE-142/fix-the-thing"],
];

/** Words drawn as Markdown with the page's mentions, as a version and a note draw them. */
function PageWords({ words, marks }: { words: string; marks: MarkdownMark[] }): ReactNode {
  const link = useMentionLink();
  return createElement(MarkdownMessage, { words, link, edit: { marks } });
}

test("the plan read on its page draws a plan's link, a file's lines, and a Linear page as chips, any other link a link, and code as code", () => {
  const container = drawn(
    createElement(PlanBody, {
      plan: PLAN,
      live: false,
      sectionLinks: {
        workspace: "acme",
        onOpen: () => undefined,
        onOpenFile: () => undefined,
        reveal: undefined,
      },
    }),
  );

  assert.deepEqual(chips(container), THREE_CHIPS);
  assert.deepEqual(
    [...container.querySelectorAll(".text-link")].map((link) => link.textContent),
    ["the docs"],
  );
  assert.deepEqual(
    [...container.querySelectorAll("code")].map((code) => code.textContent),
    ["https://linear.app/acme/issue/LUKE-9"],
  );
});

test("a section opened to edit draws the links that name mentions in a chip's light look, and any other link as a link", async () => {
  const container = drawn(
    createElement(PlanBody, {
      plan: PLAN,
      live: false,
      onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
      sectionLinks: {
        workspace: "acme",
        onOpen: () => undefined,
        onOpenFile: () => undefined,
        reveal: undefined,
      },
    }),
  );
  const rollout = container.querySelector<HTMLElement>('[role="group"][aria-label="Rollout"]');
  assert.ok(rollout !== null);
  act(() => rollout.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => undefined);

  const links = [...container.querySelectorAll(".plan-document-text a")];
  assert.deepEqual(
    links.map((link) => [link.textContent, link.classList.contains("plan-mention-link")]),
    [
      ["the rollout", true],
      ["the store", true],
      ["https://linear.app/acme/issue/LUKE-142/fix-the-thing", true],
      ["the docs", false],
    ],
  );
});

test("a version's diff draws a mention written in as its chip, still marked as written in", () => {
  const container = drawn(
    createElement(PlanMentions, {
      value: PAGE,
      children: createElement(PageWords, {
        words: LINKS,
        marks: [{ kind: MARKDOWN_MARK.INSERTED, from: 0, to: LINKS.length }],
      }),
    }),
  );

  assert.deepEqual(chips(container), THREE_CHIPS);
  assert.deepEqual(
    [...container.querySelectorAll(".mention-chip")].map(
      (chip) => chip.closest("ins.markdown-inserted") !== null,
    ),
    [true, true, true],
  );
});

test("Luke's note on a File tab's lines draws its links as a transcript does", () => {
  const notes = notesBefore({
    notes: [{ callId: "call-1", shownAt: 0, startLine: 3, endLine: 5, note: LINKS }],
    folded: [],
    onFold: () => undefined,
    onShow: () => undefined,
  });
  const container = drawn(createElement(PlanMentions, { value: PAGE, children: notes(3) }));

  assert.deepEqual(chips(container), THREE_CHIPS);
  assert.deepEqual(
    [...container.querySelectorAll(".text-link")].map((link) => link.textContent),
    ["the docs"],
  );
});

test("a link whose label a version changed in part is drawn as words with the change marked, not as one chip", () => {
  const words = `Read [the new store](https://github.com/${REPOSITORY}/blob/HEAD/store.ts).`;
  const from = words.indexOf("new");
  const container = drawn(
    createElement(PlanMentions, {
      value: PAGE,
      children: createElement(PageWords, {
        words,
        marks: [{ kind: MARKDOWN_MARK.INSERTED, from, to: from + "new ".length }],
      }),
    }),
  );

  assert.equal(container.querySelector(".mention-chip"), null);
  assert.equal(container.querySelector(".text-link ins.markdown-inserted")?.textContent, "new ");
});

test("the plan's version history, off the plan's page, reads a version's mentions against the plan it is of", () => {
  const document = { body: `## Rollout\n\n${LINKS}\n`, assumptions: [] };
  const container = drawn(
    createElement(VersionView, {
      viewing: {
        line: {
          seq: 2,
          lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 0, duringCall: true },
          startedAt: 0,
          changes: 1,
        },
        current: true,
        read: { kind: HISTORY_READ.READY, document, previous: document },
      },
      restore: {
        stage: CONFIRM_STAGE.RESTING,
        rejection: undefined,
        busy: false,
        standing: false,
        ask: () => undefined,
        keep: () => undefined,
        run: () => undefined,
        clear: () => undefined,
      },
      restorable: false,
      plan: { planId: PLAN_ID, place: PAGE.doors.place, anchors: PAGE.doors.anchors },
    }),
  );

  assert.deepEqual(chips(container), THREE_CHIPS);
});
