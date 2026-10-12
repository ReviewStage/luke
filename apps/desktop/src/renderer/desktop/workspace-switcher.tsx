import type { Workspace } from "@sidecar/hosted/workspace-wire";
import { CheckIcon, ChevronDownIcon, GearIcon } from "@sidecar/panel";
import type { PlansControl } from "../planning/use-plans-tab";
import {
  ActionMenu,
  MENU_ALIGN,
  MENU_DROP,
  type MenuAction,
  type MenuPlacement,
  useActionMenu,
} from "./action-menu";

/**
 * workspace-switcher.tsx -- the head of the sidebar's plans: which of the account's workspaces they are, and the menu that lists another.
 *
 * A workspace is a team's shared plans, or the account's personal ones, and
 * the sidebar lists one at a time. Its head names the workspace listed, and
 * a press drops the menu of every workspace the account is a member of, the
 * listed one checked, then Manage workspaces…, which opens the service's
 * Workspaces page in the browser, where workspaces are made and members
 * added. An account in its personal workspace alone has nothing to switch
 * between, so it draws no head at all and its plans read as they always did.
 */

/** Where the menu hangs: under the head, its left edge on the head's, since the head spans the column. */
function dropUnder(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START };
}

/** The menu's items: every workspace, the listed one checked, then the way to manage them. */
function workspaceMenuGroups(listed: Workspace, plans: PlansControl): MenuAction[][] {
  const choices = plans.workspaces.map(
    (workspace): MenuAction => ({
      label: workspace.name,
      ...(workspace.id === listed.id ? { icon: <CheckIcon /> } : undefined),
      onSelect: () => plans.onChooseWorkspace(workspace.id),
    }),
  );
  const manage: MenuAction = {
    label: "Manage workspaces…",
    icon: <GearIcon />,
    onSelect: plans.onManageWorkspaces,
  };
  return [choices, [manage]];
}

/** The plans' head while the account is in two workspaces or more; nothing while it is in one. */
export function WorkspaceSwitcher({
  plans,
  inSight,
}: {
  plans: PlansControl;
  /** Whether the sidebar is in sight, so the menu closes with it folding away. */
  inSight: boolean;
}): React.JSX.Element | null {
  const menu = useActionMenu(plans.shown && inSight);
  const listed = plans.workspace;
  if (listed === undefined || plans.workspaces.length < 2) return null;
  return (
    <div className="sidebar-workspace">
      <button
        type="button"
        className="sidebar-workspace-toggle"
        aria-haspopup="menu"
        aria-expanded={menu.open !== undefined}
        aria-label={`Workspace: ${listed.name}`}
        onClick={(event) => {
          if (menu.open !== undefined) {
            menu.close(true);
            return;
          }
          menu.show(dropUnder(event.currentTarget), event.currentTarget);
        }}
      >
        <span className="sidebar-workspace-name">{listed.name}</span>
        <ChevronDownIcon />
      </button>
      {menu.open === undefined ? null : (
        <ActionMenu
          label="Workspaces"
          menu={menu.open}
          groups={workspaceMenuGroups(listed, plans)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}
