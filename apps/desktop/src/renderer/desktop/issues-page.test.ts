// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ISSUE_CALL_FAILURE, type IssueListView } from "@luke/features/issue-view";
import { ISSUE_PRIORITY, ISSUE_STATUS, type Issue } from "@luke/features/issue-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { lineWords } from "#testing/actor-line";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { tasksControl } from "#testing/tasks-control";
import { runAppCommand, useAppKeymap } from "../app-commands";
import { ISSUES_PAGE, type IssuesPlace } from "../tasks/use-tasks-tab";
import { ToastHost } from "../toast";
import { IssuesPage } from "./issues-page";

/**
 * issues-page.test.ts -- the Issues page as the window draws it: the listed workspace's issues under a heading for each status, the work under way first, a title typed and Return filing a new one into its group, ↑ ↓ and Return opening a row, an issue's page saying who filed it and when it was filed and last changed, and a read that did not land said with a retry.
 *
 * The service is a script at the act boundary; synthetic issues and words throughout.
 */

const WORKSPACE: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The moment the window's clock stands at in a test that reads how long ago something was. */
const NOW = Date.UTC(2026, 9, 14, 12);

/** The signed-in reader's account. */
const READER = "user-grace";

/** The workspace's members, as their read answers them. */
const MEMBERS: readonly WorkspaceMember[] = [
  {
    userId: "user-ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: WORKSPACE_ROLE.MEMBER,
    pictureUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  },
  { userId: READER, name: "Grace Hopper", email: "grace@example.com", role: WORKSPACE_ROLE.OWNER },
];

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
/** The filings held unanswered, each answered by its resolver, where filings are held at all. */
let heldCreates: (() => void)[] | undefined;
/** Whether a change is refused. */
let changeRefused = false;
/** Every text copied, in order. */
let copied: string[] = [];

beforeEach(() => {
  installScrollIntoView();
  window.localStorage.clear();
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
  heldCreates = undefined;
  changeRefused = false;
  copied = [];
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
          const { title, status, priority } = request.payload;
          const made = issue(standing.length + 1, {
            title,
            updatedAt: 1_000,
            ...(status === undefined ? undefined : { status }),
            ...(priority === undefined ? undefined : { priority }),
          });
          standing = [made, ...standing];
          const done = { status: ACT_OUTCOME_STATUS.DONE, value: { issue: made } };
          const held = heldCreates;
          if (held === undefined) return Promise.resolve(done);
          return new Promise((resolve) => held.push(() => resolve(done)));
        }
        if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS });
        }
        if (request.kind === ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: [] });
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
        if (request.kind === ACT_KIND.WINDOW_COPY_TEXT) {
          copied.push(request.payload.words);
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The registry every render of one mount shares, so a render again is the same window. */
let registry = AtomRegistry.make();

/** The window's keymap, which hears a key as the window does. */
function Keymap(): null {
  useAppKeymap(true);
  return null;
}

/** The Issues pages over the workspace given, opened on `start`, standing on the page each press opens. */
function Pages({
  workspace,
  start = { kind: ISSUES_PAGE.LIST },
}: {
  workspace: Workspace;
  start?: IssuesPlace | undefined;
}): React.JSX.Element {
  const [place, setPlace] = useState<IssuesPlace>(start);
  const control = tasksControl({ workspace });
  const plans = tasksControl({
    workspace,
    me: READER,
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
    createElement(Keymap),
  );
}

/** The Issues page, standing in the plan's place over the workspace listed, opened on `start` as a link opens it. */
function mount(start?: IssuesPlace): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry = AtomRegistry.make();
  list(WORKSPACE, start);
  return container;
}

/** The pages drawn again in place, listing the workspace given. */
function list(workspace: Workspace, start?: IssuesPlace): void {
  act(() => root?.render(onRegistry(registry, createElement(Pages, { workspace, start }))));
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Each group's heading and its rows' identifiers and titles, top to bottom, whether the page stands as a board or a list; a board's empty columns are left out. */
function groups(page: HTMLElement): [string, string[]][] {
  return [...page.querySelectorAll(".home-section, [data-issue-column]")]
    .map((group): [string, string[]] => [
      group.querySelector(".issue-group-head, h2")?.textContent ?? "",
      [...group.querySelectorAll(".sidebar-task-item")].map(
        (row) =>
          `${row.querySelector(".issue-row-identifier")?.textContent} ${row.querySelector(".issue-row-title")?.textContent}`,
      ),
    ])
    .filter(([, rows]) => rows.length > 0);
}

/** The board's columns, each its heading and its cards' identifiers, left to right. */
function columns(page: HTMLElement): [string, string[]][] {
  return [...page.querySelectorAll("[data-issue-column]")].map((column) => [
    column.querySelector("h2")?.textContent ?? "",
    [...column.querySelectorAll(".issue-row-identifier")].map((id) => id.textContent ?? ""),
  ]);
}

/** The page laid out as the list, through its View options. */
function showList(): void {
  act(() => button("View options").click());
  act(() => menuItem("List").click());
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

/** What the line under the issue's title says, a phrase at a time, each face left out. */
function bylineOf(page: HTMLElement): (string | undefined)[] {
  return [...page.querySelectorAll(".issue-byline .actor-line")].map(lineWords);
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
      '[role="menu"]:not([data-leaving]) :is([role="menuitem"], [role="menuitemcheckbox"])',
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

/** The new issue's title field, on the card standing over the window. */
function composerField(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    "[role=dialog] input[aria-label='New issue title']",
  );
}

/** Types into a field as the developer would. */
function typeInto(field: HTMLInputElement, words: string): void {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Opens the new issue's card from its button, types the title, and presses Return. */
function file(title: string): void {
  act(() => button("New issue").click());
  const field = composerField();
  assert.ok(field, "the card's field stands");
  typeInto(field, title);
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

/** A key pressed where the keyboard is, as the window's keymap hears it. */
function press(key: string, target: EventTarget = document.activeElement ?? document.body): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, bubbles: true }),
    );
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
  showList();

  assert.deepEqual(listed, [WORKSPACE.id]);
  assert.deepEqual(groups(page), [
    ["In progress1", ["ACME-3 Fix login"]],
    ["Backlog2", ["ACME-4 Issue 4", "ACME-2 Issue 2"]],
    ["Done1", ["ACME-1 Issue 1"]],
  ]);
});

test("New issue opens a card like New task's, whose title, status, and priority Return files in the listed workspace, landing in its group as the card closes", async () => {
  standing = [issue(1, { status: ISSUE_STATUS.TODO })];
  const page = mount();
  await settle();

  act(() => button("New issue").click());
  const field = composerField();
  assert.ok(field, "the card's field stands");
  assert.equal(document.activeElement, field);
  typeInto(field, "  Flaky checkout test ");
  pick(document.body, "Status", "Todo");
  pick(document.body, "Priority", "High");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();

  assert.deepEqual(creates, [
    {
      workspaceId: WORKSPACE.id,
      title: "Flaky checkout test",
      status: ISSUE_STATUS.TODO,
      priority: ISSUE_PRIORITY.HIGH,
    },
  ]);
  assert.equal(composerField(), null, "the card closes once the issue is kept");
  assert.deepEqual(groups(page), [["Todo2", ["ACME-2 Flaky checkout test", "ACME-1 Issue 1"]]]);
});

test("Escape puts the card away unfiled, and the Issues page stands", async () => {
  const page = mount();
  await settle();

  act(() => button("New issue").click());
  const field = composerField();
  assert.ok(field, "the card's field stands");
  typeInto(field, "Never mind");
  press("Escape", field);
  await settle();

  assert.equal(composerField(), null);
  assert.deepEqual(creates, []);
  assert.equal(closed, 0);
  assert.ok(page.querySelector("[aria-label='Issues']"));
});

test("a filing the service refused keeps the card and its title and says so", async () => {
  createRefused = true;
  mount();
  await settle();

  file("Flaky checkout test");
  await settle();

  assert.equal(composerField()?.value, "Flaky checkout test");
  assert.match(document.body.textContent ?? "", /Couldn't create the issue/u);
});

test("C pressed on the page opens the card, and a c typed into the card's title, an issue's title, or its description is only a letter", async () => {
  standing = [issue(1)];
  const page = mount();
  await settle();

  press("c", document.body);
  const field = composerField();
  assert.ok(field, "C opens the card");
  press("c", field);
  assert.equal(document.querySelectorAll("[role=dialog]").length, 1, "no second card");
  press("Escape", field);
  await settle();

  const row = page.querySelector<HTMLButtonElement>(`[data-issue-id="${issue(1).id}"] button`);
  assert.ok(row);
  act(() => row.click());
  await settle();
  const title = page.querySelector<HTMLElement>("[aria-label='Issue title']");
  assert.ok(title);
  act(() => title.focus());
  press("c", title);
  const description = openDescription(page);
  press("c", description);

  assert.equal(document.querySelectorAll("[role=dialog]").length, 0, "no card opened while typing");
});

test("↓ and Return open the issue reached, read on its own page; Escape comes back to the list with its row holding the keyboard, and Escape again closes the page", async () => {
  standing = [
    issue(1, { status: ISSUE_STATUS.DONE }),
    issue(2, { status: ISSUE_STATUS.IN_PROGRESS, title: "Fix login" }),
  ];
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
  assert.equal(picked(page, "Status"), "In progress");

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

test("under the title an issue's page says who filed it, by their face as the members read them, and when it was filed and last changed, a task's own words", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  const filed = issue(1, {
    creator: { userId: "user-ada", name: "Ada Lovelace" },
    createdAt: NOW - 3 * DAY - HOUR,
    updatedAt: NOW - 2 * HOUR - MINUTE,
  });
  standing = [filed];
  const page = await openIssue(filed.id);

  assert.deepEqual(bylineOf(page), ["Created by Ada Lovelace · 3d ago", "Last edited · 2h ago"]);
  const picture = page.querySelector<HTMLImageElement>(".issue-byline .actor-mark img");
  assert.ok(picture?.src.startsWith("https://avatars.githubusercontent.com/u/1"), "her picture");
});

test("an issue the reader filed names them as you", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  const filed = issue(1, {
    creator: { userId: READER, name: "Grace Hopper" },
    createdAt: NOW - 2 * DAY - HOUR,
    updatedAt: NOW - 2 * DAY - HOUR,
  });
  standing = [filed];
  const page = await openIssue(filed.id);

  assert.deepEqual(bylineOf(page), ["Created by you · 2d ago"]);
});

test("an issue whose creator is gone and unchanged since it was filed says only when it was created, until a change lands", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  const filedAt = NOW - 5 * HOUR - MINUTE;
  const filed = issue(1, { creator: null, createdAt: filedAt, updatedAt: filedAt });
  standing = [filed];
  const page = await openIssue(filed.id);

  assert.deepEqual(bylineOf(page), ["Created · 5h ago"]);
  pick(page, "Status", "Todo");
  await settle();

  assert.deepEqual(bylineOf(page), ["Created · 5h ago", "Last edited · 5h ago"]);
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

test("an issue's ⋯ offers Copy link, copying its link under the listed workspace, and the issue's page stands", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2)];
  const page = await openIssue(issue(1).id);

  act(() => button("Issue actions").click());
  await act(async () => menuItem("Copy link").click());

  assert.deepEqual(copied, [`https://tryluke.dev/${WORKSPACE.id}/issue/${issue(1).id}`]);
  assert.equal(titleOf(page), "Fix login");
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
  mount();
  await settle();
  act(() => button("New issue").click());
  const field = composerField();
  assert.ok(field, "the card's field stands");
  typeInto(field, "Meant for Acme");

  list({ ...WORKSPACE, id: "workspace-initech", name: "Initech" });
  await settle();

  assert.equal(composerField()?.value ?? "", "");
});

test("an issue's page whose workspace is no longer the one listed says the issue is not in this workspace", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = await openIssue(issue(1).id);

  list({ ...WORKSPACE, id: "workspace-initech", name: "Initech" });
  await settle();

  assert.equal(page.querySelector("[aria-label='Issue title']"), null);
  assert.match(page.textContent ?? "", /not in this workspace/u);
});

test("an issue's page opened on an issue the service does not hand the reader, as a link to one opens it, says it is gone", async () => {
  standing = [issue(1)];
  const page = mount({ kind: ISSUES_PAGE.ISSUE, issueId: issue(9).id });
  await settle();

  assert.deepEqual(reads, [issue(9).id]);
  assert.equal(page.querySelector("[aria-label='Issue title']"), null);
  assert.match(page.textContent ?? "", /This issue is gone, or not in this workspace\./u);
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

test("while a new issue is being filed its card's chips take no pick", async () => {
  mount();
  await settle();
  heldCreates = [];
  const held = heldCreates;

  file("Flaky checkout test");
  await settle();
  const chips = [
    ...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button[aria-haspopup=dialog]"),
  ];
  const lockedWhileOut = chips.length === 2 && chips.every((chip) => chip.disabled);
  act(() => held[0]?.());
  await settle();

  assert.ok(lockedWhileOut, "both chips are disabled while the filing is out");
  assert.equal(composerField(), null);
});

test("a filing answered once another workspace is listed puts away no card of the workspace listed now", async () => {
  mount();
  await settle();
  heldCreates = [];
  const held = heldCreates;

  file("Meant for Acme");
  await settle();
  list({ ...WORKSPACE, id: "workspace-initech", name: "Initech" });
  await settle();
  const field = composerField();
  assert.ok(field, "the card stands, fresh, for the workspace listed now");
  typeInto(field, "Meant for Initech");
  act(() => held[0]?.());
  await settle();

  assert.equal(composerField()?.value, "Meant for Initech");
});

test("the page opens as a board: a column for every status in the order work moves through them, an empty one saying so uncounted, each other counted and its cards sorted as the list sorts", async () => {
  standing = [
    issue(1, { status: ISSUE_STATUS.DONE }),
    issue(2, { status: ISSUE_STATUS.TODO, priority: ISSUE_PRIORITY.LOW }),
    issue(3, { status: ISSUE_STATUS.TODO, priority: ISSUE_PRIORITY.URGENT }),
  ];
  const page = mount();
  await settle();

  assert.deepEqual(columns(page), [
    ["Backlog", []],
    ["Todo2", ["ACME-3", "ACME-2"]],
    ["In progress", []],
    ["Done1", ["ACME-1"]],
    ["Canceled", []],
  ]);
  assert.equal(page.querySelector("[data-issue-column='in-progress'] p")?.textContent, "No issues");
  assert.equal(page.querySelector(".home-section"), null, "no list stands beside the board");
});

test("on the board ↓ and ↑ move down a column, ← and → to the nearest card of the next column holding any, and Return opens the card reached", async () => {
  standing = [
    issue(1, { status: ISSUE_STATUS.TODO, priority: ISSUE_PRIORITY.HIGH }),
    issue(2, { status: ISSUE_STATUS.TODO, priority: ISSUE_PRIORITY.LOW }),
    issue(3, { status: ISSUE_STATUS.DONE }),
  ];
  const page = mount();
  await settle();
  const reached = () =>
    document.activeElement?.closest("[data-issue-id]")?.getAttribute("data-issue-id");

  press("ArrowDown", window);
  const first = reached();
  press("ArrowDown");
  const down = reached();
  press("ArrowRight");
  const across = reached();
  press("ArrowLeft");
  const back = reached();
  press("ArrowUp");
  const up = reached();
  const card = document.activeElement;
  assert.ok(card instanceof HTMLButtonElement, "a card holds the keyboard");
  act(() => card.click());
  await settle();

  assert.deepEqual(
    [first, down, across, back, up],
    [issue(1).id, issue(2).id, issue(3).id, issue(1).id, issue(1).id],
  );
  assert.deepEqual(opened, [{ kind: ISSUES_PAGE.ISSUE, issueId: issue(1).id }]);
  assert.ok(page.querySelector("[aria-label='Issue title']"));
});

/**
 * The board laid out as a narrow window lays it: each column 300px wide,
 * side by side from the scroller's start, in a scroller 700px wide that
 * scrolls sideways. jsdom lays nothing out, so this answers the geometry the
 * browser would. Answers each scroller's sideways scroll as it stands.
 */
function layBoardOut(): () => number {
  const COLUMN = 300;
  const scrolled = new WeakMap<Element, number>();
  const scroller = () => document.querySelector(".issue-board-scroll");
  vi.spyOn(Element.prototype, "scrollLeft", "get").mockImplementation(function (this: Element) {
    return scrolled.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, "scrollLeft", "set").mockImplementation(function (
    this: Element,
    left: number,
  ) {
    scrolled.set(this, left);
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.matches(".issue-board-scroll") ? 700 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches("[data-issue-column]") ? COLUMN : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const columns = [...document.querySelectorAll("[data-issue-column]")];
    const at = columns.indexOf(this);
    const left = at < 0 ? 0 : at * COLUMN - (scrolled.get(scroller() ?? this) ?? 0);
    return new DOMRect(left, 0, at < 0 ? 0 : COLUMN, 0);
  });
  return () => {
    const board = scroller();
    return board === null ? -1 : (scrolled.get(board) ?? 0);
  };
}

test("on a board wider than the window, the column of the card reached stands whole in view, by an arrow and on the way back from its issue", async () => {
  standing = [issue(1), issue(2, { status: ISSUE_STATUS.DONE })];
  const page = mount();
  await settle();
  const scrolledTo = layBoardOut();

  press("ArrowDown", window);
  press("ArrowRight");
  const byArrow = scrolledTo();
  const card = document.activeElement;
  assert.ok(card instanceof HTMLButtonElement);
  act(() => card.click());
  await settle();
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });
  await settle();

  // Note that Done is the fourth column, so it ends at 1200px, 500px past the scroller's 700.
  assert.equal(byArrow, 500);
  assert.equal(
    document.activeElement?.closest("[data-issue-id]")?.getAttribute("data-issue-id"),
    issue(2).id,
  );
  assert.equal(scrolledTo(), 500, "the board drawn again brings the returned card's column in");
  assert.ok(page.querySelector("[data-issue-column]"));
});

test("View options lays the page out as the list and back as the board, and an issue opened from either goes back to it", async () => {
  standing = [issue(1)];
  const page = mount();
  await settle();

  showList();
  const listed = page.querySelector(".home-section") !== null;
  const row = page.querySelector<HTMLButtonElement>(`[data-issue-id="${issue(1).id}"] button`);
  assert.ok(row);
  act(() => row.click());
  await settle();
  act(() => button("Issues").click());
  await settle();
  const stillListed = page.querySelector(".home-section") !== null;
  act(() => button("View options").click());
  act(() => menuItem("Board").click());

  assert.ok(listed, "List lays the page out as the list");
  assert.ok(stillListed, "the list is what the page goes back to");
  assert.ok(page.querySelector("[data-issue-column]"), "Board lays it out as the board again");
  assert.equal(page.querySelector(".home-section"), null);
});

test("the page opens again in the layout last chosen, the list after List and the board after Board", async () => {
  standing = [issue(1)];
  mount();
  await settle();
  showList();
  act(() => root?.unmount());

  const reopened = mount();
  await settle();
  const listedAgain = reopened.querySelector(".home-section") !== null;
  const boardAgain = reopened.querySelector("[data-issue-column]") !== null;
  act(() => button("View options").click());
  act(() => menuItem("Board").click());
  act(() => root?.unmount());
  const thirdTime = mount();
  await settle();

  assert.ok(listedAgain, "List chosen, the page opens as the list");
  assert.equal(boardAgain, false);
  assert.ok(thirdTime.querySelector("[data-issue-column]"), "Board chosen, it opens as the board");
  assert.equal(thirdTime.querySelector(".home-section"), null);
});

test("a workspace with no issue yet still stands the board's columns, each saying it holds none", async () => {
  const page = mount();
  await settle();

  assert.deepEqual(columns(page), [
    ["Backlog", []],
    ["Todo", []],
    ["In progress", []],
    ["Done", []],
    ["Canceled", []],
  ]);
  assert.equal(
    [...page.querySelectorAll("[data-issue-column] p")].filter(
      (idle) => idle.textContent === "No issues",
    ).length,
    5,
  );
});

test("once the page has come back from an issue, a layout chosen keeps the keyboard on View options rather than that issue's row", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);
  act(() => button("Issues").click());
  await settle();

  showList();
  await settle();

  assert.ok(page.querySelector(".home-section"), "the list stands");
  assert.equal(document.activeElement?.closest("[data-issue-id]") ?? null, null);
});

test("a column's + opens the new issue's card with that column's status chosen, the priority at its default, and the title holding the keyboard", async () => {
  mount();
  await settle();

  act(() => button("New issue in Done").click());

  assert.equal(document.activeElement, composerField(), "the title takes the keyboard");
  assert.equal(picked(document.body, "Status"), "Done");
  assert.equal(picked(document.body, "Priority"), "No priority");
});

test("Return on a card a column's + opened files the issue with that column's status, and it lands in that column", async () => {
  standing = [issue(1, { status: ISSUE_STATUS.DONE })];
  const page = mount();
  await settle();

  act(() => button("New issue in Done").click());
  const field = composerField();
  assert.ok(field, "the card's field stands");
  typeInto(field, "Ship the changelog");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();

  assert.deepEqual(creates, [
    {
      workspaceId: WORKSPACE.id,
      title: "Ship the changelog",
      status: ISSUE_STATUS.DONE,
      priority: ISSUE_PRIORITY.NONE,
    },
  ]);
  assert.equal(composerField(), null, "the card closes once the issue is kept");
  assert.deepEqual(
    columns(page).find(([head]) => head.startsWith("Done")),
    ["Done2", ["ACME-2", "ACME-1"]],
  );
});

test("the toolbar's New issue and C still open the card on Backlog", async () => {
  mount();
  await settle();

  act(() => button("New issue").click());
  const fromButton = picked(document.body, "Status");
  press("Escape", composerField() ?? document.body);
  await settle();
  press("c", document.body);

  assert.equal(fromButton, "Backlog");
  assert.equal(picked(document.body, "Status"), "Backlog");
});

/** The button a card or row draws for the issue given. */
function cardOf(page: HTMLElement, issueId: string): HTMLButtonElement {
  const found = page.querySelector<HTMLButtonElement>(`[data-issue-id="${issueId}"] > button`);
  assert.ok(found, `no card for ${issueId}`);
  return found;
}

/** A right-click on an element, at a point in the window, as the pointer makes one. */
function rightClick(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
    );
  });
}

/** Opens the submenu named in the menu standing open and picks its item. */
function pickFrom(submenu: string, item: string): void {
  act(() => menuItem(submenu).click());
  act(() => menuItem(item).click());
}

test("a status picked from a card's right-click menu, the current one checked, is sent and moves the card to its new column", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2, { status: ISSUE_STATUS.TODO })];
  const page = mount();
  await settle();

  rightClick(cardOf(page, issue(1).id));
  act(() => menuItem("Status").click());
  assert.equal(menuItem("Backlog").getAttribute("aria-checked"), "true");
  assert.equal(menuItem("Done").getAttribute("aria-checked"), "false");
  act(() => menuItem("Done").click());
  await settle();

  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { status: ISSUE_STATUS.DONE } }]);
  assert.deepEqual(columns(page), [
    ["Backlog", []],
    ["Todo1", ["ACME-2"]],
    ["In progress", []],
    ["Done1", ["ACME-1"]],
    ["Canceled", []],
  ]);
});

test("a list row's menu opens from the keyboard with ⇧F10, and a priority picked there is sent and moves the row", async () => {
  standing = [issue(1), issue(2, { priority: ISSUE_PRIORITY.LOW })];
  const page = mount();
  await settle();
  showList();

  const row = cardOf(page, issue(1).id);
  act(() => row.focus());
  act(() => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
  });
  pickFrom("Priority", "Urgent");
  await settle();

  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { priority: ISSUE_PRIORITY.URGENT } },
  ]);
  assert.deepEqual(groups(page), [["Backlog2", ["ACME-1 Issue 1", "ACME-2 Issue 2"]]]);
});

test("Archive from a card's menu asks first in the issue page's words, then sends the archive and takes the card off the board", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2)];
  const page = mount();
  await settle();

  rightClick(cardOf(page, issue(1).id));
  act(() => menuItem("Archive").click());
  assert.deepEqual(changes, [], "nothing is sent before the answer");
  assert.match(
    document.querySelector("[role=alertdialog]")?.textContent ?? "",
    /Archive ACME-1\?/u,
  );
  act(() => dialogButton("Archive").click());
  await settle();

  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { archived: true } }]);
  assert.deepEqual(groups(page), [["Backlog1", ["ACME-2 Issue 2"]]]);
  assert.equal(document.querySelector("[role=alertdialog]"), null, "the question is gone");
});

test("a card's menu offers Copy link, copying its issue's link under the listed workspace", async () => {
  standing = [issue(1), issue(2)];
  const page = mount();
  await settle();

  rightClick(cardOf(page, issue(2).id));
  await act(async () => menuItem("Copy link").click());

  assert.deepEqual(copied, [`https://tryluke.dev/${WORKSPACE.id}/issue/${issue(2).id}`]);
  assert.deepEqual(changes, []);
});

test("a change from a card's menu the service refused leaves the card where it stood and says so", async () => {
  standing = [issue(1)];
  changeRefused = true;
  const page = mount();
  await settle();

  rightClick(cardOf(page, issue(1).id));
  pickFrom("Status", "Done");
  await settle();

  assert.equal(changes.length, 1);
  assert.deepEqual(groups(page), [["Backlog1", ["ACME-1 Issue 1"]]]);
  assert.match(document.body.textContent ?? "", /Couldn't change the issue\. Try again\./u);
});

test("a card moved by a status picked from its menu keeps the keyboard in its new column", async () => {
  standing = [issue(1), issue(2)];
  const page = mount();
  await settle();

  const card = cardOf(page, issue(1).id);
  act(() => card.focus());
  act(() => {
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
  });
  pickFrom("Status", "Done");
  await settle();

  const holding = document.activeElement?.closest<HTMLElement>("[data-issue-id]");
  assert.equal(holding?.dataset.issueId, issue(1).id);
  assert.equal(holding?.closest<HTMLElement>("[data-issue-column]")?.dataset.issueColumn, "done");
});

test("a card moved once the developer has gone on to New issue takes no keyboard from its card", async () => {
  standing = [issue(1), issue(2)];
  heldChanges = [];
  const held = heldChanges;
  const page = mount();
  await settle();

  rightClick(cardOf(page, issue(1).id));
  pickFrom("Status", "Done");
  act(() => button("New issue").click());
  const field = composerField();
  assert.ok(field, "the card's field stands");
  act(() => field.focus());
  act(() => held[0]?.());
  await settle();

  assert.deepEqual(columns(page)[3], ["Done1", ["ACME-1"]]);
  assert.equal(document.activeElement, composerField());
});
