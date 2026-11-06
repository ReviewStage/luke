import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import { commandKeyshortcuts, NAV_CURRENT, NavItem, Shortcut, STATUS_TONE } from "@repo/ui";
import { InboxIcon } from "@repo/ui/icons";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { groupCount } from "./sidebar-fold.js";

export function SidebarInboxRow({
  waiting,
  current,
  disabled,
  onOpen,
}: {
  waiting: number;
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<InboxIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      count={{
        ...groupCount(waiting, NEEDS_YOU.COUNT),
        tone: STATUS_TONE.ATTENTION,
      }}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.INBOX)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.INBOX].chord} />}
      disabled={disabled}
      onClick={onOpen}
    >
      Inbox
    </NavItem>
  );
}
