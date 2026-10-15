// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentPageAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentPage,
  type CodingAgentPullRequestAnswer,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { runAppCommand } from "../app-commands";
import { archiveWords } from "../planning/coding-agent-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { useSidePanel } from "../planning/use-side-panel";
import { ToastHost } from "../toast";
import { DesktopAgentPage } from "./desktop-agent-page";

/**
 * desktop-agent-page.test.ts -- one agent's page as the window draws it: the agent read by its id, titled as its tab would be, and a read that did not land said with a retry.
 *
 * The service is a script at the act boundary; synthetic agents and words throughout.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PAGE: CodingAgentPage = {
  id: AGENT_ID,
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Sweep the flaky tests",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
  workspaceId: "workspace-1",
  repository: "acme/relay",
};

let root: Root | undefined;

// A message is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));
/** How the next reads of the agent's page answer, in order; the last stands for every read after it. */
let pages: CodingAgentPageAnswerView[] = [];
/** Every agent whose page was read, in order. */
let read: string[] = [];
/** Every archive or Unarchive asked, as the act carried it. */
let archives: { agentId: string; archived: boolean }[] = [];
/** Whether an archive or Unarchive is refused, as an unanswered service refuses it. */
let archiveRefused = false;
/** What the agent's workspace's members read answers; none refuses it. */
let members: readonly WorkspaceMember[] | undefined;
/** What the next read of the agent's transcript answers; none refuses it. */
let transcript: CodingAgentMessagesAnswerView | undefined;
/** Every act the page told or asked, in order. */
let told: Act[] = [];
/** What a read of what the agent published answers; none refuses it. */
let published: CodingAgentPullRequestAnswer | undefined;

beforeEach(() => {
  pages = [{ agent: PAGE }];
  read = [];
  archives = [];
  archiveRefused = false;
  members = undefined;
  transcript = undefined;
  told = [];
  published = undefined;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        told.push(request);
        if (request.kind === ACT_KIND.PLANNING_SKILLS) {
          const value = {
            skills: {
              repository: "acme/relay",
              branch: "main",
              skills: [
                {
                  name: "release",
                  description: "Cut a release.",
                  path: ".agents/skills/release/SKILL.md",
                },
              ],
            },
          };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.CODING_AGENTS_ARCHIVE) {
          archives.push(request.payload);
          const value = archiveRefused
            ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
            : { agent: { ...PAGE, archivedAt: undefined } };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ && members !== undefined) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: members });
        }
        if (request.kind === ACT_KIND.CODING_AGENTS_MESSAGES && transcript !== undefined) {
          // Note that only the first read answers, because a read past the cursor waits on the service, and one answered at once would be read again without end.
          const value = transcript;
          transcript = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.CODING_AGENTS_PULL_REQUEST && published !== undefined) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: published });
        }
        if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
          read.push(request.payload.agentId);
          const value = pages.length > 1 ? pages.shift() : pages[0];
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The page of the agent, standing in the plan's place, as the window's plans control holds it. */
function mount(plans: PlansControl = plansControl({})): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(DesktopAgentPage, { plans, agentId: AGENT_ID }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
  return container;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("the page reads the agent by its id and titles it as its tab would", async () => {
  const page = mount();
  await settle();

  assert.deepEqual(read, [AGENT_ID]);
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the flaky tests");
});

test("the page draws the task column's agent pane, at its reading width, and ⌘F finds in the agent's transcript", async () => {
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: "text", text: "The flaky retry is gone." }],
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount();
  await settle();

  let offered = false;
  act(() => {
    offered = runAppCommand(APP_COMMAND.FIND);
  });

  assert.ok(page.querySelector(".desktop-agent [role='log']"), "the transcript is the pane's");
  assert.equal(offered, true);
  assert.ok(page.querySelector(".desktop-agent")?.closest(".find-scope"), "the pane finds");
  assert.ok(page.querySelector("search[aria-label='Find']"), "⌘F opens the find bar");
});

/** The page over the window's own side panel, held by the agent as the window holds it while the page stands. */
function PanelPage(): React.JSX.Element {
  const agents = [AGENT_ID];
  const sidePanel = useSidePanel(
    undefined,
    { id: AGENT_ID, holds: {} },
    agents,
    [],
    [],
    [],
    agents,
  );
  return createElement(DesktopAgentPage, {
    plans: { ...plansControl({}), sidePanel },
    agentId: AGENT_ID,
  });
}

test("a delegation's row opens its worker in the side panel beside the agent's page, whose + offers none of a task's Board, Code, or Call", async () => {
  localStorage.clear();
  installScrollIntoView();
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [
          {
            type: "tool-delegate",
            toolCallId: "call-1",
            state: "output-available",
            input: { task: "Find the flakiest test." },
            output: "Started task delegate-7k2m9q.",
          },
        ],
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(PanelPage))));
  await settle();

  const row = container.querySelector<HTMLButtonElement>("button[data-subagent-row]");
  assert.ok(row, "the delegation's row opens its worker");
  act(() => row.click());
  await settle();
  const panel = container.querySelector("aside.side-panel");
  const opened = [...(panel?.querySelectorAll("[role='tab']") ?? [])].map((tab) => tab.textContent);
  const add = panel?.querySelector<HTMLButtonElement>("button[aria-label='Open a tab']");
  assert.ok(add, "the panel offers its +");
  act(() => add.click());
  await settle();
  const offered = [...document.querySelectorAll("[role='option']")].map((each) => each.textContent);

  assert.ok(
    opened.some((label) => label?.includes("Find the flakiest test.")),
    `the worker's tab stands in the panel: ${opened.join(", ")}`,
  );
  assert.deepEqual(
    offered.filter((label) => /^(Board|Code|Call)$/u.test(label ?? "")),
    [],
    "no task's kind is offered",
  );
});

/** The page drawn over the window's own side panel, held by the agent. */
async function mountPanelPage(): Promise<HTMLElement> {
  localStorage.clear();
  installScrollIntoView();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(PanelPage))));
  await settle();
  return container;
}

test("an archived agent's pull request, picked from the panel's +, opens in a Changes tab standing beside its page", async () => {
  pages = [{ agent: { ...PAGE, archivedAt: 2 } }];
  published = {
    repository: "acme/relay",
    branch: "luke/flaky-sweep",
    pullRequest: {
      number: 2911,
      title: "Await the payment mock",
      url: "https://github.com/acme/relay/pull/2911",
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
      additions: 3,
      deletions: 1,
      changedFiles: 1,
    },
  };
  const container = await mountPanelPage();

  act(() => {
    runAppCommand(APP_COMMAND.NEW_TAB);
  });
  await settle();
  const offer = [...document.querySelectorAll<HTMLElement>("[role='option']")].find((each) =>
    (each.textContent ?? "").includes("#2911"),
  );
  assert.ok(offer, "the + offers the agent's pull request");
  act(() => offer.click());
  await settle();
  const tabs = [...container.querySelectorAll("aside.side-panel [role='tab']")].map(
    (tab) => tab.textContent ?? "",
  );

  assert.ok(
    tabs.some((label) => label.includes("Changes")),
    `the Changes tab stands in the panel: ${tabs.join(", ")}`,
  );
});

test("⌘T on an agent's page opens the panel beside it on its +, the page's one", async () => {
  const container = await mountPanelPage();

  act(() => {
    runAppCommand(APP_COMMAND.NEW_TAB);
  });
  await settle();

  assert.ok(container.querySelector("aside.side-panel"), "the panel opens");
  assert.ok(
    document.querySelector("input[placeholder='Search tabs']"),
    "its + opens on the tabs it offers",
  );
});

test("a skill a message names is its chip, which opens the skill's SKILL.md on GitHub, there being no File tab for a repository no plan names", async () => {
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "line",
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: "Then run /release now." }],
        sentBy: { userId: "user-dean", name: "Dean Stratakos", kind: CODING_AGENT_SENDER.MEMBER },
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount();
  await settle();

  // The skills are read once a sent message first asks for them, a settle after the transcript lands.
  await settle();
  const chip = page.querySelector<HTMLButtonElement>("button.skill-chip");
  assert.ok(chip, "the skill is its chip");
  act(() => chip.click());

  assert.deepEqual(
    told.filter((each) => each.kind === ACT_KIND.GITHUB_OPEN).map((each) => each.payload),
    [{ url: "https://github.com/acme/relay/blob/HEAD/.agents/skills/release/SKILL.md" }],
  );
});

test("a read that did not land says so, and Retry reads the agent again and draws it", async () => {
  pages = [{ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }, { agent: PAGE }];
  const page = mount();
  await settle();

  assert.match(page.textContent ?? "", /This agent could not be read\./u);
  const retry = [...page.querySelectorAll("button")].find((each) =>
    /Retry/u.test(each.textContent ?? ""),
  );
  assert.ok(retry, "the failure offers Retry");
  act(() => retry.click());
  await settle();

  assert.deepEqual(read, [AGENT_ID, AGENT_ID]);
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the flaky tests");
});

test("an archived agent's page offers Unarchive in its composer's place, which brings the agent back", async () => {
  pages = [{ agent: { ...PAGE, archivedAt: 2 } }];
  const page = mount();
  await settle();

  const unarchive = [...page.querySelectorAll("button")].find(
    (each) => each.textContent === "Unarchive",
  );
  assert.ok(unarchive, "the archived agent offers Unarchive");
  act(() => unarchive.click());
  await settle();

  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: false }]);
});

test("an Unarchive the service refuses says why, and the agent stays archived", async () => {
  pages = [{ agent: { ...PAGE, archivedAt: 2 } }];
  archiveRefused = true;
  const page = mount();
  await settle();

  const unarchive = [...page.querySelectorAll("button")].find(
    (each) => each.textContent === "Unarchive",
  );
  assert.ok(unarchive);
  act(() => unarchive.click());
  await settle();

  assert.match(document.body.textContent ?? "", new RegExp(archiveWords(false).refused, "u"));
  assert.ok(
    [...page.querySelectorAll("button")].some((each) => each.textContent === "Unarchive"),
    "the agent stays archived, Unarchive still offered",
  );
});

test("a teammate's message to an agent on its own page carries their sign-in picture, read from the agent's workspace's members", async () => {
  const picture = "https://lh3.googleusercontent.com/a/charles=s96-c";
  const charles = { userId: "user-charles", name: "Charles Pan" };
  members = [
    {
      userId: "user-dean",
      name: "Dean Stratakos",
      email: "dean@example.com",
      role: WORKSPACE_ROLE.OWNER,
    },
    { ...charles, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER, pictureUrl: picture },
  ];
  transcript = {
    messages: [
      // The first of the developer's messages is what the agent was handed, drawn as its card.
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "line",
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: "Skip the flaky retry." }],
        sentBy: { ...charles, kind: CODING_AGENT_SENDER.MEMBER },
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount(
    plansControl({
      me: "user-dean",
      workspaces: [
        {
          id: PAGE.workspaceId,
          name: "Acme",
          role: WORKSPACE_ROLE.OWNER,
          github: null,
          memberCount: 2,
        },
      ],
    }),
  );
  await settle();

  const sender = page.querySelector(".message-sender .actor-ref");
  assert.equal(sender?.querySelector(".actor-ref-name")?.textContent, "Charles Pan");
  assert.equal(sender?.querySelector("img")?.getAttribute("src"), picture);
});
