import type { Workspace } from "@sidecar/hosted/workspace-wire";
import { CheckIcon, ChevronDownIcon, ExternalIcon, PlusIcon, UserIcon } from "@sidecar/panel";
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
 * A workspace is the account's personal plans, or the shared plans of a
 * GitHub App installation's team, and the sidebar lists one at a time. Its
 * head names the workspace listed, and a press drops the menu of every
 * workspace the account is a member of, the listed one checked; then a Join
 * for each installation's workspace the account reaches but is not in; then
 * Install Luke on GitHub…, which opens the App's installation page, and,
 * while a team's workspace is listed, Members…, which opens Settings on its
 * members. An account in its personal workspace alone, with nothing to
 * join, has nothing to switch between, so it draws no head at all and its
 * plans read as they always did; Settings still offers it the install.
 */

/** Where the menu hangs: under the head, its left edge on the head's, since the head spans the column. */
function dropUnder(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START };
}

/** The menu's items: every workspace, the listed one checked, the ones to join, then the install and the members. */
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
  const joins = plans.available.map(
    (available): MenuAction => ({
      label: `Join ${available.name}`,
      icon: <PlusIcon />,
      onSelect: () => plans.onJoinWorkspace(available.installationId),
    }),
  );
  const install: MenuAction = {
    label: "Install Luke on GitHub…",
    icon: <ExternalIcon />,
    onSelect: plans.onInstallApp,
  };
  const members: MenuAction = { label: "Members…", icon: <UserIcon />, onSelect: onOpenMembers };
  const manage = listed.personal ? [install] : [install, members];
  return joins.length === 0 ? [choices, manage] : [choices, joins, manage];
}

/** The plans' head while the account is in two workspaces or more, or may join one; nothing otherwise. */
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
  const switchable = plans.workspaces.length > 1 || plans.available.length > 0;
  if (listed === undefined || !switchable) return null;
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
