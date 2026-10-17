// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@luke/features/mention-link";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
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
import { MentionedAgents } from "./mentioned-agent-card";
import { TranscriptWords } from "./transcript-blocks";
import { WordsWorkspace } from "./use-link-standing";

/**
 * mentioned-agent-card.test.ts -- a chip of a coding agent the place has no
 * tab of, an agent on another task of the workspace or on none, in words
 * drawn off that task's page as the Inbox draws them, hangs the agent's
 * tab's own card: its name, its model, where it stands, who started it, and
 * the task it works on. Nothing is read as the chips are drawn; a hung card
 * reads its task's agents once, or, for an agent on no task, the
 * workspace's agents its written name finds, then the newest, and only then
 * says it is not found. A read that answers nothing leaves the chip's own
 * card. Synthetic workspace, tasks, and agents.
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
const told: Act[] = [];

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
function answer(request: Act): ActOutcome {
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

/** The words drawn as the Inbox draws them, off any task's page, in the workspace given. */
async function drawn(text: string): Promise<HTMLElement> {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      onAppState: () => () => undefined,
      requestAppState: () => Promise.resolve(STATE),
      act: (request: Act): Promise<ActOutcome> => {
        told.push(request);
        return Promise.resolve(answer(request));
      },
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const words = createElement(WordsWorkspace, {
    value: ACME.id,
    children: createElement(TranscriptWords, { text }),
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
function agentReads(): readonly Act[] {
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
    name: card.querySelector(".card-name")?.textContent,
    model: card.querySelector("[data-model-label]")?.textContent,
    corner: card.querySelector(".card-corner")?.textContent,
    foot: card.querySelector(".card-rule + .card-note")?.textContent,
    words: card.textContent,
  };
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return look;
}

test("chips of agents off their task's page read nothing as they are drawn", async () => {
  await drawn(
    `${mentionOf(PRORATE, "Prorate seat changes")} and ${mentionOf(SWEEPER, "Sweep flaky tests")}`,
  );

  assert.deepEqual(agentReads(), []);
});

test("an agent on another task hangs its tab's card, its task's agents read once as it is hung, naming the task it works on", async () => {
  const container = await drawn(`Ask ${mentionOf(PRORATE, "Prorate")}.`);

  const card = await cardOf(container.querySelector(".mention-chip") ?? undefined);

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
  const [searched, newest, byId, gone] = container.querySelectorAll(".mention-chip");

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
  assert.deepEqual(
    agentReads().map((request) => ("payload" in request ? request.payload : undefined)),
    [
      { workspaceId: ACME.id, includeArchived: true, words: "Sweep flaky tests" },
      { workspaceId: ACME.id, includeArchived: true, words: "The auditor" },
      { workspaceId: ACME.id, includeArchived: true },
      { workspaceId: ACME.id, includeArchived: true, words: "The archiver" },
      { workspaceId: ACME.id, includeArchived: true },
      { agentId: ARCHIVIST.id },
      { workspaceId: ACME.id, includeArchived: true, words: "Gone" },
      { workspaceId: ACME.id, includeArchived: true },
      { agentId: "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c" },
    ],
  );
});

test("where the read answers nothing, the chip's own card says where the agent works", async () => {
  answering = false;
  const container = await drawn(`Ask ${mentionOf(PRORATE, "Prorate")}.`);

  const card = await cardOf(container.querySelector(".mention-chip") ?? undefined);

  assert.equal(card.tab, false);
  assert.match(card.words ?? "", /A coding agent on another task/u);
});

test("two chips of one task's agents hung one after the other share the task's read", async () => {
  const container = await drawn(
    `${mentionOf(PRORATE, "Prorate")} then ${mentionOf(PRORATE, "the prorater")}.`,
  );
  const [first, second] = container.querySelectorAll(".mention-chip");

  act(() => {
    first?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  await settle();
  const card = await cardOf(second);

  assert.equal(card.name, "Prorate seat changes");
  assert.equal(agentReads().length, 1);
});
