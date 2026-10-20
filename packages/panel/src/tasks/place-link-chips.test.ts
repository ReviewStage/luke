// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type LinkPlace, type ReadLink } from "@luke/features/luke-link";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { signedInAs } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { OpenLinkProvider } from "./use-open-link.js";

/**
 * place-link-chips.test.ts -- a link to a place in Luke written in words,
 * an agent's, a page's, an Inbox item's, a member's, is drawn as a chip
 * called by the name the window already holds for the place: the task's
 * title for a bare task link, the agent's, the page's, the item's, the
 * member's; by its kind where the window holds none; and by the words it
 * was labelled with where it was. A press opens the place in the window.
 * Nothing is read for a name. Synthetic workspace, task, and people.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const AGENT = "7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const UNNAMED_AGENT = "9c8b7a6f-5e4d-4c3b-8a2f-1e0d9c8b7a6f";
const TRIAGE_AGENT = "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a";
const TRIAGE = "4e3d2c1b-0a9f-4e8d-9c7b-6a5f4e3d2c1b";
const PAGE = "26494df1-595a-4364-abf7-85781c65a9f8";
const ITEM = "item_4b9e";
const SAM = "user-sam";
const AT = 1_792_000_000_000;
const HOME = "https://tryluke.dev/acme";

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 2,
};

const MEMBERS: readonly WorkspaceMember[] = [
  { userId: SAM, name: "Sam Okafor", email: "sam@example.com", role: WORKSPACE_ROLE.MEMBER },
];

const TASK: TaskSummary = {
  id: TASK_ID,
  workspaceId: ACME.id,
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
  agents: {
    total: 1,
    working: 1,
    agents: [
      {
        id: AGENT,
        title: "Expire old invitations",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.RUNNING,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
};

/** Main's document holding the task, its agent, its page, and an Inbox item waiting on it. */
const STATE: AppStateSnapshot = (() => {
  const snapshot = signedInAs({ id: SAM, email: "sam@example.com", name: "Sam Okafor" });
  return {
    ...snapshot,
    tasks: {
      ...IDLE_TASKS_VIEW,
      tasks: [TASK],
      tasklessAgents: [
        {
          id: TRIAGE_AGENT,
          planId: null,
          turnId: null,
          title: "Triage new Sentry issues",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          status: CODING_AGENT_STATUS.COMPLETED,
          createdAt: AT,
          automationId: TRIAGE,
          automationName: "Nightly triage",
          workspaceId: ACME.id,
          repository: "acme/relay",
          activityAt: AT,
        },
      ],
      pages: [{ id: PAGE, title: "Unfurl matrix", version: 1, at: AT }],
    },
    inbox: {
      ...snapshot.inbox,
      waiting: [
        {
          taskId: TASK_ID,
          items: [{ id: ITEM, agentId: AGENT, title: "Keep expired links?", postedAt: AT }],
        },
      ],
    },
  };
})();

let root: Root | undefined;

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The words drawn as a transcript draws them, in a window holding `STATE`, every place a chip opened kept. */
async function drawn(
  text: string,
  opened: LinkPlace[],
  reads: (request: AnyAct) => FakeActAnswer | undefined = () => undefined,
): Promise<HTMLElement> {
  fakeActs({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(STATE),
    act: (request: AnyAct): Promise<FakeActAnswer> =>
      Promise.resolve(
        reads(request) ??
          (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
            ? { status: FAKE_ANSWER.DONE, value: MEMBERS }
            : { status: FAKE_ANSWER.DONE, value: undefined }),
      ),
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const words = createElement(MemberDirectory, {
    workspace: ACME,
    readerId: SAM,
    children: createElement(TranscriptWords, { text }),
  });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(OpenLinkProvider, {
          value: (link: ReadLink) => opened.push(link.place),
          children: words,
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

/** Each chip drawn: its kind and the name it says. */
function chips(container: HTMLElement): [string | undefined, string | null][] {
  return [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")].map((chip) => [
    chip.dataset.kind,
    chip.querySelector(".luke-inline-ref-label")?.textContent ?? null,
  ]);
}

test("a bare link to a place the window knows is called by its name, the task's title, the agent's, the page's, the item's, the member's", async () => {
  const container = await drawn(
    [
      `${HOME}/plan/${TASK_ID}`,
      `${HOME}/plan/${TASK_ID}/agent/${AGENT}`,
      `${HOME}/plan/${TASK_ID}/page/${PAGE}`,
      `${HOME}/plan/${TASK_ID}/inbox/${ITEM}`,
      `${HOME}/plan/${TASK_ID}/agent/${AGENT}/message/msg_1`,
      `${HOME}/person/${SAM}`,
      `${HOME}/agent/${TRIAGE_AGENT}`,
      `${HOME}/automation/${TRIAGE}`,
    ].join(" and "),
    [],
  );

  assert.deepEqual(chips(container), [
    ["plan", "Teammate invitations"],
    ["agent", "Expire old invitations"],
    ["page", "Unfurl matrix"],
    ["place", "Keep expired links?"],
    ["place", "Message from Expire old invitations"],
    ["person", "Sam Okafor"],
    ["agent", "Triage new Sentry issues"],
    ["place", "Nightly triage"],
  ]);
  assert.deepEqual(
    [...container.querySelectorAll("a")].map((link) => link.textContent),
    [],
  );
});

test("a place the window holds no name for is called by its kind, and a labelled link by its label", async () => {
  const container = await drawn(
    [
      `${HOME}/plan/${TASK_ID}/agent/${UNNAMED_AGENT}`,
      `${HOME}/automation/auto_1/run/run_1`,
      `${HOME}/inbox`,
      `[the matrix](${HOME}/plan/${TASK_ID}/page/${PAGE})`,
    ].join(", "),
    [],
  );

  assert.deepEqual(chips(container), [
    ["agent", "Agent"],
    ["place", "Run"],
    ["place", "Inbox"],
    ["page", "the matrix"],
  ]);
});

test("a press on a place's chip opens the place in the window", async () => {
  const opened: LinkPlace[] = [];
  const container = await drawn(
    `${HOME}/plan/${TASK_ID}/agent/${AGENT} then ${HOME}/person/${SAM}`,
    opened,
  );

  for (const chip of container.querySelectorAll<HTMLButtonElement>("button[data-mention-ref]")) {
    act(() => chip.click());
  }
  assert.deepEqual(opened, [
    { kind: LINK_PLACE.AGENT, planId: TASK_ID, agentId: AGENT },
    { kind: LINK_PLACE.PERSON, userId: SAM },
  ]);
});

test("an agent's chip the window knows no harness for has its name say whose it is", async () => {
  const container = await drawn(`${HOME}/plan/${TASK_ID}/agent/${UNNAMED_AGENT}`, []);
  const chip = container.querySelector<HTMLElement>('[data-mention-ref][data-kind="agent"]');

  assert.equal(chip?.querySelector(".luke-inline-ref-label")?.textContent, "Agent");
});

test("an agent's chip the window holds wears its harness's mark, on another task's words or none, and the card it hangs wears it too", async () => {
  const container = await drawn(
    `${HOME}/plan/${TASK_ID}/agent/${AGENT} and ${HOME}/agent/${TRIAGE_AGENT}`,
    [],
  );
  const agentChips = [
    ...container.querySelectorAll<HTMLElement>('[data-mention-ref][data-kind="agent"]'),
  ];

  const worn = agentChips.map((chip) => {
    const onChip = chip.querySelector(".luke-inline-ref-glyph .harness-mark") !== null;
    act(() => {
      chip.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const onCard =
      document.querySelector(".luke-tooltip-card [data-mention-card] .harness-mark") !== null;
    act(() => {
      chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
    return [onChip, onCard];
  });

  assert.deepEqual(worn, [
    [true, true],
    [true, true],
  ]);
});

/** An archived agent as the service reads it, on the task given or none, on the model given. */
function archivedAgent(id: string, planId: string | null, model: string) {
  return {
    id,
    planId,
    model,
    effort: "high",
    title: "Retired sweep",
    createdAt: AT,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    archivedAt: AT,
  };
}

test("an archived agent's chip, which no list the window holds names, wears the harness read for it: on a task by its task's agents, on none by its own id", async () => {
  const onTask = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const onNone = "6f5e4d3c-2b1a-4f0e-9d8c-7b6a5f4e3d2c";
  const container = await drawn(
    `${HOME}/plan/${TASK_ID}/agent/${onTask} and ${HOME}/agent/${onNone}`,
    [],
    (request) => {
      if (request.kind === ACT_KIND.CODING_AGENTS_LIST) {
        return {
          status: FAKE_ANSWER.DONE,
          value: { agents: [archivedAgent(onTask, TASK_ID, "openai/gpt-6.1-sol")] },
        };
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
        return {
          status: FAKE_ANSWER.DONE,
          value: {
            agent: {
              ...archivedAgent(onNone, null, "anthropic/claude-opus-5.5"),
              automationId: null,
              workspaceId: ACME.id,
              repository: "acme/relay",
            },
          },
        };
      }
      return undefined;
    },
  );

  const marks = [
    ...container.querySelectorAll<HTMLElement>('[data-mention-ref][data-kind="agent"]'),
  ].map((chip) =>
    chip.querySelector(".luke-inline-ref-glyph .harness-mark")?.tagName.toLowerCase(),
  );
  // Codex's mark is its picture, Claude Code's its Clawd drawn as an SVG.
  assert.deepEqual(marks, ["img", "svg"]);
});
