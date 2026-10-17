// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentInboxAnswerView } from "@luke/features/coding-agent-view";
import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import {
  INBOX_BLOCK,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { signedInAs } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { tasksControl, waitingOf } from "#testing/tasks-control";
import type { InboxChoice } from "../tasks/use-tasks-tab";
import { DesktopInbox } from "./desktop-inbox";

/**
 * inbox-link-chips.test.ts -- a link in a window Inbox item's words reads
 * through the item's own workspace, as it would in its task: a plan's item
 * through the plan's workspace, an item of an agent with no plan through
 * the agent's, whichever workspace the Inbox lists; an item whose workspace
 * the service did not name reads nothing and says what its address says.
 * Synthetic workspaces, plans, agents, and pull requests.
 */

const PULL = "https://github.com/acme/relay/pull/42";
const LEDGER_PULL = "https://github.com/globex/ledger/pull/5";

// A Markdown block is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

/** Acme and Globex, each with its GitHub App installed. */
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
  memberCount: 2,
};
const GLOBEX: Workspace = {
  ...ACME,
  id: "workspace-globex",
  name: "Globex",
  slug: "globex",
  github: { login: "globex", active: true },
};

const PLAN: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: ACME.id,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};
const PLAN_AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const SWEEP_AGENT = "5d7e8f90-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

/** An item an agent posted, asking only an acknowledgement, its one block the words given. */
function item(id: string, agentId: string, words: string): InboxItem {
  return {
    id,
    agentId,
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: "Ready for a look",
    blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: words }],
    response: { type: INBOX_RESPONSE.NONE },
    needsReply: false,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 2_000,
  };
}

/** One waiting item of the agent no plan holds, as main's read names it: in the workspace given, or in none where the service did not name one. */
function waitingSweep(waiting: InboxItem, workspaceId: string | undefined): AppInboxTasklessItem {
  return {
    ...waitingOf(waiting),
    agentTitle: "Sweep the flaky tests",
    agentModel: "anthropic/claude-opus-5.5",
    automationId: null,
    automationName: null,
    repository: "globex/ledger",
    ...(workspaceId === undefined ? undefined : { workspaceId }),
  };
}

/** Each pull request the App answers, by repository and number, as it would through any workspace. */
const PULL_REQUESTS = new Map([
  ["acme/relay", { number: 42, title: "Send invitations in batches", url: PULL }],
  ["globex/ledger", { number: 5, title: "Settle the ledger nightly", url: LEDGER_PULL }],
]);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The window's Inbox listing `listed`, holding the plan's items and the agent's given, and every pull request read it asked. */
async function inbox(options: {
  listed: Workspace | undefined;
  planItems: readonly InboxItem[];
  sweep: { readonly item: InboxItem; readonly workspaceId: string | undefined } | undefined;
  /** The account's workspaces as main's document holds them; Acme and Globex unless said. */
  workspaces?: readonly Workspace[];
}) {
  const asked: Act[] = [];
  const state = {
    ...signedInAs({ id: "user-sam", email: "sam@example.com", name: "Sam Okafor" }),
    tasks: { ...IDLE_TASKS_VIEW, tasks: [PLAN], workspaces: options.workspaces ?? [ACME, GLOBEX] },
  };
  const inboxOf = (items: readonly InboxItem[]): Promise<ActOutcome> =>
    Promise.resolve({
      status: ACT_OUTCOME_STATUS.DONE,
      value: { items, cursor: "1" } satisfies CodingAgentInboxAnswerView,
    });
  fakeAppBridge({
    onMenuCommand: () => () => undefined,
    recordSurfaceEvent: () => undefined,
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
    act: (request: Act): Promise<ActOutcome> => {
      asked.push(request);
      switch (request.kind) {
        case ACT_KIND.TASKS_PULL_REQUEST: {
          const pullRequest = PULL_REQUESTS.get(request.payload.repository);
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.DONE,
            value:
              pullRequest === undefined
                ? null
                : { ...pullRequest, state: PULL_REQUEST_STATE.MERGED },
          });
        }
        case ACT_KIND.CODING_AGENTS_INBOX:
          // A read past the cursor is held open while nothing changes, as the service holds it.
          return request.payload.after === "0"
            ? inboxOf(options.planItems)
            : new Promise(() => undefined);
        case ACT_KIND.CODING_AGENTS_AGENT_INBOX:
          return request.payload.after === "0"
            ? inboxOf(options.sweep === undefined ? [] : [options.sweep.item])
            : new Promise(() => undefined);
        case ACT_KIND.CODING_AGENTS_LIST:
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { agents: [] } });
        default:
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.REFUSED,
            reason: "Not in this test.",
          });
      }
    },
  });
  const sweep = options.sweep;
  // The Inbox's own choice is held as the plans tab holds it, so the item it stands chosen is drawn.
  function Page() {
    const [chosen, setChosen] = useState<InboxChoice | undefined>(undefined);
    return createElement(DesktopInbox, {
      tasks: tasksControl({
        workspace: options.listed,
        tasks: [PLAN],
        inbox:
          options.planItems.length === 0
            ? []
            : [{ taskId: PLAN.id, items: options.planItems.map(waitingOf) }],
        inboxTasks:
          options.planItems.length === 0
            ? []
            : [{ taskId: PLAN.id, items: options.planItems.length, updatedAt: 2_000 }],
        inboxTaskless: sweep === undefined ? [] : [waitingSweep(sweep.item, sweep.workspaceId)],
        inboxView: {
          open: true,
          chosen,
          onOpen: () => undefined,
          onClose: () => undefined,
          onChoose: setChosen,
          pages: undefined,
          onRereadPages: () => undefined,
        },
      }),
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Page))));
  await act(async () => {
    for (let tick = 0; tick < 16; tick += 1) await Promise.resolve();
  });
  return { container, asked };
}

/** The chips the chosen item's words draw, by the name each says and the state after it. */
function chips(container: HTMLElement): [string | null, string | null][] {
  return [...container.querySelectorAll<HTMLElement>("[data-inbox-markdown] .mention-chip")].map(
    (chip) => [
      chip.querySelector(".mention-chip-label")?.textContent ?? null,
      chip.querySelector(".mention-chip-state")?.textContent ?? null,
    ],
  );
}

/** The workspaces each pull request read was asked through. */
function readThrough(asked: readonly Act[]): string[] {
  return asked.flatMap((each) =>
    each.kind === ACT_KIND.TASKS_PULL_REQUEST
      ? [`${each.payload.workspaceId} ${each.payload.repository}#${each.payload.number}`]
      : [],
  );
}

test("a plan's item in the window's Inbox reads its links through the plan's workspace, as its task does", async () => {
  const { container, asked } = await inbox({
    listed: ACME,
    planItems: [item("a1b2c3d4-0000-4000-8000-000000000001", PLAN_AGENT, `Opened ${PULL}.`)],
    sweep: undefined,
  });

  assert.deepEqual(chips(container), [["relay#42 Send invitations in batches", "Merged"]]);
  assert.deepEqual(readThrough(asked), ["workspace-acme acme/relay#42"]);
});

test("an item of a workspace an older service answered with no slug still reads its links through that workspace, by its id", async () => {
  const { slug: _slug, ...unslugged } = GLOBEX;
  const { container, asked } = await inbox({
    listed: undefined,
    planItems: [],
    sweep: {
      item: item("a1b2c3d4-0000-4000-8000-000000000004", SWEEP_AGENT, `Opened ${LEDGER_PULL}.`),
      workspaceId: GLOBEX.id,
    },
    workspaces: [ACME, unslugged],
  });

  assert.deepEqual(chips(container), [["ledger#5 Settle the ledger nightly", "Merged"]]);
  assert.deepEqual(readThrough(asked), ["workspace-globex globex/ledger#5"]);
});

test("an item of an agent with no plan reads its links through the agent's own workspace, not the one the Inbox lists", async () => {
  const { container, asked } = await inbox({
    listed: undefined,
    planItems: [],
    sweep: {
      item: item("a1b2c3d4-0000-4000-8000-000000000002", SWEEP_AGENT, `Opened ${LEDGER_PULL}.`),
      workspaceId: GLOBEX.id,
    },
  });

  assert.deepEqual(chips(container), [["ledger#5 Settle the ledger nightly", "Merged"]]);
  assert.deepEqual(readThrough(asked), ["workspace-globex globex/ledger#5"]);
});

test("an item whose workspace the service did not name reads nothing, and its link says what its address says, though the Inbox lists a workspace", async () => {
  const { container, asked } = await inbox({
    listed: ACME,
    planItems: [],
    sweep: {
      item: item("a1b2c3d4-0000-4000-8000-000000000003", SWEEP_AGENT, `Opened ${PULL}.`),
      workspaceId: undefined,
    },
  });

  assert.deepEqual(chips(container), [["relay/pull/42", null]]);
  assert.deepEqual(readThrough(asked), []);
});
