import assert from "node:assert/strict";
import { DESKTOP_CAPABILITIES } from "@luke/panel/testing/app-state";
import { EXPERIMENT } from "@luke/settings";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  KEYED_COMMANDS,
  shortcutAccelerator,
  shortcutShown,
} from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import type { BaseWindow, KeyboardEvent, MenuItem, MenuItemConstructorOptions } from "electron";
import { describe, test } from "vitest";
import {
  appMenuTemplate,
  menuBarDrawer,
  type PanelMenu,
  type ReloadMenu,
  UPDATE_MENU_ACT,
} from "./app-menu";

/**
 * The menu bar as a gated feature's experiment decides it: an item whose
 * command does not stand is not in its menu, and leaves no separator
 * stranded where it stood; and the one drawer redraws when the update item
 * or the account's experiments move, and only then; and an item ends its name
 * with an ellipsis only where it opens a window or asks; and only a
 * development build offers the developer tools.
 */

/** The labels of one top-level menu's items, a separator as a dash. */
function labelsOf(template: MenuItemConstructorOptions[], menu: string): readonly string[] {
  const found = template.find((item) => item.label === menu);
  if (!found || !Array.isArray(found.submenu)) return assert.fail(`no ${menu} menu`);
  return found.submenu.map((item: MenuItemConstructorOptions) =>
    item.type === "separator" ? "-" : String(item.label),
  );
}

describe("the menu bar's gate", () => {
  test("every item stands while every command does", () => {
    assert.deepEqual(labelsOf(appMenuTemplate("Luke"), "Go"), [
      "Command Palette",
      "-",
      "Ask Luke",
      "Inbox",
      "Tasks",
      "Automations",
      "-",
      "Back",
      "Forward",
      "-",
      "Next Recent Tab",
      "Previous Recent Tab",
      "-",
      "Move Tab Left",
      "Move Tab Right",
    ]);
  });

  test("a command that does not stand has no item, and strands no separator", () => {
    const withoutInbox = appMenuTemplate(
      "Luke",
      undefined,
      (command) => command !== APP_COMMAND.INBOX && command !== APP_COMMAND.ASK_LUKE,
    );
    assert.deepEqual(labelsOf(withoutInbox, "Go"), [
      "Command Palette",
      "-",
      "Tasks",
      "Automations",
      "-",
      "Back",
      "Forward",
      "-",
      "Next Recent Tab",
      "Previous Recent Tab",
      "-",
      "Move Tab Left",
      "Move Tab Right",
    ]);

    const withoutPlaces = appMenuTemplate(
      "Luke",
      undefined,
      (command) =>
        command !== APP_COMMAND.ASK_LUKE &&
        command !== APP_COMMAND.INBOX &&
        command !== APP_COMMAND.TASKS &&
        command !== APP_COMMAND.AUTOMATIONS,
    );
    assert.deepEqual(labelsOf(withoutPlaces, "Go"), [
      "Command Palette",
      "-",
      "Back",
      "Forward",
      "-",
      "Next Recent Tab",
      "Previous Recent Tab",
      "-",
      "Move Tab Left",
      "Move Tab Right",
    ]);
  });
});

describe("the Ask Luke item", () => {
  test("stands under Go only while the account has the operator on", () => {
    const shownWith = (experiments: Parameters<typeof shortcutShown>[1]) =>
      appMenuTemplate("Luke", undefined, (command) =>
        shortcutShown(command, experiments, DESKTOP_CAPABILITIES),
      );
    assert.ok(!labelsOf(shownWith({}), "Go").includes("Ask Luke"));
    assert.ok(labelsOf(shownWith(experimentsOn(EXPERIMENT.OPERATOR)), "Go").includes("Ask Luke"));
  });
});

describe("the Automations item", () => {
  test("stands under Go with no experiment on", () => {
    const menu = appMenuTemplate("Luke", undefined, (command) =>
      shortcutShown(command, {}, DESKTOP_CAPABILITIES),
    );
    assert.ok(labelsOf(menu, "Go").includes("Automations"));
  });
});

describe("the menu bar's drawer", () => {
  test("draws what it holds, and again only when the update item or the experiments move", () => {
    const drawn: MenuItemConstructorOptions[][] = [];
    const show = menuBarDrawer({ appName: "Luke", packaged: false }, (template) =>
      drawn.push(template),
    );

    show();
    assert.equal(drawn.length, 1);

    show({ experiments: {}, capabilities: [] });
    show();
    assert.equal(drawn.length, 1, "nothing moved, so nothing was drawn again");

    show({ experiments: experimentsOn(EXPERIMENT.CHAT), capabilities: [] });
    assert.equal(drawn.length, 2);

    const update = {
      act: "restart",
      onCheck: () => undefined,
      onInstall: () => undefined,
      onOpenLatest: () => undefined,
    } as const;
    show({ update });
    assert.equal(drawn.length, 3);
    assert.ok(labelsOf(drawn[2] ?? [], "Luke").includes("Restart to Update"));

    // The experiments moving keeps the update item it was last told.
    show({ experiments: {}, capabilities: [] });
    assert.equal(drawn.length, 4);
    assert.ok(labelsOf(drawn[3] ?? [], "Luke").includes("Restart to Update"));
  });
});

/** The labels of every item a reader can choose, every submenu walked; a disabled item is a status, not a choice. */
function choosableLabels(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.label === undefined || item.enabled === false ? [] : [item.label]),
    ...(Array.isArray(item.submenu) ? choosableLabels(item.submenu) : []),
  ]);
}

/** The labels of every item a reader can choose that end with an ellipsis, in any state of the update item. */
function ellipsizedLabels(update?: Parameters<typeof appMenuTemplate>[1]): string[] {
  return choosableLabels(appMenuTemplate("Luke", update)).filter((label) => label.endsWith("…"));
}

const ASKING_ITEMS = [
  "Permanently Delete Task…",
  "Send Feedback…",
  "Settings…",
  "Suggest a Feature…",
];

describe("the menu bar's names", () => {
  test("an item ends with an ellipsis where it opens a window or asks, and nowhere else", () => {
    assert.deepEqual(ellipsizedLabels().sort(), ASKING_ITEMS);
  });

  test("the update item, which opens nothing, adds none in any state", () => {
    for (const act of Object.values(UPDATE_MENU_ACT)) {
      const update = {
        act,
        onCheck: () => undefined,
        onInstall: () => undefined,
        onOpenLatest: () => undefined,
      };
      assert.deepEqual(ellipsizedLabels(update).sort(), ASKING_ITEMS, act);
    }
  });
});

describe("the command palette and tab moves", () => {
  test("stand under Go with their chords, as items of their own commands", () => {
    const items = everyItem(appMenuTemplate("Luke")).filter((item) =>
      [APP_COMMAND.COMMAND_PALETTE, APP_COMMAND.MOVE_TAB_LEFT, APP_COMMAND.MOVE_TAB_RIGHT].some(
        (command) => command === item.id,
      ),
    );
    assert.deepEqual(
      items.map((item) => [item.id, item.label, item.accelerator]),
      [
        [APP_COMMAND.COMMAND_PALETTE, "Command Palette", "Command+K"],
        [APP_COMMAND.MOVE_TAB_LEFT, "Move Tab Left", "Shift+Command+Left"],
        [APP_COMMAND.MOVE_TAB_RIGHT, "Move Tab Right", "Shift+Command+Right"],
      ],
    );
  });
});

/** Every item, every submenu walked. */
function everyItem(items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? everyItem(item.submenu) : []),
  ]);
}

const developerTools = { onOpenVoiceWindow: () => undefined, onOpenCallWindow: () => undefined };

/** The menu bar a build draws once the windows have told it of their developer tools. */
function drawnFor(packaged: boolean): MenuItemConstructorOptions[] {
  let last: MenuItemConstructorOptions[] = [];
  const show = menuBarDrawer({ appName: "Luke", packaged }, (template) => {
    last = template;
  });
  show({ developerTools });
  return last;
}

describe("the developer tools", () => {
  test("a development build offers them under View, for the window chosen over and the two it cannot reach", () => {
    const view = drawnFor(false).find((item) => item.label === "View");
    const developer = Array.isArray(view?.submenu)
      ? view.submenu.find((item) => item.label === "Developer")
      : undefined;
    assert.ok(developer, "View has a Developer submenu");
    assert.deepEqual(labelsOf([developer], "Developer"), [
      "Developer Tools",
      "-",
      "Voice Window Developer Tools",
      "Call Window Developer Tools",
    ]);
  });

  test("a packaged build offers none, though the windows tell it of them", () => {
    const items = everyItem(drawnFor(true));
    assert.ok(!items.some((item) => item.role === "toggleDevTools"));
    assert.deepEqual(
      items.filter((item) => String(item.label ?? "").includes("Developer")),
      [],
    );
  });

  test("their chord is no window command's, so it shadows none of Luke's shortcuts", () => {
    const tools = everyItem(drawnFor(false)).find((item) => item.role === "toggleDevTools");
    assert.ok(tools?.accelerator, "the developer tools answer a chord");
    assert.ok(
      !KEYED_COMMANDS.some(
        (command) => shortcutAccelerator(APP_SHORTCUTS[command].chord) === tools.accelerator,
      ),
    );
  });
});

/** A window of Luke's, as the menu is handed the one it was chosen over. */
function aWindow(): BaseWindow {
  return {} as BaseWindow;
}

/** Presses File's New Task as its key does, over the window in front, and answers the commands the panel was brought back on. */
function pressNewTask(window: BaseWindow | undefined, panelWindow: BaseWindow): readonly string[] {
  const reopened: string[] = [];
  const panel: PanelMenu = {
    isPanel: (candidate) => candidate === panelWindow,
    onReopen: (command) => reopened.push(command),
  };
  let drawn: MenuItemConstructorOptions[] = [];
  menuBarDrawer({ appName: "Luke", packaged: true }, (template) => {
    drawn = template;
  })({ panel });
  const newTask = everyItem(drawn).find((item) => item.id === APP_COMMAND.NEW_TASK);
  if (!newTask?.click) return assert.fail("File has no New Task item");
  newTask.click({} as MenuItem, window, { triggeredByAccelerator: true } as KeyboardEvent);
  return reopened;
}

describe("New Task", () => {
  test("its key brings the closed window back on a new task", () => {
    assert.deepEqual(pressNewTask(undefined, aWindow()), [APP_COMMAND.NEW_TASK]);
  });

  test("its key over another of Luke's windows brings the panel forward on a new task", () => {
    assert.deepEqual(pressNewTask(aWindow(), aWindow()), [APP_COMMAND.NEW_TASK]);
  });

  test("its key over the panel is left to the panel's own keymap", () => {
    const panelWindow = aWindow();
    assert.deepEqual(pressNewTask(panelWindow, panelWindow), []);
  });
});

/** View's first item, as the menu bar draws it once main has (or has not) told it of the reload. */
function viewReload(reload?: ReloadMenu): MenuItemConstructorOptions | undefined {
  let drawn: MenuItemConstructorOptions[] = [];
  const show = menuBarDrawer({ appName: "Luke", packaged: true }, (template) => {
    drawn = template;
  });
  show(reload === undefined ? undefined : { reload });
  const view = drawn.find((item) => item.label === "View");
  return Array.isArray(view?.submenu) ? view.submenu[0] : undefined;
}

describe("Reload", () => {
  test("⌘R hands the window chosen over to main, which reloads it once nothing would be lost", () => {
    const reloaded: BaseWindow[] = [];
    const item = viewReload({ onReload: (window) => reloaded.push(window) });
    assert.equal(item?.label, "Reload");
    assert.equal(item?.accelerator, "Command+R");
    if (!item?.click) return assert.fail("View has no Reload item");

    const window = aWindow();
    item.click({} as MenuItem, window, { triggeredByAccelerator: true } as KeyboardEvent);
    item.click({} as MenuItem, undefined, { triggeredByAccelerator: true } as KeyboardEvent);

    assert.deepEqual(reloaded, [window]);
  });

  test("before main is told, ⌘R is the system's own reload, while no page has loaded to hold edits", () => {
    const item = viewReload();
    assert.equal(item?.role, "reload");
    assert.equal(item?.accelerator, "Command+R");
  });
});
