import {
  ArchiveIcon,
  BUTTON_SIZE,
  GAP,
  Inline,
  Menu,
  type MenuEntry,
  MoreButton,
  PageToolbar,
  PencilIcon,
  TrashIcon,
  useMenu,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * more-buttons.tsx -- a header's ⋯ dropping its thing's menu, named for the
 * thing ("Automation actions"), at the control's size and compact, and one
 * whose menu is unavailable. A row's ⋯ is `ListRow`'s `menu`, drawn in the
 * list rows' example.
 */

const ignore = (): void => undefined;

const AUTOMATION_ACTIONS: readonly (readonly MenuEntry[])[] = [
  [
    { label: "Rename", icon: <PencilIcon />, onSelect: ignore },
    { label: "Archive", icon: <ArchiveIcon />, onSelect: ignore },
  ],
  [{ label: "Delete", icon: <TrashIcon />, danger: true, onSelect: ignore }],
];

/** A ⋯ in a page's strip and the menu it drops. */
function AutomationHeader(): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <>
      <PageToolbar actions={<MoreButton thing="Automation" {...menu.trigger()} />} />
      {menu.drawn && (
        <Menu
          label="Automation actions"
          menu={menu.drawn}
          groups={AUTOMATION_ACTIONS}
          onClose={menu.close}
        />
      )}
    </>
  );
}

function MoreButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="more-button-header" title="A header's ⋯ and its menu">
        <AutomationHeader />
      </CatalogSection>
      <CatalogSection id="more-button-sizes" title="Compact, and unavailable">
        <Inline gap={GAP.CONTROL}>
          <MoreButton thing="Repository" size={BUTTON_SIZE.COMPACT} />
          <MoreButton thing="Task" disabled />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const MORE_BUTTONS_EXAMPLE: Example = {
  id: "more-buttons",
  title: "More buttons",
  Render: MoreButtons,
};
