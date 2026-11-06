import { type ReactNode, useRef } from "react";
import { NotFoundIcon } from "../../icons/lucide-glyphs.js";
import { ReplayMask, ReplayWords } from "../../session-replay-marks.js";
import { type TitleSeat, useWrapWhenCut } from "../../use-wrap-when-cut.js";
import { BREADCRUMBS_VARIANT, Breadcrumbs, type Crumb } from "../breadcrumbs/breadcrumbs.js";
import { EmptyState, type EmptyStateAction } from "../empty-state/empty-state.js";
import { FILL_ELEMENT, Fill } from "../layout/layout.js";
import type { ContextMenuProps } from "../menu/menu.js";
import { ONE_LINE_ELEMENT, OneLine } from "../one-line/one-line.js";
import { Tooltip, wholeWordsHint } from "../tooltip/hint.js";
import {
  TOOLBAR_INSET,
  TOOLBAR_LOOK,
  ToolbarFrame,
  type ToolbarInset,
  type ToolbarLook,
} from "./toolbar-frame.js";

export { TOOLBAR_INSET, TOOLBAR_LOOK, type ToolbarInset, type ToolbarLook };

export const NOT_FOUND_THING = {
  TASK: "task",
  AGENT: "agent",
  INBOX_ITEM: "Inbox item",
  AUTOMATION: "automation",
  PERSON: "profile",
  ACCOUNT: "account",
  WORKSPACE: "workspace",
} as const;

export type NotFoundThing = (typeof NOT_FOUND_THING)[keyof typeof NOT_FOUND_THING];

const NOT_FOUND_TITLE = "Not found";

const TRAIL_LABEL = "Path";

const LEAD = "ui-toolbar-lead flex min-w-0 flex-initial items-center gap-control-gap";
const ACTIONS = "ui-toolbar-actions relative flex flex-none items-center gap-control-gap";
const TAG = "ui-toolbar-tag flex-none";
const DETAIL = "ui-toolbar-detail min-w-0 flex-[0_1000_auto] text-body text-muted-foreground";
const TITLE = "ui-toolbar-title m-0 -ml-ui-6 pl-ui-6 text-dialog-size font-dialog tracking-title";

const TITLE_PRESS_HEADING =
  "ui-toolbar-title m-0 min-w-0 text-toolbar-title font-toolbar-title tracking-title";

const TITLE_PRESS =
  "ui-toolbar-title-press inline-flex h-control max-w-full items-center gap-icon-gap rounded-control bg-transparent px-ui-8 hover:bg-muted [&_svg]:size-control-icon";

const HEADING_SEAT: TitleSeat = {
  room: ":scope > .ui-toolbar-heading",
  words: ":is(.ui-breadcrumb-label, .ui-toolbar-title)",
};

export interface ToolbarPlace {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly onPress: () => void;
}

export interface ToolbarPickUp {
  readonly name: string;
  readonly shown: boolean;
}

export interface ToolbarTitlePress {
  readonly open: boolean;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly card?: ReactNode;
  readonly onPress: () => void;
}

export interface ToolbarTitleMenu {
  readonly contextMenu: ContextMenuProps;
  readonly keyMenu: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export interface ToolbarProps {
  readonly lead?: ReactNode;
  readonly title?: ReactNode;
  readonly titlePress?: ToolbarTitlePress | undefined;
  readonly titleMenu?: ToolbarTitleMenu | undefined;
  readonly titleReplayUnmasked?: boolean | undefined;
  readonly trail?: readonly ToolbarPlace[] | undefined;
  readonly pickUp?: ToolbarPickUp | undefined;
  readonly detail?: ReactNode;
  readonly tag?: ReactNode;
  readonly actions?: ReactNode;
  readonly start?: ToolbarInset | undefined;
  readonly end?: ToolbarInset | undefined;
  readonly look?: ToolbarLook | undefined;
  readonly place?: string | undefined;
  readonly measure?: boolean | undefined;
  readonly folded?: boolean | undefined;
  readonly wrapHeading?: boolean | undefined;
}

function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

function ToolbarTitle({
  title,
  unmasked,
  press,
  menu,
}: {
  title: ReactNode;
  unmasked: boolean;
  press?: ToolbarTitlePress | undefined;
  menu?: ToolbarTitleMenu | undefined;
}): React.JSX.Element {
  if (typeof title !== "string") return <>{title}</>;
  if (press !== undefined) {
    return (
      <h1 className={TITLE_PRESS_HEADING}>
        <Tooltip label={press.label} card={press.card}>
          <button
            type="button"
            className={TITLE_PRESS}
            aria-expanded={press.open}
            onClick={press.onPress}
            {...menu?.contextMenu}
            onKeyDown={menu?.keyMenu}
          >
            {press.icon}
            <OneLine className="min-w-0" words={title}>
              <ReplayWords unmasked={unmasked}>{title}</ReplayWords>
            </OneLine>
          </button>
        </Tooltip>
      </h1>
    );
  }
  return (
    <OneLine as={ONE_LINE_ELEMENT.H1} hint={wholeWordsHint(title)} className={TITLE} words={title}>
      <ReplayWords unmasked={unmasked}>{title}</ReplayWords>
    </OneLine>
  );
}

const TITLE_MENU = "ui-toolbar-title-menu w-fit min-w-0 max-w-full rounded-control";

function TitleMenu({
  menu,
  crumbs,
  children,
}: {
  menu: ToolbarTitleMenu | undefined;
  crumbs: boolean;
  children: ReactNode;
}): React.JSX.Element {
  if (menu === undefined) return <>{children}</>;
  if (crumbs) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: the box groups a trail's crumbs and the page's name, not a form's fields, so it is no `<fieldset>`.
      <div role="group" className={TITLE_MENU} {...menu.contextMenu} onKeyDown={menu.keyMenu}>
        {children}
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: the box holds the page's heading, which a <button> may not hold.
    <div
      role="button"
      aria-haspopup="menu"
      className={TITLE_MENU}
      tabIndex={0}
      {...menu.contextMenu}
      onKeyDown={menu.keyMenu}
    >
      {children}
    </div>
  );
}

function placeCrumb(place: ToolbarPlace): Crumb {
  const onPress = () => place.onPress();
  return place.icon === undefined
    ? { label: place.label, onPress }
    : { label: place.label, icon: place.icon, onPress };
}

function ToolbarTrail({
  trail,
  title,
  shown,
}: {
  trail: readonly ToolbarPlace[];
  title: string;
  shown?: boolean | undefined;
}): React.JSX.Element {
  const own: Crumb[] = title === "" ? [] : [{ label: title, current: true, shown }];
  return (
    <Breadcrumbs
      label={TRAIL_LABEL}
      variant={BREADCRUMBS_VARIANT.TITLE}
      crumbs={[...trail.map(placeCrumb), ...own]}
    />
  );
}

function ToolbarPickedUp({ pickUp }: { pickUp: ToolbarPickUp }): React.JSX.Element {
  return (
    <span
      className="ui-toolbar-pick-up"
      data-shown={pickUp.shown ? "true" : "false"}
      aria-hidden={pickUp.shown ? undefined : "true"}
    >
      <OneLine hint={pickUp.shown ? wholeWordsHint(pickUp.name) : undefined} className={TITLE}>
        {pickUp.name}
      </OneLine>
    </span>
  );
}

export function Toolbar({
  lead,
  title,
  titlePress,
  titleMenu,
  titleReplayUnmasked = false,
  trail,
  pickUp,
  detail,
  tag,
  actions,
  start,
  end,
  look,
  place,
  measure,
  folded,
  wrapHeading,
}: ToolbarProps): React.JSX.Element {
  const frame = useRef<HTMLElement>(null);
  const wrapped = useWrapWhenCut(frame, HEADING_SEAT, wrapHeading === true);
  return (
    <ToolbarFrame
      frameRef={frame}
      wrapped={wrapped}
      start={start}
      end={end}
      look={look}
      place={place}
      measure={measure}
      folded={folded}
      wrapHeading={wrapHeading}
    >
      {said(lead) ? <div className={LEAD}>{lead}</div> : null}
      <div className="ui-toolbar-heading">
        <TitleMenu
          menu={titlePress === undefined ? titleMenu : undefined}
          crumbs={trail !== undefined && trail.length > 0}
        >
          {trail !== undefined && trail.length > 0 && typeof title === "string" && title !== "" ? (
            <ReplayMask>
              <ToolbarTrail trail={trail} title={title} />
            </ReplayMask>
          ) : trail !== undefined && trail.length > 0 && !said(title) && pickUp !== undefined ? (
            <ReplayMask>
              <ToolbarTrail trail={trail} title={pickUp.name} shown={pickUp.shown} />
            </ReplayMask>
          ) : said(title) ? (
            <ToolbarTitle
              title={title}
              unmasked={titleReplayUnmasked}
              press={titlePress}
              menu={titleMenu}
            />
          ) : pickUp !== undefined && pickUp.name !== "" ? (
            <ReplayMask>
              <ToolbarPickedUp pickUp={pickUp} />
            </ReplayMask>
          ) : null}
        </TitleMenu>
        {said(detail) ? <OneLine className={DETAIL}>{detail}</OneLine> : null}
        {said(tag) ? <span className={TAG}>{tag}</span> : null}
      </div>
      {said(actions) ? <div className={ACTIONS}>{actions}</div> : null}
    </ToolbarFrame>
  );
}

export function NotFound({
  thing,
  bar,
  action,
  replayUnmasked = false,
}: {
  thing: NotFoundThing;
  bar?: ToolbarProps | undefined;
  action?: EmptyStateAction | undefined;
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  const state = (
    <EmptyState
      icon={<NotFoundIcon />}
      title={NOT_FOUND_TITLE}
      action={action}
      replayUnmasked={replayUnmasked}
    >
      {`This ${thing} doesn't exist, or you don't have access to it.`}
    </EmptyState>
  );
  if (bar === undefined) return state;
  return (
    <Fill as={FILL_ELEMENT.SECTION} aria-label={NOT_FOUND_TITLE}>
      <Toolbar {...bar} />
      {state}
    </Fill>
  );
}
