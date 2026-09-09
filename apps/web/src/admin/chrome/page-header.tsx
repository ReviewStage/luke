import { useEffect, useRef, useState } from "react";
import { accountInitials, accountLabel } from "../../account-initials";
import { Skeleton } from "../skeleton";

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

export function AccountMenu({
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
        {avatarSkeleton ? (
          <Skeleton circle className={AVATAR_FRAME.small} />
        ) : (
          <AccountAvatar account={account} />
        )}
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

/** The heading and account menu every view wears; controls sit between them. */
export function PageHeader({
  title,
  controls,
  account,
  accountSkeleton = false,
  onSignOut,
}: {
  title: string;
  controls: React.ReactNode;
  account: ViewerAccount | undefined;
  accountSkeleton?: boolean;
  onSignOut: () => void;
}): React.JSX.Element {
  const hasControls = controls !== null && controls !== undefined;

  return (
    <header className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-4 min-[720px]:flex min-[720px]:gap-x-6 min-[720px]:gap-y-3">
      {/* On a phone the identity is one row and the controls are a deliberate
          second row. This keeps the account trigger from becoming a stray
          button after whichever control happened to wrap first. */}
      <h1 className="col-start-1 row-start-1 text-lg font-semibold tracking-[-0.01em]">{title}</h1>
      {hasControls ? (
        <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-3 min-[720px]:ml-auto min-[720px]:gap-4">
          {controls}
        </div>
      ) : null}
      {accountSkeleton || account ? (
        <div
          className={`col-start-2 row-start-1 flex items-center ${hasControls ? "" : "min-[720px]:ml-auto"}`}
        >
          {account ? (
            <AccountMenu account={account} avatarSkeleton={accountSkeleton} onSignOut={onSignOut} />
          ) : accountSkeleton ? (
            <div className="flex size-11 items-center justify-center">
              <Skeleton circle className={AVATAR_FRAME.small} />
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
