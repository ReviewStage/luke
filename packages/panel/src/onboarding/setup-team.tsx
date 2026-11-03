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
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
  useFilePicker,
} from "@repo/ui";
import { useState } from "react";
import { useAct } from "../act.js";
import { PHOTO_ACCEPT, photoOfFile } from "../workspace-photo.js";

/**
 * setup-team.tsx -- setup's team step: the team's workspace named, its photo picked, and the team invited, made at once on Create.
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

/**
 * The team step's form. `onCreated` hears the workspace made, by its id, the
 * moment it is made, so a reload while its photo and invitations go out does
 * not make it again; `onDone` hears, once they have gone, what was refused.
 */
export function TeamForm({
  onCreated,
  onDone,
}: {
  onCreated: (workspaceId: string) => void;
  onDone: (refused: readonly string[]) => void;
}): React.JSX.Element {
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
  return (
    <div className="flex flex-col gap-control-gap">
      <div className="flex items-center gap-control-gap">
        {trimmed === "" && photo === undefined ? null : (
          <Avatar
            name={trimmed === "" ? "Team" : trimmed}
            src={photo}
            size={AVATAR_SIZE.CARD}
            shape={AVATAR_SHAPE.SQUARE}
            decorative
          />
        )}
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={picker.open}>
          {photo === undefined ? "Add photo" : "Replace photo"}
        </Button>
        {picker.input}
      </div>
      <FormField label="Name">
        {(control) => (
          <TextField
            field={control}
            value={name}
            placeholder="Acme"
            maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
            onChange={setName}
            onEnter={() => void create()}
          />
        )}
      </FormField>
      <FormField label="Invite by email" optional>
        {(control) => (
          <TextField
            field={control}
            value={emails}
            placeholder="dana@acme.dev, theo@acme.dev"
            onChange={setEmails}
          />
        )}
      </FormField>
      {refusal === undefined ? null : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {refusal}
        </Text>
      )}
      <div className="flex justify-end">
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          disabled={trimmed === ""}
          busy={busy}
          busyLabel="Creating"
          onClick={() => void create()}
        >
          Create
        </Button>
      </div>
    </div>
  );
}
