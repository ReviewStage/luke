import { FoldingButton as SharedFoldingButton } from "@luke/ui";
import type { ComponentProps } from "react";
import { Tooltip } from "./tooltip.js";

/**
 * folding-button.tsx -- a toolbar's labelled button whose words a narrow toolbar folds away, drawn with `@luke/ui`'s, named by the window's pill.
 *
 * The button, its fold, and whether its words are folded are the shared
 * one's. What is the window's own is the hint it raises while they are: the
 * window's pill, on its wait and warm spell (`tooltip.tsx`).
 */

/** A labelled toolbar button, its glyph then its words, the words folding away where its toolbar says so. */
export function FoldingButton(
  props: Omit<ComponentProps<typeof SharedFoldingButton>, "hint">,
): React.JSX.Element {
  return <SharedFoldingButton {...props} hint={Tooltip} />;
}
