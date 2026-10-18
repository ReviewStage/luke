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
  MENU_ITEM_MARK,
  Menu,
  type MenuEntry,
  MenuItem,
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
 * and a footer, its long words cut short; one a right-click hangs at the
 * pointer; and a searchable menu's pinned rows, steered from its field: one
 * opening a list beside it, a switch, and one that does not apply now.
 */

const ignore = () => undefined;

const TASK_ACTIONS: readonly (readonly MenuEntry[])[] = [
  [
    { label: "Rename", icon: <PencilIcon />, hint: "⌘R", onSelect: ignore },
    { label: "Copy link", icon: <CopyIcon />, hint: "⇧⌘C", onSelect: ignore },
    { label: "Move to workspace", onSelect: ignore, disabled: true },
    { label: "Archive", icon: <ArchiveIcon />, onSelect: ignore },
  ],
  [{ label: "Delete", icon: <TrashIcon />, danger: true, onSelect: ignore }],
];

/** A ⋯ and the task's menu it drops. */
function TaskMenu(): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <>
      <IconButton icon={<EllipsisIcon />} label="Task actions" {...menu.trigger()} />
      {menu.drawn && (
        <Menu label="Task actions" menu={menu.drawn} groups={TASK_ACTIONS} onClose={menu.close} />
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

/** A row a right-click opens the task's menu on, at the pointer. */
function RightClickRow(): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <>
      <button type="button" className="catalog-menu-row" onContextMenu={menu.contextMenu()}>
        <Text tone={TEXT_TONE.MUTED}>Right-click anywhere in this row.</Text>
      </button>
      {menu.drawn && (
        <Menu label="Task actions" menu={menu.drawn} groups={TASK_ACTIONS} onClose={menu.close} />
      )}
    </>
  );
}

/** Pinned rows as a model picker's foot draws them, the pointer moving their one highlight. */
function PinnedRows(): React.JSX.Element {
  const [highlighted, setHighlighted] = useState("effort");
  const [fast, setFast] = useState(true);
  const steered = (id: string) => ({
    id: `catalog-pinned-${id}`,
    highlighted: highlighted === id,
    onHover: () => setHighlighted(id),
  });
  return (
    <div className="catalog-popover catalog-column">
      <MenuItem
        action={{ label: "Effort", hint: "High", opens: true, onSelect: ignore }}
        steered={{ ...steered("effort"), expanded: false }}
        onChoose={ignore}
      />
      <MenuItem
        action={{ label: "Fast", checked: fast, mark: MENU_ITEM_MARK.SWITCH, onSelect: ignore }}
        steered={steered("fast")}
        onChoose={() => setFast(!fast)}
      />
      <MenuItem
        action={{ label: "Long context", disabled: true, onSelect: ignore }}
        steered={steered("long")}
        onChoose={ignore}
      />
    </div>
  );
}

function MenuExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="menu-buttons" title="From a button">
        <Inline gap={GAP.CONTROL}>
          <TaskMenu />
          <ViewMenu />
          <AccountMenu />
        </Inline>
      </CatalogSection>
      <CatalogSection id="menu-pointer" title="At the pointer">
        <RightClickRow />
      </CatalogSection>
      <CatalogSection id="menu-pinned" title="Pinned rows steered from a field">
        <PinnedRows />
      </CatalogSection>
    </>
  );
}

export const MENU_EXAMPLE: Example = {
  id: "menu",
  title: "Menu",
  Render: MenuExample,
};
