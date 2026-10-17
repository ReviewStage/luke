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
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/tasks-control";
import { ArchivedAgents } from "./agent-archive";

/**
 * agent-archive.test.ts -- an archived agent's row under the summary's
 * Archived fold hangs the agent's tab's card, saying it was archived, and
 * by whom and why where the service said.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
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
  assert.equal(card?.querySelector(".card-name")?.textContent, "Retry audit");
  assert.match(card?.querySelector(".card-corner")?.textContent ?? "", /^Archived · /u);
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
  return [...document.querySelectorAll(".luke-tooltip-card [data-tab-card] .card-note")].map(
    (note) => note.textContent ?? "",
  );
}

test("an archived agent's card says who archived it, an agent or Luke for a member, the reader as you, and the reason given", () => {
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

  assert.deepEqual(byAgent, [
    "Archived by Bill by seat for Dean Stratakos",
    "Its pull request merged.",
  ]);
  assert.deepEqual(byLuke, ["Archived by Luke for you"]);
});
