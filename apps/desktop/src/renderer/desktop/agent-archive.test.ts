// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/plans-control";
import { ArchivedAgents } from "./agent-archive";

/**
 * agent-archive.test.ts -- an archived agent's row under the summary's
 * Archived fold hangs the agent's tab's card, saying it was archived.
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
    ".plan-summary-archived-agent .plan-summary-row",
  );
  assert.ok(row, "the archived agent is listed");
  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".tab-card-name")?.textContent, "Retry audit");
  assert.match(card?.querySelector(".tab-card-time")?.textContent ?? "", /^Archived · /u);
});
