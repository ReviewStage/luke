// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { OpenSettingsProvider } from "@luke/panel/open-settings";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "@luke/panel/testing/composer";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import type { LinearIssuesAsk } from "@luke/ui/tasks-model";
import { Effect } from "effect";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { tasksControl } from "#testing/tasks-control";
import { NewTaskDialog } from "./new-task-dialog";
import type { RepositoryChooser } from "./repository-chip";
import type { NewTaskAgent, NewTaskPreset, NewTaskStart } from "./use-tasks-tab";

/**
 * New task as the developer meets it: a card over the window holding the
 * workspace it starts in and the composer, whose words start a coding agent
 * in Agent mode, or the plan and a call with Luke in Plan mode, with the
 * repository and Linear chips and the Plan toggle at its foot. Each test
 * stands the dialog in an owner that opens it and puts it away as the tab
 * does, so closing is read as the card leaving the window.
 */

const roots: Root[] = [];

// SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
const UNAVAILABLE = Object.fromEntries(
  INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.UNAVAILABLE]),
) as Record<IntegrationProvider, IntegrationStatus>;

/** The key New task keeps its mode under, which a test sets to stand the card in Plan mode. */
const MODE_KEY = "luke.new-task-mode";

/** The models the composer's chip offers: Opus, and its fast version. */
const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
];

/** The account's default model, as the composer's chip reads it. */
const DEFAULT_CHOICE: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" };

// Landed before any card renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
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

/** The card stood in Plan mode, as New task keeps the mode it was left in. */
function keptInLukeMode(): void {
  window.localStorage.setItem(MODE_KEY, "plan");
}

/**
 * The dialog open in its owner, a start answered by `answer` and each
 * start's name and repository written down, with the agent it asked for;
 * `preset` is what the press that opened it chose, a repository as a
 * repository group's + does or an issue as its Start task… does, `issues`
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
  const agents: (NewTaskAgent | undefined)[] = [];
  const agentsAtOnce: (boolean | undefined)[] = [];
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
        models: MODELS,
        readDefault: () => Promise.resolve({ choice: DEFAULT_CHOICE }),
        start: (
          name: string,
          repository: string | null,
          workspaceId: string | undefined,
          planning: boolean,
          from?: NewTaskStart,
        ) => {
          starts.push([name, repository]);
          planned.push(planning);
          agents.push(from?.handed);
          agentsAtOnce.push(from?.agent);
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
  const field = (): HTMLElement => composerEditor(document);
  const button = (label: string) => {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.getAttribute("aria-label") === label || each.textContent?.startsWith(label),
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
    /** The coding agent each start handed its words, where it asked for one. */
    agents,
    /** Whether each start asked an agent to start on its task's plan at once. */
    agentsAtOnce,
    /** Every Settings link the dialog's presses followed. */
    links,
    opener,
    dialog,
    field,
    button,
    /** Words typed into the composer at its caret. */
    type: (words: string) => typeInComposer(document, words),
    /** A key pressed in the composer's field. */
    key: async (key: string, held: KeyboardEventInit = {}) => {
      pressInComposer(document, key, held);
      await settle();
    },
    press,
    /** Stands the dialog again over another chooser, as a workspace switch or the first workspaces read hands it. */
    rechoose: async (next: Partial<RepositoryChooser>) => {
      repositories = { ...repositories, ...next };
      act(() => root.render(createElement(Owner)));
      await settle();
    },
    note: () => document.querySelector('[role="alert"]')?.textContent ?? undefined,
    /** What the composer asks for while its box is empty. */
    placeholder: () => document.querySelector(".agent-composer-placeholder")?.textContent,
    /** The round Start button, by the name each mode gives it. */
    startButton: () =>
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Start agent"], button[aria-label="Start planning"]',
      ) ?? assert.fail("the round Start button stands"),
    /** The card's buttons in order, as a reader meets them. */
    controls: () =>
      [...(dialog()?.querySelectorAll("button") ?? [])]
        .filter((each) => getComputedStyle(each).display !== "none")
        .map((each) => each.getAttribute("aria-label") ?? each.textContent),
  };
}

/** The Plan toggle, pressed where `planning` is. */
function modeToggle(): HTMLButtonElement {
  return (
    document.querySelector<HTMLButtonElement>('button[aria-label="Plan with Luke first"]') ??
    assert.fail("the Plan toggle stands")
  );
}

test("the card holds the composer with its words focused, the repository chip after the +, and the Plan toggle, the model chip on the account's default, and Start at its foot", async () => {
  const card = await mount();
  const controls = card.controls();

  assert.equal(document.activeElement, card.field());
  assert.equal(card.placeholder(), "Describe the change for a coding agent…");
  for (const each of ["Attach files", "acme/web", "Plan with Luke first", "Start agent"]) {
    assert.ok(controls.includes(each), `${each} stands in the card`);
  }
  assert.ok(
    controls.indexOf("acme/web") < controls.indexOf("Plan with Luke first"),
    "the repository chip leads the foot",
  );
  assert.equal(
    document.querySelector(".agent-model-chip")?.textContent?.includes("Opus"),
    true,
    "the model chip names the account's default",
  );
  assert.equal(modeToggle().getAttribute("aria-pressed"), "false", "New task starts in Agent mode");
});

test("Agent mode: Return starts the task without planning, Untitled, on the repository last used, and an agent on the words with the chip's model", async () => {
  const card = await mount();
  assert.equal(card.startButton().disabled, true, "an empty box starts nothing");
  card.type("  Make the sidebar keep its folds.  ");
  await card.key("Enter");

  assert.deepEqual(card.starts, [["", "acme/web"]]);
  assert.deepEqual(card.planned, [false]);
  const [{ idempotencyKey, ...agent } = { idempotencyKey: "" }] = card.agents;
  assert.deepEqual(agent, {
    prompt: "Make the sidebar keep its folds.",
    attachments: [],
    choice: DEFAULT_CHOICE,
  });
  assert.ok(idempotencyKey, "the agent's start carries the card's key");
});

test("a model picked on the chip runs this agent alone, and the account's default is not written", async () => {
  const card = await mount();
  const chip =
    document.querySelector<HTMLButtonElement>(".agent-model-chip button") ??
    assert.fail("the model chip stands");
  act(() => chip.click());
  const fast =
    document.querySelector<HTMLButtonElement>('[role="switch"]') ??
    assert.fail("the menu offers Fast");
  act(() => fast.click());
  await settle();
  card.type("Speed up the build");
  await card.key("Enter");

  assert.equal(card.agents[0]?.choice?.model, "anthropic/claude-opus-5.5-fast");
});

test("a server whose sign-in expired is offered nowhere in the card, which hands an agent no servers", async () => {
  fakeAppBridge({
    act: (request: Act) =>
      Promise.resolve(
        request.kind === ACT_KIND.INTEGRATIONS_STATUS
          ? {
              status: ACT_OUTCOME_STATUS.DONE,
              value: {
                integrations: {
                  ...UNAVAILABLE,
                  [INTEGRATION_PROVIDER.SLACK]: INTEGRATION_STATUS.EXPIRED,
                },
              },
            }
          : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
      ),
  });
  const card = await mount();
  await settle();

  assert.equal(card.dialog()?.textContent?.includes("sign-in expired"), false);
});

test("Command-Return while a file is still being read starts no bare task", async () => {
  const card = await mount();
  const picker =
    card.dialog()?.querySelector<HTMLInputElement>('input[type="file"]') ??
    assert.fail("the + has its file picker");
  const file = new File(["# Notes"], "notes.md", { type: "text/markdown" });
  Object.defineProperty(picker, "files", { configurable: true, value: [file] });
  act(() => {
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  pressInComposer(document, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(
    card.agents.filter((agent) => agent === undefined),
    [],
    "no bare task starts",
  );
});

test("Shift+Return is a new line, and the agent is handed both lines", async () => {
  const card = await mount();
  card.type("Fix the refresh\nand add a test");
  await card.key("Enter");

  assert.deepEqual(card.starts.length, 1);
  assert.equal(card.agents[0]?.prompt, "Fix the refresh\nand add a test");
});

test("Plan mode: Shift+Tab turns it on, the model chip stands down, and Start begins the plan and its call, named by the words' first line", async () => {
  const card = await mount();
  await card.key("Tab", { shiftKey: true });
  const placeholder = card.placeholder();
  const modelChip = document.querySelector(".agent-model-chip");
  card.type("Rethink automations\nwhich agent they reuse");
  await card.key("Enter");

  assert.equal(modeToggle().getAttribute("aria-pressed"), "true");
  assert.equal(placeholder, "What should you and Luke plan? (optional)");
  assert.equal(modelChip, null);
  assert.deepEqual(card.starts, [["Rethink automations", "acme/web"]]);
  assert.deepEqual(card.planned, [true]);
  assert.deepEqual(card.agents, [undefined], "no agent is started");
});

test("Plan mode starts with nothing typed and with no repository, as today's blank plan", async () => {
  keptInLukeMode();
  const card = await mount(undefined, undefined, { recent: [] });
  assert.equal(card.startButton().disabled, false);
  act(() => card.startButton().click());
  await settle();

  assert.deepEqual(card.starts, [["", null]]);
  assert.deepEqual(card.planned, [true]);
});

test("Agent mode with no repository holds Start and says why under the card, and turning on Plan lets it go", async () => {
  const card = await mount(undefined, undefined, { recent: [] });
  card.type("Write the migration");
  await card.key("Enter");
  const held = {
    disabled: card.startButton().disabled,
    why: card
      .dialog()
      ?.textContent?.includes(
        "An agent needs a repository to work in. Choose one, or turn on Plan.",
      ),
  };
  act(() => modeToggle().click());
  await settle();
  const why = card.dialog()?.textContent?.includes("An agent needs a repository");
  await card.key("Enter");

  assert.deepEqual(held, { disabled: true, why: true });
  assert.equal(why, false);
  assert.deepEqual(card.starts, [["Write the migration", null]]);
  assert.deepEqual(card.planned, [true]);
});

test("the mode is kept for the next New task, and Agent mode stands where only the old Plan switch's choice was kept", async () => {
  window.localStorage.setItem("luke.new-task-planning", "true");
  const first = await mount();
  const firstMode = modeToggle().getAttribute("aria-pressed");
  act(() => modeToggle().click());
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  await mount();

  assert.equal(firstMode, "false");
  assert.equal(modeToggle().getAttribute("aria-pressed"), "true");
  assert.ok(first);
});

test("Command-Return on an empty Agent-mode box starts a bare task: no planning and no agent", async () => {
  const card = await mount(undefined, undefined, { recent: [] });
  await card.key("Enter", { metaKey: true });

  assert.deepEqual(card.starts, [["", null]]);
  assert.deepEqual(card.planned, [false]);
  assert.deepEqual(card.agents, [undefined]);
});

test("a repository group's + opens the card on its repository rather than the last used", async () => {
  const card = await mount(undefined, { repository: "acme/api" });
  card.type("Rate limits");
  await card.key("Enter");
  assert.deepEqual(card.starts, [["", "acme/api"]]);
});

test("Escape puts the card away with nothing started, and focus goes back to what opened it", async () => {
  const card = await mount();
  card.type("Dark mode");
  await card.key("Escape");
  assert.equal(card.dialog(), null);
  assert.equal(document.activeElement, card.opener);
  assert.deepEqual(card.starts, []);
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

test("a refusal keeps the card and the words, says why under it, and Retry starts again", async () => {
  const card = await mount("Luke can't reach acme/web.");
  card.type("Dark mode toggle");
  await card.key("Enter");
  assert.ok(card.dialog());
  assert.match(card.note() ?? "", /Luke can't reach acme\/web\./u);
  assert.equal(card.field().textContent, "Dark mode toggle");
  act(() => card.button("Retry").click());
  await settle();
  assert.equal(card.starts.length, 2);
});

test("Retry after an agent's start that did not land carries the same key, and other words carry another", async () => {
  const card = await mount("The service did not answer.");
  card.type("Dark mode toggle");
  await card.key("Enter");
  act(() => card.button("Retry").click());
  await settle();
  card.type(" for the sidebar");
  await card.key("Enter");
  const keys = card.agents.map((agent) => agent?.idempotencyKey);

  assert.equal(keys.length, 3);
  assert.equal(keys[1], keys[0], "a press asking the same again is the same start");
  assert.notEqual(keys[2], keys[1], "other words are another start");
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
  await dialog.key("Enter");

  assert.deepEqual(dialog.starts, [["", "acme/relay"]]);
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
  await dialog.key("Enter");

  assert.deepEqual(dialog.starts, [["", "alice/private"]]);
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

test("in a workspace with no GitHub connected, a repository its plans still name is neither offered nor chosen, the chip reads No repository, and Plan mode starts the task with none", async () => {
  keptInLukeMode();
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
  await dialog.key("Enter");

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
  keptInLukeMode();
  const unlisted = await mount(undefined, undefined, { read: listing });
  unlisted.type("Dark mode");
  await unlisted.key("Enter");
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  const listed = await mount(undefined, { repository: "acme/api" }, { read: listing });
  listed.type("Rate limits");
  await listed.key("Enter");

  assert.deepEqual(unlisted.starts, [["Dark mode", null]]);
  assert.deepEqual(listed.starts, [["Rate limits", "acme/api"]]);
});

test("the repository menu names each repository first and its owner after it, so two that share an owner tell apart, and finds one by its owner/name", async () => {
  keptInLukeMode();
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
  await dialog.key("Enter");

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

/** What the Linear chip is named, and its search field's. */
const LINEAR_CHIP = '[aria-label="Choose from Linear"]';
const LINEAR_SEARCH = 'input[aria-label="Search issues, or paste a key or link"]';

/** The Linear chip's search, open. */
function linearSearch(): HTMLInputElement {
  return (
    document.querySelector<HTMLInputElement>(LINEAR_SEARCH) ??
    assert.fail("the Linear chip's search is open")
  );
}

/** The Linear chip pressed, and its search as it opens. */
async function openLinear(): Promise<HTMLInputElement> {
  const chip =
    document.querySelector<HTMLButtonElement>(LINEAR_CHIP) ?? assert.fail("the Linear chip stands");
  act(() => chip.click());
  await settle();
  return linearSearch();
}

/** Words typed into the Linear chip's search. */
function search(words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(linearSearch(), words);
    linearSearch().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The rows any open list draws, each as it reads, and which one is highlighted. */
function issueRows() {
  const options = [...document.querySelectorAll('[role="listbox"] [role="option"]')];
  const words = (row: Element) => row.textContent?.trim() ?? "";
  return {
    rows: options.map(words),
    highlighted: options
      .filter((row) => row.getAttribute("aria-selected") === "true")
      .map(words)
      .at(0),
  };
}

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

/** The Linear issue laid over the words, as its chip reads, or nothing where none is. */
function issueChip(): string | undefined {
  return document.querySelector("[data-issue-chip]")?.textContent ?? undefined;
}

test("with Linear connected, typing in the box lists no issues and searches no Linear", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const card = await mount(undefined, undefined, {}, ISSUES);
    card.type("stack");
    await rest();
    const listed = document.querySelector('[role="listbox"]');
    await card.key("Enter");

    assert.equal(listed, null);
    assert.deepEqual(card.asks, []);
    assert.deepEqual(card.fromIssues, [undefined]);
    assert.equal(card.agents[0]?.prompt, "stack");
  } finally {
    vi.useRealTimers();
  }
});

test("the Linear chip stands after the repository chip only where the workspace has Linear connected", async () => {
  const connected = await mount(undefined, undefined, {}, ISSUES);
  const withLinear = connected.controls();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  const plain = await mount();

  assert.equal(
    withLinear.indexOf("Choose from Linear"),
    withLinear.indexOf("acme/web") + 1,
    "the Linear chip follows the repository chip",
  );
  assert.equal(plain.controls().includes("Choose from Linear"), false);
});

test("choosing an issue from the Linear chip lays it over the words as a chip and starts nothing; Return then starts an agent on a mention of it and the words, the task named by it and linked to it", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES);
  const field = await openLinear();
  const listed = issueRows();
  await card.press("ArrowDown", field);
  const moved = issueRows().highlighted;
  await card.press("Enter", field);
  const chosen = { chip: issueChip(), starts: card.starts.length };
  card.type("Reproduce it first.");
  await card.key("Enter");

  assert.deepEqual(listed, {
    rows: [
      "Restack the deploy queueENG-1 · Todo",
      "Add support for stacked PRsENG-2 · In Progress",
      "Rotate the deploy keyOPS-7",
    ],
    highlighted: "Restack the deploy queueENG-1 · Todo",
  });
  assert.equal(moved, "Add support for stacked PRsENG-2 · In Progress");
  assert.deepEqual(chosen, { chip: "ENG-2Add support for stacked PRsIn Progress", starts: 0 });
  assert.deepEqual(card.starts, [["Add support for stacked PRs", "acme/web"]]);
  assert.deepEqual(card.planned, [false]);
  assert.deepEqual(card.fromIssues, ["issue-2"]);
  assert.equal(
    card.agents[0]?.prompt,
    "[@ENG-2 Add support for stacked PRs](https://linear.app/acme/issue/ENG-2)\n\nReproduce it first.",
  );
});

test("an issue picked and Return with no words starts an agent on the issue alone; its × lets it go, and Plan mode hands it to Luke as before", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES);
  await openLinear();
  await card.press("Enter", linearSearch());
  await card.key("Enter");
  const dropped = await (async () => {
    await openLinear();
    await card.press("Enter", linearSearch());
    act(() => card.button("Remove issue").click());
    await settle();
    return issueChip();
  })();
  await openLinear();
  await card.press("Enter", linearSearch());
  act(() => modeToggle().click());
  await settle();
  act(() => card.startButton().click());
  await settle();

  assert.equal(
    card.agents[0]?.prompt,
    "[@ENG-1 Restack the deploy queue](https://linear.app/acme/issue/ENG-1)",
  );
  assert.equal(dropped, undefined);
  assert.deepEqual(card.starts.at(-1), ["Restack the deploy queue", "acme/web"]);
  assert.deepEqual(card.planned.at(-1), true);
  assert.deepEqual(card.fromIssues.at(-1), "issue-1");
  assert.equal(card.agents.at(-1), undefined);
});

test("typing in the Linear search narrows the issues at once, and once it rests Linear itself is searched, an issue it finds beyond those read standing after them", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const card = await mount(undefined, undefined, {}, ISSUES, (ask) =>
      ask.query === "deploy queue"
        ? [OLDER_ISSUE, ISSUES[0] ?? assert.fail("the first issue")]
        : [],
    );
    await openLinear();
    search("deploy");
    await settle();
    const narrowed = issueRows().rows;
    search("deploy queue");
    await settle();
    const before = { rows: issueRows().rows, asks: card.asks.length };
    await rest();

    assert.deepEqual(narrowed, [
      "Restack the deploy queueENG-1 · Todo",
      "Rotate the deploy keyOPS-7",
    ]);
    assert.deepEqual(before, { rows: ["Restack the deploy queueENG-1 · Todo"], asks: 0 });
    assert.deepEqual(card.asks, [{ query: "deploy queue" }]);
    assert.deepEqual(issueRows().rows, [
      "Restack the deploy queueENG-1 · Todo",
      "Queue jumps on retryENG-301 · Backlog",
    ]);
    assert.deepEqual(card.starts, []);
  } finally {
    vi.useRealTimers();
  }
});

test("an issue Linear finds that sorts ahead of the highlighted one leaves the highlight, and Return, on the issue the arrows chose", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const redeploy: LinearIssueSummary = {
      id: "issue-9",
      identifier: "ENG-9",
      title: "Redeploy the docs",
      url: "https://linear.app/acme/issue/ENG-9",
    };
    const dashboard: LinearIssueSummary = {
      id: "issue-400",
      identifier: "ENG-400",
      title: "Deploy dashboard",
      url: "https://linear.app/acme/issue/ENG-400",
    };
    const card = await mount(
      undefined,
      undefined,
      {},
      [ISSUES[0] ?? assert.fail("the first issue"), redeploy],
      (ask) => (ask.query === "deploy" ? [dashboard] : []),
    );
    await openLinear();
    search("deploy");
    await settle();
    await card.press("ArrowDown", linearSearch());
    const chosen = issueRows().highlighted;
    await rest();
    const answered = issueRows();
    await card.press("Enter", linearSearch());

    assert.equal(chosen, "Redeploy the docsENG-9");
    assert.deepEqual(answered, {
      rows: [
        "Restack the deploy queueENG-1 · Todo",
        "Deploy dashboardENG-400",
        "Redeploy the docsENG-9",
      ],
      highlighted: "Redeploy the docsENG-9",
    });
    assert.equal(issueChip(), "ENG-9Redeploy the docs");
  } finally {
    vi.useRealTimers();
  }
});

test("a link to an issue pasted in the Linear search asks Linear for that one issue, which is offered first and chosen by Return", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const card = await mount(undefined, undefined, {}, ISSUES, (ask) =>
      ask.identifier === "ENG-301" ? [OLDER_ISSUE] : [],
    );
    await openLinear();
    search("https://linear.app/acme/issue/ENG-301/queue-jumps-on-retry");
    await rest();
    const listed = issueRows();
    await card.press("Enter", linearSearch());

    assert.deepEqual(card.asks, [{ identifier: "ENG-301" }]);
    assert.equal(listed.highlighted, "Queue jumps on retryENG-301 · Backlog");
    assert.equal(issueChip(), "ENG-301Queue jumps on retryBacklog");
    assert.deepEqual(card.starts, []);
  } finally {
    vi.useRealTimers();
  }
});

test("Escape closes the Linear search and leaves the card with focus on the chip, and Escape from the words puts the card away", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES);
  const field = await openLinear();
  await card.press("Escape", field);
  const afterFirst = {
    search: document.querySelector(LINEAR_SEARCH) !== null,
    card: card.dialog() !== null,
    focus: document.activeElement?.getAttribute("aria-label"),
  };
  await card.key("Escape");

  assert.deepEqual(afterFirst, { search: false, card: true, focus: "Choose from Linear" });
  assert.equal(card.dialog(), null);
  assert.deepEqual(card.starts, []);
});

test("Command-L from the words opens the Linear search, but not while an input method composes, and Escape hands focus back to the words", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES);
  await card.key("l", { metaKey: true, isComposing: true });
  assert.equal(
    document.querySelector(LINEAR_SEARCH) !== null,
    false,
    "a composing key opens nothing",
  );
  await card.key("l", { metaKey: true });
  const opened = document.activeElement === linearSearch();
  await card.press("Escape", linearSearch());

  assert.equal(opened, true);
  assert.equal(document.querySelector(LINEAR_SEARCH) !== null, false, "the search is closed");
  assert.equal(document.activeElement, card.field());
  assert.ok(card.dialog());
});

test("opened on one of the workspace's issues, the card says so, starts named by the issue in its workspace, offers no Linear chip, and links the task to the issue", async () => {
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
  assert.equal(document.querySelector(LINEAR_CHIP), null, "no Linear chip is offered");
  await card.key("l", { metaKey: true });
  assert.equal(document.querySelector(LINEAR_SEARCH) !== null, false, "Command-L opens nothing");
  await card.key("Enter");
  card.type("Make them last a week");
  await card.key("Enter");

  assert.deepEqual(card.starts, [
    ["Invites expire", "acme/web"],
    ["Invites expire", "acme/web"],
  ]);
  assert.deepEqual(
    card.agentsAtOnce,
    [true, undefined],
    "with nothing written the agent starts on the plan",
  );
  assert.equal(card.agents[1]?.prompt, "Make them last a week");
  assert.deepEqual(card.fromWorkspaceIssues, ["issue-1", "issue-1"]);
  assert.deepEqual(card.fromIssues, [undefined, undefined]);
  assert.deepEqual(card.startedIn, ["workspace-2", "workspace-2"]);
});

test("opened as a new agent's card on an issue, it offers no Plan toggle, holds Start until a repository is chosen, and asks an agent to start on the task at once", async () => {
  keptInLukeMode();
  const issue = {
    id: "issue-1",
    workspaceId: "workspace-2",
    identifier: "ACME-7",
    title: "Invites expire",
  };
  const card = await mount(undefined, { issue, agent: true }, { recent: [] });

  assert.match(card.dialog()?.querySelector("h2")?.textContent ?? "", /^New agent from ACME-7\b/);
  assert.equal(card.controls().includes("Plan with Luke first"), false);
  await card.key("Enter");
  assert.deepEqual(card.starts, [], "no agent is asked for with no repository to work in");
  assert.match(card.dialog()?.textContent ?? "", /An agent needs a repository/u);

  await card.rechoose({ recent: ["acme/web"] });
  act(() => card.startButton().click());
  await settle();

  assert.deepEqual(card.starts, [["Invites expire", "acme/web"]]);
  assert.deepEqual(card.planned, [false]);
  assert.deepEqual(card.fromWorkspaceIssues, ["issue-1"]);
  assert.deepEqual(card.agentsAtOnce, [true]);
});
