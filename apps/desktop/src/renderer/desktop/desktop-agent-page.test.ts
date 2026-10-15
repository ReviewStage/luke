// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentPageAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentPage,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { runAppCommand } from "../app-commands";
import { archiveWords } from "../planning/coding-agent-model";
import type { PlansControl } from "../planning/use-plans-tab";
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

beforeEach(() => {
  pages = [{ agent: PAGE }];
  read = [];
  archives = [];
  archiveRefused = false;
  members = undefined;
  transcript = undefined;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
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
