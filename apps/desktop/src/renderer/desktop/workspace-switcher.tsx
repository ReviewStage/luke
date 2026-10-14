import type { Workspace } from "@sidecar/hosted/workspace-wire";
import { CheckIcon, ChevronDownIcon, GearIcon, PlusIcon } from "@sidecar/panel";
import type { PlansControl } from "../planning/use-plans-tab";
import { ActionMenu, dropBelow, type MenuAction, useActionMenu } from "./action-menu";
import { useNewWorkspaceDialog } from "./new-workspace-dialog";

/**
 * workspace-switcher.tsx -- the head of the sidebar's plans: which of the account's workspaces they are, and the menu that lists another.
 *
 * A workspace is the account's personal plans, or a team's shared plans,
 * and the sidebar lists one at a time. Its head names the workspace listed,
 * and a press drops the menu of every workspace the account is a member of,
 * the listed one checked, then New workspace…, which asks a name and lists
 * the workspace made, and Workspace settings…, which opens Settings on the
 * listed workspace's page, where its members and its GitHub repositories
 * are managed. Nothing else stands in the menu. The head
 * stands whenever an account is signed in, its personal workspace alone
 * included, because its menu is where a workspace is made.
 */

/** The menu's items: every workspace, the listed one checked; then New workspace… and Workspace settings…. */
function workspaceMenuGroups(
  listed: Workspace,
  plans: PlansControl,
  onNew: () => void,
): MenuAction[][] {
  const choices = plans.workspaces.map(
    (workspace): MenuAction => ({
      label: workspace.name,
      ...(workspace.id === listed.id ? { icon: <CheckIcon /> } : undefined),
      onSelect: () => plans.onChooseWorkspace(workspace.id),
    }),
  );
  return [
    choices,
    [
      { label: "New workspace…", icon: <PlusIcon />, onSelect: onNew },
      { label: "Workspace settings…", icon: <GearIcon />, onSelect: plans.onOpenWorkspaceSettings },
    ],
  ];
}

/** The plans' head while an account is signed in and its workspaces are read. */
export function WorkspaceSwitcher({
  plans,
  inSight,
}: {
  plans: PlansControl;
  /** Whether the sidebar is in sight, so the menu closes with it folding away. */
  inSight: boolean;
}): React.JSX.Element | null {
  const naming = useNewWorkspaceDialog(plans.onCreateWorkspace);
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
          menu.show(dropBelow(event.currentTarget), event.currentTarget);
        }}
      >
        <span className="sidebar-workspace-name">{listed.name}</span>
        <ChevronDownIcon />
      </button>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Workspaces"
          menu={menu.drawn}
          groups={workspaceMenuGroups(listed, plans, naming.ask)}
          onClose={menu.close}
        />
      )}
      {naming.dialog}
    </div>
  );
}
