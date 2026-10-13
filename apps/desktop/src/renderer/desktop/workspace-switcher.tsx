import type { Workspace } from "@sidecar/hosted/workspace-wire";
import { CheckIcon, ChevronDownIcon, UserIcon } from "@sidecar/panel";
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
 * A workspace is the account's personal plans, or a team's shared plans,
 * and the sidebar lists one at a time. Its head names the workspace listed,
 * and a press drops the menu of every workspace the account is a member of,
 * the listed one checked, then, while a team's workspace is listed,
 * Members…, which opens Settings on its members. The head stands whenever
 * an account is signed in, its personal workspace alone included, because
 * its menu is where a workspace is made.
 */

/** Where the menu hangs: under the head, its left edge on the head's, since the head spans the column. */
function dropUnder(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START };
}

/** The menu's items: every workspace, the listed one checked, then a team's members. */
function workspaceMenuGroups(
  listed: Workspace,
  plans: PlansControl,
  onOpenMembers: () => void,
): MenuAction[][] {
  const choices = plans.workspaces.map(
    (workspace): MenuAction => ({
      label: workspace.name,
      ...(workspace.id === listed.id ? { icon: <CheckIcon /> } : undefined),
      onSelect: () => plans.onChooseWorkspace(workspace.id),
    }),
  );
  if (listed.personal) return [choices];
  return [choices, [{ label: "Members…", icon: <UserIcon />, onSelect: onOpenMembers }]];
}

/** The plans' head while an account is signed in and its workspaces are read. */
export function WorkspaceSwitcher({
  plans,
  inSight,
  onOpenMembers,
}: {
  plans: PlansControl;
  /** Whether the sidebar is in sight, so the menu closes with it folding away. */
  inSight: boolean;
  /** Opens Settings, where the listed workspace's members stand. */
  onOpenMembers: () => void;
}): React.JSX.Element | null {
  const menu = useActionMenu(plans.shown && inSight);
  const listed = plans.workspace;
  if (listed === undefined) return null;
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
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Workspaces"
          menu={menu.drawn}
          groups={workspaceMenuGroups(listed, plans, onOpenMembers)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}
