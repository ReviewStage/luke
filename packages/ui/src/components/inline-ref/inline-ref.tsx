import type {
  ComponentType,
  FocusEventHandler,
  MouseEvent,
  PointerEventHandler,
  ReactElement,
  ReactNode,
} from "react";
import { pulseOnPress } from "../../press-pulse.js";
import { useClipped } from "../../use-clipped.js";
import { useLinkAddress } from "../menu/link-address.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * inline-ref.tsx -- a thing named inside a line of words: its glyph, its name, and where it stands, as one target that hangs its card and, where it can, opens it.
 *
 * An agent, a person, a file, a skill, or a mention is named in place many
 * ways across a window, and each is the same token: a glyph that says what
 * kind of thing it is, the name it goes by, and after the name a quiet word
 * on where it stands (an issue's "Open", a file's lines). Handed `onPress` it
 * is a button, or a link where its press leaves the app for an address
 * (`leaves`); otherwise its press is the line's own, and it is words that
 * hang a card alone, which take the focus so the keyboard reaches the card.
 * A subject that is gone keeps its name, struck through. Its glyph is hidden
 * from a screen reader, which hears its kind in words before its name
 * (`kind`) and that it is gone after it.
 *
 * Its look is chosen by the place it stands (`INLINE_REF_LOOK`): words in
 * the line's own ink whose name underlines under the pointer as a link's
 * does, words that wash under the pointer as a byline's actor does, or a
 * pill on a raised fill as a mention is drawn in prose. An inert pill on a
 * row that is itself a button lifts with that row's hover, since its fill
 * is the row's hover fill. The name gives way before anything else: fading
 * out where it is cut, at its end, or at its start for a path, so a file's
 * own name stays in sight.
 *
 * What is drawn here is the token. Its hint, the pill or card hung while the
 * pointer rests on it and when that shows and goes, is the window's tooltip
 * (`Tooltip`, `hint.tsx`), or one the caller hangs in its place (`hint`):
 * it is handed the words and the card and wraps the token, which takes what
 * the hint hands it on its own root.
 */

/** How a token is drawn, by the place it stands. */
export const INLINE_REF_LOOK = {
  /** Words in the line's ink; a button's name underlines under the pointer. */
  LINK: "link",
  /** Words in the line's ink that wash under the pointer, a byline's. */
  WASH: "wash",
  /** A pill on a raised fill, a mention's in prose. */
  PILL: "pill",
} as const;

export type InlineRefLook = (typeof INLINE_REF_LOOK)[keyof typeof INLINE_REF_LOOK];

/** What a token's name is, which says how it is set and where a long one is cut. */
export const INLINE_REF_NAME = {
  /** A name, cut at its end. */
  NAME: "name",
  /** A path, in the code face and cut at its start, so its last part stays in sight. */
  PATH: "path",
} as const;

export type InlineRefName = (typeof INLINE_REF_NAME)[keyof typeof INLINE_REF_NAME];

/** What a hint hands the token it wraps: when to show and go, and what it says of the token. */
export interface InlineRefHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/** The hint an app hangs from a token: `label` in a pill, or `card` where the place hands one. */
export type InlineRefHint = ComponentType<{
  label: string;
  card: ReactNode;
  children: ReactElement<InlineRefHintProps>;
}>;

/** A `data-` attribute a place names its token by. */
type DataAttributes = { readonly [name: `data-${string}`]: string | undefined };

/** What a token says and does, beside how it is drawn. */
interface InlineRefFace {
  look: InlineRefLook;
  /** The mark of what kind of thing it names, before the name; hidden from a screen reader, which hears `kind` in its place. */
  glyph?: ReactNode;
  /** What kind of thing it names, in words a screen reader hears before the name and nothing draws: "pull request". */
  kind?: string | undefined;
  /** The name it goes by. */
  label: string;
  /** What the name is: a name, or a path cut at its start. */
  name?: InlineRefName;
  /** Whether the name is drawn nowhere and said to a screen reader alone, for a line too short to hold it. */
  labelHidden?: boolean;
  /** Where it stands, after its name, never cut: an issue's state, a file's lines. */
  state?: ReactNode;
  /** Words a screen reader hears after the name, which nothing draws. */
  heard?: string | undefined;
  /** Whether what it names is gone: its name stays, struck through, and a screen reader hears that it is gone. */
  gone?: boolean;
  /** Opens what it names; without it the token is words whose press is the line's. */
  onPress?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  /** What a reader is told its press does, where its name alone would not say: "Open src/app.ts, lines 4–9". */
  pressLabel?: string | undefined;
  /** The address its press opens, where it opens one, which a right-click offers as a link's (`useLinkAddress`). */
  linkHref?: string | undefined;
  /** Whether its press leaves the app for `linkHref`, which draws it as a link to that address rather than a button. */
  leaves?: boolean | undefined;
}

/** What a screen reader hears after a gone subject's name, which its strike-through says to the eye alone. */
const GONE_HEARD = " (gone)";

/** The controls an inert token may stand inside, whose own focus is the token's, so it takes none of its own. */
const CONTROL_ROOTS =
  "button, a[href], summary, [role='button'], [role='link'], [role='option'], [role='menuitem'], [role='tab']";

/**
 * Lets an inert token that hangs a card take the focus, so the keyboard
 * reaches its card (⌥↓, `hint.tsx`), unless it stands inside a control,
 * whose focus is the token's already and which holds no control within.
 * Note that this reads the token's place once it is drawn, because nothing
 * before it says what the token stands in.
 */
function focusUnlessInControl(element: HTMLElement | null): void {
  if (element === null) return;
  const control = element.parentElement?.closest(CONTROL_ROOTS) ?? null;
  if (control === null) element.tabIndex = 0;
  else element.removeAttribute("tabindex");
}

/** Takes from a token that no longer hangs a card the focus it took. */
function noFocus(element: HTMLElement | null): void {
  element?.removeAttribute("tabindex");
}

/** The token itself, which takes what a hint hands it on its root. */
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
    /** Whether it hangs a card, which an inert token takes the focus for. */
    carded: boolean;
  }): React.JSX.Element {
  const linkAddress = useLinkAddress(linkHref);
  const [measured, clipped] = useClipped(label);
  const face = (
    <>
      {kind === undefined ? null : <span className="luke-visually-hidden">{`${kind} `}</span>}
      {glyph === undefined ? null : (
        <span className="luke-inline-ref-glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span
        ref={measured}
        className={labelHidden ? "luke-visually-hidden" : "luke-inline-ref-label"}
        data-name={name}
        data-overflow={String(clipped)}
      >
        {/* Note that a path is isolated, so the fade at its start never reorders it. */}
        {name === INLINE_REF_NAME.PATH ? <bdi>{label}</bdi> : label}
      </span>
      {state === undefined || state === null || labelHidden ? null : (
        <span className="luke-inline-ref-state">{state}</span>
      )}
      {heard === undefined ? null : <span className="luke-visually-hidden">{heard}</span>}
      {gone ? <span className="luke-visually-hidden">{GONE_HEARD}</span> : null}
    </>
  );
  const own = { ...rest, className: "luke-inline-ref", "data-look": look };
  const goneProps = gone ? { "data-gone": "true" } : {};
  if (onPress === undefined) {
    return (
      <span ref={carded ? focusUnlessInControl : noFocus} {...own} {...goneProps}>
        {face}
      </span>
    );
  }
  if (leaves && linkHref !== undefined) {
    // Note that the press, not the browser, opens the address, because the
    // window's opener decides where an address opens, a pull request's in
    // its tab say; the link is what a reader and a right-click are told.
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

/** A thing named in a line: its glyph, name, and standing as one target, hanging `card` or its name through its `hint`. */
export function InlineRef({
  hint: Hint = Tooltip,
  hintLabel,
  card,
  ...token
}: InlineRefFace &
  DataAttributes & {
    /** The hint, which hangs the token's card, or its name in a pill: the window's tooltip, unless the caller hangs one of its own, or `false` for none, as a token whose pill would only repeat its words. */
    hint?: InlineRefHint | false | undefined;
    /** What the hint's pill says, where it is not the name: a file's whole path. */
    hintLabel?: string | undefined;
    /** The card the hint hangs in place of a pill. */
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
