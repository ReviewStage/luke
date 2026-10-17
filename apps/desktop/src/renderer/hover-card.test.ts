// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
  TURN_ENDING,
} from "@luke/features/coding-agent-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { LIVE_CLOSE_REASON } from "@luke/live";
import { Effect } from "effect";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { TaskCard } from "./desktop/task-card";
import { ChangesCard } from "./tasks/agent-changes-tab";
import { agentSubject, NOTHING_HELD } from "./tasks/agent-ref";
import { AgentTabCard, cardCorner } from "./tasks/agent-tab-card";
import { CallEnded } from "./tasks/call-card";
import { SentWords, SkillFiles } from "./tasks/skill-chip";
import type { SkillSource } from "./tasks/skill-picker";
import { TurnCard } from "./tasks/turn-card";

/**
 * hover-card.test.ts -- every hover card heads itself alike: a task's, a
 * skill's, an agent tab's, a Changes tab's, a turn's, and a call's each
 * name their subject in the one head, with the line under the name and the
 * corner in the same places, and a call's card is a turn's card.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const STARTED_AT = Date.UTC(2026, 9, 14, 12, 0, 0);
const ENDED_AT = STARTED_AT + 90_000;
const ignore = () => undefined;

const roots: Root[] = [];

// Note that a skill chip is drawn through the markdown parser, which lands as its own chunk, so the suite waits for it once rather than racing it.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  delete document.documentElement.dataset.keyboard;
});

/** What a card's head says, part by part, as a reader finds it. */
interface HeadWords {
  readonly glyph: boolean;
  readonly name: string | undefined;
  readonly sub: string | undefined;
  readonly corner: string | undefined;
}

/** The one head of the card drawn in `within`, read part by part. */
function headOf(within: ParentNode): HeadWords {
  const heads = within.querySelectorAll(".luke-hover-card > .luke-hover-card-head");
  assert.equal(heads.length, 1, "the card has one head");
  const head = heads[0];
  assert.ok(head);
  return {
    glyph: head.querySelector(":scope > .luke-hover-card-glyph") !== null,
    name:
      head.querySelector(":scope > .luke-hover-card-title > .luke-hover-card-name")?.textContent ??
      undefined,
    sub:
      head.querySelector(":scope > .luke-hover-card-title > .luke-hover-card-sub")?.textContent ??
      undefined,
    corner: head.querySelector(":scope > .luke-hover-card-corner")?.textContent ?? undefined,
  };
}

/** The card `element` draws, mounted. */
function drawn(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The card hung once the element `selector` finds in `view` is hovered. */
function hung(view: HTMLElement, selector: string): HTMLElement {
  const anchor = view.querySelector(selector);
  assert.ok(anchor, `${selector} is drawn`);
  act(() => {
    anchor.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector<HTMLElement>(".luke-tooltip-card");
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

test("a plan's, a skill's, an agent tab's, and a Changes tab's cards each name their subject in the one head, its line and corner in the same places", async () => {
  const task = drawn(
    createElement(TaskCard, {
      task: SUMMARY,
      models: [],
      pictures: false,
      now: STARTED_AT + 3 * 3_600_000,
      onOpenGitHub: ignore,
      onShowAgent: ignore,
    }),
  );
  assert.deepEqual(headOf(task), {
    glyph: false,
    name: "Teammate invitations",
    sub: undefined,
    corner: "3h",
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
  assert.equal(agentHead.corner, "Working…");
  assert.match(agentHead.sub ?? "", /High/u, "the model and effort stand under the name");

  const changes = drawn(
    createElement(ChangesCard, {
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
              status: CODING_AGENT_STATUS.COMPLETED,
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
      pullRequest: PULL_REQUEST,
      people: undefined,
      onOpenAgent: () => undefined,
    }),
  );
  assert.deepEqual(headOf(changes), {
    glyph: false,
    name: "Expire invitations",
    sub: "Invite flow",
    corner: "#42",
  });

  const skills: SkillSource = () =>
    Promise.resolve({
      skills: [
        { name: "release", description: "Cut a release.", path: ".agents/skills/release/SKILL.md" },
      ],
    });
  const message = drawn(
    createElement(SkillFiles, {
      source: skills,
      onOpen: ignore,
      children: createElement(SentWords, { text: "Cut it with /release now." }),
    }),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const skill = hung(message, "button.skill-chip");
  assert.deepEqual(headOf(skill), {
    glyph: true,
    name: "/release",
    sub: undefined,
    corner: undefined,
  });
  assert.equal(
    skill.querySelector(".luke-hover-card > .luke-hover-card-note")?.textContent,
    "Cut a release.",
  );
});

test("a call's card is a turn's card: the model at the head over when it ran, how it ended at the corner, and its figures under a rule", () => {
  const turn = drawn(
    createElement(TurnCard, {
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      record: {
        model: "openai/gpt-5.5",
        effort: "high",
        ending: TURN_ENDING.STOPPED,
        tokens: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 2 },
      },
      models: [],
    }),
  );
  const call = drawn(
    createElement(CallEnded, {
      line: "Call ended",
      startedAt: STARTED_AT,
      record: {
        endedAt: ENDED_AT,
        ending: LIVE_CLOSE_REASON.CONNECTION_LOST,
        model: "openai/gpt-realtime-2",
        usage: { seconds: 120, confirmed: true },
      },
    }),
  );
  const callCard = hung(call, "[data-call-ended]");
  const turnHead = headOf(turn);
  const callHead = headOf(callCard);
  assert.equal(turnHead.glyph, true, "the turn's model wears its provider's mark");
  assert.equal(callHead.glyph, true, "the call's model wears its provider's mark");
  assert.equal(turnHead.corner, "Stopped");
  assert.equal(callHead.corner, "Dropped");
  for (const head of [turnHead, callHead]) {
    assert.match(head.sub ?? "", /Oct 14, 2026/u, "when it ran stands under the model");
  }
  for (const card of [turn, callCard]) {
    assert.ok(
      card.querySelector(".luke-hover-card > .luke-hover-card-rule + dl"),
      "the figures stand under a rule",
    );
  }
});

test("a plan's card says in its corner when the task last saw activity, its agent's later turn over its plan's save, as its row does", () => {
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
      pictures: false,
      now: STARTED_AT + 3 * 3_600_000,
      onOpenGitHub: ignore,
      onShowAgent: ignore,
    }),
  );
  assert.equal(headOf(card).corner, "1h");
});
