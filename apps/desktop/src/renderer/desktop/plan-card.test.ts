// @vitest-environment jsdom

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { it } from "@effect/vitest";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { rendererRuntime } from "../renderer-runtime";
import { PlanCard } from "./plan-card";

/** React's act warns outside an environment that says it is a test. */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const MINUTE = 60_000;
const NOW = 60 * MINUTE;

/** A plan with three agents named of five, and two pull requests named of four, as the list carries it. */
const PLAN: PlanSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 0,
  updatedAt: NOW - 3 * MINUTE,
  repository: "acme/relay",
  agents: {
    total: 5,
    working: 1,
    agents: [
      {
        id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
        title: "Invite flow",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.RUNNING,
        at: NOW - 2 * MINUTE - 5_000,
      },
      {
        id: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
        title: null,
        model: "openai/gpt-6.1-sol",
        effort: "xhigh",
        status: CODING_AGENT_STATUS.COMPLETED,
        at: NOW - 3 * MINUTE,
      },
      {
        id: "3f1c2b7a-9d4e-4a6b-8c1d-2e5f6a7b8c9d",
        title: "Fix the tests",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.FAILED,
        at: NOW - 60 * MINUTE,
      },
    ],
    pullRequestTotal: 4,
    pullRequests: [
      {
        number: 128,
        title: "Invite teammates by email",
        state: PULL_REQUEST_STATE.DRAFT,
        checks: CHECK_SUMMARY.FAILING,
        additions: 214,
        deletions: 9,
        url: "https://github.com/acme/relay/pull/128",
      },
      {
        number: 120,
        title: "Expire invitations after a week",
        state: PULL_REQUEST_STATE.OPEN,
        checks: CHECK_SUMMARY.PASSING,
        additions: 31,
        deletions: 2,
      },
    ],
  },
};

/** The card drawn on a registry whose runtime is this test's, so a working count reads the TestClock; answered with what each part says, its buttons, and what pressing them opened. */
const drawnCard = (plan: PlanSummary) =>
  Effect.gen(function* () {
    const opened: string[] = [];
    const shownAgents: string[] = [];
    const context = yield* Effect.context<never>();
    const registry = AtomRegistry.make({
      initialValues: [[rendererRuntime, AsyncResult.success(context)]],
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        createElement(
          RegistryContext.Provider,
          { value: registry },
          createElement(PlanCard, {
            plan,
            models: [],
            pictures: false,
            now: NOW,
            onOpenGitHub: (url: string) => opened.push(url),
            onShowAgent: (agentId: string) => shownAgents.push(agentId),
          }),
        ),
      ),
    );
    yield* Effect.promise(() => act(async () => undefined));
    const lines = (label: string) =>
      [...container.querySelectorAll(`[aria-label="${label}"] > li`)].map(
        (line) => line.textContent,
      );
    return {
      head: container.querySelector(".plan-card-head")?.textContent,
      repository: container.querySelector(".plan-card-repository")?.textContent,
      agents: lines("Agents"),
      pullRequests: lines("Pull requests"),
      // Each agent's glyph as a reader and an eye meet it: what it says, the harness mark it wears, and whether the working mark stands in its place.
      agentGlyphs: [...container.querySelectorAll("[data-plan-card-agent] .plan-card-glyph")].map(
        (glyph) => ({
          said: glyph.querySelector('[role="img"]')?.getAttribute("aria-label"),
          mark: glyph.querySelector(".provider-mark")?.tagName.toLowerCase(),
          working: glyph.querySelector("svg.working-mark") !== null,
        }),
      ),
      buttons: () => [...container.querySelectorAll("button")],
      opened,
      shownAgents,
      unmount: () => act(() => root.unmount()),
    };
  });

it.effect(
  "a plan's card names it, its repository, and when it was updated, then its agents working or ended and its pull requests, counting the rest",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const card = yield* drawnCard(PLAN);

      assert.equal(card.head, "Teammate invitations3m");
      assert.equal(card.repository, "acme/relay");
      assert.deepEqual(card.agents, [
        "Invite flow Opus 5.5 HighWorking…2m 5s",
        "GPT 6.1 Sol Extra highDone 3m",
        "Fix the tests Opus 5.5 HighFailed 1h",
        "and 2 more",
      ]);
      assert.deepEqual(card.pullRequests, [
        "#128 · Invite teammates by email+214 −9 Draft",
        "#120 · Expire invitations after a week+31 −2",
        "and 2 more",
      ]);
      card.unmount();
    }),
);

it.effect(
  "an agent's line leads with its harness's mark as its tab wears it: the working mark in its place while it works, the mark alone once done, an alert in its place where it failed, and no dot",
  () =>
    Effect.gen(function* () {
      const card = yield* drawnCard(PLAN);

      assert.deepEqual(card.agentGlyphs, [
        { said: "Working", mark: undefined, working: true },
        { said: undefined, mark: "img", working: false },
        { said: "Failed", mark: undefined, working: false },
      ]);
      card.unmount();
    }),
);

it.effect("a plan with no agents hangs a card with its name and repository alone", () =>
  Effect.gen(function* () {
    const { agents: _agents, ...quiet } = PLAN;
    const card = yield* drawnCard({ ...quiet, repository: null });

    assert.equal(card.head, "Teammate invitations3m");
    assert.equal(card.repository, undefined);
    assert.deepEqual(card.agents, []);
    assert.deepEqual(card.pullRequests, []);
    card.unmount();
  }),
);

it.effect(
  "a plan's card opens its repository and a pull request on GitHub and an agent on its tab, and leaves its facts as text",
  () =>
    Effect.gen(function* () {
      const card = yield* drawnCard(PLAN);
      const [repository, invite, done, failed, pullRequest, ...rest] = card.buttons();

      assert.deepEqual(
        rest,
        [],
        "the name, the times, a line without a page, and the counts are text",
      );
      assert.equal(repository?.textContent, "acme/relay");
      assert.equal(pullRequest?.textContent, "#128 · Invite teammates by email+214 −9 Draft");
      act(() => {
        for (const line of [repository, pullRequest, invite, done, failed]) line?.click();
      });
      assert.deepEqual(card.opened, [
        "https://github.com/acme/relay",
        "https://github.com/acme/relay/pull/128",
      ]);
      assert.deepEqual(
        card.shownAgents,
        PLAN.agents?.agents.map((agent) => agent.id),
      );
      card.unmount();
    }),
);
