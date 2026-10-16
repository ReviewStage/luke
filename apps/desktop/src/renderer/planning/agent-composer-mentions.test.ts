// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentAgentAnswer } from "@luke/features/coding-agent-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import {
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  mentionMarkdown,
} from "@luke/features/mention-link";
import { PLAN_TREE_ENTRY } from "@luke/features/plan-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { ACTOR_KIND, ACTOR_STATE } from "@luke/ui/actor-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import {
  composerEditor,
  installEditorBundle,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "#testing/composer";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentComposer } from "./agent-composer";
import { PlanMentions, type PlanMentionsValue, planlessMentions } from "./plan-mentions";
import type { SkillSource } from "./skill-picker";
import { TranscriptWords } from "./transcript-blocks";
import { type MessageSender, useAgentComposer } from "./use-agent-composer";
import { OpenLinkProvider } from "./use-open-link";

/**
 * `@` in an agent's message box and its transcript, on a plan's page and
 * off it, over the real editor bundle: the word typed opens the list of the
 * plan's sections and the repository's files, the row chosen is written
 * into the message as its link and drawn in the box as its chip, the link
 * is what is sent, and a sent message's mention is drawn as the chip that
 * opens it. Off a plan's page an `@` is a letter, and a sent mention is
 * still its chip, opened through the window's own doors.
 * Synthetic plan and repository.
 */

const PLAN_ID = "pl_1";

const PLAN_TEXT = "## Goal\n\nInvite by email.\n\n## Rollout\n\nStore first.\n";

const ROLLOUT: Mention = { kind: MENTION_KIND.SECTION, planId: PLAN_ID, anchor: "rollout" };

const PLACE: MentionPlace = { workspace: "acme", repository: "acme/relay" };

/** The files each repository holds, as the plan's tree answers them. */
const TREES: ReadonlyMap<string, string> = new Map([
  ["acme/relay", "apps/web/rollout-store.ts"],
  ["acme/next", "apps/web/rollout-next.ts"],
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

/** Every act the panel told the main process, in order. */
const told: Act[] = [];

/** The repository the plan's tree is read from now. */
let standing = "acme/relay";

const noSkills: SkillSource = () => Promise.resolve({ skills: [] });

const ignore = () => undefined;

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

// Set before any box renders, since the box reads the editor bundle once per window.
installEditorBundle();

beforeEach(() => {
  standing = "acme/relay";
  told.length = 0;
  installScrollIntoView();
  installEditorLayout();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
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
              : request.kind === ACT_KIND.PLANNING_TREE
                ? {
                    status: ACT_OUTCOME_STATUS.DONE,
                    value: {
                      folder: {
                        path: "",
                        repository: standing,
                        branch: "main",
                        entries: [{ name: TREES.get(standing) ?? "", kind: PLAN_TREE_ENTRY.FILE }],
                        truncated: false,
                      },
                    },
                  }
                : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
        );
      },
      recordSurfaceEvent: ignore,
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

/** What a plan's page hands its places, every mention a chip was asked to open kept. */
function planPage(opened: Mention[], repository = "acme/relay"): PlanMentionsValue {
  return {
    planId: PLAN_ID,
    planName: "Invitations",
    workspace: PLACE.workspace,
    repository,
    text: () => PLAN_TEXT,
    doors: {
      planId: PLAN_ID,
      place: { workspace: PLACE.workspace, repository },
      anchors: new Set(["goal", "rollout"]),
      onOpenPlan: (mention) => opened.push(mention),
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
function taskPage(opened: Mention[] = []): PlanMentionsValue {
  return { ...planPage(opened), pages: [PAGE], agents: [SELF_AGENT, STORE_AGENT] };
}

/** The box on the composer's own control, its sends answered by `sender`. */
function Box({ sender, skills }: { sender: MessageSender; skills: SkillSource }): ReactNode {
  const composer = useAgentComposer({
    agentId: SELF_ID,
    planId: PLAN_ID,
    messages: [],
    send: sender,
    onStatus: ignore,
  });
  return createElement(AgentComposer, { ...QUIET_COMPOSER, agentId: SELF_ID, composer, skills });
}

/** The node drawn on a plan's page, or off any page where none is given; `redraw` draws it on the page given. */
function drawing(node: ReactNode, page: PlanMentionsValue | undefined) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const redraw = (on: PlanMentionsValue | undefined) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          on === undefined
            ? createElement(Fragment, null, node)
            : createElement(PlanMentions, { value: on, children: node }),
        ),
      ),
    );
  redraw(page);
  return { container, redraw };
}

/** The node drawn on a plan's page, or off any page where none is given. */
function drawn(node: ReactNode, page: PlanMentionsValue | undefined): HTMLElement {
  return drawing(node, page).container;
}

/** The box drawn, every message it sends written down. */
async function box(page: PlanMentionsValue | undefined, skills: SkillSource = noSkills) {
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

/** The rows the list draws, by name. */
function listed(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".mention-menu .plan-compose-menu-name")].map(
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
  const chips = [...composerEditor(container).querySelectorAll(".mention-chip")];
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
  const page = planlessMentions(
    { workspace: "acme", workspaceId: "workspace-1", repository: "acme/relay" },
    ignore,
  );
  const { container } = await box(page);

  typeInComposer(container, "Follow @roll");
  await settle();

  assert.deepEqual(listed(container), ["rollout-store.ts"]);
  assert.deepEqual(
    told.filter((each) => each.kind === ACT_KIND.PLANNING_TREE).map((each) => each.payload),
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

  const chip = container.querySelector<HTMLButtonElement>("button.mention-chip");
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

  const chip = container.querySelector<HTMLButtonElement>("button.mention-chip");
  assert.ok(chip !== null, "the mention is a chip");
  act(() => chip.click());

  assert.equal(container.textContent, "Follow Rollout.");
  assert.deepEqual(opened, [
    { workspace: "", place: { kind: LINK_PLACE.SECTION, planId: PLAN_ID, anchor: "rollout" } },
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

  const chip = container.querySelector(".mention-chip");

  assert.equal(chip?.tagName, "SPAN");
  assert.equal(chip?.textContent, "Linear");
  assert.equal(carryingTarget(container), undefined);
});

test("an @ in the box offers the account's connected MCP servers, and once a word is typed their tools, a pick sent as its link", async () => {
  const { container, sent } = await box(planPage([]));

  typeInComposer(container, "Use @");
  await settle();
  const servers = listed(container);
  typeInComposer(container, "list");
  await settle();
  const tools = listed(container);
  pressInComposer(container, "Enter");
  await settle();
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(servers, ["Goal", "Rollout", "Invitations", "Linear"]);
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
  const chips = [...composerEditor(container).querySelectorAll(".mention-chip")];
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

  const chip = container.querySelector<HTMLButtonElement>("button.mention-chip");
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

  const chip = container.querySelector<HTMLButtonElement>("button.mention-chip");
  assert.ok(chip !== null, "the page is a chip");
  act(() => chip.click());

  assert.deepEqual(told.at(-1), { kind: ACT_KIND.WEB_OPEN, payload: { url: ISSUE_URL } });
  assert.equal(carryingTarget(container), undefined);
});

/** The list's groups, each by its label with its rows' names. */
function groupsListed(container: HTMLElement): [string | null, string[]][] {
  return [...container.querySelectorAll('.mention-menu [role="group"]')].map((group) => [
    group.getAttribute("aria-label"),
    [...group.querySelectorAll(".plan-compose-menu-name")].map((name) => name.textContent ?? ""),
  ]);
}

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
  ]);
  assert.equal(agentGlyph?.getAttribute("data-kind"), ACTOR_KIND.AGENT);
});

test("a page picked from the @ list is drawn as its chip and sent as its link, which names the page by its id alone", async () => {
  const { container, sent } = await box(taskPage());

  typeInComposer(container, "Build @invites");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  const chips = [...composerEditor(container).querySelectorAll(".mention-chip")];
  pressInComposer(container, "Enter");
  await settle();

  const pageMention: Mention = { kind: MENTION_KIND.PAGE, planId: PLAN_ID, pageId: PAGE.id };
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
    { kind: MENTION_KIND.PAGE, planId: PLAN_ID, pageId: PAGE.id },
    PAGE.title,
    PLACE,
  );
  const agent = mentionMarkdown(
    { kind: MENTION_KIND.AGENT, planId: PLAN_ID, agentId: STORE_AGENT.id },
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

  const chips = [...container.querySelectorAll<HTMLButtonElement>("button.mention-chip")];
  for (const chip of chips) act(() => chip.click());

  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    [PAGE.title, STORE_AGENT.name],
  );
  assert.deepEqual(opened, [
    { workspace: "acme", place: { kind: LINK_PLACE.PAGE, planId: PLAN_ID, pageId: PAGE.id } },
    {
      workspace: "acme",
      place: { kind: LINK_PLACE.AGENT, planId: PLAN_ID, agentId: STORE_AGENT.id },
    },
  ]);
  assert.equal(carryingTarget(container), undefined);
});
