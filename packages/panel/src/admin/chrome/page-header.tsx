import {
  AVATAR_SIZE,
  Avatar,
  type AvatarSize,
  BREADCRUMBS_VARIANT,
  Breadcrumbs,
  CollectionPage,
  type CollectionState,
  DetailPage,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  OneLine,
  PAGE_FRAME,
  Skeleton,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { accountLabel } from "@luke/ui/account-initials";
import { createContext, useContext } from "react";
import { PhoneBack, type PhoneBackDoor, PhoneHead } from "../../desktop/phone-head.js";
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
 * The app's way back to the section list where a narrow room, a phone's,
 * stands a view alone (`desktop-admin.tsx`), which turns every admin
 * toolbar under it into a phone's header (`phone-head.tsx`), as a version's
 * page is headed by its way back to the versions. None elsewhere, the web
 * page's included.
 */
const AdminListBackContext = createContext<PhoneBackDoor | undefined>(undefined);

/** Hands the way back to the list to every admin page under it. */
export const AdminListBack = AdminListBackContext.Provider;

/** The way back to the list here, for a view that draws in its place. */
export function useAdminListBack(): PhoneBackDoor | undefined {
  return useContext(AdminListBackContext);
}

/** The page's heading in the toolbar, its title or the way back and its name, then what it covers after it. */
function ToolbarHeading({
  title,
  note,
  back,
}: {
  title: string;
  note: string | undefined;
  back: AdminWayBack | undefined;
}): React.JSX.Element {
  return (
    <>
      {back === undefined ? (
        <OneLine
          as={ONE_LINE_ELEMENT.H1}
          end={ONE_LINE_END.ELLIPSIS}
          className="desktop-toolbar-title"
        >
          {title}
        </OneLine>
      ) : (
        <WayBackHeading title={title} back={back} />
      )}
      {note === undefined ? null : (
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {note}
        </Text>
      )}
    </>
  );
}

/**
 * The page's toolbar, the app's own (`shell.css`): the page's title at the
 * dialog heading's size, or, under a section, the way back to it and then
 * the page's name; and the view's controls at its end. It stands still over
 * the page's scroll, and a folded sidebar's toggle stands over its start.
 * Where the app stands a view alone on a phone, it is a phone's header: one
 * way back, to the section a page stands under or else to the list, the
 * title and what it covers centred, and the view's one control, its View
 * options, at its end.
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
  const listBack = useContext(AdminListBackContext);
  if (listBack !== undefined) {
    const way =
      back === undefined ? listBack : { to: adminPlace(back.tab).label, onPress: back.onBack };
    return (
      <PhoneHead
        place="admin"
        start={<PhoneBack back={way} />}
        title={<ToolbarHeading title={title} note={note} back={undefined} />}
        end={controls ?? null}
      />
    );
  }
  // Note that a narrow room's toolbar, the web page's on a phone, wraps its
  // controls under its heading rather than cut the heading down to a letter
  // or two; the heading then asks for its words' width, which the shared
  // sheet's `flex: 1` gives up, and stands a control's height, so its words
  // stay level with the toggle.
  return (
    <header className="desktop-toolbar in-data-[room=narrow]:flex-wrap">
      <div className="desktop-toolbar-heading flex items-baseline gap-(--luke-space-8) in-data-[room=narrow]:min-h-(--luke-control-height) in-data-[room=narrow]:basis-auto! in-data-[room=narrow]:items-center">
        <ToolbarHeading title={title} note={note} back={back} />
      </div>
      {controls === null || controls === undefined ? null : (
        <div className="desktop-toolbar-actions">{controls}</div>
      )}
    </header>
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
