import type { Workspace } from "@sidecar/hosted/workspace-wire";
import { CheckIcon, ChevronDownIcon, ExternalIcon, PlusIcon, UserIcon } from "@sidecar/panel";
import { GitHubMark } from "../account-marks";
import type { PlansControl } from "../planning/use-plans-tab";
import { managesWorkspace } from "../settings/members-section";
import { ActionMenu, dropBelow, type MenuAction, useActionMenu } from "./action-menu";
import { useNewWorkspaceDialog } from "./new-workspace-dialog";

/**
 * workspace-switcher.tsx -- the head of the sidebar's plans: which of the account's workspaces they are, and the menu that lists another.
 *
 * A workspace is the account's personal plans, or a team's shared plans,
 * and the sidebar lists one at a time. Its head names the workspace listed,
 * and a press drops the menu of every workspace the account is a member of,
 * the listed one checked, then New workspace…, which asks a name and lists
 * the workspace made. While a team's workspace is listed it adds Invite
 * people…, which opens the service's invite page in the browser, Members…,
 * which opens Settings on its members, and, for an owner or admin, the
 * team's GitHub organization: Connect GitHub org… while none is connected,
 * or its login, which opens Settings where it is disconnected. The head
 * stands whenever an account is signed in, its personal workspace alone
 * included, because its menu is where a workspace is made.
 */

/**
 * The menu's items: every workspace, the listed one checked; New
 * workspace…; then, for a team's workspace, Invite people…, Members…, and
 * for an owner or admin its GitHub organization: Connect GitHub org… while
 * none is connected, or the connected login, which opens Settings where it
 * is disconnected.
 */
function workspaceMenuGroups(
  listed: Workspace,
  plans: PlansControl,
  presses: { onNew: () => void; onOpenSettings: () => void },
): MenuAction[][] {
  const choices = plans.workspaces.map(
    (workspace): MenuAction => ({
      label: workspace.name,
      ...(workspace.id === listed.id ? { icon: <CheckIcon /> } : undefined),
      onSelect: () => plans.onChooseWorkspace(workspace.id),
    }),
  );
  const create: MenuAction = {
    label: "New workspace…",
    icon: <PlusIcon />,
    onSelect: presses.onNew,
  };
  if (listed.personal) return [choices, [create]];
  const team: MenuAction[] = [
    { label: "Invite people…", icon: <ExternalIcon />, onSelect: plans.onInviteToWorkspace },
    { label: "Members…", icon: <UserIcon />, onSelect: presses.onOpenSettings },
  ];
  if (managesWorkspace(listed)) {
    team.push(
      listed.github === null
        ? { label: "Connect GitHub org…", icon: <GitHubMark />, onSelect: plans.onConnectGitHub }
        : {
            label: `GitHub: ${listed.github.login}`,
            icon: <GitHubMark />,
            onSelect: presses.onOpenSettings,
          },
    );
  }
  return [choices, [create], team];
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
  /** Opens Settings, where the listed workspace's members and GitHub organization stand. */
  onOpenMembers: () => void;
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
          groups={workspaceMenuGroups(listed, plans, {
            onNew: naming.ask,
            onOpenSettings: onOpenMembers,
          })}
          onClose={menu.close}
        />
      )}
      {naming.dialog}
    </div>
  );
}
