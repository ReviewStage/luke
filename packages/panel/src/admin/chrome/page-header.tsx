import {
  AVATAR_SIZE,
  Avatar,
  type AvatarSize,
  BREADCRUMBS_VARIANT,
  Breadcrumbs,
  CollectionPage,
  type CollectionState,
  DetailPage,
  PAGE_FRAME,
  Skeleton,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TOOLBAR_INSET,
  Toolbar,
} from "@luke/ui";
import { accountLabel } from "@luke/ui/account-initials";
import { createContext, useContext } from "react";
import type { AdminTab } from "../routing.js";
import { adminPlace } from "./places.js";

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
 * The way back from a page under a section to the section itself, which
 * leads the page's toolbar: the section's own glyph and name, as the app's
 * page under a collection leads with the collection.
 */
export interface AdminWayBack {
  tab: AdminTab;
  onBack: () => void;
}

/** A page under a section, headed by the way back to it and then its own name, in the toolbar's heading type. */
function WayBackHeading({ title, back }: { title: string; back: AdminWayBack }): React.JSX.Element {
  const section = adminPlace(back.tab);
  return (
    <Breadcrumbs
      label="Path"
      variant={BREADCRUMBS_VARIANT.TITLE}
      crumbs={[
        { label: section.label, icon: section.icon, onPress: back.onBack },
        { label: title, current: true },
      ]}
    />
  );
}

/**
 * What leads every admin toolbar under it, before the page's heading: the
 * app's way back to the section list where a narrow room stands a view
 * alone (`desktop-admin.tsx`), as a version's toolbar leads with its way
 * back to the versions. None elsewhere.
 */
const AdminToolbarLeadContext = createContext<React.ReactNode>(undefined);

/** Hands what leads the toolbar to every admin page under it. */
export const AdminToolbarLead = AdminToolbarLeadContext.Provider;

/** What leads the toolbar here, for a view that draws in its place. */
export function useAdminToolbarLead(): React.ReactNode {
  return useContext(AdminToolbarLeadContext);
}

/**
 * The page's toolbar: the page's title, or, under a section, the way back to
 * it and then the page's name; the note on what it covers after it; and the
 * view's controls at its end. It stands still over the page's scroll, and a
 * folded sidebar's toggle stands over its start.
 */
function AdminToolbar({
  title,
  note,
  back,
  controls,
}: {
  title: string;
  /** What the page covers, said after its title, such as its time range, in place of a control that would say it. */
  note: string | undefined;
  back: AdminWayBack | undefined;
  controls: React.ReactNode;
}): React.JSX.Element {
  const lead = useContext(AdminToolbarLeadContext);
  return (
    <Toolbar
      lead={lead}
      start={lead === undefined ? undefined : TOOLBAR_INSET.COLUMN}
      title={back === undefined ? title : <WayBackHeading title={title} back={back} />}
      tag={
        note === undefined ? undefined : (
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {note}
          </Text>
        )
      }
      actions={controls}
    />
  );
}

/**
 * The page every view past the gate stands on: `@luke/ui`'s detail page
 * under the app's toolbar, which holds the title, the way back where the
 * view stands under a section, and the view's controls; the view's own
 * content, or what stands in its place where it could not be read, under
 * it. The page owns the scroll, so the toolbar stays put while the content
 * moves beneath it. The `main` landmark is the mount's: the web page's
 * content region, and the app's work column.
 */
export function AdminPage({
  title,
  note,
  back,
  controls,
  children,
}: {
  title: string;
  /** What the page covers, after its title (`AdminToolbar`). */
  note?: string | undefined;
  back?: AdminWayBack | undefined;
  controls: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DetailPage
        frame={PAGE_FRAME.TOOLBAR}
        label={title}
        toolbar={<AdminToolbar title={title} note={note} back={back} controls={controls} />}
      >
        {children}
      </DetailPage>
    </div>
  );
}

/**
 * The page a view of many accounts stands on: `@luke/ui`'s collection page,
 * under the toolbar `AdminPage` heads a view with, the view's filters under
 * it, and the collection, or what stands in its place while it is read,
 * empty, or failed, under them.
 */
export function AdminCollectionPage({
  title,
  note,
  controls,
  filters,
  state,
  loadingLabel,
  skeleton,
  empty,
  error,
  children,
}: {
  title: string;
  /** What the page covers, after its title (`AdminToolbar`). */
  note?: string | undefined;
  controls: React.ReactNode;
  filters: React.ReactNode;
  state: CollectionState;
  loadingLabel: string;
  /** The view's own sections drawn before their answer, standing while it is read. */
  skeleton?: React.ReactNode;
  empty?: React.ReactNode;
  error?: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPage
        frame={PAGE_FRAME.TOOLBAR}
        label={title}
        toolbar={<AdminToolbar title={title} note={note} back={undefined} controls={controls} />}
        filters={filters}
        state={state}
        loadingLabel={loadingLabel}
        skeleton={skeleton}
        empty={empty}
        error={error}
      >
        {children}
      </CollectionPage>
    </div>
  );
}

/** A count bone, about the "12 of 340 accounts" a collection's filters say beside the search once read. */
const SKELETON_COUNT_WIDTH = "128px";

/** The count a collection's filters say beside its search, while the collection is read. */
export function CollectionCountSkeleton(): React.JSX.Element {
  return (
    <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
      <Skeleton width={SKELETON_COUNT_WIDTH} />
    </Text>
  );
}
