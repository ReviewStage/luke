// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  MENTION_KIND,
  type Mention,
  type MentionLines,
  mentionMarkdown,
} from "@luke/features/mention-link";
import type { Task } from "@luke/features/task-wire";
import { ACT_OUTCOME_STATUS, type ActOutcome } from "@luke/host/acts";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { DOCUMENT_TASK } from "@luke/panel/testing/document-task";
import { onSideBundles, unlandedBundles } from "@luke/panel/testing/side-bundles";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";
import { PlanBody, type SectionLinks } from "./plan-body";

/**
 * A task's sections' links on its own page: a mention of a section drawn as
 * the chip that opens it, one of a heading the plan no longer holds struck
 * through and opening the task at its top, a section's ⋯ copying its link,
 * the title's ⋯ copying the task's, an ask to show a section scrolling the document to it, and nothing a
 * mention names riding on an attribute. Mentions are read in the form
 * written before the link was settled as well as the settled one.
 * Synthetic plan.
 */

const TASK_ID = DOCUMENT_TASK.id;

/** The slug of the workspace the task's links are written under. */
const WORKSPACE = "acme";

const PLACE = { workspace: WORKSPACE, repository: "acme/relay" } as const;

/** A plan whose last section mentions an earlier one, and one since renamed. */
const TASK: Task = {
  ...DOCUMENT_TASK,
  document: {
    body: [
      "## Goal",
      "Invite a teammate by email.",
      "",
      "## Rollout",
      "Store first, then the desktop.",
      "",
      "## Notes",
      `Ship as [@Rollout](luke://plan/${TASK_ID}#Rollout) says, after [@Old plan](luke://plan/${TASK_ID}#Old%20plan).`,
    ].join("\n"),
    assumptions: [],
  },
};

/** A section's ⋯, as against the title's beside it. */
const SECTION_MORE = '.plan-unit-more button[aria-label="Section actions"]';

const roots: Root[] = [];
const copied: string[] = [];

beforeEach(() => {
  copied.length = 0;
  fakeAppBridge({
    act: (): Promise<ActOutcome> => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
  });
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The task's page drawn with its sections' links, the mentions it was asked to open kept. */
function drawn(links: Partial<SectionLinks> = {}) {
  const opened: Mention[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const sectionLinks: SectionLinks = {
    workspace: WORKSPACE,
    onOpen: (mention) => opened.push(mention),
    reveal: undefined,
    ...links,
  };
  act(() => root.render(createElement(PlanBody, { task: TASK, live: false, sectionLinks })));
  return { container, opened };
}

function chipNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const chip = [...container.querySelectorAll<HTMLButtonElement>("[data-mention-ref]")].find(
    (each) => each.textContent === name,
  );
  assert.ok(chip, `a chip named ${name}`);
  return chip;
}

test("a mention of a section is drawn as its chip, and a press opens that section", () => {
  const { container, opened } = drawn();

  const chip = chipNamed(container, "Rollout");
  act(() => chip.click());

  assert.equal(chip.dataset.state, "found");
  assert.deepEqual(opened, [{ kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "rollout" }]);
});

test("a mention of a heading the plan no longer holds is struck through, and a press opens the plan at its top", () => {
  const { container, opened } = drawn();

  const chip = chipNamed(container, "Old plan");
  act(() => chip.click());

  assert.equal(chip.dataset.state, "gone");
  assert.deepEqual(opened, [{ kind: MENTION_KIND.TASK, taskId: TASK_ID }]);
});

test("a section's ⋯ copies the section's link, its bare address, as a teammate pastes it into Slack or a pull request", async () => {
  const { container } = drawn();

  const rollout = [...container.querySelectorAll<HTMLElement>(".plan-unit-attributed")].find(
    (unit) => unit.textContent?.startsWith("Rollout"),
  );
  const more = rollout?.querySelector<HTMLButtonElement>(".plan-unit-more button");
  assert.ok(more, "the Rollout section has a ⋯");
  act(() => more.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link",
  );
  assert.ok(item, "the ⋯ offers to copy the section's link");
  await act(async () => item.click());

  assert.deepEqual(copied, [`https://tryluke.dev/acme/plan/${TASK_ID}#rollout`]);
});

test("the plan's first words, under no heading, offer no link", () => {
  const { container } = drawn();

  const mores = container.querySelectorAll(SECTION_MORE);

  assert.equal(mores.length, 3, "one ⋯ for each of the three headed sections");
});

test("an ask to show a section scrolls the document to it, and an ask for one it no longer holds to its top", () => {
  const { container } = drawn();
  const scroller = container.querySelector<HTMLElement>(".plan-document-body")?.parentElement;
  assert.ok(scroller);
  const units = container.querySelectorAll<HTMLElement>(".plan-unit");
  // The layout jsdom has none of: the document's top at 100, the Rollout section's at 700.
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ y: 100 }));
  const rollout = units[1];
  assert.ok(rollout);
  vi.spyOn(rollout, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ y: 700 }));
  const root = roots[0];
  assert.ok(root);
  const render = (sectionLinks: SectionLinks) =>
    act(() => root.render(createElement(PlanBody, { task: TASK, live: false, sectionLinks })));
  const onOpen = () => undefined;

  const revealed: number[] = [];
  const onRevealed = (ask: number) => revealed.push(ask);

  render({ workspace: WORKSPACE, onOpen, onRevealed, reveal: { anchor: "rollout", ask: 1 } });
  const shown = scroller.scrollTop;
  render({ workspace: WORKSPACE, onOpen, onRevealed, reveal: { anchor: "old-plan", ask: 2 } });

  assert.equal(shown, 600 - 16);
  assert.equal(scroller.scrollTop, 0);
  assert.deepEqual(revealed, [1, 2], "each ask is said shown once, so it can be let go");
});

test("no attribute of the plan's page carries what a mention names", () => {
  const { container } = drawn();

  for (const element of container.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      if (["aria-label", "title"].includes(attribute.name)) continue;
      assert.equal(/luke:|tryluke|github\.com/u.test(attribute.value), false, attribute.name);
      if (attribute.name.startsWith("data-")) {
        assert.equal(/Rollout|Old plan/u.test(attribute.value), false, attribute.name);
      }
    }
  }
});

test("off a plan's own page a mention stays its words", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => root.render(createElement(PlanBody, { task: TASK, live: false })));

  assert.equal(container.querySelector("[data-mention-ref]"), null);
  assert.equal(container.querySelector(".plan-unit-more"), null);
  assert.match(container.textContent ?? "", /Ship as @Rollout says/u);
});

test("a section whose heading is formatted is copied as a link that is drawn as its chip", () => {
  const heading = "Rollout *draft*";
  const task: Task = {
    ...TASK,
    document: {
      body: `## ${heading}\nStore first.\n\n## Notes\nSee ${mentionMarkdown({ kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "rollout-draft" }, heading, PLACE)}.`,
      assumptions: [],
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const opened: Mention[] = [];

  act(() =>
    root.render(
      createElement(PlanBody, {
        task,
        live: false,
        sectionLinks: {
          workspace: WORKSPACE,
          onOpen: (mention) => opened.push(mention),
          reveal: undefined,
        },
      }),
    ),
  );
  const chip = chipNamed(container, "Rollout draft");
  act(() => chip.click());

  assert.equal(chip.dataset.state, "found");
  assert.deepEqual(opened, [
    { kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "rollout-draft" },
  ]);
});

/** The task's page drawn editable, as a task's own page is, its editor's bundle not yet landed so that an editor opened is its host alone. */
function drawnEditable(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onSideBundles(
        unlandedBundles(),
        createElement(PlanBody, {
          task: TASK,
          live: false,
          onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
          sectionLinks: { workspace: WORKSPACE, onOpen: () => undefined, reveal: undefined },
        }),
      ),
    ),
  );
  return container;
}

test("copying a section's link from its ⋯ opens no editor, as a click into its words does", async () => {
  const container = drawnEditable();
  const rollout = [...container.querySelectorAll<HTMLElement>(".plan-unit-attributed")].find(
    (unit) => unit.textContent?.startsWith("Rollout"),
  );
  const more = rollout?.querySelector<HTMLButtonElement>(".plan-unit-more button");
  assert.ok(more);

  act(() => more.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link",
  );
  assert.ok(item);
  await act(async () => item.click());
  const afterCopy = container.querySelector(".plan-document-editor");
  act(() =>
    rollout
      ?.querySelector("p:not(.markdown-heading)")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );

  assert.equal(afterCopy, null);
  assert.notEqual(container.querySelector(".plan-document-editor"), null);
});

test("only the ⋯ beside the document's one Tab stop is a Tab stop", () => {
  const container = drawnEditable();

  const stops = [...container.querySelectorAll<HTMLElement>(".plan-unit-more button")].filter(
    (more) => more.tabIndex === 0,
  );

  assert.ok(stops.length <= 1, `${stops.length} of the ⋯ are Tab stops`);
});

test("on a plan that cannot be edited, where no block is a Tab stop, every section's ⋯ is one", () => {
  const { container } = drawn();

  const mores = [...container.querySelectorAll<HTMLElement>(SECTION_MORE)];

  assert.equal(mores.length, 3);
  assert.ok(mores.every((more) => more.tabIndex === 0));
});

/** A plan whose words mention a file and a folder of its repository. */
const FILES_TASK: Task = {
  ...TASK,
  document: {
    body: "## Goal\nMove [@session-store.ts](luke://file/apps/web/session-store.ts) out of [@auth/](luke://folder/apps/web/auth/).",
    assumptions: [],
  },
};

function drawnFiles(
  onOpenFile: ((path: string, lines: MentionLines | undefined) => void) | undefined,
  task: Task = FILES_TASK,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanBody, {
        task,
        live: false,
        sectionLinks: {
          workspace: WORKSPACE,
          onOpen: () => undefined,
          onOpenFile,
          reveal: undefined,
        },
      }),
    ),
  );
  return container;
}

test("a mention of a file is drawn as its chip, and a press opens the file's tab", () => {
  const opened: string[] = [];
  const container = drawnFiles((path) => opened.push(path));

  act(() => chipNamed(container, "session-store.ts").click());

  assert.deepEqual(opened, ["apps/web/session-store.ts"]);
});

test("a mention of a file as its page on GitHub opens its tab, at the lines it pins where it pins them, and another repository's page opens none", () => {
  const task: Task = {
    ...TASK,
    repository: PLACE.repository,
    document: {
      body: [
        "## Goal",
        "Move [@session-store.ts](https://github.com/acme/relay/blob/HEAD/apps/web/session-store.ts)",
        "as [@session-store.ts:3](https://github.com/acme/relay/blob/0123456/apps/web/session-store.ts#L3-L5) does,",
        "not as [@other.ts](https://github.com/acme/other/blob/HEAD/other.ts) does.",
      ].join("\n"),
      assumptions: [],
    },
  };
  const opened: [string, MentionLines | undefined][] = [];
  const onGitHub: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, openGitHub: (url) => onGitHub.push(url) });
  const container = drawnFiles((path, lines) => opened.push([path, lines]), task);

  act(() => chipNamed(container, "session-store.ts").click());
  act(() => chipNamed(container, "session-store.ts:3").click());
  // Another repository's file is no file of the task's, but GitHub's own page, which opens there rather than in a tab.
  act(() => chipNamed(container, "other.ts").click());

  assert.deepEqual(opened, [
    ["apps/web/session-store.ts", undefined],
    ["apps/web/session-store.ts", { commit: "0123456", startLine: 3, endLine: 5 }],
  ]);
  assert.deepEqual(onGitHub, ["https://github.com/acme/other/blob/HEAD/other.ts"]);
});

test("a heading the plan bears twice: a mention of the second opens the second, and each ⋯ copies its own", async () => {
  const task: Task = {
    ...TASK,
    document: {
      body: `## Notes\nfirst\n\n## Notes\nsecond, see [@Notes](https://tryluke.dev/acme/plan/${TASK_ID}#notes-1)`,
      assumptions: [],
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const opened: Mention[] = [];
  act(() =>
    root.render(
      createElement(PlanBody, {
        task,
        live: false,
        sectionLinks: {
          workspace: WORKSPACE,
          onOpen: (mention) => opened.push(mention),
          reveal: undefined,
        },
      }),
    ),
  );

  act(() => chipNamed(container, "Notes").click());
  for (const more of container.querySelectorAll<HTMLButtonElement>(SECTION_MORE)) {
    act(() => more.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Copy link",
    );
    assert.ok(item);
    await act(async () => item.click());
  }

  assert.deepEqual(opened, [{ kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "notes-1" }]);
  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${TASK_ID}#notes`,
    `https://tryluke.dev/acme/plan/${TASK_ID}#notes-1`,
  ]);
});

test("a folder's chip, and a file's where no file opens from here, hang their cards and open nothing", () => {
  const container = drawnFiles(undefined);

  const chips = [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")];

  assert.deepEqual(
    chips.map((chip) => [chip.textContent, chip.tagName]),
    [
      ["session-store.ts", "SPAN"],
      ["auth/", "SPAN"],
    ],
  );
});

test("a click on a folder's chip in a plan that can be edited opens no editor", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanBody, {
        task: FILES_TASK,
        live: false,
        onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
        sectionLinks: {
          workspace: WORKSPACE,
          onOpen: () => undefined,
          onOpenFile: () => undefined,
          reveal: undefined,
        },
      }),
    ),
  );
  const folder = [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")].find(
    (chip) => chip.textContent === "auth/",
  );
  assert.ok(folder);

  act(() => folder.dispatchEvent(new MouseEvent("click", { bubbles: true })));

  assert.equal(container.querySelector(".plan-document-editor"), null);
});

/** The task's page drawn as a task's own page is, its title renamed and its versions opened, each kept. */
function drawnTitled() {
  const renamed: string[] = [];
  const histories: (number | undefined)[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanBody, {
        task: TASK,
        live: false,
        onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
        onRename: (name) => {
          renamed.push(name);
          return Promise.resolve(true);
        },
        onShowHistory: (save) => histories.push(save),
        sectionLinks: { workspace: WORKSPACE, onOpen: () => undefined, reveal: undefined },
      }),
    ),
  );
  const block = container.querySelector<HTMLElement>('[role="group"][aria-label="Title"]');
  const more = container.querySelector<HTMLButtonElement>('[aria-label="Title actions"]');
  assert.ok(block, "the title is a block");
  assert.ok(more, "the title has a ⋯");
  return { container, block, more, renamed, histories };
}

/** The open menu's items, by what each says. */
function menuLabels(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].map(
    (item) => item.textContent ?? "",
  );
}

function chooseItem(label: string): Promise<void> {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.textContent === label,
  );
  assert.ok(item, `the menu offers ${label}`);
  return act(async () => item.click());
}

test("the title's ⋯ is a section's: in its row, shown while the keyboard is on the title, the Tab stop after it, and its menu takes focus and hands it back on Escape", () => {
  const { block, more } = drawnTitled();
  // The unit whose hover or focus shows its ⋯, as a section's does.
  const unit = more.closest(".plan-unit-attributed");
  assert.ok(unit, "the ⋯ stands in a unit");
  assert.ok(unit.contains(block), "the ⋯ stands in the title's unit");
  // Note that focus is read once, because jsdom's selector engine holds a `:focus-within` answer.
  const before = unit.contains(document.activeElement);
  act(() => block.focus());

  assert.equal(before, false);
  assert.equal(unit.matches(":focus-within"), true, "the ⋯ stands while the title is selected");
  assert.equal(more.closest(".plan-unit-row")?.parentElement, block.parentElement);
  assert.equal(block.tabIndex, 0);
  assert.equal(more.tabIndex, 0);
  assert.ok(block.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING);

  act(() => more.click());
  const first = document.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]');
  assert.deepEqual(menuLabels(), ["Copy link", "Rename", "Version history"]);
  assert.equal(document.activeElement, first, "the menu opens on its first item");
  act(() => {
    first?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  assert.equal(document.activeElement, more, "Escape hands focus back to the ⋯");
});

test("the title's ⋯ copies the plan's link, its Rename puts the caret in the title, and its Version history opens the plan as it stands", async () => {
  const { container, more, histories } = drawnTitled();

  act(() => more.click());
  await chooseItem("Copy link");
  act(() => more.click());
  await chooseItem("Rename");
  const typing = document.activeElement;
  act(() => more.click());
  await chooseItem("Version history");

  assert.deepEqual(copied, [`https://tryluke.dev/acme/plan/${TASK_ID}`]);
  assert.equal(typing, container.querySelector('[role="textbox"][aria-label="Task name"]'));
  assert.deepEqual(histories, [undefined]);
});

test("on a plan that cannot be edited, the title's ⋯ is a Tab stop offering its link alone", () => {
  const { container } = drawn();
  const more = container.querySelector<HTMLButtonElement>('[aria-label="Title actions"]');
  assert.ok(more);

  act(() => more.click());

  assert.equal(more.tabIndex, 0);
  assert.deepEqual(menuLabels(), ["Copy link"]);
});
