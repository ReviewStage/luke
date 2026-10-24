import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  ComboboxList,
  CopyIcon,
  DocumentIcon,
  dropBelowStart,
  FolderIcon,
  GAP,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  IconButton,
  Inline,
  LIST_VARIANT,
  List,
  ListRow,
  MENU_DETAIL,
  MENU_ITEM_MARK,
  MENU_SURFACE_FLOW,
  MENU_SURFACE_INSET,
  Menu,
  type MenuEntry,
  MenuGlyph,
  MenuItem,
  MenuSurface,
  MoreButton,
  PencilIcon,
  SearchField,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
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
 * and a footer, its long words fading where cut; people whose items hang
 * their cards beside them; one a right-click hangs at the pointer; a searchable menu's pinned rows, steered from its field: one
 * opening a list beside it, a switch, and one that does not apply now; and
 * the menu's surface under lists an app hangs and keys itself: an `@` list
 * narrowed under its kind's crumb, edge to edge, one press inset, as
 * one offered over selected words is, and a find bar's field and buttons
 * laid side by side on it; and toolbars floated on it, a hair round their
 * buttons: a message's actions, a picture's worded tools, and one press.
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
      <MoreButton thing="Task" {...menu.trigger()} />
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

/** A people filter: each person's item, their email beside their name, hangs their card beside it while the pointer rests there, a long name fading where cut. */
function PeopleMenu(): React.JSX.Element {
  const menu = useMenu(true);
  const person = (name: string, email: string, note: string) => ({
    label: name,
    detail: email,
    detailPlace: MENU_DETAIL.BESIDE,
    icon: <UserIcon />,
    card: (
      <HoverCard>
        <HoverCardHead name={name} sub={email} />
        <HoverCardNote>{note}</HoverCardNote>
      </HoverCard>
    ),
    onSelect: ignore,
  });
  return (
    <>
      <Button icon={<UserIcon />} {...menu.trigger(dropBelowStart)}>
        People
      </Button>
      {menu.drawn && (
        <Menu
          label="People"
          menu={menu.drawn}
          groups={[
            [{ label: "Anyone", onSelect: ignore }],
            [
              person("Ada Lovelace", "ada@analytical-engine.example", "Owner, since March."),
              person(
                "Augusta Ada King, Countess of Lovelace and Patron of the Analytical Engine",
                "augusta.ada.king@countess-of-lovelace.example",
                "Member, with three tasks open.",
              ),
            ],
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * A row's menu: its ⋯, a right-click or a touch held on it, and the menu key
 * open the one menu of the task's acts.
 */
function RightClickRow(): React.JSX.Element {
  return (
    <List label="Tasks" variant={LIST_VARIANT.CARD}>
      <ListRow
        title="Right-click anywhere in this row, or hold it on a touch screen."
        menu={{ thing: "Task", groups: TASK_ACTIONS }}
      />
    </List>
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

/** A narrowed `@` list on the menu's surface, under its kind's crumb, as an editor hangs one. */
function NarrowedList(): React.JSX.Element {
  const [active, setActive] = useState(0);
  return (
    <MenuSurface className="catalog-menu-surface" inset={MENU_SURFACE_INSET.NONE}>
      <div className="catalog-menu-crumb">
        <Inline gap={GAP.ICON}>
          <MenuGlyph>
            <FolderIcon aria-hidden="true" />
          </MenuGlyph>
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION}>
            Files and folders
          </Text>
        </Inline>
      </div>
      <ComboboxList
        label="Mention"
        groups={[
          {
            options: [
              { id: "readme", label: "README.md", icon: <DocumentIcon />, detail: "docs" },
              { id: "src", label: "src/", icon: <FolderIcon />, detail: "packages/ui" },
            ],
          },
        ]}
        active={active}
        onActiveChange={setActive}
        onChoose={setActive}
        headed={false}
        empty="Nothing matches"
      />
    </MenuSurface>
  );
}

/** A find bar on the menu's surface: its field, then the buttons that step through what it found. */
function FindBar(): React.JSX.Element {
  const [query, setQuery] = useState("");
  return (
    <MenuSurface flow={MENU_SURFACE_FLOW.ROW} role="search" aria-label="Find">
      <SearchField label="Find" placeholder="Find" value={query} onChange={setQuery} />
      <IconButton label="Previous match" icon={<ArrowUpIcon />} onClick={ignore} />
      <IconButton label="Next match" icon={<ArrowDownIcon />} onClick={ignore} />
    </MenuSurface>
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
          <PeopleMenu />
        </Inline>
      </CatalogSection>
      <CatalogSection id="menu-pointer" title="At the pointer">
        <RightClickRow />
      </CatalogSection>
      <CatalogSection id="menu-pinned" title="Pinned rows steered from a field">
        <PinnedRows />
      </CatalogSection>
      <CatalogSection id="menu-surface" title="The surface under a list an app keys">
        <Inline gap={GAP.CONTROL}>
          <NarrowedList />
          <MenuSurface>
            <Button icon={<CopyIcon />} onClick={ignore}>
              Copy
            </Button>
          </MenuSurface>
          <FindBar />
        </Inline>
      </CatalogSection>
      <CatalogSection id="menu-toolbar" title="A toolbar floated over what it acts on">
        <Inline gap={GAP.CONTROL}>
          <MenuSurface flow={MENU_SURFACE_FLOW.TOOLBAR}>
            <IconButton
              label="Copy"
              icon={<CopyIcon />}
              size={BUTTON_SIZE.COMPACT}
              onClick={ignore}
            />
            <IconButton
              label="Edit"
              icon={<PencilIcon />}
              size={BUTTON_SIZE.COMPACT}
              onClick={ignore}
            />
          </MenuSurface>
          <MenuSurface flow={MENU_SURFACE_FLOW.TOOLBAR} role="toolbar" aria-label="Picture">
            <Button variant={BUTTON_VARIANT.QUIET} icon={<PencilIcon />} onClick={ignore}>
              Describe
            </Button>
            <Button variant={BUTTON_VARIANT.DANGER} icon={<TrashIcon />} onClick={ignore}>
              Remove
            </Button>
          </MenuSurface>
          <MenuSurface flow={MENU_SURFACE_FLOW.TOOLBAR}>
            <Button icon={<DocumentIcon />} onClick={ignore}>
              Comment
            </Button>
          </MenuSurface>
        </Inline>
      </CatalogSection>
    </>
  );
}

export const MENU_EXAMPLE: Example = {
  id: "menu",
  title: "Menu",
  Render: MenuExample,
};
