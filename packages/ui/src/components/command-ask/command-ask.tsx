import { useId, useRef } from "react";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { DIALOG_ROLE, DIALOG_SIZE, Dialog } from "../dialog/dialog.js";
import { FILE_TEXT_EXTENT, FileText } from "../file-text/file-text.js";
import { TEXT_TONE, Text } from "../text/text.js";

/**
 * command-ask.tsx -- a command an agent asks to run on this Mac, put to the developer as a modal over the window: the command as written, then Deny, Allow all commands, and Allow once.
 *
 * The window asks the way a permission prompt does: it dims, a card asks
 * its question over the exact command, mono and whole, scrolling past a
 * few lines so a long one never fills the card, and the three answers sit
 * at its foot, the safe one first. Allow all commands is not a wider
 * once: it sets This Mac's setting to Always allow, so a line above the
 * answers says what it lets through and where it is undone, and that line,
 * not the command, is the card's description, since a payload of thousands
 * of characters would be read out before the answers; the command stands as
 * its own named region instead. The card is a wide one, since a question's
 * measure has no room for the three answers in the web's type.
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

/** The answer that lets every later command through, which the line below names as its button does. */
const ALLOW_ALL = "Allow all commands";

/** What the card says Allow all commands does, and where it is undone. */
const ALLOW_ALL_LINE = `${ALLOW_ALL} lets every agent run commands on this Mac without asking. You can change it in Settings › This Mac.`;

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
  const lineId = useId();
  return (
    <Dialog
      open={open}
      role={DIALOG_ROLE.ALERT_DIALOG}
      size={DIALOG_SIZE.WIDE}
      title={TITLE}
      describedBy={lineId}
      initialFocus={deny}
      onDismiss={onDeny}
      onExited={onExited}
      actions={
        <>
          <Button ref={deny} variant={BUTTON_VARIANT.QUIET} onClick={onDeny}>
            Deny
          </Button>
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onAllowAlways}>
            {ALLOW_ALL}
          </Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onAllowOnce}>
            Allow once
          </Button>
        </>
      }
    >
      <FileText text={command} label={COMMAND_LABEL} extent={FILE_TEXT_EXTENT.BRIEF} />
      <Text id={lineId} tone={TEXT_TONE.MUTED}>
        {ALLOW_ALL_LINE}
      </Text>
    </Dialog>
  );
}
