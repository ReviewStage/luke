import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { dropBelowStart, GearIcon, IconButton, useMenu } from "@repo/ui";
import { MessageSquareIcon } from "@repo/ui/icons";
import { runAppCommand } from "../app-commands.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ActionMenu, type MenuEntry } from "./action-menu.js";
import { AccountAvatar, AccountHeading, useAccountMenuGroups } from "./sidebar-foot.js";
import { workspaceMenuGroups } from "./workspace-switcher.js";

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
  const menu = useMenu(tasks.shown);
  const accountGroups = useAccountMenuGroups(account, onSignOut);
  const footGroup: MenuEntry[] = [
    { label: "Settings", icon: <GearIcon />, onSelect: onSettings },
    {
      label: "Send feedback",
      icon: <MessageSquareIcon />,
      onSelect: () => runAppCommand(APP_COMMAND.SEND_FEEDBACK),
    },
  ];
  const listed = tasks.workspace;
  const workspaceGroups = listed === undefined ? [] : workspaceMenuGroups(listed, tasks);
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
    </>
  );
}
