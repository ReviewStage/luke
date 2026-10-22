import { CHANNEL_KIND, type ChatAnswer, type ChatChannel } from "@luke/features/chat-wire";
import { type ChatNames, channelLabel } from "@luke/ui/chat-model";
import { PlanGlyph } from "./tab-look.js";
import { useTaskStatus } from "./use-known-names.js";

/**
 * chat-channel-name.tsx -- a channel of the workspace's chat by name, as the rail names it, wherever Chat or a chat notice names one.
 *
 * A task's channel is named as every place names a task: its status's glyph
 * and its name (`PlanGlyph`), never as a `#name`, which stays a topic's and
 * #general's. A direct message is named by who it is with.
 */

/**
 * A channel's name in words: a topic's or #general's `#name`, a task's by
 * its task's name as the window holds it, so a rename reaches it, and its
 * channel's own name until the task is read, or a DM by who it is with,
 * both of its two's names where the reader is neither (`channelLabel`).
 */
export function channelTitle(
  chat: Pick<ChatAnswer, "self" | "members">,
  names: ChatNames,
  channel: ChatChannel,
): string {
  const label = channelLabel(chat, names, channel);
  if (channel.kind === CHANNEL_KIND.TASK) {
    return (channel.planId === undefined ? undefined : names.tasks.get(channel.planId)) ?? label;
  }
  return channel.kind === CHANNEL_KIND.DM ? label : `#${label}`;
}

/** A channel by name as drawn: a task's glyph before its name, else its name in words (`channelTitle`). */
export function ChannelName({
  chat,
  names,
  channel,
}: {
  chat: Pick<ChatAnswer, "self" | "members">;
  names: ChatNames;
  channel: ChatChannel;
}): React.JSX.Element {
  const status = useTaskStatus(channel.kind === CHANNEL_KIND.TASK ? channel.planId : undefined);
  const title = channelTitle(chat, names, channel);
  if (channel.kind !== CHANNEL_KIND.TASK) return <>{title}</>;
  return (
    <>
      <span className="chat-channel-glyph">
        <PlanGlyph status={status} />
      </span>
      {title}
    </>
  );
}
