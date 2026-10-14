import assert from "node:assert/strict";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import type { MenuItemConstructorOptions } from "electron";
import { describe, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { appMenuTemplate, menuBarDrawer } from "./app-menu";

/**
 * The menu bar as a gated feature's experiment decides it: an item whose
 * command does not stand is not in its menu, and leaves no separator
 * stranded where it stood; and the one drawer redraws when the update item
 * or the account's experiments move, and only then.
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
    assert.deepEqual(labelsOf(withoutInbox, "Go"), ["Home", "-", "Back", "Forward"]);

    const withoutPlaces = appMenuTemplate(
      "Luke",
      undefined,
      (command) => command !== APP_COMMAND.HOME && command !== APP_COMMAND.INBOX,
    );
    assert.deepEqual(labelsOf(withoutPlaces, "Go"), ["Back", "Forward"]);
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
