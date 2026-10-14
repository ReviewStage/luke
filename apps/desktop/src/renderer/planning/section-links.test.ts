// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  MENTION_KIND,
  type Mention,
  type MentionLines,
  mentionMarkdown,
} from "@luke/features/mention-link";
import type { Plan } from "@luke/features/plan-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { PlanBody, type SectionLinks } from "./plan-body";

/**
 * A plan's sections' links on its own page: a mention of a section drawn as
 * the chip that opens it, one of a heading the plan no longer holds struck
 * through and opening the plan at its top, a section's ⋯ copying its link,
 * an ask to show a section scrolling the document to it, and nothing a
 * mention names riding on an attribute. Mentions are read in the form
 * written before the link was settled as well as the settled one.
 * Synthetic plan.
 */

const PLAN_ID = DOCUMENT_PLAN.id;

/** The slug of the workspace the plan's links are written under. */
const WORKSPACE = "acme";

const PLACE = { workspace: WORKSPACE, repository: "acme/relay" } as const;

/** A plan whose last section mentions an earlier one, and one since renamed. */
const PLAN: Plan = {
  ...DOCUMENT_PLAN,
  document: {
    body: [
      "## Goal",
      "Invite a teammate by email.",
      "",
      "## Rollout",
      "Store first, then the desktop.",
      "",
      "## Notes",
      `Ship as [@Rollout](luke://plan/${PLAN_ID}#Rollout) says, after [@Old plan](luke://plan/${PLAN_ID}#Old%20plan).`,
    ].join("\n"),
    assumptions: [],
  },
};

const roots: Root[] = [];
const copied: string[] = [];

beforeEach(() => {
  copied.length = 0;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        if (request.kind !== ACT_KIND.WINDOW_COPY_TEXT) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
        }
        copied.push(request.payload.words);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The plan's page drawn with its sections' links, the mentions it was asked to open kept. */
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
  act(() => root.render(createElement(PlanBody, { plan: PLAN, live: false, sectionLinks })));
  return { container, opened };
}

function chipNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const chip = [...container.querySelectorAll<HTMLButtonElement>(".mention-chip")].find(
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
  assert.deepEqual(opened, [{ kind: MENTION_KIND.SECTION, planId: PLAN_ID, anchor: "rollout" }]);
});

test("a mention of a heading the plan no longer holds is struck through, and a press opens the plan at its top", () => {
  const { container, opened } = drawn();

  const chip = chipNamed(container, "Old plan");
  act(() => chip.click());

  assert.equal(chip.dataset.state, "gone");
  assert.deepEqual(opened, [{ kind: MENTION_KIND.PLAN, planId: PLAN_ID }]);
});

test("a section's ⋯ copies the section's link, which reads back as its mention", async () => {
  const { container } = drawn();

  const rollout = [...container.querySelectorAll<HTMLElement>(".plan-unit-attributed")].find(
    (unit) => unit.textContent?.startsWith("Rollout"),
  );
  const more = rollout?.querySelector<HTMLButtonElement>(".plan-unit-more");
  assert.ok(more, "the Rollout section has a ⋯");
  act(() => more.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link to section",
  );
  assert.ok(item, "the ⋯ offers to copy the section's link");
  await act(async () => item.click());

  assert.deepEqual(copied, [`[@Rollout](https://tryluke.dev/acme/plan/${PLAN_ID}#rollout)`]);
});

test("the plan's first words, under no heading, offer no link", () => {
  const { container } = drawn();

  const mores = container.querySelectorAll(".plan-unit-more");

  assert.equal(mores.length, 3, "one ⋯ for each of the three headed sections");
});

test("an ask to show a section scrolls the document to it, and an ask for one it no longer holds to its top", () => {
  const { container } = drawn();
  const scroller = container.querySelector<HTMLElement>(".plan-document-scroll");
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
    act(() => root.render(createElement(PlanBody, { plan: PLAN, live: false, sectionLinks })));
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

  act(() => root.render(createElement(PlanBody, { plan: PLAN, live: false })));

  assert.equal(container.querySelector(".mention-chip"), null);
  assert.equal(container.querySelector(".plan-unit-more"), null);
  assert.match(container.textContent ?? "", /Ship as @Rollout says/u);
});

test("a section whose heading is formatted is copied as a link that is drawn as its chip", () => {
  const heading = "Rollout *draft*";
  const plan: Plan = {
    ...PLAN,
    document: {
      body: `## ${heading}\nStore first.\n\n## Notes\nSee ${mentionMarkdown({ kind: MENTION_KIND.SECTION, planId: PLAN_ID, anchor: "rollout-draft" }, heading, PLACE)}.`,
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
        plan,
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
    { kind: MENTION_KIND.SECTION, planId: PLAN_ID, anchor: "rollout-draft" },
  ]);
});

/** The plan's page drawn editable, as a plan's own page is. */
function drawnEditable(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanBody, {
        plan: PLAN,
        live: false,
        onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
        sectionLinks: { workspace: WORKSPACE, onOpen: () => undefined, reveal: undefined },
      }),
    ),
  );
  return container;
}

test("copying a section's link from its ⋯ opens no editor, as a click into its words does", async () => {
  const container = drawnEditable();
  const rollout = [...container.querySelectorAll<HTMLElement>(".plan-unit-attributed")].find(
    (unit) => unit.textContent?.startsWith("Rollout"),
  );
  const more = rollout?.querySelector<HTMLButtonElement>(".plan-unit-more");
  assert.ok(more);

  act(() => more.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link to section",
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

  const stops = [...container.querySelectorAll<HTMLElement>(".plan-unit-more")].filter(
    (more) => more.tabIndex === 0,
  );

  assert.ok(stops.length <= 1, `${stops.length} of the ⋯ are Tab stops`);
});

test("on a plan that cannot be edited, where no block is a Tab stop, every section's ⋯ is one", () => {
  const { container } = drawn();

  const mores = [...container.querySelectorAll<HTMLElement>(".plan-unit-more")];

  assert.equal(mores.length, 3);
  assert.ok(mores.every((more) => more.tabIndex === 0));
});

/** A plan whose words mention a file and a folder of its repository. */
const FILES_PLAN: Plan = {
  ...PLAN,
  document: {
    body: "## Goal\nMove [@session-store.ts](luke://file/apps/web/session-store.ts) out of [@auth/](luke://folder/apps/web/auth/).",
    assumptions: [],
  },
};

function drawnFiles(
  onOpenFile: ((path: string, lines: MentionLines | undefined) => void) | undefined,
  plan: Plan = FILES_PLAN,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanBody, {
        plan,
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

test("a mention of a file as its page on GitHub opens its tab, at the lines it pins where it pins them", () => {
  const plan: Plan = {
    ...PLAN,
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
  const container = drawnFiles((path, lines) => opened.push([path, lines]), plan);

  act(() => chipNamed(container, "session-store.ts").click());
  act(() => chipNamed(container, "session-store.ts:3").click());

  assert.deepEqual(opened, [
    ["apps/web/session-store.ts", undefined],
    ["apps/web/session-store.ts", { commit: "0123456", startLine: 3, endLine: 5 }],
  ]);
  assert.equal(container.querySelectorAll(".mention-chip").length, 2);
});

test("a heading the plan bears twice: a mention of the second opens the second, and each ⋯ copies its own", async () => {
  const plan: Plan = {
    ...PLAN,
    document: {
      body: `## Notes\nfirst\n\n## Notes\nsecond, see [@Notes](https://tryluke.dev/acme/plan/${PLAN_ID}#notes-1)`,
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
        plan,
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
  for (const more of container.querySelectorAll<HTMLButtonElement>(".plan-unit-more")) {
    act(() => more.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Copy link to section",
    );
    assert.ok(item);
    await act(async () => item.click());
  }

  assert.deepEqual(opened, [{ kind: MENTION_KIND.SECTION, planId: PLAN_ID, anchor: "notes-1" }]);
  assert.deepEqual(copied, [
    `[@Notes](https://tryluke.dev/acme/plan/${PLAN_ID}#notes)`,
    `[@Notes](https://tryluke.dev/acme/plan/${PLAN_ID}#notes-1)`,
  ]);
});

test("a folder's chip, and a file's where no file opens from here, hang their cards and open nothing", () => {
  const container = drawnFiles(undefined);

  const chips = [...container.querySelectorAll<HTMLElement>(".mention-chip")];

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
        plan: FILES_PLAN,
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
  const folder = [...container.querySelectorAll<HTMLElement>(".mention-chip")].find(
    (chip) => chip.textContent === "auth/",
  );
  assert.ok(folder);

  act(() => folder.dispatchEvent(new MouseEvent("click", { bubbles: true })));

  assert.equal(container.querySelector(".plan-document-editor"), null);
});
