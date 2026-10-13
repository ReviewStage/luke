/**
 * call-window-presence.ts -- whether the floating call window stands, and where it opens.
 *
 * The call is drawn in one place at a time. While a Luke window has the
 * keyboard, that window draws it: its call bar on the call's own plan, its
 * call card anywhere else. Once none does (another app in front, Luke
 * minimised or hidden), the floating window draws the same card over
 * whatever is in front, for as long as the call is in progress. Luke's
 * avatar is the exception: it is drawn in the floating window alone, so while
 * it is starting or live that window stands whoever has the keyboard, at the
 * video tile's size. Nothing here calls Electron, so the rule is read and
 * tested as the plain decision it is.
 */

import type { WebContents } from "electron";
import { AVATAR_STATUS, type AvatarStatus } from "#shared/messages/avatar";
import { callInProgress, type VoiceView } from "#shared/messages/voice-view";

/** The card's window, its shadow's room included, and its gap from the screen's corner. */
export const CALL_WINDOW_BOUNDS = { WIDTH: 264, HEIGHT: 92, INSET: 8 } as const;

/** The video tile's window: the 320 by 180 tile, and 8 points of its shadow's room on every side. */
export const CALL_VIDEO_BOUNDS = { WIDTH: 336, HEIGHT: 196 } as const;

export interface CallWindowPoint {
  readonly x: number;
  readonly y: number;
}

/** A display's work area: the screen less the menu bar and the Dock. */
export interface CallWindowArea extends CallWindowPoint {
  readonly width: number;
  readonly height: number;
}

/** What the presence shows, hides, and sizes; the window service's `CallWindow`. */
export interface CallWindowSurface {
  show(): void;
  hide(): void;
  /** The video tile's size while the avatar is up, and the card's otherwise. */
  fitVideo(video: boolean): void;
}

/** The statuses the avatar's tile is drawn in: coming up, and up. */
function videoUp(status: AvatarStatus): boolean {
  return status === AVATAR_STATUS.STARTING || status === AVATAR_STATUS.LIVE;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
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
 * The window's frame for what it draws, from where the card stands: the card
 * itself, or the video tile grown up from the card's bottom-left corner and
 * pulled back onto the work area where growing took it off. The card's place
 * is never moved by the tile, so the card comes back where it was.
 */
export function callWindowFrame(input: {
  card: CallWindowPoint;
  video: boolean;
  workArea: CallWindowArea;
}): CallWindowArea {
  const { card, video, workArea } = input;
  if (!video)
    return { ...card, width: CALL_WINDOW_BOUNDS.WIDTH, height: CALL_WINDOW_BOUNDS.HEIGHT };
  const { WIDTH: width, HEIGHT: height } = CALL_VIDEO_BOUNDS;
  return {
    x: clamp(card.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(
      card.y + CALL_WINDOW_BOUNDS.HEIGHT - height,
      workArea.y,
      workArea.y + workArea.height - height,
    ),
    width,
    height,
  };
}

/**
 * The decision, held over what moves it: the voice view the voice window
 * reports, the avatar's status the call window reports, and which panel, if
 * any, has the keyboard. The surface is told only when an answer changes.
 */
export class CallWindowPresence {
  readonly #surface: CallWindowSurface;
  #view: Pick<VoiceView, "voiceStatus" | "callPlanId"> | undefined;
  #avatar: AvatarStatus = AVATAR_STATUS.OFF;
  #focused: WebContents | undefined;
  #standing = false;
  #video = false;

  constructor(surface: CallWindowSurface) {
    this.#surface = surface;
  }

  voiceChanged(
    view: Pick<VoiceView, "voiceStatus" | "callPlanId"> | undefined,
    avatar: AvatarStatus,
  ): void {
    this.#view = view;
    this.#avatar = avatar;
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
    const calling = view !== undefined && callInProgress(view);
    const video = calling && videoUp(this.#avatar);
    const wanted = calling && (video || this.#focused === undefined);
    // Note that the window is sized while it is hidden where it can be:
    // after a hide and before a show, so neither size is seen in passing.
    if (!wanted) this.#stand(false);
    if (video !== this.#video) {
      this.#video = video;
      this.#surface.fitVideo(video);
    }
    if (wanted) this.#stand(true);
  }

  #stand(wanted: boolean): void {
    if (wanted === this.#standing) return;
    this.#standing = wanted;
    if (wanted) this.#surface.show();
    else this.#surface.hide();
  }
}
