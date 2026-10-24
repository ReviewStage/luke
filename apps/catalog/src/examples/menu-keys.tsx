import { MenuKeys } from "@luke/ui";
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
            { keys: "↑↓", does: "Move" },
            { keys: "↵", does: "Insert" },
            { keys: "esc", does: "Close" },
          ]}
        />
      </CatalogSection>
      <CatalogSection id="menu-keys-short" title="A list with no move">
        <MenuKeys
          keys={[
            { keys: "↵", does: "Insert" },
            { keys: "esc", does: "Close" },
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
