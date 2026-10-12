/**
 * call-window-presence.ts -- whether the floating call window stands, and where it opens.
 *
 * The pill is the call's controls for whenever the call's own plan is not in
 * front of the developer: on another plan, in Settings, in another app. So it
 * stands while a call is in progress, except while a focused panel shows that
 * plan, where the call bar already is. Nothing here calls Electron, so the
 * rule is read and tested as the plain decision it is.
 */

import type { WebContents } from "electron";
import { callInProgress, type VoiceView } from "#shared/messages/voice-view";

/** The pill's window, its shadow's room included, and its gap from the screen's corner. */
export const CALL_WINDOW_BOUNDS = { WIDTH: 420, HEIGHT: 68, INSET: 8 } as const;

export interface CallWindowPoint {
  readonly x: number;
  readonly y: number;
}

/** A display's work area: the screen less the menu bar and the Dock. */
export interface CallWindowArea extends CallWindowPoint {
  readonly width: number;
  readonly height: number;
}

/** What the presence shows and hides; the window service's `CallWindow`. */
export interface CallWindowSurface {
  show(): void;
  hide(): void;
}

function holds(area: CallWindowArea, point: CallWindowPoint): boolean {
  return (
    point.x >= area.x &&
    point.y >= area.y &&
    point.x + CALL_WINDOW_BOUNDS.WIDTH <= area.x + area.width &&
    point.y + CALL_WINDOW_BOUNDS.HEIGHT <= area.y + area.height
  );
}

/**
 * Where the window opens: where the developer last left it, while that place
 * is still wholly on some display, and otherwise the top-right corner of the
 * main display, where a call's own window sits in every app that has one. A
 * display unplugged since is how a remembered place stops being on screen.
 */
export function callWindowPosition(input: {
  saved: CallWindowPoint | undefined;
  workAreas: readonly CallWindowArea[];
  primary: CallWindowArea;
}): CallWindowPoint {
  const { saved, workAreas, primary } = input;
  if (saved !== undefined && workAreas.some((area) => holds(area, saved))) return saved;
  return {
    x: primary.x + primary.width - CALL_WINDOW_BOUNDS.WIDTH - CALL_WINDOW_BOUNDS.INSET,
    y: primary.y + CALL_WINDOW_BOUNDS.INSET,
  };
}

/**
 * The decision, held over what moves it: the voice view the voice window
 * reports, which panel has the keyboard, and the plan each panel says it has
 * on screen, each panel known by its renderer. The surface is told only when
 * the answer changes.
 */
export class CallWindowPresence {
  readonly #surface: CallWindowSurface;
  #view: Pick<VoiceView, "voiceStatus" | "callPlanId"> | undefined;
  #focused: WebContents | undefined;
  readonly #shown = new WeakMap<WebContents, string | undefined>();
  #standing = false;

  constructor(surface: CallWindowSurface) {
    this.#surface = surface;
  }

  voiceChanged(view: Pick<VoiceView, "voiceStatus" | "callPlanId"> | undefined): void {
    this.#view = view;
    this.#decide();
  }

  panelFocused(panel: WebContents): void {
    this.#focused = panel;
    this.#decide();
  }

  panelBlurred(panel: WebContents): void {
    if (this.#focused === panel) this.#focused = undefined;
    this.#decide();
  }

  planShown(panel: WebContents, planId: string | undefined): void {
    this.#shown.set(panel, planId);
    this.#decide();
  }

  #decide(): void {
    const view = this.#view;
    const inFront =
      this.#focused !== undefined &&
      view?.callPlanId !== undefined &&
      this.#shown.get(this.#focused) === view.callPlanId;
    const wanted = view !== undefined && callInProgress(view) && !inFront;
    if (wanted === this.#standing) return;
    this.#standing = wanted;
    if (wanted) this.#surface.show();
    else this.#surface.hide();
  }
}
