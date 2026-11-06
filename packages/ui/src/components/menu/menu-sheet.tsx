import { useCallback, useId, useRef } from "react";
import { ReplayWords } from "../../session-replay-marks.js";
import { BackButton, NO_BACK_KEY } from "../back-button/back-button.js";
import { DIALOG_SIZE, Dialog } from "../dialog/dialog.js";
import { OneLine } from "../one-line/one-line.js";

const ROOM_ATTRIBUTE = "data-ui-room";
const NARROW_ROOM = "narrow";

const SHEET_SWIPE = {
  SHARE: 0.25,
  FLICK: 0.5,
} as const;

const HEAD_CONTROL = "button, label, input";

interface SheetDrag {
  readonly pointerId: number;
  readonly from: number;
  at: number;
  down: number;
  speed: number;
}

export interface SheetBack {
  readonly label: string;
  readonly onBack: () => void;
}

function useSheetSwipe(onAway: () => void) {
  const sheet = useRef<HTMLDivElement | null>(null);
  const drag = useRef<SheetDrag | null>(null);
  const follow = (down: number, held: boolean) => {
    const element = sheet.current;
    if (element === null) return;
    element.style.translate = down === 0 ? "" : `0 ${down}px`;
    element.toggleAttribute("data-dragging", held);
  };
  const letGo = (event: React.PointerEvent<HTMLElement>, away: boolean) => {
    const held = drag.current;
    if (held === null || held.pointerId !== event.pointerId) return;
    drag.current = null;
    const height = sheet.current?.getBoundingClientRect().height ?? 0;
    const far = held.down > height * SHEET_SWIPE.SHARE || held.speed > SHEET_SWIPE.FLICK;
    follow(away && far ? held.down : 0, false);
    if (away && far) onAway();
  };
  const head = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") return;
      if (event.target instanceof Element && event.target.closest(HEAD_CONTROL) !== null) return;
      drag.current = {
        pointerId: event.pointerId,
        from: event.clientY,
        at: event.timeStamp,
        down: 0,
        speed: 0,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const held = drag.current;
      if (held === null || held.pointerId !== event.pointerId) return;
      const down = Math.max(0, event.clientY - held.from);
      const elapsed = event.timeStamp - held.at;
      if (elapsed > 0) held.speed = (down - held.down) / elapsed;
      held.down = down;
      held.at = event.timeStamp;
      follow(down, true);
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => letGo(event, true),
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => letGo(event, false),
  };
  return { sheet, head };
}

export function inNarrowRoom(): boolean {
  return document.documentElement.getAttribute(ROOM_ATTRIBUTE) === NARROW_ROOM;
}

export function MenuSheetFrame({
  id,
  open,
  opener,
  initialFocus,
  hold,
  name,
  detail,
  replayUnmasked = false,
  mark,
  back,
  field,
  onAway,
  onKeyDown,
  children,
}: {
  id?: string | undefined;
  open: boolean;
  opener?: HTMLElement | undefined;
  initialFocus: React.RefObject<HTMLElement | null>;
  hold?: ((card: HTMLElement | null) => void) | undefined;
  name: string;
  detail?: string | undefined;
  replayUnmasked?: boolean | undefined;
  mark?: React.ReactNode;
  back?: SheetBack | undefined;
  field?: React.ReactNode;
  onAway: () => void;
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const nameId = useId();
  const { sheet, head } = useSheetSwipe(onAway);
  const framed = useCallback(
    (node: HTMLDivElement | null) => {
      sheet.current = node;
      hold?.(node);
    },
    [sheet, hold],
  );
  return (
    <Dialog
      open={open}
      size={DIALOG_SIZE.SHEET}
      labelledBy={nameId}
      invoker={opener}
      initialFocus={initialFocus}
      onDismiss={onAway}
      onKeyDown={onKeyDown}
    >
      <div ref={framed} id={id} className="ui-menu-sheet" data-leaving={open ? undefined : "true"}>
        <div className="ui-menu-sheet-head" {...head}>
          <span className="ui-menu-sheet-grip" aria-hidden="true" />
          <div className="ui-menu-sheet-title">
            {back === undefined ? null : (
              <span className="ui-menu-sheet-back">
                <BackButton
                  label={back.label}
                  place={back.label}
                  command={NO_BACK_KEY}
                  onBack={back.onBack}
                />
              </span>
            )}
            {back === undefined && mark !== undefined ? (
              <span className="ui-menu-sheet-mark" aria-hidden="true">
                {mark}
              </span>
            ) : null}
            <span className="ui-menu-sheet-words">
              <span id={nameId} className="ui-menu-sheet-name">
                <OneLine words={name}>
                  <ReplayWords unmasked={replayUnmasked}>{name}</ReplayWords>
                </OneLine>
              </span>
              {detail === undefined ? null : (
                <span className="ui-menu-sheet-detail">
                  <OneLine words={detail}>
                    <ReplayWords unmasked={replayUnmasked}>{detail}</ReplayWords>
                  </OneLine>
                </span>
              )}
            </span>
          </div>
          {field === undefined || field === null ? null : (
            <div className="ui-menu-sheet-field">{field}</div>
          )}
        </div>
        {children}
      </div>
    </Dialog>
  );
}
