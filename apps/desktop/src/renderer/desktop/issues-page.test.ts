// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ISSUE_CALL_FAILURE, type IssueListView } from "@luke/features/issue-view";
import { ISSUE_PRIORITY, ISSUE_STATUS, type Issue } from "@luke/features/issue-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
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
/** Every issue read on its own, by its id. */
let reads: string[] = [];
/** Every change asked, as the act carried it. */
let changes: unknown[] = [];
/** The changes held unanswered, each answered by its resolver, where changes are held at all. */
let heldChanges: (() => void)[] | undefined;
/** Whether a change is refused. */
let changeRefused = false;

beforeEach(() => {
  installScrollIntoView();
  standing = [];
  lists = [];
  listed = [];
  creates = [];
  createRefused = false;
  opened = [];
  closed = 0;
  reads = [];
  changes = [];
  heldChanges = undefined;
  changeRefused = false;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.ISSUES_LIST) {
          listed.push(request.payload.workspaceId);
          const value = lists.shift() ?? {
            issues: standing.filter((each) => each.archivedAt === null),
          };
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
        if (request.kind === ACT_KIND.ISSUES_READ) {
          reads.push(request.payload.issueId);
          const found = standing.find((each) => each.id === request.payload.issueId);
          const value =
            found === undefined ? { failure: ISSUE_CALL_FAILURE.NOT_FOUND } : { issue: found };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.ISSUES_CHANGE) {
          changes.push(request.payload);
          const { issueId, change } = request.payload;
          const was = standing.find((each) => each.id === issueId);
          if (changeRefused) {
            const refused = {
              status: ACT_OUTCOME_STATUS.DONE,
              value: { failure: ISSUE_CALL_FAILURE.UNANSWERED },
            };
            const held = heldChanges;
            if (held === undefined) return Promise.resolve(refused);
            return new Promise((resolve) => held.push(() => resolve(refused)));
          }
          if (was === undefined) {
            const value = { failure: ISSUE_CALL_FAILURE.NOT_FOUND };
            return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
          }
          const { archived, ...fields } = change;
          const changed: Issue = {
            ...was,
            ...fields,
            archivedAt: archived === undefined ? was.archivedAt : archived ? 5_000 : null,
            updatedAt: was.updatedAt + 1,
          };
          standing = standing.map((each) => (each.id === issueId ? changed : each));
          const done = { status: ACT_OUTCOME_STATUS.DONE, value: { issue: changed } };
          const held = heldChanges;
          if (held === undefined) return Promise.resolve(done);
          return new Promise((resolve) => held.push(() => resolve(done)));
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

/** The registry every render of one mount shares, so a render again is the same window. */
let registry = AtomRegistry.make();

/** The Issues pages over the workspace given, standing on the page each press opens. */
function Pages({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const [place, setPlace] = useState<IssuesPlace>({ kind: ISSUES_PAGE.LIST });
  const control = tasksControl({ workspace });
  const plans = tasksControl({
    workspace,
    issuesView: {
      ...control.issuesView,
      open: true,
      place,
      onOpen: (to = { kind: ISSUES_PAGE.LIST }) => {
        opened.push(to);
        setPlace(to);
      },
      onClose: () => (closed += 1),
    },
  });
  return createElement(
    Fragment,
    null,
    createElement(IssuesPage, { tasks: plans }),
    createElement(ToastHost),
  );
}

/** The Issues page, standing in the plan's place over the workspace listed. */
function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry = AtomRegistry.make();
  list(WORKSPACE);
  return container;
}

/** The pages drawn again in place, listing the workspace given. */
function list(workspace: Workspace): void {
  act(() => root?.render(onRegistry(registry, createElement(Pages, { workspace }))));
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Each group's heading and its rows' identifiers and titles, top to bottom. */
function groups(page: HTMLElement): [string, string[]][] {
  return [...page.querySelectorAll(".home-section")].map((group) => [
    group.querySelector(".home-section-title")?.textContent ?? "",
    [...group.querySelectorAll(".sidebar-task-item")].map(
      (row) =>
        `${row.querySelector(".issue-row-identifier")?.textContent} ${row.querySelector(".issue-row-title")?.textContent}`,
    ),
  ]);
}

/** The page opened on one issue, its own read answered. */
async function openIssue(issueId: string): Promise<HTMLElement> {
  const page = mount();
  await settle();
  const row = page.querySelector<HTMLButtonElement>(`[data-issue-id="${issueId}"] button`);
  assert.ok(row, `no row for ${issueId}`);
  act(() => row.click());
  await settle();
  return page;
}

/** The issue's title as its page draws it. */
function titleOf(page: HTMLElement): string | undefined {
  return page.querySelector("[aria-label='Issue title']")?.textContent ?? undefined;
}

/** The button whose words or name are `name`, wherever it is drawn. */
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === name || each.getAttribute("aria-label") === name,
  );
  assert.ok(found, `no button ${name}`);
  return found;
}

/** The item of the menu standing open whose words are `name`. */
function menuItem(name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="menu"]:not([data-leaving]) [role="menuitem"]',
    ),
  ].find((each) => each.textContent === name);
  assert.ok(found, `no menu item ${name}`);
  return found;
}

/** The dialog's button whose words are `name`. */
function dialogButton(name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(
      "[role=dialog] button, [role=alertdialog] button",
    ),
  ].find((each) => each.textContent === name);
  assert.ok(found, `no dialog button ${name}`);
  return found;
}

/** The chip of the picker named. */
function picker(page: HTMLElement, label: string): HTMLButtonElement {
  const found = page.querySelector<HTMLButtonElement>(`button[aria-label^="${label}: "]`);
  assert.ok(found, `no picker ${label}`);
  return found;
}

/** What the picker named says it holds now. */
function picked(page: HTMLElement, label: string): string | undefined {
  return picker(page, label)
    .getAttribute("aria-label")
    ?.slice(label.length + 2);
}

/** Opens the picker named and picks the option. */
function pick(page: HTMLElement, label: string, option: string): void {
  act(() => picker(page, label).click());
  const row = [...document.querySelectorAll<HTMLButtonElement>("[role=option]")].find(
    (each) => each.querySelector(".task-compose-menu-name")?.textContent === option,
  );
  assert.ok(row, `no ${option} in ${label}`);
  act(() => row.click());
}

/** The description's field, opened by a press on the description. */
function openDescription(page: HTMLElement): HTMLTextAreaElement {
  const description = page.querySelector<HTMLElement>("[aria-label='Edit description']");
  assert.ok(description, "the description stands");
  act(() => description.click());
  const field = page.querySelector<HTMLTextAreaElement>("textarea[aria-label='Description']");
  assert.ok(field, "the description's field opens");
  return field;
}

/** Types into a field as the developer would. */
function type(field: HTMLTextAreaElement, words: string): void {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

test("↓ and Return open the issue reached, read on its own page; Escape comes back to the list with its row holding the keyboard, and Escape again closes the page", async () => {
  standing = [issue(1), issue(2, { status: ISSUE_STATUS.IN_PROGRESS, title: "Fix login" })];
  const page = mount();
  await settle();

  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  });
  const reached = document.activeElement;
  assert.ok(reached instanceof HTMLButtonElement && page.contains(reached));
  act(() => reached.click());
  await settle();

  assert.deepEqual(reads, [issue(2).id]);
  assert.equal(titleOf(page), "Fix login");
  assert.equal(picked(page, "Status"), "In Progress");

  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });
  await settle();
  const back = document.activeElement;
  assert.equal(back?.closest("[data-issue-id]")?.getAttribute("data-issue-id"), issue(2).id);
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });

  assert.deepEqual(opened, [
    { kind: ISSUES_PAGE.ISSUE, issueId: issue(2).id },
    { kind: ISSUES_PAGE.LIST },
  ]);
  assert.equal(closed, 1);
});

test("a status picked on an issue's page is sent, its chip names it, and the list it goes back to holds the issue under its new status", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2, { status: ISSUE_STATUS.TODO })];
  const page = await openIssue(issue(1).id);

  pick(page, "Status", "Done");
  await settle();

  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { status: ISSUE_STATUS.DONE } }]);
  assert.equal(picked(page, "Status"), "Done");
  act(() => button("Issues").click());
  await settle();
  assert.deepEqual(groups(page), [
    ["Todo1", ["ACME-2 Issue 2"]],
    ["Done1", ["ACME-1 Fix login"]],
  ]);
});

test("a priority picked on an issue's page is sent, and its chip names it", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);

  pick(page, "Priority", "Urgent");
  await settle();

  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { priority: ISSUE_PRIORITY.URGENT } },
  ]);
  assert.equal(picked(page, "Priority"), "Urgent");
});

test("the title is the task page's own heading, written where it stands: Return sends the new title and draws it", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = await openIssue(issue(1).id);

  const title = page.querySelector<HTMLElement>("[aria-label='Issue title']");
  assert.ok(title, "the title stands");
  assert.ok(title.matches(".task-title .markdown-heading.task-title-text[data-level='1']"));
  act(() => {
    title.focus();
    title.textContent = "Fix the login redirect";
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();

  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { title: "Fix the login redirect" } },
  ]);
  assert.equal(titleOf(page), "Fix the login redirect");
});

test("Escape in the title puts back the title it opened on, sends nothing, and leaves the issue's page standing", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = await openIssue(issue(1).id);

  const title = page.querySelector<HTMLElement>("[aria-label='Issue title']");
  assert.ok(title, "the title stands");
  act(() => {
    title.focus();
    title.textContent = "Something else";
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();

  assert.deepEqual(changes, []);
  assert.equal(titleOf(page), "Fix login");
  assert.equal(closed, 0);
});

test("the list stands in the window's own frame: the Automations page's view and scroll, Home's sections and rows", async () => {
  standing = [issue(1)];
  const page = mount();
  await settle();

  assert.ok(page.querySelector("section.automations-view > .automations-scroll .home-column"));
  assert.ok(page.querySelector(".home-section > h2.home-section-title > .home-section-count"));
  assert.ok(page.querySelector(".home-section > ul.sidebar-tasks > li.sidebar-task-item.home-row"));
});

test("Archive asks first, then sends the archive and goes back to a list without the issue", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2)];
  const page = await openIssue(issue(1).id);

  act(() => button("Issue actions").click());
  act(() => menuItem("Archive").click());
  assert.deepEqual(changes, [], "nothing is sent before the answer");
  act(() => dialogButton("Archive").click());
  await settle();

  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { archived: true } }]);
  assert.deepEqual(groups(page), [["Backlog1", ["ACME-2 Issue 2"]]]);
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

test("a title typed and not yet filed is dropped once another workspace is listed, so it is never filed there", async () => {
  const page = mount();
  await settle();
  const field = page.querySelector<HTMLInputElement>("input[aria-label='New issue title']");
  assert.ok(field, "the field stands");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(field, "Meant for Acme");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  list({ ...WORKSPACE, id: "workspace-initech", name: "Initech" });
  await settle();

  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='New issue title']")?.value,
    "",
  );
});

test("while a filing is out the title's field takes no typing, so the title it empties is the one it sent", async () => {
  mount();
  await settle();

  const field = document.querySelector<HTMLInputElement>("input[aria-label='New issue title']");
  assert.ok(field, "the field stands");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(field, "Flaky checkout test");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const lockedWhileOut = field.readOnly;
  await settle();

  assert.ok(lockedWhileOut, "the field takes no typing while the filing is out");
  assert.equal(field.readOnly, false);
  assert.equal(field.value, "");
});

test("an issue's page whose workspace is no longer the one listed says the issue is not in this workspace", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = await openIssue(issue(1).id);

  list({ ...WORKSPACE, id: "workspace-initech", name: "Initech" });
  await settle();

  assert.equal(page.querySelector("[aria-label='Issue title']"), null);
  assert.match(page.textContent ?? "", /not in this workspace/u);
});

test("two changes at once draw the newest's answer, though the older one is answered after it", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);
  heldChanges = [];
  const held = heldChanges;

  pick(page, "Status", "Done");
  pick(page, "Priority", "Urgent");
  act(() => held[1]?.());
  await settle();
  act(() => held[0]?.());
  await settle();

  assert.equal(picked(page, "Status"), "Done");
  assert.equal(picked(page, "Priority"), "Urgent");
});

test("the description pressed opens its field, and leaving it sends what was typed and draws it as Markdown", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);

  const field = openDescription(page);
  type(field, "## Plan\n\n- reproduce\n- fix");
  act(() => field.blur());
  await settle();

  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { description: "## Plan\n\n- reproduce\n- fix" } },
  ]);
  assert.equal(page.querySelector("textarea[aria-label='Description']"), null);
  const drawn = page.querySelector(".issue-description");
  assert.equal(drawn?.querySelector(".markdown-heading[data-level='2']")?.textContent, "Plan");
  assert.deepEqual(
    [...(drawn?.querySelectorAll("li") ?? [])].map((item) => item.textContent),
    ["reproduce", "fix"],
  );
});

test("Escape puts back the description the field opened on and sends nothing, leaving the issue's page standing", async () => {
  standing = [issue(1, { description: "Fails on CI." })];
  const page = await openIssue(issue(1).id);

  const field = openDescription(page);
  type(field, "Something else entirely");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();

  assert.deepEqual(changes, []);
  assert.equal(page.querySelector(".issue-description")?.textContent, "Fails on CI.");
  assert.equal(closed, 0);
  assert.deepEqual(opened, [{ kind: ISSUES_PAGE.ISSUE, issueId: issue(1).id }]);
});

test("a save the service refused keeps every word typed in the field and says so", async () => {
  standing = [issue(1)];
  changeRefused = true;
  const page = await openIssue(issue(1).id);

  const field = openDescription(page);
  type(field, "Steps to reproduce");
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
  });
  await settle();

  const kept = page.querySelector<HTMLTextAreaElement>("textarea[aria-label='Description']");
  assert.equal(kept?.value, "Steps to reproduce");
  assert.match(page.textContent ?? "", /Couldn't save the description/u);
});

test("while a description's save is out the field takes no typing and no Escape, and closes once the save is kept", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);
  heldChanges = [];
  const held = heldChanges;

  const field = openDescription(page);
  type(field, "First draft");
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
  });
  await settle();
  const lockedWhileOut = field.readOnly;
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();
  const standsWhileOut = page.querySelector("textarea[aria-label='Description']") !== null;
  act(() => held[0]?.());
  await settle();

  assert.ok(lockedWhileOut, "the field takes no typing while its save is out");
  assert.ok(standsWhileOut, "Escape does not take back a save under way");
  assert.equal(page.querySelector("textarea[aria-label='Description']"), null);
  assert.equal(page.querySelector(".issue-description")?.textContent, "First draft");
  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { description: "First draft" } }]);
});

test("a Return that chooses a word the input method composes is the method's, and sends no title", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = await openIssue(issue(1).id);

  const title = page.querySelector<HTMLElement>("[aria-label='Issue title']");
  assert.ok(title, "the title stands");
  act(() => {
    title.focus();
    title.textContent = "Fix ろぐいん";
    title.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
  });
  await settle();

  assert.deepEqual(changes, []);
  assert.equal(document.activeElement, title);
});

test("a refused rename answered while the title is written again puts nothing back over the newer words", async () => {
  standing = [issue(1, { title: "Fix login" })];
  changeRefused = true;
  const page = await openIssue(issue(1).id);
  heldChanges = [];
  const held = heldChanges;

  const title = page.querySelector<HTMLElement>("[aria-label='Issue title']");
  assert.ok(title, "the title stands");
  act(() => {
    title.focus();
    title.textContent = "First try";
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  act(() => {
    title.focus();
    title.textContent = "Second try, still typing";
  });
  act(() => held[0]?.());
  await settle();

  assert.equal(titleOf(page), "Second try, still typing");
});
