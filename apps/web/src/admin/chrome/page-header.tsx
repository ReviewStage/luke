import {
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  DetailPage,
  Menu,
  SKELETON_SHAPE,
  Skeleton,
  TEXT_TONE,
  Text,
  useMenu,
} from "@luke/ui";
import { accountInitials, accountLabel } from "@luke/ui/account-initials";
import { useState } from "react";

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
 * The account's menu, opened from its avatar: whose account it is over the
 * one act, signing out. The shared menu draws itself over the page, from the
 * body, which is what keeps it clear of the page's header: the header clips
 * what it holds to its own box. The body sits under the root that names the
 * admin's profile, theme, and density, so the menu is drawn at them too.
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
  const menu = useMenu(true);
  const label = `Account menu for ${accountLabel(account)}`;
  return (
    <>
      <button
        type="button"
        className="ml-auto flex size-11 cursor-pointer items-center justify-center rounded-full transition-opacity duration-150 hover:opacity-80"
        aria-label={label}
        {...menu.trigger()}
      >
        {avatarSkeleton ? <AvatarSkeleton /> : <AccountAvatar account={account} />}
      </button>
      {menu.drawn === undefined ? null : (
        <Menu
          label={label}
          menu={menu.drawn}
          heading={
            <>
              <Text>{account.name}</Text>
              <Text tone={TEXT_TONE.MUTED}>{account.email}</Text>
            </>
          }
          groups={[[{ label: "Sign out", onSelect: onSignOut }]]}
          onClose={menu.close}
        />
      )}
    </>
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
      {/* The avatar keeps to the actions' far end, on a phone too, where
          it wraps under the controls onto a row of its own. */}
      {account ? (
        <AccountMenu account={account} avatarSkeleton={accountSkeleton} onSignOut={onSignOut} />
      ) : accountSkeleton ? (
        <div className="ml-auto flex size-11 items-center justify-center">
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
  description,
  controls,
  account,
  accountSkeleton = false,
  onSignOut,
  children,
}: {
  title: string;
  /** What the title means, under it ("One UTC day of hosted-tier calls"). */
  description?: string | undefined;
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
        description={description}
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
