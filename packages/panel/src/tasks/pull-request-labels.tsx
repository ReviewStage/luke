import type { PullRequestLabel } from "@luke/features/coding-agent-wire";
import { cssCustomProperties } from "@luke/ui";
import type { CSSProperties } from "react";

/**
 * pull-request-labels.tsx -- a pull request's labels at the end of its header's line of people, each a pill in its GitHub colour, readable in either appearance.
 *
 * GitHub names a label's colour as six hex digits, and a label is drawn in
 * it as stage-cli draws one. In the light appearance it is a solid fill,
 * its words dark or white by how light the fill reads (Rec. 709, at
 * GitHub's own threshold), edged a shade darker so a white label still
 * stands on a white ground. In the dark it is a tint of its colour, edged
 * a little stronger, its words in the colour itself, words and edge lifted
 * toward white where the colour is too dark to read on a dark ground. A colour GitHub
 * spells any other way draws the pill quiet. `tasks.css` picks between the
 * two by the appearance, so a label follows it without being drawn again.
 */

/** How light a fill reads, past which GitHub writes on it in dark words rather than white. */
const LIGHT_FILL = 0.453;

/** The words written on a light fill, and on a dark one. */
const DARK_WORDS = "#24292f";
const LIGHT_WORDS = "#ffffff";

/** How light a label's words must read on the dark ground; a darker colour is lifted toward white until they do. */
const DARK_GROUND_WORDS = 0.6;

/** How much darker a light fill's edge is than its fill. */
const EDGE_SHADE = 0.15;

/** The alpha a tint and its edge wear on the dark ground, as two hex digits: an eighth, and a quarter. */
const TINT_ALPHA = "20";
const EDGE_ALPHA = "40";

type Rgb = readonly [number, number, number];

/** A colour as GitHub spells a label's, its three channels; none for any other spelling. */
function channelsOf(color: string): Rgb | undefined {
  const hex = color.trim().replace(/^#/u, "");
  if (!/^[0-9a-f]{6}$/iu.test(hex)) return undefined;
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

/**
 * The properties `tasks.css` draws a label from, in each appearance: its
 * fill, edge, and words; none for a colour GitHub spells any other way.
 */
function labelColours(color: string): CSSProperties | undefined {
  const rgb = channelsOf(color);
  if (rgb === undefined) return undefined;
  const fill = hexOf(rgb);
  const lightness = lightnessOf(rgb);
  // Note that the lift is how far toward white the words move for their lightness to reach the bound.
  const lift =
    lightness >= DARK_GROUND_WORDS ? 0 : (DARK_GROUND_WORDS - lightness) / (1 - lightness);
  const words = hexOf(mixed(rgb, 255, lift));
  return cssCustomProperties({
    "--label-fill-light": fill,
    "--label-edge-light": hexOf(mixed(rgb, 0, EDGE_SHADE)),
    "--label-words-light": lightness > LIGHT_FILL ? DARK_WORDS : LIGHT_WORDS,
    "--label-fill-dark": `${fill}${TINT_ALPHA}`,
    "--label-edge-dark": `${words}${EDGE_ALPHA}`,
    "--label-words-dark": words,
  });
}

/** The pull request's labels, in the order GitHub lists them; nothing where it has none. */
export function PullRequestLabels({
  labels,
}: {
  labels: readonly PullRequestLabel[];
}): React.JSX.Element | null {
  if (labels.length === 0) return null;
  return (
    <ul className="pull-request-labels" aria-label="Labels">
      {labels.map((label) => (
        <li key={label.name} className="pull-request-label" style={labelColours(label.color)}>
          <bdi>{label.name}</bdi>
        </li>
      ))}
    </ul>
  );
}
