// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { ISSUE_STATE } from "@luke/features/github-repositories-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { signedInAs } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { PlanMentions, type PlanMentionsValue } from "./plan-mentions";
import { TranscriptWords } from "./transcript-blocks";

/**
 * github-link-chips.test.ts -- a pull request's or an issue's link in a
 * plan's words says what the workspace's GitHub App answers for it: a bare
 * link is called by the repository's name, the number, and the title, a
 * labelled one keeps its label, and each wears GitHub's mark for where it
 * stands and says it in words, its card saying its key, its state, and a
 * pull request's lines added and removed in place of its address. Each is read by repository and number through
 * the plan's workspace, nothing is asked where that workspace has no active
 * installation, and one the App answers nothing for stays as its address
 * says. Synthetic workspace, plan, pull requests, and issues.
 */

const PLAN = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const AT = 1_792_000_000_000;
const MERGED = "https://github.com/acme/relay/pull/42";
const UNREACHED = "https://github.com/acme/secret/pull/7";
const OPEN_ISSUE = "https://github.com/acme/relay/issues/7";
const SHELVED_ISSUE = "https://github.com/acme/relay/issues/9";
const UNREACHED_ISSUE = "https://github.com/acme/secret/issues/3";

/** The issues `acme/relay` holds, as the App answers them; `acme/secret` it does not reach. */
const RELAY_ISSUES = new Map([
  [
    7,
    {
      number: 7,
      title: "Invitations expire too soon",
      url: OPEN_ISSUE,
      state: ISSUE_STATE.OPEN,
      author: "octo-dev",
    },
  ],
  [
    9,
    {
      number: 9,
      title: "Invite by phone number",
      url: SHELVED_ISSUE,
      state: ISSUE_STATE.NOT_PLANNED,
    },
  ],
]);

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

/** Acme, no GitHub installation. */
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 2,
};

/** Acme with its GitHub App installed. */
const ACME_WITH_GITHUB: Workspace = { ...ACME, github: { login: "acme", active: true } };

const TASK: TaskSummary = {
  id: PLAN,
  workspaceId: "workspace-acme",
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
};

/** Main's document holding the plan in Acme. */
function stateWith(workspace: Workspace): AppStateSnapshot {
  const snapshot = signedInAs({ id: "user-sam", email: "sam@example.com", name: "Sam Okafor" });
  return {
    ...snapshot,
    tasks: { ...IDLE_TASKS_VIEW, tasks: [TASK], workspaces: [workspace] },
  };
}

/** The plan's page, as its words' chips stand on it. */
const PAGE: PlanMentionsValue = {
  taskId: PLAN,
  taskName: TASK.name,
  workspace: "acme",
  workspaceId: "workspace-acme",
  repository: "acme/relay",
  text: () => "",
  doors: {
    taskId: PLAN,
    place: { workspace: "acme", repository: "acme/relay" },
    anchors: new Set(),
    onOpenTask: () => undefined,
    onOpenFile: undefined,
  },
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The words drawn on the plan's page in a window holding `workspace`, and every act the window asked. */
async function drawn(text: string, workspace: Workspace) {
  const asked: Act[] = [];
  const state = stateWith(workspace);
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      onAppState: () => () => undefined,
      requestAppState: () => Promise.resolve(state),
      act: (request: Act): Promise<ActOutcome> => {
        asked.push(request);
        if (request.kind === ACT_KIND.TASKS_ISSUE) {
          const { repository, number } = request.payload;
          const issue = repository === "acme/relay" ? RELAY_ISSUES.get(number) : undefined;
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: issue ?? null });
        }
        const reached =
          request.kind === ACT_KIND.TASKS_PULL_REQUEST &&
          request.payload.repository === "acme/relay";
        return Promise.resolve(
          request.kind === ACT_KIND.TASKS_PULL_REQUEST
            ? {
                status: ACT_OUTCOME_STATUS.DONE,
                value: reached
                  ? {
                      number: 42,
                      title: "Expire old invitations",
                      url: MERGED,
                      state: PULL_REQUEST_STATE.MERGED,
                      author: "octo-dev",
                      additions: 120,
                      deletions: 30,
                    }
                  : null,
              }
            : { status: ACT_OUTCOME_STATUS.DONE, value: undefined },
        );
      },
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(PlanMentions, {
          value: PAGE,
          children: createElement(TranscriptWords, { text }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return { container, asked };
}

/** Each chip drawn: the name it says, the state after it, and the pull request's mark it wears, if any. */
function chips(container: HTMLElement): [string | null, string | null, string | undefined][] {
  return [...container.querySelectorAll<HTMLElement>(".mention-chip")].map((chip) => [
    chip.querySelector(".mention-chip-label")?.textContent ?? null,
    chip.querySelector(".mention-chip-state")?.textContent ?? null,
    chip.querySelector<SVGElement>("[data-pull-request-mark]")?.dataset.pullRequestState,
  ]);
}

/** Each chip drawn: the name it says, the state after it, and the issue's mark it wears, if any, by its state and the words a reader who cannot see it hears. */
function issueChips(container: HTMLElement): (string | null | undefined)[][] {
  return [...container.querySelectorAll<HTMLElement>(".mention-chip")].map((chip) => {
    const mark = chip.querySelector<SVGElement>("[data-issue-mark]");
    return [
      chip.querySelector(".mention-chip-label")?.textContent ?? null,
      chip.querySelector(".mention-chip-state")?.textContent ?? null,
      mark?.dataset.issueState,
      mark?.getAttribute("aria-label"),
    ];
  });
}

test("a pull request's link says its repository, number, title, and state, wearing its mark, as the plan's workspace's GitHub App answers them", async () => {
  const { container, asked } = await drawn(
    `Lands after ${MERGED}, [the expiry change](${MERGED}), and ${UNREACHED}.`,
    ACME_WITH_GITHUB,
  );

  assert.deepEqual(chips(container), [
    ["relay#42 Expire old invitations", "Merged", PULL_REQUEST_STATE.MERGED],
    ["the expiry change", "Merged", PULL_REQUEST_STATE.MERGED],
    ["secret/pull/7", null, undefined],
  ]);
  assert.deepEqual(
    asked.filter((each) => each.kind === ACT_KIND.TASKS_PULL_REQUEST).map((each) => each.payload),
    [
      { workspaceId: "workspace-acme", repository: "acme/relay", number: 42 },
      { workspaceId: "workspace-acme", repository: "acme/relay", number: 42 },
      { workspaceId: "workspace-acme", repository: "acme/secret", number: 7 },
    ],
  );
});

test("where the workspace has no GitHub App installed, nothing is asked and the chip says what the address says", async () => {
  const { container, asked } = await drawn(`See ${MERGED}.`, ACME);

  assert.deepEqual(chips(container), [["relay/pull/42", null, undefined]]);
  assert.deepEqual(
    asked.filter((each) => each.kind === ACT_KIND.TASKS_PULL_REQUEST),
    [],
  );
});

test("an issue's link says its repository, number, title, and state, wearing GitHub's issue mark, as the plan's workspace's GitHub App answers them, and one it does not reach stays as its address says", async () => {
  const { container, asked } = await drawn(
    `Fixes ${OPEN_ISSUE}, [the phone ask](${SHELVED_ISSUE}), and ${UNREACHED_ISSUE}.`,
    ACME_WITH_GITHUB,
  );

  assert.deepEqual(issueChips(container), [
    ["relay#7 Invitations expire too soon", "Open", ISSUE_STATE.OPEN, "Issue #7, open"],
    ["the phone ask", "Not planned", ISSUE_STATE.NOT_PLANNED, "Issue #9, not planned"],
    ["secret/issues/3", null, undefined, undefined],
  ]);
  assert.deepEqual(
    asked.filter((each) => each.kind === ACT_KIND.TASKS_ISSUE).map((each) => each.payload),
    [
      { workspaceId: "workspace-acme", repository: "acme/relay", number: 7 },
      { workspaceId: "workspace-acme", repository: "acme/relay", number: 9 },
      { workspaceId: "workspace-acme", repository: "acme/secret", number: 3 },
    ],
  );
  assert.deepEqual(
    asked.filter((each) => each.kind === ACT_KIND.TASKS_PULL_REQUEST),
    [],
    "an issue's link asks for no pull request",
  );
});

test("where the workspace has no GitHub App installed, an issue's link asks nothing and says what the address says", async () => {
  const { container, asked } = await drawn(`See ${OPEN_ISSUE}.`, ACME);

  assert.deepEqual(issueChips(container), [["relay/issues/7", null, undefined, undefined]]);
  assert.deepEqual(
    asked.filter((each) => each.kind === ACT_KIND.TASKS_ISSUE),
    [],
  );
});

/** The notes of the card a chip hangs: its key and state, with a pull request's lines, who it is with, and its address where GitHub answered nothing. */
function cardNotes(chip: Element | undefined): (string | null)[] {
  assert.ok(chip, "the link is drawn as its chip");
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = [...document.querySelectorAll(".luke-tooltip-card [data-mention-card]")].at(-1);
  const notes = [...(card?.querySelectorAll(".card-note") ?? [])].map((note) => note.textContent);
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return notes;
}

test("a pull request's and an issue's cards say who opened them, as the workspace's GitHub App answers it, and a pull request's the lines it adds and removes, in place of their address; one GitHub names no author of names no one, and one the App does not reach still says its address", async () => {
  const { container } = await drawn(
    `Lands after ${MERGED}, and see ${OPEN_ISSUE}, ${SHELVED_ISSUE}, and ${UNREACHED}.`,
    ACME_WITH_GITHUB,
  );
  const [pullRequest, opened, shelved, unreached] = container.querySelectorAll(".mention-chip");

  assert.deepEqual(cardNotes(pullRequest), ["relay#42 · Merged · +120 −30", "Opened by octo-dev"]);
  assert.deepEqual(cardNotes(opened), ["relay#7 · Open", "Opened by octo-dev"]);
  assert.deepEqual(cardNotes(shelved), ["relay#9 · Not planned"]);
  assert.deepEqual(cardNotes(unreached), [UNREACHED]);
});
