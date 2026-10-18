import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";

/**
 * button.tsx -- the one button every app presses: a labelled Button and a glyph-alone IconButton, in one of five looks.
 *
 * A look says what a press does, not where the button stands: `quiet` for
 * an ordinary act among others (a toolbar's), `outline` for the act a row or
 * a card offers at rest, `primary` for the act a place exists for, `danger`
 * for one that destroys, `danger-outline` for a destructive act that is
 * not the place's own, and `ink` for one that ends what the place holds, a
 * solid fill in the text's own colour apart from the quiet ones beside it,
 * as a call's End call is. Each is one control's height, corner, and glyph
 * in the profile it is drawn at, and owns its insides: it takes no class or
 * style, and its outer spacing is its container's. Its shape is square on
 * the control's corner, or `round`: a disc for a glyph alone, a pill for
 * words, as a call's own controls are drawn everywhere.
 *
 * A toggle in the `danger` look is quiet while it is off and on the danger
 * tint while it is on, since what it turns on is the thing to warn of, so a
 * microphone muted is never read as one hearing you.
 *
 * A button that is not `tabbable` is out of the tab order but takes the
 * focus when it is handed it, for a roving stop: one of a group the
 * keyboard enters at one place and moves through by its own keys.
 *
 * A button that keeps focus (`keepFocus`) leaves the focus where it is
 * when a pointer presses it, so a field beside it that holds the keys, as a
 * popover's search does, goes on hearing them; Tab still reaches it and
 * hands it the focus as any button's.
 *
 * A button unavailable is out of the tab order, unless it is
 * `focusableWhenDisabled`, where it stays in it, so a hint over it can say
 * why, and refuses its press instead. A busy button keeps its width, its
 * words standing hidden under a turning ring, refuses its press, and is
 * named by `busyLabel` ("Saving") for as long as the ring stands. The ring
 * holds still on `--loop-motion`, as every endless loop does under reduced
 * motion and a capture run. The keyboard's ring is the app's own, drawn by
 * its reset for every control alike.
 *
 * A ButtonLink is a Button's look on a link, for an act that is going
 * somewhere: a download, another site, an app's own scheme. The browser
 * follows its address, so it opens in a new tab, copies, and hands off as
 * any link does; it is never unavailable or busy, since a link that cannot
 * be followed is not drawn. An IconButtonLink is an IconButton's look on a
 * link, named by its `label`, which may open in a `newTab`.
 *
 * An app's hint wraps a button and hands it the pointer and focus handlers
 * it shows and goes on, and the chord it names (`HintProps`), which land on
 * the button itself, so a reader is told the shortcut by the control.
 */

/** What a press does, which is what a button looks like. */
export const BUTTON_VARIANT = {
  QUIET: "quiet",
  OUTLINE: "outline",
  PRIMARY: "primary",
  DANGER: "danger",
  DANGER_OUTLINE: "danger-outline",
  INK: "ink",
} as const;

export type ButtonVariant = (typeof BUTTON_VARIANT)[keyof typeof BUTTON_VARIANT];

/** A button's outline: the control's corner, or round at its ends. */
export const BUTTON_SHAPE = {
  SQUARE: "square",
  ROUND: "round",
} as const;

export type ButtonShape = (typeof BUTTON_SHAPE)[keyof typeof BUTTON_SHAPE];

/** What a press of a button in a form does: act on its own, or submit the form. */
export const BUTTON_TYPE = {
  BUTTON: "button",
  SUBMIT: "submit",
} as const;

export type ButtonType = (typeof BUTTON_TYPE)[keyof typeof BUTTON_TYPE];

/**
 * A button that can be busy names what it is doing while it is, since its
 * words stand hidden under the ring and name nothing then; one that never is
 * names nothing more.
 */
type BusyProps =
  | { busy?: false | undefined; busyLabel?: undefined }
  | {
      /** Whether its press is out: it refuses another and shows a ring in place of its words. */
      busy: boolean;
      /** What it is named while busy, the act in progress ("Saving"). */
      busyLabel: string;
    };

/** What an app's hint hands the button it wraps: when to show and go, and the chord it names. */
type HintProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onPointerEnter" | "onPointerLeave" | "onPointerDown" | "onFocus" | "onBlur" | "aria-keyshortcuts"
>;

/** What every button takes, labelled or not. */
type ButtonBase = BusyProps &
  HintProps & {
    variant?: ButtonVariant;
    shape?: ButtonShape;
    type?: ButtonType;
    onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
    disabled?: boolean | undefined;
    /** Whether an unavailable button stays in the tab order, so a hint can say why it is unavailable. */
    focusableWhenDisabled?: boolean | undefined;
    /** Whether Tab stops on it; one that is not still takes the focus a roving group hands it. */
    tabbable?: boolean | undefined;
    /** Whether a pointer's press leaves the focus where it is, as on a field beside it that holds the keys. */
    keepFocus?: boolean | undefined;
    id?: string | undefined;
    ref?: Ref<HTMLButtonElement> | undefined;
    /** The id of the words that say more of what it does. */
    "aria-describedby"?: string | undefined;
    /** What more it says of its state, where no words on screen say it ("Filtered"). */
    "aria-description"?: string | undefined;
    /** The menu or popover it opens, and whether that stands open. */
    "aria-haspopup"?: "menu" | "listbox" | "dialog" | undefined;
    "aria-expanded"?: boolean | undefined;
    "aria-controls"?: string | undefined;
    /** Whether it goes to the page on show, which it is drawn and announced as. */
    "aria-current"?: "page" | undefined;
  };

/** A pointer's press that leaves the focus where it is. */
function preventFocusMove(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** The attributes and handler a button carries for its state, shared by both kinds. */
function stateProps(props: ButtonBase, name: string | undefined) {
  const refusing =
    props.busy === true || (props.disabled === true && props.focusableWhenDisabled === true);
  const busyName = props.busy === true ? props.busyLabel : undefined;
  return {
    type: props.type ?? BUTTON_TYPE.BUTTON,
    id: props.id,
    ref: props.ref,
    disabled: props.disabled === true && props.focusableWhenDisabled !== true,
    tabIndex: props.tabbable === false ? -1 : undefined,
    "aria-disabled": refusing ? true : undefined,
    "aria-busy": props.busy === true ? true : undefined,
    "aria-label": busyName ?? name,
    "aria-describedby": props["aria-describedby"],
    "aria-description": props["aria-description"],
    "aria-haspopup": props["aria-haspopup"],
    "aria-expanded": props["aria-expanded"],
    "aria-controls": props["aria-controls"],
    "aria-current": props["aria-current"],
    "aria-keyshortcuts": props["aria-keyshortcuts"],
    onPointerEnter: props.onPointerEnter,
    onPointerLeave: props.onPointerLeave,
    onPointerDown: props.onPointerDown,
    // Note that the focus moves as a mousedown's default, so refusing it there is what keeps it.
    onMouseDown: props.keepFocus === true ? preventFocusMove : undefined,
    onFocus: props.onFocus,
    onBlur: props.onBlur,
    "data-variant": props.variant ?? BUTTON_VARIANT.QUIET,
    // Note that a square button, the default, carries no shape, so it is drawn as every button was.
    "data-shape": props.shape === BUTTON_SHAPE.ROUND ? BUTTON_SHAPE.ROUND : undefined,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (refusing) {
        event.preventDefault();
        return;
      }
      props.onClick?.(event);
    },
  };
}

/** A labelled button: its words, after its glyph where it has one. */
export function Button({
  icon,
  children,
  ...props
}: ButtonBase & {
  /** The glyph before its words. */
  icon?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button className="luke-button" {...stateProps(props, undefined)}>
      <span className="luke-button-face">
        {icon}
        <span className="luke-button-words">{children}</span>
      </span>
    </button>
  );
}

/** A link drawn as a labelled button: its words after its glyph, going to `href` when pressed. */
export function ButtonLink({
  href,
  variant,
  icon,
  onClick,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  /** Called as the press leaves, before the browser follows the link. */
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  /** The glyph before its words. */
  icon?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <a
      className="luke-button"
      data-variant={variant ?? BUTTON_VARIANT.QUIET}
      href={href}
      onClick={onClick}
    >
      <span className="luke-button-face">
        {icon}
        <span className="luke-button-words">{children}</span>
      </span>
    </a>
  );
}

/** A link drawn as an IconButton: a glyph alone, named by `label`, going to `href` when pressed. */
export function IconButtonLink({
  href,
  icon,
  label,
  variant,
  newTab = false,
}: {
  href: string;
  icon: ReactNode;
  /** Its accessible name, which a sighted reader has from the glyph. */
  label: string;
  variant?: ButtonVariant;
  /** Whether it opens in a new tab, leaving the page it is on where it was. */
  newTab?: boolean;
}): React.JSX.Element {
  return (
    <a
      className="luke-button"
      data-icon-only="true"
      data-variant={variant ?? BUTTON_VARIANT.QUIET}
      href={href}
      aria-label={label}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
    >
      <span className="luke-button-face">{icon}</span>
    </a>
  );
}

/** A glyph alone in a square, named by `label` since it shows no words; `pressed` makes it a toggle. */
export function IconButton({
  icon,
  label,
  pressed,
  ...props
}: ButtonBase & {
  icon: ReactNode;
  /** Its accessible name, which a sighted reader has from the glyph. */
  label: string;
  /** Whether a toggle stands on, which it is drawn and announced as. */
  pressed?: boolean | undefined;
}): React.JSX.Element {
  return (
    <button
      className="luke-button"
      data-icon-only="true"
      aria-pressed={pressed}
      {...stateProps(props, label)}
    >
      <span className="luke-button-face">{icon}</span>
    </button>
  );
}
