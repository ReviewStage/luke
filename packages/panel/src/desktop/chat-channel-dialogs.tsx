import { CHAT_BOUNDS, type ChatAnswer, type ChatChannel } from "@luke/features/chat-wire";
import {
  ConfirmDialog,
  DIALOG_TONE,
  type DialogConfirm,
  FormField,
  Stack,
  TextField,
  useConfirmDialog,
} from "@luke/ui";
import { type ChatChannelChange, topicName, topicNameProblem } from "@luke/ui/chat-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useRef, useState } from "react";

/**
 * chat-channel-dialogs.tsx -- the questions Chat asks to open a topic channel, to rename it or say what it is for, and to archive it.
 *
 * A topic is the room's own, so any person in the workspace opens one,
 * names it, says in a line what it is for, and archives it, as an agent may
 * (`post_chat`). New channel and Edit channel ask the same two things: a
 * name, written as a channel's is (lower case, a hyphen for each run of
 * spaces), held to its grammar and refused where another channel holds it,
 * and a purpose, which shows under the name and in every agent's read.
 * Archive asks first, since an archived topic takes no post. Each answer
 * waits on the service, and a refusal stands in the card until the next
 * key changes what was asked.
 */

/** Which question is asked: a channel to open, or one of the room's topics to edit. */
const CHANNEL_ASK = { NEW: "new", EDIT: "edit" } as const;

/** What a question is about: a channel to open, or one of the room's topics to edit. */
type ChannelAsk =
  | { readonly kind: typeof CHANNEL_ASK.NEW }
  | { readonly kind: typeof CHANNEL_ASK.EDIT; readonly channel: ChatChannel };

/** The questions as Chat asks them, and the card that stands while one is. */
export interface ChannelDialogs {
  readonly askNew: () => void;
  readonly askEdit: (channel: ChatChannel) => void;
  readonly askArchive: (channel: ChatChannel) => void;
  readonly dialog: React.ReactNode;
}

/** An answer as the confirming card reads it: taken, or refused with why. */
function answered(refused: string | undefined): ActionResult {
  return refused === undefined
    ? { status: ACTION_RESULT_STATUS.ACCEPTED }
    : { status: ACTION_RESULT_STATUS.REJECTED, reason: refused };
}

/** The change an answer writes: the channel opened, or only what was changed of the one edited. */
function changeOf(ask: ChannelAsk, name: string, purpose: string): ChatChannelChange {
  // Note that a purpose is one line, so whatever breaks it is written as a space.
  const said = purpose.replace(/\s+/gu, " ").trim();
  if (ask.kind === CHANNEL_ASK.NEW) {
    return { open: { name, ...(said === "" ? undefined : { purpose: said }) } };
  }
  const { channel } = ask;
  return {
    edit: {
      channelId: channel.id,
      ...(name === channel.name ? undefined : { name }),
      ...(said === (channel.purpose ?? "") ? undefined : { purpose: said === "" ? null : said }),
    },
  };
}

export function useChannelDialogs(
  workspaceId: string | undefined,
  chat: ChatAnswer | undefined,
  onChannel: (change: ChatChannelChange) => Promise<string | undefined>,
  surfaceOpen: boolean,
): ChannelDialogs {
  const [ask, setAsk] = useState<ChannelAsk | undefined>(undefined);
  // The workspace a question was asked in, which it goes with: another workspace listed puts it away.
  const [askedIn, setAskedIn] = useState<string | undefined>(undefined);
  /** Whether a question still stands: asked in the workspace shown, its channel still one of that chat's. */
  const standing = (channel: ChatChannel | undefined) =>
    askedIn === workspaceId &&
    (channel === undefined || (chat?.channels.some((each) => each.id === channel.id) ?? false));
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [doomed, setDoomed] = useState<ChatChannel | undefined>(undefined);
  const field = useRef<HTMLInputElement | null>(null);
  const confirm: DialogConfirm = useConfirmDialog(
    {
      subject:
        ask !== undefined && standing(ask.kind === CHANNEL_ASK.EDIT ? ask.channel : undefined),
      surfaceOpen,
    },
    () => {
      if (ask === undefined || chat === undefined) {
        return Promise.resolve(answered(undefined));
      }
      const written = topicName(name);
      const renaming = ask.kind === CHANNEL_ASK.EDIT ? ask.channel.id : undefined;
      const problem = topicNameProblem(chat, written, renaming);
      if (problem !== undefined) return Promise.resolve(answered(problem));
      return onChannel(changeOf(ask, written, purpose)).then(answered);
    },
  );
  const archive = useConfirmDialog(
    { subject: doomed !== undefined && standing(doomed), surfaceOpen },
    () =>
      doomed === undefined
        ? Promise.resolve(answered(undefined))
        : onChannel({ edit: { channelId: doomed.id, archived: true } }).then(answered),
  );
  // Note that a refused answer stands in the card until what was asked changes, which asks again.
  const typed = (set: (words: string) => void) => (words: string) => {
    set(words);
    if (confirm.rejection !== undefined) confirm.ask();
  };
  const editing = ask?.kind === CHANNEL_ASK.EDIT;
  const dialog = (
    <>
      <ConfirmDialog
        confirm={confirm}
        field={field}
        question={{
          title: editing ? "Edit channel" : "New channel",
          body: "A topic channel is open to everyone in the workspace, agents included.",
          verb: editing ? "Save" : "Create channel",
          running: editing ? "Saving" : "Creating channel",
          tone: DIALOG_TONE.PRIMARY,
        }}
      >
        <Stack>
          <FormField label="Name" description="Lowercase, with dashes, as agents write it after #.">
            {(control) => (
              <TextField
                ref={field}
                field={control}
                placeholder="release-train"
                spellCheck={false}
                maxLength={CHAT_BOUNDS.MAX_KEY_CHARS}
                value={name}
                disabled={confirm.busy}
                onChange={typed(setName)}
              />
            )}
          </FormField>
          <FormField
            label="Purpose"
            description="Shown under its name, and to every agent that reads it."
          >
            {(control) => (
              <TextField
                field={control}
                placeholder="What the channel is for, in a line"
                maxLength={CHAT_BOUNDS.MAX_PURPOSE_CHARS}
                value={purpose}
                disabled={confirm.busy}
                onChange={typed(setPurpose)}
              />
            )}
          </FormField>
        </Stack>
      </ConfirmDialog>
      <ConfirmDialog
        confirm={archive}
        question={{
          title: "Archive channel?",
          body: `#${doomed?.name ?? ""} leaves the rail and takes no more posts. Nothing in it is deleted.`,
          verb: "Archive channel",
          running: "Archiving",
        }}
      />
    </>
  );
  return {
    askNew: () => {
      setAskedIn(workspaceId);
      setAsk({ kind: CHANNEL_ASK.NEW });
      setName("");
      setPurpose("");
      confirm.ask();
    },
    askEdit: (channel) => {
      setAskedIn(workspaceId);
      setAsk({ kind: CHANNEL_ASK.EDIT, channel });
      setName(channel.name ?? "");
      setPurpose(channel.purpose ?? "");
      confirm.ask();
    },
    askArchive: (channel) => {
      setAskedIn(workspaceId);
      setDoomed(channel);
      archive.ask();
    },
    dialog,
  };
}
