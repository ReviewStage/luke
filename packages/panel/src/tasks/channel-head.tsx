import type { Channel } from "@luke/features/channel-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { readFailedWords } from "@luke/features/words";
import {
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  NotFoundIcon,
  TOOLBAR_INSET,
  Toolbar,
} from "@luke/ui";
import { useState } from "react";
import { unreadShown } from "../failure-report.js";
import type { InboxChannelHead } from "./inbox-list.js";

/**
 * channel-head.tsx -- what a channel adds to the Inbox narrowed to it: its head's name, its purpose or when it was archived, and an archived channel's Unarchive; and the Inbox's place where the channel chosen stands no more (STAG-547).
 *
 * A channel is the Inbox narrowed to one topic (`use-inbox-listing.ts`), so
 * its list, its reading pane, and its keys are the Inbox's own; only its
 * head is the channel's. An archived channel opened from Browse archived
 * channels heads its list with when it was archived in its purpose's place
 * and Unarchive beside it; a refusal stands under the head. Where the workspace's
 * channels could not be read, the list's place says so with Retry rather
 * than standing a list narrowed to a channel it cannot name.
 */

/** What the Inbox says in its list's place where the workspace's channels could not be read. */
const CHANNELS_NOT_READ = readFailedWords("this workspace's channels");

/** The channel the Inbox is narrowed to, open or archived, as its head names it. */
export type HeadedChannel = Pick<Channel, "id" | "name" | "purpose">;

/** An archived channel: when it was archived, and the door that opens it again, answering what refused it, or none where it opened. */
export interface ArchivedHead {
  readonly archivedAt: number;
  readonly onUnarchive: () => Promise<string | undefined>;
}

/** The head of the Inbox narrowed to `channel`: its name, its purpose or when it was archived, and Unarchive where it is archived. */
export function useChannelHead(
  channel: HeadedChannel,
  archived: ArchivedHead | undefined,
): InboxChannelHead {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<{ readonly id: string; readonly words: string }>();
  // Note that a refusal says why its own channel stayed archived, so another channel opened shows none.
  const refusal = refused?.id === channel.id ? refused.words : undefined;
  if (archived === undefined) {
    return {
      name: channel.name,
      detail: channel.purpose === "" ? undefined : channel.purpose,
      archivedAt: undefined,
      unarchive: undefined,
      refusal,
    };
  }
  const unarchive = () => {
    setBusy(true);
    setRefused(undefined);
    archived.onUnarchive().then((words) => {
      setBusy(false);
      if (words !== undefined) setRefused({ id: channel.id, words });
    });
  };
  return {
    name: channel.name,
    detail: undefined,
    archivedAt: archived.archivedAt,
    unarchive: { busy, onUnarchive: unarchive },
    refusal,
  };
}

/**
 * The list's place where the channel chosen stands no more: archived, by
 * whoever archived it, since the archived channels were read, or never one
 * of the workspace's, as a link to it may name; with the way to #general
 * where the workspace holds it.
 */
export function ChannelMissing({
  onGeneral,
}: {
  onGeneral: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <section
      className="channel-missing flex min-h-0 min-w-0 flex-col"
      aria-label="Channel not found"
    >
      <Toolbar end={TOOLBAR_INSET.COLUMN} />
      <EmptyState
        icon={<NotFoundIcon />}
        title="Channel not found"
        action={
          onGeneral === undefined ? undefined : { label: "Go to #general", onClick: onGeneral }
        }
      >
        This channel was archived, or isn't one of this workspace's.
      </EmptyState>
    </section>
  );
}

/** The list's place while a channel is chosen and the workspace's channels could not be read, with Retry. */
export function ChannelsNotRead({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <section
      className="channels-not-read flex min-h-0 min-w-0 flex-col"
      aria-label="Channels not read"
    >
      <Toolbar end={TOOLBAR_INSET.COLUMN} />
      <ErrorState
        failure={unreadShown(FAILURE_SURFACE.CHANNEL_READ)}
        placement={ERROR_STATE_PLACEMENT.CENTRED}
        onRetry={onRetry}
      >
        {CHANNELS_NOT_READ}
      </ErrorState>
    </section>
  );
}
