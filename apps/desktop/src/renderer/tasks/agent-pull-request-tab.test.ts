// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentOverviewChecksAnswerView,
  type CodingAgentOverviewConversationAnswerView,
  type CodingAgentOverviewPullRequestAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CHECK_STATE,
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  CONVERSATION_ENTRY,
  type CodingAgentOverviewChecks,
  type CodingAgentOverviewConversation,
  type CodingAgentOverviewPullRequest,
  type CodingAgentSummary,
  DIFF_SIDE,
  MERGE_STATE,
  PULL_REQUEST_STATE,
  type PullRequestState,
  REVIEW_STATE,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
  type PullRequestWriteAnswer,
} from "@luke/features/pull-request-write-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { codingAgentsControl } from "#testing/tasks-control";
import type { DiffViewProps } from "../diff-view/contract";
import { type GitHubConnectControl, GitHubConnectProvider } from "../github-connect";
import { MemberDirectory } from "../member-directory";
import { AgentPullRequestTab } from "./agent-pull-request-tab";
import type { CodingAgentsControl } from "./use-coding-agents";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./use-side-panel";

/**
 * agent-pull-request-tab.test.ts -- an agent's Pull request tab draws its
 * pull request as a page: where it stands and its branches on the bar,
 * whether it would merge, its checks with what failed first, its
 * description as markdown, and its comments and reviews in time order, a
 * long one sending the reader to GitHub for the rest; it opens the agent's
 * Changes from its bar, says so where there is no pull request yet, and
 * offers a retry where a read failed. The overview is three reads, the pull
 * request itself, its checks, and its conversation, each drawn as it lands,
 * a skeleton until then, under the bar and title Luke already held.
 * Synthetic people throughout.
 */

const CHARLES: WorkspaceMember = {
  userId: "user-charles",
  name: "Charles Pan",
  email: "charles@example.com",
  role: WORKSPACE_ROLE.MEMBER,
};

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
const CHARLES_ON_GITHUB = { login: "charlespan", bot: false, userId: CHARLES.userId };

/** A check as the overview lists one. */
function check(name: string, state: (typeof CHECK_STATE)[keyof typeof CHECK_STATE]) {
  return {
    name,
    app: "GitHub Actions",
    state,
    url: `https://github.com/acme/relay/runs/${name}`,
    startedAt: 1_000,
    completedAt: state === CHECK_STATE.PENDING ? null : 66_000,
  };
}

/** An upload in the description, as GitHub's rendering names it. */
const UPLOAD = "https://github.com/user-attachments/assets/4f2c1a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b";

/** A bot's themed badge, its light image as GitHub's image proxy serves it. */
const BADGE = "https://camo.githubusercontent.com/abc123/6c69676874";

/** A screenshot on a branch of the agent's own repository. */
const SCREENSHOT = "https://raw.githubusercontent.com/acme/relay/pr-assets/pr-42/overview.png";

/** The image the service reads for it, a transparent pixel. */
const PIXEL = { contentType: "image/png", base64: "iVBORw0KGgo=" } as const;

/** The pull request itself, as its overview's first read answers it. */
const PULL_REQUEST: CodingAgentOverviewPullRequest = {
  number: 42,
  title: "Expire invitations",
  url: PAGE,
  state: PULL_REQUEST_STATE.OPEN,
  html: [
    '<div class="markdown-heading" dir="auto"><h2 class="heading-element">Summary</h2>',
    '<a id="user-content-summary" class="anchor" aria-label="Permalink: Summary" href="#summary"><svg></svg></a></div>',
    '<p dir="auto">Expires invitations after <strong>seven days</strong>, as ',
    '<a class="user-mention notranslate" href="https://github.com/charlespan">@charlespan</a> asked.</p>',
    '<div class="highlight highlight-source-ts notranslate position-relative overflow-auto" dir="auto">',
    '<pre><span class="pl-k">const</span> days = 7;\n\nexport default days;</pre></div>',
    '<ul class="contains-task-list"><li class="task-list-item">',
    '<input type="checkbox" class="task-list-item-checkbox" disabled="" checked=""> Sweep</li></ul>',
    `<p dir="auto"><a target="_blank" href="${UPLOAD}"><img src="${UPLOAD}" alt="before and after"></a></p>`,
    '<p dir="auto"><img src="https://tracker.example.com/pixel.png" alt="pixel"></p>',
    '<p dir="auto"><a href="https://review.example.com"><picture>',
    '<source media="(prefers-color-scheme: dark)" srcset="https://camo.githubusercontent.com/abc123/6461726b">',
    `<img src="${BADGE}" alt="Request review"></picture></a></p>`,
    `<p dir="auto"><a href="${SCREENSHOT}"><img src="${SCREENSHOT}" alt="Overview"></a></p>`,
    '<p dir="auto">Run <code class="notranslate">pnpm test</code> first.</p>',
    "<script>window.stolen = true;</script>",
  ].join(""),
  base: "main",
  head: "luke/expiry-job",
  createdAt: 1_000,
  mergedAt: null,
  merge: MERGE_STATE.CONFLICTS,
  author: { login: "luke-agent[bot]", bot: true },
  requested: [],
};

/** Its checks, as the overview's second read answers them. */
const CHECKS: CodingAgentOverviewChecks = {
  checks: [
    check("lint", CHECK_STATE.FAILED),
    check("build", CHECK_STATE.PENDING),
    check("test", CHECK_STATE.PASSED),
  ],
};

/** Its conversation, as the overview's third read answers it. */
const CONVERSATION: CodingAgentOverviewConversation = {
  reviewers: [{ by: CHARLES_ON_GITHUB, state: REVIEW_STATE.CHANGES_REQUESTED }],
  conversation: [
    {
      kind: CONVERSATION_ENTRY.REVIEW,
      by: CHARLES_ON_GITHUB,
      state: REVIEW_STATE.CHANGES_REQUESTED,
      html: '<p dir="auto">Rename the flag.</p>',
      body: "",
      at: 2_000,
      url: `${PAGE}#pullrequestreview-1`,
    },
    {
      kind: CONVERSATION_ENTRY.COMMENT,
      by: CHARLES_ON_GITHUB,
      html: null,
      body: "Also, a **plain** note GitHub sent no rendering of",
      at: 3_000,
      url: `${PAGE}#issuecomment-2`,
    },
  ],
  earlier: 0,
};

let root: Root | undefined;
let opened: string[] = [];
/** Every image the tab asked the service for, by its address. */
let images: string[] = [];
/** What each review thread's preview handed the diff bundle, in the order drawn. */
let previews: DiffViewProps[] = [];
/** Every change to the pull request the tab asked for, by agent, in order. */
let changes: (readonly [string, PullRequestActionRequest])[] = [];
/** How the service answers the next change asked for. */
let changeAnswer: PullRequestWriteAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => {
  opened = [];
  images = [];
  previews = [];
  changes = [];
  changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
  // The diff bundle, a script of its own the panel loads, stood in for at its global.
  window.lukeDiffView = {
    mount: (_host, props) => {
      previews.push(props);
      return { update: () => undefined, unmount: () => undefined };
    },
  };
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.GITHUB_OPEN) opened.push(request.payload.url);
        if (request.kind === ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION) {
          changes.push([request.payload.agentId, request.payload.request]);
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: changeAnswer });
        }
        if (request.kind === ACT_KIND.CODING_AGENTS_GITHUB_IMAGE) {
          images.push(request.payload.src);
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: PIXEL });
        }
        return Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: [CHARLES] }
            : { status: ACT_OUTCOME_STATUS.DONE, value: undefined },
        );
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete window.lukeDiffView;
});

/** The pull request as what the agent published names it, which the tab's bar wears. */
function published(state: PullRequestState) {
  return {
    number: PULL_REQUEST.number,
    title: PULL_REQUEST.title,
    url: PAGE,
    state,
    checks: CHECK_SUMMARY.FAILING,
    additions: 4,
    deletions: 1,
    changedFiles: 1,
  };
}

/** The overview's three reads, any of them answering otherwise than the fixtures above. */
interface OverviewReads {
  readonly pullRequest?: CodingAgentsControl["readOverviewPullRequest"];
  readonly checks?: CodingAgentsControl["readOverviewChecks"];
  readonly conversation?: CodingAgentsControl["readOverviewConversation"];
}

/** The plan's agents, the one whose pull request it is among them, its reads answering as given and the fixtures otherwise. */
function controlAnswering(
  reads: OverviewReads = {},
  state: PullRequestState = PULL_REQUEST_STATE.OPEN,
  readChanges: CodingAgentsControl["readChanges"] = () =>
    Promise.resolve({ pullRequest: { url: PAGE, truncated: false, files: [] } }),
): CodingAgentsControl {
  return codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    models: [],
    pullRequests: new Map([[AGENT.id, published(state)]]),
    readOverviewPullRequest:
      reads.pullRequest ?? (() => Promise.resolve({ pullRequest: PULL_REQUEST })),
    readOverviewChecks: reads.checks ?? (() => Promise.resolve({ pullRequest: CHECKS })),
    readOverviewConversation:
      reads.conversation ?? (() => Promise.resolve({ pullRequest: CONVERSATION })),
    readChanges,
  });
}

/** A read held open until the test lets it answer. */
function held<A>() {
  const { promise, resolve } = Promise.withResolvers<A>();
  return { read: () => promise, answer: resolve };
}

/** The tab, holding the view its switch chooses as the side panel does. */
function Switching({
  control,
  first,
}: {
  control: CodingAgentsControl;
  /** The tab it opens on, as the chip that opened it asked. */
  first: PullRequestView;
}) {
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
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Nothing connected, and presses that do nothing, as outside the window. */
const NO_GITHUB: GitHubConnectControl = {
  connection: undefined,
  connect: () => Promise.resolve(false),
  disconnect: () => Promise.resolve(false),
};

/** Draws the agent's tab inside the workspace's member directory and the account's GitHub, its reads landed. */
async function draw(
  control: CodingAgentsControl,
  first: PullRequestView = PULL_REQUEST_VIEW.CONVERSATION,
  github: GitHubConnectControl = NO_GITHUB,
) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(GitHubConnectProvider, {
          value: github,
          children: createElement(MemberDirectory, {
            workspace: { id: "workspace-acme", memberCount: 2 },
            readerId: "user-dana",
            children: createElement(Switching, { control, first }),
          }),
        }),
      ),
    ),
  );
  await settle();
  return container;
}

/** The tab of the row under the header named as given. */
function option(tab: HTMLElement, name: string): HTMLButtonElement {
  return (
    [...tab.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (each) => each.querySelector(".pull-request-tab-label")?.textContent === name,
    ) ?? assert.fail(`the row offers ${name}`)
  );
}

/** The tab named as given chosen, and what it reads landed. */
async function choose(tab: HTMLElement, name: string): Promise<void> {
  act(() => option(tab, name).click());
  await settle();
}

/** What every skeleton on screen says it stands for, those of a hidden tab left out. */
function waiting(tab: HTMLElement): string[] {
  return [...tab.querySelectorAll('[aria-busy="true"]')]
    .filter((each) => each.closest("[hidden]") === null)
    .map((each) => each.querySelector(".visually-hidden")?.textContent ?? "");
}

/** The words of every element the selector names, in order. */
function words(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((each) => each.textContent ?? "");
}

test("the tab draws the pull request as a page: its standing and branches, whether it merges, its checks with failures first, its description, and its conversation in time order", async () => {
  const tab = await draw(controlAnswering());

  assert.equal(tab.querySelector(".pull-request-state")?.textContent, "Open");
  assert.equal(tab.querySelector(".pull-request-branches")?.textContent, "main ← luke/expiry-job");
  assert.equal(tab.querySelector(".pull-request-title")?.textContent, "Expire invitations #42");
  assert.equal(
    tab.querySelector(".pull-request-merge")?.textContent,
    "Conflicts with main",
    "an open pull request says whether it would merge",
  );
  assert.equal(
    tab.querySelector(".pull-request-merge")?.getAttribute("data-merge-tone"),
    "blocked",
  );
  const opener =
    tab.querySelector(".pull-request-people .actor-ref") ?? assert.fail("who opened it is named");
  assert.deepEqual(
    [opener.querySelector(".actor-ref-name")?.textContent, opener.getAttribute("data-kind")],
    ["luke-agent", "github"],
    "Luke's own App's bot opened it, an App's bot on GitHub like any other",
  );

  const description =
    tab.querySelector('[aria-label="Description"]') ?? assert.fail("the description stands");
  assert.equal(description.querySelector("h2")?.textContent, "Summary", "GitHub's heading stands");
  assert.equal(
    description.querySelector("a.anchor, [href='#summary']"),
    null,
    "its permalink does not",
  );
  assert.equal(description.querySelector('[data-streamdown="strong"]')?.textContent, "seven days");
  assert.match(
    description.textContent ?? "",
    /@charlespan asked\./u,
    "a mention stands as GitHub drew it",
  );
  assert.equal(description.querySelector(".transcript-code-language")?.textContent, "ts");
  assert.equal(
    description.querySelector(".transcript-code-body")?.textContent,
    "const days = 7;\n\nexport default days;",
    "a highlighted block is the window's own code block in its language, a blank line in it kept",
  );
  assert.ok(description.querySelector('input[type="checkbox"][disabled]'), "a task list stands");
  assert.equal(
    description.querySelectorAll(".transcript-code").length,
    1,
    "inline code stays inline",
  );
  assert.match(description.textContent ?? "", /Run pnpm test first\./u);
  assert.equal(description.querySelector("script"), null, "a script never stands");
  assert.ok(!("stolen" in window), "nor does it run");
  await settle();
  assert.deepEqual(
    images,
    [UPLOAD, BADGE, SCREENSHOT],
    "only an image GitHub serves is asked for, through the service",
  );
  const upload =
    description.querySelector<HTMLImageElement>('img[alt="before and after"]') ??
    assert.fail("the upload is drawn");
  assert.equal(upload.src, `data:${PIXEL.contentType};base64,${PIXEL.base64}`);
  assert.equal(
    description.querySelector('img[alt="pixel"]'),
    null,
    "an image elsewhere is not drawn",
  );
  assert.match(description.textContent ?? "", /pixel/u, "it stands as its link");
  assert.equal(
    description.querySelector("source"),
    null,
    "a themed badge names no address the window would read itself",
  );
  for (const alt of ["Request review", "Overview"]) {
    assert.equal(
      description.querySelector<HTMLImageElement>(`img[alt="${alt}"]`)?.src,
      `data:${PIXEL.contentType};base64,${PIXEL.base64}`,
      `${alt} is drawn from what the service read`,
    );
  }

  const entries = [...tab.querySelectorAll(".pull-request-entry")];
  assert.equal(entries.length, 2);
  assert.match(entries[0]?.textContent ?? "", /Changes requested/u);
  assert.match(entries[0]?.textContent ?? "", /Rename the flag\./u);
  assert.equal(
    entries[1]?.querySelector('[data-streamdown="strong"]')?.textContent,
    "plain",
    "a comment GitHub sent no rendering of stands as its markdown",
  );
  assert.equal(tab.querySelector(".pull-request-earlier"), null, "nothing was left on GitHub");

  await choose(tab, "Checks");
  const checks = tab.querySelector('[aria-label="Checks"]') ?? assert.fail("the checks stand");
  assert.equal(
    checks.querySelector(".pull-request-count")?.textContent,
    "1 failed, 1 running, 1 passed",
  );
  assert.deepEqual(words(tab, ".pull-request-check-name"), ["lint", "build", "test"]);
  assert.deepEqual(words(tab, ".pull-request-check-time"), ["1m 5s", "1m 5s"]);
});

test("the earlier entries a read left on GitHub are counted first, in the heading too, and open the pull request", async () => {
  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: { ...CONVERSATION, earlier: 3 } }),
    }),
  );
  const conversation =
    tab.querySelector('[aria-label="Conversation"]') ?? assert.fail("the conversation stands");
  assert.equal(conversation.querySelector(".pull-request-count")?.textContent, "5");
  const earlier =
    conversation.querySelector<HTMLButtonElement>(".pull-request-earlier") ??
    assert.fail("the earlier entries are counted");
  assert.equal(earlier.textContent, "3 earlier comments on GitHub");
  await act(async () => earlier.click());
  assert.deepEqual(opened, [PAGE]);
});

/** A review thread on lines, open and current unless said otherwise. */
function thread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    path: "src/invite.ts",
    line: 13,
    startLine: 12,
    originalLine: 13,
    originalStartLine: 12,
    side: DIFF_SIDE.RIGHT,
    startSide: DIFF_SIDE.RIGHT,
    diffHunk: [
      "@@ -8,6 +8,7 @@ export function send()",
      " const one = 1;",
      " const two = 2;",
      " const three = 3;",
      " const four = 4;",
      "-  twice();",
      "+  once();",
      "+  done();",
    ].join("\n"),
    resolved: false,
    outdated: false,
    comments: [
      {
        by: CHARLES_ON_GITHUB,
        html: '<p dir="auto">Why <strong>once</strong>?</p>',
        body: "",
        at: 2_000,
        url: `${PAGE}#discussion_r1`,
      },
    ],
    more: 0,
    ...overrides,
  };
}

test("a review that only left line comments draws each thread under it: its file and lines over the lines it is on drawn as Files changed draws a diff, then its comments; a resolved or outdated one folds closed under its label until opened", async () => {
  const review = {
    kind: CONVERSATION_ENTRY.REVIEW,
    by: CHARLES_ON_GITHUB,
    state: REVIEW_STATE.COMMENTED,
    html: null,
    body: "",
    at: 2_500,
    url: `${PAGE}#pullrequestreview-9`,
    threads: [
      thread({ more: 2 }),
      thread({
        path: "src/old.ts",
        line: null,
        startLine: null,
        originalLine: 9,
        originalStartLine: null,
        resolved: true,
        outdated: true,
        comments: [
          {
            by: CHARLES_ON_GITHUB,
            html: '<p dir="auto">Moved away.</p>',
            body: "",
            at: 2_400,
            url: `${PAGE}#discussion_r7`,
          },
        ],
      }),
    ],
  } as const;
  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({ pullRequest: { ...CONVERSATION, conversation: [review] } }),
    }),
  );

  const [open, folded] = [...tab.querySelectorAll<HTMLElement>(".pull-request-thread")];
  assert.ok(open !== undefined && folded !== undefined, "both threads stand under the review");
  assert.equal(
    open.querySelector(".pull-request-thread-head")?.textContent,
    "src/invite.tslines 12–13",
  );
  const [preview] = previews;
  assert.ok(open.querySelector(".pull-request-thread-lines"), "the open thread's lines are drawn");
  assert.deepEqual(
    preview?.patch.split("\n").slice(3),
    [
      "@@ -10,3 +10,4 @@ export function send()",
      " const three = 3;",
      " const four = 4;",
      "-  twice();",
      "+  once();",
      "+  done();",
      "",
    ],
    "the end of the hunk, from three rows above the range to its line, handed to the diff bundle",
  );
  assert.deepEqual(preview?.selected, {
    start: 12,
    side: "additions",
    end: 13,
    endSide: "additions",
  });
  assert.deepEqual(
    [preview?.look.layout, preview?.look.changedWords, preview?.excerpt],
    ["unified", false, true],
    "a preview is an excerpt drawn unified, its lines tinted whole",
  );
  assert.equal(
    open.querySelector('.pull-request-thread-comment [data-streamdown="strong"]')?.textContent,
    "once",
  );
  const more =
    open.querySelector<HTMLButtonElement>(".pull-request-thread-more") ??
    assert.fail("the replies left on GitHub are counted");
  assert.equal(more.textContent, "2 more replies on GitHub");
  await act(async () => more.click());
  assert.deepEqual(opened, [`${PAGE}#discussion_r1`]);

  const head =
    folded.querySelector<HTMLElement>(".pull-request-thread-head") ?? assert.fail("a head");
  assert.deepEqual(words(folded, ".pull-request-thread-label"), ["Resolved", "Outdated"]);
  assert.match(
    head.textContent ?? "",
    /src\/old\.tsline 9/u,
    "an outdated thread names the line it was made on",
  );
  assert.equal(folded.querySelector(".pull-request-thread-comment"), null, "folded closed");
  act(() => head.click());
  await settle();
  assert.match(
    folded.querySelector(".pull-request-thread-comment")?.textContent ?? "",
    /Moved away\./u,
    "a press opens it",
  );
});

test("opened on its files, as the Changes chip opens it, the header stands above them with where each reviewer stands, and switching between the tabs draws each as it was", async () => {
  const approved = { login: "alexr", bot: false };
  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            ...CONVERSATION,
            reviewers: [{ by: approved, state: REVIEW_STATE.APPROVED }],
          },
        }),
    }),
    PULL_REQUEST_VIEW.FILES,
  );
  const shownPanel = () =>
    [...tab.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter((each) => !each.hidden);
  const header = () =>
    tab.querySelector<HTMLElement>(".pull-request-header") ?? assert.fail("the header stands");
  assert.equal(option(tab, "Files changed").getAttribute("aria-selected"), "true");
  assert.equal(shownPanel().length, 1);
  assert.match(shownPanel()[0]?.textContent ?? "", /This pull request changes no files\./u);
  assert.equal(
    header().querySelector(".pull-request-title")?.textContent,
    "Expire invitations #42",
  );
  assert.equal(
    header().querySelectorAll('[aria-label="Reviewers"] > li').length,
    1,
    "a reviewer who approved, and is asked for nothing, stands in the header above the files",
  );

  await choose(tab, "Checks");
  assert.deepEqual(words(shownPanel()[0] ?? tab, ".pull-request-check-name"), [
    "lint",
    "build",
    "test",
  ]);

  await choose(tab, "Conversation");
  assert.deepEqual(waiting(tab), [], "nothing is waited on again");
  assert.equal(shownPanel()[0]?.querySelectorAll(".pull-request-entry").length, 2);
});

test("each tab counts what Luke holds of it: the conversation its comments, reviews, and threads; the checks how they went as published from the first frame, and how many once read; the files the lines published", async () => {
  const tab = await draw(controlAnswering());
  const count = (name: string) => option(tab, name).querySelector(".pull-request-tab-count");
  assert.equal(count("Conversation")?.textContent, "2");
  assert.equal(
    count("Checks")?.querySelector('[role="img"]')?.getAttribute("aria-label"),
    "failing",
    "how the checks went, as published, stands before they are read",
  );
  assert.equal(count("Checks")?.textContent, "", "how many waits on their read");
  assert.equal(count("Files changed")?.textContent, "+4 −1");

  await choose(tab, "Checks");
  assert.equal(count("Checks")?.textContent, "3");
  assert.equal(count("Checks")?.getAttribute("data-check-summary"), CHECK_SUMMARY.FAILING);

  act(() => option(tab, "Checks").focus());
  act(() => {
    option(tab, "Checks").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  await settle();
  assert.equal(
    option(tab, "Files changed").getAttribute("aria-selected"),
    "true",
    "the arrows move along the row",
  );
});

test("a merged pull request says so on the bar, as its overview read it, says nothing of merging, and one with no description, checks, or comments says so", async () => {
  const merged: CodingAgentOverviewPullRequest = {
    ...PULL_REQUEST,
    state: PULL_REQUEST_STATE.MERGED,
    mergedAt: 9_000,
    html: "",
  };
  const tab = await draw(
    // Note that what the agent published was last read open, so the bar says what the overview read.
    controlAnswering(
      {
        pullRequest: () => Promise.resolve({ pullRequest: merged }),
        checks: () => Promise.resolve({ pullRequest: { checks: [] } }),
        conversation: () =>
          Promise.resolve({ pullRequest: { reviewers: [], conversation: [], earlier: 0 } }),
      },
      PULL_REQUEST_STATE.OPEN,
    ),
  );
  assert.equal(tab.querySelector(".pull-request-state")?.textContent, "Merged");
  assert.equal(tab.querySelector(".pull-request-merge"), null);
  assert.deepEqual(words(tab, ".pull-request-none"), [
    "No description provided.",
    "Nobody has commented yet.",
  ]);
  await choose(tab, "Checks");
  assert.deepEqual(words(tab, ".pull-request-none"), [
    "No description provided.",
    "Nobody has commented yet.",
    "No checks have run on this pull request.",
  ]);
});

test("where what the agent published is not read, the bar still says where the pull request stands and opens it on GitHub, as its overview read it", async () => {
  const control = {
    ...controlAnswering(),
    pullRequests: new Map(),
  };
  const tab = await draw(control);
  assert.equal(tab.querySelector(".pull-request-state")?.textContent, "Open");
  const github =
    tab.querySelector<HTMLButtonElement>('.pull-request-bar [aria-label="Open on GitHub"]') ??
    assert.fail("the bar opens the pull request on GitHub");
  act(() => github.click());
  await settle();
  assert.deepEqual(opened, [PAGE]);
});

test("an agent with no pull request yet says so", async () => {
  const none = await draw(
    controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: null }),
      checks: () => Promise.resolve({ pullRequest: null }),
      conversation: () => Promise.resolve({ pullRequest: null }),
    }),
  );
  assert.match(none.textContent ?? "", /No pull request yet\./u);
  assert.equal(none.querySelector(".pull-request-page"), null);
});

test("the bar, the title, and the files' count stand from what Luke holds before any read lands; each part is a skeleton until its own read lands, and is drawn the moment it does, whatever the order", async () => {
  const pullRequest = held<{ pullRequest: CodingAgentOverviewPullRequest }>();
  const checks = held<{ pullRequest: CodingAgentOverviewChecks }>();
  const conversation = held<{ pullRequest: CodingAgentOverviewConversation }>();
  const tab = await draw(
    controlAnswering({
      pullRequest: pullRequest.read,
      checks: checks.read,
      conversation: conversation.read,
    }),
  );
  const section = (title: string) =>
    tab.querySelector<HTMLElement>(`[aria-label="${title}"]`) ??
    assert.fail(`the ${title} section stands`);

  assert.equal(tab.querySelector(".pull-request-state")?.textContent, "Open");
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations #42",
    "the title is what Luke held of the pull request",
  );
  assert.equal(
    option(tab, "Files changed").querySelector(".pull-request-tab-count")?.textContent,
    "+4 −1",
  );
  assert.deepEqual(waiting(tab), [
    "Reading pull request",
    "Reading description",
    "Reading conversation",
  ]);

  conversation.answer({ pullRequest: CONVERSATION });
  await settle();
  assert.equal(section("Conversation").querySelectorAll(".pull-request-entry").length, 2);
  assert.deepEqual(waiting(tab), ["Reading pull request", "Reading description"]);

  pullRequest.answer({ pullRequest: { ...PULL_REQUEST, title: "Expire invitations weekly" } });
  await settle();
  assert.deepEqual(waiting(tab), []);
  assert.equal(tab.querySelector(".pull-request-branches")?.textContent, "main ← luke/expiry-job");
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations weekly #42",
    "the read's title replaces what was held",
  );
  assert.equal(section("Description").querySelector("h2")?.textContent, "Summary");

  await choose(tab, "Checks");
  assert.deepEqual(waiting(tab), ["Reading checks"]);
  checks.answer({ pullRequest: CHECKS });
  await settle();
  assert.deepEqual(waiting(tab), []);
  assert.deepEqual(words(section("Checks"), ".pull-request-check-name"), ["lint", "build", "test"]);
});

/** A read answering each ask with the next of the answers given, the last again once they run out. */
function inTurn<A>(...answers: readonly A[]): () => Promise<A> {
  let ask = 0;
  return () => {
    const answer = answers[Math.min(ask, answers.length - 1)] ?? assert.fail("an answer is given");
    ask += 1;
    return Promise.resolve(answer);
  };
}

test("a part whose read failed says so with a Retry that reads it alone, the others standing; Refresh reads again the header's reads and the checks once shown", async () => {
  const failure = { failure: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED } as const;
  const later = (name: string) => ({ checks: [check(name, CHECK_STATE.PASSED)] });
  const tab = await draw(
    controlAnswering({
      pullRequest: inTurn<CodingAgentOverviewPullRequestAnswerView>(
        { pullRequest: PULL_REQUEST },
        { pullRequest: { ...PULL_REQUEST, title: "Expire invitations weekly" } },
      ),
      checks: inTurn<CodingAgentOverviewChecksAnswerView>(
        failure,
        { pullRequest: later("retried") },
        { pullRequest: later("refreshed") },
      ),
      conversation: inTurn<CodingAgentOverviewConversationAnswerView>(
        { pullRequest: CONVERSATION },
        { pullRequest: { ...CONVERSATION, conversation: CONVERSATION.conversation.slice(0, 1) } },
      ),
    }),
  );
  await choose(tab, "Checks");
  const checks =
    tab.querySelector('[aria-label="Checks"]') ?? assert.fail("the checks section stands");
  assert.match(checks.textContent ?? "", /The checks could not be read\./u);
  assert.equal(tab.querySelector(".pull-request-branches")?.textContent, "main ← luke/expiry-job");
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 2, "the conversation stands");

  const retry =
    [...checks.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
    assert.fail("the failed section offers a retry");
  act(() => retry.click());
  await settle();
  assert.deepEqual(words(tab, ".pull-request-check-name"), ["retried"]);
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations #42",
    "the pull request is not read again",
  );
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 2, "nor is the conversation");

  const more =
    tab.querySelector<HTMLButtonElement>('[aria-label="Pull request actions"]') ??
    assert.fail("the bar has a ⋯");
  act(() => more.click());
  const refresh =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Refresh pull request",
    ) ?? assert.fail("the ⋯ offers Refresh");
  await act(async () => refresh.click());
  await settle();
  assert.deepEqual(words(tab, ".pull-request-check-name"), ["refreshed"]);
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations weekly #42",
  );
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 1);
});

test("where nothing of the pull request is held and its reads fail, each part says so with its own Retry, and Files changed still reads on its own", async () => {
  const failure = { failure: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED } as const;
  const control = {
    ...controlAnswering({
      pullRequest: inTurn<CodingAgentOverviewPullRequestAnswerView>(failure, {
        pullRequest: PULL_REQUEST,
      }),
      conversation: inTurn<CodingAgentOverviewConversationAnswerView>(failure, {
        pullRequest: CONVERSATION,
      }),
    }),
    pullRequests: new Map(),
  };
  const tab = await draw(control);
  const retry = (within: Element) =>
    [...within.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Retry",
    ) ?? assert.fail("the part offers a retry");
  const header =
    tab.querySelector(".pull-request-header") ?? assert.fail("the header stands, failed");
  assert.match(header.textContent ?? "", /The pull request could not be read\./u);
  const conversation =
    tab.querySelector('[aria-label="Conversation"]') ?? assert.fail("the conversation stands");
  assert.match(conversation.textContent ?? "", /The conversation could not be read\./u);

  await choose(tab, "Files changed");
  assert.match(
    tab.textContent ?? "",
    /This pull request changes no files\./u,
    "the files read on their own",
  );

  await act(async () => retry(header).click());
  await settle();
  assert.equal(tab.querySelector(".pull-request-title")?.textContent, "Expire invitations #42");
  await choose(tab, "Conversation");
  await act(async () => retry(conversation).click());
  await settle();
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 2);
});

test("the bar wears what was published of the checks only for the pull request they were read on, never a newer one whose checks failed to read", async () => {
  const control = {
    ...controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, number: 43 } }),
      checks: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED }),
    }),
  };
  const tab = await draw(control);
  const mark = tab.querySelector(".pull-request-state [aria-label]") ?? assert.fail("a mark");
  assert.match(mark.getAttribute("aria-label") ?? "", /43/u);
  assert.doesNotMatch(
    mark.getAttribute("aria-label") ?? "",
    /checks failing/u,
    "#42's failing checks are not #43's",
  );
});

/** The bar's pill, as a press. */
function pill(tab: HTMLElement): HTMLButtonElement {
  return (
    tab.querySelector<HTMLButtonElement>("button.pull-request-state") ??
    assert.fail("the pill is a press that opens what may be done")
  );
}

/** Opens the pill's menu and presses its item of the words given. */
async function pressAction(tab: HTMLElement, label: string): Promise<void> {
  act(() => pill(tab).click());
  const item =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`the pill's menu offers ${label}`);
  act(() => item.click());
  await settle();
}

/** The labels the pill's menu offers, opened and closed again. */
function offered(tab: HTMLElement): string[] {
  act(() => pill(tab).click());
  const labels = words(document.body, '[role="menuitem"]');
  act(() => pill(tab).click());
  return labels;
}

test("a draft's pill offers Ready for review, which is asked of the service for the agent, and the tab reads the pull request again, its pill then saying it is open and offering Convert to draft", async () => {
  let reads = 0;
  const tab = await draw(
    controlAnswering(
      {
        pullRequest: () => {
          reads += 1;
          return Promise.resolve({
            pullRequest: {
              ...PULL_REQUEST,
              state: reads === 1 ? PULL_REQUEST_STATE.DRAFT : PULL_REQUEST_STATE.OPEN,
            },
          });
        },
      },
      PULL_REQUEST_STATE.DRAFT,
    ),
  );
  assert.equal(pill(tab).textContent, "Draft");
  assert.deepEqual(offered(tab), ["Ready for review"]);

  await pressAction(tab, "Ready for review");

  assert.deepEqual(changes, [[AGENT.id, { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW }]]);
  assert.equal(reads, 2, "the pull request is read again once GitHub took the change");
  assert.equal(pill(tab).textContent, "Open");
  assert.deepEqual(offered(tab), ["Convert to draft"]);
  assert.equal(tab.querySelector(".pull-request-write-note"), null);
});

test("a member GitHub would not take as signed in is offered to sign in with GitHub again, and a merged pull request's pill offers nothing", async () => {
  let connects = 0;
  changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED };
  const tab = await draw(controlAnswering(), PULL_REQUEST_VIEW.CONVERSATION, {
    ...NO_GITHUB,
    connect: () => {
      connects += 1;
      return Promise.resolve(true);
    },
  });

  await pressAction(tab, "Convert to draft");

  const note =
    tab.querySelector<HTMLElement>(".pull-request-write-note") ??
    assert.fail("the tab says why the change was not made");
  assert.match(note.textContent ?? "", /Sign in with GitHub to make this change as you\./u);
  const signIn =
    [...note.querySelectorAll("button")].find(
      (button) => button.textContent === "Sign in with GitHub",
    ) ?? assert.fail("the line offers to sign in with GitHub");
  act(() => signIn.click());
  assert.equal(connects, 1);
  act(() => root?.unmount());
  root = undefined;

  const merged = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({ pullRequest: { ...PULL_REQUEST, state: PULL_REQUEST_STATE.MERGED } }),
    }),
  );
  assert.equal(merged.querySelector("button.pull-request-state"), null);
  assert.equal(merged.querySelector(".pull-request-state")?.textContent, "Merged");
});

test("a change GitHub refused says so in GitHub's own words until dismissed, and the pull request is read again in case it moved", async () => {
  let reads = 0;
  changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request is in the merge queue.",
  };
  const tab = await draw(
    controlAnswering({
      pullRequest: () => {
        reads += 1;
        return Promise.resolve({ pullRequest: PULL_REQUEST });
      },
    }),
  );

  await pressAction(tab, "Convert to draft");

  const note =
    tab.querySelector<HTMLElement>(".pull-request-write-note") ??
    assert.fail("the tab says GitHub refused");
  assert.equal(
    note.querySelector(".failure-note-words")?.textContent,
    "GitHub said: Pull request is in the merge queue.",
  );
  assert.equal(reads, 2);
  const dismiss =
    note.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]') ??
    assert.fail("the line may be dismissed");
  act(() => dismiss.click());
  assert.equal(tab.querySelector(".pull-request-write-note"), null);
});
