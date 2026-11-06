import { useAtomSet } from "@effect/atom-react";
import { MOTION_DURATION_MS } from "@repo/brand";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MOTION_TOKEN, milliseconds } from "../../motion-timing.js";
import { trappedTab } from "../../trapped-tab.js";
import { PanePin } from "../pane-pin/pane-pin.js";

export const OVER_PANE_EDGE = {
  RIGHT: "right",
  LEFT: "left",
} as const;

export type OverPaneEdge = (typeof OVER_PANE_EDGE)[keyof typeof OVER_PANE_EDGE];

export const OVER_PANE_WIDTH = {
  SHEET: "sheet",
  COLUMN: "column",
  FULL: "full",
} as const;

export type OverPaneWidth = (typeof OVER_PANE_WIDTH)[keyof typeof OVER_PANE_WIDTH];

type OverPaneToggle = RefObject<HTMLElement | null> | readonly RefObject<HTMLElement | null>[];

function onToggle(toggle: OverPaneToggle | undefined, target: Node): boolean {
  if (toggle === undefined) return false;
  const all = "current" in toggle ? [toggle] : toggle;
  return all.some((each) => each.current?.contains(target) === true);
}

const OVER_PANE_STATE = {
  OPEN: "open",
  LEAVING: "leaving",
} as const;

const OVER_PANE_ARRIVAL = {
  PEEK: "peek",
} as const;

const KEY_LAYERS = '[role="menu"], [role="dialog"], [role="alertdialog"]';

const PANE =
  "ui-over-pane absolute inset-y-0 z-1 flex w-over-pane min-w-0 flex-col bg-popover shadow-menu outline-none data-[width=column]:w-over-pane-column data-[width=full]:w-full data-[width=full]:shadow-none data-[edge=left]:left-0 data-[edge=left]:not-data-[width=full]:border-r data-[edge=left]:border-border-strong data-[edge=right]:right-0 data-[edge=right]:not-data-[width=full]:border-l data-[edge=right]:border-border-strong";

function exitDuration(): number {
  const value = getComputedStyle(document.body).getPropertyValue(MOTION_TOKEN.DURATION_PANE);
  return value.trim() === "" ? MOTION_DURATION_MS.PANE : milliseconds(value);
}

function exitWait() {
  return Atom.fn(({ delay, done }: { readonly delay: number; readonly done: () => void }) =>
    Effect.andThen(Effect.sleep(Duration.millis(delay)), Effect.sync(done)),
  );
}

function useLeaving(open: boolean): boolean {
  const atom = useMemo(exitWait, []);
  const wait = useAtomSet(atom);
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  if (shown !== open) {
    setShown(open);
    setLeaving(!open);
  }
  useLayoutEffect(() => {
    if (!leaving) return undefined;
    const delay = exitDuration();
    if (delay <= 1) {
      setLeaving(false);
      return undefined;
    }
    wait({ delay, done: () => setLeaving(false) });
    return () => wait(Atom.Interrupt);
  }, [leaving, wait]);
  return leaving;
}

function heldIn(box: HTMLElement | null): boolean {
  const now = document.activeElement;
  return now === null || now === document.body || (box?.contains(now) ?? false);
}

function useHeldKeyboard(
  open: boolean,
  pane: RefObject<HTMLElement | null>,
  initialFocus: RefObject<HTMLElement | null> | undefined,
): void {
  const before = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const box = pane.current;
    if (open) {
      before.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      (initialFocus?.current ?? box)?.focus({ preventScroll: true });
      return;
    }
    const back = before.current;
    before.current = null;
    if (back?.isConnected === true && heldIn(box)) back.focus({ preventScroll: true });
  }, [open, pane, initialFocus]);
  useEffect(
    () => () => {
      const back = before.current;
      if (back?.isConnected === true && heldIn(null)) back.focus({ preventScroll: true });
    },
    [],
  );
}

function usePressOutside(
  open: boolean,
  toggle: OverPaneToggle | undefined,
  onClose: () => void,
): () => void {
  const within = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  const toggles = useRef(toggle);
  toggles.current = toggle;
  useEffect(() => {
    if (!open) return undefined;
    within.current = false;
    const press = (event: PointerEvent) => {
      const own = within.current;
      within.current = false;
      const target = event.target;
      if (own || (target instanceof Node && onToggle(toggles.current, target))) return;
      close.current();
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, [open]);
  return useCallback(() => {
    within.current = true;
  }, []);
}

function useEscapedPeek(peeking: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!peeking) return undefined;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`${KEY_LAYERS}, .ui-over-pane`) != null) return;
      event.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [peeking]);
}

export function OverPane({
  open,
  onClose,
  label,
  edge = OVER_PANE_EDGE.RIGHT,
  width = OVER_PANE_WIDTH.SHEET,
  toggle,
  initialFocus,
  peek = false,
  onPointerLeave,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  edge?: OverPaneEdge | undefined;
  width?: OverPaneWidth | undefined;
  toggle?: OverPaneToggle | undefined;
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  peek?: boolean | undefined;
  onPointerLeave?: ((event: React.PointerEvent<HTMLElement>) => void) | undefined;
  children: ReactNode;
}): React.JSX.Element | null {
  const pane = useRef<HTMLElement>(null);
  const leaving = useLeaving(open);
  useHeldKeyboard(open && !peek, pane, initialFocus);
  const pin = usePressOutside(open, toggle, onClose);
  useEscapedPeek(open && peek, onClose);
  if (!open && !leaving) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") {
      if (!peek) trappedTab(event);
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.target instanceof Element && event.target.closest(KEY_LAYERS) !== null) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <PanePin
      ref={pane}
      className={PANE}
      aria-label={label}
      tabIndex={-1}
      data-edge={edge}
      data-width={width}
      data-state={open ? OVER_PANE_STATE.OPEN : OVER_PANE_STATE.LEAVING}
      data-arrival={open && peek ? OVER_PANE_ARRIVAL.PEEK : undefined}
      inert={!open}
      onPin={open ? pin : undefined}
      onKeyDown={open ? onKeyDown : undefined}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </PanePin>
  );
}
