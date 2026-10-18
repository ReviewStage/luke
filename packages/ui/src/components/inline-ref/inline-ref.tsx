import type {
  ComponentType,
  FocusEventHandler,
  MouseEvent,
  PointerEventHandler,
  ReactElement,
  ReactNode,
} from "react";

/**
 * inline-ref.tsx -- a thing named inside a line of words: its glyph, its name, and where it stands, as one target that hangs its card and, where it can, opens it.
 *
 * An agent, a person, a file, a skill, or a mention is named in place many
 * ways across a window, and each is the same token: a glyph that says what
 * kind of thing it is, the name it goes by, and after the name a quiet word
 * on where it stands (an issue's "Open", a file's lines). Handed `onPress` it
 * is a button; otherwise its press is the line's own, and it is words that
 * hang a card alone. A subject that is gone keeps its name, struck through.
 *
 * Its look is chosen by the place it stands (`INLINE_REF_LOOK`): words in
 * the line's own ink whose name underlines under the pointer as a link's
 * does, words that wash under the pointer as a byline's actor does, or a
 * pill on a raised fill as a mention is drawn in prose. An inert pill on a
 * row that is itself a button lifts with that row's hover, since its fill
 * is the row's hover fill. The name gives way before anything else: cut at
 * its end, or at its start for a path, so a file's own name stays in sight.
 *
 * What is drawn here is the token. Its hint, the pill or card hung while the
 * pointer rests on it and when that shows and goes, is the app's (`hint`):
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
  /** What kind of thing it names, before the name; hidden from a screen reader, since the name says it. */
  glyph?: ReactNode;
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
  /** Whether what it names is gone: its name stays, struck through. */
  gone?: boolean;
  /** Opens what it names; without it the token is words whose press is the line's. */
  onPress?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  /** What a reader is told its press does, where its name alone would not say: "Open src/app.ts, lines 4–9". */
  pressLabel?: string | undefined;
}

/** The token itself, which takes what a hint hands it on its root. */
function InlineRefRoot({
  look,
  glyph,
  label,
  name = INLINE_REF_NAME.NAME,
  labelHidden = false,
  state,
  heard,
  gone = false,
  onPress,
  pressLabel,
  ...rest
}: InlineRefFace & InlineRefHintProps & DataAttributes): React.JSX.Element {
  const face = (
    <>
      {glyph === undefined ? null : (
        <span className="luke-inline-ref-glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span
        className={labelHidden ? "luke-visually-hidden" : "luke-inline-ref-label"}
        data-name={name}
      >
        {/* Note that a path is isolated, so the cut at its start never reorders it. */}
        {name === INLINE_REF_NAME.PATH ? <bdi>{label}</bdi> : label}
      </span>
      {state === undefined || state === null || labelHidden ? null : (
        <span className="luke-inline-ref-state">{state}</span>
      )}
      {heard === undefined ? null : <span className="luke-visually-hidden">{heard}</span>}
    </>
  );
  const own = { ...rest, className: "luke-inline-ref", "data-look": look };
  const goneProps = gone ? { "data-gone": "true" } : {};
  return onPress === undefined ? (
    <span {...own} {...goneProps}>
      {face}
    </span>
  ) : (
    <button type="button" {...own} {...goneProps} aria-label={pressLabel} onClick={onPress}>
      {face}
    </button>
  );
}

/** A thing named in a line: its glyph, name, and standing as one target, hanging `card` or its name through the app's `hint`. */
export function InlineRef({
  hint: Hint,
  hintLabel,
  card,
  ...token
}: InlineRefFace &
  DataAttributes & {
    /** The app's hint, which hangs the token's card, or its name in a pill. */
    hint?: InlineRefHint | undefined;
    /** What the hint's pill says, where it is not the name: a file's whole path. */
    hintLabel?: string | undefined;
    /** The card the hint hangs in place of a pill. */
    card?: ReactNode;
  }): React.JSX.Element {
  const root = <InlineRefRoot {...token} />;
  if (Hint === undefined) return root;
  return (
    <Hint label={hintLabel ?? token.label} card={card}>
      {root}
    </Hint>
  );
}
