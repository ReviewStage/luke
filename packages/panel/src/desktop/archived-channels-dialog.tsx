import type { ArchivedChannel } from "@luke/features/channel-wire";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  DIALOG_SIZE,
  Dialog,
  DialogActions,
  ErrorLine,
  ErrorState,
  LIST_ROW_ACTIONS,
  List,
  ListRow,
  NOTE_LINE_LOOK,
  NoteLine,
  SCROLL_SIZE,
  ScrollArea,
  TIME_LOOK,
  Time,
} from "@luke/ui";
import { useState } from "react";
import type { ChannelsControl } from "../tasks/use-channels.js";
import { useArchivedChannels } from "../tasks/use-channels.js";

/**
 * archived-channels-dialog.tsx -- Browse archived channels, from a sidebar section's head: the workspace's archived channels of that section, each with its Unarchive, and a press that opens one to read.
 *
 * The dialog reads the archived channels as it opens (`useArchivedChannels`),
 * the latest archived first, and lists those of the section it was opened
 * from, the standing channels' or the projects': each by its name, its
 * purpose, and when it was archived. Unarchive opens the channel again under
 * its own name, for everyone, as archiving it closed it; it asks nothing,
 * since it reaches nobody who loses anything, and a refusal, as where an
 * open channel now goes by its name, stands under the list. A press on a
 * row opens the channel in the Inbox's place and puts the dialog away; the
 * stream there draws an archived channel's threads to read, not to post in.
 */

/** What the dialog is asked for: the section it lists, in the workspace it was asked in. */
interface ArchivedAsk {
  readonly project: boolean;
  readonly workspaceId: string | undefined;
}

/** What the dialog says while it reads, where it could not, and where nothing is archived. */
const ARCHIVED_WORDS = {
  READING: "Reading archived channels…",
  NOT_READ: "Could not read this workspace's archived channels.",
  NONE: "Nothing here is archived.",
  UNARCHIVE: "Unarchive",
  UNARCHIVING: "Unarchiving",
} as const;

/** One archived channel's row: its name, purpose, when it was archived, and its Unarchive. */
function ArchivedRow({
  channel,
  busy,
  onOpen,
  onUnarchive,
}: {
  channel: ArchivedChannel;
  busy: boolean;
  onOpen: () => void;
  onUnarchive: () => void;
}): React.JSX.Element {
  return (
    <ListRow
      title={`#${channel.name}`}
      description={channel.purpose}
      meta={
        <>
          {"Archived "}
          <Time at={channel.archivedAt} look={TIME_LOOK.AGO} />
        </>
      }
      actions={
        <Button
          size={BUTTON_SIZE.COMPACT}
          variant={BUTTON_VARIANT.OUTLINE}
          busy={busy}
          busyLabel={ARCHIVED_WORDS.UNARCHIVING}
          onClick={onUnarchive}
        >
          {ARCHIVED_WORDS.UNARCHIVE}
        </Button>
      }
      actionsAt={LIST_ROW_ACTIONS.ALWAYS}
      onPress={onOpen}
    />
  );
}

/** The archived channels of one section, read as the dialog opens. */
function ArchivedList({
  workspaceId,
  project,
  channels,
  onOpen,
}: {
  workspaceId: string | undefined;
  project: boolean;
  channels: ChannelsControl;
  onOpen: (channelId: string) => void;
}): React.JSX.Element {
  const archived = useArchivedChannels(workspaceId);
  const [unarchiving, setUnarchiving] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const unarchive = (channelId: string) => {
    setUnarchiving(channelId);
    setRefusal(undefined);
    channels.onUnarchive(channelId).then((refused) => {
      setUnarchiving(undefined);
      setRefusal(refused);
      if (refused === undefined) archived.onRefresh();
    });
  };
  const listed = archived.channels?.filter((channel) => channel.project === project);
  if (listed === undefined) {
    return archived.failure === undefined ? (
      <NoteLine look={NOTE_LINE_LOOK.CENTRED} status>
        {ARCHIVED_WORDS.READING}
      </NoteLine>
    ) : (
      <ErrorState onRetry={archived.onRefresh}>{ARCHIVED_WORDS.NOT_READ}</ErrorState>
    );
  }
  if (listed.length === 0) {
    return <NoteLine look={NOTE_LINE_LOOK.CENTRED}>{ARCHIVED_WORDS.NONE}</NoteLine>;
  }
  return (
    <>
      <ScrollArea size={SCROLL_SIZE.CONTENT}>
        <List label="Archived channels">
          {listed.map((channel) => (
            <ArchivedRow
              key={channel.id}
              channel={channel}
              busy={unarchiving === channel.id}
              onOpen={() => onOpen(channel.id)}
              onUnarchive={() => unarchive(channel.id)}
            />
          ))}
        </List>
      </ScrollArea>
      <ErrorLine>{refusal}</ErrorLine>
    </>
  );
}

/** Browse archived channels as a sidebar holds it: the press that opens it for a section, and the dialog. */
export function useArchivedChannelsDialog({
  workspaceId,
  channels,
  shown,
  onOpen,
}: {
  workspaceId: string | undefined;
  channels: ChannelsControl;
  /** Whether the sidebar is in sight, which the dialog goes with. */
  shown: boolean;
  /** Opens a channel in the Inbox's place. */
  onOpen: (channelId: string) => void;
}): { readonly ask: (project: boolean) => void; readonly dialog: React.JSX.Element } {
  const [asked, setAsked] = useState<ArchivedAsk | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const standing = open && shown && asked?.workspaceId === workspaceId;
  const dismiss = () => setOpen(false);
  return {
    ask: (project) => {
      setAsked({ project, workspaceId });
      setOpen(true);
    },
    dialog: (
      <Dialog
        open={standing}
        size={DIALOG_SIZE.WIDE}
        title={asked?.project === true ? "Archived project channels" : "Archived channels"}
        onDismiss={dismiss}
        onExited={() => setAsked(undefined)}
        actions={<DialogActions onDone={dismiss} />}
      >
        {asked === undefined ? null : (
          <ArchivedList
            workspaceId={asked.workspaceId}
            project={asked.project}
            channels={channels}
            onOpen={(channelId) => {
              dismiss();
              onOpen(channelId);
            }}
          />
        )}
      </Dialog>
    ),
  };
}
