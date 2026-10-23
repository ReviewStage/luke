import {
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  type WheelEvent,
} from "react";

/**
 * remote-surface.tsx -- a canvas a page running elsewhere is drawn on, whose mouse, wheel, keys, and paste go to that page while the member drives it.
 *
 * It is no control: it is the page's own surface, so what the member does
 * over it is handed on as it happened rather than taken as a press. Its
 * owner paints the frames on the canvas (`ref`) and sends what it is handed;
 * the surface owns the forwarding: each point measured in CSS pixels from
 * its own corner and held inside it, a wheel counted in pixels, the keyboard
 * taken onto it by a press, and while it is driven, the system's menu and
 * the panel's scroll held back from it, since the wheel and the right
 * button are the page's. A key goes on only where the owner takes it
 * (`onKey` answers whether it did), so a chord the window answers stays the
 * window's. While it is not driven it hands nothing on and takes no focus.
 */

/** What a mouse did over the surface. */
export const REMOTE_POINTER_ACTION = {
  DOWN: "down",
  UP: "up",
  MOVE: "move",
} as const;

export type RemotePointerAction =
  (typeof REMOTE_POINTER_ACTION)[keyof typeof REMOTE_POINTER_ACTION];

/** What a key did on the surface. */
export const REMOTE_KEY_ACTION = {
  DOWN: "down",
  UP: "up",
} as const;

export type RemoteKeyAction = (typeof REMOTE_KEY_ACTION)[keyof typeof REMOTE_KEY_ACTION];

/** A wheel's line, in pixels, for a wheel that counts in lines. */
const WHEEL_LINE_PIXELS = 16;

/** The modifier keys held through an input. */
export interface RemoteModifiers {
  readonly alt: boolean;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

/** A point on the surface, in CSS pixels from its top left corner, inside it. */
export interface RemotePoint {
  readonly x: number;
  readonly y: number;
}

/** A mouse's input over the surface. */
export interface RemotePointer extends RemotePoint {
  readonly action: RemotePointerAction;
  /** The button pressed or let go, by the DOM's count (0 the main one); none for a move. */
  readonly button: number | undefined;
  /** The buttons held, as the DOM's bits count them. */
  readonly buttons: number;
  /** Which click of a run this is, up to three; none for a move. */
  readonly clickCount: number;
  readonly modifiers: RemoteModifiers;
}

/** A wheel's input over the surface, in pixels. */
export interface RemoteWheel extends RemotePoint {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly modifiers: RemoteModifiers;
}

/** A key's input on the surface. */
export interface RemoteKey {
  readonly action: RemoteKeyAction;
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly modifiers: RemoteModifiers;
}

/** The modifier keys `event` holds. */
function modifiersOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): RemoteModifiers {
  return {
    alt: event.altKey,
    control: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

/** The canvas a remote page is drawn on, `width` by `height` CSS pixels, forwarding its input while `driving`. */
export function RemoteSurface({
  label,
  width,
  height,
  driving,
  ref,
  onPointer,
  onWheel,
  onKey,
  onPaste,
}: {
  /** What the surface is, for one who cannot see it. */
  label: string;
  width: number;
  height: number;
  /** Whether the member drives the page, so their input goes to it. */
  driving: boolean;
  /** The canvas, which the owner paints the page's frames on. */
  ref?: Ref<HTMLCanvasElement> | undefined;
  onPointer: (input: RemotePointer) => void;
  onWheel: (input: RemoteWheel) => void;
  /** A key pressed or let go; answers whether the page takes it, which keeps it from the window. */
  onKey: (input: RemoteKey) => boolean;
  /** Words pasted on the surface. */
  onPaste: (text: string) => void;
}): React.JSX.Element {
  const own = useRef<HTMLCanvasElement | null>(null);
  // The canvas is the owner's too, which paints on it.
  const held = useCallback(
    (element: HTMLCanvasElement | null) => {
      own.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref !== null && ref !== undefined) ref.current = element;
    },
    [ref],
  );
  const ratio = window.devicePixelRatio || 1;
  // React's own wheel listener is passive, so the default is refused on one of the canvas's own.
  const drivingNow = useRef(driving);
  drivingNow.current = driving;
  useEffect(() => {
    const element = own.current;
    if (element === null) return;
    const refuse = (event: globalThis.WheelEvent) => {
      if (drivingNow.current) event.preventDefault();
    };
    element.addEventListener("wheel", refuse, { passive: false });
    return () => element.removeEventListener("wheel", refuse);
  }, []);
  const at = (event: MouseEvent | WheelEvent): RemotePoint => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, event.clientX - box.left)),
      y: Math.max(0, Math.min(height, event.clientY - box.top)),
    };
  };
  const mouse = (action: RemotePointerAction) => (event: MouseEvent<HTMLCanvasElement>) => {
    if (!driving) return;
    if (action === REMOTE_POINTER_ACTION.DOWN) event.currentTarget.focus();
    const moved = action === REMOTE_POINTER_ACTION.MOVE;
    onPointer({
      action,
      ...at(event),
      button: moved ? undefined : event.button,
      buttons: event.buttons,
      clickCount: moved ? 0 : Math.min(3, event.detail || 1),
      modifiers: modifiersOf(event),
    });
  };
  const key = (action: RemoteKeyAction) => (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!driving) return;
    const taken = onKey({
      action,
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      modifiers: modifiersOf(event),
    });
    if (taken) event.preventDefault();
  };
  return (
    <canvas
      ref={held}
      className="luke-remote-surface"
      aria-label={label}
      data-driving={driving ? "" : undefined}
      tabIndex={driving ? 0 : -1}
      width={Math.round(width * ratio)}
      height={Math.round(height * ratio)}
      style={{ width, height }}
      onMouseDown={mouse(REMOTE_POINTER_ACTION.DOWN)}
      onMouseUp={mouse(REMOTE_POINTER_ACTION.UP)}
      onMouseMove={mouse(REMOTE_POINTER_ACTION.MOVE)}
      onContextMenu={(event) => {
        if (driving) event.preventDefault();
      }}
      onWheel={(event) => {
        if (!driving) return;
        const scale = event.deltaMode === 0 ? 1 : WHEEL_LINE_PIXELS;
        onWheel({
          ...at(event),
          deltaX: event.deltaX * scale,
          deltaY: event.deltaY * scale,
          modifiers: modifiersOf(event),
        });
      }}
      onKeyDown={key(REMOTE_KEY_ACTION.DOWN)}
      onKeyUp={key(REMOTE_KEY_ACTION.UP)}
      onPaste={(event: ClipboardEvent<HTMLCanvasElement>) => {
        if (!driving) return;
        event.preventDefault();
        onPaste(event.clipboardData.getData("text/plain"));
      }}
    />
  );
}
