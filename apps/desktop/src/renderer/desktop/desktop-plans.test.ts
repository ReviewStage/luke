// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import type { Plan } from "@sidecar/hosted/plan-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import {
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkState,
} from "@sidecar/hosted/planning-view";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { codingAgentsControl, plansControl } from "#testing/plans-control";
import { relayout } from "#testing/resize-observer";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { useAppKeymap, useMenuCommands } from "../app-commands";
import { COPY_SHOWN, DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { TRANSCRIPT_REGION } from "../planning/transcript-model";
import type { PlansControl } from "../planning/use-plans-tab";
import {
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelState,
  type SidePanelTab,
  useSidePanel,
} from "../planning/use-side-panel";
import { workerCallIds } from "../planning/work-model";
import { DesktopPlans } from "./desktop-plans";
import { SidePanelToggle } from "./side-panel";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const CODE: PlanCode = {
  ref: { path: "src/invite.ts", startLine: 1, endLine: 1 },
  repository: "acme/relay",
  firstLine: 1,
  lineCount: 1,
  lines: [[{ text: "export function accept() {}" }]],
};

const roots: Root[] = [];

/** How the page draws the panel. */
const PANEL = {
  HIDDEN: "hidden",
  BESIDE: "beside the document",
  FULL_SCREEN: "full screen",
} as const;

type PanelDrawn = (typeof PANEL)[keyof typeof PANEL];

/** What the toolbar's Copy was asked to do, across the presses and the chord. */
let copies = 0;

/**
 * The open plan's page over the real side panel, staged where a fixture run
 * would stage it, with the window's keymap and the panel's toggle the window
 * stands beside the page (desktop-shell.tsx).
 */
function Page({
  staged,
  work,
  agents,
}: {
  staged: SidePanelState | undefined;
  work?: PlansControl["work"] | undefined;
  agents?: PlansControl["agents"] | undefined;
}) {
  const sidePanel = useSidePanel(staged, undefined, workerCallIds(work?.turns));
  useAppKeymap(true);
  useMenuCommands(true);
  const page = createElement(DesktopPlans, {
    plans: plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN.id,
      region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
      sidePanel,
      copy: {
        shown: COPY_SHOWN.IDLE,
        onPress: () => {
          copies += 1;
        },
      },
      ...(work === undefined ? undefined : { work }),
      ...(agents === undefined ? undefined : { agents }),
    }),
  });
  return createElement(
    Fragment,
    null,
    page,
    createElement(SidePanelToggle, { panel: sidePanel, disabled: false }),
  );
}

/** A key pressed anywhere in the window, answering whether the window claimed it. */
function keydown(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function mountOpenPlan(
  options: {
    staged?: SidePanelState;
    work?: PlansControl["work"];
    agents?: PlansControl["agents"];
  } = {},
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Page, { ...options, staged: options.staged })));
  return container;
}

/** Renders the last mounted page again, as the first state arriving a render in renders it. */
function restage(staged: SidePanelState | undefined): void {
  const root = roots.at(-1);
  assert.ok(root, "no page to render again");
  act(() => root.render(createElement(Page, { staged })));
}

function unmountAll(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
}

function press(page: HTMLElement, selector: string): void {
  const control = page.querySelector<HTMLElement>(selector);
  assert.ok(control, `nothing to press at ${selector}`);
  act(() => control.click());
}

function tabNamed(page: HTMLElement, label: string): HTMLElement {
  const tab = [...page.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (each) => each.textContent === label,
  );
  assert.ok(tab, `no ${label} tab`);
  return tab;
}

/** The pointer arriving on a control, answering the pill it raised, if any. */
function hover(control: HTMLElement): string | undefined {
  act(() => {
    control.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return document.body.querySelector('[role="tooltip"]')?.textContent ?? undefined;
}

function documentShown(page: HTMLElement): boolean {
  const body = page.querySelector(`.desktop-document[aria-label="${PLAN.name}"] .plan-body`);
  return body !== null && body.closest("[hidden]") === null;
}

function resizeEdge(page: HTMLElement): HTMLElement {
  const edge = page.querySelector<HTMLElement>('[role="separator"]');
  assert.ok(edge, "no resize edge");
  return edge;
}

function panelDrawn(page: HTMLElement): PanelDrawn {
  const panel = page.querySelector(".side-panel");
  if (panel === null) return PANEL.HIDDEN;
  return panel.getAttribute("data-full-screen") === "true" ? PANEL.FULL_SCREEN : PANEL.BESIDE;
}

/**
 * Drags the edge from `from` through each of `through`, releasing at the
 * last, reading how the panel is drawn at each stop. Once a snap has taken
 * the edge away, the pointer is over the page, as it would be in the window.
 */
function dragEdge(page: HTMLElement, from: number, through: number[]): PanelDrawn[] {
  const edge = resizeEdge(page);
  const pointer = (type: string, clientX: number) =>
    act(() => {
      const target = edge.isConnected ? edge : page;
      target.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }));
    });
  pointer("pointerdown", from);
  const drawn = through.map((x) => {
    pointer("pointermove", x);
    return panelDrawn(page);
  });
  pointer("pointerup", through.at(-1) ?? from);
  return drawn;
}

/** Lays the plan's area out this wide, the document beside the panel included; jsdom lays out nothing. */
function layOutPlanArea(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("desktop-plan") ? width : 0 });
  });
}

function pointer(page: HTMLElement, type: string, pointerId: number, clientX: number): void {
  const edge = resizeEdge(page);
  act(() => {
    edge.dispatchEvent(new PointerEvent(type, { clientX, pointerId, bubbles: true }));
  });
}

function key(target: HTMLElement, name: string): void {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })));
}

function panelShown(page: HTMLElement): boolean {
  return page.querySelector(".side-panel") !== null;
}

/** The menu bar's one listener, as the bridge hands it to the window. */
let menuListener: ((command: AppCommand) => void) | undefined;

beforeEach(() => {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onMenuCommand: (listener: (command: AppCommand) => void) => {
        menuListener = listener;
        return () => {
          menuListener = undefined;
        };
      },
    },
  });
  // The whiteboard bundle already loaded, as it is once a board has been shown in this window.
  window.lukeWhiteboard = {
    mount: () => ({ show: () => undefined, scene: () => undefined, unmount: () => undefined }),
    render: () => Promise.resolve(undefined),
  };
  // jsdom captures no pointer; the drag's own events are dispatched at the edge.
  HTMLElement.prototype.setPointerCapture = () => undefined;
});

afterEach(() => {
  unmountAll();
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  copies = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

test("a first launch shows the document alone, its toolbar ending at the plan's menu and the panel shut", () => {
  const page = mountOpenPlan();

  assert.ok(documentShown(page));
  assert.equal(page.querySelector(".side-panel"), null);
  const last = page.querySelector(".desktop-toolbar-actions")?.lastElementChild;
  assert.equal(last?.getAttribute("aria-label"), "Plan actions");
  assert.equal(page.querySelector(".desktop-toolbar .side-panel-toggle"), null);
  assert.equal(
    page.querySelector('[aria-label="Show panel"]')?.getAttribute("aria-expanded"),
    "false",
  );
});

test("the toggle opens the panel on the board and closes it, the document shown throughout", () => {
  const page = mountOpenPlan();

  press(page, '[aria-label="Show panel"]');
  assert.ok(documentShown(page));
  assert.equal(tabNamed(page, "Board").getAttribute("aria-selected"), "true");
  assert.ok(page.querySelector(".side-panel .plan-board"));

  press(page, '[aria-label="Hide panel"]');
  assert.ok(documentShown(page));
  assert.equal(page.querySelector(".side-panel"), null);
});

test("the tabs switch the panel between the board and the code, which is quiet while Luke shows none", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  act(() => tabNamed(page, "Code").click());
  assert.equal(tabNamed(page, "Code").getAttribute("aria-selected"), "true");
  assert.equal(page.querySelector(".side-panel .plan-board"), null);
  assert.match(page.querySelector(".side-panel")?.textContent ?? "", /When Luke shows you code/u);
  assert.ok(documentShown(page));

  act(() => tabNamed(page, "Board").click());
  assert.ok(page.querySelector(".side-panel .plan-board"));
});

test("the panel's tabs hang no pill, their words being enough, while Copy plan's chord still copies from the ⋯ menu's toolbar", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  assert.equal(hover(tabNamed(page, "Code")), undefined);
  assert.equal(tabNamed(page, "Code").getAttribute("aria-keyshortcuts"), "Meta+Alt+2");

  // Copy plan stands in the ⋯ menu now, so the toolbar draws no button for
  // it; its chord is still the toolbar's, and Start stands where Copy was.
  const copy = [...page.querySelectorAll<HTMLElement>("button")].find(
    (each) => each.textContent === "Copy plan",
  );
  assert.equal(copy, undefined, "the toolbar draws no Copy plan of its own");
  assert.ok(page.querySelector('.desktop-toolbar [aria-label="Start a coding agent"]'));
  const before = copies;
  assert.equal(keydown({ key: "c", code: "KeyC", metaKey: true, shiftKey: true }), true);
  assert.equal(copies, before + 1);
});

test("a panel too narrow for its tabs whole still draws every tab's label, hanging no pill on one whose label shows whole", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const panelTabs = page.querySelector(".side-panel .tab-strip");
  assert.ok(panelTabs, "the panel draws its tabs");
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this === panelTabs ? 320 : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this === panelTabs ? 200 : 0;
  });
  act(() => relayout());
  act(() => tabNamed(page, "Transcript").click());

  for (const label of ["Board", "Code", "Work"]) {
    assert.equal(tabNamed(page, label).querySelector(".tab-label")?.textContent, label);
    assert.equal(hover(tabNamed(page, label)), undefined, `${label} hangs a pill`);
  }
});

test("the Code tab draws the code Luke has on screen", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopPlans, {
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.CODE },
        code: CODE,
      }),
    }),
  );

  assert.match(
    markup,
    /<aside class="side-panel"[\s\S]*class="code-pane ph-no-capture"[\s\S]*src\/invite\.ts/u,
  );
});

test("a tab with something new on it carries a dot, and the tab shown carries none", () => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    createElement(DesktopPlans, {
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.TRANSCRIPT },
        unreadTabs: [SIDE_PANEL_TAB.BOARD],
      }),
    }),
  );

  assert.ok(tabNamed(page, "Board").querySelector(".tab-note"));
  assert.equal(tabNamed(page, "Code").querySelector(".tab-note"), null);
  assert.equal(tabNamed(page, "Transcript").querySelector(".tab-note"), null);
});

test("the Work tab draws each turn's calls as lines that open onto their output, left out of the screen recording", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(DesktopPlans, {
        plans: plansControl({
          page: PLANS_PAGE.DOCUMENT,
          activePlanId: PLAN.id,
          region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
          sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.WORK },
          work: {
            callLive: true,
            earlier: undefined,
            onLoadEarlier: () => Promise.resolve(),
            turns: [
              {
                turnId: "turn-1",
                startedAt: 1_000,
                state: PLAN_WORK_STATE.DONE,
                earlierOmitted: false,
                parts: [
                  {
                    type: PLAN_WORK_PART.TOOL,
                    id: "call-1",
                    tool: PLAN_WORK_TOOL.REPOSITORY,
                    name: "run_in_repository",
                    state: PLAN_WORK_STATE.DONE,
                    subject: "ls src",
                    input: '{ "command": "ls src" }',
                    output: "invite.ts",
                  },
                ],
              },
            ],
          },
        }),
      }),
    ),
  );

  const work = container.querySelector('section[aria-label="Work"]');
  assert.ok(work);
  assert.ok(work.classList.contains("ph-no-capture"));
  // The call's row is its fold's summary (../ai-elements/fold.tsx), as an agent tab's rows are.
  const line = [...work.querySelectorAll("summary")].find((summary) =>
    summary.textContent?.includes("ls src"),
  );
  assert.ok(line, "no line for the call");
  assert.match(line.textContent ?? "", /^Ran\s*ls src/u);
  assert.equal(work.textContent?.includes("invite.ts"), false);

  act(() => line.click());
  // The command behind its prompt, as an agent's tab draws one, then its answer.
  const output = [...work.querySelectorAll("pre")].map((pre) => pre.textContent);
  assert.deepEqual(output, ["$ ls src", "invite.ts"]);
});

test("a worker's line in the Work tab is one button saying where the subagent stands with the mark a call wears, no link on it, and pressing it opens the subagent's tab rather than its session in the tab's place", () => {
  const running = "Compare the two queue libraries.";
  const done = "Find the admin check.";
  const worker = (id: string, subject: string, state: PlanWorkState) => ({
    type: PLAN_WORK_PART.TOOL,
    id,
    tool: PLAN_WORK_TOOL.WORKER,
    name: "worker",
    state,
    subject,
    input: "{}",
    session: {
      earlierOmitted: false,
      parts: [{ type: PLAN_WORK_PART.TEXT, text: `Notes on: ${subject}` }],
    },
  });
  const page = mountOpenPlan({
    work: {
      callLive: true,
      earlier: undefined,
      onLoadEarlier: () => Promise.resolve(),
      turns: [
        {
          turnId: "turn-1",
          startedAt: 1_000,
          state: PLAN_WORK_STATE.RUNNING,
          earlierOmitted: false,
          parts: [
            worker("call-running", running, PLAN_WORK_STATE.RUNNING),
            worker("call-done", done, PLAN_WORK_STATE.DONE),
            { type: PLAN_WORK_PART.TEXT, text: "While that runs, I'm reading the code." },
          ],
        },
      ],
    },
  });
  press(page, '[aria-label="Show panel"]');
  act(() => tabNamed(page, "Work").click());
  const work = page.querySelector('section[aria-label="Work"]');
  assert.ok(work);
  const lines = [...work.querySelectorAll<HTMLElement>(".work-worker-line")];
  // Each line is the one button: its job, and the state mark every call's row wears.
  assert.deepEqual(
    lines.map((line) => [
      line.tagName,
      line.textContent,
      line.querySelector("[data-tool-state]")?.getAttribute("aria-label"),
    ]),
    [
      ["BUTTON", running, "Running"],
      ["BUTTON", done, "Completed"],
    ],
  );
  assert.equal(work.querySelector('[aria-label="Open in tab"]'), null);

  act(() => lines[1]?.click());
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work", done]);
  assert.equal(chosenTab(page), done);
  // Back on the Work tab, every turn still stands: no session took its place.
  act(() => tabNamed(page, "Work").click());
  const back = page.querySelector('section[aria-label="Work"]');
  assert.ok(back?.textContent?.includes("While that runs"));
  assert.equal(back?.textContent?.includes(`Notes on: ${done}`), false);
});

/** The open plan's work: one call that ran a worker on `job`, handed `task` where one is given, its session a call and a line of words. */
function workerWork(job: string, task?: string): PlansControl["work"] {
  return {
    callLive: true,
    earlier: undefined,
    onLoadEarlier: () => Promise.resolve(),
    turns: [
      {
        turnId: "turn-1",
        startedAt: 1_000,
        state: PLAN_WORK_STATE.RUNNING,
        earlierOmitted: false,
        parts: [
          {
            type: PLAN_WORK_PART.TOOL,
            id: "call-worker",
            tool: PLAN_WORK_TOOL.WORKER,
            name: "worker",
            state: PLAN_WORK_STATE.RUNNING,
            subject: job,
            input: task === undefined ? "{}" : JSON.stringify({ message: task }, null, 2),
            session: {
              earlierOmitted: false,
              parts: [
                {
                  type: PLAN_WORK_PART.TOOL,
                  id: "worker-call",
                  tool: PLAN_WORK_TOOL.REPOSITORY,
                  name: "run_in_repository",
                  state: PLAN_WORK_STATE.DONE,
                  subject: "ls src",
                  input: '{ "command": "ls src" }',
                  output: "queue.ts",
                },
                { type: PLAN_WORK_PART.TEXT, text: "Queue A lets an admin revoke." },
              ],
            },
          },
        ],
      },
    ],
  };
}

test("a worker's line opens the subagent's session in a tab of its own after the fixed tabs, drawn as the Work tab draws it, its task card opening onto the whole message it was handed; pressed again it is chosen rather than doubled, and its × closes it", () => {
  const job = "Compare the two queue libraries.";
  // Longer than the subject the service cuts a worker's line to, as a task the planning model writes often is.
  const task =
    `${job} ${"Read each library's README and its source, and say which call revokes a pending invite. ".repeat(6)}`.trim();
  const page = mountOpenPlan({ work: workerWork(job, task) });
  press(page, '[aria-label="Show panel"]');
  act(() => tabNamed(page, "Work").click());
  press(page, ".work-worker-line");
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work", job]);
  assert.equal(chosenTab(page), job);
  assert.ok(tabNamed(page, job).querySelector("svg.lucide-bot"), "the worker's glyph");
  const content = page.querySelector('.side-panel-content[role="tabpanel"]');
  assert.equal(content?.getAttribute("aria-label"), job);
  // As an agent's tab: the task a card at the top, and a working line at the end while the subagent runs.
  const card = content?.querySelector("[data-task-card]");
  assert.ok(card?.textContent?.includes(job));
  assert.equal(card?.textContent?.includes(task), false, "folded to its line");
  const opener = card?.querySelector("summary");
  assert.ok(opener);
  act(() => opener.click());
  assert.ok(card?.textContent?.includes(task), "the whole task, uncut");
  assert.ok(content?.querySelector("[data-working]"));
  // The session's rows as the Work tab draws them: the call a row that opens onto its output, the words after it.
  const call = [...(content?.querySelectorAll("summary") ?? [])].find((summary) =>
    summary.textContent?.includes("ls src"),
  );
  assert.ok(call, "no row for the subagent's call");
  act(() => call.click());
  assert.ok(content?.textContent?.includes("queue.ts"));
  assert.ok(content?.textContent?.includes("Queue A lets an admin revoke."));

  act(() => tabNamed(page, "Work").click());
  press(page, ".work-worker-line");
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work", job]);
  assert.equal(chosenTab(page), job);

  press(page, `[aria-label="Close ${job}"]`);
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work"]);
  assert.equal(chosenTab(page), "Work");
});

test("a subagent's tab cuts a long job short and says the whole of it in its hint, while a tab shown whole hangs none", () => {
  const job =
    "Compare the two queue libraries on revocation, retries, and the cost of running each at our volume.";
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("tab-label") && this.textContent === job ? 600 : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("tab-label") && this.textContent === job ? 160 : 0;
  });
  const page = mountOpenPlan({ work: workerWork(job) });
  press(page, '[aria-label="Show panel"]');
  act(() => tabNamed(page, "Work").click());
  press(page, ".work-worker-line");
  act(() => relayout());

  assert.equal(hover(tabNamed(page, "Work")), undefined);
  assert.equal(hover(tabNamed(page, job)), job);
});

test("the Work tab with no turn says what will appear there", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopPlans, {
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.WORK },
      }),
    }),
  );

  assert.match(markup, /When Luke works on a call, what he reads and runs appears here\./u);
});

/** The rows the page's observers watch, and a scroll that brings every one into view. */
function watchedRows() {
  const watching = new Set<{ callback: IntersectionObserverCallback; target?: Element }>();
  class SeenObserver {
    readonly #watch: { callback: IntersectionObserverCallback; target?: Element };
    constructor(callback: IntersectionObserverCallback) {
      this.#watch = { callback };
    }
    observe(target: Element): void {
      this.#watch.target = target;
      watching.add(this.#watch);
    }
    disconnect(): void {
      watching.delete(this.#watch);
    }
  }
  vi.stubGlobal("IntersectionObserver", SeenObserver);
  return {
    scrollIntoView: () =>
      act(() => {
        for (const { callback, target } of [...watching]) {
          // SAFETY: the callback reads `isIntersecting` alone, which is all a scroll here says.
          callback([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as never);
        }
      }),
  };
}

test("the Work tab reads the turns before its oldest as the row before them scrolls into view, and after a read that brought none waits for a press", async () => {
  const rows = watchedRows();
  const asked: string[] = [];
  const page = mountOpenPlan({
    staged: { open: true, tabs: SIDE_PANEL_TABS, tab: SIDE_PANEL_TAB.WORK, width: 400 },
    work: {
      callLive: false,
      earlier: "turn-2",
      onLoadEarlier: () => {
        asked.push("earlier");
        return Promise.resolve();
      },
      turns: [
        {
          turnId: "turn-2",
          startedAt: 1_000,
          state: PLAN_WORK_STATE.DONE,
          earlierOmitted: false,
          parts: [{ type: PLAN_WORK_PART.TEXT, text: "Invites expire after seven days." }],
        },
      ],
    },
  });
  const row = () =>
    [...page.querySelectorAll<HTMLElement>("section[aria-label='Work'] button")].find((button) =>
      button.textContent?.includes("earlier work"),
    );

  assert.equal(row()?.textContent, "Show earlier work");
  rows.scrollIntoView();
  assert.deepEqual(asked, ["earlier"]);
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(row()?.textContent, "Could not read earlier work. Try again");
  rows.scrollIntoView();
  assert.deepEqual(asked, ["earlier"]);

  act(() => row()?.click());
  assert.deepEqual(asked, ["earlier", "earlier"]);
});

test("the Transcript tab draws each call's turns under their speakers, left out of the screen recording", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopPlans, {
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.TRANSCRIPT },
        transcript: {
          region: {
            kind: TRANSCRIPT_REGION.READY,
            earlierOmitted: false,
            calls: [
              {
                key: "call-1",
                startedAt: 1_000,
                live: true,
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

  assert.match(markup, /<section class="plan-transcript ph-no-capture" aria-label="Transcript">/u);
  assert.match(
    markup,
    /data-speaker="user"[^>]*>.*?>You<\/span>.*?<p[^>]*>Invites should expire\.<\/p>/su,
  );
  assert.match(
    markup,
    /data-speaker="assistant"[^>]*>.*?>Luke<\/span>.*?<p[^>]*>After how many days\?<\/p>/su,
  );
  assert.match(markup, />Live</u);
});

test("the Transcript tab is the panel's third, beside the document", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  act(() => tabNamed(page, "Transcript").click());
  assert.equal(tabNamed(page, "Transcript").getAttribute("aria-selected"), "true");
  assert.ok(page.querySelector('.side-panel .plan-transcript[aria-label="Transcript"]'));
  assert.ok(documentShown(page));
});

test("the next launch opens the panel as this one left it, and a fixture run neither reads nor writes it", () => {
  const first = mountOpenPlan();
  press(first, '[aria-label="Show panel"]');
  act(() => tabNamed(first, "Code").click());
  unmountAll();

  const next = mountOpenPlan();
  assert.equal(tabNamed(next, "Code").getAttribute("aria-selected"), "true");
  unmountAll();

  const staged = mountOpenPlan({
    staged: {
      open: false,
      tabs: SIDE_PANEL_TABS,
      tab: SIDE_PANEL_TAB.BOARD,
      width: SIDE_PANEL_WIDTH.DEFAULT,
    },
  });
  assert.equal(staged.querySelector(".side-panel"), null);
  press(staged, '[aria-label="Show panel"]');
  unmountAll();

  const after = mountOpenPlan();
  assert.equal(tabNamed(after, "Code").getAttribute("aria-selected"), "true");
});

test("a fixture run known only a render in still opens the panel it stages, and keeps nothing", () => {
  const first = mountOpenPlan();
  press(first, '[aria-label="Show panel"]');
  act(() => tabNamed(first, "Code").click());
  unmountAll();

  // The run is known only once the first state arrives, a render in.
  const staged = mountOpenPlan();
  restage({
    open: false,
    tabs: SIDE_PANEL_TABS,
    tab: SIDE_PANEL_TAB.BOARD,
    width: SIDE_PANEL_WIDTH.DEFAULT,
  });
  assert.equal(panelShown(staged), false, "the developer's panel is not drawn");
  press(staged, '[aria-label="Show panel"]');
  assert.equal(tabNamed(staged, "Board").getAttribute("aria-selected"), "true");
  unmountAll();

  const after = mountOpenPlan();
  assert.equal(tabNamed(after, "Code").getAttribute("aria-selected"), "true");
});

test("storage that refuses the read opens the page as a first launch would", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage is disabled.", "SecurityError");
  });

  const page = mountOpenPlan();
  assert.ok(documentShown(page));
  assert.equal(page.querySelector(".side-panel"), null);
});

test("the panel's edge widens it from the keyboard, no wider than the document beside it allows", () => {
  layOutPlanArea(1200);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const edge = page.querySelector<HTMLElement>('[role="separator"]');
  assert.ok(edge);

  act(() => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT + 16));

  for (let press = 0; press < 60; press += 1) {
    act(() =>
      edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
  }
  // The document keeps 280 of the 1200.
  assert.equal(edge.getAttribute("aria-valuenow"), "920");
});

test("the open panel's row ends at its full-screen button, holding neither the toggle nor any of the plan's actions", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  assert.ok(page.querySelector('.desktop-toolbar [aria-label="Plan actions"]'));
  assert.match(page.querySelector(".desktop-toolbar")?.textContent ?? "", /Start/u);

  for (const fullScreen of [false, true]) {
    if (fullScreen) press(page, '[aria-label="Expand panel"]');
    const panel = page.querySelector(".side-panel");
    const last = panel?.querySelector(".side-panel-bar")?.lastElementChild;
    assert.equal(
      last?.getAttribute("aria-label"),
      fullScreen ? "Exit full screen" : "Expand panel",
    );
    assert.equal(panel?.querySelector(".side-panel-toggle"), null);
    assert.doesNotMatch(panel?.textContent ?? "", /Copy plan/u);
    assert.equal(panel?.querySelector('[aria-label="Plan actions"]'), null);
  }
  assert.equal(page.querySelector(".desktop-toolbar .side-panel-toggle"), null);
});

test("the full-screen button grows the panel over the document, and back to the width it had", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  key(resizeEdge(page), "ArrowLeft");

  press(page, '[aria-label="Expand panel"]');
  assert.equal(documentShown(page), false);
  assert.equal(page.querySelector('[role="separator"]'), null, "full screen has no edge");
  assert.ok(page.querySelector('.side-panel [aria-label="Exit full screen"]'));

  press(page, '[aria-label="Exit full screen"]');
  assert.ok(documentShown(page));
  assert.equal(
    resizeEdge(page).getAttribute("aria-valuenow"),
    String(SIDE_PANEL_WIDTH.DEFAULT + 16),
  );
});

test("hiding a full-screen panel and showing it again shows it beside the document", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  press(page, '[aria-label="Expand panel"]');

  press(page, '[aria-label="Hide panel"]');
  assert.ok(documentShown(page));
  press(page, '[aria-label="Show panel"]');
  assert.ok(documentShown(page));
  assert.ok(page.querySelector('.side-panel [aria-label="Expand panel"]'));
});

test("a drag between the bounds sets the width, and one past a bound holds there", () => {
  layOutPlanArea(1200);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // The panel is on the right, so the pointer moving left widens it.
  assert.deepEqual(dragEdge(page, 1000, [900]), [PANEL.BESIDE]);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "500");

  // 500 wide at 1000: 450 asks for 1050, past the 920 the document leaves.
  assert.deepEqual(dragEdge(page, 1000, [450]), [PANEL.BESIDE]);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "920");
});

test("on a wide window the panel is dragged as wide as the document's least width leaves it", () => {
  layOutPlanArea(2000);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // 400 wide at 1500: 100 asks for 1800, past the 1720 the document leaves.
  assert.deepEqual(dragEdge(page, 1500, [500, 100]), [PANEL.BESIDE, PANEL.BESIDE]);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "1720");
});

test("the panel's edge announces the room the document leaves as its greatest width, and the width drawn in it", () => {
  layOutPlanArea(1200);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  act(() => relayout());
  assert.equal(resizeEdge(page).getAttribute("aria-valuemax"), "920");
  key(resizeEdge(page), "End");
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "920");

  layOutPlanArea(900);
  act(() => relayout());
  assert.equal(resizeEdge(page).getAttribute("aria-valuemax"), "620");
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "620");
});

test("the panel is dragged no wider than the room the stylesheet keeps the document, as folding the sidebar raises it", () => {
  layOutPlanArea(1200);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const area = page.querySelector<HTMLElement>(".desktop-plan");
  assert.ok(area);
  area.style.setProperty("--document-reserve", "423px");

  // 400 wide at 1000: 500 asks for 900, past the 777 the document keeps.
  assert.deepEqual(dragEdge(page, 1000, [500]), [PANEL.BESIDE]);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "777");
  key(resizeEdge(page), "Enter");
  // Full screen is past asking for 937: 470 asks for 930, 460 for 940.
  assert.deepEqual(dragEdge(page, 1000, [470, 460]), [PANEL.BESIDE, PANEL.FULL_SCREEN]);
});

test("a drag far past the least width closes the panel as it crosses, the release leaves it closed, and it opens again at the width it had", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // 400 wide at 1000: 1150 asks for 250, held at the bound; 1250 asks for 150.
  assert.deepEqual(dragEdge(page, 1000, [1150, 1250]), [PANEL.BESIDE, PANEL.HIDDEN]);
  assert.equal(panelShown(page), false);
  assert.ok(documentShown(page));

  press(page, '[aria-label="Show panel"]');
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
});

test("a drag far past the greatest width fills the window as it crosses, and leaving full screen gives back the width it had", () => {
  layOutPlanArea(1200);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // 400 wide at 1000, held at 920: 390 asks for 1010, further past than a
  // drag goes to shut the panel and still held; 300 asks for 1100.
  assert.deepEqual(dragEdge(page, 1000, [390, 300]), [PANEL.BESIDE, PANEL.FULL_SCREEN]);
  assert.equal(documentShown(page), false);
  assert.equal(page.querySelector(".side-panel")?.getAttribute("data-full-screen"), "true");

  press(page, '[aria-label="Exit full screen"]');
  assert.ok(documentShown(page));
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
});

test("a drag that comes back opens the panel again as it crosses, and resizes it from there", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  assert.deepEqual(dragEdge(page, 1000, [1250, 1050]), [PANEL.HIDDEN, PANEL.BESIDE]);
  assert.ok(panelShown(page));
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "350");
});

test("a drag that comes back from full screen brings the panel back beside the document as it crosses", () => {
  layOutPlanArea(1200);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // 400 wide at 1000: 300 asks for 1100, past the greatest width by more than
  // the overshoot; 500 asks for 900, back inside it.
  assert.deepEqual(dragEdge(page, 1000, [300, 500]), [PANEL.FULL_SCREEN, PANEL.BESIDE]);
  assert.ok(documentShown(page));
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "900");
});

test("a pointer resting on a snap's threshold does not flicker the panel", () => {
  layOutPlanArea(1200);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // Held at 920, full screen is past asking for 1080, and lets go only once
  // the pointer is back by more than a tremor: 340 asks for 1060, 350 for 1050.
  assert.deepEqual(dragEdge(page, 1000, [300, 330, 340, 350]), [
    PANEL.FULL_SCREEN,
    PANEL.FULL_SCREEN,
    PANEL.FULL_SCREEN,
    PANEL.BESIDE,
  ]);
  // Back at 400, shut is past asking for 200, and lets go past 224.
  key(resizeEdge(page), "Enter");
  assert.deepEqual(dragEdge(page, 1000, [1210, 1190, 1180, 1170]), [
    PANEL.HIDDEN,
    PANEL.HIDDEN,
    PANEL.HIDDEN,
    PANEL.BESIDE,
  ]);
});

test("in a narrow window, the drag goes full screen a longer pull past the document's room than it takes to shut the panel", () => {
  layOutPlanArea(900);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // The document keeps 280 of the 900, so the panel is held at 620, still
  // held 130 past it, and snaps past 780.
  assert.deepEqual(dragEdge(page, 1000, [760, 650, 610]), [
    PANEL.BESIDE,
    PANEL.BESIDE,
    PANEL.FULL_SCREEN,
  ]);
  assert.equal(documentShown(page), false);
});

test("a snap in a window that holds the panel narrower keeps the width the developer chose", () => {
  layOutPlanArea(1200);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  key(resizeEdge(page), "End");
  layOutPlanArea(900);

  // Drawn at 620 of its 920: 800 asks for 820, past the room by more than the overshoot.
  assert.deepEqual(dragEdge(page, 1000, [800]), [PANEL.FULL_SCREEN]);
  press(page, '[aria-label="Exit full screen"]');
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "920");
});

test("in a window that holds the panel narrower, the keys move the panel it draws", () => {
  layOutPlanArea(900);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const edge = resizeEdge(page);

  key(edge, "End");
  assert.equal(edge.getAttribute("aria-valuenow"), "620");
  key(edge, "ArrowLeft");
  assert.equal(edge.getAttribute("aria-valuenow"), "620");
  key(edge, "ArrowRight");
  assert.equal(edge.getAttribute("aria-valuenow"), "604");
});

test("a second pointer on the edge does not take over the drag under way", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  pointer(page, "pointerdown", 1, 1000);
  pointer(page, "pointerdown", 2, 500);
  pointer(page, "pointermove", 2, 400);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
  pointer(page, "pointerup", 2, 400);

  pointer(page, "pointermove", 1, 900);
  pointer(page, "pointerup", 1, 900);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "500");
});

test("double-clicking the panel's edge gives it back its default width", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  dragEdge(page, 1000, [800]);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "600");

  act(() => resizeEdge(page).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
});

test("Home and End take the edge to its bounds and Enter back to the default", () => {
  layOutPlanArea(1200);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const edge = resizeEdge(page);

  key(edge, "Home");
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.MIN));
  key(edge, "ArrowRight");
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.MIN));
  key(edge, "End");
  assert.equal(edge.getAttribute("aria-valuenow"), "920");
  key(edge, "Enter");
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
});

test("Option-Command-B shows and hides the panel by its key, though Option makes the character another", () => {
  const page = mountOpenPlan();
  const chord = { code: "KeyB", key: "∫", metaKey: true, altKey: true };

  assert.equal(keydown(chord), true);
  assert.ok(panelShown(page));
  // Holding the chord is one press, not one per repeat.
  assert.equal(keydown({ ...chord, repeat: true }), true);
  assert.ok(panelShown(page));
  assert.equal(keydown({ ...chord, shiftKey: true }), false);
  assert.ok(panelShown(page));

  assert.equal(keydown(chord), true);
  assert.equal(panelShown(page), false);
});

test("Option-Command-1, 2, 3, and 4 open the panel on its tabs in their order", () => {
  const page = mountOpenPlan();

  keydown({ code: "Digit2", key: "™", metaKey: true, altKey: true });
  assert.equal(tabNamed(page, "Code").getAttribute("aria-selected"), "true");
  keydown({ code: "Digit3", key: "£", metaKey: true, altKey: true });
  assert.equal(tabNamed(page, "Transcript").getAttribute("aria-selected"), "true");
  keydown({ code: "Digit4", key: "¢", metaKey: true, altKey: true });
  assert.equal(tabNamed(page, "Work").getAttribute("aria-selected"), "true");
  keydown({ code: "Digit1", key: "¡", metaKey: true, altKey: true });
  assert.equal(tabNamed(page, "Board").getAttribute("aria-selected"), "true");
});

test("Shift-Command-C copies the open plan as its toolbar button does", () => {
  mountOpenPlan();

  assert.equal(keydown({ code: "KeyC", key: "c", metaKey: true, shiftKey: true }), true);
  assert.equal(copies, 1);
  // Command-C alone is the system's own Copy.
  assert.equal(keydown({ code: "KeyC", key: "c", metaKey: true }), false);
  assert.equal(copies, 1);
});

test("with no plan open the plan's chords are left to the rest of the window", () => {
  function Home() {
    useAppKeymap(true);
    return createElement(DesktopPlans, { plans: plansControl({ page: PLANS_PAGE.NEW }) });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Home)));

  assert.equal(keydown({ code: "KeyB", key: "∫", metaKey: true, altKey: true }), false);
  assert.equal(keydown({ code: "KeyC", key: "c", metaKey: true, shiftKey: true }), false);
});

test("with no plan open the work column is the new-plan page, with nothing to go back to", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopPlans, { plans: plansControl({ page: PLANS_PAGE.NEW }) }),
  );

  assert.match(markup, /<h1 [^>]*>What are we planning\?<\/h1>/u);
  assert.match(markup, /aria-label="Plan name"/u);
  assert.doesNotMatch(markup, /desktop-toolbar|Back|Cancel/u);
});

test("Shift-Command-Return fills the window with the open panel and brings it back, and the keymap leaves Escape to the window", () => {
  const page = mountOpenPlan();
  const chord = { key: "Enter", code: "Enter", metaKey: true, shiftKey: true };
  assert.equal(keydown(chord), false, "no panel to fill the window with yet");

  press(page, '[aria-label="Show panel"]');
  assert.equal(keydown(chord), true);
  assert.equal(documentShown(page), false);
  // Escape steps back one layer at a time in the window's own handler, which
  // this page does not stand; the keymap claims none of it.
  assert.equal(keydown({ key: "Escape", code: "Escape" }), false);
  assert.equal(documentShown(page), false);

  assert.equal(keydown(chord), true);
  assert.ok(documentShown(page));
});

test("the menu bar's Exit Full Screen steps out of full screen, and does nothing beside the document", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  assert.ok(menuListener, "the window listens to the menu bar");

  act(() => menuListener?.(APP_COMMAND.EXIT_FULL_SCREEN));
  assert.ok(documentShown(page));
  assert.ok(panelShown(page));

  press(page, '[aria-label="Expand panel"]');
  act(() => menuListener?.(APP_COMMAND.EXIT_FULL_SCREEN));
  assert.ok(documentShown(page));
  assert.ok(page.querySelector('.side-panel [aria-label="Expand panel"]'));
});

/**
 * The page over a region that moves as the host's does: opening a plan from
 * the list draws it reading first and ready once the read lands, and
 * opening another draws the first plan's page reading again.
 */
function Opening({ region }: { region: PlansControl["region"] }) {
  const sidePanel = useSidePanel(undefined);
  return createElement(DesktopPlans, {
    plans: plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN.id,
      region,
      sidePanel,
    }),
  });
}

test("a plan opened from the list, read after the page first drew it reading, draws its document on the repository chip", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // The host publishes the plan reading before its read lands, and ready after.
  act(() => root.render(createElement(Opening, { region: { kind: DOCUMENT_REGION.READING } })));
  assert.match(container.textContent ?? "", /Reading the plan…/u);

  act(() =>
    root.render(createElement(Opening, { region: { kind: DOCUMENT_REGION.READY, plan: PLAN } })),
  );
  assert.ok(documentShown(container));
  assert.equal(
    container.querySelector(".repository-chip .plan-compose-chip-name")?.textContent,
    "Choose repository",
  );

  // Another plan opening draws the page reading again, with nothing of the first left on it.
  act(() => root.render(createElement(Opening, { region: { kind: DOCUMENT_REGION.READING } })));
  assert.equal(documentShown(container), false);
  assert.match(container.textContent ?? "", /Reading the plan…/u);
});

/** The panel's tabs, in the strip's order. */
function panelTabs(page: HTMLElement): string[] {
  return [...page.querySelectorAll<HTMLElement>('.side-panel [role="tab"]')].map(
    (tab) => tab.textContent ?? "",
  );
}

function chosenTab(page: HTMLElement): string | undefined {
  return (
    page.querySelector('.side-panel [role="tab"][aria-selected="true"]')?.textContent ?? undefined
  );
}

/** The rows a list of the tab kinds draws: each label, what it says at its end, and whether it may be chosen. */
function kindRows(rows: Iterable<HTMLButtonElement>): [string, string, boolean][] {
  return [...rows].map((row) => [
    row.querySelector(".plan-menu-label")?.textContent ?? "",
    row.querySelector(".plan-menu-end")?.textContent ?? "",
    !row.disabled,
  ]);
}

/** The "+" menu's rows: each label, what it says at its end, and whether it may be picked. */
function addRows(): [string, string, boolean][] {
  return [...document.querySelectorAll<HTMLElement>('.tab-add-menu [role="option"]')].map((row) => [
    row.querySelector(".plan-compose-menu-name")?.textContent ?? "",
    row.querySelector(".plan-compose-menu-hint")?.textContent ?? "",
    row.getAttribute("aria-disabled") !== "true",
  ]);
}

/** The "+" menu's highlighted row, by label. */
function addHighlighted(): string | undefined {
  return (
    document
      .querySelector('.tab-add-menu [role="option"][aria-selected="true"]')
      ?.querySelector(".plan-compose-menu-name")?.textContent ?? undefined
  );
}

/** What has focus, which a key is pressed on. */
function focused(): HTMLElement {
  const element = document.activeElement;
  assert.ok(element instanceof HTMLElement, "something has focus");
  return element;
}

/** Types into the focused search the way a key press does, through the setter React watches. */
function typeSearch(words: string): void {
  const field = document.activeElement;
  assert.ok(field instanceof HTMLInputElement, "the search has focus");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("the plan's tab names the plan, has no × to close it, and its hint says the plan's repository", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (repository: string | null) =>
    act(() =>
      root.render(
        createElement(DesktopPlans, {
          plans: plansControl({
            page: PLANS_PAGE.DOCUMENT,
            activePlanId: PLAN.id,
            region: { kind: DOCUMENT_REGION.READY, plan: { ...PLAN, repository } },
          }),
        }),
      ),
    );

  render(null);
  const tab = container.querySelector<HTMLElement>('.desktop-toolbar [role="tab"]');
  assert.ok(tab, "the plan's tab stands");
  assert.equal(tab.textContent, PLAN.name);
  assert.equal(tab.getAttribute("aria-selected"), "true");
  assert.equal(container.querySelector(".desktop-toolbar .tab-close"), null);
  key(tab, "Delete");
  assert.equal(container.querySelector('.desktop-toolbar [role="tab"]')?.textContent, PLAN.name);
  assert.match(
    container.querySelector(".desktop-toolbar")?.textContent ?? "",
    /Choose repository/u,
  );

  render("dean/invites");
  const filed = container.querySelector<HTMLElement>('.desktop-toolbar [role="tab"]');
  assert.ok(filed);
  assert.equal(hover(filed), "dean/invites");
  assert.doesNotMatch(
    container.querySelector(".desktop-toolbar")?.textContent ?? "",
    /Choose repository/u,
  );
});

test("a plan's coding agents follow the fixed tabs as tabs of the strip, named by model, dotted for where each stands and for an end unseen, each with an × and no shortcut", () => {
  const running: CodingAgentSummary = {
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    planId: PLAN.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    createdAt: 3,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
  };
  const ended: CodingAgentSummary = {
    ...running,
    id: "1f6d2c3b-5a4e-4f7d-9c8b-2e3f4a5b6c7d",
    model: "openai/gpt-5.6-sol",
    status: CODING_AGENT_STATUS.COMPLETED,
  };
  const chosen: SidePanelTab[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(DesktopPlans, {
        plans: plansControl({
          page: PLANS_PAGE.DOCUMENT,
          activePlanId: PLAN.id,
          region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
          sidePanel: {
            ...plansControl().sidePanel,
            open: true,
            tabs: [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.TRANSCRIPT],
            tab: { agent: ended.id },
            onChoose: (tab) => chosen.push(tab),
          },
          unreadTabs: [{ agent: running.id }],
          agents: codingAgentsControl({
            agents: [running, ended],
            agentIds: [running.id, ended.id],
          }),
        }),
      }),
    ),
  );

  assert.deepEqual(panelTabs(container), ["Board", "Transcript", "Claude Opus 5.5", "GPT 5.6 Sol"]);
  assert.equal(chosenTab(container), "GPT 5.6 Sol");
  const claude = tabNamed(container, "Claude Opus 5.5");
  assert.equal(claude.querySelector(".agent-status-dot")?.getAttribute("data-status"), "running");
  assert.ok(claude.querySelector(".tab-note"), "an end no one saw dots the tab");
  assert.equal(tabNamed(container, "GPT 5.6 Sol").querySelector(".tab-note"), null);
  assert.equal(claude.getAttribute("aria-keyshortcuts"), null);
  assert.ok(container.querySelector('[aria-label="Close Claude Opus 5.5"]'));
  assert.ok(container.querySelector('[aria-label="Close Board"]'));
  assert.equal(
    container.querySelector('.side-panel-content[role="tabpanel"]')?.getAttribute("aria-label"),
    "GPT 5.6 Sol",
  );

  act(() => claude.click());
  assert.deepEqual(chosen, [{ agent: running.id }]);
});

test("closing the chosen tab chooses its neighbour, and closing the last leaves the panel open offering every kind", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  act(() => tabNamed(page, "Code").click());
  press(page, '[aria-label="Close Code"]');
  assert.deepEqual(panelTabs(page), ["Board", "Transcript", "Work"]);
  assert.equal(chosenTab(page), "Transcript", "the tab after it");
  assert.ok(documentShown(page));

  act(() => tabNamed(page, "Work").click());
  press(page, '[aria-label="Close Work"]');
  assert.equal(chosenTab(page), "Transcript", "the tab before the last");

  press(page, '[aria-label="Close Transcript"]');
  press(page, '[aria-label="Close Board"]');
  assert.ok(panelShown(page));
  assert.deepEqual(panelTabs(page), []);
  const rows = page.querySelectorAll<HTMLButtonElement>(".side-panel-no-tabs button");
  assert.deepEqual(kindRows(rows), [
    ["Board", "⌥⌘1", true],
    ["Code", "⌥⌘2", true],
    ["Transcript", "⌥⌘3", true],
    ["Work", "⌥⌘4", true],
  ]);

  const code = [...rows].find((row) => row.textContent?.startsWith("Code"));
  assert.ok(code);
  act(() => code.click());
  assert.deepEqual(panelTabs(page), ["Code"]);
  assert.equal(chosenTab(page), "Code");
});

test("the panel's tabs are one stop for Tab that the arrow keys move along, and Delete closes the one focused and hands focus on", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const tabs = () => [...page.querySelectorAll<HTMLElement>('.side-panel [role="tab"]')];
  assert.deepEqual(
    tabs().map((tab) => tab.tabIndex),
    [0, -1, -1, -1],
  );

  const board = tabNamed(page, "Board");
  act(() => board.focus());
  key(board, "ArrowRight");
  assert.equal(document.activeElement, tabNamed(page, "Code"));
  key(tabNamed(page, "Code"), "End");
  assert.equal(document.activeElement, tabNamed(page, "Work"));
  key(tabNamed(page, "Work"), "ArrowRight");
  assert.equal(document.activeElement, board);
  assert.equal(chosenTab(page), "Board", "moving along the tabs chooses none of them");

  key(board, "Delete");
  assert.deepEqual(panelTabs(page), ["Code", "Transcript", "Work"]);
  assert.equal(document.activeElement, tabNamed(page, "Code"));
  key(tabNamed(page, "Code"), "Backspace");
  assert.deepEqual(panelTabs(page), ["Transcript", "Work"]);
  assert.equal(document.activeElement, tabNamed(page, "Transcript"));
});

/** The panel's "+". */
function addButton(page: HTMLElement): HTMLElement {
  const button = page.querySelector<HTMLElement>('.side-panel [aria-label="Open a tab"]');
  assert.ok(button, "the panel draws its +");
  return button;
}

test("the + drops the searchable menu over every kind with its shortcut, those open dimmed, and opens a closed one at the strip's end", () => {
  installScrollIntoView();
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // Every kind is open and the plan has no agent, so there is nothing to add.
  assert.equal(addButton(page).getAttribute("aria-disabled"), "true");
  assert.equal(hover(addButton(page)), "Every tab is open");
  act(() => addButton(page).click());
  assert.equal(document.querySelector(".tab-add-menu"), null);

  press(page, '[aria-label="Close Code"]');
  assert.equal(addButton(page).getAttribute("aria-disabled"), "false");
  act(() => addButton(page).click());
  assert.deepEqual(addRows(), [
    ["Board", "Open", false],
    ["Code", "⌥⌘2", true],
    ["Transcript", "Open", false],
    ["Work", "Open", false],
  ]);
  assert.equal(
    document.activeElement?.getAttribute("placeholder"),
    "Search tabs and agents",
    "the search takes focus as the menu opens",
  );
  assert.equal(addHighlighted(), "Code", "the highlight starts on the one kind to open");

  // The arrows pass over the open kinds, and a press on one does nothing.
  key(focused(), "ArrowDown");
  assert.equal(addHighlighted(), "Code");
  const board = document.querySelector<HTMLElement>('.tab-add-menu [role="option"]');
  act(() => board?.click());
  assert.ok(document.querySelector(".tab-add-menu"), "an open kind is not picked");

  key(focused(), "Enter");
  assert.equal(document.querySelector(".tab-add-menu"), null);
  assert.deepEqual(panelTabs(page), ["Board", "Transcript", "Work", "Code"]);
  assert.equal(chosenTab(page), "Code");
  assert.equal(document.activeElement, addButton(page), "focus goes back to the +");
});

test("the + menu's search narrows the kinds as it is typed, and Escape closes the menu and nothing behind it", () => {
  installScrollIntoView();
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  press(page, '[aria-label="Close Board"]');
  press(page, '[aria-label="Close Work"]');
  act(() => addButton(page).click());

  typeSearch("wo");
  assert.deepEqual(addRows(), [["Work", "⌥⌘4", true]]);
  assert.equal(addHighlighted(), "Work");
  typeSearch("zzz");
  assert.deepEqual(addRows(), []);
  assert.match(document.querySelector(".tab-add-menu")?.textContent ?? "", /No tabs match/u);
  typeSearch("");
  assert.deepEqual(
    addRows().map(([label]) => label),
    ["Board", "Code", "Transcript", "Work"],
  );

  key(focused(), "Escape");
  assert.equal(document.querySelector(".tab-add-menu"), null);
  assert.ok(panelShown(page), "the panel behind the menu stays");
  assert.equal(document.activeElement, addButton(page));
});

test("Option-Command-2 opens a closed Code tab again and chooses it, and no kind is ever open twice", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  press(page, '[aria-label="Close Code"]');

  keydown({ code: "Digit2", key: "™", metaKey: true, altKey: true });
  assert.deepEqual(panelTabs(page), ["Board", "Transcript", "Work", "Code"]);
  assert.equal(chosenTab(page), "Code");

  keydown({ code: "Digit1", key: "¡", metaKey: true, altKey: true });
  keydown({ code: "Digit2", key: "™", metaKey: true, altKey: true });
  assert.deepEqual(panelTabs(page), ["Board", "Transcript", "Work", "Code"]);
});

test("the next launch opens the panel with the tabs this one left open, in their order", () => {
  const first = mountOpenPlan();
  press(first, '[aria-label="Show panel"]');
  press(first, '[aria-label="Close Board"]');
  act(() => tabNamed(first, "Transcript").click());
  unmountAll();

  const next = mountOpenPlan();
  assert.deepEqual(panelTabs(next), ["Code", "Transcript", "Work"]);
  assert.equal(chosenTab(next), "Transcript");
});

test("a panel an earlier version kept, before its tabs could close, opens as it was with every tab, and one that no longer reads opens as a first launch", () => {
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({ open: true, tab: SIDE_PANEL_TAB.CODE, width: 500 }),
  );
  const earlier = mountOpenPlan();
  assert.ok(panelShown(earlier));
  assert.deepEqual(panelTabs(earlier), ["Board", "Code", "Transcript", "Work"]);
  assert.equal(chosenTab(earlier), "Code");
  assert.equal(earlier.querySelector<HTMLElement>(".side-panel")?.style.width, "500px");
  unmountAll();

  window.localStorage.setItem("luke.sidePanel", JSON.stringify({ open: true, tabs: "code" }));
  const unread = mountOpenPlan();
  assert.equal(panelShown(unread), false);
  press(unread, '[aria-label="Show panel"]');
  assert.deepEqual(panelTabs(unread), ["Board", "Code", "Transcript", "Work"]);
  assert.equal(chosenTab(unread), "Board");
});

test("Delete on a tab the arrow keys reached closes it and hands focus to the tab after it, and the last tab closed hands it to the +", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const board = tabNamed(page, "Board");
  act(() => board.focus());

  key(board, "ArrowRight");
  key(tabNamed(page, "Code"), "Delete");
  assert.deepEqual(panelTabs(page), ["Board", "Transcript", "Work"]);
  assert.equal(document.activeElement, tabNamed(page, "Transcript"));
  assert.equal(chosenTab(page), "Board", "closing another tab leaves the chosen one chosen");

  key(tabNamed(page, "Transcript"), "Delete");
  key(tabNamed(page, "Work"), "Delete");
  key(tabNamed(page, "Board"), "Delete");
  assert.deepEqual(panelTabs(page), []);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Open a tab");
});

/** How far apart the panel's tabs are laid out, and how wide each is, in CSS pixels. */
const TAB_PITCH = 100;
const TAB_WIDTH = 90;

/** Lays the panel's tabs out in a row in their strip's order, the strip room for four unless said; jsdom lays out nothing. */
function layOutTabs(strip: { width: number } = { width: 4 * TAB_PITCH }): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("tab-strip")) return DOMRect.fromRect(strip);
    const row = this.classList.contains("tab") ? this.parentElement : null;
    const at = row === null ? -1 : [...row.querySelectorAll(":scope > .tab")].indexOf(this);
    return DOMRect.fromRect(at < 0 ? {} : { x: at * TAB_PITCH, width: TAB_WIDTH });
  });
}

/** How a drag ends. */
const DRAG_END = {
  DROP: "drop",
  ESCAPE: "escape",
  CANCEL: "cancel",
} as const;

type DragEnd = (typeof DRAG_END)[keyof typeof DRAG_END];

/** The tabs standing aside or lifted, by the transform a drag left on them. */
function tabsMoved(page: HTMLElement): string[] {
  return [...page.querySelectorAll<HTMLElement>(".side-panel .tab")]
    .filter((tab) => tab.style.transform !== "")
    .map((tab) => tab.textContent ?? "");
}

/**
 * Presses at `from` over `target`, moves through each of `through`, runs
 * `meanwhile`, and ends the drag the way asked, answering the tabs the drag
 * had moved before it ended.
 */
function dragTab(
  target: HTMLElement,
  from: number,
  through: number[],
  end: DragEnd,
  meanwhile: () => void = () => undefined,
): string[] {
  const page = document.body;
  const pointer = (type: string, clientX: number) =>
    act(() => {
      target.dispatchEvent(
        new PointerEvent(type, { clientX, pointerId: 1, bubbles: true, cancelable: true }),
      );
    });
  pointer("pointerdown", from);
  for (const x of through) pointer("pointermove", x);
  const moved = tabsMoved(page);
  meanwhile();
  if (end === DRAG_END.ESCAPE) keydown({ key: "Escape" });
  pointer(end === DRAG_END.CANCEL ? "pointercancel" : "pointerup", through.at(-1) ?? from);
  return moved;
}

function movedSaid(page: HTMLElement): string | undefined {
  return page.querySelector(".side-panel [role='status']")?.textContent ?? undefined;
}

test("a press on a tab that wavers less than a drag is a click: it chooses the tab and moves none", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  layOutTabs();

  const code = tabNamed(page, "Code");
  assert.deepEqual(dragTab(code, 145, [147, 142], DRAG_END.DROP), []);
  act(() => code.click());

  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work"]);
  assert.equal(chosenTab(page), "Code");
  assert.deepEqual(tabsMoved(page), []);
});

test("a tab dragged past its neighbour lands there chosen, says where, and the next launch keeps the order", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  layOutTabs();

  dragTab(tabNamed(page, "Board"), 45, [60, 120, 160], DRAG_END.DROP);
  assert.deepEqual(panelTabs(page), ["Code", "Board", "Transcript", "Work"]);
  assert.equal(chosenTab(page), "Board");
  assert.equal(movedSaid(page), "Board moved to position 2 of 4");

  dragTab(tabNamed(page, "Work"), 345, [200, -400], DRAG_END.DROP);
  assert.deepEqual(panelTabs(page), ["Work", "Code", "Board", "Transcript"]);
  assert.equal(chosenTab(page), "Work", "the dragged tab is chosen");
  unmountAll();

  const next = mountOpenPlan();
  assert.deepEqual(panelTabs(next), ["Work", "Code", "Board", "Transcript"]);
});

test("Escape, or the system taking the pointer, puts a dragged tab back and changes nothing", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  layOutTabs();

  const lifted = dragTab(tabNamed(page, "Code"), 145, [200, 360], DRAG_END.ESCAPE);
  assert.deepEqual(
    lifted,
    ["Code", "Transcript", "Work"],
    "Code is lifted and the two it passed stand aside",
  );
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work"]);
  assert.equal(chosenTab(page), "Board");
  assert.deepEqual(tabsMoved(page), [], "every tab is back in its place");

  dragTab(tabNamed(page, "Code"), 145, [360], DRAG_END.CANCEL);
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work"]);
  assert.deepEqual(tabsMoved(page), []);
});

test("a tab closed under a drag puts the drag back rather than dropping it at a place that moved", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  layOutTabs();

  dragTab(tabNamed(page, "Code"), 145, [260], DRAG_END.DROP, () =>
    press(page, '[aria-label="Close Work"]'),
  );
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript"]);
  assert.equal(chosenTab(page), "Board");
  assert.deepEqual(tabsMoved(page), []);

  // One closed and opened again at the end leaves as many tabs, and the
  // dragged one where it was, but the places it passed have moved.
  dragTab(tabNamed(page, "Board"), 45, [160], DRAG_END.DROP, () => {
    press(page, '[aria-label="Close Code"]');
    keydown({ code: "Digit2", key: "™", metaKey: true, altKey: true });
  });
  assert.deepEqual(panelTabs(page), ["Board", "Transcript", "Code"]);
  assert.equal(chosenTab(page), "Code");
  assert.deepEqual(tabsMoved(page), []);
});

test("the × on a tab starts no drag", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  layOutTabs();

  const close = page.querySelector<HTMLElement>('[aria-label="Close Board"]');
  assert.ok(close, "the Board tab has its ×");
  assert.deepEqual(dragTab(close, 80, [200, 300], DRAG_END.DROP), []);
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work"]);
});

test("a tab let go anywhere short of the first tab's middle lands first, and past the last tab's middle lands last, wherever it was held", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  layOutTabs();

  // Work spans 300 to 390, held near its start and let go at 40, short of
  // Board's middle at 45, though its own middle stands past Board's.
  dragTab(tabNamed(page, "Work"), 305, [200, 40], DRAG_END.DROP);
  assert.deepEqual(panelTabs(page), ["Work", "Board", "Code", "Transcript"]);

  // Board, now at 100 to 190, held near its end and let go at 350, past
  // Transcript's middle at 345, though its own middle falls short of it.
  dragTab(tabNamed(page, "Board"), 185, [250, 350], DRAG_END.DROP);
  assert.deepEqual(panelTabs(page), ["Work", "Code", "Transcript", "Board"]);
});

test("only the fixed tabs move: one dragged on among the agents' tabs lands last of the fixed, and an agent's tab is not dragged nor stepped", () => {
  const agent: CodingAgentSummary = {
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    planId: PLAN.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    createdAt: 3,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
  };
  const agents = codingAgentsControl({ agents: [agent], agentIds: [agent.id] });
  const page = mountOpenPlan({ agents });
  press(page, '[aria-label="Show panel"]');
  layOutTabs({ width: 6 * TAB_PITCH });
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work", "Claude Opus 5.5"]);

  // Let go at 480, past the agent's middle at 445.
  const moved = dragTab(tabNamed(page, "Board"), 45, [200, 480], DRAG_END.DROP);
  assert.deepEqual(moved, ["Board", "Code", "Transcript", "Work"], "the agent's tab stands still");
  assert.deepEqual(panelTabs(page), ["Code", "Transcript", "Work", "Board", "Claude Opus 5.5"]);
  assert.equal(movedSaid(page), "Board moved to position 4 of 5");

  const claude = tabNamed(page, "Claude Opus 5.5");
  assert.deepEqual(dragTab(claude, 445, [300, 100], DRAG_END.DROP), []);
  assert.deepEqual(panelTabs(page), ["Code", "Transcript", "Work", "Board", "Claude Opus 5.5"]);

  const board = tabNamed(page, "Board");
  act(() => board.focus());
  keydown({ key: "ArrowRight", code: "ArrowRight", metaKey: true, shiftKey: true });
  assert.deepEqual(panelTabs(page), ["Code", "Transcript", "Work", "Board", "Claude Opus 5.5"]);
  assert.equal(movedSaid(page), "Board moved to position 4 of 5", "no move is said");
});

test("Shift-Command-Arrow moves the focused tab along the strip, focus and choice staying put, and says where", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const right = { key: "ArrowRight", code: "ArrowRight", metaKey: true, shiftKey: true };
  const left = { key: "ArrowLeft", code: "ArrowLeft", metaKey: true, shiftKey: true };
  assert.equal(keydown(right), false, "with no tab focused the chord is left alone");

  const code = tabNamed(page, "Code");
  act(() => code.focus());
  keydown(right);
  keydown(right);
  assert.deepEqual(panelTabs(page), ["Board", "Transcript", "Work", "Code"]);
  assert.equal(document.activeElement, code);
  assert.equal(chosenTab(page), "Board");
  assert.equal(movedSaid(page), "Code moved to position 4 of 4");

  keydown(right);
  assert.deepEqual(panelTabs(page), ["Board", "Transcript", "Work", "Code"], "the last stays last");
  for (const _ of SIDE_PANEL_TABS) keydown(left);
  assert.deepEqual(panelTabs(page), ["Code", "Board", "Transcript", "Work"]);
  assert.equal(document.activeElement, code);
});

/** Lays the panel's tabs out in a row as `layOutTabs` does, in a strip that shows only `shown.tabs` of them at a time, two unless said, and scrolls. */
function layOutScrollingTabs(shown: { tabs: number } = { tabs: 2 }): HTMLElement {
  const strip = document.querySelector<HTMLElement>(".side-panel .tab-strip");
  assert.ok(strip, "the panel draws its tabs");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === strip) return DOMRect.fromRect({ width: shown.tabs * TAB_PITCH });
    const at = this.parentElement === strip ? [...strip.children].indexOf(this) : -1;
    return DOMRect.fromRect(
      at < 0 ? {} : { x: at * TAB_PITCH - strip.scrollLeft, width: TAB_WIDTH },
    );
  });
  return strip;
}

/** Whether the strip shows the whole of the named tab's pill. */
function tabInView(page: HTMLElement, strip: HTMLElement, label: string): boolean {
  const pill = tabNamed(page, label).closest(".tab");
  assert.ok(pill, `no pill for ${label}`);
  const own = pill.getBoundingClientRect();
  const shown = strip.getBoundingClientRect();
  return own.left >= shown.left && own.right <= shown.right;
}

test("a tab chosen, or opened, past the strip's shown room is scrolled into view, and so is one the arrow keys reach", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const strip = layOutScrollingTabs();
  assert.equal(tabInView(page, strip, "Work"), false);

  act(() => tabNamed(page, "Work").click());
  assert.ok(tabInView(page, strip, "Work"), "the chosen tab is brought into view");
  assert.equal(tabInView(page, strip, "Board"), false);

  const work = tabNamed(page, "Work");
  act(() => work.focus());
  key(work, "Home");
  assert.equal(document.activeElement, tabNamed(page, "Board"));
  assert.ok(tabInView(page, strip, "Board"), "the tab the keys reach is brought into view");

  key(tabNamed(page, "Board"), "Delete");
  keydown({ code: "Digit1", key: "¡", metaKey: true, altKey: true });
  assert.deepEqual(panelTabs(page), ["Code", "Transcript", "Work", "Board"]);
  assert.ok(
    tabInView(page, strip, "Board"),
    "a tab opened at the strip's end is brought into view",
  );
});

/**
 * The display's frames, run when a test says: each frame asked for is held
 * until `run` runs it, as the window would on its next paint.
 */
function heldFrames() {
  const asked = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    next += 1;
    asked.set(next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => asked.delete(frame));
  // Runs frames until none is asked for, answering how many ran.
  const run = () => {
    let ran = 0;
    for (const [frame, callback] of asked) {
      asked.delete(frame);
      act(() => callback(ran));
      ran += 1;
      assert.ok(ran < 1000, "the frames never stop being asked for");
    }
    return ran;
  };
  return { run };
}

test("a tab held at the edge of a strip scrolled along runs it back to the tabs it hides, and lands first", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const strip = layOutScrollingTabs();
  act(() => tabNamed(page, "Work").click());
  assert.equal(tabInView(page, strip, "Board"), false, "Board is scrolled out of sight");
  const frames = heldFrames();

  // Work, shown at 110 to 200, held at 10, within the strip's faded edge.
  dragTab(tabNamed(page, "Work"), 155, [100, 10], DRAG_END.DROP, () => {
    assert.ok(frames.run() > 1, "the strip runs along over frames");
  });
  assert.deepEqual(panelTabs(page), ["Work", "Board", "Code", "Transcript"]);
});

test("a tab held still while the strip scrolls under it lands where the row has brought it", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const strip = layOutScrollingTabs();

  // Code, held at 150, clear of both edges, while a wheel runs the row two tabs along.
  dragTab(tabNamed(page, "Code"), 145, [150], DRAG_END.DROP, () =>
    act(() => {
      strip.scrollLeft = 2 * TAB_PITCH;
      strip.dispatchEvent(new Event("scroll"));
    }),
  );
  assert.deepEqual(panelTabs(page), ["Board", "Transcript", "Work", "Code"]);
});

test("a strip narrowed past its chosen tab scrolls to keep it in view", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const shown = { tabs: 4 };
  const strip = layOutScrollingTabs(shown);
  act(() => tabNamed(page, "Work").click());
  assert.equal(strip.scrollLeft, 0, "the strip shows every tab");

  shown.tabs = 2;
  act(() => relayout());
  assert.ok(tabInView(page, strip, "Work"));
});

test("a wheel turned up and down over a strip with tabs hidden runs it along, a line of a wheel that counts lines a line of text", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const strip = page.querySelector<HTMLElement>(".side-panel .tab-strip");
  assert.ok(strip, "the panel draws its tabs");
  const wheel = (init: WheelEventInit) =>
    act(() => {
      strip.dispatchEvent(new WheelEvent("wheel", { bubbles: true, ...init }));
    });

  wheel({ deltaY: 120 });
  assert.equal(strip.scrollLeft, 0, "a strip showing every tab does not scroll");

  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this === strip ? 400 : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this === strip ? 200 : 0;
  });
  wheel({ deltaY: 120 });
  assert.equal(strip.scrollLeft, 120);
  wheel({ deltaY: -3, deltaMode: WheelEvent.DOM_DELTA_LINE });
  assert.equal(strip.scrollLeft, 72);
  wheel({ deltaX: 40, deltaY: 10 });
  assert.equal(strip.scrollLeft, 72, "a sideways swipe is the strip's own native scroll");
});

/** The edges of the strip faded for the tabs it hides beyond them. */
function fadedEdges(strip: HTMLElement): string[] {
  const start = strip.getAttribute("data-overflow-start") === "true" ? ["start"] : [];
  return strip.getAttribute("data-overflow-end") === "true" ? [...start, "end"] : start;
}

test("the strip fades exactly the edges it hides tabs beyond, as it scrolls, resizes, and opens and closes tabs", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const strip = page.querySelector<HTMLElement>(".side-panel .tab-strip");
  assert.ok(strip, "the panel draws its tabs");
  const shown = { width: 4 * TAB_PITCH };
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this === strip ? strip.children.length * TAB_PITCH : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this === strip ? shown.width : 0;
  });
  const scroll = (to: number) =>
    act(() => {
      strip.scrollLeft = to;
      strip.dispatchEvent(new Event("scroll"));
    });
  act(() => relayout());
  assert.deepEqual(fadedEdges(strip), [], "a strip showing every tab fades neither edge");

  shown.width = 2 * TAB_PITCH;
  act(() => relayout());
  assert.deepEqual(fadedEdges(strip), ["end"]);
  scroll(2 * TAB_PITCH);
  assert.deepEqual(fadedEdges(strip), ["start"]);
  scroll(TAB_PITCH);
  assert.deepEqual(fadedEdges(strip), ["start", "end"]);

  // Widened to hold every tab, as the panel's edge is dragged out; the
  // strip, scrolled no further than it can be, comes back to its start.
  shown.width = 4 * TAB_PITCH;
  strip.scrollLeft = 0;
  act(() => relayout());
  assert.deepEqual(fadedEdges(strip), [], "the fades go once every tab is held");

  // The tabs' fractional widths can leave a sub-pixel the strip rounds up to one.
  shown.width = 4 * TAB_PITCH - 1;
  act(() => relayout());
  assert.deepEqual(
    fadedEdges(strip),
    [],
    "a strip that holds every tab to the eye fades neither edge",
  );

  shown.width = 3 * TAB_PITCH;
  act(() => relayout());
  assert.deepEqual(fadedEdges(strip), ["end"]);
  press(page, '[aria-label="Close Board"]');
  assert.deepEqual(fadedEdges(strip), [], "a tab closed leaves room for the rest");
  keydown({ code: "Digit1", key: "¡", metaKey: true, altKey: true });
  assert.deepEqual(fadedEdges(strip), ["end"], "a tab opened hides one again");
});

test("the plan's tab, cut short as its toolbar narrows, says its whole name in its hint", () => {
  const page = mountOpenPlan();
  const label = page.querySelector('.desktop-toolbar [role="tab"] .tab-label');
  assert.ok(label, "the plan's tab draws its name");
  const tab = tabNamed(page, PLAN.name);
  assert.equal(hover(tab), undefined);

  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this === label ? 180 : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this === label ? 60 : 0;
  });
  act(() => relayout());
  assert.equal(hover(tab), PLAN.name);
});

/** A coding agent of the plan's that is running, on Claude. */
const RUNNING_AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: PLAN.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  createdAt: 3,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

/** A coding agent of the plan's that has finished, on GPT. */
const DONE_AGENT: CodingAgentSummary = {
  ...RUNNING_AGENT,
  id: "1f6d2c3b-5a4e-4f7d-9c8b-2e3f4a5b6c7d",
  model: "openai/gpt-5.6-sol",
  status: CODING_AGENT_STATUS.COMPLETED,
};

/** Every Stop an agent was asked for on the page below. */
let stops: string[] = [];

/** The agents the service answers a read of the list with on the page below, which it opens on. */
let listed: readonly CodingAgentSummary[] = [];

/**
 * The open plan's page over the real side panel with the plan's coding
 * agents, read again as the service lists them, and every Stop recorded.
 */
function AgentsPage({ work }: { work?: PlansControl["work"] | undefined }) {
  const [agents, setAgents] = useState(listed);
  const agentIds = agents.map((agent) => agent.id);
  const sidePanel = useSidePanel(undefined, agentIds, workerCallIds(work?.turns));
  const page = createElement(DesktopPlans, {
    plans: plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN.id,
      region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
      sidePanel,
      agents: codingAgentsControl({
        agents,
        agentIds,
        onStop: (agentId) => {
          stops.push(agentId);
          return Promise.resolve();
        },
        onRetryList: () => setAgents(listed),
      }),
      ...(work === undefined ? undefined : { work }),
    }),
  });
  return createElement(
    Fragment,
    null,
    page,
    createElement(SidePanelToggle, { panel: sidePanel, disabled: false }),
  );
}

/** Mounts the plan's page with its agents and the panel shown. */
function mountAgents(work?: PlansControl["work"]): HTMLElement {
  installScrollIntoView();
  stops = [];
  listed = [RUNNING_AGENT, DONE_AGENT];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(AgentsPage, { work })));
  press(container, '[aria-label="Show panel"]');
  return container;
}

/** The "+" menu's sections after the fixed kinds: each heading and the rows under it. */
function addSections(): [string | null, string[]][] {
  return [...document.querySelectorAll<HTMLElement>('.tab-add-menu [role="group"]')].map(
    (group) => [
      group.getAttribute("aria-label"),
      [...group.querySelectorAll('[role="option"]')].map(
        (row) => row.querySelector(".plan-compose-menu-name")?.textContent ?? "",
      ),
    ],
  );
}

/** The "+" menu's row named so. */
function addRow(label: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('.tab-add-menu [role="option"]')].find(
    (each) => each.querySelector(".plan-compose-menu-name")?.textContent === label,
  );
  assert.ok(row, `no ${label} row in the + menu`);
  return row;
}

test("the + lists the plan's coding agents and its subagents in sections of their own, each with its tab's glyph and where it stands, found by a search, and picking one opens its tab or chooses the one open", () => {
  const job = "Compare the two queue libraries.";
  const page = mountAgents(workerWork(job));
  act(() => addButton(page).click());

  assert.deepEqual(addSections(), [
    ["Coding agents", ["Claude Opus 5.5", "GPT 5.6 Sol"]],
    ["Subagents", [job]],
  ]);
  assert.deepEqual(addRows().slice(4), [
    ["Claude Opus 5.5", "Open", true],
    ["GPT 5.6 Sol", "Open", true],
    [job, "", true],
  ]);
  const claude = addRow("Claude Opus 5.5");
  assert.equal(claude.querySelector(".agent-status-dot")?.getAttribute("data-status"), "running");
  assert.equal(claude.querySelector(".plan-compose-menu-detail")?.textContent, "Running");
  assert.ok(claude.querySelector(".animate-shimmer"), "a running agent's state shimmers");
  const sol = addRow("GPT 5.6 Sol");
  assert.equal(sol.querySelector(".plan-compose-menu-detail")?.textContent, "Done");
  assert.equal(sol.querySelector(".animate-shimmer"), null);
  const worker = addRow(job);
  assert.ok(worker.querySelector("svg.lucide-bot"), "the worker's glyph");
  assert.equal(worker.querySelector(".plan-compose-menu-detail")?.textContent, "Running");

  // An agent's tab already open is chosen again, not doubled.
  typeSearch("sol");
  assert.deepEqual(
    addRows().map(([label]) => label),
    ["GPT 5.6 Sol"],
  );
  key(focused(), "Enter");
  assert.equal(document.querySelector(".tab-add-menu"), null);
  assert.equal(chosenTab(page), "GPT 5.6 Sol");
  assert.deepEqual(panelTabs(page), [
    "Board",
    "Code",
    "Transcript",
    "Work",
    "Claude Opus 5.5",
    "GPT 5.6 Sol",
  ]);

  // A subagent is found by its section's name too, and opens its tab at the strip's end.
  act(() => addButton(page).click());
  typeSearch("subagents");
  assert.deepEqual(
    addRows().map(([label]) => label),
    [job],
  );
  key(focused(), "Enter");
  assert.equal(panelTabs(page).at(-1), job);
  assert.equal(chosenTab(page), job);
  act(() => addButton(page).click());
  assert.equal(addRow(job).querySelector(".plan-compose-menu-hint")?.textContent, "Open");
});

test("an agent's × or Delete closes its tab and nothing of the agent's: it is not stopped, the + lists it as it stands, and picking it there opens the tab again in its place", () => {
  const page = mountAgents();
  act(() => tabNamed(page, "Claude Opus 5.5").click());

  press(page, '[aria-label="Close Claude Opus 5.5"]');
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work", "GPT 5.6 Sol"]);
  assert.equal(chosenTab(page), "GPT 5.6 Sol", "the agent after it");
  assert.deepEqual(stops, []);

  act(() => addButton(page).click());
  const claude = addRow("Claude Opus 5.5");
  assert.equal(claude.querySelector(".plan-compose-menu-hint"), null, "its tab is not open");
  assert.equal(claude.querySelector(".plan-compose-menu-detail")?.textContent, "Running");
  act(() => claude.click());
  assert.deepEqual(panelTabs(page), [
    "Board",
    "Code",
    "Transcript",
    "Work",
    "Claude Opus 5.5",
    "GPT 5.6 Sol",
  ]);
  assert.equal(chosenTab(page), "Claude Opus 5.5");

  const sol = tabNamed(page, "GPT 5.6 Sol");
  act(() => sol.focus());
  key(sol, "Delete");
  assert.deepEqual(panelTabs(page), ["Board", "Code", "Transcript", "Work", "Claude Opus 5.5"]);
  assert.equal(chosenTab(page), "Claude Opus 5.5", "closing another tab leaves the chosen one");
  assert.deepEqual(stops, []);
});

test("the + reads the plan's agents again as it opens, so an agent no tab follows says where it stands now", () => {
  const page = mountAgents();
  press(page, '[aria-label="Close Claude Opus 5.5"]');

  // The agent finishes with its tab closed, where no transcript follows it.
  listed = [{ ...RUNNING_AGENT, status: CODING_AGENT_STATUS.COMPLETED }, DONE_AGENT];
  act(() => addButton(page).click());
  assert.equal(
    addRow("Claude Opus 5.5").querySelector(".plan-compose-menu-detail")?.textContent,
    "Done",
  );
});
