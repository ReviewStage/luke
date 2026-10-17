// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Task, type TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { DOCUMENT_REGION, TASKS_PAGE, type TaskMark } from "@luke/ui/tasks-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { lineWords } from "#testing/actor-line";
import { fakeAppBridge, fakeAppBridgeCalls } from "#testing/app-bridge";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { tasksControl, UNPINNED_SUMMARY } from "#testing/tasks-control";
import { newestToastSays } from "#testing/toast";
import { MemberDirectory } from "../member-directory";
import { OpenPersonProvider } from "../person-door";
import { MAIN_TAB, type MainTab } from "../tasks/use-main-tabs";
import { NO_LOOKS } from "../tasks/use-task-looks";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { ToastHost } from "../toast";
import { DesktopTasks } from "./desktop-tasks";
import { SidebarTask } from "./task-actions";
import { taskCardOf } from "./task-card";

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const OTHER: TaskSummary = {
  id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
  workspaceId: "workspace-personal",
  name: "Billing export",
  createdAt: 4,
  updatedAt: 5,
  repository: null,
};

const DIALOG = '[role="alertdialog"]';

const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const DEAN = { userId: "user-dean", name: "Dean Stratakos" };

/** `PLAN` as Charles started it and Dean last edited it, the minute after. */
const SHARED_TASK: Task = {
  ...TASK,
  createdAt: 60_000,
  updatedAt: 120_000,
  ownerId: CHARLES.userId,
  createdBy: CHARLES,
  lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by: DEAN, at: 120_000, duringCall: false },
};

/** What the task actions asked of the tab, by the task each named. */
interface Asked {
  opened: string[];
  /** Each task whose page Open on GitHub asked for. */
  openedOnGitHub: string[];
  /** Each task whose chip Change repository… asked open. */
  changed: string[];
  deleted: string[];
  /** Each rename asked, as the task and the name it was given. */
  renamed: string[][];
  /** Each pin or archive asked, as the task and what was asked of it. */
  marked: [string, TaskMark][];
}

const roots: Root[] = [];

/** Takes down every mounted surface and the menus they drew. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

beforeEach(installScrollIntoView);

afterEach(unmountAll);

/** The open task's tab, every per-task press recorded; `PLAN` is open and `OTHER` beside it in the list. */
function openTab(
  repositories: Readonly<Record<string, string>> = {},
  deletes: () => Promise<ActionResult> = () =>
    Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  renames: () => Promise<boolean> = () => Promise.resolve(true),
) {
  const asked: Asked = {
    opened: [],
    openedOnGitHub: [],
    changed: [],
    deleted: [],
    renamed: [],
    marked: [],
  };
  const onRepository = (task: Task | TaskSummary) => ({
    ...task,
    repository: repositories[task.id] ?? null,
  });
  const open = onRepository(TASK);
  const tasks: TasksControl = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    tasks: [onRepository(TASK), onRepository(OTHER)],
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: { ...TASK, ...open } },
    onOpenOnGitHub: (taskId) => asked.openedOnGitHub.push(taskId),
    onChangeRepository: (taskId) => asked.changed.push(taskId),
    onDeleteTask: (taskId) => {
      asked.deleted.push(taskId);
      return deletes();
    },
    onRenameTask: (taskId, name) => {
      asked.renamed.push([taskId, name]);
      return renames();
    },
    onMarkTask: (taskId, mark) => asked.marked.push([taskId, mark]),
  });
  return { tasks, asked };
}

function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

function mountToolbar(tasks: TasksControl): HTMLButtonElement {
  const container = mount(
    createElement(DesktopTasks, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      tasks,
    }),
  );
  const more = container.querySelector('[aria-label="Task actions"]');
  assert.ok(more instanceof HTMLButtonElement);
  return more;
}

function sidebarTask(
  tasks: TasksControl,
  task: TaskSummary,
  asked: Asked,
  current = false,
): ReactElement {
  return createElement(
    "ul",
    null,
    createElement(SidebarTask, {
      tasks,
      task,
      current,
      unread: false,
      now: task.updatedAt,
      onOpen: () => asked.opened.push(task.id),
    }),
  );
}

function mountSidebarTask(
  tasks: TasksControl,
  task: TaskSummary,
  asked: Asked,
  current = false,
): HTMLButtonElement {
  const container = mount(sidebarTask(tasks, task, asked, current));
  const row = container.querySelector(".sidebar-task");
  assert.ok(row instanceof HTMLButtonElement);
  return row;
}

function openMenu(more: HTMLButtonElement): void {
  act(() => more.click());
}

function rightClick(row: HTMLElement, clientX: number, clientY: number): void {
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX, clientY }));
  });
}

function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];
}
function choose(label: string): void {
  const item = menuItems().find((candidate) => candidate.textContent === label);
  assert.ok(item, `the menu offers ${label}`);
  act(() => item.click());
}
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(DIALOG);
}

/** Whether a dialog stands, said as a boolean so a failure does not try to print the DOM. */
function asking(): boolean {
  return dialog() !== null;
}

/** The dialog's button with these words. */
function answer(words: string): HTMLButtonElement {
  const button = [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent === words,
  );
  assert.ok(button, `the dialog offers ${words}`);
  return button;
}

/** Answers the question Permanently delete asked, and lets the delete it starts settle. */
async function confirmDelete(): Promise<void> {
  assert.equal(asking(), true, "Permanently delete asks first");
  const remove = answer("Permanently delete");
  await act(async () => remove.click());
}
test("Permanently delete asks in a dialog naming the plan, from the ⋯ and from a sidebar plan alike, and deletes on its answer", async () => {
  const { tasks, asked } = openTab();

  const more = mountToolbar(tasks);
  openMenu(more);
  assert.equal(asking(), false);
  choose("Permanently delete");
  const question = dialog();
  assert.ok(question);
  assert.equal(question.getAttribute("aria-modal"), "true");
  const title = document.getElementById(question.getAttribute("aria-labelledby") ?? "");
  const body = document.getElementById(question.getAttribute("aria-describedby") ?? "");
  assert.equal(title?.textContent, "Permanently delete task?");
  assert.equal(
    body?.textContent,
    "“Teammate invitations” and its board and transcript will be deleted. This can’t be undone. To keep it out of the way instead, archive it.",
  );
  // A key already pressed lands on the answer that changes nothing.
  assert.equal(document.activeElement, answer("Cancel"));
  assert.deepEqual(asked.deleted, []);
  await confirmDelete();
  assert.equal(asking(), false);

  unmountAll();
  rightClick(mountSidebarTask(tasks, OTHER, asked), 40, 60);
  choose("Permanently delete");
  assert.match(dialog()?.textContent ?? "", /“Billing export”/u);
  assert.deepEqual(asked.deleted, [TASK.id]);
  await confirmDelete();

  assert.deepEqual(asked.deleted, [TASK.id, OTHER.id]);
});
test("the plan's name reaches the recording only as masked text, never in an attribute", () => {
  const { tasks } = openTab();
  openMenu(mountToolbar(tasks));
  choose("Permanently delete");
  const drawn = dialog()?.parentElement;
  assert.ok(drawn);
  for (const element of [drawn, ...drawn.querySelectorAll("*")]) {
    for (const attribute of element.attributes) {
      assert.doesNotMatch(attribute.value, /Teammate invitations/u, attribute.name);
    }
  }
});

/** The open task's tab on `tab`, `SHARED_PLAN` open as `me` reads it and `OTHER` beside it in the list. */
function sharedTab(me: string, tab: MainTab = MAIN_TAB.PLAN): TasksControl {
  const base = tasksControl();
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    me,
    tasks: [SHARED_TASK, OTHER],
    activeTaskId: SHARED_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: SHARED_TASK },
    mainTabs: { ...base.mainTabs, tabs: [MAIN_TAB.PLAN, MAIN_TAB.INBOX], tab },
  });
}

/** The lines under the open menu's items, each with its time left off. */
function menuFooter(): string[] {
  const notes = document.querySelectorAll('[role="menu"] .luke-menu-footer p');
  return [...notes].map((note) => (lineWords(note) ?? "").replace(/ · .*$/u, ""));
}

test("the plan's ⋯ menu ends with who created the plan and who last edited it, the reader's own as you and a teammate's by name", () => {
  openMenu(mountToolbar(sharedTab(DEAN.userId)));
  assert.deepEqual(menuFooter(), ["Created by Charles Pan", "Last edited by you"]);
  // Each person stands on their face, their letter until a picture is read.
  const faces = document.querySelectorAll('[role="menu"] .luke-menu-footer .actor-mark');
  assert.deepEqual(
    [...faces].map((face) => [face.getAttribute("data-kind"), face.textContent]),
    [
      ["person", "C"],
      ["person", "D"],
    ],
  );
  const times = document.querySelectorAll('[role="menu"] .luke-menu-footer time');
  assert.deepEqual(
    [...times].map((time) => time.getAttribute("datetime")),
    [new Date(60_000).toISOString(), new Date(120_000).toISOString()],
  );
  unmountAll();

  openMenu(mountToolbar(sharedTab(CHARLES.userId)));
  assert.deepEqual(menuFooter(), ["Created by you", "Last edited by Dean Stratakos"]);
  unmountAll();

  // A task the window has not opened, from a service that named no creator, says only when it was saved.
  const { asked } = openTab();
  rightClick(mountSidebarTask(sharedTab(DEAN.userId), OTHER, asked), 40, 60);
  assert.deepEqual(menuFooter(), ["Created by someone", "Last edited"]);
});

test("a sidebar task someone else created wears its creator's face before its time, and the reader's own wears none", () => {
  /** The faces each row wears, by the task's name, read as Dean sees them. */
  const faces = (task: TaskSummary) => {
    const { tasks, asked } = openTab();
    const container = mount(
      createElement(MemberDirectory, {
        workspace: undefined,
        readerId: DEAN.userId,
        children: sidebarTask(tasks, task, asked),
      }),
    );
    const marks = container.querySelectorAll(".sidebar-task-time .actor-mark");
    // What the row says while it holds the keyboard, its time stepped out for Pin and Archive.
    const line = container.querySelector(".sidebar-task-line");
    const said = [...(line?.childNodes ?? [])]
      .filter((part) => !(part instanceof Element && part.matches(".sidebar-task-time")))
      .map(heard)
      .join("")
      .match(/\(created by [^)]*\)/u)?.[0];
    unmountAll();
    return [[...marks].map((mark) => mark.textContent), said];
  };

  assert.deepEqual(faces(SHARED_TASK), [["C"], "(created by Charles Pan)"]);
  assert.deepEqual(faces({ ...SHARED_TASK, ownerId: DEAN.userId, createdBy: DEAN }), [
    [],
    undefined,
  ]);
  // A task from a service that named no creator can't be told apart, so it wears nothing.
  assert.deepEqual(faces(OTHER), [[], undefined]);
});

test("Start and the plan's ⋯ stand in the toolbar on the Plan tab alone", () => {
  const drawn = (tab: MainTab) => {
    const container = mount(
      createElement(DesktopTasks, {
        summary: UNPINNED_SUMMARY,
        looks: NO_LOOKS,
        tasks: sharedTab(DEAN.userId, tab),
      }),
    );
    const toolbar = container.querySelector(".desktop-toolbar");
    const shown = ["Start a coding agent", "Task actions"].filter(
      (label) => toolbar?.querySelector(`[aria-label="${label}"]`) !== null,
    );
    unmountAll();
    return shown;
  };

  assert.deepEqual(drawn(MAIN_TAB.PLAN), ["Start a coding agent", "Task actions"]);
  assert.deepEqual(drawn(MAIN_TAB.INBOX), []);
});

/** Dean's own workspace, with no GitHub connected, and the team's, whose GitHub reaches acme-corp's repositories. */
const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Dean Stratakos",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  memberCount: 1,
};
const STAGE: Workspace = {
  id: "workspace-stage",
  name: "Stage",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme-corp", active: true },
  memberCount: 6,
};

/** Dean's task in his own workspace on a repository only Stage's GitHub reaches: stranded there. */
const STRANDED: TaskSummary = {
  ...OTHER,
  repository: "acme-corp/relay",
  ownerId: DEAN.userId,
};

/** The words a reader hears in an element: its text but for a mark hidden from a screen reader, a workspace's tile's letter among them. */
function heard(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return [...node.childNodes].map(heard).join("");
}

test("a sidebar plan whose repository belongs to another of the account's workspaces wears the attention mark before its time, its card naming that workspace, until it is moved there", () => {
  const { asked } = openTab();
  const tasks = tasksControl({ me: DEAN.userId, workspaces: [PERSONAL, STAGE] });
  const container = mount(sidebarTask(tasks, STRANDED, asked));
  const mark = () => container.querySelector(".sidebar-task-time .attention-mark");
  const card = mount(taskCardOf(tasks, STRANDED, STRANDED.updatedAt));

  assert.notEqual(mark(), null, "the row wears the attention mark");
  assert.match(heard(container), /\(repository belongs to Stage\)/u);
  assert.deepEqual([...card.querySelectorAll(".task-card-detail")].map(heard), [
    "acme-corp/relay",
    "Repository belongs to Stage",
  ]);

  act(() => roots[0]?.render(sidebarTask(tasks, { ...STRANDED, workspaceId: STAGE.id }, asked)));
  assert.equal(mark(), null, "moved to Stage, the row wears it no longer");
});

test("no sidebar plan wears the attention mark where its own workspace reaches its repository, no other workspace does, a teammate owns it, or it is archived", () => {
  const { asked } = openTab();
  const reaching = { ...PERSONAL, github: { login: "acme-corp", active: true } };
  const cases: [TaskSummary, readonly Workspace[]][] = [
    [STRANDED, [reaching, STAGE]],
    [STRANDED, [PERSONAL]],
    [{ ...STRANDED, ownerId: CHARLES.userId }, [PERSONAL, STAGE]],
    [{ ...STRANDED, archivedAt: 6 }, [PERSONAL, STAGE]],
  ];
  const marked = cases.map(([task, workspaces]) => {
    const tasks = tasksControl({ me: DEAN.userId, workspaces: [...workspaces] });
    const row = mount(sidebarTask(tasks, task, asked));
    const card = mount(taskCardOf(tasks, task, task.updatedAt));
    const found = [
      row.querySelector(".attention-mark") !== null,
      card.querySelector(".attention-mark") !== null,
    ];
    unmountAll();
    return found;
  });

  assert.deepEqual(
    marked,
    cases.map(() => [false, false]),
  );
});

/** Main's clipboard, keeping each copy the window asks of it. */
function installClipboard(): string[] {
  const copied: string[] = [];
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => {
      if (request.kind !== ACT_KIND.WINDOW_COPY_TEXT) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
      }
      copied.push(request.payload.words);
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
    },
    recordSurfaceEvent: () => undefined,
  });
  return copied;
}

test("Copy link copies the plan's address on tryluke.dev, alike from the toolbar's ⋯, the ⋯ beside its title, and its sidebar row, and says Link copied", async () => {
  const copied = installClipboard();
  mount(createElement(ToastHost));
  const opened = openTab();
  const tasks: TasksControl = { ...opened.tasks, workspaces: [{ ...PERSONAL, slug: "dean" }] };
  const link = `https://tryluke.dev/dean/plan/${TASK.id}`;
  const copyFromMenu = async () => {
    const item = menuItems().find((candidate) => candidate.textContent === "Copy link");
    assert.ok(item, "the menu offers Copy link");
    await act(async () => item.click());
  };

  openMenu(mountToolbar(tasks));
  await copyFromMenu();
  const title = document.querySelector<HTMLButtonElement>('[aria-label="Title actions"]');
  assert.ok(title, "the title has a ⋯");
  openMenu(title);
  await copyFromMenu();
  unmountAll();
  mount(createElement(ToastHost));
  rightClick(mountSidebarTask(tasks, TASK, opened.asked), 40, 60);
  await copyFromMenu();

  assert.deepEqual(copied, [link, link, link]);
  assert.equal(newestToastSays(), "Link copied");
});

test("a task's card says who created it where others share its workspace, the reader as you, and nothing in a workspace of one", () => {
  /** The card's lines under its name, as Dean hears them with the creation's time left off. */
  const details = (plan: TaskSummary, workspace: Workspace) => {
    const plans = tasksControl({ me: DEAN.userId, workspaces: [workspace] });
    const card = mount(
      createElement(MemberDirectory, {
        workspace: undefined,
        readerId: DEAN.userId,
        children: taskCardOf(plans, { ...plan, workspaceId: workspace.id }, plan.updatedAt),
      }),
    );
    const lines = [...card.querySelectorAll(".task-card-detail")].map((line) =>
      heard(line).replace(/ · .*$/u, ""),
    );
    unmountAll();
    return lines;
  };
  const charles = { ...OTHER, createdAt: 60_000, ownerId: CHARLES.userId, createdBy: CHARLES };

  assert.deepEqual(details(charles, STAGE), ["Created by Charles Pan"]);
  assert.deepEqual(details({ ...charles, ownerId: DEAN.userId, createdBy: DEAN }, STAGE), [
    "Created by you",
  ]);
  assert.deepEqual(details(charles, PERSONAL), []);
  // A service that names no creator leaves the card as it was.
  assert.deepEqual(details(OTHER, STAGE), []);
});

test("a task's card's creator line opens the creator's page in the window, and is words outside it", () => {
  const opened: string[] = [];
  const plans = tasksControl({ me: DEAN.userId, workspaces: [STAGE] });
  const charles = { ...OTHER, createdAt: 60_000, ownerId: CHARLES.userId, createdBy: CHARLES };
  const drawn = (inWindow: boolean) => {
    const card = taskCardOf(plans, { ...charles, workspaceId: STAGE.id }, charles.updatedAt);
    return mount(
      createElement(MemberDirectory, {
        workspace: undefined,
        readerId: DEAN.userId,
        children: inWindow
          ? createElement(OpenPersonProvider, { value: (id: string) => opened.push(id) }, card)
          : card,
      }),
    ).querySelector<HTMLElement>(".task-card-creator");
  };

  const line = drawn(true);
  assert.equal(line?.tagName, "BUTTON");
  act(() => line?.click());
  assert.deepEqual(opened, [CHARLES.userId]);
  unmountAll();
  assert.equal(drawn(false)?.tagName, "SPAN");
});

test("a task's card says you of the reader's own task outside a member directory, and, where the service counts no members, says who created it only once the members read lists someone else", async () => {
  const { memberCount: _uncounted, ...stage } = STAGE;
  const mine = { ...OTHER, workspaceId: STAGE.id, ownerId: DEAN.userId, createdBy: DEAN };
  const lines = async (
    workspace: Workspace,
    members: readonly { userId: string; name: string }[] | undefined,
  ) => {
    installMembers(members);
    const plans = tasksControl({ me: DEAN.userId, workspaces: [PERSONAL, workspace] });
    const card = mount(
      members === undefined
        ? taskCardOf(plans, mine, mine.updatedAt)
        : createElement(MemberDirectory, {
            workspace,
            readerId: DEAN.userId,
            children: taskCardOf(plans, mine, mine.updatedAt),
          }),
    );
    await act(async () => {
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });
    const said = [...card.querySelectorAll(".task-card-detail")].map((line) =>
      heard(line).replace(/ · .*$/u, ""),
    );
    unmountAll();
    return said;
  };

  assert.deepEqual(await lines(STAGE, undefined), ["Created by you"]);
  assert.deepEqual(await lines(stage, [DEAN, CHARLES]), ["Created by you"]);
  assert.deepEqual(await lines(stage, [DEAN]), []);
  assert.deepEqual(await lines(stage, undefined), []);
});

/** The bridge answering the members read with `members`, each a member of the workspace. */
function installMembers(members: readonly { userId: string; name: string }[] | undefined): void {
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    act: (request: Act): Promise<ActOutcome> =>
      Promise.resolve(
        request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ && members !== undefined
          ? {
              status: ACT_OUTCOME_STATUS.DONE,
              value: members.map((member) => ({
                ...member,
                email: `${member.userId}@example.com`,
                role: WORKSPACE_ROLE.MEMBER,
              })),
            }
          : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Could not read." },
      ),
  });
}
