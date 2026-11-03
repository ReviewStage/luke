// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import {
  encodeMention,
  MENTION_KIND,
  type MentionPlace,
  mentionMarkdown,
} from "@repo/features/mention-link";
import type { TaskSummary } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, TASKS_READ } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { ACTOR_KIND, ACTOR_STATE, APP_ACTOR } from "@repo/ui/actor-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { ActorRef } from "../actor-ref.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { signedInAs } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { MentionNodeChip } from "./mention-chip.js";
import { MentionedAgents } from "./mentioned-agent-card.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { WordsWorkspace } from "./use-link-standing.js";

/**
 * mentioned-agent-card.test.ts -- a chip of a coding agent the place has no
 * tab of, an agent on another task of the workspace or on none, in words
 * drawn off that task's page as the Inbox draws them, hangs the agent's
 * tab's own card: its name, its model, who started it, and the task it
 * works on, drawn from the agents the task list carries, so neither drawing
 * a chip nor hanging its card asks the service anything. A mark the window
 * holds no model for wears the harness the list carries; an agent the list
 * carries not keeps the chip's own card, and until the list first answers
 * the card stands in its reading state. A pull request's chip hangs its Pull
 * request tab's card from the pull request the list holds of its agent.
 * Synthetic workspace, tasks, and agents.
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

function agentOf(id: string, overrides: Partial<AgentSummary>): AgentSummary {
  return {
    id,
    planId: BILLING.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Prorate seat changes",
    createdAt: AT,
    status: AGENT_STATUS.RUNNING,
    turnId: null,
    startedBy: { userId: "user-sam", name: "Sam Okafor" },
    ...overrides,
  };
}

const PRORATE = agentOf("7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f", {});

const SWEEPER = agentOf("5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a", {
  planId: null,
  title: "Sweep flaky tests",
  status: AGENT_STATUS.COMPLETED,
  startedBy: { userId: ME, name: "Dean Stratakos" },
});

/** An agent on no task the task list carries not, one of a workspace the reader left say. */
const AUDITOR = agentOf("2a1b0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d", {
  planId: null,
  title: "Audit retries",
  status: AGENT_STATUS.COMPLETED,
});

/** Main's document holding the billing task, by which an agent of it names where it works, before the task list first answers live. */
const STATE: AppStateSnapshot = (() => {
  const snapshot = signedInAs({ id: ME, email: "dean@example.com", name: "Dean Stratakos" });
  return {
    ...snapshot,
    tasks: { ...IDLE_TASKS_VIEW, tasks: [BILLING], workspaces: [ACME] },
  };
})();

/** Every act the panel told the main process, in order. */
const told: AnyAct[] = [];

/** The pull request the prorater opened, as its Pull request tab reads it. */
const SEAT_PULL_REQUEST: AgentPullRequest = {
  number: 42,
  title: "Prorate seats on upgrade",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 120,
  deletions: 8,
  changedFiles: 3,
};

/** A pull request no agent of the workspace opened. */
const OUTSIDE_PULL_REQUEST = "https://github.com/acme/relay/pull/7";

let root: Root | undefined;

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  told.length = 0;
});

/** An older pull request the prorater opened, which its row no longer keeps. */
const OLDER_PULL_REQUEST = "https://github.com/acme/relay/pull/41";

/**
 * Main's document as `STATE` once the task list has answered live: the
 * prorater among its tasks' agents, though the billing row's few name it
 * not, an archived one say, the sweeper on no task, the prorater's pull
 * request as its row keeps it, and the billing row naming that one and an
 * older one of the prorater's.
 */
const LISTED_STATE: AppStateSnapshot = {
  ...STATE,
  tasks: {
    ...STATE.tasks,
    listStatus: TASKS_READ.READY,
    tasks: [
      {
        ...BILLING,
        agents: {
          total: 1,
          working: 0,
          agents: [],
          pullRequestTotal: 2,
          pullRequests: [
            {
              number: SEAT_PULL_REQUEST.number,
              title: SEAT_PULL_REQUEST.title,
              state: SEAT_PULL_REQUEST.state,
              checks: SEAT_PULL_REQUEST.checks,
              additions: SEAT_PULL_REQUEST.additions,
              deletions: SEAT_PULL_REQUEST.deletions,
              url: SEAT_PULL_REQUEST.url,
              agentId: PRORATE.id,
            },
            {
              number: 41,
              title: "Prorate seats on downgrade",
              state: PULL_REQUEST_STATE.MERGED,
              checks: CHECK_SUMMARY.PASSING,
              additions: 30,
              deletions: 2,
              url: OLDER_PULL_REQUEST,
              agentId: PRORATE.id,
            },
          ],
        },
      },
    ],
    taskAgents: [PRORATE],
    tasklessAgents: [
      {
        ...SWEEPER,
        automationId: null,
        workspaceId: ACME.id,
        repository: "acme/relay",
        activityAt: AT,
      },
    ],
    agentPullRequests: [
      { agentId: PRORATE.id, taskId: BILLING.id, pullRequest: SEAT_PULL_REQUEST },
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
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      told.push(request);
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
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

/** An agent's mention, by the agent whichever task it works on, as its chip is written. */
function mentionOf(agent: AgentSummary, name: string): string {
  return mentionMarkdown({ kind: MENTION_KIND.AGENT, agentId: agent.id }, name, PLACE);
}

/** The acts that read agents or their pull requests, as told. */
function agentReads(): readonly AnyAct[] {
  return told.filter(
    (request) =>
      request.kind === ACT_KIND.AGENTS_LIST ||
      request.kind === ACT_KIND.AGENTS_WORKSPACE_LIST ||
      request.kind === ACT_KIND.AGENTS_PAGE ||
      request.kind === ACT_KIND.AGENTS_PULL_REQUEST,
  );
}

/** What the card a chip hangs says, once its read has landed: the agent's tab's card, or the chip's own. */
async function cardOf(chip: Element | undefined) {
  assert.ok(chip, "the agent is drawn as its chip");
  restOn(chip);
  await settle();
  const card = [...document.querySelectorAll(".ui-tooltip-card > *")].at(-1);
  assert.ok(card, "the chip hangs a card");
  const look = {
    agent: card.matches("[data-agent-card]"),
    pullRequest: card.matches("[data-pull-request-card]"),
    reading: card.matches("[data-hover-card-skeleton]"),
    led: card.querySelector(".ui-hover-card-lead") !== null,
    actor: card.getAttribute("data-actor-card") ?? undefined,
    name: card.querySelector(".ui-hover-card-name")?.textContent,
    model: card.querySelector("[data-model-label]")?.textContent,
    corner: card.querySelector(".ui-hover-card-corner")?.textContent,
    working: card.querySelector('.ui-hover-card-lead .state-glyph[data-state="working"]') !== null,
    foot: card.querySelector(".ui-hover-card-row:last-child .ui-hover-card-row-label")?.textContent,
    words: card.textContent,
  };
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return look;
}

test("chips of agents off their task's page read nothing, and hang their tab's card at once, on another task or on none; one the list carries not keeps the chip's own", async () => {
  const container = await drawn(
    [
      mentionOf(PRORATE, "Prorate"),
      mentionOf(SWEEPER, "Sweep flaky tests"),
      mentionOf(AUDITOR, "The auditor"),
    ].join(" "),
    LISTED_STATE,
  );
  const [onTask, onNone, unlisted] = container.querySelectorAll("[data-mention-ref]");

  const prorate = await cardOf(onTask);
  const sweeper = await cardOf(onNone);
  const auditor = await cardOf(unlisted);

  assert.deepEqual(
    [prorate.agent, prorate.name, prorate.model, prorate.foot],
    [true, "Prorate seat changes", "Opus 5.5 High", "On Billing by seat"],
  );
  assert.match(prorate.words ?? "", /Started by.*Sam Okafor/u);
  assert.deepEqual(
    [sweeper.agent, sweeper.name, sweeper.foot],
    [true, "Sweep flaky tests", "On no task"],
  );
  assert.doesNotMatch(
    sweeper.words ?? "",
    /Started by/u,
    "the reader's own agent names no starter",
  );
  assert.deepEqual(
    [auditor.agent, auditor.reading, auditor.name],
    [false, false, "The auditor"],
    "an agent the list carries not keeps the chip's own card",
  );
  assert.deepEqual(agentReads(), []);
});

test("a mention of an agent on another task whose model no row names, laid in a message box as an Inbox answer's is, wears the harness the task list carries", async () => {
  // The box stands on another task's page, whose doors know only that task's agents.
  const container = await drawnElement(
    createElement(MentionNodeChip, {
      mention: {
        name: "Prorate seat changes",
        target: encodeMention({ kind: MENTION_KIND.AGENT, agentId: PRORATE.id }, PLACE),
      },
      doors: {
        holder: { taskId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" },
        place: PLACE,
        anchors: new Set<string>(),
        onOpenTask: () => undefined,
        onOpenFile: undefined,
        agentOf: () => ({
          actor: {
            kind: ACTOR_KIND.AGENT,
            name: "Agent",
            provider: undefined,
            state: ACTOR_STATE.REST,
          },
          card: null,
        }),
      },
    }),
    LISTED_STATE,
  );

  assert.ok(
    container.querySelector(".ui-inline-ref-glyph .ui-harness-mark"),
    "the box's chip wears its harness",
  );
});

test("a mention of its own task's agent whose tile the page knows no harness of wears the harness the task list carries", async () => {
  // The box stands on the agent's own task's page, whose agents are not yet read.
  const container = await drawnElement(
    createElement(MentionNodeChip, {
      mention: {
        name: "Prorate seat changes",
        target: encodeMention({ kind: MENTION_KIND.AGENT, agentId: PRORATE.id }, PLACE),
      },
      doors: {
        holder: { taskId: BILLING.id },
        place: PLACE,
        anchors: new Set<string>(),
        onOpenTask: () => undefined,
        onOpenFile: undefined,
        agentOf: () => ({
          actor: {
            kind: ACTOR_KIND.AGENT,
            name: "Agent",
            provider: undefined,
            state: ACTOR_STATE.REST,
          },
          card: null,
        }),
      },
    }),
    LISTED_STATE,
  );

  assert.ok(
    container.querySelector(".ui-inline-ref-glyph .ui-harness-mark"),
    "the box's chip wears its harness",
  );
});

test("a pull request's chip off its task's page hangs the card its Pull request tab hangs, from the pull request the list holds; one no listed agent opened, and an older one its row keeps not, keep the chip's own", async () => {
  const container = await drawn(
    `Lands in [@#42](${SEAT_PULL_REQUEST.url}) after [@#7](${OUTSIDE_PULL_REQUEST}) and [@#41](${OLDER_PULL_REQUEST}).`,
    LISTED_STATE,
  );
  const [opened, outside, older] = container.querySelectorAll("[data-mention-ref]");

  const card = await cardOf(opened);
  assert.equal(card.pullRequest, true, "the chip hangs the pull request's card");
  assert.equal(card.name, "Prorate seats on upgrade");
  assert.match(card.words ?? "", /in 3 files/u, "it says what the list holds of it");
  assert.match(card.words ?? "", /By Prorate seat changes/u, "it names the agent whose it is");
  const other = await cardOf(outside);
  assert.deepEqual([other.pullRequest, other.reading], [false, false]);
  const earlier = await cardOf(older);
  assert.deepEqual([earlier.pullRequest, earlier.reading], [false, false]);
  assert.deepEqual(agentReads(), []);
});

test("an agent named as an actor leads its card with its tile until the task list first answers, where its tab's card leads with it once listed, so the head stands still", async () => {
  const actor = createElement(ActorRef, {
    actor: {
      kind: ACTOR_KIND.AGENT,
      agentId: PRORATE.id,
      taskId: BILLING.id,
      name: "Prorate",
      provider: undefined,
      state: ACTOR_STATE.REST,
    },
  });
  const container = await drawnElement(actor);

  const card = await cardOf(container.querySelector("[data-actor-ref]") ?? undefined);
  assert.deepEqual([card.reading, card.led, card.name], [true, true, "Prorate"]);
});

test("a chip of Vespin hangs Vespin's own card", async () => {
  const container = await drawn(
    `Ask ${mentionMarkdown({ kind: MENTION_KIND.APP, taskId: BILLING.id }, "Vespin", PLACE)}.`,
  );

  const card = await cardOf(container.querySelector("[data-mention-ref]") ?? undefined);
  assert.deepEqual([card.actor, card.name], [ACTOR_KIND.APP, "Vespin"]);
});

test("Vespin and an agent named as actors hang Vespin's card and the agent's tab's card, as the task list carries the agent", async () => {
  const container = await drawnElement(
    createElement(
      "p",
      null,
      createElement(ActorRef, { actor: APP_ACTOR }),
      createElement(ActorRef, {
        actor: {
          kind: ACTOR_KIND.AGENT,
          agentId: PRORATE.id,
          taskId: BILLING.id,
          name: "Prorate",
          provider: undefined,
          state: ACTOR_STATE.REST,
        },
      }),
    ),
    LISTED_STATE,
  );
  const [luke, agent] = container.querySelectorAll("[data-actor-ref]");

  const lukeCard = await cardOf(luke);
  const agentCard = await cardOf(agent);
  assert.equal(lukeCard.actor, ACTOR_KIND.APP);
  assert.deepEqual(
    [agentCard.agent, agentCard.led, agentCard.name, agentCard.foot],
    [true, true, "Prorate seat changes", "On Billing by seat"],
  );
});
