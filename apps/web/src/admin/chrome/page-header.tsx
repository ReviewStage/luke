import { DetailPage, SKELETON_SHAPE, Skeleton } from "@luke/ui";
import { accountInitials, accountLabel } from "@luke/ui/account-initials";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** The signed-in account the header names; read from the session, shown as-is. */
export interface ViewerAccount {
  name: string;
  email: string;
  image: string | undefined;
}

const AVATAR_FRAME = {
  small: "size-8",
  large: "size-14",
} as const;

/** The header avatar's stand-in while the session is still being read, the small avatar's size. */
function AvatarSkeleton(): React.JSX.Element {
  return <Skeleton shape={SKELETON_SHAPE.CIRCLE} width="32px" />;
}

const AVATAR_TEXT = {
  small: "text-xs",
  large: "text-lg",
} as const;

/**
 * An account's own avatar, falling back to its initials. A provider's avatar
 * URL can outlive the image it named, so a failed fetch falls back to the
 * letters rather than leaving a broken frame. Small is the header's, large is
 * the detail page's masthead.
 */
export function AccountAvatar({
  account,
  size = "small",
}: {
  account: ViewerAccount;
  size?: keyof typeof AVATAR_FRAME;
}): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);

  if (account.image !== undefined && !imageFailed) {
    return (
      <img
        src={account.image}
        alt=""
        className={`${AVATAR_FRAME[size]} rounded-full object-cover`}
        // Google's avatar host answers 403 to a request carrying a Referer, so
        // without this a Google-signed-in admin falls to initials every time.
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <span
      className={`grid ${AVATAR_FRAME[size]} place-items-center rounded-full bg-muted ${AVATAR_TEXT[size]} font-semibold`}
      aria-hidden="true"
    >
      {accountInitials(account.name, account.email)}
    </span>
  );
}

/**
 * The focus ring is drawn inside the item: the page's own `:focus-visible`
 * outline would otherwise sit astride the panel's border, which reads as a
 * seam rather than as focus.
 */
const ACCOUNT_MENU_ITEM =
  "flex min-h-11 w-full cursor-pointer items-center px-3 py-2 text-left text-sm font-medium transition-colors duration-150 outline-offset-[-2px] hover:bg-muted focus-visible:bg-muted";

/** Where the open menu stands in the window: its top, and its right edge's inset from the window's. */
interface MenuPlace {
  top: number;
  right: number;
}

/** The menu's narrowest width, and the gap it keeps from its trigger and the window's edge. */
const MENU_WIDTH = 200;
const MENU_GAP = 8;

/**
 * The menu's place under `trigger`, its right edge on the trigger's, a small
 * gap below it, and pulled in from the window's left edge where a trigger
 * near it would push the menu past.
 */
function menuPlaceUnder(trigger: HTMLElement): MenuPlace {
  const box = trigger.getBoundingClientRect();
  const furthest = window.innerWidth - MENU_WIDTH - MENU_GAP;
  return { top: box.bottom + MENU_GAP, right: Math.min(window.innerWidth - box.right, furthest) };
}

/**
 * The account's menu, opened from its avatar. Note that the open menu is
 * portalled to the body and fixed under its trigger, because the page's
 * header clips what it holds to its own box, so a menu drawn inside it would
 * open under the header's edge rather than over the page.
 */
function AccountMenu({
  account,
  avatarSkeleton = false,
  onSignOut,
}: {
  account: ViewerAccount;
  avatarSkeleton?: boolean;
  onSignOut: () => void;
}): React.JSX.Element {
  const [place, setPlace] = useState<MenuPlace>();
  const open = place !== undefined;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node) {
        if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      }
      setPlace(undefined);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPlace(undefined);
      triggerRef.current?.focus();
    };
    // The trigger moves when the window does, so the menu follows it there.
    const onResize = () => {
      if (triggerRef.current) setPlace(menuPlaceUnder(triggerRef.current));
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="ml-auto flex size-11 cursor-pointer items-center justify-center rounded-full transition-opacity duration-150 hover:opacity-80"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${accountLabel(account)}`}
        onClick={(event) => setPlace(open ? undefined : menuPlaceUnder(event.currentTarget))}
      >
        {avatarSkeleton ? <AvatarSkeleton /> : <AccountAvatar account={account} />}
      </button>
      {place === undefined
        ? null
        : createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ ...place, minWidth: MENU_WIDTH }}
              className="fixed z-10 rounded-lg border border-border bg-card py-1 text-left shadow-[0_16px_48px_rgba(0,0,0,0.32)]"
            >
              <div className="border-b border-border px-3 py-2">
                <div className="text-sm leading-tight font-medium">{account.name}</div>
                <div className="truncate text-xs text-muted-foreground">{account.email}</div>
              </div>
              <button
                type="button"
                ref={itemRef}
                role="menuitem"
                className={ACCOUNT_MENU_ITEM}
                onClick={onSignOut}
              >
                Sign out
              </button>
            </div>,
            document.body,
          )}
    </>
  );
}

/**
 * The page every view past the gate stands on: `@luke/ui`'s detail page,
 * titled, with the view's controls and the account menu as its acts and the
 * view's own content under them. The page owns the scroll, so the title and
 * the controls stay put while the content moves beneath them. The `main`
 * landmark is this page's, which is why the shell's content region is a div.
 */
export function AdminPage({
  title,
  controls,
  account,
  accountSkeleton = false,
  onSignOut,
  children,
}: {
  title: string;
  controls: React.ReactNode;
  account: ViewerAccount | undefined;
  accountSkeleton?: boolean;
  onSignOut: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <DetailPage
        title={title}
        actions={
          <>
            {controls}
            {/* The avatar keeps to the actions' far end, on a phone too, where
                it wraps under the controls onto a row of its own. */}
            {account ? (
              <AccountMenu
                account={account}
                avatarSkeleton={accountSkeleton}
                onSignOut={onSignOut}
              />
            ) : accountSkeleton ? (
              <div className="ml-auto flex size-11 items-center justify-center">
                <AvatarSkeleton />
              </div>
            ) : null}
          </>
        }
      >
        {children}
      </DetailPage>
    </main>
  );
}
