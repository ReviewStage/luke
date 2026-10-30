// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentTranscriptMessage } from "@luke/features/agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";
import { OpenHereProvider } from "./use-open-link.js";

/**
 * pull-request-call.test.ts -- a pull request an agent was refused is a fold
 * that says it opened none and shows the reason.
 */

const roots: Root[] = [];

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const OPEN = {
  head: "feat/export",
  title: "feat(billing): export invoices",
  body: "Adds the export.",
};

/** The agent's turn holding the one `open_pull_request` call, drawn with the links its place opens recorded. */
function drawn(output: WireRecord | undefined) {
  const message: AgentTranscriptMessage = {
    id: "turn",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      {
        type: "tool-open_pull_request",
        toolCallId: "call-open",
        state: output === undefined ? "input-available" : "output-available",
        input: OPEN,
        ...(output === undefined ? undefined : { output }),
      },
    ],
  };
  const links: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        OpenHereProvider,
        {
          value: (href: string) => {
            links.push(href);
            return true;
          },
        },
        createElement(AgentMessage, {
          message,
          plan: false,
          lead: AGENT_LEAD,
          moving: false,
          delegation: { models: [], onOpenTarget: () => undefined },
        }),
      ),
    ),
  );
  return { container, links };
}

test("a refused pull request is a fold that says it opened none and shows the reason", () => {
  const reason = "A pull request already exists for feat/export.";
  const { container, links } = drawn({ status: "rejected", reason });
  assert.equal(container.querySelector("button[data-opens]"), null, "no row opens a tab");
  const row = container.querySelector("summary");
  assert.ok(row, "the row is a fold's line");
  assert.equal(row.textContent?.trim(), `Could not open pull request ${OPEN.title}`);
  act(() => row.click());
  assert.ok(container.textContent?.includes(reason), "the body shows the reason");
  assert.deepEqual(links, []);
});
