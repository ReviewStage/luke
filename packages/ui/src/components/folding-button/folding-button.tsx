import {
  type ComponentType,
  type FocusEventHandler,
  type MouseEvent,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useState,
} from "react";
import { cn } from "../../cn.js";
import {
  BUTTON_SHAPE,
  BUTTON_VARIANT,
  Button,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
} from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * folding-button.tsx -- a toolbar's labelled button whose words a narrow toolbar folds away, leaving its glyph, named by its hint.
 *
 * A toolbar too narrow for every act's words folds them by a container query
 * of its own, which sets `--luke-fold: folded` on an element holding its
 * buttons, so its acts keep their places as glyphs rather than crowding the
 * title beside them off its line or drawing over it. Folded, the button is
 * a square around its glyph, and its words are still there for a reader,
 * drawn nowhere, so its name never changes; it raises them in its hint for
 * the pointer and the keyboard. A round one is a pill drawn and a disc
 * folded. Drawn, its words name it and it raises
 * nothing, since a hint repeating the words beside it says nothing.
 *
 * A button that opens a popup says so (`aria-haspopup`, `aria-expanded`,
 * `aria-controls`) and hands its owner the button (`ref`), which the popup
 * hands the focus back to; one whose name says more than its words, a count
 * its glyph wears, is named by `name`, which holds its words.
 *
 * What is drawn here is the button, and whether its words are folded. Its
 * hint is the window's tooltip (`Tooltip`, `hint.tsx`), or one the caller
 * hangs in its place (`hint`): it is handed the
 * words while they are folded and nothing while they are drawn, and wraps
 * the button's box, which hands what the hint gives it on to the button.
 */

/**
 * The box's own classes, and the fold it lays on its button: under a
 * `--luke-fold` of `folded`, a square around the glyph, its words drawn
 * nowhere though a reader still has them. Note that the fold is drawn from
 * the box, whose child selectors outweigh the button's own utilities, so it
 * needs no class on the button, which takes none.
 */
const FOLDING_BOX = cn(
  "luke-folding-button inline-flex flex-none min-w-0 max-w-full",
  "fold-folded:[&>.luke-button]:w-control",
  "fold-folded:[&>.luke-button]:p-0",
  "fold-folded:[&>.luke-button[data-size=compact]]:w-6",
  "fold-folded:[&_.luke-button-words]:sr-only",
);

/** A row-look box, the row's whole width, as the look says. */
const FOLDING_ROW = "flex w-full";

/** The value of `--luke-fold` that folds every folding button under it. */
const FOLDED = "folded";

/** What a hint hands the box it wraps, which the box hands on to its button: when to show and go, and what it says of the button. */
interface FoldingHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/** The hint an app hangs from a folding button: `label` while the words are folded, nothing while they are drawn. */
export type FoldingButtonHint = ComponentType<{
  label: string | undefined;
  children: ReactElement<FoldingHintProps>;
}>;

/**
 * Whether the button's words are folded away, read whenever its box changes,
 * which folding them does. Note that the box is observed rather than the
 * words, because words folded from the first frame report no change of size
 * to observe.
 */
function useFolded(): [(box: HTMLElement | null) => (() => void) | undefined, boolean] {
  const [folded, setFolded] = useState(false);
  const measured = useCallback((box: HTMLElement | null) => {
    if (box === null) return undefined;
    const observer = new ResizeObserver(() =>
      setFolded(getComputedStyle(box).getPropertyValue("--luke-fold").trim() === FOLDED),
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return [measured, folded];
}

/** What a folding button may say beyond its words: a fuller name, the popup it opens, and the button itself for its owner. */
interface FoldingButtonDoors {
  /** Its accessible name where it says more than its words, which it holds (“Review, 2 pending comments”). */
  name?: string | undefined;
  "aria-haspopup"?: "menu" | "listbox" | "dialog" | undefined;
  "aria-expanded"?: boolean | undefined;
  "aria-controls"?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

/**
 * The button's box, measured for its fold. Note that what a hint hands the
 * box lands on the button inside it, because the button is what takes the
 * pointer and the focus, and what a reader is told the hint's words and
 * chord by.
 */
function FoldingBox({
  measured,
  label,
  icon,
  variant,
  shape,
  size,
  busy,
  succeeded,
  turns,
  disabled,
  onClick,
  trailing,
  doors,
  ...hinted
}: FoldingHintProps & {
  measured: (box: HTMLElement | null) => (() => void) | undefined;
  doors: FoldingButtonDoors;
  label: string;
  icon: ReactNode;
  variant: ButtonVariant;
  shape: ButtonShape | undefined;
  size: ButtonSize | undefined;
  busy: string | undefined;
  succeeded: boolean | undefined;
  turns: boolean | undefined;
  disabled: boolean | undefined;
  onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  trailing: ReactNode;
}): React.JSX.Element {
  // Note that the main part is told how its press landed while it is not busy too, since the ring's leaving is what it reads it at.
  const busyProps = { busy: busy !== undefined, busyLabel: busy ?? "", succeeded };
  return (
    <span
      ref={measured}
      className={cn(FOLDING_BOX, variant === BUTTON_VARIANT.ROW && FOLDING_ROW)}
      data-row={variant === BUTTON_VARIANT.ROW ? "" : undefined}
    >
      <Button
        ref={doors.ref}
        icon={icon}
        trailing={trailing}
        variant={variant}
        shape={shape ?? BUTTON_SHAPE.SQUARE}
        size={size}
        disabled={disabled}
        turns={turns}
        onClick={onClick}
        label={doors.name}
        aria-haspopup={doors["aria-haspopup"]}
        aria-expanded={doors["aria-expanded"]}
        aria-controls={doors["aria-controls"]}
        {...busyProps}
        {...hinted}
      >
        {label}
      </Button>
    </span>
  );
}

/** A labelled toolbar button, its glyph then its words, the words folding away where its toolbar says so. */
export function FoldingButton({
  label,
  icon,
  variant = BUTTON_VARIANT.QUIET,
  shape,
  size,
  busy,
  succeeded,
  turns,
  disabled,
  onClick,
  trailing,
  hint: Hint = Tooltip,
  ...doors
}: FoldingButtonDoors & {
  /** Its words, and so its name, folded or not. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  /** Its outline: the control's corner, or round, a pill drawn and a disc folded. */
  shape?: ButtonShape | undefined;
  /** How big it is: the control's own, or a row mark's height in the caption's type. */
  size?: ButtonSize | undefined;
  /** While its press is out, what it is doing ("Running"): a ring stands over it under that name. */
  busy?: string | undefined;
  /** Whether the press its ring stood for landed, read as the ring leaves (Button's `succeeded`). */
  succeeded?: boolean | undefined;
  /** Whether its glyph turns once as a press lands, as a retry's arrow does (Button's `turns`). */
  turns?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  /** A count after its words, inside the button's fill; it stays drawn when the words fold. */
  trailing?: ReactNode;
  /** The hint raising the words while they are folded: the window's tooltip, unless the caller hangs one of its own. */
  hint?: FoldingButtonHint | undefined;
}): React.JSX.Element {
  const [measured, folded] = useFolded();
  const box = (
    <FoldingBox
      measured={measured}
      label={label}
      icon={icon}
      variant={variant}
      shape={shape}
      size={size}
      busy={busy}
      succeeded={succeeded}
      turns={turns}
      disabled={disabled}
      onClick={onClick}
      trailing={trailing}
      doors={doors}
    />
  );
  return <Hint label={folded ? label : undefined}>{box}</Hint>;
}
