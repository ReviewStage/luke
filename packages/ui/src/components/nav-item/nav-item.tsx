import type { ButtonHTMLAttributes, KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { type ContextMenuProps, withContextMenu } from "../menu/menu.js";
import { ClippedLine, ONE_LINE_ELEMENT, ONE_LINE_END } from "../one-line/clipped-line.js";
import { rovingItem } from "../roving-keys/roving-keys.js";

const ROW =
  "ui-nav-item group/nav m-0 flex h-control w-full min-w-0 cursor-press items-center gap-icon-gap rounded-control border-0 px-row-inset data-[nested=true]:ps-nav-item-nest text-left font-sans text-body-size leading-label font-text no-underline transition-[background-color,color] duration-(--ui-duration-hover) ease-plain disabled:cursor-default disabled:opacity-disabled data-[variant=identity]:h-auto data-[variant=identity]:min-h-nav-identity data-[variant=identity]:py-ui-6 data-[variant=step]:h-auto data-[variant=step]:items-start data-[variant=step]:py-ui-6";

const NAME =
  "ui-nav-item-name min-w-0 flex-initial overflow-hidden whitespace-nowrap group-data-[unread=true]/nav:font-emphasis group-data-[variant=identity]/nav:font-emphasis";

const STEP_NAME = "ui-nav-item-name min-w-0 line-clamp-2 wrap-break-word";

const STEP_WORDS = "ui-nav-item-words flex min-w-0 flex-1 flex-col";

const MARK =
  "ui-nav-item-mark inline-flex [&>svg.settings-chevron]:mx-ui-2 [&>svg.settings-chevron]:size-ui-12 [&>svg.settings-chevron]:text-muted-foreground";

export const NAV_ITEM_VARIANT = {
  ROW: "row",
  IDENTITY: "identity",
  STEP: "step",
} as const;

export type NavItemVariant = (typeof NAV_ITEM_VARIANT)[keyof typeof NAV_ITEM_VARIANT];

export const NAV_CURRENT = {
  PAGE: "page",
  LOCATION: "location",
} as const;

export type NavCurrent = (typeof NAV_CURRENT)[keyof typeof NAV_CURRENT];

export const NAV_COUNT_SHOWN = {
  ALWAYS: "always",
  ON_HOVER: "on-hover",
} as const;

export type NavCountShown = (typeof NAV_COUNT_SHOWN)[keyof typeof NAV_COUNT_SHOWN];

export interface NavCount {
  readonly value: number;
  readonly noun?: string | undefined;
  readonly shown?: NavCountShown | undefined;
  readonly tone?: StatusTone | undefined;
}

export interface NavMenuTrigger {
  readonly "aria-haspopup": "menu";
  readonly "aria-expanded": boolean;
  readonly onClick: (event: MouseEvent<HTMLElement>) => void;
}

type HintProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onPointerEnter" | "onPointerLeave" | "onPointerDown" | "onFocus" | "onBlur" | "aria-keyshortcuts"
>;

export type NavItemProps = HintProps & {
  variant?: NavItemVariant | undefined;
  icon?: ReactNode;
  children: ReactNode;
  detail?: ReactNode;
  current?: NavCurrent | undefined;
  unread?: boolean | undefined;
  nested?: boolean | undefined;
  count?: NavCount | undefined;
  mark?: ReactNode;
  shortcut?: ReactNode;
  menu?: NavMenuTrigger | undefined;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  contextMenu?: ContextMenuProps | undefined;
  actions?: ReactNode;
  onKeyDown?: ((event: KeyboardEvent<HTMLButtonElement>) => void) | undefined;
  disabled?: boolean | undefined;
  keepFocus?: boolean | undefined;
  roving?: boolean | undefined;
  id?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
  "aria-label"?: string | undefined;
  "aria-describedby"?: string | undefined;
};

function preventFocusMove(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

function Glyph({ icon }: { icon: ReactNode }): React.JSX.Element {
  return (
    <span
      className="ui-nav-item-glyph grid min-h-control-icon min-w-control-icon flex-none place-items-center [&>*]:grid [&>*]:place-items-center"
      aria-hidden="true"
    >
      <span className="ui-nav-item-icon [&>svg]:size-control-icon">{icon}</span>
    </span>
  );
}

function Name({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ClippedLine className={NAME} as={ONE_LINE_ELEMENT.SPAN} end={ONE_LINE_END.FADE}>
      {children}
    </ClippedLine>
  );
}

function AtRest({ mark, count }: { mark: ReactNode; count: NavCount | undefined }) {
  const counted = count !== undefined && count.value > 0;
  if (!said(mark) && !counted) return null;
  return (
    <span className="ui-nav-item-rest ml-auto">
      {said(mark) ? <span className={MARK}>{mark}</span> : null}
      {counted ? (
        <span
          className="ui-nav-item-count"
          data-shown={count.shown ?? NAV_COUNT_SHOWN.ALWAYS}
          data-tone={count.tone ?? STATUS_TONE.NEUTRAL}
        >
          {count.value}
          {count.noun === undefined ? null : (
            <span className="ui-visually-hidden"> {count.noun}</span>
          )}
        </span>
      ) : null}
    </span>
  );
}

function StepWords({ name, detail }: { name: ReactNode; detail: ReactNode }): React.JSX.Element {
  return (
    <span className={STEP_WORDS}>
      <span className={STEP_NAME}>{name}</span>
      {said(detail) ? <span className="ui-nav-item-detail">{detail}</span> : null}
    </span>
  );
}

export function NavItemLink({
  href,
  icon,
  children,
  current,
  title,
  newTab,
  onClick,
  ...props
}: {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
  current?: NavCurrent | undefined;
  title?: string | undefined;
  newTab?: boolean | undefined;
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  "aria-label"?: string | undefined;
}): React.JSX.Element {
  return (
    <a
      className={ROW}
      data-variant={NAV_ITEM_VARIANT.ROW}
      href={href}
      target={newTab === true ? "_blank" : undefined}
      rel={newTab === true ? "noopener" : undefined}
      title={title}
      aria-label={props["aria-label"]}
      aria-current={current}
      onClick={pulseOnPress(onClick, PRESS_PULSE.QUIET)}
    >
      {said(icon) ? <Glyph icon={icon} /> : null}
      <Name>{children}</Name>
    </a>
  );
}

export function NavItem({
  variant = NAV_ITEM_VARIANT.ROW,
  icon,
  children,
  detail,
  current,
  unread,
  nested,
  count,
  mark,
  shortcut,
  menu,
  onClick,
  keepFocus,
  roving,
  actions,
  ...props
}: NavItemProps): React.JSX.Element {
  const framed = said(actions);
  const press = (
    <button
      type="button"
      className={ROW}
      data-variant={variant}
      data-unread={unread === true ? "true" : undefined}
      data-nested={nested === true ? "true" : undefined}
      id={props.id}
      ref={props.ref}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
      aria-describedby={props["aria-describedby"]}
      aria-current={current}
      aria-expanded={menu?.["aria-expanded"]}
      aria-haspopup={menu?.["aria-haspopup"]}
      aria-keyshortcuts={props["aria-keyshortcuts"]}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      onMouseDown={keepFocus === true ? preventFocusMove : undefined}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onClick={pulseOnPress(menu?.onClick ?? onClick, PRESS_PULSE.QUIET)}
      {...withContextMenu(framed ? undefined : props.contextMenu, {
        onPointerDown: props.onPointerDown,
      })}
      onKeyDown={props.onKeyDown}
      {...(roving === true ? rovingItem() : undefined)}
    >
      {said(icon) ? <Glyph icon={icon} /> : null}
      {variant === NAV_ITEM_VARIANT.STEP ? (
        <StepWords name={children} detail={detail} />
      ) : (
        <>
          <Name>{children}</Name>
          {said(detail) ? <span className="ui-nav-item-detail">{detail}</span> : null}
        </>
      )}
      <AtRest mark={mark} count={count} />
      {said(shortcut) ? <span className="ui-nav-item-shortcut ml-auto">{shortcut}</span> : null}
    </button>
  );
  if (!framed) return press;
  return (
    <div
      className="ui-nav-item-frame relative flex min-w-0"
      data-actions={said(actions) ? "true" : undefined}
      {...withContextMenu<HTMLDivElement>(props.contextMenu, {})}
    >
      {press}
      {said(actions) ? (
        <span className="ui-nav-item-actions absolute inset-y-0 end-ui-4 flex items-center">
          {actions}
        </span>
      ) : null}
    </div>
  );
}
