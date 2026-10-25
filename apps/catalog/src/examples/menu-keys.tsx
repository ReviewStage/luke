import { SHORTCUT_KEY } from "@luke/settings/shortcuts";
import { MenuKeys, menuKey } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * menu-keys.tsx -- the foot a list keyed from the caret names its keys with:
 * the `@` list's, and a list that hears one key fewer.
 */

function MenuKeysExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="menu-keys-full" title="Move, insert and close">
        <MenuKeys
          keys={[
            menuKey("Move", SHORTCUT_KEY.UP, SHORTCUT_KEY.DOWN),
            menuKey("Insert", SHORTCUT_KEY.ENTER, SHORTCUT_KEY.TAB),
            menuKey("Close", SHORTCUT_KEY.ESCAPE),
          ]}
        />
      </CatalogSection>
      <CatalogSection id="menu-keys-short" title="A list with no move">
        <MenuKeys
          keys={[
            menuKey("Insert", SHORTCUT_KEY.ENTER, SHORTCUT_KEY.TAB),
            menuKey("Close", SHORTCUT_KEY.ESCAPE),
          ]}
        />
      </CatalogSection>
    </>
  );
}

export const MENU_KEYS_EXAMPLE: Example = {
  id: "menu-keys",
  title: "Menu keys",
  Render: MenuKeysExample,
};
