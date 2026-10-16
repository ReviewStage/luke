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
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl, plansControl } from "#testing/plans-control";
import { relayout } from "#testing/resize-observer";
import { fadedEdges, layFades } from "#testing/scroll-fade";
import { LinkWorkspaceProvider } from "../copy-link-item";
import type { PlansControl } from "../planning/use-plans-tab";
import {
  SummaryButton,
  type SummaryLayout,
  summaryHolds,
  TaskSummary,
  useSummaryLayout,
  useSummaryPin,
} from "./plan-summary";
import type { HeldTranscripts } from "./strip-tabs";

/**
 * plan-summary.test.ts -- the summary's pull request row hangs the Changes
 * card, whose agent opens through the door the plan hands it, the one that
 * gives the plan's column the keys, and whose card previews the running
 * agent's latest step while the plan's column shows that agent. A column too
 * narrow to spare the rail draws none, and the toolbar's button hangs the
 * card in its place. A plan with nothing to list draws neither the summary
 * nor its button. Synthetic agents and pull requests throughout.
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

/** The summary pinned beside the document, its card hung by nothing. */
const PINNED: SummaryLayout = {
  mode: "column",
  holds: true,
  wide: true,
  card: undefined,
  onToggle: () => undefined,
  onExpand: () => undefined,
  onDismiss: () => undefined,
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
  const base = plansControl();
  const plans = plansControl({
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
            plans,
            layout: PINNED,
            cardId: "summary-card",
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
    each.textContent?.includes("Pull request: Expiry job"),
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
  const row = [...page.querySelectorAll<HTMLElement>(".plan-summary-row")].find((each) =>
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

/** The plan's column as the shell lays it out: the toolbar's button over the summary, laid out by the column's own width. */
function PlanColumn({ plans }: { plans: PlansControl }): React.JSX.Element {
  const pin = useSummaryPin(true);
  const [column, setColumn] = useState<HTMLElement | null>(null);
  const layout = useSummaryLayout(pin, column, false, summaryHolds(plans, NO_INBOX));
  return createElement(
    "div",
    { ref: setColumn },
    createElement(SummaryButton, { layout, cardId: "summary-card" }),
    createElement(TaskSummary, {
      plans,
      layout,
      cardId: "summary-card",
      inbox: NO_INBOX,
      held: HELD,
      repository: "acme/relay",
      onOpenAgent: () => undefined,
    }),
  );
}

/** The column of `plans` drawn `width` pixels wide, and ways to lay it out again at another width or over other plans. */
function columnAt(width: number, plans: PlansControl = plansControl()) {
  const measured = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  measured.mockReturnValue(DOMRect.fromRect({ width }));
  const page = document.body.appendChild(document.createElement("div"));
  root = createRoot(page);
  const draw = (shown: PlansControl) =>
    act(() =>
      root?.render(onRegistry(AtomRegistry.make(), createElement(PlanColumn, { plans: shown }))),
    );
  draw(plans);
  return {
    page,
    rail: () => page.querySelector('aside[aria-label="Summary"]'),
    toggle: () => page.querySelector('button[aria-label$="summary"]'),
    redraw: draw,
    widen: (to: number) => {
      measured.mockReturnValue(DOMRect.fromRect({ width: to }));
      act(() => relayout());
    },
  };
}

test("a column too narrow to spare the rail draws none, and the toolbar's button hangs the whole summary as a card in its place", () => {
  const column = columnAt(280);
  assert.equal(column.rail(), null);

  const toggle =
    column.page.querySelector<HTMLButtonElement>('button[aria-label="Toggle summary"]') ??
    assert.fail("the toolbar's button stands");
  act(() => toggle.click());
  const card = document.querySelector('[role="dialog"][aria-label="Summary"]');
  assert.ok(card, "the card hangs");
  assert.ok(card.querySelectorAll(".plan-summary-row").length > 0, "the card lists the summary");
});

test("a column with room for the rail draws it, and one widened to that room draws it again", () => {
  assert.equal(columnAt(600).rail()?.getAttribute("data-mode"), "rail");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const column = columnAt(423);
  assert.equal(column.rail(), null);
  column.widen(480);
  assert.equal(column.rail()?.getAttribute("data-mode"), "rail");
});

test("the pinned summary's rows fade under the toolbar above it and over the call bar below it, rather than being sliced at either", () => {
  const { page } = mount("plan");
  const sheets = layFades();
  try {
    const summary = page.querySelector(".plan-summary") ?? assert.fail("the summary stands");
    assert.deepEqual(fadedEdges(summary), { top: true, bottom: true });
  } finally {
    sheets.remove();
  }
});

test("a plan with nothing yet to list draws no summary and no toolbar button, and both stand once it holds a row", () => {
  const listed = plansControl();
  const bare = plansControl({ sidePanel: { ...listed.sidePanel, used: [] } });
  for (const width of [1200, 600, 280]) {
    const column = columnAt(width, bare);
    assert.equal(column.rail(), null, `no summary at ${width}px`);
    assert.equal(column.toggle(), null, `no toolbar button at ${width}px`);
    act(() => root?.unmount());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  }

  const column = columnAt(1200, bare);
  column.redraw(listed);
  assert.equal(column.rail()?.getAttribute("data-mode"), "column");
  assert.ok(column.toggle(), "the toolbar's button stands");
});
