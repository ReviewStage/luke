import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { Segmented as SharedSegmented } from "@luke/ui";
import type { ComponentProps } from "react";

/**
 * segmented.tsx -- the window's segmented control, which is `@luke/ui`'s shared `Segmented`, and the settings search's landing on it.
 *
 * What is the window's own is `anchor`, the settings search id a result
 * lands on, which this adapter hands the control as its search attribute.
 */

/** The shared control, found by the settings search at `anchor` where it is given one. */
export function Segmented<Value extends string>({
  anchor,
  ...props
}: ComponentProps<typeof SharedSegmented<Value>> & {
  /** The settings search id a result lands on. */
  anchor?: string | undefined;
}): React.JSX.Element {
  return (
    <SharedSegmented<Value>
      {...props}
      {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
    />
  );
}
