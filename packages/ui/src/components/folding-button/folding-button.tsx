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
import {
  BUTTON_SHAPE,
  BUTTON_VARIANT,
  Button,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
} from "../button/button.js";

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
 * What is drawn here is the button, and whether its words are folded. The
 * hint, when it shows and goes, is the app's (`hint`): it is handed the
 * words while they are folded and nothing while they are drawn, and wraps
 * the button's box, which hands what the hint gives it on to the button.
 */

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
  disabled,
  onClick,
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
  disabled: boolean | undefined;
  onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
}): React.JSX.Element {
  const busyProps = busy === undefined ? {} : { busy: true, busyLabel: busy };
  return (
    <span ref={measured} className="luke-folding-button">
      <Button
        ref={doors.ref}
        icon={icon}
        variant={variant}
        shape={shape ?? BUTTON_SHAPE.SQUARE}
        size={size}
        disabled={disabled}
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
  disabled,
  onClick,
  hint: Hint,
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
  disabled?: boolean | undefined;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  /** The app's hint, raising the words while they are folded. */
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
      disabled={disabled}
      onClick={onClick}
      doors={doors}
    />
  );
  return Hint === undefined ? box : <Hint label={folded ? label : undefined}>{box}</Hint>;
}
