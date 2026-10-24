import {
  AVATAR_SIZE,
  Avatar,
  Badge,
  ChevronDownIcon,
  ComposeIcon,
  FolderIcon,
  GearIcon,
  InboxIcon,
  NAV_CURRENT,
  NAV_ITEM_VARIANT,
  NavItem,
  NavItemLink,
  SearchIcon,
  STATUS_TONE,
  useMenu,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * nav-items.tsx -- a sidebar's places with their counts, marks, and chords,
 * the one shown, one unavailable, one unread; an account's menu trigger;
 * links with addresses of their own; and long names in a narrow column.
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
        count={{ value: 3, noun: "waiting on you", tone: STATUS_TONE.ATTENTION }}
        shortcut={<Chord keys="⇧⌘I" />}
        {...place("inbox")}
      >
        Inbox
      </NavItem>
      <NavItem icon={<GearIcon />} unread detail="2 new" {...place("general")}>
        general
      </NavItem>
      <NavItem icon={<FolderIcon />} disabled>
        Automations
      </NavItem>
      <NavItem icon={<InboxIcon />} mark={<Badge tone={STATUS_TONE.ATTENTION}>Needs you</Badge>}>
        Inbox
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

/** Places with addresses of their own: a plain press stays here, a modified one opens a tab. */
function Links(): React.JSX.Element {
  const [shown, setShown] = useState("dashboard");
  const link = (id: string) => ({
    href: `#${id}`,
    current: shown === id ? NAV_CURRENT.PAGE : undefined,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      setShown(id);
    },
  });
  return (
    <div className="catalog-narrow">
      <NavItemLink icon={<FolderIcon />} {...link("dashboard")}>
        Dashboard
      </NavItemLink>
      <NavItemLink icon={<GearIcon />} {...link("users")}>
        Users
      </NavItemLink>
    </div>
  );
}

function NavItems(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="nav-item-places" title="Places, with counts, marks, and chords">
        <Places />
      </CatalogSection>
      <CatalogSection id="nav-item-identity" title="Who: a menu's trigger">
        <Account />
      </CatalogSection>
      <CatalogSection id="nav-item-links" title="Links to places of their own">
        <Links />
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
