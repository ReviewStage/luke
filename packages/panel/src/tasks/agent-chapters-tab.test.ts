// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  CONVERSATION_ENTRY,
  type CodingAgentChangedFile,
  type CodingAgentOverviewConversation,
  type CodingAgentOverviewPullRequest,
  type CodingAgentSummary,
  DIFF_SIDE,
  MERGE_STATE,
  PULL_REQUEST_STATE,
  REVIEW_STATE,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import {
  CHAPTER_KIND,
  CHAPTER_RISK,
  type Chapter,
  LINE_REF_SIDE,
} from "@luke/features/pull-request-chapters";
import type { PullRequestChaptersAnswerView } from "@luke/features/pull-request-chapters-view";
import {
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersState,
} from "@luke/features/pull-request-chapters-wire";
import {
  FILE_VIEWED_STATE,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
} from "@luke/features/pull-request-write-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import type { SideBundles } from "../bundle-loader.js";
import type { DiffListProps, DiffViewModule } from "../diff-view/contract.js";
import type { FileTreeModule } from "../file-tree/contract.js";
import { GitHubConnectProvider } from "../github-connect.js";
import { MemberDirectory } from "../member-directory.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { AgentPullRequestTab } from "./agent-pull-request-tab.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./use-side-panel.js";

/**
 * agent-chapters-tab.test.ts -- an agent's Pull request tab offers a
 * Chapters tab after Checks: with none yet, Generate chapters, which stands
 * as generating until it answers, then the chapters, counted on the tab,
 * "Other changes" last; each chapter's diff is Files changed's list handed
 * only its hunks and the review threads on them; chapters made for an
 * older head stand under a line saying so with Regenerate; a generation
 * that failed says why with Retry; a chapter is viewed once its files are,
 * Mark chapter viewed and ⇧V mark them all, ← and → step through the
 * chapters, and a key change's press scrolls to its lines and lights them.
 * Synthetic people, files, and chapters throughout.
 */

const AGENT: CodingAgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const PAGE = "https://github.com/acme/relay/pull/42";
const HEAD = "b".repeat(40);
const OLDER = "a".repeat(40);
const BASE = "c".repeat(40);

const PULL_REQUEST: CodingAgentOverviewPullRequest = {
  number: 42,
  title: "Expire invitations",
  url: PAGE,
  state: PULL_REQUEST_STATE.OPEN,
  html: "",
  base: "main",
  head: "luke/expiry-job",
  createdAt: 1_000,
  mergedAt: null,
  merge: MERGE_STATE.CLEAN,
  author: { login: "luke-agent[bot]", bot: true },
  requested: [],
};

/** A file of two hunks: the read at its top, the write further down. */
const STORE: CodingAgentChangedFile = {
  path: "src/store.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  omitted: null,
  patch: ["@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -10,1 +10,2 @@", " j", "+k"].join("\n"),
};

const SWEEP: CodingAgentChangedFile = {
  path: "src/sweep.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.ADDED,
  additions: 1,
  deletions: 0,
  omitted: null,
  patch: ["@@ -0,0 +1,1 @@", "+sweep();"].join("\n"),
};

const LOCK: CodingAgentChangedFile = {
  path: "pnpm-lock.yaml",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 1,
  deletions: 1,
  omitted: null,
  patch: ["@@ -3,1 +3,1 @@", "-x", "+y"].join("\n"),
};

const FILES = [STORE, SWEEP, LOCK];

const READ_STORE: Chapter = {
  kind: CHAPTER_KIND.STORY,
  title: "Read the expiry",
  summary: "Reads when an invitation **expires**.",
  hunkRefs: [{ path: STORE.path, oldStart: 1 }],
  keyChanges: [
    {
      content: "Is the expiry read in the member's time zone?",
      lineRefs: [{ path: STORE.path, side: LINE_REF_SIDE.ADDITIONS, startLine: 1, endLine: 2 }],
    },
  ],
  risk: CHAPTER_RISK.HIGH,
  riskReasons: ["Changes what every invitation reads"],
};

const SWEEP_EXPIRED: Chapter = {
  kind: CHAPTER_KIND.STORY,
  title: "Sweep what expired",
  summary: "Sweeps the expired invitations.",
  hunkRefs: [
    { path: SWEEP.path, oldStart: 0 },
    { path: STORE.path, oldStart: 10 },
  ],
  keyChanges: [],
  risk: CHAPTER_RISK.LOW,
  riskReasons: [],
};

const OTHER: Chapter = {
  kind: CHAPTER_KIND.OTHER,
  title: "Other changes",
  summary: "Lockfiles.",
  hunkRefs: [{ path: LOCK.path, oldStart: 3 }],
  keyChanges: [],
  risk: null,
  riskReasons: [],
};

/** A review thread on the store's second hunk, which the sweep's chapter holds. */
const ON_WRITE: ReviewThread = {
  path: STORE.path,
  line: 11,
  startLine: null,
  originalLine: 11,
  originalStartLine: null,
  side: DIFF_SIDE.RIGHT,
  startSide: null,
  diffHunk: "@@ -10,1 +10,2 @@\n j\n+k",
  resolved: false,
  outdated: false,
  comments: [],
  more: 0,
  id: "PRRT_onwrite",
};

const CONVERSATION: CodingAgentOverviewConversation = {
  reviewers: [],
  conversation: [
    {
      kind: CONVERSATION_ENTRY.REVIEW,
      by: { login: "charlespan", bot: false },
      state: REVIEW_STATE.COMMENTED,
      html: null,
      body: "",
      at: 2_500,
      url: `${PAGE}#pullrequestreview-9`,
      threads: [ON_WRITE],
    },
  ],
  earlier: 0,
};

/** The read answering the pull request at `HEAD` with these newest chapters. */
function answering(
  chapters: PullRequestChaptersState,
  generatable = true,
): PullRequestChaptersAnswerView {
  return { pullRequest: { number: 42, headSha: HEAD, generatable, chapters } };
}

/** Ready chapters made for `headSha`, "Other changes" put first, as no reader reads it. */
function ready(
  headSha = HEAD,
  chapters: readonly Chapter[] = [OTHER, READ_STORE, SWEEP_EXPIRED],
): PullRequestChaptersState {
  return {
    status: PULL_REQUEST_CHAPTERS_STATE.READY,
    headSha,
    baseSha: BASE,
    model: "claude",
    chapters,
  };
}

let root: Root | undefined;
/** What each of Files changed's lists was handed, mount first, each draw after it, with the box it was drawn in. */
let lists: Array<{ readonly host: HTMLElement; readonly props: DiffListProps }> = [];
/** The files the lists were scrolled to, in order. */
let listReveals: string[] = [];
/** Every viewed mark asked of GitHub, in order. */
let marked: PullRequestActionRequest[] = [];

const DIFF_STAND_IN: DiffViewModule = {
  colourLines: () => Promise.resolve(undefined),
  mount: () => ({ update: () => undefined, unmount: () => undefined }),
  mountList: (host, props) => {
    lists.push({ host, props });
    return {
      update: (next) => lists.push({ host, props: next }),
      reveal: (path) => listReveals.push(path),
      revealLine: (path, side, line) => listReveals.push(`${path}:${side}:${line}`),
      revealLines: (range) =>
        listReveals.push(`${range.path}:${range.side}:${range.startLine}-${range.endLine}`),
      unmount: () => undefined,
    };
  },
};

const TREE_STAND_IN: FileTreeModule = {
  mount: () => {
    const nothing = () => undefined;
    return {
      reveal: nothing,
      search: nothing,
      only: nothing,
      within: nothing,
      mark: nothing,
      unmount: nothing,
    };
  },
  fileIcon: () => ({ symbol: "", type: "" }),
};

let bundles: SideBundles;

beforeAll(async () => {
  bundles = await Effect.runPromise(
    landedBundles({
      diffView: () => Promise.resolve(DIFF_STAND_IN),
      fileTree: () => Promise.resolve(TREE_STAND_IN),
    }),
  );
});

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

// The view is a chunk of its own the tab loads the first time it is shown; loaded once here, so each test's first draw finds it.
beforeAll(() => import("./agent-chapters-tab.js"));

beforeEach(() => {
  window.localStorage.clear();
  lists = [];
  listReveals = [];
  marked = [];
  fakeAppPlatform(DESKTOP_LINKS);
  fakeActPort({
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION]: ({ request }) => {
      marked.push(request);
      return Promise.resolve({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE });
    },
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () =>
      Promise.resolve([
        {
          userId: "user-dana",
          name: "Dana",
          email: "dana@example.com",
          role: WORKSPACE_ROLE.MEMBER,
        },
      ]),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** How a test's control answers: the chapters' read and Generate, and the member's viewed marks. */
interface Answers {
  readonly readChapters?: CodingAgentsControl["readChapters"];
  readonly generateChapters?: CodingAgentsControl["generateChapters"];
  /** The files marked viewed on GitHub; the marks are unread where none are named. */
  readonly viewed?: readonly string[];
}

/** The agent's control, its overview, files, and chapters answering as given. */
function controlAnswering(answers: Answers): CodingAgentsControl {
  return codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    models: [],
    pullRequests: new Map([
      [
        AGENT.id,
        {
          number: 42,
          title: PULL_REQUEST.title,
          url: PAGE,
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PASSING,
          additions: 4,
          deletions: 2,
          changedFiles: 3,
        },
      ],
    ]),
    readOverviewPullRequest: () => Promise.resolve({ pullRequest: PULL_REQUEST }),
    readOverviewConversation: () => Promise.resolve({ pullRequest: CONVERSATION }),
    readOverviewChecks: () => Promise.resolve({ pullRequest: { checks: [] } }),
    readChanges: () =>
      Promise.resolve({
        pullRequest: { url: PAGE, headSha: HEAD, truncated: false, files: FILES },
      }),
    readPullRequestViewed: () =>
      Promise.resolve(
        answers.viewed === undefined
          ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
          : {
              outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
              files: answers.viewed.map((path) => ({ path, state: FILE_VIEWED_STATE.VIEWED })),
            },
      ),
    readChapters:
      answers.readChapters ??
      (() => Promise.resolve(answering({ status: PULL_REQUEST_CHAPTERS_STATE.NONE }))),
    generateChapters: answers.generateChapters ?? (() => Promise.resolve(answering(ready()))),
  });
}

/** The tab, holding the view its row chooses as the side panel does. */
function Switching({ control, first }: { control: CodingAgentsControl; first: PullRequestView }) {
  const [view, setView] = useState<PullRequestView>(first);
  return createElement(AgentPullRequestTab, {
    agentId: AGENT.id,
    control,
    shown: true,
    repository: "acme/relay",
    tree: { open: false, onToggle: () => undefined },
    view,
    onView: setView,
  });
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 16; tick += 1) await Promise.resolve();
  });
}

/** Draws the agent's tab on its Chapters view, its reads landed. */
async function draw(control: CodingAgentsControl): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const tab = createElement(Switching, { control, first: PULL_REQUEST_VIEW.CHAPTERS });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(
          bundles,
          createElement(GitHubConnectProvider, {
            value: {
              connection: undefined,
              connect: () => Promise.resolve(false),
              disconnect: () => Promise.resolve(false),
            },
            children: createElement(MemberDirectory, {
              workspace: { id: "workspace-acme", memberCount: 1 },
              readerId: "user-dana",
              children: tab,
            }),
          }),
        ),
      ),
    ),
  );
  await settle();
  return container;
}

/** The tabs of the row under the header, by their words. */
function tabNames(tab: HTMLElement): string[] {
  return [...tab.querySelectorAll('[role="tab"]')].map((each) => each.textContent ?? "");
}

/** The button whose words are as given, where one stands outside a hidden view. */
function button(container: HTMLElement, words: string): HTMLButtonElement {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent?.trim() === words && each.closest("[hidden]") === null,
    ) ?? assert.fail(`a ${words} button stands`)
  );
}

/** The rail's rows, as a reader hears each. */
function railRows(tab: HTMLElement): string[] {
  return [...tab.querySelectorAll(".chapter-rail [aria-label]")]
    .filter((each) => each.tagName === "BUTTON")
    .map((each) => each.getAttribute("aria-label") ?? "");
}

/** The chapter shown, by its heading. */
function heading(tab: HTMLElement): string {
  return tab.querySelector(".chapter-head h3")?.textContent ?? "";
}

/** The paths and patches the chapter's list was last handed, the Files changed view's own left out. */
function listed(): Array<[string, string]> {
  const chapter = lists.filter((each) => each.host.closest(".chapters-view") !== null).at(-1);
  return (chapter?.props.files ?? []).map((file) => [file.path, file.patch]);
}

/** Presses a key on the chapter's view. */
function press(tab: HTMLElement, init: KeyboardEventInit): void {
  const view = tab.querySelector(".chapters-view") ?? assert.fail("the chapters stand");
  act(() => {
    view.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

test("Chapters stands after Checks; with none yet it offers Generate chapters, which stands as generating until it answers, then the chapters, counted on the tab, Other changes last", async () => {
  const generated = Promise.withResolvers<PullRequestChaptersAnswerView>();
  let reads = 0;
  const tab = await draw(
    controlAnswering({
      readChapters: () => {
        reads += 1;
        return Promise.resolve(
          reads === 1
            ? answering({ status: PULL_REQUEST_CHAPTERS_STATE.NONE })
            : answering(ready()),
        );
      },
      generateChapters: () => generated.promise,
    }),
  );

  assert.deepEqual(
    tabNames(tab)
      .slice(0, 4)
      .map((name) => name.replace(/[\d+−\s].*$/u, "")),
    ["Conversation", "Checks", "Chapters", "Files"],
  );
  act(() => button(tab, "Generate chapters").click());
  await settle();
  assert.match(
    tab.querySelector(".chapters-generating-line")?.textContent ?? "",
    /^Generating chapters/u,
  );

  generated.resolve(answering(ready()));
  await settle();
  assert.equal(reads, 2, "the chapters are read again once the Generate lands");
  assert.deepEqual(railRows(tab), [
    "1. Read the expiry, High risk",
    "2. Sweep what expired, Low risk",
    "3. Other changes",
  ]);
  assert.ok(
    tabNames(tab).some((name) => name === "Chapters3"),
    "the tab counts the chapters",
  );
});

test("a chapter's diff is Files changed's list handed only its hunks, and its rail row counts the review threads on them", async () => {
  const tab = await draw(
    controlAnswering({ readChapters: () => Promise.resolve(answering(ready())) }),
  );

  assert.equal(heading(tab), "1. Read the expiry");
  assert.deepEqual(
    listed().map(([path]) => path),
    [STORE.path],
  );
  assert.ok(listed()[0]?.[1].includes("+B"), "the read's hunk is drawn");
  assert.ok(!listed()[0]?.[1].includes("+k"), "the write's hunk is not");
  const sweepRow =
    [...tab.querySelectorAll<HTMLButtonElement>(".chapter-rail button")].find((each) =>
      each.getAttribute("aria-label")?.startsWith("2."),
    ) ?? assert.fail("the sweep's row stands");
  assert.match(sweepRow.textContent ?? "", /1 threads/u, "the thread on the write is the sweep's");

  act(() => sweepRow.click());
  await settle();
  assert.equal(heading(tab), "2. Sweep what expired");
  assert.deepEqual(
    listed()
      .map(([path]) => path)
      .sort(),
    [STORE.path, SWEEP.path].sort(),
  );
});

test("← and → step through the chapters, held at either end, and a key change's lines bring its file into view", async () => {
  const tab = await draw(
    controlAnswering({ readChapters: () => Promise.resolve(answering(ready())) }),
  );

  press(tab, { key: "ArrowLeft" });
  assert.equal(heading(tab), "1. Read the expiry");
  press(tab, { key: "ArrowRight" });
  press(tab, { key: "ArrowRight" });
  await settle();
  assert.equal(heading(tab), "3. Other changes");
  press(tab, { key: "ArrowRight" });
  assert.equal(heading(tab), "3. Other changes");
  act(() => button(tab, "Previous chapter").click());
  act(() => button(tab, "Previous chapter").click());
  await settle();

  act(() => button(tab, "src/store.ts · L1–2").click());
  await settle();
  assert.deepEqual(listReveals, ["src/store.ts:additions:1-2"]);
});

test("a key change's press scrolls to its first lines in the chapter's file order and lights them, or to its file where the chapter draws none of them", async () => {
  const pointed: Chapter = {
    ...SWEEP_EXPIRED,
    keyChanges: [
      {
        content: "Does the sweep run before the write?",
        lineRefs: [
          { path: STORE.path, side: LINE_REF_SIDE.ADDITIONS, startLine: 11, endLine: 11 },
          { path: SWEEP.path, side: LINE_REF_SIDE.ADDITIONS, startLine: 1, endLine: 1 },
        ],
      },
      {
        content: "Is the read between them still right?",
        lineRefs: [{ path: STORE.path, side: LINE_REF_SIDE.ADDITIONS, startLine: 5, endLine: 6 }],
      },
    ],
  };
  const tab = await draw(
    controlAnswering({
      readChapters: () => Promise.resolve(answering(ready(HEAD, [READ_STORE, pointed]))),
    }),
  );
  press(tab, { key: "ArrowRight" });
  await settle();
  assert.equal(heading(tab), "2. Sweep what expired");

  act(() => button(tab, "src/sweep.ts · L1").click());
  await settle();
  act(() => button(tab, "src/store.ts · L5–6").click());
  await settle();
  assert.deepEqual(listReveals, ["src/sweep.ts:additions:1-1", STORE.path]);
});

test("a chapter is viewed once every file it holds is; Mark chapter viewed and ⇧V mark the rest, and unmark them all once all are", async () => {
  const tab = await draw(
    controlAnswering({
      readChapters: () => Promise.resolve(answering(ready())),
      viewed: [STORE.path],
    }),
  );

  assert.match(railRows(tab)[0] ?? "", /, viewed$/u, "the read's one file is viewed");
  assert.doesNotMatch(railRows(tab)[1] ?? "", /viewed/u, "the sweep's new file is not");

  press(tab, { key: "ArrowRight" });
  press(tab, { key: "V", shiftKey: true });
  await settle();
  assert.deepEqual(marked, [{ action: PULL_REQUEST_ACTION.MARK_FILE_VIEWED, path: SWEEP.path }]);
  assert.match(railRows(tab)[1] ?? "", /, viewed$/u);

  const box =
    tab.querySelector<HTMLInputElement>('.chapter-viewed input[type="checkbox"]') ??
    assert.fail("the chapter's Viewed box stands");
  assert.equal(box.checked, true);
  act(() => box.click());
  await settle();
  assert.deepEqual(marked.slice(1), [
    { action: PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED, path: SWEEP.path },
    { action: PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED, path: STORE.path },
  ]);
});

test("chapters made for an older head stand under a line saying new commits came since, with Regenerate, drawing no diff, counts, Viewed, or press to their lines, since their hunks name an older head", async () => {
  let generates = 0;
  const tab = await draw(
    controlAnswering({
      readChapters: () => Promise.resolve(answering(ready(OLDER))),
      generateChapters: () => {
        generates += 1;
        return Promise.resolve(answering(ready()));
      },
    }),
  );

  assert.match(
    tab.querySelector(".chapters-stale")?.textContent ?? "",
    /New commits since these chapters/u,
  );
  assert.equal(heading(tab), "1. Read the expiry", "the chapters stand as they were");
  assert.match(tab.textContent ?? "", /Is the expiry read in the member's time zone\?/u);
  assert.deepEqual(listed(), [], "no diff is drawn for the chapter");
  assert.match(tab.textContent ?? "", /These chapters were made before the newest commits\./u);
  const sweepRow =
    [...tab.querySelectorAll<HTMLButtonElement>(".chapter-rail button")].find((each) =>
      each.getAttribute("aria-label")?.startsWith("2."),
    ) ?? assert.fail("the sweep's row stands");
  assert.doesNotMatch(sweepRow.textContent ?? "", /threads|\+/u, "no lines or threads are counted");
  assert.equal(tab.querySelector(".chapter-viewed"), null, "no Viewed box stands");
  assert.equal(
    [...tab.querySelectorAll("button")].some((each) => each.textContent === "src/store.ts · L1–2"),
    false,
    "a key change's lines are named, not pressed",
  );
  act(() => button(tab, "Regenerate").click());
  await settle();
  assert.equal(generates, 1);
});

test("a generation that failed says why with Retry, chapters someone else is making offer Refresh, and a deployment that cannot make them says so", async () => {
  let generates = 0;
  const tooLarge = await draw(
    controlAnswering({
      readChapters: () =>
        Promise.resolve(
          answering({
            status: PULL_REQUEST_CHAPTERS_STATE.FAILED,
            headSha: HEAD,
            baseSha: BASE,
            failureKind: PULL_REQUEST_CHAPTERS_FAILURE_KIND.TOO_LARGE,
          }),
        ),
      generateChapters: () => {
        generates += 1;
        return Promise.resolve(answering(ready()));
      },
    }),
  );
  assert.match(tooLarge.textContent ?? "", /This pull request is too large to chapter\./u);
  act(() => button(tooLarge, "Retry").click());
  await settle();
  assert.equal(generates, 1);
  act(() => root?.unmount());

  let reads = 0;
  const elsewhere = await draw(
    controlAnswering({
      readChapters: () => {
        reads += 1;
        return Promise.resolve(
          answering({
            status: PULL_REQUEST_CHAPTERS_STATE.GENERATING,
            headSha: HEAD,
            baseSha: BASE,
            startedAt: 1_000,
          }),
        );
      },
    }),
  );
  assert.match(
    elsewhere.querySelector(".chapters-generating-line")?.textContent ?? "",
    /^Chapters are being generated/u,
  );
  act(() => button(elsewhere, "Refresh").click());
  await settle();
  assert.equal(reads, 2);
  act(() => root?.unmount());

  const unavailable = await draw(
    controlAnswering({
      readChapters: () =>
        Promise.resolve(answering({ status: PULL_REQUEST_CHAPTERS_STATE.NONE }, false)),
    }),
  );
  assert.match(unavailable.textContent ?? "", /Chapters aren't available on this deployment\./u);
  assert.equal(
    [...unavailable.querySelectorAll("button")].some(
      (each) => each.textContent === "Generate chapters",
    ),
    false,
  );
});
