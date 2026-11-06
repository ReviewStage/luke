import type { KeyboardEventHandler, ReactNode } from "react";
import { PRESS_PULSE, pulsePress } from "../../press-pulse.js";
import { useTouchHold } from "../menu/touch-hold.js";

export function HoldPress({
  onHold,
  onContextMenu,
  onKeyDown,
  mouse = false,
  disabled = false,
  children,
}: {
  onHold: () => void;
  onContextMenu?: (() => void) | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLElement> | undefined;
  mouse?: boolean | undefined;
  disabled?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const hold = useTouchHold();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it lays nothing out and hears the presses of the control it wraps, which is the keyboard's; the right-click's list is the control's context menu.
    <span
      className="ui-hold-press"
      data-long-press=""
      onPointerDown={(event) => {
        if (disabled) return;
        const control = event.currentTarget.firstElementChild;
        const held = () => {
          if (control instanceof HTMLElement) pulsePress(control, PRESS_PULSE.FACE);
          onHold();
        };
        hold.start(event, held, { mouse });
      }}
      onTouchEnd={hold.touchEnd}
      onKeyDown={onKeyDown}
      onClickCapture={(event) => {
        if (!hold.held.current) return;
        hold.held.current = false;
        const target = event.target;
        if (target instanceof Node && event.currentTarget.contains(target)) event.stopPropagation();
      }}
      onContextMenu={
        onContextMenu === undefined
          ? undefined
          : (event) => {
              const target = event.target;
              if (!(target instanceof Node && event.currentTarget.contains(target))) return;
              event.preventDefault();
              if (hold.counting()) hold.claim();
              onContextMenu();
            }
      }
    >
      {children}
    </span>
  );
}
