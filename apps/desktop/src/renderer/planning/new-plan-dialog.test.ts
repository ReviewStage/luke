// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { OpenSettingsProvider } from "../open-settings";
import { NewPlanDialog } from "./new-plan-dialog";
import type { RepositoryChooser } from "./repository-chip";

/**
 * New plan as the developer meets it: a card over the window holding the
 * plan's name, the repository chip, Cancel, and Create plan. Each test
 * stands the dialog in an owner that opens it and puts it away as the tab
 * does, so closing is read as the card leaving the window.
 */

/** The window's own stylesheet, which says where the chip's menu hangs. */
const DESKTOP_CSS = readFileSync(path.join(import.meta.dirname, "../styles/desktop.css"), "utf8");

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * The dialog open in its owner, a start answered by `answer` and each
 * start's name and repository written down; `preset` is the repository the
 * press that opened it chose, as a repository group's + does.
 */
async function mount(
  answer: string | undefined = undefined,
  preset?: string,
  chooser: Partial<RepositoryChooser> = {},
) {
  const starts: [string, string | null][] = [];
  const planned: boolean[] = [];
  const control = plansControl();
  let repositories: RepositoryChooser = {
    ...control.repositories,
    recent: ["acme/web", "acme/api"],
    ...chooser,
  };
  const links: SettingsLink[] = [];
  function Owner() {
    const [open, setOpen] = useState(true);
    const dialog = createElement(NewPlanDialog, {
      newPlan: {
        ...control.newPlan,
        open,
        preset: preset === undefined ? undefined : { repository: preset },
        repositoriesIn: () => repositories,
        start: (
          name: string,
          repository: string | null,
          _workspaceId: string | undefined,
          planning: boolean,
        ) => {
          starts.push([name, repository]);
          planned.push(planning);
          return Promise.resolve(answer);
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
  const press = async (key: string, on: HTMLElement) => {
    act(() => {
      on.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    await settle();
  };
  return {
    starts,
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
  const card = await mount(undefined, "acme/api");
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

test("the repository menu hangs above its chip where the window leaves no room for it below, its list capped to the room above, and below a chip high in the window", async () => {
  document.head.appendChild(document.createElement("style")).textContent = DESKTOP_CSS;
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(520);
  const card = await mount();
  const chip = card.button("acme/web");
  const opened = async (top: number) => {
    vi.spyOn(chip, "getBoundingClientRect").mockReturnValue(new DOMRect(40, top, 200, 32));
    act(() => chip.click());
    await settle();
    const holder = chip.closest<HTMLElement>(".repository-chip") ?? assert.fail("the chip's box");
    const menu = holder.querySelector(".searchable-menu") ?? assert.fail("the menu opens");
    const placed = {
      side: holder.dataset.side,
      list: holder.style.getPropertyValue("--settings-picker-list-max"),
      top: getComputedStyle(menu).top,
    };
    act(() => chip.click());
    await settle();
    return placed;
  };

  // A chip at the foot of a card in a 520px window, then one near its top.
  const low = await opened(300);
  const high = await opened(60);

  assert.deepEqual(low, { side: "above", list: "240px", top: "auto" });
  assert.equal(high.side, "below");
  assert.notEqual(high.top, "auto");
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
  const dialog = await mount(undefined, "alice/private", {
    scope: "workspace-personal",
    recent: ["alice/notes"],
  });
  dialog.type("Dark mode");

  await dialog.rechoose({ scope: "workspace-acme", recent: ["acme/relay"] });
  await dialog.press("Enter", dialog.field());

  assert.deepEqual(dialog.starts, [["Dark mode", "acme/relay"]]);
});

test("the workspace first resolving keeps a repository picked before the workspaces were read", async () => {
  const dialog = await mount(undefined, "alice/private", {
    scope: undefined,
    recent: ["alice/notes"],
  });
  dialog.type("Dark mode");

  await dialog.rechoose({ scope: "workspace-personal" });
  await dialog.press("Enter", dialog.field());

  assert.deepEqual(dialog.starts, [["Dark mode", "alice/private"]]);
});

/** The chip's menu opened, and the buttons then drawn anywhere in the document. */
async function openChip(): Promise<HTMLButtonElement[]> {
  const chip =
    document.querySelector<HTMLButtonElement>(".chip") ??
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
  const notes = [...document.querySelectorAll(".plan-compose-menu-note")].map(
    (note) => note.textContent,
  );
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
  const notes = [...document.querySelectorAll(".plan-compose-menu-note")].map(
    (note) => note.textContent,
  );

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
    notes: [...document.querySelectorAll(".plan-compose-menu-note")].map(
      (note) => note.textContent,
    ),
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
  const notes = [...document.querySelectorAll(".plan-compose-menu-note")].map(
    (note) => note.textContent,
  );
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

  const listed = await mount(undefined, "acme/api", { read: listing });
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
      row.querySelector(".plan-compose-menu-name")?.textContent,
      row.querySelector(".plan-compose-menu-detail")?.textContent,
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
