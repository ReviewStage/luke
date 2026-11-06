import type { Workspace } from "@repo/features/workspace-wire";
import { ChevronDownIcon, dropBelowStart, GearIcon, NavItem, PlusIcon, useMenu } from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { sharedWords, WORKSPACE_REF_SIZE, WorkspaceCard, WorkspaceRef } from "./workspace-ref.js";
import { WorkspaceTile } from "./workspace-tile.js";

/**
 * workspace-switcher.tsx -- the sidebar's head: the workspace listed, by its tile and name and who shares it, and the menu that lists another.
 *
 * A workspace is a team's shared tasks, the first one made for the account
 * among them, and the sidebar lists one at a time. Its head stands at the
 * sidebar's top left, where Slack, Linear, and Vercel name the scope
 * everything under it belongs to: one control's row, standing on the line
 * the agents' tabs beside it stand on, its middle where theirs is
 * (`shell.css`), holding the workspace's tile and its name alone, as
 * Linear's and Slack's do. Who shares it, "5 members", or "Personal
 * workspace" for the account's own first workspace while no one else is in
 * it (`automations-page.tsx` reads the first listed as the account's own
 * too), is what a reader hears after its name and what its menu's row says,
 * since beside the name on one control's row it would be cut short. A press
 * drops the menu of every workspace the account is a member of from its left
 * edge, each by its tile with who shares it under its name, the listed one
 * checked and the workspace's card hung beside it while the pointer rests on it, then New workspace, which
 * opens its cards over the window (`new-workspace-steps.tsx`), and Workspace settings, which
 * opens Settings on the listed workspace's page, where its members and its
 * GitHub are managed. Nothing else stands in the menu. The head stands
 * whenever an account is signed in and its workspaces are read, its first
 * workspace alone included, because its menu is where a workspace is made;
 * before then the sidebar's head is the app's.
 */

/** The menu's items: every workspace by its tile, with who shares it under its name, the listed one checked; then New workspace and Workspace settings. */
export function workspaceMenuGroups(listed: Workspace, tasks: TasksControl): MenuAction[][] {
  const first = tasks.workspaces[0]?.id;
  const choices = tasks.workspaces.map(
    (workspace): MenuAction => ({
      label: workspace.name,
      key: workspace.id,
      replayMasked: true,
      icon: (
        <ReplayMask>
          <WorkspaceTile workspace={workspace} />
        </ReplayMask>
      ),
      detail: sharedWords(workspace.memberCount, workspace.id === first),
      card: <WorkspaceCard workspace={workspace} personal={workspace.id === first} />,
      checked: workspace.id === listed.id,
      onSelect: () => tasks.onChooseWorkspace(workspace.id),
    }),
  );
  return [
    choices,
    [
      { label: "New workspace", icon: <PlusIcon />, onSelect: tasks.newWorkspace.onOpen },
      { label: "Workspace settings", icon: <GearIcon />, onSelect: tasks.onOpenWorkspaceSettings },
    ],
  ];
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
  const menu = useMenu(tasks.shown && inSight);
  const listed = tasks.workspace;
  if (listed === undefined) return null;
  const personal = tasks.workspaces[0]?.id === listed.id;
  return (
    <div className="sidebar-workspace flex-none">
      <NavItem
        // The name a reader hears says who shares it too, since the label stands for the button's text.
        aria-label={[`Workspace: ${listed.name}`, sharedWords(listed.memberCount, personal)]
          .filter((part) => part !== undefined)
          .join(", ")}
        menu={menu.trigger(dropBelowStart)}
        mark={<ChevronDownIcon />}
      >
        <WorkspaceRef workspace={listed} size={WORKSPACE_REF_SIZE.HEAD} />
      </NavItem>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Workspaces"
          replayUnmasked
          menu={menu.drawn}
          groups={workspaceMenuGroups(listed, tasks)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}
