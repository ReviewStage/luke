import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import { commandKeyshortcuts, NAV_CURRENT, NavItem, Shortcut, STATUS_TONE } from "@repo/ui";
import { InboxIcon } from "@repo/ui/icons";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { groupCount } from "./sidebar-fold.js";

/**
 * sidebar-inbox-row.tsx -- the sidebar's Inbox row.
 */

/**
 * The Inbox's row, last of the rows heading the list and drawn as they are:
 * the tray, its name, and how many threads Needs you lists at its end
 * (`useInboxWaiting`), in even figures and the needs-you tone the phone's
 * bar fills its badge with (`mobile-bar.tsx`), and
 * nothing at none. Its chord takes the count's place
 * while the row is hovered or reached from the keyboard, as New task's and
 * Search's show theirs. A press opens the window's Inbox
 * (`desktop-inbox.tsx`), and the row is the place shown while it stands.
 * Note that it opens no menu: Mark all as read stands on the Inbox's own
 * head, where its reader looks for it.
 */
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
