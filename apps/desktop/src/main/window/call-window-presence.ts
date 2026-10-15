/**
 * call-window-presence.ts -- whether the floating call window stands, and where it opens.
 *
 * The call is drawn in one place at a time. While a Luke window has the
 * keyboard, that window draws it: its call bar on the call's own plan, its
 * call card anywhere else. Once none does (another app in front, Luke
 * minimised or hidden), the floating window draws the same card over
 * whatever is in front, for as long as the call is in progress. On a video
 * call the window grows upward by the avatar's tile while the avatar stands,
 * as a picture-in-picture window does, and shrinks back once it is down.
 * Nothing here calls Electron, so the rule is read and tested as the plain
 * decision it is.
 */

import { type AvatarState, avatarStanding } from "@luke/voice/avatar";
import { callInProgress, type VoiceView } from "@luke/voice/voice-view";
import type { WebContents } from "electron";

/**
 * The card's window, its shadow's room included, and its gap from the
 * screen's corner, and the room the avatar's tile and the gap under it add
 * above the card while the avatar stands: `call.css`'s window tile, 125px
 * at the card's 222px inside, at 16:9, and the card's 4px gap.
 */
export const CALL_WINDOW_BOUNDS = { WIDTH: 264, HEIGHT: 92, INSET: 8, VIDEO: 129 } as const;

export interface CallWindowPoint {
  readonly x: number;
  readonly y: number;
}

/** A display's work area: the screen less the menu bar and the Dock. */
export interface CallWindowArea extends CallWindowPoint {
  readonly width: number;
  readonly height: number;
}

/** What the presence shows, hides, and fits; the window service's `CallWindow`. */
export interface CallWindowSurface {
  show(): void;
  hide(): void;
  /** Grows the window by the avatar's tile, or shrinks it back to the card alone. */
  fitVideo(video: boolean): void;
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
 * The window's frame for a card kept at `card`: the card alone, or grown
 * upward by the avatar's tile so the card's controls stay where they were.
 * A card near the top of its display grows downward instead, as far as
 * keeps the whole window on that display. `card` is the top-left of the
 * card alone, which is what is kept between launches.
 */
export function callWindowFrame(input: {
  card: CallWindowPoint;
  video: boolean;
  workAreas: readonly CallWindowArea[];
}): CallWindowArea {
  const { card, video, workAreas } = input;
  const height = CALL_WINDOW_BOUNDS.HEIGHT + (video ? CALL_WINDOW_BOUNDS.VIDEO : 0);
  const grown = { x: card.x, y: card.y + CALL_WINDOW_BOUNDS.HEIGHT - height };
  const area = workAreas.find((each) => holds(each, card));
  const y =
    area === undefined
      ? grown.y
      : Math.min(Math.max(grown.y, area.y), area.y + area.height - height);
  return { x: grown.x, y, width: CALL_WINDOW_BOUNDS.WIDTH, height };
}

/** The top-left of the card alone in a window's frame, whose bottom the card's controls keep to. */
export function callWindowCard(frame: CallWindowArea): CallWindowPoint {
  return { x: frame.x, y: frame.y + frame.height - CALL_WINDOW_BOUNDS.HEIGHT };
}

/**
 * Where the card is kept, apart from the frame the window stands in: set
 * where the window opens, and moved by the developer's own drags alone. A
 * frame this side set, a grown one pushed down from the top of its display
 * included, is never read back as the card's place, so the card returns to
 * where it was once the tile is down.
 */
export class CallWindowPlace {
  #card: CallWindowPoint;
  #framed: CallWindowArea | undefined;

  constructor(card: CallWindowPoint) {
    this.#card = card;
  }

  /** The frame for the card kept, with or without the tile, remembered as this side's own. */
  frame(video: boolean, workAreas: readonly CallWindowArea[]): CallWindowArea {
    const framed = callWindowFrame({ card: this.#card, video, workAreas });
    this.#framed = framed;
    return framed;
  }

  /** The window moved to `frame`: the card's new place to keep, or nothing where the move was this side's own. */
  moved(frame: CallWindowArea): CallWindowPoint | undefined {
    const own = this.#framed;
    if (
      own !== undefined &&
      own.x === frame.x &&
      own.y === frame.y &&
      own.height === frame.height
    ) {
      return undefined;
    }
    this.#framed = undefined;
    this.#card = callWindowCard(frame);
    return this.#card;
  }
}

/**
 * The decision, held over what moves it: the voice view the voice window
 * reports, the avatar the document holds, and which panel, if any, has the
 * keyboard. The surface is told only when an answer changes, and is fitted
 * before it is shown, so it never shows at the size it is about to leave.
 */
export class CallWindowPresence {
  readonly #surface: CallWindowSurface;
  #view: Pick<VoiceView, "voiceStatus" | "callTaskId"> | undefined;
  #avatar: AvatarState | undefined;
  #focused: WebContents | undefined;
  #standing = false;
  #video = false;

  constructor(surface: CallWindowSurface) {
    this.#surface = surface;
  }

  voiceChanged(voice: {
    view?: Pick<VoiceView, "voiceStatus" | "callTaskId"> | undefined;
    avatar: AvatarState;
  }): void {
    this.#view = voice.view;
    this.#avatar = voice.avatar;
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
    const video = calling && this.#avatar !== undefined && avatarStanding(this.#avatar);
    if (video !== this.#video) {
      this.#video = video;
      this.#surface.fitVideo(video);
    }
    const wanted = calling && this.#focused === undefined;
    if (wanted === this.#standing) return;
    this.#standing = wanted;
    if (wanted) this.#surface.show();
    else this.#surface.hide();
  }
}
