import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * status-dot.tsx -- a dot in a status tone at a row's end, as a chat app marks who is online: a device in Runs on's menu.
 *
 * The dot stands in its own glyph-sized box, so a column of rows lines their
 * dots up with the check beside them, and it says its words to a reader and
 * on hover, since a colour alone says nothing to a reader or an eye that
 * cannot tell the inks apart. It is for a row too narrow to say its standing
 * in words beside a long name, where words would fade to their first letter;
 * where there is room, a `Badge` says it in words.
 */

/** A dot in `tone`, called `label`. */
export function StatusDot({
  tone = STATUS_TONE.NEUTRAL,
  label,
}: {
  tone?: StatusTone | undefined;
  /** What the dot says: the standing it stands for. */
  label: string;
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <span
        className="luke-status-dot inline-flex size-control-icon flex-none items-center justify-center"
        data-tone={tone}
        role="img"
        aria-label={label}
      >
        <span className="size-status-dot rounded-disc bg-tone-ink" />
      </span>
    </Tooltip>
  );
}
