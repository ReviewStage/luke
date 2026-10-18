import {
  type ComponentType,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { CloseIcon } from "../../face/glyphs.js";
import { IconButton } from "../button/button.js";

/**
 * popover-panel.tsx -- the panel a button opens inside its `AnchoredPopover`: a small dialog named by its title, holding the keyboard while it stands and closing once focus leaves it.
 *
 * Every hung panel stands the same way. It is a dialog, named by its title,
 * which a card draws at its head beside an optional × and a menu holds
 * unseen, since a menu's search field is its head. It takes the focus as it
 * opens, onto the control its owner names or else onto itself, so its keys
 * and focus leaving it are heard. Escape is the panel's, never the window's:
 * it stops there, so the surface behind stays open, and is handed to the
 * owner, who decides what it costs (closing, or going back a page), never
 * while an input method composes. Focus moving anywhere outside the panel
 * is handed to the owner too, who closes unless that is still its own, the
 * button that opened it among them. A card's height is bounded by the room
 * its side of the button leaves (`--luke-popover-room`), and it scrolls
 * within; a menu scrolls its own list.
 */

/** How the panel is drawn: a card with its head, or a menu's surface whose content is edge to edge. */
export const POPOVER_PANEL_LOOK = {
  CARD: "card",
  MENU: "menu",
} as const;

export type PopoverPanelLook = (typeof POPOVER_PANEL_LOOK)[keyof typeof POPOVER_PANEL_LOOK];

/** What a hint hands the × it wraps: when to show and go, and what it says of the button. */
interface PopoverPanelHintProps {
  "aria-describedby"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/** The hint an app hangs from the panel's ×: its pill, naming the button. */
export type PopoverPanelHint = ComponentType<{
  label: string;
  children: ReactElement<PopoverPanelHintProps>;
}>;

/** The ×, under the app's hint where it hangs one. */
function CloseButton({
  label,
  hint: Hint,
  onPress,
}: {
  label: string;
  hint: PopoverPanelHint | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const button = <IconButton icon={<CloseIcon />} label={label} onClick={onPress} />;
  return Hint === undefined ? button : <Hint label={label}>{button}</Hint>;
}

/** Whether `target` is a node inside `box`. */
function inside(box: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && box.contains(target);
}

/**
 * The panel itself. Note that it takes the focus in an effect rather than
 * through `autoFocus`, because the control it hands focus to is its owner's,
 * named by a ref that may stand empty (a field not drawn), when the panel
 * takes it instead.
 */
export function PopoverPanel({
  id,
  title,
  look = POPOVER_PANEL_LOOK.CARD,
  closeLabel,
  hint,
  initialFocus,
  onDismiss,
  onLeave,
  onKeyDown,
  children,
}: {
  /** Its id, which the button that opens it names as what it controls. */
  id?: string | undefined;
  /** What it is called, drawn at a card's head and read as its name. */
  title: string;
  look?: PopoverPanelLook | undefined;
  /** What the × is named, which draws it at a card's head; none where it is left out. */
  closeLabel?: string | undefined;
  /** The app's hint over the ×. */
  hint?: PopoverPanelHint | undefined;
  /** The control that takes focus as it opens; the panel itself where it names none. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Escape, or a press on the ×: the owner decides what putting it away costs. */
  onDismiss: () => void;
  /** Focus left the panel for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
  /** Its own keys, heard after Escape. */
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    (initialFocus?.current ?? panel.current)?.focus({ preventScroll: true });
  }, [initialFocus]);

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.stopPropagation();
      onDismiss();
      return;
    }
    onKeyDown?.(event);
  };

  return (
    <div
      ref={panel}
      id={id}
      className="luke-popover-panel"
      data-look={look}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKey}
      onBlur={(event) => {
        if (panel.current !== null && !inside(panel.current, event.relatedTarget)) {
          onLeave(event.relatedTarget);
        }
      }}
    >
      {look === POPOVER_PANEL_LOOK.CARD ? (
        <div className="luke-popover-panel-head">
          <h2 id={titleId} className="luke-popover-panel-title">
            {title}
          </h2>
          {closeLabel === undefined ? null : (
            <CloseButton label={closeLabel} hint={hint} onPress={onDismiss} />
          )}
        </div>
      ) : (
        <h2 id={titleId} className="luke-visually-hidden">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
