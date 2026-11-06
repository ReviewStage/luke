import type React from "react";
import { useCallback, useEffect, useRef } from "react";

export const PANE_FLOAT = {
  CLOSED: "closed",
  PEEK: "peek",
  OPEN: "open",
} as const;

export type PaneFloat = (typeof PANE_FLOAT)[keyof typeof PANE_FLOAT];

const alwaysFloats = () => true;

export const KEY_LAYERS = '[role="menu"], [role="dialog"], [role="alertdialog"]';

export interface FloatState {
  readonly state: PaneFloat;
  readonly onState: (next: PaneFloat) => void;
}

export interface HoverPane {
  readonly ref: React.RefObject<HTMLElement | null>;
  readonly floating: boolean;
  readonly chosen: <A extends unknown[]>(go: (...args: A) => void) => (...args: A) => void;
  readonly close: () => void;
  readonly open: () => void;
  readonly onPointerLeave: (event: { readonly relatedTarget: EventTarget | null }) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export function useHoverPane(
  float: FloatState,
  look: {
    readonly focusAt: (pane: HTMLElement) => HTMLElement | null;
    readonly stays: string;
    readonly ref?: React.RefObject<HTMLElement | null>;
    readonly floatsNow?: (pane: HTMLElement) => boolean;
  },
): HoverPane {
  const own = useRef<HTMLElement | null>(null);
  const ref = look.ref ?? own;
  const handBack = useRef<HTMLElement | null>(null);
  const returning = useRef(false);
  const { state, onState } = float;
  const was = useRef<PaneFloat>(PANE_FLOAT.CLOSED);
  const floating = state !== PANE_FLOAT.CLOSED;
  const { focusAt, stays, floatsNow = alwaysFloats } = look;
  const drawn = useRef(state);
  drawn.current = state;
  const close = useCallback(() => {
    drawn.current = PANE_FLOAT.CLOSED;
    onState(PANE_FLOAT.CLOSED);
  }, [onState]);
  const toggled = useRef(false);
  const open = useCallback(() => {
    toggled.current = true;
    onState(PANE_FLOAT.OPEN);
  }, [onState]);
  useEffect(() => {
    const from = was.current;
    was.current = state;
    const fromToggle = toggled.current;
    toggled.current = false;
    if (state === PANE_FLOAT.CLOSED && returning.current) {
      returning.current = false;
      handBack.current?.focus();
      handBack.current = null;
      return;
    }
    const held = ref.current;
    if (state !== PANE_FLOAT.OPEN || held === null) return;
    if (from !== PANE_FLOAT.CLOSED && !(from === PANE_FLOAT.PEEK && fromToggle)) return;
    handBack.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusAt(held)?.focus();
  }, [state, focusAt, ref]);
  useEffect(() => () => onState(PANE_FLOAT.CLOSED), [onState]);
  useEffect(() => {
    const held = ref.current;
    if (state !== PANE_FLOAT.OPEN || held === null) return;
    let tabbing = false;
    const tab = (event: KeyboardEvent) => {
      tabbing = event.key === "Tab" && !event.defaultPrevented;
    };
    const hold = (event: FocusEvent) => {
      const walked = tabbing;
      tabbing = false;
      const to = event.target;
      if (!walked || drawn.current !== PANE_FLOAT.OPEN || !(to instanceof Element)) return;
      if (held.contains(to) || to.closest(KEY_LAYERS) !== null) return;
      if (floatsNow(held)) focusAt(held)?.focus();
      else close();
    };
    held.addEventListener("keydown", tab);
    document.addEventListener("focusin", hold);
    return () => {
      held.removeEventListener("keydown", tab);
      document.removeEventListener("focusin", hold);
    };
  }, [state, focusAt, floatsNow, close, ref]);
  useEffect(() => {
    if (!floating) return;
    const putAway = (event: KeyboardEvent) => {
      const held = ref.current;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (target !== null && (held?.contains(target) || target.closest(KEY_LAYERS) !== null)) {
        return;
      }
      if (held !== null && !floatsNow(held)) {
        close();
        return;
      }
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", putAway, true);
    return () => window.removeEventListener("keydown", putAway, true);
  }, [floating, floatsNow, close, ref]);
  return {
    ref,
    floating,
    chosen:
      (go) =>
      (...args) => {
        if (floating) close();
        go(...args);
      },
    close,
    open,
    onPointerLeave: (event) => {
      if (state !== PANE_FLOAT.PEEK) return;
      const to = event.relatedTarget;
      if (to instanceof Element && (to.closest(stays) ?? to.closest(KEY_LAYERS)) !== null) return;
      onState(PANE_FLOAT.CLOSED);
    },
    onKeyDown: (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || !floating) return;
      event.preventDefault();
      returning.current = true;
      close();
    },
  };
}

export function useFloatDismiss(float: FloatState): () => void {
  const within = useRef(false);
  const floating = float.state !== PANE_FLOAT.CLOSED;
  const { onState } = float;
  useEffect(() => {
    if (!floating) return;
    within.current = false;
    const press = () => {
      if (!within.current) onState(PANE_FLOAT.CLOSED);
      within.current = false;
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, [floating, onState]);
  return useCallback(() => {
    within.current = true;
  }, []);
}
