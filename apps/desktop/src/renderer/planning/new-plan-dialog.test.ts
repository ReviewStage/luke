// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { OpenSettingsProvider } from "../open-settings";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "../settings-views";
import { NewPlanDialog } from "./new-plan-dialog";
import type { RepositoryChooser } from "./repository-chip";

/**
 * New plan as the developer meets it: a card over the window holding the
 * plan's name, the repository chip, Cancel, and Create plan. Each test
 * stands the dialog in an owner that opens it and puts it away as the tab
 * does, so closing is read as the card leaving the window.
 */

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
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
        open,
        preset: preset === undefined ? undefined : { repository: preset },
        start: (name: string, repository: string | null) => {
          starts.push([name, repository]);
          return Promise.resolve(answer);
        },
        onClose: () => setOpen(false),
      },
      repositories,
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
    const found = document.querySelector<HTMLInputElement>('input[aria-label="Plan name"]');
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

test("the dialog holds the name, then the repository chip leading Cancel and Create plan, with the name taking focus", async () => {
  const card = await mount();
  assert.deepEqual(card.controls(), ["Plan name", "acme/web", "Cancel", "Create plan⏎"]);
  assert.equal(document.activeElement, card.field());
  assert.equal(
    card.dialog()?.textContent?.includes("Repository"),
    false,
    "the chip stands unlabelled",
  );
});

test("Return creates the plan under the name as typed, trimmed, about the repository last used", async () => {
  const card = await mount();
  assert.equal(card.button("Create plan").disabled, true, "nothing to create before a name");
  await card.press("Enter", card.field());
  assert.deepEqual(card.starts, []);
  card.type("  Dark mode toggle  ");
  assert.equal(card.button("Create plan").disabled, false);
  await card.press("Enter", card.field());
  assert.deepEqual(card.starts, [["Dark mode toggle", "acme/web"]]);
});

test("a repository group's + opens the dialog on its repository rather than the last used", async () => {
  const card = await mount(undefined, "acme/api");
  card.type("Rate limits");
  act(() => card.button("Create plan").click());
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
  act(() => card.button("Create plan").click());
  await settle();
  assert.deepEqual(card.starts, [["Dark mode toggle", "acme/web"]]);
  assert.ok(card.dialog());
  assert.equal(card.note(), "Luke can't reach acme/web.");
  assert.equal(card.field().value, "Dark mode toggle");
  assert.equal(card.button("Create plan").disabled, false);
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
