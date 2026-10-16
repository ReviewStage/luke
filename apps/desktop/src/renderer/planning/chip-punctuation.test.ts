// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@luke/features/plan-wire";
import { PLAN_ACTOR } from "@luke/features/plan-wire";
import { ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect } from "effect";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, test } from "vitest";
import { layContainersAt } from "#testing/container-width";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { useConfirmDialog } from "../settings/confirm-dialog";
import { notesBefore } from "./file-note";
import { PlanBody } from "./plan-body";
import { PlanMentions, type PlanMentionsValue } from "./plan-mentions";
import { TranscriptWords } from "./transcript-blocks";
import { HISTORY_READ } from "./use-plan-history";
import { VersionView } from "./version-view";

/**
 * chip-punctuation.test.ts -- a chip and the punctuation written against it stand as one box no line breaks inside, wherever words are drawn: a transcript, the plan, a version, and Luke's note. A comma or full stop after a chip, a Luke link's, a GitHub file's or pull request's, or a Linear issue's alike, never starts a line alone, nor an opening bracket ends one alone before it; a plain link's words still wrap as words. Synthetic plan and repository.
 */

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const REPOSITORY = "acme/relay";

const WORDS = [
  `Read [the rollout](https://tryluke.dev/acme/plan/${PLAN_ID}#rollout),`,
  `[the store](https://github.com/${REPOSITORY}/blob/0a1b2c3d/apps/web/store.ts#L3-L5);`,
  `it was opened as https://github.com/${REPOSITORY}/pull/4823, after`,
  `(https://linear.app/acme/issue/IAM-482/invites) and [the docs](https://example.com/docs), too.`,
].join(" ");

/** Each chip's box, as the words around it are held to it: the opening punctuation before the chip, and the closing after it. */
const HELD = [
  ["", ","],
  ["", ";"],
  ["", ","],
  ["(", ")"],
];

const PLAN: Plan = {
  ...DOCUMENT_PLAN,
  id: PLAN_ID,
  repository: REPOSITORY,
  document: { body: `## Rollout\n\n${WORDS}`, assumptions: [] },
};

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

const SECTION_LINKS = {
  workspace: "acme",
  onOpen: () => undefined,
  onOpenFile: () => undefined,
  reveal: undefined,
};

let style: HTMLStyleElement | undefined;

// A reply is drawn once the parser has landed, and the window's stylesheets are laid once, because jsdom takes seconds to lay them.
beforeAll(async () => {
  await Effect.runPromise(markdownHtmlParserLanded);
  style = layContainersAt({});
}, 30_000);

afterAll(() => style?.remove());

const roots: Root[] = [];

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (_request: Act): Promise<ActOutcome> =>
        Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const container of document.body.querySelectorAll(":scope > div")) container.remove();
});

function drawn(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(PlanMentions, { value: PAGE, children: node })));
  return container;
}

/** A plan's version, read and ready, as the version history draws it. */
function Version(): ReactNode {
  const restore = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  );
  return createElement(VersionView, {
    viewing: {
      line: {
        seq: 2,
        lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 2, duringCall: true },
        startedAt: 1,
        changes: 1,
      },
      current: false,
      read: { kind: HISTORY_READ.READY, document: PLAN.document, previous: null },
    },
    restore,
  });
}

/** Luke's note on a File tab's lines. */
function Note(): ReactNode {
  const notes = notesBefore({
    notes: [{ callId: "call-1", shownAt: 0, startLine: 3, endLine: 5, note: WORDS }],
    folded: [],
    onFold: () => undefined,
    onShow: () => undefined,
  });
  return notes(3);
}

/** Each chip, as the box it stands in holds it: the words before it and after it in that box, where no line may break. */
function heldChips(surface: HTMLElement): string[][] {
  return [...surface.querySelectorAll<HTMLElement>(".mention-chip")].map((chip) => {
    let box = chip.parentElement;
    while (box !== null && box !== surface && getComputedStyle(box).whiteSpace !== "nowrap") {
      box = box.parentElement;
    }
    if (box === null || box === surface) return ["unheld"];
    const whole = box.textContent ?? "";
    const at = whole.indexOf(chip.textContent ?? "");
    return [whole.slice(0, at), whole.slice(at + (chip.textContent ?? "").length)];
  });
}

test("a transcript, the plan, a version, and a note hold each chip and the punctuation written against it in one box no line breaks inside, a plain link's words left to wrap", () => {
  const surfaces = [
    drawn(createElement(TranscriptWords, { text: WORDS })),
    drawn(createElement(PlanBody, { plan: PLAN, live: false, sectionLinks: SECTION_LINKS })),
    drawn(createElement(Version)),
    drawn(createElement(Note)),
  ];

  for (const surface of surfaces) {
    assert.deepEqual(heldChips(surface), HELD);
    const plain = surface.querySelector<HTMLElement>(".text-link");
    assert.equal(plain?.textContent, "the docs");
    assert.notEqual(getComputedStyle(plain?.parentElement ?? surface).whiteSpace, "nowrap");
  }
});
