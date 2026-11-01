import { readingWords } from "@luke/features/words";
import {
  AVATAR_SIZE,
  Avatar,
  type AvatarSize,
  BackButton,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  DetailPage,
  PAGE_FRAME,
  Skeleton,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Toolbar,
} from "@luke/ui";
import { accountLabel } from "@luke/ui/account-initials";
import { createContext, useContext } from "react";
import { PhoneHead } from "../../desktop/phone-head.js";
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

/**
 * What the app hands every admin page standing in its work column
 * (`desktop-admin.tsx`), as Automations heads its tabs: the place's name, which
 * titles a section's toolbar where the web page titles it by the section; the
 * bar of sections under that toolbar; the place's own acts before a view's
 * controls; and whether a phone's header stands for the toolbar. None on the
 * web page, whose own sidebar lists the sections.
 */
export interface AdminPlaceFrame {
  readonly title: string;
  readonly sections: React.ReactNode;
  readonly acts: React.ReactNode;
  readonly phone: boolean;
}

const AdminPlaceFrameContext = createContext<AdminPlaceFrame | undefined>(undefined);

/** Hands the app's frame to every admin page under it. */
export const AdminPlaceFrameProvider = AdminPlaceFrameContext.Provider;

/**
 * The page's toolbar: the page's title, or, under a section, the way back to
 * it and then the page's name; the note on what it covers after it; and the
 * view's controls at its end. Where the app frames a section, the toolbar is
 * the place's (its name, its acts before the view's controls), the section
 * named by the bar under it. It stands still over the page's scroll, and a
 * folded sidebar's toggle stands over its start. On a phone it is a phone's
 * header (`phone-head.tsx`): a page under a section led by its way back to
 * the section, a section by the place's acts, the title and what it covers
 * centred, and the view's one control, its View options.
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
  const frame = useContext(AdminPlaceFrameContext);
  const section = back === undefined ? undefined : adminPlace(back.tab);
  const placed = frame !== undefined && section === undefined ? frame : undefined;
  const tag =
    note === undefined ? undefined : (
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {note}
      </Text>
    );
  if (frame?.phone === true) {
    return (
      <PhoneHead
        place="admin"
        start={
          back === undefined || section === undefined ? (
            frame.acts
          ) : (
            <BackButton
              label={section.label}
              place={section.label.toLowerCase()}
              onBack={back.onBack}
            />
          )
        }
        title={placed?.title ?? title}
        tag={tag}
        end={controls ?? null}
      />
    );
  }
  return (
    <Toolbar
      title={placed?.title ?? title}
      trail={
        back === undefined || section === undefined
          ? undefined
          : [{ label: section.label, icon: section.icon, onPress: back.onBack }]
      }
      tag={tag}
      actions={
        placed === undefined ? (
          controls
        ) : (
          <>
            {placed.acts}
            {controls}
          </>
        )
      }
    />
  );
}

/** The app's frame where it frames this page, a section rather than a page under one; none on the web page. */
function usePlacedFrame(back: AdminWayBack | undefined): AdminPlaceFrame | undefined {
  const frame = useContext(AdminPlaceFrameContext);
  return back === undefined ? frame : undefined;
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
  const placed = usePlacedFrame(back);
  const toolbar = <AdminToolbar title={title} note={note} back={back} controls={controls} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {placed === undefined ? (
        <DetailPage frame={PAGE_FRAME.TOOLBAR} label={title} toolbar={toolbar}>
          {children}
        </DetailPage>
      ) : (
        // Note that the app's section stands on the collection page, as Automations' tabs do, because the bar of sections stands still under the toolbar there.
        <CollectionPage
          frame={PAGE_FRAME.TOOLBAR}
          label={placed.title}
          toolbar={toolbar}
          filters={placed.sections}
          state={COLLECTION_STATE.READY}
          loadingLabel={readingWords(title)}
        >
          {children}
        </CollectionPage>
      )}
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
  const placed = usePlacedFrame(undefined);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPage
        frame={PAGE_FRAME.TOOLBAR}
        label={placed?.title ?? title}
        toolbar={<AdminToolbar title={title} note={note} back={undefined} controls={controls} />}
        filters={
          placed === undefined ? (
            filters
          ) : (
            <>
              {placed.sections}
              {filters}
            </>
          )
        }
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
