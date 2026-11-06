import type { MouseEvent, Ref } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { type ButtonLight, type ButtonSize, IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

export function moreLabel(thing: string): string {
  return `${thing} actions`;
}

export function MoreButton({
  thing,
  size,
  lights,
  disabled,
  tabbable,
  ref,
  onClick,
  "aria-haspopup": hasPopup,
  "aria-expanded": expanded,
  "aria-describedby": describedBy,
}: {
  thing: string;
  size?: ButtonSize | undefined;
  lights?: ButtonLight | undefined;
  disabled?: boolean | undefined;
  tabbable?: boolean | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  "aria-haspopup"?: "menu" | undefined;
  "aria-expanded"?: boolean | undefined;
  "aria-describedby"?: string | undefined;
}): React.JSX.Element {
  const label = moreLabel(thing);
  return (
    <Tooltip label={label}>
      <IconButton
        ref={ref}
        icon={<GLYPH.MORE />}
        label={label}
        {...(size === undefined ? {} : { size })}
        lights={lights}
        disabled={disabled}
        tabbable={tabbable}
        onClick={onClick}
        aria-haspopup={hasPopup}
        aria-expanded={expanded}
        aria-describedby={describedBy}
      />
    </Tooltip>
  );
}
