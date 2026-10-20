// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentOverviewChecksAnswerView,
  type CodingAgentOverviewConversationAnswerView,
  type CodingAgentOverviewPullRequestAnswerView,
  type CodingAgentPullRequestAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CHANGED_FILE_STATUS,
  CHECK_STATE,
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  CONVERSATION_ENTRY,
  type CodingAgentOverviewChecks,
  type CodingAgentOverviewConversation,
  type CodingAgentOverviewPullRequest,
  type CodingAgentSummary,
  DEPLOYMENT_STATE,
  DIFF_SIDE,
  type GitHubPerson,
  MERGE_STATE,
  type MergeState,
  type PendingReviewComment,
  PULL_REQUEST_STATE,
  type PullRequestMerging,
  type PullRequestState,
  REVIEW_DECISION,
  REVIEW_STATE,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE, PULL_REQUEST_THREAD_VIEW, type ReadLink } from "@luke/features/luke-link";
import {
  FILE_VIEWED_STATE,
  MERGE_METHOD,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
  type PullRequestWriteAnswer,
  REACTION,
  REVIEW_COMMENT_MODE,
  REVIEW_EVENT,
} from "@luke/features/pull-request-write-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import type { SideBundles } from "../bundle-loader.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import {
  DIFF_SELECTION_SIDE,
  type DiffListProps,
  type DiffListSelection,
  type DiffViewModule,
  type DiffViewProps,
} from "../diff-view/contract.js";
import type { FileTreeModule } from "../file-tree/contract.js";
import { type GitHubConnectControl, GitHubConnectProvider } from "../github-connect.js";
import { MemberDirectory } from "../member-directory.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { copyingInto, DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { AgentPullRequestTab } from "./agent-pull-request-tab.js";
import { TAB_KIND, tabLook } from "./tab-look.js";
import { type ThreadReveal, ThreadRevealProvider } from "./thread-reveal.js";
import { type PullRequestReader, useTaskPullRequests } from "./use-agent-pull-request.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { OpenLinkProvider } from "./use-open-link.js";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./use-side-panel.js";

/**
 * agent-pull-request-tab.test.ts -- an agent's Pull request tab draws its
 * pull request as a page: where it stands beside its title, its branches,
 * whether it would merge, its checks with what failed first, its
 * description as markdown, and its comments and reviews in time order, a
 * long one sending the reader to GitHub for the rest; it opens the agent's
 * Changes from its bar, says so where there is no pull request yet, and
 * offers a retry where a read failed. The overview is three reads, the pull
 * request itself, its checks, and its conversation, each drawn as it lands,
 * a skeleton until then, under the pill and title Luke already held.
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

/** The diff bundle, a chunk of its own the panel imports, stood in for at its importer. */
const DIFF_STAND_IN: DiffViewModule = {
  colourLines: () => Promise.resolve(undefined),
  mount: (_host, props) => {
    previews.push(props);
    return { update: () => undefined, unmount: () => undefined };
  },
  mountList: (_host, props) => {
    lists.push(props);
    return {
      update: (next) => lists.push(next),
      reveal: (path) => listReveals.push(path),
      revealLine: (path, side, line) => listReveals.push(`${path}:${side}:${line}`),
      unmount: () => undefined,
    };
  },
};

/** The file tree's bundle, stood in for: it draws nothing, so its search field, the panel's own, is what narrows the files. */
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
/** Every change to the pull request the tab asked for, by agent, in order. */
let changes: (readonly [string, PullRequestActionRequest])[] = [];
/** How the service answers the next change asked for. */
let changeAnswer: PullRequestWriteAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
/** What the service waits on before it answers a change, where a test holds it; none answers at once. */
let changeHeld: Promise<void> | undefined;
/** The number of the pull request each change named, none where it was the agent's own. */
let changeNumbers: (number | undefined)[] = [];

/** What Files changed handed the diff bundle's list, mount first, each draw after it. */
let lists: DiffListProps[] = [];
/** The files, or the lines of them, the list was scrolled to, in order. */
let listReveals: string[] = [];

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => {
  window.localStorage.clear();
  opened = [];
  images = [];
  previews = [];
  changes = [];
  changeNumbers = [];
  changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
  lists = [];
  listReveals = [];
  changeHeld = undefined;
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({
    act: (request: Act) => {
      if (request.kind === ACT_KIND.GITHUB_OPEN) opened.push(request.payload.url);
      if (request.kind === ACT_KIND.WEB_OPEN) opened.push(request.payload.url);
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
    },
  });
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([CHARLES]),
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION]: (payload) => {
      changes.push([payload.agentId, payload.request]);
      changeNumbers.push(payload.number);
      const answer = changeAnswer;
      return (changeHeld ?? Promise.resolve()).then(() => answer);
    },
    [ACT_KIND.CODING_AGENTS_GITHUB_IMAGE]: ({ src }) => {
      images.push(src);
      return Promise.resolve(PIXEL);
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The pull request as what the agent published names it, which the tab's pill wears. */
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
  readonly reviewOptions?: CodingAgentsControl["readReviewOptions"];
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
    ...(reads.reviewOptions === undefined ? undefined : { readReviewOptions: reads.reviewOptions }),
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

/**
 * The tab beside the name the side panel's strip gives it (`tabLook`), both
 * drawn from what the task's real reads of the agent's published pull
 * request keep (`useTaskPullRequests`), as the window draws them.
 */
function Named({ control, reader }: { control: CodingAgentsControl; reader: PullRequestReader }) {
  const kept = useTaskPullRequests(AGENT.planId ?? undefined, control.agents, reader);
  const pullRequest = kept.pullRequests.get(AGENT.id);
  return createElement(
    "div",
    null,
    createElement(
      "span",
      { "data-tab-name": "" },
      tabLook({ kind: TAB_KIND.CHANGES, pullRequest }).label,
    ),
    createElement(Switching, {
      control: { ...control, pullRequests: kept.pullRequests, readPullRequest: kept.read },
      first: PULL_REQUEST_VIEW.CONVERSATION,
    }),
  );
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

/** A registry whose atoms count on this clock, as the window's count on its own. */
function registryOn(clock: Clock.Clock): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({
    initialValues: [[rendererRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))]],
  });
}

/** Draws the agent's tab inside the workspace's member directory and the account's GitHub, its reads landed; inside the window's opener for a place in Luke where one is given. */
async function draw(
  control: CodingAgentsControl,
  first: PullRequestView = PULL_REQUEST_VIEW.CONVERSATION,
  registry = AtomRegistry.make(),
  github: GitHubConnectControl = NO_GITHUB,
  openPlace?: (link: ReadLink) => void,
) {
  return drawn(createElement(Switching, { control, first }), registry, github, openPlace);
}

/** Draws `tab` inside the workspace's member directory and the account's GitHub, its reads landed; inside the window's opener for a place in Luke where one is given. */
async function drawn(
  tab: React.ReactElement,
  registry = AtomRegistry.make(),
  github: GitHubConnectControl = NO_GITHUB,
  openPlace?: (link: ReadLink) => void,
) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        registry,
        onSideBundles(
          bundles,
          createElement(GitHubConnectProvider, {
            value: github,
            children: createElement(MemberDirectory, {
              workspace: { id: "workspace-acme", memberCount: 2 },
              readerId: "user-dana",
              children:
                openPlace === undefined
                  ? tab
                  : createElement(OpenLinkProvider, { value: openPlace, children: tab }),
            }),
          }),
        ),
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
      (each) => each.textContent?.startsWith(name) === true,
    ) ?? assert.fail(`the row offers ${name}`)
  );
}

/** What the tab named as given counts beside its name, its words after the name. */
function tabCount(tab: HTMLElement, name: string): string {
  return (option(tab, name).textContent ?? "").slice(name.length);
}

/** How the Checks tab's glyph says its checks went, in its words. */
function checksGlyph(tab: HTMLElement): string | null | undefined {
  return option(tab, "Checks").querySelector('[role="img"]')?.getAttribute("aria-label");
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
    .map((each) => each.textContent ?? "");
}

/** What the header says of where the pull request stands: its title row's first control's words. */
function standing(tab: HTMLElement): string | undefined {
  return tab.querySelector(".pull-request-title-row")?.firstElementChild?.textContent ?? undefined;
}

/** The merge control at the title row's end, where one stands. */
function mergeControl(tab: HTMLElement): HTMLButtonElement | null {
  return tab.querySelector<HTMLButtonElement>(".pull-request-title-row .merge-control > button");
}

/** The header's ⋯, opened, and its items' words. */
function openHeaderMenu(tab: HTMLElement): HTMLButtonElement[] {
  act(() =>
    (
      tab.querySelector<HTMLButtonElement>(
        '.pull-request-title-row [aria-label="Pull request actions"]',
      ) ?? assert.fail("the title row has a ⋯")
    ).click(),
  );
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

/** The words of every element the selector names, in order. */
function words(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((each) => each.textContent ?? "");
}

/** The button whose words match, where one stands. */
function buttonWith(container: HTMLElement, label: RegExp): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((each) =>
    label.test(each.textContent ?? ""),
  );
}

/** The labels a thread's head wears beside its path, in order. */
function threadLabels(thread: HTMLElement): string[] {
  const head = thread.querySelector(".pull-request-thread-head")?.textContent ?? "";
  return ["Resolved", "Outdated"].filter((label) => head.includes(label));
}

test("the tab draws the pull request as a page: its standing and branches, whether it merges, its checks with failures first, its description, and its conversation in time order", async () => {
  const tab = await draw(controlAnswering());

  assert.equal(standing(tab), "Open");
  assert.equal(tab.querySelector(".pull-request-branches")?.textContent, "main ← luke/expiry-job");
  assert.equal(tab.querySelector(".pull-request-title")?.textContent, "Expire invitations #42");
  const merge = mergeControl(tab) ?? assert.fail("an open pull request has a merge control");
  assert.equal(merge.getAttribute("aria-label"), "Conflicts");
  assert.equal(
    merge.getAttribute("aria-description"),
    "Conflicts with main",
    "an open pull request says whether it would merge",
  );
  const opener =
    tab.querySelector(".pull-request-people [data-actor-ref]") ??
    assert.fail("who opened it is named");
  assert.deepEqual(
    [opener.querySelector(".luke-inline-ref-label")?.textContent, opener.getAttribute("data-kind")],
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
  assert.equal(
    tab.querySelector(".pull-request-earlier button"),
    null,
    "nothing was left on GitHub",
  );

  await choose(tab, "Checks");
  const checks = tab.querySelector('[aria-label="Checks"]') ?? assert.fail("the checks stand");
  assert.equal(
    checks.querySelector(".pull-request-count")?.textContent,
    "1 failed, 1 running, 1 passed",
  );
  assert.deepEqual(words(tab, "li .luke-list-row-title"), [
    "lint, failed",
    "build, running",
    "test, passed",
  ]);
  assert.deepEqual(
    words(tab, 'li .luke-list-row-meta:not(:has([role="timer"]))'),
    ["1m 5s", "1m 5s"],
    "a finished check says how long it ran",
  );
});

it.effect(
  "a check wears its App's avatar, a status's picture off GitHub's avatar host read through the service; a running one counts each second from when it started, a finished one says how long it ran",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      yield* TestClock.setTime(66_000);
      const checks: CodingAgentOverviewChecks = {
        checks: [
          {
            ...check("build", CHECK_STATE.PENDING),
            avatarUrl: "https://avatars.githubusercontent.com/in/15368?v=4",
          },
          { ...check("vercel", CHECK_STATE.PASSED), app: null, avatarUrl: BADGE },
          check("lint", CHECK_STATE.PASSED),
        ],
      };
      const tab = yield* Effect.promise(() =>
        draw(
          controlAnswering({ checks: () => Promise.resolve({ pullRequest: checks }) }),
          PULL_REQUEST_VIEW.CONVERSATION,
          registry,
        ),
      );
      yield* Effect.promise(() => choose(tab, "Checks"));

      const rows = [...tab.querySelectorAll('[aria-label="Check list"] > li')];
      assert.equal(
        rows[0]?.querySelector("img")?.getAttribute("src"),
        "https://avatars.githubusercontent.com/in/15368?v=4&s=32",
        "an App's logo is drawn from GitHub's avatar host at its size",
      );
      assert.ok(
        images.every((src) => !src.startsWith("https://avatars.githubusercontent.com/")),
        "a picture GitHub's avatar host serves is never asked of the service",
      );
      assert.equal(
        rows[1]?.querySelector("img")?.getAttribute("src"),
        `data:${PIXEL.contentType};base64,${PIXEL.base64}`,
        "any other is drawn as the service read it",
      );
      assert.equal(rows[2]?.querySelector(".lucide-bot"), null, "no avatar, none drawn");
      assert.deepEqual(words(tab, '[role="timer"]'), ["1m 5s"]);

      yield* TestClock.adjust("1 second");
      yield* Effect.promise(settle);
      assert.deepEqual(words(tab, '[role="timer"]'), ["1m 6s"], "the running one counts on");
      assert.deepEqual(words(tab, 'li .luke-list-row-meta:not(:has([role="timer"]))'), [
        "1m 5s",
        "1m 5s",
      ]);

      yield* Effect.promise(() => choose(tab, "Conversation"));
      assert.deepEqual(
        words(tab, '[role="timer"]'),
        [],
        "a count behind a hidden tab reads no clock",
      );
      yield* TestClock.adjust("1 second");
      yield* Effect.promise(() => choose(tab, "Checks"));
      assert.deepEqual(
        words(tab, '[role="timer"]'),
        ["1m 7s"],
        "shown again, it counts from the clock",
      );
      act(() => root?.unmount());
      root = undefined;
      registry.dispose();
    }),
);

test("a picture GitHub linked to itself opens over the window rather than in the browser: Enlarge walks that entry's pictures from the one pressed, drawn from what was read, and Open on GitHub opens the one shown; a badge keeps its link", async () => {
  const tab = await draw(controlAnswering());
  await settle();
  const description =
    tab.querySelector('[aria-label="Description"]') ?? assert.fail("the description stands");
  assert.equal(
    description.querySelector('img[alt="before and after"]')?.closest("a"),
    null,
    "GitHub's link to the picture itself is gone",
  );
  assert.ok(
    description.querySelector('a[href^="https://review.example.com"] img[alt="Request review"]'),
    "a badge linked elsewhere keeps its link",
  );
  assert.equal(description.querySelector('[aria-label="Enlarge Request review"]'), null);

  const enlarge =
    description.querySelector<HTMLButtonElement>('[aria-label="Enlarge before and after"]') ??
    assert.fail("the upload has Enlarge");
  act(() => enlarge.click());
  const viewer = () =>
    document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("the viewer stands");
  const shown = () => [
    viewer().querySelector(".attachment-viewer-title")?.textContent,
    viewer().querySelector(".attachment-viewer-place")?.textContent,
  ];
  assert.deepEqual(shown(), ["before and after.png", "1 of 2"]);
  assert.equal(
    viewer().querySelector("img")?.getAttribute("src"),
    `data:${PIXEL.contentType};base64,${PIXEL.base64}`,
  );
  act(() => viewer().querySelector<HTMLButtonElement>('[aria-label="Next file"]')?.click());
  assert.deepEqual(shown(), ["Overview.png", "2 of 2"]);
  const onGitHub =
    [...viewer().querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Open on GitHub",
    ) ?? assert.fail("the viewer offers Open on GitHub");
  act(() => onGitHub.click());
  await settle();
  assert.deepEqual(opened, [SCREENSHOT]);
});

test("in the viewer, Open on GitHub opens the upload GitHub linked a picture to, which lasts, rather than the address it is drawn from; a picture that shares its link with words keeps the link and stays out of the walk", async () => {
  const drawnFrom = "https://user-images.githubusercontent.com/1/signed-preview.png";
  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            html: [
              `<p dir="auto"><a target="_blank" href="${UPLOAD}"><img src="${drawnFrom}" alt="upload"></a></p>`,
              `<p dir="auto"><a href="${SCREENSHOT}"><img src="${SCREENSHOT}" alt="Overview"> the original</a></p>`,
            ].join(""),
          },
        }),
    }),
  );
  await settle();
  const description =
    tab.querySelector('[aria-label="Description"]') ?? assert.fail("the description stands");
  assert.equal(description.querySelector('[aria-label="Enlarge Overview"]'), null);
  act(() =>
    (
      description.querySelector<HTMLButtonElement>('[aria-label="Enlarge upload"]') ??
      assert.fail("the upload has Enlarge")
    ).click(),
  );
  const viewer =
    document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("the viewer stands");
  assert.equal(viewer.querySelector(".attachment-viewer-place"), null, "it walks the upload alone");
  act(() =>
    (
      [...viewer.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Open on GitHub",
      ) ?? assert.fail("the viewer offers Open on GitHub")
    ).click(),
  );
  await settle();
  assert.deepEqual(opened, [UPLOAD]);
});

test("the Checks tab lists the head's deployments over its checks: each environment, where it stands, and a press opening the address it serves; a head with none lists no deployments", async () => {
  const deployed: CodingAgentOverviewChecks = {
    ...CHECKS,
    deployments: [
      {
        environment: "Preview – luke-web",
        state: DEPLOYMENT_STATE.READY,
        url: "https://luke-web-git-expiry.vercel.app",
        avatarUrl: "https://avatars.githubusercontent.com/in/8329?v=4",
      },
      { environment: "staging", state: DEPLOYMENT_STATE.FAILED, url: null },
    ],
  };
  const tab = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: deployed }) }),
  );
  await choose(tab, "Checks");
  const headings = [...tab.querySelectorAll(".pull-request-heading")]
    .filter((each) => each.closest("[hidden]") === null)
    .map((each) => each.firstChild?.textContent);
  assert.deepEqual(headings, ["Deployments", "Checks"], "the deployments stand over the checks");
  const deployments =
    tab.querySelector<HTMLElement>('[aria-label="Deployments"]') ??
    assert.fail("the deployments stand");
  assert.equal(deployments.querySelector(".pull-request-count")?.textContent, "2");
  assert.deepEqual(words(deployments, "li .luke-list-row-title"), [
    "Preview – luke-web",
    "staging",
  ]);
  assert.deepEqual(words(deployments, "li .luke-list-row-description"), ["Deployed", "Failed"]);
  assert.equal(
    deployments.querySelector("img")?.getAttribute("src"),
    "https://avatars.githubusercontent.com/in/8329?v=4&s=32",
  );
  const buttons = deployments.querySelectorAll<HTMLButtonElement>("li > button");
  assert.equal(buttons.length, 1, "a deployment naming no address opens nothing");
  act(() => buttons[0]?.click());
  await settle();
  assert.deepEqual(opened, ["https://luke-web-git-expiry.vercel.app"]);

  act(() => root?.unmount());
  const none = await draw(controlAnswering());
  await choose(none, "Checks");
  assert.equal(none.querySelector('[aria-label="Deployments"]'), null);
});

test("past five checks the list folds behind Show all, keeping every one that failed or still runs above the fold, and folds again on Show less", async () => {
  const passing = Array.from({ length: 6 }, (_, at) => check(`test ${at}`, CHECK_STATE.PASSED));
  const few: CodingAgentOverviewChecks = {
    checks: [check("lint", CHECK_STATE.FAILED), check("build", CHECK_STATE.PENDING), ...passing],
  };
  const tab = await draw(controlAnswering({ checks: () => Promise.resolve({ pullRequest: few }) }));
  await choose(tab, "Checks");
  const fold = () => buttonWith(tab, /^Show (all \d+|less)$/u) ?? assert.fail("the list folds");
  assert.deepEqual(words(tab, "li .luke-list-row-title"), [
    "lint, failed",
    "build, running",
    "test 0, passed",
    "test 1, passed",
    "test 2, passed",
  ]);
  assert.equal(fold().textContent, "Show all 8");
  assert.equal(fold().getAttribute("aria-expanded"), "false");

  act(() => fold().click());
  assert.equal(words(tab, "li .luke-list-row-title").length, 8);
  assert.equal(fold().textContent, "Show less");
  assert.equal(fold().getAttribute("aria-expanded"), "true");

  act(() => fold().click());
  assert.equal(words(tab, "li .luke-list-row-title").length, 5);
});

test("a check that failed or still runs never folds away, however many there are, and five or fewer checks do not fold", async () => {
  const failing = Array.from({ length: 6 }, (_, at) => check(`lint ${at}`, CHECK_STATE.FAILED));
  const many: CodingAgentOverviewChecks = {
    checks: [...failing, check("build", CHECK_STATE.PENDING), check("test", CHECK_STATE.PASSED)],
  };
  const tab = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: many }) }),
  );
  await choose(tab, "Checks");
  assert.equal(words(tab, "li .luke-list-row-title").length, 7);
  assert.equal(buttonWith(tab, /^Show all/u)?.textContent, "Show all 8");

  act(() => root?.unmount());
  const five = await draw(controlAnswering());
  await choose(five, "Checks");
  assert.equal(buttonWith(five, /^Show all/u), undefined);
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
    conversation.querySelector<HTMLButtonElement>(".pull-request-earlier button") ??
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
    [preview?.look.layout, preview?.look.inlineDiff, preview?.excerpt],
    ["unified", "none", true],
    "a preview is an excerpt drawn unified, its lines tinted whole",
  );
  assert.equal(
    open.querySelector('.pull-request-thread-comment [data-streamdown="strong"]')?.textContent,
    "once",
  );
  const more =
    open.querySelector<HTMLButtonElement>(".pull-request-thread-more button") ??
    assert.fail("the replies left on GitHub are counted");
  assert.equal(more.textContent, "2 more replies on GitHub");
  await act(async () => more.click());
  assert.deepEqual(opened, [`${PAGE}#discussion_r1`]);

  const head =
    folded.querySelector<HTMLElement>(".pull-request-thread-head") ?? assert.fail("a head");
  assert.deepEqual(threadLabels(folded), ["Resolved", "Outdated"]);
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

/** A reaction's pill in a row of them, a press or a count, named by who reacted. */
const REACTION_PILL = '[aria-label*=" reacted with "]';

test("the description, a comment, a review, and a thread comment wear their reactions under their words, each its emoji and count, the reader's own lit only where the read named them among who gave it", async () => {
  const dana = { login: "danak", bot: false, userId: "user-dana" };
  const review = {
    kind: CONVERSATION_ENTRY.REVIEW,
    by: CHARLES_ON_GITHUB,
    state: REVIEW_STATE.APPROVED,
    html: '<p dir="auto">Good.</p>',
    body: "",
    at: 2_500,
    url: `${PAGE}#pullrequestreview-9`,
    reactions: [{ content: REACTION.HOORAY, count: 1, by: [CHARLES_ON_GITHUB] }],
    threads: [
      thread({
        comments: [
          {
            by: CHARLES_ON_GITHUB,
            html: '<p dir="auto">Why?</p>',
            body: "",
            at: 2_000,
            url: `${PAGE}#discussion_r1`,
            reactions: [{ content: REACTION.THUMBS_DOWN, count: 3 }],
          },
        ],
      }),
    ],
  } as const;
  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            ...CONVERSATION,
            descriptionReactions: [
              { content: REACTION.THUMBS_UP, count: 12, by: [CHARLES_ON_GITHUB, dana] },
              { content: REACTION.ROCKET, count: 1, by: [CHARLES_ON_GITHUB] },
            ],
            conversation: [
              review,
              {
                kind: CONVERSATION_ENTRY.COMMENT,
                by: CHARLES_ON_GITHUB,
                html: '<p dir="auto">Thanks.</p>',
                body: "",
                at: 3_000,
                url: `${PAGE}#issuecomment-2`,
                reactions: [{ content: REACTION.EYES, count: 2, by: [dana, CHARLES_ON_GITHUB] }],
              },
            ],
          },
        }),
    }),
  );
  /** Each pill under the element given: what it says to a reader, and whether it is lit as the reader's. */
  const pills = (under: Element | null) =>
    [...(under?.querySelectorAll(REACTION_PILL) ?? [])].map((pill) => [
      pill.textContent,
      pill.getAttribute("aria-label"),
      pill.getAttribute("aria-pressed") ?? pill.getAttribute("data-mine"),
    ]);
  assert.deepEqual(pills(tab.querySelector('[aria-label="Description"]')), [
    ["👍12", "Charles Pan, you, and 10 more reacted with thumbs up", "true"],
    ["🚀1", "Charles Pan reacted with rocket", "false"],
  ]);
  const [reviewed, commented] = [...tab.querySelectorAll(".pull-request-entry")];
  assert.deepEqual(pills(reviewed?.querySelector(":scope > .pull-request-reactions") ?? null), [
    ["🎉1", "Charles Pan reacted with hooray", "false"],
  ]);
  assert.deepEqual(
    pills(reviewed?.querySelector(".pull-request-thread-comment") ?? null),
    [["👎3", "3 reacted with thumbs down", "false"]],
    "a reaction the read only counted is never lit",
  );
  assert.deepEqual(pills(commented ?? null), [
    ["👀2", "You and Charles Pan reacted with eyes", "true"],
  ]);
});

/** The conversation with a heart on the description, the reader's own as given, and a comment wearing eyes. */
function reacted(heart: { readonly count: number; readonly mine: boolean } | undefined) {
  return {
    ...CONVERSATION,
    descriptionSubject: "PR_42",
    descriptionReactions:
      heart === undefined || heart.count === 0 ? [] : [{ content: REACTION.HEART, ...heart }],
    conversation: [
      {
        kind: CONVERSATION_ENTRY.COMMENT,
        by: CHARLES_ON_GITHUB,
        html: '<p dir="auto">Thanks.</p>',
        body: "",
        at: 3_000,
        url: `${PAGE}#issuecomment-2`,
        subject: "IC_2",
        reactions: [{ content: REACTION.EYES, count: 1, by: [CHARLES_ON_GITHUB] }],
      },
    ],
  };
}

/** The description's heart, as a press. */
function heartOf(tab: HTMLElement): HTMLButtonElement | null {
  return (
    tab
      .querySelector('[aria-label="Description"]')
      ?.querySelector<HTMLButtonElement>(`button${REACTION_PILL}`) ?? null
  );
}

test("a reaction is pressed to take the reader's own back, waits on its change with the state pill unmoved, and is drawn as GitHub left it once the conversation is read again", async () => {
  let heart = { count: 2, mine: true };
  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: reacted(heart) }),
    }),
  );
  const pressed = heartOf(tab) ?? assert.fail("the description's heart is a press");
  assert.equal(pressed.getAttribute("aria-pressed"), "true", "lit as the reader's own");
  const pill = tab.querySelector(".pull-request-state")?.textContent;

  const removing = Promise.withResolvers<void>();
  changeHeld = removing.promise;
  act(() => pressed.click());
  assert.deepEqual(changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.REMOVE_REACTION, subject: "PR_42", content: REACTION.HEART },
    ],
  ]);
  assert.equal(pressed.getAttribute("aria-busy"), "true", "the heart waits on its change");
  assert.ok(
    [
      ...tab.querySelectorAll<HTMLButtonElement>(
        `[aria-label="Description"] button${REACTION_PILL}`,
      ),
    ].every((each) => each.disabled),
    "the row's other presses wait too",
  );
  assert.equal(tab.querySelector(".pull-request-state")?.textContent, pill, "the pill is unmoved");

  heart = { count: 1, mine: false };
  await act(async () => removing.resolve());
  await settle();
  const after = heartOf(tab) ?? assert.fail("the heart still stands, given by another");
  assert.deepEqual(
    [after.textContent, after.getAttribute("aria-pressed")],
    ["❤️1", "false"],
    "drawn as GitHub left it",
  );
});

test("a reaction pressed again before the conversation is read again takes back what the first press gave", async () => {
  const fresh = Promise.withResolvers<{ pullRequest: ReturnType<typeof reacted> }>();
  let asked = 0;
  const tab = await draw(
    controlAnswering({
      conversation: () => {
        asked += 1;
        return asked === 1 ? Promise.resolve({ pullRequest: reacted(undefined) }) : fresh.promise;
      },
    }),
  );
  const entry = tab.querySelector(".pull-request-entry") ?? assert.fail("the comment stands");
  const eyes =
    entry.querySelector<HTMLButtonElement>(`button${REACTION_PILL}`) ??
    assert.fail("the comment's eyes are a press");
  act(() => eyes.click());
  await settle();
  assert.deepEqual(
    [eyes.textContent, eyes.getAttribute("aria-pressed"), eyes.disabled],
    ["👀2", "true", false],
    "once GitHub gave it, the eyes are the reader's while the read is out",
  );
  assert.equal(
    eyes.getAttribute("aria-label"),
    "Charles Pan and 1 more reacted with eyes",
    "who else gave it is still named",
  );
  act(() => eyes.click());
  assert.deepEqual(
    changes.map(([, request]) => request.action),
    [PULL_REQUEST_ACTION.ADD_REACTION, PULL_REQUEST_ACTION.REMOVE_REACTION],
  );
  await settle();
  await act(async () => fresh.resolve({ pullRequest: reacted(undefined) }));
  await settle();
});

test("Add reaction opens one row of GitHub's eight, each named, the arrows moving along it; a pick gives it, and a reaction nobody had given stands as the reader's while it is given, GitHub's refusal standing under the row", async () => {
  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: reacted(undefined) }),
    }),
  );
  const entry = tab.querySelector(".pull-request-entry") ?? assert.fail("the comment stands");
  const add =
    entry.querySelector<HTMLButtonElement>('[aria-label="Add reaction"]') ??
    assert.fail("the comment offers Add reaction");
  act(() => add.click());
  const row =
    entry.querySelector<HTMLElement>('[role="toolbar"]') ?? assert.fail("a row of reactions opens");
  const choices = [...row.querySelectorAll<HTMLButtonElement>("button")];
  assert.deepEqual(
    choices.map((each) => [each.textContent, each.getAttribute("aria-label")]),
    [
      ["👍", "Thumbs up"],
      ["👎", "Thumbs down"],
      ["😄", "Laugh"],
      ["🎉", "Hooray"],
      ["😕", "Confused"],
      ["❤️", "Heart"],
      ["🚀", "Rocket"],
      ["👀", "Eyes"],
    ],
  );
  assert.equal(document.activeElement, choices[0], "the first takes the focus");
  act(() => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  assert.equal(document.activeElement, choices[7], "the arrows wrap along the row");
  assert.equal(choices[7]?.getAttribute("aria-pressed"), "false");

  const giving = Promise.withResolvers<void>();
  changeHeld = giving.promise;
  changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: "Rate limited." };
  const rocket = choices[6] ?? assert.fail("the row offers Rocket");
  act(() => rocket.click());
  assert.equal(entry.querySelector('[role="toolbar"]'), null, "a pick closes the row");
  assert.deepEqual(changes.at(-1), [
    AGENT.id,
    { action: PULL_REQUEST_ACTION.ADD_REACTION, subject: "IC_2", content: REACTION.ROCKET },
  ]);
  assert.deepEqual(
    [...entry.querySelectorAll(REACTION_PILL)].map((each) => [
      each.textContent,
      each.getAttribute("aria-busy"),
    ]),
    [
      ["🚀1", "true"],
      ["👀1", null],
    ],
    "a reaction nobody had given stands as the reader's while it is given",
  );
  await act(async () => giving.resolve());
  await settle();
  assert.match(
    entry.querySelector(".pull-request-reaction-note")?.textContent ?? "",
    /Rate limited\./u,
    "GitHub's refusal stands under the row",
  );
});

/** The switch of the Conversation's filter named as given. */
function filter(tab: HTMLElement, name: string): HTMLButtonElement {
  return (
    tab.querySelector<HTMLButtonElement>(
      `.pull-request-filter [role="switch"][aria-label="${name}"]`,
    ) ?? assert.fail(`the conversation offers ${name}`)
  );
}

/** What a filter's switch says it leaves out, as a reader hears it. */
function filterNote(tab: HTMLElement, name: string): string {
  const note = filter(tab, name).getAttribute("aria-describedby");
  return note === null ? "" : (document.getElementById(note)?.textContent ?? "");
}

/** Who wrote each entry still drawn, and how many threads stand under it. */
function drawnEntries(tab: HTMLElement): string[] {
  return [...tab.querySelectorAll(".pull-request-entry")].map(
    (entry) =>
      `${entry.querySelector(".changes-comment-head .luke-inline-ref-label")?.textContent} ${entry.querySelectorAll(".pull-request-thread").length}`,
  );
}

test("Hide bots and Hide resolved each count what they leave out, leave it out while on, a review whose every thread was resolved going with them, and stay as left for the next conversation drawn", async () => {
  const devin = { login: "devin-ai-integration[bot]", bot: true };
  const conversation: CodingAgentOverviewConversation = {
    reviewers: [],
    conversation: [
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: devin,
        state: REVIEW_STATE.COMMENTED,
        html: '<p dir="auto">Found one issue.</p>',
        body: "",
        at: 1_500,
        url: `${PAGE}#pullrequestreview-1`,
        threads: [thread({ resolved: true })],
      },
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: CHARLES_ON_GITHUB,
        state: REVIEW_STATE.COMMENTED,
        html: '<p dir="auto">Two things.</p>',
        body: "",
        at: 2_000,
        url: `${PAGE}#pullrequestreview-2`,
        threads: [thread({ resolved: true }), thread({ path: "src/other.ts" })],
      },
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: CHARLES_ON_GITHUB,
        state: REVIEW_STATE.APPROVED,
        html: '<p dir="auto">Settled.</p>',
        body: "",
        at: 2_500,
        url: `${PAGE}#pullrequestreview-3`,
        threads: [thread({ resolved: true })],
      },
      {
        kind: CONVERSATION_ENTRY.COMMENT,
        by: { login: "vercel[bot]", bot: true },
        html: '<p dir="auto">Deployed.</p>',
        body: "",
        at: 3_000,
        url: `${PAGE}#issuecomment-4`,
      },
      {
        kind: CONVERSATION_ENTRY.COMMENT,
        by: CHARLES_ON_GITHUB,
        html: '<p dir="auto">Thanks.</p>',
        body: "",
        at: 3_500,
        url: `${PAGE}#issuecomment-5`,
      },
    ],
    earlier: 0,
  };
  const control = controlAnswering({
    conversation: () => Promise.resolve({ pullRequest: conversation }),
  });
  const tab = await draw(control);

  assert.deepEqual(
    words(tab, ".pull-request-filter label"),
    ["Hide resolved3", "Hide bots2"],
    "each counts what it would leave out, resolved threads and bots' entries",
  );
  assert.equal(filterNote(tab, "Hide bots"), "Hides 2 comments and reviews by bots");
  assert.equal(filterNote(tab, "Hide resolved"), "Hides 3 resolved review threads");
  const all = [
    "devin-ai-integration 1",
    "Charles Pan 2",
    "Charles Pan 1",
    "vercel 0",
    "Charles Pan 0",
  ];
  assert.deepEqual(drawnEntries(tab), all, "both start off, everything drawn");

  act(() => filter(tab, "Hide bots").click());
  assert.equal(filter(tab, "Hide bots").getAttribute("aria-checked"), "true");
  assert.deepEqual(drawnEntries(tab), ["Charles Pan 2", "Charles Pan 1", "Charles Pan 0"]);

  act(() => filter(tab, "Hide bots").click());
  act(() => filter(tab, "Hide resolved").click());
  assert.deepEqual(
    drawnEntries(tab),
    ["Charles Pan 1", "vercel 0", "Charles Pan 0"],
    "a resolved thread goes, and a review whose every thread was resolved with it; a comment stays",
  );

  act(() => filter(tab, "Hide bots").click());
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  const again = await draw(control);
  assert.deepEqual(
    [filter(again, "Hide resolved"), filter(again, "Hide bots")].map((each) =>
      each.getAttribute("aria-checked"),
    ),
    ["true", "true"],
    "the choice stands for the next conversation drawn",
  );
  assert.deepEqual(drawnEntries(again), ["Charles Pan 1", "Charles Pan 0"]);
});

test("where the filters leave nothing of the conversation, it says no comment matches", async () => {
  window.localStorage.setItem(
    "luke.conversation-filters",
    JSON.stringify({ hideBots: true, hideResolved: false }),
  );
  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            ...CONVERSATION,
            conversation: CONVERSATION.conversation.map((entry) => ({
              ...entry,
              by: { login: "vercel[bot]", bot: true },
            })),
          },
        }),
    }),
  );
  const conversation =
    tab.querySelector('[aria-label="Conversation"]') ?? assert.fail("the conversation stands");
  assert.equal(conversation.querySelector(".pull-request-entry"), null);
  assert.equal(
    conversation.querySelector(".pull-request-none")?.textContent,
    "No matching comments.",
  );
});

test("opened on its files, as a link to its changes opens it, the header stands above them with where each reviewer stands, and switching between the tabs draws each as it was", async () => {
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
  // The views' own panels, not the Write and Preview panel of a comment box inside one.
  const shownPanel = () =>
    [...tab.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter(
      (each) => !each.hidden && each.parentElement?.closest('[role="tabpanel"]') === null,
    );
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
  assert.deepEqual(words(shownPanel()[0] ?? tab, "li .luke-list-row-title"), [
    "lint, failed",
    "build, running",
    "test, passed",
  ]);

  await choose(tab, "Conversation");
  assert.deepEqual(waiting(tab), [], "nothing is waited on again");
  assert.equal(shownPanel()[0]?.querySelectorAll(".pull-request-entry").length, 2);
});

test("an App's bot stands by the logo GitHub gives it at its App's address, in the header's Opened by and Reviewers and in the conversation, its robot only until the logo loads", async () => {
  const devin = {
    login: "devin-ai-integration[bot]",
    bot: true,
    avatarUrl: "https://avatars.githubusercontent.com/in/811515?v=4",
  };
  const lukeBot = {
    login: "luke-agent[bot]",
    bot: true,
    avatarUrl: "https://avatars.githubusercontent.com/in/4242?v=4",
  };
  const tab = await draw(
    controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, author: lukeBot } }),
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            reviewers: [{ by: devin, state: REVIEW_STATE.COMMENTED }],
            conversation: [
              {
                kind: CONVERSATION_ENTRY.REVIEW,
                by: devin,
                state: REVIEW_STATE.COMMENTED,
                html: '<p dir="auto">Found 1 potential issue.</p>',
                body: "",
                at: 2_000,
                url: `${PAGE}#pullrequestreview-1`,
              },
            ],
            earlier: 0,
          },
        }),
    }),
  );
  const header =
    tab.querySelector<HTMLElement>(".pull-request-header") ?? assert.fail("the header stands");
  const face =
    header.querySelector('[aria-label="Reviewers"] .actor-mark[data-bot="true"]') ??
    assert.fail("the bot reviewer stands on its square");
  const picture = face.querySelector("img") ?? assert.fail("its logo is asked for");
  assert.equal(
    picture.getAttribute("src"),
    "https://avatars.githubusercontent.com/in/811515?v=4&s=36",
  );
  assert.ok(face.querySelector(".lucide-bot"), "its robot stands while the logo loads");
  act(() => {
    picture.dispatchEvent(new Event("load"));
  });
  assert.equal(face.querySelector(".lucide-bot"), null, "the logo stands in the robot's place");

  const opener =
    header.querySelector(
      '.pull-request-people [data-actor-ref] .actor-mark[data-bot="true"] img',
    ) ?? assert.fail("who opened it is asked for by its logo");
  assert.match(
    opener.getAttribute("src") ?? "",
    /^https:\/\/avatars\.githubusercontent\.com\/in\/4242\?/u,
  );
  assert.ok(
    [...tab.querySelectorAll('.pull-request-entry .actor-mark[data-bot="true"] img')].some((each) =>
      (each.getAttribute("src") ?? "").startsWith(
        "https://avatars.githubusercontent.com/in/811515?",
      ),
    ),
    "the bot's review in the conversation is drawn by its logo",
  );
});

test("each tab counts what Luke holds of it: the conversation its comments, reviews, and threads; the checks how they went as published from the first frame, and how many once read; the files the lines published", async () => {
  const tab = await draw(controlAnswering());
  assert.equal(tabCount(tab, "Conversation"), "2");
  assert.equal(
    checksGlyph(tab),
    "failing",
    "how the checks went, as published, stands before they are read",
  );
  assert.equal(tabCount(tab, "Checks"), "", "how many waits on their read");
  assert.equal(tabCount(tab, "Files changed"), "+4 −1");

  await choose(tab, "Checks");
  assert.equal(tabCount(tab, "Checks"), "1", "beside a failure, how many failed");
  assert.equal(checksGlyph(tab), "failing");

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

test("the Checks tab counts what its glyph says: beside a wait how many still run, and where all passed how many there are", async () => {
  const running: CodingAgentOverviewChecks = {
    checks: [
      check("build", CHECK_STATE.PENDING),
      check("e2e", CHECK_STATE.PENDING),
      check("test", CHECK_STATE.PASSED),
    ],
  };
  const waits = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: running }) }),
  );
  await choose(waits, "Checks");
  assert.equal(checksGlyph(waits), "running");
  assert.equal(tabCount(waits, "Checks"), "2");

  act(() => root?.unmount());
  const passing: CodingAgentOverviewChecks = {
    checks: [
      check("lint", CHECK_STATE.PASSED),
      check("test", CHECK_STATE.PASSED),
      check("docs", CHECK_STATE.SKIPPED),
    ],
  };
  const passed = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: passing }) }),
  );
  await choose(passed, "Checks");
  assert.equal(checksGlyph(passed), "passing");
  assert.equal(tabCount(passed, "Checks"), "3");
});

test("a check that ran for no time, skipped or cancelled before it began, says no duration", async () => {
  const none: CodingAgentOverviewChecks = {
    checks: [
      { ...check("cancelled", CHECK_STATE.FAILED), completedAt: 1_000 },
      { ...check("docs", CHECK_STATE.SKIPPED), completedAt: 1_000 },
      check("test", CHECK_STATE.PASSED),
    ],
  };
  const tab = await draw(
    controlAnswering({ checks: () => Promise.resolve({ pullRequest: none }) }),
  );
  await choose(tab, "Checks");
  assert.deepEqual(words(tab, "li .luke-list-row-meta"), ["1m 5s"]);
});

test("a merged pull request says so on its pill, as its overview read it, says nothing of merging, and one with no description, checks, or comments says so", async () => {
  const merged: CodingAgentOverviewPullRequest = {
    ...PULL_REQUEST,
    state: PULL_REQUEST_STATE.MERGED,
    mergedAt: 9_000,
    html: "",
  };
  const tab = await draw(
    // Note that what the agent published was last read open, so the pill says what the overview read.
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
  assert.equal(standing(tab), "Merged");
  assert.equal(mergeControl(tab), null, "a merged pull request has no merge control");
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

test("where what the agent published is not read, the header still says where the pull request stands, and its ⋯ opens it on GitHub first, as its overview read it", async () => {
  const control = {
    ...controlAnswering(),
    pullRequests: new Map(),
  };
  const tab = await draw(control);
  assert.equal(standing(tab), "Open");
  assert.equal(
    tab.querySelector('.pull-request-tab button[aria-label="Open on GitHub"]'),
    null,
    "GitHub is no button of its own",
  );
  const items = openHeaderMenu(tab);
  assert.deepEqual(
    items.map((each) => each.textContent),
    ["Open on GitHub", "Refresh pull request", "Copy link"],
  );
  act(() => items[0]?.click());
  await settle();
  assert.deepEqual(opened, [PAGE]);
});

test("a ⌘-click on the title opens the pull request on GitHub, and a plain one opens nothing", async () => {
  const tab = await draw(controlAnswering());
  const title =
    tab.querySelector<HTMLElement>(".pull-request-title-row .pull-request-title") ??
    assert.fail("the title stands in the title row");
  act(() => title.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await settle();
  assert.deepEqual(opened, []);
  act(() => title.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })));
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
  assert.equal(none.querySelector("section[aria-label='Pull request conversation']"), null);
});

test("the pill, the title, and the files' count stand from what Luke holds before any read lands; each part is a skeleton until its own read lands, and is drawn the moment it does, whatever the order", async () => {
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

  assert.equal(standing(tab), "Open");
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations #42",
    "the title is what Luke held of the pull request",
  );
  assert.equal(tabCount(tab, "Files changed"), "+4 −1");
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
  assert.deepEqual(words(section("Checks"), "li .luke-list-row-title"), [
    "lint, failed",
    "build, running",
    "test, passed",
  ]);
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
  assert.deepEqual(words(tab, "li .luke-list-row-title"), ["retried, passed"]);
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations #42",
    "the pull request is not read again",
  );
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 2, "nor is the conversation");

  const more =
    tab.querySelector<HTMLButtonElement>('[aria-label="Pull request actions"]') ??
    assert.fail("the header has a ⋯");
  act(() => more.click());
  const refresh =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Refresh pull request",
    ) ?? assert.fail("the ⋯ offers Refresh");
  await act(async () => refresh.click());
  await settle();
  assert.deepEqual(words(tab, "li .luke-list-row-title"), ["refreshed, passed"]);
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations weekly #42",
  );
  assert.equal(tab.querySelectorAll(".pull-request-entry").length, 1);
});

test("a pull request renamed on GitHub renames its tab once Refresh is pressed, as it does its header", async () => {
  const renamed = { ...PULL_REQUEST, title: "Expire invitations weekly" };
  const answer = (title: string) => ({
    repository: "acme/relay",
    branch: PULL_REQUEST.head,
    pullRequest: { ...published(PULL_REQUEST_STATE.OPEN), title },
  });
  const tab = await drawn(
    createElement(Named, {
      control: controlAnswering({
        pullRequest: inTurn<CodingAgentOverviewPullRequestAnswerView>(
          { pullRequest: PULL_REQUEST },
          { pullRequest: renamed },
        ),
      }),
      reader: inTurn<CodingAgentPullRequestAnswerView>(
        answer(PULL_REQUEST.title),
        answer(renamed.title),
      ),
    }),
  );
  const name = () => tab.querySelector("[data-tab-name]")?.textContent;
  assert.equal(name(), "#42 Expire invitations");

  const more =
    tab.querySelector<HTMLButtonElement>('[aria-label="Pull request actions"]') ??
    assert.fail("the header has a ⋯");
  act(() => more.click());
  const refresh =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Refresh pull request",
    ) ?? assert.fail("the ⋯ offers Refresh");
  await act(async () => refresh.click());
  await settle();
  assert.equal(
    tab.querySelector(".pull-request-title")?.textContent,
    "Expire invitations weekly #42",
  );
  assert.equal(name(), "#42 Expire invitations weekly");
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

test("the pill wears what was published of the checks only for the pull request they were read on, never a newer one whose checks failed to read", async () => {
  const control = {
    ...controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, number: 43 } }),
      checks: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED }),
    }),
  };
  const tab = await draw(control);
  const mark =
    tab
      .querySelector(".pull-request-title-row")
      ?.firstElementChild?.querySelector("[aria-label]") ?? assert.fail("a mark");
  assert.match(mark.getAttribute("aria-label") ?? "", /43/u);
  assert.doesNotMatch(
    mark.getAttribute("aria-label") ?? "",
    /checks failing/u,
    "#42's failing checks are not #43's",
  );
});

/** The header's pill, its title row's first control, as a press; nothing where it is no press. */
function pillPress(tab: HTMLElement): HTMLButtonElement | undefined {
  const first = tab.querySelector(".pull-request-title-row")?.firstElementChild;
  return first instanceof HTMLButtonElement ? first : undefined;
}

/** The header's pill, as a press. */
function pill(tab: HTMLElement): HTMLButtonElement {
  return pillPress(tab) ?? assert.fail("the pill is a press that opens what may be done");
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
  assert.deepEqual(offered(tab), ["Ready for review", "Close pull request"]);

  await pressAction(tab, "Ready for review");

  assert.deepEqual(changes, [[AGENT.id, { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW }]]);
  assert.equal(pill(tab).textContent, "Open");
  assert.deepEqual(offered(tab), ["Convert to draft", "Close pull request"]);
  assert.equal(tab.querySelector(".pull-request-write-note"), null);
});

test("a member GitHub would not take as signed in is offered to sign in with GitHub again, and a merged pull request's pill offers nothing", async () => {
  let connects = 0;
  changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED };
  const tab = await draw(controlAnswering(), PULL_REQUEST_VIEW.CONVERSATION, AtomRegistry.make(), {
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
  assert.ok(pillPress(merged) === undefined, "a merged pull request's pill is no press");
  assert.equal(standing(merged), "Merged");
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
    note.querySelector("[role='alert']")?.textContent,
    "GitHub said: Pull request is in the merge queue.",
  );
  assert.ok(reads > 1, "the pull request is read again after GitHub answered");
  const dismiss =
    note.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]') ??
    assert.fail("the line may be dismissed");
  act(() => dismiss.click());
  assert.equal(tab.querySelector(".pull-request-write-note"), null);
});

/** How the pull request may be merged where a test says nothing else: squash or rebase, nothing asked for yet, checks passing. */
const MERGING: PullRequestMerging = {
  methods: [MERGE_METHOD.SQUASH, MERGE_METHOD.REBASE],
  autoMergeAllowed: true,
  queue: false,
  queued: null,
  autoMerge: null,
  headSha: "c0ffee1",
  review: null,
  checks: CHECK_SUMMARY.PASSING,
};

/** The plan's agents, its pull request standing as given and merged as given. */
function merging(merge: MergeState, merged: Partial<PullRequestMerging> = {}): CodingAgentsControl {
  return controlAnswering({
    pullRequest: () =>
      Promise.resolve({
        pullRequest: { ...PULL_REQUEST, merge, merging: { ...MERGING, ...merged } },
      }),
  });
}

/** The merge control's panel, opened from its button. */
function openMerge(tab: HTMLElement): HTMLElement {
  act(() => (mergeControl(tab) ?? assert.fail("an open pull request has a merge control")).click());
  return (
    tab.querySelector<HTMLElement>('.merge-control [role="dialog"]') ??
    assert.fail("the merge control opens its panel")
  );
}

/** What the merge control says, and what its panel holds once opened: GitHub's sentence, the words under it, the methods, and the presses; closed again after. */
function mergeShown(tab: HTMLElement) {
  const control = mergeControl(tab) ?? assert.fail("an open pull request has a merge control");
  const panel = openMerge(tab);
  const shown = {
    label: control.getAttribute("aria-label"),
    short: control.querySelector(".merge-control-short")?.textContent,
    look: control.getAttribute("data-variant"),
    title: document.getElementById(panel.getAttribute("aria-labelledby") ?? "")?.textContent,
    words: panel.querySelector(".merge-panel-words")?.textContent,
    methods: words(panel, '[aria-label="Choose how to merge"] [role="radio"]'),
    presses: words(panel, ".merge-panel-foot button"),
  };
  act(() => control.click());
  return shown;
}

/** The merge panel's press of the words given, pressed. */
async function pressBox(tab: HTMLElement, label: string): Promise<void> {
  const panel = openMerge(tab);
  const press =
    [...panel.querySelectorAll<HTMLButtonElement>(".merge-panel-foot button")].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`the merge panel offers ${label}`);
  act(() => press.click());
  await settle();
}

test("the merge control says what can happen now, in the look of where the merge stands, and its panel holds GitHub's sentence, the methods where it merges by one, and the press", async () => {
  const draft = controlAnswering(
    {
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            state: PULL_REQUEST_STATE.DRAFT,
            merge: MERGE_STATE.DRAFT,
            merging: MERGING,
          },
        }),
    },
    PULL_REQUEST_STATE.DRAFT,
  );
  const both = ["Squash and merge", "Rebase and merge"];
  const cases = [
    [
      merging(MERGE_STATE.CLEAN),
      {
        label: "Merge",
        short: "Merge",
        look: "primary",
        title: "Ready to merge",
        words: undefined,
        methods: both,
        presses: ["Squash and merge"],
      },
    ],
    [
      merging(MERGE_STATE.BLOCKED, { checks: CHECK_SUMMARY.PENDING }),
      {
        label: "Auto-merge",
        short: "Auto",
        look: "outline",
        title: "Waiting on required checks",
        words: undefined,
        methods: both,
        presses: ["Enable auto-merge"],
      },
    ],
    [
      merging(MERGE_STATE.CLEAN, { queue: true }),
      {
        label: "Merge when ready",
        short: "When ready",
        look: "primary",
        title: "Ready to merge",
        words: undefined,
        methods: [],
        presses: ["Merge when ready"],
      },
    ],
    [
      merging(MERGE_STATE.UNKNOWN, {
        queue: true,
        queued: { position: 3 },
        autoMerge: { method: null },
      }),
      {
        label: "Queued #3",
        short: "#3",
        look: "working-tint",
        title: "#3 in the merge queue",
        words: "GitHub is still checking whether it merges",
        methods: [],
        presses: ["Remove from queue"],
      },
    ],
    [
      merging(MERGE_STATE.BLOCKED, { autoMerge: { method: MERGE_METHOD.SQUASH } }),
      {
        label: "Auto-merge on",
        short: "Auto-merge",
        look: "working-tint",
        title: "Auto-merge is on (squash)",
        words: "Merging is blocked by a required review or check",
        methods: [],
        presses: ["Disable auto-merge"],
      },
    ],
    [
      merging(MERGE_STATE.CONFLICTS),
      {
        label: "Conflicts",
        short: "Conflicts",
        look: "danger-tint",
        title: "Conflicts with main",
        words: undefined,
        methods: [],
        presses: [],
      },
    ],
    [
      merging(MERGE_STATE.BLOCKED, { review: REVIEW_DECISION.REVIEW_REQUIRED }),
      {
        label: "Review required",
        short: "Review",
        look: "outline",
        title: "A required review is missing",
        words: undefined,
        methods: [],
        presses: [],
      },
    ],
    [
      merging(MERGE_STATE.BLOCKED, { checks: CHECK_SUMMARY.FAILING }),
      {
        label: "Checks failing",
        short: "Failing",
        look: "outline",
        title: "Required checks are failing",
        words: undefined,
        methods: [],
        presses: [],
      },
    ],
    [
      merging(MERGE_STATE.BLOCKED, { review: REVIEW_DECISION.CHANGES_REQUESTED }),
      {
        label: "Changes requested",
        short: "Changes",
        look: "outline",
        title: "Changes were requested",
        words: undefined,
        methods: [],
        presses: [],
      },
    ],
    [
      draft,
      {
        label: "Draft",
        short: "Draft",
        look: "outline",
        title: "A draft; mark it ready for review to merge",
        words: undefined,
        methods: [],
        presses: [],
      },
    ],
  ] as const;
  for (const [control, expected] of cases) {
    const tab = await draw(control);
    assert.deepEqual(mergeShown(tab), expected, expected.label);
    act(() => root?.unmount());
    root = undefined;
  }
});

test("the merge panel closes on Escape and on a press outside it, handing the focus back to its button", async () => {
  const tab = await draw(merging(MERGE_STATE.CLEAN));
  const panel = openMerge(tab);
  act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(tab.querySelector('.merge-control [role="dialog"]'), null, "Escape closes it");
  assert.equal(document.activeElement, mergeControl(tab));
  openMerge(tab);
  act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  assert.equal(
    tab.querySelector('.merge-control [role="dialog"]'),
    null,
    "a press outside closes it",
  );
});

test("a pull request ready to merge offers Merge by the first method the repository allows, keeps the method chosen for the repository, and asks before merging against the head it read", async () => {
  const first = await draw(merging(MERGE_STATE.CLEAN));
  const panel = openMerge(first);
  assert.deepEqual(words(panel, ".merge-panel-foot button"), ["Squash and merge"]);
  const rebase =
    [
      ...panel.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Choose how to merge"] [role="radio"]',
      ),
    ].find((each) => each.textContent?.startsWith("Rebase and merge")) ??
    assert.fail("the methods are offered");
  act(() => rebase.click());
  assert.deepEqual(words(panel, ".merge-panel-foot button"), ["Rebase and merge"]);
  act(() => root?.unmount());
  root = undefined;

  const again = await draw(merging(MERGE_STATE.CLEAN));
  assert.deepEqual(mergeShown(again).presses, ["Rebase and merge"], "the method chosen is kept");
  await pressBox(again, "Rebase and merge");
  assert.deepEqual(changes, [], "a merge asks first");
  assert.equal(again.querySelector('.merge-control [role="dialog"]'), null, "the panel closes");
  const dialog =
    document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]') ??
    assert.fail("the merge is asked about");
  const merge =
    [...dialog.querySelectorAll("button")].find(
      (each) => each.textContent === "Rebase and merge",
    ) ?? assert.fail("the dialog offers the merge");
  act(() => merge.click());
  await settle();
  assert.deepEqual(changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.MERGE, method: MERGE_METHOD.REBASE, headSha: "c0ffee1" },
    ],
  ]);
});

test("auto-merge is offered while checks run, and turned off once on; a merge queue's base offers Merge when ready, and a queued pull request Remove from queue; each closes the panel and is asked of the service for the agent", async () => {
  const cases: readonly (readonly [CodingAgentsControl, string, PullRequestActionRequest])[] = [
    [
      merging(MERGE_STATE.BLOCKED, { checks: CHECK_SUMMARY.PENDING }),
      "Enable auto-merge",
      {
        action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE,
        method: MERGE_METHOD.SQUASH,
        headSha: "c0ffee1",
      },
    ],
    [
      merging(MERGE_STATE.BLOCKED, { autoMerge: { method: MERGE_METHOD.SQUASH } }),
      "Disable auto-merge",
      { action: PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE },
    ],
    [
      merging(MERGE_STATE.CLEAN, { queue: true }),
      "Merge when ready",
      { action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha: "c0ffee1" },
    ],
    [
      merging(MERGE_STATE.CLEAN, {
        queue: true,
        queued: { position: 2 },
        autoMerge: { method: null },
      }),
      "Remove from queue",
      { action: PULL_REQUEST_ACTION.DEQUEUE },
    ],
  ];
  for (const [control, label, request] of cases) {
    changes = [];
    const tab = await draw(control);
    await pressBox(tab, label);
    assert.deepEqual(changes, [[AGENT.id, request]]);
    assert.equal(tab.querySelector('.merge-control [role="dialog"]'), null, "the panel closes");
    act(() => root?.unmount());
    root = undefined;
  }
});

test("while a merge's change is out its control stands busy, and where GitHub refuses it the tab says so in GitHub's own words", async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  changeHeld = promise;
  changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request is not mergeable.",
  };
  const tab = await draw(merging(MERGE_STATE.CLEAN, { queue: true }));
  await pressBox(tab, "Merge when ready");
  const control = mergeControl(tab) ?? assert.fail("a merge control");
  assert.equal(control.getAttribute("aria-busy"), "true");
  assert.equal(control.getAttribute("aria-label"), "Turning on auto-merge");
  resolve();
  await settle();
  assert.equal(
    tab.querySelector(".pull-request-write-note [role='alert']")?.textContent,
    "GitHub said: Pull request is not mergeable.",
  );
});

test("Review stands at the end of the tabs' row while the pull request is open or a draft, and nowhere once it is closed or merged", async () => {
  const states = [
    [PULL_REQUEST_STATE.OPEN, true],
    [PULL_REQUEST_STATE.DRAFT, true],
    [PULL_REQUEST_STATE.CLOSED, false],
    [PULL_REQUEST_STATE.MERGED, false],
  ] as const;
  for (const [state, offered] of states) {
    const tab = await draw(
      controlAnswering(
        { pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, state } }) },
        state,
      ),
    );
    const row =
      tab.querySelector<HTMLElement>(".pull-request-tabs") ?? assert.fail("the tabs' row stands");
    const review = buttonWith(row, /^Review$/u);
    assert.equal(review !== undefined, offered, state);
    const before = review?.closest(".pull-request-review")?.previousElementSibling;
    assert.equal(
      before?.getAttribute("role") ?? null,
      offered ? "tablist" : null,
      "Review follows the tabs",
    );
    assert.equal(
      buttonWith(tab.querySelector(".pull-request-header") ?? tab, /^Review$/u),
      undefined,
    );
    act(() => root?.unmount());
    root = undefined;
  }
});

test("a merge asked about merges the head it was asked about, though a read landing under the question names a newer one", async () => {
  let reads = 0;
  const tab = await draw(
    controlAnswering({
      pullRequest: () => {
        reads += 1;
        const headSha = reads === 1 ? "c0ffee1" : "beef002";
        return Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            merge: MERGE_STATE.CLEAN,
            merging: { ...MERGING, headSha },
          },
        });
      },
    }),
  );
  await pressBox(tab, "Squash and merge");
  const dialog =
    document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]') ??
    assert.fail("the merge is asked about");
  assert.match(dialog.textContent ?? "", /at commit c0ffee1/u);

  act(() =>
    (
      tab.querySelector<HTMLButtonElement>('[aria-label="Pull request actions"]') ??
      assert.fail("the header has a ⋯")
    ).click(),
  );
  const refresh =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Refresh pull request",
    ) ?? assert.fail("the ⋯ offers Refresh");
  await act(async () => refresh.click());
  await settle();
  assert.ok(reads > 1, "a newer head was read under the question");

  const merge =
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"] button, [role="alertdialog"] button',
      ),
    ].find((each) => each.textContent === "Squash and merge") ??
    assert.fail("the dialog still offers the merge");
  act(() => merge.click());
  await settle();
  assert.deepEqual(changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.MERGE, method: MERGE_METHOD.SQUASH, headSha: "c0ffee1" },
    ],
  ]);
});

/** The Review press at the end of the tabs' row. */
function reviewPress(tab: HTMLElement): HTMLButtonElement {
  return (
    buttonWith(tab.querySelector(".pull-request-tabs") ?? tab, /^Review$/u) ??
    assert.fail("an open pull request's tabs offer Review")
  );
}

/** Opens the review panel from the tabs' row. */
function openReview(tab: HTMLElement): HTMLElement {
  act(() => reviewPress(tab).click());
  return tab.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("Review opens the panel");
}

/** Writes the review's words as the member would. */
function writeReview(panel: HTMLElement, words: string): void {
  const field =
    panel.querySelector<HTMLTextAreaElement>('textarea[aria-label="Review comment"]') ??
    assert.fail("the panel has a field for the review's words");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Chooses what the review says by its label, and submits it. */
async function submitReview(panel: HTMLElement, label: string): Promise<void> {
  const choice =
    [
      ...panel.querySelectorAll<HTMLButtonElement>(
        '[aria-label="What the review says"] [role="radio"]',
      ),
    ].find((each) => each.textContent?.startsWith(label)) ??
    assert.fail(`the panel offers ${label}`);
  act(() => choice.click());
  const submit =
    [...panel.querySelectorAll("button")].find((each) => each.textContent === "Submit review") ??
    assert.fail("the panel submits");
  act(() => submit.click());
  await settle();
}

test("Review opens a panel whose choice and words are submitted for the agent as one review, after which it closes, lets its words go, and the conversation is read again", async () => {
  let conversationReads = 0;
  const tab = await draw(
    controlAnswering({
      conversation: () => {
        conversationReads += 1;
        return Promise.resolve({ pullRequest: CONVERSATION });
      },
    }),
  );
  const panel = openReview(tab);
  assert.deepEqual(words(panel, '[aria-label="What the review says"] [role="radio"]'), [
    "CommentSubmit general feedback without approval.",
    "ApproveApprove this pull request.",
    "Request changesSubmit feedback that must be addressed.",
  ]);

  writeReview(panel, "Ship it once **CI** is green.");
  await submitReview(panel, "Approve");

  assert.deepEqual(changes, [
    [
      AGENT.id,
      {
        action: PULL_REQUEST_ACTION.SUBMIT_REVIEW,
        event: REVIEW_EVENT.APPROVE,
        body: "Ship it once **CI** is green.",
      },
    ],
  ]);
  assert.equal(conversationReads, 2, "the conversation is read again once GitHub took the review");
  assert.equal(tab.querySelector('[role="dialog"]'), null, "the panel closes");
  const reopened = openReview(tab);
  assert.equal(reopened.querySelector("textarea")?.value, "", "the submitted words are let go");
  assert.equal(
    reopened
      .querySelector('[aria-label="What the review says"] [aria-checked="true"]')
      ?.textContent?.startsWith("Comment"),
    true,
    "a fresh review says Comment",
  );
});

test("a review GitHub refuses says so in GitHub's own words inside the panel, never over the header, and the words written stand for another try; a merged pull request offers no Review", async () => {
  changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Review Can not approve your own pull request",
  };
  const tab = await draw(controlAnswering());
  const panel = openReview(tab);

  writeReview(panel, "LGTM");
  await submitReview(panel, "Approve");

  assert.equal(
    panel.querySelector(".pull-request-review-note [role='alert']")?.textContent,
    "GitHub said: Review Can not approve your own pull request",
  );
  assert.equal(tab.querySelector(".pull-request-write-note"), null);
  assert.equal(panel.querySelector("textarea")?.value, "LGTM");
  act(() => root?.unmount());
  root = undefined;

  const merged = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({ pullRequest: { ...PULL_REQUEST, state: PULL_REQUEST_STATE.MERGED } }),
    }),
  );
  assert.equal(buttonWith(merged, /^Review$/u), undefined);
});

test("a press outside the review panel closes it, its words kept, and one on a short window opens it on the side with more room, bounded to that room", async () => {
  // Note that jsdom lays out nothing, so the press stands low in a 768px window and the panel is taller than either side.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("pull-request-review")) {
      return DOMRect.fromRect({ x: 600, y: 300, width: 80, height: 28 });
    }
    if (this.classList.contains("luke-anchored-popover")) {
      return DOMRect.fromRect({ x: 0, y: 0, width: 480, height: 600 });
    }
    return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });
  try {
    const tab = await draw(controlAnswering());
    const panel = openReview(tab);
    const layer =
      tab.querySelector<HTMLElement>(".luke-anchored-popover") ??
      assert.fail("the panel hangs from Review");
    assert.equal(layer.dataset.side, "below");
    assert.equal(layer.style.getPropertyValue("--luke-popover-room"), `${768 - 328 - 4 - 8}px`);

    writeReview(panel, "Half a thought");
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    assert.equal(tab.querySelector('[role="dialog"]'), null);
    assert.equal(openReview(tab).querySelector("textarea")?.value, "Half a thought");
  } finally {
    vi.restoreAllMocks();
  }
});

test("its labels stand under the title in their GitHub colours, a fill with words that read on it in the light and a tint with words lifted to read in the dark; one GitHub spelled otherwise stands quiet", async () => {
  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            labels: [
              { name: "bug", color: "d73a4a" },
              { name: "needs review", color: "fbca04" },
              { name: "blocked", color: "000000" },
              { name: "odd", color: "not-a-colour" },
            ],
          },
        }),
    }),
  );
  const labels = [...tab.querySelectorAll<HTMLElement>(".pull-request-header .pull-request-label")];
  const colour = (at: number, property: string) =>
    labels[at]?.style.getPropertyValue(property) ?? assert.fail(`label ${at} stands`);
  assert.deepEqual(
    labels.map((label) => label.textContent),
    ["bug", "needs review", "blocked", "odd"],
  );
  assert.equal(colour(0, "--label-fill-light"), "#d73a4a");
  assert.equal(colour(0, "--label-words-light"), "#ffffff", "a dark fill is written on in white");
  assert.equal(colour(1, "--label-words-light"), "#24292f", "a light fill is written on dark");
  assert.equal(colour(0, "--label-fill-dark"), "#d73a4a20");
  assert.equal(colour(1, "--label-words-dark"), "#fbca04", "a light colour reads as it is");
  assert.equal(colour(2, "--label-words-dark"), "#999999", "black is lifted to read on the dark");
  assert.equal(colour(3, "--label-fill-light"), "", "a colour spelled otherwise draws no fill");
});

test("a pull request with no labels spends no line on them: its label picker stands beside the reviewers' picker, and its labels, once it has some, close that same line", async () => {
  let labels: { name: string; color: string }[] = [];
  const tab = await draw(
    controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, labels } }),
    }),
  );
  const people = () =>
    tab.querySelector<HTMLElement>(".pull-request-header .pull-request-people") ??
    assert.fail("the line of people stands");
  const pickers = () =>
    [...people().querySelectorAll<HTMLButtonElement>(".pull-request-reviewers button")].map(
      (button) => button.getAttribute("aria-label"),
    );

  assert.equal(tab.querySelector(".pull-request-header .pull-request-labels"), null);
  assert.deepEqual(pickers(), ["Edit reviewers", "Edit labels"]);

  labels = [{ name: "bug", color: "d73a4a" }];
  act(() =>
    (
      tab.querySelector<HTMLButtonElement>('[aria-label="Pull request actions"]') ??
      assert.fail("the header has a ⋯")
    ).click(),
  );
  const refresh =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Refresh pull request",
    ) ?? assert.fail("the ⋯ offers Refresh");
  await act(async () => refresh.click());
  await settle();
  const list = people().querySelector('[aria-label="Labels"]') ?? assert.fail("its labels stand");
  assert.equal(list.textContent, "bug");
  assert.equal(people().lastElementChild, list, "they close the line of people");
  assert.deepEqual(pickers(), ["Edit reviewers", "Edit labels"]);
});

test("its reviewers stand compactly, three faces and a count of the rest: where each stands, a change asked for outlasting a new ask, its author left out, and Apps' bots last; those asked stand asked until the reviews land", async () => {
  const author = { login: "luke-agent[bot]", bot: true };
  const priya = { login: "priyan", bot: false };
  const alex = { login: "alexr", bot: false };
  const linter = { login: "lint-app[bot]", bot: true };
  const conversation = held<{ pullRequest: CodingAgentOverviewConversation }>();
  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            author,
            requested: [linter, CHARLES_ON_GITHUB, priya, author],
          },
        }),
      conversation: conversation.read,
    }),
  );
  const faces = () =>
    [...tab.querySelectorAll('.pull-request-header [aria-label="Reviewers"] > li')].map((face) =>
      face.getAttribute("aria-label"),
    );
  assert.deepEqual(faces(), [
    "Charles Pan · Review requested",
    "priyan · Review requested",
    "lint-app · Review requested",
  ]);

  conversation.answer({
    pullRequest: {
      ...CONVERSATION,
      reviewers: [
        { by: CHARLES_ON_GITHUB, state: REVIEW_STATE.CHANGES_REQUESTED },
        { by: alex, state: REVIEW_STATE.APPROVED },
      ],
    },
  });
  await settle();
  assert.deepEqual(faces(), [
    "Charles Pan · Changes requested",
    "alexr · Approved",
    "priyan · Review requested",
    "lint-app · Review requested",
  ]);
  assert.equal(
    tab.querySelector(".pull-request-header .actor-stack-more")?.textContent,
    "+1",
    "the fourth is counted rather than drawn",
  );
});

test("the stack it stands in sits beside its branches; its menu lists it tip first, and opens an agent's Pull request tab on its task, this one or another, an agent on no task its page, and one no agent owns on GitHub", async () => {
  const elsewhere = "3c5e7a9b-1d2f-4a6b-8c0e-2f4a6b8c0e1d";
  const entry = (number: number, agent?: { id: string; taskId: string | null }) => ({
    number,
    title: `Step ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    draft: number === 46,
    ...(agent === undefined ? undefined : { agent }),
  });
  const sibling = { id: "5a7c9e1b-3d5f-4b7d-9f1b-3d5f7b9d1f3a", taskId: AGENT.planId };
  const away = { id: "7c9e1b3d-5f7b-4d9f-8b3d-5f7b9d1f3b5d", taskId: elsewhere };
  const taskless = { id: "9e1b3d5f-7b9d-4f1b-8d5f-7b9d1f3b5d7f", taskId: null };
  const links: ReadLink[] = [];
  const tab = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({
          pullRequest: {
            ...PULL_REQUEST,
            stack: [
              entry(38, away),
              entry(40, sibling),
              entry(42, { id: AGENT.id, taskId: AGENT.planId }),
              entry(44, taskless),
              entry(46),
            ],
          },
        }),
    }),
    PULL_REQUEST_VIEW.CONVERSATION,
    undefined,
    undefined,
    (link) => links.push(link),
  );
  const button =
    tab.querySelector<HTMLButtonElement>(
      '.pull-request-branch-row button[aria-label="Stack, 3 of 5"]',
    ) ?? assert.fail("the stack stands beside the branches");
  assert.equal(button.textContent, "Stack 3/5");
  const items = () => [
    ...document.querySelectorAll<HTMLButtonElement>(
      ':is([role="menuitem"], [role="menuitemcheckbox"])',
    ),
  ];
  const press = (number: number) => {
    act(() => button.click());
    const item =
      items().find((each) => each.textContent?.startsWith(`#${number} `)) ??
      assert.fail(`the menu lists #${number}`);
    act(() => item.click());
  };

  act(() => button.click());
  assert.deepEqual(
    items().map((item) => item.textContent?.split(" ")[0]),
    ["#46", "#44", "#42", "#40", "#38"],
  );
  const current = items()[2];
  assert.equal(current?.getAttribute("aria-checked"), "true");
  assert.equal(current?.disabled, true, "this pull request is not opened again");
  act(() => button.click());

  press(40);
  press(38);
  press(44);
  press(46);
  assert.deepEqual(links, [
    {
      workspace: "",
      place: { kind: LINK_PLACE.CHANGES, planId: AGENT.planId, agentId: sibling.id },
    },
    { workspace: "", place: { kind: LINK_PLACE.CHANGES, planId: elsewhere, agentId: away.id } },
    { workspace: "", place: { kind: LINK_PLACE.AGENT, agentId: taskless.id } },
  ]);
  assert.deepEqual(opened, ["https://github.com/acme/relay/pull/46"]);
});

test("a pull request in no stack draws no stack", async () => {
  const tab = await draw(
    controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, stack: [] } }),
    }),
  );
  assert.ok(tab.querySelector(".pull-request-header .pull-request-branches") !== null);
  assert.equal(tab.querySelector(".pull-request-stack"), null);
});

/** The items of the menu standing open, by their words and whether each is checked. */
function menuItems(): { readonly label: string; readonly checked: string | null }[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      ':is([role="menuitem"], [role="menuitemcheckbox"])',
    ),
  ].map((item) => ({
    label: item.querySelector(".luke-menu-item-label")?.textContent ?? "",
    checked: item.getAttribute("aria-checked"),
  }));
}

/** Presses the menu item that begins with the words given. */
async function pressItem(words: string): Promise<void> {
  const item =
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        ':is([role="menuitem"], [role="menuitemcheckbox"])',
      ),
    ].find((each) => each.textContent?.startsWith(words)) ??
    assert.fail(`the menu offers ${words}`);
  act(() => item.click());
  await settle();
}

test("the reviewer picker lists the repository's teams then its people, the author left out and those asked checked; choosing one asks a review of them as the member, and the picker waits on the pull request's read before it opens again, then checks them", async () => {
  let asked: readonly GitHubPerson[] = [CHARLES_ON_GITHUB];
  const reread = held<{ pullRequest: CodingAgentOverviewPullRequest }>();
  let reads = 0;
  const tab = await draw(
    controlAnswering({
      pullRequest: () => {
        reads += 1;
        const answer = {
          pullRequest: {
            ...PULL_REQUEST,
            requested: asked,
            requestedTeams: [{ slug: "platform", name: "Platform" }],
          },
        };
        return reads === 1 ? Promise.resolve(answer) : reread.read();
      },
      reviewOptions: () =>
        Promise.resolve({
          labels: [],
          users: [
            CHARLES_ON_GITHUB,
            { login: "priyan", bot: false },
            PULL_REQUEST.author ?? assert.fail(),
          ],
          teams: [
            { slug: "platform", name: "Platform" },
            { slug: "design", name: "Design" },
          ],
        }),
    }),
  );
  const picker = () =>
    tab.querySelector<HTMLButtonElement>('.pull-request-reviewers [aria-label="Edit reviewers"]') ??
    assert.fail("the reviewer picker stands beside the reviewers");

  act(() => picker().click());
  await settle();
  assert.deepEqual(menuItems(), [
    { label: "Platform", checked: "true" },
    { label: "Design", checked: "false" },
    { label: "charlespan", checked: "true" },
    { label: "priyan", checked: "false" },
  ]);
  await pressItem("priyan");

  assert.deepEqual(changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.REQUEST_REVIEW, reviewer: { kind: "user", name: "priyan" } },
    ],
  ]);
  assert.equal(picker().disabled, true, "nothing is chosen from what the pull request held before");
  asked = [CHARLES_ON_GITHUB, { login: "priyan", bot: false }];
  reread.answer({
    pullRequest: {
      ...PULL_REQUEST,
      requested: asked,
      requestedTeams: [{ slug: "platform", name: "Platform" }],
    },
  });
  await settle();
  act(() => picker().click());
  await settle();
  assert.deepEqual(
    menuItems().find((item) => item.label === "priyan"),
    { label: "priyan", checked: "true" },
  );
  await pressItem("Platform");
  assert.deepEqual(changes.at(-1), [
    AGENT.id,
    {
      action: PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST,
      reviewer: { kind: "team", name: "platform" },
    },
  ]);
});

test("the label picker lists the repository's labels, those on the pull request checked, and takes one off or puts one on as chosen; a merged pull request is offered no reviewers", async () => {
  const tab = await draw(
    controlAnswering(
      {
        pullRequest: () =>
          Promise.resolve({
            pullRequest: {
              ...PULL_REQUEST,
              state: PULL_REQUEST_STATE.MERGED,
              mergedAt: 2_000,
              labels: [{ name: "bug", color: "d73a4a" }],
            },
          }),
        reviewOptions: () =>
          Promise.resolve({
            labels: [
              { name: "bug", color: "d73a4a" },
              { name: "docs", color: "0075ca" },
            ],
            users: [],
            teams: [],
          }),
      },
      PULL_REQUEST_STATE.MERGED,
    ),
  );
  assert.equal(tab.querySelector('[aria-label="Edit reviewers"]'), null);
  const picker =
    tab.querySelector<HTMLButtonElement>('.pull-request-reviewers [aria-label="Edit labels"]') ??
    assert.fail("the label picker stands beside the reviewers");

  act(() => picker.click());
  await settle();
  assert.deepEqual(menuItems(), [
    { label: "bug", checked: "true" },
    { label: "docs", checked: "false" },
  ]);
  await pressItem("bug");
  act(() => picker.click());
  await settle();
  await pressItem("docs");

  assert.deepEqual(changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.REMOVE_LABEL, label: "bug" }],
    [AGENT.id, { action: PULL_REQUEST_ACTION.ADD_LABEL, label: "docs" }],
  ]);
});

/** A review carrying the threads given, as the conversation's read answers one. */
function reviewWith(threads: readonly ReviewThread[]): CodingAgentOverviewConversation {
  return {
    ...CONVERSATION,
    conversation: [
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: CHARLES_ON_GITHUB,
        state: REVIEW_STATE.COMMENTED,
        html: null,
        body: "",
        at: 2_500,
        url: `${PAGE}#pullrequestreview-9`,
        threads,
      },
    ],
  };
}

/** The press of the words given under the thread. */
function threadPress(thread: HTMLElement, label: string): HTMLButtonElement {
  return (
    [...thread.querySelectorAll<HTMLButtonElement>(".pull-request-thread-actions button")].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`the thread offers ${label}`)
  );
}

/** Writes a reply on the thread as the member would, the field opened first. */
function writeReply(thread: HTMLElement, words: string): void {
  act(() => threadPress(thread, "Reply…").click());
  const field =
    thread.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]') ??
    assert.fail("Reply… opens the reply's field");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The thread as GitHub holds it once the changes asked so far were made: their replies after its comment, and resolved by the last resolve or unresolve. */
function threadAfterChanges(): ReviewThread {
  const base = thread({ id: "PRRT_flag" });
  let resolved = false;
  const replies: ReviewThread["comments"][number][] = [];
  for (const [, request] of changes) {
    if (request.action === PULL_REQUEST_ACTION.REPLY_TO_THREAD) {
      replies.push({
        by: CHARLES_ON_GITHUB,
        html: null,
        body: request.body,
        at: 3_000,
        url: `${PAGE}#discussion_r${10 + replies.length}`,
      });
    }
    if (request.action === PULL_REQUEST_ACTION.RESOLVE_THREAD) resolved = true;
    if (request.action === PULL_REQUEST_ACTION.UNRESOLVE_THREAD) resolved = false;
  }
  return { ...base, resolved, comments: [...base.comments, ...replies] };
}

test("a thread is replied on, resolved, and opened again from under its comments, each asked of the service for the agent by the thread's id, the thread then drawn as GitHub holds it", async () => {
  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: reviewWith([threadAfterChanges()]) }),
    }),
  );
  const card = (): HTMLElement =>
    tab.querySelector<HTMLElement>(".pull-request-thread") ?? assert.fail("the thread is drawn");
  const labels = () => threadLabels(card());

  writeReply(card(), "Renamed in the next push.");
  act(() => threadPress(card(), "Reply").click());
  await settle();
  assert.equal(card().querySelector("textarea"), null, "the field closes once GitHub took it");
  assert.match(
    card().querySelector(".pull-request-thread-comments")?.textContent ?? "",
    /Renamed in the next push\./u,
    "the reply is drawn under the thread once read again",
  );

  act(() => threadPress(card(), "Resolve conversation").click());
  await settle();
  assert.deepEqual(labels(), ["Resolved"]);

  act(() => threadPress(card(), "Unresolve conversation").click());
  await settle();
  assert.deepEqual(labels(), []);
  assert.ok(threadPress(card(), "Resolve conversation"), "the thread stands open again");

  assert.deepEqual(changes, [
    [
      AGENT.id,
      {
        action: PULL_REQUEST_ACTION.REPLY_TO_THREAD,
        threadId: "PRRT_flag",
        body: "Renamed in the next push.",
      },
    ],
    [AGENT.id, { action: PULL_REQUEST_ACTION.RESOLVE_THREAD, threadId: "PRRT_flag" }],
    [AGENT.id, { action: PULL_REQUEST_ACTION.UNRESOLVE_THREAD, threadId: "PRRT_flag" }],
  ]);
});

test("while a thread's resolve is out, its reply stands still, neither sent nor let go, so nothing is posted twice", async () => {
  const held = Promise.withResolvers<void>();
  changeHeld = held.promise;
  const tab = await draw(
    controlAnswering({
      conversation: () => Promise.resolve({ pullRequest: reviewWith([threadAfterChanges()]) }),
    }),
  );
  const card = (): HTMLElement =>
    tab.querySelector<HTMLElement>(".pull-request-thread") ?? assert.fail("the thread is drawn");

  writeReply(card(), "Done.");
  act(() => threadPress(card(), "Resolve conversation").click());
  const field = card().querySelector<HTMLTextAreaElement>("textarea") ?? assert.fail();
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  assert.equal(threadPress(card(), "Reply").disabled, true);
  assert.equal(card().querySelector("textarea")?.value, "Done.", "Escape lets nothing go");
  held.resolve();
  await settle();
  assert.deepEqual(
    changes.map(([, request]) => request.action),
    [PULL_REQUEST_ACTION.RESOLVE_THREAD],
  );
});

test("a reply GitHub refuses says so under its thread in GitHub's own words, its words kept, and a thread read with no id offers nothing to press", async () => {
  changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request review thread is locked",
  };
  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: reviewWith([
            thread({ id: "PRRT_flag" }),
            thread({ path: "src/other.ts", comments: [] }),
          ]),
        }),
    }),
  );
  const [withId, withoutId] = [...tab.querySelectorAll<HTMLElement>(".pull-request-thread")];
  assert.ok(withId !== undefined && withoutId !== undefined);

  writeReply(withId, "Done.");
  act(() => threadPress(withId, "Reply").click());
  await settle();

  assert.equal(
    withId.querySelector(".pull-request-thread-note [role='alert']")?.textContent,
    "GitHub said: Pull request review thread is locked",
  );
  assert.equal(withId.querySelector("textarea")?.value, "Done.");
  assert.equal(withoutId.querySelector(".pull-request-thread-actions"), null);
});

test("a tab naming another pull request of the agent's repository by its number reads that one, counts its own lines, and changes it rather than the agent's own", async () => {
  const asked: unknown[] = [];
  const url = "https://github.com/acme/relay/pull/41";
  const earlier = {
    ...published(PULL_REQUEST_STATE.OPEN),
    number: 41,
    title: "Lay the invitations' base",
    url,
    additions: 9,
    deletions: 2,
  };
  const recorded =
    <A>(kind: string, answer: A) =>
    (agentId: string, number?: number) => {
      asked.push([kind, agentId, number]);
      return Promise.resolve(answer);
    };
  const control = {
    ...controlAnswering({
      pullRequest: recorded("pull request", {
        pullRequest: { ...PULL_REQUEST, number: 41, title: earlier.title, url },
      }),
      conversation: recorded("conversation", { pullRequest: CONVERSATION }),
    }),
    numberedPullRequests: new Map([[AGENT.id, new Map([[41, earlier]])]]),
  };
  const tab = await drawn(
    createElement(AgentPullRequestTab, {
      agentId: AGENT.id,
      number: 41,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
      view: PULL_REQUEST_VIEW.CONVERSATION,
      onView: () => undefined,
    }),
  );

  assert.deepEqual(asked, [
    ["pull request", AGENT.id, 41],
    ["conversation", AGENT.id, 41],
  ]);
  assert.equal(tabCount(tab, "Files changed"), "+9 −2");
  await pressAction(tab, "Close pull request");
  assert.deepEqual(changes, [[AGENT.id, { action: PULL_REQUEST_ACTION.CLOSE }]]);
  assert.deepEqual(changeNumbers, [41]);
});

test("an open pull request's pill offers Close and a closed one's Reopen, each asked of the service for the agent", async () => {
  const open = await draw(controlAnswering());
  await pressAction(open, "Close pull request");
  act(() => root?.unmount());
  root = undefined;
  const closed = await draw(
    controlAnswering({
      pullRequest: () =>
        Promise.resolve({ pullRequest: { ...PULL_REQUEST, state: PULL_REQUEST_STATE.CLOSED } }),
    }),
  );
  assert.deepEqual(offered(closed), ["Reopen pull request"]);
  await pressAction(closed, "Reopen pull request");

  assert.deepEqual(changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.CLOSE }],
    [AGENT.id, { action: PULL_REQUEST_ACTION.REOPEN }],
  ]);
});

/** The title's field, opened by its pencil. */
function editTitle(tab: HTMLElement): HTMLInputElement {
  act(() =>
    (
      tab.querySelector<HTMLButtonElement>('[aria-label="Edit title"]') ??
      assert.fail("the title has a pencil")
    ).click(),
  );
  return (
    tab.querySelector<HTMLInputElement>('[aria-label="Pull request title"]') ??
    assert.fail("the pencil opens a field")
  );
}

/** Words typed into a field, as React hears them. */
function type(field: HTMLInputElement, words: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A key pressed in a field, while an input method composes a word where `composing` says. */
async function key(field: HTMLInputElement, name: string, composing = false): Promise<void> {
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, isComposing: composing }),
    );
  });
  await settle();
}

test("the title is edited in place: Enter keeps new words trimmed, and Escape, or words unchanged, sends nothing", async () => {
  const tab = await draw(controlAnswering());
  const escaped = editTitle(tab);
  assert.equal(document.activeElement, escaped, "the field takes the keys as it opens");
  type(escaped, "Something else");
  await key(escaped, "Enter", true);
  await key(escaped, "Escape", true);
  assert.equal(escaped.isConnected, true, "keys an input method takes leave the field as it is");
  const heard: string[] = [];
  const hear = (event: KeyboardEvent) => heard.push(event.key);
  window.addEventListener("keydown", hear);
  await key(escaped, "Escape");
  window.removeEventListener("keydown", hear);
  assert.equal(tab.querySelector('[aria-label="Pull request title"]'), null);
  assert.deepEqual(heard, [], "the field's own Escape never reaches the window");

  const unchanged = editTitle(tab);
  assert.equal(unchanged.value, PULL_REQUEST.title);
  await key(unchanged, "Enter");
  assert.deepEqual(changes, [], "neither Escape nor the same words change anything");

  const renamed = editTitle(tab);
  type(renamed, "  Expire invitations after a week  ");
  await key(renamed, "Enter");
  assert.deepEqual(changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.EDIT_TITLE, title: "Expire invitations after a week" },
    ],
  ]);
  assert.equal(
    tab.querySelector('[aria-label="Pull request title"]'),
    null,
    "the field closes once GitHub answered",
  );
});

test("the title's edit is kept as the focus leaves its field, as it is on Enter", async () => {
  const tab = await draw(controlAnswering());
  const field = editTitle(tab);
  type(field, "Expire invitations after a day");
  act(() => field.blur());
  await settle();
  assert.deepEqual(changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.EDIT_TITLE, title: "Expire invitations after a day" }],
  ]);
  assert.equal(tab.querySelector('[aria-label="Pull request title"]'), null, "the field closes");
});

test("Files changed draws each review thread under its line, its comments through the overview's own drawing, and while Minimize inline comments is on, as one chip at the line's end that shows it", async () => {
  const review = {
    kind: CONVERSATION_ENTRY.REVIEW,
    by: CHARLES_ON_GITHUB,
    state: REVIEW_STATE.COMMENTED,
    html: null,
    body: "",
    at: 2_500,
    url: `${PAGE}#pullrequestreview-9`,
    threads: [thread()],
  } as const;
  const readChanges: CodingAgentsControl["readChanges"] = () =>
    Promise.resolve({
      pullRequest: {
        url: PAGE,
        truncated: false,
        files: [
          {
            path: "src/invite.ts",
            previousPath: null,
            status: CHANGED_FILE_STATUS.MODIFIED,
            additions: 2,
            deletions: 1,
            omitted: null,
            // The hunk as the pull request's files carry it, its header counting the lines it holds.
            patch: thread().diffHunk.replace("@@ -8,6 +8,7 @@", "@@ -8,5 +8,6 @@"),
          },
        ],
      },
    });
  handSettings();
  // The View settings popover opens on the window's appearance.
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const tab = await draw(
    controlAnswering(
      {
        conversation: () =>
          Promise.resolve({ pullRequest: { ...CONVERSATION, conversation: [review] } }),
      },
      PULL_REQUEST_STATE.OPEN,
      readChanges,
    ),
  );
  await act(async () => option(tab, "Files changed").click());
  await settle();
  const minimize = async () => {
    act(() => tab.querySelector<HTMLButtonElement>('button[aria-label="View settings"]')?.click());
    const toggle = [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
      (each) => each.getAttribute("aria-label") === "Minimize inline comments",
    );
    act(() => toggle?.click());
    await settle();
    act(() => tab.querySelector<HTMLButtonElement>('button[aria-label="View settings"]')?.click());
  };

  const drawn = lists.at(-1) ?? assert.fail("the files are drawn");
  const file = drawn.files.find((each) => each.path === "src/invite.ts");
  assert.deepEqual(file?.annotations, [
    { key: `${PAGE}#discussion_r1`, side: "additions", line: 13 },
  ]);
  const note = drawn.renderAnnotation("src/invite.ts", `${PAGE}#discussion_r1`);
  assert.equal(
    note.querySelector('.pull-request-thread-comment [data-streamdown="strong"]')?.textContent,
    "once",
  );
  assert.equal(note.querySelector("details")?.open, true, "a current thread stands open");
  await minimize();
  const chip = note.querySelector<HTMLElement>(".diff-thread-chip") ?? assert.fail("a chip stands");
  assert.equal(chip.getAttribute("aria-label"), "1 comment by Charles Pan · 1 open, show");
  assert.equal(
    note.querySelector(".pull-request-thread-comment"),
    null,
    "minimized, no thread is drawn",
  );
  act(() => chip.click());
  await settle();
  assert.ok(note.querySelector(".pull-request-thread-comment"), "the chip shows the line's thread");
  assert.equal(
    note.querySelector(".diff-thread-chip")?.getAttribute("aria-label"),
    "1 comment by Charles Pan · 1 open, hide",
  );
});

test("the pointer resting on a review thread in Files changed lights the lines it is on, and leaving it lets them go; a minimized chip lights the widest of its threads' lines, and again once the pointer comes back from a thread it shows", async () => {
  const review = {
    kind: CONVERSATION_ENTRY.REVIEW,
    by: CHARLES_ON_GITHUB,
    state: REVIEW_STATE.COMMENTED,
    html: null,
    body: "",
    at: 2_500,
    url: `${PAGE}#pullrequestreview-9`,
    threads: [
      thread(),
      thread({
        // A first line above the patch's hunk, which no drawn row holds.
        startLine: 3,
        originalStartLine: 3,
        comments: [
          { ...(thread().comments[0] ?? assert.fail("a comment")), url: `${PAGE}#discussion_r2` },
        ],
      }),
    ],
  } as const;
  handSettings();
  // The View settings popover opens on the window's appearance.
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const tab = await draw(
    controlAnswering(
      {
        conversation: () =>
          Promise.resolve({ pullRequest: { ...CONVERSATION, conversation: [review] } }),
      },
      PULL_REQUEST_STATE.OPEN,
      () =>
        Promise.resolve({
          pullRequest: { url: PAGE, headSha: READ_HEAD, truncated: false, files: [INVITE_FILE] },
        }),
    ),
  );
  await act(async () => option(tab, "Files changed").click());
  await settle();
  const note = (lists.at(-1) ?? assert.fail("the files are drawn")).renderAnnotation(
    INVITE_FILE.path,
    `${PAGE}#discussion_r1`,
  );
  const drawnThread =
    note.querySelector<HTMLElement>(".pull-request-thread-comment") ??
    assert.fail("the thread is drawn");

  act(() => {
    drawnThread.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  assert.deepEqual(lists.at(-1)?.selected, {
    path: INVITE_FILE.path,
    selection: {
      start: 12,
      side: DIFF_SELECTION_SIDE.ADDITIONS,
      end: 13,
      endSide: DIFF_SELECTION_SIDE.ADDITIONS,
    },
  });
  act(() => {
    drawnThread.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
    );
  });
  assert.equal(lists.at(-1)?.selected, undefined, "its lines are let go");

  act(() => tab.querySelector<HTMLButtonElement>('button[aria-label="View settings"]')?.click());
  await settle();
  const minimize =
    [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
      (each) => each.getAttribute("aria-label") === "Minimize inline comments",
    ) ?? assert.fail("the diff settings offer Minimize inline comments");
  act(() => minimize.click());
  await settle();
  const chip =
    note.querySelector<HTMLElement>(".diff-thread-chip") ??
    assert.fail("the threads are minimized");
  const litFrom = () => lists.at(-1)?.selected?.selection.start;
  act(() => {
    chip.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  assert.equal(
    litFrom(),
    3,
    "the chip lights the widest of its threads' lines, 3–13, though no drawn row holds line 3",
  );

  act(() => chip.click());
  await settle();
  const shown =
    [
      ...note.querySelectorAll<HTMLElement>(
        ".diff-thread-chip-threads .pull-request-thread-comment",
      ),
    ].find((each) => each.textContent?.includes("once")) ??
    assert.fail("the chip shows the thread on lines 12–13");
  act(() => {
    shown.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  assert.equal(litFrom(), 12, "a thread shown under the chip lights its own lines");
  act(() => {
    shown.dispatchEvent(
      new MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: note.querySelector(".diff-thread-chip"),
      }),
    );
  });
  assert.equal(litFrom(), 3, "back on the chip, the chip's lines light again");
});

test("a review thread on its line in Files changed is replied on and resolved from under its comments, as in the Conversation", async () => {
  const flagged = thread({ id: "PRRT_flag" });
  const readChanges: CodingAgentsControl["readChanges"] = () =>
    Promise.resolve({
      pullRequest: {
        url: PAGE,
        truncated: false,
        files: [
          {
            path: "src/invite.ts",
            previousPath: null,
            status: CHANGED_FILE_STATUS.MODIFIED,
            additions: 2,
            deletions: 1,
            omitted: null,
            patch: flagged.diffHunk.replace("@@ -8,6 +8,7 @@", "@@ -8,5 +8,6 @@"),
          },
        ],
      },
    });
  const tab = await draw(
    controlAnswering(
      { conversation: () => Promise.resolve({ pullRequest: reviewWith([flagged]) }) },
      PULL_REQUEST_STATE.OPEN,
      readChanges,
    ),
  );
  await act(async () => option(tab, "Files changed").click());
  await settle();
  const drawn = lists.at(-1) ?? assert.fail("the files are drawn");
  assert.ok(
    drawn.files.some((file) => file.annotations.some((one) => one.line === 13)),
    "the thread is drawn on its line",
  );
  const note = drawn.renderAnnotation("src/invite.ts", `${PAGE}#discussion_r1`);

  writeReply(note, "Renamed.");
  act(() => threadPress(note, "Reply").click());
  await settle();
  act(() => threadPress(note, "Resolve conversation").click());
  await settle();

  assert.deepEqual(changes, [
    [
      AGENT.id,
      { action: PULL_REQUEST_ACTION.REPLY_TO_THREAD, threadId: "PRRT_flag", body: "Renamed." },
    ],
    [AGENT.id, { action: PULL_REQUEST_ACTION.RESOLVE_THREAD, threadId: "PRRT_flag" }],
  ]);
});

/** Writes in the comment box at the Conversation's foot as the member would. */
function writeComment(tab: HTMLElement, words: string): HTMLTextAreaElement {
  const field =
    tab.querySelector<HTMLTextAreaElement>(
      '.pull-request-comment-box textarea[aria-label="Comment"]',
    ) ?? assert.fail("the Conversation ends in a comment box");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
}

/** The comment box's Comment press. */
function commentPress(tab: HTMLElement): HTMLButtonElement {
  return (
    tab.querySelector<HTMLButtonElement>(".pull-request-comment-foot button") ??
    assert.fail("the box offers Comment")
  );
}

test("a comment written at the Conversation's foot is asked of the service for the agent, after which the box lets its words go and the comment stands in the conversation", async () => {
  const tab = await draw(
    controlAnswering({
      conversation: () =>
        Promise.resolve({
          pullRequest: {
            ...CONVERSATION,
            conversation: [
              ...CONVERSATION.conversation,
              ...changes.flatMap(([, request]) =>
                request.action === PULL_REQUEST_ACTION.COMMENT
                  ? [
                      {
                        kind: CONVERSATION_ENTRY.COMMENT,
                        by: CHARLES_ON_GITHUB,
                        html: null,
                        body: request.body,
                        at: 4_000,
                        url: `${PAGE}#issuecomment-9`,
                      },
                    ]
                  : [],
              ),
            ],
          },
        }),
    }),
  );
  assert.equal(commentPress(tab).disabled, true, "a blank comment is not sent");

  const field = writeComment(tab, "Shipping after **lunch**.");
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
  });
  await settle();

  assert.deepEqual(changes, [
    [AGENT.id, { action: PULL_REQUEST_ACTION.COMMENT, body: "Shipping after **lunch**." }],
  ]);
  assert.equal(
    tab.querySelector<HTMLTextAreaElement>(".pull-request-comment-box textarea")?.value,
    "",
    "the box lets its words go",
  );
  assert.match(
    tab.querySelector(".pull-request-conversation")?.textContent ?? "",
    /Shipping after lunch\./u,
  );
});

test("a comment GitHub refuses says so under the box in GitHub's own words, its words kept for another try", async () => {
  changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Conversation is locked to collaborators",
  };
  const tab = await draw(controlAnswering());

  writeComment(tab, "Ping?");
  act(() => commentPress(tab).click());
  await settle();

  assert.equal(
    tab.querySelector(".pull-request-comment-note [role='alert']")?.textContent,
    "GitHub said: Conversation is locked to collaborators",
  );
  assert.equal(
    tab.querySelector<HTMLTextAreaElement>(".pull-request-comment-box textarea")?.value,
    "Ping?",
  );
});

test("a comment being written outlives a read of the conversation that failed, standing in the box again once Retry reads it", async () => {
  let reads = 0;
  const tab = await draw(
    controlAnswering({
      conversation: () => {
        reads += 1;
        return Promise.resolve(
          reads === 2
            ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
            : { pullRequest: CONVERSATION },
        );
      },
    }),
  );
  writeComment(tab, "Half a thought");

  const more =
    tab.querySelector<HTMLButtonElement>('[aria-label="Pull request actions"]') ??
    assert.fail("the header has a ⋯");
  act(() => more.click());
  const refresh =
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Refresh pull request",
    ) ?? assert.fail("the ⋯ offers Refresh");
  await act(async () => refresh.click());
  await settle();
  assert.equal(
    tab.querySelector(".pull-request-comment-box"),
    null,
    "the failed read takes it away",
  );

  const retry =
    [...tab.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Retry",
    ) ?? assert.fail("the failed conversation offers Retry");
  await act(async () => retry.click());
  await settle();

  assert.equal(
    tab.querySelector<HTMLTextAreaElement>(".pull-request-comment-box textarea")?.value,
    "Half a thought",
  );
});

/** The head the changes were read at, which a comment on their lines names. */
const READ_HEAD = "c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe";

/** One changed file whose hunk is the review threads' own: old lines 8–12, the last removed, and new lines 8–13, the last two added. */
const INVITE_FILE = {
  path: "src/invite.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  omitted: null,
  patch: thread().diffHunk.replace("@@ -8,6 +8,7 @@", "@@ -8,5 +8,6 @@"),
};

/** The tab over that one file, read at `READ_HEAD`, its conversation holding the member's pending review as given; a read of the changes after the first answers `reread` in its place where one is given. */
async function drawCommentable(
  pendingReview?: { readonly comments: number } | null,
  reread: typeof INVITE_FILE = INVITE_FILE,
) {
  const read = { changes: 0 };
  const tab = await draw(
    controlAnswering(
      {
        conversation: () =>
          Promise.resolve({
            pullRequest: {
              ...CONVERSATION,
              ...(pendingReview === undefined ? undefined : { pendingReview }),
            },
          }),
      },
      PULL_REQUEST_STATE.OPEN,
      () => {
        read.changes += 1;
        return Promise.resolve({
          pullRequest: {
            url: PAGE,
            headSha: READ_HEAD,
            truncated: false,
            files: [read.changes === 1 ? INVITE_FILE : reread],
          },
        });
      },
    ),
  );
  await act(async () => option(tab, "Files changed").click());
  await settle();
  return { tab };
}

/** Presses the gutter's + on the lines given of the file, as the diff bundle tells the view, and the comment it opened. */
async function pickLines(selection: DiffListSelection["selection"]): Promise<HTMLElement> {
  const drawn = lists.at(-1) ?? assert.fail("the files are drawn");
  const onComment = drawn.onComment ?? assert.fail("the gutter offers a comment");
  act(() => onComment({ path: INVITE_FILE.path, selection }));
  await settle();
  return commentNotes().at(-1)?.element ?? assert.fail("the pick opens a comment");
}

/** The comments the files' last draw stands under their lines, in the order they were opened: each note's place and the element drawn in it. */
function commentNotes() {
  const drawn = lists.at(-1);
  if (drawn === undefined) return [];
  return drawn.files
    .flatMap((file) =>
      file.annotations.map((note) => ({
        path: file.path,
        side: note.side,
        line: note.line,
        element: drawn.renderAnnotation(file.path, note.key),
      })),
    )
    .filter((note) => note.element.querySelector(".line-comment") !== null);
}

/** Writes the comment's words as the member would. */
function writeLineComment(comment: HTMLElement, words: string): void {
  const field =
    comment.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]') ??
    assert.fail("the comment has a field for its words");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The comment's press of the words given. */
function commentOffer(comment: HTMLElement, label: string): HTMLButtonElement {
  return (
    [...comment.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`the comment offers ${label}`)
  );
}

/** Whether the files' last draw stands a comment under a line. */
function commentDrawn(): boolean {
  return commentNotes().length > 0;
}

test("the gutter's + opens a comment under the last line picked, however the pick was dragged, its lines lit; Add single comment sends it for the agent at the head the files were read at, after which it closes and lets its words go", async () => {
  await drawCommentable();

  const comment = await pickLines({
    start: 13,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });

  assert.equal(comment.querySelector(".line-comment-head")?.textContent, "Comment on lines 12–13");
  assert.deepEqual(
    commentNotes().map(({ path, side, line }) => ({ path, side, line })),
    [{ path: INVITE_FILE.path, side: DIFF_SELECTION_SIDE.ADDITIONS, line: 13 }],
  );
  assert.equal(lists.at(-1)?.selected?.path, INVITE_FILE.path);
  assert.deepEqual(
    [...comment.querySelectorAll(".line-comment-foot button")].map((each) => each.textContent),
    ["Cancel", "Add single comment", "Start a review"],
  );

  writeLineComment(comment, "Why **twice**?");
  act(() => commentOffer(comment, "Add single comment").click());
  await settle();

  assert.deepEqual(changes, [
    [
      AGENT.id,
      {
        action: PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT,
        mode: REVIEW_COMMENT_MODE.SINGLE,
        path: INVITE_FILE.path,
        line: 13,
        side: DIFF_SIDE.RIGHT,
        startLine: 12,
        startSide: DIFF_SIDE.RIGHT,
        body: "Why **twice**?",
        headSha: READ_HEAD,
      },
    ],
  ]);
  assert.equal(commentDrawn(), false, "the comment closes once GitHub took it");
  assert.equal(lists.at(-1)?.selected, undefined, "its lines are no longer lit");
  const again = await pickLines({
    start: 12,
    side: DIFF_SELECTION_SIDE.DELETIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.DELETIONS,
  });
  assert.equal(again.querySelector("textarea")?.value, "", "its words were let go");
  assert.equal(again.querySelector(".line-comment-head")?.textContent, "Comment on line 12");
});

test("several comments stand open at once, each under its own lines with its own words, the last opened lit; one closed unsent comes back with its words, and lines ending where an open one ends move it rather than open another", async () => {
  await drawCommentable();
  const added = {
    start: 12,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  };
  const removed = {
    start: 12,
    side: DIFF_SELECTION_SIDE.DELETIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.DELETIONS,
  };
  writeLineComment(await pickLines(added), "Why twice?");
  writeLineComment(await pickLines(removed), "Gone?");

  const heads = () =>
    commentNotes().map((note) => note.element.querySelector(".line-comment-head")?.textContent);
  const words = () => commentNotes().map((note) => note.element.querySelector("textarea")?.value);
  assert.deepEqual(heads(), ["Comment on lines 12–13", "Comment on line 12"]);
  assert.deepEqual(words(), ["Why twice?", "Gone?"]);
  assert.deepEqual(lists.at(-1)?.selected, { path: INVITE_FILE.path, selection: removed });

  const [first] = commentNotes();
  act(() => commentOffer(first?.element ?? assert.fail("the first stands"), "Cancel").click());
  await settle();
  assert.deepEqual(heads(), ["Comment on line 12"], "Cancel closes that comment alone");
  assert.deepEqual(lists.at(-1)?.selected, { path: INVITE_FILE.path, selection: removed });

  await pickLines({ ...added, start: 13 });
  assert.deepEqual(heads(), ["Comment on line 12", "Comment on line 13"]);
  assert.deepEqual(words(), ["Gone?", "Why twice?"], "the words written there come back");
  await pickLines(added);
  assert.deepEqual(
    heads(),
    ["Comment on line 12", "Comment on lines 12–13"],
    "lines ending on the same line move the comment there",
  );
});

test("a comment opened on lines takes the keyboard once the list stands its note in the window", async () => {
  await drawCommentable();
  const comment = await pickLines({
    start: 13,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });
  const field =
    comment.querySelector<HTMLTextAreaElement>("textarea") ?? assert.fail("the comment has words");
  assert.notEqual(document.activeElement, field, "a note not yet in the window takes nothing");

  document.body.append(comment);
  await settle();
  assert.equal(document.activeElement, field);
});

test("code selected as text on lines GitHub takes a comment on is offered a Comment press, which opens a comment on those lines; elsewhere, or once let go, nothing is offered", async () => {
  const { tab } = await drawCommentable();
  const tellText = lists.at(-1)?.onSelectText ?? assert.fail("the list hears selected text");
  const rect = { top: 120, left: 40, right: 200, bottom: 160 };
  const offer = () => tab.querySelector<HTMLButtonElement>(".diff-list-offer button");

  act(() =>
    tellText({
      picked: {
        path: INVITE_FILE.path,
        selection: {
          start: 30,
          side: DIFF_SELECTION_SIDE.ADDITIONS,
          end: 31,
          endSide: DIFF_SELECTION_SIDE.ADDITIONS,
        },
      },
      rect,
    }),
  );
  assert.equal(offer(), null, "lines no hunk holds are offered nothing");

  const selection = {
    start: 12,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  };
  act(() => tellText({ picked: { path: INVITE_FILE.path, selection }, rect }));
  assert.equal(offer()?.getAttribute("aria-label"), "Comment on lines 12–13");
  act(() => tellText(undefined));
  assert.equal(offer(), null, "a selection let go takes its offer with it");

  act(() => tellText({ picked: { path: INVITE_FILE.path, selection }, rect }));
  act(() => offer()?.click());
  await settle();
  assert.equal(offer(), null);
  assert.deepEqual(
    commentNotes().map((note) => note.element.querySelector(".line-comment-head")?.textContent),
    ["Comment on lines 12–13"],
  );
});

/** The comment's formatting press named `label`, where its toolbar offers one. */
function formatPress(comment: HTMLElement, label: string): HTMLButtonElement | null {
  return comment.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`);
}

test("a comment on the head's lines offers a suggestion, which writes them as they read now for the member to change, previewed as a suggested change and sent as GitHub's suggestion block; one on the old side offers none", async () => {
  await drawCommentable();
  const comment = await pickLines({
    start: 12,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });
  writeLineComment(comment, "Say it once:");
  const field =
    comment.querySelector<HTMLTextAreaElement>("textarea") ?? assert.fail("the comment has words");
  field.setSelectionRange(field.value.length, field.value.length);

  act(() =>
    (formatPress(comment, "Add a suggestion") ?? assert.fail("a suggestion is offered")).click(),
  );

  const block = "```suggestion\n  once();\n  done();\n```";
  assert.equal(field.value, `Say it once:\n${block}`);
  assert.equal(
    field.value.slice(field.selectionStart, field.selectionEnd),
    "  once();\n  done();",
    "the lines stand selected to be changed",
  );
  act(() =>
    (
      [...comment.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (each) => each.textContent === "Preview",
      ) ?? assert.fail("the comment offers Preview")
    ).click(),
  );
  assert.equal(comment.querySelector(".transcript-code-header")?.textContent, "Suggested change");
  act(() => commentOffer(comment, "Add single comment").click());
  await settle();
  const sent = changes.at(-1)?.[1];
  assert.ok(sent?.action === PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT, "the comment is sent");
  assert.equal(sent.body, `Say it once:\n${block}`);

  const old = await pickLines({
    start: 12,
    side: DIFF_SELECTION_SIDE.DELETIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.DELETIONS,
  });
  assert.equal(
    formatPress(old, "Add a suggestion"),
    null,
    "the old side's lines take no suggestion",
  );
  assert.notEqual(formatPress(old, "Bold"), null, "it still formats its words");
});

test("the toolbar wraps the comment's selection, and ⌘B in its words does the same without the window's keymap hearing it", async () => {
  await drawCommentable();
  const comment = await pickLines({
    start: 13,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 13,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });
  writeLineComment(comment, "Why twice?");
  const field =
    comment.querySelector<HTMLTextAreaElement>("textarea") ?? assert.fail("the comment has words");
  const heard: string[] = [];
  const hear = (event: KeyboardEvent) => heard.push(event.key);
  window.addEventListener("keydown", hear);
  try {
    field.setSelectionRange(4, 9);
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    });
    assert.equal(field.value, "Why **twice**?");
    assert.deepEqual(heard, [], "the chord is the field's");

    act(() => (formatPress(comment, "Italic") ?? assert.fail("italic is offered")).click());
    assert.equal(field.value, "Why **_twice_**?");
  } finally {
    window.removeEventListener("keydown", hear);
  }
});

test("a member holding a pending review adds a comment to it and nothing else, and Review counts its comments and offers to discard it, asking first", async () => {
  const { tab } = await drawCommentable({ comments: 2 });

  const comment = await pickLines({
    start: 12,
    side: DIFF_SELECTION_SIDE.DELETIONS,
    end: 12,
    endSide: DIFF_SELECTION_SIDE.DELETIONS,
  });
  assert.deepEqual(
    [...comment.querySelectorAll(".line-comment-foot button")].map((each) => each.textContent),
    ["Cancel", "Add review comment"],
  );
  writeLineComment(comment, "Gone?");
  act(() => commentOffer(comment, "Add review comment").click());
  await settle();

  const review =
    tab.querySelector<HTMLButtonElement>('[aria-label="Review, 2 pending comments"]') ??
    assert.fail("Review counts the pending comments");
  act(() => review.click());
  const panel =
    tab.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("Review opens its panel");
  assert.match(panel.textContent ?? "", /2 pending comments will be published\./u);
  act(() => commentOffer(panel, "Discard").click());
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ??
    assert.fail("Discard asks first");
  act(() => commentOffer(question, "Discard review").click());
  await settle();

  assert.deepEqual(
    changes.map(([, request]) => request),
    [
      {
        action: PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT,
        mode: REVIEW_COMMENT_MODE.REVIEW,
        path: INVITE_FILE.path,
        line: 12,
        side: DIFF_SIDE.LEFT,
        body: "Gone?",
        headSha: READ_HEAD,
      },
      { action: PULL_REQUEST_ACTION.DISCARD_REVIEW },
    ],
  );
});

test("a comment GitHub refuses says so under it in GitHub's own words, its words kept, beside Refresh changes, which draws the files as read again", async () => {
  changeAnswer = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED,
    words: "Pull request review thread line must be part of the diff",
  };
  await drawCommentable(undefined, { ...INVITE_FILE, additions: 5 });
  const lines = () =>
    lists.at(-1)?.renderHeader(INVITE_FILE.path).querySelector(".agent-published-added")
      ?.textContent;
  const comment = await pickLines({
    start: 9,
    side: DIFF_SELECTION_SIDE.ADDITIONS,
    end: 9,
    endSide: DIFF_SELECTION_SIDE.ADDITIONS,
  });

  writeLineComment(comment, "Here.");
  act(() => commentOffer(comment, "Start a review").click());
  await settle();

  assert.equal(
    comment.querySelector(".line-comment-note [role='alert']")?.textContent,
    "GitHub said: Pull request review thread line must be part of the diff",
  );
  assert.equal(comment.querySelector("textarea")?.value, "Here.");
  assert.match(lines() ?? "", /\+2/u);
  act(() => commentOffer(comment, "Refresh changes").click());
  await settle();
  assert.match(lines() ?? "", /\+5/u, "the files are drawn as read again");
});

test("Discard's question stands busy until GitHub answers, and says GitHub's refusal in its words", async () => {
  const held = Promise.withResolvers<void>();
  changeHeld = held.promise;
  changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: "Review is not pending" };
  const { tab } = await drawCommentable({ comments: 1 });
  act(() =>
    (
      tab.querySelector<HTMLButtonElement>('[aria-label="Review, 1 pending comment"]') ??
      assert.fail("Review counts the pending comment")
    ).click(),
  );
  const panel =
    tab.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("Review opens its panel");
  act(() => commentOffer(panel, "Discard").click());
  const question = () =>
    document.querySelector<HTMLElement>('[role="alertdialog"]') ??
    assert.fail("Discard asks first");
  act(() => commentOffer(question(), "Discard review").click());
  await settle();

  assert.equal(question().getAttribute("aria-busy"), "true", "the question waits on GitHub");
  held.resolve();
  await settle();
  assert.match(question().textContent ?? "", /GitHub said: Review is not pending/u);
});

test("a merge asked about goes with its panel: hidden, the question is let go and nothing merges, and shown again it asks nothing", async () => {
  let show: (shown: boolean) => void = () => undefined;
  function Hiding() {
    const [shown, setShown] = useState(true);
    show = setShown;
    return createElement(AgentPullRequestTab, {
      agentId: AGENT.id,
      control: merging(MERGE_STATE.CLEAN),
      shown,
      repository: "acme/relay",
      tree: { open: false, onToggle: () => undefined },
      view: PULL_REQUEST_VIEW.CONVERSATION,
      onView: () => undefined,
    });
  }
  const tab = await drawn(createElement(Hiding));
  // Note that the question is read as whether it stands, so a failure prints a word rather than a whole DOM node.
  const question = () => document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

  await pressBox(tab, "Squash and merge");
  assert.equal(question(), true, "the merge is asked about");
  act(() => show(false));
  assert.equal(question(), false, "the question goes as its panel hides");
  act(() => show(true));
  await settle();

  assert.equal(question(), false, "the panel comes back asking nothing");
  assert.deepEqual(changes, []);
});

/** The thread the jumps below land on, by GitHub's node id. */
const JUMPED = "PRRT_kwDOjump";

/** The route's opener the last `Routed` drew, as a link pressed anywhere in the window reaches it. */
let routeOpen: (link: ReadLink) => void = () => undefined;

/** The Pull request tab inside the window's route for a review thread's link, as `openLink` takes it: the view the link names chosen, and the ask left for the tab; every link opened heard. */
function Routed({
  control,
  heard,
  first = PULL_REQUEST_VIEW.CONVERSATION,
}: {
  control: CodingAgentsControl;
  heard: ReadLink[];
  first?: PullRequestView;
}) {
  const [view, setView] = useState<PullRequestView>(first);
  const [reveal, setReveal] = useState<ThreadReveal | undefined>(undefined);
  const open = (link: ReadLink) => {
    heard.push(link);
    const { place } = link;
    if (place.kind !== LINK_PLACE.PULL_REQUEST_THREAD) return;
    setView(place.view);
    setReveal((last) => ({
      agentId: place.agentId,
      threadId: place.threadId,
      view: place.view,
      ask: (last?.ask ?? 0) + 1,
    }));
  };
  routeOpen = open;
  return createElement(
    OpenLinkProvider,
    { value: open },
    createElement(
      ThreadRevealProvider,
      {
        value: {
          reveal,
          onRevealed: (ask: number) => setReveal((last) => (last?.ask === ask ? undefined : last)),
        },
      },
      createElement(AgentPullRequestTab, {
        agentId: AGENT.id,
        control,
        shown: true,
        repository: "acme/relay",
        tree: { open: false, onToggle: () => undefined },
        view,
        onView: setView,
      }),
    ),
  );
}

/** A control whose conversation holds the threads given and whose changes hold the files given. */
function jumpControl(
  threads: readonly ReviewThread[],
  files: readonly (typeof INVITE_FILE)[] = [INVITE_FILE],
): CodingAgentsControl {
  return controlAnswering(
    { conversation: () => Promise.resolve({ pullRequest: reviewWith(threads) }) },
    PULL_REQUEST_STATE.OPEN,
    () =>
      Promise.resolve({ pullRequest: { url: PAGE, headSha: READ_HEAD, truncated: false, files } }),
  );
}

/** Lets the frames a landing waits on pass. */
async function frames(count = 3): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
}

/** A thread's head press in the Conversation, which takes it to Files changed. */
function headPress(tab: HTMLElement): HTMLButtonElement {
  return (
    tab.querySelector<HTMLButtonElement>('button[aria-label^="View in Files changed"]') ??
    assert.fail("the thread's file and lines take it to Files changed")
  );
}

/** Ends a card's ring, as its animation would. Note that jsdom has no AnimationEvent, so React hears the prefixed name there, which is sent beside the standard one. */
function ringEnds(card: Element): void {
  for (const name of ["animationend", "webkitAnimationEnd"]) {
    const end = new Event(name, { bubbles: true });
    Object.defineProperty(end, "animationName", { value: "search-landed" });
    act(() => card.dispatchEvent(end));
  }
}

/** A thread's ⋯ opened and the item named pressed. */
async function threadMenuItem(card: Element, label: string): Promise<void> {
  act(() =>
    (
      card.querySelector<HTMLButtonElement>('button[aria-label="Comment actions"]') ??
      assert.fail("the thread has its ⋯")
    ).click(),
  );
  const item =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent?.includes(label) === true,
    ) ?? assert.fail(`the ⋯ offers ${label}`);
  act(() => item.click());
  await settle();
}

test("a thread's file and lines in the Conversation take it to Files changed through the window's route for its link: its collapsed file opened, its minimized chip shown, the list scrolled to its line, its lines lit, the thread ringed and focused, and the lines let go as the ring ends", async () => {
  handSettings();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const heard: ReadLink[] = [];
  const tab = await drawn(
    createElement(Routed, { control: jumpControl([thread({ id: JUMPED })]), heard }),
  );
  // The member collapsed the file and minimized the comments in Files changed before.
  await choose(tab, "Files changed");
  const header = (lists.at(-1) ?? assert.fail("the files are drawn")).renderHeader(
    INVITE_FILE.path,
  );
  act(() => header.querySelector<HTMLButtonElement>('button[aria-label="Collapse file"]')?.click());
  act(() => tab.querySelector<HTMLButtonElement>('button[aria-label="View settings"]')?.click());
  act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
      .find((each) => each.getAttribute("aria-label") === "Minimize inline comments")
      ?.click(),
  );
  act(() => tab.querySelector<HTMLButtonElement>('button[aria-label="View settings"]')?.click());
  await settle();
  assert.equal(lists.at(-1)?.files[0]?.collapsed, true, "the file stands collapsed");
  await choose(tab, "Conversation");

  act(() => headPress(tab).click());
  await settle();

  assert.deepEqual(heard.at(-1)?.place, {
    kind: LINK_PLACE.PULL_REQUEST_THREAD,
    planId: AGENT.planId,
    agentId: AGENT.id,
    threadId: JUMPED,
    view: PULL_REQUEST_THREAD_VIEW.FILES,
  });
  assert.equal(option(tab, "Files changed").getAttribute("aria-selected"), "true");
  const list = lists.at(-1) ?? assert.fail("the files are drawn");
  assert.equal(list.files[0]?.collapsed, false, "the file is opened");
  assert.deepEqual(listReveals, [`${INVITE_FILE.path}:additions:13`]);
  const lit = {
    path: INVITE_FILE.path,
    selection: {
      start: 12,
      side: DIFF_SELECTION_SIDE.ADDITIONS,
      end: 13,
      endSide: DIFF_SELECTION_SIDE.ADDITIONS,
    },
  };
  assert.deepEqual(list.selected, lit);
  const note = list.renderAnnotation(INVITE_FILE.path, `${PAGE}#discussion_r1`);
  const card =
    note.querySelector(".diff-inline-thread") ?? assert.fail("the chip shows its thread");

  // Pierre draws the thread's note into the list, where it stands in sight.
  (tab.querySelector(".diff-list") ?? assert.fail("the list's box")).appendChild(note);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
  await frames();

  assert.equal(card.hasAttribute("data-search-landed"), true, "the thread is ringed");
  assert.equal(document.activeElement, card.querySelector("summary"), "the thread takes the focus");
  ringEnds(card);
  assert.equal(lists.at(-1)?.selected, undefined, "its lines are let go as the ring ends");
  assert.equal(card.hasAttribute("data-search-landed"), false);
});

test("a thread on a line no hunk shows, and one a later push outdated, land on their file's list above its diff, opened, the list scrolled to the file's header", async () => {
  const outside = thread({
    id: JUMPED,
    line: 40,
    startLine: 40,
    originalLine: 40,
    originalStartLine: 40,
  });
  const outdated = thread({
    id: "PRRT_kwDOgone",
    line: null,
    startLine: null,
    outdated: true,
    comments: [
      { ...(thread().comments[0] ?? assert.fail("a comment")), url: `${PAGE}#discussion_r2` },
    ],
  });
  const tab = await draw(jumpControl([outside, outdated]));

  act(() => headPress(tab).click());
  await settle();
  assert.equal(option(tab, "Files changed").getAttribute("aria-selected"), "true");
  assert.deepEqual(listReveals, [INVITE_FILE.path]);

  await choose(tab, "Conversation");
  const folded =
    [...tab.querySelectorAll<HTMLElement>(".pull-request-thread")].find((each) =>
      threadLabels(each).includes("Outdated"),
    ) ?? assert.fail("the outdated thread is drawn");
  assert.equal(folded.querySelector("details")?.open, false, "an outdated thread stands folded");
  await threadMenuItem(folded, "View in Files changed");

  assert.deepEqual(listReveals, [INVITE_FILE.path, INVITE_FILE.path]);
  const above = (lists.at(-1) ?? assert.fail("the files are drawn")).renderAnnotation(
    INVITE_FILE.path,
    "above-additions",
  );
  const opened = [...above.querySelectorAll<HTMLElement>(".diff-inline-thread")].map(
    (each) => each.querySelector("details")?.open,
  );
  assert.deepEqual(opened, [true, true], "the outdated thread is opened above the diff");
});

test("a thread whose file the changes no longer hold stays in the Conversation, brought into view there; a link to one the conversation no longer holds is let go", async () => {
  const heard: ReadLink[] = [];
  const tab = await drawn(
    createElement(Routed, {
      control: jumpControl([thread({ id: JUMPED, path: "src/gone.ts" })]),
      heard,
    }),
  );

  act(() => headPress(tab).click());
  await settle();
  await frames();

  assert.equal(option(tab, "Conversation").getAttribute("aria-selected"), "true");
  assert.deepEqual(listReveals, [], "no file is scrolled to");
  const card = tab.querySelector(".pull-request-thread") ?? assert.fail("the thread stands");
  assert.equal(card.hasAttribute("data-search-landed"), true, "the thread is shown where it stays");

  ringEnds(card);
  act(() =>
    routeOpen({
      workspace: "acme",
      place: {
        kind: LINK_PLACE.PULL_REQUEST_THREAD,
        planId: AGENT.planId ?? "",
        agentId: AGENT.id,
        threadId: "PRRT_kwDOnone",
        view: PULL_REQUEST_THREAD_VIEW.CONVERSATION,
      },
    }),
  );
  await settle();
  await frames();
  assert.equal(card.hasAttribute("data-search-landed"), false, "nothing is landed on");
});

test("a thread's ⋯ in Files changed shows it in the Conversation through the same route, standing through Hide resolved, ringed and focused there", async () => {
  window.localStorage.clear();
  const heard: ReadLink[] = [];
  const resolved = thread({ id: JUMPED, resolved: true });
  const tab = await drawn(
    createElement(Routed, {
      control: jumpControl([resolved]),
      heard,
      first: PULL_REQUEST_VIEW.FILES,
    }),
  );
  await choose(tab, "Conversation");
  act(() => filter(tab, "Hide resolved").click());
  await settle();
  assert.equal(tab.querySelector(".pull-request-thread"), null, "Hide resolved leaves it out");
  await choose(tab, "Files changed");
  const note = (lists.at(-1) ?? assert.fail("the files are drawn")).renderAnnotation(
    INVITE_FILE.path,
    `${PAGE}#discussion_r1`,
  );
  document.body.appendChild(note);

  await threadMenuItem(note, "View in Conversation");
  await frames();

  assert.equal(heard.at(-1)?.place.kind, LINK_PLACE.PULL_REQUEST_THREAD);
  assert.equal(option(tab, "Conversation").getAttribute("aria-selected"), "true");
  const card = tab.querySelector(".pull-request-thread") ?? assert.fail("the thread stands");
  assert.equal(card.querySelector("details")?.open, true, "the resolved thread is opened");
  assert.equal(card.hasAttribute("data-search-landed"), true);
  assert.equal(document.activeElement, card.querySelector("summary"));
});

test("Copy link in a thread's ⋯ copies its Luke link in the view it is drawn in; a thread with no id offers no ⋯ and no press to Files changed", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...DESKTOP_LINKS, ...copyingInto(copied) });
  const tab = await drawn(
    createElement(
      LinkWorkspaceProvider,
      { value: "acme" },
      createElement(Switching, {
        control: jumpControl([thread({ id: JUMPED }), thread({ comments: [] })]),
        first: PULL_REQUEST_VIEW.CONVERSATION,
      }),
    ),
  );
  const [card] = tab.querySelectorAll(".pull-request-thread");

  await threadMenuItem(card ?? assert.fail("the thread is drawn"), "Copy link");

  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${AGENT.planId}/agent/${AGENT.id}/changes/conversation/thread/${JUMPED}`,
  ]);
});

test("a link in the pull request's words to one of its own comments on GitHub opens it in the tab: a line comment through its thread's route, a comment brought into view, ringed and focused; one the read did not reach opens on GitHub", async () => {
  const heard: ReadLink[] = [];
  const links = [
    `<a href="${PAGE}#discussion_r1">the thread</a>`,
    `<a href="${PAGE}#issuecomment-2">the note</a>`,
    `<a href="${PAGE}#issuecomment-99">an older note</a>`,
  ].join(" ");
  const conversation = reviewWith([thread({ id: JUMPED })]);
  const tab = await drawn(
    createElement(Routed, {
      control: controlAnswering({
        pullRequest: () =>
          Promise.resolve({ pullRequest: { ...PULL_REQUEST, html: `<p>See ${links}.</p>` } }),
        conversation: () =>
          Promise.resolve({
            pullRequest: {
              ...conversation,
              conversation: [...conversation.conversation, ...CONVERSATION.conversation.slice(-1)],
            },
          }),
      }),
      heard,
    }),
  );
  const press = async (words: string) => {
    const link =
      [...tab.querySelectorAll<HTMLElement>(".pull-request-words a")].find(
        (each) => each.textContent === words,
      ) ?? assert.fail(`the description links ${words}`);
    await act(async () => link.click());
    await settle();
  };

  await press("the thread");
  assert.deepEqual(heard.at(-1)?.place, {
    kind: LINK_PLACE.PULL_REQUEST_THREAD,
    planId: AGENT.planId,
    agentId: AGENT.id,
    threadId: JUMPED,
    view: PULL_REQUEST_THREAD_VIEW.CONVERSATION,
  });

  await press("the note");
  await frames();
  const note =
    [...tab.querySelectorAll<HTMLElement>(".pull-request-entry")].find((each) =>
      each.textContent?.includes("GitHub sent no rendering of"),
    ) ?? assert.fail("the note is drawn");
  assert.equal(note.hasAttribute("data-search-landed"), true, "the note is ringed");
  assert.equal(document.activeElement, note, "the note takes the focus");
  ringEnds(note);
  act(() => note.blur());
  await press("the note");
  await frames();
  assert.equal(
    note.hasAttribute("data-search-landed"),
    true,
    "the same link pressed again lands again",
  );
  assert.equal(document.activeElement, note);

  await press("an older note");
  assert.deepEqual(
    opened,
    [`${PAGE}#issuecomment-99`],
    "only the note the read did not reach leaves for GitHub",
  );
});

test("a thread on a changed image a filter left out lands above its picture once the filter is cleared, the list scrolled to the file's header rather than a line the picture draws none of", async () => {
  const logo = {
    path: "assets/logo.svg",
    previousPath: null,
    status: CHANGED_FILE_STATUS.MODIFIED,
    additions: 1,
    deletions: 1,
    omitted: null,
    patch: "@@ -1,3 +1,3 @@\n <svg>\n-<rect/>\n+<circle/>\n </svg>",
  };
  const onLogo = thread({
    id: JUMPED,
    path: logo.path,
    line: 2,
    startLine: null,
    originalLine: 2,
    originalStartLine: null,
    startSide: null,
  });
  // The picture is read as it comes near the view, which nothing here watches.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  function WithTree() {
    const [view, setView] = useState<PullRequestView>(PULL_REQUEST_VIEW.FILES);
    return createElement(AgentPullRequestTab, {
      agentId: AGENT.id,
      control: jumpControl([onLogo], [INVITE_FILE, logo]),
      shown: true,
      repository: "acme/relay",
      tree: { open: true, onToggle: () => undefined },
      view,
      onView: setView,
    });
  }
  const tab = await drawn(createElement(WithTree));
  const field =
    tab.querySelector<HTMLInputElement>('input[aria-label="Search files"]') ??
    assert.fail("the tree's search stands");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "src");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  assert.deepEqual(
    lists.at(-1)?.files.map((file) => file.path),
    [INVITE_FILE.path],
    "the filter leaves the image out",
  );
  await choose(tab, "Conversation");

  act(() => headPress(tab).click());
  await settle();

  assert.deepEqual(listReveals, [logo.path]);
  const list = lists.at(-1) ?? assert.fail("the files are drawn");
  assert.ok(
    list.files.some((file) => file.path === logo.path),
    "the filter is cleared",
  );
  const holding = (list.files.find((file) => file.path === logo.path)?.annotations ?? []).find(
    (note) =>
      list.renderAnnotation(logo.path, note.key).querySelector(".diff-inline-thread") !== null,
  );
  assert.equal(holding?.line, 0, "the thread stands above the picture, on no line of it");
});

test("a landing waits for the panel to be visible before it takes the focus, as a panel still arriving refuses it", async () => {
  const heard: ReadLink[] = [];
  const tab = await drawn(
    createElement(Routed, {
      control: jumpControl([thread({ id: JUMPED, path: "src/gone.ts" })]),
      heard,
    }),
  );
  tab.style.visibility = "hidden";

  act(() => headPress(tab).click());
  await settle();
  await frames();
  const card = tab.querySelector(".pull-request-thread") ?? assert.fail("the thread stands");
  assert.equal(card.hasAttribute("data-search-landed"), false, "nothing lands on a hidden panel");

  tab.style.visibility = "visible";
  await frames();
  assert.equal(
    card.hasAttribute("data-search-landed"),
    true,
    "the landing ends once the panel is seen",
  );
  assert.equal(document.activeElement, card.querySelector("summary"));
});

/** Three files of differing sizes, +60 −7 in all, as the changes read names them. */
const SIZED = [
  ["a.ts", 10, 2],
  ["b.ts", 20, 5],
  ["c.ts", 30, 0],
] as const;

/** The plan's agents, the pull request published at the size given (+60 −7 unless told), its changes those three files, read in full unless told, and the member's marks as given. */
function viewing(
  marked: readonly string[],
  options: { readonly published?: readonly [number, number]; readonly truncated?: boolean } = {},
) {
  const [additions, deletions] = options.published ?? [60, 7];
  const control: CodingAgentsControl = {
    ...controlAnswering({}, PULL_REQUEST_STATE.OPEN, () =>
      Promise.resolve({
        pullRequest: {
          url: PAGE,
          truncated: options.truncated ?? false,
          files: SIZED.map(([path, additions, deletions]) => ({
            path,
            previousPath: null,
            status: CHANGED_FILE_STATUS.MODIFIED,
            additions,
            deletions,
            patch: "@@ -1 +1 @@\n-a\n+b\n",
            omitted: null,
          })),
        },
      }),
    ),
    pullRequests: new Map([
      [AGENT.id, { ...published(PULL_REQUEST_STATE.OPEN), additions, deletions }],
    ]),
    readPullRequestViewed: () =>
      Promise.resolve({
        outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
        files: SIZED.map(([path]) => ({
          path,
          state: marked.includes(path) ? FILE_VIEWED_STATE.VIEWED : FILE_VIEWED_STATE.UNVIEWED,
        })),
      }),
  };
  return { control };
}

/** A file's Viewed box, in the header Files changed's list draws for it. */
function viewedBoxOf(path: string): HTMLInputElement {
  const list = lists.at(-1) ?? assert.fail("Files changed draws its list");
  const head = list.renderHeader(path);
  if (!head.isConnected) document.body.append(head);
  return (
    head.querySelector<HTMLInputElement>('.diff-list-viewed input[type="checkbox"]') ??
    assert.fail(`${path} offers a Viewed box`)
  );
}

/** What the Files changed tab's hint says, once the pointer rests on it. */
async function filesHint(tab: HTMLElement): Promise<string | undefined> {
  const files = option(tab, "Files changed");
  act(() => files.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
  await settle();
  const hint = files.getAttribute("aria-describedby");
  return hint === null ? undefined : (document.getElementById(hint)?.textContent ?? undefined);
}

test("Files changed counts what was published until it is first opened; then it counts the lines left to review, the whole in its hint", async () => {
  const tab = await draw(viewing(["a.ts"]).control);
  assert.equal(tabCount(tab, "Files changed"), "+60 −7");

  await choose(tab, "Files changed");
  assert.equal(tabCount(tab, "Files changed"), "+50 −5 left");
  assert.equal(await filesHint(tab), "+60 −7 total");
  await choose(tab, "Conversation");
  assert.equal(tabCount(tab, "Files changed"), "+50 −5 left", "the count stands on another tab");
});

test("ticking a file's Viewed box counts it at once, before GitHub answers, and one GitHub refuses counts again as its mark goes back", async () => {
  const { control } = viewing(["a.ts"]);
  const tab = await draw(control, PULL_REQUEST_VIEW.FILES);
  assert.equal(tabCount(tab, "Files changed"), "+50 −5 left");

  const { promise, resolve } = Promise.withResolvers<void>();
  changeHeld = promise;
  act(() => viewedBoxOf("c.ts").click());
  assert.equal(tabCount(tab, "Files changed"), "+20 −5 left", "the tick counts at once");
  resolve();
  await settle();
  assert.equal(tabCount(tab, "Files changed"), "+20 −5 left");

  changeHeld = undefined;
  changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.REFUSED, words: "Pull request is locked." };
  act(() => viewedBoxOf("b.ts").click());
  await settle();
  assert.equal(tabCount(tab, "Files changed"), "+20 −5 left", "a refused mark counts again");
  assert.deepEqual(
    changes.map(([, request]) => request),
    [
      { action: PULL_REQUEST_ACTION.MARK_FILE_VIEWED, path: "c.ts" },
      { action: PULL_REQUEST_ACTION.MARK_FILE_VIEWED, path: "b.ts" },
    ],
  );
});

test("with every file viewed, or none, Files changed counts the whole and hints nothing more", async () => {
  for (const marked of [["a.ts", "b.ts", "c.ts"], []]) {
    const tab = await draw(viewing(marked).control, PULL_REQUEST_VIEW.FILES);
    assert.equal(tabCount(tab, "Files changed"), "+60 −7", `${marked.length} viewed`);
    assert.equal(option(tab, "Files changed").getAttribute("aria-describedby"), null);
    act(() => root?.unmount());
    root = undefined;
  }
});

test("ticking the last file left counts the whole again, every file viewed", async () => {
  const tab = await draw(viewing(["a.ts", "b.ts"]).control, PULL_REQUEST_VIEW.FILES);
  assert.equal(tabCount(tab, "Files changed"), "+30 −0 left");
  act(() => viewedBoxOf("c.ts").click());
  await settle();
  assert.equal(tabCount(tab, "Files changed"), "+60 −7");
});

test("once its files are read, Files changed counts from their own whole, so a pull request pushed to since it was published counts what the read holds", async () => {
  const tab = await draw(viewing(["a.ts"], { published: [40, 5] }).control);
  assert.equal(
    tabCount(tab, "Files changed"),
    "+40 −5",
    "until the files land, what was published",
  );
  await choose(tab, "Files changed");
  assert.equal(tabCount(tab, "Files changed"), "+50 −5 left");
  assert.equal(await filesHint(tab), "+60 −7 total");
});

test("where the read stopped short of every file, the whole is what was published, and every file read being viewed still leaves the rest to review", async () => {
  const tab = await draw(
    viewing(["a.ts", "b.ts", "c.ts"], { published: [100, 20], truncated: true }).control,
    PULL_REQUEST_VIEW.FILES,
  );
  assert.equal(tabCount(tab, "Files changed"), "+40 −13 left");
  assert.equal(await filesHint(tab), "+100 −20 total");
});

/** A comment of the member's own pending review on the invite file, starting a thread of its own on line 12 unless told otherwise. */
function draftOf(overrides: Partial<PendingReviewComment> = {}): PendingReviewComment {
  return {
    id: "PRRC_start",
    by: { login: "dana", bot: false },
    path: INVITE_FILE.path,
    line: 12,
    startLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    html: '<p dir="auto">Why <strong>four</strong>?</p>',
    body: "Why **four**?",
    at: 3_000,
    ...overrides,
  };
}

/** Writes words into the field labelled as given, as the member would. */
function typeInto(within: Element, label: string, words: string): void {
  const field =
    within.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`) ??
    assert.fail(`a field for ${label}`);
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("the member's pending comments stand on their lines in Files changed, marked Pending in their own name: a reply as its thread's last comment, a new one as a card of its own; Edit sends new words, Delete asks first, and the Review panel lists them", async () => {
  const reply = draftOf({
    id: "PRRC_reply",
    threadId: JUMPED,
    line: 13,
    html: null,
    body: "Still once?",
  });
  const tab = await draw(
    controlAnswering(
      {
        conversation: () =>
          Promise.resolve({
            pullRequest: {
              ...reviewWith([thread({ id: JUMPED })]),
              pendingReview: { comments: 2, drafts: [reply, draftOf()] },
            },
          }),
      },
      PULL_REQUEST_STATE.OPEN,
      () =>
        Promise.resolve({
          pullRequest: { url: PAGE, headSha: READ_HEAD, truncated: false, files: [INVITE_FILE] },
        }),
    ),
  );
  await act(async () => option(tab, "Files changed").click());
  await settle();

  const list = lists.at(-1) ?? assert.fail("the files are drawn");
  assert.deepEqual(
    list.files[0]?.annotations.map(({ key, side, line }) => [key, side, line]),
    [
      [`${PAGE}#discussion_r1`, "additions", 13],
      ["PRRC_start", "additions", 12],
    ],
    "the reply adds no card of its own",
  );
  const card = list.renderAnnotation(INVITE_FILE.path, "PRRC_start");
  assert.match(card.textContent ?? "", /dana.*Pending/u);
  assert.deepEqual(
    [...card.querySelectorAll(".pull-request-thread-head, .changes-comment-head")].map((head) =>
      /Pending/u.test(head.textContent ?? ""),
    ),
    [true, false],
    "the card it starts wears Pending in its head alone",
  );
  assert.match(card.textContent ?? "", /Why four\?/u, "its words as GitHub rendered them");
  const replied = list.renderAnnotation(INVITE_FILE.path, `${PAGE}#discussion_r1`);
  const comments = [...replied.querySelectorAll<HTMLElement>(".pull-request-thread-comment")];
  assert.equal(comments.length, 2);
  assert.match(comments[1]?.textContent ?? "", /dana.*Pending.*Still once\?/u);
  assert.doesNotMatch(
    comments[0]?.textContent ?? "",
    /Pending/u,
    "the published comment stays as it was",
  );

  // Edit opens the words in place; Cancel keeps nothing, Save sends the new words.
  act(() => commentOffer(card, "Edit").click());
  typeInto(card, "Pending comment", "Thrown away");
  act(() => commentOffer(card, "Cancel").click());
  assert.equal(card.querySelector("textarea"), null);
  act(() => commentOffer(card, "Edit").click());
  assert.equal(card.querySelector("textarea")?.value, "Why **four**?");
  typeInto(card, "Pending comment", "Why **five**?");
  act(() => commentOffer(card, "Save").click());
  await settle();

  // Delete asks first, since it cannot be undone.
  act(() => commentOffer(comments[1] ?? assert.fail(), "Delete").click());
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("Delete asks first");
  act(() => commentOffer(question, "Delete comment").click());
  await settle();

  assert.deepEqual(changes, [
    [
      AGENT.id,
      {
        action: PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT,
        commentId: "PRRC_start",
        body: "Why **five**?",
      },
    ],
    [AGENT.id, { action: PULL_REQUEST_ACTION.DELETE_REVIEW_COMMENT, commentId: "PRRC_reply" }],
  ]);

  act(() =>
    (
      tab.querySelector<HTMLButtonElement>('[aria-label="Review, 2 pending comments"]') ??
      assert.fail("Review counts the pending comments")
    ).click(),
  );
  const panel =
    tab.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail("Review opens its panel");
  const listed = [...panel.querySelectorAll(".pull-request-pending-list > li")].map(
    (each) => each.querySelector(".pull-request-pending-where")?.textContent,
  );
  assert.deepEqual(listed, ["src/invite.ts · line 13", "src/invite.ts · line 12"]);
});
