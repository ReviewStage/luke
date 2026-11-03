import { useCallback } from "react";
import { cssCustomProperties } from "../../css.js";
import { COPY_LOOK, CopyButton } from "../copy-button/copy-button.js";

/**
 * build-chip.tsx -- a development build's chip: where it was cut, led by its color, copied on a press.
 *
 * A development build runs beside others on one Mac, each banded in the
 * Dock in a color of its own. This chip says the same in the window: a dot
 * of that color, then `branch @ sha`, which a press copies, as a pull
 * request's branch chip copies its name (`COPY_LOOK.CHIP`). The color is
 * a value rather than a token because the Dock's band, drawn where no
 * stylesheet is read, must wear the very same one.
 */

/** The dot a build's chip leads with, in the build's color. */
function BuildDot({ color }: { color: string }): React.JSX.Element {
  return (
    <span
      className="ui-build-dot"
      aria-hidden="true"
      style={cssCustomProperties({ "--ui-build-dot": color })}
    />
  );
}

/** A development build's `detail` in a chip led by its `color`, copied through `copy`. */
export function BuildChip({
  detail,
  color,
  copy,
}: {
  /** Where the build was cut: `branch @ sha`. */
  detail: string;
  /** Any CSS color, the one its Dock band wears. */
  color: string;
  copy: (text: string) => Promise<void>;
}): React.JSX.Element {
  const lead = useCallback(() => <BuildDot color={color} />, [color]);
  return <CopyButton look={COPY_LOOK.CHIP} lead={lead} text={detail} what="build" copy={copy} />;
}
