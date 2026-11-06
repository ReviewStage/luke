import type { ReactNode } from "react";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { Tooltip } from "../tooltip/hint.js";

export function StatusGlyph({
  tone = STATUS_TONE.NEUTRAL,
  label,
  children,
}: {
  tone?: StatusTone | undefined;
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <span
        className="ui-status-glyph relative inline-flex"
        data-tone={tone}
        role="img"
        aria-label={label}
      >
        {children}
        <span className="ui-status-glyph-dot" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
