import type {
  ComponentType,
  FocusEventHandler,
  MouseEvent,
  PointerEventHandler,
  ReactElement,
  ReactNode,
  Ref,
} from "react";
import { useCallback, useRef } from "react";
import { ChevronDownIcon } from "../../face/glyphs.js";
import { BUTTON_VARIANT, Button, type ButtonVariant, IconButton } from "../button/button.js";
import { cn } from "../../cn.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * split-button.tsx -- one act and the menu of its options in one control: a labelled Button and, joined to it, a chevron that drops the menu.
 *
 * The main part does the act as its options stand; the chevron opens what
 * sets them, a menu or a popover the owner draws and places, as every
 * button that opens one does (`useMenu`'s `trigger`, spread into `menu`).
 * Both halves wear one look, joined into a single control by the edge the
 * look draws around and between them, and each keeps its own hover.
 *
 * Unavailable, both halves say so and refuse their press, kept in the tab
 * order so a hint over the main part can say why. Busy, the main part
 * stands under its ring as a busy Button does while the chevron still
 * opens the options, and one whose press `succeeded` lands on a check as a
 * busy Button's does. A toolbar short of room folds the main part's words
 * away with `--luke-fold: folded`, as it folds a FoldingButton's, leaving
 * its glyph and its name; shorter still, `--luke-fold: bare` leaves that
 * glyph alone, the chevron not drawn, so the options are reached some
 * other way the app offers.
 *
 * The hint over the main part is the window's tooltip (`Tooltip`), or one
 * the caller hangs in its place (`hint`): it is handed
 * `hintLabel` and wraps the main part, which takes what the hint hands it.
 *
 * Every press on the split button but the chevron's is heard as it lands
 * (`onMainPress`), before the main part's own and a refused one alike, busy
 * or unavailable, so a press of the main part closes the options' menu
 * whether or not it acts.
 */

/** What a hint hands the main part it wraps: when to show and go, and what it says of it. */
interface SplitButtonHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/** The hint an app hangs from a split button's main part, saying `label`. */
export type SplitButtonHint = ComponentType<{
  label: string | undefined;
  children: ReactElement<SplitButtonHintProps>;
}>;

/** The chevron: its name, the popup it opens and whether that stands open, and its press. */
export interface SplitButtonMenu {
  /** Its accessible name, which a sighted reader has from the glyph ("Choose a model"). */
  label: string;
  "aria-haspopup": "menu" | "listbox" | "dialog";
  "aria-expanded": boolean;
  "aria-controls"?: string | undefined;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  ref?: Ref<HTMLButtonElement> | undefined;
}

/**
 * The halves joined into one control, drawn from the box: no edge or corner
 * between them, and the main part's fold, under a `--luke-fold` of `folded`
 * a square around its glyph, its words drawn nowhere though a reader still
 * has them, and of `bare` that square alone at the control's own corner,
 * the chevron not drawn. Note that each is a child selector of the box's,
 * which outweighs the halves' own utilities, so neither takes a class. The
 * edge's ink is `split-button.css`'s, set as a button's inks are.
 */
const SPLIT_BOX = cn(
  "luke-split-button inline-flex flex-none items-center min-w-0 max-w-full",
  "[&>.luke-button:first-child]:border-e-0 [&>.luke-button:first-child]:rounded-e-none",
  "[&>.luke-button:last-child]:rounded-s-none",
  "[@container_style(--luke-fold:folded)]:[&>.luke-button:first-child]:w-control",
  "[@container_style(--luke-fold:folded)]:[&>.luke-button:first-child]:p-0",
  "[@container_style(--luke-fold:folded)]:[&>.luke-button:first-child_.luke-button-words]:sr-only",
  "[@container_style(--luke-fold:bare)]:[&>.luke-button:first-child]:w-control",
  "[@container_style(--luke-fold:bare)]:[&>.luke-button:first-child]:p-0",
  "[@container_style(--luke-fold:bare)]:[&>.luke-button:first-child_.luke-button-words]:sr-only",
  "[@container_style(--luke-fold:bare)]:[&>.luke-button:first-child]:border-e",
  "[@container_style(--luke-fold:bare)]:[&>.luke-button:first-child]:rounded-control",
  "[@container_style(--luke-fold:bare)]:[&>.luke-button:last-child]:hidden",
);

/** A filled look's halves, parted by a rule in its own ink. */
const SPLIT_FILLED_RULE =
  "[&>.luke-button:last-child]:border-s-[color-mix(in_srgb,var(--luke-button-ink)_30%,transparent)]";

/** The looks drawn on a fill, whose halves a rule in their ink parts rather than a hairline. */
const FILLED: ReadonlySet<ButtonVariant> = new Set([
  BUTTON_VARIANT.PRIMARY,
  BUTTON_VARIANT.DANGER,
  BUTTON_VARIANT.INK,
]);

/** An act and, joined to it, the chevron that drops its options. */
export function SplitButton({
  variant = BUTTON_VARIANT.QUIET,
  icon,
  label,
  children,
  onClick,
  disabled,
  busy,
  succeeded,
  hint: Hint = Tooltip,
  hintLabel,
  menu,
  onMainPress,
}: {
  variant?: ButtonVariant | undefined;
  /** The glyph before the main part's words, which stands alone where they are folded. */
  icon?: ReactNode;
  /** The main part's accessible name where its words say less, which holds them (Button's `label`). */
  label?: string | undefined;
  /** The main part's words. */
  children: ReactNode;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  /** Whether both halves are unavailable: they refuse their press, and stay reachable so a hint can say why. */
  disabled?: boolean | undefined;
  /** While the main part's press is out, what it is doing ("Starting"): a ring stands over it under that name. */
  busy?: string | undefined;
  /** Whether the main part's press landed, read as its ring leaves: a check stands a moment before its words come back (Button's `succeeded`). */
  succeeded?: boolean | undefined;
  /** The hint over the main part: the window's tooltip, unless the caller hangs one of its own. */
  hint?: SplitButtonHint | undefined;
  /** What the hint says. */
  hintLabel?: string | undefined;
  menu: SplitButtonMenu;
  /** Hears every press but the chevron's as it lands, one the main part refuses (busy, unavailable) too. */
  onMainPress?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
}): React.JSX.Element {
  const { label: menuLabel, ...trigger } = menu;
  const chevron = useRef<HTMLButtonElement | null>(null);
  const { ref: triggerRef, ...triggerProps } = trigger;
  // Note that the chevron is held here as well as by its owner, so a press on it is told apart.
  const chevronRef = useCallback(
    (element: HTMLButtonElement | null) => {
      chevron.current = element;
      if (typeof triggerRef === "function") triggerRef(element);
      else if (triggerRef !== undefined && triggerRef !== null) triggerRef.current = element;
    },
    [triggerRef],
  );
  // Note that the main part is told how its press landed while it is not busy too, since the ring's leaving is what it reads it at.
  const busyProps = { busy: busy !== undefined, busyLabel: busy ?? "", succeeded };
  const main = (
    <Button
      variant={variant}
      icon={icon}
      label={label}
      disabled={disabled}
      focusableWhenDisabled
      onClick={onClick}
      {...busyProps}
    >
      {children}
    </Button>
  );
  return (
    <span
      className={cn(SPLIT_BOX, FILLED.has(variant) && SPLIT_FILLED_RULE)}
      data-variant={variant}
      onClickCapture={
        onMainPress === undefined
          ? undefined
          : (event) => {
              const target = event.target;
              if (!(target instanceof Node && chevron.current?.contains(target)))
                onMainPress(event);
            }
      }
    >
      <Hint label={hintLabel}>{main}</Hint>
      <IconButton
        variant={variant}
        icon={<ChevronDownIcon />}
        label={menuLabel}
        disabled={disabled}
        focusableWhenDisabled
        {...triggerProps}
        ref={chevronRef}
      />
    </span>
  );
}
