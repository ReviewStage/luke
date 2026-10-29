// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_BOUNDS } from "@luke/features/agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import { TASK_SKILL_SOURCE, TASK_TREE_ENTRY } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  agentKeyLink,
  SETTINGS_SECTION,
  SETTINGS_VIEW,
  type SettingsLink,
} from "@luke/settings/settings-views";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { OPEN_SETTINGS_LABEL, OpenSettingsProvider } from "../open-settings.js";
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
import { NEW_TASK_PURPOSE } from "./new-task-purpose.js";
import type { RepositoryChooser } from "./repository-chip.js";
import type { NewTaskAgent, NewTaskPreset, NewTaskStart } from "./use-tasks-tab.js";

/**
 * New task as the developer meets it: a card over the window whose head row
 * holds the repository chip, over the composer, whose words start a coding agent. Each test
 * stands the dialog in an owner that opens it and puts it away as the tab
 * does, so closing is read as the card leaving the window, on a registry
 * of its own, as one launch of the window holds.
 */

const roots: Root[] = [];

// SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
const UNAVAILABLE = Object.fromEntries(
  INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.UNAVAILABLE]),
) as Record<IntegrationProvider, IntegrationStatus>;

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

/**
 * The dialog open in its owner, a start answered by `answer` and each
 * start's name and repository written down, with the agent it asked for;
 * `preset` is what the press that opened it chose, a repository as a
 * repository group's + does; a start answered by a promise stays out until
 * the test settles it. An agent's start puts the card away as it is pressed
 * and a refusal opens it again on what it held, as the tab does.
 */
async function mount(
  answer: string | Failure | undefined | Promise<Failure | undefined> = undefined,
  preset?: NewTaskPreset,
  chooser: Partial<RepositoryChooser> = {},
) {
  const starts: [string, string | null][] = [];
  const agents: (NewTaskAgent | undefined)[] = [];
  const startedIn: (string | undefined)[] = [];
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
    const [reopened, setReopened] = useState<NewTaskPreset | undefined>(undefined);
    openAgain = () => setOpen(true);
    const dialog = createElement(NewTaskDialog, {
      newTask: {
        ...control.newTask,
        workspaceId: listed,
        open,
        preset: reopened ?? preset,
        repositoriesIn: () => repositories,
        models: MODELS,
        readDefault: () => Promise.resolve({ choice: DEFAULT_CHOICE }),
        start: (
          name: string,
          repository: string | null,
          workspaceId: string | undefined,
          from?: NewTaskStart,
        ) => {
          starts.push([name, repository]);
          agents.push(from?.handed);
          startedIn.push(workspaceId);
          const refused = Promise.resolve(answer).then((said) =>
            typeof said === "string" ? { reason: FAILURE_REASON.OTHER, text: said } : said,
          );
          const card = from?.card;
          if (from?.handed === undefined || card === undefined) return refused;
          // An agent's start puts the card away as it is pressed, and a refusal opens it again on what it held, as the tab does.
          setOpen(false);
          return refused.then((note) => {
            if (note !== undefined) {
              setReopened({
                ...(card.purpose === undefined ? undefined : { purpose: card.purpose }),
                refused: { card, note },
              });
              setOpen(true);
            }
            return note;
          });
        },
        onClose: () => setOpen(false),
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
    /** The workspace each start asked for. */
    startedIn,
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
    /** The round Start button, by its place at the foot's end, since an empty box names it for what ⌘Return does there. */
    startButton: () =>
      document.querySelector<HTMLButtonElement>('.luke-composer-foot button[type="submit"]') ??
      assert.fail("the round Start button stands"),
    /** The card's buttons in order, as a reader meets them. */
    controls: () =>
      [...(dialog()?.querySelectorAll("button") ?? [])]
        .filter((each) => getComputedStyle(each).display !== "none")
        .map((each) => each.getAttribute("aria-label") ?? each.textContent),
  };
}

test("the card, named New task, holds the composer with its words focused, the repository chip in the head row, and the model chip on the account's default and Start at its foot, with no Plan toggle", async () => {
  const card = await mount();
  const controls = card.controls();
  const head = card.dialog()?.querySelector(".new-task-head");
  const foot = card.dialog()?.querySelector(".luke-composer-foot");

  assert.equal(document.activeElement, card.field());
  assert.equal(card.placeholder(), "Describe the task");
  assert.equal(controls.includes("Plan with Luke first"), false, "no Plan toggle stands");
  for (const each of ["Attach files", "acme/web", "Start a task with no agent"]) {
    assert.ok(controls.includes(each), `${each} stands in the card`);
  }
  const name = card.dialog()?.getAttribute("aria-labelledby") ?? assert.fail("the card is named");
  assert.equal(document.getElementById(name)?.textContent, "New task");
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
});

test("Return starts the task without planning, Untitled, on the repository last used, and an agent on the words naming no model while the chip is unpicked", async () => {
  const card = await mount();
  assert.equal(card.startButton().disabled, true, "an empty box starts nothing");
  card.type("  Make the sidebar keep its folds.  ");
  await card.key("Enter");

  assert.deepEqual(card.starts, [["", "acme/web"]]);
  const [{ idempotencyKey, ...agent } = { idempotencyKey: "" }] = card.agents;
  assert.deepEqual(agent, {
    prompt: "Make the sidebar keep its folds.",
    attachments: [],
    choice: undefined,
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
              started.push(asked[3]?.handed);
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
    chips.map((chip) => chip.querySelector(".luke-inline-ref-label")?.textContent),
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
              source: TASK_SKILL_SOURCE.REPOSITORY,
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
    composerEditor(document).querySelector<HTMLElement>("[data-skill-ref]") ??
    assert.fail("the skill is a chip that opens");
  act(() => chip.click());

  assert.deepEqual(onGitHub, [
    "https://github.com/acme/web/blob/HEAD/.agents/skills/release/SKILL.md",
  ]);
});

test("a box with no repository holds Start and says why under the card", async () => {
  const card = await mount(undefined, undefined, { recent: [] });
  card.type("Write the migration");
  await card.key("Enter");

  assert.equal(card.startButton().disabled, true);
  // The chip asks for a repository too, so the note under the card is the second saying.
  assert.equal(card.dialog()?.textContent?.split("Choose a repository").length, 3);
  assert.deepEqual(card.starts, []);
});

test("Command-Return on an empty box starts a bare task: no planning and no agent", async () => {
  const card = await mount(undefined, undefined, { recent: [] });
  await card.key("Enter", { metaKey: true });

  assert.deepEqual(card.starts, [["", null]]);
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
  await card.key("Escape");
  assert.equal(card.dialog(), null);
  assert.equal(document.activeElement, card.opener);
  assert.deepEqual(card.starts, []);
});

test("a card holding words is nudged rather than put away by the first Escape, and put away by the next", async () => {
  const card = await mount();
  card.type("Dark mode");
  await card.key("Escape");
  const nudged = card.dialog()?.getAttribute("data-nudge");
  await card.key("Escape");

  assert.equal(nudged, "true", "the first Escape nudges the card and keeps it");
  assert.equal(card.dialog(), null);
  assert.equal(document.activeElement, card.opener);
  assert.deepEqual(card.starts, []);
});

test("words left in a card put away come back as New task opens again and after a relaunch, and a task started lets them go", async () => {
  const card = await mount();
  card.type("Dark mode");
  await card.key("Escape");
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

test("an agent's start still out lets its words go, so New task opened before it answers opens empty, and a refusal opens the card again on its words, saying why", async () => {
  let answer: (refused: Failure | undefined) => void = () => undefined;
  const card = await mount(
    new Promise<Failure | undefined>((resolve) => {
      answer = resolve;
    }),
  );
  card.type("Dark mode");
  await card.key("Enter");

  await card.reopen();
  assert.equal(card.field().textContent, "", "the card opened again is empty");
  await card.key("Escape");
  await act(async () =>
    answer({ reason: FAILURE_REASON.OTHER, text: "Luke cannot reach acme/web." }),
  );
  await settle();
  assert.equal(card.field().textContent, "Dark mode");
  assert.match(card.note() ?? "", /Luke cannot reach acme\/web\./u);
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
  const card = await mount("Luke cannot reach acme/web.");
  card.type("Dark mode toggle");
  await card.key("Enter");
  assert.ok(card.dialog());
  assert.match(card.note() ?? "", /Luke cannot reach acme\/web\./u);
  assert.equal(card.field().textContent, "Dark mode toggle");
  act(() => card.button("Retry").click());
  await settle();
  assert.equal(card.starts.length, 2);
});

test("a start refused for a missing credential says which harness to connect, and the card offers the same press the draft agent tab does, opening Settings at its row", async () => {
  const card = await mount({
    reason: FAILURE_REASON.CONNECT_AGENTS,
    text: "Connect Claude in Settings to start an agent.",
    provider: MODEL_PROVIDER.ANTHROPIC,
  });
  card.type("Dark mode toggle");
  await card.key("Enter");

  assert.match(card.note() ?? "", /Connect Claude in Settings to start an agent\./u);
  act(() => card.button("Connect Claude").click());
  await settle();
  assert.deepEqual(card.links, [agentKeyLink(MODEL_PROVIDER.ANTHROPIC)]);
  assert.equal(card.field().textContent, "Dark mode toggle", "the words stay");
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

/** A read answering that the App is installed and gives Luke no repository. */
const NOTHING_REACHED = () =>
  Promise.resolve({
    repositories: {
      installed: true,
      repositories: [],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  });

/** A workspace's people as the host answers them: two to ask, a third owner past the names a note gives, and a plain member. */
const PEOPLE: readonly WorkspaceMember[] = [
  { userId: "u-dean", name: "Dean", email: "dean@acme.test", role: WORKSPACE_ROLE.OWNER },
  { userId: "u-charles", name: "Charles", email: "charles@acme.test", role: WORKSPACE_ROLE.ADMIN },
  { userId: "u-sam", name: "Sam", email: "sam@acme.test", role: WORKSPACE_ROLE.MEMBER },
];

test("a member of a workspace with no GitHub connected is told which owners and admins to ask, and no member is named", async () => {
  fakeActPort({ [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve(PEOPLE) });
  await mount(undefined, undefined, {
    scope: "workspace-acme",
    workspaceName: "Acme",
    manages: false,
    read: NOWHERE_INSTALLED,
  });

  await openChip();
  await settle();

  assert.deepEqual(menuNotes(), ["Ask Dean or Charles to connect GitHub for Acme."]);
});

test("a member of a workspace whose GitHub reaches no repository is told so and which owners and admins to ask, with no Open Settings", async () => {
  fakeActPort({ [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve(PEOPLE) });
  await mount(undefined, undefined, {
    scope: "workspace-acme",
    manages: false,
    connected: true,
    read: NOTHING_REACHED,
  });

  const buttons = await openChip();
  await settle();

  assert.deepEqual(menuNotes(), [
    "Luke cannot see any repository yet.",
    "Ask Dean or Charles to add a repository to Luke's GitHub App.",
  ]);
  assert.equal(
    buttons.some((button) => button.textContent === OPEN_SETTINGS_LABEL),
    false,
  );
});

test("an owner of a workspace whose GitHub reaches no repository is offered Open Settings at the workspace's GitHub", async () => {
  const dialog = await mount(undefined, undefined, {
    scope: "workspace-acme",
    connected: true,
    read: NOTHING_REACHED,
  });

  const buttons = await openChip();
  const notes = menuNotes();
  const open =
    buttons.find((button) => button.textContent === OPEN_SETTINGS_LABEL) ??
    assert.fail("the menu offers to open Settings");
  act(() => open.click());

  assert.deepEqual(notes, ["Luke cannot see any repository yet."]);
  assert.deepEqual(dialog.links, [
    {
      page: SETTINGS_VIEW.WORKSPACE,
      section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
      workspaceId: "workspace-acme",
    },
  ]);
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

test("in a workspace with no GitHub connected, a repository its plans still name is neither offered nor chosen, the chip reads No repository, and a bare start makes the task with none", async () => {
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
  await dialog.key("Enter", { metaKey: true });

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
  const unlisted = await mount(undefined, undefined, { read: listing });
  await unlisted.key("Enter", { metaKey: true });
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  const listed = await mount(undefined, { repository: "acme/api" }, { read: listing });
  listed.type("Rate limits");
  await listed.key("Enter");

  assert.deepEqual(unlisted.starts, [["", null]]);
  assert.deepEqual(listed.starts, [["", "acme/api"]]);
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
  await dialog.key("Enter");

  assert.deepEqual(dialog.starts, [["", `${owner}/billing-ledger-and-invoicing-pipeline`]]);
});

test("for an automation's agent the card is titled for it, and Return hands the agent the brief with the words fenced last", async () => {
  const card = await mount(undefined, { purpose: NEW_TASK_PURPOSE.AUTOMATION });
  assert.equal(card.dialog()?.querySelector("h2")?.textContent, "Create with an agent");
  assert.equal(card.placeholder(), "Describe what to automate");
  card.type("Every Monday, audit our agents' tool sets.");
  await card.key("Enter");

  assert.deepEqual(card.starts, [["", "acme/web"]]);
  const prompt = card.agents[0]?.prompt ?? assert.fail("an agent is handed the words");
  assert.match(prompt, /`create_automation`/u, "the brief names the tool that makes it");
  assert.match(prompt, /`list_automations`/u, "and the one that reads what stands");
  assert.ok(
    prompt.endsWith("\n```text\nEvery Monday, audit our agents' tool sets.\n```"),
    "the words close the message, fenced as the request",
  );
});

test("for an automation's agent an empty box starts no bare task, and words past an agent's first message's bound start nothing and say why", async () => {
  const card = await mount(undefined, { purpose: NEW_TASK_PURPOSE.AUTOMATION });
  await card.key("Enter", { metaKey: true });
  assert.equal(card.starts.length, 0, "no bare task");

  card.type("a".repeat(AGENT_BOUNDS.MAX_MESSAGE_CHARS));
  await card.key("Enter");
  assert.equal(card.starts.length, 0, "nothing past the bound is sent");
  assert.match(card.note() ?? "", /^That request is too long\./u);
});

test("an automation's words are a draft of their own, so New task opens without them", async () => {
  const automation = await mount(undefined, { purpose: NEW_TASK_PURPOSE.AUTOMATION });
  automation.type("Post a weekly digest.");
  await settle();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  const task = await mount();
  assert.equal(task.field().textContent, "", "New task's box is empty");
});

test("for an automation's agent files alone hold Start, since the words are the request", async () => {
  const card = await mount(undefined, { purpose: NEW_TASK_PURPOSE.AUTOMATION });
  const picker =
    card.dialog()?.querySelector<HTMLInputElement>('input[type="file"]') ??
    assert.fail("the + has its file picker");
  const file = new File(["# Notes"], "notes.md", { type: "text/markdown" });
  Object.defineProperty(picker, "files", { configurable: true, value: [file] });
  act(() => {
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  for (let read = 0; read < 4; read += 1) await settle();
  assert.ok(card.dialog()?.textContent?.includes("notes.md"), "the file is attached");
  assert.equal(card.startButton().disabled, true, "Start is held");

  card.type("Post the notes every Friday.");
  await settle();
  assert.equal(card.startButton().disabled, false, "words let it start");
});
