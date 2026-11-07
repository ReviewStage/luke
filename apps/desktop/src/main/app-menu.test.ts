import assert from "node:assert/strict";
import { EXPERIMENT, HOST_CAPABILITY, NO_EXPERIMENTS } from "@repo/settings";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  KEYED_COMMANDS,
  shortcutAccelerator,
} from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
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
 * or the account's experiments move, and only then, an experiment renaming
 * the items it changes the reach of; and an item ends its name
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
    assert.deepEqual(labelsOf(appMenuTemplate("Vespin"), "Go"), [
      "Command Palette",
      "-",
      "Home",
      "Inbox",
      "Tasks",
      "Automations",
      "-",
      "Back",
      "Forward",
      "-",
      "Previous Task",
      "Next Task",
    ]);
  });

  test("a command that does not stand has no item, and strands no separator", () => {
    const withoutInbox = appMenuTemplate(
      "Vespin",
      undefined,
      (command) => command !== APP_COMMAND.INBOX,
    );
    assert.deepEqual(labelsOf(withoutInbox, "Go"), [
      "Command Palette",
      "-",
      "Home",
      "Tasks",
      "Automations",
      "-",
      "Back",
      "Forward",
      "-",
      "Previous Task",
      "Next Task",
    ]);

    const withoutPlaces = appMenuTemplate(
      "Vespin",
      undefined,
      (command) =>
        command !== APP_COMMAND.HOME &&
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
      "Previous Task",
      "Next Task",
    ]);
  });
});

describe("the menu bar's drawer", () => {
  test("keeps the update item it was last told when the experiments move", () => {
    const drawn: MenuItemConstructorOptions[][] = [];
    const show = menuBarDrawer({ appName: "Vespin", packaged: false }, (template) =>
      drawn.push(template),
    );

    show();
    show({ experiments: experimentsOn(EXPERIMENT.PILOT), capabilities: [] });

    const update = {
      act: "restart",
      onCheck: () => undefined,
      onInstall: () => undefined,
      onOpenLatest: () => undefined,
    } as const;
    show({ update });
    assert.ok(labelsOf(drawn.at(-1) ?? [], "Vespin").includes("Restart to Update"));

    // The experiments moving keeps the update item it was last told.
    show({ experiments: {}, capabilities: [] });
    assert.ok(labelsOf(drawn.at(-1) ?? [], "Vespin").includes("Restart to Update"));
  });
});

/** The labels of every item in the menus, chosen or dimmed, every submenu walked. */
function everyLabel(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.label === undefined ? [] : [item.label]),
    ...(Array.isArray(item.submenu) ? everyLabel(item.submenu) : []),
  ]);
}

describe("a workspace experiment's items", () => {
  test("stand only while the focused window offers them, whatever another workspace or the account's old choice holds", () => {
    const drawn: MenuItemConstructorOptions[][] = [];
    const show = menuBarDrawer({ appName: "Vespin", packaged: false }, (template) =>
      drawn.push(template),
    );
    // The account's store still holds Task descriptions on, as it held it for another workspace before it was each workspace's.
    show({ experiments: experimentsOn(EXPERIMENT.DESCRIPTIONS), capabilities: [] });
    assert.ok(!everyLabel(drawn.at(-1) ?? []).includes("Version History"), "no panel told yet");

    // The focused window's workspace has it off, so its panel offers no version history.
    show({ offered: [APP_COMMAND.COPY_LINK] });
    assert.ok(
      !everyLabel(drawn.at(-1) ?? []).includes("Version History"),
      "its workspace has it off",
    );

    show({ offered: [APP_COMMAND.COPY_LINK, APP_COMMAND.VERSION_HISTORY] });
    assert.ok(
      everyLabel(drawn.at(-1) ?? []).includes("Version History"),
      "its workspace has it on",
    );
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
  return choosableLabels(appMenuTemplate("Vespin", update)).filter((label) => label.endsWith("…"));
}

const ASKING_ITEMS = ["Permanently Delete…", "Send Feedback…", "Settings…"];

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

describe("the command palette and the task steps", () => {
  test("stand under Go with their chords, as items of their own commands", () => {
    const go =
      appMenuTemplate("Vespin").find((menu) => menu.label === "Go")?.submenu ??
      assert.fail("the menu bar has Go");
    const items = everyItem(Array.isArray(go) ? go : []).filter((item) =>
      [APP_COMMAND.COMMAND_PALETTE, APP_COMMAND.PREVIOUS_TASK, APP_COMMAND.NEXT_TASK].some(
        (command) => command === item.id,
      ),
    );
    assert.deepEqual(
      items.map((item) => [item.id, item.label, item.accelerator]),
      [
        [APP_COMMAND.COMMAND_PALETTE, "Command Palette", "Command+K"],
        [APP_COMMAND.PREVIOUS_TASK, "Previous Task", "Alt+Command+Up"],
        [APP_COMMAND.NEXT_TASK, "Next Task", "Alt+Command+Down"],
      ],
    );
  });
});

describe("the menu bar's dimmed items", () => {
  test("an item that hands the window a command nothing there offers stands dimmed, an item main runs itself never does, and nothing is dimmed before the window tells", () => {
    const enabledIn = (template: MenuItemConstructorOptions[], menu: string) => {
      const items = template.find((each) => each.label === menu)?.submenu;
      assert.ok(Array.isArray(items), `the menu bar has ${menu}`);
      return items
        .filter((item) => item.type !== "separator")
        .map((item) => [item.label, item.enabled !== false]);
    };
    const offering = appMenuTemplate(
      "Vespin",
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      (command) => command === APP_COMMAND.COPY_LINK,
    );

    assert.deepEqual(enabledIn(offering, "File"), [
      ["New Task", true],
      ["New Tab", false],
      ["New Terminal", false],
      ["Reopen Closed Tab", false],
      ["Close Tab", true],
      ["Close Other Tabs", false],
      ["Close Window", true],
      ["Copy Link", true],
      ["Copy Transcript", false],
      ["Copy Full Transcript", false],
      ["Version History", false],
      ["Mark Done", false],
      ["Permanently Delete…", false],
    ]);
    assert.ok(
      enabledIn(appMenuTemplate("Vespin"), "File").every(([, enabled]) => enabled),
      "a menu bar no window has told dims nothing",
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

/** The menu bar a build draws once the windows have told it of their developer tools. */
function drawnFor(packaged: boolean): MenuItemConstructorOptions[] {
  let last: MenuItemConstructorOptions[] = [];
  const show = menuBarDrawer({ appName: "Vespin", packaged }, (template) => {
    last = template;
  });
  show({ developerTools: true });
  return last;
}

describe("the developer tools", () => {
  test("a development build offers them under View, for the window chosen over", () => {
    const view = drawnFor(false).find((item) => item.label === "View");
    const developer = Array.isArray(view?.submenu)
      ? view.submenu.find((item) => item.label === "Developer")
      : undefined;
    assert.ok(developer, "View has a Developer submenu");
    assert.deepEqual(labelsOf([developer], "Developer"), ["Developer Tools"]);
  });

  test("a packaged build offers none, though the windows tell it of them", () => {
    const items = everyItem(drawnFor(true));
    assert.ok(!items.some((item) => item.role === "toggleDevTools"));
    assert.deepEqual(
      items.filter((item) => String(item.label ?? "").includes("Developer")),
      [],
    );
  });

  test("their chord is no window command's, so it shadows none of Vespin's shortcuts", () => {
    const tools = everyItem(drawnFor(false)).find((item) => item.role === "toggleDevTools");
    assert.ok(tools?.accelerator, "the developer tools answer a chord");
    assert.ok(
      !KEYED_COMMANDS.some(
        (command) => shortcutAccelerator(APP_SHORTCUTS[command].chord) === tools.accelerator,
      ),
    );
  });
});

/** A window of the app's, as the menu is handed the one it was chosen over. */
function aWindow(): BaseWindow {
  return {} as BaseWindow;
}

/** What a press brought the panel back on: a command, or the window alone. */
const WINDOW_ALONE = "the window alone";

/** Presses a command's item as its key does, over the window in front, and answers what the panel was brought back on. */
function pressKey(
  command: typeof APP_COMMAND.NEW_TASK | typeof APP_COMMAND.ACTUAL_SIZE,
  window: BaseWindow | undefined,
  panelWindow: BaseWindow,
): readonly string[] {
  const reopened: string[] = [];
  const panel: PanelMenu = {
    isPanel: (candidate) => candidate === panelWindow,
    onReopen: (reopenedOn) => reopened.push(reopenedOn ?? WINDOW_ALONE),
  };
  let drawn: MenuItemConstructorOptions[] = [];
  const show = menuBarDrawer({ appName: "Vespin", packaged: true }, (template) => {
    drawn = template;
  });
  // The zoom's items stand only in the desktop app.
  show({ experiments: NO_EXPERIMENTS, capabilities: [HOST_CAPABILITY.DESKTOP_APP] });
  show({ panel });
  const item = everyItem(drawn).find((candidate) => candidate.id === command);
  if (!item?.click) return assert.fail(`no ${command} item`);
  item.click({} as MenuItem, window, { triggeredByAccelerator: true } as KeyboardEvent);
  return reopened;
}

function pressNewTask(window: BaseWindow | undefined, panelWindow: BaseWindow): readonly string[] {
  return pressKey(APP_COMMAND.NEW_TASK, window, panelWindow);
}

describe("New Task", () => {
  test("its key brings the closed window back on a new task", () => {
    assert.deepEqual(pressNewTask(undefined, aWindow()), [APP_COMMAND.NEW_TASK]);
  });

  test("its key over another of Vespin's windows brings the panel forward on a new task", () => {
    assert.deepEqual(pressNewTask(aWindow(), aWindow()), [APP_COMMAND.NEW_TASK]);
  });

  test("its key over the panel is left to the panel's own keymap", () => {
    const panelWindow = aWindow();
    assert.deepEqual(pressNewTask(panelWindow, panelWindow), []);
  });
});

describe("⌘0", () => {
  test("with the window closed, it brings the window back as it was, zoom and all", () => {
    assert.deepEqual(pressKey(APP_COMMAND.ACTUAL_SIZE, undefined, aWindow()), [WINDOW_ALONE]);
  });

  test("over the panel, it is left to the panel's own keymap", () => {
    const panelWindow = aWindow();
    assert.deepEqual(pressKey(APP_COMMAND.ACTUAL_SIZE, panelWindow, panelWindow), []);
  });
});

/** View's first item, as the menu bar draws it once main has (or has not) told it of the reload. */
function viewReload(reload?: ReloadMenu): MenuItemConstructorOptions | undefined {
  let drawn: MenuItemConstructorOptions[] = [];
  const show = menuBarDrawer({ appName: "Vespin", packaged: true }, (template) => {
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
