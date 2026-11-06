import type { Ref } from "react";
import { cssCustomProperties } from "../../css.js";
import { pulseOnPress } from "../../press-pulse.js";

export function Swatch({
  color,
  label,
  pressed,
  tabbable,
  onClick,
  ref,
}: {
  color?: string | undefined;
  label: string;
  pressed: boolean;
  tabbable?: boolean | undefined;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement> | undefined;
}): React.JSX.Element {
  return (
    <button
      ref={ref}
      type="button"
      className="ui-swatch"
      aria-label={label}
      aria-pressed={pressed}
      tabIndex={tabbable === false ? -1 : undefined}
      data-none={color === undefined || undefined}
      style={color === undefined ? undefined : cssCustomProperties({ "--ui-swatch": color })}
      onClick={pulseOnPress(onClick)}
    />
  );
}
