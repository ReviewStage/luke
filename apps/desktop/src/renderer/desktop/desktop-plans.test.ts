// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { TRANSCRIPT_REGION } from "../planning/transcript-model";
import { NO_LOOKS } from "../planning/use-plan-looks";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
import "../file-tree/index";
import { DesktopPlans } from "./desktop-plans";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "", assumptions: [] },
};

test("the Call tab draws each call's spoken lines as the developer's bubbles and Luke's messages, left out of the screen recording", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.CALL },
        transcript: {
          region: {
            kind: TRANSCRIPT_REGION.READY,
            earlierOmitted: false,
            calls: [
              {
                key: "call-1",
                startedAt: 1_000,
                live: true,
                lukeEnded: false,
                messages: [
                  {
                    id: "0",
                    role: "user",
                    parts: [{ type: "text", text: "Invites should expire." }],
                  },
                  {
                    id: "1",
                    role: "assistant",
                    parts: [{ type: "text", text: "After how many days?" }],
                  },
                ],
              },
            ],
          },
          onRetry: () => undefined,
        },
      }),
    }),
  );

  const page = document.createElement("div");
  page.innerHTML = markup;
  const call = page.querySelector('section.plan-call.ph-no-capture[aria-label="Call"]');
  assert.ok(call, "the Call tab, left out of the recording");
  // The developer's line a bubble of their own, Luke's an assistant's message, as an agent's tab draws them.
  assert.deepEqual(
    [...call.querySelectorAll(".is-user, .is-assistant")].map((message) => [
      message.classList.contains("is-user") ? "user" : "assistant",
      message.querySelector("p")?.textContent,
    ]),
    [
      ["user", "Invites should expire."],
      ["assistant", "After how many days?"],
    ],
  );
  assert.match(call.textContent ?? "", /Live/u);
});
