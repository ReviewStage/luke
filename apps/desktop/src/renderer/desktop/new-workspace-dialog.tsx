import { WORKSPACE_BOUNDS } from "@luke/features/workspace-wire";
import { ConfirmDialog, DIALOG_TONE, type DialogConfirm, useConfirmDialog } from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useRef, useState } from "react";

/**
 * new-workspace-dialog.tsx -- the small prompt the switcher's New workspace opens: a name, Cancel, and Create workspace.
 *
 * It is the confirm dialog with a field in it, so it dims the window, keeps
 * Tab inside, hands focus back to whatever opened it, and says a refusal on
 * the card with the name left as typed for another try. The name is held
 * to the service's bound and drawn in New task's name field; Enter creates,
 * and Escape or a press on the dimmed window cancels. Each opening starts
 * from an empty name, so a cancelled one is never offered again, and the
 * question goes with the sidebar folding away or the account signing out.
 */

/** Why a blank name was not sent. */
const NAME_ASKED = "Name the workspace.";

/** New workspace's ask: the press that opens the card, and the card. */
export interface NewWorkspaceAsk {
  ask: () => void;
  dialog: React.JSX.Element;
}

/** New workspace's ask, opened by `ask()`, and the card that asks it, standing only while `surfaceOpen`. */
export function useNewWorkspaceDialog(
  onCreate: (name: string) => Promise<string | undefined>,
  surface: { signedIn: boolean; surfaceOpen: boolean },
): NewWorkspaceAsk {
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  const confirm: DialogConfirm = useConfirmDialog(
    { subject: surface.signedIn, surfaceOpen: surface.surfaceOpen },
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
        verb: "Create workspace",
        running: "Creating workspace",
        tone: DIALOG_TONE.PRIMARY,
      }}
    >
      <input
        ref={field}
        className="dialog-name-field"
        aria-label="Workspace name"
        spellCheck={false}
        placeholder="Workspace name"
        maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
        value={name}
        disabled={confirm.busy}
        onChange={(event) => {
          setName(event.target.value);
          // Note that a refused answer has settled, so the refusal alone holds
          // the card up: the question is asked again rather than cleared, or
          // the first key typed after it would close the card.
          if (confirm.rejection !== undefined) confirm.ask();
        }}
      />
    </ConfirmDialog>
  );
  return {
    ask: () => {
      setName("");
      confirm.ask();
    },
    dialog,
  };
}
