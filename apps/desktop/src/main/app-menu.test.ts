import assert from "node:assert/strict";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import type { MenuItemConstructorOptions } from "electron";
import { describe, test } from "vitest";
import { APP_COMMAND, shortcutShown, shownShortcutGroups } from "#shared/shortcuts";
import { ellipsized } from "#testing/action-label";
import { appMenuTemplate, menuBarDrawer, UPDATE_MENU_ACT } from "./app-menu";

/**
 * The menu bar as a gated feature's experiment decides it: an item whose
 * command does not stand is not in its menu, and leaves no separator
 * stranded where it stood; and the one drawer redraws when the update item
 * or the account's experiments move, and only then; and no item a reader
 * can choose ends its name with an ellipsis.
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
      "Factory",
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
    assert.deepEqual(labelsOf(withoutInbox, "Go"), [
      "Home",
      "Factory",
      "Automations",
      "-",
      "Back",
      "Forward",
    ]);

    const withoutPlaces = appMenuTemplate(
      "Luke",
      undefined,
      (command) =>
        command !== APP_COMMAND.HOME &&
        command !== APP_COMMAND.INBOX &&
        command !== APP_COMMAND.FACTORY &&
        command !== APP_COMMAND.AUTOMATIONS,
    );
    assert.deepEqual(labelsOf(withoutPlaces, "Go"), ["Back", "Forward"]);
  });
});

describe("the Automations item", () => {
  test("stands under Go only while the account has its experiment on", () => {
    const off = appMenuTemplate("Luke", undefined, (command) => shortcutShown(command, {}));
    assert.ok(!labelsOf(off, "Go").includes("Automations"));
    const on = appMenuTemplate("Luke", undefined, (command) =>
      shortcutShown(command, experimentsOn(EXPERIMENT.AUTOMATIONS)),
    );
    assert.ok(labelsOf(on, "Go").includes("Automations"));
  });
});

describe("Factory's item", () => {
  test("stands under Go only while the account has Factory's experiment on", () => {
    const off = appMenuTemplate("Luke", undefined, (command) => shortcutShown(command, {}));
    assert.ok(!labelsOf(off, "Go").includes("Factory"));
    const on = appMenuTemplate("Luke", undefined, (command) =>
      shortcutShown(command, experimentsOn(EXPERIMENT.FACTORY)),
    );
    assert.ok(labelsOf(on, "Go").includes("Factory"));
  });

  test("Factory's chord is listed only while its experiment is on", () => {
    const listed = (groups: ReturnType<typeof shownShortcutGroups>) =>
      groups.flatMap((group) => group.commands);
    assert.ok(!listed(shownShortcutGroups({})).includes(APP_COMMAND.FACTORY));
    assert.ok(
      listed(shownShortcutGroups(experimentsOn(EXPERIMENT.FACTORY))).includes(APP_COMMAND.FACTORY),
    );
  });
});

describe("the menu bar's drawer", () => {
  test("draws what it holds, and again only when the update item or the experiments move", () => {
    const drawn: MenuItemConstructorOptions[][] = [];
    const show = menuBarDrawer("Luke", (template) => drawn.push(template));

    show();
    assert.equal(drawn.length, 1);

    show({ experiments: {} });
    show();
    assert.equal(drawn.length, 1, "nothing moved, so nothing was drawn again");

    show({ experiments: experimentsOn(EXPERIMENT.FACTORY) });
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
    show({ experiments: {} });
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
