import { type ReactNode, useId, useRef, useState } from "react";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { DIALOG_ROLE, Dialog } from "../dialog/dialog.js";
import { FILE_TEXT_EXTENT, FileText } from "../file-text/file-text.js";
import { Stack } from "../layout/layout.js";
import { TEXT_TONE, Text } from "../text/text.js";
import { TEXT_BUTTON_TONE, TextButton } from "../text-button/text-button.js";

/**
 * command-ask.tsx -- a command an agent asks to run on this Mac, put to the developer as a modal over the window: the command as written, then Deny, Always allow, and Allow once.
 *
 * The window asks the way a permission prompt does, and as a confirm does:
 * it dims, and a card holds the question, one muted line under it on what
 * running it means, the exact command, mono and scrolling past a reading
 * height, and the three answers at its foot, the safe one first. A long unbroken run in the command, the
 * base64 of a payload, is shown by its head and how much of it there is,
 * since no one reads it there and it would bury the rest of the command;
 * Show all, at the foot's start, brings it back whole. Focus lands on Deny, so a key already pressed runs nothing;
 * Escape and a press on the dimmed window deny too, since a prompt waved
 * away must not run the command. The muted line says Always allow lasts
 * until This Mac's setting changes, which is the setting it writes.
 * Whoever owns the card holds it mounted while the ask stands and passes
 * `open` as the ask goes, answered or timed out, so the card fades out
 * (`Dialog`'s `open`), taking it down once it says it is gone.
 */

/** What the card is titled. */
const TITLE = "Run this command on your Mac?";

/** The label a reader is given for the command's region. */
const COMMAND_LABEL = "The command";

/** The shortest run of encoded characters that is folded: past any word, path, or hash a reader would read. */
const FOLDED_RUN_MIN = 120;

/** How much of a folded run's head stays, so a reader still sees where it starts. */
const FOLDED_RUN_HEAD = 24;

/**
 * A run of base64 or hex within one line. Note that a line break ends it,
 * because a run folded across lines would hide whatever command stands on
 * the next one.
 */
const ENCODED_RUN = new RegExp(`[A-Za-z0-9+/=]{${FOLDED_RUN_MIN},}`, "g");

/** `command` with each encoded run cut to its head and a count of what was cut. */
function foldEncodedRuns(command: string): string {
  return command.replace(ENCODED_RUN, (run) => {
    const hidden = run.length - FOLDED_RUN_HEAD;
    return `${run.slice(0, FOLDED_RUN_HEAD)}… (${hidden.toLocaleString("en-US")} more)`;
  });
}

export function CommandAsk({
  open,
  command,
  onAllowOnce,
  onAllowAlways,
  onDeny,
  onExited,
  settingsPage,
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
  /** The page of Settings the asking is changed in, as the window links it by name; settings at large where none. */
  settingsPage?: ReactNode;
}): React.JSX.Element {
  const deny = useRef<HTMLButtonElement | null>(null);
  const bodyId = useId();
  const commandId = useId();
  const [whole, setWhole] = useState(false);
  const folded = foldEncodedRuns(command);
  const shortened = folded !== command;
  return (
    <Dialog
      open={open}
      role={DIALOG_ROLE.ALERT_DIALOG}
      title={TITLE}
      describedBy={bodyId}
      initialFocus={deny}
      onDismiss={onDeny}
      onExited={onExited}
      actionsStart={
        shortened ? (
          <TextButton
            tone={TEXT_BUTTON_TONE.ACCENT}
            aria-expanded={whole}
            aria-controls={commandId}
            onClick={() => setWhole(!whole)}
          >
            {whole ? "Shorten" : "Show all"}
          </TextButton>
        ) : null
      }
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
      <Stack>
        <Text tone={TEXT_TONE.MUTED} id={bodyId}>
          Runs from your home folder, and the agent sees what it prints. Always allow lasts until
          you change it in {settingsPage === undefined ? null : <>{settingsPage} </>}settings.
        </Text>
        <div id={commandId}>
          <FileText
            text={whole ? command : folded}
            label={COMMAND_LABEL}
            extent={FILE_TEXT_EXTENT.WHOLE}
          />
        </div>
      </Stack>
    </Dialog>
  );
}
