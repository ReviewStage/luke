// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  GITHUB_AUTHOR_ASSOCIATION,
  type GitHubIssuePick,
  type GitHubRepositoryIssuesAnswer,
  ISSUE_STATE,
  type RepositoryIssuesAsk,
} from "@luke/features/github-repositories-wire";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import {
  TASK_ISSUE_PROVIDER,
  TASK_ISSUE_RELATION,
  type TaskIssueChoice,
} from "@luke/features/task-issue-wire";
import { TASK_STATUS, TASK_TREE_ENTRY, type TaskStatus } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import type { LinearIssuesAsk } from "@luke/ui/tasks-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActPort,
  fakeActs,
  fakeAppBridge,
} from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { NewTaskDialog } from "./new-task-dialog.js";
import type { RepositoryChooser } from "./repository-chip.js";
import type { NewTaskAgent, NewTaskPreset, NewTaskStart } from "./use-tasks-tab.js";

/**
 * New task as the developer meets it: a card over the window whose head row
 * holds its title, the repository chip, and the Issue chip at the right,
 * over the composer, whose words start a coding agent in Agent mode, or the
 * plan and a call with Luke in Plan mode, with the Plan toggle at its foot. Each test
 * stands the dialog in an owner that opens it and puts it away as the tab
 * does, so closing is read as the card leaving the window, on a registry
 * of its own, as one launch of the window holds.
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
  fakeAppBridge({});
  fakeActPort({});
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
 * repository group's + does, `issues` the workspace's Linear issues where it
 * has Linear connected, `finds` what its Linear answers a search or an
 * identifier with, and `github` what a repository's GitHub issues read
 * answers, where the workspace has GitHub connected.
 */
async function mount(
  answer: string | undefined = undefined,
  preset?: NewTaskPreset,
  chooser: Partial<RepositoryChooser> = {},
  issues?: readonly LinearIssueSummary[],
  finds: (ask: LinearIssuesAsk) => readonly LinearIssueSummary[] = () => [],
  github?: (repository: string, ask: RepositoryIssuesAsk) => GitHubRepositoryIssuesAnswer,
) {
  const starts: [string, string | null][] = [];
  const githubAsks: [string, RepositoryIssuesAsk][] = [];
  const choices: (readonly TaskIssueChoice[] | undefined)[] = [];
  const asks: LinearIssuesAsk[] = [];
  const planned: boolean[] = [];
  const agents: (NewTaskAgent | undefined)[] = [];
  const fromIssues: (readonly (string | number)[] | undefined)[] = [];
  const briefs: (string | undefined)[] = [];
  const startedIn: (string | undefined)[] = [];
  const statuses: (TaskStatus | undefined)[] = [];
  const control = tasksControl();
  let repositories: RepositoryChooser = {
    ...control.repositories,
    recent: ["acme/web", "acme/api"],
    ...chooser,
  };
  const links: SettingsLink[] = [];
  let registry = AtomRegistry.make();
  let listed = control.newTask.workspaceId;
  let openAgain = (): void => undefined;
  function Owner() {
    const [open, setOpen] = useState(true);
    openAgain = () => setOpen(true);
    const dialog = createElement(NewTaskDialog, {
      newTask: {
        ...control.newTask,
        workspaceId: listed,
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
          fromIssues.push(from?.issues?.map((issue) => ("id" in issue ? issue.id : issue.number)));
          choices.push(from?.issues);
          briefs.push(from?.brief);
          startedIn.push(workspaceId);
          statuses.push(from?.status);
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
        githubIssuesIn: () =>
          github === undefined
            ? undefined
            : (repository: string, ask: RepositoryIssuesAsk) => {
                githubAsks.push([repository, ask]);
                return Promise.resolve(github(repository, ask));
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
  let root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(Owner))));
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
    /** The issues each start linked, with their relations. */
    choices,
    /** Every read of a repository's GitHub issues, by repository, and what it asked. */
    githubAsks,
    /** The brief each start handed Luke, where it handed one. */
    briefs,
    /** The workspace each start asked for. */
    startedIn,
    /** The status each start asked its task to stand in, where it asked for one. */
    statuses,
    /** Whether each start asked for its planning phase. */
    planned,
    /** The coding agent each start handed its words, where it asked for one. */
    agents,
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
      act(() => root.render(onRegistry(registry, createElement(Owner))));
      await settle();
    },
    /** Stands the dialog again once the workspaces are read, listing `workspaceId`. */
    list: async (workspaceId: string | undefined) => {
      listed = workspaceId;
      act(() => root.render(onRegistry(registry, createElement(Owner))));
      await settle();
    },
    /** Opens New task again, as another press of it does. */
    reopen: async () => {
      act(() => openAgain());
      await settle();
    },
    /** Stands the window again from what it stored, as a relaunch does, the card open. */
    relaunch: async () => {
      act(() => root.unmount());
      registry = AtomRegistry.make();
      root = createRoot(container);
      roots.push(root);
      act(() => root.render(onRegistry(registry, createElement(Owner))));
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

test("the card holds the composer with its words focused, the repository chip in the head row after the title, and the Plan toggle, the model chip on the account's default, and Start at its foot", async () => {
  const card = await mount();
  const controls = card.controls();
  const head = card.dialog()?.querySelector(".new-task-head");
  const foot = card.dialog()?.querySelector(".prompt-input-footer");

  assert.equal(document.activeElement, card.field());
  assert.equal(card.placeholder(), "Describe the change for a coding agent…");
  for (const each of ["Attach files", "acme/web", "Plan with Luke first", "Start agent"]) {
    assert.ok(controls.includes(each), `${each} stands in the card`);
  }
  assert.equal(head?.querySelector("h2")?.textContent, "New task");
  assert.equal(head?.querySelector(".repository-chip")?.textContent, "acme/web");
  assert.equal(foot?.querySelector(".repository-chip"), null, "the foot holds no repository chip");
  assert.equal(
    document.querySelector('[aria-label^="Workspace"]'),
    null,
    "the card offers no workspace picker",
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
  assert.deepEqual(card.briefs, [undefined], "an agent's words are no brief");
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
  fakeActPort({
    [ACT_KIND.INTEGRATIONS_STATUS]: () =>
      Promise.resolve({
        integrations: { ...UNAVAILABLE, [INTEGRATION_PROVIDER.SLACK]: INTEGRATION_STATUS.EXPIRED },
      }),
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

test("once a repository is chosen, an @ offers its files, read through the workspace, and the row chosen is drawn as its chip and handed to the agent as its link", async () => {
  const told: AnyAct[] = [];
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      told.push(request);
      return Promise.resolve(
        request.kind === ACT_KIND.TASKS_TREE
          ? {
              status: FAKE_ANSWER.DONE,
              value: {
                folder: {
                  path: "",
                  repository: "acme/web",
                  branch: "main",
                  entries: [{ name: "apps/web/rollout-store.ts", kind: TASK_TREE_ENTRY.FILE }],
                  truncated: false,
                },
              },
            }
          : { status: FAKE_ANSWER.UNKNOWN_ACT },
      );
    },
  });
  const started: (NewTaskAgent | undefined)[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control = tasksControl();
  const draw = (recent: readonly string[]) =>
    act(() =>
      root.render(
        createElement(NewTaskDialog, {
          newTask: {
            ...control.newTask,
            open: true,
            workspaceId: "workspace-acme",
            repositoriesIn: () => ({ ...control.repositories, recent }),
            start: (...asked) => {
              started.push(asked[4]?.handed);
              return Promise.resolve(undefined);
            },
          },
        }),
      ),
    );
  // The card opens with no repository, and the words are begun before one is chosen.
  draw([]);
  await settle();
  typeInComposer(document, "Follow ");
  draw(["acme/web"]);
  await settle();
  const focused = document.activeElement === composerEditor(document);

  typeInComposer(document, "@roll");
  await settle();
  const offered = [...document.querySelectorAll(".mention-menu .luke-combobox-option-label")].map(
    (row) => row.textContent,
  );
  pressInComposer(document, "Enter");
  await settle();
  const chips = [...composerEditor(document).querySelectorAll("[data-mention-ref]")];
  pressInComposer(document, "Enter");
  await settle();

  assert.ok(focused, "the words keep the caret as the repository is chosen");
  assert.deepEqual(offered, ["rollout-store.ts"]);
  assert.deepEqual(
    told.filter((each) => each.kind === ACT_KIND.TASKS_TREE).map((each) => each.payload),
    [{ workspaceId: "workspace-acme", repository: "acme/web", path: "", recursive: true }],
  );
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["rollout-store.ts"],
  );
  const file = { kind: MENTION_KIND.FILE, path: "apps/web/rollout-store.ts" } as const;
  assert.equal(
    started[0]?.prompt,
    `Follow ${mentionMarkdown(file, "rollout-store.ts", { workspace: "workspace-acme", repository: "acme/web" })}`,
  );
});

test("a skill chosen from the / list is its chip, which opens its SKILL.md in the chosen repository on GitHub", async () => {
  const onGitHub: string[] = [];
  fakeAppPlatform(DESKTOP_LINKS);
  fakeActPort({
    [ACT_KIND.GITHUB_OPEN]: ({ url }) => {
      onGitHub.push(url);
      return Promise.resolve();
    },
    [ACT_KIND.TASKS_SKILLS]: () =>
      Promise.resolve({
        skills: {
          repository: "acme/web",
          branch: "main",
          skills: [
            {
              name: "release",
              description: "Cut a release.",
              path: ".agents/skills/release/SKILL.md",
            },
          ],
        },
      }),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control = tasksControl();
  act(() =>
    root.render(
      createElement(NewTaskDialog, {
        newTask: {
          ...control.newTask,
          open: true,
          workspaceId: "workspace-acme",
          repositoriesIn: () => ({ ...control.repositories, recent: ["acme/web"] }),
        },
      }),
    ),
  );
  await settle();

  typeInComposer(document, "/rel");
  await settle();
  pressInComposer(document, "Enter");
  await settle();
  const chip =
    composerEditor(document).querySelector<HTMLElement>(".skill-chip[data-opens]") ??
    assert.fail("the skill is a chip that opens");
  act(() => chip.click());

  assert.deepEqual(onGitHub, [
    "https://github.com/acme/web/blob/HEAD/.agents/skills/release/SKILL.md",
  ]);
});

test("Plan mode: Shift+Tab turns it on, the model chip stands down, and Start begins the plan and its call, Untitled, handing Luke the words as its brief", async () => {
  const card = await mount();
  await card.key("Tab", { shiftKey: true });
  const placeholder = card.placeholder();
  const modelChip = document.querySelector(".agent-model-chip");
  card.type("  Rethink automations\nwhich agent they reuse  ");
  await card.key("Enter");

  assert.equal(modeToggle().getAttribute("aria-pressed"), "true");
  assert.equal(placeholder, "What should you and Luke plan? (optional)");
  assert.equal(modelChip, null);
  assert.deepEqual(card.starts, [["", "acme/web"]], "the words name nothing");
  assert.deepEqual(card.briefs, ["Rethink automations\nwhich agent they reuse"]);
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
  assert.deepEqual(card.briefs, [undefined], "an empty box hands no brief");
  assert.deepEqual(card.fromIssues, [undefined]);
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
  assert.deepEqual(card.starts, [["", null]]);
  assert.deepEqual(card.briefs, ["Write the migration"]);
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

test("words left in a card put away come back as New task opens again and after a relaunch, and a task started lets them go", async () => {
  const card = await mount();
  card.type("Dark mode");
  await card.key("Escape");
  assert.equal(card.dialog(), null);

  await card.reopen();
  assert.equal(card.field().textContent, "Dark mode");
  await card.relaunch();
  assert.equal(card.field().textContent, "Dark mode");

  await card.key("Enter");
  assert.equal(card.agents[0]?.prompt, "Dark mode");
  await card.reopen();
  assert.equal(card.field().textContent, "");
  await card.relaunch();
  assert.equal(card.field().textContent, "");
});

test("words typed before the workspaces are read stay in the box as the workspace lands, over its older draft, and are its draft", async () => {
  const card = await mount();
  await card.list("workspace-personal");
  card.type("Fix login");
  await card.relaunch();
  await card.list(undefined);
  assert.equal(card.field().textContent, "");
  card.type("Dark mode");
  await card.list("workspace-personal");
  assert.equal(card.field().textContent, "Dark mode");

  await card.key("Escape");
  await card.reopen();
  assert.equal(card.field().textContent, "Dark mode");
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
  assert.deepEqual(dialog.starts, [["", null]]);
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

  assert.deepEqual(unlisted.starts, [["", null]]);
  assert.deepEqual(listed.starts, [["", "acme/api"]]);
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

  assert.deepEqual(dialog.starts, [["", `${owner}/billing-ledger-and-invoicing-pipeline`]]);
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

/** What the Issue chip is named, and its search field's. */
const ISSUE_CHIP = '[aria-label="Choose an issue"]';
const LINEAR_SEARCH = 'input[aria-label="Search issues, or paste a key, #number, or link"]';

/** The Issue chip's search, open. */
function linearSearch(): HTMLInputElement {
  return (
    document.querySelector<HTMLInputElement>(LINEAR_SEARCH) ??
    assert.fail("the Issue chip's search is open")
  );
}

/** The Issue chip pressed, and its search as it opens. */
async function openLinear(): Promise<HTMLInputElement> {
  const chip =
    document.querySelector<HTMLButtonElement>(ISSUE_CHIP) ?? assert.fail("the Issue chip stands");
  act(() => chip.click());
  await settle();
  return linearSearch();
}

/** Words typed into the Issue chip's search. */
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

test("the Issue chip stands at the right end of the head row, after the repository chip, only where the workspace offers issues", async () => {
  const connected = await mount(undefined, undefined, {}, ISSUES);
  const withLinear = connected.controls();
  const head = connected.dialog()?.querySelector(".new-task-head");
  const placed = {
    last: head?.lastElementChild?.querySelector(ISSUE_CHIP) !== null,
    inFoot: connected.dialog()?.querySelector(`.prompt-input-footer ${ISSUE_CHIP}`) !== null,
  };
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  const plain = await mount();

  assert.equal(
    withLinear.indexOf("Choose an issue"),
    withLinear.indexOf("acme/web") + 1,
    "the Issue chip follows the repository chip",
  );
  assert.deepEqual(placed, { last: true, inFoot: false });
  assert.equal(plain.controls().includes("Choose an issue"), false);
});

/** Each heading the open menu stands its issues under, with the issues under it as they read. */
function issueGroups(): Record<string, readonly string[]> {
  return Object.fromEntries(
    [...document.querySelectorAll('[role="listbox"] [role="group"]')].map((group) => [
      group.getAttribute("aria-label") ?? "",
      [...group.querySelectorAll('[role="option"]')].map((row) => row.textContent?.trim() ?? ""),
    ]),
  );
}

test("choosing a Linear issue from the Issue chip lays it over the words as a chip and starts nothing; Return then starts an agent on a mention of it and the words, the task named by it and linked to it", async () => {
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
  assert.deepEqual(chosen, { chip: "ENG-2Add support for stacked PRsCloses", starts: 0 });
  assert.deepEqual(card.starts, [["Add support for stacked PRs", "acme/web"]]);
  assert.deepEqual(card.planned, [false]);
  assert.deepEqual(card.fromIssues, [["issue-2"]]);
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
  assert.deepEqual(card.fromIssues.at(-1), ["issue-1"]);
  assert.equal(card.agents.at(-1), undefined);
});

test("Plan mode with an issue picked and words written names the task by the issue, links it, and hands Luke the words as its brief beside it", async () => {
  keptInLukeMode();
  const card = await mount(undefined, undefined, {}, ISSUES);
  await openLinear();
  await card.press("Enter", linearSearch());
  card.type("Keep the queue order stable.");
  await card.key("Enter");

  assert.deepEqual(card.starts, [["Restack the deploy queue", "acme/web"]]);
  assert.deepEqual(card.planned, [true]);
  assert.deepEqual(card.fromIssues, [["issue-1"]]);
  assert.deepEqual(card.briefs, ["Keep the queue order stable."]);
  assert.deepEqual(card.agents, [undefined]);
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
    assert.equal(issueChip(), "ENG-9Redeploy the docsCloses");
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
    assert.equal(issueChip(), "ENG-301Queue jumps on retryCloses");
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

  assert.deepEqual(afterFirst, { search: false, card: true, focus: "Choose an issue" });
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

test("File for later files the task in the backlog with no call and no agent, named by the words' first line and keeping them as its brief", async () => {
  const card = await mount();
  card.type("Rate limit the public search\nThirty a minute per installation.");
  act(() => card.button("File for later").click());
  await settle();

  assert.deepEqual(card.starts, [["Rate limit the public search", "acme/web"]]);
  assert.deepEqual(card.statuses, [TASK_STATUS.BACKLOG]);
  assert.deepEqual(card.planned, [false]);
  assert.deepEqual(card.agents, [undefined]);
  assert.deepEqual(card.briefs, [
    "Rate limit the public search\nThirty a minute per installation.",
  ]);
});

test("File for later is held while the box is empty, and Start's task names no status, so it starts to do", async () => {
  const card = await mount();
  assert.equal(card.button("File for later").disabled, true);

  card.type("Fix the refresh");
  await card.key("Enter");

  assert.deepEqual(card.statuses, [undefined]);
});

test("Retry after a refused File for later files the task for later again, rather than starting it", async () => {
  const card = await mount("Luke can't reach acme/web.");
  act(() => modeToggle().click());
  card.type("Rate limit search");
  act(() => card.button("File for later").click());
  await settle();
  act(() => card.button("Retry").click());
  await settle();

  assert.deepEqual(card.statuses, [TASK_STATUS.BACKLOG, TASK_STATUS.BACKLOG]);
  assert.deepEqual(card.planned, [false, false]);
});

test("a task filed for later is named by as much of its first line as a name holds, an emoji kept whole", async () => {
  const card = await mount();
  card.type(`${"a".repeat(199)}🚀 and more`);
  act(() => card.button("File for later").click());
  await settle();

  assert.deepEqual(
    card.starts.map(([name]) => name),
    ["a".repeat(199)],
  );
});

/** A GitHub issue of `repository`, opened by `author` standing to it as `association`. */
function githubIssue(
  repository: string,
  number: number,
  title: string,
  author = "priya",
  association: string = GITHUB_AUTHOR_ASSOCIATION.MEMBER,
): GitHubIssuePick {
  return {
    nodeId: `I_${repository}_${number}`,
    repository,
    number,
    title,
    url: `https://github.com/${repository}/issues/${number}`,
    state: ISSUE_STATE.OPEN,
    author,
    authorAssociation: association,
    updatedAt: Date.now(),
  };
}

const SAFARI = githubIssue("acme/web", 312, "Login fails on Safari 18");
const TOOLTIPS = githubIssue("acme/web", 301, "Chart tooltips unreadable", "j-random", "NONE");
const API_ISSUE = githubIssue("acme/api", 5, "Rate limit the search endpoint");

/** acme/web's open issues and its search, acme/api's one issue, and an installation that grants acme/ledger none. */
function acmeGitHub(repository: string, ask: RepositoryIssuesAsk): GitHubRepositoryIssuesAnswer {
  if (repository === "acme/ledger") {
    return {
      ungranted: { settingsUrl: "https://github.com/organizations/acme/settings/installations/7" },
    };
  }
  const open = repository === "acme/web" ? [SAFARI, TOOLTIPS] : [API_ISSUE];
  if (ask.number !== undefined)
    return { issues: open.filter((issue) => issue.number === ask.number) };
  if (ask.query === "cookie") return { issues: [SAFARI] };
  return { issues: ask.query === undefined ? open : [] };
}

test("the Issue chip lists the chosen repository's open GitHub issues under its own heading above Linear's, an author outside the repository wearing a badge, and words search GitHub once the typing rests", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const card = await mount(undefined, undefined, {}, ISSUES, () => [], acmeGitHub);
    await openLinear();
    const listed = issueRows().rows;
    const headings = Object.keys(issueGroups());
    const outside = [...document.querySelectorAll('[role="option"] .luke-badge')].map(
      (badge) => badge.textContent,
    );
    search("cookie");
    await settle();
    const before = card.githubAsks.filter(([, ask]) => ask.query !== undefined).length;
    await rest();

    assert.deepEqual(
      listed.slice(0, 2).map((row) => row.split("#")[0]),
      ["Login fails on Safari 18", "Chart tooltips unreadableoutside"],
    );
    assert.deepEqual(headings, ["GitHub · acme/web", "Linear"]);
    assert.deepEqual(outside, ["outside"]);
    assert.equal(before, 0, "the search waits for the typing to rest");
    assert.deepEqual(card.githubAsks.at(-1), ["acme/web", { query: "cookie" }]);
    assert.deepEqual(
      issueRows().rows.map((row) => row.split("#")[0]),
      ["Login fails on Safari 18"],
    );
  } finally {
    vi.useRealTimers();
  }
});

test("GitHub and Linear issues picked stand as chips with a Closes / Part of switch, and Return starts the task linked to each with its relation, named by the first", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES, () => [], acmeGitHub);
  await openLinear();
  await card.press("Enter", linearSearch());
  await openLinear();
  const marked = issueRows().rows[0];
  search("restack");
  await settle();
  await card.press("Enter", linearSearch());
  const chips = [...document.querySelectorAll("[data-issue-chip]")].map((chip) => chip.textContent);
  act(() => card.button("Closes").click());
  await settle();
  card.type("Fix both.");
  await card.key("Enter");

  assert.match(marked ?? "", /Linked$/u, "an issue linked already is not offered again");
  assert.deepEqual(chips, [
    "#312Login fails on Safari 18Closes",
    "ENG-1Restack the deploy queueCloses",
  ]);
  assert.deepEqual(card.starts, [["Login fails on Safari 18", "acme/web"]]);
  assert.deepEqual(card.choices, [
    [
      {
        provider: TASK_ISSUE_PROVIDER.GITHUB,
        repository: "acme/web",
        number: 312,
        relation: TASK_ISSUE_RELATION.PART_OF,
      },
      { provider: TASK_ISSUE_PROVIDER.LINEAR, id: "issue-1", relation: TASK_ISSUE_RELATION.CLOSES },
    ],
  ]);
  assert.equal(
    card.agents[0]?.prompt,
    "[@acme/web#312 Login fails on Safari 18](https://github.com/acme/web/issues/312)\n[@ENG-1 Restack the deploy queue](https://linear.app/acme/issue/ENG-1)\n\nFix both.",
  );
});

test("a pasted #N, owner/name#N, or link to a GitHub issue offers that one issue, and with no repository chosen picking it makes its repository the task's", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const card = await mount(undefined, undefined, { recent: [] }, undefined, () => [], acmeGitHub);
    await openLinear();
    const unchosen = issueRows().rows;
    search("acme/api#5");
    await rest();
    const pasted = issueRows().rows;
    await card.press("Enter", linearSearch());
    await openLinear();
    search("https://github.com/acme/api/issues/5");
    await rest();
    const linked = issueRows().rows;
    search("#7");
    await rest();
    const missing = issueRows().rows;
    act(() => card.button("Remove issue").click());
    await settle();
    card.type("Throttle it.");
    await card.key("Enter");

    assert.deepEqual(
      unchosen,
      [],
      "with no repository and nothing pasted, no GitHub section stands",
    );
    assert.deepEqual(
      pasted.map((row) => row.split("#")[0]),
      ["Rate limit the search endpoint"],
    );
    assert.match(linked[0] ?? "", /Linked$/u);
    assert.deepEqual(
      missing.map((row) => row.split("#")[0]),
      ["No open issues match"],
    );
    assert.deepEqual(card.starts, [["", "acme/api"]]);
    assert.ok(
      card.githubAsks.some(([repository, ask]) => repository === "acme/api" && ask.number === 5),
    );
  } finally {
    vi.useRealTimers();
  }
});

test("a change of repository lets go the GitHub issues picked in the one before, keeps Linear's, and reads the new one's issues", async () => {
  const card = await mount(undefined, undefined, {}, ISSUES, () => [], acmeGitHub);
  await openLinear();
  await card.press("Enter", linearSearch());
  await openLinear();
  search("restack");
  await settle();
  await card.press("Enter", linearSearch());
  await card.rechoose({ recent: ["acme/api"] });
  const chips = [...document.querySelectorAll("[data-issue-chip]")].map((chip) => chip.textContent);
  await openLinear();
  const listed = issueRows().rows;

  assert.deepEqual(chips, ["ENG-1Restack the deploy queueCloses"]);
  assert.equal(listed[0]?.split("#")[0], "Rate limit the search endpoint");
  assert.deepEqual(
    [...new Set(card.githubAsks.map(([repository]) => repository))],
    ["acme/web", "acme/api"],
  );
});

test("a repository whose installation grants Luke no issues says so in the GitHub section, whose row opens the installation's settings on GitHub, while Linear's issues stand beside it, and the menu opened again after a grant lists its issues", async () => {
  const opened: string[] = [];
  fakeAppPlatform({ openGitHub: (url) => opened.push(url) });
  let granted = false;
  const card = await mount(
    undefined,
    undefined,
    { recent: ["acme/ledger"] },
    ISSUES,
    () => [],
    (repository, ask) =>
      granted
        ? { issues: [githubIssue(repository, 4, "Ledger totals drift")] }
        : acmeGitHub(repository, ask),
  );
  await openLinear();
  const listed = issueRows().rows;
  await card.press("Enter", linearSearch());
  granted = true;
  await openLinear();
  const regranted = issueRows().rows[0]?.split("#")[0];

  assert.deepEqual(listed, [
    "Luke can't read acme/ledger's issues yetGrant access",
    "Restack the deploy queueENG-1 · Todo",
    "Add support for stacked PRsENG-2 · In Progress",
    "Rotate the deploy keyOPS-7",
  ]);
  assert.deepEqual(opened, ["https://github.com/organizations/acme/settings/installations/7"]);
  assert.equal(regranted, "Ledger totals drift");
  assert.equal(document.querySelector("[data-issue-chip]"), null);
  assert.deepEqual(card.starts, []);
});
