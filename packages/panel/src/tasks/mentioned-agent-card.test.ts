// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  encodeMention,
  MENTION_KIND,
  type MentionPlace,
  mentionMarkdown,
} from "@luke/features/mention-link";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { ACTOR_KIND, ACTOR_STATE } from "@luke/ui/actor-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { type AnyAct, type AnyActOutcome, fakeActs } from "../testing/app-bridge.js";
import { signedInAs } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { MentionNodeChip } from "./mention-chip.js";
import { MentionedAgents } from "./mentioned-agent-card.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { WordsWorkspace } from "./use-link-standing.js";

/**
 * mentioned-agent-card.test.ts -- a chip of a coding agent the place has no
 * tab of, an agent on another task of the workspace or on none, in words
 * drawn off that task's page as the Inbox draws them, hangs the agent's
 * tab's own card: its name, its model, where it stands, who started it, and
 * the task it works on. A chip of an agent the window lists reads nothing
 * as it is drawn; one of an agent it lists not, an archived one say, takes
 * its card's read as it is drawn, so its mark wears its harness, and the
 * card hung after shares it: its task's agents once, or, for an agent on
 * no task, the workspace's agents its written name finds, then the newest,
 * and only then says it is not found. A read that answers nothing leaves
 * the chip's own card. Synthetic workspace, tasks, and agents.
 */

const AT = 1_792_000_000_000;

const ME = "user-dean";

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 2,
};

const PLACE: MentionPlace = { workspace: "acme", repository: "acme/relay" };

const BILLING: TaskSummary = {
  id: "4e3d2c1b-0a9f-4e8d-9c7b-6a5f4e3d2c1b",
  workspaceId: ACME.id,
  name: "Billing by seat",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
};

function agentOf(id: string, overrides: Partial<CodingAgentSummary>): CodingAgentSummary {
  return {
    id,
    planId: BILLING.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Prorate seat changes",
    createdAt: AT,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: null,
    startedBy: { userId: "user-sam", name: "Sam Okafor" },
    ...overrides,
  };
}

const PRORATE = agentOf("7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f", {});

const SWEEPER = agentOf("5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a", {
  planId: null,
  title: "Sweep flaky tests",
  status: CODING_AGENT_STATUS.COMPLETED,
  startedBy: { userId: ME, name: "Dean Stratakos" },
});

/** An agent on no task the workspace's newest list, and no search, finds. */
const AUDITOR = agentOf("2a1b0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d", {
  planId: null,
  title: "Audit retries",
  status: CODING_AGENT_STATUS.COMPLETED,
});

/** An agent on no task older than the workspace's newest, renamed since its chip was written, found only by its id. */
const ARCHIVIST = agentOf("6e5d4c3b-2a1f-4e0d-9c8b-7a6f5e4d3c2b", {
  planId: null,
  title: "Archive stale branches",
  status: CODING_AGENT_STATUS.COMPLETED,
});

/** Main's document holding the billing task, by which an agent of it names where it works. */
const STATE: AppStateSnapshot = (() => {
  const snapshot = signedInAs({ id: ME, email: "dean@example.com", name: "Dean Stratakos" });
  return {
    ...snapshot,
    tasks: { ...IDLE_TASKS_VIEW, tasks: [BILLING], workspaces: [ACME] },
  };
})();

/** Every act the panel told the main process, in order. */
const told: AnyAct[] = [];

/** Whether the service answers reads of agents; refused otherwise. */
let answering = true;

let root: Root | undefined;

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  told.length = 0;
  answering = true;
});

/** What the main process answers: a task's agents, and the workspace's searched or newest. */
function answer(request: AnyAct): AnyActOutcome {
  if (!answering) return { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not now." };
  if (request.kind === ACT_KIND.CODING_AGENTS_LIST) {
    const agents = request.payload.taskId === BILLING.id ? [PRORATE] : [];
    return { status: ACT_OUTCOME_STATUS.DONE, value: { agents } };
  }
  if (request.kind === ACT_KIND.CODING_AGENTS_WORKSPACE_LIST) {
    const { words } = request.payload;
    const agents =
      words === undefined
        ? [AUDITOR]
        : [SWEEPER, AUDITOR].filter((agent) =>
            agent.title?.toLowerCase().includes(words.toLowerCase()),
          );
    return { status: ACT_OUTCOME_STATUS.DONE, value: { agents } };
  }
  if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
    return request.payload.agentId === ARCHIVIST.id
      ? {
          status: ACT_OUTCOME_STATUS.DONE,
          value: {
            agent: {
              ...ARCHIVIST,
              automationId: null,
              workspaceId: ACME.id,
              repository: "acme/relay",
            },
          },
        }
      : {
          status: ACT_OUTCOME_STATUS.DONE,
          value: { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND },
        };
  }
  return { status: ACT_OUTCOME_STATUS.DONE, value: undefined };
}

/** Main's document as `STATE`, its billing row naming the prorater and its agents with no task the sweeper, as the plan list carries them. */
const LISTING_STATE: AppStateSnapshot = {
  ...STATE,
  tasks: {
    ...STATE.tasks,
    tasks: [
      {
        ...BILLING,
        agents: {
          total: 1,
          working: 1,
          agents: [
            {
              id: PRORATE.id,
              title: PRORATE.title,
              model: PRORATE.model,
              effort: PRORATE.effort,
              status: PRORATE.status,
            },
          ],
          pullRequestTotal: 0,
          pullRequests: [],
        },
      },
    ],
    tasklessAgents: [
      {
        ...SWEEPER,
        automationId: null,
        workspaceId: ACME.id,
        repository: "acme/relay",
        activityAt: AT,
      },
    ],
  },
};

/** The words drawn as the Inbox draws them, off any task's page, in the workspace given, main's document being `state`. */
function drawn(text: string, state: AppStateSnapshot = STATE): Promise<HTMLElement> {
  return drawnElement(createElement(TranscriptWords, { text }), state);
}

/** An element drawn where the Inbox draws words, in the workspace given, main's document being `state`. */
async function drawnElement(
  element: ReactElement,
  state: AppStateSnapshot = STATE,
): Promise<HTMLElement> {
  fakeActs({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
    act: (request: AnyAct): Promise<AnyActOutcome> => {
      told.push(request);
      return Promise.resolve(answer(request));
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const words = createElement(WordsWorkspace, {
    value: ACME.id,
    children: element,
  });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MentionedAgents, {
          value: { models: [], me: ME },
          children: words,
        }),
      ),
    ),
  );
  await settle();
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** An agent's mention, under its task or under none, as its chip is written. */
function mentionOf(agent: CodingAgentSummary, name: string): string {
  return mentionMarkdown(
    agent.planId === null
      ? { kind: MENTION_KIND.AGENT, agentId: agent.id }
      : { kind: MENTION_KIND.AGENT, taskId: agent.planId, agentId: agent.id },
    name,
    PLACE,
  );
}

/** The acts that read agents, as told. */
function agentReads(): readonly AnyAct[] {
  return told.filter(
    (request) =>
      request.kind === ACT_KIND.CODING_AGENTS_LIST ||
      request.kind === ACT_KIND.CODING_AGENTS_WORKSPACE_LIST ||
      request.kind === ACT_KIND.CODING_AGENTS_PAGE,
  );
}

/** What the card a chip hangs says, once its read has landed: the agent's tab's card, or the chip's own. */
async function cardOf(chip: Element | undefined) {
  assert.ok(chip, "the agent is drawn as its chip");
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  await settle();
  const card = [...document.querySelectorAll(".luke-tooltip-card > *")].at(-1);
  assert.ok(card, "the chip hangs a card");
  const look = {
    tab: card.matches("[data-tab-card]"),
    name: card.querySelector(".luke-hover-card-name")?.textContent,
    model: card.querySelector("[data-model-label]")?.textContent,
    corner: card.querySelector(".luke-hover-card-corner")?.textContent,
    foot: card.querySelector(".luke-hover-card-rule + .luke-hover-card-note")?.textContent,
    words: card.textContent,
  };
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return look;
}

test("chips of agents off their task's page that the window lists read nothing as they are drawn", async () => {
  await drawn(
    `${mentionOf(PRORATE, "Prorate seat changes")} and ${mentionOf(SWEEPER, "Sweep flaky tests")}`,
    LISTING_STATE,
  );

  assert.deepEqual(agentReads(), []);
});

test("a chip of an agent the window lists not reads its task's agents once as it is drawn, wearing its harness, and the card hung after reads nothing more", async () => {
  const container = await drawn(`Ask ${mentionOf(PRORATE, "Prorate")}.`);
  const chip = container.querySelector("[data-mention-ref]") ?? undefined;

  assert.ok(
    chip?.querySelector(".luke-inline-ref-glyph .harness-mark"),
    "the chip wears its harness",
  );
  const card = await cardOf(chip);
  assert.equal(card.name, "Prorate seat changes");
  assert.deepEqual(agentReads(), [
    {
      kind: ACT_KIND.CODING_AGENTS_LIST,
      payload: { taskId: BILLING.id, includeArchived: true },
    },
  ]);
});

test("a mention of an agent the window lists not, laid in a message box as an Inbox answer's is, wears its harness", async () => {
  // The box stands on another task's page, whose doors know only that task's agents.
  const container = await drawnElement(
    createElement(MentionNodeChip, {
      mention: {
        name: "Prorate seat changes",
        target: encodeMention(
          { kind: MENTION_KIND.AGENT, taskId: BILLING.id, agentId: PRORATE.id },
          PLACE,
        ),
      },
      doors: {
        taskId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
        place: PLACE,
        anchors: new Set<string>(),
        onOpenTask: () => undefined,
        onOpenFile: undefined,
        agentOf: () => ({
          actor: {
            kind: ACTOR_KIND.AGENT,
            name: "Coding agent",
            provider: undefined,
            state: ACTOR_STATE.REST,
          },
          card: null,
        }),
      },
    }),
  );

  assert.ok(
    container.querySelector(".luke-inline-ref-glyph .harness-mark"),
    "the box's chip wears its harness",
  );
});

test("a mention of its own task's agent whose tile the page knows no harness of wears the harness read for it", async () => {
  // The box stands on the agent's own task's page, whose agents are not yet read.
  const container = await drawnElement(
    createElement(MentionNodeChip, {
      mention: {
        name: "Prorate seat changes",
        target: encodeMention(
          { kind: MENTION_KIND.AGENT, taskId: BILLING.id, agentId: PRORATE.id },
          PLACE,
        ),
      },
      doors: {
        taskId: BILLING.id,
        place: PLACE,
        anchors: new Set<string>(),
        onOpenTask: () => undefined,
        onOpenFile: undefined,
        agentOf: () => ({
          actor: {
            kind: ACTOR_KIND.AGENT,
            name: "Coding agent",
            provider: undefined,
            state: ACTOR_STATE.REST,
          },
          card: null,
        }),
      },
    }),
  );

  assert.ok(
    container.querySelector(".luke-inline-ref-glyph .harness-mark"),
    "the box's chip wears its harness",
  );
});

test("an agent on another task hangs its tab's card, its task's agents read once as it is hung, naming the task it works on", async () => {
  const container = await drawn(`Ask ${mentionOf(PRORATE, "Prorate")}.`);

  const card = await cardOf(container.querySelector("[data-mention-ref]") ?? undefined);

  assert.equal(card.tab, true, "the card is the agent's tab's own");
  assert.equal(card.name, "Prorate seat changes");
  assert.equal(card.model, "Opus 5.5 High");
  assert.match(card.corner ?? "", /^Working…/u);
  assert.match(card.words ?? "", /Started by.*Sam Okafor/u);
  assert.equal(card.foot, "On Billing by seat");
  assert.deepEqual(agentReads(), [
    {
      kind: ACT_KIND.CODING_AGENTS_LIST,
      payload: { taskId: BILLING.id, includeArchived: true },
    },
  ]);
});

test("an agent on no task is found by the name its chip was written with, else among the workspace's newest, else by its id, and is otherwise not found", async () => {
  const container = await drawn(
    [
      mentionOf(SWEEPER, "Sweep flaky tests"),
      mentionOf(AUDITOR, "The auditor"),
      mentionOf(ARCHIVIST, "The archiver"),
      mentionOf(agentOf("0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c", { planId: null }), "Gone"),
    ].join(" "),
  );
  const [searched, newest, byId, gone] = container.querySelectorAll("[data-mention-ref]");

  const sweeper = await cardOf(searched);
  const auditor = await cardOf(newest);
  const archivist = await cardOf(byId);
  const missing = await cardOf(gone);

  assert.deepEqual(
    [sweeper.name, sweeper.foot, auditor.name, auditor.foot],
    ["Sweep flaky tests", "On no task", "Audit retries", "On no task"],
  );
  assert.doesNotMatch(
    sweeper.words ?? "",
    /Started by/u,
    "the reader's own agent names no starter",
  );
  assert.deepEqual([archivist.name, archivist.foot], ["Archive stale branches", "On no task"]);
  assert.equal(missing.corner, "Not found");
  assert.equal(missing.foot, undefined, "an agent not found works nowhere the card can say");
  // Note that each chip reads as it is drawn, so the four chains interleave and are compared whole.
  const inOrder = (payloads: readonly unknown[]) =>
    payloads.map((payload) => JSON.stringify(payload)).sort();
  assert.deepEqual(
    inOrder(agentReads().map((request) => ("payload" in request ? request.payload : undefined))),
    inOrder([
      { workspaceId: ACME.id, includeArchived: true, words: "Sweep flaky tests" },
      { workspaceId: ACME.id, includeArchived: true, words: "The auditor" },
      { workspaceId: ACME.id, includeArchived: true },
      { workspaceId: ACME.id, includeArchived: true, words: "The archiver" },
      { workspaceId: ACME.id, includeArchived: true },
      { agentId: ARCHIVIST.id },
      { workspaceId: ACME.id, includeArchived: true, words: "Gone" },
      { workspaceId: ACME.id, includeArchived: true },
      { agentId: "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c" },
    ]),
  );
});

test("where the read answers nothing, the chip's own card says where the agent works", async () => {
  answering = false;
  const container = await drawn(`Ask ${mentionOf(PRORATE, "Prorate")}.`);

  const card = await cardOf(container.querySelector("[data-mention-ref]") ?? undefined);

  assert.equal(card.tab, false);
  assert.match(card.words ?? "", /A coding agent on another task/u);
});

test("two chips of one task's agents hung one after the other share the task's read", async () => {
  const container = await drawn(
    `${mentionOf(PRORATE, "Prorate")} then ${mentionOf(PRORATE, "the prorater")}.`,
  );
  const [first, second] = container.querySelectorAll("[data-mention-ref]");

  act(() => {
    first?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  await settle();
  const card = await cardOf(second);

  assert.equal(card.name, "Prorate seat changes");
  assert.equal(agentReads().length, 1);
});
