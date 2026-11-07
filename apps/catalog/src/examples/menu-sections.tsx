import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import {
  LIST_DENSITY,
  List,
  ListRow,
  MenuSection,
  PROVIDER_MARK_SIZE,
  ProviderMark,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * menu-sections.tsx -- a popover's rows in headed sections: the group
 * heading, a count at its right end, and the hairline over every section
 * after the first, as an agent's MCP popover heads Connected and Not connected.
 */

function MenuSections(): React.JSX.Element {
  return (
    <CatalogSection id="menu-sections" title="Headed sections, counted">
      <div className="catalog-frame p-menu-inset">
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
        <MenuSection heading="Not connected">
          <List label="Not connected" density={LIST_DENSITY.COMPACT}>
            <ListRow
              leading={
                <ProviderMark
                  provider={INTEGRATION_PROVIDER.MERCURY}
                  size={PROVIDER_MARK_SIZE.ICON}
                />
              }
              title="Mercury"
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
