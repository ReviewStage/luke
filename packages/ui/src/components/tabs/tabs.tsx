import { APP_COMMAND } from "@repo/settings/shortcuts";
import type {
  ComponentType,
  FocusEventHandler,
  MouseEventHandler,
  PointerEventHandler,
  ReactElement,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import {
  Children,
  isValidElement,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import { cn } from "../../cn.js";
import { cssCustomProperties } from "../../css.js";
import { CloseIcon } from "../../face/glyphs.js";
import { joinRefs } from "../../join-refs.js";
import { PRESS_PULSE, pulseOnPress, pulsePress } from "../../press-pulse.js";
import { ReplayWords } from "../../session-replay-marks.js";
import type { StatusTone } from "../../status-tone.js";
import { useClipped } from "../../use-clipped.js";
import { ANNOUNCE, announce } from "../announcer/announcer.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import {
  type ContextMenuProps,
  MENU_ALIGN,
  MENU_DROP,
  type MenuPlacement,
  opensMenu,
} from "../menu/menu.js";
import {
  ROVING_ORIENTATION,
  ROVING_STOP,
  rovingItem,
  useRovingKeys,
} from "../roving-keys/roving-keys.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";
import { type TabMove, useTabDrag } from "./use-tab-drag.js";

const TAB = '[role="tab"]';

const ANCHORED = '[data-anchored="true"]';

const STRIP =
  "ui-tabs relative flex min-w-0 items-center gap-list-gap overscroll-x-contain [scrollbar-width:none]";

const PILL = "ui-tab flex items-center rounded-control text-label font-label";

const TAB_BUTTON =
  "ui-tab-button relative flex min-w-0 flex-[1_1_auto] items-center gap-icon-gap h-control m-0 [border:0] rounded-[inherit] bg-transparent bg-none text-inherit [font:inherit]";

const END_SLOT =
  "absolute top-1/2 right-(--ui-tab-close-inset) [transform:translateY(-50%)] transition-opacity duration-(--ui-duration-hover) ease-motion-exit";

const WHEEL_DELTA = {
  PIXEL: 0,
  LINE: 1,
  PAGE: 2,
} as const;

const WHEEL_LINE = 16;

const UNREAD_TAB_NOTE = "New result";

export const TABS_GROUND = {
  WELL: "well",
  GROUND: "ground",
  FRAME: "frame",
} as const;

export type TabsGround = (typeof TABS_GROUND)[keyof typeof TABS_GROUND];

export const TABS_FOLD = {
  GLYPH: "glyph",
  LABEL: "label",
} as const;

export type TabsFold = (typeof TABS_FOLD)[keyof typeof TABS_FOLD];

export type { TabMove };

export interface TabPlace {
  readonly at: number;
  readonly count: number;
  readonly onMove: TabMove;
}

export interface TabsControls {
  readonly step: (by: number) => void;
  readonly placeOf: (tab: HTMLElement) => TabPlace | undefined;
}

interface TabHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onClick?: MouseEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

export type TabHint = ComponentType<{
  label: string | undefined;
  card?: ReactNode;
  children: ReactElement<TabHintProps>;
}>;

function tabHint(input: { label: string; clipped: boolean; unread: boolean }): string | undefined {
  const words = [
    input.clipped ? input.label : undefined,
    input.unread ? UNREAD_TAB_NOTE : undefined,
  ].filter((word) => word !== undefined);
  return words.length === 0 ? undefined : words.join(" · ");
}

function closesTab(key: string): boolean {
  return key === "Delete" || key === "Backspace";
}

function scrollStrip(strip: HTMLElement, by: number, glide: boolean): void {
  if (!glide) strip.style.scrollBehavior = "auto";
  strip.scrollLeft += by;
  strip.style.scrollBehavior = "";
}

function reveal(strip: HTMLElement, tab: HTMLElement, glide = true): void {
  const pill = tab.closest<HTMLElement>(".ui-tab") ?? tab;
  const before = pill.previousElementSibling;
  const style = getComputedStyle(strip);
  const start =
    before instanceof HTMLElement
      ? before.offsetLeft + before.offsetWidth + (Number.parseFloat(style.columnGap) || 0)
      : Number.parseFloat(style.paddingLeft) || 0;
  const end = start + pill.offsetWidth;
  if (start < strip.scrollLeft) scrollStrip(strip, start - strip.scrollLeft, glide);
  else if (end > strip.scrollLeft + strip.clientWidth) {
    scrollStrip(strip, end - strip.scrollLeft - strip.clientWidth, glide);
  }
}

function focusTab(strip: HTMLElement | null, tab: HTMLElement | undefined | null): void {
  tab?.focus({ preventScroll: true });
  if (strip !== null && tab !== undefined && tab !== null) reveal(strip, tab);
}

function within(strip: HTMLElement, target: EventTarget): boolean {
  return target instanceof Node && strip.contains(target);
}

function movedLine(tab: HTMLElement | undefined, to: number, count: number): string {
  return `${tab?.textContent ?? "Tab"} moved to position ${to + 1} of ${count}`;
}

export function tabMenuPlacement(tab: HTMLElement): MenuPlacement {
  const bounds = (tab.closest(".ui-tab") ?? tab).getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START };
}

function movableTabs(strip: HTMLElement | null): HTMLElement[] {
  const tabs = [...(strip?.querySelectorAll<HTMLElement>(TAB) ?? [])];
  return tabs.filter((tab) => tab.closest(ANCHORED) === null);
}

export function Tabs({
  label,
  ground = TABS_GROUND.WELL,
  fold = TABS_FOLD.GLYPH,
  onMove,
  onFocusChange,
  controls,
  children,
}: {
  label: string;
  ground?: TabsGround | undefined;
  fold?: TabsFold | undefined;
  onMove?: TabMove | undefined;
  onFocusChange?: ((focused: boolean) => void) | undefined;
  controls?: Ref<TabsControls> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const strip = useRef<HTMLDivElement | null>(null);
  const roving = useRovingKeys<HTMLDivElement>({
    orientation: ROVING_ORIENTATION.HORIZONTAL,
    stop: ROVING_STOP.CHOSEN,
    moveTo: (tab) => focusTab(strip.current, tab),
  });
  const stripRef = useMemo(() => joinRefs(strip, roving.ref), [roving.ref]);
  const count = Children.toArray(children).filter(isValidElement).length;
  const closedAt = useRef<number | undefined>(undefined);
  const revealed = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const at = closedAt.current;
    if (at === undefined || strip.current === null) return;
    closedAt.current = undefined;
    const tabs = [...strip.current.querySelectorAll<HTMLElement>(TAB)];
    const following = strip.current.nextElementSibling;
    const after = following?.matches("button") ? following : following?.querySelector("button");
    const next = tabs[Math.min(at, tabs.length - 1)];
    if (next === undefined && after instanceof HTMLElement) after.focus();
    else focusTab(strip.current, next);
  });
  useLayoutEffect(() => {
    const chosen = strip.current?.querySelector<HTMLElement>(`${TAB}[aria-selected="true"]`);
    if (strip.current === null || chosen === null || chosen === undefined) return;
    if (chosen === revealed.current) return;
    const drawn = revealed.current !== null;
    revealed.current = chosen;
    reveal(strip.current, chosen, drawn);
  });
  const move =
    onMove === undefined
      ? undefined
      : (from: number, to: number) => {
          const tabs = movableTabs(strip.current);
          announce(ANNOUNCE.POLITE, movedLine(tabs[from], to, tabs.length));
          onMove(from, to);
        };
  const onPointerDown = useTabDrag(move);
  useImperativeHandle(controls, () => ({
    step: (by: number) => {
      const tabs = movableTabs(strip.current);
      const tab = tabs.find((each) => each === document.activeElement);
      const at = tab === undefined ? -1 : tabs.indexOf(tab);
      if (tab === undefined || move === undefined || at + by < 0 || at + by >= tabs.length) return;
      flushSync(() => move(at, at + by));
      focusTab(strip.current, tab);
    },
    placeOf: (tab: HTMLElement): TabPlace | undefined => {
      if (move === undefined) return undefined;
      const tabs = movableTabs(strip.current);
      const at = tabs.indexOf(tab);
      return at < 0 ? undefined : { at, count: tabs.length, onMove: move };
    },
  }));

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>(TAB)];
    const at = event.target instanceof HTMLElement ? tabs.indexOf(event.target) : -1;
    if (at < 0) return;
    if (closesTab(event.key)) {
      const pill = event.target instanceof HTMLElement ? event.target.closest(".ui-tab") : null;
      if (pill?.getAttribute("data-closable") === "true") closedAt.current = at;
      return;
    }
    roving.onKeyDown(event);
  };

  const wheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (!within(node, event.target)) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (node.scrollWidth <= node.clientWidth) return;
    const unit =
      event.deltaMode === WHEEL_DELTA.LINE
        ? WHEEL_LINE
        : event.deltaMode === WHEEL_DELTA.PAGE
          ? node.clientWidth
          : 1;
    scrollStrip(node, event.deltaY * unit, false);
  };

  return (
    <div
      ref={stripRef}
      data-roving={roving["data-roving"]}
      role="tablist"
      aria-label={label}
      className={STRIP}
      data-ground={ground}
      data-fold={fold}
      style={cssCustomProperties({ "--ui-tab-count": count })}
      onKeyDown={keyDown}
      onPointerDown={onPointerDown}
      onWheel={wheel}
      onFocus={(event) => {
        roving.onFocus(event);
        if (within(event.currentTarget, event.target)) onFocusChange?.(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange?.(false);
      }}
    >
      {children}
    </div>
  );
}

export function Tab({
  id,
  controls,
  icon,
  label,
  labelReplayUnmasked = false,
  detail,
  detailTone,
  endMark,
  selected,
  unread = false,
  card,
  hint: Hint,
  editor,
  tabRef,
  preview = false,
  anchored = false,
  onSelect,
  onKeep,
  onClose,
  contextMenu,
  onMenu,
  menu,
}: {
  id?: string | undefined;
  controls?: string | undefined;
  icon: React.JSX.Element;
  label: string;
  labelReplayUnmasked?: boolean | undefined;
  detail?: string | undefined;
  detailTone?: StatusTone | undefined;
  endMark?: React.JSX.Element | undefined;
  selected: boolean;
  unread?: boolean;
  card?: ReactNode;
  hint?: TabHint | undefined;
  editor?: ReactNode;
  tabRef?: RefObject<HTMLButtonElement | null> | undefined;
  preview?: boolean;
  anchored?: boolean;
  onSelect: () => void;
  onKeep?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  contextMenu?: ContextMenuProps | undefined;
  onMenu?: ((placement: MenuPlacement, opener: HTMLElement) => void) | undefined;
  menu?: ReactNode;
}): React.JSX.Element {
  const [words, clipped] = useClipped(detail === undefined ? label : `${label} ${detail}`);
  const said = tabHint({ label, clipped: clipped || !selected, unread });
  const own = useRef<HTMLButtonElement | null>(null);
  const button = tabRef ?? own;
  const glyph = (
    <span className="ui-tab-icon relative flex flex-none text-muted-foreground [--ui-glyph-size:var(--ui-control-icon)] [&_svg]:size-control-icon">
      {icon}
    </span>
  );
  const tab = (
    <button
      ref={button}
      type="button"
      role="tab"
      id={id}
      className={TAB_BUTTON}
      aria-selected={selected}
      aria-controls={controls}
      aria-description={unread ? UNREAD_TAB_NOTE : undefined}
      {...rovingItem()}
      onClick={(event) => {
        pulsePress(event.currentTarget.closest<HTMLElement>(".ui-tab") ?? event.currentTarget);
        onSelect();
      }}
      onDoubleClick={preview ? onKeep : undefined}
      {...contextMenu}
      onKeyDown={(event) => {
        if (onMenu !== undefined && opensMenu(event)) {
          event.preventDefault();
          onMenu(tabMenuPlacement(event.currentTarget), event.currentTarget);
          return;
        }
        if (onClose === undefined || !closesTab(event.key)) return;
        event.preventDefault();
        onClose();
      }}
    >
      {glyph}
      <span
        ref={words}
        className="ui-tab-label overflow-hidden whitespace-nowrap"
        data-overflow={String(clipped)}
      >
        <ReplayWords unmasked={labelReplayUnmasked}>{label}</ReplayWords>
        {detail === undefined ? null : (
          <>
            {" "}
            <span
              className="ui-tab-detail text-muted-foreground data-tone:text-tone-ink"
              data-tone={detailTone}
            >
              <ReplayWords unmasked={labelReplayUnmasked}>{detail}</ReplayWords>
            </span>
          </>
        )}
      </span>
      {endMark === undefined ? null : (
        <span
          className={cn(
            "ui-tab-end-mark",
            END_SLOT,
            "size-(--ui-tab-close) items-center justify-center",
          )}
        >
          {endMark}
        </span>
      )}
    </button>
  );
  const hung =
    Hint === undefined ? (
      tab
    ) : (
      <Hint label={card === undefined ? said : label} card={card}>
        {tab}
      </Hint>
    );
  return (
    <div
      className={PILL}
      data-selected={String(selected)}
      data-closable={String(onClose !== undefined)}
      data-preview={String(preview)}
      data-anchored={String(anchored)}
      data-unread={String(unread)}
      data-marked={String(endMark !== undefined)}
    >
      {editor === undefined ? (
        hung
      ) : (
        <span className={TAB_BUTTON} data-editing="true">
          {glyph}
          <span className="ui-tab-rename grid w-[24ch] min-w-0">{editor}</span>
        </span>
      )}
      {onClose === undefined || editor !== undefined ? null : (
        <span className={cn("ui-tab-close", END_SLOT)}>
          <Tooltip label={`Close ${label}`} command={selected ? APP_COMMAND.CLOSE_TAB : undefined}>
            <IconButton
              icon={<CloseIcon />}
              label={`Close ${label}`}
              size={BUTTON_SIZE.COMPACT}
              tabbable={false}
              onClick={onClose}
            />
          </Tooltip>
        </span>
      )}
      {menu}
    </div>
  );
}

export function TabCards({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-tab-cards flex gap-2 p-3 overflow-x-auto" role="listbox" aria-label={label}>
      {children}
    </div>
  );
}

export function TabCard({
  icon,
  label,
  labelReplayUnmasked = false,
  detail,
  detailIcon,
  endMark,
  still,
  here = false,
  chosen,
  pickOnPress = false,
  onPoint,
  onPick,
}: {
  icon: ReactNode;
  label: string;
  labelReplayUnmasked?: boolean | undefined;
  detail?: string | undefined;
  detailIcon?: ReactNode;
  endMark?: ReactNode;
  still?: string | undefined;
  here?: boolean | undefined;
  chosen: boolean;
  pickOnPress?: boolean | undefined;
  onPoint: () => void;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <div
      role="option"
      aria-selected={chosen}
      tabIndex={pickOnPress ? -1 : 0}
      className="ui-tab-card group/card flex w-[176px] min-w-0 flex-none flex-col gap-1 p-1.5 border border-solid border-transparent rounded-ui-10 cursor-default aria-[selected=true]:border-border-selected aria-[selected=true]:bg-fill-strong"
      data-here={here}
      onPointerEnter={onPoint}
      onPointerDown={
        pickOnPress
          ? (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              pulsePress(event.currentTarget, PRESS_PULSE.QUIET);
              onPick();
            }
          : undefined
      }
      onClick={pickOnPress ? undefined : pulseOnPress(onPick, PRESS_PULSE.QUIET)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onPick();
      }}
      onContextMenu={pickOnPress ? (event) => event.preventDefault() : undefined}
    >
      <div className="ui-tab-card-preview ph-no-capture flex h-[110px] items-center justify-center mb-0.5 border border-solid border-border rounded-ui-6 bg-surface overflow-hidden group-data-[here=true]/card:opacity-55">
        {still === undefined ? (
          <span className="ui-tab-card-glyph inline-flex text-muted-foreground [--ui-glyph-size:28px] [&_:is(svg,img)]:size-[28px]">
            {icon}
          </span>
        ) : (
          <img
            className="ui-tab-card-still size-full object-cover object-left-top"
            src={still}
            alt=""
            draggable={false}
          />
        )}
      </div>
      <div className="ui-tab-card-name flex min-w-0 items-center gap-icon-gap px-0.5 whitespace-nowrap [--ui-glyph-size:var(--ui-menu-glyph)] [&>:is(svg,img)]:size-menu-glyph [&>:is(svg,img)]:flex-none [&>.ui-text]:min-w-0 [&>.ui-text]:flex-auto [&>.ui-text]:overflow-hidden [&>.ui-text]:text-ellipsis">
        {icon}
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
          <ReplayWords unmasked={labelReplayUnmasked}>{label}</ReplayWords>
        </Text>
      </div>
      <div className="ui-tab-card-detail flex items-center gap-1 whitespace-nowrap [&>.ui-text]:min-w-0 [&>.ui-text]:overflow-hidden [&>.ui-text]:text-ellipsis">
        {detail === undefined ? null : (
          <>
            {detailIcon}
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              <ReplayWords unmasked={false}>{detail}</ReplayWords>
            </Text>
          </>
        )}
        {endMark}
      </div>
    </div>
  );
}
