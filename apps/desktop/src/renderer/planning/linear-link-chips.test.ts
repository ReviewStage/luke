// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanSummary } from "@luke/features/plan-wire";
import { IDLE_PLANNING_VIEW } from "@luke/features/planning-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { signedInAs } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { PlanMentions, type PlanMentionsValue } from "./plan-mentions";
import { TranscriptWords } from "./transcript-blocks";

/**
 * linear-link-chips.test.ts -- a Linear issue's link in a plan's words says
 * what the workspace's own Linear answers for it: a bare link is called by
 * the issue's key and title, a labelled one keeps its label, and each says
 * the state the issue stands in. The issue is read by its identifier through
 * the plan's workspace, and nothing is asked where that workspace has no
 * Linear connected. Synthetic workspace, plan, and issue.
 */

const PLAN = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const AT = 1_792_000_000_000;
const ISSUE = "https://linear.app/acme/issue/ENG-1/start-a-plan-from-linear";

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

/** Acme, Linear not connected. */
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 2,
};

/** Acme with its Linear connected. */
const ACME_WITH_LINEAR: Workspace = { ...ACME, linear: { active: true } };

const TASK: PlanSummary = {
  id: PLAN,
  workspaceId: "workspace-acme",
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
};

/** Main's document holding the plan in Acme. */
function stateWith(workspace: Workspace): AppStateSnapshot {
  const snapshot = signedInAs({ id: "user-sam", email: "sam@example.com", name: "Sam Okafor" });
  return {
    ...snapshot,
    planning: { ...IDLE_PLANNING_VIEW, plans: [TASK], workspaces: [workspace] },
  };
}

/** The plan's page, as its words' chips stand on it. */
const PAGE: PlanMentionsValue = {
  planId: PLAN,
  planName: TASK.name,
  workspace: "acme",
  workspaceId: "workspace-acme",
  repository: "acme/relay",
  text: () => "",
  doors: {
    planId: PLAN,
    place: { workspace: "acme", repository: "acme/relay" },
    anchors: new Set(),
    onOpenPlan: () => undefined,
    onOpenFile: undefined,
  },
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The words drawn on the plan's page in a window holding `workspace`, and every act the window asked. */
async function drawn(text: string, workspace: Workspace) {
  const asked: Act[] = [];
  const state = stateWith(workspace);
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      onAppState: () => () => undefined,
      requestAppState: () => Promise.resolve(state),
      act: (request: Act): Promise<ActOutcome> => {
        asked.push(request);
        return Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_LINEAR_ISSUES
            ? {
                status: ACT_OUTCOME_STATUS.DONE,
                value: [
                  {
                    id: "issue-1",
                    identifier: "ENG-1",
                    title: "Start a plan from Linear",
                    url: ISSUE,
                    state: "In Progress",
                  },
                ],
              }
            : { status: ACT_OUTCOME_STATUS.DONE, value: undefined },
        );
      },
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(PlanMentions, {
          value: PAGE,
          children: createElement(TranscriptWords, { text }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return { container, asked };
}

/** Each chip drawn: the name it says and the state after it. */
function chips(container: HTMLElement): [string | null, string | null][] {
  return [...container.querySelectorAll<HTMLElement>(".mention-chip")].map((chip) => [
    chip.querySelector(".mention-chip-label")?.textContent ?? null,
    chip.querySelector(".mention-chip-state")?.textContent ?? null,
  ]);
}

test("a Linear issue's link says the issue's key, title, and state, as the plan's workspace's Linear answers them, a labelled one keeping its label", async () => {
  const { container, asked } = await drawn(
    `See ${ISSUE} and [the issue](${ISSUE}).`,
    ACME_WITH_LINEAR,
  );

  assert.deepEqual(chips(container), [
    ["ENG-1 Start a plan from Linear", "In Progress"],
    ["the issue", "In Progress"],
  ]);
  assert.deepEqual(
    asked
      .filter((each) => each.kind === ACT_KIND.WORKSPACE_LINEAR_ISSUES)
      .map((each) => each.payload),
    [
      { workspaceId: "workspace-acme", identifier: "ENG-1" },
      { workspaceId: "workspace-acme", identifier: "ENG-1" },
    ],
  );
});

test("where the workspace has no Linear connected, nothing is asked and the chip says what the address says", async () => {
  const { container, asked } = await drawn(`See ${ISSUE}.`, ACME);

  assert.deepEqual(chips(container), [["ENG-1/start-a-plan-from-linear", null]]);
  assert.deepEqual(
    asked.filter((each) => each.kind === ACT_KIND.WORKSPACE_LINEAR_ISSUES),
    [],
  );
});
