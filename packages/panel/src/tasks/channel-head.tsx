import type { Channel } from "@luke/features/channel-wire";
import { agoText } from "@luke/features/time-format";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  EmptyState,
  NotFoundIcon,
  TOOLBAR_INSET,
  Toolbar,
} from "@luke/ui";
import { useState } from "react";
import type { InboxChannelHead } from "./inbox-list.js";

/**
 * channel-head.tsx -- what a channel adds to the Inbox narrowed to it: its head's name, its purpose or when it was archived, and an archived channel's Unarchive; and the Inbox's place where the channel chosen stands no more (STAG-547).
 *
 * A channel is the Inbox narrowed to one topic (`use-inbox-listing.ts`), so
 * its list, its reading pane, and its keys are the Inbox's own; only its
 * head is the channel's. An archived channel opened from Browse archived
 * channels heads its list with when it was archived in its purpose's place
 * and Unarchive before New thread, whose refusal stands under the head.
 */

/** What an archived channel's head offers. */
const ARCHIVED_WORDS = {
  UNARCHIVE: "Unarchive",
  UNARCHIVING: "Unarchiving",
} as const;

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
  now: number,
): InboxChannelHead {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<{ readonly id: string; readonly words: string }>();
  // Note that a refusal says why its own channel stayed archived, so another channel opened shows none.
  const refusal = refused?.id === channel.id ? refused.words : undefined;
  if (archived === undefined) {
    return {
      name: channel.name,
      detail: channel.purpose === "" ? undefined : channel.purpose,
      action: null,
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
    detail: `Archived ${agoText(archived.archivedAt, now)}`,
    action: (
      <Button
        size={BUTTON_SIZE.COMPACT}
        variant={BUTTON_VARIANT.OUTLINE}
        busy={busy}
        busyLabel={ARCHIVED_WORDS.UNARCHIVING}
        onClick={unarchive}
      >
        {ARCHIVED_WORDS.UNARCHIVE}
      </Button>
    ),
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
