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
  PULL_REQUEST_STATE,
  type PullRequestMerging,
  type PullRequestState,
  REVIEW_DECISION,
  REVIEW_STATE,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import {
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
import type { SideBundles } from "@luke/panel/bundle-loader";
import {
  DIFF_SELECTION_SIDE,
  type DiffListProps,
  type DiffListSelection,
  type DiffViewModule,
  type DiffViewProps,
} from "@luke/panel/diff-view/contract";
import { type GitHubConnectControl, GitHubConnectProvider } from "@luke/panel/github-connect";
import { MemberDirectory } from "@luke/panel/member-directory";
import { rendererRuntime } from "@luke/panel/renderer-runtime";
import { AgentPullRequestTab } from "@luke/panel/tasks/agent-pull-request-tab";
import { TAB_KIND, tabLook } from "@luke/panel/tasks/tab-look";
import {
  type PullRequestReader,
  useTaskPullRequests,
} from "@luke/panel/tasks/use-agent-pull-request";
import type { CodingAgentsControl } from "@luke/panel/tasks/use-coding-agents";
import { OpenLinkProvider } from "@luke/panel/tasks/use-open-link";
import { PULL_REQUEST_VIEW, type PullRequestView } from "@luke/panel/tasks/use-side-panel";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { handSettings } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { markdownHtmlParserLanded } from "@luke/panel/testing/markdown";
import { landedBundles, onSideBundles } from "@luke/panel/testing/side-bundles";
import { codingAgentsControl } from "@luke/panel/testing/tasks-control";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { DESKTOP_LINKS, fakeAppPlatform } from "#testing/app-platform";

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

/** The diff bundle, a chunk of its own the panel imports, stood in for at its importer. */
const DIFF_STAND_IN: DiffViewModule = {
  mount: (_host, props) => {
    previews.push(props);
    return { update: () => undefined, unmount: () => undefined };
  },
  mountList: (_host, props) => {
    lists.push(props);
    return {
      update: (next) => lists.push(next),
      reveal: () => undefined,
      unmount: () => undefined,
    };
  },
};

let bundles: SideBundles;

beforeAll(async () => {
  bundles = await Effect.runPromise(
    landedBundles({ diffView: () => Promise.resolve(DIFF_STAND_IN) }),
  );
});
/** Every change to the pull request the tab asked for, by agent, in order. */
let changes: (readonly [string, PullRequestActionRequest])[] = [];
/** How the service answers the next change asked for. */
let changeAnswer: PullRequestWriteAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
/** What the service waits on before it answers a change, where a test holds it; none answers at once. */
let changeHeld: Promise<void> | undefined;
/** What Files changed handed the diff bundle's list, mount first, each draw after it. */
let lists: DiffListProps[] = [];

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => {
  window.localStorage.clear();
  opened = [];
  images = [];
  previews = [];
  changes = [];
  changeAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
  lists = [];
  changeHeld = undefined;
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({
    act: (request: Act) => {
      if (request.kind === ACT_KIND.GITHUB_OPEN) opened.push(request.payload.url);
      if (request.kind === ACT_KIND.WEB_OPEN) opened.push(request.payload.url);
      if (request.kind === ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION) {
        changes.push([request.payload.agentId, request.payload.request]);
        const answer = changeAnswer;
        return (changeHeld ?? Promise.resolve()).then(() => ({
          status: ACT_OUTCOME_STATUS.DONE,
          value: answer,
        }));
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
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
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

/** What the bar says of where the pull request stands: its first control's words. */
function standing(tab: HTMLElement): string | undefined {
  return tab.querySelector(".pull-request-bar")?.firstElementChild?.textContent ?? undefined;
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
  assert.equal(standing(tab), "Merged");
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
  assert.equal(standing(tab), "Open");
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
  assert.equal(none.querySelector("section[aria-label='Pull request conversation']"), null);
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
    assert.fail("the bar has a ⋯");
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
    assert.fail("the bar has a ⋯");
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

test("the bar wears what was published of the checks only for the pull request they were read on, never a newer one whose checks failed to read", async () => {
  const control = {
    ...controlAnswering({
      pullRequest: () => Promise.resolve({ pullRequest: { ...PULL_REQUEST, number: 43 } }),
      checks: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED }),
    }),
  };
  const tab = await draw(control);
  const mark =
    tab.querySelector(".pull-request-bar")?.firstElementChild?.querySelector("[aria-label]") ??
    assert.fail("a mark");
  assert.match(mark.getAttribute("aria-label") ?? "", /43/u);
  assert.doesNotMatch(
    mark.getAttribute("aria-label") ?? "",
    /checks failing/u,
    "#42's failing checks are not #43's",
  );
});

/** The bar's pill, its first control, as a press; nothing where it is no press. */
function pillPress(tab: HTMLElement): HTMLButtonElement | undefined {
  const first = tab.querySelector(".pull-request-bar")?.firstElementChild;
  return first instanceof HTMLButtonElement ? first : undefined;
}

/** The bar's pill, as a press. */
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

/** The merge box's presses, by their words. */
function boxPresses(tab: HTMLElement): string[] {
  return words(tab, ".merge-box-actions .luke-button-words");
}

/** The merge box's press of the words given, pressed. */
async function pressBox(tab: HTMLElement, label: string): Promise<void> {
  const press =
    [...tab.querySelectorAll<HTMLButtonElement>(".merge-box-actions button")].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`the merge box offers ${label}`);
  act(() => press.click());
  await settle();
}

test("a pull request ready to merge offers Merge by the first method the repository allows, keeps the method chosen for the repository, and asks before merging against the head it read", async () => {
  const first = await draw(merging(MERGE_STATE.CLEAN));
  assert.deepEqual(boxPresses(first), ["Squash and merge"]);
  act(() =>
    (
      first.querySelector<HTMLButtonElement>('[aria-label="Choose how to merge"]') ??
      assert.fail("the box offers the repository's other methods")
    ).click(),
  );
  const rebase =
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemcheckbox"], [role="menuitem"]',
      ),
    ].find((each) => each.textContent?.startsWith("Rebase and merge")) ??
    assert.fail("the methods are offered");
  act(() => rebase.click());
  assert.deepEqual(boxPresses(first), ["Rebase and merge"]);
  act(() => root?.unmount());
  root = undefined;

  const again = await draw(merging(MERGE_STATE.CLEAN));
  assert.deepEqual(boxPresses(again), ["Rebase and merge"], "the method chosen is kept");
  await pressBox(again, "Rebase and merge");
  assert.deepEqual(changes, [], "a merge asks first");
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

test("auto-merge is offered while checks run, and turned off once on; a merge queue's base offers Merge when ready, and a queued pull request Remove from queue; a conflict offers nothing", async () => {
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
    assert.deepEqual(boxPresses(tab), [label]);
    await pressBox(tab, label);
    assert.deepEqual(changes, [[AGENT.id, request]]);
    act(() => root?.unmount());
    root = undefined;
  }

  const blocked = await draw(
    merging(MERGE_STATE.BLOCKED, {
      review: REVIEW_DECISION.REVIEW_REQUIRED,
      checks: CHECK_SUMMARY.PENDING,
    }),
  );
  assert.match(
    blocked.querySelector(".pull-request-merge")?.textContent ?? "",
    /A required review is missing/u,
  );
  act(() => root?.unmount());
  root = undefined;
  const conflicted = await draw(merging(MERGE_STATE.CONFLICTS));
  assert.deepEqual(boxPresses(conflicted), []);
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
      assert.fail("the bar has a ⋯")
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

/** The bar's Review press. */
function reviewPress(tab: HTMLElement): HTMLButtonElement {
  return (
    buttonWith(tab.querySelector(".pull-request-bar") ?? tab, /^Review$/u) ??
    assert.fail("an open pull request's bar offers Review")
  );
}

/** Opens the review panel from the bar. */
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

test("a review GitHub refuses says so in GitHub's own words inside the panel, never under the bar, and the words written stand for another try; a merged pull request offers no Review", async () => {
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
    tab.querySelector<HTMLButtonElement>('.pull-request-label-row [aria-label="Edit labels"]') ??
    assert.fail("the label picker stands at the labels' end");

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
    act(() => tab.querySelector<HTMLButtonElement>('button[aria-label="Diff settings"]')?.click());
    const toggle = [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
      (each) => each.getAttribute("aria-label") === "Minimize inline comments",
    );
    act(() => toggle?.click());
    await settle();
    act(() => tab.querySelector<HTMLButtonElement>('button[aria-label="Diff settings"]')?.click());
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
    assert.fail("the bar has a ⋯");
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
  return (lists.at(-1) ?? drawn).renderAnnotation(INVITE_FILE.path, "line-comment");
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
  return (lists.at(-1)?.files ?? []).some((file) =>
    file.annotations.some((note) => note.key === "line-comment"),
  );
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
    lists.at(-1)?.files[0]?.annotations.find((note) => note.key === "line-comment"),
    { key: "line-comment", side: DIFF_SELECTION_SIDE.ADDITIONS, line: 13 },
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
