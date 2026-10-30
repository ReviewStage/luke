import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  commandKeyshortcuts,
  MoreButton,
  moreLabel,
  NAV_COUNT_TONE,
  NAV_CURRENT,
  NavItem,
  Shortcut,
  useMenu,
} from "@luke/ui";
import { InboxIcon } from "@luke/ui/icons";
import { useRef } from "react";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import type { InboxChannels } from "./sidebar-channels.js";
import { groupCount } from "./sidebar-fold.js";
import { ReadAllMenu, type SidebarReadAll } from "./sidebar-read-all.js";

/**
 * sidebar-inbox-row.tsx -- the sidebar's Inbox row, its menu, and, with Channels on, the chevron and the ⋯ it heads the channels with.
 */

/** What the Inbox's ⋯ is named for, and the menu it drops. */
const INBOX_THING = "Inbox";

/**
 * The Inbox's row, last of the rows heading the list and drawn as they are:
 * the tray, its name, and how many threads Needs you lists at its end
 * (`useInboxWaiting`), in even figures and the unread dot's blue, and
 * nothing at none. Its chord takes the count's place
 * while the row is hovered or reached from the keyboard, as New task's and
 * Search's show theirs. A press opens the window's Inbox
 * (`desktop-inbox.tsx`), and the row is the place shown while it stands. A
 * right-click, a long press, or the menu key opens its menu, Mark all as
 * read, which marks every unread thread of the listed workspace read
 * (`sidebar-read-all.tsx`). With Channels on it heads them (`channels`):
 * the chevron that folds them, and a ⋯ beside its chord dropping the same
 * menu, which offers what makes a channel and lists the archived ones
 * after Mark all as read.
 */
export function SidebarInboxRow({
  waiting,
  current,
  disabled,
  shown,
  readAll,
  channels,
  onOpen,
}: {
  waiting: number;
  current: boolean;
  disabled: boolean;
  /** Whether the sidebar is in sight, which its menu closes with. */
  shown: boolean;
  readAll: SidebarReadAll;
  channels?: InboxChannels | undefined;
  onOpen: () => void;
}): React.JSX.Element {
  const menu = useMenu(shown && !disabled);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <NavItem
        icon={<InboxIcon />}
        current={current ? NAV_CURRENT.PAGE : undefined}
        count={{
          ...groupCount(waiting, NEEDS_YOU.COUNT),
          tone: NAV_COUNT_TONE.UNREAD,
        }}
        aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.INBOX)}
        shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.INBOX].chord} />}
        disabled={disabled}
        fold={channels?.fold}
        actions={
          channels === undefined || disabled ? undefined : (
            <MoreButton
              ref={ellipsis}
              thing={INBOX_THING}
              size={BUTTON_SIZE.COMPACT}
              {...menu.trigger()}
            />
          )
        }
        contextMenu={
          disabled ? undefined : menu.contextMenu(channels === undefined ? undefined : ellipsis)
        }
        onKeyDown={disabled ? undefined : menu.keyMenu}
        onClick={onOpen}
      >
        Inbox
      </NavItem>
      {menu.drawn === undefined ? null : (
        <ReadAllMenu
          readAll={readAll}
          label={moreLabel(INBOX_THING)}
          menu={menu.drawn}
          groups={(markAll) => [[markAll], ...(channels?.groups ?? [])]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
