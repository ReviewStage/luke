import { WORKSPACE_BOUNDS } from "@sidecar/hosted/workspace-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useRef, useState } from "react";
import {
  ConfirmDialog,
  DIALOG_TONE,
  type DialogConfirm,
  useConfirmDialog,
} from "../settings/confirm-dialog";

/**
 * new-workspace-dialog.tsx -- the small prompt the switcher's New workspace… opens: a name, Cancel, and Create.
 *
 * It is the confirm dialog with a field in it, so it dims the window, keeps
 * Tab inside, hands focus back to whatever opened it, and says a refusal on
 * the card with the name left as typed for another try. The name is held
 * to the service's bound; Enter creates, and Escape or a press on the dimmed
 * window cancels.
 */

/** Why a blank name was not sent. */
const NAME_ASKED = "Name the workspace.";

/** New workspace…'s ask: the press that opens the card, and the card. */
export interface NewWorkspaceAsk {
  ask: () => void;
  dialog: React.JSX.Element;
}

/** New workspace…'s ask, opened by `ask()`, and the card that asks it. */
export function useNewWorkspaceDialog(
  onCreate: (name: string) => Promise<string | undefined>,
): NewWorkspaceAsk {
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  const confirm: DialogConfirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    (): Promise<ActionResult> => {
      const trimmed = name.trim();
      if (trimmed === "") {
        return Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: NAME_ASKED });
      }
      return onCreate(trimmed).then((refused) => {
        if (refused !== undefined)
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: refused };
        setName("");
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      });
    },
  );
  const dialog = (
    <ConfirmDialog
      confirm={confirm}
      field={field}
      question={{
        title: "New workspace",
        body: "You will be its owner, and can invite people to it.",
        verb: "Create",
        running: "Creating workspace",
        tone: DIALOG_TONE.PRIMARY,
      }}
    >
      <input
        ref={field}
        className="settings-input"
        aria-label="Workspace name"
        placeholder="Workspace name"
        maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
        value={name}
        disabled={confirm.busy}
        onChange={(event) => {
          setName(event.target.value);
          confirm.clear();
        }}
      />
    </ConfirmDialog>
  );
  return { ask: confirm.ask, dialog };
}
