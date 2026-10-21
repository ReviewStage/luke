import assert from "node:assert/strict";
import { ellipsized } from "@luke/panel/testing/action-label";
import { DESKTOP_CAPABILITIES } from "@luke/panel/testing/app-state";
import { EXPERIMENT } from "@luke/settings";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  appCommandLabel,
  KEYED_COMMANDS,
  SHORTCUT_KEY,
  shortcutAccelerator,
  shortcutShown,
  shownShortcutGroups,
} from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import type { MenuItemConstructorOptions } from "electron";
import { describe, test } from "vitest";
import { appMenuTemplate, menuBarDrawer, UPDATE_MENU_ACT } from "./app-menu";

/**
 * The menu bar as a gated feature's experiment decides it: an item whose
 * command does not stand is not in its menu, and leaves no separator
 * stranded where it stood; and the one drawer redraws when the update item
 * or the account's experiments move, and only then; and no item a reader
 * can choose ends its name with an ellipsis; and only a development build
 * offers the developer tools.
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
      "Home",
      "Inbox",
      "Automations",
      "-",
      "Back",
      "Forward",
    ]);
  });

  test("a command that does not stand has no item, and strands no separator", () => {
    const withoutInbox = appMenuTemplate(
      "Luke",
      undefined,
      (command) => command !== APP_COMMAND.INBOX,
    );
    assert.deepEqual(labelsOf(withoutInbox, "Go"), ["Home", "Automations", "-", "Back", "Forward"]);

    const withoutPlaces = appMenuTemplate(
      "Luke",
      undefined,
      (command) =>
        command !== APP_COMMAND.HOME &&
        command !== APP_COMMAND.INBOX &&
        command !== APP_COMMAND.AUTOMATIONS,
    );
    assert.deepEqual(labelsOf(withoutPlaces, "Go"), ["Back", "Forward"]);
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

describe("Factory", () => {
  test("keeps no menu bar item and no chord, with its experiment on as off, so ⇧⌘F reaches no command", () => {
    const on = appMenuTemplate("Luke", undefined, (command) =>
      shortcutShown(command, experimentsOn(EXPERIMENT.FACTORY), DESKTOP_CAPABILITIES),
    );
    assert.ok(!labelsOf(on, "Go").includes("Factory"));
    const listed = shownShortcutGroups(
      experimentsOn(EXPERIMENT.FACTORY),
      DESKTOP_CAPABILITIES,
    ).flatMap((group) => group.commands);
    assert.ok(!listed.some((command) => appCommandLabel(command) === "Factory"));
    const freed = shortcutAccelerator({ key: SHORTCUT_KEY.F, shift: true });
    assert.ok(
      !KEYED_COMMANDS.some(
        (command) => shortcutAccelerator(APP_SHORTCUTS[command].chord) === freed,
      ),
    );
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

    show({ experiments: experimentsOn(EXPERIMENT.FACTORY), capabilities: [] });
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

describe("the menu bar's names", () => {
  test("no item a reader can choose ends with an ellipsis, in any state of the update item", () => {
    for (const act of Object.values(UPDATE_MENU_ACT)) {
      const update = {
        act,
        onCheck: () => undefined,
        onInstall: () => undefined,
        onOpenLatest: () => undefined,
      };
      assert.deepEqual(ellipsized(choosableLabels(appMenuTemplate("Luke", update))), [], act);
    }
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
