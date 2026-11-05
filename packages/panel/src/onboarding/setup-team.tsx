import { INVITATION_ROLE } from "@repo/features/workspace-invitation-wire";
import { WORKSPACE_BOUNDS } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  AVATAR_SHAPE,
  AVATAR_SIZE,
  Avatar,
  BUTTON_VARIANT,
  Button,
  FormField,
  GAP,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
  useFilePicker,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useState } from "react";
import { useAct } from "../act.js";
import { PHOTO_ACCEPT, photoOfFile } from "../workspace-photo.js";

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

/** The team step's form as it stands, and the Create its step's foot presses. */
export interface TeamFormState {
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly emails: string;
  readonly onEmails: (emails: string) => void;
  readonly photo: string | undefined;
  readonly picker: ReturnType<typeof useFilePicker>;
  /** Whether Create is out: the workspace, its photo, and its invitations going. */
  readonly busy: boolean;
  /** Why the workspace or its photo was refused, while one was. */
  readonly refusal: string | undefined;
  /** Whether a name is typed, which Create needs. */
  readonly named: boolean;
  readonly create: () => void;
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
  const { act } = useAct();
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const picker = useFilePicker({
    accept: PHOTO_ACCEPT,
    onFiles: ([picked]) => {
      if (picked === undefined) return;
      photoOfFile(picked).then((read) => {
        if ("refusal" in read) setRefusal(read.refusal);
        else {
          setRefusal(undefined);
          setPhoto(read.photo);
        }
      });
    },
  });
  const trimmed = name.trim();
  const create = async () => {
    if (trimmed === "" || busy) return;
    setBusy(true);
    setRefusal(undefined);
    let workspaceId: string;
    try {
      workspaceId = (await act(ACT_KIND.WORKSPACE_CREATE, { name: trimmed })).id;
    } catch (refused) {
      setBusy(false);
      setRefusal((refused as Error).message);
      return;
    }
    onCreated(workspaceId);
    // Note that the photo and the invitations follow the workspace made, and one refused leaves the rest standing.
    const refused: string[] = [];
    if (photo !== undefined) {
      await act(ACT_KIND.WORKSPACE_PHOTO_SET, { workspaceId, photo }).catch((why: Error) =>
        refused.push(why.message),
      );
    }
    for (const email of addressesOf(emails)) {
      await act(ACT_KIND.WORKSPACE_INVITE, {
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
    named: trimmed !== "",
    create: () => void create(),
  };
}

/** The team step's fields: the photo, the name, and who to invite, one field apart. */
export function TeamForm({ form }: { form: TeamFormState }): React.JSX.Element {
  const trimmed = form.name.trim();
  return (
    <Stack gap={GAP.FIELD}>
      <div className="flex items-center gap-control-gap">
        {trimmed === "" && form.photo === undefined ? null : (
          <ReplayMask>
            <Avatar
              name={trimmed === "" ? "Team" : trimmed}
              src={form.photo}
              size={AVATAR_SIZE.CARD}
              shape={AVATAR_SHAPE.SQUARE}
              decorative
            />
          </ReplayMask>
        )}
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={form.picker.open}>
          {form.photo === undefined ? "Add photo" : "Replace photo"}
        </Button>
        {form.picker.input}
      </div>
      <FormField label="Name">
        {(control) => (
          <TextField
            field={control}
            value={form.name}
            placeholder="Acme"
            maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
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
