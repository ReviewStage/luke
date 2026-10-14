import type { Workspace } from "@sidecar/hosted/workspace-wire";
import { ChevronDownIcon, GearIcon, PlusIcon } from "@sidecar/panel";
import type { PlansControl } from "../planning/use-plans-tab";
import { ActionMenu, dropBelowStart, type MenuAction, useActionMenu } from "./action-menu";
import { useNewWorkspaceDialog } from "./new-workspace-dialog";

/**
 * workspace-switcher.tsx -- the head of the sidebar's plans: which of the account's workspaces they are, and the menu that lists another.
 *
 * A workspace is a team's shared plans, the first one made for the account
 * among them, and the sidebar lists one at a time. Its head names the workspace listed,
 * and a press drops the menu of every workspace the account is a member of
 * from its left edge, the listed one checked, then New workspace, which asks
 * a name and lists the workspace made, and Workspace settings, which opens Settings on the
 * listed workspace's page, where its members and its GitHub repositories
 * are managed. Nothing else stands in the menu. The head
 * stands whenever an account is signed in, its first workspace alone
 * included, because its menu is where a workspace is made.
 */

/** The menu's items: every workspace, the listed one checked; then New workspace and Workspace settings. */
function workspaceMenuGroups(
  listed: Workspace,
  plans: PlansControl,
  onNew: () => void,
): MenuAction[][] {
  const choices = plans.workspaces.map(
    (workspace): MenuAction => ({
      label: workspace.name,
      checked: workspace.id === listed.id,
      onSelect: () => plans.onChooseWorkspace(workspace.id),
    }),
  );
  return [
    choices,
    [
      { label: "New workspace", icon: <PlusIcon />, onSelect: onNew },
      { label: "Workspace settings", icon: <GearIcon />, onSelect: plans.onOpenWorkspaceSettings },
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
  const naming = useNewWorkspaceDialog(plans.onCreateWorkspace, {
    signedIn: plans.signedIn,
    surfaceOpen: plans.shown && inSight,
  });
  const menu = useActionMenu(plans.shown && inSight);
  const listed = plans.workspace;
  if (listed === undefined) return null;
  return (
    <div className="sidebar-workspace">
      <button
        type="button"
        className="sidebar-workspace-toggle"
        aria-label={`Workspace: ${listed.name}`}
        {...menu.trigger(dropBelowStart)}
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
