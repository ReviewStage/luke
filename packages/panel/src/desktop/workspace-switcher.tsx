import type { Workspace } from "@repo/features/workspace-wire";
import { ChevronDownIcon, dropBelowStart, GearIcon, NavItem, PlusIcon, useMenu } from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { sharedWords, WORKSPACE_REF_SIZE, WorkspaceCard, WorkspaceRef } from "./workspace-ref.js";
import { WorkspaceTile } from "./workspace-tile.js";

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

export function WorkspaceSwitcher({
  tasks,
  inSight,
}: {
  tasks: TasksControl;
  inSight: boolean;
}): React.JSX.Element | null {
  const menu = useMenu(tasks.shown && inSight);
  const listed = tasks.workspace;
  if (listed === undefined) return null;
  const personal = tasks.workspaces[0]?.id === listed.id;
  return (
    <div className="sidebar-workspace flex-none">
      <NavItem
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
