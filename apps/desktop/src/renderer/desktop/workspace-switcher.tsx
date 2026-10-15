import type { Workspace } from "@luke/features/workspace-wire";
import { ChevronDownIcon, GearIcon, PlusIcon } from "@luke/ui";
import { UsersIcon } from "lucide-react";
import type { PlansControl } from "../planning/use-plans-tab";
import { ActionMenu, dropBelowStart, type MenuAction, useActionMenu } from "./action-menu";
import { useNewWorkspaceDialog } from "./new-workspace-dialog";
import { TILE_SIZE, WorkspaceTile } from "./workspace-tile";

/**
 * workspace-switcher.tsx -- the sidebar's head: the workspace listed, by its tile and name and who shares it, and the menu that lists another.
 *
 * A workspace is a team's shared plans, the first one made for the account
 * among them, and the sidebar lists one at a time. Its head stands at the
 * sidebar's top left, where Slack, Linear, and Vercel name the scope
 * everything under it belongs to (`docs/proposals/workspace-clarity.md`,
 * variant A): the workspace's tile, its name, and under it who shares it,
 * "5 members", or "Personal workspace" for a workspace of one. A press
 * drops the menu of every workspace the account is a member of from its left
 * edge, each by its tile, the listed one checked, then New workspace, which
 * asks a name and lists the workspace made, and Workspace settings, which
 * opens Settings on the listed workspace's page, where its members and its
 * GitHub are managed. Nothing else stands in the menu. The head stands
 * whenever an account is signed in and its workspaces are read, its first
 * workspace alone included, because its menu is where a workspace is made;
 * before then the sidebar's head is Luke's.
 */

/** The menu's items: every workspace by its tile, the listed one checked; then New workspace and Workspace settings. */
function workspaceMenuGroups(
  listed: Workspace,
  plans: PlansControl,
  onNew: () => void,
): MenuAction[][] {
  const choices = plans.workspaces.map(
    (workspace): MenuAction => ({
      label: workspace.name,
      icon: <WorkspaceTile workspace={workspace} />,
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

/** Who shares a workspace in words: "Personal workspace" for a workspace of one, its members counted otherwise, nothing from a service that does not count them. */
export function sharedWords(count: number | undefined): string | undefined {
  if (count === undefined) return undefined;
  return count <= 1 ? "Personal workspace" : `${count} members`;
}

/** The head's line saying who shares the workspace, a people glyph before a team's members counted. */
function SharedLine({ count }: { count: number | undefined }): React.JSX.Element | null {
  const words = sharedWords(count);
  if (count === undefined || words === undefined) return null;
  return (
    <span className="sidebar-workspace-shared">
      {count <= 1 ? null : <UsersIcon aria-hidden="true" />}
      {words}
    </span>
  );
}

/** The sidebar's head while an account is signed in and its workspaces are read. */
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
        // The name a reader hears says who shares it too, since the label stands for the button's text.
        aria-label={[`Workspace: ${listed.name}`, sharedWords(listed.memberCount)]
          .filter((part) => part !== undefined)
          .join(", ")}
        {...menu.trigger(dropBelowStart)}
      >
        <WorkspaceTile workspace={listed} size={TILE_SIZE.HEAD} />
        <span className="sidebar-workspace-copy">
          <span className="sidebar-workspace-name">{listed.name}</span>
          <SharedLine count={listed.memberCount} />
        </span>
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
