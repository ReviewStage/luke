import { INVITATION_ROLE } from "@repo/features/workspace-invitation-wire";
import { WORKSPACE_BOUNDS } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type FilePicker,
  FormField,
  GAP,
  PhotoPick,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useMutation } from "@tanstack/react-query";
import { type Ref, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useWorkspacePhotoPick } from "../workspace-photo.js";

/**
 * setup-team.tsx -- setup's team step: the team's workspace named, its photo picked, and the team invited, made at once on Create in the step's foot.
 *
 * The workspace is made first, then its photo set and each address invited
 * as a member. A photo or an invitation refused does not undo the
 * workspace: the step says what was refused, and goes on at Continue, since
 * both can be done again in Settings › Workspace.
 */

/** The addresses typed into the invite field, each once. */
function addressesOf(words: string): readonly string[] {
  return [...new Set(words.split(/[\s,;]+/u).filter((one) => one.includes("@")))];
}

/** What the team's fields draw from, in setup's team step and New workspace's card alike. */
export interface TeamFields {
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly emails: string;
  readonly onEmails: (emails: string) => void;
  readonly photo: string | undefined;
  readonly picker: FilePicker;
  /** What was refused, said under the fields, while something was. */
  readonly refusal: string | undefined;
  /** Enter in the name: makes the workspace. */
  readonly create: () => void;
}

/** The team step's form as it stands, and the Create its step's foot presses. */
export interface TeamFormState extends TeamFields {
  /** Whether Create is out: the workspace, its photo, and its invitations going. */
  readonly busy: boolean;
  /** Whether a name is typed and no photo is still being read, which Create needs. */
  readonly ready: boolean;
}

/**
 * The team step's form. `onCreated` hears the workspace made, by its id, the
 * moment it is made, so a reload while its photo and invitations go out does
 * not make it again; `onDone` hears, once they have gone, what was refused.
 * Note that the form's state is held here rather than in `TeamForm`, because
 * Create stands in the step's foot, outside the form.
 */
export function useTeamForm({
  onCreated,
  onDone,
}: {
  onCreated: (workspaceId: string) => void;
  onDone: (refused: readonly string[]) => void;
}): TeamFormState {
  const { mutateAsync: createWorkspace } = useMutation(actMutation(ACT_KIND.WORKSPACE_CREATE));
  const { mutateAsync: setWorkspacePhoto } = useMutation(actMutation(ACT_KIND.WORKSPACE_PHOTO_SET));
  const { mutateAsync: invite } = useMutation(actMutation(ACT_KIND.WORKSPACE_INVITE));
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const { photo, reading, picker } = useWorkspacePhotoPick(setRefusal);
  const trimmed = name.trim();
  const ready = trimmed !== "" && !reading;
  const create = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setRefusal(undefined);
    let workspaceId: string;
    try {
      workspaceId = (await createWorkspace({ name: trimmed })).id;
    } catch (refused) {
      setBusy(false);
      setRefusal((refused as Error).message);
      return;
    }
    onCreated(workspaceId);
    // Note that the photo and the invitations follow the workspace made, and one refused leaves the rest standing.
    const refused: string[] = [];
    if (photo !== undefined) {
      await setWorkspacePhoto({ workspaceId, photo }).catch((why: Error) =>
        refused.push(why.message),
      );
    }
    for (const email of addressesOf(emails)) {
      await invite({
        workspaceId,
        email,
        role: INVITATION_ROLE.MEMBER,
      }).catch((why: Error) => refused.push(`${email}: ${why.message}`));
    }
    setBusy(false);
    onDone(refused);
  };
  return {
    name,
    onName: setName,
    emails,
    onEmails: setEmails,
    photo,
    picker,
    busy,
    refusal,
    ready,
    create: () => void create(),
  };
}

/**
 * The team's fields: the photo, the name, and who to invite, one field
 * apart, as setup's team step and New workspace both draw them. A card that
 * lands focus in the name hands its `nameRef`, one that says a refusal of
 * the name on its field hands `nameError`, and `disabled` stills every field
 * while the workspace is being made.
 */
export function TeamForm({
  form,
  nameRef,
  nameError,
  disabled = false,
}: {
  form: TeamFields;
  nameRef?: Ref<HTMLInputElement> | undefined;
  nameError?: ShownError | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      <PhotoPick
        name={form.name}
        unnamed="Team"
        photo={form.photo}
        picker={form.picker}
        disabled={disabled}
      />
      <FormField label="Name" error={nameError}>
        {(control) => (
          <TextField
            ref={nameRef}
            field={control}
            value={form.name}
            placeholder="Acme"
            spellCheck={false}
            maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
            disabled={disabled}
            onChange={form.onName}
            onEnter={form.create}
          />
        )}
      </FormField>
      <FormField label="Invite by email" optional>
        {(control) => (
          <TextField
            field={control}
            value={form.emails}
            placeholder="dana@acme.dev, theo@acme.dev"
            spellCheck={false}
            disabled={disabled}
            onChange={form.onEmails}
          />
        )}
      </FormField>
      {form.refusal === undefined ? null : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          <ReplayMask>{form.refusal}</ReplayMask>
        </Text>
      )}
    </Stack>
  );
}
