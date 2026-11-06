import type {
  ComponentType,
  FocusEventHandler,
  MouseEvent,
  PointerEventHandler,
  ReactElement,
  ReactNode,
} from "react";
import { pulseOnPress } from "../../press-pulse.js";
import { useLinkAddress } from "../menu/link-address.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_TRUNCATE, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";

export const INLINE_REF_LOOK = {
  LINK: "link",
  WASH: "wash",
  PILL: "pill",
} as const;

export type InlineRefLook = (typeof INLINE_REF_LOOK)[keyof typeof INLINE_REF_LOOK];

export const INLINE_REF_NAME = {
  NAME: "name",
  PATH: "path",
} as const;

export type InlineRefName = (typeof INLINE_REF_NAME)[keyof typeof INLINE_REF_NAME];

export interface InlineRefHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

export type InlineRefHint = ComponentType<{
  label: string;
  card: ReactNode;
  children: ReactElement<InlineRefHintProps>;
}>;

type DataAttributes = { readonly [name: `data-${string}`]: string | undefined };

interface InlineRefFace {
  look: InlineRefLook;
  glyph?: ReactNode;
  kind?: string | undefined;
  label: string;
  name?: InlineRefName;
  labelHidden?: boolean;
  state?: ReactNode;
  heard?: string | undefined;
  gone?: boolean;
  onPress?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  pressLabel?: string | undefined;
  linkHref?: string | undefined;
  leaves?: boolean | undefined;
}

const ROOT =
  "ui-inline-ref inline-flex min-w-0 max-w-full items-center p-0 border-0 text-left align-baseline [font:inherit] no-underline whitespace-nowrap";

const LOOK_ROOT = {
  [INLINE_REF_LOOK.LINK]: "gap-icon-gap bg-transparent",
  [INLINE_REF_LOOK.WASH]:
    "gap-ui-4 rounded-ui-6 bg-transparent transition-[background-color,box-shadow,color] duration-(--ui-duration-hover) ease-motion-exit hover:bg-muted hover:text-foreground hover:shadow-inline-ref-wash hover:[--ui-inline-ref-wash:var(--ui-color-fill-hover)]",
  [INLINE_REF_LOOK.PILL]:
    "-my-[0.075em] gap-ui-4 rounded-ui-6 py-[0.075em] pr-ui-6 pl-ui-4 text-foreground data-[look=pill]:leading-[1.2] data-[look=pill]:font-tag transition-[background-color] duration-(--ui-duration-hover) ease-motion-exit",
} as const satisfies Record<InlineRefLook, string>;

function rootClass({
  look,
  gone,
  pressable,
  leaving,
  stated,
}: {
  look: InlineRefLook;
  gone: boolean;
  pressable: boolean;
  leaving: boolean;
  stated: boolean;
}): string {
  const pill = look === INLINE_REF_LOOK.PILL;
  const parts: string[] = [ROOT, LOOK_ROOT[look]];
  if (!pill) parts.push(gone ? "text-muted-foreground" : "text-inherit");
  if (pressable) parts.push(leaving ? "cursor-link" : "cursor-press");
  if (pill) {
    parts.push(stated ? "max-w-inline-ref-pill-stated" : "max-w-inline-ref-pill");
    if (gone) parts.push("bg-transparent inset-ring inset-ring-border-strong");
    else if (pressable)
      parts.push("bg-fill-strong hover:bg-fill-selected focus-visible:bg-fill-selected");
    else
      parts.push(
        "bg-fill-strong [@media(hover:hover)]:in-[:is(button,summary):hover]:bg-fill-selected in-[:is(button,summary):focus-visible]:bg-fill-selected",
      );
  }
  return parts.join(" ");
}

function glyphClass(look: InlineRefLook): string {
  const glyph =
    "ui-inline-ref-glyph inline-grid flex-none place-items-center empty:hidden [&>svg]:size-[1em]";
  return look === INLINE_REF_LOOK.PILL ? `${glyph} size-[1em] text-muted-foreground` : glyph;
}

function labelClass({
  look,
  gone,
  pressable,
}: {
  look: InlineRefLook;
  gone: boolean;
  pressable: boolean;
}): string {
  const parts = ["ui-inline-ref-label self-baseline"];
  if (gone) parts.push("line-through");
  if (look === INLINE_REF_LOOK.LINK && pressable) {
    parts.push("group-hover/inline-ref:underline group-hover/inline-ref:underline-offset-2");
  }
  if (look === INLINE_REF_LOOK.WASH) parts.push("py-inline-ref-mark");
  return parts.join(" ");
}

function stateClass(look: InlineRefLook): string {
  const state = "ui-inline-ref-state flex-none self-baseline text-muted-foreground";
  return look === INLINE_REF_LOOK.PILL
    ? `${state} border-l border-border-strong pl-ui-4 font-caption`
    : state;
}

const GONE_HEARD = " (gone)";

const CONTROL_ROOTS =
  "button, a[href], summary, [role='button'], [role='link'], [role='option'], [role='menuitem'], [role='tab']";

function focusUnlessInControl(element: HTMLElement | null): void {
  if (element === null) return;
  const control = element.parentElement?.closest(CONTROL_ROOTS) ?? null;
  if (control === null) element.tabIndex = 0;
  else element.removeAttribute("tabindex");
}

function noFocus(element: HTMLElement | null): void {
  element?.removeAttribute("tabindex");
}

function InlineRefRoot({
  look,
  glyph,
  kind,
  label,
  name = INLINE_REF_NAME.NAME,
  labelHidden = false,
  state,
  heard,
  gone = false,
  onPress,
  pressLabel,
  linkHref,
  leaves = false,
  carded,
  ...rest
}: InlineRefFace &
  InlineRefHintProps &
  DataAttributes & {
    carded: boolean;
  }): React.JSX.Element {
  const linkAddress = useLinkAddress(linkHref);
  const pressable = onPress !== undefined;
  const leaving = pressable && leaves && linkHref !== undefined;
  const stated = !(state === undefined || state === null || labelHidden);
  const face = (
    <>
      {kind === undefined ? null : <span className="ui-visually-hidden">{`${kind} `}</span>}
      {glyph === undefined ? null : (
        <span className={glyphClass(look)} aria-hidden="true">
          {glyph}
        </span>
      )}
      {labelHidden ? (
        <span className="ui-visually-hidden">{label}</span>
      ) : (
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.INHERIT}
          font={name === INLINE_REF_NAME.PATH ? TEXT_FONT.MONO : TEXT_FONT.SANS}
          truncate={name === INLINE_REF_NAME.PATH ? TEXT_TRUNCATE.START : true}
          className={labelClass({ look, gone, pressable })}
        >
          {name === INLINE_REF_NAME.PATH ? <bdi>{label}</bdi> : label}
        </Text>
      )}
      {!stated ? null : <span className={stateClass(look)}>{state}</span>}
      {heard === undefined ? null : <span className="ui-visually-hidden">{heard}</span>}
      {gone ? <span className="ui-visually-hidden">{GONE_HEARD}</span> : null}
    </>
  );
  const own = {
    ...rest,
    className: `${rootClass({ look, gone, pressable, leaving, stated })}${pressable ? " group/inline-ref" : ""}`,
    "data-look": look,
  };
  const goneProps = gone ? { "data-gone": "true" } : {};
  if (onPress === undefined) {
    return (
      <span ref={carded ? focusUnlessInControl : noFocus} {...own} {...goneProps}>
        {face}
      </span>
    );
  }
  if (leaving) {
    const open = pulseOnPress(onPress);
    return (
      <a
        {...own}
        {...goneProps}
        href={linkHref}
        target="_blank"
        rel="noreferrer"
        aria-label={pressLabel}
        onClick={(event) => {
          event.preventDefault();
          open(event);
        }}
      >
        {face}
      </a>
    );
  }
  return (
    <button
      type="button"
      ref={linkAddress}
      {...own}
      {...goneProps}
      aria-label={pressLabel}
      onClick={pulseOnPress(onPress)}
    >
      {face}
    </button>
  );
}

export function InlineRef({
  hint: Hint = Tooltip,
  hintLabel,
  card,
  ...token
}: InlineRefFace &
  DataAttributes & {
    hint?: InlineRefHint | false | undefined;
    hintLabel?: string | undefined;
    card?: ReactNode;
  }): React.JSX.Element {
  const root = <InlineRefRoot {...token} carded={Hint !== false && card !== undefined} />;
  if (Hint === false) return root;
  return (
    <Hint label={hintLabel ?? token.label} card={card}>
      {root}
    </Hint>
  );
}
