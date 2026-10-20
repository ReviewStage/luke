// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_STATUS,
  type CodingAgentArchivedBy,
} from "@luke/features/coding-agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { ArchivedAgents } from "./agent-archive.js";

/**
 * agent-archive.test.ts -- an archived agent's row under the summary's
 * Archived fold hangs the agent's tab's card, saying it was archived, and
 * by whom and why where the service said; and its Unarchive takes no room
 * at rest with a mouse, coming in over the row's end in its failed mark's
 * place only while the row is hovered or reached from the keyboard, as the
 * sidebar task rows' Pin and Archive do, while a touch screen shows it at
 * rest. jsdom matches no `:hover` and lays nothing out, so the sheets are
 * laid for the device (`testing/container-width.ts`) with a hover read off
 * a `data-hovered` mark and `:focus-visible` read as `:focus`, which jsdom
 * never matches either, and the room the row gives up is read off its
 * right padding.
 */

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.innerHTML = "";
});

test("an archived agent's row hangs its tab's card beside it, its name and when it was archived", () => {
  const agents = codingAgentsControl({
    archived: [
      {
        id: "agent-8",
        planId: "plan-1",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: "Retry audit",
        createdAt: 1,
        status: CODING_AGENT_STATUS.CANCELLED,
        turnId: null,
        archivedAt: 2,
      },
    ],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(ArchivedAgents, { agents, shown: true })),
    ),
  );
  const fold = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  act(() => fold?.click());
  const row = container.querySelector<HTMLElement>(
    ".task-summary-archived-agent .task-summary-row",
  );
  assert.ok(row, "the archived agent is listed");
  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Retry audit");
  assert.match(card?.querySelector(".luke-hover-card-corner")?.textContent ?? "", /^Archived · /u);
});

/** The notes the card hung over the archived agent's row says, with the reader and who archived it given. */
function archivedCardNotes(me: string | undefined, archivedBy: CodingAgentArchivedBy): string[] {
  const agents = {
    ...codingAgentsControl({
      archived: [
        {
          id: "agent-8",
          planId: "plan-1",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: "Retry audit",
          createdAt: 1,
          status: CODING_AGENT_STATUS.COMPLETED,
          turnId: null,
          archivedAt: 2,
          archivedBy,
        },
      ],
    }),
    me,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(ArchivedAgents, { agents, shown: true })),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
  const row = container.querySelector<HTMLElement>(
    ".task-summary-archived-agent .task-summary-row",
  );
  act(() => {
    row?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return [
    ...document.querySelectorAll(".luke-tooltip-card [data-tab-card] .luke-hover-card-note"),
  ].map((note) => note.textContent ?? "");
}

test("an archived agent's card says who archived it, an agent or Luke for a member, the reader as you, the reason given, and an archive made with its task", () => {
  const dean = { userId: "user-dean", name: "Dean Stratakos" };
  const byAgent = archivedCardNotes("user-sam", {
    by: CODING_AGENT_ARCHIVER.AGENT,
    member: dean,
    agent: { id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", name: "Bill by seat" },
    reason: "Its pull request merged.",
  });
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  const byLuke = archivedCardNotes("user-dean", { by: CODING_AGENT_ARCHIVER.LUKE, member: dean });
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  const withTask = archivedCardNotes("user-sam", {
    by: CODING_AGENT_ARCHIVER.MEMBER,
    member: dean,
    withTask: true,
  });

  assert.deepEqual(byAgent, [
    "Archived by Bill by seat for Dean Stratakos",
    "Its pull request merged.",
  ]);
  assert.deepEqual(byLuke, ["Archived by Luke for you"]);
  assert.deepEqual(withTask, ["Archived with its task by Dean Stratakos"]);
});

/** A failed archived agent's row drawn under the panel's sheets laid for a touch screen or a mouse, its fold opened: the row, its words' box, its failed mark, and its Unarchive. */
function archivedRowLaid(touch: boolean) {
  laid = layContainersAt({}, { touch });
  laid.textContent = (laid.textContent ?? "")
    .replaceAll(":hover", "[data-hovered]")
    .replaceAll(":focus-visible", ":focus");
  const agents = codingAgentsControl({
    archived: [
      {
        id: "agent-8",
        planId: "plan-1",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: "Retry audit",
        createdAt: 1,
        status: CODING_AGENT_STATUS.FAILED,
        turnId: null,
        archivedAt: 2,
      },
    ],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(ArchivedAgents, { agents, shown: true })),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
  const part = (selector: string) =>
    container.querySelector<HTMLElement>(selector) ?? assert.fail(selector);
  return {
    item: part(".task-summary-archived-agent"),
    row: part(".task-summary-row"),
    mark: part(".failed-mark"),
    unarchive: part(".task-summary-marks"),
  };
}

/** Whether the row keeps room at its end for its Unarchive. */
function roomKept(row: HTMLElement): boolean {
  return getComputedStyle(row).paddingRight.includes("--sidebar-plan-mark");
}

/** Whether the Unarchive is drawn to be seen and pressed. */
function offered(unarchive: HTMLElement): boolean {
  const style = getComputedStyle(unarchive);
  return style.opacity === "1" && style.pointerEvents !== "none";
}

test("with a mouse an archived agent's row at rest keeps no room for its Unarchive, which takes no press, and shows its failed mark", () => {
  const { row, mark, unarchive } = archivedRowLaid(false);

  assert.ok(!roomKept(row), "the name runs the row's full width");
  assert.ok(!offered(unarchive));
  assert.equal(getComputedStyle(unarchive).pointerEvents, "none");
  assert.notEqual(getComputedStyle(mark).display, "none");
});

test("with a mouse a hovered archived agent's row brings its Unarchive in its failed mark's place, its name giving up that room", () => {
  const { item, row, mark, unarchive } = archivedRowLaid(false);
  act(() => {
    for (let at: Element | null = item; at !== null; at = at.parentElement) {
      at.setAttribute("data-hovered", "");
    }
  });

  assert.ok(roomKept(row));
  assert.ok(offered(unarchive));
  assert.equal(getComputedStyle(mark).display, "none", "the mark leaves no gap");
});

test("an archived agent's row reached from the keyboard brings its Unarchive in its failed mark's place", () => {
  const { row, mark, unarchive } = archivedRowLaid(false);
  const button = unarchive.querySelector("button") ?? assert.fail("the Unarchive");
  act(() => button.focus());

  assert.ok(roomKept(row));
  assert.ok(offered(unarchive));
  assert.equal(getComputedStyle(mark).display, "none");
});

test("on a touch screen an archived agent's row shows its Unarchive at rest, in the room it takes while hovered, in its failed mark's place", () => {
  const { row, mark, unarchive } = archivedRowLaid(true);

  assert.ok(roomKept(row));
  assert.ok(offered(unarchive));
  assert.equal(getComputedStyle(mark).display, "none");
});
