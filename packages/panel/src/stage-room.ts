import { createContext, useCallback, useContext, useLayoutEffect, useState } from "react";
import { COARSE_POINTER, coarsePointerNow } from "./coarse-pointer.js";
import { compactStage } from "./desktop/sidebar-collapse.js";
import { narrowStage, SHELL_ROOM, type ShellRoom } from "./shell-room.js";

interface StageLines {
  readonly narrow: boolean;
  readonly compact: boolean;
}

const ROOM_ATTRIBUTE = "data-ui-room";

const UNMEASURED: StageLines = { narrow: false, compact: false };

export const ShellRoomContext = createContext<ShellRoom>(SHELL_ROOM.WIDE);

export function usePhoneRoom(): boolean {
  return useContext(ShellRoomContext) === SHELL_ROOM.NARROW;
}

export interface StageRoom {
  readonly ref: React.RefCallback<HTMLElement>;
  readonly room: ShellRoom;
  readonly compact: boolean;
}

export function useStageRoom(): StageRoom {
  const [lines, setLines] = useState<StageLines>(UNMEASURED);
  const ref = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const measure = () => {
      const { width } = element.getBoundingClientRect();
      if (width <= 0) return;
      const screenSide = Math.min(window.screen.width, window.screen.height);
      const coarse = coarsePointerNow();
      setLines((was) => {
        const narrow = narrowStage({ width, screenSide, coarse }, was.narrow);
        const compact = compactStage(width, was.compact);
        return narrow === was.narrow && compact === was.compact ? was : { narrow, compact };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const pointer = window.matchMedia(COARSE_POINTER);
    pointer.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      pointer.removeEventListener("change", measure);
    };
  }, []);
  const room = lines.narrow ? SHELL_ROOM.NARROW : SHELL_ROOM.WIDE;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute(ROOM_ATTRIBUTE, room);
    return () => root.removeAttribute(ROOM_ATTRIBUTE);
  }, [room]);
  return {
    ref,
    room,
    compact: lines.compact,
  };
}
