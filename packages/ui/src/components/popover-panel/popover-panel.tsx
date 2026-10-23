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
import { Tooltip } from "../tooltip/hint.js";

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

/**
 * The panel's surface, shadcn/ui's popover content (style `base-nova`) in
 * Luke's menu surface: its ground, edge, corner, and lift, arriving as a
 * menu does, holding focus for its controls with no ring of its own, and no
 * section giving up its height to the bound, since it scrolls rather than
 * squeezing what it holds. A card stands its sections apart in one column
 * at the caption's type, never taller than the room its side of the button
 * leaves and scrolling within it; a menu's content runs edge to edge, its
 * own rows carrying the inset, and scrolls its own list. Its head stands the
 * title and the ×, which its own inset pulls out to the edge so its glyph,
 * not its square, lines up with the card's content.
 */
const PANEL = [
  "luke-popover-panel flex flex-col rounded-menu border border-border-strong bg-popover text-popover-foreground shadow-menu animate-menu-in focus-visible:outline-none *:shrink-0",
  "data-[look=card]:max-h-popover-room data-[look=card]:gap-3 data-[look=card]:overflow-x-hidden data-[look=card]:overflow-y-auto data-[look=card]:overscroll-contain data-[look=card]:px-4 data-[look=card]:pt-3 data-[look=card]:pb-4 data-[look=card]:text-caption",
].join(" ");
const HEAD = "-mr-2 flex items-center justify-between gap-control-gap";
const TITLE = "m-0 text-section font-semibold";

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

/** The ×, under its hint. */
function CloseButton({
  label,
  hint: Hint,
  onPress,
}: {
  label: string;
  hint: PopoverPanelHint;
  onPress: () => void;
}): React.JSX.Element {
  const button = <IconButton icon={<CloseIcon />} label={label} onClick={onPress} />;
  return <Hint label={label}>{button}</Hint>;
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
  hint = Tooltip,
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
  /** The hint over the ×: the window's tooltip, unless the caller hangs one of its own. */
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
      className={PANEL}
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
        <div className={HEAD}>
          <h2 id={titleId} className={TITLE}>
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
