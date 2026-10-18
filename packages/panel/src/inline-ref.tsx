import { InlineRef as SharedInlineRef } from "@luke/ui";
import type { ComponentProps } from "react";
import { Tooltip } from "./tooltip.js";

/**
 * inline-ref.tsx -- a thing named in a line of words, drawn with `@luke/ui`'s, hanging its card on the window's hint.
 *
 * The token, its look, and its press are the shared one's. What is the
 * window's own is the hint it hangs: the window's pill or card, on its wait
 * and warm spell (`tooltip.tsx`).
 */

/** A thing named in a line: its glyph, name, and standing as one target hanging its card. */
export function InlineRef(
  props: Omit<ComponentProps<typeof SharedInlineRef>, "hint">,
): React.JSX.Element {
  return <SharedInlineRef {...props} hint={Tooltip} />;
}
