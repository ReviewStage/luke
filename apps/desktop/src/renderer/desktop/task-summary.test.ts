// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { fadedEdges, layFades } from "#testing/scroll-fade";
import { codingAgentsControl, tasksControl } from "#testing/tasks-control";
import { LinkWorkspaceProvider } from "../copy-link-item";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel";
import type { TasksControl } from "../tasks/use-tasks-tab";
import type { HeldTranscripts } from "./strip-tabs";
import { TaskSummary } from "./task-summary";

/**
 * task-summary.test.ts -- the summary's pull request row hangs the Changes
 * card, whose agent opens through the door the plan hands it, the one that
 * gives the plan's column the keys, and whose card previews the running
 * agent's latest step while the plan's column shows that agent. Drawn in the
 * side panel's Summary tab, it lists the panel's other kinds and never
 * itself, and a plan with nothing to list says so. Synthetic agents and pull
 * requests throughout.
 */

const RUN_STARTED = 5_000;

const AGENT: CodingAgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c99",
  runStartedAt: RUN_STARTED,
};

const PULL_REQUEST: CodingAgentPullRequest = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 210,
  deletions: 14,
  changedFiles: 6,
};

/** What the agent's tab last drew: its run's one step so far. */
const HELD: HeldTranscripts = {
  agents: new Map([
    [
      AGENT.id,
      {
        messages: [
          {
            id: "m1",
            role: "assistant",
            parts: [{ type: "text", text: "Writing the expiry tests." }],
          },
        ],
        status: CODING_AGENT_STATUS.RUNNING,
        runStartedAt: RUN_STARTED,
        title: undefined,
        subagentTitles: new Map(),
      },
    ],
  ]),
  workers: new Map(),
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The summary of a plan whose running agent opened the pull request, the plan's column showing `shown`; every agent it opens recorded. */
function mount(shown: "agent" | "plan", linkWorkspace?: string) {
  const opened: string[] = [];
  const base = tasksControl();
  const tasks = tasksControl({
    agents: codingAgentsControl({
      agents: [AGENT],
      agentIds: [AGENT.id],
      models: [],
      pullRequests: new Map([[AGENT.id, PULL_REQUEST]]),
    }),
    mainTabs: {
      ...base.mainTabs,
      tabs: [base.mainTabs.tab, { agent: AGENT.id }],
      tab: shown === "agent" ? { agent: AGENT.id } : base.mainTabs.tab,
    },
  });
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          LinkWorkspaceProvider,
          { value: linkWorkspace },
          createElement(TaskSummary, {
            tasks: tasks,
            inbox: { open: [], settled: [] },
            held: HELD,
            repository: "acme/relay",
            onOpenAgent: (agentId) => opened.push(agentId),
          }),
        ),
      ),
    ),
  );
  return { page, opened };
}

/** Rests the pointer on a control, which hangs its card. */
function hover(control: Element): void {
  act(() => {
    control.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
}

/** The agent named in the Changes card the pull request's row hangs. */
function cardAgent(page: HTMLElement): HTMLButtonElement {
  const row = [...page.querySelectorAll("button")].find((each) =>
    each.textContent?.includes("Changes: Expiry job"),
  );
  assert.ok(row, "the pull request has a row");
  hover(row);
  const named = document.querySelector<HTMLButtonElement>(
    '.tooltip-card .card-sub button.actor-ref[data-kind="agent"]',
  );
  assert.ok(named, "the Changes card names the agent");
  return named;
}

test("the agent a pull request row's card names opens through the plan's door, which hands its column the keys", () => {
  const { page, opened } = mount("plan");
  const named = cardAgent(page);
  act(() => named.click());
  assert.deepEqual(opened, [AGENT.id]);
});

test("the agent's card hung from a Changes card previews its running step while the plan's column shows the agent, and says none while it shows another tab", () => {
  const latestStep = (shown: "agent" | "plan") => {
    const { page } = mount(shown);
    hover(cardAgent(page));
    const words = [...document.querySelectorAll(".tooltip-card [data-tab-card]")]
      .map((card) => card.textContent ?? "")
      .join(" | ");
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    return words;
  };
  assert.match(latestStep("agent"), /Writing the expiry tests\./u);
  assert.doesNotMatch(latestStep("plan"), /Writing the expiry tests\./u);
});

test("an agent's row in the summary offers Copy link on a right-click, copying the agent's link under its task, before Archive agent", async () => {
  const copied: string[] = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        if (request.kind === ACT_KIND.WINDOW_COPY_TEXT) copied.push(request.payload.words);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
      recordSurfaceEvent: () => undefined,
    },
  });
  const { page } = mount("plan", "acme");
  const row = [...page.querySelectorAll<HTMLElement>(".task-summary-row")].find((each) =>
    each.textContent?.includes(AGENT.title ?? ""),
  );
  assert.ok(row, "the agent's row is listed");
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const labels = items.map((each) => each.textContent);
  const copy = items.find((each) => each.textContent === "Copy link");
  assert.ok(copy);
  await act(async () => copy.click());

  assert.deepEqual(labels, ["Copy link", "Archive agent"]);
  assert.deepEqual(copied, [`https://tryluke.dev/acme/plan/${AGENT.planId}/agent/${AGENT.id}`]);
});

/** What the plan's own inbox holds in these tests: nothing. */
const NO_INBOX = { open: [], settled: [] };

/** The Summary tab's content for `plans`, drawn alone. */
function drawSummary(plans: TasksControl): HTMLElement {
  const page = document.body.appendChild(document.createElement("div"));
  root = createRoot(page);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(TaskSummary, {
          tasks: plans,
          inbox: NO_INBOX,
          held: HELD,
          repository: "acme/relay",
          onOpenAgent: () => undefined,
        }),
      ),
    ),
  );
  return page;
}

test("the summary's rows fade under the panel's bar above them and at the panel's foot, rather than being sliced at either", () => {
  const { page } = mount("plan");
  const sheets = layFades();
  try {
    const summary = page.querySelector(".task-summary") ?? assert.fail("the summary stands");
    assert.deepEqual(fadedEdges(summary), { top: true, bottom: true });
  } finally {
    sheets.remove();
  }
});

test("the Summary tab lists the panel's other kinds, never itself, and each opens its tab in the panel", () => {
  const chosen: unknown[] = [];
  const base = tasksControl();
  const plans = tasksControl({
    sidePanel: {
      ...base.sidePanel,
      used: [SIDE_PANEL_TAB.SUMMARY, SIDE_PANEL_TAB.BOARD],
      onChoose: (tab) => chosen.push(tab),
    },
  });
  const page = drawSummary(plans);
  const rows = [...page.querySelectorAll<HTMLButtonElement>(".task-summary-row")];
  const labels = rows.map((row) => row.textContent);
  assert.deepEqual(labels, ["Board"]);
  act(() => rows[0]?.click());
  assert.deepEqual(chosen, [SIDE_PANEL_TAB.BOARD]);
});

test("a plan with nothing yet to list says so in the Summary tab, and lists its first row once it holds one", () => {
  const listed = tasksControl();
  const bare = tasksControl({ sidePanel: { ...listed.sidePanel, used: [] } });
  const page = drawSummary(bare);
  assert.equal(page.querySelector(".task-summary"), null);
  assert.match(page.textContent ?? "", /Nothing on this plan yet\./u);

  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(TaskSummary, {
          tasks: listed,
          inbox: NO_INBOX,
          held: HELD,
          repository: "acme/relay",
          onOpenAgent: () => undefined,
        }),
      ),
    ),
  );
  assert.ok(page.querySelectorAll(".task-summary-row").length > 0, "the summary lists its rows");
});
