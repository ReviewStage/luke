// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ISSUE_CALL_FAILURE, type IssueListView } from "@luke/features/issue-view";
import { ISSUE_PRIORITY, ISSUE_STATUS, type Issue } from "@luke/features/issue-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { tasksControl } from "#testing/tasks-control";
import { runAppCommand } from "../app-commands";
import { ISSUES_PAGE, type IssuesPlace } from "../tasks/use-tasks-tab";
import { ToastHost } from "../toast";
import { IssuesPage } from "./issues-page";

/**
 * issues-page.test.ts -- the Issues page as the window draws it: the listed workspace's issues under a heading for each status, the work under way first, a title typed and Return filing a new one into its group, ↑ ↓ and Return opening a row, and a read that did not land said with a retry.
 *
 * The service is a script at the act boundary; synthetic issues and words throughout.
 */

const WORKSPACE: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

function issue(number: number, patch: Partial<Issue> = {}): Issue {
  return {
    id: `3f0e6f5c-7d1a-4f6e-9a55-${String(number).padStart(12, "0")}`,
    workspaceId: WORKSPACE.id,
    number,
    title: `Issue ${number}`,
    description: "",
    status: ISSUE_STATUS.BACKLOG,
    priority: ISSUE_PRIORITY.NONE,
    creator: null,
    archivedAt: null,
    createdAt: number,
    updatedAt: number,
    ...patch,
  };
}

let root: Root | undefined;
/** The service's issues, as a read of the list answers them and a filing adds to them. */
let standing: Issue[] = [];
/** How the next reads of the list answer before the service's own, in order. */
let lists: IssueListView[] = [];
/** Every workspace whose list was read, in order. */
let listed: string[] = [];
/** Every filing asked, as the act carried it. */
let creates: unknown[] = [];
/** Whether a filing is refused. */
let createRefused = false;
/** Every place the page asked to open. */
let opened: (IssuesPlace | undefined)[] = [];
/** How many times the page asked to close. */
let closed = 0;

beforeEach(() => {
  standing = [];
  lists = [];
  listed = [];
  creates = [];
  createRefused = false;
  opened = [];
  closed = 0;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.ISSUES_LIST) {
          listed.push(request.payload.workspaceId);
          const value = lists.shift() ?? { issues: standing };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.ISSUES_CREATE) {
          creates.push(request.payload);
          if (createRefused) {
            const value = { failure: ISSUE_CALL_FAILURE.INVALID };
            return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
          }
          const made = issue(standing.length + 1, {
            title: request.payload.title,
            updatedAt: 1_000,
          });
          standing = [made, ...standing];
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { issue: made } });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The Issues page, standing in the plan's place over the workspace listed. */
function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const control = tasksControl({ workspace: WORKSPACE });
  const plans = tasksControl({
    workspace: WORKSPACE,
    issuesView: {
      ...control.issuesView,
      open: true,
      onOpen: (place) => opened.push(place),
      onClose: () => (closed += 1),
    },
  });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(IssuesPage, { tasks: plans }),
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

/** Each group's heading and its rows' identifiers and titles, top to bottom. */
function groups(page: HTMLElement): [string, string[]][] {
  return [...page.querySelectorAll(".issue-group")].map((group) => [
    group.querySelector(".issue-group-head")?.textContent ?? "",
    [...group.querySelectorAll(".issue-row")].map(
      (row) =>
        `${row.querySelector(".issue-row-identifier")?.textContent} ${row.querySelector(".issue-row-title")?.textContent}`,
    ),
  ]);
}

/** Types into the new issue's field and presses Return. */
function file(page: HTMLElement, title: string): void {
  const field = page.querySelector<HTMLInputElement>("input[aria-label='New issue title']");
  assert.ok(field, "the field stands");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(field, title);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

test("the listed workspace's issues stand under a heading for each status, the work under way first, each counted and the most pressing first", async () => {
  standing = [
    issue(1, { status: ISSUE_STATUS.DONE }),
    issue(2, { priority: ISSUE_PRIORITY.LOW }),
    issue(3, { status: ISSUE_STATUS.IN_PROGRESS, title: "Fix login" }),
    issue(4, { priority: ISSUE_PRIORITY.URGENT }),
  ];
  const page = mount();
  await settle();

  assert.deepEqual(listed, [WORKSPACE.id]);
  assert.deepEqual(groups(page), [
    ["In Progress1", ["ACME-3 Fix login"]],
    ["Backlog2", ["ACME-4 Issue 4", "ACME-2 Issue 2"]],
    ["Done1", ["ACME-1 Issue 1"]],
  ]);
});

test("a title typed and Return files the issue in the listed workspace, which lands under Backlog and empties the field", async () => {
  standing = [issue(1, { status: ISSUE_STATUS.TODO })];
  const page = mount();
  await settle();

  file(page, "  Flaky checkout test ");
  await settle();

  assert.deepEqual(creates, [{ workspaceId: WORKSPACE.id, title: "Flaky checkout test" }]);
  assert.deepEqual(groups(page), [
    ["Todo1", ["ACME-1 Issue 1"]],
    ["Backlog1", ["ACME-2 Flaky checkout test"]],
  ]);
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='New issue title']")?.value,
    "",
  );
});

test("a filing the service refused keeps the title typed and says so", async () => {
  createRefused = true;
  const page = mount();
  await settle();

  file(page, "Flaky checkout test");
  await settle();

  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='New issue title']")?.value,
    "Flaky checkout test",
  );
  assert.match(document.body.textContent ?? "", /Couldn't create the issue/u);
});

test("↓ from the window reaches the first row and Return opens that issue; Escape closes the page", async () => {
  standing = [issue(1), issue(2, { status: ISSUE_STATUS.IN_PROGRESS })];
  const page = mount();
  await settle();

  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  });
  const focused = document.activeElement;
  assert.ok(focused instanceof HTMLButtonElement && page.contains(focused));
  act(() => focused.click());
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });

  assert.deepEqual(opened, [{ kind: ISSUES_PAGE.ISSUE, issueId: issue(2).id }]);
  assert.equal(closed, 1);
});

test("a read that did not land is said with a retry, which asks again and draws the list", async () => {
  lists = [{ failure: ISSUE_CALL_FAILURE.UNANSWERED }];
  standing = [issue(1)];
  const page = mount();
  await settle();

  assert.match(page.textContent ?? "", /The issues could not be read/u);
  const retry = [...page.querySelectorAll("button")].find((button) =>
    /Retry|Try again/u.test(button.textContent ?? ""),
  );
  assert.ok(retry, "a retry stands");
  act(() => retry.click());
  await settle();

  assert.deepEqual(listed, [WORKSPACE.id, WORKSPACE.id]);
  assert.deepEqual(groups(page), [["Backlog1", ["ACME-1 Issue 1"]]]);
});
