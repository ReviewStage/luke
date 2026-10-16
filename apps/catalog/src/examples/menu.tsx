import {
  ArchiveIcon,
  BUTTON_VARIANT,
  Button,
  CopyIcon,
  dropBelowStart,
  EllipsisIcon,
  GAP,
  IconButton,
  Inline,
  Menu,
  type MenuEntry,
  PencilIcon,
  TEXT_TONE,
  Text,
  TrashIcon,
  UserIcon,
  useMenu,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * menu.tsx -- a menu dropped from a ⋯ with glyphs, shortcuts, a dimmed item
 * and a red one ruled apart; one of settings in submenus; one with a heading
 * and a footer, its long words cut short; and one a right-click hangs at the
 * pointer.
 */

const ignore = () => undefined;

const PLAN_ACTIONS: readonly (readonly MenuEntry[])[] = [
  [
    { label: "Rename", icon: <PencilIcon />, hint: "⌘R", onSelect: ignore },
    { label: "Copy link", icon: <CopyIcon />, hint: "⇧⌘C", onSelect: ignore },
    { label: "Move to workspace", onSelect: ignore, disabled: true },
    { label: "Archive", icon: <ArchiveIcon />, onSelect: ignore },
  ],
  [{ label: "Delete", icon: <TrashIcon />, danger: true, onSelect: ignore }],
];

/** A ⋯ and the plan's menu it drops. */
function PlanMenu(): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <>
      <IconButton icon={<EllipsisIcon />} label="Plan actions" {...menu.trigger()} />
      {menu.drawn && (
        <Menu label="Plan actions" menu={menu.drawn} groups={PLAN_ACTIONS} onClose={menu.close} />
      )}
    </>
  );
}

const GROUPINGS = ["Repository", "Status", "None"] as const;
const ORDERS = ["Last updated", "Created", "Name"] as const;

/** View options: two submenus of settings, each a check on the one chosen. */
function ViewMenu(): React.JSX.Element {
  const menu = useMenu(true);
  const [grouping, setGrouping] = useState<string>("Repository");
  const [order, setOrder] = useState<string>("Last updated");
  const [archived, setArchived] = useState(false);
  const choices = (labels: readonly string[], chosen: string, choose: (label: string) => void) =>
    labels.map((label) => ({ label, checked: label === chosen, onSelect: () => choose(label) }));
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} {...menu.trigger(dropBelowStart)}>
        View options
      </Button>
      {menu.drawn && (
        <Menu
          label="View options"
          menu={menu.drawn}
          groups={[
            [
              { label: "Group by", items: choices(GROUPINGS, grouping, setGrouping) },
              { label: "Order by", items: choices(ORDERS, order, setOrder) },
            ],
            [{ label: "Show archived", checked: archived, onSelect: () => setArchived(!archived) }],
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The account's menu: whose it is over its items, long words cut short, and who shares it under them. */
function AccountMenu(): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <>
      <Button icon={<UserIcon />} {...menu.trigger(dropBelowStart)}>
        Account
      </Button>
      {menu.drawn && (
        <Menu
          label="Account"
          menu={menu.drawn}
          heading={
            <>
              <Text>Ada Lovelace</Text>
              <Text tone={TEXT_TONE.MUTED}>ada.lovelace@analytical-engine.example</Text>
            </>
          }
          footer="Shared with Charles Babbage and Mary Somerville"
          groups={[
            [
              {
                label: "Analytical Engine Society of Greater London",
                detail: "Owner, with 12 members",
                onSelect: ignore,
              },
              { label: "Settings", hint: "⌘,", onSelect: ignore },
            ],
            [{ label: "Sign out", onSelect: ignore }],
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** A row a right-click opens the plan's menu on, at the pointer. */
function RightClickRow(): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <>
      <button type="button" className="catalog-menu-row" onContextMenu={menu.contextMenu()}>
        <Text tone={TEXT_TONE.MUTED}>Right-click anywhere in this row.</Text>
      </button>
      {menu.drawn && (
        <Menu label="Plan actions" menu={menu.drawn} groups={PLAN_ACTIONS} onClose={menu.close} />
      )}
    </>
  );
}

function MenuExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="menu-buttons" title="From a button">
        <Inline gap={GAP.CONTROL}>
          <PlanMenu />
          <ViewMenu />
          <AccountMenu />
        </Inline>
      </CatalogSection>
      <CatalogSection id="menu-pointer" title="At the pointer">
        <RightClickRow />
      </CatalogSection>
    </>
  );
}

export const MENU_EXAMPLE: Example = {
  id: "menu",
  title: "Menu",
  Render: MenuExample,
};
