import {
  AVATAR_SIZE,
  Avatar,
  BADGE_TONE,
  BackIcon,
  Badge,
  ChevronDownIcon,
  ComposeIcon,
  FolderIcon,
  GearIcon,
  NAV_COUNT_SHOWN,
  NAV_CURRENT,
  NAV_ITEM_VARIANT,
  NavItem,
  SearchIcon,
  useMenu,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * nav-items.tsx -- a sidebar's places with their counts, marks, and chords,
 * the one shown, one unavailable, one unread; fold heads open and folded;
 * an account's menu trigger; and long names in a narrow column.
 */

/** A chord as an app draws one, hidden from a reader since the row names it. */
function Chord({ keys }: { keys: string }): React.JSX.Element {
  return <span aria-hidden="true">{keys}</span>;
}

function Places(): React.JSX.Element {
  const [shown, setShown] = useState("inbox");
  const place = (id: string) => ({
    current: shown === id ? NAV_CURRENT.PAGE : undefined,
    onClick: () => setShown(id),
  });
  return (
    <div className="catalog-narrow">
      <NavItem icon={<ComposeIcon />} shortcut={<Chord keys="⌘N" />} aria-keyshortcuts="Meta+N">
        New task
      </NavItem>
      <NavItem icon={<SearchIcon />} shortcut={<Chord keys="⌘K" />} aria-keyshortcuts="Meta+K">
        Search
      </NavItem>
      <NavItem
        icon={<FolderIcon />}
        count={{ value: 3, noun: "waiting on you" }}
        shortcut={<Chord keys="⇧⌘I" />}
        {...place("inbox")}
      >
        Inbox
      </NavItem>
      <NavItem icon={<GearIcon />} unread detail="2 new" {...place("general")}>
        general
      </NavItem>
      <NavItem icon={<FolderIcon />} disabled>
        Factory
      </NavItem>
      <NavItem icon={<BackIcon />} mark={<Badge tone={BADGE_TONE.ATTENTION}>Needs you</Badge>}>
        Back
      </NavItem>
    </div>
  );
}

function Folds(): React.JSX.Element {
  const [folded, setFolded] = useState(true);
  return (
    <div className="catalog-narrow">
      <NavItem
        variant={NAV_ITEM_VARIANT.HEAD}
        icon={<FolderIcon />}
        expanded={!folded}
        count={folded ? { value: 4, noun: "tasks", shown: NAV_COUNT_SHOWN.ON_HOVER } : undefined}
        onClick={() => setFolded((was) => !was)}
      >
        acme/web
      </NavItem>
      <NavItem
        variant={NAV_ITEM_VARIANT.HEAD}
        icon={<FolderIcon />}
        expanded={false}
        count={{ value: 2, noun: "need you" }}
      >
        Nightly review
      </NavItem>
      <NavItem variant={NAV_ITEM_VARIANT.HEAD} expanded>
        Tasks
      </NavItem>
    </div>
  );
}

function Account(): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <div className="catalog-narrow">
      <NavItem
        variant={NAV_ITEM_VARIANT.IDENTITY}
        icon={<Avatar name="Ada Lovelace" size={AVATAR_SIZE.ACCOUNT} decorative />}
        menu={menu.trigger()}
        mark={<ChevronDownIcon />}
      >
        Ada Lovelace
      </NavItem>
    </div>
  );
}

function NavItems(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="nav-item-places" title="Places, with counts, marks, and chords">
        <Places />
      </CatalogSection>
      <CatalogSection id="nav-item-folds" title="Fold heads, open and folded">
        <Folds />
      </CatalogSection>
      <CatalogSection id="nav-item-identity" title="Who: a menu's trigger">
        <Account />
      </CatalogSection>
      <CatalogSection id="nav-item-narrow" title="Long names in a narrow column">
        <div className="catalog-narrow">
          <NavItem icon={<FolderIcon />} count={{ value: 128, noun: "unread" }}>
            acme-corporation-engineering-platform
          </NavItem>
          <NavItem icon={<FolderIcon />} detail="Reviewing the release notes for the spring launch">
            Grace Hopper
          </NavItem>
        </div>
      </CatalogSection>
    </>
  );
}

export const NAV_ITEMS_EXAMPLE: Example = {
  id: "nav-items",
  title: "Nav items",
  Render: NavItems,
};
