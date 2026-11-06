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

export interface TeamFields {
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly invitees: Invitees;
  readonly photo: string | undefined;
  readonly picker: FilePicker;
  readonly onRemovePhoto: (() => void) | undefined;
  readonly refusal: string | undefined;
  readonly create: () => void;
}

export interface TeamFormState extends TeamFields {
  readonly busy: boolean;
  readonly ready: boolean;
  readonly label: string;
  readonly busyLabel: string;
}

export interface TeamMade {
  readonly id: string;
  readonly name: string | undefined;
}

const PRESS = {
  CREATE: "create",
  SAVE: "save",
} as const;

type Press = (typeof PRESS)[keyof typeof PRESS];

const PRESS_WORDS = {
  [PRESS.CREATE]: { label: "Create", busy: "Creating" },
  [PRESS.SAVE]: { label: "Save", busy: "Saving" },
} as const satisfies Record<Press, { label: string; busy: string }>;

function pressWords(made: boolean, changed: boolean): string {
  if (!made) return PRESS_WORDS[PRESS.CREATE].label;
  return changed ? PRESS_WORDS[PRESS.SAVE].label : "Continue";
}

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
  const [pressing, setPressing] = useState<Press | undefined>(undefined);
  const busy = pressing !== undefined;
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [setPhoto, setSetPhoto] = useState<string | undefined>(undefined);
  const invitees = useInvitees(signedIn?.email);
  const { photo, reading, picker, clear } = useWorkspacePhotoPick(setRefusal);
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

  const write = async (workspaceId: string, emails: readonly string[]) => {
    const refused: string[] = [];
    if (newPhoto) {
      await setWorkspacePhoto({ workspaceId, photo }).then(
        () => setSetPhoto(photo),
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
                placeholder="Team name"
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
              placeholder="name@example.com"
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
