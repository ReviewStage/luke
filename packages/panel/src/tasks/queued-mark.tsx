import { Badge, STATUS_TONE } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";

/**
 * queued-mark.tsx -- the mark under a line the developer queued behind the agent's turn: "Queued", until a turn takes it.
 *
 * A message sent with ⌘↩ or the chevron beside Send while a turn runs
 * (`send-options.tsx`) waits for that turn to end and opens the next. Until
 * then it stands at the transcript's foot, its bubble faded
 * (`tasks.css`'s `.is-user[data-queued]`) with this mark under it, and once
 * the next turn takes it the mark goes and it stands as that turn's opening.
 */

/** What the mark says. */
const QUEUED_WORDS = "Queued";

/** The mark under a queued line. */
export function QueuedMark(): React.JSX.Element {
  return (
    <Badge tone={STATUS_TONE.NEUTRAL} icon={<GLYPH.TIME />}>
      {QUEUED_WORDS}
    </Badge>
  );
}
