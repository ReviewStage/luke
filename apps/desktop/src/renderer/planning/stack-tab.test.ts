// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
  ROLLOUT_ROLE,
} from "@sidecar/hosted/coding-agent-wire";
import { ROLLOUT_BASE, type RolloutItem } from "@sidecar/hosted/plan-wire";
import { WORKER_REPORT_KIND } from "@sidecar/hosted/rollout-wire";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach } from "vitest";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { PUBLISHED_REREAD_MS } from "./coding-agent-model";
import { stackLayout } from "./stack-model";
import { StackTab, StackView } from "./stack-tab";

const PLAN_ID = "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";

const ROLLOUT: readonly RolloutItem[] = [
  { title: "Pending memberships", scope: "The column.", base: ROLLOUT_BASE.MAIN, acceptance: null },
  { title: "Invite and accept", scope: "The route.", base: 1, acceptance: null },
  { title: "Invite screen", scope: "The form.", base: 1, acceptance: null },
];

function worker(
  id: string,
  position: number,
  status: CodingAgentSummary["status"],
  more: Partial<CodingAgentSummary> = {},
): CodingAgentSummary {
  return {
    id,
    planId: PLAN_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: position,
    status,
    turnId: null,
    position,
    ...more,
  };
}

const OPEN = worker("a1", 1, CODING_AGENT_STATUS.COMPLETED, {
  published: {
    number: 412,
    title: "Pending memberships",
    url: "https://github.com/acme/relay/pull/412",
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PENDING,
    additions: 4,
    deletions: 1,
    changedFiles: 1,
  },
});
const WORKING = worker("a2", 2, CODING_AGENT_STATUS.RUNNING);
const ASKING = worker("a3", 3, CODING_AGENT_STATUS.COMPLETED, {
  lastReport: {
    kind: WORKER_REPORT_KIND.QUESTION,
    text: "One email per invite, or several?",
    options: ["One", "Several"],
    at: 1,
  },
});

const { position: _none, ...KEEPER_FIELDS } = worker("k1", 1, CODING_AGENT_STATUS.RUNNING);
const KEEPER: CodingAgentSummary = { ...KEEPER_FIELDS, role: ROLLOUT_ROLE.KEEPER };

const NO_DOORS = { openGitHub: () => undefined, copy: () => undefined };

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function cardOf(page: ParentNode, position: number): HTMLElement {
  const found = page.querySelector<HTMLElement>(`[data-stack-position="${position}"]`);
  assert.ok(found, `no card for #${position}`);
  return found;
}

/** The Stack tab mounted over `agents`, answering the page, what was chosen, how many reads it asked, and a way to hand it the agents read next. */
function mounted(
  registry: Parameters<typeof onRegistry>[0],
  agents: readonly CodingAgentSummary[],
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const chosen: string[] = [];
  const reads: number[] = [];
  const draw = (held: readonly CodingAgentSummary[]) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(StackTab, {
            rollout: ROLLOUT,
            agents: held,
            models: [],
            onChoose: (agentId: string) => chosen.push(agentId),
            onReadAgain: () => reads.push(reads.length),
          }),
        ),
      ),
    );
  draw(agents);
  return { page: container, chosen, reads, draw };
}

/** Lets the clock's ticks so far reach the page. */
const settle = Effect.promise(() =>
  act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  }),
);

it("draws a column per depth, each card's position, title, base, state, worker, and pull request, and a question under its card with its answers", () => {
  const markup = renderToStaticMarkup(
    createElement(StackView, {
      columns: stackLayout(ROLLOUT, [OPEN, WORKING, ASKING]),
      keeper: undefined,
      models: [],
      doors: NO_DOORS,
      onChoose: () => undefined,
    }),
  );
  const page = document.createElement("div");
  page.innerHTML = markup;

  assert.ok(page.querySelector(".stack-tab.ph-no-capture"), "the recording leaves it out");
  assert.equal(page.querySelector("[data-stack-keeper]"), null, "no keeper, no header");
  assert.deepEqual(
    [...page.querySelectorAll("[data-stack-depth]")].map((column) =>
      [...column.querySelectorAll("[data-stack-position]")].map((card) =>
        card.getAttribute("data-stack-position"),
      ),
    ),
    [["1"], ["2", "3"]],
  );
  const first = cardOf(page, 1);
  assert.match(first.textContent ?? "", /#1Pending memberships/u);
  assert.match(first.textContent ?? "", /base: main·open/u);
  assert.ok(
    first.querySelector('[aria-label="Pull request #412, open"]'),
    "its pull request's chip",
  );
  assert.match(cardOf(page, 2).textContent ?? "", /on #1·working/u);
  const asking = cardOf(page, 3);
  assert.match(asking.textContent ?? "", /on #1·waiting on you/u);
  assert.equal(
    asking.querySelector('[data-stack-waiting="question"] p')?.textContent,
    "One email per invite, or several?",
  );
  assert.deepEqual(
    [...asking.querySelectorAll("[data-stack-option]")].map((option) => option.textContent),
    ["One", "Several"],
  );
});

it.effect(
  "a press of a card with a worker chooses the worker's tab, and a card with none offers no press",
  () =>
    Effect.gen(function* () {
      const { page, chosen } = mounted(yield* registryOnTestClock, [OPEN]);

      act(() =>
        cardOf(page, 1).querySelector<HTMLElement>("button:not(.agent-published-chip)")?.click(),
      );

      assert.deepEqual(chosen, ["a1"]);
      assert.match(cardOf(page, 2).textContent ?? "", /ready/u);
      assert.equal(cardOf(page, 2).querySelector("button"), null);
    }),
);

it.effect(
  "while a worker is at work the list is read again at each reread's pace, and not once none is",
  () =>
    Effect.gen(function* () {
      const registry = yield* registryOnTestClock;
      const { reads, draw } = mounted(registry, [OPEN, WORKING]);
      yield* settle;

      yield* TestClock.adjust(Duration.millis(PUBLISHED_REREAD_MS - 1));
      yield* settle;
      assert.equal(reads.length, 0, "nothing before the pace");
      yield* TestClock.adjust(Duration.millis(1));
      yield* settle;
      assert.equal(reads.length, 1, "once at the pace");
      yield* TestClock.adjust(Duration.millis(PUBLISHED_REREAD_MS));
      yield* settle;
      assert.equal(reads.length, 2, "again at the next");

      draw([OPEN, { ...WORKING, status: CODING_AGENT_STATUS.COMPLETED }]);
      yield* settle;
      assert.equal(reads.length, 3, "once as the worker's status changed");
      yield* TestClock.adjust(Duration.millis(PUBLISHED_REREAD_MS * 3));
      yield* settle;
      assert.equal(reads.length, 3, "nothing more once none is at work");
    }),
);

it.effect(
  "the keeper stands in the header with its state, never as a card, and a press of the header chooses its tab",
  () =>
    Effect.gen(function* () {
      const { page, chosen } = mounted(yield* registryOnTestClock, [OPEN, KEEPER]);
      const header = page.querySelector<HTMLElement>('[data-stack-keeper="k1"]');

      assert.ok(header, "the keeper's header");
      assert.match(header.textContent ?? "", /Stack keeper.*·working/u);
      assert.equal(page.querySelectorAll("[data-stack-position]").length, ROLLOUT.length);
      act(() => header.click());
      assert.deepEqual(chosen, ["k1"]);
    }),
);
