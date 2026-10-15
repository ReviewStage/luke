// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import { Effect } from "effect";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { TranscriptWords } from "./transcript-blocks";
import { OpenPlanProvider } from "./use-open-link";

/**
 * A link pressed in written words: a Luke link opens its plan in the
 * window, at its section, and never the browser, while a GitHub page and
 * any other web page open in the browser over their acts; off the window,
 * where no opener for a plan is handed down, a Luke link opens in the
 * browser too. Synthetic plan.
 */

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

const WORDS = [
  `See [the rollout](https://tryluke.dev/acme/plan/${PLAN_ID}#rollout),`,
  `[the plan](https://tryluke.dev/personal-u_1/plan/${PLAN_ID}),`,
  "[the pull request](https://github.com/acme/relay/pull/12),",
  "and [the docs](https://example.com/docs).",
].join(" ");

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];
let sent: Act[] = [];

beforeEach(() => {
  sent = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        sent.push(request);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The words drawn under the opener given, each link pressed in order. */
function pressedEach(openPlan: ((mention: PlanMention) => void) | undefined): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const words: ReactNode = createElement(TranscriptWords, { text: WORDS });
  act(() =>
    root.render(
      openPlan === undefined ? words : createElement(OpenPlanProvider, { value: openPlan }, words),
    ),
  );
  for (const link of container.querySelectorAll<HTMLElement>("a, .agent-link-inert")) {
    act(() => link.click());
  }
}

test("a Luke link opens its plan in the window, at its section, and other pages open in the browser", () => {
  const opened: PlanMention[] = [];

  pressedEach((mention) => opened.push(mention));

  assert.deepEqual(opened, [
    { kind: MENTION_KIND.SECTION, planId: PLAN_ID, anchor: "rollout" },
    { kind: MENTION_KIND.PLAN, planId: PLAN_ID },
  ]);
  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.GITHUB_OPEN, ACT_KIND.WEB_OPEN],
  );
});

test("off the window, where no opener for a plan is handed down, a Luke link opens in the browser", () => {
  pressedEach(undefined);

  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.WEB_OPEN, ACT_KIND.WEB_OPEN, ACT_KIND.GITHUB_OPEN, ACT_KIND.WEB_OPEN],
  );
});
