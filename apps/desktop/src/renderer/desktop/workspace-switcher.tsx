import type { Workspace } from "@luke/features/workspace-wire";
import {
  ChevronDownIcon,
  dropBelowStart,
  GearIcon,
  NAV_ITEM_VARIANT,
  NavItem,
  PlusIcon,
  useMenu,
} from "@luke/ui";
import { UsersIcon } from "lucide-react";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { ActionMenu, type MenuAction } from "./action-menu";
import { useNewWorkspaceDialog } from "./new-workspace-dialog";
import { sharedWords, WORKSPACE_REF_SIZE, WorkspaceRef } from "./workspace-ref";
import { WorkspaceTile } from "./workspace-tile";

/**
 * workspace-switcher.tsx -- the sidebar's head: the workspace listed, by its tile and name and who shares it, and the menu that lists another.
 *
 * A workspace is a team's shared tasks, the first one made for the account
 * among them, and the sidebar lists one at a time. Its head stands at the
 * sidebar's top left, where Slack, Linear, and Vercel name the scope
 * everything under it belongs to (`docs/proposals/workspace-clarity.md`,
 * variant A): the workspace's tile, its name, and under it who shares it,
 * "5 members", or "Personal workspace" for the account's own first
 * workspace while no one else is in it (`automations-page.tsx` reads the
 * first listed as the account's own too). A press
 * drops the menu of every workspace the account is a member of from its left
 * edge, each by its tile with who shares it under its name, the listed one
 * checked, then New workspace, which
 * asks a name and lists the workspace made, and Workspace settings, which
 * opens Settings on the listed workspace's page, where its members and its
 * GitHub are managed. Nothing else stands in the menu. The head stands
 * whenever an account is signed in and its workspaces are read, its first
 * workspace alone included, because its menu is where a workspace is made;
 * before then the sidebar's head is Luke's.
 */

/** The menu's items: every workspace by its tile, with who shares it under its name as the head says it, the listed one checked; then New workspace and Workspace settings. */
function workspaceMenuGroups(
  listed: Workspace,
  tasks: TasksControl,
  onNew: () => void,
): MenuAction[][] {
  const first = tasks.workspaces[0]?.id;
  const choices = tasks.workspaces.map(
    (workspace): MenuAction => ({
      label: workspace.name,
      icon: <WorkspaceTile workspace={workspace} />,
      detail: sharedWords(workspace.memberCount, workspace.id === first),
      checked: workspace.id === listed.id,
      onSelect: () => tasks.onChooseWorkspace(workspace.id),
    }),
  );
  return [
    choices,
    [
      { label: "New workspace", icon: <PlusIcon />, onSelect: onNew },
      { label: "Workspace settings", icon: <GearIcon />, onSelect: tasks.onOpenWorkspaceSettings },
    ],
  ];
}

/** The head's line saying who shares the workspace, a people glyph before a team's members counted; none where the service does not count them. */
function sharedLine(count: number | undefined, personal: boolean): React.JSX.Element | undefined {
  const words = sharedWords(count, personal);
  if (count === undefined || words === undefined) return undefined;
  return (
    <span className="sidebar-workspace-shared">
      {personal && count <= 1 ? null : <UsersIcon aria-hidden="true" />}
      {words}
    </span>
  );
}

/** The sidebar's head while an account is signed in and its workspaces are read. */
export function WorkspaceSwitcher({
  tasks,
  inSight,
}: {
  tasks: TasksControl;
  /** Whether the sidebar is in sight, so the menu closes with it folding away. */
  inSight: boolean;
}): React.JSX.Element | null {
  const naming = useNewWorkspaceDialog(tasks.onCreateWorkspace, {
    signedIn: tasks.signedIn,
    surfaceOpen: tasks.shown && inSight,
  });
  const menu = useMenu(tasks.shown && inSight);
  const listed = tasks.workspace;
  if (listed === undefined) return null;
  const personal = tasks.workspaces[0]?.id === listed.id;
  return (
    <div className="sidebar-workspace">
      <NavItem
        variant={NAV_ITEM_VARIANT.IDENTITY}
        // The name a reader hears says who shares it too, since the label stands for the button's text.
        aria-label={[`Workspace: ${listed.name}`, sharedWords(listed.memberCount, personal)]
          .filter((part) => part !== undefined)
          .join(", ")}
        menu={menu.trigger(dropBelowStart)}
        mark={<ChevronDownIcon />}
      >
        <WorkspaceRef
          workspace={listed}
          size={WORKSPACE_REF_SIZE.HEAD}
          line={sharedLine(listed.memberCount, personal)}
        />
      </NavItem>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Workspaces"
          menu={menu.drawn}
          groups={workspaceMenuGroups(listed, tasks, naming.ask)}
          onClose={menu.close}
        />
      )}
      {naming.dialog}
    </div>
  );
}
