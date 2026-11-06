import { VERB } from "@repo/features/words";
import "@repo/panel/styles/shell.css";
import { AccountAvatar, type ViewerAccount } from "@repo/panel/admin/chrome/page-header";
import { ADMIN_PLACES } from "@repo/panel/admin/chrome/places";
import { type AdminTab, plainLeftClick, tabHref } from "@repo/panel/admin/routing";
import { ProductIdentity } from "@repo/panel/desktop/product-identity";
import { SHELL_ROOM } from "@repo/panel/shell-room";
import { useStageRoom } from "@repo/panel/stage-room";
import {
  AVATAR_SIZE,
  FailureNote,
  IconButton,
  Menu,
  NAV_CURRENT,
  NAV_ITEM_VARIANT,
  NavItem,
  NavItemLink,
  riseAbove,
  SidebarAccountRow,
  SidebarFoot,
  SidebarIcon,
  SidebarPlaces,
  TEXT_TONE,
  Text,
  useMenu,
} from "@repo/ui";
import { accountLabel } from "@repo/ui/account-initials";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { LogOutIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const SIDEBAR_TOGGLE_LABEL = {
  SHOW: "Show sidebar",
  HIDE: "Hide sidebar",
} as const;

const SIDEBAR_OVERLAY = {
  CLOSED: "closed",
  OPEN: "open",
} as const;

type SidebarOverlay = (typeof SIDEBAR_OVERLAY)[keyof typeof SIDEBAR_OVERLAY];

const SIGN_OUT_REFUSED = "The account could not be signed out. Try again.";

function AccountFoot({
  account,
  shown,
  onSignOut,
}: {
  account: ViewerAccount;
  shown: boolean;
  onSignOut: () => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
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
          groups={[[{ label: VERB.SIGN_OUT, icon: <LogOutIcon />, onSelect: onSignOut }]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

function AdminSidebar({
  active,
  inSight,
  account,
  onNavigate,
  onSignOut,
  ref,
}: {
  active: AdminTab;
  inSight: boolean;
  account: ViewerAccount | undefined;
  onNavigate: (tab: AdminTab) => void;
  onSignOut: () => Promise<void>;
  ref: React.Ref<HTMLElement>;
}): React.JSX.Element {
  const [refused, setRefused] = useState(false);
  const signOut = () => {
    setRefused(false);
    onSignOut().catch(() => setRefused(true));
  };
  const go = (tab: AdminTab) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!plainLeftClick(event)) return;
    event.preventDefault();
    onNavigate(tab);
  };
  return (
    <aside ref={ref} className="desktop-sidebar" inert={!inSight}>
      <div className="desktop-drag-strip" />
      <ProductIdentity qualifier="Admin" />
      <SidebarPlaces label="Admin sections">
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
      </SidebarPlaces>
      <div className="min-h-0 flex-1" />
      <SidebarFoot>
        {refused ? (
          <FailureNote failure={UNREPORTED.NO_REPORTER}>{SIGN_OUT_REFUSED}</FailureNote>
        ) : null}
        <SidebarAccountRow>
          {account === undefined ? null : (
            <AccountFoot account={account} shown={inSight} onSignOut={signOut} />
          )}
        </SidebarAccountRow>
      </SidebarFoot>
    </aside>
  );
}

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

export function AdminShell({
  active,
  hidden,
  account,
  onToggleHidden,
  onNavigate,
  onSignOut,
  children,
}: {
  active: AdminTab;
  hidden: boolean;
  account: ViewerAccount | undefined;
  onToggleHidden: () => void;
  onNavigate: (tab: AdminTab) => void;
  onSignOut: () => Promise<void>;
  children: React.ReactNode;
}): React.JSX.Element {
  const stage = useStageRoom();
  const narrow = stage.room === SHELL_ROOM.NARROW;
  const [overlay, setOverlay] = useState<SidebarOverlay>(SIDEBAR_OVERLAY.CLOSED);
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
      <div
        ref={shell}
        className="desktop-shell [--sidebar-toggle-clearance:calc(var(--title-bar-left)_+_var(--ui-control-height)_+_var(--ui-control-gap))]"
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
          onSignOut={onSignOut}
        />
        <main className="desktop-main" inert={drawerOpen}>
          {children}
        </main>
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
