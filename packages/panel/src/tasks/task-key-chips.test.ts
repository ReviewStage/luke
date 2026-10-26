// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MENTION_KIND, type Mention } from "@luke/features/mention-link";
import { TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { MarkdownMessage } from "../markdown-message.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { mentionLinkDrawer } from "./mention-chip.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * task-key-chips.test.ts -- a listed task's key written among words
 * (`STAG-422`) is drawn as that task's chip, saying the key as written,
 * wherever words are drawn with chips: a transcript's, an Inbox item's, and a plan's or a comment's. A key in code or a link, a
 * word shaped like a key that names no task, and a key two tasks share
 * stay words. Synthetic workspaces and tasks.
 */

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

/** A workspace of the reader's, its slug its name in lower case. */
function workspace(id: string, name: string): Workspace {
  return { id, name, slug: name.toLowerCase(), role: WORKSPACE_ROLE.OWNER, github: null };
}

const STAGE = workspace("workspace-stage", "Stage");
const STAG = workspace("workspace-stag", "Stag");

/** A task of `home`'s, numbered `number`. */
function task(home: Workspace, number: number, name: string): TaskSummary {
  return {
    id: `${home.id}-${number}`,
    workspaceId: home.id,
    number,
    name,
    status: TASK_STATUS.IN_PROGRESS,
    createdAt: 1,
    updatedAt: 1,
    repository: null,
  };
}

// Words are drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The window's document listing Stage's tasks 421 and 422, and task 7 of both Stage and Stag, whose keys are alike. */
function listTasks(): void {
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [STAGE, STAG],
        tasks: [
          task(STAGE, 421, "Cut the release"),
          task(STAGE, 422, "Task ID chips"),
          task(STAGE, 7, "Dotfiles sync"),
          task(STAG, 7, "Antler inventory"),
        ],
      },
    },
  );
}

/** What a plan's page hands its places, each task a chip opened kept. */
function planPage(opened: Mention[]): TaskMentionsValue {
  return {
    taskId: PLAN_ID,
    taskName: "Rollout",
    workspace: STAGE.slug ?? "",
    repository: null,
    text: () => "",
    doors: {
      taskId: PLAN_ID,
      place: { workspace: STAGE.slug ?? "", repository: null },
      anchors: new Set(),
      onOpenTask: (mention) => opened.push(mention),
      onOpenFile: () => undefined,
    },
  };
}

/** `element` drawn on the plan's page over the window's document, once the document has landed. */
async function drawn(element: ReactElement, opened: Mention[] = []): Promise<HTMLElement> {
  listTasks();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const page = createElement(TaskMentions, { value: planPage(opened), children: element });
  // Note that the words are drawn before the document lands, as a window drawn before its tasks are listed draws them.
  act(() => root.render(onRegistry(AtomRegistry.make(), page)));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** Each chip drawn: its kind and the name it says. */
function chips(container: HTMLElement): [string | undefined, string | null][] {
  return [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")].map((chip) => [
    chip.dataset.kind,
    chip.querySelector(".luke-inline-ref-label")?.textContent ?? null,
  ]);
}

/** Whether any element drawn carries an address on an attribute the session recording keeps, other than a link's own. */
function carriesTarget(container: HTMLElement): boolean {
  const masked = new Set(["title", "href", "xmlns"]);
  return [...container.querySelectorAll("*")]
    .flatMap((element) => [...element.attributes])
    .some((attribute) => !masked.has(attribute.name) && attribute.value.includes("://"));
}

const WORDS = [
  "Landed STAG-421, so STAG-422 can go out.",
  "UTF-8 and STAG-9 stay words, `STAG-421` stays code,",
  "[STAG-422](https://example.com/notes) stays a link, STAG-422/notes and STAG-421.md are paths,",
  "and STAG-7 names two tasks.",
].join(" ");

test("in a transcript a listed task's key is its chip saying the key, which opens the task, and every other key-shaped word stays as written", async () => {
  const opened: Mention[] = [];
  const container = await drawn(createElement(TranscriptWords, { text: WORDS }), opened);

  assert.deepEqual(chips(container), [
    [MENTION_KIND.TASK, "STAG-421"],
    [MENTION_KIND.TASK, "STAG-422"],
  ]);
  assert.deepEqual(
    [...container.querySelectorAll("code")].map((code) => code.textContent),
    ["STAG-421"],
  );
  assert.deepEqual(
    [...container.querySelectorAll("a")].map((link) => link.textContent),
    ["STAG-422"],
  );
  assert.match(container.textContent ?? "", /UTF-8 and STAG-9 stay words/);
  assert.match(container.textContent ?? "", /STAG-422\/notes and STAG-421\.md are paths/);
  assert.match(container.textContent ?? "", /STAG-7 names two tasks/);
  assert.equal(carriesTarget(container), false);

  for (const chip of container.querySelectorAll<HTMLButtonElement>("button[data-mention-ref]")) {
    act(() => chip.click());
  }
  assert.deepEqual(opened, [
    { kind: MENTION_KIND.TASK, taskId: task(STAGE, 421, "").id },
    { kind: MENTION_KIND.TASK, taskId: task(STAGE, 422, "").id },
  ]);
});

test("a mention labelled with one task's key that links another says the task it opens, by its name", async () => {
  const other = task(STAGE, 422, "").id;
  const container = await drawn(
    createElement(TranscriptWords, {
      text: `See [@STAG-421](https://tryluke.dev/stage/plan/${other}).`,
    }),
  );

  assert.deepEqual(chips(container), [[MENTION_KIND.TASK, "Task ID chips"]]);
});

test("a key alone on its line of an Inbox item's document is its chip in the paragraph, not a link's card", async () => {
  const container = await drawn(
    createElement(TranscriptWords, { text: "Next up:\n\nSTAG-422\n", asDocument: true }),
  );

  assert.deepEqual(chips(container), [[MENTION_KIND.TASK, "STAG-422"]]);
  assert.ok(
    container.querySelector("p [data-mention-ref]"),
    "the chip stands in its paragraph, as words do",
  );
});

test("in a plan's or a comment's words a listed task's key is its chip, and a place that draws no chips leaves it as words", async () => {
  const doors = planPage([]).doors;
  const words = "See STAG-421, not `STAG-422` nor STAG-422/notes.";
  const chipped = await drawn(
    createElement(MarkdownMessage, { words, link: mentionLinkDrawer(doors) }),
  );
  const plain = await drawn(createElement(MarkdownMessage, { words }));

  assert.deepEqual(chips(chipped), [[MENTION_KIND.TASK, "STAG-421"]]);
  assert.equal(chipped.querySelector("code")?.textContent, "STAG-422");
  assert.deepEqual(chips(plain), []);
  assert.equal(plain.textContent, "See STAG-421, not STAG-422 nor STAG-422/notes.");
});
