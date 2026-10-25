import {
  AVATAR_SIZE,
  Avatar,
  ComposeIcon,
  GearIcon,
  IconButton,
  NAV_CURRENT,
  NavItem,
  SearchIcon,
  SidebarAccountRow,
  SidebarFoot,
  SidebarIdentity,
  SidebarPlaces,
  SidebarRule,
  WingFace,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * sidebar-parts.tsx -- the parts every surface drawing the app's sidebar
 * shares: Luke's head, and the same head naming the surface it stands on;
 * the places over their rule; and the foot's account row.
 */

function SidebarParts(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="sidebar-identity" title="Head">
        <div className="catalog-narrow">
          <SidebarIdentity name="Luke" face={<WingFace fill />} />
        </div>
      </CatalogSection>
      <CatalogSection id="sidebar-identity-qualified" title="Head on a surface of its own">
        <div className="catalog-narrow">
          <SidebarIdentity name="Luke" qualifier="Admin" face={<WingFace fill />} />
        </div>
      </CatalogSection>
      <CatalogSection id="sidebar-places" title="Places over their rule">
        <div className="catalog-narrow">
          <SidebarPlaces label="Places">
            <NavItem icon={<ComposeIcon />}>New task</NavItem>
            <NavItem icon={<SearchIcon />} current={NAV_CURRENT.PAGE}>
              Search
            </NavItem>
          </SidebarPlaces>
          <SidebarRule />
        </div>
      </CatalogSection>
      <CatalogSection id="sidebar-foot" title="Foot">
        <div className="catalog-narrow">
          <SidebarFoot>
            <SidebarAccountRow>
              <NavItem icon={<Avatar name="Ada Lovelace" size={AVATAR_SIZE.ACCOUNT} decorative />}>
                Ada Lovelace
              </NavItem>
              <IconButton icon={<GearIcon />} label="Settings" />
            </SidebarAccountRow>
          </SidebarFoot>
        </div>
      </CatalogSection>
    </>
  );
}

export const SIDEBAR_PARTS_EXAMPLE: Example = {
  id: "sidebar-parts",
  title: "Sidebar parts",
  Render: SidebarParts,
};
