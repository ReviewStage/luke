import { backToWords } from "@repo/features/words";
import { APP_COMMAND, type KeyedCommand } from "@repo/settings/shortcuts";
import { useMemo } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { FoldingButton, type FoldingButtonHint } from "../folding-button/folding-button.js";
import { NavItem } from "../nav-item/nav-item.js";
import { Tooltip } from "../tooltip/hint.js";

export const BACK_BUTTON_LOOK = {
  HEADER: "header",
  COLUMN: "column",
} as const;

export type BackButtonLook = (typeof BACK_BUTTON_LOOK)[keyof typeof BACK_BUTTON_LOOK];

export const NO_BACK_KEY = null;

export function BackButton({
  look = BACK_BUTTON_LOOK.HEADER,
  label,
  place,
  name,
  command: named = APP_COMMAND.BACK,
  keepFocus,
  tabbable,
  onBack,
}: {
  look?: BackButtonLook | undefined;
  label: string;
  place: string;
  name?: string | undefined;
  command?: KeyedCommand | typeof NO_BACK_KEY | undefined;
  keepFocus?: boolean | undefined;
  tabbable?: boolean | undefined;
  onBack: () => void;
}): React.JSX.Element {
  const hint = backToWords(place);
  const command = named ?? undefined;
  const WayBackHint = useMemo<FoldingButtonHint>(
    () =>
      function WayBackHint({ children }) {
        return (
          <Tooltip label={hint} command={command}>
            {children}
          </Tooltip>
        );
      },
    [hint, command],
  );
  if (look === BACK_BUTTON_LOOK.COLUMN) {
    return (
      <Tooltip label={hint} command={command}>
        <NavItem icon={<GLYPH.BACK />} keepFocus={keepFocus} onClick={onBack}>
          {label}
        </NavItem>
      </Tooltip>
    );
  }
  return (
    <FoldingButton
      label={label}
      name={name}
      icon={<GLYPH.BACK />}
      keepFocus={keepFocus}
      tabbable={tabbable}
      onClick={onBack}
      hint={WayBackHint}
    />
  );
}
