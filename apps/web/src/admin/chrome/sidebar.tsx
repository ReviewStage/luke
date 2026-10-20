/**
 * sidebar.tsx -- the admin dashboard's shell: the app's sidebar beside the open view, its toggle in the title bar's row, and the account at its foot.
 *
 * The shell is the app's own (`@luke/panel`'s `shell.css`, which the panel
 * lays for its window): the same two columns, the sidebar's ground, insets,
 * and width, Luke's head over its rows, and the toggle standing at the
 * column's top-left whichever way the sidebar is. Hiding the sidebar slides
 * it off the left edge on the pane's motion while the view takes the room at
 * once, and the choice is remembered (`prefs.ts`). A narrow room's sidebar,
 * a phone's, is a drawer over the view instead, opened by the same toggle
 * and put away by a choice in it, Escape, or a press outside it, the view
 * inert while it stands, as the app's is (`stage-room.ts` measures the room).
 *
 * The account stands at the sidebar's foot, as the app's does: its face and
 * name, raising its menu above it, whose one act is Log out, asked first.
 */

import "@luke/panel/styles/shell.css";
import { LukeIdentity } from "@luke/panel/desktop/luke-identity";
import { SHELL_ROOM } from "@luke/panel/shell-room";
import { useStageRoom } from "@luke/panel/stage-room";
import {
  AVATAR_SIZE,
  ConfirmDialog,
  DIALOG_TONE,
  IconButton,
  Menu,
  NAV_CURRENT,
  NAV_ITEM_VARIANT,
  NavItem,
  NavItemLink,
  riseAbove,
  SidebarIcon,
  TEXT_TONE,
  Text,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { accountLabel } from "@luke/ui/account-initials";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { LogOutIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AdminTab, plainLeftClick, tabHref } from "../routing";
import { AccountAvatar, type ViewerAccount } from "./page-header";
import { ADMIN_PLACES } from "./places";

/** What the toggle names for a reader: the sidebar's way back, or its way away. */
const SIDEBAR_TOGGLE_LABEL = {
  SHOW: "Show sidebar",
  HIDE: "Hide sidebar",
} as const;

/**
 * How the sidebar stands over the view while it stands out of the columns,
 * in the attribute the shared sheet reads (`shell.css`'s
 * `data-sidebar-overlay`): away, or open over it as a narrow room's drawer.
 */
const SIDEBAR_OVERLAY = {
  CLOSED: "closed",
  OPEN: "open",
} as const;

type SidebarOverlay = (typeof SIDEBAR_OVERLAY)[keyof typeof SIDEBAR_OVERLAY];

/** What the Log out dialog says where signing out failed, in the app's words. */
const LOG_OUT_REFUSED = "Luke could not log out. Try again.";

/**
 * The foot's account: the signed-in account's face and name, raising its
 * menu over the column, whose heading says whose account it is over Log out.
 * Log out asks first, as the app's does: getting back in costs a whole trip
 * through the provider's sign-in.
 */
function AccountFoot({
  account,
  shown,
  onLogOut,
}: {
  account: ViewerAccount;
  /** Whether the sidebar is in sight; hidden, nothing it raised stands over the page. */
  shown: boolean;
  onLogOut: () => Promise<void>;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const logOut = useConfirmDialog(
    { subject: true, surfaceOpen: shown },
    async (): Promise<ActionResult> => {
      try {
        await onLogOut();
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      } catch {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: LOG_OUT_REFUSED };
      }
    },
  );
  return (
    <>
      <NavItem
        variant={NAV_ITEM_VARIANT.IDENTITY}
        icon={<AccountAvatar account={account} size={AVATAR_SIZE.ACCOUNT} />}
        menu={menu.trigger(riseAbove)}
      >
        {accountLabel(account)}
      </NavItem>
      {menu.drawn === undefined ? null : (
        <Menu
          label="Account"
          menu={menu.drawn}
          heading={
            <>
              <Text>{account.name}</Text>
              <Text tone={TEXT_TONE.MUTED}>{account.email}</Text>
            </>
          }
          groups={[[{ label: "Log out", icon: <LogOutIcon />, onSelect: logOut.ask }]]}
          onClose={menu.close}
        />
      )}
      <ConfirmDialog
        confirm={logOut}
        question={{
          title: `Log out of ${account.email}?`,
          verb: "Log out",
          running: "Logging out",
          tone: DIALOG_TONE.PRIMARY,
        }}
      />
    </>
  );
}

/**
 * The column itself: the title bar's row the toggle stands over, Luke's head
 * named for the dashboard, the places as the app's sidebar lists its own,
 * each a real anchor to its own address so a modified click still gets the
 * browser's own gesture, and the account at the foot.
 */
function AdminSidebar({
  active,
  inSight,
  account,
  onNavigate,
  onLogOut,
  ref,
}: {
  active: AdminTab;
  inSight: boolean;
  account: ViewerAccount | undefined;
  onNavigate: (tab: AdminTab) => void;
  onLogOut: () => Promise<void>;
  ref: React.Ref<HTMLElement>;
}): React.JSX.Element {
  const go = (tab: AdminTab) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!plainLeftClick(event)) return;
    event.preventDefault();
    onNavigate(tab);
  };
  return (
    <aside ref={ref} className="desktop-sidebar" inert={!inSight}>
      <div className="desktop-drag-strip" />
      <LukeIdentity qualifier="Admin" />
      <nav aria-label="Admin sections" className="sidebar-places">
        {ADMIN_PLACES.map(({ tab, label, icon }) => (
          <NavItemLink
            key={tab}
            href={tabHref(tab)}
            icon={icon}
            current={active === tab ? NAV_CURRENT.PAGE : undefined}
            onClick={go(tab)}
          >
            {label}
          </NavItemLink>
        ))}
      </nav>
      <div className="min-h-0 flex-1" />
      <div className="sidebar-foot">
        <div className="sidebar-account-row">
          {account === undefined ? null : (
            <AccountFoot account={account} shown={inSight} onLogOut={onLogOut} />
          )}
        </div>
      </div>
    </aside>
  );
}

/**
 * The drawer's own dismissals while it stands over a narrow room's view: a
 * press on the shell anywhere but the drawer and the toggle, and Escape in
 * it, which hands the keyboard back to the toggle. Opened, it takes the keyboard
 * to the place shown, as the app's drawer does. Note that a press outside
 * the shell, or Escape there, is not the view's: the account's menu and the
 * Log out question are drawn over the page from the body, and what is
 * pressed in them is theirs, so it must not put the drawer, and them with
 * it, away.
 */
function useDrawerDismiss(
  open: boolean,
  shell: React.RefObject<HTMLElement | null>,
  drawer: React.RefObject<HTMLElement | null>,
  toggle: React.RefObject<HTMLButtonElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return undefined;
    drawer.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    const press = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || shell.current?.contains(target) !== true) return;
      if (drawer.current?.contains(target) || toggle.current?.contains(target)) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key !== "Escape" || !(target instanceof Node)) return;
      if (shell.current?.contains(target) !== true) return;
      onClose();
      toggle.current?.focus();
    };
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("keydown", key);
    };
  }, [open, shell, drawer, toggle, onClose]);
}

/**
 * Every view past the gate stands in this shell: the sidebar marking
 * `active`, the view beside it, and the toggle over the sidebar's top-left.
 * Hidden or in a narrow room, the toggle stands over the start of the view's
 * toolbar, which starts its title past it, so it covers none of the page.
 */
export function AdminShell({
  active,
  hidden,
  account,
  onToggleHidden,
  onNavigate,
  onLogOut,
  children,
}: {
  active: AdminTab;
  /** Whether the reader hid the sidebar, which a narrow room's drawer leaves as it was. */
  hidden: boolean;
  account: ViewerAccount | undefined;
  onToggleHidden: () => void;
  onNavigate: (tab: AdminTab) => void;
  onLogOut: () => Promise<void>;
  children: React.ReactNode;
}): React.JSX.Element {
  const stage = useStageRoom();
  const narrow = stage.room === SHELL_ROOM.NARROW;
  const [overlay, setOverlay] = useState<SidebarOverlay>(SIDEBAR_OVERLAY.CLOSED);
  // Note that a drawer left open as the room widens is put away, so the room
  // narrowing again opens on the view rather than on the drawer.
  if (!narrow && overlay === SIDEBAR_OVERLAY.OPEN) setOverlay(SIDEBAR_OVERLAY.CLOSED);
  const drawerOpen = overlay === SIDEBAR_OVERLAY.OPEN;
  const collapsed = hidden || narrow;
  const inSight = !collapsed || drawerOpen;
  const shell = useRef<HTMLDivElement | null>(null);
  const sidebar = useRef<HTMLElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const closeDrawer = useCallback(() => setOverlay(SIDEBAR_OVERLAY.CLOSED), []);
  useDrawerDismiss(drawerOpen, shell, sidebar, toggle, closeDrawer);

  const onToggle = () => {
    if (!narrow) {
      onToggleHidden();
      return;
    }
    setOverlay(drawerOpen ? SIDEBAR_OVERLAY.CLOSED : SIDEBAR_OVERLAY.OPEN);
  };
  const navigate = (tab: AdminTab) => {
    closeDrawer();
    onNavigate(tab);
  };
  const label = inSight ? SIDEBAR_TOGGLE_LABEL.HIDE : SIDEBAR_TOGGLE_LABEL.SHOW;

  return (
    <div ref={stage.ref} className="relative h-dvh">
      {/* The admin's title bar holds the sidebar's toggle alone, where the
          app's holds New task beside it, so a folded sidebar's page starts
          its toolbar past the one button. */}
      <div
        ref={shell}
        className="desktop-shell [--sidebar-toggle-clearance:calc(var(--title-bar-left)_+_var(--luke-control-height)_+_var(--luke-control-gap))]"
        data-room={stage.room}
        data-sidebar-collapsed={String(collapsed)}
        data-sidebar-overlay={overlay}
      >
        <AdminSidebar
          ref={sidebar}
          active={active}
          inSight={inSight}
          account={account}
          onNavigate={navigate}
          onLogOut={onLogOut}
        />
        {/* The content region is the app's work column, a div because the
            `main` landmark is the page's own. The page owns its scroll under
            its toolbar, so the region only fills; a folded sidebar's toggle
            stands over the toolbar's start, which leaves it room (`shell.css`). */}
        <div className="desktop-main" inert={drawerOpen}>
          {children}
        </div>
        <div className="title-bar-controls">
          <IconButton
            ref={toggle}
            icon={<SidebarIcon />}
            label={label}
            aria-expanded={narrow ? drawerOpen : undefined}
            onClick={onToggle}
          />
        </div>
      </div>
    </div>
  );
}
