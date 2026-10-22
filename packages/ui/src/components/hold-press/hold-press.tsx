import type { ReactNode } from "react";
import { useTouchHold } from "../menu/touch-hold.js";

/**
 * hold-press.tsx -- a press held on the control it wraps does a second act, as a browser's Back held lists the steps behind it.
 *
 * It wraps one control, an `IconButton` whose own press stays its own, and
 * lays nothing out (`display: contents`). A touch held still for the
 * platform's long press (`useTouchHold`), or with `mouse` the mouse's main
 * button held as long, does `onHold`; the release of that press is then no
 * press of the control, while a press in what `onHold` opened, a menu drawn
 * in a portal, is its own. A right-click on the control, where `onContextMenu`
 * is given, does what it asks in place of the system's menu and spends a
 * hold still counting, so a finger's lift after Android's own long-press
 * menu presses nothing either. It marks itself as a long press's
 * (`data-long-press`), so a hint over the control leaves that press to it.
 */

/** A control whose held press, or right-click, does a second act. */
export function HoldPress({
  onHold,
  onContextMenu,
  mouse = false,
  disabled = false,
  children,
}: {
  /** What a press held does: a touch's, or with `mouse` the mouse's main button's too. */
  onHold: () => void;
  /** What a right-click on the control does, in place of the system's menu. */
  onContextMenu?: (() => void) | undefined;
  /** Whether the mouse's main button held counts, as a touch held does. */
  mouse?: boolean | undefined;
  /** Whether a press held counts for nothing, the control being unavailable. */
  disabled?: boolean | undefined;
  /** The one control it wraps. */
  children: ReactNode;
}): React.JSX.Element {
  const hold = useTouchHold();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it lays nothing out and hears the presses of the control it wraps, which is the keyboard's; the right-click's list is the control's context menu.
    <span
      className="luke-hold-press"
      data-long-press=""
      onPointerDown={(event) => {
        if (!disabled) hold.start(event, onHold, { mouse });
      }}
      onTouchEnd={hold.touchEnd}
      onClickCapture={(event) => {
        if (!hold.held.current) return;
        hold.held.current = false;
        // Note that the release of a press that held is no press of the control, while a press in
        // what the hold opened, drawn in a portal whose clicks still pass through here, is its own.
        const target = event.target;
        if (target instanceof Node && event.currentTarget.contains(target)) event.stopPropagation();
      }}
      onContextMenu={
        onContextMenu === undefined
          ? undefined
          : (event) => {
              // Note that a right-click in what the hold opened, drawn in a portal, is its own.
              const target = event.target;
              if (!(target instanceof Node && event.currentTarget.contains(target))) return;
              event.preventDefault();
              // Android's own contextmenu may come before the hold's timer: it spends the hold,
              // so the finger's lift presses nothing as well.
              if (hold.counting()) hold.claim();
              onContextMenu();
            }
      }
    >
      {children}
    </span>
  );
}
