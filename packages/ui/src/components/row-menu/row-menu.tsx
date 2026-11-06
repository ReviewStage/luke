import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { BUTTON_LIGHT, type ButtonSize } from "../button/button.js";
import {
  dropBelowStart,
  Menu,
  type MenuEntry,
  type MenuSubject,
  opensMenu,
  useMenu,
  withContextMenu,
} from "../menu/menu.js";
import { MoreButton, moreLabel } from "../more-button/more-button.js";

export interface ListRowMenu {
  readonly thing: string;
  readonly groups: readonly (readonly MenuEntry[])[];
  readonly heading?: ReactNode;
  readonly subject?: MenuSubject | undefined;
  readonly footer?: ReactNode;
  readonly shown?: boolean | undefined;
  readonly replayUnmasked?: boolean | undefined;
  readonly openRequest?: RowMenuRequest | undefined;
}

export interface RowMenuRequest {
  readonly count: number;
  readonly submenu?: string | undefined;
}

interface RowMoreOptions {
  readonly size?: ButtonSize | undefined;
  readonly describedBy?: string | undefined;
}

export function useRowMenu(
  menu: ListRowMenu | undefined,
  options: {
    readonly disabled?: boolean | undefined;
    readonly opener?: RefObject<HTMLElement | null> | undefined;
    readonly more?: boolean | undefined;
  } = {},
) {
  const { disabled = false, opener, more = true } = options;
  const state = useMenu(menu?.shown ?? true);
  const moreElement = useRef<HTMLButtonElement | null>(null);
  const live =
    menu !== undefined && !disabled && menu.groups.some((group) => group.length > 0)
      ? menu
      : undefined;
  const offered = live !== undefined;
  const moreDrawn = offered && (more || opener === undefined);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || !opensMenu(event)) return;
    event.preventDefault();
    const held = event.target instanceof HTMLElement ? event.target : event.currentTarget;
    state.show(dropBelowStart(event.currentTarget), held);
  };
  const [openOn, setOpenOn] = useState<string | undefined>(undefined);
  if (state.open === undefined && openOn !== undefined) setOpenOn(undefined);
  const answered = useRef(menu?.openRequest?.count ?? 0);
  const asked = live?.openRequest;
  useEffect(() => {
    if (asked === undefined || asked.count <= answered.current) return;
    answered.current = asked.count;
    const from = opener?.current ?? moreElement.current;
    if (from === null) return;
    setOpenOn(asked.submenu);
    state.show(dropBelowStart(from), from);
  }, [asked?.count]);
  const doors = offered ? state.contextMenu(opener ?? moreElement) : undefined;
  const open = state.open !== undefined;
  const button = ({ size, describedBy }: RowMoreOptions = {}): ReactNode =>
    live !== undefined && moreDrawn ? (
      <MoreButton
        ref={moreElement}
        thing={live.thing}
        size={size}
        lights={BUTTON_LIGHT.GLYPH}
        aria-describedby={describedBy}
        {...state.trigger()}
      />
    ) : null;
  const popup: ReactNode =
    live !== undefined && state.drawn !== undefined ? (
      <Menu
        label={moreLabel(live.thing)}
        menu={state.drawn}
        subject={live.subject}
        heading={live.heading}
        footer={live.footer}
        groups={live.groups}
        openOn={openOn}
        onClose={state.close}
        replayUnmasked={live.replayUnmasked}
      />
    ) : null;
  return {
    offered,
    moreDrawn,
    open,
    close: state.close,
    doors,
    onKeyDown: offered ? onKeyDown : undefined,
    button,
    more: (moreOptions?: RowMoreOptions): ReactNode =>
      moreDrawn ? <span className="ui-row-more">{button(moreOptions)}</span> : null,
    props: {
      ...withContextMenu<HTMLElement>(doors, {}),
      onKeyDown: offered ? onKeyDown : undefined,
      "data-row-menu": offered ? "" : undefined,
      "data-menu-open": open ? "true" : undefined,
    },
    popup,
  };
}
