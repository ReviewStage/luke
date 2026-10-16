// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON } from "@luke/features/failure-remedy";
import { type CatalogModel, MODEL_PROVIDER } from "@luke/features/models-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { TOOL_STATE } from "../ai-elements/tool";
import { FailureNote } from "../failure-note";
import { PublishedRow } from "./agent-published";
import { TranscriptSubagent } from "./transcript-blocks";
import { WorkedFor } from "./working-time";

/**
 * An agent's transcript in a narrow column: each row keeps what names it
 * and gives up what can be read elsewhere first. The pull request's row
 * keeps its number whole and drops the checks' word, then the lines; a
 * subagent's row keeps its job and drops its model; a finished turn's
 * line breaks between its parts; and a failure's press stands off the
 * pull request's row under it. jsdom lays nothing out, so each width is the
 * stylesheets' container queries resolved for a row that wide
 * (`#testing/container-width`). Synthetic throughout.
 */

/** A row's width in a column this wide, less the transcript's insets. */
const ROW = {
  /** The plan's 280px column beside the summary's rail. */
  MAIN_280: 186,
  /** The plan's 423px column. */
  MAIN_423: 300,
  /** A 720px column. */
  WIDE: 640,
} as const;

const FAILING: CodingAgentPullRequest = {
  number: 4823,
  title: "feat(members): invite a teammate by email",
  url: "https://github.com/acme/relay/pull/4823",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.FAILING,
  additions: 1284,
  deletions: 377,
  changedFiles: 12,
};

const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["medium", "high"],
  },
];

const ignore = () => undefined;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** Draws `element` under the stylesheets laid for the containers given, answering its container. */
async function drawnAt(
  widths: Readonly<Record<string, number>>,
  element: ReactElement,
): Promise<HTMLElement> {
  layContainersAt(widths);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), element)));
  return container;
}

/** The words of each part of the pull request's row that is drawn, in order. */
async function publishedAt(width: number): Promise<string[]> {
  const drawn = await drawnAt(
    { "published-row": width },
    createElement(PublishedRow, { pullRequest: FAILING, openGitHub: ignore }),
  );
  const row = drawn.querySelector("[data-published-row]") ?? assert.fail("the row stands");
  const parts = row.querySelectorAll(
    ".agent-published-number, .agent-published-title, .agent-published-checks, .agent-published-lines",
  );
  return [...parts].filter(shown).map((part) => part.textContent ?? "");
}

/** Whether a finished subagent's row draws its job and its model, in a row this wide. */
async function subagentAt(width: number): Promise<{ job: boolean; pair: boolean }> {
  const drawn = await drawnAt(
    { "subagent-row": width },
    createElement(TranscriptSubagent, {
      callId: "call-1",
      job: "Audit every retry path in the invite mailer",
      pair: { choice: { model: "anthropic/claude-opus-5.5", effort: "medium" }, models: MODELS },
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      errorText: undefined,
      onOpen: ignore,
    }),
  );
  const job = drawn.querySelector(".subagent-job") ?? assert.fail("the job stands");
  const pair = drawn.querySelector("[data-subagent-pair]") ?? assert.fail("the pair stands");
  return { job: shown(job), pair: shown(pair) };
}

test("a pull request's row in a wide column says its number, title, failed checks, and lines", async () => {
  assert.deepEqual(await publishedAt(ROW.WIDE), [
    "#4823 ·",
    "feat(members): invite a teammate by email",
    "Checks failing",
    "+1284 −377",
  ]);
});

test("a pull request's row in a 423px column gives up the checks' word, its mark's red and label still saying they failed", async () => {
  assert.deepEqual(await publishedAt(ROW.MAIN_423), [
    "#4823 ·",
    "feat(members): invite a teammate by email",
    "+1284 −377",
  ]);
});

test("a pull request's row in a 280px column keeps its number and title, and draws nothing past its edge", async () => {
  assert.deepEqual(await publishedAt(ROW.MAIN_280), [
    "#4823 ·",
    "feat(members): invite a teammate by email",
  ]);
  const row = document.querySelector("[data-published-row]") ?? assert.fail("the row stands");
  assert.equal(getComputedStyle(row).overflow, "hidden");
});

test("a subagent's row in a wide column says its job and the model it runs on", async () => {
  assert.deepEqual(await subagentAt(ROW.WIDE), { job: true, pair: true });
});

test("a subagent's row in a narrow column keeps its job and gives up its model, which its card still names", async () => {
  assert.deepEqual(await subagentAt(ROW.MAIN_423), { job: true, pair: false });
  assert.deepEqual(await subagentAt(ROW.MAIN_280), { job: true, pair: false });
});

test("a finished turn's line breaks between how long it worked and when it ended, never inside either", async () => {
  const drawn = await drawnAt(
    {},
    createElement(WorkedFor, { startedAt: 1_000_000, endedAt: 1_840_000 }),
  );
  const line = drawn.querySelector("[data-worked]") ?? assert.fail("the line stands");
  const parts = [...line.children];
  assert.deepEqual(
    parts.map((part) => [part.textContent, getComputedStyle(part).whiteSpace]),
    [
      ["Worked for 14m 0s", "nowrap"],
      [parts[1]?.textContent, "nowrap"],
    ],
  );
});

test("a failure's press stands off the pull request's row under it, as every block of the log stands off the next", async () => {
  const drawn = await drawnAt(
    {},
    createElement(
      "div",
      { role: "log" },
      createElement(FailureNote, {
        failure: { reason: FAILURE_REASON.API_KEY, text: "Failed: your API key was refused." },
        className: "agent-end-line",
        onRemedy: ignore,
      }),
      createElement(PublishedRow, { pullRequest: FAILING, openGitHub: ignore }),
    ),
  );
  const note = drawn.querySelector(".agent-end-line") ?? assert.fail("the note stands");
  assert.notEqual(getComputedStyle(note).marginBottom, "0px");
});
