import {
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  DetailPage,
  SKELETON_SHAPE,
  Skeleton,
} from "@luke/ui";
import { accountInitials, accountLabel } from "@luke/ui/account-initials";
import { useEffect, useRef, useState } from "react";

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

function AccountMenu({
  account,
  avatarSkeleton = false,
  onSignOut,
}: {
  account: ViewerAccount;
  avatarSkeleton?: boolean;
  onSignOut: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="flex size-11 cursor-pointer items-center justify-center rounded-full transition-opacity duration-150 hover:opacity-80"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${accountLabel(account)}`}
        onClick={() => setOpen(!open)}
      >
        {avatarSkeleton ? <AvatarSkeleton /> : <AccountAvatar account={account} />}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute top-[calc(100%+8px)] right-0 z-10 min-w-[200px] rounded-lg border border-border bg-card py-1 text-left shadow-[0_16px_48px_rgba(0,0,0,0.32)]"
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
        </div>
      ) : null}
    </div>
  );
}

/** The acts every admin page's header ends on: the view's controls, then the account menu. */
function AdminActions({
  controls,
  account,
  accountSkeleton,
  onSignOut,
}: {
  controls: React.ReactNode;
  account: ViewerAccount | undefined;
  accountSkeleton: boolean;
  onSignOut: () => void;
}): React.JSX.Element {
  return (
    <>
      {controls}
      {account ? (
        <AccountMenu account={account} avatarSkeleton={accountSkeleton} onSignOut={onSignOut} />
      ) : accountSkeleton ? (
        <div className="flex size-11 items-center justify-center">
          <AvatarSkeleton />
        </div>
      ) : null}
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
          <AdminActions
            controls={controls}
            account={account}
            accountSkeleton={accountSkeleton}
            onSignOut={onSignOut}
          />
        }
      >
        {children}
      </DetailPage>
    </main>
  );
}

/**
 * The page a view of many accounts stands on: `@luke/ui`'s collection page,
 * headed as `AdminPage` heads a view, with the view's filters under its title
 * and the collection, or what stands in its place while it is read or empty,
 * under them. The account menu waits as a bone while the page loads, as the
 * detail page's does.
 */
export function AdminCollectionPage({
  title,
  controls,
  account,
  onSignOut,
  filters,
  state,
  loadingLabel,
  empty,
  children,
}: {
  title: string;
  controls: React.ReactNode;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  filters: React.ReactNode;
  state: CollectionState;
  loadingLabel: string;
  empty?: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <CollectionPage
        title={title}
        actions={
          <AdminActions
            controls={controls}
            account={account}
            accountSkeleton={state === COLLECTION_STATE.LOADING}
            onSignOut={onSignOut}
          />
        }
        filters={filters}
        state={state}
        loadingLabel={loadingLabel}
        empty={empty}
      >
        {children}
      </CollectionPage>
    </main>
  );
}
