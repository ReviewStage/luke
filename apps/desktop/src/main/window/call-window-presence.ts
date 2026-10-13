/**
 * call-window-presence.ts -- whether the floating call window stands, in which shape, and where it opens.
 *
 * The call is drawn in one place at a time. While a Luke window has the
 * keyboard, that window draws it: its call bar on the call's own plan, its
 * call card anywhere else. Once none does (another app in front, Luke
 * minimised or hidden), the floating window draws the same card over
 * whatever is in front, for as long as the call is in progress. The one
 * exception is Luke's face: no Luke window draws it, so while it is starting
 * or live the floating window stands for the whole call, grown into the
 * video tile. Nothing here calls Electron, so the rule is read and tested as
 * the plain decision it is.
 */

import type { WebContents } from "electron";
import { AVATAR_STATUS, type AvatarState } from "#shared/messages/avatar";
import { callInProgress, type VoiceView } from "#shared/messages/voice-view";

/** The card's window, its shadow's room included, and its gap from the screen's corner. */
export const CALL_WINDOW_BOUNDS = { WIDTH: 264, HEIGHT: 92, INSET: 8 } as const;

/** What the floating window draws: the call card, or the video tile while the call has a face. */
export const CALL_WINDOW_SHAPE = { CARD: "card", TILE: "tile" } as const;

export type CallWindowShape = (typeof CALL_WINDOW_SHAPE)[keyof typeof CALL_WINDOW_SHAPE];

/**
 * Each shape's window, its shadow's room included. The tile is 320 by 180,
 * 16:9, and the window is 16 wider and taller for the room the card's own
 * shadow stands in (`call.css`).
 */
export const CALL_WINDOW_SIZE = {
  [CALL_WINDOW_SHAPE.CARD]: { WIDTH: CALL_WINDOW_BOUNDS.WIDTH, HEIGHT: CALL_WINDOW_BOUNDS.HEIGHT },
  [CALL_WINDOW_SHAPE.TILE]: { WIDTH: 336, HEIGHT: 196 },
} as const;

/** The face statuses the floating window stands through whoever has the keyboard. */
const FACE_SHOWN: ReadonlySet<AvatarState["status"]> = new Set([
  AVATAR_STATUS.STARTING,
  AVATAR_STATUS.LIVE,
]);

export interface CallWindowPoint {
  readonly x: number;
  readonly y: number;
}

/** A display's work area: the screen less the menu bar and the Dock. */
export interface CallWindowArea extends CallWindowPoint {
  readonly width: number;
  readonly height: number;
}

/** What the presence shows, reshapes, and hides; the window service's `CallWindow`. */
export interface CallWindowSurface {
  show(shape: CallWindowShape): void;
  hide(): void;
}

/** A window's place and size on screen. */
export type CallWindowRect = CallWindowArea;

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
 * The window's bounds in a new shape: grown or shrunk about its bottom-left
 * corner, which is where the card opens, so the tile rises out of the card
 * rather than over the Dock, and moved back wholly onto the display it stands
 * on where growing would take it past an edge.
 */
export function callWindowReshaped(input: {
  bounds: CallWindowRect;
  shape: CallWindowShape;
  workArea: CallWindowArea;
}): CallWindowRect {
  const { bounds, shape, workArea } = input;
  const { WIDTH: width, HEIGHT: height } = CALL_WINDOW_SIZE[shape];
  const within = (start: number, size: number, areaStart: number, areaSize: number) =>
    Math.max(areaStart, Math.min(start, areaStart + areaSize - size));
  return {
    x: within(bounds.x, width, workArea.x, workArea.width),
    y: within(bounds.y + bounds.height - height, height, workArea.y, workArea.height),
    width,
    height,
  };
}

/**
 * The decision, held over what moves it: the voice view the voice window
 * reports, the face main holds, and which panel, if any, has the keyboard.
 * The surface is told only when the answer changes. Note that any face but
 * none draws the tile, an ended one included, because the tile is where the
 * video is restarted; only a starting or live one holds the window up while
 * a panel has the keyboard.
 */
export class CallWindowPresence {
  readonly #surface: CallWindowSurface;
  #view: Pick<VoiceView, "voiceStatus" | "callPlanId"> | undefined;
  #avatar: AvatarState["status"] = AVATAR_STATUS.OFF;
  #focused: WebContents | undefined;
  #standing: CallWindowShape | undefined;

  constructor(surface: CallWindowSurface) {
    this.#surface = surface;
  }

  voiceChanged(
    view: Pick<VoiceView, "voiceStatus" | "callPlanId"> | undefined,
    avatar: Pick<AvatarState, "status">,
  ): void {
    this.#view = view;
    this.#avatar = avatar.status;
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
    const call = view !== undefined && callInProgress(view);
    const wanted = call && (this.#focused === undefined || FACE_SHOWN.has(this.#avatar));
    const shape =
      this.#avatar === AVATAR_STATUS.OFF ? CALL_WINDOW_SHAPE.CARD : CALL_WINDOW_SHAPE.TILE;
    const answer = wanted ? shape : undefined;
    if (answer === this.#standing) return;
    this.#standing = answer;
    if (answer === undefined) this.#surface.hide();
    else this.#surface.show(answer);
  }
}
