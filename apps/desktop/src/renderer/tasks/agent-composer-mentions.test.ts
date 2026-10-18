// @vitest-environment jsdom

import assert from "node:assert/strict";
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
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import {
  encodeMention,
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  mentionMarkdown,
} from "@luke/features/mention-link";
import { TASK_TREE_ENTRY } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { MemberDirectory } from "@luke/panel/member-directory";
import { OpenLinkProvider } from "@luke/panel/tasks/use-open-link";
import { fakeAppBridge, fakeAppBridgeCalls } from "@luke/panel/testing/app-bridge";
import { stateWith } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { markdownHtmlParserLanded } from "@luke/panel/testing/markdown";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { ACTOR_KIND, ACTOR_STATE } from "@luke/ui/actor-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { DESKTOP_LINKS, fakeAppPlatform } from "#testing/app-platform";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "#testing/composer";
import { AgentComposer } from "./agent-composer";
import type { SkillSource } from "./skill-picker";
import {
  mentionablePullRequests,
  TaskMentions,
  type TaskMentionsValue,
  tasklessMentions,
  useMentionAgentsReader,
} from "./task-mentions";
import { TranscriptWords } from "./transcript-blocks";
import { type MessageSender, useAgentComposer } from "./use-agent-composer";

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

/** The workspace's list as the service answers it: the newest, or those whose title or task's name holds the words, as the store finds them. */
function workspaceAnswer({ words }: CodingAgentWorkspaceListParams): readonly CodingAgentSummary[] {
  if (words === undefined) return NEWEST_AGENTS;
  const lower = words.toLowerCase();
  return WORKSPACE_AGENTS.filter(
    (agent) =>
      (agent.title ?? "").toLowerCase().includes(lower) ||
      (agent.planId === BILLING.id && BILLING.name.toLowerCase().includes(lower)),
  );
}

/** The workspace's members, as its Members list reads them: the reader, and a teammate. */
const READER_ID = "u_reader";
const DANA_ID = "u_dana";
const MEMBERS: readonly WorkspaceMember[] = [
  {
    userId: READER_ID,
    name: "Charles Pan",
    email: "charles@example.com",
    role: WORKSPACE_ROLE.OWNER,
  },
  { userId: DANA_ID, name: "Dana Reyes", email: "dana@example.com", role: WORKSPACE_ROLE.ADMIN },
];

/** Every act the panel told the main process, in order. */
const told: Act[] = [];

/** The repository the task's tree is read from now. */
let standing = "acme/relay";

const noSkills: SkillSource = () => Promise.resolve({ skills: [] });

const ignore = () => undefined;

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  standing = "acme/relay";
  told.length = 0;
  installScrollIntoView();
  installEditorLayout();
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => {
      told.push(request);
      return Promise.resolve(
        request.kind === ACT_KIND.INTEGRATIONS_STATUS
          ? {
              status: ACT_OUTCOME_STATUS.DONE,
              value: {
                integrations: LINEAR_CONNECTED,
              },
            }
          : request.kind === ACT_KIND.INTEGRATIONS_TOOLS
            ? {
                status: ACT_OUTCOME_STATUS.DONE,
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
              ? { status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS }
              : request.kind === ACT_KIND.CODING_AGENTS_WORKSPACE_LIST
                ? {
                    status: ACT_OUTCOME_STATUS.DONE,
                    value: {
                      agents: workspaceAnswer(request.payload),
                    },
                  }
                : request.kind === ACT_KIND.TASKS_TREE
                  ? {
                      status: ACT_OUTCOME_STATUS.DONE,
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
                  : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
      );
    },
  });
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
const PAGE = { id: "page-1", title: "Invites by week" };
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

/** The plan's page holding its pages and agents, every link a chip was asked to open kept. */
function taskPage(opened: Mention[] = []): TaskMentionsValue {
  return { ...planPage(opened), pages: [PAGE], agents: [SELF_AGENT, STORE_AGENT] };
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

/** The node drawn on a task's page, or off any page where none is given; `redraw` draws it on the page given. */
function drawing(node: ReactNode, page: TaskMentionsValue | undefined) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
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
  const chips = [...composerEditor(container).querySelectorAll(".skill-chip")];
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

test("an @ in the box on a plan's page offers the plan's pages and its other agents, each in its own group, and not the agent whose box it is", async () => {
  const { container } = await box(taskPage());

  typeInComposer(container, "See @");
  await settle();
  const agentGlyph = container.querySelector('.mention-menu [aria-label="Agents"] .actor-mark');

  assert.deepEqual(groupsListed(container), [
    ["Plan", ["Goal", "Rollout", "Invitations"]],
    ["Pages", ["Invites by week"]],
    ["Agents", ["Wire the desktop"]],
    ["MCP servers", ["Linear"]],
    ["Mention from", ["Files and folders", "Plan", "Pages", "Agents", "Linear"]],
  ]);
  assert.equal(agentGlyph?.getAttribute("data-kind"), ACTOR_KIND.AGENT);
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

/** The box on the plan's page that reads its workspace's agents, every message it sends written down. */
async function workspaceBox() {
  const sent: string[] = [];
  const sender: MessageSender = (_agentId, text) => {
    sent.push(text);
    return new Promise<CodingAgentAgentAnswer>(ignore);
  };
  const { container } = drawing(
    createElement(WorkspacePage, null, createElement(Box, { sender, skills: noSkills })),
    undefined,
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

test("a word typed after @ finds an agent of another task by its task's name, and an archived one, read then and marked archived", async () => {
  const { container } = await workspaceBox();

  typeInComposer(container, "See @billing");
  await settle();

  assert.deepEqual(agentsListed(container), [
    ["Bill by seat", "Billing"],
    ["Old invoices", "Billing · Archived"],
  ]);
  // The word was typed whole, so the one read asked the service to find it, archived agents among them.
  assert.deepEqual(workspaceReads(), [
    { workspaceId: "workspace-1", words: "billing", includeArchived: true },
  ]);
});

test("an agent of another task picked from the @ list is sent as its link under its task, and one on no task under the workspace", async () => {
  const { container, sent } = await workspaceBox();

  typeInComposer(container, "Ask @bill");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  typeInComposer(container, "and @sweep");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(sent, [
    `Ask [@Bill by seat](https://tryluke.dev/acme/plan/${BILLING.id}/agent/${BILLING_AGENT.id}) and [@Sweep flaky tests](https://tryluke.dev/acme/agent/${SWEEPER.id})`,
  ]);
});

test("a word typed after @ finds an agent the workspace's newest leave out, as the service searches every agent for it", async () => {
  const { container } = await workspaceBox();

  typeInComposer(container, "See @");
  await settle();
  const bare = agentsListed(container).map(([name]) => name);
  typeInComposer(container, "ledger");
  await settle();

  assert.ok(!bare.includes("Old ledger"), bare.join(", "));
  assert.deepEqual(agentsListed(container), [["Old ledger", "No task"]]);
  assert.deepEqual(workspaceReads().at(-1), {
    workspaceId: "workspace-1",
    words: "ledger",
    includeArchived: true,
  });
});

test("a sent mention of an agent of another task or none hangs a card naming where it works, never the task page's own card for an id it has no tab of", () => {
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
    act(() => {
      chip.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const card = document.querySelector(".luke-tooltip-card [data-mention-card]");
    const words = card?.textContent ?? "";
    act(() => {
      chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
    return words;
  });

  assert.deepEqual(
    notes.map((words) => /A coding agent on [a-z ]+task|Not found/u.exec(words)?.[0]),
    ["Not found", "A coding agent on another task", "A coding agent on no task"],
    "the task's own agent hangs its tab's card; another task's and one on none name where they work",
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
          { tasks: { ...IDLE_TASKS_VIEW, pages: [{ ...PAGE, version: 1, at: 1_000 }] } },
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
  return [...container.querySelectorAll(".mention-menu-foot span")].map(
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
  const back = container.querySelector<HTMLButtonElement>('button[aria-label="All kinds"]');
  assert.ok(back !== null, "the narrowed list's crumb offers the way back");
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

test("an @ among the workspace's members offers its people, the reader as You, each wearing their mark, and a kind of their own narrowed to by @people:", async () => {
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

test("a sent message's mention of a person is drawn as the chip wearing their mark that opens their page, its target on no attribute", async () => {
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

  assert.equal(chip.querySelector(".luke-inline-ref-label")?.textContent, "Dana");
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
