import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  GLYPH_INK,
  GlyphSlot,
  LIST_DENSITY,
  List,
  ListRow,
  MenuSection,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  WingFace,
} from "@luke/ui";
import { ICON_SIZE } from "@luke/ui/icons";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * menu-sections.tsx -- a popover's rows in headed sections: the group
 * heading, a count at its right end, and the hairline over every section
 * after the first, as an agent's MCP popover heads Built in and Connected.
 */

function MenuSections(): React.JSX.Element {
  return (
    <CatalogSection id="menu-sections" title="Headed sections, counted">
      <div className="catalog-frame p-menu-inset">
        <MenuSection heading="Built in">
          <List label="Built in" density={LIST_DENSITY.COMPACT}>
            <ListRow
              leading={
                <GlyphSlot ink={GLYPH_INK.TEXT} size={ICON_SIZE.MEDIUM}>
                  <WingFace />
                </GlyphSlot>
              }
              title="Luke"
              meta="Always on"
            />
          </List>
        </MenuSection>
        <MenuSection heading="Connected" count="2 of 3 on">
          <List label="Connected" density={LIST_DENSITY.COMPACT}>
            <ListRow
              leading={
                <ProviderMark
                  provider={INTEGRATION_PROVIDER.LINEAR}
                  size={PROVIDER_MARK_SIZE.ICON}
                />
              }
              title="Linear"
            />
            <ListRow
              leading={
                <ProviderMark
                  provider={INTEGRATION_PROVIDER.SENTRY}
                  size={PROVIDER_MARK_SIZE.ICON}
                />
              }
              title="Sentry"
            />
            <ListRow
              leading={
                <ProviderMark
                  provider={INTEGRATION_PROVIDER.VERCEL}
                  size={PROVIDER_MARK_SIZE.ICON}
                />
              }
              title="Vercel"
            />
          </List>
        </MenuSection>
      </div>
    </CatalogSection>
  );
}

export const MENU_SECTIONS_EXAMPLE: Example = {
  id: "menu-sections",
  title: "Menu sections",
  Render: MenuSections,
};
