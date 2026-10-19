import { CHANNEL_KIND } from "@luke/features/chat-wire";
import type { MentionPlace } from "@luke/features/mention-link";
import {
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  NAV_CURRENT,
  NavItem,
  ScrollArea,
} from "@luke/ui";
import {
  CHAT_PLACE,
  type ChatPlace,
  type ChatRailRow,
  chatNames,
  chatRail,
  FOR_YOU,
} from "@luke/ui/chat-model";
import { AtSignIcon, HashIcon, MessagesSquareIcon } from "lucide-react";
import { useMemo } from "react";
import { SpinnerRegion } from "../spinner.js";
import { ChatPane, MemberMark } from "../tasks/chat-pane.js";
import { useMinute } from "../tasks/task-time.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * desktop-chat.tsx -- the window's Chat: the workspace's channels and direct messages in a rail of their own, and For you or the channel chosen read beside it.
 *
 * It stands in the plan's place beside the sidebar, whose Chat row is
 * marked while it does, as the window's Inbox (`desktop-inbox.tsx`) does.
 * The rail is drawn from the sidebar's own pieces: For you at its head,
 * counting what waits on the developer, then the channels, then the direct
 * messages, each group under its heading as Settings' page list's are
 * (`.section-heading`), each row counting what in it the developer has not read and
 * in the unread weight while anything is (`chat-model.ts`). A direct
 * message's row leads with the other member's mark and names their agent's
 * title or plan after their handle. A press on a row shows its place in
 * the pane beside the rail (`chat-pane.tsx`). The agents are named from
 * the plans' summaries, the way the sidebar names them, and from the lines
 * the chat read carries where those name more. With nothing read, it says
 * so under Chat's glyph. Any row of the sidebar leaves it for the plan it
 * stood over; Escape does not, as it does not leave the Inbox, so a stray
 * press never loses the place being read.
 */

/** The workspace a chip's link is written in, the chat's own; none while no workspace is listed. */
function mentionPlaceOf(tasks: TasksControl): MentionPlace | undefined {
  const { workspace } = tasks;
  if (workspace === undefined) return undefined;
  return { workspace: workspace.slug ?? workspace.id, repository: null };
}

/** What a row's count is read as. */
const UNREAD = "unread";

/** What the view says where no chat is read. */
const NO_CHAT = "Chat is not available yet.";

/** What the view says where the workspace's chat could not be read. */
const CHAT_FAILED = "The workspace's chat could not be read.";

/** Whether a row stands for the place shown. */
function shows(place: ChatPlace, row: ChatRailRow): boolean {
  return place.kind === CHAT_PLACE.CHANNEL && place.channelId === row.channel.id;
}

/** One channel's or direct message's row: its glyph or the other member's mark, its name, what it says after, and its count. */
function RailRow({
  row,
  current,
  onChoose,
}: {
  row: ChatRailRow;
  current: boolean;
  onChoose: () => void;
}): React.JSX.Element {
  return (
    <li>
      <NavItem
        icon={row.other === undefined ? <HashIcon /> : <MemberMark who={row.other} small />}
        detail={row.sub}
        current={current ? NAV_CURRENT.PAGE : undefined}
        unread={row.unread > 0}
        count={{ value: row.unread, noun: UNREAD }}
        onClick={onChoose}
      >
        {row.label}
      </NavItem>
    </li>
  );
}

/** The window's Chat, in the plan's place: the rail, and the place chosen beside it. */
export function DesktopChat({
  tasks,
  accountName,
}: {
  tasks: TasksControl;
  accountName: string | undefined;
}): React.JSX.Element {
  const view = tasks.chatView;
  const now = useMinute();
  const openLink = useOpenLink();
  const read = view.chat;
  const listed = tasks.tasks;
  const names = useMemo(
    () => chatNames(listed, read?.agents ?? [], accountName),
    [listed, read, accountName],
  );
  if (read === undefined || view.failed) {
    // Nothing read yet: a read that did not answer, one still out, or no chat to read at all.
    const standIn = view.failed ? (
      <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={view.onRetry}>
        {CHAT_FAILED}
      </ErrorState>
    ) : view.available ? (
      <SpinnerRegion label="Loading chat" />
    ) : (
      <EmptyState icon={<MessagesSquareIcon />}>{NO_CHAT}</EmptyState>
    );
    return (
      <div className="chat-view">
        <section className="chat-stream" aria-label="Chat">
          <header className="desktop-toolbar" />
          {standIn}
        </section>
      </div>
    );
  }
  const chat = read.answer;
  const rail = chatRail(chat, names);
  const row = (each: ChatRailRow) => (
    <RailRow
      key={each.channel.id}
      row={each}
      current={shows(view.place, each)}
      onChoose={() => view.onChoose({ kind: CHAT_PLACE.CHANNEL, channelId: each.channel.id })}
    />
  );
  return (
    <div className="chat-view">
      <nav className="chat-rail" aria-label="Chat">
        <header className="desktop-toolbar chat-rail-bar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">Chat</h1>
          </div>
        </header>
        <ScrollArea>
          <div className="chat-rail-body">
            <ul className="sidebar-tasks">
              <li>
                <NavItem
                  icon={<AtSignIcon />}
                  current={view.place.kind === CHAT_PLACE.FOR_YOU ? NAV_CURRENT.PAGE : undefined}
                  unread={rail.forYou > 0}
                  count={{ value: rail.forYou, noun: UNREAD }}
                  onClick={() => view.onChoose(FOR_YOU)}
                >
                  For you
                </NavItem>
              </li>
            </ul>
            <section className="chat-rail-group">
              <h2 className="section-heading">Channels</h2>
              <ul className="sidebar-tasks">{rail.channels.map(row)}</ul>
            </section>
            {rail.direct.length === 0 ? null : (
              <section className="chat-rail-group">
                <h2 className="section-heading">Direct messages</h2>
                <ul className="sidebar-tasks">{rail.direct.map(row)}</ul>
              </section>
            )}
          </div>
        </ScrollArea>
      </nav>
      <ChatPane
        chat={chat}
        names={names}
        place={view.place}
        mentionPlace={mentionPlaceOf(tasks)}
        now={now}
        openLink={openLink}
        onPost={view.onPost}
        onAnswer={view.onAnswer}
      />
    </div>
  );
}

/** What the plan's Chat tab says where its plan has no channel yet. */
const NO_TASK_CHANNEL = "Nothing is posted in this task's channel yet.";

/**
 * The plan's own Chat tab, in the plan's column: its channel of the
 * workspace's chat, at reading size, as the window's Chat shows it, its
 * composer posting there. A plan whose channel is not opened yet, which
 * its first post opens, says so; a chat not read yet waits on the read.
 */
export function TaskChatTab({
  tasks,
  taskId,
}: {
  tasks: TasksControl;
  taskId: string;
}): React.JSX.Element {
  const view = tasks.chatView;
  const now = useMinute();
  const openLink = useOpenLink();
  const read = view.chat;
  const listed = tasks.tasks;
  const names = useMemo(() => chatNames(listed, read?.agents ?? [], undefined), [listed, read]);
  const channel = read?.answer.channels.find(
    (each) => each.kind === CHANNEL_KIND.TASK && each.planId === taskId,
  );
  if (read === undefined || channel === undefined) {
    return (
      <section className="chat-stream task-chat" aria-label="Chat">
        {view.failed ? (
          <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={view.onRetry}>
            {CHAT_FAILED}
          </ErrorState>
        ) : read === undefined && view.available ? (
          <SpinnerRegion label="Loading chat" />
        ) : (
          <EmptyState icon={<MessagesSquareIcon />}>{NO_TASK_CHANNEL}</EmptyState>
        )}
      </section>
    );
  }
  return (
    <ChatPane
      chat={read.answer}
      names={names}
      place={{ kind: CHAT_PLACE.CHANNEL, channelId: channel.id }}
      mentionPlace={mentionPlaceOf(tasks)}
      now={now}
      openLink={openLink}
      onPost={view.onPost}
      onAnswer={view.onAnswer}
    />
  );
}
