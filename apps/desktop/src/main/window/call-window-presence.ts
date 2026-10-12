/**
 * call-window-presence.ts -- whether the floating call window stands, and where it opens.
 *
 * The call is drawn in one place at a time. While a Luke window has the
 * keyboard, that window draws it: its call bar on the call's own plan, its
 * call card anywhere else. Once none does (another app in front, Luke
 * minimised or hidden), the floating window draws the same card over
 * whatever is in front, for as long as the call is in progress. Nothing here
 * calls Electron, so the rule is read and tested as the plain decision it is.
 */

import type { WebContents } from "electron";
import { callInProgress, type VoiceView } from "#shared/messages/voice-view";

/** The card's window, its shadow's room included, and its gap from the screen's corner. */
export const CALL_WINDOW_BOUNDS = { WIDTH: 264, HEIGHT: 92, INSET: 8 } as const;

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
 * is still wholly on some display, and otherwise the bottom-left corner of
 * the main display, where the card sits in Luke's own window. A display
 * unplugged since is how a remembered place stops being on screen.
 */
export function callWindowPosition(input: {
  saved: CallWindowPoint | undefined;
  workAreas: readonly CallWindowArea[];
  primary: CallWindowArea;
}): CallWindowPoint {
  const { saved, workAreas, primary } = input;
  if (saved !== undefined && workAreas.some((area) => holds(area, saved))) return saved;
  return {
    x: primary.x + CALL_WINDOW_BOUNDS.INSET,
    y: primary.y + primary.height - CALL_WINDOW_BOUNDS.HEIGHT - CALL_WINDOW_BOUNDS.INSET,
  };
}

/**
 * The decision, held over what moves it: the voice view the voice window
 * reports, and which panel, if any, has the keyboard. The surface is told
 * only when the answer changes.
 */
export class CallWindowPresence {
  readonly #surface: CallWindowSurface;
  #view: Pick<VoiceView, "voiceStatus" | "callPlanId"> | undefined;
  #focused: WebContents | undefined;
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

  /** A blur arriving late from a panel that has already handed the keyboard to another changes nothing. */
  panelBlurred(panel: WebContents): void {
    if (this.#focused === panel) this.#focused = undefined;
    this.#decide();
  }

  #decide(): void {
    const view = this.#view;
    const wanted = view !== undefined && callInProgress(view) && this.#focused === undefined;
    if (wanted === this.#standing) return;
    this.#standing = wanted;
    if (wanted) this.#surface.show();
    else this.#surface.hide();
  }
}
