import {
  type AnchorHTMLAttributes,
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
import { ArrowUpRightIcon, CheckIcon } from "../../face/glyphs.js";
import { PRESS_FACE, PRESS_PULSE, pulsePress } from "../../press-pulse.js";
import { replayMotion } from "../../replay-motion.js";
import { buttonVariants, Button as ShadcnButton } from "../../shadcn/button.js";
import { useDisclosure } from "../../use-disclosure.js";
import { rovingItem } from "../roving-keys/roving-keys.js";
import { useSettled } from "../spinner/settle-wait.js";
import { SpinnerRing } from "../spinner/spinner.js";

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
  DANGER_QUIET: "danger-quiet",
  ROW: "row",
  MEDIA: "media",
} as const;

export type ButtonVariant = (typeof BUTTON_VARIANT)[keyof typeof BUTTON_VARIANT];

export const BUTTON_SHAPE = {
  SQUARE: "square",
  ROUND: "round",
} as const;

export type ButtonShape = (typeof BUTTON_SHAPE)[keyof typeof BUTTON_SHAPE];

export const BUTTON_SIZE = {
  CONTROL: "control",
  COMPACT: "compact",
} as const;

export type ButtonSize = (typeof BUTTON_SIZE)[keyof typeof BUTTON_SIZE];

export const BUTTON_LIGHT = {
  FILL: "fill",
  GLYPH: "glyph",
} as const;

export type ButtonLight = (typeof BUTTON_LIGHT)[keyof typeof BUTTON_LIGHT];

export const SUBMIT_STATE = {
  READY: "ready",
  SUBMITTED: "submitted",
  STREAMING: "streaming",
} as const;

export type SubmitState = (typeof SUBMIT_STATE)[keyof typeof SUBMIT_STATE];

export const BUTTON_TYPE = {
  BUTTON: "button",
  SUBMIT: "submit",
} as const;

export type ButtonType = (typeof BUTTON_TYPE)[keyof typeof BUTTON_TYPE];

export type BusyProps =
  | { busy?: false | undefined; busyLabel?: undefined }
  | {
      busy: boolean;
      busyLabel: string;
    };

type LandingProps = BusyProps & {
  succeeded?: boolean | undefined;
};

type HintProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onPointerEnter" | "onPointerLeave" | "onPointerDown" | "onFocus" | "onBlur" | "aria-keyshortcuts"
>;

type LinkHintProps = Pick<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerDown"
  | "onTouchEnd"
  | "onFocus"
  | "onBlur"
  | "aria-describedby"
  | "aria-keyshortcuts"
>;

type ButtonBase = LandingProps &
  HintProps & {
    variant?: ButtonVariant;
    shape?: ButtonShape;
    type?: ButtonType;
    onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
    onContextMenu?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
    disabled?: boolean | undefined;
    focusableWhenDisabled?: boolean | undefined;
    onRefused?: (() => void) | undefined;
    tabbable?: boolean | undefined;
    roving?: boolean | undefined;
    keepFocus?: boolean | undefined;
    turns?: boolean | undefined;
    id?: string | undefined;
    ref?: Ref<HTMLButtonElement> | undefined;
    "aria-describedby"?: string | undefined;
    "aria-description"?: string | undefined;
    "aria-haspopup"?: "menu" | "listbox" | "dialog" | undefined;
    "aria-expanded"?: boolean | undefined;
    "aria-controls"?: string | undefined;
    "aria-current"?: "page" | undefined;
  };

type BoxSize = "control" | "compact" | "icon" | "icon-compact" | "row";

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

const PRESSABLE_CURSOR = "cursor-press disabled:cursor-default";

interface ButtonLook {
  readonly size: BoxSize;
  readonly shape: "square" | "round";
  readonly className: string;
}

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
  busy?: boolean;
  settled?: boolean;
  fades?: boolean;
}): ButtonLook {
  const box = boxSize(variant, size, iconOnly);
  return {
    size: box,
    shape: shape === BUTTON_SHAPE.ROUND ? "round" : "square",
    className: cn(
      "ui-button",
      busy ? "cursor-progress" : settled ? "cursor-default" : PRESSABLE_CURSOR,
      fades && "disabled:opacity-disabled",
    ),
  };
}

function linkClasses(look: ButtonLook): string {
  return cn(buttonVariants(look));
}

function faceClasses(size: BoxSize | undefined, ringShown: boolean, done: boolean): string {
  return cn(
    "ui-button-face inline-flex items-center gap-icon-gap min-w-0",
    size === "compact" && "gap-1",
    ringShown && "invisible",
    done && "opacity-0",
  );
}

function BusyRing(): React.JSX.Element {
  return (
    <span className="ui-button-ring absolute inset-0 m-auto size-control-icon" aria-hidden="true">
      <SpinnerRing />
    </span>
  );
}

const WORDS = "ui-button-words overflow-hidden text-ellipsis";

function preventFocusMove(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

const DENIED_ATTRIBUTE = "data-denied";

const TURN_ATTRIBUTE = "data-turn";

function turn(button: HTMLElement): void {
  const glyph = button.querySelector(":scope > .ui-button-face > svg:first-child");
  if (glyph !== null) replayMotion(button, TURN_ATTRIBUTE, glyph);
}

function pulse(pressable: HTMLElement, variant: ButtonVariant | undefined): void {
  pulsePress(pressable, variant === BUTTON_VARIANT.ROW ? PRESS_PULSE.QUIET : PRESS_PULSE.FACE);
}

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
    ...(props.roving === true ? rovingItem() : undefined),
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
    onMouseDown: props.keepFocus === true ? preventFocusMove : undefined,
    onContextMenu: props.onContextMenu,
    onFocus: props.onFocus,
    onBlur: props.onBlur,
    "data-variant": props.variant ?? BUTTON_VARIANT.QUIET,
    "data-shape": props.shape === BUTTON_SHAPE.ROUND ? BUTTON_SHAPE.ROUND : undefined,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (refusing) {
        event.preventDefault();
        if (settled) return;
        replayMotion(event.currentTarget, DENIED_ATTRIBUTE);
        props.onRefused?.();
        return;
      }
      pulse(event.currentTarget, props.variant);
      if (props.turns === true) turn(event.currentTarget);
      props.onClick?.(event);
    },
  };
}

function running(element: HTMLElement): Animation[] {
  return "getAnimations" in element ? element.getAnimations() : [];
}

function DoneMark({
  onShown,
  hold = false,
  leaving = false,
  held,
}: {
  onShown: (() => void) | undefined;
  hold?: boolean;
  leaving?: boolean;
  held?: ((element: HTMLElement | null) => void) | undefined;
}): React.JSX.Element {
  const mark = useRef<HTMLSpanElement | null>(null);
  const shown = useRef(onShown);
  shown.current = onShown;
  useLayoutEffect(() => {
    const motions = mark.current === null ? [] : running(mark.current);
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
      ref={(element) => {
        mark.current = element;
        held?.(element);
      }}
      className="ui-button-done absolute inset-0 grid place-items-center"
      data-hold={hold || undefined}
      data-leaving={leaving || undefined}
      aria-hidden="true"
    >
      <CheckIcon />
    </span>
  );
}

function LandingMark({
  landed,
  onShown,
}: {
  landed: boolean;
  onShown: () => void;
}): React.JSX.Element | null {
  const shown = useDisclosure(landed);
  if (!shown.mounted) return null;
  return <DoneMark hold leaving={shown.leaving} held={shown.ref} onShown={onShown} />;
}

function useLanded(props: LandingProps): { landed: boolean; settle: () => void } {
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

function landedProps<Props extends ButtonBase>(props: Props, landed: boolean): Props {
  return landed ? { ...props, disabled: false } : props;
}

function recordedProps(state: ReturnType<typeof stateProps>): ReturnType<typeof stateProps> {
  return {
    ...state,
    disabled: false,
    tabIndex: -1,
    "aria-disabled": true,
    onClick: (event: MouseEvent<HTMLButtonElement>) => event.preventDefault(),
  };
}

export function Button({
  icon,
  trailing,
  badge,
  label,
  size,
  pressed,
  readOnly = false,
  done = false,
  onDone,
  children,
  ...props
}: ButtonBase & {
  icon?: ReactNode;
  trailing?: ReactNode;
  badge?: string | undefined;
  label?: string | undefined;
  size?: ButtonSize | undefined;
  pressed?: boolean | undefined;
  readOnly?: boolean | undefined;
  done?: boolean | undefined;
  onDone?: (() => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const { landed, settle } = useLanded(props);
  const busy = props.busy === true;
  const ringShown = useSettled(busy);
  const shown = done || landed;
  const offered = stateProps(landedProps(props, landed), label, shown);
  const state = readOnly ? recordedProps(offered) : offered;
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
        className={faceClasses(boxSize(props.variant, size, false), ringShown, shown)}
        {...PRESS_FACE}
      >
        {icon}
        <span className={WORDS}>{children}</span>
        {badge === undefined ? null : (
          <span className="ui-button-badge inline-flex flex-none items-center text-muted-foreground text-caption">
            {badge}
          </span>
        )}
        {trailing === undefined ? null : (
          <span className="ui-button-trailing inline-flex flex-none items-center text-muted-foreground text-caption tabular-nums">
            {trailing}
          </span>
        )}
      </span>
      {ringShown ? <BusyRing /> : null}
      {done ? <DoneMark onShown={onDone} /> : <LandingMark landed={landed} onShown={settle} />}
    </ShadcnButton>
  );
}

export function ButtonLink({
  href,
  variant,
  shape,
  icon,
  label,
  external = false,
  onClick,
  children,
  ...hint
}: LinkHintProps & {
  href: string;
  variant?: ButtonVariant;
  shape?: ButtonShape;
  external?: boolean | undefined;
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  icon?: ReactNode;
  label?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <a
      className={linkClasses(buttonLook({ variant, size: undefined, shape, iconOnly: false }))}
      data-variant={variant ?? BUTTON_VARIANT.QUIET}
      {...hint}
      href={href}
      aria-label={label}
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
        {external ? <ArrowUpRightIcon /> : null}
      </span>
    </a>
  );
}

export function IconButtonLink({
  href,
  icon,
  label,
  variant,
  newTab = false,
  onClick,
  ...hint
}: LinkHintProps & {
  href: string;
  icon: ReactNode;
  label: string;
  variant?: ButtonVariant;
  newTab?: boolean;
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
}): React.JSX.Element {
  return (
    <a
      className={linkClasses(
        buttonLook({ variant, size: undefined, shape: undefined, iconOnly: true }),
      )}
      data-icon-only="true"
      data-variant={variant ?? BUTTON_VARIANT.QUIET}
      {...hint}
      href={href}
      aria-label={label}
      onClick={(event) => {
        pulse(event.currentTarget, variant);
        onClick?.(event);
      }}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
    >
      <span className={faceClasses("icon", false, false)} {...PRESS_FACE}>
        {icon}
      </span>
    </a>
  );
}

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

function submitGlyph(state: SubmitState): React.JSX.Element {
  switch (state) {
    case SUBMIT_STATE.READY:
      return <SendGlyph />;
    case SUBMIT_STATE.SUBMITTED:
      return (
        <span className="ui-button-ring block size-control-icon">
          <SpinnerRing />
        </span>
      );
    case SUBMIT_STATE.STREAMING:
      return <StopGlyph />;
  }
}

function lightsGlyph(
  variant: ButtonVariant | undefined,
  size: ButtonSize | undefined,
  lights: ButtonLight | undefined,
): boolean {
  if ((variant ?? BUTTON_VARIANT.QUIET) !== BUTTON_VARIANT.QUIET) return false;
  if (lights !== undefined) return lights === BUTTON_LIGHT.GLYPH;
  return size === BUTTON_SIZE.COMPACT;
}

type IconProps =
  | { icon: ReactNode; submit?: undefined; size?: ButtonSize }
  | {
      icon?: undefined;
      submit: SubmitState;
      size?: undefined;
    };

export function IconButton({
  icon,
  submit,
  label,
  pressed,
  size,
  lights,
  ...props
}: ButtonBase &
  IconProps & {
    label: string;
    pressed?: boolean | undefined;
    lights?: ButtonLight | undefined;
  }): React.JSX.Element {
  const { landed, settle } = useLanded(props);
  const busy = props.busy === true;
  const ringShown = useSettled(busy);
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
        fades: submit === undefined,
      })}
      data-icon-only="true"
      data-size={size === BUTTON_SIZE.COMPACT ? BUTTON_SIZE.COMPACT : undefined}
      data-lights={lightsGlyph(props.variant, size, lights) ? BUTTON_LIGHT.GLYPH : undefined}
      data-submit={submit}
      data-done={landed || undefined}
      aria-pressed={pressed}
    >
      <span className={faceClasses("icon", ringShown, landed)} {...PRESS_FACE}>
        {submit === undefined ? icon : submitGlyph(submit)}
      </span>
      {ringShown ? <BusyRing /> : null}
      <LandingMark landed={landed} onShown={settle} />
    </ShadcnButton>
  );
}
