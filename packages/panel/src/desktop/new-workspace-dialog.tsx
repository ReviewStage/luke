import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { DIALOG_TONE, Dialog, DialogActions, type DialogConfirm, useConfirmDialog } from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useRef, useState } from "react";
import { confirmFailure } from "../failure-report.js";
import { addressesOf, TeamForm } from "../onboarding/setup-team.js";
import type { WorkspaceMade } from "../tasks/use-tasks-tab.js";
import { useWorkspacePhotoPick } from "../workspace-photo.js";
import { useFormDialog } from "./use-form-dialog.js";

/**
 * new-workspace-dialog.tsx -- the prompt the switcher's New workspace opens: setup's team fields (a photo, the name, who to invite), Cancel, and Create workspace.
 *
 * It is a dialog with a form in it, so it dims the window, keeps Tab inside,
 * hands focus back to whatever opened it, and says a refusal on the name
 * field, marked invalid, with the name left as typed for another try. The name is held to the service's
 * bound in the shared text field; Create workspace stands unavailable until
 * a name is typed, Enter creates, and Escape or a press on the dimmed window
 * cancels. Its fields are setup's team step's own (`TeamForm`), so the two
 * ask the same: a photo, set once the workspace is made, and the addresses
 * invited to it then; a pick that cannot be a photo says why under the
 * fields, and Create waits while a pick is still being read. Each opening
 * starts empty, so a canceled one is never offered again, and the question
 * goes with the sidebar folding away or the account signing out.
 */

/** Why a blank name was not sent, which the field says when Enter asks it. */
const NAME_ASKED = "Name the workspace.";

/** New workspace's ask: the press that opens the card, and the card. */
export interface NewWorkspaceAsk {
  ask: () => void;
  dialog: React.JSX.Element;
}

/** New workspace's ask, opened by `ask()`, and the card that asks it, standing only while `surfaceOpen`. */
export function useNewWorkspaceDialog(
  onCreate: (name: string, made: WorkspaceMade) => Promise<string | undefined>,
  surface: { signedIn: boolean; surfaceOpen: boolean },
): NewWorkspaceAsk {
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [photoRefusal, setPhotoRefusal] = useState<string | undefined>(undefined);
  const photo = useWorkspacePhotoPick(setPhotoRefusal);
  const field = useRef<HTMLInputElement | null>(null);
  const confirm: DialogConfirm = useConfirmDialog(
    { subject: surface.signedIn, surfaceOpen: surface.surfaceOpen },
    (): Promise<ActionResult> => {
      const trimmed = name.trim();
      if (trimmed === "") {
        return Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: NAME_ASKED });
      }
      return onCreate(trimmed, { photo: photo.photo, invite: addressesOf(emails) }).then(
        (refused) => {
          if (refused !== undefined)
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: refused };
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        },
      );
    },
    confirmFailure(FAILURE_SURFACE.WORKSPACE_CREATE),
  );
  const forget = () => {
    setName("");
    setEmails("");
    setPhotoRefusal(undefined);
    photo.clear();
  };
  const blank = name.trim() === "";
  const form = useFormDialog(confirm, !blank && !photo.reading);
  const dialog = (
    <Dialog
      open={form.open}
      replayUnmasked
      title="New workspace"
      busy={form.settling}
      refused={form.refusal !== undefined}
      initialFocus={field}
      onDismiss={form.dismiss}
      // Note that the fields are let go once the card has faded, so they stay while it goes.
      onExited={forget}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: "Create workspace",
            tone: DIALOG_TONE.PRIMARY,
            running: "Creating workspace",
            ...form.act,
          }}
        />
      }
    >
      <TeamForm
        nameRef={field}
        disabled={form.settling}
        nameError={
          form.refusal === undefined || form.refusal.words === NAME_ASKED
            ? form.refusal
            : { ...form.refusal, words: <ReplayMask>{form.refusal.words}</ReplayMask> }
        }
        form={{
          name,
          onName: (value) => {
            setName(value);
            // Note that a refused answer has settled, so the refusal alone holds
            // the card up: the question is asked again rather than cleared, or
            // the first key typed after it would close the card.
            if (confirm.rejection !== undefined) confirm.ask();
          },
          emails,
          onEmails: setEmails,
          photo: photo.photo,
          picker: photo.picker,
          refusal: photoRefusal,
          // Note that Enter on a blank name is asked anyway, so the field says why it was not sent.
          create: blank ? confirm.run : form.submit,
        }}
      />
    </Dialog>
  );
  return {
    ask: () => {
      forget();
      confirm.ask();
    },
    dialog,
  };
}
