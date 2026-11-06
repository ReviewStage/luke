import { WORKSPACE_BOUNDS } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  EmailChipsField,
  type FilePicker,
  Fill,
  FormField,
  GAP,
  Inline,
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
import { type Ref, useEffect, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { type Invitees, useInvitees, useSignedIn } from "../invitees.js";
import { useWorkspacePhotoPick } from "../workspace-photo.js";

/**
 * setup-team.tsx -- setup's team step: the team's workspace named, its photo picked, and the team invited, made at once on Create in the step's foot, and changed there once it stands.
 *
 * The workspace is made first, then its photo set and each address invited
 * as a member, each chip ticking from on its way to sent as its invitation
 * lands. A photo or an invitation refused does not undo the workspace: a
 * refused address stays marked with why, and the step stays to say so
 * rather than going on. Once the workspace stands, the step coming back
 * holds it as it stands: its name and photo may be changed and more people
 * invited, which Save writes, and with nothing changed the press goes on.
 */

/** What the team's fields draw from, in setup's team step and New workspace's card alike. */
export interface TeamFields {
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly invitees: Invitees;
  readonly photo: string | undefined;
  readonly picker: FilePicker;
  /** Lets the photo picked go, offered from its tile while one stands. */
  readonly onRemovePhoto: (() => void) | undefined;
  /** What was refused, said under the fields, while something was. */
  readonly refusal: string | undefined;
  /** Enter in the name: the form's way on. */
  readonly create: () => void;
}

/** The team step's form as it stands, and the press its step's foot draws. */
export interface TeamFormState extends TeamFields {
  /** Whether the press is out: the workspace, its photo, and its invitations going. */
  readonly busy: boolean;
  /** Whether a name is typed and no photo is still being read, which the press needs. */
  readonly ready: boolean;
  /** The press's words: what it will do. */
  readonly label: string;
  /** The words the press says while it is out. */
  readonly busyLabel: string;
}

/** The workspace the step made, by its id and, once the list holds it, its name. */
export interface TeamMade {
  readonly id: string;
  readonly name: string | undefined;
}

/** What a press writes: the workspace made, or the one made changed. */
const PRESS = {
  CREATE: "create",
  SAVE: "save",
} as const;

type Press = (typeof PRESS)[keyof typeof PRESS];

/** Each press's words, at rest and while it is out. */
const PRESS_WORDS = {
  [PRESS.CREATE]: { label: "Create", busy: "Creating" },
  [PRESS.SAVE]: { label: "Save", busy: "Saving" },
} as const satisfies Record<Press, { label: string; busy: string }>;

/** The press's words for what it will write: a workspace made, one changed, or nothing but going on. */
function pressWords(made: boolean, changed: boolean): string {
  if (!made) return PRESS_WORDS[PRESS.CREATE].label;
  return changed ? PRESS_WORDS[PRESS.SAVE].label : "Continue";
}

/**
 * The team step's form. `made` is the workspace the step made, if it has;
 * `onCreated` hears the workspace made, by its id, the moment it is made,
 * so a reload while its photo and invitations go out does not make it
 * again; `onDone` hears, once every write has gone, what was refused, and
 * is heard with nothing refused at once where nothing was changed. Note
 * that the form's state is held here rather than in `TeamForm`, because the
 * press stands in the step's foot, outside the form.
 */
export function useTeamForm({
  made,
  onCreated,
  onDone,
}: {
  made: TeamMade | undefined;
  onCreated: (workspaceId: string) => void;
  onDone: (refused: readonly string[]) => void;
}): TeamFormState {
  const { mutateAsync: createWorkspace } = useMutation(actMutation(ACT_KIND.WORKSPACE_CREATE));
  const { mutateAsync: renameWorkspace } = useMutation(actMutation(ACT_KIND.WORKSPACE_RENAME));
  const { mutateAsync: setWorkspacePhoto } = useMutation(actMutation(ACT_KIND.WORKSPACE_PHOTO_SET));
  const signedIn = useSignedIn();
  const [name, setName] = useState(made?.name ?? "");
  const named = useRef(made?.name !== undefined);
  // Note that a press out keeps the words it was pressed under, because the workspace it makes stands before its invitations have gone.
  const [pressing, setPressing] = useState<Press | undefined>(undefined);
  const busy = pressing !== undefined;
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [setPhoto, setSetPhoto] = useState<string | undefined>(undefined);
  const invitees = useInvitees(signedIn?.email);
  const { photo, reading, picker, clear } = useWorkspacePhotoPick(setRefusal);
  // Note that a workspace made before a reload is named once the list holds it, unless something was typed meanwhile.
  useEffect(() => {
    if (made?.name === undefined || named.current) return;
    named.current = true;
    setName(made.name);
  }, [made?.name]);
  const trimmed = name.trim();
  const renamed = made !== undefined && made.name !== undefined && trimmed !== made.name;
  const newPhoto = photo !== undefined && photo !== setPhoto;
  const changed = renamed || newPhoto || invitees.pending.length > 0;
  const ready = trimmed !== "" && !reading;

  // Note that the photo and the invitations follow the name, and one refused leaves the rest standing.
  const write = async (workspaceId: string, emails: readonly string[]) => {
    const refused: string[] = [];
    if (newPhoto) {
      await setWorkspacePhoto({ workspaceId, photo }).then(
        () => setSetPhoto(photo),
        // Note that a refused photo is said under the fields, as a refused address is beside its chip.
        (why: Error) => {
          refused.push(why.message);
          setRefusal(why.message);
        },
      );
    }
    refused.push(...(await invitees.send(workspaceId, emails)));
    setPressing(undefined);
    onDone(refused);
  };
  const create = async () => {
    if (!ready || busy) return;
    // Note that an address typed and never ended is read as the press lands, and one typed wrong is left unsent, its chip saying why.
    const { pending } = invitees.commit();
    if (made !== undefined && !renamed && !newPhoto && pending.length === 0) {
      onDone([]);
      return;
    }
    setPressing(made === undefined ? PRESS.CREATE : PRESS.SAVE);
    setRefusal(undefined);
    let workspaceId = made?.id;
    try {
      if (workspaceId === undefined) {
        workspaceId = (await createWorkspace({ name: trimmed })).id;
        onCreated(workspaceId);
      } else if (renamed) {
        await renameWorkspace({ workspaceId, name: trimmed });
      }
    } catch (refused) {
      setPressing(undefined);
      setRefusal((refused as Error).message);
      return;
    }
    await write(workspaceId, pending);
  };
  return {
    name,
    onName: (typed) => {
      named.current = true;
      setName(typed);
    },
    invitees,
    photo,
    picker,
    // Note that a photo already set on the workspace made is taken off it, and one only picked is let go.
    onRemovePhoto:
      photo === undefined
        ? undefined
        : () => {
            clear();
            if (made === undefined || setPhoto === undefined) return;
            void setWorkspacePhoto({ workspaceId: made.id, photo: null }).then(
              () => setSetPhoto(undefined),
              (why: Error) => setRefusal(why.message),
            );
          },
    busy,
    refusal,
    ready,
    label:
      pressing === undefined
        ? pressWords(made !== undefined, changed)
        : PRESS_WORDS[pressing].label,
    busyLabel: PRESS_WORDS[pressing ?? (made === undefined ? PRESS.CREATE : PRESS.SAVE)].busy,
    create: () => void create(),
  };
}

/**
 * The team's fields: the workspace's tile and its name in one row, the tile
 * itself the press that picks its photo (`PhotoPick`), as Settings ›
 * Workspace draws it too, then who to invite, as setup's team step and New
 * workspace both draw them. A card that lands focus in the name hands its
 * `nameRef`, one that says a refusal of the name on its field hands
 * `nameError`, and `disabled` stills every field while the workspace is
 * being made.
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
      <FormField label="Workspace" error={nameError}>
        {(control) => (
          <Inline wrap={false}>
            <PhotoPick
              name={form.name}
              unnamed="Team"
              photo={form.photo}
              picker={form.picker}
              onRemove={form.onRemovePhoto}
              disabled={disabled}
            />
            <Fill>
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
            </Fill>
          </Inline>
        )}
      </FormField>
      <FormField label="Add teammates by email" optional>
        {(control) => (
          <ReplayMask>
            <EmailChipsField
              field={control}
              chips={form.invitees.chips}
              typed={form.invitees.typed}
              onTyped={form.invitees.onTyped}
              placeholder="Ex. ellis@acme.dev, maria@acme.dev"
              disabled={disabled}
              onAdd={form.invitees.add}
              onRemove={form.invitees.remove}
              onSubmit={form.create}
            />
          </ReplayMask>
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
