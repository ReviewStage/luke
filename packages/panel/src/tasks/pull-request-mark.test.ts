// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { PullRequestLine } from "../desktop/task-card.js";
import { ChangesCard } from "./agent-changes-tab.js";
import { PublishedRow } from "./agent-published.js";
import { agentSubject, NOTHING_HELD } from "./agent-ref.js";

/**
 * pull-request-mark.test.ts -- a pull request reads the same wherever the
 * window draws it: a sidebar task's card, the row pinned over its agent's
 * box, and its Changes tab's card each wear one mark saying the words a
 * reader who cannot see it hears.
 */

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite flow",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

/** A pull request standing as `state`, its checks as `checks`. */
function pullRequest(
  state: CodingAgentPullRequest["state"],
  checks: CodingAgentPullRequest["checks"],
): CodingAgentPullRequest {
  return {
    number: 42,
    title: "Expire invitations",
    url: "https://github.com/acme/relay/pull/42",
    state,
    checks,
    additions: 210,
    deletions: 14,
    changedFiles: 6,
  };
}

/** Every place the window draws the pull request, each rendered on its own. */
function places(drawn: CodingAgentPullRequest): ReadonlyMap<string, ReactElement> {
  const ignore = (): void => undefined;
  return new Map<string, ReactElement>([
    ["plan card", createElement(PullRequestLine, { pullRequest: drawn })],
    [
      "pinned row",
      createElement(PublishedRow, {
        pullRequest: drawn,
        branch: "invites",
        doors: { openGitHub: ignore, copy: ignore },
      }),
    ],
    [
      "Changes card",
      createElement(ChangesCard, {
        subject: agentSubject(
          { agents: [AGENT], archived: [], models: [], me: undefined, pullRequests: new Map() },
          AGENT.id,
          NOTHING_HELD,
          false,
        ),
        models: [],
        pullRequest: drawn,
        people: undefined,
        onOpenAgent: ignore,
      }),
    ],
  ]);
}

/** The pull request's mark as a place draws it; undefined where it draws none. */
function markElementOf(place: ReactElement): Element | undefined {
  const page = new DOMParser().parseFromString(renderToStaticMarkup(place), "text/html");
  return page.querySelector("[data-pull-request-mark]") ?? undefined;
}

/** What the mark is styled by: its class and every attribute but its words. */
function lookOf(mark: Element | undefined): string | undefined {
  if (mark === undefined) return undefined;
  return [...mark.attributes]
    .filter((attribute) => attribute.name !== "aria-label")
    .map((attribute) => `${attribute.name}=${attribute.value}`)
    .toSorted()
    .join(" ");
}

/** The words the pull request's mark says as a place draws it. */
function markOf(place: ReactElement): string | null | undefined {
  const page = new DOMParser().parseFromString(renderToStaticMarkup(place), "text/html");
  const mark = page.querySelector("[data-pull-request-mark]");
  if (mark === null) return undefined;
  return mark.getAttribute("aria-label");
}

test("a closed pull request whose checks failed says so wherever it is drawn", () => {
  const drawn = places(pullRequest(PULL_REQUEST_STATE.CLOSED, CHECK_SUMMARY.FAILING));
  const expected = "Pull request #42, closed, checks failing";
  for (const [place, element] of drawn) assert.equal(markOf(element), expected, place);
});

test("a merged pull request says so wherever it is drawn, its checks unsaid", () => {
  const drawn = places(pullRequest(PULL_REQUEST_STATE.MERGED, CHECK_SUMMARY.PASSING));
  const expected = "Pull request #42, merged";
  for (const [place, element] of drawn) assert.equal(markOf(element), expected, place);
});

test("a pull request's mark wears the colour of where it stands whatever its checks say", () => {
  for (const state of Object.values(PULL_REQUEST_STATE)) {
    const failing = places(pullRequest(state, CHECK_SUMMARY.FAILING));
    const passing = places(pullRequest(state, CHECK_SUMMARY.PASSING));
    for (const [place, element] of failing) {
      const look = lookOf(markElementOf(element));
      assert.ok(look?.includes(`data-pull-request-state=${state}`), `${place}, ${state}`);
      assert.equal(
        look,
        lookOf(markElementOf(passing.get(place) ?? element)),
        `${place}, ${state}`,
      );
    }
  }
});
