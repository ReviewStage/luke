import { useLayoutEffect, useRef, useState } from "react";
import { MOTION_TOKEN, tokenTiming } from "./motion-timing.js";

const FLIGHT_DURATION = MOTION_TOKEN.DURATION_FAST;
const FLIGHT_EASING = MOTION_TOKEN.SPRING_FAST;

const PICTURE_SELECTOR = ".ui-zoom-image";

const SHADOW_ROOM_PX = 96;

const EXPANDING_ATTRIBUTE = "data-expanding";

let pressed: HTMLElement | undefined;

interface Box {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

function pixels(value: string): number {
  const length = Number.parseFloat(value);
  return Number.isFinite(length) ? length : 0;
}

function overlaps(box: Box, room: Pick<Box, "top" | "right" | "bottom" | "left">): boolean {
  return (
    box.bottom > room.top && box.top < room.bottom && box.right > room.left && box.left < room.right
  );
}

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

interface Flight {
  readonly tile: Keyframe;
  readonly landed: Keyframe;
}

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

export function notePictureOrigin(face: HTMLElement): void {
  pressed = face;
  requestAnimationFrame(() => {
    if (pressed === face) pressed = undefined;
  });
}

export interface PictureExpand {
  readonly grow: (card: HTMLElement) => void;
  readonly close: (done: () => void) => void;
}

export function usePictureExpand(onOpened: boolean): PictureExpand {
  const [face] = useState(() => pressed);
  const card = useRef<HTMLElement | null>(null);
  const grown = useRef(false);
  const closing = useRef(false);
  const stopWaiting = useRef<(() => void) | undefined>(undefined);

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
    standing.setAttribute(EXPANDING_ATTRIBUTE, "true");
    const picture = standing.querySelector(PICTURE_SELECTOR);
    if (!(picture instanceof HTMLImageElement) || picture.complete) {
      fly(standing, face, timing);
      return;
    }
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
