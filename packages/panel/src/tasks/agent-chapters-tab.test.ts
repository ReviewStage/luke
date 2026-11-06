// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DURATION_MS } from "@repo/brand";
import { AGENT_CALL_FAILURE, PULL_REQUEST_PART } from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentChangedFile,
  type AgentOverviewConversation,
  type AgentOverviewPullRequest,
  type AgentSummary,
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CONVERSATION_ENTRY,
  DIFF_SIDE,
  MERGE_STATE,
  PULL_REQUEST_STATE,
  REVIEW_STATE,
  type ReviewThread,
} from "@repo/features/agent-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import {
  CHAPTER_KIND,
  CHAPTER_RISK,
  type Chapter,
  LINE_REF_SIDE,
} from "@repo/features/pull-request-chapters";
import type { PullRequestChaptersAnswerView } from "@repo/features/pull-request-chapters-view";
import {
  type ChaptersRunsOn,
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersState,
} from "@repo/features/pull-request-chapters-wire";
import {
  FILE_VIEWED_STATE,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
} from "@repo/features/pull-request-write-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppChapters } from "@repo/host/app-state";
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
import { answeringChanges, fakeActPort, fakeActPortCalls } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { handHostReads, holdMembers, holdPullRequestParts } from "../testing/app-state.js";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry, settleQueries } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { agentsControl } from "../testing/tasks-control.js";
import { AgentPullRequestTab } from "./agent-pull-request-tab.js";
import type { AgentsControl } from "./use-agents.js";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./use-side-panel.js";

const AGENT: AgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
};

const PAGE = "https://github.com/acme/relay/pull/42";
const HEAD = "b".repeat(40);
const OLDER = "a".repeat(40);
const BASE = "c".repeat(40);

const PULL_REQUEST: AgentOverviewPullRequest = {
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

const STORE: AgentChangedFile = {
  path: "src/store.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  omitted: null,
  patch: ["@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -10,1 +10,2 @@", " j", "+k"].join("\n"),
};

const SWEEP: AgentChangedFile = {
  path: "src/sweep.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.ADDED,
  additions: 1,
  deletions: 0,
  omitted: null,
  patch: ["@@ -0,0 +1,1 @@", "+sweep();"].join("\n"),
};

const LOCK: AgentChangedFile = {
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

const CONVERSATION: AgentOverviewConversation = {
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

const ON_HAIKU: ChaptersRunsOn = {
  provider: MODEL_PROVIDER.ANTHROPIC,
  model: "claude-haiku-5-5",
};

function answering(
  chapters: PullRequestChaptersState,
  runsOn: ChaptersRunsOn | null = ON_HAIKU,
): PullRequestChaptersAnswerView {
  return {
    pullRequest: {
      number: 42,
      generatable: runsOn !== null,
      ...(runsOn === null ? {} : { runsOn }),
      chapters,
    },
  };
}

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
let lists: Array<{ readonly host: HTMLElement; readonly props: DiffListProps }> = [];
let listReveals: string[] = [];
let marked: PullRequestActionRequest[] = [];

const DIFF_STAND_IN: DiffViewModule = {
  mount: () => ({ update: () => undefined, unmount: () => undefined }),
  mountFile: () => ({
    update: () => undefined,
    revealLines: () => undefined,
    pickedLines: () => undefined,
    unmount: () => undefined,
  }),
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
      relist: nothing,
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

beforeAll(() => import("./agent-chapters-tab.js"));

beforeEach(() => {
  window.localStorage.clear();
  lists = [];
  listReveals = [];
  marked = [];
  fakeAppPlatform(DESKTOP_LINKS);
  fakeActPort({
    [ACT_KIND.AGENTS_PULL_REQUEST_ACTION]: ({ request }) => {
      marked.push(request);
      return Promise.resolve({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE });
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  for (const style of document.head.querySelectorAll("style")) style.remove();
  document.body.style.removeProperty("--ui-duration-pane");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Answers {
  readonly chapters?: PullRequestChaptersAnswerView;
  readonly generateChapters?: AgentsControl["generateChapters"];
  readonly viewed?: readonly string[];
  readonly head?: () => string;
  readonly filesHeadless?: boolean;
}

const DANA: WorkspaceMember = {
  userId: "user-dana",
  name: "Dana",
  email: "dana@example.com",
  role: WORKSPACE_ROLE.MEMBER,
};

let moveChapters: (next: PullRequestChaptersAnswerView) => void = () => undefined;

function chaptersHeld(answer: PullRequestChaptersAnswerView): AppChapters {
  return {
    [AGENT.id]: {
      [String(PULL_REQUEST.number)]: "failure" in answer ? { failed: true } : { rows: answer },
    },
  };
}

function controlAnswering(answers: Answers): AgentsControl {
  const { deliverChapters, deliverMembers, deliverParts } = handHostReads({
    chapters: chaptersHeld(
      answers.chapters ?? answering({ status: PULL_REQUEST_CHAPTERS_STATE.NONE }),
    ),
  });
  moveChapters = (next) => deliverChapters(chaptersHeld(next));
  holdMembers(deliverMembers, () => ({ rows: { members: [DANA] } }));
  holdPullRequestParts(deliverParts, {
    [PULL_REQUEST_PART.PULL_REQUEST]: () =>
      Promise.resolve({
        pullRequest:
          answers.head === undefined
            ? PULL_REQUEST
            : {
                ...PULL_REQUEST,
                merging: {
                  methods: [],
                  autoMergeAllowed: false,
                  queue: false,
                  queued: null,
                  autoMerge: null,
                  headSha: answers.head(),
                  review: null,
                  checks: CHECK_SUMMARY.PASSING,
                },
              },
      }),
    [PULL_REQUEST_PART.CONVERSATION]: () => Promise.resolve({ pullRequest: CONVERSATION }),
    [PULL_REQUEST_PART.CHECKS]: () => Promise.resolve({ pullRequest: { checks: [] } }),
    [PULL_REQUEST_PART.VIEWED]: () =>
      Promise.resolve(
        answers.viewed === undefined
          ? { failure: AGENT_CALL_FAILURE.UNANSWERED }
          : {
              outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
              files: answers.viewed.map((path) => ({ path, state: FILE_VIEWED_STATE.VIEWED })),
            },
      ),
  });
  fakeActPort({
    ...fakeActPortCalls(),
    ...answeringChanges(() => {
      const head = answers.head?.() ?? HEAD;
      const files = head === HEAD ? FILES : [];
      return Promise.resolve({
        pullRequest: {
          url: PAGE,
          ...(answers.filesHeadless === true ? {} : { headSha: head }),
          truncated: false,
          files,
        },
      });
    }),
  });
  return agentsControl({
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
    generateChapters: answers.generateChapters ?? (() => Promise.resolve(answering(ready()))),
  });
}

function Switching({ control, first }: { control: AgentsControl; first: PullRequestView }) {
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

async function settle(): Promise<void> {
  const ticks = () =>
    act(async () => {
      for (let tick = 0; tick < 16; tick += 1) await Promise.resolve();
    });
  await ticks();
  await settleQueries(ticks);
}

async function draw(
  control: AgentsControl,
  first: PullRequestView = PULL_REQUEST_VIEW.CHAPTERS,
): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const tab = createElement(Switching, { control, first });
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

function tabNames(tab: HTMLElement): string[] {
  return [...tab.querySelectorAll('[role="tab"]')].map((each) => each.textContent ?? "");
}

function chaptersTabWords(tab: HTMLElement): string {
  const chapters =
    [...tab.querySelectorAll('[role="tab"]')].find((each) =>
      each.textContent?.startsWith("Chapters"),
    ) ?? assert.fail("the Chapters tab stands");
  return drawnWords(chapters);
}

function button(container: HTMLElement, words: string): HTMLButtonElement {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent?.trim() === words && each.closest("[hidden]") === null,
    ) ?? assert.fail(`a ${words} button stands`)
  );
}

function railPresses(container: Element | null): HTMLButtonElement[] {
  return [...(container?.querySelectorAll<HTMLButtonElement>(".ui-list-row-main") ?? [])];
}

function railRows(tab: HTMLElement): string[] {
  return railPresses(tab.querySelector(".chapter-rail")).map(
    (each) => each.querySelector(".ui-list-row-title")?.textContent ?? "",
  );
}

function railRow(container: Element | null, at: number): HTMLButtonElement {
  return railPresses(container)[at] ?? assert.fail(`row ${at + 1} stands`);
}

function linesPress(tab: HTMLElement, label: string): HTMLButtonElement {
  return (
    tab.querySelector<HTMLButtonElement>(`button[aria-label="Show ${label} in the diff"]`) ??
    assert.fail(`a press on ${label} stands`)
  );
}

function drawnWords(node: Node): string {
  if (node instanceof Element && node.getAttribute("role") === "img") {
    return node.getAttribute("aria-label") ?? "";
  }
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.trim() ?? "";
  return [...node.childNodes]
    .map(drawnWords)
    .filter((words) => words !== "")
    .join(" ");
}

function heading(tab: HTMLElement): string {
  return tab.querySelector(".chapter-reading .ui-pane-bar-title")?.textContent ?? "";
}

function listed(): Array<[string, string]> {
  const chapter = lists.filter((each) => each.host.closest(".chapters-view") !== null).at(-1);
  return (chapter?.props.files ?? []).map((file) => [file.path, file.patch]);
}

function press(tab: HTMLElement, init: KeyboardEventInit): void {
  const view = tab.querySelector(".chapters-view") ?? assert.fail("the chapters stand");
  act(() => {
    view.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

test("Chapters stands after Checks; with none yet it offers Generate chapters on the model and key the read names, which stands as generating until it answers, then the chapters, counted on the tab, Other changes last", async () => {
  const generated = Promise.withResolvers<PullRequestChaptersAnswerView>();
  const tab = await draw(
    controlAnswering({
      chapters: answering(
        { status: PULL_REQUEST_CHAPTERS_STATE.NONE },
        { provider: MODEL_PROVIDER.OPENAI, model: "gpt-6-luna" },
      ),
      generateChapters: () => generated.promise,
    }),
  );

  assert.deepEqual(
    tabNames(tab)
      .slice(0, 4)
      .map((name) => name.replace(/[\d+−\s].*$/u, "")),
    ["Conversation", "Checks", "Chapters", "Files"],
  );
  const generate = await vi.waitFor(() => button(tab, "Generate with GPT-6 Luna"));
  assert.match(tab.textContent ?? "", /Generating them runs on your OpenAI API key\./u);
  act(() => generate.click());
  await settle();
  assert.match(tab.textContent ?? "", /Generating chapters/u);

  generated.resolve(answering(ready()));
  await settle();
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
  const tab = await draw(controlAnswering({ chapters: answering(ready()) }));

  await vi.waitFor(() => assert.equal(heading(tab), "Read the expiry"));
  const bars = tab.querySelectorAll(".chapters-view .ui-pane-bar");
  assert.equal(bars.length, 1, "the chapter's bar is the one bar over its list");
  assert.notEqual(
    bars[0]?.querySelector(".chapter-list-tools .file-tree-toggle"),
    null,
    "the chapter's bar holds its list's tree toggle",
  );
  assert.deepEqual(
    listed().map(([path]) => path),
    [STORE.path],
  );
  assert.ok(listed()[0]?.[1].includes("+B"), "the read's hunk is drawn");
  assert.ok(!listed()[0]?.[1].includes("+k"), "the write's hunk is not");
  const sweepRow = railRow(tab.querySelector(".chapter-rail"), 1);
  assert.match(drawnWords(sweepRow), /threads 1$/u, "the thread on the write is the sweep's");

  act(() => sweepRow.click());
  await settle();
  assert.equal(heading(tab), "Sweep what expired");
  assert.deepEqual(
    listed()
      .map(([path]) => path)
      .sort(),
    [STORE.path, SWEEP.path].sort(),
  );
});

test("← and → step through the chapters, held at either end, and a key change's lines bring its file into view", async () => {
  const tab = await draw(controlAnswering({ chapters: answering(ready()) }));
  await vi.waitFor(() => assert.equal(heading(tab), "Read the expiry"));

  press(tab, { key: "ArrowLeft" });
  assert.equal(heading(tab), "Read the expiry");
  press(tab, { key: "ArrowRight" });
  press(tab, { key: "ArrowRight" });
  await settle();
  assert.equal(heading(tab), "Other changes");
  press(tab, { key: "ArrowRight" });
  assert.equal(heading(tab), "Other changes");
  const previous =
    tab.querySelector<HTMLButtonElement>(
      '.chapter-reading button[aria-label="Previous chapter"]',
    ) ?? assert.fail("the header's pager offers Previous chapter");
  act(() => previous.click());
  act(() => previous.click());
  await settle();
  assert.equal(heading(tab), "Read the expiry");

  act(() => linesPress(tab, "src/store.ts · L1–2").click());
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
      chapters: answering(ready(HEAD, [READ_STORE, pointed])),
    }),
  );
  await vi.waitFor(() => assert.equal(heading(tab), "Read the expiry"));
  press(tab, { key: "ArrowRight" });
  await settle();
  assert.equal(heading(tab), "Sweep what expired");

  act(() => linesPress(tab, "src/sweep.ts · L1").click());
  await settle();
  act(() => linesPress(tab, "src/store.ts · L5–6").click());
  await settle();
  assert.deepEqual(listReveals, ["src/sweep.ts:additions:1-1", STORE.path]);
});

test("a chapter is viewed once every file it holds is; Mark chapter viewed and ⇧V mark the rest, and unmark them all once all are", async () => {
  const tab = await draw(
    controlAnswering({
      chapters: answering(ready()),
      viewed: [STORE.path],
    }),
  );

  const rail = () => tab.querySelector(".chapter-rail");
  await vi.waitFor(() =>
    assert.match(drawnWords(railRow(rail(), 0)), /viewed$/u, "the read's one file is viewed"),
  );
  assert.equal(chaptersTabWords(tab), "Chapters 1/3 viewed", "the tab counts the chapters viewed");
  assert.doesNotMatch(drawnWords(railRow(rail(), 1)), /viewed/u, "the sweep's new file is not");

  press(tab, { key: "ArrowRight" });
  const viewedBox = () =>
    tab.querySelector(".chapter-viewed") ?? assert.fail("the chapter's Viewed box stands");
  assert.equal(viewedBox().textContent, "Viewed 1/2", "the box counts the sweep's files viewed");
  assert.equal(
    viewedBox().querySelector('[role="checkbox"]')?.getAttribute("aria-checked"),
    "mixed",
    "the box stands mixed while only some of them are",
  );
  press(tab, { key: "V", shiftKey: true });
  await settle();
  assert.deepEqual(marked, [{ action: PULL_REQUEST_ACTION.MARK_FILE_VIEWED, path: SWEEP.path }]);
  assert.match(drawnWords(railRow(rail(), 1)), /viewed$/u);
  assert.equal(chaptersTabWords(tab), "Chapters 2/3 viewed");

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

test("the Chapters tab says where the chapters stand before their view is opened: out of date under a clock once the pull request moved on from their head", async () => {
  const tab = await draw(
    controlAnswering({
      head: () => HEAD,
      chapters: answering(ready(OLDER)),
    }),
    PULL_REQUEST_VIEW.CONVERSATION,
  );

  assert.equal(tab.querySelector(".chapters-view"), null, "the view was never opened");
  await vi.waitFor(() => assert.equal(chaptersTabWords(tab), "Chapters out of date 3"));
});

test("the Chapters tab counts none viewed where the files' read names no head, since the view takes the chapters as out of date then", async () => {
  const tab = await draw(
    controlAnswering({
      head: () => HEAD,
      filesHeadless: true,
      chapters: answering(ready()),
      viewed: [STORE.path],
    }),
  );

  await vi.waitFor(() =>
    assert.match(tab.querySelector(".ui-tab-notice")?.textContent ?? "", /New commits since/u),
  );
  assert.equal(chaptersTabWords(tab), "Chapters out of date 3");
});

function readyChapters(headSha: string): Extract<PullRequestChaptersState, { model: string }> {
  const chapters = ready(headSha);
  return chapters.status === PULL_REQUEST_CHAPTERS_STATE.READY ? chapters : assert.fail("ready");
}

function madeBy(model: string, headSha = HEAD): AgentsControl {
  return controlAnswering({
    chapters: answering({ ...readyChapters(headSha), model }),
  });
}

test("the rail's foot says which model made the chapters, inside the tab's ph-no-capture root", async () => {
  const tab = await draw(madeBy("claude-haiku-5-5"));
  const line = await vi.waitFor(
    () => tab.querySelector(".chapter-rail-credit") ?? assert.fail("the model is named"),
  );
  assert.equal(line.textContent, "Chapters by Haiku 5.5");
  assert.notEqual(line.closest(".ph-no-capture"), null);
});

test("stale chapters still say which model made them, and a model Settings does not offer is named by its id", async () => {
  const tab = await draw(madeBy("scripted", OLDER));
  await vi.waitFor(() =>
    assert.match(tab.querySelector(".ui-tab-notice")?.textContent ?? "", /New commits since/u),
  );
  assert.equal(tab.querySelector(".chapter-rail-credit")?.textContent, "Chapters by scripted");
});

test("chapters made for an older head stand under a line saying new commits came since, with Regenerate, drawing no diff, counts, Viewed, or press to their lines, since their hunks name an older head", async () => {
  let generates = 0;
  const tab = await draw(
    controlAnswering({
      chapters: answering(ready(OLDER)),
      generateChapters: () => {
        generates += 1;
        return Promise.resolve(answering(ready()));
      },
    }),
  );

  await vi.waitFor(() =>
    assert.match(
      tab.querySelector(".ui-tab-notice")?.textContent ?? "",
      /New commits since these chapters/u,
    ),
  );
  assert.equal(heading(tab), "Read the expiry", "the chapters stand as they were");
  assert.match(tab.textContent ?? "", /Is the expiry read in the member's time zone\?/u);
  assert.deepEqual(listed(), [], "no diff is drawn for the chapter");
  assert.match(tab.textContent ?? "", /Regenerate the chapters to see this chapter's changes\./u);
  const sweepRow = railRow(tab.querySelector(".chapter-rail"), 1);
  assert.doesNotMatch(drawnWords(sweepRow), /threads|\+/u, "no lines or threads are counted");
  assert.equal(tab.querySelector(".chapter-viewed"), null, "no Viewed box stands");
  assert.equal(
    tab.querySelector('button[aria-label^="Show src/store.ts"]'),
    null,
    "a key change's lines are named, not pressed",
  );
  assert.match(
    tab.textContent ?? "",
    /src\/store\.ts · L1–2/u,
    "a key change's lines are named, its file and its lines apart",
  );
  act(() => button(tab, "Regenerate").click());
  await settle();
  assert.equal(generates, 1);
});

test("chapters a Generate made for a head pushed since the tab read the pull request draw their diff once the tab has read that head again", async () => {
  let head = OLDER;
  const tab = await draw(
    controlAnswering({
      head: () => head,
      generateChapters: () => {
        head = HEAD;
        return Promise.resolve(answering(ready()));
      },
    }),
  );

  const generate = await vi.waitFor(() => button(tab, "Generate with Haiku 5.5"));
  act(() => generate.click());
  await settle();
  assert.equal(heading(tab), "Read the expiry");
  assert.doesNotMatch(tab.querySelector(".ui-tab-notice")?.textContent ?? "", /New commits since/u);
  assert.notDeepEqual(listed(), [], "the chapter's diff is drawn from the files of its head");
});

test("a generation that failed says why with Retry, chapters someone else is making draw once the host's read of them moves, and a deployment that cannot make them says so", async () => {
  let generates = 0;
  const tooLarge = await draw(
    controlAnswering({
      chapters: answering({
        status: PULL_REQUEST_CHAPTERS_STATE.FAILED,
        headSha: HEAD,
        baseSha: BASE,
        failureKind: PULL_REQUEST_CHAPTERS_FAILURE_KIND.TOO_LARGE,
      }),
      generateChapters: () => {
        generates += 1;
        return Promise.resolve(answering(ready()));
      },
    }),
  );
  await vi.waitFor(() =>
    assert.match(tooLarge.textContent ?? "", /This pull request is too large to chapter\./u),
  );
  act(() => button(tooLarge, "Retry").click());
  await settle();
  assert.equal(generates, 1);
  act(() => root?.unmount());

  const elsewhere = await draw(
    controlAnswering({
      chapters: answering({
        status: PULL_REQUEST_CHAPTERS_STATE.GENERATING,
        headSha: HEAD,
        baseSha: BASE,
        startedAt: 1_000,
      }),
    }),
  );
  assert.match(elsewhere.textContent ?? "", /Generating chapters/u);
  act(() => moveChapters(answering(ready())));
  await vi.waitFor(() =>
    assert.deepEqual(railRows(elsewhere), [
      "1. Read the expiry, High risk",
      "2. Sweep what expired, Low risk",
      "3. Other changes",
    ]),
  );
  act(() => root?.unmount());

  const unavailable = await draw(
    controlAnswering({
      chapters: answering({ status: PULL_REQUEST_CHAPTERS_STATE.NONE }, null),
    }),
  );
  await vi.waitFor(() =>
    assert.match(
      unavailable.textContent ?? "",
      /Save an API key in Agents settings to generate chapters\./u,
    ),
  );
  assert.equal(
    [...unavailable.querySelectorAll("button")].some((each) =>
      each.textContent?.startsWith("Generate"),
    ),
    false,
  );
});

function floatedRail(tab: HTMLElement): HTMLElement | null {
  return tab.querySelector<HTMLElement>('aside[aria-label="Chapters"]');
}

function railToggle(tab: HTMLElement): HTMLButtonElement {
  return (
    tab.querySelector<HTMLButtonElement>('.chapter-rail-toggle[data-place="over"] button') ??
    assert.fail("the toggle that floats the rail is drawn")
  );
}

async function narrowChapters(): Promise<HTMLElement> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.body.style.setProperty("--ui-duration-pane", `${MOTION_DURATION_MS.PANE}ms`);
  layContainersAt({ "side-panel": 500 });
  const tab = await draw(controlAnswering({ chapters: answering(ready()) }));
  await vi.waitFor(() => railToggle(tab));
  assert.equal(floatedRail(tab), null, "the rail is away until its toggle is pressed");
  return tab;
}

test("in a narrow panel the rail opens over the chapter, stays drawn through its exit, then is let go", async () => {
  const tab = await narrowChapters();
  act(() => railToggle(tab).click());
  const opened = floatedRail(tab) ?? assert.fail("the rail opens over the chapter");
  assert.equal(opened.getAttribute("data-state"), "open");

  act(() => railToggle(tab).click());
  assert.equal(floatedRail(tab)?.getAttribute("data-state"), "leaving");
  act(() => vi.advanceTimersByTime(MOTION_DURATION_MS.PANE - 1));
  assert.notEqual(floatedRail(tab), null, "the exit has not finished");
  act(() => vi.advanceTimersByTime(1));
  assert.equal(floatedRail(tab), null, "the rail is let go once its exit has played");
});

test("Escape in the rail floated over the chapter puts it away and gives the keyboard back to its toggle", async () => {
  const tab = await narrowChapters();
  act(() => railToggle(tab).focus());
  act(() => railToggle(tab).click());
  const rail = floatedRail(tab) ?? assert.fail("the rail opens over the chapter");
  assert.equal(document.activeElement, rail, "the rail takes the keyboard as it opens");

  act(() => {
    rail.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(floatedRail(tab)?.getAttribute("data-state"), "leaving");
  assert.equal(document.activeElement, railToggle(tab));
});

test("a chapter chosen in the rail floated over the chapter takes the rail down", async () => {
  const tab = await narrowChapters();
  act(() => railToggle(tab).click());
  const sweep = railRow(floatedRail(tab) ?? null, 1);
  act(() => sweep.click());
  await settle();
  assert.equal(heading(tab), "Sweep what expired");
  assert.equal(floatedRail(tab)?.getAttribute("data-state"), "leaving");
});
