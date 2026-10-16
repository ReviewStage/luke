// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import { ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { useConfirmDialog } from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect } from "effect";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, test } from "vitest";
import { layContainersAt } from "#testing/container-width";
import { DOCUMENT_TASK } from "#testing/document-task";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { notesBefore } from "./file-note";
import { PlanBody } from "./plan-body";
import { PlanMentions, type PlanMentionsValue } from "./plan-mentions";
import { TranscriptWords } from "./transcript-blocks";
import { HISTORY_READ } from "./use-plan-history";
import { VersionView } from "./version-view";

/**
 * chip-punctuation.test.ts -- a chip and the punctuation written against it stand as one box no line breaks inside, wherever words are drawn: a transcript, the plan, a version, and Luke's note, a box no wider than the chip as it is cut and its punctuation. A comma or full stop after a chip, a Luke link's, a GitHub file's or pull request's, or a Linear issue's alike, never starts a line alone, nor an opening bracket ends one alone before it; a plain link's words still wrap as words. Synthetic plan and repository.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const REPOSITORY = "acme/relay";

const WORDS = [
  `Read [the rollout](https://tryluke.dev/acme/plan/${TASK_ID}#rollout),`,
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

const PLAN: Task = {
  ...DOCUMENT_TASK,
  id: TASK_ID,
  repository: REPOSITORY,
  document: { body: `## Rollout\n\n${WORDS}`, assumptions: [] },
};

const PAGE: PlanMentionsValue = {
  taskId: TASK_ID,
  taskName: "Invitations",
  workspace: "acme",
  repository: REPOSITORY,
  text: () => PLAN.document.body,
  doors: {
    taskId: TASK_ID,
    place: { workspace: "acme", repository: REPOSITORY },
    anchors: new Set(["rollout"]),
    onOpenTask: () => undefined,
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

/** A plan's version, read and ready, as the version history draws it, against the version before it where one is given. */
function Version({ previous = null }: { previous?: Task["document"] | null }): ReactElement {
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
      read: { kind: HISTORY_READ.READY, document: PLAN.document, previous },
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
    drawn(createElement(PlanBody, { task: PLAN, live: false, sectionLinks: SECTION_LINKS })),
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

test("a version holds a chip with a comma it wrote in after it, and leaves a mention whose label it changed in part to wrap as words", () => {
  const before = `## Rollout\n\nRead [the plan](https://tryluke.dev/acme/plan/${TASK_ID}#rollout) then.\n\nSee [the store](https://github.com/${REPOSITORY}/blob/0a1b2c3d/apps/web/store.ts#L3-L5) too.`;
  const after = before
    .replace("#rollout) then.", "#rollout), then.")
    .replace("[the store]", "[the new store]");
  const version = { ...PLAN, document: { body: after, assumptions: [] } };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanMentions, {
        value: { ...PAGE, text: () => after },
        children: createElement(() =>
          createElement(VersionView, {
            viewing: {
              line: {
                seq: 2,
                lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 2, duringCall: true },
                startedAt: 1,
                changes: 2,
              },
              current: false,
              read: {
                kind: HISTORY_READ.READY,
                document: version.document,
                previous: { body: before, assumptions: [] },
              },
            },
            restore: useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
              Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
            ),
          }),
        ),
      }),
    ),
  );

  assert.deepEqual(heldChips(container), [["", ","]]);
  const changed = [...container.querySelectorAll<HTMLElement>(".text-link")].find((link) =>
    link.textContent?.includes("store"),
  );
  assert.ok(changed, "the mention changed in part is drawn as words");
  assert.equal(changed.closest(".link-glued"), null);
});

test("a chip held with its punctuation is cut by a length alone, never a share of the box it stands in, which takes its width from the chip", () => {
  const surfaces = [
    drawn(createElement(TranscriptWords, { text: WORDS })),
    drawn(createElement(PlanBody, { task: PLAN, live: false, sectionLinks: SECTION_LINKS })),
    // A version that wrote every chip in, so each stands in its change's mark inside the box.
    drawn(createElement(Version, { previous: { body: "## Rollout\n\nRead.", assumptions: [] } })),
  ];

  for (const surface of surfaces) {
    const held = [...surface.querySelectorAll<HTMLElement>(".link-glued .mention-chip")];
    assert.equal(held.length, HELD.length);
    // A share has nothing to resolve against while the box is measured, so the box would keep the whole name's room as a gap after the chip it cuts.
    for (const chip of held) assert.match(getComputedStyle(chip).maxWidth, /^\d+(\.\d+)?px$/);
  }
});
