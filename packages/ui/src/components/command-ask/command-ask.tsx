import { useRef } from "react";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { DIALOG_ROLE, Dialog } from "../dialog/dialog.js";
import { FILE_TEXT_EXTENT, FileText } from "../file-text/file-text.js";

/**
 * command-ask.tsx -- a command an agent asks to run on this Mac, put to the developer as a modal over the window: the command as written, then Deny, Always allow, and Allow once.
 *
 * The window asks the way a permission prompt does: it dims, a card asks
 * its question over the exact command, mono and whole, scrolling past a
 * few lines so a long one never fills the card, and the three answers sit
 * at its foot, the safe one first. The command is not the card's
 * description, since a payload of thousands of characters would be read
 * out before the answers; it stands as its own named region instead.
 * Focus lands on Deny, so a key already pressed runs nothing; Escape and a
 * press on the dimmed window deny too, since a prompt waved away must not
 * run the command.
 * Whoever owns the card holds it mounted while the ask stands and passes
 * `open` as the ask goes, answered or timed out, so the card fades out
 * (`Dialog`'s `open`), taking it down once it says it is gone.
 */

/** What the card is titled. */
const TITLE = "Run this command on your Mac?";

/** The label a reader is given for the command's region. */
const COMMAND_LABEL = "The command";

export function CommandAsk({
  open,
  command,
  onAllowOnce,
  onAllowAlways,
  onDeny,
  onExited,
}: {
  /** Whether the ask stands; falling, the card fades out before it goes. */
  open: boolean;
  /** The shell command, as the agent wrote it. */
  command: string;
  /** Run it this once. */
  onAllowOnce: () => void;
  /** Run it, and every later command without asking. */
  onAllowAlways: () => void;
  /** Do not run it, which Escape and the dimmed window also answer. */
  onDeny: () => void;
  /** Its fade has run and the card is gone, which its owner takes the ask down on. */
  onExited?: (() => void) | undefined;
}): React.JSX.Element {
  const deny = useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog
      open={open}
      role={DIALOG_ROLE.ALERT_DIALOG}
      title={TITLE}
      initialFocus={deny}
      onDismiss={onDeny}
      onExited={onExited}
      actions={
        <>
          <Button ref={deny} variant={BUTTON_VARIANT.QUIET} onClick={onDeny}>
            Deny
          </Button>
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onAllowAlways}>
            Always allow
          </Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onAllowOnce}>
            Allow once
          </Button>
        </>
      }
    >
      <FileText text={command} label={COMMAND_LABEL} extent={FILE_TEXT_EXTENT.BRIEF} />
    </Dialog>
  );
}
