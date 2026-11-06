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

export const REMOTE_POINTER_ACTION = {
  DOWN: "down",
  UP: "up",
  MOVE: "move",
} as const;

export type RemotePointerAction =
  (typeof REMOTE_POINTER_ACTION)[keyof typeof REMOTE_POINTER_ACTION];

export const REMOTE_KEY_ACTION = {
  DOWN: "down",
  UP: "up",
} as const;

export type RemoteKeyAction = (typeof REMOTE_KEY_ACTION)[keyof typeof REMOTE_KEY_ACTION];

const WHEEL_LINE_PIXELS = 16;

export interface RemoteModifiers {
  readonly alt: boolean;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

export interface RemotePoint {
  readonly x: number;
  readonly y: number;
}

export interface RemotePointer extends RemotePoint {
  readonly action: RemotePointerAction;
  readonly button: number | undefined;
  readonly buttons: number;
  readonly clickCount: number;
  readonly modifiers: RemoteModifiers;
}

export interface RemoteWheel extends RemotePoint {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly modifiers: RemoteModifiers;
}

export interface RemoteKey {
  readonly action: RemoteKeyAction;
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly modifiers: RemoteModifiers;
}

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
  label: string;
  width: number;
  height: number;
  driving: boolean;
  ref?: Ref<HTMLCanvasElement> | undefined;
  onPointer: (input: RemotePointer) => void;
  onWheel: (input: RemoteWheel) => void;
  onKey: (input: RemoteKey) => boolean;
  onPaste: (text: string) => void;
}): React.JSX.Element {
  const own = useRef<HTMLCanvasElement | null>(null);
  const held = useCallback(
    (element: HTMLCanvasElement | null) => {
      own.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref !== null && ref !== undefined) ref.current = element;
    },
    [ref],
  );
  const ratio = window.devicePixelRatio || 1;
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
    if (!taken) return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <canvas
      ref={held}
      className="ui-remote-surface"
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
