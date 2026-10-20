import {
  AVATAR_SIZE,
  Avatar,
  type AvatarSize,
  CollectionPage,
  type CollectionState,
  DetailPage,
} from "@luke/ui";
import { accountLabel } from "@luke/ui/account-initials";

/** The signed-in account the sidebar's foot names; read from the session, shown as-is. */
export interface ViewerAccount {
  name: string;
  email: string;
  image: string | undefined;
}

/**
 * An account's own avatar, falling back to its letter on its hue. A
 * provider's avatar URL can outlive the image it named, so a failed fetch
 * falls back to the letter rather than leaving a broken frame. A row's is a
 * card's size, the sidebar foot's an account's; the detail page's masthead
 * is its own.
 */
export function AccountAvatar({
  account,
  size = AVATAR_SIZE.CARD,
}: {
  account: ViewerAccount;
  size?: AvatarSize;
}): React.JSX.Element {
  return (
    <Avatar
      id={account.email}
      name={accountLabel(account)}
      {...(account.image === undefined ? {} : { src: account.image })}
      size={size}
      decorative
    />
  );
}

/**
 * The page every view past the gate stands on: `@luke/ui`'s detail page,
 * titled, with the view's controls as its acts and the view's own content
 * under them; the account is the sidebar's, at its foot. The page owns the scroll, so the title and
 * the controls stay put while the content moves beneath them. The `main`
 * landmark is this page's, which is why the shell's content region is a div.
 */
export function AdminPage({
  title,
  description,
  controls,
  children,
}: {
  title: string;
  /** What the title means, under it ("One UTC day of hosted-tier calls"). */
  description?: string | undefined;
  controls: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <DetailPage title={title} description={description} actions={controls}>
        {children}
      </DetailPage>
    </main>
  );
}

/**
 * The page a view of many accounts stands on: `@luke/ui`'s collection page,
 * headed as `AdminPage` heads a view, with the view's filters under its title
 * and the collection, or what stands in its place while it is read or empty,
 * under them.
 */
export function AdminCollectionPage({
  title,
  controls,
  filters,
  state,
  loadingLabel,
  empty,
  children,
}: {
  title: string;
  controls: React.ReactNode;
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
        actions={controls}
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
