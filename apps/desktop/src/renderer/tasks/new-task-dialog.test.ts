// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import type { LinearIssuesAsk } from "@luke/ui/tasks-model";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { tasksControl } from "#testing/tasks-control";
import { OpenSettingsProvider } from "../open-settings";
import { NewTaskDialog } from "./new-task-dialog";
import type { RepositoryChooser } from "./repository-chip";
import type { NewTaskPreset } from "./use-tasks-tab";

/**
 * New task as the developer meets it: a card over the window holding the
 * task's name, the repository chip, Cancel, and Create task. Each test
 * stands the dialog in an owner that opens it and puts it away as the tab
 * does, so closing is read as the card leaving the window.
 */

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * The dialog open in its owner, a start answered by `answer` and each
 * start's name and repository written down; `preset` is what the press
 * that opened it chose, a repository as a repository group's + does or an
 * issue as its Start task… does, `issues`
 * the workspace's Linear issues where it has Linear connected, and `finds`
 * what its Linear answers a search or an identifier with.
 */
async function mount(
  answer: string | undefined = undefined,
  preset?: NewTaskPreset,
  chooser: Partial<RepositoryChooser> = {},
  issues?: readonly LinearIssueSummary[],
  finds: (ask: LinearIssuesAsk) => readonly LinearIssueSummary[] = () => [],
) {
  const starts: [string, string | null][] = [];
  const asks: LinearIssuesAsk[] = [];
  const planned: boolean[] = [];
  const fromIssues: (string | undefined)[] = [];
  const fromWorkspaceIssues: (string | undefined)[] = [];
  const startedIn: (string | undefined)[] = [];
  const control = tasksControl();
  let repositories: RepositoryChooser = {
    ...control.repositories,
    recent: ["acme/web", "acme/api"],
    ...chooser,
  };
  const links: SettingsLink[] = [];
  function Owner() {
    const [open, setOpen] = useState(true);
    const dialog = createElement(NewTaskDialog, {
      newTask: {
        ...control.newTask,
        open,
        preset,
        repositoriesIn: () => repositories,
        start: (
          name: string,
          repository: string | null,
          workspaceId: string | undefined,
          planning: boolean,
          from?: { readonly linearIssueId?: string; readonly issueId?: string },
        ) => {
          starts.push([name, repository]);
          planned.push(planning);
          fromIssues.push(from?.linearIssueId);
          fromWorkspaceIssues.push(from?.issueId);
          startedIn.push(workspaceId);
          return Promise.resolve(answer);
        },
        onClose: () => setOpen(false),
        linearIssuesIn: () =>
          issues === undefined
            ? undefined
            : (ask?: LinearIssuesAsk) => {
                if (ask === undefined) return Promise.resolve(issues);
                asks.push(ask);
                return Promise.resolve(finds(ask));
              },
      },
    });
    return createElement(
      OpenSettingsProvider,
      { value: (link: SettingsLink) => links.push(link) },
      dialog,
    );
  }
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Owner)));
  await settle();
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
  const field = () => {
    const found = document.querySelector<HTMLInputElement>('input[aria-label="Task name"]');
    assert.ok(found, "the name field is drawn");
    return found;
  };
  const button = (label: string) => {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
      each.textContent?.startsWith(label),
    );
    assert.ok(found, `${label} is drawn`);
    return found;
  };
  const press = async (key: string, on: HTMLElement, held: KeyboardEventInit = {}) => {
    act(() => {
      on.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...held }));
    });
    await settle();
  };
  return {
    starts,
    /** Every search or identifier the card asked the workspace's Linear for. */
    asks,
    /** The Linear issue each start came from, where it came from one. */
    fromIssues,
    /** The workspace's own issue each start came from, where it came from one. */
    fromWorkspaceIssues,
    /** The workspace each start asked for. */
    startedIn,
    /** Whether each start asked for its planning phase. */
    planned,
    /** Every Settings link the dialog's presses followed. */
    links,
    opener,
    dialog,
    field,
    button,
    type: (words: string) => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      act(() => {
        setValue?.call(field(), words);
        field().dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    press,
    /** Stands the dialog again over another chooser, as a workspace switch or the first workspaces read hands it. */
    rechoose: async (next: Partial<RepositoryChooser>) => {
      repositories = { ...repositories, ...next };
      act(() => root.render(createElement(Owner)));
      await settle();
    },
    note: () => document.querySelector('[role="alert"]')?.textContent ?? undefined,
    /** The card's controls in order, as a reader meets them. */
    controls: () =>
      [...(dialog()?.querySelectorAll("input, button") ?? [])].map(
        (each) => each.getAttribute("aria-label") ?? each.textContent,
      ),
  };
}

test("the dialog holds the Plan switch, the name, then the repository chip leading Cancel and Create plan, with the name taking focus", async () => {
  const card = await mount();
  assert.deepEqual(card.controls(), [
    "Plan with Luke",
    "Task name",
    "acme/web",
    "Cancel",
    "Create task⏎",
  ]);
  assert.equal(document.activeElement, card.field());
  assert.equal(
    card.dialog()?.textContent?.includes("Repository"),
    false,
    "the chip stands unlabelled",
  );
});

test("Return creates the plan under the name as typed, trimmed, about the repository last used", async () => {
  const card = await mount();
  card.type("  Dark mode toggle  ");
  await card.press("Enter", card.field());
  assert.deepEqual(card.starts, [["Dark mode toggle", "acme/web"]]);
});

test("the name is optional: with none, or only whitespace, Return and Create task each start the plan unnamed", async () => {
  const card = await mount("refused");
  assert.equal(card.field().placeholder, "Task name (optional)");
  assert.equal(card.button("Create task").disabled, false);
  await card.press("Enter", card.field());
  card.type("   ");
  act(() => card.button("Create task").click());
  await settle();
  assert.deepEqual(card.starts, [
    ["", "acme/web"],
    ["", "acme/web"],
  ]);
});

test("Plan starts on, a task started with it off starts without planning, and the next New task offers it as it was left", async () => {
  const first = await mount();
  const planSwitch = () => {
    const found = document.querySelector<HTMLButtonElement>('[role="switch"]');
    assert.ok(found, "the Plan switch is drawn");
    return found;
  };
  assert.equal(planSwitch().getAttribute("aria-checked"), "true");
  act(() => first.button("Create task").click());
  await settle();
  const label = document.querySelector<HTMLLabelElement>(`label[for="${planSwitch().id}"]`);
  assert.ok(label, "the switch has a visible label");
  act(() => label.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  assert.equal(planSwitch().getAttribute("aria-checked"), "false", "a press on its word turns it");
  act(() => first.button("Create task").click());
  await settle();
  assert.deepEqual(first.planned, [true, false]);
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  const next = await mount();
  assert.equal(planSwitch().getAttribute("aria-checked"), "false");
  await next.press("Enter", next.field());
  assert.deepEqual(next.planned, [false]);
});

test("a repository group's + opens the dialog on its repository rather than the last used", async () => {
  const card = await mount(undefined, { repository: "acme/api" });
  card.type("Rate limits");
  act(() => card.button("Create task").click());
  await settle();
  assert.deepEqual(card.starts, [["Rate limits", "acme/api"]]);
});

test("Escape and Cancel each put the dialog away with nothing started, and focus goes back to what opened it", async () => {
  const escaped = await mount();
  escaped.type("Dark mode");
  await escaped.press("Escape", escaped.field());
  assert.equal(escaped.dialog(), null);
  assert.equal(document.activeElement, escaped.opener);
  assert.deepEqual(escaped.starts, []);
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  const cancelled = await mount();
  cancelled.type("Dark mode");
  act(() => cancelled.button("Cancel").click());
  await settle();
  assert.equal(cancelled.dialog(), null);
  assert.deepEqual(cancelled.starts, []);
});

test("Escape in the repository menu closes the menu and leaves the dialog standing", async () => {
  const card = await mount();
  act(() => card.button("acme/web").click());
  await settle();
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search repositories"]',
  );
  assert.ok(search, "the chip's menu opens");
  await card.press("Escape", search);
  assert.equal(document.querySelector('input[aria-label="Search repositories"]'), null);
  assert.ok(card.dialog(), "the dialog still stands");
});

test("a refusal keeps the dialog and the name, says why under the field, and Create plan can be pressed again", async () => {
  const card = await mount("Luke can't reach acme/web.");
  card.type("Dark mode toggle");
  act(() => card.button("Create task").click());
  await settle();
  assert.deepEqual(card.starts, [["Dark mode toggle", "acme/web"]]);
  assert.ok(card.dialog());
  assert.equal(card.note(), "Luke can't reach acme/web.");
  assert.equal(card.field().value, "Dark mode toggle");
  assert.equal(card.button("Create task").disabled, false);
});

test("a workspace switch lets the pick go for the new workspace's recent repository", async () => {
  const dialog = await mount(
    undefined,
    { repository: "alice/private" },
    {
      scope: "workspace-personal",
      recent: ["alice/notes"],
    },
  );
  dialog.type("Dark mode");

  await dialog.rechoose({ scope: "workspace-acme", recent: ["acme/relay"] });
  await dialog.press("Enter", dialog.field());

  assert.deepEqual(dialog.starts, [["Dark mode", "acme/relay"]]);
});

test("the workspace first resolving keeps a repository picked before the workspaces were read", async () => {
  const dialog = await mount(
    undefined,
    { repository: "alice/private" },
    {
      scope: undefined,
      recent: ["alice/notes"],
    },
  );
  dialog.type("Dark mode");

  await dialog.rechoose({ scope: "workspace-personal" });
  await dialog.press("Enter", dialog.field());

  assert.deepEqual(dialog.starts, [["Dark mode", "alice/private"]]);
});

/** The lines the repository menu says in its rows' place. */
function menuNotes(): (string | null)[] {
  return [...document.querySelectorAll(".luke-combobox-note")].flatMap((note) => {
    const lines = [...note.querySelectorAll("p")];
    return lines.length === 0 ? [note.textContent] : lines.map((line) => line.textContent);
  });
}

/** The chip's menu opened, and the buttons then drawn anywhere in the document. */
async function openChip(): Promise<HTMLButtonElement[]> {
  const chip =
    document.querySelector<HTMLButtonElement>(".luke-chip") ??
    assert.fail("the dialog draws the repository chip");
  act(() => chip.click());
  await settle();
  return [...document.querySelectorAll<HTMLButtonElement>("button")];
}

/** A read answering that no GitHub is connected to the workspace. */
const NOWHERE_INSTALLED = () =>
  Promise.resolve({
    repositories: {
      installed: false,
      repositories: [],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  });

test("an owner or admin of a workspace with no GitHub connected is told so and offered Open Settings at that workspace's Integrations", async () => {
  const dialog = await mount(undefined, undefined, {
    scope: "workspace-acme",
    read: NOWHERE_INSTALLED,
  });

  const buttons = await openChip();
  const notes = menuNotes();
  const open =
    buttons.find((button) => button.textContent === "Open Settings") ??
    assert.fail("the menu offers to open Settings");
  act(() => open.click());

  assert.deepEqual(notes, ["No GitHub is connected to this workspace yet."]);
  assert.deepEqual(dialog.links, [
    {
      page: SETTINGS_VIEW.WORKSPACE,
      section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
      workspaceId: "workspace-acme",
    },
  ]);
});

test("a member of a workspace with no GitHub connected is told only to ask an owner or admin, with no Open Settings", async () => {
  await mount(undefined, undefined, {
    scope: "workspace-acme",
    manages: false,
    read: NOWHERE_INSTALLED,
  });

  const buttons = await openChip();
  const notes = menuNotes();

  assert.deepEqual(notes, ["Ask an owner or admin to connect GitHub."]);
  assert.equal(
    buttons.some((button) => ["Open Settings", "Retry"].includes(button.textContent ?? "")),
    false,
  );
});

/** The notes the chip's menu draws, and whether it offers Open Settings, for a workspace with a GitHub connected whose read finds none installed. */
async function lapsedMenu(manages: boolean) {
  await mount(undefined, undefined, {
    scope: "workspace-acme",
    workspaceName: "Acme",
    connected: true,
    manages,
    read: NOWHERE_INSTALLED,
  });
  const buttons = await openChip();
  return {
    notes: menuNotes(),
    settings: buttons.some((button) => button.textContent === "Open Settings"),
  };
}

test("an owner or admin of a workspace whose GitHub was removed or suspended on GitHub is told so, not that none is connected, and offered Open Settings", async () => {
  assert.deepEqual(await lapsedMenu(true), {
    notes: ["Acme's GitHub connection was removed or suspended on GitHub."],
    settings: true,
  });
});

test("a member of a workspace whose GitHub was removed or suspended on GitHub is told so and to ask an owner or admin to reconnect it", async () => {
  assert.deepEqual(await lapsedMenu(false), {
    notes: [
      "Acme's GitHub connection was removed or suspended on GitHub.",
      "Ask an owner or admin to reconnect GitHub.",
    ],
    settings: false,
  });
});

test("in a workspace with no GitHub connected, a repository its plans still name is neither offered nor chosen, the chip reads No repository, and Create starts the plan with none", async () => {
  const dialog = await mount(undefined, undefined, {
    scope: "workspace-personal",
    workspaceName: "Dean Stratakos",
    recent: ["ReviewStage/luke"],
    read: NOWHERE_INSTALLED,
  });

  const buttons = await openChip();
  const notes = menuNotes();
  const offered = buttons.map((button) => button.textContent);
  const search =
    document.querySelector<HTMLInputElement>('input[aria-label="Search repositories"]') ??
    assert.fail("the chip's menu opens");
  await dialog.press("Escape", search);
  dialog.type("Tmp");
  await dialog.press("Enter", dialog.field());

  assert.deepEqual(notes, ["Dean Stratakos has no GitHub connected yet."]);
  assert.equal(
    offered.some((words) => words?.startsWith("luke")),
    false,
    "the stranded repository is not offered",
  );
  assert.equal(dialog.button("No repository").textContent, "No repository");
  assert.deepEqual(dialog.starts, [["Tmp", null]]);
});

test("a pick the workspace's GitHub turns out not to list is let go, while one it lists stays chosen", async () => {
  const listing = () =>
    Promise.resolve({
      repositories: {
        installed: true,
        repositories: [
          {
            owner: "acme",
            name: "api",
            fullName: "acme/api",
            defaultBranch: "main",
            private: true,
            updatedAt: 1,
          },
        ],
        installationUrl: "https://github.com/apps/luke/installations/new",
      },
    });
  const unlisted = await mount(undefined, undefined, { read: listing });
  unlisted.type("Dark mode");
  await unlisted.press("Enter", unlisted.field());
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  const listed = await mount(undefined, { repository: "acme/api" }, { read: listing });
  listed.type("Rate limits");
  await listed.press("Enter", listed.field());

  assert.deepEqual(unlisted.starts, [["Dark mode", null]]);
  assert.deepEqual(listed.starts, [["Rate limits", "acme/api"]]);
});

test("the repository menu names each repository first and its owner after it, so two that share an owner tell apart, and finds one by its owner/name", async () => {
  const owner = "northwind-platform";
  const reached = (name: string) => ({
    owner,
    name,
    fullName: `${owner}/${name}`,
    defaultBranch: "main",
    private: true,
    updatedAt: 1,
  });
  const dialog = await mount(undefined, undefined, {
    recent: [],
    read: () =>
      Promise.resolve({
        repositories: {
          installed: true,
          repositories: [
            reached("customer-identity-and-access-management-service"),
            reached("billing-ledger-and-invoicing-pipeline"),
          ],
          installationUrl: "https://github.com/apps/luke/installations/new",
        },
      }),
  });
  await openChip();
  const rows = () =>
    [...document.querySelectorAll('[role="option"]')].map((row) => [
      row.querySelector(".luke-combobox-option-label")?.textContent,
      row.querySelector(".luke-combobox-option-detail")?.textContent,
    ]);

  assert.deepEqual(rows(), [
    ["customer-identity-and-access-management-service", owner],
    ["billing-ledger-and-invoicing-pipeline", owner],
  ]);
  const search =
    document.querySelector<HTMLInputElement>('input[aria-label="Search repositories"]') ??
    assert.fail("the chip's menu opens");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(search, `${owner}/billing`);
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await dialog.press("Enter", search);
  dialog.type("Ledger");
  await dialog.press("Enter", dialog.field());

  assert.deepEqual(dialog.starts, [["Ledger", `${owner}/billing-ledger-and-invoicing-pipeline`]]);
});

/** A workspace's Linear issues, in the order Linear lists them. */
const ISSUES: readonly LinearIssueSummary[] = [
  {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Restack the deploy queue",
    url: "https://linear.app/acme/issue/ENG-1",
    state: "Todo",
  },
  {
    id: "issue-2",
    identifier: "ENG-2",
    title: "Add support for stacked PRs",
    url: "https://linear.app/acme/issue/ENG-2",
    state: "In Progress",
  },
  {
    id: "issue-3",
    identifier: "OPS-7",
    title: "Rotate the deploy key",
    url: "https://linear.app/acme/issue/OPS-7",
  },
];

/** The rows standing under the name field, each as it reads, and which one is highlighted. */
function matchRows() {
  const options = [...document.querySelectorAll('[role="listbox"] [role="option"]')];
  const words = (row: Element) => row.textContent?.replace("⌘⏎", "").trim() ?? "";
  return {
    rows: options.map(words),
    highlighted: options
      .filter((row) => row.getAttribute("aria-selected") === "true")
      .map(words)
      .at(0),
  };
}

test("with Linear connected, what is typed lists the matching issues under the field, the nearest highlighted, and Return starts that issue's task at once on the card's repository", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES);
  assert.equal(card.field().placeholder, "Task name, or search Linear issues");

  card.type("stack");
  await settle();
  const listed = matchRows();
  const label = card.button("Start").textContent;
  await card.press("Enter", card.field());

  assert.deepEqual(listed, {
    rows: [
      "Add support for stacked PRsENG-2 · In Progress",
      "Restack the deploy queueENG-1 · Todo",
      "Create task “stack”",
    ],
    highlighted: "Add support for stacked PRsENG-2 · In Progress",
  });
  assert.equal(label, "Start ENG-2⏎");
  assert.deepEqual(card.starts, [["Add support for stacked PRs", "acme/web"]]);
  assert.deepEqual(card.fromIssues, ["issue-2"]);
});

test("the arrows move on through the issues to the name as typed, and Command-Return creates the name as typed whatever is highlighted", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES);
  card.type("deploy");
  await settle();

  await card.press("ArrowDown", card.field());
  const second = matchRows().highlighted;
  await card.press("ArrowDown", card.field());
  const typed = matchRows().highlighted;
  await card.press("Enter", card.field());
  await card.press("ArrowDown", card.field());
  await card.press("Enter", card.field(), { metaKey: true });

  assert.equal(second, "Rotate the deploy keyOPS-7");
  assert.equal(typed, "Create task “deploy”");
  assert.deepEqual(card.starts, [
    ["deploy", "acme/web"],
    ["deploy", "acme/web"],
  ]);
  assert.deepEqual(card.fromIssues, [undefined, undefined]);
});

test("Escape puts the issues away and leaves the card, a second puts the card away, and typing brings the issues back", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES);
  card.type("stack");
  await settle();

  await card.press("Escape", card.field());
  const afterFirst = { rows: matchRows().rows.length, card: card.dialog() !== null };
  card.type("stacked");
  await settle();
  const retyped = matchRows().rows.length;
  await card.press("Escape", card.field());
  await card.press("Escape", card.field());

  assert.deepEqual(afterFirst, { rows: 0, card: true });
  assert.equal(retyped, 2);
  assert.equal(card.dialog(), null);
  assert.deepEqual(card.starts, []);
});

test("a name no issue matches is the plain field it always was: nothing listed, and Return creates the task under it", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES);
  card.type("Refactor billing");
  await settle();

  const listed = document.querySelector('[role="listbox"]');
  await card.press("Enter", card.field());

  assert.equal(listed, null);
  assert.equal(card.field().getAttribute("aria-expanded"), "false");
  assert.deepEqual(card.starts, [["Refactor billing", "acme/web"]]);
  assert.deepEqual(card.fromIssues, [undefined]);
});

/** Longer than the typing rests before Linear is searched. */
const PAST_SEARCH_PAUSE = 300;

/** The clock moved past the search's pause, and what the search answered drawn. */
async function rest(): Promise<void> {
  act(() => {
    vi.advanceTimersByTime(PAST_SEARCH_PAUSE);
  });
  await settle();
}

/** An issue older than any the card read as it opened, which only Linear's own search finds. */
const OLDER_ISSUE: LinearIssueSummary = {
  id: "issue-301",
  identifier: "ENG-301",
  title: "Queue jumps on retry",
  url: "https://linear.app/acme/issue/ENG-301",
  state: "Backlog",
};

test("once the typing rests, Linear itself is searched for the words, and an issue it finds beyond those read stands after the ones read", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const card = await mount(undefined, undefined, {}, ISSUES, (ask) =>
      ask.query === "deploy queue"
        ? [OLDER_ISSUE, ISSUES[0] ?? assert.fail("the first issue")]
        : [],
    );
    card.type("deploy");
    await settle();
    card.type("deploy queue");
    await settle();
    const before = { rows: matchRows().rows, asks: card.asks.length };
    await rest();
    const after = matchRows().rows;

    assert.deepEqual(before, {
      rows: ["Restack the deploy queueENG-1 · Todo", "Create task “deploy queue”"],
      asks: 0,
    });
    assert.deepEqual(card.asks, [{ query: "deploy queue" }]);
    assert.deepEqual(after, [
      "Restack the deploy queueENG-1 · Todo",
      "Queue jumps on retryENG-301 · Backlog",
      "Create task “deploy queue”",
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("a pasted link to an issue, or its key typed alone, asks Linear for that one issue, which is offered first and started by Return", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const card = await mount(undefined, undefined, {}, ISSUES, (ask) =>
      ask.identifier === "ENG-301" ? [OLDER_ISSUE] : [],
    );
    card.type("https://linear.app/acme/issue/ENG-301/queue-jumps-on-retry");
    await rest();
    const listed = matchRows();
    await card.press("Enter", card.field());
    card.type("eng-301");
    await rest();

    assert.deepEqual(card.asks, [{ identifier: "ENG-301" }, { identifier: "ENG-301" }]);
    assert.deepEqual(listed.highlighted, "Queue jumps on retryENG-301 · Backlog");
    assert.deepEqual(card.starts, [["Queue jumps on retry", "acme/web"]]);
    assert.deepEqual(card.fromIssues, ["issue-301"]);
  } finally {
    vi.useRealTimers();
  }
});

test("opened on one of the workspace's issues, the card says so, starts named by the issue in its workspace, searches no Linear, and links the task to the issue", async () => {
  const issue = {
    id: "issue-1",
    workspaceId: "workspace-2",
    identifier: "ACME-7",
    title: "Invites expire",
  };
  const linear: LinearIssueSummary = {
    id: "linear-1",
    identifier: "ENG-1",
    title: "Invites expire in Linear",
    url: "https://linear.app/acme/issue/ENG-1",
  };
  const card = await mount(undefined, { issue }, {}, [linear]);

  assert.match(card.dialog()?.querySelector("h2")?.textContent ?? "", /^New task from ACME-7\b/);
  assert.equal(card.field().value, "Invites expire");
  assert.equal(card.field().placeholder, "Task name (optional)");
  card.type("Invites expire");
  await settle();
  assert.equal(document.querySelector('[role="option"]'), null, "no Linear issue is offered");
  await card.press("Enter", card.field());

  assert.deepEqual(card.starts, [["Invites expire", "acme/web"]]);
  assert.deepEqual(card.fromWorkspaceIssues, ["issue-1"]);
  assert.deepEqual(card.fromIssues, [undefined]);
  assert.deepEqual(card.startedIn, ["workspace-2"]);
});
