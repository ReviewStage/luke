import { readingWords } from "@repo/features/words";
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
} from "@repo/ui";
import { accountLabel } from "@repo/ui/account-initials";
import { createContext, useContext } from "react";
import { PhoneHead } from "../../desktop/phone-head.js";
import type { AdminTab } from "../routing.js";
import { adminPlace } from "./places.js";

export interface ViewerAccount {
  name: string;
  email: string;
  image: string | undefined;
}

export function AccountAvatar({
  account,
  size = AVATAR_SIZE.CARD,
  onFail,
}: {
  account: ViewerAccount;
  size?: AvatarSize;
  onFail?: () => void;
}): React.JSX.Element {
  return (
    <Avatar
      id={account.email}
      name={accountLabel(account)}
      {...(account.image === undefined ? {} : { src: account.image })}
      size={size}
      decorative
      {...(onFail === undefined ? {} : { onFail })}
    />
  );
}

export interface AdminWayBack {
  tab: AdminTab;
  onBack: () => void;
}

export interface AdminPlaceFrame {
  readonly title: string;
  readonly sections: React.ReactNode;
  readonly acts: React.ReactNode;
  readonly phone: boolean;
}

const AdminPlaceFrameContext = createContext<AdminPlaceFrame | undefined>(undefined);

export const AdminPlaceFrameProvider = AdminPlaceFrameContext.Provider;

function AdminToolbar({
  title,
  note,
  back,
  controls,
}: {
  title: string;
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

function usePlacedFrame(back: AdminWayBack | undefined): AdminPlaceFrame | undefined {
  const frame = useContext(AdminPlaceFrameContext);
  return back === undefined ? frame : undefined;
}

export function AdminPage({
  title,
  note,
  back,
  controls,
  children,
}: {
  title: string;
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
  note?: string | undefined;
  controls: React.ReactNode;
  filters: React.ReactNode;
  state: CollectionState;
  loadingLabel: string;
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

const SKELETON_COUNT_WIDTH = "128px";

export function CollectionCountSkeleton(): React.JSX.Element {
  return (
    <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
      <Skeleton width={SKELETON_COUNT_WIDTH} />
    </Text>
  );
}
