import type {
  ComponentType,
  FocusEventHandler,
  MouseEvent,
  PointerEventHandler,
  ReactElement,
  ReactNode,
  Ref,
} from "react";
import { ChevronDownIcon } from "../../face/glyphs.js";
import { BUTTON_VARIANT, Button, type ButtonVariant, IconButton } from "../button/button.js";

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
 * opens the options. A toolbar short of room folds the main part's words
 * away with `--luke-fold: folded`, as it folds a FoldingButton's, leaving
 * its glyph and its name; shorter still, `--luke-fold: bare` leaves that
 * glyph alone, the chevron not drawn, so the options are reached some
 * other way the app offers.
 *
 * The hint over the main part is the app's (`hint`): it is handed
 * `hintLabel` and wraps the main part, which takes what the hint hands it.
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

/** An act and, joined to it, the chevron that drops its options. */
export function SplitButton({
  variant = BUTTON_VARIANT.QUIET,
  icon,
  label,
  children,
  onClick,
  disabled,
  busy,
  hint: Hint,
  hintLabel,
  menu,
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
  /** The app's hint over the main part. */
  hint?: SplitButtonHint | undefined;
  /** What the hint says. */
  hintLabel?: string | undefined;
  menu: SplitButtonMenu;
}): React.JSX.Element {
  const { label: menuLabel, ...trigger } = menu;
  const busyProps = busy === undefined ? {} : { busy: true, busyLabel: busy };
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
    <span className="luke-split-button" data-variant={variant}>
      {Hint === undefined ? main : <Hint label={hintLabel}>{main}</Hint>}
      <IconButton
        variant={variant}
        icon={<ChevronDownIcon />}
        label={menuLabel}
        disabled={disabled}
        focusableWhenDisabled
        {...trigger}
      />
    </span>
  );
}
