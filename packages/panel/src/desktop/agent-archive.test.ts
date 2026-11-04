// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@repo/brand";
import { AGENT_ARCHIVER, AGENT_STATUS, type AgentArchivedBy } from "@repo/features/agent-wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { agentsControl } from "../testing/tasks-control.js";
import { ArchivedAgents } from "./agent-archive.js";

/**
 * agent-archive.test.ts -- an archived agent's row under the summary's
 * Archived fold hangs the agent's tab's card, saying it was archived, and
 * by whom and why where the service said; a press on it opens the agent,
 * whose tab is gone; and its Unarchive is busy while the service answers.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  // Note that the fold is kept in the window's storage, so each test starts with it folded.
  window.localStorage.clear();
});

/** A summary's Archived fold, its one archived agent drawn over a registry of its own, `onOpen` hearing a row opened. */
function drawArchived(onOpen: (agentId: string) => void = () => undefined): HTMLElement {
  const agents = agentsControl({
    archived: [
      {
        id: "agent-8",
        planId: "plan-1",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: "Retry audit",
        createdAt: 1,
        status: AGENT_STATUS.CANCELED,
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
      onRegistry(
        AtomRegistry.make(),
        createElement(ArchivedAgents, { agents, shown: true, onOpen }),
      ),
    ),
  );
  return container;
}

test("an unfolded Archived stands open as the summary is drawn again, and one never unfolded stays folded", () => {
  const fold = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  const first = drawArchived();
  assert.equal(fold(first)?.getAttribute("aria-expanded"), "false");
  act(() => fold(first)?.click());
  assert.equal(fold(first)?.getAttribute("aria-expanded"), "true");

  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  const again = drawArchived();
  assert.equal(fold(again)?.getAttribute("aria-expanded"), "true", "it stands as it was left");
  act(() => fold(again)?.click());

  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  assert.equal(fold(drawArchived())?.getAttribute("aria-expanded"), "false", "and folded again");
});

test("an archived agent's row hangs its tab's card beside it, its name and when it was archived", () => {
  const container = drawArchived();
  const fold = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  act(() => fold?.click());
  const row = container.querySelector<HTMLElement>(
    '[aria-label="Archived agents"] .ui-list-row-main',
  );
  assert.ok(row, "the archived agent is listed");
  restOn(row);
  const card = document.querySelector(".ui-tooltip-card [data-agent-card]");
  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "Retry audit");
  assert.match(card?.querySelector(".ui-hover-card-corner")?.textContent ?? "", /^Archived · /u);
});

test("a press on an archived agent's row opens it, whose tab is gone", () => {
  const opened: string[] = [];
  const container = drawArchived((agentId) => opened.push(agentId));
  act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
  const row =
    container.querySelector<HTMLButtonElement>(
      '[aria-label="Archived agents"] .ui-list-row-main',
    ) ?? assert.fail("the archived agent is listed");
  act(() => row.click());
  assert.deepEqual(opened, ["agent-8"]);
});

/** The notes the card hung over the archived agent's row says, with the reader and who archived it given. */
function archivedCardNotes(me: string | undefined, archivedBy: AgentArchivedBy): string[] {
  // Note that each draw unfolds Archived afresh, so the fold the last one kept is let go.
  window.localStorage.clear();
  const agents = {
    ...agentsControl({
      archived: [
        {
          id: "agent-8",
          planId: "plan-1",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: "Retry audit",
          createdAt: 1,
          status: AGENT_STATUS.COMPLETED,
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
      onRegistry(
        AtomRegistry.make(),
        createElement(ArchivedAgents, { agents, shown: true, onOpen: () => undefined }),
      ),
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
  const row = container.querySelector<HTMLElement>(
    '[aria-label="Archived agents"] .ui-list-row-main',
  );
  restOn(row ?? assert.fail("the row is drawn"));
  return [
    ...document.querySelectorAll(".ui-tooltip-card [data-agent-card] .ui-hover-card-note"),
  ].map((note) => note.textContent ?? "");
}

test("an archived agent's card says who archived it, an agent or Vespin for a member, the reader as you, the reason given, and an archive made with its task", () => {
  const dean = { userId: "user-dean", name: "Dean Stratakos" };
  const byAgent = archivedCardNotes("user-sam", {
    by: AGENT_ARCHIVER.AGENT,
    member: dean,
    agent: { id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", name: "Bill by seat" },
    reason: "Its pull request merged.",
  });
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  const byApp = archivedCardNotes("user-dean", { by: AGENT_ARCHIVER.APP, member: dean });
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  const withTask = archivedCardNotes("user-sam", {
    by: AGENT_ARCHIVER.MEMBER,
    member: dean,
    withTask: true,
  });

  assert.deepEqual(byAgent, [
    "Archived by Bill by seat for Dean Stratakos",
    "Its pull request merged.",
  ]);
  assert.deepEqual(byApp, ["Archived by Vespin for you"]);
  assert.deepEqual(withTask, ["Archived with its task by Dean Stratakos"]);
});

test("an archived agent's Unarchive is named Unarchiving while the service answers, shows its ring once the settle delay has passed, and clears when it answers", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let answer: () => void = () => undefined;
    let unarchives = 0;
    const agents = agentsControl({
      archived: [
        {
          id: "agent-8",
          planId: "plan-1",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: "Retry audit",
          createdAt: 1,
          status: AGENT_STATUS.COMPLETED,
          turnId: null,
          archivedAt: 2,
        },
      ],
      onArchive: () => {
        unarchives += 1;
        return new Promise((resolve) => {
          answer = () => resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
        });
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(ArchivedAgents, { agents, shown: true, onOpen: () => undefined }),
        ),
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
    const unarchive =
      container.querySelector<HTMLButtonElement>(".ui-list-row-actions button") ??
      assert.fail("the Unarchive");
    const ring = () => unarchive.querySelector(".ui-spinner-ring") !== null;

    act(() => unarchive.click());
    assert.equal(unarchive.getAttribute("aria-label"), "Unarchiving");
    assert.equal(ring(), false);
    act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE));
    assert.equal(ring(), true);
    act(() => unarchive.click());
    assert.equal(unarchives, 1, "a second press waits for the first");
    await act(async () => answer());
    assert.equal(unarchive.getAttribute("aria-label"), "Unarchive");
    assert.equal(ring(), false);
  } finally {
    vi.useRealTimers();
  }
});
