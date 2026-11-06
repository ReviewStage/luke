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
import { useRef, useState } from "react";
import { useAct } from "../act.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure } from "../failure-report.js";
import { useInvitees, useSignedIn } from "../invitees.js";
import { replayMaskedError } from "./marks.js";

/**
 * invite-dialog.tsx -- Members' Invite: the card that invites one address or several, as a member or, for the owner, an admin.
 *
 * The addresses are typed or pasted into one field of chips (`invitees.ts`),
 * so a list pasted from anywhere lands whole, each checked as the service
 * reads it as it lands, and Invite waits while one is wrong. Then each is
 * invited in turn, one act at a time; one refused stops the run there, the
 * card saying why with that address and those after it left in the field
 * for another try, the ones before it already invited and listed under the
 * members. The role is
 * the owner's to choose, since only the owner invites an admin; an admin's
 * card offers none and invites a member.
 */

/** The roles an invitation offers, in the order the bar draws them, the default first. */
const INVITATION_ROLES = [INVITATION_ROLE.MEMBER, INVITATION_ROLE.ADMIN] as const;

/** What the field says where an address typed is none the service invites, each marked under the field with why. */
const MALFORMED = "Enter only email addresses.";

function refused(reason: string): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** Members' Invite: the press that opens the card, and the card. */
export interface InviteAsk {
  ask: () => void;
  dialog: React.JSX.Element;
}

/** The Invite card for `workspaceName`, its role chosen only where the reader is the `owner`. */
export function useInviteDialog({
  workspaceId,
  workspaceName,
  owner,
}: {
  workspaceId: string;
  workspaceName: string;
  owner: boolean;
}): InviteAsk {
  const { act } = useAct();
  const invitees = useInvitees(useSignedIn()?.email);
  const [role, setRole] = useState<WorkspaceInvitation["role"]>(INVITATION_ROLE.MEMBER);
  const field = useRef<HTMLInputElement | null>(null);

  // Note that a second press joins the run under way rather than starting
  // another, because it can land before the render that stills the act.
  const flight = useRef<Promise<ActionResult> | undefined>(undefined);
  const send = (): Promise<ActionResult> => {
    flight.current ??= sendAll().finally(() => {
      flight.current = undefined;
    });
    return flight.current;
  };

  // Note that the run reads the addresses it was asked with, and leaves in
  // the field only those it did not invite, so a retry sends none twice.
  const sendAll = (): Promise<ActionResult> => {
    const { pending: addresses, wrong } = invitees.commit();
    if (wrong > 0) return Promise.resolve(refused(MALFORMED));
    return addresses.reduce<Promise<ActionResult>>(
      (before, email, index) =>
        before.then((result) =>
          result.status !== ACTION_RESULT_STATUS.ACCEPTED
            ? result
            : act(ACT_KIND.WORKSPACE_INVITE, {
                workspaceId,
                email,
                // Note that a reader no longer the owner invites a member, whatever the bar last held.
                role: owner ? role : INVITATION_ROLE.MEMBER,
              }).then(
                () => result,
                (refusal: Error) => {
                  invitees.keep(addresses.slice(index));
                  return refused(refusal.message);
                },
              ),
        ),
      Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    );
  };

  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    send,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_INVITE),
  );
  const form = useFormDialog(confirm, invitees.pending.length > 0 && invitees.wrong === 0);
  const dialog = (
    <Dialog
      open={form.open}
      title={`Invite to ${workspaceName}`}
      // Note that its own words show in a screen recording, but its title, which names the workspace, and a refusal, which can quote an address, stay masked.
      replayUnmasked
      titleReplayMasked
      busy={form.settling}
      refused={form.refusal !== undefined}
      initialFocus={field}
      onDismiss={form.dismiss}
      // Note that the addresses are let go once the card has faded, so the words stay while it goes.
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
            // Note that the addresses are a person's words drawn as chips, so they stay masked in a screen recording.
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
                // Note that a refusal alone holds the card up, so a change to the addresses asks the question again rather than clearing it.
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
