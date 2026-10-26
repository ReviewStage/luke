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
import { channelSlug } from "../tasks/channels-model.js";
import type { ChannelsControl } from "../tasks/use-channels.js";
import { useFormDialog } from "./use-form-dialog.js";

/**
 * channel-dialog.tsx -- the question that makes a channel or renames one, asked from the sidebar's "+" and a row's menu, and from a phone's list of channels (STAG-547).
 *
 * Making one asks for a name, written as a channel's is (`channelSlug`),
 * and a purpose, the line an agent reads to choose it; renaming asks for
 * the name alone. Every answer waits on the service, and a refusal stands
 * in the card until what was asked changes. A channel made is opened
 * (`onMade`), so whoever made it lands in it. The question goes with the
 * workspace it was asked in, and a rename with its channel once that is
 * archived, and with the surface it was asked on.
 */

/** Which question is asked: a channel to make, standing or a project's, or one to rename. */
const CHANNEL_ASK = { NEW: "new", RENAME: "rename" } as const;

type ChannelAsk =
  | { readonly kind: typeof CHANNEL_ASK.NEW; readonly project: boolean }
  | { readonly kind: typeof CHANNEL_ASK.RENAME; readonly channel: Channel };

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
  readonly askRename: (channel: Channel) => void;
  readonly dialog: React.JSX.Element;
}

/** The question that makes or renames a channel of `workspaceId`; see the module's head. */
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
  const renamed = ask?.kind === CHANNEL_ASK.RENAME ? ask.channel : undefined;
  const confirm = useConfirmDialog(
    {
      // Note that the question stands while asked in the workspace listed, a rename's channel still open there.
      subject:
        ask !== undefined &&
        askedIn === workspaceId &&
        (renamed === undefined || listed.some((each) => each.id === renamed.id)),
      surfaceOpen: shown,
    },
    () => {
      if (ask === undefined) return Promise.resolve(answered(undefined));
      const written = channelSlug(name);
      if (ask.kind === CHANNEL_ASK.RENAME) {
        return channels.onEdit(ask.channel.id, { name: written }).then(answered);
      }
      return channels
        .onCreate(written, purpose.replace(/[\r\n]+/gu, " ").trim(), ask.project)
        .then((made) => {
          if ("refused" in made) return answered(made.refused);
          onMade(made.channelId);
          return answered(undefined);
        });
    },
  );
  const renaming = renamed !== undefined;
  const valid = channelSlug(name) !== "" && (renaming || purpose.trim() !== "");
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
        renaming
          ? "Rename channel"
          : making?.project === true
            ? "New project channel"
            : "New channel"
      }
      describedBy={renaming ? undefined : bodyId}
      busy={form.settling}
      refused={form.refusal !== undefined}
      initialFocus={field}
      onDismiss={form.dismiss}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: renaming ? "Rename" : "Create channel",
            tone: DIALOG_TONE.PRIMARY,
            running: renaming ? "Renaming" : "Creating channel",
            ...form.act,
          }}
        />
      }
    >
      {renaming ? null : (
        <Text id={bodyId} tone={TEXT_TONE.MUTED}>
          Everyone in the workspace sees it.
        </Text>
      )}
      <Stack>
        <FormField
          label="Name"
          description="Lowercase, with dashes."
          count={{ length: name.length, limit: CHANNEL_BOUNDS.MAX_NAME_CHARS }}
        >
          {(control) => (
            <TextField
              ref={field}
              field={control}
              placeholder="release-train"
              spellCheck={false}
              maxLength={CHANNEL_BOUNDS.MAX_NAME_CHARS}
              value={name}
              disabled={form.settling}
              onEnter={form.submit}
              onChange={typed(setName)}
            />
          )}
        </FormField>
        {renaming ? null : (
          <FormField
            label="Purpose"
            description="Agents read it to choose where a thread goes."
            count={{ length: purpose.length, limit: CHANNEL_BOUNDS.MAX_PURPOSE_CHARS }}
          >
            {(control) => (
              <TextField
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
        )}
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
    askRename: (channel) => {
      setAskedIn(workspaceId);
      setAsk({ kind: CHANNEL_ASK.RENAME, channel });
      setName(channel.name);
      confirm.ask();
    },
    dialog,
  };
}
