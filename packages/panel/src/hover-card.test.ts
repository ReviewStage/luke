// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS, CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { TASK_SKILL_SOURCE } from "@repo/features/task-wire";
import { Effect } from "effect";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { TaskCard } from "./desktop/task-card.js";
import { GLYPH_STATE } from "./state-glyph.js";
import { subagentActor } from "./tasks/agent-model.js";
import { agentSubject, NOTHING_HELD } from "./tasks/agent-ref.js";
import { AgentTabCard, cardCorner } from "./tasks/agent-tab-card.js";
import { PullRequestCard } from "./tasks/pull-request-card.js";
import { SentWords, SkillFiles } from "./tasks/skill-chip.js";
import type { SkillSource } from "./tasks/skill-picker.js";
import { PULL_REQUEST_MOMENT } from "./tasks/use-link-standing.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { withQueryClient } from "./testing/copy-feedback.js";
import { holdFrames, settleFrames } from "./testing/frames.js";
import { restOn } from "./testing/hint-rest.js";
import { markdownHtmlParserLanded } from "./testing/markdown.js";

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const STARTED_AT = Date.UTC(2026, 9, 14, 12, 0, 0);
const ignore = () => undefined;

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  holdFrames();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  delete document.documentElement.dataset.keyboard;
});

interface HeadWords {
  readonly glyph: boolean;
  readonly name: string | undefined;
  readonly sub: string | undefined;
  readonly corner: string | undefined;
}

function cornerWords(corner: Element | null): string | undefined {
  if (corner === null) return undefined;
  if (corner.textContent !== "") return corner.textContent;
  const marks = [...corner.querySelectorAll('[role="img"][aria-label]')].filter(
    (each) => each.parentElement?.closest('[aria-hidden="true"]') === null,
  );
  return marks.map((each) => each.getAttribute("aria-label")).join(", ");
}

function headOf(within: ParentNode): HeadWords {
  const heads = within.querySelectorAll(".ui-hover-card > .ui-hover-card-head");
  assert.equal(heads.length, 1, "the card has one head");
  const head = heads[0];
  assert.ok(head);
  return {
    glyph: head.querySelector(":scope > .ui-hover-card-glyph") !== null,
    name:
      head.querySelector(":scope > .ui-hover-card-title > .ui-hover-card-name")?.textContent ??
      undefined,
    sub:
      head.querySelector(":scope > .ui-hover-card-title > .ui-hover-card-sub")?.textContent ??
      undefined,
    corner: cornerWords(head.querySelector(":scope > .ui-hover-card-corner")),
  };
}

function drawn(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(element)));
  return container;
}

function hung(view: HTMLElement, selector: string): HTMLElement {
  const anchor = view.querySelector(selector);
  assert.ok(anchor, `${selector} is drawn`);
  restOn(anchor);
  const card = document.querySelector<HTMLElement>(".ui-tooltip-card");
  assert.ok(card, "the card hangs");
  return card;
}

const SUMMARY: TaskSummary = {
  id: TASK,
  workspaceId: "workspace",
  name: "Teammate invitations",
  createdAt: STARTED_AT,
  updatedAt: STARTED_AT,
  repository: "acme/relay",
};

const PULL_REQUEST = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 210,
  deletions: 14,
  changedFiles: 6,
};

test("a working agent's card says only how long its run has gone at its corner, its tile wearing the working mark in its harness's place", async () => {
  vi.useFakeTimers({ now: STARTED_AT + 65_000, toFake: ["Date"] });
  const card = drawn(
    createElement(AgentTabCard, {
      name: "Audit the retry paths",
      models: [],
      read: () => ({
        corner: cardCorner({
          writing: true,
          startedAt: STARTED_AT,
          movedAt: undefined,
          state: undefined,
        }),
        choice: { model: "anthropic/claude-opus-5.5", effort: "high" },
        transcript: undefined,
        tile: subagentActor(
          "anthropic/claude-opus-5.5",
          GLYPH_STATE.WORKING,
          "Audit the retry paths",
        ),
      }),
    }),
  );
  await vi.waitFor(() =>
    assert.equal(card.querySelector(".ui-hover-card-corner")?.textContent, "1m 5s"),
  );
  assert.equal(
    card.querySelector("[data-agent-card] > .ui-visually-hidden")?.textContent,
    "Working",
    "a reader, whom the tile's mark is hidden from, hears that it works",
  );
});

test("a plan's, a skill's, an agent tab's, and a pull request's cards each name their subject in the one head, its line and corner in the same places", async () => {
  const task = drawn(
    createElement(TaskCard, {
      task: { ...SUMMARY, number: 42 },
      workspaceName: "Acme",
      models: [],
      now: STARTED_AT + 3 * 3_600_000,
      onShowAgent: ignore,
    }),
  );
  assert.deepEqual(headOf(task), {
    glyph: true,
    name: "Teammate invitations",
    sub: "ACME-42 · acme/relay · 3h",
    corner: "Priority: No priority, Assignee: No assignee",
  });

  const agent = drawn(
    createElement(AgentTabCard, {
      name: "Invite flow",
      models: [],
      read: () => ({
        corner: cardCorner({
          writing: true,
          startedAt: undefined,
          movedAt: undefined,
          state: undefined,
        }),
        choice: { model: "anthropic/claude-opus-5.5", effort: "high" },
        transcript: undefined,
      }),
    }),
  );
  const agentHead = headOf(agent);
  assert.equal(agentHead.name, "Invite flow");
  assert.equal(
    agentHead.corner,
    undefined,
    "a working agent's corner says no word, and counts only from a known start",
  );
  assert.match(agentHead.sub ?? "", /High/u, "the model and effort stand under the name");

  const pullRequest = drawn(
    createElement(PullRequestCard, {
      pullRequest: PULL_REQUEST,
      place: { taskId: null },
      lines: PULL_REQUEST,
      files: PULL_REQUEST.changedFiles,
      agent: {
        subject: agentSubject(
          {
            agents: [
              {
                id: AGENT,
                planId: TASK,
                model: "anthropic/claude-opus-5.5",
                effort: "high",
                title: "Invite flow",
                createdAt: 1,
                status: AGENT_STATUS.COMPLETED,
                turnId: null,
              },
            ],
            archived: [],
            models: [],
            me: undefined,
            pullRequests: new Map(),
          },
          AGENT,
          NOTHING_HELD,
          false,
        ),
        models: [],
        onOpen: () => undefined,
      },
    }),
  );
  assert.deepEqual(headOf(pullRequest), {
    glyph: true,
    name: "Expire invitations",
    sub: "acme/relay#42 · Open",
    corner: undefined,
  });

  const skills: SkillSource = () =>
    Promise.resolve({
      skills: [
        {
          name: "release",
          description: "Cut a release.",
          source: TASK_SKILL_SOURCE.REPOSITORY,
          path: ".agents/skills/release/SKILL.md",
        },
      ],
    });
  const message = drawn(
    createElement(SkillFiles, {
      source: skills,
      onOpen: ignore,
      children: createElement(SentWords, { text: "Cut it with /release now." }),
    }),
  );
  await settleFrames();
  const skill = hung(message, "button[data-skill-ref]");
  assert.deepEqual(headOf(skill), {
    glyph: true,
    name: "/release",
    sub: "Repository skill",
    corner: undefined,
  });
  assert.equal(
    skill.querySelector(".ui-hover-card > .ui-hover-card-note")?.textContent,
    "Cut a release.",
  );
});

test("a pull request's corner says the age of the moment its state names, and nothing where the service answered only when a merged one was opened", () => {
  vi.useFakeTimers({ now: STARTED_AT, toFake: ["Date"] });
  const opened = { moment: PULL_REQUEST_MOMENT.OPENED, at: STARTED_AT - 5 * 86_400_000 };
  const card = (state: (typeof PULL_REQUEST_STATE)[keyof typeof PULL_REQUEST_STATE]) =>
    headOf(
      drawn(
        createElement(PullRequestCard, {
          pullRequest: { ...PULL_REQUEST, state, checks: undefined },
          place: { taskId: null },
          when: opened,
        }),
      ),
    ).corner;
  assert.equal(card(PULL_REQUEST_STATE.OPEN), "5d");
  assert.equal(card(PULL_REQUEST_STATE.MERGED), undefined);
});

test("a plan's card says under its name when the task last saw activity, its agent's later turn over its description's save, as its row does", () => {
  const worked: TaskSummary = {
    ...SUMMARY,
    agents: {
      total: 1,
      working: 0,
      activityAt: STARTED_AT + 2 * 3_600_000,
      agents: [],
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
  const card = drawn(
    createElement(TaskCard, {
      task: worked,
      models: [],
      now: STARTED_AT + 3 * 3_600_000,
      onShowAgent: ignore,
    }),
  );
  assert.equal(headOf(card).sub, "acme/relay · 1h");
});
