// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { ISSUE_CALL_FAILURE, type IssueListView } from "@luke/features/issue-view";
import { ISSUE_PRIORITY, ISSUE_STATUS, type Issue } from "@luke/features/issue-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import type { TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { runAppCommand, useAppKeymap } from "@luke/panel/app-commands";
import {
  PLACEMENT_END,
  type PlanEditorModule,
  type PlanEditorPlacement,
  type PlanEditorProps,
} from "@luke/panel/plan-editor/contract";
import { lineWords } from "@luke/panel/testing/actor-line";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { relayout } from "@luke/panel/testing/resize-observer";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { ToastHost } from "@luke/panel/toast";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";
import { playMotions } from "#testing/pane-motion";
import { landedBundles, onSideBundles, unlandedBundles } from "#testing/side-bundles";
import { tasksControl } from "#testing/tasks-control";
import { type SideBundles, sideBundles } from "../bundle-loader";
import { type SidePanelControl, useSidePanel } from "../tasks/use-side-panel";
import { ISSUES_PAGE, type IssuesPlace, type NewTaskIssue } from "../tasks/use-tasks-tab";
import { IssuesPage } from "./issues-page";

/**
 * issues-page.test.ts -- the Issues page as the window draws it: the listed workspace's issues under a heading for each status, the work under way first, a title typed and Return filing a new one into its group, ↑ ↓ and Return peeking a row beside the board and ⌘Return opening its page, an issue's page saying who filed it and when it was filed and last changed and listing the tasks started from it, Start task… opening New task on an issue, and a read that did not land said with a retry.
 *
 * The service is a script at the act boundary; synthetic issues and words throughout.
 * The description's editor is the plan's TipTap bundle, tested beside it
 * (`../plan-editor/`); here a stand-in at the bundle's importer is typed
 * into, finished, and left as the editor would be.
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

/**
 * The moment the window's clock stands at otherwise: a day past the epoch,
 * so the synthetic issues, stamped in its first seconds, are recent, and a
 * settled one among them is not left out as gone quiet.
 */
const EARLY = DAY;

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

/** An editor the description mounted: what it was handed, the words it holds now, and its element. */
interface StandInEditor {
  readonly props: PlanEditorProps;
  readonly element: HTMLElement;
  text: string;
  destroyed: boolean;
  /** Where each press on the text's room put the caret while the editor stood. */
  readonly placed: PlanEditorPlacement[];
}

/** Every editor the description mounted, newest last. */
const editors: StandInEditor[] = [];

/** The plan editor's stand-in: an editable element holding the words it was handed, focused where it is asked to be. */
const EDITOR_STAND_IN: PlanEditorModule = {
  mount: (host, props) => {
    const element = document.createElement("div");
    element.setAttribute("contenteditable", "true");
    element.setAttribute("role", "textbox");
    element.setAttribute("aria-label", props.label);
    element.tabIndex = 0;
    host.append(element);
    const editor: StandInEditor = {
      props,
      element,
      text: props.markdown,
      destroyed: false,
      placed: [],
    };
    editors.push(editor);
    if (props.focus) element.focus();
    return {
      take: (_sent, merged) => ({ base: merged, text: merged }),
      chooseMention: () => undefined,
      markdown: () => editor.text,
      focusAt: (placement) => {
        editor.placed.push(placement);
        element.focus();
      },
      insertPictures: () => undefined,
      settlePicture: () => undefined,
      removePicture: () => undefined,
      destroy: () => {
        editor.destroyed = true;
        element.remove();
      },
    };
  },
  mountComposer: () => assert.fail("the issue's page mounts no message box"),
};

/** The bundles the page is drawn over: the editor's stand-in landed, unless a test draws it over others. */
let landed: SideBundles;
let bundles: SideBundles;

// Landed before any page renders, as it is once a plan or an issue has been shown in this window.
beforeAll(async () => {
  landed = await Effect.runPromise(
    landedBundles({ planEditor: () => Promise.resolve(EDITOR_STAND_IN) }),
  );
});

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
/** The listed workspace's tasks, as the tab holds them, and its archived ones. */
let tasksListed: TaskSummary[] = [];
let tasksArchived: TaskSummary[] = [];
/** Every issue New task was opened on, in order, with `agent` where it was opened as a new agent's card. */
let newTasksFrom: (NewTaskIssue & { readonly agent?: boolean })[] = [];
/** Every task opened, in order. */
let tasksOpened: string[] = [];
/** Every Luke link the page opened, and every GitHub page, in order. */
let linksOpened: ReadLink[] = [];
let githubOpened: string[] = [];
/** The account signed in as the page is drawn. */
let signedIn = READER;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: EARLY });
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
  tasksListed = [];
  tasksArchived = [];
  newTasksFrom = [];
  tasksOpened = [];
  linksOpened = [];
  githubOpened = [];
  signedIn = READER;
  editors.length = 0;
  bundles = landed;
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  fakeAppBridge({
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
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  for (const sheet of document.head.querySelectorAll("style[data-laid-out]")) sheet.remove();
});

/** The window's side panel as the pages last drew it. */
let panelNow: SidePanelControl | undefined;

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
  const [peeked, setPeeked] = useState<string | undefined>(undefined);
  // The window's own side panel, which the peek stands in, beside no task.
  const sidePanel = useSidePanel(undefined, {
    id: undefined,
    holds: {},
    bare: true,
    drawsOwn: true,
  });
  panelNow = sidePanel;
  const control = tasksControl({ workspace });
  const tasks = tasksControl({
    workspace,
    me: signedIn,
    tasks: tasksListed,
    archived: tasksArchived,
    onNewTaskFrom: (from, agent) => newTasksFrom.push(agent === true ? { ...from, agent } : from),
    onSelect: (taskId) => tasksOpened.push(taskId),
    onOpenLink: (link) => linksOpened.push(link),
    repositories: { ...control.repositories, openGitHub: (url) => githubOpened.push(url) },
    sidePanel,
    issuesView: {
      ...control.issuesView,
      open: true,
      place,
      onOpen: (to = { kind: ISSUES_PAGE.LIST }) => {
        opened.push(to);
        setPlace(to);
      },
      onClose: () => (closed += 1),
      peeked,
      onPeek: setPeeked,
    },
  });
  return createElement(
    Fragment,
    null,
    createElement(IssuesPage, { tasks: tasks }),
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
  act(() =>
    root?.render(
      onRegistry(registry, onSideBundles(bundles, createElement(Pages, { workspace, start }))),
    ),
  );
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
      group.querySelector("h2")?.textContent ?? "",
      [...group.querySelectorAll("li")].map(
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

/** A ⌘-press on a card or row, which opens its issue's page rather than peeking it. */
function commandClick(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
    );
  });
}

/** ⌘Return on the element holding the keyboard, as the window hears it. */
function commandReturn(target: EventTarget = document.activeElement ?? document.body): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** The page opened on one issue from its card with ⌘ held, its own read answered. */
async function openIssue(issueId: string): Promise<HTMLElement> {
  const page = mount();
  await settle();
  const row = page.querySelector<HTMLButtonElement>(`[data-issue-id="${issueId}"] button`);
  assert.ok(row, `no row for ${issueId}`);
  commandClick(row);
  await settle();
  return page;
}

/** The issue's title as its page draws it. */
function titleOf(page: HTMLElement): string | undefined {
  return page.querySelector("[aria-label='Issue title']")?.textContent ?? undefined;
}

/** What the line under the issue's title says, a phrase at a time, each face left out. */
function bylineOf(page: HTMLElement): (string | undefined)[] {
  return [...page.querySelectorAll(".plan-byline .actor-line")].map(lineWords);
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
    (each) => each.querySelector(".luke-combobox-option-label")?.textContent === option,
  );
  assert.ok(row, `no ${option} in ${label}`);
  act(() => row.click());
}

/** The description as its page draws it at rest. */
function descriptionOf(page: HTMLElement): HTMLElement {
  const description = page.querySelector<HTMLElement>("[role=group][aria-label='Description']");
  assert.ok(description, "the description stands");
  return description;
}

/** The description's editor open now. */
function openEditor(): StandInEditor {
  const editor = editors.filter((each) => !each.destroyed).at(-1);
  assert.ok(editor, "the description's editor is open");
  return editor;
}

/** The description's editor, opened by a click into its words at the point given. */
function openDescription(page: HTMLElement, at = { x: 40, y: 12 }): StandInEditor {
  act(() => {
    descriptionOf(page).dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: at.x, clientY: at.y }),
    );
  });
  return openEditor();
}

/** Words typed into the editor, as it hands each change over. */
function type(editor: StandInEditor, words: string): void {
  act(() => {
    editor.text = words;
    editor.props.onDraft(words);
  });
}

/** Esc or ⌘↩ in the editor, which finishes it. */
function finish(editor: StandInEditor): void {
  act(() => editor.props.onFinish(0));
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
  commandClick(row);
  await settle();
  const title = page.querySelector<HTMLElement>("[aria-label='Issue title']");
  assert.ok(title);
  act(() => title.focus());
  press("c", title);
  const description = openDescription(page);
  press("c", description.element);

  assert.equal(document.querySelectorAll("[role=dialog]").length, 0, "no card opened while typing");
});

test("↓ and ⌘Return open the issue reached, read on its own page; Escape comes back to the list with its row holding the keyboard, and Escape again closes the page", async () => {
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
  commandReturn(reached);
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
  const picture = page.querySelector<HTMLImageElement>(".plan-byline .actor-mark img");
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

test("an issue's page opened before its issue is read, as a link opens it, stands the issue's page in blocks, said as reading, until the issue lands in their place", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = mount({ kind: ISSUES_PAGE.ISSUE, issueId: issue(1).id });
  const reading = page.querySelector('[role="status"]');
  const readingWords = reading?.textContent;
  const readingTitle = titleOf(page);
  await settle();

  assert.equal(readingWords, "Reading the issue");
  assert.ok(
    reading?.closest(".desktop-document .plan-document-scroll"),
    "the blocks stand in the issue's own document, in a plan's own column",
  );
  assert.equal(readingTitle, undefined);
  assert.equal(page.querySelector('[role="status"]'), null);
  assert.equal(titleOf(page), "Fix login");
});

test("an issue's description is drawn a section at a time, as a plan's text is, so its sections stand a plan's gap apart", async () => {
  standing = [
    issue(1, { description: "Fails on CI.\n\n## Steps\n\nRun it twice.\n\n## Fix\n\nRetry once." }),
  ];
  const page = await openIssue(issue(1).id);

  assert.deepEqual(
    [...descriptionOf(page).querySelectorAll(":scope > .plan-unit")].map(
      (unit) => unit.textContent,
    ),
    ["Fails on CI.", "Steps\nRun it twice.", "Fix\nRetry once."],
  );
  assert.ok(descriptionOf(page).classList.contains("document-sections"));
});

test("an issue's document stands in a plan's own scrolling column and body, its title, byline, and description together, as a plan's do", async () => {
  standing = [issue(1, { title: "Fix login", description: "Fails on CI." })];
  const page = await openIssue(issue(1).id);

  const body = page.querySelector(".desktop-document > .plan-document-scroll > .plan-body");
  assert.ok(body, "the issue's body stands where a plan's does");
  assert.equal(body.querySelector("[aria-label='Issue title']")?.textContent, "Fix login");
  assert.ok(body.querySelector(".plan-byline"), "the line under the title is a plan's");
  assert.equal(descriptionOf(page).closest(".plan-body"), body);
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

test("a click into the description opens the plan's editor in its place, the caret where the click landed, and leaving it sends what was typed and draws it as Markdown", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);

  const editor = openDescription(page, { x: 120, y: 48 });
  const opened = {
    markdown: editor.props.markdown,
    placement: editor.props.placement,
    placeholder: editor.props.placeholder,
    focused: document.activeElement === editor.element,
    masked: editor.element.closest(".ph-no-capture") !== null,
    resting: page.querySelector("[role=group][aria-label='Description']"),
  };
  type(editor, "## Plan\n\n- reproduce\n- fix");
  act(() => editor.element.blur());
  await settle();

  assert.deepEqual(opened, {
    markdown: "",
    placement: { x: 120, y: 48 },
    placeholder: "Add a description…",
    focused: true,
    masked: true,
    resting: null,
  });
  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { description: "## Plan\n\n- reproduce\n- fix" } },
  ]);
  assert.ok(editor.destroyed, "the editor closes once the save is kept");
  const drawn = descriptionOf(page);
  assert.equal(drawn.querySelector(".markdown-heading[data-level='2']")?.textContent, "Plan");
  assert.deepEqual(
    [...drawn.querySelectorAll("li")].map((item) => item.textContent),
    ["reproduce", "fix"],
  );
});

/**
 * The issue's page laid out as a window draws it: its document's column scrolls,
 * as its stylesheet says, and stands from 0 to 1000 across, and the
 * description's words from 100 to 800 across and 200 to 240 down. Laid out
 * before the page is drawn, as a window's stylesheet is.
 */
function layPageOut(): void {
  const sheet = document.createElement("style");
  sheet.dataset.laidOut = "";
  sheet.textContent = ".plan-document-scroll { overflow-y: auto; }";
  document.head.append(sheet);
  const wide = DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 900 });
  const words = DOMRect.fromRect({ x: 100, y: 200, width: 700, height: 40 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("plan-document-scroll") ? wide : words;
  });
}

/** The document's column, whose room is the description's way in. */
function columnOf(page: HTMLElement): HTMLElement {
  return (
    page.querySelector<HTMLElement>(".plan-document-scroll") ?? assert.fail("the document's column")
  );
}

/** A press on `target` at the point given, its button going down and coming up; answers whether the press was taken. */
function pressAt(target: Element, x: number, y: number): boolean {
  const down = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  act(() => {
    target.dispatchEvent(down);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
  });
  return down.defaultPrevented;
}

test("a press anywhere on the page's room under an empty description opens its editor at the end", async () => {
  standing = [issue(1)];
  layPageOut();
  const page = await openIssue(issue(1).id);
  const column = columnOf(page);

  const taken = pressAt(column, 400, 700);

  assert.ok(!taken, "a drag from the room still selects, as a press on a page does");
  assert.equal(openEditor().props.markdown, "");
  assert.deepEqual(openEditor().props.placement, PLACEMENT_END);
});

test("a press on the room beside the description opens it on the nearest line, and one above it, by the title, opens nothing", async () => {
  standing = [issue(1, { description: "Fails on CI." })];
  layPageOut();
  const page = await openIssue(issue(1).id);
  const column = columnOf(page);
  const body = page.querySelector(".plan-body") ?? assert.fail("the issue's body");

  const aboveTaken = pressAt(body, 400, 120);
  const openedAbove = editors.length;
  pressAt(column, 900, 220);

  assert.ok(!aboveTaken);
  assert.equal(openedAbove, 0, "a press above the description opens nothing");
  assert.deepEqual(
    openEditor().props.placement,
    { x: 799, y: 220 },
    "the nearest line, at the words' own edge",
  );
});

test("a press on the room while the description's editor loads is where the editor opens", async () => {
  standing = [issue(1, { description: "Fails on CI." })];
  const gate = Promise.withResolvers<PlanEditorModule>();
  bundles = sideBundles({ planEditor: () => gate.promise });
  layPageOut();
  const page = await openIssue(issue(1).id);
  const column = columnOf(page);

  pressAt(column, 400, 700);
  pressAt(column, 900, 220);
  await act(async () => {
    gate.resolve(EDITOR_STAND_IN);
    await gate.promise;
  });
  await settle();

  assert.deepEqual(openEditor().props.placement, { x: 799, y: 220 });
});

test("a press on the room while the description is open moves its caret to the end and keeps it open", async () => {
  standing = [issue(1, { description: "Fails on CI." })];
  layPageOut();
  const page = await openIssue(issue(1).id);
  const column = columnOf(page);
  const editor = openDescription(page);

  const taken = pressAt(column, 400, 700);
  await settle();

  assert.ok(taken, "the press keeps the keyboard in the editor");
  assert.deepEqual(editor.placed, [PLACEMENT_END]);
  assert.ok(!editor.destroyed);
  assert.deepEqual(changes, []);
});

test("Return on the description opens the editor with the caret at the end of its text", async () => {
  standing = [issue(1, { description: "Fails on CI.\n\n## Steps\n\nRun it twice." })];
  const page = await openIssue(issue(1).id);

  const description = descriptionOf(page);
  act(() => description.focus());
  press("Enter", description);

  assert.deepEqual(openEditor().props.placement, PLACEMENT_END);
  assert.equal(openEditor().props.markdown, "Fails on CI.\n\n## Steps\n\nRun it twice.");
});

test("Esc sends what was typed, leaving the issue's page standing, and gives the keyboard back to the description", async () => {
  standing = [issue(1, { description: "Fails on CI." })];
  const page = await openIssue(issue(1).id);

  const editor = openDescription(page);
  type(editor, "Fails on CI, twice.");
  finish(editor);
  await settle();

  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { description: "Fails on CI, twice." } },
  ]);
  assert.equal(descriptionOf(page).textContent, "Fails on CI, twice.");
  assert.equal(document.activeElement, descriptionOf(page));
  assert.equal(closed, 0);
  assert.deepEqual(opened, [{ kind: ISSUES_PAGE.ISSUE, issueId: issue(1).id }]);
});

test("a description left as it opened sends nothing and closes", async () => {
  standing = [issue(1, { description: "Fails on CI." })];
  const page = await openIssue(issue(1).id);

  const editor = openDescription(page);
  type(editor, "Fails on CI!");
  type(editor, "Fails on CI.");
  finish(editor);
  await settle();

  assert.deepEqual(changes, []);
  assert.ok(editor.destroyed);
  assert.equal(descriptionOf(page).textContent, "Fails on CI.");
});

test("a save the service refused keeps every word typed in the open editor and says so, with a Retry that sends them again", async () => {
  standing = [issue(1)];
  changeRefused = true;
  const page = await openIssue(issue(1).id);

  const editor = openDescription(page);
  type(editor, "Steps to reproduce");
  finish(editor);
  await settle();

  assert.ok(!editor.destroyed, "the editor stays open");
  assert.equal(editor.text, "Steps to reproduce");
  assert.match(page.textContent ?? "", /Couldn't save the description/u);

  changeRefused = false;
  act(() => button("Retry").click());
  await settle();

  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { description: "Steps to reproduce" } },
    { issueId: issue(1).id, change: { description: "Steps to reproduce" } },
  ]);
  assert.ok(editor.destroyed, "the editor closes once Retry's save is kept");
});

test("a description past its bound is not sent, and the open editor says why", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);

  const editor = openDescription(page);
  type(editor, "a".repeat(20_001));
  finish(editor);
  await settle();

  assert.deepEqual(changes, []);
  assert.ok(!editor.destroyed, "the editor stays open");
  assert.match(page.textContent ?? "", /Not saved: the description is too long/u);
});

test("a finish while a save is out waits for it, then sends the words typed meanwhile, and the editor closes once those are kept", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);
  heldChanges = [];
  const held = heldChanges;

  const editor = openDescription(page);
  type(editor, "First draft");
  finish(editor);
  await settle();
  type(editor, "First draft, and more");
  finish(editor);
  await settle();
  const sentWhileOut = changes.length;
  act(() => held[0]?.());
  await settle();
  const openBetween = !editor.destroyed;
  act(() => held[1]?.());
  await settle();

  assert.equal(sentWhileOut, 1, "nothing more is sent while the first save is out");
  assert.ok(openBetween, "the newer words keep the editor open");
  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { description: "First draft" } },
    { issueId: issue(1).id, change: { description: "First draft, and more" } },
  ]);
  assert.ok(editor.destroyed);
  assert.equal(descriptionOf(page).textContent, "First draft, and more");
});

test("words typed while a save is out are sent once it is kept, though the page left the issue meanwhile", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);
  heldChanges = [];
  const held = heldChanges;

  const editor = openDescription(page);
  type(editor, "First draft");
  finish(editor);
  await settle();
  type(editor, "First draft, plus details");
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });
  await settle();
  act(() => held[0]?.());
  await settle();
  act(() => held[1]?.());
  await settle();

  assert.equal(page.querySelector("[role=group][aria-label='Description']"), null);
  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { description: "First draft" } },
    { issueId: issue(1).id, change: { description: "First draft, plus details" } },
  ]);
});

test("words typed back to the description it opened on while a save is out are sent once it is kept, though the page left the issue", async () => {
  standing = [issue(1, { description: "Fails on CI." })];
  const page = await openIssue(issue(1).id);
  heldChanges = [];
  const held = heldChanges;

  const editor = openDescription(page);
  type(editor, "Fails on CI, twice.");
  finish(editor);
  await settle();
  type(editor, "Fails on CI.");
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });
  await settle();
  act(() => held[0]?.());
  await settle();
  act(() => held[1]?.());
  await settle();

  assert.equal(page.querySelector("[role=group][aria-label='Description']"), null);
  assert.deepEqual(changes, [
    { issueId: issue(1).id, change: { description: "Fails on CI, twice." } },
    { issueId: issue(1).id, change: { description: "Fails on CI." } },
  ]);
});

test("a description reopened on words a later change's answer drew, and left as it opened, sends nothing", async () => {
  standing = [issue(1, { description: "Original" })];
  const page = await openIssue(issue(1).id);
  heldChanges = [];
  const held = heldChanges;

  const editor = openDescription(page);
  type(editor, "Revised");
  finish(editor);
  await settle();
  // The service answers a status change made meanwhile from the issue as it stood before the description landed.
  standing = [issue(1, { description: "Original" })];
  pick(page, "Status", "Todo");
  await settle();
  act(() => held[0]?.());
  await settle();
  act(() => held[1]?.());
  await settle();
  const shown = descriptionOf(page).textContent;
  finish(openDescription(page));
  await settle();

  assert.equal(shown, "Original");
  assert.equal(changes.length, 2, "reopening and leaving the words as they opened sends nothing");
});

test("a control pressed while a finished save is out keeps the keyboard once the save closes the editor", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);
  heldChanges = [];
  const held = heldChanges;

  const editor = openDescription(page);
  type(editor, "Steps");
  finish(editor);
  await settle();
  const title = page.querySelector<HTMLElement>("[aria-label='Issue title']");
  assert.ok(title);
  act(() => title.focus());
  act(() => held[0]?.());
  await settle();

  assert.ok(editor.destroyed);
  assert.equal(document.activeElement, title);
});

test("focus leaving the description before its editor has loaded opens nothing", async () => {
  standing = [issue(1, { description: "Fails on CI." })];
  bundles = unlandedBundles();
  const page = await openIssue(issue(1).id);

  const description = descriptionOf(page);
  act(() => description.focus());
  act(() => description.click());
  const busy = description.closest("[aria-busy='true']") !== null;
  const title = page.querySelector<HTMLElement>("[aria-label='Issue title']");
  assert.ok(title);
  act(() => title.focus());

  assert.ok(busy, "the description waits on its editor, keeping its words");
  assert.equal(descriptionOf(page), description, "the words pressed are the ones drawn");
  assert.equal(page.querySelector("[aria-busy='true']"), null);
  assert.equal(document.activeElement, title);
});

test("words typed in the description are sent as the page leaves the issue with its editor open", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);

  const editor = openDescription(page);
  type(editor, "Half a thought");
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });
  await settle();

  assert.equal(page.querySelector("[role=group][aria-label='Description']"), null);
  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { description: "Half a thought" } }]);
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

test("on the board ↓ and ↑ move down a column, ← and → to the nearest card of the next column holding any, and ⌘Return opens the card reached on its page", async () => {
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
  commandReturn(card);
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
 * side by side from the page's scroll's start, in that scroll 700px wide,
 * which scrolls sideways. jsdom lays nothing out and reads no stylesheet,
 * so this answers the geometry and the overflow the browser would. Answers
 * the page's sideways scroll as it stands.
 */
function layBoardOut(): () => number {
  const COLUMN = 300;
  const scrolled = new WeakMap<Element, number>();
  const SCROLL = ".luke-collection-page-scroll";
  const scroller = () => document.querySelector<HTMLElement>(SCROLL);
  const computed = globalThis.getComputedStyle;
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo);
    if (element.matches(SCROLL)) style.overflowX = "auto";
    return style;
  });
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
    return this.matches(SCROLL) ? 700 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches("[data-issue-column]") ? COLUMN : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const columns = [...document.querySelectorAll("[data-issue-column]")];
    const at = columns.indexOf(this);
    const shift = scrolled.get(scroller() ?? this) ?? 0;
    if (this.matches(".issue-board")) return new DOMRect(-shift, 0, columns.length * COLUMN, 0);
    const left = at < 0 ? 0 : at * COLUMN - shift;
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
  commandReturn(card);
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
  const row = listRowOf(page, issue(1));
  commandClick(row);
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

test("while the issues are read the list stands rows of blocks and the board a column of blocks for every status, each said as reading", async () => {
  standing = [issue(1)];
  window.localStorage.setItem("luke.issuesLayout", JSON.stringify("list"));
  const list = mount();
  const reading = list.querySelector('[role="status"]')?.textContent;
  await settle();
  const read = list.querySelector('[role="status"]');
  const listedGroups = groups(list);
  act(() => root?.unmount());

  window.localStorage.setItem("luke.issuesLayout", JSON.stringify("board"));
  const board = mount();
  const boardReading = board.querySelector('[role="status"]');
  const readingColumns = boardReading?.querySelectorAll(".issue-column").length;
  const readingCards = boardReading?.querySelectorAll("[data-issue-id]").length;
  await settle();

  assert.equal(reading, "Reading issues");
  assert.equal(read, null);
  assert.deepEqual(listedGroups, [["Backlog1", ["ACME-1 Issue 1"]]]);
  assert.equal(boardReading?.textContent, "Reading issues");
  assert.equal(readingColumns, 5, "a column for every status stands while the board is read");
  assert.equal(readingCards, 0, "no issue's card stands before the issues are read");
  assert.equal(board.querySelector('[role="status"]'), null);
  assert.deepEqual(columns(board)[0], ["Backlog1", ["ACME-1"]]);
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

/** The empty workspace's own New issue, under its line. */
function emptyStateNewIssue(page: HTMLElement): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>(".luke-empty-state button");
}

test("a workspace with no issue yet says so on the board and in the list, its New issue opening the card, and the first issue filed stands the board's columns", async () => {
  const page = mount();
  await settle();
  const boardSays = page.querySelector(".luke-empty-state")?.textContent;
  const boardColumns = columns(page).length;
  showList();
  const listSays = page.querySelector(".luke-empty-state")?.textContent;
  act(() => button("View options").click());
  act(() => menuItem("Board").click());

  const newIssue = emptyStateNewIssue(page);
  assert.ok(newIssue, "the empty state offers New issue");
  act(() => newIssue.click());
  const field = composerField();
  assert.ok(field, "the empty state's New issue opens the card");
  const whileOpen = emptyStateNewIssue(page)?.disabled;
  typeInto(field, "First issue");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();

  assert.equal(boardSays, "No issues yetNew issue");
  assert.equal(boardColumns, 0, "no empty column stands on an empty workspace's board");
  assert.equal(listSays, "No issues yetNew issue");
  assert.equal(
    whileOpen,
    true,
    "New issue is unavailable while the card stands, as the toolbar's is",
  );
  assert.equal(page.querySelector(".luke-empty-state"), null);
  assert.deepEqual(columns(page), [
    ["Backlog1", ["ACME-1"]],
    ["Todo", []],
    ["In progress", []],
    ["Done", []],
    ["Canceled", []],
  ]);
});

test("once the page has come back from an issue, a layout chosen keeps the keyboard on View options rather than that issue's row", async () => {
  standing = [issue(1)];
  const page = await openIssue(issue(1).id);
  act(() => button("Issues").click());
  await settle();

  showList();
  await settle();

  assert.ok(page.querySelector(".home-section"), "the list stands");
  assert.doesNotMatch(document.activeElement?.textContent ?? "", /ACME-1/u);
});

test("a column's + opens the new issue's card with that column's status chosen, the priority at its default, and the title holding the keyboard", async () => {
  standing = [issue(1)];
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

/** The press of the list's row for the issue given, found by the identifier it reads. */
function listRowOf(page: HTMLElement, listed: Issue): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>(".home-section button")].find((each) =>
    each.textContent?.startsWith(`ACME-${listed.number}`),
  );
  assert.ok(found, `no row for ACME-${listed.number}`);
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

  const row = listRowOf(page, issue(1));
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

test("a list row's right-click opens its menu, and Escape hands the keyboard back to the row", async () => {
  standing = [issue(1), issue(2)];
  const page = mount();
  await settle();
  showList();

  const row = listRowOf(page, issue(2));
  rightClick(row);
  assert.ok(menuItem("Status"));
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  await settle();

  assert.equal(document.querySelector("[role=menu]"), null);
  assert.ok(document.activeElement === row, "the row holds the keyboard");
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

test("a list row moved by a status picked from its menu keeps the keyboard under its new heading", async () => {
  standing = [issue(1), issue(2)];
  const page = mount();
  await settle();
  showList();

  const row = listRowOf(page, issue(1));
  act(() => row.focus());
  act(() => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
  });
  pickFrom("Status", "Done");
  await settle();

  const holding = document.activeElement;
  assert.ok(holding instanceof HTMLButtonElement, "a row holds the keyboard");
  assert.match(holding.textContent ?? "", /^ACME-1/u);
  assert.equal(holding.closest("section")?.getAttribute("aria-label"), "Done");
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

/**
 * The board laid out for a drag: each column 300px wide and 600px tall, side
 * by side from the window's left, each card 40px tall, 50px apart, from
 * 40px down its column. jsdom lays nothing out and captures no pointer, so
 * this answers the geometry and the capture the browser would.
 */
function layCardsOut(page: HTMLElement): void {
  const COLUMN = 300;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const columns = [...document.querySelectorAll("[data-issue-column]")];
    if (this.matches(".issue-board")) return new DOMRect(0, 0, columns.length * COLUMN, 600);
    const at = columns.indexOf(this);
    if (at >= 0) return new DOMRect(at * COLUMN, 0, COLUMN, 600);
    const column = columns.indexOf(this.closest("[data-issue-column]") ?? this);
    if (!this.matches("li[data-issue-id]") || column < 0) return new DOMRect();
    const row = [...(this.parentElement?.children ?? [])].indexOf(this);
    return new DOMRect(column * COLUMN + 8, 40 + row * 50, COLUMN - 16, 40);
  });
  for (const list of page.querySelectorAll(".issue-column-cards")) {
    Object.assign(list, { setPointerCapture: () => undefined });
  }
}

/** A pointer event at a point in the window, as the primary button makes one. */
function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 });
}

/** What the board showed with a dragged card held over a point: the column marked as where it lands, and whether a copy of it was carried. */
interface HeldDrag {
  marked: string | undefined;
  carried: boolean;
}

/**
 * Presses a card, drags it to a point, and lets it go there, answering
 * what the board showed with the pointer held there: the column marked as
 * the one it would land in, and whether a copy of the card was carried.
 */
function dragCard(page: HTMLElement, issueId: string, to: { x: number; y: number }): HeldDrag {
  const card = cardOf(page, issueId);
  const box = card.closest("li")?.getBoundingClientRect() ?? assert.fail("the card stands");
  const from = { x: box.x + 20, y: box.y + 20 };
  let held: HeldDrag = { marked: undefined, carried: false };
  act(() => {
    card.dispatchEvent(pointer("pointerdown", from.x, from.y));
    window.dispatchEvent(pointer("pointermove", from.x + 10, from.y));
    window.dispatchEvent(pointer("pointermove", to.x, to.y));
    held = {
      marked:
        page.querySelector<HTMLElement>("[data-drop-target='true']")?.dataset.issueColumn ??
        undefined,
      carried: document.querySelector("[data-carried] .issue-board .sidebar-task-item") !== null,
    };
    window.dispatchEvent(pointer("pointerup", to.x, to.y));
  });
  return held;
}

test("a Todo card dragged onto Done is carried there, Done marked as where it lands, and it is sent done and lands in Done", async () => {
  standing = [issue(1, { status: ISSUE_STATUS.TODO }), issue(2, { status: ISSUE_STATUS.TODO })];
  const page = mount();
  await settle();
  layCardsOut(page);

  const held = dragCard(page, issue(1).id, { x: 1000, y: 120 });
  await settle();

  assert.deepEqual(held, { marked: ISSUE_STATUS.DONE, carried: true });
  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { status: ISSUE_STATUS.DONE } }]);
  assert.deepEqual(columns(page), [
    ["Backlog", []],
    ["Todo1", ["ACME-2"]],
    ["In progress", []],
    ["Done1", ["ACME-1"]],
    ["Canceled", []],
  ]);
  assert.equal(
    document.querySelectorAll("[data-carried], [data-dragging], [data-drop-target]").length,
    0,
  );
  assert.deepEqual(opened, [], "the drop opens nothing");
});

test("a card let go over its own column sends nothing, and a ⌘-press that does not move still opens its page", async () => {
  standing = [issue(1, { status: ISSUE_STATUS.TODO }), issue(2, { status: ISSUE_STATUS.TODO })];
  const page = mount();
  await settle();
  layCardsOut(page);

  const held = dragCard(page, issue(1).id, { x: 450, y: 400 });
  await settle();
  const card = cardOf(page, issue(1).id);
  act(() => {
    card.dispatchEvent(pointer("pointerdown", 350, 60));
    window.dispatchEvent(pointer("pointerup", 350, 60));
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
  });
  await settle();

  assert.deepEqual(held, { marked: undefined, carried: true });
  assert.deepEqual(changes, []);
  assert.deepEqual(opened, [{ kind: ISSUES_PAGE.ISSUE, issueId: issue(1).id }]);
});

test("a card dragged onto Done whose change the service refused stays in Todo and says so", async () => {
  standing = [issue(1, { status: ISSUE_STATUS.TODO })];
  changeRefused = true;
  const page = mount();
  await settle();
  layCardsOut(page);

  dragCard(page, issue(1).id, { x: 1000, y: 120 });
  await settle();

  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { status: ISSUE_STATUS.DONE } }]);
  assert.deepEqual(columns(page)[1], ["Todo1", ["ACME-1"]]);
  assert.deepEqual(columns(page)[3], ["Done", []]);
  assert.match(document.body.textContent ?? "", /Couldn't change the issue\. Try again\./u);
});

test("a card is sent the status of the column it is let go over, though the last move reported another", async () => {
  standing = [issue(1, { status: ISSUE_STATUS.TODO })];
  const page = mount();
  await settle();
  layCardsOut(page);

  const card = cardOf(page, issue(1).id);
  act(() => {
    card.dispatchEvent(pointer("pointerdown", 350, 60));
    window.dispatchEvent(pointer("pointermove", 750, 120));
    window.dispatchEvent(pointer("pointerup", 1000, 120));
  });
  await settle();

  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { status: ISSUE_STATUS.DONE } }]);
  assert.deepEqual(columns(page)[3], ["Done1", ["ACME-1"]]);
});

/** A task of the listed workspace, started from the issue given where one is. */
function task(id: string, name: string, issueId?: string, createdAt = 1): TaskSummary {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name,
    createdAt,
    updatedAt: createdAt,
    repository: null,
    ...(issueId === undefined ? undefined : { issueId }),
  };
}

/** The tasks the issue's page lists as started from it, by name, in order; none where it draws no row. */
function workOf(page: HTMLElement): string[] | undefined {
  const row = page.querySelector(".issue-work");
  if (row === null) return undefined;
  return [...row.querySelectorAll("button")].map((each) => each.textContent ?? "");
}

test("an issue's ⋯ offers Start task…, which opens New task on the issue by its identifier and title, in its workspace", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2)];
  await openIssue(issue(1).id);

  act(() => button("Issue actions").click());
  act(() => menuItem("Start task…").click());

  assert.deepEqual(newTasksFrom, [
    { id: issue(1).id, workspaceId: WORKSPACE.id, identifier: "ACME-1", title: "Fix login" },
  ]);
  assert.deepEqual(changes, []);
});

test("a card's menu offers Start task… for its own issue", async () => {
  standing = [issue(1), issue(2, { title: "Fix logout" })];
  const page = mount();
  await settle();

  rightClick(cardOf(page, issue(2).id));
  act(() => menuItem("Start task…").click());

  assert.deepEqual(newTasksFrom, [
    { id: issue(2).id, workspaceId: WORKSPACE.id, identifier: "ACME-2", title: "Fix logout" },
  ]);
});

test("an issue's page lists the tasks started from it, and none of another issue's, each opening its task", async () => {
  standing = [issue(1), issue(2)];
  tasksListed = [
    task("task-newer", "Fix login, again", issue(1).id, 2),
    task("task-other", "Fix logout", issue(2).id, 2),
    task("task-plain", "Tidy", undefined, 2),
    task("task-older", "Fix login", issue(1).id, 1),
  ];
  const page = await openIssue(issue(1).id);

  assert.deepEqual(workOf(page), ["Fix login, again", "Fix login"]);
  act(() => button("Open Fix login").click());
  assert.deepEqual(tasksOpened, ["task-older"]);
});

test("an issue no task was started from draws no row of tasks", async () => {
  standing = [issue(1), issue(2)];
  tasksListed = [task("task-other", "Fix logout", issue(2).id), task("task-plain", "Tidy")];
  const page = await openIssue(issue(1).id);

  assert.equal(workOf(page), undefined);
});

test("an issue's page lists its archived tasks too, and its tasks newest started first whatever the sidebar's pins put first", async () => {
  standing = [issue(1)];
  // The sidebar's order: a pinned task, the oldest, ahead of a newer one.
  tasksListed = [
    { ...task("task-pinned", "First try", issue(1).id, 1), pinnedAt: 5 },
    task("task-newest", "Third try", issue(1).id, 3),
  ];
  tasksArchived = [{ ...task("task-archived", "Second try", issue(1).id, 2), archivedAt: 4 }];
  const page = await openIssue(issue(1).id);

  assert.deepEqual(workOf(page), ["Third try", "Second try", "First try"]);
});

/** The item whose label, its glyph and any detail left out, is `name`, of the newest menu standing open that holds one: a submenu before the menu it hangs from. */
function labelledItem(name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="menu"]:not([data-leaving]) .luke-menu-item-label',
    ),
  ].findLast((each) => each.textContent === name);
  const item = found?.closest<HTMLButtonElement>("button");
  assert.ok(item, `no menu item labelled ${name}`);
  return item;
}

/** One choice of View options taken: the submenu named opened, where one is, and the choice in it. */
function chooseView(choice: string, submenu?: string): void {
  act(() => button("View options").click());
  if (submenu !== undefined) act(() => labelledItem(submenu).click());
  act(() => labelledItem(choice).click());
}

/** Whether View options says the page is filtered. */
function saysFiltered(page: HTMLElement): boolean {
  const options = page.querySelector(".issues-view-options");
  return (
    options?.getAttribute("data-filtered") === "true" &&
    button("View options").getAttribute("aria-description") === "Filtered"
  );
}

test("a priority chosen in View options leaves the others off the board and the list, says the page is filtered, and stands when the page opens again", async () => {
  standing = [
    issue(1, { priority: ISSUE_PRIORITY.URGENT }),
    issue(2, { priority: ISSUE_PRIORITY.LOW }),
    issue(3, { priority: ISSUE_PRIORITY.NONE, status: ISSUE_STATUS.TODO }),
  ];
  const page = mount();
  await settle();
  const filteredAtFirst = saysFiltered(page);

  chooseView("Urgent", "Priority");
  const board = groups(page);
  const filtered = saysFiltered(page);
  showList();
  const list = groups(page);
  act(() => root?.unmount());
  const reopened = mount();
  await settle();

  assert.equal(filteredAtFirst, false);
  assert.deepEqual(board, [["Backlog1", ["ACME-1 Issue 1"]]]);
  assert.ok(filtered, "View options says a filter is on");
  assert.deepEqual(list, [["Backlog1", ["ACME-1 Issue 1"]]]);
  assert.deepEqual(groups(reopened), [["Backlog1", ["ACME-1 Issue 1"]]], "the filter is kept");
  assert.ok(saysFiltered(reopened));
});

test("Created by Me in View options shows only the issues the reader filed", async () => {
  standing = [
    issue(1, { creator: { userId: "user-ada", name: "Ada Lovelace" } }),
    issue(2, { creator: { userId: READER, name: "Grace Hopper" } }),
    issue(3, { creator: null }),
  ];
  const page = mount();
  await settle();

  chooseView("Me", "Created by");
  const mine = groups(page);
  chooseView("Ada Lovelace", "Created by");
  const ada = groups(page);
  chooseView("Anyone", "Created by");

  assert.deepEqual(mine, [["Backlog1", ["ACME-2 Issue 2"]]]);
  assert.deepEqual(ada, [["Backlog1", ["ACME-1 Issue 1"]]]);
  assert.deepEqual(groups(page), [
    ["Backlog3", ["ACME-3 Issue 3", "ACME-2 Issue 2", "ACME-1 Issue 1"]],
  ]);
  assert.equal(saysFiltered(page), false);
});

test("a Done or Canceled issue last changed over a week ago is left off the board and the list at first while a recent one stands, and Show completed brings it back", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  standing = [
    issue(1, { status: ISSUE_STATUS.DONE, updatedAt: NOW - 8 * DAY }),
    issue(2, { status: ISSUE_STATUS.DONE, updatedAt: NOW - DAY }),
    issue(3, { status: ISSUE_STATUS.CANCELED, updatedAt: NOW - 30 * DAY }),
    issue(4, { status: ISSUE_STATUS.BACKLOG, updatedAt: NOW - 30 * DAY }),
  ];
  const page = mount();
  await settle();
  const atFirst = columns(page);
  const filteredAtFirst = saysFiltered(page);
  showList();
  const listedAtFirst = groups(page);

  chooseView("Show completed");
  const listed = groups(page);
  act(() => button("View options").click());
  act(() => labelledItem("Board").click());

  assert.deepEqual(atFirst.slice(3), [
    ["Done1", ["ACME-2"]],
    ["Canceled", []],
  ]);
  assert.deepEqual(atFirst[0], ["Backlog1", ["ACME-4"]], "open work stands however old");
  assert.equal(filteredAtFirst, false, "the first filter is no change to say");
  assert.deepEqual(listedAtFirst, [
    ["Backlog1", ["ACME-4 Issue 4"]],
    ["Done1", ["ACME-2 Issue 2"]],
  ]);
  assert.deepEqual(listed, [
    ["Backlog1", ["ACME-4 Issue 4"]],
    ["Done2", ["ACME-2 Issue 2", "ACME-1 Issue 1"]],
    ["Canceled1", ["ACME-3 Issue 3"]],
  ]);
  assert.deepEqual(columns(page).slice(3), [
    ["Done2", ["ACME-2", "ACME-1"]],
    ["Canceled1", ["ACME-3"]],
  ]);
  assert.ok(saysFiltered(page));
});

test("where every issue is settled and gone quiet, the page says none matches and Clear filters shows them", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  standing = [issue(1, { status: ISSUE_STATUS.DONE, updatedAt: NOW - 30 * DAY })];
  const page = mount();
  await settle();
  const said = page.querySelector(".luke-empty-state")?.textContent;

  act(() => button("Clear filters").click());

  assert.equal(said, "No issues matchClear filters");
  assert.deepEqual(groups(page), [["Done1", ["ACME-1 Issue 1"]]]);
});

test("a filter that keeps none of the workspace's issues says no issue matches, and Clear filters shows every issue again", async () => {
  standing = [issue(1), issue(2, { status: ISSUE_STATUS.TODO })];
  const page = mount();
  await settle();

  chooseView("Urgent", "Priority");
  const said = page.querySelector(".luke-empty-state")?.textContent;
  const columnsWhileNone = page.querySelectorAll("[data-issue-column]").length;
  act(() => button("Clear filters").click());

  assert.equal(said, "No issues matchClear filters");
  assert.equal(columnsWhileNone, 0, "the board's columns step aside for the line");
  assert.deepEqual(groups(page), [
    ["Backlog1", ["ACME-1 Issue 1"]],
    ["Todo1", ["ACME-2 Issue 2"]],
  ]);
  assert.equal(saysFiltered(page), false);
});

test("a filter one account chose is not the filter of another account signed in on this Mac", async () => {
  standing = [
    issue(1, { creator: { userId: "user-ada", name: "Ada Lovelace" } }),
    issue(2, { creator: { userId: READER, name: "Grace Hopper" } }),
  ];
  mount();
  await settle();
  chooseView("Me", "Created by");
  act(() => root?.unmount());

  signedIn = "user-ada";
  const other = mount();
  await settle();

  assert.deepEqual(groups(other), [["Backlog2", ["ACME-2 Issue 2", "ACME-1 Issue 1"]]]);
  assert.equal(saysFiltered(other), false);
});

test("Group by Priority in the List's View options heads its issues by priority, the most pressing first, stands when the page opens again, and Status heads them by status again", async () => {
  standing = [
    issue(1, { priority: ISSUE_PRIORITY.LOW, status: ISSUE_STATUS.TODO }),
    issue(2, { priority: ISSUE_PRIORITY.URGENT }),
    issue(3, { priority: ISSUE_PRIORITY.LOW, status: ISSUE_STATUS.IN_PROGRESS }),
  ];
  const page = mount();
  await settle();
  act(() => button("View options").click());
  const offeredOnBoard = [...document.querySelectorAll(".luke-menu-item-label")].some(
    (label) => label.textContent === "Group by",
  );
  act(() => button("View options").click());
  await settle();
  showList();

  chooseView("Priority", "Group by");
  const byPriority = groups(page);
  act(() => root?.unmount());
  const reopened = mount();
  await settle();
  const keptByPriority = groups(reopened);
  chooseView("Status", "Group by");

  assert.equal(
    offeredOnBoard,
    false,
    "the board's columns are its statuses, so it offers no grouping",
  );
  assert.deepEqual(byPriority, [
    ["Urgent1", ["ACME-2 Issue 2"]],
    ["Low2", ["ACME-3 Issue 3", "ACME-1 Issue 1"]],
  ]);
  assert.deepEqual(keptByPriority, byPriority);
  assert.deepEqual(groups(reopened), [
    ["In progress1", ["ACME-3 Issue 3"]],
    ["Todo1", ["ACME-1 Issue 1"]],
    ["Backlog1", ["ACME-2 Issue 2"]],
  ]);
});

/** What the window's Issues page measures across: room for the peek beside a column of the board, or too little. */
const ROOMY = 1280;
const CRAMPED = 500;

/** The Issues page laid out `width` wide, as the window lays it; jsdom lays nothing out. */
function layPagesAt(width: number): void {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.matches(".issues-pages") ? width : 0;
  });
}

/** The peek standing beside the board or list, if one does. */
function peekOf(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>(".side-panel:not([data-leaving]) .side-panel-content");
}

/** What a peek reads: its issue's title, and the identifiers of the cards or rows marked as the one it reads. */
interface Peeking {
  readonly title: string | undefined;
  readonly marked: readonly string[];
}

/** The issue the peek reads, by its title, and the card or row marked as the one it reads. */
function peeking(page: HTMLElement): Peeking {
  const peek = peekOf(page);
  return {
    title: peek?.querySelector("[aria-label='Issue title']")?.textContent ?? undefined,
    marked: [...page.querySelectorAll("[aria-current='true']")].map(
      (marked) =>
        marked.querySelector(".issue-row-identifier")?.textContent ??
        marked.closest("li")?.querySelector(".issue-row-identifier")?.textContent ??
        "",
    ),
  };
}

test("a press on a card peeks its issue beside the board, which stands, its card marked, reading nothing of its own", async () => {
  standing = [
    issue(1, { status: ISSUE_STATUS.TODO, title: "Fix login" }),
    issue(2, { status: ISSUE_STATUS.DONE }),
  ];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  act(() => cardOf(page, issue(1).id).click());
  await settle();

  assert.deepEqual(peeking(page), { title: "Fix login", marked: ["ACME-1"] });
  assert.equal(picked(peekOf(page) ?? page, "Status"), "Todo");
  assert.ok(page.querySelector("[data-issue-column]"), "the board still stands");
  assert.deepEqual(opened, [], "no page is opened in the board's place");
  assert.deepEqual(reads, [], "the peek draws the issue the list holds");
});

test("while a peek stands the arrows move through the cards and the peek follows, reading nothing; Escape puts it away with the card still holding the keyboard, and Escape again leaves the page", async () => {
  standing = [
    issue(1, { status: ISSUE_STATUS.TODO, title: "Fix login" }),
    issue(2, { status: ISSUE_STATUS.TODO, title: "Fix logout" }),
    issue(3, { status: ISSUE_STATUS.DONE, title: "Ship it" }),
  ];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  press("ArrowDown", window);
  const reached = document.activeElement;
  assert.ok(reached instanceof HTMLButtonElement, "a card holds the keyboard");
  act(() => reached.click());
  await settle();
  const first = peeking(page);
  press("ArrowDown");
  const down = peeking(page);
  press("ArrowRight");
  const across = peeking(page);
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });
  await settle();
  const keyboard = document.activeElement
    ?.closest("[data-issue-id]")
    ?.getAttribute("data-issue-id");
  const afterEscape = peekOf(page);
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });

  assert.deepEqual(
    [first, down, across],
    [
      { title: "Fix logout", marked: ["ACME-2"] },
      { title: "Fix login", marked: ["ACME-1"] },
      { title: "Ship it", marked: ["ACME-3"] },
    ],
  );
  assert.deepEqual(reads, [], "moving the peek reads nothing");
  assert.ok(afterEscape === null, "Escape put the peek away");
  assert.equal(keyboard, issue(3).id);
  assert.deepEqual(opened, []);
  assert.equal(closed, 1, "the second Escape leaves the Issues page");
});

test("the tab's × puts the peek away and hands the keyboard back to its card", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  act(() => cardOf(page, issue(1).id).click());
  await settle();
  const close = page.querySelector<HTMLButtonElement>(
    ".side-panel button[aria-label='Close ACME-1']",
  );
  assert.ok(close, "the peek's tab offers its ×");
  act(() => close.focus());
  act(() => close.click());
  await settle();

  assert.ok(peekOf(page) === null);
  assert.ok(document.activeElement === cardOf(page, issue(1).id), "its card holds the keyboard");
  assert.equal(closed, 0);
});

test("⌘-press and ⌘Return on a card, and Open as page from the peek, open the issue's own page in the board's place", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2, { title: "Fix logout" })];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  commandClick(cardOf(page, issue(1).id));
  await settle();
  act(() => button("Issues").click());
  await settle();
  act(() => cardOf(page, issue(2).id).focus());
  commandReturn();
  await settle();
  act(() => button("Issues").click());
  await settle();
  act(() => cardOf(page, issue(1).id).click());
  await settle();
  act(() => button("Issue actions").click());
  act(() => menuItem("Open as page").click());
  await settle();

  assert.deepEqual(opened, [
    { kind: ISSUES_PAGE.ISSUE, issueId: issue(1).id },
    { kind: ISSUES_PAGE.LIST },
    { kind: ISSUES_PAGE.ISSUE, issueId: issue(2).id },
    { kind: ISSUES_PAGE.LIST },
    { kind: ISSUES_PAGE.ISSUE, issueId: issue(1).id },
  ]);
  assert.equal(titleOf(page), "Fix login");
  assert.ok(peekOf(page) === null, "the page stands alone, no peek beside it");
});

test("in a window with no room for the peek beside a column, a press opens the issue's page as it did before there was a peek", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = mount();
  await settle();
  layPagesAt(CRAMPED);

  act(() => cardOf(page, issue(1).id).click());
  await settle();

  assert.deepEqual(opened, [{ kind: ISSUES_PAGE.ISSUE, issueId: issue(1).id }]);
  assert.ok(peekOf(page) === null);
  assert.equal(titleOf(page), "Fix login");
});

test("a status picked in the peek is sent through the list, whose card moves to its new column while the peek goes on reading it", async () => {
  standing = [issue(1, { status: ISSUE_STATUS.TODO, title: "Fix login" })];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  act(() => cardOf(page, issue(1).id).click());
  await settle();
  pick(peekOf(page) ?? page, "Status", "Done");
  await settle();

  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { status: ISSUE_STATUS.DONE } }]);
  assert.deepEqual(columns(page)[3], ["Done1", ["ACME-1"]]);
  assert.deepEqual(peeking(page), { title: "Fix login", marked: ["ACME-1"] });
  assert.equal(picked(peekOf(page) ?? page, "Status"), "Done");
});

test("an issue archived from the peek's menu leaves the board, and the peek with it", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2)];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  act(() => cardOf(page, issue(1).id).click());
  await settle();
  act(() => button("Issue actions").click());
  act(() => menuItem("Archive").click());
  act(() => dialogButton("Archive").click());
  await settle();

  assert.deepEqual(changes, [{ issueId: issue(1).id, change: { archived: true } }]);
  assert.ok(peekOf(page) === null);
  assert.deepEqual(columns(page)[0], ["Backlog1", ["ACME-2"]]);
  assert.deepEqual(opened, []);
});

test("in the list, a press on a row peeks its issue beside the list, the row current", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = mount();
  await settle();
  showList();
  layPagesAt(ROOMY);

  act(() => listRowOf(page, issue(1)).click());
  await settle();

  assert.equal(peeking(page).title, "Fix login");
  assert.equal(listRowOf(page, issue(1)).getAttribute("aria-current"), "true");
  assert.ok(page.querySelector(".home-section"), "the list still stands");
  assert.deepEqual(opened, []);
});

test("a peek the window narrows past its room beside a column is put away, its card holding the keyboard", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = mount();
  await settle();
  let width = ROOMY;
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.matches(".issues-pages") ? width : 0;
  });

  act(() => cardOf(page, issue(1).id).click());
  await settle();
  const opened_ = peeking(page).title;
  width = CRAMPED;
  act(() => relayout());

  assert.equal(opened_, "Fix login");
  assert.ok(peekOf(page) === null, "the narrowed window put the peek away");
  assert.ok(document.activeElement === cardOf(page, issue(1).id), "its card holds the keyboard");
  assert.deepEqual(opened, []);
});

test("Archive's question asked in a peek goes with the peek as it slides out, and another workspace listed opens no peek of the last", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);
  const motions = playMotions();
  try {
    act(() => cardOf(page, issue(1).id).click());
    await settle();
    act(() => button("Issue actions").click());
    act(() => menuItem("Archive").click());
    const asked = document.querySelector("[role=alertdialog], [role=dialog]") !== null;

    list({ ...WORKSPACE, id: "workspace-initech", name: "Initech" });
    await settle();

    assert.ok(asked, "Archive asked first");
    assert.ok(page.querySelector(".side-panel[data-leaving]"), "the peek is still sliding out");
    assert.ok(
      document.querySelector("[role=alertdialog], [role=dialog]") === null,
      "its question went with it",
    );
    assert.ok(peekOf(page) === null, "Initech's list, though it holds the issue, opens no peek");
  } finally {
    motions.remove();
  }
});

test("as the peek opens and closes, the board's columns glide from where they stood rather than jump", async () => {
  standing = [issue(1, { status: ISSUE_STATUS.TODO }), issue(2, { status: ISSUE_STATUS.DONE })];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);
  // Note that each column stands narrower once the peek has taken its room, so every column but the first moves left.
  const COLUMN = { WIDE: 250, NARROW: 170 };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const columns = [...document.querySelectorAll("[data-issue-column]")];
    const at = columns.indexOf(this);
    const narrowed = document.querySelector(".side-panel:not([data-leaving])") !== null;
    const width = narrowed ? COLUMN.NARROW : COLUMN.WIDE;
    return new DOMRect(at < 0 ? 0 : at * width, 0, at < 0 ? 0 : width, 0);
  });
  const motions = playMotions();
  try {
    act(() => cardOf(page, issue(1).id).click());
    await settle();
    const glides = () =>
      motions.played
        .filter((each) => each.element.matches("[data-issue-column]"))
        .map((each) => each.keyframes[0]?.transform);
    const opening = glides();
    motions.played.length = 0;
    act(() => {
      runAppCommand(APP_COMMAND.EXIT_ISSUES);
    });
    const closing = glides();

    // Note that the first column stands where it stood, so it plays nothing.
    assert.deepEqual(
      opening,
      [80, 160, 240, 320].map((dx) => `translateX(${dx}px)`),
    );
    assert.deepEqual(
      closing,
      [-80, -160, -240, -320].map((dx) => `translateX(${dx}px)`),
    );
  } finally {
    motions.remove();
  }
});

test("the peek lists the tasks started from its issue and offers Start task… from its ⋯, as the issue's page does", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2)];
  tasksListed = [
    task("task-mine", "Fix login", issue(1).id, 2),
    task("task-other", "Fix logout", issue(2).id, 2),
  ];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  act(() => cardOf(page, issue(1).id).click());
  await settle();
  const listedInPeek = workOf(peekOf(page) ?? page);
  act(() => button("Issue actions").click());
  act(() => menuItem("Start task…").click());

  assert.deepEqual(listedInPeek, ["Fix login"]);
  assert.deepEqual(newTasksFrom, [
    { id: issue(1).id, workspaceId: WORKSPACE.id, identifier: "ACME-1", title: "Fix login" },
  ]);
  assert.deepEqual(opened, [], "the board still stands");
});

test("a peeked issue a View options filter leaves off the board is peeked no more", async () => {
  standing = [
    issue(1, { priority: ISSUE_PRIORITY.URGENT, title: "Fix login" }),
    issue(2, { priority: ISSUE_PRIORITY.LOW }),
  ];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  act(() => cardOf(page, issue(1).id).click());
  await settle();
  const before = peeking(page).title;
  chooseView("Low", "Priority");
  await settle();

  assert.equal(before, "Fix login");
  assert.deepEqual(groups(page), [["Backlog1", ["ACME-2 Issue 2"]]]);
  assert.ok(peekOf(page) === null, "the filtered-out issue's peek is put away");
});

test("an issue's ⋯ offers Start agent…, which opens a new agent's card on the issue, and a card's menu offers it too", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2, { title: "Fix logout" })];
  const page = await openIssue(issue(1).id);

  act(() => button("Issue actions").click());
  act(() => menuItem("Start agent…").click());
  act(() => button("Issues").click());
  await settle();
  rightClick(cardOf(page, issue(2).id));
  act(() => menuItem("Start agent…").click());

  assert.deepEqual(newTasksFrom, [
    {
      id: issue(1).id,
      workspaceId: WORKSPACE.id,
      identifier: "ACME-1",
      title: "Fix login",
      agent: true,
    },
    {
      id: issue(2).id,
      workspaceId: WORKSPACE.id,
      identifier: "ACME-2",
      title: "Fix logout",
      agent: true,
    },
  ]);
  assert.deepEqual(changes, [], "the page moves no issue itself");
});

test("the peek's ⋯ offers Start agent… beside Start task…, as the issue's page does", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2)];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  act(() => cardOf(page, issue(1).id).click());
  await settle();
  assert.ok(peekOf(page), "the issue is peeked");
  act(() => button("Issue actions").click());
  act(() => menuItem("Start agent…").click());

  assert.deepEqual(newTasksFrom, [
    {
      id: issue(1).id,
      workspaceId: WORKSPACE.id,
      identifier: "ACME-1",
      title: "Fix login",
      agent: true,
    },
  ]);
  assert.deepEqual(opened, [], "the board still stands");
});

/** A task's agents' summary holding the pull requests given, newest first, of `total` in all. */
function withPullRequests(
  listed: TaskSummary,
  pullRequests: TaskPullRequestLine[],
  total = pullRequests.length,
): TaskSummary {
  return {
    ...listed,
    agents: { total: 1, working: 0, agents: [], pullRequestTotal: total, pullRequests },
  };
}

/** A pull request as the task list carries it. */
function pullRequestLine(
  number: number,
  state: TaskPullRequestLine["state"],
  patch: Partial<TaskPullRequestLine> = {},
): TaskPullRequestLine {
  return {
    number,
    title: `Change ${number}`,
    state,
    checks: CHECK_SUMMARY.PASSING,
    additions: 1,
    deletions: 1,
    ...patch,
  };
}

test("an issue's page draws each task's pull requests beside it as Factory does, each opening its agent's Pull request tab, or GitHub where no agent is named", async () => {
  standing = [issue(1)];
  tasksListed = [
    withPullRequests(task("task-newer", "Fix login, again", issue(1).id, 2), [
      pullRequestLine(42, PULL_REQUEST_STATE.OPEN, {
        agentId: "6f1d2a10-2c1d-4c7a-9a55-5e3b6f1d2a10",
      }),
    ]),
    withPullRequests(task("task-older", "Fix login", issue(1).id, 1), [
      pullRequestLine(17, PULL_REQUEST_STATE.MERGED, {
        url: "https://github.com/acme/web/pull/17",
      }),
    ]),
  ];
  const page = await openIssue(issue(1).id);

  assert.deepEqual(workOf(page), ["Fix login, again", "#42", "Fix login", "#17"]);
  const marks = [...page.querySelectorAll(".issue-work [data-pull-request-mark]")].map((mark) => [
    mark.getAttribute("data-pull-request-state"),
    mark.getAttribute("aria-label"),
  ]);
  assert.deepEqual(
    marks.map(([state]) => state),
    [PULL_REQUEST_STATE.OPEN, PULL_REQUEST_STATE.MERGED],
  );
  act(() => button("Open pull request #42, Change 42").click());
  act(() => button("Open pull request #17, Change 17").click());

  assert.deepEqual(linksOpened, [
    {
      workspace: "",
      place: {
        kind: LINK_PLACE.CHANGES,
        planId: "task-newer",
        agentId: "6f1d2a10-2c1d-4c7a-9a55-5e3b6f1d2a10",
      },
    },
  ]);
  assert.deepEqual(githubOpened, ["https://github.com/acme/web/pull/17"]);
});

test("a card draws the pull request that matters most of its issue's tasks after its priority, with how many more stand, and none where no pull request was opened", async () => {
  standing = [issue(1), issue(2)];
  tasksListed = [
    withPullRequests(
      task("task-newer", "Fix login, again", issue(1).id, 2),
      [
        pullRequestLine(42, PULL_REQUEST_STATE.DRAFT),
        pullRequestLine(41, PULL_REQUEST_STATE.CLOSED),
      ],
      3,
    ),
    withPullRequests(task("task-older", "Fix login", issue(1).id, 1), [
      pullRequestLine(17, PULL_REQUEST_STATE.MERGED),
    ]),
    task("task-plain", "Fix logout", issue(2).id, 3),
  ];
  const page = mount();
  await settle();

  const drawn = (issueId: string) => {
    const mark = cardOf(page, issueId).querySelector(".issue-card-pull-request");
    return mark === null
      ? undefined
      : [mark.getAttribute("data-pull-request-state"), mark.textContent];
  };
  assert.deepEqual(drawn(issue(1).id), [PULL_REQUEST_STATE.DRAFT, "#42+3"]);
  assert.equal(drawn(issue(2).id), undefined);
});

test("a card draws an older agent's open pull request over a newer one's merged one, as a task's sidebar mark does, and a merged one over a closed one", async () => {
  standing = [issue(1), issue(2)];
  tasksListed = [
    // The service lists a task's still-open pull requests first, whatever agent opened them.
    withPullRequests(task("task-one", "Fix login", issue(1).id, 2), [
      pullRequestLine(10, PULL_REQUEST_STATE.OPEN),
      pullRequestLine(11, PULL_REQUEST_STATE.MERGED),
    ]),
    withPullRequests(task("task-newer", "Fix logout, again", issue(2).id, 3), [
      pullRequestLine(21, PULL_REQUEST_STATE.CLOSED),
    ]),
    withPullRequests(task("task-older", "Fix logout", issue(2).id, 1), [
      pullRequestLine(20, PULL_REQUEST_STATE.MERGED),
    ]),
  ];
  const page = mount();
  await settle();

  const drawn = (issueId: string) => {
    const mark = cardOf(page, issueId).querySelector(".issue-card-pull-request");
    return [mark?.getAttribute("data-pull-request-state"), mark?.textContent];
  };
  assert.deepEqual(drawn(issue(1).id), [PULL_REQUEST_STATE.OPEN, "#10+1"]);
  assert.deepEqual(drawn(issue(2).id), [PULL_REQUEST_STATE.MERGED, "#20+1"]);
});

test("an issue's page counts a task's pull requests the list did not carry, in a pill that opens the task", async () => {
  standing = [issue(1)];
  tasksListed = [
    withPullRequests(
      task("task-busy", "Fix login", issue(1).id, 1),
      [
        pullRequestLine(4, PULL_REQUEST_STATE.OPEN),
        pullRequestLine(3, PULL_REQUEST_STATE.OPEN),
        pullRequestLine(2, PULL_REQUEST_STATE.MERGED),
      ],
      5,
    ),
  ];
  const page = await openIssue(issue(1).id);

  assert.deepEqual(workOf(page), ["Fix login", "#4", "#3", "#2", "2 more"]);
  act(() => button("Open Fix login for 2 more pull requests").click());
  assert.deepEqual(tasksOpened, ["task-busy"]);
});

test("the peek stands in the window's own side panel: its row's tab for the issue, its width, and its Expand panel, which fills the page until Escape brings it back, and Escape again puts it away", async () => {
  standing = [issue(1, { title: "Fix login" }), issue(2)];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  act(() => cardOf(page, issue(1).id).click());
  await settle();
  const pane = page.querySelector<HTMLElement>(".side-panel");
  const tab = pane?.querySelector(".side-panel-bar [role=tab][aria-selected='true']")?.textContent;
  const width = pane?.style.width;
  act(() => button("Expand panel").click());
  const filled = page.querySelector(".side-panel")?.getAttribute("data-full-screen");
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });
  await settle();
  const back = page.querySelector(".side-panel")?.getAttribute("data-full-screen");
  const stillPeeked = peeking(page).title;
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_ISSUES);
  });
  await settle();

  assert.equal(tab, "ACME-1 Fix login");
  assert.equal(width, "400px", "the side panel's own width");
  assert.equal(filled, "true");
  assert.equal(back, "false", "Escape brings it back beside the board first");
  assert.equal(stillPeeked, "Fix login");
  assert.ok(peekOf(page) === null, "then puts it away");
  assert.equal(closed, 0);
});

test("Open as page from a peek filling the page brings the panel back from full screen, so no page after it draws one full screen", async () => {
  standing = [issue(1, { title: "Fix login" })];
  const page = mount();
  await settle();
  layPagesAt(ROOMY);

  act(() => cardOf(page, issue(1).id).click());
  await settle();
  act(() => button("Expand panel").click());
  const filled = panelNow?.fullScreen;
  act(() => button("Issue actions").click());
  act(() => menuItem("Open as page").click());
  await settle();

  assert.equal(filled, true);
  assert.equal(titleOf(page), "Fix login");
  assert.equal(panelNow?.fullScreen, false);
});
