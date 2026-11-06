import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  INVITATION_ROLE,
  isInvitableEmail,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  CHOICE_BAR_LOOK,
  ChoiceBar,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  FormField,
  Stack,
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_TYPE,
  TextField,
  useConfirmDialog,
} from "@repo/ui";
import { ROLE_WORDS } from "@repo/ui/actor-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure } from "../failure-report.js";
import { replayMaskedError } from "./marks.js";

/**
 * invite-dialog.tsx -- Members' Invite: the card that invites one address or several, as a member or, for the owner, an admin.
 *
 * The addresses are typed into one field, split at commas, semicolons, and
 * spaces, so a list pasted from anywhere lands whole. Each is checked as the
 * service reads it before any is sent, then each is invited in turn, one
 * act at a time; one refused stops the run there, the card saying why with
 * that address and those after it left in the field for another try, the
 * ones before it already invited and listed under the members. The role is
 * the owner's to choose, since only the owner invites an admin; an admin's
 * card offers none and invites a member.
 */

/** The roles an invitation offers, in the order the bar draws them, the default first. */
const INVITATION_ROLES = [INVITATION_ROLE.MEMBER, INVITATION_ROLE.ADMIN] as const;

/** What the field says where an address typed is none the service invites, which names none of them, since a refusal is reported. */
const MALFORMED = "Enter only email addresses.";

/** Where one typed address ends and the next begins. */
const ADDRESS_BREAK = /[\s,;]+/;

/** The distinct addresses typed, in the order typed. */
function addressesOf(typed: string): string[] {
  const seen = new Set<string>();
  return typed
    .split(ADDRESS_BREAK)
    .filter((one) => one !== "")
    .filter((one) => {
      const key = one.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

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
  const { mutateAsync: sendWorkspaceInvite } = useMutation(actMutation(ACT_KIND.WORKSPACE_INVITE));
  const [typed, setTyped] = useState("");
  const [role, setRole] = useState<WorkspaceInvitation["role"]>(INVITATION_ROLE.MEMBER);
  const field = useRef<HTMLInputElement | null>(null);
  const addresses = addressesOf(typed);

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
    if (!addresses.every(isInvitableEmail)) return Promise.resolve(refused(MALFORMED));
    return addresses.reduce<Promise<ActionResult>>(
      (before, email, index) =>
        before.then((result) =>
          result.status !== ACTION_RESULT_STATUS.ACCEPTED
            ? result
            : sendWorkspaceInvite({
                workspaceId,
                email,
                // Note that a reader no longer the owner invites a member, whatever the bar last held.
                role: owner ? role : INVITATION_ROLE.MEMBER,
              }).then(
                () => result,
                (refusal: Error) => {
                  setTyped(addresses.slice(index).join(", "));
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
  const form = useFormDialog(confirm, addresses.length > 0);
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
        setTyped("");
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
            <TextField
              ref={field}
              field={control}
              type={TEXT_FIELD_TYPE.EMAIL}
              placeholder="name@example.com"
              autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
              spellCheck={false}
              value={typed}
              disabled={form.settling}
              onEnter={form.submit}
              onChange={(value) => {
                setTyped(value);
                // Note that a refusal alone holds the card up, so the question is asked again rather than cleared.
                if (confirm.rejection !== undefined) confirm.ask();
              }}
            />
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
      setTyped("");
      setRole(INVITATION_ROLE.MEMBER);
      confirm.ask();
    },
    dialog,
  };
}
