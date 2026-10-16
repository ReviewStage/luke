// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { AGENT_LEAD, AgentMessage } from "./agent-tab";

/**
 * origin-width.test.ts -- what a transcript opens on, the plan, an
 * automation's prompt, or a worker's task, is a card as wide as a sent
 * message: it stands in a sent message's own measure and spans all of it,
 * so its left edge lines up with a long sent message's. Synthetic throughout.
 */

/** The window's own stylesheet, which says how wide the card stands in its message. */
const DESKTOP_CSS = readFileSync(path.join(import.meta.dirname, "../styles/desktop.css"), "utf8");

const PLAN: CodingAgentMessage = {
  id: "plan",
  role: MESSAGE_ROLE.USER,
  parts: [
    { type: "text", text: "# Agent to agent communication\n\nLet one agent message another." },
  ],
};

const SENT: CodingAgentMessage = {
  id: "sent",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "Rebase on main before you push." }],
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function draw(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** One of the developer's messages as an agent's tab draws it, as the plan it opens on or as a line sent after. */
function message(input: { message: CodingAgentMessage; plan: boolean }): ReactElement {
  return createElement(AgentMessage, {
    ...input,
    lead: AGENT_LEAD,
    moving: false,
    delegation: undefined,
  });
}

test("the card a transcript opens on stands in a sent message's measure and spans all of it", () => {
  document.head.appendChild(document.createElement("style")).textContent = DESKTOP_CSS;
  const view = draw(
    createElement(
      "div",
      null,
      message({ message: PLAN, plan: true }),
      message({ message: SENT, plan: false }),
    ),
  );
  const card =
    view.querySelector<HTMLElement>("[data-plan-card]") ?? assert.fail("the card stands");
  const [origin, sent] = [...view.querySelectorAll<HTMLElement>(".is-user")];
  assert.ok(origin !== undefined && sent !== undefined, "both are sent messages");

  // The card's message is the sent message's, its measure and its right edge alike.
  assert.equal(card.parentElement, origin);
  const measure = (element: HTMLElement) =>
    [...element.classList].filter((name) => name !== "agent-origin");
  assert.deepEqual(measure(origin), measure(sent));
  // And the card is as wide as that measure, never a narrower width of its own.
  assert.equal(getComputedStyle(card).width, "100%");
});
