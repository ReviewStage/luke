import {
  AVATAR_SIZE,
  Avatar,
  ComposeIcon,
  GearIcon,
  IconButton,
  InboxIcon,
  NAV_CURRENT,
  NavItem,
  SearchIcon,
  SidebarAccountRow,
  SidebarFilters,
  SidebarFoot,
  SidebarIdentity,
  SidebarPlaces,
  SidebarRule,
  STATUS_TONE,
  WingFace,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * sidebar-parts.tsx -- the parts every surface drawing the app's sidebar
 * shares: Luke's head, and the same head naming the surface it stands on;
 * the places over their rule; a place and the rows that narrow it; and the
 * foot's account row.
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
      <CatalogSection id="sidebar-filters" title="A place and the rows that narrow it">
        <div className="catalog-narrow">
          <SidebarPlaces label="Places">
            <NavItem
              icon={<InboxIcon />}
              count={{ value: 3, noun: "need you", tone: STATUS_TONE.ATTENTION }}
            >
              Inbox
            </NavItem>
            <SidebarFilters label="Channels">
              <NavItem icon={<GLYPH.CHANNEL />} current={NAV_CURRENT.PAGE} unread>
                general
              </NavItem>
              <NavItem
                icon={<GLYPH.CHANNEL />}
                count={{ value: 1, noun: "needs you", tone: STATUS_TONE.ATTENTION }}
              >
                infra
              </NavItem>
              <NavItem icon={<GLYPH.ADD />}>Add channel</NavItem>
            </SidebarFilters>
          </SidebarPlaces>
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
