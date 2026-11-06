import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
import { MenuKeys, menuKey } from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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
