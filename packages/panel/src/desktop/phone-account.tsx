import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { dropBelowStart, GearIcon, IconButton, useMenu } from "@repo/ui";
import { MessageSquareIcon } from "@repo/ui/icons";
import { runAppCommand } from "../app-commands.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ActionMenu, type MenuEntry } from "./action-menu.js";
import { useNewWorkspaceDialog } from "./new-workspace-dialog.js";
import { AccountAvatar, AccountHeading, useAccountMenuGroups } from "./sidebar-foot.js";
import { workspaceMenuGroups } from "./workspace-switcher.js";

/**
 * phone-account.tsx -- a phone's account: the reader's face in the start corner of a place's head, opening one menu of their workspaces and their account.
 *
 * On the desktop the sidebar splits these between its head, the workspace
 * switcher, and its foot, the account's menu. A phone's places draw neither
 * (`desktop-sidebar.tsx`), so every place's head leads with the reader's face
 * instead, as phone apps that keep an account and actions of their own do,
 * the actions at the head's other end. Its menu holds the workspaces, New
 * workspace and Workspace settings; Settings and Send feedback, which the
 * desktop's foot draws as buttons beside its account; then the account
 * menu's items, each the same as the desktop's.
 */

/** The face and its menu; see the module's head. */
export function PhoneAccount({
  tasks,
  account,
  onSettings,
  onSignOut,
}: {
  tasks: TasksControl;
  account: AccountSnapshot;
  onSettings: () => void;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const naming = useNewWorkspaceDialog(tasks.onCreateWorkspace, {
    signedIn: tasks.signedIn,
    surfaceOpen: tasks.shown,
  });
  const menu = useMenu(tasks.shown);
  const accountGroups = useAccountMenuGroups(account, onSignOut);
  // The foot's two buttons, which a phone draws no foot for.
  const footGroup: MenuEntry[] = [
    { label: "Settings", icon: <GearIcon />, onSelect: onSettings },
    {
      label: "Send feedback",
      icon: <MessageSquareIcon />,
      onSelect: () => runAppCommand(APP_COMMAND.SEND_FEEDBACK),
    },
  ];
  const listed = tasks.workspace;
  const workspaceGroups =
    listed === undefined ? [] : workspaceMenuGroups(listed, tasks, naming.ask);
  return (
    <>
      <IconButton
        icon={<AccountAvatar account={account} />}
        label="Account"
        {...menu.trigger(dropBelowStart)}
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Account"
          replayUnmasked
          menu={menu.drawn}
          heading={
            account.status === ACCOUNT_STATUS.SIGNED_IN ? (
              <AccountHeading account={account} />
            ) : undefined
          }
          groups={[...workspaceGroups, footGroup, ...accountGroups]}
          onClose={menu.close}
        />
      )}
      {naming.dialog}
    </>
  );
}
