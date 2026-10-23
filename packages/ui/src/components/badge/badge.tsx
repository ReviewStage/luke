import type { CSSProperties, ReactNode } from "react";
import { cssCustomProperties } from "../../css.js";
import { useClipped } from "../../use-clipped.js";
import type { VisuallyHiddenUnder } from "../visually-hidden/visually-hidden.js";

/**
 * badge.tsx -- a short word saying where something stands, in the state palette: working, needing you, done, merged, failed, or nothing in particular.
 *
 * The words are the badge, and the colour says them again: a badge is never
 * a coloured dot alone, so a reader, a screenshot in grey, and an eye that
 * cannot tell the inks apart all read the same state. A glyph may stand
 * before the words where one says the state too, in the tone's ink; a badge
 * in a tone without one leads its words with a dot of it. The badge stands
 * on the chip's own opaque face, its words in the text's ink, so they hold
 * their contrast on any ground behind it.
 *
 * A badge naming something a provider colours, a GitHub label, wears that
 * colour as a dot before its words (`swatch`) rather than on them, because a
 * provider lets its colour be anything, a dark one among them, which the
 * badge's words could not be read in. The colour is six hex digits, the
 * spelling GitHub and Linear answer; any other is drawn in the subtle ink.
 * Where the colour is how a reader tells one from another, a pull request's
 * labels in its header, the badge is filled with it instead (`fill`), as
 * GitHub draws a label: a solid fill in the light appearance, its words dark
 * or white by how light the fill reads (Rec. 709, at GitHub's own threshold),
 * edged a shade darker so a white label still stands on a white ground; and
 * in the dark a tint of the colour, its words in the colour itself, lifted
 * toward white where it is too dark to read. A filled badge keeps its words
 * on one line, fading them out at their end where the row cuts them short,
 * in their own direction (`<bdi>`), and any other spelling draws it neutral.
 *
 * A badge may stand lit (`lit`), in the ink, as a pressed filter chip does:
 * the reader's own reaction where it cannot be pressed. In a narrow room
 * (`hideWordsUnder`) a badge gives its words up to a reader alone wherever
 * something else says its state in their place: its glyph, its swatch, or
 * its tone's dot.
 */

/** The one spelling of a provider's colour a swatch paints: six hex digits, with or without its `#`. */
const SWATCH_COLOUR = /^#?([0-9a-f]{6})$/iu;

/** What a badge says about where something stands. */
export const BADGE_TONE = {
  NEUTRAL: "neutral",
  WORKING: "working",
  ATTENTION: "attention",
  COMPLETE: "complete",
  MERGED: "merged",
  DANGER: "danger",
} as const;

export type BadgeTone = (typeof BADGE_TONE)[keyof typeof BADGE_TONE];

/** How light a fill reads, past which GitHub writes on it in dark words rather than white. */
const LIGHT_FILL = 0.453;

/** The words written on a light fill, and on a dark one. */
const DARK_WORDS = "#24292f";
const LIGHT_WORDS = "#ffffff";

/** How light a filled badge's words must read on the dark ground; a darker colour is lifted toward white until they do. */
const DARK_GROUND_WORDS = 0.6;

/** How much darker a light fill's edge is than its fill. */
const EDGE_SHADE = 0.15;

/** The alpha a tint and its edge wear on the dark ground, as two hex digits: an eighth, and a quarter. */
const TINT_ALPHA = "20";
const EDGE_ALPHA = "40";

type Rgb = readonly [number, number, number];

/** A provider's colour as its three channels; none for any spelling but six hex digits. */
function channelsOf(colour: string): Rgb | undefined {
  const hex = SWATCH_COLOUR.exec(colour.trim())?.[1];
  if (hex === undefined) return undefined;
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

/** How light a colour reads, from nought to one. */
function lightnessOf([red, green, blue]: Rgb): number {
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

/** A colour moved toward `toward` (0 or 255) by `by`, from nought to one. */
function mixed([red, green, blue]: Rgb, toward: number, by: number): Rgb {
  const move = (channel: number) => Math.round(channel + (toward - channel) * by);
  return [move(red), move(green), move(blue)];
}

/** A colour spelled as six hex digits after a `#`. */
function hexOf(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** The fill, edge, and words a filled badge is drawn in, in each appearance; none for a colour it cannot paint. */
function fillColours(colour: string): CSSProperties | undefined {
  const rgb = channelsOf(colour);
  if (rgb === undefined) return undefined;
  const fill = hexOf(rgb);
  const lightness = lightnessOf(rgb);
  // Note that the lift is how far toward white the words move for their lightness to reach the bound.
  const lift =
    lightness >= DARK_GROUND_WORDS ? 0 : (DARK_GROUND_WORDS - lightness) / (1 - lightness);
  const words = hexOf(mixed(rgb, 255, lift));
  return cssCustomProperties({
    "--luke-badge-fill-light": fill,
    "--luke-badge-edge-light": hexOf(mixed(rgb, 0, EDGE_SHADE)),
    "--luke-badge-words-light": lightness > LIGHT_FILL ? DARK_WORDS : LIGHT_WORDS,
    "--luke-badge-fill-dark": `${fill}${TINT_ALPHA}`,
    "--luke-badge-edge-dark": `${words}${EDGE_ALPHA}`,
    "--luke-badge-words-dark": words,
  });
}

/** A filled badge's words, on one line in their own direction, marked while the badge cuts them short. */
function FilledWords({ children }: { children: string }): React.JSX.Element {
  const [measured, clipped] = useClipped(children);
  return (
    <bdi ref={measured} className="luke-badge-line" data-overflow={String(clipped)}>
      {children}
    </bdi>
  );
}

/** A state in `tone`, said by its words. */
export function Badge({
  tone = BADGE_TONE.NEUTRAL,
  icon,
  swatch,
  fill,
  dot = false,
  lit = false,
  hideWordsUnder,
  children,
}: {
  tone?: BadgeTone;
  /** A glyph before the words, saying the state again. */
  icon?: ReactNode;
  /** A provider's colour for what the badge names, drawn as a dot before its words; any colour but six hex digits is drawn subtle. */
  swatch?: string | undefined;
  /** A provider's colour the badge is filled with, its words on one line; any colour but six hex digits draws it neutral. */
  fill?: string | undefined;
  /** Whether a muted dot leads the words, as a marker of something standing open. */
  dot?: boolean;
  /** Whether it stands in the ink, as a pressed filter chip does: the reader's own. */
  lit?: boolean;
  /** Give the words up, to a reader alone, once the room around the badge (a `luke-room` container) is narrower than this step; kept drawn where no `icon`, `swatch`, or dot says the state in their place. */
  hideWordsUnder?: VisuallyHiddenUnder | undefined;
  /** The state's words, which the colour only repeats; a filled badge's are one string. */
  children: ReactNode;
}): React.JSX.Element {
  const colour = swatch === undefined ? undefined : SWATCH_COLOUR.exec(swatch)?.[1];
  const filled = fill === undefined ? undefined : fillColours(fill);
  const marked = icon != null || swatch !== undefined || dot || tone !== BADGE_TONE.NEUTRAL;
  return (
    <span
      className="luke-badge"
      data-tone={tone}
      data-fill={filled === undefined ? undefined : "true"}
      data-lit={lit ? "true" : undefined}
      style={filled}
    >
      {swatch === undefined ? null : (
        <span
          className="luke-badge-swatch"
          aria-hidden="true"
          style={colour === undefined ? undefined : { background: `#${colour}` }}
        />
      )}
      {dot ? <span className="luke-badge-swatch" aria-hidden="true" /> : null}
      {icon}
      <span className="luke-badge-words" data-under={marked ? hideWordsUnder : undefined}>
        {filled !== undefined && typeof children === "string" ? (
          <FilledWords>{children}</FilledWords>
        ) : (
          children
        )}
      </span>
    </span>
  );
}
