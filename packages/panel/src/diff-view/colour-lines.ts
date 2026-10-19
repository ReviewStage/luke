/**
 * colour-lines.ts -- a run of a file's lines as Pierre colours it, read back as the runs a File tab draws: each run of one colour carrying it in both appearances, and each theme's ground and ink.
 *
 * Pierre colours a file as one element per line, each holding a span per
 * token whose style names its colour in each theme (`--diffs-token-dark`,
 * `--diffs-token-light`), and names each theme's ground and ink in its
 * theme styles. A File tab draws runs of text with a colour for each
 * appearance (`@luke/features/tasks-view`'s `CodeToken`), so the lines are
 * read back into those: tokens of one colour joined, and the theme styles
 * read for the ground and the ink. A result whose lines are not the run's,
 * one per line given, is no result.
 */

import type { CodeLines, CodeToken } from "@luke/features/tasks-view";
import type { ElementContent } from "hast";
import type { ColouredLines } from "./contract.js";

/** The custom properties Pierre names a token's colour in, one per appearance. */
const TOKEN_COLOUR = { DARK: "--diffs-token-dark", LIGHT: "--diffs-token-light" } as const;

/** The custom properties Pierre names each theme's ground and ink in. */
const THEME_COLOUR = {
  DARK_INK: "--diffs-dark",
  DARK_GROUND: "--diffs-dark-bg",
  LIGHT_INK: "--diffs-light",
  LIGHT_GROUND: "--diffs-light-bg",
} as const;

/** The custom properties an inline style declares, by name. */
function declared(style: string): ReadonlyMap<string, string> {
  const named = new Map<string, string>();
  for (const declaration of style.split(";")) {
    const at = declaration.indexOf(":");
    if (at > 0) named.set(declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
  }
  return named;
}

/** Every word under a node, in order. */
function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  return node.children.map(textOf).join("");
}

/** A line's runs, read off its tokens' spans, those of one colour joined. */
function runsOf(line: ElementContent): CodeToken[] {
  const runs: CodeToken[] = [];
  const children = line.type === "element" ? line.children : [];
  for (const child of children) {
    const text = textOf(child);
    if (text === "") continue;
    const style = child.type === "element" ? child.properties.style : undefined;
    const colours = declared(style === undefined || style === null ? "" : String(style));
    const color = colours.get(TOKEN_COLOUR.DARK)?.toLowerCase();
    const lightColor = colours.get(TOKEN_COLOUR.LIGHT)?.toLowerCase();
    const last = runs.at(-1);
    if (last !== undefined && last.color === color && last.lightColor === lightColor) {
      runs[runs.length - 1] = { ...last, text: last.text + text };
      continue;
    }
    let run: CodeToken = { text };
    if (color !== undefined) run = { ...run, color };
    if (lightColor !== undefined) run = { ...run, lightColor };
    runs.push(run);
  }
  return runs;
}

/** A line's words with its trailing line break left off, as a File tab holds them. */
function withoutBreak(runs: CodeToken[]): CodeToken[] {
  const last = runs.at(-1);
  if (last === undefined || !last.text.endsWith("\n")) return runs;
  const text = last.text.slice(0, -1);
  return text === "" ? runs.slice(0, -1) : [...runs.slice(0, -1), { ...last, text }];
}

/**
 * The lines Pierre coloured, read back as runs, with each theme's ground and
 * ink; none where it coloured some other number of lines than `count`, or
 * named no theme's colours.
 */
export function colouredFrom(
  result: { readonly code: readonly ElementContent[]; readonly themeStyles: string },
  count: number,
): ColouredLines | undefined {
  const lines: CodeLines = result.code
    .filter((line) => line.type === "element")
    .map((line) => withoutBreak(runsOf(line)));
  const theme = declared(result.themeStyles);
  const darkInk = theme.get(THEME_COLOUR.DARK_INK);
  const darkGround = theme.get(THEME_COLOUR.DARK_GROUND);
  const lightInk = theme.get(THEME_COLOUR.LIGHT_INK);
  const lightGround = theme.get(THEME_COLOUR.LIGHT_GROUND);
  if (lines.length !== count) return undefined;
  if (darkInk === undefined || darkGround === undefined) return undefined;
  if (lightInk === undefined || lightGround === undefined) return undefined;
  return {
    lines,
    ground: { dark: darkGround, light: lightGround },
    ink: { dark: darkInk, light: lightInk },
  };
}
