import { useLayoutEffect, useRef, useState } from "react";
import { tokenTiming } from "./motion-timing.js";

/**
 * picture-expand.ts -- a picture opened from its tile grows from the tile's own rect into the viewer, and shrinks back into it as the viewer closes.
 *
 * A tile notes the picture it was pressed on (`notePictureOrigin`) for as
 * long as the frame the press landed in, and the viewer that opens in that
 * frame takes it (`usePictureExpand`), handing what it answers to its
 * dialog (`Dialog`'s `expand`). As the card first stands it is moved and
 * scaled, by transform alone, so the picture it holds lies over the tile,
 * and clipped to that picture at the tile's corners; it then springs to
 * where it stands while the clip opens onto the whole card, header and all.
 * The tile's own picture stands hidden meanwhile, so one picture is seen to
 * travel rather than two. Put away, it plays back into the tile before it
 * is taken out, and the dimmed window fades on the same beat.
 *
 * Where there is nothing to grow from or go back to, it stands down and the
 * dialog opens and closes as it does for everything else: under reduced
 * motion or a capture run, which zero the duration it reads; a viewer not
 * opened from a tile; a tile that has unmounted or scrolled out of sight by
 * the close; and a viewer walked on to another picture than the one opened.
 */

/** The duration and easing a flight plays on, those of a dialog rising into place. */
const FLIGHT_DURATION = "--luke-duration-fast";
const FLIGHT_EASING = "--luke-spring-fast";

/** The picture inside the card that lands over the tile: the viewer's zoomed picture. */
const PICTURE_SELECTOR = ".luke-zoom-image";

/**
 * How far past the card its clip ends, so the shadow it casts is drawn whole
 * as it lands. Note that this is a measure the clip is opened to rather than
 * a size anything is drawn at, so no token stands for it.
 */
const SHADOW_ROOM_PX = 96;

/** What the card wears while it flies, which stands its own entrance down (`dialog.tsx`). */
const EXPANDING_ATTRIBUTE = "data-expanding";

/** The picture a tile was pressed on, until the frame the press landed in has passed. */
let pressed: HTMLElement | undefined;

/** A rect of the window as an element stands in it. */
interface Box {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** A pixel length's number, none where it is none. */
function pixels(value: string): number {
  const length = Number.parseFloat(value);
  return Number.isFinite(length) ? length : 0;
}

/** Whether any of `box` is drawn inside `room`. */
function overlaps(box: Box, room: Pick<Box, "top" | "right" | "bottom" | "left">): boolean {
  return (
    box.bottom > room.top && box.top < room.bottom && box.right > room.left && box.left < room.right
  );
}

/**
 * Whether `face` is still drawn where it can be seen: in the window, with
 * size, and not scrolled out of any box around it that clips what stands
 * past its edges.
 */
function inSight(face: HTMLElement): boolean {
  const box = face.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const view = { top: 0, left: 0, right: innerWidth, bottom: innerHeight };
  if (!overlaps(box, view)) return false;
  for (let around = face.parentElement; around !== null; around = around.parentElement) {
    if (getComputedStyle(around).overflow === "visible") continue;
    if (!overlaps(box, around.getBoundingClientRect())) return false;
  }
  return true;
}

/** The pose a card flies between: where it lies over the tile, and where it stands. */
interface Flight {
  readonly tile: Keyframe;
  readonly landed: Keyframe;
}

/**
 * The flight between `face`, the tile's picture, and `card` as it stands:
 * the card moved and scaled from its top-left corner so the picture it
 * holds lies over the tile's, and clipped to what of that picture it
 * shows, rounded as the tile is. None where either has no size yet.
 */
function flightOf(face: HTMLElement, card: HTMLElement): Flight | undefined {
  const picture = card.querySelector(PICTURE_SELECTOR);
  if (picture === null) return undefined;
  const tile = face.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const shown = picture.getBoundingClientRect();
  if (tile.width <= 0 || tile.height <= 0 || shown.width <= 0 || shown.height <= 0) {
    return undefined;
  }
  const scaleX = tile.width / shown.width;
  const scaleY = tile.height / shown.height;
  const x = tile.left - box.left - (shown.left - box.left) * scaleX;
  const y = tile.top - box.top - (shown.top - box.top) * scaleY;
  // Note that the clip is the card's own measure, before its scale, so the
  // tile's corner is drawn at its own size once the card is scaled down.
  const top = Math.max(shown.top, box.top) - box.top;
  const right = box.right - Math.min(shown.right, box.right);
  const bottom = box.bottom - Math.min(shown.bottom, box.bottom);
  const left = Math.max(shown.left, box.left) - box.left;
  const corner = pixels(getComputedStyle(face).borderTopLeftRadius);
  const room = -SHADOW_ROOM_PX;
  return {
    tile: {
      transformOrigin: "0 0",
      transform: `translate(${String(x)}px, ${String(y)}px) scale(${String(scaleX)}, ${String(scaleY)})`,
      clipPath: `inset(${String(top)}px ${String(right)}px ${String(bottom)}px ${String(left)}px round ${String(corner / scaleX)}px / ${String(corner / scaleY)}px)`,
    },
    landed: {
      transformOrigin: "0 0",
      transform: "none",
      clipPath: `inset(${String(room)}px ${String(room)}px ${String(room)}px ${String(room)}px round 0px)`,
    },
  };
}

/**
 * Notes `face`, the picture a tile was pressed on, as what the viewer the
 * press opens grows from. It is forgotten once the frame has passed, so a
 * press that opened nothing leaves nothing for a later viewer to take.
 */
export function notePictureOrigin(face: HTMLElement): void {
  pressed = face;
  requestAnimationFrame(() => {
    if (pressed === face) pressed = undefined;
  });
}

/** What a viewer hands its dialog to grow from a tile and go back into it. */
export interface PictureExpand {
  /** Plays the growth onto the card as it first stands, once; the dialog calls it. */
  readonly grow: (card: HTMLElement) => void;
  /** Puts the viewer away: back into its tile, then `done`, or `done` at once where it cannot go back. */
  readonly close: (done: () => void) => void;
}

/**
 * The flight of a viewer opened from a tile, taken as it first draws.
 * `onOpened` says whether it still shows the picture it was opened on,
 * which alone goes back into the tile.
 */
export function usePictureExpand(onOpened: boolean): PictureExpand {
  const [face] = useState(() => pressed);
  const card = useRef<HTMLElement | null>(null);
  const grown = useRef(false);
  const closing = useRef(false);
  // Stops a wait for the viewer's picture to load, the card shown as every card is.
  const stopWaiting = useRef<(() => void) | undefined>(undefined);

  // The tile's picture stands hidden while its own is shown over it, and
  // comes back as soon as the viewer shows another or is gone. Note that a
  // wait for the picture opened on ends as the viewer walks off it, because
  // the picture it waits on is taken out and never loads.
  useLayoutEffect(() => {
    if (!onOpened) stopWaiting.current?.();
    if (face !== undefined && grown.current) face.style.visibility = onOpened ? "hidden" : "";
  }, [face, onOpened]);
  useLayoutEffect(
    () => () => {
      if (face !== undefined && grown.current) face.style.visibility = "";
    },
    [face],
  );

  // Flies the card from the tile, or lets its own entrance play where the
  // picture cannot be measured, which taking the attribute off replays.
  const fly = (standing: HTMLElement, tile: HTMLElement, timing: KeyframeAnimationOptions) => {
    const flight = tile.isConnected ? flightOf(tile, standing) : undefined;
    if (flight === undefined) {
      standing.removeAttribute(EXPANDING_ATTRIBUTE);
      return;
    }
    grown.current = true;
    if (onOpened) tile.style.visibility = "hidden";
    standing.animate([flight.tile, flight.landed], timing);
  };

  const grow = (standing: HTMLElement) => {
    if (card.current !== null || face === undefined || !face.isConnected) return;
    card.current = standing;
    const timing = tokenTiming(standing, FLIGHT_DURATION, FLIGHT_EASING);
    if (timing === undefined) return;
    // Note that the attribute goes on before the card is measured, so the
    // measure is of the card as it stands rather than mid-entrance.
    standing.setAttribute(EXPANDING_ATTRIBUTE, "true");
    const picture = standing.querySelector(PICTURE_SELECTOR);
    if (!(picture instanceof HTMLImageElement) || picture.complete) {
      fly(standing, face, timing);
      return;
    }
    // Note that a picture the viewer has yet to decode has no size to fly
    // to, so the card stands unseen until it has one, then flies; one that
    // fails to load opens as every card does.
    const waiting = standing.animate([{ opacity: 0 }, { opacity: 0 }], { fill: "forwards" });
    const stop = () => {
      stopWaiting.current = undefined;
      picture.removeEventListener("load", settle);
      picture.removeEventListener("error", settle);
      waiting.cancel();
    };
    const settle = (event: Event) => {
      stop();
      if (event.type === "load" && !closing.current) fly(standing, face, timing);
      else standing.removeAttribute(EXPANDING_ATTRIBUTE);
    };
    stopWaiting.current = () => {
      stop();
      standing.removeAttribute(EXPANDING_ATTRIBUTE);
    };
    picture.addEventListener("load", settle);
    picture.addEventListener("error", settle);
  };

  const close = (done: () => void) => {
    if (closing.current) return;
    const standing = card.current;
    // Note that the tile is asked about as the close lands, because it may
    // have unmounted or scrolled away while the picture stood over it.
    const tile = grown.current && onOpened && face?.isConnected && inSight(face) ? face : undefined;
    const timing =
      standing === null ? undefined : tokenTiming(standing, FLIGHT_DURATION, FLIGHT_EASING);
    const flight =
      tile === undefined || standing === null || timing === undefined
        ? undefined
        : flightOf(tile, standing);
    if (tile === undefined || standing === null || timing === undefined || flight === undefined) {
      done();
      return;
    }
    closing.current = true;
    const back = { ...timing, fill: "forwards" } as const;
    standing.parentElement?.animate([{ opacity: 1 }, { opacity: 0 }], back);
    const flying = standing.animate([flight.landed, flight.tile], back);
    flying.onfinish = () => {
      tile.style.visibility = "";
      done();
    };
  };

  return { grow, close };
}
