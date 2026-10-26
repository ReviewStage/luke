import { CHANNEL_BOUNDS, type Channel } from "@luke/features/channel-wire";
import {
  DIALOG_TONE,
  Dialog,
  DialogActions,
  ErrorLine,
  FormField,
  Stack,
  TEXT_TONE,
  Text,
  TextField,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useId, useRef, useState } from "react";
import { channelEditable, channelSlug } from "../tasks/channels-model.js";
import type { ChannelsControl } from "../tasks/use-channels.js";
import { useFormDialog } from "./use-form-dialog.js";

/**
 * channel-dialog.tsx -- the question that makes a channel or edits one, asked from the sidebar's "+" and a row's menu, and from a phone's list of channels (STAG-547).
 *
 * Making one asks for a name, written as a channel's is (`channelSlug`),
 * and a purpose, the line an agent reads to choose it. Editing one asks for
 * the same two, filled in as they stand, and sends only what changed, so
 * its act waits until something has; #general's name stands locked, since
 * no member renames it, and its purpose is edited as any other's. Every
 * answer waits on the service, and a refusal stands in the card until what
 * was asked changes. A channel made is opened (`onMade`), so whoever made
 * it lands in it. The question goes with the workspace it was asked in, and
 * an edit with its channel once that is archived, and with the surface it
 * was asked on.
 */

/** Which question is asked: a channel to make, standing or a project's, or one to edit. */
const CHANNEL_ASK = { NEW: "new", EDIT: "edit" } as const;

type ChannelAsk =
  | { readonly kind: typeof CHANNEL_ASK.NEW; readonly project: boolean }
  | { readonly kind: typeof CHANNEL_ASK.EDIT; readonly channel: Channel };

/** A purpose as it is typed, on one line. */
function purposeLine(typed: string): string {
  return typed.replace(/[\r\n]+/gu, " ").trim();
}

/** What an edit sends: the name where it may change and did, and the purpose where it changed. */
function editOf(
  channel: Channel,
  name: string,
  purpose: string,
): { readonly name?: string; readonly purpose?: string } {
  return {
    ...(channelEditable(channel) && name !== channel.name ? { name } : {}),
    ...(purpose !== channel.purpose ? { purpose } : {}),
  };
}

/** What #general's Name says while it stands locked. */
const GENERAL_NAME_LOCKED = "#general keeps its name.";

/** A refusal as the confirming card reads it. */
export function answered(refused: string | undefined): ActionResult {
  return refused === undefined
    ? { status: ACTION_RESULT_STATUS.ACCEPTED }
    : { status: ACTION_RESULT_STATUS.REJECTED, reason: refused };
}

/** The question's doors and its card, which the asker draws once. */
export interface ChannelDialog {
  /** Asks for a channel to make, a project's where `project`. */
  readonly askNew: (project: boolean) => void;
  /** Asks for a channel's name and purpose, #general's purpose alone. */
  readonly askEdit: (channel: Channel) => void;
  readonly dialog: React.JSX.Element;
}

/** The question that makes or edits a channel of `workspaceId`; see the module's head. */
export function useChannelDialog({
  workspaceId,
  channels,
  shown,
  onMade,
}: {
  workspaceId: string | undefined;
  channels: ChannelsControl;
  /** Whether the surface asking is in sight, which the question closes with. */
  shown: boolean;
  /** Opens the channel just made. */
  onMade: (channelId: string) => void;
}): ChannelDialog {
  const [ask, setAsk] = useState<ChannelAsk | undefined>(undefined);
  const [askedIn, setAskedIn] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  const bodyId = useId();
  const listed = channels.channels ?? [];
  const edited = ask?.kind === CHANNEL_ASK.EDIT ? ask.channel : undefined;
  const confirm = useConfirmDialog(
    {
      // Note that the question stands while asked in the workspace listed, an edit's channel still open there.
      subject:
        ask !== undefined &&
        askedIn === workspaceId &&
        (edited === undefined || listed.some((each) => each.id === edited.id)),
      surfaceOpen: shown,
    },
    () => {
      if (ask === undefined) return Promise.resolve(answered(undefined));
      const written = channelSlug(name);
      if (ask.kind === CHANNEL_ASK.EDIT) {
        return channels
          .onEdit(ask.channel.id, editOf(ask.channel, written, purposeLine(purpose)))
          .then(answered);
      }
      return channels.onCreate(written, purposeLine(purpose), ask.project).then((made) => {
        if ("refused" in made) return answered(made.refused);
        onMade(made.channelId);
        return answered(undefined);
      });
    },
  );
  const editing = edited !== undefined;
  const nameLocked = edited !== undefined && !channelEditable(edited);
  const filled = channelSlug(name) !== "" && purposeLine(purpose) !== "";
  const valid =
    filled &&
    (edited === undefined ||
      Object.keys(editOf(edited, channelSlug(name), purposeLine(purpose))).length > 0);
  const form = useFormDialog(confirm, valid);
  // Note that a refused answer stands in the card until what was asked changes, which asks again.
  const typed = (set: (words: string) => void) => (words: string) => {
    set(words);
    if (confirm.rejection !== undefined) confirm.ask();
  };
  const making = ask?.kind === CHANNEL_ASK.NEW ? ask : undefined;
  const dialog = (
    <Dialog
      open={form.open}
      title={
        editing
          ? `Edit #${edited.name}`
          : making?.project === true
            ? "New project channel"
            : "New channel"
      }
      describedBy={editing ? undefined : bodyId}
      busy={form.settling}
      refused={form.refusal !== undefined}
      initialFocus={field}
      onDismiss={form.dismiss}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: editing ? "Save" : "Create channel",
            tone: DIALOG_TONE.PRIMARY,
            running: editing ? "Saving" : "Creating channel",
            ...form.act,
          }}
        />
      }
    >
      {editing ? null : (
        <Text id={bodyId} tone={TEXT_TONE.MUTED}>
          Everyone in the workspace sees it.
        </Text>
      )}
      <Stack>
        <FormField
          label="Name"
          description={nameLocked ? GENERAL_NAME_LOCKED : "Lowercase, with dashes."}
          count={{ length: name.length, limit: CHANNEL_BOUNDS.MAX_NAME_CHARS }}
        >
          {(control) => (
            <TextField
              ref={nameLocked ? undefined : field}
              field={control}
              placeholder="release-train"
              spellCheck={false}
              maxLength={CHANNEL_BOUNDS.MAX_NAME_CHARS}
              value={name}
              disabled={form.settling || nameLocked}
              onEnter={form.submit}
              onChange={typed(setName)}
            />
          )}
        </FormField>
        <FormField
          label="Purpose"
          description="Agents read it to choose where a thread goes."
          count={{ length: purpose.length, limit: CHANNEL_BOUNDS.MAX_PURPOSE_CHARS }}
        >
          {(control) => (
            <TextField
              ref={nameLocked ? field : undefined}
              field={control}
              placeholder="What belongs in the channel, in a line"
              maxLength={CHANNEL_BOUNDS.MAX_PURPOSE_CHARS}
              value={purpose}
              disabled={form.settling}
              onEnter={form.submit}
              onChange={typed(setPurpose)}
            />
          )}
        </FormField>
      </Stack>
      <ErrorLine>{form.refusal}</ErrorLine>
    </Dialog>
  );
  return {
    askNew: (project) => {
      setAskedIn(workspaceId);
      setAsk({ kind: CHANNEL_ASK.NEW, project });
      setName("");
      setPurpose("");
      confirm.ask();
    },
    askEdit: (channel) => {
      setAskedIn(workspaceId);
      setAsk({ kind: CHANNEL_ASK.EDIT, channel });
      setName(channel.name);
      setPurpose(channel.purpose);
      confirm.ask();
    },
    dialog,
  };
}
