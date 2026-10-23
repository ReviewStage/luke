import {
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../cn.js";
import { CheckIcon } from "../../face/glyphs.js";
import { PRESS_FACE, PRESS_PULSE, pulsePress } from "../../press-pulse.js";
import { replayMotion } from "../../replay-motion.js";
import { buttonVariants, Button as ShadcnButton } from "../../shadcn/button.js";
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
 * as a call's End call is. `subtle` is a quiet one in the muted ink, for a
 * press that stands among quiet words rather than controls, and must not
 * outweigh them (a pull request header's “+ Label”), lighting as a
 * quiet one does. Two tinted looks carry news on a wash of their
 * colour rather than a fill: `working-tint` for an act something under way
 * offers (Restart, once a release is downloaded), and `danger-tint` for the
 * one a failure offers (Download, once installing it failed). `row` is an
 * act standing as a row of a card's own, its words at the row's start and
 * the row lit by the fill a menu's row is lit by, as a date picker's Clear
 * is. Each is one control's height, corner, and glyph
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
 * why, and refuses its press instead, with a shake. Every press a button
 * or a link drawn as one takes is answered with a pulse of its face, and a
 * submit's arrow lifts as it sends. A busy button keeps its width, its
 * words standing hidden under a turning ring, refuses its press, and is
 * named by `busyLabel` ("Saving") for as long as the ring stands. A labelled
 * button whose act has landed may say so, `done`: a check springs in where
 * its words stood, it refuses another press, and `onDone` hears once the
 * check has been seen, at once where no motion runs. A busy button told its
 * press `succeeded` as its ring leaves lands the same way for a moment: the
 * check stands in the ring's place for `--luke-confirm-delay`, a hold reduced
 * motion keeps, so the check is still seen there without its spring, and its
 * words come back after; one that failed just stops, its words back at once.
 * A button that `turns`, a refresh's or a retry's, turns its glyph once as a
 * press lands, beside the pulse of its face. The ring
 * holds still on `--luke-loop-motion`, as every endless loop does under reduced
 * motion and a capture run. The keyboard's ring is the app's own, drawn by
 * its reset for every control alike.
 *
 * A labelled Button may be a record of a press rather than an offer of
 * one: `readOnly`, it takes no press and no Tab stop, as an unavailable one
 * does, yet stands at full strength, so it reads as a press given rather
 * than one waiting; `pressed` draws the one that was given as a toggle
 * standing on.
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
 * the row beneath it is already lit; only its glyph brightens. A labelled
 * Button comes in the same two: `compact` is a row mark's height in the
 * caption's type, for a press that stands among words rather than
 * controls (a sidebar foot's Restart).
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
 *
 * Each is drawn by shadcn/ui's Base UI button (`../../shadcn/button.tsx`),
 * a native button, its box, type, and edge in Tailwind over the theme; a
 * link drawn as one wears the same classes (`buttonVariants`). Its look,
 * the `--luke-button-*` inks each variant and state sets, its motions, and
 * what a container restyles it by stay in `button.css`, because a
 * container's sheet sets those inks from the components layer, which a
 * utility would outrank. It keeps the `luke-button` class and its `data-`
 * attributes, which those sheets and the apps' own select it by.
 */

/** What a press does, which is what a button looks like. */
export const BUTTON_VARIANT = {
  QUIET: "quiet",
  SUBTLE: "subtle",
  OUTLINE: "outline",
  PRIMARY: "primary",
  DANGER: "danger",
  DANGER_OUTLINE: "danger-outline",
  INK: "ink",
  WORKING_TINT: "working-tint",
  DANGER_TINT: "danger-tint",
  ROW: "row",
  MEDIA: "media",
} as const;

export type ButtonVariant = (typeof BUTTON_VARIANT)[keyof typeof BUTTON_VARIANT];

/** A button's outline: the control's corner, or round at its ends. */
export const BUTTON_SHAPE = {
  SQUARE: "square",
  ROUND: "round",
} as const;

export type ButtonShape = (typeof BUTTON_SHAPE)[keyof typeof BUTTON_SHAPE];

/** How big a button is: the control's own, or a row mark's height. */
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
  | { busy?: false | undefined; busyLabel?: undefined; succeeded?: undefined }
  | {
      /** Whether its press is out: it refuses another and shows a ring in place of its words. */
      busy: boolean;
      /** What it is named while busy, the act in progress ("Saving"). */
      busyLabel: string;
      /** Whether the press the ring stood for landed, read as the ring leaves: a check stands for a moment before its words come back. */
      succeeded?: boolean | undefined;
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
    /** Whether its glyph turns once as a press lands, as a refresh's or a retry's arrow does. */
    turns?: boolean | undefined;
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

/** The box a button is drawn in: the control's, a row mark's, a glyph alone in either, or a menu's row. */
type BoxSize = "control" | "compact" | "icon" | "icon-compact" | "row";

/** The box a button of `variant` is drawn in, at `size`, with words or a glyph alone. */
function boxSize(
  variant: ButtonVariant | undefined,
  size: ButtonSize | undefined,
  iconOnly: boolean,
): BoxSize {
  const compact = size === BUTTON_SIZE.COMPACT;
  if (iconOnly) return compact ? "icon-compact" : "icon";
  if (variant === BUTTON_VARIANT.ROW) return "row";
  return compact ? "compact" : "control";
}

/** How a button of `variant` gives under the pointer: the hand on the web, the Mac's arrow on the desktop, the arrow once it takes no press. */
const PRESSABLE_CURSOR =
  "cursor-pointer in-data-[luke-profile=desktop]:cursor-default disabled:cursor-default";

/** What a button is drawn with: the shadcn button's box and shape, and the classes its look and state add. */
interface ButtonLook {
  readonly size: BoxSize;
  readonly shape: "square" | "round";
  readonly className: string;
}

/**
 * What a button is drawn with: its box, and the faces its state takes.
 * Note that the state's are decided here rather than by variants on the
 * element, because two utilities for one property stand in an order no
 * selector of theirs decides, as a busy button's cursor and the desktop's would.
 */
function buttonLook({
  variant,
  size,
  shape,
  iconOnly,
  busy = false,
  settled = false,
  fades = true,
}: {
  variant: ButtonVariant | undefined;
  size: ButtonSize | undefined;
  shape: ButtonShape | undefined;
  iconOnly: boolean;
  /** Whether its press is out, which it says with a turning cursor. */
  busy?: boolean;
  /** Whether it takes no press, unavailable, busy, or done. */
  settled?: boolean;
  /** Whether it fades while disabled, as every button but a read-only one or a submit does. */
  fades?: boolean;
}): ButtonLook {
  const box = boxSize(variant, size, iconOnly);
  return {
    size: box,
    shape: shape === BUTTON_SHAPE.ROUND ? "round" : "square",
    className: cn(
      "luke-button",
      // Note that a subtle button's words keep the weight of the quiet words it stands among.
      box === "compact" && variant === BUTTON_VARIANT.SUBTLE && "font-medium",
      busy ? "cursor-progress" : settled ? "cursor-default" : PRESSABLE_CURSOR,
      fades && "disabled:opacity-45",
    ),
  };
}

/** The classes a link drawn as a button wears: the shadcn button's own, as shadcn dresses a link. */
function linkClasses(look: ButtonLook): string {
  return cn(buttonVariants(look));
}

/** The classes of a button's face, which hides under a busy ring and fades under a done check. */
function faceClasses(size: BoxSize | undefined, busy: boolean, done: boolean): string {
  return cn(
    "luke-button-face inline-flex items-center gap-icon-gap min-w-0",
    size === "compact" && "gap-luke-4",
    busy && "invisible",
    done && "opacity-0",
  );
}

/** A button's words, cut with an ellipsis where its box is narrower than they are. */
const WORDS = "luke-button-words overflow-hidden text-ellipsis";

/** A pointer's press that leaves the focus where it is. */
function preventFocusMove(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** What a button plays as it answers a press it refused: a shake. */
const DENIED_ATTRIBUTE = "data-denied";

/** What a button that `turns` plays on its glyph as a press lands: one whole turn. */
const TURN_ATTRIBUTE = "data-turn";

/** Turns the glyph `button` leads with once, where it has one. */
function turn(button: HTMLElement): void {
  const glyph = button.querySelector(":scope > .luke-button-face > svg:first-child");
  if (glyph !== null) replayMotion(button, TURN_ATTRIBUTE, glyph);
}

/**
 * Plays a press's pulse on `pressable`: its face springs back inside its
 * box, but a row's, a menu's row lit rather than pressed, which gives a
 * little whole, as every row does.
 */
function pulse(pressable: HTMLElement, variant: ButtonVariant | undefined): void {
  pulsePress(pressable, variant === BUTTON_VARIANT.ROW ? PRESS_PULSE.QUIET : PRESS_PULSE.FACE);
}

/** The attributes and handler a button carries for its state, shared by both kinds; `done` is a labelled one whose act has landed. */
function stateProps(props: ButtonBase, name: string | undefined, done = false) {
  const settled = props.busy === true || done;
  const refusing = settled || (props.disabled === true && props.focusableWhenDisabled === true);
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
        // Note that a busy button's ring, or a done one's check, already says why it takes no press.
        if (!settled) replayMotion(event.currentTarget, DENIED_ATTRIBUTE);
        return;
      }
      pulse(event.currentTarget, props.variant);
      if (props.turns === true) turn(event.currentTarget);
      props.onClick?.(event);
    },
  };
}

/** The motions an element runs. Note that a DOM with no animation engine, a test's, runs none. */
function running(element: HTMLElement): Animation[] {
  return "getAnimations" in element ? element.getAnimations() : [];
}

/**
 * The check a done button wears over its hidden words, which tells `onShown`
 * once its spring has played, or at once where it runs none, as under
 * reduced motion's zeroed tokens or in a DOM with no animation engine.
 */
function DoneMark({
  onShown,
  hold = false,
}: {
  onShown: (() => void) | undefined;
  /** Whether it stands its hold before it is shown, as a busy button's landing does. */
  hold?: boolean;
}): React.JSX.Element {
  const mark = useRef<HTMLSpanElement | null>(null);
  const shown = useRef(onShown);
  shown.current = onShown;
  useLayoutEffect(() => {
    const motions = mark.current === null ? [] : running(mark.current);
    // Note that a motion cancelled counts as played, since nothing is left to wait for.
    let left = motions.length;
    let current = true;
    const played = () => {
      left -= 1;
      if (current && left <= 0) shown.current?.();
    };
    if (left === 0) shown.current?.();
    for (const motion of motions) {
      motion.addEventListener("finish", played, { once: true });
      motion.addEventListener("cancel", played, { once: true });
    }
    return () => {
      current = false;
    };
  }, []);
  return (
    <span
      ref={mark}
      className="luke-button-done absolute inset-0 grid place-items-center"
      data-hold={hold || undefined}
      aria-hidden="true"
    >
      <CheckIcon />
    </span>
  );
}

/**
 * Whether a busy button's press has just landed: from the draw its ring
 * leaves on, told it `succeeded`, until its check has stood its hold, which
 * `settle` ends. Note that the ring's leaving is read as the draw sees it
 * rather than in an effect, so the check is in the first frame without it.
 */
function useLanded(props: BusyProps): { landed: boolean; settle: () => void } {
  const busy = props.busy === true;
  const [wasBusy, setWasBusy] = useState(busy);
  const [landed, setLanded] = useState(false);
  if (busy !== wasBusy) {
    setWasBusy(busy);
    setLanded(!busy && props.succeeded === true);
  }
  const settle = useCallback(() => setLanded(false), []);
  return { landed, settle };
}

/**
 * The state a landed button stands in: settled as a done one is, and
 * available while its check stands, so the check is at full strength even
 * where what landed leaves it unavailable after (a Save with nothing left to save).
 */
function landedProps<Props extends ButtonBase>(props: Props, landed: boolean): Props {
  return landed ? { ...props, disabled: false } : props;
}

/** A labelled button: its words, after its glyph where it has one. */
export function Button({
  icon,
  trailing,
  label,
  size,
  pressed,
  readOnly = false,
  done = false,
  onDone,
  children,
  ...props
}: ButtonBase & {
  /** The glyph before its words. */
  icon?: ReactNode;
  /** A count or note after its words, inside its fill, in the caption's quiet type (a fold's \"3\"). */
  trailing?: ReactNode;
  /** Its accessible name where its words say less, which holds its words ("Start a coding agent" over "Start"). */
  label?: string | undefined;
  size?: ButtonSize | undefined;
  /** Whether a toggle stands on, or a press recorded was the one given, which it is drawn and announced as. */
  pressed?: boolean | undefined;
  /** Whether it records a press rather than offering one: it takes none, at full strength. */
  readOnly?: boolean | undefined;
  /** Whether its act has landed: a check stands in its words' place and it takes no press. */
  done?: boolean | undefined;
  /** Heard once the check has been seen, as a dialog waits on it to close. */
  onDone?: (() => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const { landed, settle } = useLanded(props);
  const busy = props.busy === true;
  const shown = done || landed;
  const state = stateProps(
    readOnly ? { ...props, disabled: true } : landedProps(props, landed),
    label,
    shown,
  );
  return (
    <ShadcnButton
      {...state}
      {...buttonLook({
        variant: props.variant,
        size,
        shape: props.shape,
        iconOnly: false,
        busy,
        settled: shown || state["aria-disabled"] === true,
        fades: !readOnly,
      })}
      data-size={size === BUTTON_SIZE.COMPACT ? BUTTON_SIZE.COMPACT : undefined}
      data-read-only={readOnly || undefined}
      data-done={shown || undefined}
      aria-pressed={pressed}
    >
      <span
        className={faceClasses(boxSize(props.variant, size, false), busy, shown)}
        {...PRESS_FACE}
      >
        {icon}
        <span className={WORDS}>{children}</span>
        {trailing === undefined ? null : (
          <span className="luke-button-trailing flex-none text-subtle-foreground text-caption tabular-nums">
            {trailing}
          </span>
        )}
      </span>
      {done ? <DoneMark onShown={onDone} /> : landed ? <DoneMark hold onShown={settle} /> : null}
    </ShadcnButton>
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
      className={linkClasses(
        buttonLook({ variant, size: undefined, shape: undefined, iconOnly: false }),
      )}
      data-variant={variant ?? BUTTON_VARIANT.QUIET}
      href={href}
      onClick={(event) => {
        pulse(event.currentTarget, variant);
        onClick?.(event);
      }}
    >
      <span
        className={faceClasses(boxSize(variant, undefined, false), false, false)}
        {...PRESS_FACE}
      >
        {icon}
        <span className={WORDS}>{children}</span>
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
      className={linkClasses(
        buttonLook({ variant, size: undefined, shape: undefined, iconOnly: true }),
      )}
      data-icon-only="true"
      data-variant={variant ?? BUTTON_VARIANT.QUIET}
      href={href}
      aria-label={label}
      onClick={(event) => pulse(event.currentTarget, variant)}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
    >
      <span className={faceClasses("icon", false, false)} {...PRESS_FACE}>
        {icon}
      </span>
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
        <span className="luke-button-ring block size-control-icon">
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
  const { landed, settle } = useLanded(props);
  const busy = props.busy === true;
  const state = stateProps(
    submit === undefined ? landedProps(props, landed) : { ...props, shape: BUTTON_SHAPE.ROUND },
    label,
    landed,
  );
  return (
    <ShadcnButton
      {...state}
      {...buttonLook({
        variant: props.variant,
        size,
        shape: submit === undefined ? props.shape : BUTTON_SHAPE.ROUND,
        iconOnly: true,
        busy,
        settled: landed || state["aria-disabled"] === true,
        // Note that a submit unavailable stands on the strong fill rather than fading (`button.css`).
        fades: submit === undefined,
      })}
      data-icon-only="true"
      data-size={size === BUTTON_SIZE.COMPACT ? BUTTON_SIZE.COMPACT : undefined}
      data-submit={submit}
      data-done={landed || undefined}
      aria-pressed={pressed}
    >
      <span className={faceClasses("icon", busy, landed)} {...PRESS_FACE}>
        {submit === undefined ? icon : submitGlyph(submit)}
      </span>
      {landed ? <DoneMark hold onShown={settle} /> : null}
    </ShadcnButton>
  );
}
