// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type {
  CodingAgentAgentAnswer,
  CodingAgentWorkspaceListParams,
} from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/link-grammar";
import {
  encodeMention,
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  mentionMarkdown,
} from "@luke/features/mention-link";
import { pageFrameUrl } from "@luke/features/page-frame";
import { TASK_SKILL_SOURCE, TASK_TREE_ENTRY } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW, type TaskCodeShowing } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ACTOR_KIND, ACTOR_STATE } from "@luke/ui/actor-model";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { rendererRuntime } from "../renderer-runtime.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeAppBridge,
  fakeAppBridgeCalls,
} from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { stateWith } from "../testing/app-state.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { AgentComposer } from "./agent-composer.js";
import type { SkillSource } from "./skill-picker.js";
import {
  mentionablePullRequests,
  TaskMentions,
  type TaskMentionsValue,
  tasklessMentions,
  useMentionAgentsReader,
} from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { type MessageSender, useAgentComposer } from "./use-agent-composer.js";
import { OpenLinkProvider } from "./use-open-link.js";

/**
 * `@` in an agent's message box and its transcript, on a task's page and
 * off it, over the real editor bundle: the word typed opens the list of the
 * plan's sections and the repository's files, the row chosen is written
 * into the message as its link and drawn in the box as its chip, the link
 * is what is sent, and a sent message's mention is drawn as the chip that
 * opens it. Off a task's page an `@` is a letter, and a sent mention is
 * still its chip, opened through the window's own doors.
 * Synthetic plan and repository.
 */

const TASK_ID = "pl_1";

const PLAN_TEXT = "## Goal\n\nInvite by email.\n\n## Rollout\n\nStore first.\n";

const ROLLOUT: Mention = { kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "rollout" };

const PLACE: MentionPlace = { workspace: "acme", repository: "acme/relay" };

/** A file of the repository's tree. */
function treeFile(name: string) {
  return { name, kind: TASK_TREE_ENTRY.FILE };
}

/** Sixty invitation files under `apps/web`, more than a narrowed list shows. */
const INVITES = Array.from({ length: 60 }, (_, at) =>
  treeFile(`apps/web/invite-${String(at + 1).padStart(2, "0")}.ts`),
);

/** The paths each repository holds, as the plan's tree answers them. */
const TREES = new Map([
  ["acme/relay", [treeFile("apps/web/rollout-store.ts")]],
  ["acme/next", [treeFile("apps/web/rollout-next.ts")]],
  [
    "acme/wide",
    [
      { name: "apps", kind: TASK_TREE_ENTRY.FOLDER },
      { name: "apps/web", kind: TASK_TREE_ENTRY.FOLDER },
      ...INVITES,
      treeFile("README.md"),
    ],
  ],
]);

/** Linear connected, and every other integration unavailable. */
// SAFETY: the entries are made from INTEGRATION_PROVIDER_LIST, one for every provider, which is the record's every key.
const LINEAR_CONNECTED = Object.fromEntries(
  INTEGRATION_PROVIDER_LIST.map((provider) => [
    provider,
    provider === INTEGRATION_PROVIDER.LINEAR
      ? INTEGRATION_STATUS.CONNECTED
      : INTEGRATION_STATUS.UNAVAILABLE,
  ]),
) as Record<IntegrationProvider, IntegrationStatus>;

/** The workspace's task beside the plan, as the window lists it. */
const BILLING = { id: "2b2b2b2b-0000-4000-8000-000000000000", name: "Billing" };

/** An agent of the workspace as its list answers it. */
function workspaceAgent(
  id: string,
  title: string,
  taskId: string | null,
  archivedAt?: number,
): CodingAgentSummary {
  return {
    id,
    planId: taskId,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1_000,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    ...(archivedAt === undefined ? undefined : { archivedAt }),
  };
}

/** The workspace's agents beside the plan's own: one on another task, one on none, and one archived. */
const BILLING_AGENT = workspaceAgent(
  "3c3c3c3c-0000-4000-8000-000000000000",
  "Bill by seat",
  BILLING.id,
);
const SWEEPER = workspaceAgent("4d4d4d4d-0000-4000-8000-000000000000", "Sweep flaky tests", null);
const OLD_AGENT = workspaceAgent(
  "5e5e5e5e-0000-4000-8000-000000000000",
  "Old invoices",
  BILLING.id,
  2_000,
);
/** An agent past the newest the workspace's list answers, which only a search finds. */
const LEDGER = workspaceAgent("6f6f6f6f-0000-4000-8000-000000000000", "Old ledger", null);

/** The newest agents the workspace's list answers, archived ones left out. */
const NEWEST_AGENTS: readonly CodingAgentSummary[] = [BILLING_AGENT, SWEEPER];

/** Every agent of the workspace, which a search finds among, archived ones included. */
const WORKSPACE_AGENTS: readonly CodingAgentSummary[] = [BILLING_AGENT, SWEEPER, OLD_AGENT, LEDGER];

/** The newest agents the workspace's list answers now. */
let newest: readonly CodingAgentSummary[] = NEWEST_AGENTS;

/** The workspace's list as the service answers it: the newest, or those whose title or task's name holds the words, as the store finds them. */
function workspaceAnswer({ words }: CodingAgentWorkspaceListParams): readonly CodingAgentSummary[] {
  if (words === undefined) return newest;
  const lower = words.toLowerCase();
  return WORKSPACE_AGENTS.filter(
    (agent) =>
      (agent.title ?? "").toLowerCase().includes(lower) ||
      (agent.planId === BILLING.id && BILLING.name.toLowerCase().includes(lower)),
  );
}

/** The workspace's members, as its Members list reads them: a teammate, then the reader. */
const READER_ID = "u_reader";
const DANA_ID = "u_dana";
const MEMBERS: readonly WorkspaceMember[] = [
  { userId: DANA_ID, name: "Dana Reyes", email: "dana@example.com", role: WORKSPACE_ROLE.ADMIN },
  {
    userId: READER_ID,
    name: "Charles Pan",
    email: "charles@example.com",
    role: WORKSPACE_ROLE.OWNER,
  },
];

/** Every act the panel told the main process, in order. */
const told: AnyAct[] = [];

/** The repository the task's tree is read from now. */
let standing = "acme/relay";

/** The kinds of act main refuses now, as it does while GitHub or the service cannot be reached. */
const refusing = new Set<string>();

const noSkills: SkillSource = () => Promise.resolve({ skills: [] });

const ignore = () => undefined;

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

/** What main answers the box's acts with on the act port, every one told. */
function answer(request: AnyAct): Promise<FakeActAnswer> {
  told.push(request);
  if (refusing.has(request.kind)) {
    return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Could not reach it." });
  }
  return Promise.resolve(
    request.kind === ACT_KIND.INTEGRATIONS_STATUS
      ? {
          status: FAKE_ANSWER.DONE,
          value: {
            integrations: LINEAR_CONNECTED,
          },
        }
      : request.kind === ACT_KIND.INTEGRATIONS_TOOLS
        ? {
            status: FAKE_ANSWER.DONE,
            value: {
              tools: [
                { name: "list_issues", description: "List the team's issues." },
                { name: "get_issue", description: "Read one issue." },
                { name: "list/issues", description: "A name no mention can carry." },
                {
                  name: "list\ud800",
                  description: "A name that is no string of characters.",
                },
                { name: "..", description: "A name an address resolves away." },
              ],
            },
          }
        : request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
          ? { status: FAKE_ANSWER.DONE, value: MEMBERS }
          : request.kind === ACT_KIND.CODING_AGENTS_WORKSPACE_LIST
            ? {
                status: FAKE_ANSWER.DONE,
                value: {
                  agents: workspaceAnswer(request.payload),
                },
              }
            : request.kind === ACT_KIND.TASKS_TREE
              ? {
                  status: FAKE_ANSWER.DONE,
                  value: {
                    folder: {
                      path: "",
                      repository: standing,
                      branch: "main",
                      entries: TREES.get(standing) ?? [],
                      truncated: false,
                    },
                  },
                }
              : { status: FAKE_ANSWER.UNKNOWN_ACT },
  );
}

beforeEach(() => {
  standing = "acme/relay";
  refusing.clear();
  newest = NEWEST_AGENTS;
  told.length = 0;
  installScrollIntoView();
  installEditorLayout();
  fakeAppPlatform(DESKTOP_LINKS);
  fakeActs({ act: answer });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** What a task's page hands its places, every mention a chip was asked to open kept. */
function planPage(opened: Mention[], repository = "acme/relay"): TaskMentionsValue {
  return {
    taskId: TASK_ID,
    taskName: "Invitations",
    workspace: PLACE.workspace,
    repository,
    text: () => PLAN_TEXT,
    doors: {
      taskId: TASK_ID,
      place: { workspace: PLACE.workspace, repository },
      anchors: new Set(["goal", "rollout"]),
      onOpenTask: (mention) => opened.push(mention),
      onOpenFile: undefined,
    },
  };
}

/** The agent whose box is drawn. */
const SELF_ID = "agent-1";

/** A page an agent showed on the plan, and two of its agents, the box's own among them. */
const PAGE = { id: "page-1", title: "Invites by week", version: 1, at: 1_000 };
const STORE_AGENT = {
  id: "agent-2",
  name: "Wire the desktop",
  actor: {
    kind: ACTOR_KIND.AGENT,
    name: "Wire the desktop",
    provider: undefined,
    state: ACTOR_STATE.REST,
  },
} as const;
const SELF_AGENT = { ...STORE_AGENT, id: SELF_ID, name: "Invite by email" };

/** The plan's page holding its pages and agents, as the task's list read them, every link a chip was asked to open kept. */
function taskPage(opened: Mention[] = []): TaskMentionsValue {
  const store = {
    ...STORE_AGENT,
    summary: workspaceAgent(STORE_AGENT.id, STORE_AGENT.name, TASK_ID),
  };
  return { ...planPage(opened), pages: [PAGE], agents: [SELF_AGENT, store] };
}

/** The box on the composer's own control, its sends answered by `sender`. */
function Box({ sender, skills }: { sender: MessageSender; skills: SkillSource }): ReactNode {
  const composer = useAgentComposer({
    agentId: SELF_ID,
    taskId: TASK_ID,
    messages: [],
    send: sender,
    onStatus: ignore,
  });
  return createElement(AgentComposer, { ...QUIET_COMPOSER, agentId: SELF_ID, composer, skills });
}

/** The node drawn on a task's page, or off any page where none is given, its atoms held by `registry`; `redraw` draws it on the page given. */
function drawing(
  node: ReactNode,
  page: TaskMentionsValue | undefined,
  registry = AtomRegistry.make(),
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const redraw = (on: TaskMentionsValue | undefined) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          on === undefined
            ? createElement(Fragment, null, node)
            : createElement(TaskMentions, { value: on, children: node }),
        ),
      ),
    );
  redraw(page);
  return { container, redraw };
}

/** The node drawn on a task's page, or off any page where none is given. */
function drawn(node: ReactNode, page: TaskMentionsValue | undefined): HTMLElement {
  return drawing(node, page).container;
}

/** The box drawn, every message it sends written down. */
async function box(page: TaskMentionsValue | undefined, skills: SkillSource = noSkills) {
  const sent: string[] = [];
  const sender: MessageSender = (_agentId, text) => {
    sent.push(text);
    return new Promise<CodingAgentAgentAnswer>(ignore);
  };
  const { container, redraw } = drawing(createElement(Box, { sender, skills }), page);
  await settle();
  return { container, sent, redraw };
}

/** The attribute that carries an address, other than those session replay masks (`../session-replay.ts`), if any element drawn holds one. */
function carryingTarget(container: HTMLElement): string | undefined {
  // Note that an SVG glyph's own namespace is no address of a page.
  const masked = new Set([
    "title",
    "aria-label",
    "aria-description",
    "alt",
    "src",
    "href",
    "xmlns",
  ]);
  return [...container.querySelectorAll("*")]
    .flatMap((element) => [...element.attributes])
    .find((attribute) => !masked.has(attribute.name) && attribute.value.includes("://"))?.name;
}

/** The list's groups, each by its label with its rows' names. */
function groupsListed(container: HTMLElement): [string | null, string[]][] {
  return [...container.querySelectorAll('.mention-menu [role="group"]')].map((group) => [
    group.getAttribute("aria-label"),
    [...group.querySelectorAll(".luke-combobox-option-label")].map(
      (name) => name.textContent ?? "",
    ),
  ]);
}

/** The rows the list draws, by name. */
function listed(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".mention-menu .luke-combobox-option-label")].map(
    (name) => name.textContent ?? "",
  );
}

test("an @ typed in the box on a plan's page offers the plan's sections, and the row chosen is drawn as its chip and sent as its link", async () => {
  const { container, sent } = await box(planPage([]));

  typeInComposer(container, "Follow @roll");
  await settle();
  const offered = listed(container);
  pressInComposer(container, "ArrowDown");
  pressInComposer(container, "Enter");
  await settle();
  const chips = [...composerEditor(container).querySelectorAll("[data-mention-ref]")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(offered, ["rollout-store.ts", "Rollout"]);
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Rollout"],
  );
  assert.deepEqual(sent, [`Follow ${mentionMarkdown(ROLLOUT, "Rollout", PLACE)}`]);
});

test("the @ list hangs at the caret, by the word's line, and narrows as the word is typed on while the caret stays in the box", async () => {
  // Note that jsdom lays out nothing, so the word's letters stand where a line would put them, and the layer is laid in the page.
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 120, y: 300, width: 8, height: 16 }),
  );
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
  try {
    const { container } = await box(planPage([]));

    typeInComposer(container, "Follow @r");
    await settle();
    const layer =
      container.querySelector<HTMLElement>(".luke-rect-float") ?? assert.fail("the list hangs");
    const hung = { side: layer.dataset.side, left: layer.style.left, top: layer.style.top };
    const first = listed(container);
    typeInComposer(container, "oll");
    await settle();

    assert.deepEqual(hung, { side: "above", left: "120px", top: "300px" });
    assert.ok(first.length > 2, "a letter offers more than the word does");
    assert.deepEqual(listed(container), ["rollout-store.ts", "Rollout"]);
    assert.ok(composerEditor(container).contains(document.activeElement), "the caret stays");
  } finally {
    vi.restoreAllMocks();
  }
});

test("the @ list closes on a press outside it and the box, stays open for a press in the box, and stays closed while the caret is in its word", async () => {
  const { container } = await box(planPage([]));
  const press = (target: Element) =>
    act(() => {
      target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

  typeInComposer(container, "Follow @roll");
  await settle();
  press(composerEditor(container));
  const keptByTheBox = listed(container);
  press(document.body);
  const afterAway = container.querySelector(".mention-menu") !== null;
  typeInComposer(container, "o");
  await settle();

  assert.deepEqual(keptByTheBox, ["rollout-store.ts", "Rollout"]);
  assert.equal(afterAway, false, "a press outside closes it");
  assert.equal(container.querySelector(".mention-menu") !== null, false, "and it stays closed");
});

test("the box names the @ list it opened and the row highlighted in it, as any combobox's field does, and names none once the list closes", async () => {
  const { container } = await box(planPage([]));

  typeInComposer(container, "Follow @roll");
  await settle();
  const field = composerEditor(container);
  const list = container.querySelector('.mention-menu [role="listbox"]');
  const highlighted = () => list?.querySelector('[role="option"][aria-selected="true"]')?.id;
  const first = highlighted();
  const named = [field.getAttribute("aria-controls"), field.getAttribute("aria-activedescendant")];
  pressInComposer(container, "ArrowDown");
  const moved = [field.getAttribute("aria-activedescendant"), highlighted()];
  pressInComposer(container, "Escape");

  assert.ok(list?.id, "the list has an id to be named by");
  assert.deepEqual(named, [list?.id, first]);
  assert.notEqual(moved[0], first);
  assert.equal(moved[0], moved[1]);
  assert.equal(field.getAttribute("aria-expanded"), "false");
  assert.equal(field.getAttribute("aria-controls"), null);
  assert.equal(field.getAttribute("aria-activedescendant"), null);
});

test("on the page of an agent no plan holds an @ offers its repository's files, read through its workspace, and no plan's sections", async () => {
  const page = tasklessMentions(
    { workspace: "acme", workspaceId: "workspace-1", repository: "acme/relay" },
    ignore,
  );
  const { container } = await box(page);

  typeInComposer(container, "Follow @roll");
  await settle();

  assert.deepEqual(listed(container), ["rollout-store.ts"]);
  assert.deepEqual(
    told.filter((each) => each.kind === ACT_KIND.TASKS_TREE).map((each) => each.payload),
    [{ workspaceId: "workspace-1", repository: "acme/relay", path: "", recursive: true }],
  );
});

test("off a plan's page an @ in the box opens nothing and is sent as the letter it is", async () => {
  const { container, sent } = await box(undefined);

  typeInComposer(container, "Mail @roll");
  await settle();
  const menu = container.querySelector(".mention-menu");
  pressInComposer(container, "Enter");
  await settle();

  assert.equal(menu, null);
  assert.deepEqual(sent, ["Mail @roll"]);
});

test("a sent message's mention is drawn on a plan's page as the chip that opens what it names", () => {
  const opened: Mention[] = [];
  const container = drawn(
    createElement(TranscriptWords, {
      text: `Follow ${mentionMarkdown(ROLLOUT, "Rollout", PLACE)}.`,
    }),
    planPage(opened),
  );

  const chip = container.querySelector<HTMLButtonElement>("button[data-mention-ref]");
  assert.ok(chip, "the mention is a chip");
  act(() => chip.click());

  assert.equal(chip.textContent, "Rollout");
  assert.deepEqual(opened, [ROLLOUT]);
  assert.equal(carryingTarget(container), undefined);
});

test("off a plan's page a sent message's mention is still its chip, which opens through the window's opener", () => {
  const opened: ReadLink[] = [];
  const container = drawn(
    createElement(
      OpenLinkProvider,
      { value: (link: ReadLink) => opened.push(link) },
      createElement(TranscriptWords, {
        text: `Follow ${mentionMarkdown(ROLLOUT, "Rollout", PLACE)}.`,
      }),
    ),
    undefined,
  );

  const chip = container.querySelector<HTMLButtonElement>("button[data-mention-ref]");
  assert.ok(chip !== null, "the mention is a chip");
  act(() => chip.click());

  assert.equal(container.textContent, "Follow Rollout.");
  assert.deepEqual(opened, [
    { workspace: "", place: { kind: LINK_PLACE.SECTION, planId: TASK_ID, anchor: "rollout" } },
  ]);
  assert.equal(carryingTarget(container), undefined);
});

test("once the plan's repository changes, the box offers the new repository's files", async () => {
  const { container, redraw } = await box(planPage([]));
  typeInComposer(container, "Follow @roll");
  await settle();
  const before = listed(container);

  standing = "acme/next";
  redraw(planPage([], "acme/next"));
  await settle();

  assert.deepEqual(before, ["rollout-store.ts", "Rollout"]);
  assert.deepEqual(listed(container), ["rollout-next.ts", "Rollout"]);
});

test("a sent message's mention of an MCP server is drawn on a plan's page as a chip that opens nothing", () => {
  const opened: Mention[] = [];
  const linear = mentionMarkdown(
    { kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR },
    "Linear",
    PLACE,
  );
  const container = drawn(
    createElement(TranscriptWords, { text: `Check ${linear} first.` }),
    planPage(opened),
  );

  const chip = container.querySelector("[data-mention-ref]");

  assert.equal(chip?.tagName, "SPAN");
  assert.equal(chip?.textContent, "Linear");
  assert.equal(carryingTarget(container), undefined);
});

test("an @ in the box offers the account's connected MCP servers, and once a word is typed their tools, a pick sent as its link", async () => {
  const { container, sent } = await box(planPage([]));

  typeInComposer(container, "Use @");
  await settle();
  const servers = groupsListed(container).find(([group]) => group === "MCP servers");
  typeInComposer(container, "list");
  await settle();
  const tools = listed(container);
  pressInComposer(container, "Enter");
  await settle();
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(servers, ["MCP servers", ["Linear"]]);
  assert.deepEqual(tools, ["Linear · list_issues"]);
  assert.deepEqual(sent, [
    `Use ${mentionMarkdown({ kind: MENTION_KIND.TOOL, provider: INTEGRATION_PROVIDER.LINEAR, tool: "list_issues" }, "Linear · list_issues", PLACE)}`,
  ]);
});

test("an @ in the box offers the repository's skills, a pick written as the /name chip the / list writes", async () => {
  const release: SkillSource = () =>
    Promise.resolve({
      skills: [
        {
          name: "release",
          description: "Use to cut a release.",
          source: TASK_SKILL_SOURCE.REPOSITORY,
          path: ".agents/skills/release/SKILL.md",
        },
      ],
    });
  const { container, sent } = await box(planPage([]), release);

  typeInComposer(container, "Run @rel");
  await settle();
  const offered = [...container.querySelectorAll('.mention-menu [role="group"]')].map((group) =>
    group.getAttribute("aria-label"),
  );
  pressInComposer(container, "Enter");
  await settle();
  const chips = [...composerEditor(container).querySelectorAll("[data-skill-ref]")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(offered, ["Skills"]);
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["/release"],
  );
  assert.deepEqual(sent, ["Run /release"]);
});

test("skills that could not be read for one @ list are asked for again by the next", async () => {
  let asks = 0;
  const flaky: SkillSource = () => {
    asks += 1;
    return Promise.resolve(
      asks === 1
        ? { unread: "GitHub could not be reached." }
        : {
            skills: [
              {
                name: "release",
                description: "Use to cut a release.",
                source: TASK_SKILL_SOURCE.REPOSITORY,
                path: ".agents/skills/release/SKILL.md",
              },
            ],
          },
    );
  };
  const groups = (container: HTMLElement) =>
    [...container.querySelectorAll('.mention-menu [role="group"]')].map((group) =>
      group.getAttribute("aria-label"),
    );
  const { container } = await box(planPage([]), flaky);

  typeInComposer(container, "Run @releas");
  await settle();
  const first = groups(container);
  typeInComposer(container, " then @releas");
  await settle();

  assert.deepEqual(first, []);
  assert.deepEqual(groups(container), ["Skills"]);
});

test("an @ whose read of the skills came back unread says they could not be read, with Retry, and ends its reading; Retry reads them again", async () => {
  let reachable = false;
  const flaky: SkillSource = () =>
    Promise.resolve(
      reachable
        ? {
            skills: [
              {
                name: "release",
                description: "Use to cut a release.",
                source: TASK_SKILL_SOURCE.REPOSITORY,
                path: ".agents/skills/release/SKILL.md",
              },
            ],
          }
        : { unread: "GitHub could not be reached." },
    );
  const { container } = await box(planPage([]), flaky);

  typeInComposer(container, "Run @releas");
  await settle();

  const failed = listNote(container);
  assert.match(failed.words, /Skills could not be read\./u);
  assert.doesNotMatch(failed.words, /Reading/u);
  assert.equal(container.querySelector(".mention-menu .luke-combobox-empty"), null);

  reachable = true;
  act(() => (failed.retry ?? assert.fail("no Retry")).click());
  await settle();

  assert.equal(listNote(container).words, "");
  assert.deepEqual(
    [...container.querySelectorAll('.mention-menu [role="group"]')].map((group) =>
      group.getAttribute("aria-label"),
    ),
    ["Skills"],
  );
});

const ISSUE_URL = "https://linear.app/acme/issue/LUKE-142/fix-the-thing";

/** Words pasted into the box's editor, as the system's clipboard hands them over. */
function pasteInComposer(container: HTMLElement, words: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? words : ""),
    },
  });
  act(() => {
    composerEditor(container).dispatchEvent(event);
  });
}

test("a page of an integration's pasted into the box on a plan's page is drawn as its chip and sent as its link", async () => {
  const { container, sent } = await box(planPage([]));

  typeInComposer(container, "Fix ");
  pasteInComposer(container, ISSUE_URL);
  await settle();
  const chips = [...composerEditor(container).querySelectorAll("[data-mention-ref]")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["LUKE-142/fix-the-thing"],
  );
  assert.deepEqual(sent, [`Fix [@LUKE-142/fix-the-thing](${ISSUE_URL})`]);
});

test("a sent message's page of an integration's is a chip that opens the page in the browser", () => {
  const container = drawn(
    createElement(TranscriptWords, {
      text: `Fix ${mentionMarkdown({ kind: MENTION_KIND.LINK, provider: INTEGRATION_PROVIDER.LINEAR, url: ISSUE_URL }, "LUKE-142/fix-the-thing", PLACE)}.`,
    }),
    planPage([]),
  );

  const chip = container.querySelector<HTMLButtonElement>("button[data-mention-ref]");
  assert.ok(chip, "the page is a chip");
  act(() => chip.click());

  assert.deepEqual(told.at(-1), { kind: ACT_KIND.WEB_OPEN, payload: { url: ISSUE_URL } });
  assert.equal(carryingTarget(container), undefined);
});

test("off a plan's page a sent message's page of an integration's is still its chip, its address on no attribute the recording keeps", () => {
  const container = drawn(
    createElement(TranscriptWords, {
      text: `Fix ${mentionMarkdown({ kind: MENTION_KIND.LINK, provider: INTEGRATION_PROVIDER.LINEAR, url: ISSUE_URL }, "LUKE-142/fix-the-thing", PLACE)}.`,
    }),
    undefined,
  );

  const chip = container.querySelector<HTMLButtonElement>("button[data-mention-ref]");
  assert.ok(chip !== null, "the page is a chip");
  act(() => chip.click());

  assert.deepEqual(told.at(-1), { kind: ACT_KIND.WEB_OPEN, payload: { url: ISSUE_URL } });
  assert.equal(carryingTarget(container), undefined);
});

test("an @ in the box on a plan's page offers the plan's pages and its other agents, each in its own group, an agent leading with its tab's glyph, and not the agent whose box it is", async () => {
  const { container } = await box(taskPage());

  typeInComposer(container, "See @");
  await settle();
  const agentGlyph = container.querySelector(
    '.mention-menu [aria-label="Agents"] [role="option"] .luke-combobox-option-glyph',
  )?.firstElementChild;

  assert.deepEqual(groupsListed(container), [
    ["Plan", ["Goal", "Rollout", "Invitations"]],
    ["Pages", ["Invites by week"]],
    ["Agents", ["Wire the desktop"]],
    ["MCP servers", ["Linear"]],
    ["Mention from", ["Files and folders", "Plan", "Pages", "Agents", "Dates", "Linear"]],
  ]);
  assert.equal(agentGlyph?.className, "state-glyph", "the agent's row leads with its tab's glyph");
});

test("a page picked from the @ list is drawn as its chip and sent as its link, which names the page by its id alone", async () => {
  const { container, sent } = await box(taskPage());

  typeInComposer(container, "Build @invites");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  const chips = [...composerEditor(container).querySelectorAll("[data-mention-ref]")];
  pressInComposer(container, "Enter");
  await settle();

  const pageMention: Mention = { kind: MENTION_KIND.PAGE, taskId: TASK_ID, pageId: PAGE.id };
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Invites by week"],
  );
  assert.deepEqual(sent, [`Build ${mentionMarkdown(pageMention, "Invites by week", PLACE)}`]);
  assert.equal(sent[0], "Build [@Invites by week](https://tryluke.dev/acme/plan/pl_1/page/page-1)");
});

test("another agent picked from the @ list is drawn as its chip and sent as its link, which names the agent by its id alone", async () => {
  const { container, sent } = await box(taskPage());

  typeInComposer(container, "Build on @wire");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(sent, [
    "Build on [@Wire the desktop](https://tryluke.dev/acme/plan/pl_1/agent/agent-2)",
  ]);
});

test("a sent message's mention of a page or an agent is drawn as the chip that opens its tab through the window's opener, its target on no attribute", () => {
  const opened: ReadLink[] = [];
  const page = mentionMarkdown(
    { kind: MENTION_KIND.PAGE, taskId: TASK_ID, pageId: PAGE.id },
    PAGE.title,
    PLACE,
  );
  const agent = mentionMarkdown(
    { kind: MENTION_KIND.AGENT, taskId: TASK_ID, agentId: STORE_AGENT.id },
    STORE_AGENT.name,
    PLACE,
  );
  const container = drawn(
    createElement(
      OpenLinkProvider,
      { value: (link: ReadLink) => opened.push(link) },
      createElement(TranscriptWords, { text: `Build ${page} on ${agent}.` }),
    ),
    taskPage(),
  );

  const chips = [...container.querySelectorAll<HTMLButtonElement>("button[data-mention-ref]")];
  for (const chip of chips) act(() => chip.click());

  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    [PAGE.title, STORE_AGENT.name],
  );
  assert.deepEqual(opened, [
    { workspace: "acme", place: { kind: LINK_PLACE.PAGE, planId: TASK_ID, pageId: PAGE.id } },
    {
      workspace: "acme",
      place: { kind: LINK_PLACE.AGENT, planId: TASK_ID, agentId: STORE_AGENT.id },
    },
  ]);
  assert.equal(carryingTarget(container), undefined);
});

/** The plan's page, its workspace's agents read through the window's own reader, the box drawn on it. */
function WorkspacePage({ children }: { children: ReactNode }): ReactNode {
  const readAgents = useMentionAgentsReader("workspace-1", [BILLING], undefined);
  return createElement(TaskMentions, { value: { ...taskPage(), readAgents }, children });
}

/** A registry whose atoms wait on this clock, as the window's wait on its own. */
function registryOn(clock: Clock.Clock): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({
    initialValues: [[rendererRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))]],
  });
}

/** Longer than the typing rests before the service is searched for the words typed. */
const PAST_SEARCH_PAUSE = "300 millis";

/** The clock moved past the search's pause, and what the search answered drawn. */
const rest = Effect.gen(function* () {
  yield* TestClock.adjust(PAST_SEARCH_PAUSE);
  yield* Effect.promise(settle);
});

/** The box on the plan's page that reads its workspace's agents, every message it sends written down, its waits on `registry`'s clock. */
async function workspaceBox(registry?: AtomRegistry.AtomRegistry) {
  const sent: string[] = [];
  const sender: MessageSender = (_agentId, text) => {
    sent.push(text);
    return new Promise<CodingAgentAgentAnswer>(ignore);
  };
  const { container } = drawing(
    createElement(WorkspacePage, null, createElement(Box, { sender, skills: noSkills })),
    undefined,
    registry,
  );
  await settle();
  return { container, sent };
}

/** The Agents group's rows, each by its name and its detail. */
function agentsListed(container: HTMLElement): [string, string][] {
  return [...container.querySelectorAll('.mention-menu [aria-label="Agents"] [role="option"]')].map(
    (row) => [
      row.querySelector(".luke-combobox-option-label")?.textContent ?? "",
      row.querySelector(".luke-combobox-option-detail")?.textContent ?? "",
    ],
  );
}

/** The workspace lists the list read, by whether each asked for the archived agents. */
function workspaceReads(): unknown[] {
  return told
    .filter((each) => each.kind === ACT_KIND.CODING_AGENTS_WORKSPACE_LIST)
    .map((each) => each.payload);
}

test("an @ offers the workspace's agents after the task's own, each labelled by its task, and no archived one before a word is typed", async () => {
  const { container } = await workspaceBox();

  typeInComposer(container, "See @");
  await settle();

  assert.deepEqual(agentsListed(container), [
    ["Wire the desktop", "This task"],
    ["Bill by seat", "Billing"],
    ["Sweep flaky tests", "No task"],
  ]);
  assert.deepEqual(workspaceReads(), [{ workspaceId: "workspace-1" }]);
});

/** What the open list says after its rows, and the press that reads again. */
function listNote(container: HTMLElement): { words: string; retry: HTMLButtonElement | null } {
  const note = container.querySelector(".mention-menu .luke-combobox-note");
  return {
    words: note?.textContent ?? "",
    retry:
      [...(note?.querySelectorAll("button") ?? [])].find((button) =>
        (button.textContent ?? "").includes("Retry"),
      ) ?? null,
  };
}

test("an @ whose read of the workspace's agents failed says they could not be read, with Retry, never that none match, and Retry reads them again", async () => {
  refusing.add(ACT_KIND.CODING_AGENTS_WORKSPACE_LIST);
  const { container } = await workspaceBox();

  typeInComposer(container, "See @");
  await settle();

  assert.match(listNote(container).words, /Agents could not be read\./u);
  assert.equal(container.querySelector(".mention-menu .luke-combobox-empty"), null);
  assert.deepEqual(agentsListed(container), [["Wire the desktop", "This task"]]);

  refusing.clear();
  const { retry } = listNote(container);
  act(() => (retry ?? assert.fail("no Retry")).click());
  await settle();

  assert.equal(listNote(container).words, "");
  assert.deepEqual(agentsListed(container), [
    ["Wire the desktop", "This task"],
    ["Bill by seat", "Billing"],
    ["Sweep flaky tests", "No task"],
  ]);
});

test("an @ whose read of the repository's files was refused ends its reading, says they could not be read, and Retry reads them again", async () => {
  refusing.add(ACT_KIND.TASKS_TREE);
  const { container } = await box(planPage([]));

  typeInComposer(container, "Follow @roll");
  await settle();

  const failed = listNote(container);
  assert.match(failed.words, /The repository's files could not be read\./u);
  assert.doesNotMatch(failed.words, /Reading/u);
  assert.equal(container.querySelector(".mention-menu .luke-combobox-empty"), null);
  assert.deepEqual(listed(container), ["Rollout"]);

  refusing.clear();
  act(() => (failed.retry ?? assert.fail("no Retry")).click());
  await settle();

  assert.equal(listNote(container).words, "");
  assert.deepEqual(listed(container), ["rollout-store.ts", "Rollout"]);
});

it.effect(
  "a word typed after @ finds an agent of another task by its task's name, and an archived one, read then and marked archived",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      const { container } = yield* Effect.promise(() => workspaceBox(registry));

      typeInComposer(container, "See @billing");
      yield* rest;

      assert.deepEqual(agentsListed(container), [
        ["Bill by seat", "Billing"],
        ["Old invoices", "Billing · Archived"],
      ]);
      // The word was typed whole, so the one read asked the service to find it, archived agents among them.
      assert.deepEqual(workspaceReads(), [
        { workspaceId: "workspace-1", words: "billing", includeArchived: true },
      ]);
    }),
);

it.effect(
  "words typed after @ ask the service once the typing rests on them, never letter by letter, while the bare @ asks at once",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      const { container } = yield* Effect.promise(() => workspaceBox(registry));

      typeInComposer(container, "See @");
      yield* Effect.promise(settle);
      assert.deepEqual(workspaceReads(), [{ workspaceId: "workspace-1" }]);

      typeInComposer(container, "b");
      yield* Effect.promise(settle);
      yield* TestClock.adjust("200 millis");
      typeInComposer(container, "ill");
      yield* Effect.promise(settle);
      yield* TestClock.adjust("200 millis");
      yield* Effect.promise(settle);
      assert.deepEqual(workspaceReads(), [{ workspaceId: "workspace-1" }], "nothing asked yet");

      yield* rest;
      assert.deepEqual(workspaceReads(), [
        { workspaceId: "workspace-1" },
        { workspaceId: "workspace-1", words: "bill", includeArchived: true },
      ]);
      assert.deepEqual(agentsListed(container), [
        ["Bill by seat", "Billing"],
        ["Old invoices", "Billing · Archived"],
      ]);
    }),
);

it.effect(
  "words typed after @ again, once they went, wait the pause afresh before the service is asked",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      const { container } = yield* Effect.promise(() => workspaceBox(registry));

      typeInComposer(container, "See @bill");
      yield* rest;
      eraseInComposer(container, 4);
      yield* Effect.promise(settle);
      const asked = workspaceReads().length;
      typeInComposer(container, "bill");
      yield* Effect.promise(settle);
      const typedAgain = workspaceReads().length;
      yield* rest;

      assert.equal(typedAgain, asked, "nothing asked before the pause");
      assert.deepEqual(workspaceReads().slice(asked), [
        { workspaceId: "workspace-1", words: "bill", includeArchived: true },
      ]);
    }),
);

it.effect(
  "an agent of another task picked from the @ list is sent as its link under its task, and one on no task under the workspace",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      const { container, sent } = yield* Effect.promise(() => workspaceBox(registry));

      typeInComposer(container, "Ask @bill");
      yield* rest;
      pressInComposer(container, "Enter");
      yield* Effect.promise(settle);
      typeInComposer(container, "and @sweep");
      yield* rest;
      pressInComposer(container, "Enter");
      yield* Effect.promise(settle);
      pressInComposer(container, "Enter");
      yield* Effect.promise(settle);

      assert.deepEqual(sent, [
        `Ask [@Bill by seat](https://tryluke.dev/acme/plan/${BILLING.id}/agent/${BILLING_AGENT.id}) and [@Sweep flaky tests](https://tryluke.dev/acme/agent/${SWEEPER.id})`,
      ]);
    }),
);

it.effect(
  "a word typed after @ finds an agent the workspace's newest leave out, as the service searches every agent for it",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      const { container } = yield* Effect.promise(() => workspaceBox(registry));

      typeInComposer(container, "See @");
      yield* Effect.promise(settle);
      const bare = agentsListed(container).map(([name]) => name);
      typeInComposer(container, "ledger");
      yield* rest;

      assert.ok(!bare.includes("Old ledger"), bare.join(", "));
      assert.deepEqual(agentsListed(container), [["Old ledger", "No task"]]);
      assert.deepEqual(workspaceReads().at(-1), {
        workspaceId: "workspace-1",
        words: "ledger",
        includeArchived: true,
      });
    }),
);

/** The box on the plan's page that reads its workspace's agents, among the workspace's members. */
async function workspaceMemberBox() {
  const sender: MessageSender = () => new Promise<CodingAgentAgentAnswer>(ignore);
  const { container } = drawing(
    amongMembers(
      createElement(WorkspacePage, null, createElement(Box, { sender, skills: noSkills })),
    ),
    undefined,
  );
  await settle();
  return container;
}

test("an @ row for an agent ends in its starter's face where a teammate started it and in nothing for the reader's own, then in the failed mark where its turn failed", async () => {
  newest = [
    {
      ...BILLING_AGENT,
      status: CODING_AGENT_STATUS.FAILED,
      startedBy: { userId: DANA_ID, name: "Dana Reyes" },
    },
    { ...SWEEPER, startedBy: { userId: READER_ID, name: "Charles Pan" } },
  ];
  const container = await workspaceMemberBox();

  typeInComposer(container, "See @");
  await settle();

  const ends = [
    ...container.querySelectorAll('.mention-menu [aria-label="Agents"] [role="option"]'),
  ].map((row) => [
    row.querySelector(".luke-combobox-option-label")?.textContent,
    ...[...(row.querySelector(".luke-combobox-option-hint")?.children ?? [])].map((mark) =>
      mark.matches(".actor-mark") ? `face ${mark.getAttribute("data-kind")}` : mark.className,
    ),
  ]);
  assert.deepEqual(ends, [
    ["Wire the desktop"],
    ["Bill by seat", `face ${ACTOR_KIND.PERSON}`, "failed-mark"],
    ["Sweep flaky tests"],
  ]);
});

it.effect(
  "an @ row for an agent hangs the agent's own card while the pointer rests on it, naming its task, with nothing read for it",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      const { container } = yield* Effect.promise(() => workspaceBox(registry));

      typeInComposer(container, "See @bill");
      yield* rest;
      const option =
        container.querySelector<HTMLElement>(
          '.mention-menu [aria-label="Agents"] [role="option"]',
        ) ?? assert.fail("the list offers the agent");
      const reads = told.length;
      restOn(option);

      const card =
        document.querySelector(".luke-tooltip-card") ?? assert.fail("the row hangs a card");
      assert.equal(card.querySelector(".luke-hover-card-name")?.textContent, "Bill by seat");
      assert.match(card.textContent ?? "", new RegExp(`On ${BILLING.name}`, "u"));
      assert.equal(told.length, reads, "the card is drawn from the agent the list read");
    }),
);

/** Luke's note on a file of the repository, as he showed its lines at `commit`. */
function shownAt(commit: string, note: string, at: number): TaskCodeShowing {
  return {
    callId: `c-${commit}`,
    turnId: "t",
    shownAt: at,
    code: {
      ref: { path: "apps/web/rollout-store.ts", startLine: 3, endLine: 5 },
      repository: "acme/relay",
      commit,
      firstLine: 1,
      lineCount: 9,
      lines: [],
      note,
    },
  };
}

/** The card an @ row hangs once the pointer rests on it, as the list is drawn for the page given. */
async function cardOfRow(page: TaskMentionsValue, typed: string, section: string) {
  const { container } = await box(page);
  typeInComposer(container, typed);
  await settle();
  const option =
    container.querySelector<HTMLElement>(
      `.mention-menu [aria-label="${section}"] [role="option"]`,
    ) ?? assert.fail(`the list offers a row under ${section}`);
  restOn(option);
  return {
    option,
    card: document.querySelector(".luke-tooltip-card") ?? assert.fail("the row hangs a card"),
  };
}

test("an @ row for a file hangs the file's card with Luke's newest note, read at the commit an open tab of it is pinned to", async () => {
  const shownCode = [
    shownAt("aaaa111", "Fix parsing", 1_000),
    shownAt("bbbb222", "Add logging", 2_000),
  ];

  const pinned = await cardOfRow(
    {
      ...planPage([]),
      shownCode,
      openFiles: [{ path: "apps/web/rollout-store.ts", commit: "aaaa111" }],
    },
    "See @rollout-store",
    "Files and folders",
  );
  assert.equal(
    pinned.card.querySelector(".luke-hover-card-name")?.textContent,
    "apps/web/rollout-store.ts",
  );
  assert.equal(pinned.card.querySelector(".luke-hover-card-note")?.textContent, "Fix parsing");
});

test("an @ row for a file with no tab open of it hangs the note of Luke's newest showing", async () => {
  const { card } = await cardOfRow(
    {
      ...planPage([]),
      shownCode: [
        shownAt("aaaa111", "Fix parsing", 1_000),
        shownAt("bbbb222", "Add logging", 2_000),
      ],
    },
    "See @rollout-store",
    "Files and folders",
  );

  assert.equal(card.querySelector(".luke-hover-card-note")?.textContent, "Add logging");
});

test("an @ row for a file Luke showed no note on hangs the file's card with its path alone", async () => {
  const { card } = await cardOfRow(planPage([]), "See @rollout-store", "Files and folders");

  assert.equal(
    card.querySelector(".luke-hover-card-name")?.textContent,
    "apps/web/rollout-store.ts",
  );
  assert.equal(card.querySelector(".luke-hover-card-note"), null);
});

test("an @ row for a page says its version where it has more than one, else its age, and hangs the page's card", async () => {
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  fakeAppPlatform({ ...DESKTOP_LINKS, pageFrameUrl });

  const later = await cardOfRow(
    { ...planPage([]), pages: [{ ...PAGE, version: 3, at: threeHoursAgo }] },
    "See @invites",
    "Pages",
  );
  assert.equal(
    later.option.querySelector(".luke-combobox-option-detail")?.textContent,
    "Version 3",
  );
  assert.equal(
    later.card.querySelector("[data-page-card] .luke-hover-card-name")?.textContent,
    PAGE.title,
  );
  assert.match(later.card.textContent ?? "", /Version 3/u);
});

test("an @ row for a page still on its first version says how long ago it was written in place of the version", async () => {
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  fakeAppPlatform({ ...DESKTOP_LINKS, pageFrameUrl });

  const { option } = await cardOfRow(
    { ...planPage([]), pages: [{ ...PAGE, version: 1, at: threeHoursAgo }] },
    "See @invites",
    "Pages",
  );

  assert.equal(option.querySelector(".luke-combobox-option-detail")?.textContent, "3h");
});

test("a sent mention of an agent of another task or none hangs its card's one reading state while it is read, never the task page's own card for an id it has no tab of", () => {
  const mention = (agentId: string, taskId: string | undefined) =>
    mentionMarkdown(
      taskId === undefined
        ? { kind: MENTION_KIND.AGENT, agentId }
        : { kind: MENTION_KIND.AGENT, taskId, agentId },
      "Agent",
      PLACE,
    );
  const container = drawn(
    createElement(TranscriptWords, {
      text: `${mention("agent-7", TASK_ID)} ${mention(BILLING_AGENT.id, BILLING.id)} ${mention(SWEEPER.id, undefined)}`,
    }),
    // The task page's doors answer a card for any id, a "Not found" one for an agent it has no tab of.
    {
      ...planPage([]),
      doors: {
        ...planPage([]).doors,
        agentOf: (agentId: string) => ({
          actor: STORE_AGENT.actor,
          card: createElement("div", { "data-mention-card": "" }, `Not found ${agentId}`),
        }),
      },
    },
  );

  const notes = [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")].map((chip) => {
    restOn(chip);
    const card = document.querySelector(".luke-tooltip-card > *");
    const words = card?.hasAttribute("data-chip-card-reading")
      ? "Reading"
      : (/Not found/u.exec(card?.textContent ?? "")?.[0] ?? card?.textContent);
    act(() => {
      chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
    return words;
  });

  assert.deepEqual(
    notes,
    ["Not found", "Reading", "Reading"],
    "the task's own agent hangs its tab's card; another task's and one on none wait on their read",
  );
});

test("a section's address pasted whole into the box on a plan's page is drawn as its chip, called by its heading, and sent as its mention", async () => {
  const { container, sent } = await box(planPage([]));
  const address = encodeMention(ROLLOUT, PLACE);

  typeInComposer(container, "Follow ");
  pasteInComposer(container, address);
  await settle();
  const chips = [...composerEditor(container).querySelectorAll("[data-mention-ref]")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Rollout"],
  );
  assert.deepEqual(sent, [`Follow [@Rollout](${address})`]);
  assert.equal(carryingTarget(container), undefined);
});

test("a page's address pasted in the app's own scheme is called by the name the window holds, an agent's it holds none for by its kind, and a file of the plan's repository pastes as words", async () => {
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: () => () => undefined,
    requestAppState: () =>
      Promise.resolve(
        stateWith(
          {},
          {
            tasks: {
              ...IDLE_TASKS_VIEW,
              activeTaskId: TASK_ID,
              pages: [{ ...PAGE, version: 1, at: 1_000 }],
            },
          },
        ),
      ),
  });
  const { container, sent } = await box(planPage([]));
  const page = encodeMention({ kind: MENTION_KIND.PAGE, taskId: TASK_ID, pageId: PAGE.id }, PLACE);
  const agent = encodeMention(
    { kind: MENTION_KIND.AGENT, taskId: TASK_ID, agentId: STORE_AGENT.id },
    PLACE,
  );
  const file = "https://github.com/acme/relay/blob/HEAD/apps/web/rollout-store.ts";

  typeInComposer(container, "Build ");
  pasteInComposer(container, page.replace("https:", "tryluke:"));
  typeInComposer(container, "on ");
  pasteInComposer(container, agent);
  typeInComposer(container, "in ");
  pasteInComposer(container, file);
  await settle();
  const chips = [...composerEditor(container).querySelectorAll("[data-mention-ref]")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    [PAGE.title, "Agent"],
  );
  assert.deepEqual(sent, [`Build [@${PAGE.title}](${page}) on [@Agent](${agent}) in ${file}`]);
});

/** The repository with folders and more files than a narrowed list shows, as the plan's page names it. */
const WIDE: MentionPlace = { workspace: "acme", repository: "acme/wide" };

/** The box on a plan whose repository is the wide one. */
async function wideBox() {
  standing = "acme/wide";
  return box(planPage([], "acme/wide"));
}

/** What the crumb over a narrowed list names: its kind or the folder walked into; none over a wide list. */
function crumb(container: HTMLElement): string | undefined {
  return container.querySelector(".mention-menu-crumb-title")?.textContent ?? undefined;
}

/** The keys the list's foot names. */
function footKeys(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".mention-menu .luke-menu-keys > *")].map(
    (key) => key.textContent ?? "",
  );
}

/** The "Mention from" rows, each by its name and its detail. */
function kindsListed(container: HTMLElement): [string, string][] {
  return [
    ...container.querySelectorAll('.mention-menu [aria-label="Mention from"] [role="option"]'),
  ].map((row) => [
    row.querySelector(".luke-combobox-option-label")?.textContent ?? "",
    row.querySelector(".luke-combobox-option-detail")?.textContent ?? "",
  ]);
}

/** ↓ pressed until the row named, in the group given, holds the highlight. */
function highlightRow(container: HTMLElement, group: string, name: string): void {
  const held = () => {
    const row = container.querySelector('.mention-menu [role="option"][aria-selected="true"]');
    return (
      row?.closest('[role="group"]')?.getAttribute("aria-label") === group &&
      row.querySelector(".luke-combobox-option-label")?.textContent === name
    );
  };
  for (let press = 0; press < 40 && !held(); press += 1) pressInComposer(container, "ArrowDown");
  assert.ok(held(), `${name} in ${group} holds the highlight`);
}

test("a bare @ ends in a row for each kind the place offers, and → on one narrows the list to that kind under its crumb", async () => {
  const { container } = await box(taskPage());

  typeInComposer(container, "See @");
  await settle();
  const kinds = kindsListed(container);
  const wideKeys = footKeys(container);
  highlightRow(container, "Mention from", "Pages");
  pressInComposer(container, "ArrowRight");
  await settle();

  assert.deepEqual(kinds, [
    ["Files and folders", "acme/relay"],
    ["Plan", "2 sections"],
    ["Pages", "1 page"],
    ["Agents", "acme"],
    ["Dates", "A day, a time, or a range"],
    ["Linear", "MCP server"],
  ]);
  assert.deepEqual(wideKeys, ["↑↓ Move", "↵ Mention", "→ Open", "esc Close"]);
  assert.equal(crumb(container), "Pages");
  assert.deepEqual(groupsListed(container), [["Pages", ["Invites by week"]]]);
  assert.deepEqual(footKeys(container), ["↑↓ Move", "↵ Mention", "⌫ All kinds", "esc Close"]);
});

/** The highlighted row, by its group and its name. */
function highlighted(container: HTMLElement): [string | null, string] | undefined {
  const row = container.querySelector('.mention-menu [role="option"][aria-selected="true"]');
  if (row === null) return undefined;
  return [
    row.closest('[role="group"]')?.getAttribute("aria-label") ?? null,
    row.querySelector(".luke-combobox-option-label")?.textContent ?? "",
  ];
}

test("a bare End and Home take the highlight to the last row and the first, a modified one is left to the editor, and Shift+Enter writes no mention", async () => {
  const { container } = await box(taskPage());

  typeInComposer(container, "See @");
  await settle();
  pressInComposer(container, "End", { shiftKey: true });
  pressInComposer(container, "Home", { metaKey: true });
  const held = highlighted(container);
  pressInComposer(container, "End");
  const last = highlighted(container);
  pressInComposer(container, "Home");
  const first = highlighted(container);
  pressInComposer(container, "Enter", { shiftKey: true });
  await settle();

  assert.deepEqual(held, ["Plan", "Goal"], "a modified Home or End is the editor's");
  assert.deepEqual(last, ["Mention from", "Linear"]);
  assert.deepEqual(first, ["Plan", "Goal"]);
  assert.equal(composerEditor(container).querySelector("[data-mention-ref]"), null);
});

test("Enter on a kind's row narrows the list to it, and ⌫ on its empty words widens it again, deleting nothing", async () => {
  const { container } = await wideBox();

  typeInComposer(container, "See @");
  await settle();
  highlightRow(container, "Mention from", "Files and folders");
  pressInComposer(container, "Enter");
  await settle();
  const narrowed = groupsListed(container);
  const narrowedCrumb = crumb(container);
  const backspace = pressInComposer(container, "Backspace");
  await settle();

  assert.equal(narrowedCrumb, "Files and folders");
  assert.deepEqual(narrowed, [["Files and folders", ["apps/", "README.md"]]]);
  assert.equal(backspace.defaultPrevented, true);
  assert.equal(composerEditor(container).textContent, "See @");
  assert.equal(crumb(container), undefined);
  assert.ok(kindsListed(container).length > 0, "the kinds' rows stand again");
});

test("pressing the crumb's back arrow widens the list again and keeps the caret in the composer", async () => {
  const { container } = await wideBox();

  typeInComposer(container, "See @");
  await settle();
  highlightRow(container, "Mention from", "Files and folders");
  pressInComposer(container, "ArrowRight");
  await settle();
  const back = [
    ...container.querySelectorAll<HTMLButtonElement>(".mention-menu-crumb button"),
  ].find((each) => each.textContent === "All kinds");
  assert.ok(back !== undefined, "the narrowed list's crumb offers the way back");
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  back.dispatchEvent(press);
  act(() => back.click());
  await settle();

  assert.equal(press.defaultPrevented, true);
  assert.equal(back.tabIndex, -1);
  assert.equal(composerEditor(container).textContent, "See @");
  assert.equal(crumb(container), undefined);
  assert.ok(kindsListed(container).length > 0, "the kinds' rows stand again");
});

/** The `count` letters before the caret deleted, as ⌫ pressed that many times would. */
function eraseInComposer(container: ParentNode, count: number): void {
  const editor = composerEditor(container).editor ?? assert.fail("the box's editor is running");
  act(() => {
    const at = editor.state.selection.from;
    editor.view.dispatch(editor.state.tr.delete(at - count, at));
  });
}

test("files found by a word typed on are those the longer word finds, and the word typed back finds every file it found before", async () => {
  const { container } = await wideBox();

  typeInComposer(container, "See @files:invite-");
  await settle();
  const typed = listed(container);
  typeInComposer(container, "5");
  await settle();
  const typedOn = listed(container);
  eraseInComposer(container, 1);
  await settle();

  assert.equal(typed.length, 50);
  assert.deepEqual(
    [...typedOn].sort(),
    ["05", "15", "25", "35", "45", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59"].map(
      (number) => `invite-${number}.ts`,
    ),
  );
  assert.deepEqual(listed(container), typed);
});

test("typing @files: narrows the list to the repository's paths, listing up to fifty where the wide list shows four", async () => {
  const { container } = await wideBox();

  typeInComposer(container, "See @invite");
  await settle();
  const wide = groupsListed(container).find(([group]) => group === "Files and folders");
  typeInComposer(container, " and @files:invite");
  await settle();

  assert.equal(wide?.[1].length, 4);
  assert.equal(crumb(container), "Files and folders");
  assert.equal(listed(container).length, 50);
  assert.ok(listed(container).every((name) => name.startsWith("invite-")));
});

test("→ on a folder walks into it, its first row the folder and the rest what it holds, and ⌫ climbs back out", async () => {
  const { container } = await wideBox();

  typeInComposer(container, "See @files:");
  await settle();
  pressInComposer(container, "ArrowRight");
  await settle();
  const inApps = [crumb(container), listed(container)];
  highlightRow(container, "apps", "web/");
  pressInComposer(container, "ArrowRight");
  await settle();
  const inWeb = [crumb(container), listed(container).slice(0, 3), listed(container).length];
  const keys = footKeys(container);
  pressInComposer(container, "Backspace");
  await settle();

  assert.deepEqual(inApps, ["apps", ["apps/", "web/"]]);
  assert.deepEqual(inWeb, ["apps/web", ["web/", "invite-01.ts", "invite-02.ts"], 50]);
  assert.deepEqual(keys, ["↑↓ Move", "↵ Mention", "→ Open", "⌫ Up", "esc Close"]);
  assert.deepEqual([crumb(container), listed(container)], ["apps", ["apps/", "web/"]]);
  assert.equal(composerEditor(container).textContent, "See @files:");
});

test("a file or a folder picked from a narrowed list is sent as the same link the wide list writes", async () => {
  const { container, sent } = await wideBox();

  typeInComposer(container, "Ship @invite-07");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  typeInComposer(container, "and @files:");
  await settle();
  pressInComposer(container, "ArrowRight");
  await settle();
  highlightRow(container, "apps", "web/");
  pressInComposer(container, "ArrowRight");
  await settle();
  typeInComposer(container, "invite-07");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  typeInComposer(container, "in @files:");
  await settle();
  pressInComposer(container, "ArrowRight");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  pressInComposer(container, "Enter");
  await settle();

  const file = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "apps/web/invite-07.ts" },
    "invite-07.ts",
    WIDE,
  );
  const folder = mentionMarkdown({ kind: MENTION_KIND.FOLDER, path: "apps" }, "apps/", WIDE);
  assert.deepEqual(sent, [`Ship ${file} and ${file} in ${folder}`]);
});

test("typing a server's provider and a colon narrows the list to that server, its tools listed before a word is typed", async () => {
  const { container } = await box(planPage([]));

  typeInComposer(container, "Use @linear:");
  await settle();

  assert.equal(crumb(container), "Linear");
  assert.deepEqual(listed(container), ["Linear", "Linear · list_issues", "Linear · get_issue"]);
});

/** A pull request an agent of the task published, as GitHub holds it now. */
function pullRequest(
  number: number,
  title: string,
  state: CodingAgentPullRequest["state"],
): CodingAgentPullRequest {
  return {
    number,
    title,
    url: `https://github.com/acme/relay/pull/${number}`,
    state,
    checks: CHECK_SUMMARY.PASSING,
    additions: 12,
    deletions: 3,
    changedFiles: 2,
  };
}

const SEATS = pullRequest(3059, "feat(billing): bill by seat", PULL_REQUEST_STATE.OPEN);
const SWEEP = pullRequest(3061, "test: sweep flaky tests", PULL_REQUEST_STATE.MERGED);

/** The task's page whose agents published two pull requests, one of them by an archived agent and one by two agents. */
function publishedPage(): TaskMentionsValue {
  return {
    ...taskPage(),
    pullRequests: mentionablePullRequests({
      agents: [BILLING_AGENT, LEDGER],
      archived: [OLD_AGENT],
      models: undefined,
      // The ledger's agent pushed to the same pull request as the billing one.
      pullRequests: new Map([
        [OLD_AGENT.id, SWEEP],
        [LEDGER.id, SEATS],
        [BILLING_AGENT.id, SEATS],
      ]),
    }),
  };
}

/** The Pull requests group's rows, each by its name, its detail, and where its mark says it stands. */
function pullRequestsListed(container: HTMLElement): [string, string, string | null][] {
  return [
    ...container.querySelectorAll('.mention-menu [aria-label="Pull requests"] [role="option"]'),
  ].map((row) => [
    row.querySelector(".luke-combobox-option-label")?.textContent ?? "",
    row.querySelector(".luke-combobox-option-detail")?.textContent ?? "",
    row.querySelector("[data-pull-request-state]")?.getAttribute("data-pull-request-state") ?? null,
  ]);
}

test("an @ on a task's page offers the pull requests its agents published, each once, by its number and title, labelled by its first agent", async () => {
  const { container } = await box(publishedPage());

  typeInComposer(container, "See @");
  await settle();

  assert.deepEqual(pullRequestsListed(container), [
    ["#3059 feat(billing): bill by seat", "Bill by seat", PULL_REQUEST_STATE.OPEN],
    ["#3061 test: sweep flaky tests", "Old invoices", PULL_REQUEST_STATE.MERGED],
  ]);
});

test("a pull request picked from the @ list is drawn as its link's chip and sent as its GitHub address", async () => {
  const { container, sent } = await box(publishedPage());

  typeInComposer(container, "Review @3059");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  const chips = [...composerEditor(container).querySelectorAll("[data-mention-ref]")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["#3059 feat(billing): bill by seat"],
  );
  assert.deepEqual(sent, [
    `Review ${mentionMarkdown({ kind: MENTION_KIND.LINK, provider: INTEGRATION_PROVIDER.GITHUB, url: SEATS.url }, "#3059 feat(billing): bill by seat", PLACE)}`,
  ]);
  assert.equal(
    sent[0],
    "Review [@#3059 feat(billing): bill by seat](https://github.com/acme/relay/pull/3059)",
  );
});

test("the task's pull requests are a kind of their own, narrowed to by their row or by @prs:", async () => {
  const { container } = await box(publishedPage());

  typeInComposer(container, "See @");
  await settle();
  const kind = kindsListed(container).find(([name]) => name === "Pull requests");
  highlightRow(container, "Mention from", "Pull requests");
  pressInComposer(container, "ArrowRight");
  await settle();
  const opened = [crumb(container), listed(container)];
  typeInComposer(container, " and @prs:sweep");
  await settle();

  assert.deepEqual(kind, ["Pull requests", "2 pull requests"]);
  assert.deepEqual(opened, [
    "Pull requests",
    ["#3059 feat(billing): bill by seat", "#3061 test: sweep flaky tests"],
  ]);
  assert.deepEqual(
    [crumb(container), listed(container)],
    ["Pull requests", ["#3061 test: sweep flaky tests"]],
  );
});

/** The node drawn on a plan's page in a workspace whose members the window reads. */
function amongMembers(node: ReactNode): ReactNode {
  return createElement(MemberDirectory, {
    workspace: { id: "workspace-1", memberCount: MEMBERS.length },
    readerId: READER_ID,
    children: node,
  });
}

/** The box drawn on a plan's page among the workspace's members, every message it sends written down. */
async function memberBox() {
  const sent: string[] = [];
  const sender: MessageSender = (_agentId, text) => {
    sent.push(text);
    return new Promise<CodingAgentAgentAnswer>(ignore);
  };
  const { container } = drawing(
    amongMembers(createElement(Box, { sender, skills: noSkills })),
    taskPage(),
  );
  await settle();
  return { container, sent };
}

/** The People group's rows, each by its name, its detail, and its mark's kind. */
function peopleListed(container: HTMLElement): [string, string, string | null][] {
  return [...container.querySelectorAll('.mention-menu [aria-label="People"] [role="option"]')].map(
    (row) => [
      row.querySelector(".luke-combobox-option-label")?.textContent ?? "",
      row.querySelector(".luke-combobox-option-detail")?.textContent ?? "",
      row.querySelector(".actor-mark")?.getAttribute("data-kind") ?? null,
    ],
  );
}

test("an @ among the workspace's members offers its people, the reader first as You and the rest by name with their email, each wearing their mark, and a kind of their own narrowed to by @people:", async () => {
  const { container } = await memberBox();

  typeInComposer(container, "See @");
  await settle();
  const people = peopleListed(container);
  const kind = kindsListed(container).find(([name]) => name === "People");
  typeInComposer(container, " and @people:reyes");
  await settle();

  assert.deepEqual(people, [
    ["Charles Pan", "You", ACTOR_KIND.PERSON],
    ["Dana Reyes", "dana@example.com", ACTOR_KIND.PERSON],
  ]);
  assert.deepEqual(kind, ["People", "2 members"]);
  assert.deepEqual([crumb(container), listed(container)], ["People", ["Dana Reyes"]]);
});

test("a person picked from the @ list is drawn as their chip and sent as their page's link, which names them by their account's id alone", async () => {
  const { container, sent } = await memberBox();

  typeInComposer(container, "Ask @dana");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  const chips = [...composerEditor(container).querySelectorAll(".luke-inline-ref-label")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Dana Reyes"],
  );
  assert.deepEqual(sent, ["Ask [@Dana Reyes](https://tryluke.dev/acme/person/u_dana)"]);
});

test("a sent message's mention of a person is drawn as the chip wearing their mark and their name now that opens their page, its target on no attribute", async () => {
  const opened: ReadLink[] = [];
  const person = mentionMarkdown({ kind: MENTION_KIND.PERSON, userId: DANA_ID }, "Dana", PLACE);
  const container = drawn(
    amongMembers(
      createElement(
        OpenLinkProvider,
        { value: (link: ReadLink) => opened.push(link) },
        createElement(TranscriptWords, { text: `Ask ${person} to review.` }),
      ),
    ),
    taskPage(),
  );
  await settle();

  const chip = container.querySelector<HTMLButtonElement>("button[data-mention-ref]");
  assert.ok(chip);
  act(() => chip.click());

  assert.equal(chip.querySelector(".luke-inline-ref-label")?.textContent, "Dana Reyes");
  assert.equal(chip.dataset.kind, MENTION_KIND.PERSON);
  assert.equal(chip.querySelector(".actor-mark")?.getAttribute("data-kind"), ACTOR_KIND.PERSON);
  assert.deepEqual(opened, [
    { workspace: "acme", place: { kind: LINK_PLACE.PERSON, userId: DANA_ID } },
  ]);
  assert.equal(carryingTarget(container), undefined);
});

test("off a members' directory an @ offers no people", async () => {
  const { container } = await box(taskPage());

  typeInComposer(container, "See @dana");
  await settle();

  assert.deepEqual(peopleListed(container), []);
});

test("a person's page pasted into the box becomes their chip called by their name, and one of another workspace pastes as the words it is", async () => {
  const { container, sent } = await memberBox();
  const here = "https://tryluke.dev/acme/person/u_dana";
  const elsewhere = "https://tryluke.dev/other/person/u_dana";

  typeInComposer(container, "Ask ");
  pasteInComposer(container, here);
  typeInComposer(container, "not ");
  pasteInComposer(container, elsewhere);
  await settle();
  const chips = [...composerEditor(container).querySelectorAll(".luke-inline-ref-label")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Dana Reyes"],
  );
  assert.deepEqual(sent, [`Ask [@Dana Reyes](${here}) not ${elsewhere}`]);
});

test("an old Luke issue page's link pasted into the box stays the words it is, since Luke keeps no issues of its own", async () => {
  const { container, sent } = await box(taskPage());
  const old = "https://tryluke.dev/acme/issue/3f0e6f5c-7d1a-4f6e-9a55-000000000007";

  typeInComposer(container, "Fix ");
  pasteInComposer(container, old);
  await settle();
  const chips = [...composerEditor(container).querySelectorAll(".luke-inline-ref-label")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(chips, []);
  assert.deepEqual(sent, [`Fix ${old}`]);
});

/** Monday, October 19, 2026, at noon in UTC: the same day in any zone within eleven hours of it. */
const MONDAY_NOON = Date.parse("2026-10-19T12:00:00Z");

test("words after an @ that read as a date offer it first, said from today, and its pick is drawn from today and sent with the date in full", async () => {
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  try {
    const { container, sent } = await box(taskPage());

    typeInComposer(container, "Ship it @tomorrow");
    await settle();
    const offered = groupsListed(container)[0];
    pressInComposer(container, "Enter");
    await settle();
    const chips = [...composerEditor(container).querySelectorAll("[data-mention-ref]")];
    pressInComposer(container, "Enter");
    await settle();

    assert.deepEqual(offered, ["Dates", ["Tomorrow"]]);
    assert.deepEqual(
      chips.map((chip) => chip.textContent),
      ["Tomorrow"],
    );
    assert.deepEqual(sent, ["Ship it [@Oct 20, 2026](luke://date/2026-10-20)"]);
  } finally {
    vi.useRealTimers();
  }
});

test("a date's chip in the box opens its picker, and the day picked there is the date the message sends", async () => {
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  try {
    const { container, sent } = await box(taskPage());

    typeInComposer(container, "Ship it @tomorrow");
    await settle();
    pressInComposer(container, "Enter");
    await settle();
    const chip = composerEditor(container).querySelector<HTMLElement>("button[data-mention-ref]");
    assert.ok(chip, "the date's chip is a button in the box");
    act(() => chip.click());
    await settle();
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog, "the picker is open");
    act(() =>
      dialog
        .querySelector<HTMLButtonElement>('button[aria-label="Thursday, October 22, 2026"]')
        ?.click(),
    );
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await settle();
    pressInComposer(container, "Enter");
    await settle();

    assert.equal(container.querySelector('[role="dialog"]'), null);
    assert.deepEqual(sent, ["Ship it [@Oct 22, 2026](luke://date/2026-10-22)"]);
  } finally {
    vi.useRealTimers();
  }
});

test("an @ narrowed to dates offers today, tomorrow, and next Monday before a word is typed, then the row that opens the picker", async () => {
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  try {
    const { container } = await box(taskPage());

    typeInComposer(container, "Due @dates:");
    await settle();

    assert.equal(crumb(container), "Dates");
    assert.deepEqual(groupsListed(container), [
      ["Dates", ["Today", "Tomorrow", "Oct 26", "Pick a date…"]],
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("a sent message's date is drawn as a chip saying it from today that opens nothing, and words that read as no date stay words", () => {
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  try {
    const container = drawn(
      createElement(TranscriptWords, {
        text: "Ready [@Oct 23, 2026](luke://date/2026-10-23), not [@Feb 30](luke://date/2026-02-30).",
      }),
      planPage([]),
    );

    const chips = [...container.querySelectorAll("[data-mention-ref]")];

    assert.deepEqual(
      chips.map((chip) => [chip.tagName, chip.textContent]),
      [["SPAN", "Friday"]],
    );
  } finally {
    vi.useRealTimers();
  }
});
