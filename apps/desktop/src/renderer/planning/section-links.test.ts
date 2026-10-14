// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MENTION_KIND, type Mention, mentionMarkdown } from "@sidecar/hosted/mention-link";
import type { Plan } from "@sidecar/hosted/plan-wire";
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
 * mention names riding on an attribute. Synthetic plan.
 */

const PLAN_ID = DOCUMENT_PLAN.id;

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
  assert.deepEqual(opened, [{ kind: MENTION_KIND.SECTION, planId: PLAN_ID, heading: "Rollout" }]);
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

  assert.deepEqual(copied, [`[@Rollout](luke://plan/${PLAN_ID}#Rollout)`]);
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

  render({ onOpen, reveal: { heading: "Rollout", ask: 1 } });
  const shown = scroller.scrollTop;
  render({ onOpen, reveal: { heading: "Old plan", ask: 2 } });

  assert.equal(shown, 600 - 16);
  assert.equal(scroller.scrollTop, 0);
});

test("no attribute of the plan's page carries what a mention names", () => {
  const { container } = drawn();

  for (const element of container.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      if (["aria-label", "title"].includes(attribute.name)) continue;
      assert.equal(attribute.value.includes("luke:"), false, attribute.name);
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
      body: `## ${heading}\nStore first.\n\n## Notes\nSee ${mentionMarkdown({ kind: MENTION_KIND.SECTION, planId: PLAN_ID, heading }, heading)}.`,
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
        sectionLinks: { onOpen: (mention) => opened.push(mention), reveal: undefined },
      }),
    ),
  );
  const chip = chipNamed(container, "Rollout draft");
  act(() => chip.click());

  assert.equal(chip.dataset.state, "found");
  assert.deepEqual(opened, [{ kind: MENTION_KIND.SECTION, planId: PLAN_ID, heading }]);
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
        sectionLinks: { onOpen: () => undefined, reveal: undefined },
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
