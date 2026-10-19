// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { taskHolder } from "@luke/panel/tasks/inbox-model";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ItemMark } from "./inbox-list";

/**
 * inbox-item-mark.test.ts -- an Inbox item whose agent was archived still
 * stands, and its row's mark wears the harness that agent ran on, read from
 * its task's agents, archived ones among them, since the task's row names
 * no archived agent. Synthetic task and agent.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const ARCHIVED = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const AT = 1_792_000_000_000;

/** The task as the list carries it: its row names no agent, the one that posted being archived. */
const TASK: TaskSummary = {
  id: TASK_ID,
  workspaceId: "workspace-acme",
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
  agents: { total: 0, working: 0, agents: [], pullRequestTotal: 0, pullRequests: [] },
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  fakeAppBridge({});
});

test("an item an archived agent posted wears the harness that agent ran on, read from its task's agents", async () => {
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> =>
      Promise.resolve(
        request.kind === ACT_KIND.CODING_AGENTS_LIST
          ? {
              status: ACT_OUTCOME_STATUS.DONE,
              value: {
                agents: [
                  {
                    id: ARCHIVED,
                    planId: TASK_ID,
                    model: "openai/gpt-6.1-sol",
                    effort: "high",
                    title: "Retired sweep",
                    createdAt: AT,
                    status: CODING_AGENT_STATUS.COMPLETED,
                    turnId: null,
                    archivedAt: AT,
                  },
                ],
              },
            }
          : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
      ),
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(ItemMark, {
          holder: taskHolder(TASK),
          agentId: ARCHIVED,
          models: undefined,
          readerId: undefined,
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });

  // Codex's mark is its picture.
  assert.ok(container.querySelector(".actor-mark img.harness-mark"), "the row wears Codex's mark");
});
