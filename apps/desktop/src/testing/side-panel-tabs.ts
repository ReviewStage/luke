import {
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import type { PageLine } from "@luke/features/page-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TOOL_STATE } from "../renderer/ai-elements/tool";
import { AgentChangesTab } from "../renderer/tasks/agent-changes-tab";
import { notesBefore } from "../renderer/tasks/file-note";
import { PagePane } from "../renderer/tasks/page-pane";
import { TranscriptSubagent } from "../renderer/tasks/transcript-blocks";
import { onRegistry } from "./copy-feedback";
import { codingAgentsControl } from "./tasks-control";

/**
 * side-panel-tabs.ts -- the side panel's tabs drawn as the panel draws them, synthetic throughout, for the tests that read them at a width (`container-width.ts`).
 *
 * Each draws one tab into the document with what it reads already landed:
 * an agent's Changes tab over one modified file, a File tab's note of
 * Luke's, a subagent's row on the Call tab, and a page's tab at its third
 * version. Whatever is drawn is let go by `unmountTabs`.
 */

/** The plan the tabs stand on. */
const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const AGENT: CodingAgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: PLAN,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const PULL_REQUEST = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 2,
  deletions: 1,
  changedFiles: 1,
};

const PAGE: PageLine = {
  id: "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f",
  title: "Invitation email: copy, layout, and expiry wording for every locale",
  version: 3,
  at: 1_800_000_000_000,
};

const roots: Root[] = [];

/** Draws `element` into the document, its reads let land, answering the box it was drawn in. */
async function drawn(element: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** Lets go of every tab drawn. */
export function unmountTabs(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
}

/** An agent's Changes tab over its pull request's one file, a line removed and two added, with the tree beside every Changes tab held open as the panel holds it. */
export function drawChangesTab(): Promise<HTMLElement> {
  const control = codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    models: [],
    pullRequests: new Map([[AGENT.id, PULL_REQUEST]]),
    readChanges: () =>
      Promise.resolve({
        pullRequest: {
          url: PULL_REQUEST.url,
          truncated: false,
          files: [
            {
              path: "src/invites/expiry.ts",
              previousPath: null,
              status: CHANGED_FILE_STATUS.MODIFIED,
              additions: 2,
              deletions: 1,
              omitted: null,
              patch:
                "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;\n",
            },
          ],
          reviewers: [],
          commitAuthors: [],
          comments: [],
        },
      }),
  });
  return drawn(
    createElement(AgentChangesTab, {
      agentId: AGENT.id,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: true, onToggle: () => undefined },
    }),
  );
}

/** One note of Luke's on lines 4 to 5 of a File tab's file, a week old, open. */
export function drawFileNote(): Promise<HTMLElement> {
  const now = Date.now();
  const before = notesBefore({
    notes: [
      {
        callId: "call-1",
        shownAt: now - 7 * 24 * 60 * 60 * 1000,
        startLine: 4,
        endLine: 5,
        note: "An invite link lands here.",
      },
    ],
    folded: [],
    onFold: () => undefined,
    onShow: () => undefined,
  });
  return drawn(createElement("div", { className: "file-tab-lines" }, before(4)));
}

/** A subagent's row on the Call tab, still at work on a job longer than a narrow panel's line. */
export function drawSubagentRow(): Promise<HTMLElement> {
  return drawn(
    createElement(TranscriptSubagent, {
      callId: "call-2",
      job: "Compare how two invite libraries lay out their expiry and withdrawal flows",
      pair: undefined,
      state: TOOL_STATE.INPUT_AVAILABLE,
      startedAt: Date.now() - 60_000,
      errorText: undefined,
      onOpen: () => undefined,
    }),
  );
}

/** A page's tab at its third version of three, its page drawn. */
export function drawPageTab(): Promise<HTMLElement> {
  return drawn(
    createElement(PagePane, {
      taskId: PLAN,
      page: PAGE,
      // The page is drawn rather than its source, which is never read.
      readSource: () => Promise.resolve({ lines: [] }),
      findActive: false,
    }),
  );
}
