/**
 * hover-pane.ts -- a pane that floats over the work while there is no room to dock it beside: peeked by the pointer, opened by its toggle, and put away by a press outside it, Escape, a choice in it, or the pointer leaving a peek.
 *
 * The plans' sidebar floats this way in a window too narrow to pin it, or
 * folded by the developer (`sidebar-collapse.ts`), as Linear's does. Who
 * holds the float's state, and where its toggle and the edge it peeks from
 * stand, is the caller's; this module is the float's doors, so every pane
 * that floats is put away by the same presses and keys and hands the
 * keyboard back the same way.
 */

import type React from "react";
import { useEffect, useRef } from "react";

/** How a pane stands over the work. */
export const PANE_FLOAT = {
  /** Away, docked beside the work or out of sight. */
  CLOSED: "closed",
  /** Peeked by the pointer, and put away once it leaves the pane. */
  PEEK: "peek",
  /** Opened by its toggle, its chord, or a press in a peek, and put away by a choice in it, Escape, or a press outside. */
  OPEN: "open",
} as const;

export type PaneFloat = (typeof PANE_FLOAT)[keyof typeof PANE_FLOAT];

/** The layers that answer their own Escape before a floating pane is put away. */
const KEY_LAYERS = '[role="menu"], [role="dialog"], [role="alertdialog"]';

/** A pane's float as its owner holds it. */
export interface FloatState {
  readonly state: PaneFloat;
  readonly onState: (next: PaneFloat) => void;
}

/** What the pane's own box answers, and what it hands its owner. */
export interface HoverPane {
  readonly ref: React.RefObject<HTMLElement | null>;
  /** Whether the pane floats over the work, peeked or open. */
  readonly floating: boolean;
  /** A choice made in the pane, which puts a floating pane away once made. */
  readonly chosen: <A extends unknown[]>(go: (...args: A) => void) => (...args: A) => void;
  readonly onPress: () => void;
  readonly onPointerLeave: (event: { readonly relatedTarget: EventTarget | null }) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * The floating pane's doors: a press in a peek opens it, the pointer leaving
 * a peek puts it away, though not for the box `stays` names, where its
 * toggle stands, and Escape puts it away while no menu in it took the key
 * first, wherever the keyboard stands, a peek leaving it in the work under
 * it. Opened from away, it takes the keyboard where `focusAt` says, which
 * Escape gives back. A pane let go while it floats is put away with it.
 */
export function useHoverPane(
  float: FloatState,
  look: {
    /** What takes the keyboard in the pane opened from away. */
    readonly focusAt: (pane: HTMLElement) => HTMLElement | null;
    /** The boxes the pointer may leave a peek for without putting it away. */
    readonly stays: string;
  },
): HoverPane {
  const ref = useRef<HTMLElement | null>(null);
  const handBack = useRef<HTMLElement | null>(null);
  const { state, onState } = float;
  const was = useRef(state);
  const floating = state !== PANE_FLOAT.CLOSED;
  const { focusAt, stays } = look;
  useEffect(() => {
    const from = was.current;
    was.current = state;
    const held = ref.current;
    if (state !== PANE_FLOAT.OPEN || from !== PANE_FLOAT.CLOSED || held === null) return;
    handBack.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusAt(held)?.focus();
  }, [state, focusAt]);
  useEffect(() => () => onState(PANE_FLOAT.CLOSED), [onState]);
  // Note that a floating pane need not hold the keyboard, a peek or one a
  // bare press opened leaving it in the work under it, so Escape is heard at
  // the window before the work's layers hear it. A key aimed into the pane
  // is left to its own handler, and one aimed into a menu or a dialog to
  // that layer, which may have been raised from the pane.
  useEffect(() => {
    if (!floating) return;
    const putAway = (event: KeyboardEvent) => {
      const held = ref.current;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (target !== null && (held?.contains(target) || target.closest(KEY_LAYERS) !== null)) {
        return;
      }
      event.preventDefault();
      onState(PANE_FLOAT.CLOSED);
    };
    window.addEventListener("keydown", putAway, true);
    return () => window.removeEventListener("keydown", putAway, true);
  }, [floating, onState]);
  return {
    ref,
    floating,
    chosen:
      (go) =>
      (...args) => {
        go(...args);
        if (floating) onState(PANE_FLOAT.CLOSED);
      },
    onPress: () => {
      if (state === PANE_FLOAT.PEEK) onState(PANE_FLOAT.OPEN);
    },
    onPointerLeave: (event) => {
      if (state !== PANE_FLOAT.PEEK) return;
      const to = event.relatedTarget;
      if (to instanceof Element && to.closest(stays) !== null) return;
      onState(PANE_FLOAT.CLOSED);
    },
    onKeyDown: (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || !floating) return;
      // Note that the window's layered Escape stands down for a key already taken.
      event.preventDefault();
      onState(PANE_FLOAT.CLOSED);
      handBack.current?.focus();
      handBack.current = null;
    },
  };
}

/**
 * Puts a floating pane away at a press anywhere outside it and its toggle,
 * answering the handler they take the press with. Note that the press is
 * heard at the document as it bubbles, after the pane's own handlers, so
 * one inside it, a menu or a dialog it opened included, since React carries
 * their presses through the pane, is marked before the document asks.
 */
export function useFloatDismiss(float: FloatState): () => void {
  const within = useRef(false);
  const floating = float.state !== PANE_FLOAT.CLOSED;
  const { onState } = float;
  useEffect(() => {
    if (!floating) return;
    const press = () => {
      if (!within.current) onState(PANE_FLOAT.CLOSED);
      within.current = false;
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, [floating, onState]);
  return () => {
    within.current = true;
  };
}
