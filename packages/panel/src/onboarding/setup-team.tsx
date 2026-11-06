import { andList } from "@repo/features/words";
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
import { type Ref, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { useWorkspacePhotoPick } from "../workspace-photo.js";

/**
 * setup-team.tsx -- setup's team step: the team's workspace named, its photo picked, and the team invited, made at once on Create in the step's foot.
 *
 * The workspace is made first, then its photo set and each address invited
 * as a member. A photo or an invitation refused does not undo the
 * workspace: the step says what was refused, and goes on at Continue, since
 * both can be done again in Settings › Workspace. Back onto the step once
 * the workspace is made finds the same fields over it, where Continue saves
 * what changed, so the step never stands as a bare line saying it was made.
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
  /** The addresses invited from this form, said under the invite field once the workspace is made. */
  readonly invited: readonly string[];
  /** What was refused, said under the fields, while something was. */
  readonly refusal: string | undefined;
  /** What the last Create or Continue had refused of the photo, the name, or an invitation, said under the fields. */
  readonly refused: readonly string[];
  /** Enter in the name: makes the workspace, or saves what changed once it is made. */
  readonly create: () => void;
}

/** The team step's form as it stands, and the Create its step's foot presses. */
export interface TeamFormState extends TeamFields {
  /** Whether Create is out: the workspace, its photo, and its invitations going. */
  readonly busy: boolean;
  /** Whether a name is typed and no photo is still being read, which Create needs. */
  readonly ready: boolean;
}

/** What the workspace holds as this form last wrote it: its name, its photo, and who was invited. */
interface TeamSaved {
  readonly name: string | undefined;
  readonly photo: string | undefined;
  readonly invited: readonly string[];
}

const NOTHING_SAVED: TeamSaved = { name: undefined, photo: undefined, invited: [] };

/**
 * The team step's form. `onCreated` hears the workspace made, by its id, the
 * moment it is made, so a reload while its photo and invitations go out does
 * not make it again; `onDone` hears, once they have gone, what was refused.
 * Once the caller holds the workspace made (`made`), the form stands over it
 * rather than making another: its name comes back from the list
 * (`madeName`) where a reload lost what was typed, and the same press saves
 * a new name, a new photo, and the addresses not yet invited. Note that what
 * was refused is said once and not tried again, so Continue never holds the
 * step on a refusal that would only come back; the name alone goes back to
 * the one the workspace holds. Note that the form's state is held here
 * rather than in `TeamForm`, because Create stands in the step's foot,
 * outside the form.
 */
export function useTeamForm({
  made,
  madeName,
  onCreated,
  onDone,
}: {
  made: string | undefined;
  madeName: string | undefined;
  onCreated: (workspaceId: string) => void;
  onDone: (refused: readonly string[]) => void;
}): TeamFormState {
  const { act } = useAct();
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<readonly string[]>([]);
  const [saved, setSaved] = useState<TeamSaved>(NOTHING_SAVED);
  const { photo, reading, picker } = useWorkspacePhotoPick(setRefusal);
  // A workspace made before a reload comes back under its own name, where the field lost what was typed.
  useEffect(() => {
    if (madeName !== undefined) setName((typed) => (typed === "" ? madeName : typed));
  }, [madeName]);
  const trimmed = name.trim();
  const ready = trimmed !== "" && !reading;
  const create = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setRefusal(undefined);
    const missed: string[] = [];
    let workspaceId = made;
    let named = saved.name ?? madeName;
    if (workspaceId === undefined) {
      try {
        workspaceId = (await act(ACT_KIND.WORKSPACE_CREATE, { name: trimmed })).id;
      } catch (failed) {
        setBusy(false);
        setRefusal((failed as Error).message);
        return;
      }
      named = trimmed;
      onCreated(workspaceId);
    } else if (trimmed !== named) {
      const renamed = await act(ACT_KIND.WORKSPACE_RENAME, { workspaceId, name: trimmed }).then(
        () => true,
        (why: Error) => {
          missed.push(why.message);
          return false;
        },
      );
      if (renamed) named = trimmed;
      else if (named !== undefined) setName(named);
    }
    // Note that the photo and the invitations follow the workspace made, and one refused leaves the rest standing.
    if (photo !== undefined && photo !== saved.photo) {
      await act(ACT_KIND.WORKSPACE_PHOTO_SET, { workspaceId, photo }).catch((why: Error) =>
        missed.push(why.message),
      );
    }
    const invited = [...saved.invited];
    for (const email of addressesOf(emails)) {
      if (invited.includes(email)) continue;
      await act(ACT_KIND.WORKSPACE_INVITE, {
        workspaceId,
        email,
        role: INVITATION_ROLE.MEMBER,
      }).then(
        () => invited.push(email),
        (why: Error) => missed.push(`${email}: ${why.message}`),
      );
    }
    setSaved({ name: named, photo, invited });
    setEmails("");
    setRefused(missed);
    setBusy(false);
    onDone(missed);
  };
  return {
    name,
    onName: setName,
    emails,
    onEmails: setEmails,
    photo,
    picker,
    invited: saved.invited,
    busy,
    refusal,
    refused,
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
      <FormField
        label="Invite by email"
        optional
        description={
          form.invited.length === 0 ? undefined : (
            <>
              Invited <ReplayMask>{andList(form.invited)}</ReplayMask>
            </>
          )
        }
      >
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
      {[...(form.refusal === undefined ? [] : [form.refusal]), ...form.refused].map((words) => (
        <Text key={words} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          <ReplayMask>{words}</ReplayMask>
        </Text>
      ))}
    </Stack>
  );
}
