import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  INVITATION_ROLE,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  CHOICE_BAR_LOOK,
  ChoiceBar,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  EmailChipsField,
  FormField,
  Stack,
  useConfirmDialog,
} from "@repo/ui";
import { ROLE_WORDS } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { sendAct } from "../act.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure } from "../failure-report.js";
import { useInvitees, useSignedIn } from "../invitees.js";
import { replayMaskedError } from "./marks.js";

const INVITATION_ROLES = [INVITATION_ROLE.MEMBER, INVITATION_ROLE.ADMIN] as const;

function refused(reason: string): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

export interface InviteAsk {
  ask: () => void;
  dialog: React.JSX.Element;
}

export function useInviteDialog({
  workspaceId,
  workspaceName,
  owner,
}: {
  workspaceId: string;
  workspaceName: string;
  owner: boolean;
}): InviteAsk {
  const invitees = useInvitees(useSignedIn()?.email);
  const [role, setRole] = useState<WorkspaceInvitation["role"]>(INVITATION_ROLE.MEMBER);
  const field = useRef<HTMLInputElement | null>(null);

  const inviting = useMutation({
    mutationKey: [ACT_KIND.WORKSPACE_INVITE, workspaceId],
    mutationFn: (asked: readonly string[]): Promise<ActionResult> =>
      asked.reduce<Promise<ActionResult>>(
        (before, email, index) =>
          before.then((result) =>
            result.status !== ACTION_RESULT_STATUS.ACCEPTED
              ? result
              : sendAct(ACT_KIND.WORKSPACE_INVITE, {
                  workspaceId,
                  email,
                  role: owner ? role : INVITATION_ROLE.MEMBER,
                }).then(
                  () => result,
                  (refusal: Error) => {
                    invitees.keep(asked.slice(index));
                    return refused(refusal.message);
                  },
                ),
          ),
        Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      ),
  });
  const flight = useRef<Promise<ActionResult> | undefined>(undefined);
  const send = (): Promise<ActionResult> => {
    flight.current ??= inviting.mutateAsync(invitees.commit().pending).finally(() => {
      flight.current = undefined;
    });
    return flight.current;
  };

  const confirmAct = useConfirmAct(inviting, {
    send: send,
    answered: sameAnswer,
  });
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_INVITE),
  );
  const form = useFormDialog(confirm, invitees.pending.length > 0);
  const dialog = (
    <Dialog
      open={form.open}
      title={`Invite to ${workspaceName}`}
      replayUnmasked
      titleReplayMasked
      busy={form.settling}
      refused={form.refusal !== undefined}
      initialFocus={field}
      onDismiss={form.dismiss}
      onExited={() => {
        invitees.clear();
        setRole(INVITATION_ROLE.MEMBER);
      }}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: "Invite",
            tone: DIALOG_TONE.PRIMARY,
            running: "Inviting",
            ...form.act,
          }}
        />
      }
    >
      <Stack>
        <FormField label="Email addresses" error={replayMaskedError(form.refusal)}>
          {(control) => (
            <ReplayMask>
              <EmailChipsField
                ref={field}
                field={control}
                chips={invitees.chips}
                typed={invitees.typed}
                onTyped={invitees.onTyped}
                placeholder="name@example.com"
                disabled={form.settling}
                onSubmit={form.submit}
                onAdd={(typed) => {
                  invitees.add(typed);
                  if (confirm.rejection !== undefined) confirm.ask();
                }}
                onRemove={(id) => {
                  invitees.remove(id);
                  if (confirm.rejection !== undefined) confirm.ask();
                }}
              />
            </ReplayMask>
          )}
        </FormField>
        {owner ? (
          <ChoiceBar<WorkspaceInvitation["role"]>
            label="Role"
            items={INVITATION_ROLES.map((one) => ({ value: one, label: ROLE_WORDS[one] }))}
            value={role}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            stretch
            disabled={form.settling}
            onChange={setRole}
          />
        ) : null}
      </Stack>
    </Dialog>
  );
  return {
    ask: () => {
      invitees.clear();
      setRole(INVITATION_ROLE.MEMBER);
      confirm.ask();
    },
    dialog,
  };
}
