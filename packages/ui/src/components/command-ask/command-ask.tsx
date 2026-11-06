import { useId, useRef } from "react";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { DIALOG_ROLE, DIALOG_SIZE, Dialog } from "../dialog/dialog.js";
import { FILE_TEXT_EXTENT, FileText } from "../file-text/file-text.js";
import { TEXT_TONE, Text } from "../text/text.js";

const TITLE = "Run this command on your Mac?";

const COMMAND_LABEL = "The command";

const ALLOW_ALL = "Allow all commands";

const ALLOW_ALL_LINE = `${ALLOW_ALL} lets every agent run commands on this Mac without asking. You can change it in Settings › This Mac.`;

export function CommandAsk({
  open,
  command,
  onAllowOnce,
  onAllowAlways,
  onDeny,
  onExited,
}: {
  open: boolean;
  command: string;
  onAllowOnce: () => void;
  onAllowAlways: () => void;
  onDeny: () => void;
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
