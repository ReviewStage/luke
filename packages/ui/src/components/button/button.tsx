import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { SpinnerRing } from "../spinner/spinner.js";

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
 * A labelled button is named by its words, unless it is given a `label`
 * that says more of what it does than they have room for ("Start a coding
 * agent" over "Start"). The label holds the words it is drawn with, so a
 * reader who says what they see still reaches it (WCAG's label in name).
 *
 * An IconButton comes in two sizes: the control's own, and `compact`, the
 * smaller square a row's marks stand in at its end (a sidebar row's Pin,
 * Archive, or ⋯, a message's Copy), which its row reveals under the
 * pointer. A compact quiet one draws no ground under the pointer, because
 * the row beneath it is already lit; only its glyph brightens.
 *
 * An IconButton may instead be a `submit`, the round button a message is
 * sent with: its glyph is its state's, never its caller's, an arrow while it
 * sends, a ring while a send is out, and a square while a reply streams,
 * which its owner may make the Stop. It never changes size or place, and
 * unavailable it stands on the strong fill with a muted glyph rather than
 * fading, so its glyph stays a colour apart from its disc.
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

/** How big a glyph-alone button is: the control's own square, or a row mark's. */
export const BUTTON_SIZE = {
  CONTROL: "control",
  COMPACT: "compact",
} as const;

export type ButtonSize = (typeof BUTTON_SIZE)[keyof typeof BUTTON_SIZE];

/** Where a message's send stands, which decides its submit's glyph. */
export const SUBMIT_STATE = {
  READY: "ready",
  SUBMITTED: "submitted",
  STREAMING: "streaming",
} as const;

export type SubmitState = (typeof SUBMIT_STATE)[keyof typeof SUBMIT_STATE];

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
    /** A right-click's handler, as on a row's mark that offers its row's own menu. */
    onContextMenu?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
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
    onContextMenu: props.onContextMenu,
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
  label,
  children,
  ...props
}: ButtonBase & {
  /** The glyph before its words. */
  icon?: ReactNode;
  /** Its accessible name where its words say less, which holds its words ("Start a coding agent" over "Start"). */
  label?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button className="luke-button" {...stateProps(props, label)}>
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

/** A submit's arrow: the message goes up into the conversation. */
function SendGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

/** A submit's Stop, filled as every chat draws it; an outline reads as a checkbox at this size. */
function StopGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="16" height="16" x="4" y="4" rx="2" />
    </svg>
  );
}

/** The glyph a submit wears in its state. */
function submitGlyph(state: SubmitState): React.JSX.Element {
  switch (state) {
    case SUBMIT_STATE.READY:
      return <SendGlyph />;
    case SUBMIT_STATE.SUBMITTED:
      return (
        <span className="luke-button-ring">
          <SpinnerRing />
        </span>
      );
    case SUBMIT_STATE.STREAMING:
      return <StopGlyph />;
  }
}

/**
 * A glyph-alone button's glyph and size: its caller's own glyph at either
 * size, or a submit's, which its state decides, always at the control's.
 */
type IconProps =
  | { icon: ReactNode; submit?: undefined; size?: ButtonSize }
  | {
      icon?: undefined;
      /** Where the send it makes stands; it is round and wears its state's glyph. */
      submit: SubmitState;
      size?: undefined;
    };

/**
 * A glyph alone in a square, named by `label` since it shows no words;
 * `pressed` makes it a toggle, `size` a row's compact mark, and `submit` a
 * message's round send.
 */
export function IconButton({
  icon,
  submit,
  label,
  pressed,
  size,
  ...props
}: ButtonBase &
  IconProps & {
    /** Its accessible name, which a sighted reader has from the glyph. */
    label: string;
    /** Whether a toggle stands on, which it is drawn and announced as. */
    pressed?: boolean | undefined;
  }): React.JSX.Element {
  const state = stateProps(
    submit === undefined ? props : { ...props, shape: BUTTON_SHAPE.ROUND },
    label,
  );
  return (
    <button
      className="luke-button"
      data-icon-only="true"
      data-size={size === BUTTON_SIZE.COMPACT ? BUTTON_SIZE.COMPACT : undefined}
      data-submit={submit}
      aria-pressed={pressed}
      {...state}
    >
      <span className="luke-button-face">{submit === undefined ? icon : submitGlyph(submit)}</span>
    </button>
  );
}
