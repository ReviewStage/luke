import { SHOW_LESS_WORDS, showMoreWords } from "@repo/features/words";
import type { BusyProps } from "../button/button.js";
import { LINE_BUTTON_LOOK, LineButton } from "../line-button/line-button.js";
import { BusyLabel } from "../spinner/spinner.js";

export function ShowMoreRow({
  more,
  shown,
  onToggle,
  controls,
  busy,
  busyLabel,
}: BusyProps & {
  more: number;
  shown: boolean;
  onToggle: () => void;
  controls?: string | undefined;
}): React.JSX.Element | null {
  if (more <= 0) return null;
  return (
    <LineButton
      look={LINE_BUTTON_LOOK.ROW}
      brightens
      aria-expanded={shown}
      aria-controls={controls}
      aria-label={busy === true ? busyLabel : undefined}
      onClick={() => {
        if (busy !== true) onToggle();
      }}
    >
      <BusyLabel busy={busy === true} label={busyLabel ?? ""}>
        {shown ? SHOW_LESS_WORDS : showMoreWords(more)}
      </BusyLabel>
    </LineButton>
  );
}
